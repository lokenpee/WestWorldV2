/**
 * P1 编排：把整本书的章节跑一遍提取（实施计划步骤 7）。
 *
 * 三件事（ADR-008）：
 *   1. **并发 3**（可配）—— 顺序无关，每章写自己的记录
 *   2. **每章完成立即写进度** —— 这是"关掉标签页后能接着跑"能成立的前提
 *   3. **可取消** —— 已完成的章节保留，在途的丢弃重跑
 */
import type { CompileProgress, CompileStatus } from '@/core/schema/index.ts'
import { getChapterText, getProgress, listChapters, putProgress, saveP1Result } from '@/core/db/repo.ts'
import { getEventBus, type EventBus } from '@/core/events/bus.ts'
import { extractChapter, type P1Deps } from './p1.ts'
import { runPool } from './pool.ts'

export interface RunP1Options {
  concurrency?: number
  signal?: AbortSignal
  /** 便于测试注入 */
  deps?: P1Deps
  bus?: EventBus
}

export interface RunP1Result {
  status: CompileStatus
  total: number
  completed: number
  failed: number
  cost: number
  failures: Array<{ chapterIndex: string; message?: string }>
}

export async function runP1(bookId: string, options: RunP1Options = {}): Promise<RunP1Result> {
  const { concurrency = 3, signal, deps = {}, bus = getEventBus() } = options

  const chapters = await listChapters(bookId)
  const existing = await getProgress(bookId, 'P1')

  const progress: CompileProgress = existing ?? {
    bookId,
    stage: 'P1',
    status: 'idle',
    totalChapters: chapters.length,
    completedChapters: [],
    failedChapters: [],
    updatedAt: new Date().toISOString(),
  }

  const done = new Set(progress.completedChapters)
  const failed = new Set(progress.failedChapters)
  const failures: RunP1Result['failures'] = []
  let cost = 0

  const todo = chapters.filter((c) => !done.has(c.chapterIndex) && !failed.has(c.chapterIndex))

  progress.status = 'running'
  progress.totalChapters = chapters.length
  progress.updatedAt = new Date().toISOString()
  await putProgress(progress)

  bus.emit({ type: 'task:start', bookId, stage: 'P1', total: chapters.length })

  const emitProgress = () => {
    bus.emit({
      type: 'task:progress',
      bookId,
      stage: 'P1',
      completed: done.size,
      failed: failed.size,
      total: chapters.length,
      cost,
    })
  }

  emitProgress()

  await runPool(
    todo,
    concurrency,
    async (chapter) => {
      const chapterIndex = chapter.chapterIndex
      bus.emit({ type: 'chapter:start', bookId, chapterIndex })

      const text = await getChapterText(bookId, chapterIndex)
      if (text === undefined) {
        failed.add(chapterIndex)
        failures.push({ chapterIndex, message: '章节正文缺失' })
        bus.emit({ type: 'chapter:failed', bookId, chapterIndex, message: '章节正文缺失' })
        return
      }

      const result = await extractChapter(
        { bookId, chapterIndex, chapterName: chapter.chapterName, text },
        deps,
      )
      for (const u of result.usages) cost += u.cost

      // 全失败才算这一章失败；部分成功按成功计（数据已经拿到了）
      if (result.failures.length >= 2) {
        failed.add(chapterIndex)
        const first = result.failures[0]
        failures.push({
          chapterIndex,
          ...(first?.errorMessage ? { message: first.errorMessage } : {}),
        })
        bus.emit({
          type: 'chapter:failed',
          bookId,
          chapterIndex,
          ...(first?.errorMessage ? { message: first.errorMessage } : {}),
        })
      } else {
        await saveP1Result(bookId, result)
        done.add(chapterIndex)
        bus.emit({
          type: 'chapter:done',
          bookId,
          chapterIndex,
          characters: result.characterSnapshots.length,
          locations: result.locations.length,
          nodes: result.nodes.length,
        })
      }

      // ⚠️ 每章完成立即写进度（断点续跑的前提）
      progress.completedChapters = [...done]
      progress.failedChapters = [...failed]
      progress.updatedAt = new Date().toISOString()
      await putProgress(progress)
      emitProgress()
    },
    signal,
  )

  const cancelled = signal?.aborted ?? false
  progress.status = cancelled ? 'cancelled' : 'completed'
  progress.completedChapters = [...done]
  progress.failedChapters = [...failed]
  progress.updatedAt = new Date().toISOString()
  await putProgress(progress)

  if (cancelled) {
    bus.emit({ type: 'task:cancelled', bookId, stage: 'P1' })
  } else {
    bus.emit({ type: 'task:done', bookId, stage: 'P1', completed: done.size, failed: failed.size })
  }

  return {
    status: progress.status,
    total: chapters.length,
    completed: done.size,
    failed: failed.size,
    cost,
    failures,
  }
}
