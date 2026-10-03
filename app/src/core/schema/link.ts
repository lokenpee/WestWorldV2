import { Type, type Static } from '@sinclair/typebox'
import { LineStatusSchema } from './event-line.ts'
import { NodeSchema } from './node.ts'

/**
 * 事件线串联的 AI 输出（提示词 04）。
 *
 * **只输出「操作」，不重新描述全部数据** —— 这样已有事件线的 id 与内容不会被覆盖，
 * 也天然实现「能续就续，不要新建」。
 */
export const EventLineOpAppendSchema = Type.Object(
  {
    op: Type.Literal('append', { description: '追加到已有的那条事件线' }),
    line_id: Type.String({ description: '已有事件线的 id，例：L05' }),
    node_ids: Type.Array(Type.String(), { description: '要追加进来的节点 id' }),
    cause: Type.String({ description: '补充后的起因' }),
    process: Type.String({ description: '补充后的经过' }),
    result: Type.String({ description: '补充后的结果' }),
    line_status: LineStatusSchema,
  },
  { additionalProperties: false },
)

export const EventLineOpCreateSchema = Type.Object(
  {
    op: Type.Literal('create', { description: '新建一条事件线' }),
    title: Type.String({ description: '这条线的名字，例：贾赦父子走私案' }),
    node_ids: Type.Array(Type.String(), { description: '这条线包含的节点 id' }),
    cause: Type.String({ description: '起因' }),
    process: Type.String({ description: '经过' }),
    result: Type.String({ description: '结果' }),
    line_status: LineStatusSchema,
  },
  { additionalProperties: false },
)

export const EventLineOpSchema = Type.Union([EventLineOpAppendSchema, EventLineOpCreateSchema])

/** 补断点时新建的节点（由代码分配 id）。 */
export const NewNodeDraftSchema = Type.Omit(NodeSchema, ['confidence'], {
  description: 'P2/P3 补断点时新建的节点。id 由代码分配。',
})

export type NewNodeDraft = Static<typeof NewNodeDraftSchema>

export const LinkEventLinesResultSchema = Type.Object(
  {
    event_line_ops: Type.Array(EventLineOpSchema, {
      description: '对事件线的增量操作。空数组表示本批节点没有归属到任何线。',
    }),
    new_nodes: Type.Array(NewNodeDraftSchema, {
      description: '补断点时新建的节点。没有就返回空数组。',
    }),
  },
  { additionalProperties: false, description: '事件线串联结果。' },
)

export type LinkEventLinesResult = Static<typeof LinkEventLinesResultSchema>
export type EventLineOp = Static<typeof EventLineOpSchema>
