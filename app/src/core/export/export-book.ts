/**
 * 导出一本书为 `.wwv2` 备份包（ADR-013）。
 *
 * 产出的是**字节**，不是文件 —— 下载（需要 DOM）由 features/ 负责（ADR-012）。
 *
 * 明确不导出：API Key（在设置库，结构上带不出来）、事件日志（体积大且含正文）。
 */
import { zipSync, strToU8 } from 'fflate'
import { getCanonDb } from '@/core/db/canon.ts'
import { getBook } from '@/core/db/repo.ts'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  chapterFileName,
  checksumOf,
  type BackupManifest,
} from './manifest.ts'

export interface ExportResult {
  fileName: string
  bytes: Uint8Array
  manifest: BackupManifest
}

export async function exportBook(bookId: string): Promise<ExportResult> {
  const db = getCanonDb(bookId)
  const book = await getBook(bookId)
  if (!book) throw new Error(`书籍不存在：${bookId}`)

  const [
    chapters,
    texts,
    snapshots,
    locationSnapshots,
    characters,
    locations,
    nodes,
    eventLines,
    progress,
  ] = await Promise.all([
    db.chapters.toArray(),
    db.chapterTexts.toArray(),
    db.characterSnapshots.toArray(),
    db.locationSnapshots.toArray(),
    db.characters.toArray(),
    db.locations.toArray(),
    db.nodes.toArray(),
    db.eventLines.toArray(),
    db.compileProgress.toArray(),
  ])

  const files: Record<string, Uint8Array> = {}

  // 结构化数据分文件（而不是一个大 JSON）—— 可读、可单独取出
  const dataFiles: Array<[string, unknown]> = [
    ['data/book.json', book],
    ['data/chapters.json', chapters],
    ['data/characterSnapshots.json', snapshots],
    ['data/locationSnapshots.json', locationSnapshots],
    ['data/characters.json', characters],
    ['data/locations.json', locations],
    ['data/nodes.json', nodes],
    ['data/eventLines.json', eventLines],
    ['data/compileProgress.json', progress],
  ]
  for (const [path, value] of dataFiles) {
    files[path] = strToU8(JSON.stringify(value, null, 2))
  }

  // 原文按章分片
  for (const t of texts) {
    files[`chapters/${chapterFileName(t.chapterIndex)}`] = strToU8(t.text)
  }

  // 算校验和
  const checksums: Record<string, string> = {}
  for (const [path, bytes] of Object.entries(files)) {
    checksums[path] = await checksumOf(bytes)
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    book: {
      id: book.id,
      title: book.title,
      ...(book.author ? { author: book.author } : {}),
      chapterCount: chapters.length,
    },
    contents: [
      'book',
      'chapters',
      'characterSnapshots',
      'locationSnapshots',
      'characters',
      'locations',
      'nodes',
      'eventLines',
      'compileProgress',
    ],
    excludes: ['apiKey', 'eventLog'],
    checksums,
  }

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))

  const bytes = zipSync(files, { level: 6 })
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
  const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

  return { fileName: `${safeTitle}-${stamp}.wwv2`, bytes, manifest }
}