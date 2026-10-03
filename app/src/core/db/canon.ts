import Dexie, { type Table } from 'dexie'
import type {
  Book,
  Chapter,
  ChapterText,
  Character,
  CompileProgress,
  EventLine,
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
 *
 * 版本迁移（ADR-014）：
 *   v1 → v2：新增 characters / eventLines 两张表。**纯新增，不需要数据迁移**
 *            （老数据保持原样，新表建出来即可）。
 */
export class CanonDatabase extends Dexie {
  books!: Table<Book, string>
  chapters!: Table<Chapter, [string, string]>
  chapterTexts!: Table<ChapterText, [string, string]>
  characterSnapshots!: Table<StoredCharacterSnapshot, string>
  characters!: Table<Character, string>
  locations!: Table<StoredLocation, string>
  nodes!: Table<StoredNode, string>
  eventLines!: Table<EventLine, string>
  compileProgress!: Table<CompileProgress, [string, string]>

  constructor(name = CANON_DB_NAME) {
    super(name)

    // v1：初始表结构
    this.version(1).stores({
      books: 'id, title',
      chapters: '[bookId+chapterIndex], bookId, [bookId+order]',
      chapterTexts: '[bookId+chapterIndex], bookId',
      characterSnapshots: 'id, bookId, [bookId+chapterIndex]',
      locations: 'id, bookId, [bookId+name]',
      nodes: 'id, bookId, [bookId+chapterIndex], [bookId+order]',
      compileProgress: '[bookId+stage], bookId',
    })

    // v2：加入 P2/P3 产物（纯新增，无需数据迁移）
    this.version(2).stores({ ...CANON_STORES })
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

/** 仅供类型引用，避免 CANON_VERSION 被 tree-shake 掉时告警。 */
export { CANON_VERSION }
