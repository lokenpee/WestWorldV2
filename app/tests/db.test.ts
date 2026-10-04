import type { TSchema } from '@sinclair/typebox'
import { afterEach, describe, expect, it } from 'vitest'
import { CanonDatabase, getCanonDb, resetCanonDbForTest } from '../src/core/db/canon.ts'
import { getSettingsDb, resetSettingsDbForTest } from '../src/core/db/settings.ts'
import { CANON_STORES, type CanonStoreName } from '../src/core/db/stores.ts'
import {
  ChapterSchema,
  ChapterTextSchema,
  CharacterSchema,
  CompileProgressSchema,
  EventLineSchema,
  StoredCharacterSnapshotSchema,
  StoredLocationSchema,
  StoredLocationSnapshotSchema,
  StoredNodeSchema,
} from '../src/core/schema/index.ts'

// ── 每个 store 对应的 TypeBox schema（漂移测试用）──
const SCHEMA_BY_STORE: Record<CanonStoreName, TSchema> = {
  chapters: ChapterSchema,
  chapterTexts: ChapterTextSchema,
  characterSnapshots: StoredCharacterSnapshotSchema,
  locationSnapshots: StoredLocationSnapshotSchema,
  characters: CharacterSchema,
  locations: StoredLocationSchema,
  nodes: StoredNodeSchema,
  eventLines: EventLineSchema,
  compileProgress: CompileProgressSchema,
}

/**
 * 从 Dexie 的索引声明里提取字段名。
 * `'id, chapterIndex, [a+b]'` → `['id','chapterIndex','a','b']`
 */
function declaredFields(storeDecl: string): string[] {
  return storeDecl
    .split(',')
    .map((s) => s.trim())
    .map((s) => s.replace(/^&/, '').replace(/^\*/, '').replace(/^\+\+/, ''))
    .flatMap((s) => s.replace(/^\[/, '').replace(/\]$/, '').split('+'))
    .map((s) => s.trim())
    .filter(Boolean)
}

function schemaPropertyNames(schema: TSchema): string[] {
  const props = (schema as { properties?: Record<string, unknown> }).properties
  return props ? Object.keys(props) : []
}

afterEach(async () => {
  await resetCanonDbForTest()
  await resetSettingsDbForTest()
})

// ── 漂移测试 ──
describe('Canon 库：TypeBox 与 Dexie 的字段漂移', () => {
  for (const [store, decl] of Object.entries(CANON_STORES)) {
    it(`${store}：索引里用到的字段都存在于对应 schema`, () => {
      const schema = SCHEMA_BY_STORE[store as CanonStoreName]
      expect(schema, `store "${store}" 缺少对应的 TypeBox schema`).toBeTruthy()

      const known = new Set(schemaPropertyNames(schema))
      const used = [...new Set(declaredFields(decl))]
      const missing = used.filter((f) => !known.has(f))
      expect(missing, `${store} 的索引引用了 schema 里不存在的字段: ${missing.join(', ')}`).toEqual([])
    })
  }

  it('canon 库里没有 books 表（书架搬到设置库了）', () => {
    expect(Object.keys(CANON_STORES)).not.toContain('books')
  })
})

// ── 真实读写（fake-indexeddb）──
describe('Canon 库：读写', () => {
  let db: CanonDatabase | null = null
  const name = `test_canon_${Math.random().toString(36).slice(2)}`

  afterEach(async () => {
    if (db) {
      db.close()
      await db.delete()
      db = null
    }
  })

  it('能建表并写入/读回章节', async () => {
    db = new CanonDatabase(name)
    await db.chapters.add({ bookId: 'bk_001', chapterIndex: '1', chapterName: '第一章', charCount: 100, order: 0 })
    const got = await db.chapters.get('1')
    expect(got?.chapterName).toBe('第一章')
  })

  it('章节正文与元信息分开存', async () => {
    db = new CanonDatabase(name)
    await db.chapterTexts.add({ bookId: 'bk_001', chapterIndex: '1', text: '正文内容' })
    expect((await db.chapterTexts.get('1'))?.text).toBe('正文内容')
  })

  it('能写入/读回人物快照、地点快照与事件节点', async () => {
    db = new CanonDatabase(name)
    await db.characterSnapshots.add({
      id: 'C37-P001', bookId: 'bk_001', chapterIndex: '37', chapterName: '第三十七回',
      name: '贾琏', confidence: 0.9,
    })
    await db.locationSnapshots.add({
      id: 'C37-L001', bookId: 'bk_001', chapterIndex: '37', chapterName: '第三十七回',
      name: '荣国府', confidence: 0.9,
    })
    await db.nodes.add({
      id: 'C37-N001', bookId: 'bk_001', chapterIndex: '37', chapterName: '第三十七回', order: 0,
      name: '贾琏的资金来源异常', summary: '手头忽然宽裕。', actors: ['贾琏'], quote: '……', confidence: 0.8,
    })
    expect((await db.characterSnapshots.get('C37-P001'))?.name).toBe('贾琏')
    expect((await db.locationSnapshots.get('C37-L001'))?.name).toBe('荣国府')
    expect(await db.nodes.count()).toBe(1)
  })

  it('编译进度按 stage 读写（断点续跑的依据）', async () => {
    db = new CanonDatabase(name)
    await db.compileProgress.put({
      bookId: 'bk_001', stage: 'P1', status: 'running', totalChapters: 1200,
      completedChapters: ['1', '2', '3'], failedChapters: [], updatedAt: new Date().toISOString(),
    })
    const p = await db.compileProgress.get('P1')
    expect(p?.completedChapters).toEqual(['1', '2', '3'])
    expect(p?.status).toBe('running')
  })

  it('重开数据库后数据仍在（持久化）', async () => {
    db = new CanonDatabase(name)
    await db.chapters.add({ bookId: 'bk_009', chapterIndex: '1', chapterName: '持久化测试', charCount: 1, order: 0 })
    db.close()

    db = new CanonDatabase(name)
    expect((await db.chapters.get('1'))?.chapterName).toBe('持久化测试')
  })
})

describe('⭐ 每本书一个库：两本书互不覆盖（回归测试）', () => {
  it('两本书都有「第 1 章」快照，不会串味', async () => {
    const a = getCanonDb('bk_a')
    const b = getCanonDb('bk_b')
    await a.characterSnapshots.put({
      id: 'C1-P001', bookId: 'bk_a', chapterIndex: '1', chapterName: '第一章', name: '贾宝玉', confidence: 0.9,
    })
    await b.characterSnapshots.put({
      id: 'C1-P001', bookId: 'bk_b', chapterIndex: '1', chapterName: '第一章', name: '林冲', confidence: 0.9,
    })

    expect((await a.characterSnapshots.get('C1-P001'))?.name).toBe('贾宝玉')
    expect((await b.characterSnapshots.get('C1-P001'))?.name).toBe('林冲')
    expect(a.name).not.toBe(b.name)
  })
})

describe('设置库：书架', () => {
  it('books 存在设置库里（跨书全局信息）', async () => {
    await getSettingsDb().books.put({ id: 'bk_1', title: '测试', createdAt: '2026-10-04T00:00:00Z' })
    expect((await getSettingsDb().books.get('bk_1'))?.title).toBe('测试')
  })
})