/**
 * 设置层的对外接口。
 *
 * 为什么要有这一层（ADR-012）：`features/` 不允许直接 import `core/llm`，
 * 所以设置界面通过这里读写配置 —— core 内部可以去碰 llm / db，对外只暴露这几个函数。
 */
import { getSettingsDb } from '@/core/db/settings.ts'
import { clearApiKey, hasCredential, setApiKey } from '@/core/llm/credentials.ts'
import { MODEL_CONFIG } from '@/core/llm/models.ts'

export const CONCURRENCY_KEY = 'compile.concurrency'
export const DEFAULT_CONCURRENCY = 3

// ── API Key（ADR-005：明文存 IndexedDB + 四条纪律）──

/** UI 只能问"配没配"，**拿不到 key 本身**（ADR-005 第 3 条纪律）。 */
export async function isApiKeyConfigured(): Promise<boolean> {
  return hasCredential(MODEL_CONFIG.provider)
}

export async function saveApiKey(key: string): Promise<void> {
  await setApiKey(MODEL_CONFIG.provider, key.trim())
}

export async function removeApiKey(): Promise<void> {
  await clearApiKey(MODEL_CONFIG.provider)
}

/** 只返回尾 4 位用于显示，其余打码。 */
export async function getApiKeyHint(): Promise<string | null> {
  const db = getSettingsDb()
  const row = await db.credentials.get(MODEL_CONFIG.provider)
  const key = (row?.credential as { key?: string } | undefined)?.key
  if (!key) return null
  return key.length <= 4 ? '••••' : `••••••••${key.slice(-4)}`
}

// ── 通用键值设置 ──

export async function getAppSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getSettingsDb().appSettings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  await getSettingsDb().appSettings.put({ key, value, updatedAt: new Date().toISOString() })
}

// ── 并发数 ──

export async function getConcurrency(): Promise<number> {
  return getAppSetting<number>(CONCURRENCY_KEY, DEFAULT_CONCURRENCY)
}

export async function setConcurrency(n: number): Promise<void> {
  const clamped = Math.max(1, Math.min(16, Math.round(n)))
  await setAppSetting(CONCURRENCY_KEY, clamped)
}

// ── 当前模型配置（只读展示） ──

export function getModelConfig() {
  return MODEL_CONFIG
}
