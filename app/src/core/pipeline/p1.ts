/**
 * P1 · 章节提取（实施计划步骤 6）。
 *
 * 每章调用模型 **两次**（PRD 1.3）：
 *   ① 世界资产 —— 人物快照 + 地点（提示词 01）
 *   ② 叙事资产 —— 事件节点（提示词 02）
 *
 * 铁律：
 *   - **模型不产出 id**，id 一律由代码分配（避免模型跳号/重号）
 *   - 两次调用互相独立，任一次失败**不影响另一次**（能拿到多少算多少）
 *   - 结果全部过 TypeBox 校验才会到这里
 */
import type {
  CharacterSnapshot,
  Location,
  NarrativeAssetsExtraction,
  Node,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredNode,
  WorldAssetsExtraction,
} from '@/core/schema/index.ts'
import {
  NarrativeAssetsExtractionSchema,
  WorldAssetsExtractionSchema,
} from '@/core/schema/index.ts'
import { callModel, type CallUsage } from '@/core/llm/call.ts'
import { PROMPTS } from '@/core/prompts/index.ts'

export interface P1Input {
  bookId: string
  /** 章节标识。切块后形如 "101.1" */
  chapterIndex: string
  chapterName: string
  text: string
}

export interface P1Failure {
  stage: 'worldAssets' | 'narrativeAssets'
  errorKind?: string
  errorMessage?: string
  attempts: number
}

export interface P1Result {
  characterSnapshots: StoredCharacterSnapshot[]
  locations: StoredLocation[]
  nodes: StoredNode[]
  /** 两次调用的用量合计（成本统计用，含重试） */
  usages: CallUsage[]
  failures: P1Failure[]
}

/** 3 位补零，保证 id 可字典序排序。 */
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

/** 把一章正文包成模型能识别的输入。 */
export function buildChapterMessage(input: P1Input): string {
  return [
    `章节标识：${input.chapterIndex}`,
    `章节名：${input.chapterName}`,
    '',
    '--- 正文开始 ---',
    input.text,
    '--- 正文结束 ---',
  ].join('\n')
}

/** 章内去重：同名只保留第一条（提示词已要求合并，这里是防御）。 */
function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = item.name.trim()
    if (key && !seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

/** 给人物快照分配 id 并挂上归属信息。 */
export function assignCharacterIds(
  input: P1Input,
  characters: CharacterSnapshot[],
): StoredCharacterSnapshot[] {
  return dedupeByName(characters).map((c, i) => ({
    ...c,
    id: `C${input.chapterIndex}-P${pad3(i + 1)}`,
    bookId: input.bookId,
    chapterIndex: input.chapterIndex,
    chapterName: input.chapterName,
  }))
}

export function assignLocationIds(input: P1Input, locations: Location[]): StoredLocation[] {
  return dedupeByName(locations).map((l, i) => ({
    ...l,
    id: `L${pad3(i + 1)}`,
    bookId: input.bookId,
    chapterIndex: input.chapterIndex,
  }))
}

export function assignNodeIds(input: P1Input, nodes: Node[]): StoredNode[] {
  return nodes.map((n, i) => ({
    ...n,
    id: `C${input.chapterIndex}-N${pad3(i + 1)}`,
    bookId: input.bookId,
    chapterIndex: input.chapterIndex,
    chapterName: input.chapterName,
    order: i,
    createdBy: 'P1' as const,
  }))
}

export interface P1Deps {
  /** 便于测试注入；默认走真实 callModel */
  call?: typeof callModel
  signal?: AbortSignal
}

/**
 * 提取一章。
 *
 * 两次调用**互相独立**：世界资产失败不会导致叙事资产不跑，反之亦然。
 * 失败的调用记进 `failures`，由上层决定是否跳过该章（ADR-009：跳过并继续）。
 */
export async function extractChapter(input: P1Input, deps: P1Deps = {}): Promise<P1Result> {
  const call = deps.call ?? callModel
  const message = { role: 'user' as const, content: buildChapterMessage(input), timestamp: Date.now() }

  const usages: CallUsage[] = []
  const failures: P1Failure[] = []

  // ── ① 世界资产 ──
  const world = await call({
    role: 'extraction',
    system: PROMPTS.extractWorldAssets,
    messages: [message],
    schema: WorldAssetsExtractionSchema,
    submitToolDescription: '提交本章的**世界资产**：人物快照（不判层级）与地点。',
    ...(deps.signal ? { signal: deps.signal } : {}),
  })
  usages.push(...world.attemptsUsage)

  let characters: CharacterSnapshot[] = []
  let locations: Location[] = []
  if (world.ok && world.data) {
    const data = world.data as WorldAssetsExtraction
    characters = data.characters ?? []
    locations = data.locations ?? []
  } else {
    failures.push({
      stage: 'worldAssets',
      attempts: world.attempts,
      ...(world.errorKind ? { errorKind: world.errorKind } : {}),
      ...(world.errorMessage ? { errorMessage: world.errorMessage } : {}),
    })
  }

  // ── ② 叙事资产 ──
  const narrative = await call({
    role: 'extraction',
    system: PROMPTS.extractNarrativeAssets,
    messages: [message],
    schema: NarrativeAssetsExtractionSchema,
    submitToolDescription: '提交本章的**叙事资产**：事件节点（只记录，不解释）。',
    ...(deps.signal ? { signal: deps.signal } : {}),
  })
  usages.push(...narrative.attemptsUsage)

  let nodes: Node[] = []
  if (narrative.ok && narrative.data) {
    nodes = (narrative.data as NarrativeAssetsExtraction).nodes ?? []
  } else {
    failures.push({
      stage: 'narrativeAssets',
      attempts: narrative.attempts,
      ...(narrative.errorKind ? { errorKind: narrative.errorKind } : {}),
      ...(narrative.errorMessage ? { errorMessage: narrative.errorMessage } : {}),
    })
  }

  return {
    characterSnapshots: assignCharacterIds(input, characters),
    locations: assignLocationIds(input, locations),
    nodes: assignNodeIds(input, nodes),
    usages,
    failures,
  }
}
