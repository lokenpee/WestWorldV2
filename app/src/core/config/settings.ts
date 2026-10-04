/**
 * 设置层的对外接口。
 *
 * 为什么要有这一层（ADR-012）：`features/` 不允许直接 import `core/llm`，
 * 所以设置界面通过这里读写配置 —— core 内部可以去碰 llm / db，对外只暴露函数。
 */
import { getSettingsDb } from '@/core/db/settings.ts'
import { clearApiKey, hasCredential, setApiKey } from '@/core/llm/credentials.ts'
import { listCatalogModels } from '@/core/llm/models.ts'
import { fetchModelList, quickTestModel, type QuickTestResult } from '@/core/llm/probe.ts'
import { DEFAULT_LLM_CONFIG, type LlmConfig, type ModelRole } from '@/core/llm/models.ts'

export const PROVIDER_ID = 'deepseek'
export const CONCURRENCY_KEY = 'compile.concurrency'
export const LLM_CONFIG_KEY = 'llm.config'
export const DEFAULT_CONCURRENCY = 3

// ── API Key（ADR-005：明文存 IndexedDB + 四条纪律）──

/** UI 只能问"配没配"，**拿不到 key 本身**（ADR-005 第 3 条纪律）。 */
export async function isApiKeyConfigured(): Promise<boolean> {
  return hasCredential(PROVIDER_ID)
}

export async function saveApiKey(key: string): Promise<void> {
  await setApiKey(PROVIDER_ID, key.trim())
}

export async function removeApiKey(): Promise<void> {
  await clearApiKey(PROVIDER_ID)
}

/** 只返回尾 4 位用于显示，其余打码。 */
export async function getApiKeyHint(): Promise<string | null> {
  const row = await getSettingsDb().credentials.get(PROVIDER_ID)
  const key = (row?.credential as { key?: string } | undefined)?.key
  if (!key) return null
  return key.length <= 4 ? '••••' : `••••••••${key.slice(-4)}`
}

/** 探测与测试要用到明文 Key —— 只在 core 内部用，不给 UI 暴露。 */
export async function readApiKeyForProbe(): Promise<string | null> {
  const row = await getSettingsDb().credentials.get(PROVIDER_ID)
  return (row?.credential as { key?: string } | undefined)?.key ?? null
}

// ── 通用键值设置 ──

export async function getAppSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getSettingsDb().appSettings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  await getSettingsDb().appSettings.put({ key, value, updatedAt: new Date().toISOString() })
}

// ── 模型配置（可改 baseUrl / 模型名）──

export async function getLlmConfig(): Promise<LlmConfig> {
  const saved = await getAppSetting<Partial<LlmConfig>>(LLM_CONFIG_KEY, {})
  return { ...DEFAULT_LLM_CONFIG, ...saved }
}

export async function setLlmConfig(patch: Partial<LlmConfig>): Promise<void> {
  const current = await getLlmConfig()
  await setAppSetting(LLM_CONFIG_KEY, { ...current, ...patch })
}

/** 某个角色当前用的模型名（设置界面显示用）。 */
export async function getModelForRole(role: ModelRole): Promise<string> {
  const cfg = await getLlmConfig()
  return role === 'extraction' ? cfg.extractionModel : cfg.aggregationModel
}

// ── 并发数 ──

export async function getConcurrency(): Promise<number> {
  return getAppSetting<number>(CONCURRENCY_KEY, DEFAULT_CONCURRENCY)
}

export async function setConcurrency(n: number): Promise<void> {
  const clamped = Math.max(1, Math.min(16, Math.round(n)))
  await setAppSetting(CONCURRENCY_KEY, clamped)
}

// ── 给设置界面用的探测入口 ──
// UI 不碰 Key —— 这里内部读配置与凭据，只把结果返回给界面。

/** DeepSeek 官方目录里的模型名（离线，不需要网络）。 */
export function getCatalogModels(): string[] {
  return listCatalogModels()
}

/** 用当前配置去拉取可用模型列表（顺便验证 Key）。 */
export async function probeFetchModels(signal?: AbortSignal): Promise<string[]> {
  const cfg = await getLlmConfig()
  const key = await readApiKeyForProbe()
  if (!key) throw new Error('还没有配置 API Key')
  return fetchModelList({ baseUrl: cfg.baseUrl, apiKey: key }, signal)
}

/** 用当前配置发一个最小请求，验证「地址 + Key + 模型名」能不能通。 */
export async function probeQuickTest(
  role: ModelRole = 'extraction',
  signal?: AbortSignal,
): Promise<QuickTestResult> {
  const cfg = await getLlmConfig()
  const key = await readApiKeyForProbe()
  if (!key) throw new Error('还没有配置 API Key')
  const model = role === 'extraction' ? cfg.extractionModel : cfg.aggregationModel
  return quickTestModel({ baseUrl: cfg.baseUrl, apiKey: key, model }, signal)
}
