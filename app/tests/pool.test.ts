import { describe, expect, it } from 'vitest'
import { runPool } from '../src/core/pipeline/pool.ts'

describe('并发池（ADR-008）', () => {
  it('不会超过并发上限', async () => {
    let running = 0
    let peak = 0
    await runPool(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((r) => setTimeout(r, 1))
        running -= 1
      },
    )
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('每个元素恰好处理一次', async () => {
    const seen: number[] = []
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('取消后不再领新任务', async () => {
    const ac = new AbortController()
    const seen: number[] = []
    await runPool(
      Array.from({ length: 50 }, (_, i) => i),
      1,
      async (n) => {
        seen.push(n)
        if (n === 2) ac.abort()
      },
      ac.signal,
    )
    expect(seen.length).toBeLessThan(5)
  })

  it('空数组直接返回', async () => {
    await expect(runPool([], 3, async () => {})).resolves.toBeUndefined()
  })

  it('并发数大于元素数时不会出错', async () => {
    const seen: number[] = []
    await runPool([1, 2], 10, async (n) => {
      seen.push(n)
    })
    expect(seen).toHaveLength(2)
  })
})
