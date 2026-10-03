import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetCanonDbForTest } from '../src/core/db/canon.ts'
import { saveP1Result } from '../src/core/db/repo.ts'
import { createEventBus } from '../src/core/events/bus.ts'
import type { CallModelOptions, CallModelResult } from '../src/core/llm/call.ts'
import { listCharacters, runMerge } from '../src/core/pipeline/run-merge.ts'
import type { StoredCharacterSnapshot } from '../src/core/schema/index.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

function snap(id: string, chapterIndex: string, name: string, over: Partial<StoredCharacterSnapshot> = {}): StoredCharacterSnapshot {
  return {
    id,
    bookId: 'bk',
    chapterIndex,
    chapterName: `第${chapterIndex}章`,
    name,
    confidence: 0.9,
    ...over,
  }
}

async function seed(snapshots: StoredCharacterSnapshot[]) {
  await saveP1Result('bk', { characterSnapshots: snapshots, locations: [], nodes: [] })
}

function aiResult(groups: Array<{ canonicalName: string; names: string[] }>): CallModelResult<unknown> {
  return {
    ok: true,
    data: { groups },
    stopReason: 'stop',
    usage: { input: 10, output: 5, totalTokens: 15, cost: 0.001 },
    attemptsUsage: [{ input: 10, output: 5, totalTokens: 15, cost: 0.001 }],
    attempts: 1,
  }
}

describe('P2 合并人物：本地规则', () => {
  it('包含关系被合并（贾宝玉 / 宝玉 → 1 个实体）', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])
    const r = await runMerge('bk', { useAi: false })
    expect(r.characterCount).toBe(1)
    expect(r.mergedSnapshotCount).toBe(1)

    const chars = await listCharacters('bk')
    expect(chars[0]?.name).toBe('贾宝玉')
    expect(chars[0]?.aliases).toContain('宝玉')
    expect(chars[0]?.sourceSnapshotIds.sort()).toEqual(['C1-P001', 'C5-P001'])
  })

  it('不同的人不会被合并', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C1-P002', '1', '贾环')])
    const r = await runMerge('bk', { useAi: false })
    expect(r.characterCount).toBe(2)
  })

  it('每个快照都被某个实体覆盖（不丢人）', async () => {
    await seed([
      snap('A', '1', '贾宝玉'),
      snap('B', '2', '宝玉'),
      snap('C', '3', '林黛玉'),
      snap('D', '4', '贾'),
    ])
    await runMerge('bk', { useAi: false })
    const chars = await listCharacters('bk')
    const covered = new Set(chars.flatMap((c) => c.sourceSnapshotIds))
    expect(covered).toEqual(new Set(['A', 'B', 'C', 'D']))
  })
})

describe('P2 合并人物：AI 别名识别', () => {
  it('昵称靠 AI 合并（贾琏 / 琏二爷）', async () => {
    await seed([snap('C1-P001', '1', '贾琏'), snap('C9-P001', '9', '琏二爷')])

    const call = vi.fn(async (_opts: CallModelOptions<never>) =>
      aiResult([{ canonicalName: '贾琏', names: ['贾琏', '琏二爷'] }]),
    ) as never

    const r = await runMerge('bk', { deps: { call }, useAi: true })
    expect(r.characterCount).toBe(1)
    expect(r.aiUsed).toBe(true)

    const chars = await listCharacters('bk')
    expect(chars[0]?.aliases).toContain('琏二爷')
  })

  it('AI 失败时降级为只用本地规则，不抛错', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])

    const failing = {
      ok: false,
      stopReason: 'error',
      errorKind: 'auth',
      errorMessage: '401',
      attemptsUsage: [],
      attempts: 1,
    } as CallModelResult<unknown>
    const call = vi.fn(async () => failing) as never

    const bus = createEventBus()
    const logs: string[] = []
    bus.on((e) => {
      if (e.type === 'log') logs.push(e.message)
    })

    const r = await runMerge('bk', { deps: { call }, useAi: true, bus })
    expect(r.status).toBe('completed')
    expect(r.aiUsed).toBe(false)
    expect(r.characterCount).toBe(1) // 本地规则仍然生效
    expect(logs.join('\n')).toContain('别名识别失败')
  })
})

describe('P2 合并人物：幂等与稳定性', () => {
  it('重跑幂等（先清后写，不会翻倍）', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])
    await runMerge('bk', { useAi: false })
    await runMerge('bk', { useAi: false })
    expect((await listCharacters('bk')).length).toBe(1)
  })

  it('实体 id 稳定：同样的输入产生同样的 P001', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])
    await runMerge('bk', { useAi: false })
    const first = (await listCharacters('bk')).map((c) => c.id)

    await runMerge('bk', { useAi: false })
    const second = (await listCharacters('bk')).map((c) => c.id)
    expect(second).toEqual(first)
  })

  it('没有快照时直接返回，不报错', async () => {
    const r = await runMerge('bk', { useAi: false })
    expect(r.characterCount).toBe(0)
    expect(r.status).toBe('completed')
  })
})
