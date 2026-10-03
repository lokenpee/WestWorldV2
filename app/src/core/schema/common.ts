import { Type, type Static } from '@sinclair/typebox'

/** 抽取置信度：0–1。低于 0.6 的会被标为待复核。 */
export const ConfidenceSchema = Type.Number({
  minimum: 0,
  maximum: 1,
  description: '抽取置信度，0 到 1 之间的小数。不确定时给低分，不要编造。',
})

export type Confidence = Static<typeof ConfidenceSchema>

/** 关系的方向：恋人这类是对称的，父子这类是有向的。 */
export const RelationDirectionSchema = Type.Union(
  [Type.Literal('bidirectional'), Type.Literal('directed')],
  { description: '关系方向。bidirectional = 对称（如夫妻、朋友）；directed = 有向（如父子、师徒）。' },
)

export type RelationDirection = Static<typeof RelationDirectionSchema>

/** 单条关系（P1 只给「本章观察到的」关系，不做全书归并）。 */
export const RelationSchema = Type.Object(
  {
    target: Type.String({
      description: '关系指向的人。用本章原文的称呼，还没归并。',
    }),
    relation_type: Type.String({
      description: '关系的英文类型标记，小写下划线风格。例：spouse / parent_child / mentor / friendship',
    }),
    relation_label: Type.Optional(
      Type.String({
        description: '关系的中文说法，用原文里的词。例：夫妻 / 父子 / 知己。原文没写就留空。',
      }),
    ),
    direction: Type.Optional(RelationDirectionSchema),
  },
  { additionalProperties: false, description: '一条人物关系。' },
)

export type Relation = Static<typeof RelationSchema>
