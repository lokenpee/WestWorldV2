/**
 * 单章试跑 —— **不落库**，只把 P1 的原始产出拿回来给用户看。
 *
 * 为什么需要它：提示词抽出来的东西对不对，是**唯一需要人判断**的环节。
 * 跑一整本书要花钱花时间；试跑一章几秒就能看出问题，还能立刻改提示词重试。
 */
import { getChapterText, listChapters } from '@/core/db/repo.ts'
import type {
  StoredCharacterSnapshot,
  StoredLocation,
  StoredNode,
} from '@/core/schema/index.ts'
import { extractChapter, type P1Failure } from './p1.ts'

export interface TryOneResult {
  chapterIndex: string
  chapterName: string
  /** 原文（截断给界面显示，避免长章卡住） */
  sourceText: string
  sourceTruncated: boolean
  characters: StoredCharacterSnapshot[]
  locations: StoredLocation[]
  nodes: StoredNode[]
  failures: P1Failure[]
  cost: number
  durationMs: number
}

/** 试跑指定章节（默认第一章）。**不写入数据库。** */
export async function tryOneChapter(
  bookId: string,
  chapterIndex?: string,
  options: { signal?: AbortSignal; deps?: Parameters<typeof extractChapter>[1] } = {},
): Promise<TryOneResult> {
  const chapters = await listChapters(bookId)
  if (chapters.length === 0) throw new Error('这本书还没有章节')

  const target = chapterIndex ? chapters.find((c) => c.chapterIndex === chapterIndex) : chapters[0]
  if (!target) throw new Error(`找不到第 ${chapterIndex} 章`)

  const text = await getChapterText(bookId, target.chapterIndex)
  if (text === undefined) throw new Error('章节正文缺失')

  const started = performance.now()
  const result = await extractChapter(
    { bookId, chapterIndex: target.chapterIndex, chapterName: target.chapterName, text },
    {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.deps ?? {}),
    },
  )
  const durationMs = Math.round(performance.now() - started)

  return {
    chapterIndex: target.chapterIndex,
    chapterName: target.chapterName,
    sourceText: text.slice(0, 2000),
    sourceTruncated: text.length > 2000,
    characters: result.characterSnapshots,
    locations: result.locations,
    nodes: result.nodes,
    failures: result.failures,
    cost: result.usages.reduce((s, u) => s + u.cost, 0),
    durationMs,
  }
}
