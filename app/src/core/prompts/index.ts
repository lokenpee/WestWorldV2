/**
 * 提示词加载器。
 *
 * 提示词是独立的 `.md` 文件（ADR-011），用 Vite 的 `?raw` 导入成字符串 ——
 * **改提示词不需要重编译代码，也不需要改 TypeScript**。
 *
 * 字段表部分由 `scripts/render-prompt-schema.ts` 从 TypeBox schema 生成，
 * 见 ADR-011 的「手写区 + 生成区」。
 */
import extractWorldAssets from './extraction/01-extract-world-assets.md?raw'
import extractNarrativeAssets from './extraction/02-extract-narrative-assets.md?raw'
import mergeWorldAssets from './merge/03-merge-world-assets.md?raw'
import linkEventLines from './merge/04-link-event-lines.md?raw'

export const PROMPTS = {
  /** P1 第 1 次调用：人物 + 地点 */
  extractWorldAssets,
  /** P1 第 2 次调用：事件节点 */
  extractNarrativeAssets,
  /** P2 / P3：世界资产合并 */
  mergeWorldAssets,
  /** P2 / P3：串联事件线 + 连贯性检查 */
  linkEventLines,
} as const

export type PromptName = keyof typeof PROMPTS
