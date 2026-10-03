import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
  it('render:prompts --check 通过（生成区与 schema 一致）', () => {
    // 有任何差异时脚本以退出码 1 结束
    expect(() =>
      execFileSync('pnpm', ['render:prompts', '--check'], {
        cwd: ROOT,
        stdio: 'pipe',
        shell: process.platform === 'win32',
      }),
    ).not.toThrow()
  })

  it('每个生成区都引用了已注册的 schema 名', () => {
    const known = new Set([
      'CharacterSnapshotSchema',
      'LocationSchema',
      'NodeSchema',
      'WorldAssetsExtractionSchema',
      'NarrativeAssetsExtractionSchema',
    ])
    const files = walk(PROMPTS_DIR)
    const markers: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/AUTO-GENERATED:START\s+source=(\w+)/g)) {
        if (m[1]) markers.push(m[1])
      }
    }
    expect(markers.length).toBeGreaterThan(0)
    const unknown = markers.filter((n) => !known.has(n))
    expect(unknown, `未注册的 schema：${unknown.join(', ')}`).toEqual([])
  })

  it('两个 P1 提示词都含生成区', () => {
    const files = walk(PROMPTS_DIR).map((f) => f.replace(/\\/g, '/'))
    const p1a = files.find((f) => f.endsWith('01-extract-world-assets.md'))
    const p1b = files.find((f) => f.endsWith('02-extract-narrative-assets.md'))
    expect(p1a && readFileSync(p1a, 'utf8')).toContain('AUTO-GENERATED:START')
    expect(p1b && readFileSync(p1b, 'utf8')).toContain('AUTO-GENERATED:START')
  })

  it('生成区内容带「勿手改」提示', () => {
    const file = walk(PROMPTS_DIR).find((f) => f.endsWith('01-extract-world-assets.md'))
    const src = readFileSync(file!, 'utf8')
    expect(src).toContain('勿手改')
  })
})
