import { Type, type Static } from '@sinclair/typebox'
import { ConfidenceSchema, RelationSchema } from './common.ts'
import { RoleWeightSchema } from './character.ts'

/**
 * 人物快照 —— P1 的产出。
 *
 * 重要：**本章不判层级**（主要人物 / 重要配角 / NPC / 路人由 P2 的滚动检查决定）。
 * 所以所有人用同一套字段，能填则填、不能填留空。
 *
 * 另外：**LLM 不产出 id**，id 由代码在落库时分配（见 Stored 版本）。
 */
export const CharacterSnapshotSchema = Type.Object(
  {
    name: Type.String({
      description: '本章主要使用的称呼。可能是别名，例：琏二爷。',
    }),
    aliases_mentioned: Type.Optional(
      Type.Array(Type.String(), {
        description: '本章出现过的其他称呼，用于后续归并同一个人。例：["琏二哥哥"]',
      }),
    ),
    identity: Type.Optional(
      Type.String({ description: '身份 / 职务 / 归属。例：荣国府长孙。原文没写就留空。' }),
    ),
    profile: Type.Optional(
      Type.Object(
        {
          age: Type.Optional(Type.Number({ description: '年龄。原文没明确写就留空。' })),
          gender: Type.Optional(Type.String({ description: '性别。原文没写就留空。' })),
        },
        { additionalProperties: false, description: '打包的基础资料。' },
      ),
    ),
    appearance: Type.Optional(
      Type.String({ description: '外貌。**仅当原文写到**，不要推断。' }),
    ),
    personality: Type.Optional(
      Type.String({
        description: '性格。**必须能从原文找到依据**，不要凭印象概括。多条用「；」分隔。',
      }),
    ),
    background: Type.Optional(Type.String({ description: '背景 / 来历。仅当原文写到。' })),
    speech_style_sample: Type.Optional(
      Type.String({
        description: '本章这个人的**原话片段**（直接摘录），用于后续学习他的说话味道。',
      }),
    ),
    relations: Type.Optional(Type.Array(RelationSchema, { description: '本章观察到的关系。' })),
    confidence: ConfidenceSchema,
  },
  { additionalProperties: false, description: '人物快照（P1 产出，未归并、未分层的原始观察）。' },
)

export type CharacterSnapshot = Static<typeof CharacterSnapshotSchema>

/** 落库后的人物快照：加上代码分配的 id 与归属信息。 */
export const StoredCharacterSnapshotSchema = Type.Composite(
  [
    CharacterSnapshotSchema,
    Type.Object({
      id: Type.String({ description: '代码分配的快照 id。格式 C{章号}-P{3 位序号}，例：C037-P003' }),
      bookId: Type.String({ description: '所属书籍 id。' }),
      chapterIndex: Type.String({
        description: '章节标识。字符串以支持切块，例："37" 或 "101.1"。',
      }),
      chapterName: Type.String({ description: '导入预处理后的章节名。' }),
      /** 合并阶段填上：这个人的所有已知称呼（含被合并掉的那些快照里的） */
      aliases: Type.Optional(
        Type.Array(Type.String(), { description: '合并后的别名列表。例：["琏二爷", "琏二哥哥"]' }),
      ),
      /** 合并阶段填上，用户可改 */
      roleWeight: Type.Optional(RoleWeightSchema),
      updatedAt: Type.Optional(Type.String({ description: '最后一次编辑时间' })),
    }),
  ],
  { description: '已落库的人物快照。' },
)

export type StoredCharacterSnapshot = Static<typeof StoredCharacterSnapshotSchema>


