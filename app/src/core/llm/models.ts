import { createModels } from '@earendil-works/pi-ai/models'
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'
import { IndexedDbCredentialStore } from './credentials.ts'

/**
 * 模型配置。
 *
 * ADR-004：模型名、base URL、Key 全部走配置，**不硬编码在调用点**。
 * 只 import 用到的 provider 子路径 —— 绝不 import `providers/all`
 * （那会把所有供应商的 SDK 打进包；实测单 provider 是 312 KB 的懒加载 chunk）。
 */
export const MODEL_CONFIG = {
  provider: 'deepseek',
  /** 按用途分配模型：提取量大用便宜的，归并需要推理用强的。 */
  models: {
    extraction: 'deepseek-flash',
    aggregation: 'deepseek-v4-pro',
  },
} as const

export type ModelRole = keyof typeof MODEL_CONFIG.models

let instance: ReturnType<typeof createModels> | null = null

/** 取 Models 单例（注入 IndexedDB 版凭据存储）。 */
export function getModels() {
  if (instance) return instance
  const models = createModels({ credentials: new IndexedDbCredentialStore() })
  if (MODEL_CONFIG.provider === 'deepseek') {
    models.setProvider(deepseekProvider())
  }
  instance = models
  return models
}

/** 仅用于测试：重置单例。 */
export function resetModelsForTest(): void {
  instance = null
}

/** 取某个用途对应的模型对象。 */
export function resolveModel(role: ModelRole) {
  const models = getModels()
  const id = MODEL_CONFIG.models[role]
  const model = models.getModel(MODEL_CONFIG.provider, id)
  if (!model) {
    throw new Error(`模型不存在：${MODEL_CONFIG.provider}/${id}（检查 MODEL_CONFIG）`)
  }
  return model
}

/** 列出当前 provider 下可用的模型 id（设置界面用）。 */
export function listModelIds(): string[] {
  return getModels()
    .getModels(MODEL_CONFIG.provider)
    .map((m) => m.id)
}
