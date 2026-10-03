import { Type, type Static } from '@sinclair/typebox'
import { CharacterSnapshotSchema } from './character-snapshot.ts'
import { LocationSchema } from './location.ts'
import { NodeSchema } from './node.ts'

/**
 * P1 第 1 次调用（世界资产）的输出。
 * 对应提示词 prompts/extraction/01-extract-world-assets.md
 */
export const WorldAssetsExtractionSchema = Type.Object(
  {
    chapter_index: Type.String({ description: '章节标识。例："37" 或 "101.1"' }),
    chapter_name: Type.String({ description: '章节名。例：第三十七回 秋爽斋偶结海棠社' }),
    characters: Type.Array(CharacterSnapshotSchema, { description: '本章出现的人物快照。' }),
    locations: Type.Array(LocationSchema, { description: '本章出现的地点。' }),
  },
  { additionalProperties: false, description: 'P1-B：世界资产提取结果。' },
)

export type WorldAssetsExtraction = Static<typeof WorldAssetsExtractionSchema>

/**
 * P1 第 2 次调用（叙事资产）的输出。
 * 对应提示词 prompts/extraction/02-extract-narrative-assets.md
 */
export const NarrativeAssetsExtractionSchema = Type.Object(
  {
    chapter_index: Type.String({ description: '章节标识。' }),
    chapter_name: Type.String({ description: '章节名。' }),
    nodes: Type.Array(NodeSchema, { description: '本章抽出的事件节点。一段可拆多个。' }),
  },
  { additionalProperties: false, description: 'P1-B：叙事资产提取结果。' },
)

export type NarrativeAssetsExtraction = Static<typeof NarrativeAssetsExtractionSchema>
