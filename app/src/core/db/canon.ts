import Dexie, { type Table } from 'dexie'
import type {
  Book,
  Chapter,
  ChapterText,
  CompileProgress,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredNode,
} from '@/core/schema/index.ts'
import { CANON_DB_NAME, CANON_STORES, CANON_VERSION } from './stores.ts'

/**
 * Canon 库 —— 编译产物（不可变层）。
 *
 * 单库，多本书靠 `bookId` 字段区分（ADR-002 修正后）。
 * 世界线数据在**另一个库**里（每条世界线一个），见 ADR-002 的分库策略。
 */
export class CanonDatabase extends Dexie {
  books!: Table<Book, string>
  chapters!: Table<Chapter, [string, string]>
  chapterTexts!: Table<ChapterText, [string, string]>
  characterSnapshots!: Table<StoredCharacterSnapshot, string>
  locations!: Table<StoredLocation, string>
  nodes!: Table<StoredNode, string>
  compileProgress!: Table<CompileProgress, [string, string]>

  constructor(name = CANON_DB_NAME) {
    super(name)
    this.version(CANON_VERSION).stores({ ...CANON_STORES })
  }
}

let instance: CanonDatabase | null = null

/** 取 Canon 库单例。测试里可以传自定义名字隔离。 */
export function getCanonDb(): CanonDatabase {
  instance ??= new CanonDatabase()
  return instance
}

/** 仅用于测试：关闭并清空单例。 */
export async function resetCanonDbForTest(): Promise<void> {
  if (instance) {
    instance.close()
    await instance.delete()
    instance = null
  }
}
