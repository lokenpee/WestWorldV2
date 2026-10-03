import { Type, type Static } from '@sinclair/typebox'
import { CharacterSnapshotSchema } from './character-snapshot.ts'
import { LocationSchema } from './location.ts'
import { NodeSchema } from './node.ts'

/**
 * P1 第 1 次调用（世界资产）的输出。
 * 对应提示词 prompts/extraction/01-extract-world-assets.md
 *
 * ⚠️ **不要让模型回显 chapter_index / chapter_name**：
 * 代码本来就知道是第几章（`p1.ts` 用的是输入里的值），让模型回显只是浪费 token，
 * 而且它一旦回显错（比如把 "37" 写成 "第三十七章"）整章校验就会失败。
 */
export const WorldAssetsExtractionSchema = Type.Object(
  {
    characters: Type.Array(CharacterSnapshotSchema, { description: '本章出现的人物快照。' }),
    locations: Type.Array(LocationSchema, { description: '本章出现的地点。' }),
  },
  { additionalProperties: false, description: 'P1-A：世界资产提取结果。' },
)

export type WorldAssetsExtraction = Static<typeof WorldAssetsExtractionSchema>

/**
 * P1 第 2 次调用（叙事资产）的输出。
 * 对应提示词 prompts/extraction/02-extract-narrative-assets.md
 */
export const NarrativeAssetsExtractionSchema = Type.Object(
  {
    nodes: Type.Array(NodeSchema, { description: '本章抽出的事件节点。一段可拆多个。' }),
  },
  { additionalProperties: false, description: 'P1-B：叙事资产提取结果。' },
)

export type NarrativeAssetsExtraction = Static<typeof NarrativeAssetsExtractionSchema>
