import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetCanonDbForTest } from '../src/core/db/canon.ts'
import { listCharacterSnapshots, listLocationSnapshots, saveP1Result } from '../src/core/db/repo.ts'
import { createEventBus } from '../src/core/events/bus.ts'
import type { CallModelOptions, CallModelResult } from '../src/core/llm/call.ts'
import { runMerge } from '../src/core/pipeline/run-merge.ts'
import type { StoredCharacterSnapshot } from '../src/core/schema/index.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

function snap(id: string, chapterIndex: string, name: string, over: Partial<StoredCharacterSnapshot> = {}): StoredCharacterSnapshot {
  return { id, bookId: 'bk', chapterIndex, chapterName: `第${chapterIndex}章`, name, confidence: 0.9, ...over }
}

async function seed(snapshots: StoredCharacterSnapshot[]) {
  await saveP1Result('bk', { characterSnapshots: snapshots, locationSnapshots: [], nodes: [] })
}

const usage = { input: 10, output: 5, totalTokens: 15, cost: 0.001 }

function ok(data: unknown): CallModelResult<unknown> {
  return { ok: true, data, stopReason: 'stop', usage, attemptsUsage: [usage], attempts: 1 }
}

function aliasResult(groups: Array<{ canonicalName: string; names: string[] }>): CallModelResult<unknown> {
  return ok({ groups })
}

function fusionResult(name: string, over: Record<string, unknown> = {}): CallModelResult<unknown> {
  return ok({ entity: { name, aliases: [], roleWeight: 'NPC', relations: [], ...over }, merge_notes: [] })
}

/** 按 schema 形状自动分派：别名识别返回 { groups }，字段融合返回 { entity }。 */
function autoCall(alias: CallModelResult<unknown>, fusion?: CallModelResult<unknown>) {
  return async (opts: CallModelOptions<never>) => {
    const props = (opts.schema as { properties?: Record<string, unknown> })?.properties ?? {}
    if ('groups' in props) return alias
    if ('entity' in props) return fusion ?? fusionResult('融合后')
    throw new Error(`测试未覆盖的调用：${Object.keys(props).join(',')}`)
  }
}

describe('P2 合并：本地规则（结果写回快照表）', () => {
  it('包含关系被合并（贾宝玉 / 宝玉 → 1 条），保留最早的那条 id', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])
    const r = await runMerge('bk', { useAi: false })
    expect(r.characters).toEqual({ before: 2, after: 1 })

    const chars = await listCharacterSnapshots('bk')
    expect(chars).toHaveLength(1)
    expect(chars[0]?.id).toBe('C1-P001')
    expect(chars[0]?.name).toBe('贾宝玉')
    expect(chars[0]?.aliases).toContain('宝玉')
  })

  it('不同的人不会被合并', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C1-P002', '1', '贾环')])
    const r = await runMerge('bk', { useAi: false })
    expect(r.characters).toEqual({ before: 2, after: 2 })
  })

  it('单字名不会被吞（贾 / 贾宝玉 不合并）', async () => {
    await seed([snap('C1-P001', '1', '贾'), snap('C1-P002', '1', '贾宝玉')])
    const r = await runMerge('bk', { useAi: false })
    expect(r.characters.after).toBe(2)
  })

  it('合并后每个人的别名并集都在保留的那条上', async () => {
    await seed([
      snap('C1-P001', '1', '贾琏', { aliases_mentioned: ['琏二爷'] }),
      snap('C5-P001', '5', '贾琏儿', { aliases_mentioned: ['二爷'] }),
    ])
    await runMerge('bk', { useAi: false })
    const chars = await listCharacterSnapshots('bk')
    expect(chars[0]?.id).toBe('C1-P001')
    expect(chars[0]?.aliases?.sort()).toEqual(['二爷', '贾琏儿', '琏二爷'].sort())
  })
})

describe('P2 合并：AI 别名识别', () => {
  it('昵称靠 AI 合并（贾琏 / 琏二爷）', async () => {
    await seed([snap('C1-P001', '1', '贾琏'), snap('C9-P001', '9', '琏二爷')])
    const call = vi.fn(autoCall(aliasResult([{ canonicalName: '贾琏', names: ['贾琏', '琏二爷'] }]), fusionResult('贾琏'))) as never

    const r = await runMerge('bk', { deps: { call }, useAi: true })
    expect(r.characters.after).toBe(1)

    const chars = await listCharacterSnapshots('bk')
    expect(chars[0]?.aliases).toContain('琏二爷')
  })

  it('AI 失败时降级为只用本地规则，不抛错', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])
    const failing = {
      ok: false, stopReason: 'error', errorKind: 'auth', errorMessage: '401', attemptsUsage: [], attempts: 1,
    } as CallModelResult<unknown>
    const call = vi.fn(async () => failing) as never

    const bus = createEventBus()
    const logs: string[] = []
    bus.on((e) => { if (e.type === 'log') logs.push(e.message) })

    const r = await runMerge('bk', { deps: { call }, useAi: true, bus })
    expect(r.status).toBe('completed')
    expect(r.characters.after).toBe(1)
    expect(logs.join('\n')).toContain('别名识别失败')
  })
})

describe('P2 合并：幂等与稳定性', () => {
  it('重跑幂等（不会越并越少 / 翻倍）', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])
    const a = await runMerge('bk', { useAi: false })
    const b = await runMerge('bk', { useAi: false })
    expect(a.characters.after).toBe(1)
    expect(b.characters.after).toBe(1)
  })

  it('没有快照时直接返回，不报错', async () => {
    const r = await runMerge('bk', { useAi: false })
    expect(r.characters).toEqual({ before: 0, after: 0 })
    expect(r.locations).toEqual({ before: 0, after: 0 })
    expect(r.status).toBe('completed')
  })
})

describe('P2 合并：人物字段融合（提示词 03）', () => {
  it('⭐ 融合后别名取并集（不丢分组阶段收集到的别名）', async () => {
    await seed([snap('C1-P001', '1', '贾琏'), snap('C5-P001', '5', '琏二爷')])
    const call = vi.fn(
      autoCall(
        aliasResult([{ canonicalName: '贾琏', names: ['贾琏', '琏二爷'] }]),
        fusionResult('贾琏', { aliases: ['琏二爷'], personality: '多情' }),
      ),
    ) as never

    await runMerge('bk', { deps: { call }, useAi: true })
    const chars = await listCharacterSnapshots('bk')
    expect(chars[0]?.aliases).toContain('琏二爷')
    expect(chars[0]?.personality).toBe('多情')
  })

  it('融合失败 → 降级保留主快照的字段，不报错', async () => {
    await seed([snap('C1-P001', '1', '贾宝玉'), snap('C5-P001', '5', '宝玉')])
    const failing = { ok: false, stopReason: 'error', errorKind: 'rate_limit', attemptsUsage: [], attempts: 1 } as CallModelResult<unknown>
    const call = vi.fn(async (opts: CallModelOptions<never>) => {
      const props = (opts.schema as { properties?: Record<string, unknown> })?.properties ?? {}
      if ('groups' in props) return aliasResult([{ canonicalName: '贾宝玉', names: ['贾宝玉', '宝玉'] }])
      return failing
    }) as never

    const bus = createEventBus()
    const logs: string[] = []
    bus.on((e) => { if (e.type === 'log') logs.push(e.message) })

    const r = await runMerge('bk', { deps: { call }, useAi: true, bus })
    expect(r.status).toBe('completed')
    const chars = await listCharacterSnapshots('bk')
    expect(chars).toHaveLength(1)
  })
})

describe('P2 合并：地点走同一套流程', () => {
  it('同名地点向前合并，保留最早的那条', async () => {
    await saveP1Result('bk', {
      characterSnapshots: [],
      locationSnapshots: [
        { id: 'C1-L001', bookId: 'bk', chapterIndex: '1', chapterName: '第一章', name: '荣国府', confidence: 0.9 },
        { id: 'C9-L001', bookId: 'bk', chapterIndex: '9', chapterName: '第九章', name: '荣国府', description: '贾府主宅', confidence: 0.8 },
      ],
      nodes: [],
    })
    const r = await runMerge('bk', { useAi: false })
    expect(r.locations).toEqual({ before: 2, after: 1 })
    const locs = await listLocationSnapshots('bk')
    expect(locs[0]?.id).toBe('C1-L001')
    expect(locs[0]?.description).toBe('贾府主宅')
  })
})