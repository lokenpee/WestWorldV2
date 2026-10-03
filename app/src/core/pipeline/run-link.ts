/**
 * P2/P3 · 串联事件线（把散落的事件节点聚成「一件事」）。
 *
 * 三个关键设计：
 *   ① **按时序分批**（ADR-017）—— 一窗口可能上千节点，全塞进 prompt 会爆
 *   ② **只输出操作**（append / create）—— 天然实现「能续就续，不要新建」
 *   ③ **派生字段由代码算**（chapters / timeRange / characterIds）—— 不让模型编
 */
import type { Character, EventLine, EventLineOp, StoredNode } from '@/core/schema/index.ts'
import { LinkEventLinesResultSchema } from '@/core/schema/index.ts'
import { getCanonDb } from '@/core/db/canon.ts'
import { listNodes } from '@/core/db/repo.ts'
import { getEventBus, type EventBus } from '@/core/events/bus.ts'
import { callModel } from '@/core/llm/call.ts'
import { PROMPTS } from '@/core/prompts/index.ts'

/** 单批节点数上限（ADR-017 的阈值，可配）。 */
export const DEFAULT_BATCH_SIZE = 400

export interface RunLinkOptions {
  signal?: AbortSignal
  deps?: { call?: typeof callModel }
  bus?: EventBus
  batchSize?: number
}

export interface RunLinkResult {
  status: 'completed' | 'cancelled'
  batches: number
  nodeCount: number
  eventLineCount: number
  cost: number
  failedBatches: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 按时序切成若干批（纯函数，可单测）。**必须连续切，不能随机** —— 否则同一件事会被切到两批。 */
export function splitIntoBatches<T>(items: readonly T[], batchSize: number): T[][] {
  if (batchSize <= 0) throw new Error('batchSize 必须 > 0')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += batchSize) out.push(items.slice(i, i + batchSize))
  return out
}

/** 让模型看到的「已有事件线」摘要。 */
export function buildExistingLinesDigest(lines: EventLine[]): string {
  if (lines.length === 0) return '（还没有任何事件线）'
  return lines
    .map((l) => `${l.id} | ${l.title} | 章节 ${l.chapters[0] ?? '?'}-${l.chapters[l.chapters.length - 1] ?? '?'} | ${l.lineStatus}`)
    .join('\n')
}

/** 让模型看到的「本批节点」列表。 */
export function buildNodesDigest(nodes: StoredNode[]): string {
  return nodes
    .map((n) => `${n.id} | ${n.name} | ${n.actors.join('、') || '—'} | 第${n.chapterIndex}章`)
    .join('\n')
}

function buildMessage(batch: StoredNode[], existing: EventLine[]): string {
  return [
    '【已有事件线】（新节点若属于其中一条，请用 op=append，不要新建）',
    buildExistingLinesDigest(existing),
    '',
    '【本批事件节点】',
    buildNodesDigest(batch),
  ].join('\n')
}

/** 由成员节点算出派生字段（chapters / timeRange）——不让模型编。 */
export function deriveLineFields(
  nodeIds: string[],
  nodeById: Map<string, StoredNode>,
): { chapters: string[]; timeRange?: string[] } {
  const chapters = new Set<string>()
  const times: string[] = []
  for (const id of nodeIds) {
    const n = nodeById.get(id)
    if (!n) continue
    chapters.add(n.chapterIndex)
    if (n.timeCoord) times.push(n.timeCoord)
  }
  const sortedChapters = [...chapters].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (times.length === 0) return { chapters: sortedChapters }
  times.sort()
  return { chapters: sortedChapters, timeRange: [times[0]!, times[times.length - 1]!] }
}

/** 把节点的 actors（原文称呼）解析成人物实体 id。 */
export function resolveCharacterIds(nodeIds: string[], nodeById: Map<string, StoredNode>, chars: Character[]): string[] {
  const nameToId = new Map<string, string>()
  for (const c of chars) {
    nameToId.set(c.name, c.id)
    for (const a of c.aliases) nameToId.set(a, c.id)
  }
  const out = new Set<string>()
  for (const id of nodeIds) {
    const n = nodeById.get(id)
    if (!n) continue
    for (const actor of n.actors) {
      const cid = nameToId.get(actor)
      if (cid) out.add(cid)
    }
  }
  return [...out]
}

export async function runLink(bookId: string, options: RunLinkOptions = {}): Promise<RunLinkResult> {
  const { signal, deps = {}, bus = getEventBus(), batchSize = DEFAULT_BATCH_SIZE } = options
  const call = deps.call ?? callModel

  const db = getCanonDb()
  const nodes = await listNodes(bookId)
  const existingLines = await db.eventLines.where('bookId').equals(bookId).toArray()
  const characters = await db.characters.where('bookId').equals(bookId).toArray()

  bus.emit({ type: 'task:start', bookId, stage: 'P3', total: 1 })

  if (nodes.length === 0) {
    bus.emit({ type: 'task:done', bookId, stage: 'P3', completed: 0, failed: 0 })
    return { status: 'completed', batches: 0, nodeCount: 0, eventLineCount: 0, cost: 0, failedBatches: 0 }
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const batches = splitIntoBatches(nodes, batchSize)
  // 内存中的事件线（跨批次累积）——后一批要靠「已有事件线」才能续上
  const lineMap = new Map<string, EventLine>(existingLines.map((l) => [l.id, l]))
  let nextLineNumber = lineMap.size + 1
  let cost = 0
  let failedBatches = 0

  for (const [i, batch] of batches.entries()) {
    if (signal?.aborted) break
    bus.emit({ type: 'log', level: 'info', message: `  第 ${i + 1}/${batches.length} 批（${batch.length} 个节点）…` })

    const res = await call({
      role: 'aggregation',
      system: PROMPTS.linkEventLines,
      messages: [{ role: 'user', content: buildMessage(batch, [...lineMap.values()]), timestamp: Date.now() }],
      schema: LinkEventLinesResultSchema,
      submitToolDescription: '提交对事件线的增量操作（append / create）。',
      temperature: 0,
      ...(signal ? { signal } : {}),
    })
    for (const u of res.attemptsUsage) cost += u.cost

    if (!res.ok || !res.data) {
      failedBatches += 1
      bus.emit({
        type: 'log',
        level: 'warn',
        message: `  第 ${i + 1} 批失败（${res.errorKind ?? 'unknown'}），跳过`,
      })
      continue
    }

    for (const op of res.data.event_line_ops as EventLineOp[]) {
      if (op.op === 'append') {
        const line = lineMap.get(op.line_id)
        if (!line) {
          // 模型引用了不存在的线 —— 不静默吞掉，记一条日志
          bus.emit({ type: 'log', level: 'warn', message: `  引用了不存在的事件线 ${op.line_id}，已忽略` })
          continue
        }
        const merged = [...new Set([...line.nodeIds, ...op.node_ids])]
        const derived = deriveLineFields(merged, nodeById)
        lineMap.set(line.id, {
          ...line,
          nodeIds: merged,
          chapters: derived.chapters,
          ...(derived.timeRange ? { timeRange: derived.timeRange } : {}),
          cause: op.cause,
          process: op.process,
          result: op.result,
          lineStatus: op.line_status,
          characterIds: resolveCharacterIds(merged, nodeById, characters),
          updatedAt: new Date().toISOString(),
        })
      } else {
        // 防线：模型有时会把「续写已有线」说成「新建」。
        // 如果某条已有线的节点集合与本条完全一致，就不新建（否则会出现两条重复线）。
        const nodeKey = [...op.node_ids].sort().join(',')
        const duplicate = [...lineMap.values()].find(
          (l) => [...l.nodeIds].sort().join(',') === nodeKey,
        )
        if (duplicate) {
          bus.emit({
            type: 'log',
            level: 'warn',
            message: `  与已有事件线 ${duplicate.id} 的节点完全一致，已忽略这次新建`,
          })
          continue
        }

        const id = `L${pad2(nextLineNumber)}`
        nextLineNumber += 1
        const derived = deriveLineFields(op.node_ids, nodeById)
        lineMap.set(id, {
          id,
          bookId,
          title: op.title,
          nodeIds: op.node_ids,
          chapters: derived.chapters,
          ...(derived.timeRange ? { timeRange: derived.timeRange } : {}),
          cause: op.cause,
          process: op.process,
          result: op.result,
          lineStatus: op.line_status,
          characterIds: resolveCharacterIds(op.node_ids, nodeById, characters),
          updatedAt: new Date().toISOString(),
        })
      }
    }

    bus.emit({
      type: 'log',
      level: 'info',
      message: `  第 ${i + 1} 批完成 · 事件线累计 ${lineMap.size} 条`,
    })
  }

  const lines = [...lineMap.values()]

  // 落库（先清后写，重跑幂等）+ 回填节点的 eventLineIds
  await db.transaction('rw', db.eventLines, db.nodes, async () => {
    await db.eventLines.where('bookId').equals(bookId).delete()
    if (lines.length) await db.eventLines.bulkPut(lines)

    const nodeToLines = new Map<string, string[]>()
    for (const l of lines) {
      for (const nid of l.nodeIds) {
        const list = nodeToLines.get(nid) ?? []
        list.push(l.id)
        nodeToLines.set(nid, list)
      }
    }
    for (const [nid, ids] of nodeToLines) {
      await db.nodes.update(nid, { eventLineIds: ids })
    }
  })

  const cancelled = signal?.aborted ?? false
  if (cancelled) bus.emit({ type: 'task:cancelled', bookId, stage: 'P3' })
  else bus.emit({ type: 'task:done', bookId, stage: 'P3', completed: batches.length, failed: failedBatches })

  return {
    status: cancelled ? 'cancelled' : 'completed',
    batches: batches.length,
    nodeCount: nodes.length,
    eventLineCount: lines.length,
    cost,
    failedBatches,
  }
}

