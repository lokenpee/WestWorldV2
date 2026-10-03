import { Type, type Static } from '@sinclair/typebox'

/**
 * 人物实体 —— P2/P3 合并的产物。
 *
 * 与「人物快照」的区别：
 *   快照 = 某一章的观察（C037-P003），**未归并**
 *   实体 = 全书同一个人（P001），**已归并**
 *
 * 合并规则见 ADR/工程约定第 8 节：不新建、不删除，
 * **挑一个保留原 id，另一个写 mergedInto 重定向**，然后回填引用。
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
      '人物层级。主要人物 = 承担核心剧情线；重要配角 = 对重要剧情线有持续影响；NPC = 反复参与局部剧情；路人 = 单次或低影响。',
  },
)

export type RoleWeight = Static<typeof RoleWeightSchema>

export const CharacterRelationSchema = Type.Object(
  {
    targetId: Type.String({ description: '关系指向的人物实体 id，例：P001' }),
    relationType: Type.String({ description: '英文类型标记，例：spouse / parent_child / mentor' }),
    relationLabel: Type.Optional(Type.String({ description: '中文说法，例：夫妻 / 父子' })),
    direction: Type.Optional(
      Type.Union([Type.Literal('bidirectional'), Type.Literal('directed')]),
    ),
  },
  { additionalProperties: false },
)

export const CharacterSchema = Type.Object(
  {
    id: Type.String({ description: '人物实体 id，例：P001' }),
    bookId: Type.String({ description: '所属书籍 id' }),
    name: Type.String({ description: '主名（合并后选定的那个称呼）' }),
    aliases: Type.Array(Type.String(), { description: '所有已知称呼，含被合并实体的称呼' }),
    roleWeight: RoleWeightSchema,
    identity: Type.Optional(Type.String()),
    profile: Type.Optional(
      Type.Object(
        {
          age: Type.Optional(Type.Number()),
          gender: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    appearance: Type.Optional(Type.String()),
    personality: Type.Optional(Type.String()),
    background: Type.Optional(Type.String()),
    speechStyleSample: Type.Optional(Type.String()),
    relations: Type.Array(CharacterRelationSchema, { description: '初始关系（不含变化史）' }),
    /** 被合并到哪个实体。**不删除**，只加这个字段（可追溯、可撤销、防悬空引用） */
    mergedInto: Type.Optional(Type.String({ description: '若被合并，指向主实体 id' })),
    /** 从哪些快照合并而来（可追溯） */
    sourceSnapshotIds: Type.Array(Type.String()),
    updatedAt: Type.String({ description: 'ISO 8601' }),
  },
  { additionalProperties: false, description: '人物实体（P2/P3 合并产物）' },
)

export type Character = Static<typeof CharacterSchema>
