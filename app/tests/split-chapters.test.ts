import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAPTER_REGEX, splitChapters } from '../src/core/pipeline/split-chapters.ts'

describe('分章：章节标记的各种形态', () => {
  it('第1章 x（阿拉伯数字 + 半角空格）', () => {
    const r = splitChapters('第1章 开端\n正文一。\n第2章 转折\n正文二。')
    expect(r).toHaveLength(2)
    expect(r[0]?.chapterName).toContain('第1章')
    expect(r[0]?.chapterName).toContain('开端')
    expect(r[0]?.text).toContain('正文一')
    expect(r[1]?.text).toContain('正文二')
  })

  it('第一章　全角空格', () => {
    const r = splitChapters('第一章　初见\n正文。\n第二章　再会\n正文。')
    expect(r).toHaveLength(2)
    expect(r[0]?.chapterName).toContain('初见')
  })

  it('第一章 半角空格（这是原正则漏掉的形态）', () => {
    const r = splitChapters('第一章 初见\n正文。\n第二章 再会\n正文。')
    expect(r).toHaveLength(2)
    expect(r[0]?.chapterName).toContain('初见')
  })

  it('第 十 二 章（字之间有空格）', () => {
    const r = splitChapters('第 十 二 章 风起\n正文。')
    expect(r).toHaveLength(1)
    expect(r[0]?.chapterName).toContain('风起')
  })

  it('行内出现「。第一章」也算章节起点', () => {
    const r = splitChapters('收尾一句。第一章 起点\n正文。\n第二章 继续\n正文。')
    expect(r).toHaveLength(2)
    // 关键：被 `(?:^|[^\w\n\r])` 吃掉的那个句号应当还留在上一段里
    expect(r[0]?.text.startsWith('第一章')).toBe(true)
  })

  it('回目体裁：第三十七回', () => {
    const r = splitChapters('第三十七回 秋爽斋偶结海棠社\n正文。')
    expect(r[0]?.chapterName).toContain('秋爽斋偶结海棠社')
  })

  it('第X卷 / 第X节 也能识别', () => {
    expect(splitChapters('第一卷 风起\n正文。').length).toBeGreaterThan(0)
    expect(splitChapters('第一节 初见\n正文。').length).toBeGreaterThan(0)
  })
})

describe('分章：兜底与切块', () => {
  it('没有章节标记时按滑窗兜底（Chapter 1 不匹配）', () => {
    const text = 'Chapter 1\n' + '正'.repeat(9000)
    const r = splitChapters(text, { fallbackWindowChars: 4000 })
    expect(r).toHaveLength(3)
    expect(r[0]?.chapterName).toContain('段')
    expect(r[0]?.charCount).toBeLessThanOrEqual(4000)
  })

  it('超长章节切成 X.1 / X.2 / X.3', () => {
    const body = '甲'.repeat(25_000)
    const r = splitChapters(`第101章 长章\n${body}`, { maxChunkChars: 10_000 })
    expect(r).toHaveLength(3)
    expect(r.map((c) => c.chapterIndex)).toEqual(['1.1', '1.2', '1.3'])
    expect(r[0]?.chapterName).toContain('第 1 块')
    expect(r[2]?.charCount).toBe(5000 + '第101章 长章\n'.length)
  })

  it('不超限的章节不切块', () => {
    const r = splitChapters('第一章 短\n' + '乙'.repeat(100))
    expect(r).toHaveLength(1)
    expect(r[0]?.chapterIndex).toBe('1')
  })

  it('所有正文都被保留（不丢字）', () => {
    const text = '第一章 甲\nAAA\n第二章 乙\nBBB\n第三章 丙\nCCC'
    const r = splitChapters(text)
    const joined = r.map((c) => c.text).join('')
    expect(joined).toContain('AAA')
    expect(joined).toContain('BBB')
    expect(joined).toContain('CCC')
  })

  it('order 连续递增', () => {
    const r = splitChapters('第一章 A\nx\n第二章 B\ny\n第三章 C\nz')
    expect(r.map((c) => c.order)).toEqual([0, 1, 2])
  })
})

describe('分章：防呆', () => {
  it('正则缺少 g 标志时明确报错', () => {
    expect(() => splitChapters('第一章 A\nx', { regex: /第[一二三]章/ })).toThrow(/g 标志/)
  })

  it('默认正则带 g 与 m 标志', () => {
    expect(DEFAULT_CHAPTER_REGEX.flags).toContain('g')
    expect(DEFAULT_CHAPTER_REGEX.flags).toContain('m')
  })

  it('同一本正则对象连续调用两次结果一致（lastIndex 被重置）', () => {
    const text = '第一章 A\nx\n第二章 B\ny'
    expect(splitChapters(text).length).toBe(splitChapters(text).length)
  })

  it('空文本返回空数组', () => {
    expect(splitChapters('')).toEqual([])
  })
})
