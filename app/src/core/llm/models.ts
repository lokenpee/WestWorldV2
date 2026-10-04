import { createModels } from '@earendil-works/pi-ai/models'
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'
import { IndexedDbCredentialStore } from './credentials.ts'
import { buildProvider, DEFAULT_BASE_URL } from './provider.ts'

/**
 * 模型配置。
 *
 * 从「写死」改成「可配置」（ADR-004：模型名 / base URL / Key 全部走配置）：
 * 用户在设置界面填的 baseUrl 与模型名会在这里生效。
 */
export interface LlmConfig {
  baseUrl: string
  /** P1 逐章提取用：调用量最大，选便宜快的 */
  extractionModel: string
  /** P2/P3 归并用：需要推理与长上下文，选强的 */
  aggregationModel: string
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: DEFAULT_BASE_URL,
  extractionModel: 'deepseek-flash',
  aggregationModel: 'deepseek-v4-pro',
}

export type ModelRole = 'extraction' | 'aggregation'

/** DeepSeek 官方目录里的模型名（给设置界面做下拉用）。 */
export function listCatalogModels(): string[] {
  return deepseekProvider()
    .getModels()
    .map((m) => m.id)
}

interface Cache {
  key: string
  models: ReturnType<typeof createModels>
}

let cache: Cache | null = null

function cacheKey(cfg: LlmConfig): string {
  return [cfg.baseUrl, cfg.extractionModel, cfg.aggregationModel].join('|')
}

function getModelsFor(cfg: LlmConfig) {
  const key = cacheKey(cfg)
  if (cache?.key === key) return cache.models

  const models = createModels({ credentials: new IndexedDbCredentialStore() })
  models.setProvider(
    buildProvider({
      baseUrl: cfg.baseUrl,
      models: [cfg.extractionModel, cfg.aggregationModel],
    }),
  )
  cache = { key, models }
  return models
}

/** 取某个用途对应的模型对象。 */
export function resolveModel(role: ModelRole, cfg: LlmConfig) {
  const models = getModelsFor(cfg)
  const id = role === 'extraction' ? cfg.extractionModel : cfg.aggregationModel
  const model = models.getModel('deepseek', id)
  if (!model) {
    throw new Error(`模型未注册：${id}（检查设置里的模型名，或点「拉取模型」看看有哪些）`)
  }
  return model
}

/** 取 provider 实例（调用时用）。 */
export function getModelsForConfig(cfg: LlmConfig) {
  return getModelsFor(cfg)
}

/** 仅用于测试：重置缓存。 */
export function resetModelsForTest(): void {
  cache = null
}
