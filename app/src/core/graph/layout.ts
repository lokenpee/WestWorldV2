/**
 * 用 dagre 算「从左到右」的分层布局（ADR-015）。
 *
 * 纯计算，不碰 DOM —— 所以放在 core/ 里，可单测、将来也能搬进 Worker。
 */
import dagre from '@dagrejs/dagre'
import type { NetworkGraph } from './build-network.ts'

export interface PositionedNode {
  id: string
  x: number
  y: number
}

export interface LayoutOptions {
  direction?: 'LR' | 'TB'
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number
  nodeSep?: number
}

/** 算布局。返回每个节点的坐标（左上角）。 */
export function layoutGraph(graph: NetworkGraph, options: LayoutOptions = {}): PositionedNode[] {
  const {
    direction = 'LR',
    nodeWidth = 220,
    nodeHeight = 80,
    rankSep = 120,
    nodeSep = 40,
  } = options

  if (graph.nodes.length === 0) return []

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of graph.nodes) {
    g.setNode(n.id, { width: nodeWidth, height: nodeHeight })
  }
  for (const e of graph.edges) {
    // dagre 不接受自环/悬空边
    if (e.source === e.target) continue
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    g.setEdge(e.source, e.target)
  }

  dagre.layout(g)

  return graph.nodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number } | undefined
    return {
      id: n.id,
      x: (pos?.x ?? 0) - nodeWidth / 2,
      y: (pos?.y ?? 0) - nodeHeight / 2,
    }
  })
}
