/**
 * 一键跑完整条链路：P1 提取 → 合并人物 → 串联事件线。
 *
 * 每一步都是**独立可重跑**的（各自幂等），所以中途失败或取消后，
 * 用户可以直接再从某一步开始，不需要从头来。
 */
import type { CompileStatus } from '@/core/schema/index.ts'
import { getEventBus, type EventBus } from '@/core/events/bus.ts'
import { runLink } from './run-link.ts'
import { runMerge } from './run-merge.ts'
import { runP1, type RunP1Options } from './run-p1.ts'

export interface RunAllOptions {
  concurrency?: number
  signal?: AbortSignal
  bus?: EventBus
  /** 是否用 AI 做别名识别 / 事件线串联（没配 Key 时可关，只跑纯代码部分） */
  useAi?: boolean
  deps?: RunP1Options['deps']
}

export interface RunAllResult {
  p1: { status: CompileStatus; completed: number; failed: number; cost: number }
  merge: { characterCount: number; mergedSnapshotCount: number; cost: number } | null
  link: { eventLineCount: number; batches: number; failedBatches: number; cost: number } | null
  totalCost: number
}

export async function runAll(bookId: string, options: RunAllOptions = {}): Promise<RunAllResult> {
  const { concurrency = 3, signal, bus = getEventBus(), useAi = true, deps } = options

  // ── P1：逐章提取 ──
  const p1 = await runP1(bookId, {
    concurrency,
    ...(signal ? { signal } : {}),
    bus,
    ...(deps ? { deps } : {}),
  })

  let merge: RunAllResult['merge'] = null
  let link: RunAllResult['link'] = null
  let totalCost = p1.cost

  if (signal?.aborted) {
    return { p1, merge, link, totalCost }
  }

  // ── P2：合并人物（本地规则 + 可选 AI 别名识别）──
  const mergeRes = await runMerge(bookId, {
    bus,
    useAi,
    ...(signal ? { signal } : {}),
    ...(deps?.call ? { deps: { call: deps.call } } : {}),
  })
  merge = {
    characterCount: mergeRes.characterCount,
    mergedSnapshotCount: mergeRes.mergedSnapshotCount,
    cost: mergeRes.cost,
  }
  totalCost += mergeRes.cost

  if (signal?.aborted || !useAi) {
    return { p1, merge, link, totalCost }
  }

  // ── P3：串联事件线 ──
  const linkRes = await runLink(bookId, {
    bus,
    ...(signal ? { signal } : {}),
    ...(deps?.call ? { deps: { call: deps.call } } : {}),
  })
  link = {
    eventLineCount: linkRes.eventLineCount,
    batches: linkRes.batches,
    failedBatches: linkRes.failedBatches,
    cost: linkRes.cost,
  }
  totalCost += linkRes.cost

  return { p1, merge, link, totalCost }
}
