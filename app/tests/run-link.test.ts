import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetCanonDbForTest } from '../src/core/db/canon.ts'
import { saveP1Result } from '../src/core/db/repo.ts'
import { createEventBus } from '../src/core/events/bus.ts'
import type { CallModelOptions, CallModelResult } from '../src/core/llm/call.ts'
import {
  buildExistingLinesDigest,
  buildNodesDigest,
  deriveLineFields,
  runLink,
  splitIntoBatches,
} from '../src/core/pipeline/run-link.ts'
import type { StoredNode } from '../src/core/schema/index.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

function node(id: string, chapterIndex: string, order: number, over: Partial<StoredNode> = {}): StoredNode {
  return {
    id,
    bookId: 'bk',
    chapterIndex,
    chapterName: `第${chapterIndex}章`,
    order,
    name: `节点${id}`,
    summary: 's',
    actors: ['贾琏'],
    quote: 'q',
    confidence: 0.9,
    createdBy: 'P1',
    ...over,
  }
}

function linkResult(ops: unknown[], newNodes: unknown[] = []): CallModelResult<unknown> {
  return {
    ok: true,
    data: { event_line_ops: ops, new_nodes: newNodes },
    stopReason: 'stop',
    usage: { input: 10, output: 5, totalTokens: 15, cost: 0.002 },
    attemptsUsage: [{ input: 10, output: 5, totalTokens: 15, cost: 0.002 }],
    attempts: 1,
  }
}

describe('分批（ADR-017）', () => {
  it('不超限 → 1 批', () => {
    expect(splitIntoBatches([1, 2, 3], 400)).toEqual([[1, 2, 3]])
  })

  it('刚好超限 → 2 批', () => {
    expect(splitIntoBatches([1, 2, 3], 2)).toEqual([[1, 2], [3]])
  })

  it('⭐ 按时序连续切，不重叠（否则同一件事会被切到两批）', () => {
    const items = Array.from({ length: 10 }, (_, i) => i)
    const batches = splitIntoBatches(items, 4)
    expect(batches.flat()).toEqual(items) // 顺序不变
    expect(batches.map((b) => b.length)).toEqual([4, 4, 2])
  })

  it('batchSize 非法时报错', () => {
    expect(() => splitIntoBatches([1], 0)).toThrow(/batchSize/)
  })
})

describe('派生字段由代码算（不让模型编）', () => {
  const nodes = new Map<string, StoredNode>([
    ['a', node('a', '2', 0, { timeCoord: '002-01-01 08:00' })],
    ['b', node('b', '5', 0, { timeCoord: '003-01-01 08:00' })],
    ['c', node('c', '5', 1)],
  ])

  it('chapters 去重并按数字序排列', () => {
    expect(deriveLineFields(['b', 'a', 'c'], nodes).chapters).toEqual(['2', '5'])
  })

  it('timeRange 取最早与最晚', () => {
    expect(deriveLineFields(['b', 'a'], nodes).timeRange).toEqual(['002-01-01 08:00', '003-01-01 08:00'])
  })

  it('没有时间坐标时不产出 timeRange', () => {
    expect(deriveLineFields(['c'], nodes).timeRange).toBeUndefined()
  })

  it('节点不存在时安全忽略', () => {
    expect(deriveLineFields(['不存在'], nodes).chapters).toEqual([])
  })

})

describe('串联事件线', () => {
  it('create 落库，派生字段由代码补齐', async () => {
    await saveP1Result('bk', {
      characterSnapshots: [],
      locationSnapshots: [],
      nodes: [node('C1-N001', '1', 0), node('C2-N001', '2', 0)],
    })

    const call = vi.fn(async (_o: CallModelOptions<never>) =>
      linkResult([
        {
          op: 'create',
          title: '走私案',
          node_ids: ['C1-N001', 'C2-N001'],
          cause: '起',
          process: '经',
          result: '果',
          line_status: 'open',
        },
      ]),
    ) as never

    const r = await runLink('bk', { deps: { call } })
    expect(r.eventLineCount).toBe(1)

    const lines = await (await import('../src/core/db/canon.ts')).getCanonDb('bk').eventLines.toArray()
    expect(lines[0]?.id).toBe('L01')
    expect(lines[0]?.chapters).toEqual(['1', '2'])
  })

  it('append 追加到已有线，不新建', async () => {
    await saveP1Result('bk', {
      characterSnapshots: [],
      locationSnapshots: [],
      nodes: [node('C1-N001', '1', 0), node('C3-N001', '3', 0)],
    })

    const call = vi
      .fn()
      .mockResolvedValueOnce(
        linkResult([
          { op: 'create', title: '线A', node_ids: ['C1-N001'], cause: '', process: '', result: '', line_status: 'open' },
        ]),
      )
      .mockResolvedValueOnce(
        linkResult([
          { op: 'append', line_id: 'L01', node_ids: ['C3-N001'], cause: '', process: '', result: '', line_status: 'closed' },
        ]),
      ) as never

    // batchSize=1 强制走两批，第二批才有机会 append
    const r = await runLink('bk', { deps: { call }, batchSize: 1 })
    expect(r.eventLineCount).toBe(1)
    expect(r.batches).toBe(2)

    const db = (await import('../src/core/db/canon.ts')).getCanonDb('bk')
    const line = await db.eventLines.get('L01')
    expect(line?.nodeIds.sort()).toEqual(['C1-N001', 'C3-N001'])
    expect(line?.lineStatus).toBe('closed')
  })

  it('引用不存在的事件线 → 忽略并记日志，不崩', async () => {
    await saveP1Result('bk', { characterSnapshots: [], locationSnapshots: [], nodes: [node('C1-N001', '1', 0)] })
    const call = vi.fn(async () =>
      linkResult([
        { op: 'append', line_id: 'L99', node_ids: ['C1-N001'], cause: '', process: '', result: '', line_status: 'open' },
      ]),
    ) as never

    const bus = createEventBus()
    const logs: string[] = []
    bus.on((e) => { if (e.type === 'log') logs.push(e.message) })

    const r = await runLink('bk', { deps: { call }, bus })
    expect(r.eventLineCount).toBe(0)
    expect(logs.join('\n')).toContain('不存在的事件线')
  })

  it('某批失败 → 跳过继续，不中止', async () => {
    await saveP1Result('bk', {
      characterSnapshots: [],
      locationSnapshots: [],
      nodes: [node('C1-N001', '1', 0), node('C2-N001', '2', 0)],
    })

    const failing: CallModelResult<unknown> = {
      ok: false, stopReason: 'error', errorKind: 'rate_limit', attemptsUsage: [], attempts: 1,
    }
    const call = vi.fn().mockResolvedValueOnce(failing).mockResolvedValueOnce(
      linkResult([{ op: 'create', title: '线', node_ids: ['C2-N001'], cause: '', process: '', result: '', line_status: 'open' }]),
    ) as never

    const r = await runLink('bk', { deps: { call }, batchSize: 1 })
    expect(r.failedBatches).toBe(1)
    expect(r.eventLineCount).toBe(1)
  })

  it('重跑幂等（先清后写）', async () => {
    await saveP1Result('bk', { characterSnapshots: [], locationSnapshots: [], nodes: [node('C1-N001', '1', 0)] })
    const call = vi.fn(async () =>
      linkResult([{ op: 'create', title: '线', node_ids: ['C1-N001'], cause: '', process: '', result: '', line_status: 'open' }]),
    ) as never

    await runLink('bk', { deps: { call } })
    await runLink('bk', { deps: { call } })
    const db = (await import('../src/core/db/canon.ts')).getCanonDb('bk')
    expect(await db.eventLines.count()).toBe(1)
  })

  it('回填节点的 eventLineIds（多对多）', async () => {
    await saveP1Result('bk', { characterSnapshots: [], locationSnapshots: [], nodes: [node('C1-N001', '1', 0)] })
    const call = vi.fn(async () =>
      linkResult([{ op: 'create', title: '线', node_ids: ['C1-N001'], cause: '', process: '', result: '', line_status: 'open' }]),
    ) as never

    await runLink('bk', { deps: { call } })
    const db = (await import('../src/core/db/canon.ts')).getCanonDb('bk')
    const n = await db.nodes.get('C1-N001')
    expect(n?.eventLineIds).toEqual(['L01'])
  })

  it('没有节点时直接返回', async () => {
    const r = await runLink('bk', {})
    expect(r.eventLineCount).toBe(0)
    expect(r.batches).toBe(0)
  })

  it('摘要文本可读（给模型看的输入）', () => {
    expect(buildExistingLinesDigest([])).toContain('还没有')
    expect(buildNodesDigest([node('C1-N001', '1', 0, { name: '资金异常', actors: ['贾琏'] })])).toContain('C1-N001')
  })
})
