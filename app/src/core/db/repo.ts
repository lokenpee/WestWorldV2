/**
 * 数据读写封装。
 *
 * 分两处存储（ADR-002）：
 *   · **书架**（books）→ 设置库，跨书的全局信息
 *   · **一本书的数据**（章节 / 快照 / 节点 / 事件线 / 实体）→ 每本书一个 Canon 库
 */
import type {
  Book,
  Chapter,
  Character,
  CompileProgress,
  EventLine,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredLocationSnapshot,
  StoredNode,
} from '@/core/schema/index.ts'
import { deleteCanonDb, getCanonDb } from './canon.ts'
import { getSettingsDb } from './settings.ts'

// ── 书架（设置库）──

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
  await getSettingsDb().books.put(book)
  return book
}

export async function getBook(bookId: string): Promise<Book | undefined> {
  return getSettingsDb().books.get(bookId)
}

export async function listBooks(): Promise<Book[]> {
  // ⚠️ 不能用 orderBy('createdAt')：books 表没为 createdAt 建索引，
  // Dexie 对未索引字段排序会抛 SchemaError（曾经把整个 UI 搞崩过）。
  const rows = await getSettingsDb().books.toArray()
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 删掉一本书：书架记录 + 整个 Canon 库（删档 = 删库）。 */
export async function deleteBook(bookId: string): Promise<void> {
  await getSettingsDb().books.delete(bookId)
  await deleteCanonDb(bookId)
}

// ── 章节 ──

export async function saveChapters(
  bookId: string,
  drafts: Array<{ chapterIndex: string; chapterName: string; text: string; charCount: number; order: number }>,
): Promise<void> {
  const db = getCanonDb(bookId)
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
  const rows = await getCanonDb(bookId).chapters.toArray()
  return rows.sort((a, b) => a.order - b.order)
}

export async function getChapterText(bookId: string, chapterIndex: string): Promise<string | undefined> {
  const row = await getCanonDb(bookId).chapterTexts.get(chapterIndex)
  return row?.text
}

// ── P1 产出（快照层：草稿，用户在这上面编辑）──

export interface P1PersistPayload {
  characterSnapshots: StoredCharacterSnapshot[]
  locationSnapshots: StoredLocationSnapshot[]
  nodes: StoredNode[]
}

/** 写入一章的 P1 产出。整章一个事务，避免写一半失败留下脏数据。 */
export async function saveP1Result(bookId: string, payload: P1PersistPayload): Promise<void> {
  const db = getCanonDb(bookId)
  await db.transaction(
    'rw',
    db.characterSnapshots,
    db.locationSnapshots,
    db.nodes,
    async () => {
      if (payload.characterSnapshots.length) {
        await db.characterSnapshots.bulkPut(payload.characterSnapshots)
      }
      if (payload.locationSnapshots.length) {
        await db.locationSnapshots.bulkPut(payload.locationSnapshots)
      }
      if (payload.nodes.length) {
        await db.nodes.bulkPut(payload.nodes)
      }
    },
  )
}

export async function listCharacterSnapshots(bookId: string): Promise<StoredCharacterSnapshot[]> {
  return getCanonDb(bookId).characterSnapshots.toArray()
}

export async function listLocationSnapshots(bookId: string): Promise<StoredLocationSnapshot[]> {
  return getCanonDb(bookId).locationSnapshots.toArray()
}

export async function listNodes(bookId: string): Promise<StoredNode[]> {
  const rows = await getCanonDb(bookId).nodes.toArray()
  return rows.sort((a, b) =>
    a.chapterIndex === b.chapterIndex ? a.order - b.order : a.chapterIndex.localeCompare(b.chapterIndex, undefined, { numeric: true }),
  )
}

// ── 合并结果写回快照层 ──
// 合并 = 保留最早的那条（内容已融合），其余的删掉。id 空着不管。

export async function replaceCharacterSnapshots(
  bookId: string,
  snapshots: StoredCharacterSnapshot[],
): Promise<void> {
  const db = getCanonDb(bookId)
  await db.transaction('rw', db.characterSnapshots, async () => {
    await db.characterSnapshots.clear()
    if (snapshots.length) await db.characterSnapshots.bulkPut(snapshots)
  })
}

export async function replaceLocationSnapshots(
  bookId: string,
  snapshots: StoredLocationSnapshot[],
): Promise<void> {
  const db = getCanonDb(bookId)
  await db.transaction('rw', db.locationSnapshots, async () => {
    await db.locationSnapshots.clear()
    if (snapshots.length) await db.locationSnapshots.bulkPut(snapshots)
  })
}

// ── 入库后的固定资产 ──

export async function listCharacters(bookId: string): Promise<Character[]> {
  const rows = await getCanonDb(bookId).characters.toArray()
  return rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

export async function listLocations(bookId: string): Promise<StoredLocation[]> {
  const rows = await getCanonDb(bookId).locations.toArray()
  return rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

export async function listEventLines(bookId: string): Promise<EventLine[]> {
  const rows = await getCanonDb(bookId).eventLines.toArray()
  return rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

// ── 编译进度（断点续跑的唯一依据，ADR-008）──

export async function getProgress(
  bookId: string,
  stage: CompileProgress['stage'],
): Promise<CompileProgress | undefined> {
  return getCanonDb(bookId).compileProgress.get(stage)
}

export async function putProgress(progress: CompileProgress): Promise<void> {
  await getCanonDb(progress.bookId).compileProgress.put(progress)
}
