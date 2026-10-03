import { describe, expect, it } from 'vitest'
import type { StoredCharacterSnapshot } from '../src/core/schema/index.ts'
import {
  areNamesObviouslySame,
  groupSnapshots,
  normalizeEntryName,
  normalizeNameForComparison,
  pickMainByQuality,
} from '../src/core/pipeline/merge-characters.ts'

function snap(id: string, name: string, over: Partial<StoredCharacterSnapshot> = {}): StoredCharacterSnapshot {
  return {
    id,
    bookId: 'bk',
    chapterIndex: '1',
    chapterName: '第一章',
    name,
    confidence: 0.9,
    ...over,
  }
}

describe('名称归一化', () => {
  it('去掉版本 / 卷 / 章后缀', () => {
    expect(normalizeEntryName('贾琏（修订版）')).toBe('贾琏')
    expect(normalizeEntryName('贾琏_卷1')).toBe('贾琏')
    expect(normalizeEntryName('贾琏_v2')).toBe('贾琏')
    expect(normalizeEntryName('贾琏 -第3章')).toBe('贾琏')
    expect(normalizeEntryName('贾琏')).toBe('贾琏')
  })

  it('比较用归一化去掉标点与空白', () => {
    expect(normalizeNameForComparison('贾 琏')).toBe('贾琏')
    expect(normalizeNameForComparison('贾·琏')).toBe('贾琏')
    expect(normalizeNameForComparison('Jia Lian')).toBe('jialian')
  })
})

describe('判同规则', () => {
  it('完全相同 → 同一人', () => {
    expect(areNamesObviouslySame('贾琏', '贾琏')).toBe(true)
  })

  it('包含关系 → 同一人（贾宝玉 / 宝玉）', () => {
    expect(areNamesObviouslySame('贾宝玉', '宝玉')).toBe(true)
  })

  it('⭐ 单字守卫：单字名不会被吸进长名（贾 / 贾琏）', () => {
    expect(areNamesObviouslySame('贾', '贾琏')).toBe(false)
    expect(areNamesObviouslySame('王', '王熙凤')).toBe(false)
  })

  it('判不了昵称（琏二爷 vs 贾琏）—— 这是留给 AI 那一步的', () => {
    expect(areNamesObviouslySame('贾琏', '琏二爷')).toBe(false)
  })

  it('不同的人不会被误判', () => {
    expect(areNamesObviouslySame('贾宝玉', '贾环')).toBe(false)
    expect(areNamesObviouslySame('林黛玉', '薛宝钗')).toBe(false)
  })
})

describe('挑主名', () => {
  it('内容更丰富的胜出', () => {
    const lean = snap('C1-P001', '贾宝玉')
    const rich = snap('C2-P001', '宝玉', {
      personality: '多情；叛逆；聪明',
      background: '荣国府二公子',
      relations: [{ target: '林黛玉', relation_type: 'lover' }],
    })
    expect(pickMainByQuality([lean, rich]).id).toBe('C2-P001')
  })

  it('带后缀的名字被惩罚', () => {
    const clean = snap('C1-P001', '贾琏', { identity: '荣国府长孙' })
    const dirty = snap('C2-P001', '贾琏（修订版）', { identity: '荣国府长孙' })
    expect(pickMainByQuality([clean, dirty]).id).toBe('C1-P001')
  })
})

describe('聚组', () => {
  it('把包含关系的快照并成一组，并汇总别名', () => {
    const groups = groupSnapshots([
      snap('C1-P001', '贾宝玉', { aliases_mentioned: ['宝二爷'] }),
      snap('C5-P001', '宝玉'),
      snap('C7-P001', '林黛玉'),
    ])
    expect(groups).toHaveLength(1)
    const g = groups[0]!
    expect(g.main.name).toBe('贾宝玉')
    expect(g.others).toHaveLength(1)
    expect(g.aliases).toContain('宝玉')
    expect(g.aliases).toContain('宝二爷')
  })

  it('三个同人快照并成一组（传递性）', () => {
    const groups = groupSnapshots([
      snap('A', '贾宝玉'),
      snap('B', '宝玉'),
      snap('C', '贾宝玉（修订版）'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.others).toHaveLength(2)
  })

  it('没有同人时不产生组', () => {
    const groups = groupSnapshots([snap('A', '林黛玉'), snap('B', '薛宝钗')])
    expect(groups).toEqual([])
  })

  it('单字名不会和长名并组（守卫生效）', () => {
    const groups = groupSnapshots([snap('A', '贾'), snap('B', '贾琏')])
    expect(groups).toEqual([])
  })
})
