/**
 * Canon 库的表结构与索引 —— **唯一手写处**。
 *
 * ADR-003 的边界：TypeBox 管「业务数据的形状」，这里管「表结构与索引设计」。
 * 两者必须一致 —— 由 `tests/db.test.ts` 里的漂移测试保证：
 * **索引声明里用到的每一个字段，都必须在对应 TypeBox schema 里存在**。
 *
 * Dexie 的索引语法：
 *   `id`                     单字段索引
 *   `[bookId+chapterIndex]`  复合索引（也是复合主键）
 *   带前缀 `&` 表示唯一索引，`*` 表示 multiEntry（数组）
 */
export const CANON_DB_NAME = 'westworld_canon'

export const CANON_VERSION = 1

export const CANON_STORES = {
  /** 一本书 */
  books: 'id, title',

  /** 章节元信息（不含正文） */
  chapters: '[bookId+chapterIndex], bookId, [bookId+order]',

  /** 章节正文（单独一张表，避免查元信息时把正文一起读出来） */
  chapterTexts: '[bookId+chapterIndex], bookId',

  /** 人物快照（P1 产出，未归并） */
  characterSnapshots: 'id, bookId, [bookId+chapterIndex]',

  /** 地点 */
  locations: 'id, bookId, [bookId+name]',

  /** 事件节点 */
  nodes: 'id, bookId, [bookId+chapterIndex], [bookId+order]',

  /** 编译进度（断点续跑的唯一依据，ADR-008） */
  compileProgress: '[bookId+stage], bookId',
} as const

export type CanonStoreName = keyof typeof CANON_STORES
