/**
 * Canon 库的读写封装。
 *
 * 为什么要有这一层（ADR-012）：
 *   - `features/` 不允许直接 import `core/db`，只能通过这一层暴露的函数
 *   - 写入集中在一处，方便加校验、加事务、加变更账本
 */
import type {
  Book,
  Chapter,
  CompileProgress,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredNode,
} from '@/core/schema/index.ts'
import { getCanonDb } from './canon.ts'

// ── 书 ──

export async function createBook(input: {
  id: string
  title: string
  author?: string
  sourceFileName?: string
}): Promise<Book> {
  const book: Book = {
    id: input.id,
    title: input.title,
    createdAt: new Date().toISOString(),
    ...(input.author ? { author: input.author } : {}),
    ...(input.sourceFileName ? { sourceFileName: input.sourceFileName } : {}),
  }
  await getCanonDb().books.put(book)
  return book
}

export async function getBook(bookId: string): Promise<Book | undefined> {
  return getCanonDb().books.get(bookId)
}

export async function listBooks(): Promise<Book[]> {
  return getCanonDb().books.orderBy('createdAt').reverse().toArray()
}

// ── 章节 ──

export async function saveChapters(
  bookId: string,
  drafts: Array<{ chapterIndex: string; chapterName: string; text: string; charCount: number; order: number }>,
): Promise<void> {
  const db = getCanonDb()
  // 元信息与正文分表（正文可能很大，不该在查章节列表时被顺带读出来）
  const chapters: Chapter[] = drafts.map((d) => ({
    bookId,
    chapterIndex: d.chapterIndex,
    chapterName: d.chapterName,
    charCount: d.charCount,
    order: d.order,
  }))
  const texts = drafts.map((d) => ({ bookId, chapterIndex: d.chapterIndex, text: d.text }))

  await db.transaction('rw', db.chapters, db.chapterTexts, async () => {
    await db.chapters.bulkPut(chapters)
    await db.chapterTexts.bulkPut(texts)
  })
}

export async function listChapters(bookId: string): Promise<Chapter[]> {
  const rows = await getCanonDb().chapters.where('bookId').equals(bookId).toArray()
  return rows.sort((a, b) => a.order - b.order)
}

export async function getChapterText(bookId: string, chapterIndex: string): Promise<string | undefined> {
  const row = await getCanonDb().chapterTexts.get([bookId, chapterIndex])
  return row?.text
}

// ── P1 产出 ──

export interface P1PersistPayload {
  characterSnapshots: StoredCharacterSnapshot[]
  locations: StoredLocation[]
  nodes: StoredNode[]
}

/** 写入一章的 P1 产出。整章一个事务，避免写一半失败留下脏数据。 */
export async function saveP1Result(bookId: string, payload: P1PersistPayload): Promise<void> {
  const db = getCanonDb()
  await db.transaction(
    'rw',
    db.characterSnapshots,
    db.locations,
    db.nodes,
    async () => {
      if (payload.characterSnapshots.length) {
        await db.characterSnapshots.bulkPut(payload.characterSnapshots)
      }
      if (payload.locations.length) {
        await db.locations.bulkPut(payload.locations)
      }
      if (payload.nodes.length) {
        await db.nodes.bulkPut(payload.nodes)
      }
    },
  )
  void bookId
}

export async function listCharacterSnapshots(bookId: string): Promise<StoredCharacterSnapshot[]> {
  return getCanonDb().characterSnapshots.where('bookId').equals(bookId).toArray()
}

export async function listLocations(bookId: string): Promise<StoredLocation[]> {
  return getCanonDb().locations.where('bookId').equals(bookId).toArray()
}

export async function listNodes(bookId: string): Promise<StoredNode[]> {
  const rows = await getCanonDb().nodes.where('bookId').equals(bookId).toArray()
  return rows.sort((a, b) => (a.chapterIndex === b.chapterIndex ? a.order - b.order : a.chapterIndex.localeCompare(b.chapterIndex)))
}

// ── 编译进度（断点续跑的唯一依据，ADR-008）──

export async function getProgress(
  bookId: string,
  stage: CompileProgress['stage'],
): Promise<CompileProgress | undefined> {
  return getCanonDb().compileProgress.get([bookId, stage])
}

/** 覆盖写。调用方保证只有一个写入者（编排器），避免并发丢更新。 */
export async function putProgress(progress: CompileProgress): Promise<void> {
  await getCanonDb().compileProgress.put(progress)
}

// ── 删除 ──

/** 删掉一本书的全部数据（含正文与进度）。 */
export async function deleteBook(bookId: string): Promise<void> {
  const db = getCanonDb()
  await db.transaction(
    'rw',
    [db.books, db.chapters, db.chapterTexts, db.characterSnapshots, db.locations, db.nodes, db.compileProgress],
    async () => {
      await db.books.delete(bookId)
      await db.chapters.where('bookId').equals(bookId).delete()
      await db.chapterTexts.where('bookId').equals(bookId).delete()
      await db.characterSnapshots.where('bookId').equals(bookId).delete()
      await db.locations.where('bookId').equals(bookId).delete()
      await db.nodes.where('bookId').equals(bookId).delete()
      await db.compileProgress.where('bookId').equals(bookId).delete()
    },
  )
}
