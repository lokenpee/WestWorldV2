import { afterEach, describe, expect, it } from 'vitest'
import { resetCanonDbForTest } from '../src/core/db/canon.ts'
import { getChapterText, getProgress, listChapters } from '../src/core/db/repo.ts'
import { importBook } from '../src/core/pipeline/import-book.ts'

// repo 走的是 Canon 库单例 —— 每个用例后把库删掉，避免互相污染
afterEach(async () => {
  await resetCanonDbForTest()
})

const sample = [
  '第一章 开端',
  '贾琏近来手头颇觉宽裕。',
  '',
  '第二章 转折',
  '忠顺王府差人来寻琪官。',
  '',
  '第三章 收尾',
  '一切归于平静。',
].join('\n')

describe('导入一本书', () => {
  it('txt → 分章 → 落库 + 初始化进度', async () => {
    const r = await importBook({ id: 'bk_t1', title: '测试书', text: sample })

    expect(r.chapterCount).toBe(3)
    expect(r.chapters.map((c) => c.chapterIndex)).toEqual(['1', '2', '3'])

    const chapters = await listChapters('bk_t1')
    expect(chapters).toHaveLength(3)
    expect(chapters[0]?.chapterName).toContain('开端')

    const text = await getChapterText('bk_t1', '1')
    expect(text).toContain('贾琏近来手头颇觉宽裕')

    const progress = await getProgress('bk_t1', 'P1')
    expect(progress?.status).toBe('idle')
    expect(progress?.totalChapters).toBe(3)
  })

  it('空文本 → 明确报错，不产生半成品', async () => {
    await expect(importBook({ id: 'bk_t2', title: '空', text: '' })).rejects.toThrow(/没有切出任何章节/)
  })

  it('超长章节切块后作为独立章节落库（101.1 形态）', async () => {
    const long = '甲'.repeat(25_000)
    const r = await importBook({
      id: 'bk_t3',
      title: '长章',
      text: `第1章 超长\n${long}`,
      split: { maxChunkChars: 10_000 },
    })
    expect(r.chapters.map((c) => c.chapterIndex)).toEqual(['1.1', '1.2', '1.3'])
  })
})
