import { Type, type Static } from '@sinclair/typebox'

/** 一本书。Canon 库里可以有多本书，靠 id 区分。 */
export const BookSchema = Type.Object(
  {
    id: Type.String({ description: '书籍唯一 id。例：bk_001' }),
    title: Type.String({ description: '书名。默认取文件名。' }),
    author: Type.Optional(Type.String({ description: '作者。原文没写就留空。' })),
    sourceFileName: Type.Optional(Type.String({ description: '导入时的原始文件名。' })),
    createdAt: Type.String({ description: '导入时间，ISO 8601 字符串。' }),
  },
  { additionalProperties: false, description: '一本书。' },
)

export type Book = Static<typeof BookSchema>

/** 章节（导入预处理的产物）。 */
export const ChapterSchema = Type.Object(
  {
    bookId: Type.String({ description: '所属书籍 id。' }),
    chapterIndex: Type.String({
      description: '章节标识，字符串。超长章节切块后形如 "101.1"。用于排序与区间计算。',
    }),
    chapterName: Type.String({ description: '章节名，导入预处理后的结果。' }),
    charCount: Type.Number({ description: '本章字数。' }),
    order: Type.Number({ description: '在书中的顺序，从 0 开始。' }),
  },
  { additionalProperties: false, description: '一章的元信息（不含正文）。' },
)

export type Chapter = Static<typeof ChapterSchema>

/** 章节正文。独立一张表，避免查询元信息时把正文一起读出来。 */
export const ChapterTextSchema = Type.Object(
  {
    bookId: Type.String({ description: '所属书籍 id。' }),
    chapterIndex: Type.String({ description: '章节标识。' }),
    text: Type.String({ description: '本章正文。' }),
  },
  { additionalProperties: false, description: '一章的正文。' },
)

export type ChapterText = Static<typeof ChapterTextSchema>

export const CompileStageSchema = Type.Union(
  [Type.Literal('P1'), Type.Literal('P2'), Type.Literal('P3')],
  { description: '编译阶段。P1 = 逐章提取；P2 = 每 100 章滚动归并；P3 = 全书收尾。' },
)

export type CompileStage = Static<typeof CompileStageSchema>

export const CompileStatusSchema = Type.Union(
  [
    Type.Literal('idle'),
    Type.Literal('running'),
    Type.Literal('paused'),
    Type.Literal('cancelling'),
    Type.Literal('cancelled'),
    Type.Literal('failed'),
    Type.Literal('completed'),
  ],
  { description: '任务状态，见 ADR-008 的状态机。' },
)

export type CompileStatus = Static<typeof CompileStatusSchema>

/**
 * 编译进度 —— 断点续跑的唯一依据（ADR-008）。
 * **每章完成立即写**，这是"关掉标签页后能接着跑"能成立的前提。
 */
export const CompileProgressSchema = Type.Object(
  {
    bookId: Type.String({ description: '所属书籍 id。' }),
    stage: CompileStageSchema,
    status: CompileStatusSchema,
    totalChapters: Type.Number({ description: '总章节数。' }),
    completedChapters: Type.Array(Type.String(), { description: '已完成的章节标识。' }),
    failedChapters: Type.Array(Type.String(), { description: '重试后仍失败的章节标识。' }),
    lastWindowIndex: Type.Optional(
      Type.Number({ description: 'P2 已完成的窗口序号，从 0 开始。' }),
    ),
    updatedAt: Type.String({ description: '最后更新时间，ISO 8601 字符串。' }),
  },
  { additionalProperties: false, description: '编译进度。' },
)

export type CompileProgress = Static<typeof CompileProgressSchema>
