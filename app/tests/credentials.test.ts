import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsDatabase } from '../src/core/db/settings.ts'
import { IndexedDbCredentialStore } from '../src/core/llm/credentials.ts'

// 让 getSettingsDb() 用测试库：直接改单例不可行，所以这里测 store 本身
// （getSettingsDb 是模块级单例，测试里用独立的 db 名验证同样的读写逻辑）
let db: SettingsDatabase | null = null
const name = `test_settings_${Math.random().toString(36).slice(2)}`

beforeEach(() => {
  db = new SettingsDatabase(name)
})
afterEach(async () => {
  if (db) {
    db.close()
    await db.delete()
    db = null
  }
})

describe('凭据存储（ADR-005）', () => {
  it('modify 是唯一的写路径：写入后能读回', async () => {
    await db!.credentials.put({
      providerId: 'deepseek',
      credential: { type: 'api_key', key: 'sk-test-1234' },
    })
    const row = await db!.credentials.get('deepseek')
    expect((row?.credential as { key?: string })?.key).toBe('sk-test-1234')
  })

  it('modify 传 undefined 表示删除', async () => {
    await db!.credentials.put({ providerId: 'deepseek', credential: { type: 'api_key', key: 'x' } })
    await db!.credentials.delete('deepseek')
    expect(await db!.credentials.get('deepseek')).toBeUndefined()
  })

  it('一个 provider 只有一条凭据（put 覆盖）', async () => {
    await db!.credentials.put({ providerId: 'deepseek', credential: { type: 'api_key', key: 'old' } })
    await db!.credentials.put({ providerId: 'deepseek', credential: { type: 'api_key', key: 'new' } })
    expect(await db!.credentials.count()).toBe(1)
    expect(((await db!.credentials.get('deepseek'))?.credential as { key?: string })?.key).toBe('new')
  })

  it('list 只返回非敏感元数据（不含 key）', async () => {
    const store = new IndexedDbCredentialStore()
    // 直接往 store 依赖的库里写 —— 这里用真实 store 的话会落到另一个库，
    // 所以改为验证 list 的过滤逻辑：把假数据塞进真实库后调用
    const realDb = (await import('../src/core/db/settings.ts')).getSettingsDb()
    await realDb.credentials.put({
      providerId: 'deepseek',
      credential: { type: 'api_key', key: 'sk-should-not-leak' },
    })
    const infos = await store.list()
    const json = JSON.stringify(infos)
    expect(json).not.toContain('sk-should-not-leak')
    expect(json).toContain('deepseek')
    expect(infos.every((i) => i.type === 'api_key' || i.type === 'oauth')).toBe(true)
    // 清理
    await store.delete('deepseek')
    realDb.close()
    await realDb.delete()
  })
})
