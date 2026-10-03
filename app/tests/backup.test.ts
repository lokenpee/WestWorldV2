import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { getCanonDb, resetCanonDbForTest } from '../src/core/db/canon.ts'
import { exportBook } from '../src/core/export/export-book.ts'
import { importBackup, inspectBackup } from '../src/core/export/import-book.ts'
import { chapterFileName, parseChapterFileName } from '../src/core/export/manifest.ts'
import type { Book, Character, EventLine, StoredCharacterSnapshot, StoredLocation, StoredNode } from '../src/core/schema/index.ts'

afterEach(async () => {
  await resetCanonDbForTest()
})

const book: Book = { id: 'bk_1', title: '测试《书》', createdAt: '2026-10-04T00:00:00Z' }

async function seed() {
  const db = getCanonDb()
  await db.books.put(book)
  await db.chapters.bulkPut([
    { bookId: 'bk_1', chapterIndex: '1', chapterName: '第一章', charCount: 10, order: 0 },
    { bookId: 'bk_1', chapterIndex: '2', chapterName: '第二章', charCount: 20, order: 1 },
  ])
  await db.chapterTexts.bulkPut([
    { bookId: 'bk_1', chapterIndex: '1', text: '正文一' },
    { bookId: 'bk_1', chapterIndex: '2', text: '正文二' },
  ])
  await db.characterSnapshots.put({
    id: 'C1-P001', bookId: 'bk_1', chapterIndex: '1', chapterName: '第一章',
    name: '贾琏', confidence: 0.9,
  } satisfies StoredCharacterSnapshot)
  await db.characters.put({
    id: 'P001', bookId: 'bk_1', name: '贾琏', aliases: ['琏二爷'], roleWeight: 'NPC',
    relations: [], sourceSnapshotIds: ['C1-P001'], updatedAt: '',
  } satisfies Character)
  await db.locations.put({ id: 'L001', bookId: 'bk_1', chapterIndex: '1', name: '荣国府' } satisfies StoredLocation)
  await db.nodes.put({
    id: 'C1-N001', bookId: 'bk_1', chapterIndex: '1', chapterName: '第一章', order: 0,
    name: '资金异常', summary: 's', actors: ['贾琏'], quote: 'q', confidence: 0.9, createdBy: 'P1',
  } satisfies StoredNode)
  await db.eventLines.put({
    id: 'L01', bookId: 'bk_1', title: '走私案', nodeIds: ['C1-N001'], chapters: ['1'],
    cause: 'c', process: 'p', result: 'r', lineStatus: 'open', characterIds: ['P001'], updatedAt: '',
  } satisfies EventLine)
}

describe('备份包文件名映射', () => {
  it('章节标识 ↔ 文件名可互转（含切块）', () => {
    expect(chapterFileName('1')).toBe('0001.txt')
    expect(chapterFileName('101.1')).toBe('0101_1.txt')
    expect(parseChapterFileName('0001.txt')).toBe('1')
    expect(parseChapterFileName('0101_1.txt')).toBe('101.1')
    expect(parseChapterFileName('乱起名.txt')).toBeNull()
  })
})

describe('导出', () => {
  it('产出一个 zip，含 manifest 与分片数据', async () => {
    await seed()
    const r = await exportBook('bk_1')
    expect(r.fileName).toMatch(/\.wwv2$/)

    const files = unzipSync(r.bytes)
    expect(Object.keys(files)).toContain('manifest.json')
    expect(Object.keys(files)).toContain('data/characters.json')
    expect(Object.keys(files)).toContain('chapters/0001.txt')
  })

  it('manifest 里明确写出「不包含 API Key 与事件日志」', async () => {
    await seed()
    const { manifest } = await exportBook('bk_1')
    expect(manifest.excludes).toContain('apiKey')
    expect(manifest.excludes).toContain('eventLog')
  })

  it('⭐ 备份包里搜不到 API Key', async () => {
    await seed()
    const r = await exportBook('bk_1')
    const text = Buffer.from(r.bytes).toString('latin1')
    expect(text).not.toContain('sk-')
  })

  it('每个文件都有校验和', async () => {
    await seed()
    const { manifest } = await exportBook('bk_1')
    expect(Object.keys(manifest.checksums).length).toBeGreaterThan(3)
    expect(manifest.checksums['data/characters.json']).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('书不存在时明确报错', async () => {
    await expect(exportBook('不存在')).rejects.toThrow(/书籍不存在/)
  })
})

describe('导入', () => {
  it('往返：导出再导入，数据规模一致', async () => {
    await seed()
    const { bytes } = await exportBook('bk_1')

    const inspect = await inspectBackup(bytes)
    expect(inspect.ok, inspect.errors.join('; ')).toBe(true)
    expect(inspect.stats).toEqual({ chapters: 2, characters: 1, locations: 1, nodes: 1, eventLines: 1 })

    const result = await importBackup(bytes)
    expect(result.chapterCount).toBe(2)

    const db = getCanonDb()
    expect(await db.chapters.where('bookId').equals(result.bookId).count()).toBe(2)
    expect(await db.characters.where('bookId').equals(result.bookId).count()).toBe(1)
    expect(await db.nodes.where('bookId').equals(result.bookId).count()).toBe(1)
    expect(await db.eventLines.where('bookId').equals(result.bookId).count()).toBe(1)

    const text = await db.chapterTexts.get([result.bookId, '1'])
    expect(text?.text).toBe('正文一')
  })

  it('⭐ 导入是**新建**，不动原书', async () => {
    await seed()
    const { bytes } = await exportBook('bk_1')
    const result = await importBackup(bytes)

    expect(result.bookId).not.toBe('bk_1')
    const db = getCanonDb()
    expect(await db.books.get('bk_1')).toBeTruthy() // 原书还在
    expect((await db.books.get(result.bookId))?.title).toContain('导入')
  })

  it('文件损坏 → 校验失败，且**不写入任何数据**', async () => {
    await seed()
    const { bytes, manifest } = await exportBook('bk_1')
    const files = unzipSync(bytes)
    files['data/characters.json'] = strToU8('[{"tampered":true}]')
    const broken = zipSync(files)

    const inspect = await inspectBackup(broken)
    expect(inspect.ok).toBe(false)
    expect(inspect.errors.join(' ')).toContain('校验和不匹配')

    const before = await getCanonDb().books.count()
    await expect(importBackup(broken)).rejects.toThrow(/校验失败/)
    expect(await getCanonDb().books.count()).toBe(before)
    void manifest
  })

  it('不是 zip → 明确报错', async () => {
    const inspect = await inspectBackup(strToU8('这不是 zip'))
    expect(inspect.ok).toBe(false)
    expect(inspect.errors[0]).toContain('zip')
  })

  it('缺 manifest → 明确报错', async () => {
    const inspect = await inspectBackup(zipSync({ 'data/a.json': strToU8('{}') }))
    expect(inspect.ok).toBe(false)
    expect(inspect.errors[0]).toContain('manifest')
  })

  it('⭐ 来自更新版本的备份被拒绝（而不是导入坏数据）', async () => {
    await seed()
    const { bytes, manifest } = await exportBook('bk_1')
    const files = unzipSync(bytes)
    files['manifest.json'] = strToU8(JSON.stringify({ ...manifest, formatVersion: 99 }))
    const inspect = await inspectBackup(zipSync(files))
    expect(inspect.ok).toBe(false)
    expect(inspect.errors.join(' ')).toContain('请先升级应用')
  })
})
