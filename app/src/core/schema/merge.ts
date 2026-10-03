import { Type, type Static } from '@sinclair/typebox'

/**
 * AI 别名识别的输出（提示词 05）。
 *
 * 本地规则能判「包含」「后缀」，但判不了「贾琏 / 琏二爷」这类昵称 —— 那一步交给模型。
 * 模型只负责**指出哪些名字是同一个人**；真正怎么合并（挑哪个 id 保留、怎么回填引用）
 * 仍然由代码决定（见工程约定第 8 节）。
 */
export const AliasGroupSchema = Type.Object(
  {
    canonicalName: Type.String({
      description: '这一组里最正式、最完整的那个称呼。例：贾琏',
    }),
    names: Type.Array(Type.String(), {
      description: '这一组里所有确实是同一个人的称呼。例：["贾琏", "琏二爷", "琏二哥哥"]',
    }),
  },
  { additionalProperties: false, description: '一组同人的称呼。' },
)

export const AliasGroupsSchema = Type.Object(
  {
    groups: Type.Array(AliasGroupSchema, {
      description: '识别出的同人分组。单人不用输出，没有就返回空数组。',
    }),
  },
  { additionalProperties: false, description: 'AI 别名识别结果。' },
)

export type AliasGroups = Static<typeof AliasGroupsSchema>
export type AliasGroup = Static<typeof AliasGroupSchema>

/**
 * AI 字段级融合的输出（提示词 03）。
 *
 * 与 AliasGroupsSchema 的分工：
 *   AliasGroupsSchema —— **指出哪些名字是同一个人**（识别）
 *   MergedEntitySchema —— **把同一个人的多份快照融合成一份档案**（融合）
 *
 * 这里不产出 id：怎么合、保留哪个 id 由代码决定（工程约定第 8 节）。
 */
export const MergedEntitySchema = Type.Object(
  {
    entity: Type.Object(
      {
        name: Type.String({ description: '融合后的主名' }),
        aliases: Type.Array(Type.String(), { description: '所有已知称呼（不含主名）' }),
        roleWeight: Type.Union(
          [
            Type.Literal('主要人物'),
            Type.Literal('重要配角'),
            Type.Literal('NPC'),
            Type.Literal('路人'),
          ],
          {
            description:
              '人物层级。判定依据：① 剧情推动能力（有没有主动制造事件）② 因果影响范围 ③ 是否拥有自己的事件线 ④ 移除测试（删掉他，哪些重要事件会无法发生）',
          },
        ),
        identity: Type.Optional(Type.String({ description: '身份 / 职务 / 归属' })),
        profile: Type.Optional(
          Type.Object(
            {
              age: Type.Optional(Type.Number()),
              gender: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
        ),
        appearance: Type.Optional(Type.String({ description: '外貌' })),
        personality: Type.Optional(
          Type.String({ description: '性格。多条用「；」分隔。**不得遗漏任何快照里的独有信息**' }),
        ),
        background: Type.Optional(Type.String({ description: '背景 / 来历' })),
        speechStyleSample: Type.Optional(
          Type.String({ description: '原话片段（直接摘录，用于学这个人的说话味道）' }),
        ),
        relations: Type.Array(
          Type.Object(
            {
              target: Type.String({ description: '关系指向的人，用原文称呼' }),
              relationType: Type.String({ description: '英文类型标记' }),
              relationLabel: Type.Optional(Type.String({ description: '中文说法' })),
              direction: Type.Optional(
                Type.Union([Type.Literal('bidirectional'), Type.Literal('directed')]),
              ),
            },
            { additionalProperties: false },
          ),
          { description: '融合后的关系列表' },
        ),
      },
      { additionalProperties: false },
    ),
    merge_notes: Type.Array(Type.String(), {
      description:
        '记录**无法融合的矛盾**（原文本身就冲突，或两次抽取结果冲突）。例：「C037 写瘦削，C041 写富态，已保留两说」。没有矛盾就返回空数组。',
    }),
  },
  { additionalProperties: false, description: 'AI 字段级融合结果。' },
)

export type MergedEntity = Static<typeof MergedEntitySchema>
