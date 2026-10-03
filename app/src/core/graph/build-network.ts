/**
 * 事件网络的数据构造（ADR-015）。
 *
 * 两级：
 *   **事件线级**（默认）—— 一条事件线 = 一个节点，边由代码推导
 *   **节点级**（下钻）—— 某条线的节点展开成子图
 *
 * 边的推导**不需要 LLM**（PRD 1.5 的 shares_node / shares_character / temporal_overlap）。
 */
import type { EventLine, StoredNode } from '@/core/schema/index.ts'

export type EdgeKind = 'shares_node' | 'shares_character' | 'temporal_overlap' | 'contains'

export interface NetworkNode {
  id: string
  kind: 'line' | 'node'
  label: string
  sublabel?: string
  chapters: string[]
  lineStatus?: EventLine['lineStatus']
  /** 事件线级：这条线有多少节点 */
  nodeCount?: number
}

export interface NetworkEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
}

export interface NetworkGraph {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
}

function overlap(a: string[], b: string[]): boolean {
  const setB = new Set(b)
  return a.some((x) => setB.has(x))
}

/**
 * 章节标识比较器。
 *
 * ⚠️ **不能用字符串比较** —— `"5" <= "10"` 在字符串下是 false，多位数章节会判错。
 * 按 `.` 分段后各段转数字比较；转不出来（非数字）时退回字符串比较。
 * 支持切块标识 `"101.1"`。
 */
export function compareChapterIndex(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const sa = pa[i]
    const sb = pb[i]
    if (sa === undefined) return -1
    if (sb === undefined) return 1
    const na = Number(sa)
    const nb = Number(sb)
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na - nb
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1
    }
  }
  return 0
}

/** 章节区间是否重叠（按数字序比较）。 */
function chapterRangesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const sortedA = [...a].sort(compareChapterIndex)
  const sortedB = [...b].sort(compareChapterIndex)
  const minA = sortedA[0]!
  const maxA = sortedA[sortedA.length - 1]!
  const minB = sortedB[0]!
  const maxB = sortedB[sortedB.length - 1]!
  return compareChapterIndex(minA, maxB) <= 0 && compareChapterIndex(minB, maxA) <= 0
}

/**
 * 事件线级图：一条线一个节点；两条线之间只要有共享节点 / 共享人物 / 章节区间重叠就连边。
 *
 * 注意：这里**不做因果推理** —— 因果留到游玩阶段由 Agent 产生。
 */
export function buildLineLevelGraph(lines: EventLine[], nodes: StoredNode[]): NetworkGraph {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const graphNodes: NetworkNode[] = lines.map((l) => ({
    id: l.id,
    kind: 'line',
    label: l.title,
    sublabel: l.result || l.cause || '',
    chapters: l.chapters,
    lineStatus: l.lineStatus,
    nodeCount: l.nodeIds.length,
  }))

  const edges: NetworkEdge[] = []
  const seen = new Set<string>()

  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i]!
      const b = lines[j]!
      const kinds: EdgeKind[] = []

      // 共享节点
      if (overlap(a.nodeIds, b.nodeIds)) kinds.push('shares_node')
      // 共享人物
      else if (overlap(a.characterIds, b.characterIds)) kinds.push('shares_character')
      // 章节区间重叠
      else if (chapterRangesOverlap(a.chapters, b.chapters)) kinds.push('temporal_overlap')

      for (const kind of kinds) {
        const key = `${a.id}->${b.id}:${kind}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ id: key, source: a.id, target: b.id, kind })
      }
    }
  }

  void nodeById
  return { nodes: graphNodes, edges }
}

/**
 * 节点级图：把某条事件线展开成它的节点序列。
 *
 * 节点之间按**顺序**连边（章节序 + 章内 order），因为事件线本身就是按时序串起来的。
 * 同时也画出该线与其他线的连接点（用 `contains` 之外的边表示"这个节点也属于别的线"）。
 */
export function buildNodeLevelGraph(
  line: EventLine,
  nodes: StoredNode[],
  allLines: EventLine[],
): NetworkGraph {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const members = line.nodeIds
    .map((id) => nodeById.get(id))
    .filter((n): n is StoredNode => Boolean(n))
    .sort((a, b) =>
      a.chapterIndex === b.chapterIndex
        ? a.order - b.order
        : a.chapterIndex.localeCompare(b.chapterIndex, undefined, { numeric: true }),
    )

  const graphNodes: NetworkNode[] = members.map((n) => ({
    id: n.id,
    kind: 'node',
    label: n.name,
    sublabel: n.summary,
    chapters: [n.chapterIndex],
  }))

  const edges: NetworkEdge[] = []
  for (let i = 0; i + 1 < members.length; i += 1) {
    edges.push({
      id: `${members[i]!.id}->${members[i + 1]!.id}`,
      source: members[i]!.id,
      target: members[i + 1]!.id,
      kind: 'contains',
    })
  }

  // 该线之外还有哪些线也引用了这些节点（多对多关系要看得见）
  for (const other of allLines) {
    if (other.id === line.id) continue
    const shared = other.nodeIds.filter((id) => line.nodeIds.includes(id))
    if (shared.length === 0) continue
    // 用一个代表节点连到"另一条线"的虚拟节点上
    const anchor = shared[0]!
    if (!nodeById.has(anchor)) continue
    graphNodes.push({
      id: other.id,
      kind: 'line',
      label: other.title,
      chapters: other.chapters,
      lineStatus: other.lineStatus,
      nodeCount: other.nodeIds.length,
    })
    edges.push({ id: `${anchor}->${other.id}`, source: anchor, target: other.id, kind: 'shares_node' })
  }

  return { nodes: graphNodes, edges }
}

/** 从图里挑出「主干」节点（度数最高的若干），供 UI 高亮用。 */
export function topByDegree(graph: NetworkGraph, limit = 5): string[] {
  const degree = new Map<string, number>()
  for (const n of graph.nodes) degree.set(n.id, 0)
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  return [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}

