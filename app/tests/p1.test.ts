import { describe, expect, it, vi } from 'vitest'
import type { CallModelOptions, CallModelResult } from '../src/core/llm/call.ts'
import { buildChapterMessage, extractChapter, type P1Input } from '../src/core/pipeline/p1.ts'

const input: P1Input = {
  bookId: 'bk_001',
  chapterIndex: '37',
  chapterName: '第三十七回 秋爽斋偶结海棠社',
  text: '贾琏近来手头颇觉宽裕。忠顺王府差人来寻琪官。',
}

const usage = { input: 100, output: 50, totalTokens: 150, cost: 0.002 }

const worldOk: CallModelResult<unknown> = {
  ok: true,
  data: {
    characters: [
      { name: '贾琏', aliases_mentioned: ['琏二爷'], confidence: 0.92 },
      { name: '琪官', confidence: 0.8 },
      { name: '贾琏', confidence: 0.5 }, // 重复，应被去重
    ],
    locations: [{ name: '荣国府', description: '贾府主宅' }, { name: '荣国府' }],
  },
  stopReason: 'stop',
  usage,
  attemptsUsage: [usage],
  attempts: 1,
}

const narrativeOk: CallModelResult<unknown> = {
  ok: true,
  data: {
    nodes: [
      {
        name: '贾琏的资金来源异常',
        summary: '手头忽然宽裕。',
        actors: ['贾琏'],
        quote: '……贾琏近来手头颇觉宽裕……',
        confidence: 0.88,
      },
      {
        name: '忠顺王府在寻琪官',
        summary: '王府差人来寻。',
        actors: ['忠顺王府'],
        quote: '……忠顺王府差人来寻琪官……',
        confidence: 0.85,
      },
    ],
  },
  stopReason: 'stop',
  usage,
  attemptsUsage: [usage],
  attempts: 1,
}

function makeCall(map: { world?: CallModelResult<unknown>; narrative?: CallModelResult<unknown> }) {
  return vi.fn(async (opts: CallModelOptions<never>) => {
    // 靠 schema 区分是哪一次调用
    const isWorld = 'characters' in ((opts.schema as { properties?: Record<string, unknown> })?.properties ?? {})
    const res = isWorld ? map.world : map.narrative
    if (!res) throw new Error('测试未提供该次调用的返回值')
    return res
  })
}

describe('P1：正常提取', () => {
  it('两次调用都成功 → 返回带 id 的三类记录', async () => {
    const r = await extractChapter(input, {
      call: makeCall({ world: worldOk, narrative: narrativeOk }) as never,
    })
    expect(r.failures).toEqual([])
    expect(r.characterSnapshots).toHaveLength(2)
    expect(r.locations).toHaveLength(1)
    expect(r.nodes).toHaveLength(2)
  })

  it('id 由代码分配：3 位补零 + 连续', async () => {
    const r = await extractChapter(input, {
      call: makeCall({ world: worldOk, narrative: narrativeOk }) as never,
    })
    expect(r.characterSnapshots.map((c) => c.id)).toEqual(['C37-P001', 'C37-P002'])
    expect(r.nodes.map((n) => n.id)).toEqual(['C37-N001', 'C37-N002'])
    expect(r.locations.map((l) => l.id)).toEqual(['L001'])
  })

  it('记录挂上了归属信息', async () => {
    const r = await extractChapter(input, {
      call: makeCall({ world: worldOk, narrative: narrativeOk }) as never,
    })
    const c = r.characterSnapshots[0]!
    expect(c.bookId).toBe('bk_001')
    expect(c.chapterIndex).toBe('37')
    expect(c.chapterName).toContain('第三十七回')
    expect(r.nodes[0]?.order).toBe(0)
    expect(r.nodes[1]?.order).toBe(1)
    expect(r.nodes[0]?.createdBy).toBe('P1')
  })

  it('章内同名人物/地点被去重', async () => {
    const r = await extractChapter(input, {
      call: makeCall({ world: worldOk, narrative: narrativeOk }) as never,
    })
    expect(r.characterSnapshots.map((c) => c.name)).toEqual(['贾琏', '琪官'])
    expect(r.locations.map((l) => l.name)).toEqual(['荣国府'])
  })

  it('两次调用的用量都被收集（成本统计）', async () => {
    const r = await extractChapter(input, {
      call: makeCall({ world: worldOk, narrative: narrativeOk }) as never,
    })
    expect(r.usages).toHaveLength(2)
    expect(r.usages.reduce((s, u) => s + u.totalTokens, 0)).toBe(300)
  })
})

describe('P1：故障隔离（ADR-009 跳过并继续）', () => {
  it('世界资产失败 → 叙事资产照跑，失败被记录', async () => {
    const failed: CallModelResult<unknown> = {
      ok: false,
      stopReason: 'error',
      errorKind: 'auth',
      errorMessage: '401',
      attemptsUsage: [],
      attempts: 1,
    }
    const r = await extractChapter(input, {
      call: makeCall({ world: failed, narrative: narrativeOk }) as never,
    })
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]?.stage).toBe('worldAssets')
    expect(r.failures[0]?.errorKind).toBe('auth')
    // 叙事资产仍然成功
    expect(r.nodes).toHaveLength(2)
    expect(r.characterSnapshots).toHaveLength(0)
  })

  it('叙事资产失败 → 世界资产仍保留', async () => {
    const failed: CallModelResult<unknown> = {
      ok: false,
      stopReason: 'error',
      errorKind: 'context_length',
      attemptsUsage: [],
      attempts: 1,
    }
    const r = await extractChapter(input, {
      call: makeCall({ world: worldOk, narrative: failed }) as never,
    })
    expect(r.failures[0]?.stage).toBe('narrativeAssets')
    expect(r.characterSnapshots).toHaveLength(2)
    expect(r.nodes).toHaveLength(0)
  })

  it('两次都失败 → 返回空记录 + 两条失败', async () => {
    const failed: CallModelResult<unknown> = {
      ok: false,
      stopReason: 'error',
      attemptsUsage: [],
      attempts: 1,
    }
    const r = await extractChapter(input, {
      call: makeCall({ world: failed, narrative: failed }) as never,
    })
    expect(r.failures).toHaveLength(2)
    expect(r.characterSnapshots).toEqual([])
    expect(r.nodes).toEqual([])
  })
})

describe('P1：输入构造', () => {
  it('章节消息包含标识、章节名与正文', () => {
    const msg = buildChapterMessage(input)
    expect(msg).toContain('章节标识：37')
    expect(msg).toContain('章节名：第三十七回')
    expect(msg).toContain('正文开始')
    expect(msg).toContain('贾琏近来手头颇觉宽裕')
  })
})

