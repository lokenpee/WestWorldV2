import { Type, type Static } from '@sinclair/typebox'

/** 地点 —— P1 顺手抽取，不做层级、不做归并（PRD 2.3）。 */
export const LocationSchema = Type.Object(
  {
    name: Type.String({ description: '地点名称，用原文的叫法。例：荣国府 / 县一中。' }),
    description: Type.Optional(
      Type.String({ description: '一句话描述。原文没写就留空。' }),
    ),
  },
  { additionalProperties: false, description: '地点。' },
)

export type Location = Static<typeof LocationSchema>

/** 落库后的地点。 */
export const StoredLocationSchema = Type.Composite(
  [
    LocationSchema,
    Type.Object({
      id: Type.String({ description: '代码分配的 id。格式 L{序号}，例：L003' }),
      bookId: Type.String({ description: '所属书籍 id。' }),
      chapterIndex: Type.String({ description: '首次出现的章节标识。' }),
    }),
  ],
  { description: '已落库的地点。' },
)

export type StoredLocation = Static<typeof StoredLocationSchema>
