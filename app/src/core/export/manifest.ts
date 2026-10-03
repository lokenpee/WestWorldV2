/**
 * 备份包的清单（ADR-013）。
 *
 * `.wwv2` 本质是一个 zip：
 *   manifest.json          ← 版本、书籍信息、内容清单、校验和
 *   data/*.json            ← 结构化数据分文件
 *   chapters/0001.txt      ← 原文按章分片（不是一个大文件）
 */
export const BACKUP_FORMAT = 'westworld-v2'
export const BACKUP_FORMAT_VERSION = 1

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  appVersion: string
  exportedAt: string
  book: {
    id: string
    title: string
    author?: string
    chapterCount: number
  }
  /** 包含哪些数据 */
  contents: string[]
  /** 明确排除的东西（写在清单里，用户能看到） */
  excludes: string[]
  /** 文件相对路径 → `sha256:<hex>` */
  checksums: Record<string, string>
}

/** 用 Web Crypto 算 SHA-256（浏览器与 Node 18+ 都有）。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function checksumOf(bytes: Uint8Array): Promise<string> {
  return `sha256:${await sha256Hex(bytes)}`
}

/** 章节标识 → 安全的文件名（101.1 → 0101_1） */
export function chapterFileName(chapterIndex: string): string {
  const [major, minor] = chapterIndex.split('.')
  const padded = String(major).padStart(4, '0')
  return minor === undefined ? `${padded}.txt` : `${padded}_${minor}.txt`
}

/** 文件名 → 章节标识（反向，导入时用） */
export function parseChapterFileName(fileName: string): string | null {
  const m = /^(\d+)(?:_(\d+))?\.txt$/.exec(fileName)
  if (!m) return null
  return m[2] === undefined ? String(Number(m[1])) : `${Number(m[1])}.${m[2]}`
}
