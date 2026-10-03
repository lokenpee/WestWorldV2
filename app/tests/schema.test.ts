import { describe, expect, it } from 'vitest'
import {
  CharacterSnapshotSchema,
  NarrativeAssetsExtractionSchema,
  NodeSchema,
  WorldAssetsExtractionSchema,
  compileSchema,
  validate,
} from '../src/core/schema/index.ts'

// 用《红楼梦》走私案那一段做样例（与 PRD 里的例子一致）
const worldAssetsSample = {
  chapter_index: '37',
  chapter_name: '第三十七回 秋爽斋偶结海棠社',
  characters: [
    {
      name: '贾琏',
      aliases_mentioned: ['琏二爷'],
      identity: '荣国府长孙',
      profile: { gender: '男' },
      personality: '好色；惧内；办事机灵',
      speech_style_sample: '「你又来做什么？」',
      relations: [
        { target: '王熙凤', relation_type: 'spouse', relation_label: '夫妻', direction: 'bidirectional' },
      ],
      confidence: 0.92,
    },
  ],
  locations: [{ name: '荣国府', description: '贾府主宅' }],
}

const narrativeAssetsSample = {
  chapter_index: '37',
  chapter_name: '第三十七回 秋爽斋偶结海棠社',
  nodes: [
    {
      name: '贾琏的资金来源异常',
      summary: '贾琏近来手头忽然宽裕许多，来路不明。',
      actors: ['贾琏'],
      targets: [],
      world_delta: ['贾琏手头多出大笔银子'],
      new_facts: ['贾琏近期有大笔来路不明的钱'],
      time_text: '洪武十四年三月六日',
      time_hint: '次日',
      quote: '……贾琏近来手头颇觉宽裕……',
      offset: 12345,
      confidence: 0.88,
    },
  ],
}

describe('P1 世界资产输出', () => {
  it('合法样例通过校验', () => {
    const r = validate(WorldAssetsExtractionSchema, worldAssetsSample)
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors)).toBe(true)
  })

  it('缺必填字段时失败，并给出可读错误', () => {
    const bad = {
      ...worldAssetsSample,
      characters: [{ ...worldAssetsSample.characters[0], name: undefined }],
    }
    const r = validate(WorldAssetsExtractionSchema, bad)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThan(0)
      expect(r.errors.join(' ')).toContain('name')
    }
  })

  it('置信度越界时失败', () => {
    const bad = {
      ...worldAssetsSample,
      characters: [{ ...worldAssetsSample.characters[0], confidence: 1.5 }],
    }
    expect(validate(WorldAssetsExtractionSchema, bad).ok).toBe(false)
  })

  it('出现未定义的字段时失败（additionalProperties: false）', () => {
    const bad = { ...worldAssetsSample, 未定义字段: 1 }
    expect(validate(WorldAssetsExtractionSchema, bad).ok).toBe(false)
  })

  it('关系方向只接受 bidirectional / directed', () => {
    const bad = {
      ...worldAssetsSample,
      characters: [
        {
          ...worldAssetsSample.characters[0],
          relations: [{ target: '王熙凤', relation_type: 'spouse', direction: '双向' }],
        },
      ],
    }
    expect(validate(WorldAssetsExtractionSchema, bad).ok).toBe(false)
  })
})

describe('P1 叙事资产输出', () => {
  it('合法样例通过校验', () => {
    const r = validate(NarrativeAssetsExtractionSchema, narrativeAssetsSample)
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors)).toBe(true)
  })

  it('actors 必须是数组（模型常犯的错）', () => {
    const bad = {
      ...narrativeAssetsSample,
      nodes: [{ ...narrativeAssetsSample.nodes[0], actors: '贾琏' }],
    }
    expect(validate(NarrativeAssetsExtractionSchema, bad).ok).toBe(false)
  })

  it('quote 是必填（没有原文出处就不能落库）', () => {
    const { quote: _drop, ...withoutQuote } = narrativeAssetsSample.nodes[0]
    const bad = { ...narrativeAssetsSample, nodes: [withoutQuote] }
    expect(validate(NarrativeAssetsExtractionSchema, bad).ok).toBe(false)
  })
})

describe('单个 schema 的边界', () => {
  it('人物快照的最小合法形态（只填必填字段）', () => {
    expect(validate(CharacterSnapshotSchema, { name: '贾琏', confidence: 0.5 }).ok).toBe(true)
  })

  it('事件节点的最小合法形态', () => {
    const minimal = {
      name: '散步回家',
      summary: '主角与妻子散步回家。',
      actors: ['主角'],
      quote: '……',
      confidence: 0.7,
    }
    expect(validate(NodeSchema, minimal).ok).toBe(true)
  })
})

describe('编译缓存', () => {
  it('同一个 schema 重复编译返回同一个 checker', () => {
    expect(compileSchema(NodeSchema)).toBe(compileSchema(NodeSchema))
  })
})
