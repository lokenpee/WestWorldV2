import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import { getSettingsDb } from '@/core/db/settings.ts'

/**
 * pi-ai 的 CredentialStore 的 IndexedDB 实现（ADR-005）。
 *
 * 四条纪律（见 ADR-005，实现里逐条对应）：
 *   1. 不导出 —— 凭据在**独立的 settings 库**里，导出只读 Canon 库，结构上就带不出去
 *   2. 不打日志 —— 这个文件里没有任何 console / 日志调用
 *   3. UI 打码 —— 由设置界面负责（只暴露"是否已配置"，不暴露 key）
 *   4. 明确告知 —— 由设置界面负责
 *
 * 另外：**不提供任何把 key 读出来给 UI 的方法**。UI 只能问 `hasCredential()`。
 */
export class IndexedDbCredentialStore implements CredentialStore {
  async read(providerId: string): Promise<Credential | undefined> {
    const row = await getSettingsDb().credentials.get(providerId)
    return row?.credential as Credential | undefined
  }

  /** 只返回非敏感元数据（providerId + type），绝不解析 key。 */
  async list(): Promise<readonly CredentialInfo[]> {
    const rows = await getSettingsDb().credentials.toArray()
    return rows
      .map((r) => {
        const c = r.credential as { type?: string } | undefined
        const type = c?.type
        if (type !== 'api_key' && type !== 'oauth') return null
        return { providerId: r.providerId, type } satisfies CredentialInfo
      })
      .filter((x): x is CredentialInfo => x !== null)
  }

  /**
   * 唯一的写路径。pi-ai 要求串行化的 read-modify-write
   * （OAuth 刷新要靠这个防止并发重复刷新）。
   *
   * 用 Dexie 事务实现读改写，保证同一 provider 的并发 modify 串行。
   */
  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const db = getSettingsDb()
    return db.transaction('rw', db.credentials, async () => {
      const row = await db.credentials.get(providerId)
      const current = row?.credential as Credential | undefined
      const next = await fn(current)
      if (next === undefined) {
        await db.credentials.delete(providerId)
      } else {
        await db.credentials.put({ providerId, credential: next })
      }
      return next
    })
  }

  async delete(providerId: string): Promise<void> {
    await getSettingsDb().credentials.delete(providerId)
  }
}

/** UI 用：只回答"配没配"，不返回 key 本身。 */
export async function hasCredential(providerId: string): Promise<boolean> {
  const row = await getSettingsDb().credentials.get(providerId)
  const c = row?.credential as { key?: string } | undefined
  return Boolean(c?.key)
}

/** 设置界面用：写入 API Key。 */
export async function setApiKey(providerId: string, key: string): Promise<void> {
  await new IndexedDbCredentialStore().modify(providerId, async () => ({
    type: 'api_key' as const,
    key,
  }))
}

/** 设置界面用：清除 API Key。 */
export async function clearApiKey(providerId: string): Promise<void> {
  await new IndexedDbCredentialStore().delete(providerId)
}
