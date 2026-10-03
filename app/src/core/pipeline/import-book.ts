/**
 * 导入一本书：txt → 分章 → 落库（实施计划步骤 7 的入口）。
 */
import type { Book } from '@/core/schema/index.ts'
import { createBook, putProgress, saveChapters } from '@/core/db/repo.ts'
import { splitChapters, type SplitOptions } from './split-chapters.ts'

export interface ImportBookInput {
  id: string
  title: string
  text: string
  sourceFileName?: string
  /** 分章参数（正则 / 切块阈值 / 滑窗大小） */
  split?: SplitOptions
}

export interface ImportBookResult {
  book: Book
  chapterCount: number
  /** 章节列表（供 UI 立即展示，不必再查库） */
  chapters: Array<{ chapterIndex: string; chapterName: string; charCount: number; order: number }>
}

export async function importBook(input: ImportBookInput): Promise<ImportBookResult> {
  const drafts = splitChapters(input.text, input.split ?? {})
  if (drafts.length === 0) {
    throw new Error('没有切出任何章节：文件可能是空的，或分章正则与文本不匹配')
  }

  const book = await createBook({
    id: input.id,
    title: input.title,
    ...(input.sourceFileName ? { sourceFileName: input.sourceFileName } : {}),
  })

  await saveChapters(book.id, drafts)

  // 初始化进度（断点续跑的依据）
  await putProgress({
    bookId: book.id,
    stage: 'P1',
    status: 'idle',
    totalChapters: drafts.length,
    completedChapters: [],
    failedChapters: [],
    updatedAt: new Date().toISOString(),
  })

  return {
    book,
    chapterCount: drafts.length,
    chapters: drafts.map((d) => ({
      chapterIndex: d.chapterIndex,
      chapterName: d.chapterName,
      charCount: d.charCount,
      order: d.order,
    })),
  }
}
