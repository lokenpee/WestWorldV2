/**
 * 把 TypeBox schema 渲染成提示词里的字段表（ADR-011）。
 *
 * 用法：
 *   pnpm render:prompts          写入
 *   pnpm render:prompts --check  只检查不写入（测试/CI 用，有差异就退出码 1）
 *
 * 提示词文件里的标记形态：
 *   <!-- AUTO-GENERATED:START source=CharacterSnapshotSchema -->
 *   ...（这里的内容由本脚本生成，手写会被覆盖）...
 *   <!-- AUTO-GENERATED:END -->
 *
 * 只替换标记**之间**的内容，标记之外一个字符都不动。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { TSchema } from '@sinclair/typebox'
import {
  CharacterSnapshotSchema,
  LocationSchema,
  NarrativeAssetsExtractionSchema,
  NodeSchema,
  WorldAssetsExtractionSchema,
} from '../src/core/schema/index.ts'

const PROMPTS_DIR = join(import.meta.dirname, '..', 'src', 'core', 'prompts')
const ROOT = join(import.meta.dirname, '..')

/** 提示词里可以引用的 schema（用名字引用，避免脆弱的路径解析）。 */
const SCHEMA_REGISTRY: Record<string, TSchema> = {
  CharacterSnapshotSchema,
  LocationSchema,
  NodeSchema,
  WorldAssetsExtractionSchema,
  NarrativeAssetsExtractionSchema,
}

const MARKER_RE =
  /<!--\s*AUTO-GENERATED:START\s+source=(\w+)\s*-->([\s\S]*?)<!--\s*AUTO-GENERATED:END\s*-->\n*/g

// ── 类型渲染 ──

function renderType(schema: TSchema): string {
  const s = schema as TSchema & {
    type?: string
    anyOf?: TSchema[]
    const?: unknown
    items?: TSchema
  }

  if (s.const !== undefined) {
    return typeof s.const === 'string' ? `"${s.const}"` : String(s.const)
  }
  if (s.anyOf?.length) {
    return s.anyOf.map(renderType).join(' \\| ')
  }
  switch (s.type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'integer':
      return 'integer'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return s.items ? `${renderType(s.items)}[]` : 'array'
    case 'object':
      return 'object'
    default:
      return s.type ?? 'unknown'
  }
}

/** 转义 markdown 表格里的竖线。 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

function descriptionOf(schema: TSchema): string {
  const d = (schema as { description?: string }).description
  return d ? escapeCell(d) : ''
}

interface Row {
  field: string
  type: string
  required: boolean
  description: string
}

/** 把 schema 的 properties 展平成表格行（嵌套对象展开一层，用点号连接）。 */
function collectRows(schema: TSchema, prefix = ''): Row[] {
  const s = schema as TSchema & {
    properties?: Record<string, TSchema>
    required?: string[]
  }
  if (!s.properties) return []

  const requiredSet = new Set(s.required ?? [])
  const rows: Row[] = []

  for (const [key, value] of Object.entries(s.properties)) {
    const fieldName = prefix ? `${prefix}.${key}` : key
    const v = value as TSchema & { properties?: Record<string, TSchema> }
    const isRequired = prefix ? false : requiredSet.has(key)

    // 嵌套对象：先列一行，再展开子字段（避免表格过深）
    if (v.type === 'object' && v.properties) {
      rows.push({
        field: fieldName,
        type: 'object',
        required: isRequired,
        description: descriptionOf(value),
      })
      rows.push(...collectRows(value, fieldName))
      continue
    }

    // 对象数组：同样展开一层，用 `field[].sub` 表示
    const items = (v as { items?: TSchema & { type?: string; properties?: Record<string, TSchema> } })
      .items
    if (v.type === 'array' && items?.type === 'object' && items.properties) {
      rows.push({
        field: fieldName,
        type: 'object[]',
        required: isRequired,
        description: descriptionOf(value),
      })
      rows.push(...collectRows(items, `${fieldName}[]`))
      continue
    }

    rows.push({
      field: fieldName,
      type: renderType(value),
      required: isRequired,
      description: descriptionOf(value),
    })
  }

  return rows
}

function renderMarkdownTable(schema: TSchema, sourceName: string): string {
  const rows = collectRows(schema)
  const header = `| 字段 | 类型 | 必填 | 说明 |\n|------|------|------|------|`
  const body = rows
    .map(
      (r) =>
        `| \`${r.field}\` | ${escapeCell(r.type)} | ${r.required ? '✅' : '⬜'} | ${r.description} |`,
    )
    .join('\n')
  return `<!-- 以下内容由 scripts/render-prompt-schema.ts 从 ${sourceName} 生成，勿手改 -->\n${header}\n${body}`
}

// ── 文件遍历与替换 ──

function walkMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkMarkdown(full))
    else if (entry.endsWith('.md')) out.push(full)
  }
  return out
}

export interface RenderIssue {
  file: string
  message: string
}

function renderFile(file: string): { next: string; issues: RenderIssue[] } {
  const original = readFileSync(file, 'utf8')
  const issues: RenderIssue[] = []
  const rel = relative(ROOT, file)

  const next = original.replace(MARKER_RE, (_full, sourceName: string, _inner: string) => {
    const schema = SCHEMA_REGISTRY[sourceName]
    if (!schema) {
      issues.push({ file: rel, message: `标记引用了未注册的 schema：${sourceName}` })
      return _full
    }
    const table = renderMarkdownTable(schema, sourceName)
    return `<!-- AUTO-GENERATED:START source=${sourceName} -->\n${table}\n<!-- AUTO-GENERATED:END -->\n\n`
  })

  return { next, issues }
}

export interface RenderReport {
  files: number
  markerCount: number
  changedFiles: string[]
  issues: RenderIssue[]
}

/**
 * 渲染（或检查）全部提示词的生成区。
 *
 * 导出成函数是为了让测试**在进程内调用** —— 比 spawn 一个子进程更快、更稳
 * （Windows 上 `pnpm` 是 .cmd，走子进程有各种坑）。
 */
export function renderAll(options: { check: boolean }): RenderReport {
  const files = walkMarkdown(PROMPTS_DIR)
  const changedFiles: string[] = []
  const issues: RenderIssue[] = []
  let markerCount = 0

  for (const file of files) {
    const original = readFileSync(file, 'utf8')
    markerCount += [...original.matchAll(MARKER_RE)].length

    const { next, issues: fileIssues } = renderFile(file)
    issues.push(...fileIssues)

    if (original !== next) {
      const rel = relative(ROOT, file)
      changedFiles.push(rel)
      if (!options.check) writeFileSync(file, next, 'utf8')
    }
  }

  return { files: files.length, markerCount, changedFiles, issues }
}

function main(): void {
  const check = process.argv.includes('--check')
  const report = renderAll({ check })

  for (const rel of report.changedFiles) {
    if (check) console.error(`✗ ${rel}：生成区与 schema 不一致（跑 pnpm render:prompts 修复）`)
    else console.log(`✎ ${rel}：已更新`)
  }
  for (const issue of report.issues) {
    console.error(`✗ ${issue.file}：${issue.message}`)
  }

  console.log(`\n扫描 ${report.files} 个提示词文件，共 ${report.markerCount} 个生成区`)

  if (check) {
    if (report.changedFiles.length > 0 || report.issues.length > 0) {
      console.error(
        `\n检查失败：${report.changedFiles.length} 个文件需要重新生成，${report.issues.length} 个问题`,
      )
      process.exit(1)
    }
    console.log('检查通过：生成区与 schema 一致')
    return
  }
  console.log(report.changedFiles.length === 0 ? '没有需要更新的内容' : `已更新 ${report.changedFiles.length} 个文件`)
}

// 只有被当作脚本直接运行时才执行 main（被测试 import 时不跑）
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  main()
}
