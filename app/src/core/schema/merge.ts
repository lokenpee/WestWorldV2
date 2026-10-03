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
