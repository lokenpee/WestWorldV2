import Dexie, { type Table } from 'dexie'

/**
 * 设置库 —— 与 Canon 库**物理分离**。
 *
 * 为什么单独一个库（ADR-005 + ADR-013）：
 *   - 凭据放在 Canon 库里，导出备份时就有"不小心把 API Key 导出去"的风险
 *   - 清空编译数据不应该把用户登出
 *   - 物理隔离后，"导出不含 Key" 是**结构上成立**的，不靠自觉
 */
export const SETTINGS_DB_NAME = 'westworld_settings'
export const SETTINGS_VERSION = 1

export const SETTINGS_STORES = {
  /** 凭据：一个 provider 一条（pi-ai 的 CredentialStore 语义） */
  credentials: 'providerId',
  /** 应用设置：键值对 */
  appSettings: 'key',
} as const

export interface StoredCredentialRow {
  providerId: string
  /** 直接存 pi-ai 的 Credential 对象（{ type: 'api_key', key } 或 oauth） */
  credential: unknown
}

export interface AppSettingRow {
  key: string
  value: unknown
  updatedAt: string
}

export class SettingsDatabase extends Dexie {
  credentials!: Table<StoredCredentialRow, string>
  appSettings!: Table<AppSettingRow, string>

  constructor(name = SETTINGS_DB_NAME) {
    super(name)
    this.version(SETTINGS_VERSION).stores({ ...SETTINGS_STORES })
  }
}

let instance: SettingsDatabase | null = null

export function getSettingsDb(): SettingsDatabase {
  instance ??= new SettingsDatabase()
  return instance
}

export async function resetSettingsDbForTest(): Promise<void> {
  if (instance) {
    instance.close()
    await instance.delete()
    instance = null
  }
}
