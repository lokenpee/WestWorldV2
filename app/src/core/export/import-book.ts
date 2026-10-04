/**
 * 导入 `.wwv2` 备份包（ADR-013）。
 *
 * 两条硬规则：
 *   ① **先全部校验，再写库** —— 不要写了一半才发现文件坏了（会在库里留半本书）
 *   ② **默认新建一本书**，不覆盖现有的 —— 导入的典型场景是"恢复备份"
 *
 * 分库后：新书 = 设置库里一条书架记录 + 一个新的 `westworld_canon_{bookId}` 库。
 */
import { unzipSync, strFromU8 } from 'fflate'
import { getCanonDb } from '@/core/db/canon.ts'
import { createBook } from '@/core/db/repo.ts'
import type {
  Book,
  Chapter,
  ChapterText,
  Character,
  CompileProgress,
  EventLine,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredLocationSnapshot,
  StoredNode,
} from '@/core/schema/index.ts'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  checksumOf,
  parseChapterFileName,
  type BackupManifest,
} from './manifest.ts'

export interface InspectResult {
  ok: boolean
  manifest?: BackupManifest
  errors: string[]
  /** 校验通过时的内容统计（给用户看"这份备份里有什么"） */
  stats?: {
    chapters: number
    characters: number
    locations: number
    nodes: number
    eventLines: number
  }
}

/** 只读检查：是不是合法备份、版本能不能处理、文件有没有损坏。 */
export function inspectBackup(bytes: Uint8Array): Promise<InspectResult> {
  const errors: string[] = []
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    return Promise.resolve({ ok: false, errors: ['不是合法的 zip 文件'] })
  }

  const manifestBytes = files['manifest.json']
  if (!manifestBytes) {
    return Promise.resolve({ ok: false, errors: ['缺少 manifest.json，不是本应用的备份'] })
  }

  let manifest: BackupManifest
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest
  } catch {
    return Promise.resolve({ ok: false, errors: ['manifest.json 不是合法 JSON'] })
  }

  if (manifest.format !== BACKUP_FORMAT) {
    errors.push(`备份格式不匹配：期望 ${BACKUP_FORMAT}，实际 ${String(manifest.format)}`)
  }
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    errors.push(
      `这份备份由更新版本的应用创建（v${manifest.formatVersion}），当前只支持到 v${BACKUP_FORMAT_VERSION}。请先升级应用。`,
    )
  }

  // 逐文件校验 checksum
  const checks = Promise.all(
    Object.entries(manifest.checksums ?? {}).map(async ([path, expected]) => {
      const file = files[path]
      if (!file) return `${path} 缺失`
      const actual = await checksumOf(file)
      return actual === expected ? null : `${path} 校验和不匹配（文件可能损坏）`
    }),
  )

  return checks.then((results) => {
    for (const r of results) if (r) errors.push(r)

    let stats: InspectResult['stats']
    if (errors.length === 0) {
      const chapters = JSON.parse(strFromU8(files['data/chapters.json']!)) as Chapter[]
      const characters = JSON.parse(strFromU8(files['data/characters.json']!)) as Character[]
      const locations = JSON.parse(strFromU8(files['data/locations.json']!)) as StoredLocation[]
      const nodes = JSON.parse(strFromU8(files['data/nodes.json']!)) as StoredNode[]
      const eventLines = JSON.parse(strFromU8(files['data/eventLines.json']!)) as EventLine[]
      stats = {
        chapters: chapters.length,
        characters: characters.length,
        locations: locations.length,
        nodes: nodes.length,
        eventLines: eventLines.length,
      }
    }

    return { ok: errors.length === 0, manifest, errors, ...(stats ? { stats } : {}) }
  })
}

export interface ImportResult {
  bookId: string
  chapterCount: number
}

/** 真正导入。**新建一本书**，不改动现有数据。 */
export async function importBackup(bytes: Uint8Array): Promise<ImportResult> {
  const inspect = await inspectBackup(bytes)
  if (!inspect.ok || !inspect.manifest) {
    throw new Error(`备份校验失败：\n${inspect.errors.join('\n')}`)
  }

  const files = unzipSync(bytes)
  const manifest = inspect.manifest
  const newBookId = `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

  const readJson = <T>(path: string, fallback: T): T => {
    const file = files[path]
    if (!file) return fallback
    return JSON.parse(strFromU8(file)) as T
  }

  const book = readJson<Book | null>('data/book.json', null)
  const chapters = readJson<Chapter[]>('data/chapters.json', [])
  const snapshots = readJson<StoredCharacterSnapshot[]>('data/characterSnapshots.json', [])
  const locationSnapshots = readJson<StoredLocationSnapshot[]>('data/locationSnapshots.json', [])
  const characters = readJson<Character[]>('data/characters.json', [])
  const locations = readJson<StoredLocation[]>('data/locations.json', [])
  const nodes = readJson<StoredNode[]>('data/nodes.json', [])
  const eventLines = readJson<EventLine[]>('data/eventLines.json', [])
  const progress = readJson<CompileProgress[]>('data/compileProgress.json', [])

  // 全部换成本书的新 id —— 不改动任何已有数据
  const remap = <T extends { bookId: string }>(rows: T[]): T[] =>
    rows.map((r) => ({ ...r, bookId: newBookId }))

  const texts: ChapterText[] = []
  for (const chapter of chapters) {
    const fileName = Object.keys(manifest.checksums)
      .filter((k) => k.startsWith('chapters/'))
      .map((k) => k.replace('chapters/', ''))
      .find((name) => parseChapterFileName(name) === chapter.chapterIndex)
    const file = fileName ? files[`chapters/${fileName}`] : undefined
    if (file) texts.push({ bookId: newBookId, chapterIndex: chapter.chapterIndex, text: strFromU8(file) })
  }

  // 书架记录进设置库（跨书全局信息），正文与资产进新 Canon 库
  const originalTitle = book?.title ?? manifest.book.title
  await createBook({
    id: newBookId,
    title: `${originalTitle}（导入）`,
    ...(book?.author ? { author: book.author } : {}),
    ...(book?.sourceFileName ? { sourceFileName: book.sourceFileName } : {}),
  })

  const db = getCanonDb(newBookId)
  await db.transaction(
    'rw',
    [db.chapters, db.chapterTexts, db.characterSnapshots, db.locationSnapshots, db.characters, db.locations, db.nodes, db.eventLines, db.compileProgress],
    async () => {
      if (chapters.length) await db.chapters.bulkPut(remap(chapters))
      if (texts.length) await db.chapterTexts.bulkPut(texts)
      if (snapshots.length) await db.characterSnapshots.bulkPut(remap(snapshots))
      if (locationSnapshots.length) await db.locationSnapshots.bulkPut(remap(locationSnapshots))
      if (characters.length) await db.characters.bulkPut(remap(characters))
      if (locations.length) await db.locations.bulkPut(remap(locations))
      if (nodes.length) await db.nodes.bulkPut(remap(nodes))
      if (eventLines.length) await db.eventLines.bulkPut(remap(eventLines))
      if (progress.length) await db.compileProgress.bulkPut(remap(progress))
    },
  )

  return { bookId: newBookId, chapterCount: chapters.length }
}