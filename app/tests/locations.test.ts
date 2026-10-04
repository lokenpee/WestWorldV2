import { afterEach, describe, expect, it } from 'vitest'
import { getCanonDb, resetCanonDbForTest } from '../src/core/db/canon.ts'
import { saveP1Result } from '../src/core/db/repo.ts'
import { assignLocationIds } from '../src/core/pipeline/p1.ts'
import { runMerge } from '../src/core/pipeline/run-merge.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

const input = (chapterIndex: string) => ({
  bookId: 'bk',
  chapterIndex,
  chapterName: `第${chapterIndex}章`,
  text: '',
})

function loc(id: string, chapterIndex: string, name: string) {
  return { id, bookId: 'bk', chapterIndex, chapterName: `第${chapterIndex}章`, name, confidence: 0.9 }
}

describe('地点快照：跨章唯一（回归测试）', () => {
  it('⭐ id 跨章唯一 —— 第 5 章不会覆盖第 1 章（曾经真的会）', () => {
    const a = assignLocationIds(input('1'), [{ name: '荣国府', confidence: 0.9 }])
    const b = assignLocationIds(input('5'), [{ name: '大观园', confidence: 0.9 }])
    expect(a[0]?.id).toBe('C1-L001')
    expect(b[0]?.id).toBe('C5-L001')
    expect(a[0]?.id).not.toBe(b[0]?.id)
  })

  it('⭐ 两章的地点都能留下来', async () => {
    await saveP1Result('bk', { characterSnapshots: [], locationSnapshots: [loc('C1-L001', '1', '荣国府')], nodes: [] })
    await saveP1Result('bk', { characterSnapshots: [], locationSnapshots: [loc('C5-L001', '5', '大观园')], nodes: [] })

    const rows = await getCanonDb('bk').locationSnapshots.toArray()
    expect(rows.map((r) => r.name).sort()).toEqual(['大观园', '荣国府'])
  })

  it('同名地点逐章都会留下来（归并是 P2 的事，不是 P1 的事）', async () => {
    await saveP1Result('bk', { characterSnapshots: [], locationSnapshots: [loc('C1-L001', '1', '荣国府')], nodes: [] })
    await saveP1Result('bk', { characterSnapshots: [], locationSnapshots: [loc('C9-L001', '9', '荣国府')], nodes: [] })
    expect(await getCanonDb('bk').locationSnapshots.count()).toBe(2)

    // P2 合并：同名向前合并，保留最早的那条
    await runMerge('bk', { useAi: false })
    const rows = await getCanonDb('bk').locationSnapshots.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('C1-L001')
    expect(rows[0]?.chapterIndex).toBe('1')
  })

  it('同一章内的多个地点都留下，且章内去重', () => {
    const list = assignLocationIds(input('3'), [
      { name: '荣国府', confidence: 0.9 },
      { name: '大观园', confidence: 0.9 },
      { name: '荣国府', confidence: 0.5 },
    ])
    expect(list.map((l) => l.name)).toEqual(['荣国府', '大观园'])
    expect(list.map((l) => l.id)).toEqual(['C3-L001', 'C3-L002'])
  })

  it('不同书之间互不影响（每本书一个库）', async () => {
    await saveP1Result('bk1', { characterSnapshots: [], locationSnapshots: [{ ...loc('C1-L001', '1', '荣国府'), bookId: 'bk1' }], nodes: [] })
    await saveP1Result('bk2', { characterSnapshots: [], locationSnapshots: [{ ...loc('C1-L001', '1', '荣国府'), bookId: 'bk2' }], nodes: [] })
    expect(await getCanonDb('bk1').locationSnapshots.count()).toBe(1)
    expect(await getCanonDb('bk2').locationSnapshots.count()).toBe(1)
  })
})