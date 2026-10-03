import type { TSchema } from '@sinclair/typebox'
import { afterEach, describe, expect, it } from 'vitest'
import { CanonDatabase } from '../src/core/db/canon.ts'
import { CANON_STORES, type CanonStoreName } from '../src/core/db/stores.ts'
import {
  BookSchema,
  ChapterSchema,
  ChapterTextSchema,
  CharacterSchema,
  CompileProgressSchema,
  EventLineSchema,
  StoredCharacterSnapshotSchema,
  StoredLocationSchema,
  StoredNodeSchema,
} from '../src/core/schema/index.ts'

// ── 每个 store 对应的 TypeBox schema（漂移测试用）──
const SCHEMA_BY_STORE: Record<CanonStoreName, TSchema> = {
  books: BookSchema,
  chapters: ChapterSchema,
  chapterTexts: ChapterTextSchema,
  characterSnapshots: StoredCharacterSnapshotSchema,
  characters: CharacterSchema,
  locations: StoredLocationSchema,
  nodes: StoredNodeSchema,
  eventLines: EventLineSchema,
  compileProgress: CompileProgressSchema,
}

/**
 * 从 Dexie 的索引声明里提取字段名。
 * `'id, bookId, [bookId+chapterIndex]'` → `['id','bookId','bookId','chapterIndex']`
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

  it('能建表并写入/读回一本书', async () => {
    db = new CanonDatabase(name)
    await db.books.add({
      id: 'bk_001',
      title: '测试小说',
      createdAt: new Date().toISOString(),
    })
    const got = await db.books.get('bk_001')
    expect(got?.title).toBe('测试小说')
  })

  it('复合主键（bookId + chapterIndex）工作', async () => {
    db = new CanonDatabase(name)
    await db.chapters.bulkAdd([
      { bookId: 'bk_001', chapterIndex: '1', chapterName: '第一章', charCount: 100, order: 0 },
      { bookId: 'bk_001', chapterIndex: '2', chapterName: '第二章', charCount: 200, order: 1 },
      { bookId: 'bk_002', chapterIndex: '1', chapterName: '另一本书的第一章', charCount: 50, order: 0 },
    ])
    expect((await db.chapters.where('[bookId+chapterIndex]').equals(['bk_001', '2']).first())?.chapterName).toBe('第二章')
    expect(await db.chapters.where('bookId').equals('bk_001').count()).toBe(2)
    expect(await db.chapters.where('bookId').equals('bk_002').count()).toBe(1)
  })

  it('章节正文与元信息分开存', async () => {
    db = new CanonDatabase(name)
    await db.chapterTexts.add({ bookId: 'bk_001', chapterIndex: '1', text: '正文内容' })
    const text = await db.chapterTexts.where('[bookId+chapterIndex]').equals(['bk_001', '1']).first()
    expect(text?.text).toBe('正文内容')
  })

  it('能写入/读回人物快照与事件节点', async () => {
    db = new CanonDatabase(name)
    await db.characterSnapshots.add({
      id: 'C037-P01',
      bookId: 'bk_001',
      chapterIndex: '37',
      chapterName: '第三十七回',
      name: '贾琏',
      confidence: 0.9,
    })
    await db.nodes.add({
      id: 'C037-N01',
      bookId: 'bk_001',
      chapterIndex: '37',
      chapterName: '第三十七回',
      order: 0,
      name: '贾琏的资金来源异常',
      summary: '手头忽然宽裕。',
      actors: ['贾琏'],
      quote: '……',
      confidence: 0.8,
    })
    expect((await db.characterSnapshots.get('C037-P01'))?.name).toBe('贾琏')
    expect(await db.nodes.where('[bookId+chapterIndex]').equals(['bk_001', '37']).count()).toBe(1)
  })

  it('编译进度可按 (bookId + stage) 读写（断点续跑的依据）', async () => {
    db = new CanonDatabase(name)
    await db.compileProgress.put({
      bookId: 'bk_001',
      stage: 'P1',
      status: 'running',
      totalChapters: 1200,
      completedChapters: ['1', '2', '3'],
      failedChapters: [],
      updatedAt: new Date().toISOString(),
    })
    const p = await db.compileProgress.get(['bk_001', 'P1'])
    expect(p?.completedChapters).toEqual(['1', '2', '3'])
    expect(p?.status).toBe('running')
  })

  it('重开数据库后数据仍在（持久化）', async () => {
    db = new CanonDatabase(name)
    await db.books.add({ id: 'bk_009', title: '持久化测试', createdAt: new Date().toISOString() })
    db.close()

    db = new CanonDatabase(name)
    expect((await db.books.get('bk_009'))?.title).toBe('持久化测试')
  })
})


