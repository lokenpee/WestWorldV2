import { Type, type Static } from '@sinclair/typebox'
import { ConfidenceSchema, RelationSchema } from './common.ts'

/**
 * 人物**实体** —— 用户在资产页编辑完、点「入库」之后才生成的固定资产。
 *
 * 入库前的所有编辑都在 `characterSnapshots` 上做（那是草稿层）。
 * 入库时把快照复制过来并**重新编号**（`C3-P002` → `P001`），游戏只读这一份。
 */
export const RoleWeightSchema = Type.Union(
  [
    Type.Literal('主要人物'),
    Type.Literal('重要配角'),
    Type.Literal('NPC'),
    Type.Literal('路人'),
  ],
  {
    description:
      '人物层级。判定依据：① 剧情推动能力（有没有主动制造事件）② 因果影响范围 ③ 是否拥有自己的事件线 ④ 移除测试',
  },
)

export type RoleWeight = Static<typeof RoleWeightSchema>

export const CharacterSchema = Type.Object(
  {
    id: Type.String({ description: '入库时重新编码的 id。例：P001' }),
    bookId: Type.String({ description: '所属书籍 id。' }),
    /** 最早出现的章节（保留这条信息，便于知道这个人什么时候登场） */
    chapterIndex: Type.Optional(Type.String()),
    name: Type.String({ description: '主名' }),
    aliases: Type.Array(Type.String(), { description: '所有已知称呼（不含主名）' }),
    roleWeight: RoleWeightSchema,
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
    personality: Type.Optional(Type.String({ description: '性格' })),
    background: Type.Optional(Type.String({ description: '背景 / 来历' })),
    speechStyleSample: Type.Optional(Type.String({ description: '原话片段（说话味道）' })),
    relations: Type.Array(RelationSchema, { description: '关系（目标用人物名，检索时再解析）' }),
    confidence: ConfidenceSchema,
    updatedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false, description: '人物实体（入库后的固定资产）。' },
)

export type Character = Static<typeof CharacterSchema>
