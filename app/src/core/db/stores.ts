/**
 * Canon 库的表结构 —— **每本书一个库**（ADR-002）。
 *
 * 库名：`westworld_canon_{bookId}`
 *
 * ⚠️ 为什么必须分库：id 是**书内编号**（`C3-P002` / `P001`），如果所有书共用一个库，
 * 两本书的第 1 章会互相覆盖（这个 bug 实际发生过，有回归测试兜着）。
 * 分库之后 id 天然按书隔离，不需要给每个 id 加前缀。
 *
 * 分库后 `bookId` 字段是冗余的（库里只有一本书），保留它只是为了导出/调试时自描述。
 *
 * Dexie 索引语法：`id` 单字段；`[a+b]` 复合；`&` 唯一；`*` multiEntry
 */
export const CANON_DB_PREFIX = 'westworld_canon_'

export const CANON_STORES = {
  /** 章节元信息（不含正文）。主键就是「第几章」 */
  chapters: 'chapterIndex, order',

  /** 章节正文（单独一张表，避免查列表时把几 MB 正文一起读出来） */
  chapterTexts: 'chapterIndex',

  /** 人物快照（P1 产出；P2/P3 合并后剩下的就是"合并结果"，用户在这上面编辑） */
  characterSnapshots: 'id, chapterIndex, name',

  /** 地点快照（同上） */
  locationSnapshots: 'id, chapterIndex, name',

  /** 事件节点 */
  nodes: 'id, chapterIndex, order',

  /** 事件线（P2/P3 串联产物） */
  eventLines: 'id',

  /** 人物实体 —— **用户点「入库」后才生成**（固定资产） */
  characters: 'id, name',

  /** 地点实体 —— 同上 */
  locations: 'id, name',

  /** 编译进度（断点续跑的唯一依据，ADR-008） */
  compileProgress: 'stage',
} as const

export type CanonStoreName = keyof typeof CANON_STORES
