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

const usage = { input: 10, output: 5, totalTokens: 15, cost: 0.001 }

function ok(data: unknown): CallModelResult<unknown> {
  return { ok: true, data, stopReason: 'stop', usage, attemptsUsage: [usage], attempts: 1 }
}

/** 别名识别的返回。 */
function aliasResult(groups: Array<{ canonicalName: string; names: string[] }>): CallModelResult<unknown> {
  return ok({ groups })
}

/** 字段融合的返回（提示词 03）。 */
function fusionResult(name: string, over: Record<string, unknown> = {}): CallModelResult<unknown> {
  return ok({
    entity: {
      name,
      aliases: [],
      roleWeight: 'NPC',
      relations: [],
      ...over,
    },
    merge_notes: [],
  })
}

/**
 * 按 schema 形状自动分派：别名识别返回 { groups }，字段融合返回 { entity }。
 * 测试里只需要关心"这一步会拿到什么"，不必逐处写两套 mock。
 */
function autoCall(alias: CallModelResult<unknown>, fusion?: CallModelResult<unknown>) {
  return async (opts: CallModelOptions<never>) => {
    const props = (opts.schema as { properties?: Record<string, unknown> })?.properties ?? {}
    if ('groups' in props) return alias
    if ('entity' in props) return fusion ?? fusionResult('融合后')
    throw new Error(`测试未覆盖的调用：${Object.keys(props).join(',')}`)
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

    const call = vi.fn(
      autoCall(aliasResult([{ canonicalName: '贾琏', names: ['贾琏', '琏二爷'] }]), fusionResult('贾琏')),
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


describe('P2 合并人物：AI 字段融合（提示词 03）', () => {
  it('⭐ 单快照组不调融合（只有多快照组才需要）', async () => {
    await seed([snap('C1-P001', '1', '独一无二的人')])
    const call = vi.fn(async (opts: CallModelOptions<never>) => {
      const props = (opts.schema as { properties?: Record<string, unknown> })?.properties ?? {}
      if ('groups' in props) return aliasResult([])
      throw new Error('单快照组不该调融合')
    }) as never

    const r = await runMerge('bk', { deps: { call }, useAi: true })
    expect(r.characterCount).toBe(1)
  })

  it('⭐ 融合后别名取**并集**（不丢分组阶段收集到的别名）', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])

    const call = vi.fn(
      autoCall(
        aliasResult([]),
        // 模型只返回了一个别名，且没有"宝玉" —— 不能因此丢掉
        fusionResult('贾宝玉', { aliases: ['宝二爷'], personality: '多情；叛逆' }),
      ),
    ) as never

    await runMerge('bk', { deps: { call }, useAi: true })
    const chars = await listCharacters('bk')
    expect(chars[0]?.aliases).toContain('宝玉')
    expect(chars[0]?.aliases).toContain('宝二爷')
    expect(chars[0]?.personality).toBe('多情；叛逆')
  })

  it('融合失败 → 降级保留主快照的字段，不报错', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉', { personality: '多情' }), snap('C5-P001', '5', '宝玉')])

    const failing: CallModelResult<unknown> = {
      ok: false, stopReason: 'error', errorKind: 'rate_limit', attemptsUsage: [], attempts: 1,
    }
    const call = vi.fn(
      autoCall(aliasResult([]), failing),
    ) as never

    const bus = createEventBus()
    const logs: string[] = []
    bus.on((e) => { if (e.type === 'log') logs.push(e.message) })

    const r = await runMerge('bk', { deps: { call }, useAi: true, bus })
    expect(r.status).toBe('completed')
    const chars = await listCharacters('bk')
    expect(chars[0]?.personality).toBe('多情')
    expect(logs.join('\n')).toContain('字段融合失败')
  })
})
