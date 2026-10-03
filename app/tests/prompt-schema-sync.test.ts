import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderAll } from '../scripts/render-prompt-schema.ts'

const ROOT = join(import.meta.dirname, '..')
const PROMPTS_DIR = join(ROOT, 'src', 'core', 'prompts')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (e.endsWith('.md')) out.push(full)
  }
  return out
}

describe('提示词与 TypeBox schema 的一致性（ADR-011）', () => {
  it('生成区与 schema 一致（check 模式下没有文件需要重新生成）', () => {
    const report = renderAll({ check: true })
    expect(report.issues).toEqual([])
    expect(report.changedFiles, `这些文件需要重新生成：${report.changedFiles.join(', ')}`).toEqual([])
  })

  it('检查是幂等的（连续两次结果相同）', () => {
    const a = renderAll({ check: true })
    const b = renderAll({ check: true })
    expect(a.changedFiles).toEqual(b.changedFiles)
    expect(a.markerCount).toBe(b.markerCount)
  })

  it('每个生成区都引用了已注册的 schema 名', () => {
    const known = new Set([
      'AliasGroupsSchema',
      'LinkEventLinesResultSchema',
      'CharacterSnapshotSchema',
      'LocationSchema',
      'NodeSchema',
      'WorldAssetsExtractionSchema',
      'NarrativeAssetsExtractionSchema',
    ])
    const markers: string[] = []
    for (const f of walk(PROMPTS_DIR)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/AUTO-GENERATED:START\s+source=(\w+)/g)) {
        if (m[1]) markers.push(m[1])
      }
    }
    expect(markers.length).toBeGreaterThan(0)
    expect(markers.filter((n) => !known.has(n))).toEqual([])
  })

  it('两个 P1 提示词都含生成区，且带「勿手改」提示', () => {
    const files = walk(PROMPTS_DIR)
    const p1a = files.find((f) => f.endsWith('01-extract-world-assets.md'))!
    const p1b = files.find((f) => f.endsWith('02-extract-narrative-assets.md'))!
    expect(readFileSync(p1a, 'utf8')).toContain('AUTO-GENERATED:START')
    expect(readFileSync(p1b, 'utf8')).toContain('AUTO-GENERATED:START')
    expect(readFileSync(p1a, 'utf8')).toContain('勿手改')
  })
})



describe('提示词必须是「调工具」而不是「吐 JSON」', () => {
  it('⭐ 每个有生成区的提示词都必须提到 submit_result', () => {
    const offenders: string[] = []
    for (const f of walk(PROMPTS_DIR)) {
      const src = readFileSync(f, 'utf8')
      if (!src.includes('AUTO-GENERATED:START')) continue
      if (!src.includes('submit_result')) offenders.push(f.split(/[\\/]/).pop()!)
    }
    expect(
      offenders,
      `这些提示词没告诉模型要调用 submit_result 工具（会导致模型吐 JSON 文本、白花一轮钱）：${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('不再出现「输出严格 JSON」这类会误导模型的措辞', () => {
    const offenders: string[] = []
    for (const f of walk(PROMPTS_DIR)) {
      const src = readFileSync(f, 'utf8')
      if (/严格\s*JSON/.test(src)) offenders.push(f.split(/[\\/]/).pop()!)
    }
    expect(offenders).toEqual([])
  })
})
