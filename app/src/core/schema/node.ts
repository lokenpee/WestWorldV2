import { Type, type Static } from '@sinclair/typebox'
import { ConfidenceSchema } from './common.ts'

/**
 * 事件节点 —— P1 的产出。
 *
 * 铁律：**只记录，不解释**。
 * 原文只写「贾琏近来手头宽裕」，就只能写「贾琏近来手头宽裕」；
 * ❌ 不能写「这是贾赦走私案的伏笔」。
 *
 * LLM 不产出 id，id 由代码分配。
 */
export const NodeSchema = Type.Object(
  {
    name: Type.String({
      description: '事件名称，客观描述，**不得是结论**。例：贾琏的资金来源异常',
    }),
    summary: Type.String({ description: '事件概述，一到两句。' }),
    actors: Type.Array(Type.String(), {
      description: '行动者。用**本章原文的称呼**，还没归并。例：["贾琏"]',
    }),
    targets: Type.Optional(
      Type.Array(Type.String(), { description: '对象 / 承受者。例：["王熙凤"]' }),
    ),
    world_delta: Type.Optional(
      Type.Array(Type.String(), {
        description: '世界状态因此改变了什么。例：["贾琏手头多出大笔银子"]',
      }),
    ),
    new_facts: Type.Optional(
      Type.Array(Type.String(), {
        description: '新出现的信息。例：["贾琏近期有大笔来路不明的钱"]',
      }),
    ),
    started_actions: Type.Optional(
      Type.Array(Type.String(), {
        description: '谁开始了什么行动（尚未完成）。例：["贾琏开始变卖田产"]',
      }),
    ),
    time_text: Type.Optional(
      Type.String({
        description: '原文里的**明确**时间表述。可空。例：洪武十四年三月六日 / 亥时三刻',
      }),
    ),
    time_hint: Type.Optional(
      Type.String({ description: '原文里的**相对**时间表述。可空。例：次日 / 过了半月' }),
    ),
    quote: Type.String({
      description: '原文片段，用于回查校验。必须是原文里真实存在的句子。',
    }),
    offset: Type.Optional(
      Type.Number({
        description: '该片段在**本章正文**中的字符起点（从 0 开始）。拿不准就留空。',
      }),
    ),
    confidence: ConfidenceSchema,
  },
  { additionalProperties: false, description: '事件节点（P1 产出，未归类到事件线）。' },
)

export type Node = Static<typeof NodeSchema>

/** 时间精度 —— 必须记录，否则 Agent 会把「推断出的小时」当成原文事实（PRD 1.6）。 */
export const TimePrecisionSchema = Type.Union(
  [
    Type.Literal('explicit'),
    Type.Literal('inferred_hour'),
    Type.Literal('inferred_day'),
    Type.Literal('order_only'),
  ],
  {
    description:
      '时间精度。explicit = 原文直接写的；inferred_hour = 推断到小时；inferred_day = 只能推到天；order_only = 只能定先后。',
  },
)

export type TimePrecision = Static<typeof TimePrecisionSchema>

/** 落库后的事件节点。 */
export const StoredNodeSchema = Type.Composite(
  [
    NodeSchema,
    Type.Object({
      id: Type.String({
        description: '代码分配的节点 id。格式 C{章号}-N{本章序号}，例：C037-N02',
      }),
      bookId: Type.String({ description: '所属书籍 id。' }),
      chapterIndex: Type.String({ description: '章节标识。' }),
      chapterName: Type.String({ description: '章节名。' }),
      createdBy: Type.Optional(
        Type.Union([Type.Literal('P1'), Type.Literal('P2')], {
          description: '节点来源。P1 = 章节提取；P2 = 聚合时补建。',
        }),
      ),
      eventLineIds: Type.Optional(
        Type.Array(Type.String(), { description: '所属事件线 id。多对多，聚合后才有。' }),
      ),
      timeCoord: Type.Optional(
        Type.String({
          description: '虚构时间坐标。由 P2 推断，P1 阶段为空。例："003-02-15 08:00"',
        }),
      ),
      timePrecision: Type.Optional(TimePrecisionSchema),
      canonicalId: Type.Optional(
        Type.String({ description: '若本节点被判定与另一节点重复，指向主节点 id。' }),
      ),
    }),
  ],
  { description: '已落库的事件节点。' },
)

export type StoredNode = Static<typeof StoredNodeSchema>
