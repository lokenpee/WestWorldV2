import { Type, type Static } from '@sinclair/typebox'
import { ConfidenceSchema } from './common.ts'

/**
 * 地点快照 —— P1 的产出（与人物快照同构）。
 *
 * 存在的理由跟人物快照一样：**每章都会重复抽到同一个地点**（"荣国府"在 100 章里出现 100 次），
 * 所以要逐章记下来，再由 P2/P3 向前合并（以最早的快照为准）。
 */
export const LocationSnapshotSchema = Type.Object(
  {
    name: Type.String({ description: '地点名称，用原文的叫法。例：荣国府 / 县一中。' }),
    description: Type.Optional(Type.String({ description: '一句话描述。原文没写就留空。' })),
    confidence: ConfidenceSchema,
  },
  { additionalProperties: false, description: '地点快照（P1 产出，未合并）。' },
)

export type LocationSnapshot = Static<typeof LocationSnapshotSchema>

/** 落库后的地点快照：加上代码分配的 id 与归属信息。 */
export const StoredLocationSnapshotSchema = Type.Composite(
  [
    LocationSnapshotSchema,
    Type.Object({
      id: Type.String({ description: '代码分配的 id。格式 C{章号}-L{章内序号}，例：C37-L002' }),
      bookId: Type.String({ description: '所属书籍 id。分库后冗余，保留便于导出与调试。' }),
      chapterIndex: Type.String({ description: '章节标识。' }),
      chapterName: Type.String({ description: '章节名。' }),
      updatedAt: Type.Optional(Type.String({ description: '最后一次编辑时间（合并或人工修改过）' })),
    }),
  ],
  { description: '已落库的地点快照。' },
)

export type StoredLocationSnapshot = Static<typeof StoredLocationSnapshotSchema>

/** 入库后生成的地点实体（id 重新编码为 L001 这种短 id）。 */
export const StoredLocationSchema = Type.Composite(
  [
    LocationSnapshotSchema,
    Type.Object({
      id: Type.String({ description: '入库时重新编码的 id。例：L001' }),
      bookId: Type.String({ description: '所属书籍 id。' }),
      chapterIndex: Type.Optional(
        Type.String({ description: '最早出现的章节（合并后的那条保留的信息）' }),
      ),
      updatedAt: Type.Optional(Type.String()),
    }),
  ],
  { description: '已入库的地点实体。' },
)

export type StoredLocation = Static<typeof StoredLocationSchema>
