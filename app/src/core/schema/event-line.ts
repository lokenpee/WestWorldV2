import { Type, type Static } from '@sinclair/typebox'

/**
 * 事件线 —— P2/P3 把散落的事件节点串成的「一件事」。
 *
 * 一个节点可以属于**多条**事件线（例：`琪官儿举报` 同时属于「琪官儿事件」和「贾赦走私案」）。
 */
export const LineStatusSchema = Type.Union([Type.Literal('open'), Type.Literal('closed')], {
  description: '这条线在逻辑上是否已经讲完。已结束的线之后若发现新节点，允许重新打开。',
})

export type LineStatus = Static<typeof LineStatusSchema>

export const EventLineSchema = Type.Object(
  {
    id: Type.String({ description: '事件线 id，例：L01' }),
    bookId: Type.String({ description: '所属书籍 id' }),
    title: Type.String({ description: '这条线的名字，例：贾赦父子走私案' }),
    nodeIds: Type.Array(Type.String(), { description: '涉及的事件节点 id（多对多）' }),
    /** 由代码从 nodeIds 自动生成，不由模型产出 */
    chapters: Type.Array(Type.String(), { description: '涉及章节（代码生成）' }),
    timeRange: Type.Optional(
      Type.Array(Type.String(), { description: '虚构时间区间 [最早, 最晚]（代码生成）' }),
    ),
    cause: Type.String({ description: '起因' }),
    process: Type.String({ description: '经过' }),
    result: Type.String({ description: '结果' }),
    lineStatus: LineStatusSchema,
    characterIds: Type.Array(Type.String(), { description: '涉及人物实体 id（代码汇总）' }),
    updatedAt: Type.String({ description: 'ISO 8601' }),
  },
  { additionalProperties: false, description: '事件线（P2/P3 聚合产物）' },
)

export type EventLine = Static<typeof EventLineSchema>
