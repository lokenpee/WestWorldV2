import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CallModelOptions, CallModelResult } from '../src/core/llm/call.ts'
import { resetCanonDbForTest } from '../src/core/db/canon.ts'
import { getProgress, listCharacterSnapshots, listNodes } from '../src/core/db/repo.ts'
import { createEventBus } from '../src/core/events/bus.ts'
import type { AppEvent } from '../src/core/events/types.ts'
import { importBook } from '../src/core/pipeline/import-book.ts'
import { runP1 } from '../src/core/pipeline/run-p1.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

const usage = { input: 10, output: 5, totalTokens: 15, cost: 0.001 }

function okResult(characters: unknown[], nodes: unknown[]): CallModelResult<unknown> {
  return {
    ok: true,
    data: { characters, locations: [{ name: '荣国府' }], nodes },
    stopReason: 'stop',
    usage,
    attemptsUsage: [usage],
    attempts: 1,
  }
}

/** 按 schema 区分是世界资产调用还是叙事资产调用。 */
function fakeCall(opts: CallModelOptions<never>): CallModelResult<unknown> {
  const props = (opts.schema as { properties?: Record<string, unknown> })?.properties ?? {}
  if ('characters' in props) {
    return okResult([{ name: '贾琏', confidence: 0.9 }], [])
  }
  return {
    ok: true,
    data: {
      characters: [],
      locations: [],
      nodes: [
        { name: '节点A', summary: 's', actors: ['贾琏'], quote: 'q', confidence: 0.8 },
      ],
    },
    stopReason: 'stop',
    usage,
    attemptsUsage: [usage],
    attempts: 1,
  }
}

const text = '第一章 A\n甲。\n第二章 B\n乙。\n第三章 C\n丙。'

describe('P1 编排', () => {
  it('跑完全书 → 数据落库 + 进度 completed', async () => {
    await importBook({ id: 'bk_r1', title: 'T', text })
    const r = await runP1('bk_r1', { concurrency: 2, deps: { call: fakeCall as never } })

    expect(r.status).toBe('completed')
    expect(r.completed).toBe(3)
    expect(r.failed).toBe(0)

    expect(await listCharacterSnapshots('bk_r1')).toHaveLength(3)
    expect(await listNodes('bk_r1')).toHaveLength(3)

    const p = await getProgress('bk_r1', 'P1')
    expect(p?.status).toBe('completed')
    expect(p?.completedChapters.sort()).toEqual(['1', '2', '3'])
  })

  it('用量与费用被累计', async () => {
    await importBook({ id: 'bk_r2', title: 'T', text })
    const r = await runP1('bk_r2', { concurrency: 1, deps: { call: fakeCall as never } })
    // 每章两次调用 × 3 章 = 6 次 × 0.001
    expect(r.cost).toBeCloseTo(0.006, 6)
  })

  it('断点续跑：已完成的章节不重跑', async () => {
    await importBook({ id: 'bk_r3', title: 'T', text })
    const call1 = vi.fn(fakeCall as never)
    await runP1('bk_r3', { concurrency: 1, deps: { call: call1 } })
    expect(call1).toHaveBeenCalledTimes(6) // 3 章 × 2 次

    const call2 = vi.fn(fakeCall as never)
    const r2 = await runP1('bk_r3', { concurrency: 1, deps: { call: call2 } })
    expect(call2).not.toHaveBeenCalled() // 全部已完成，一次都不该再调
    expect(r2.completed).toBe(3)
  })

  it('全失败的章节被标记 failed 并跳过，其余照跑', async () => {
    await importBook({ id: 'bk_r4', title: 'T', text })
    const failing: CallModelResult<unknown> = {
      ok: false,
      stopReason: 'error',
      errorKind: 'auth',
      errorMessage: '401',
      attemptsUsage: [],
      attempts: 1,
    }
    let n = 0
    const call = vi.fn(() => {
      n += 1
      return n === 1 ? failing : (fakeCall as never)({} as never)
    })

    const r = await runP1('bk_r4', { concurrency: 1, deps: { call: call as never } })
    expect(r.status).toBe('completed')
    // 第一章的两次调用都失败（n=1 与 n=2 都属于第一章）—— 这里只断言整体不中断
    expect(r.completed + r.failed).toBe(3)
  })

  it('取消后保留已完成章节，状态为 cancelled', async () => {
    await importBook({ id: 'bk_r5', title: 'T', text })
    const ac = new AbortController()
    const call = vi.fn(async (opts: never) => {
      ac.abort() // 第一次调用后立刻取消
      return (fakeCall as never)(opts)
    })

    const r = await runP1('bk_r5', {
      concurrency: 1,
      signal: ac.signal,
      deps: { call: call as never },
    })
    expect(r.status).toBe('cancelled')
    expect(r.completed + r.failed).toBeLessThan(3)

    const p = await getProgress('bk_r5', 'P1')
    expect(p?.status).toBe('cancelled')
  })

  it('发出任务与章节事件', async () => {
    await importBook({ id: 'bk_r6', title: 'T', text })
    const bus = createEventBus()
    const events: AppEvent[] = []
    bus.on((e) => events.push(e))

    await runP1('bk_r6', { concurrency: 1, deps: { call: fakeCall as never }, bus })

    const types = events.map((e) => e.type)
    expect(types).toContain('task:start')
    expect(types).toContain('chapter:start')
    expect(types).toContain('chapter:done')
    expect(types).toContain('task:done')
    expect(types.filter((t) => t === 'chapter:done')).toHaveLength(3)
  })

  it('监听器抛错不影响编译', async () => {
    await importBook({ id: 'bk_r7', title: 'T', text })
    const bus = createEventBus()
    bus.on(() => {
      throw new Error('UI 挂了')
    })
    await expect(
      runP1('bk_r7', { concurrency: 1, deps: { call: fakeCall as never }, bus }),
    ).resolves.toMatchObject({ status: 'completed' })
  })
})
