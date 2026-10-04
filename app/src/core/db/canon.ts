import Dexie, { type Table } from 'dexie'
import type {
  Chapter,
  ChapterText,
  Character,
  CompileProgress,
  EventLine,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredLocationSnapshot,
  StoredNode,
} from '@/core/schema/index.ts'
import { CANON_DB_PREFIX, CANON_STORES } from './stores.ts'

/**
 * Canon 库 —— **每本书一个**（ADR-002）。
 *
 * 分库的理由：id 是书内编号（`C3-P002` / `P001`），共用一个库会跨书覆盖。
 * 详见 stores.ts 顶部的说明。
 */
export class CanonDatabase extends Dexie {
  chapters!: Table<Chapter, string>
  chapterTexts!: Table<ChapterText, string>
  characterSnapshots!: Table<StoredCharacterSnapshot, string>
  locationSnapshots!: Table<StoredLocationSnapshot, string>
  nodes!: Table<StoredNode, string>
  eventLines!: Table<EventLine, string>
  characters!: Table<Character, string>
  locations!: Table<StoredLocation, string>
  compileProgress!: Table<CompileProgress, string>

  constructor(bookId: string) {
    super(CANON_DB_PREFIX + bookId)
    this.version(1).stores({ ...CANON_STORES })
  }
}

const instances = new Map<string, CanonDatabase>()

/** 取某本书的 Canon 库（按 bookId 缓存实例）。 */
export function getCanonDb(bookId: string): CanonDatabase {
  let db = instances.get(bookId)
  if (!db) {
    db = new CanonDatabase(bookId)
    instances.set(bookId, db)
  }
  return db
}

/** 删掉一本书的整个库（删档 = 删库）。 */
export async function deleteCanonDb(bookId: string): Promise<void> {
  const existing = instances.get(bookId)
  existing?.close()
  instances.delete(bookId)
  await Dexie.delete(CANON_DB_PREFIX + bookId)
}

/** 仅用于测试。 */
export async function resetCanonDbForTest(bookId?: string): Promise<void> {
  if (bookId) {
    await deleteCanonDb(bookId)
    return
  }
  for (const id of [...instances.keys()]) await deleteCanonDb(id)
}

/** 列出当前进程里已打开的书（调试用）。 */
export function listOpenCanonDbs(): string[] {
  return [...instances.keys()]
}
