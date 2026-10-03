import type { CompileStage } from '@/core/schema/index.ts'

/**
 * 应用事件（ADR-010）。
 *
 * 分两层：
 *   - **Agent 层**：由 `pi-agent-core` 的 `AgentEvent` 转发而来（agent_start / tool_execution_* …）
 *   - **任务层**：PI 不知道"章节""窗口"这些概念，由 pipeline 补上
 *
 * 这里先定义任务层 + 一个通用的 log 事件；Agent 层的转发在接 Agent 时补。
 */
export type AppEvent =
  | { type: 'task:start'; bookId: string; stage: CompileStage; total: number }
  | {
      type: 'task:progress'
      bookId: string
      stage: CompileStage
      completed: number
      failed: number
      total: number
      cost: number
    }
  | { type: 'task:paused'; bookId: string; stage: CompileStage }
  | { type: 'task:resumed'; bookId: string; stage: CompileStage }
  | { type: 'task:cancelled'; bookId: string; stage: CompileStage }
  | { type: 'task:done'; bookId: string; stage: CompileStage; completed: number; failed: number }
  | { type: 'chapter:start'; bookId: string; chapterIndex: string }
  | {
      type: 'chapter:done'
      bookId: string
      chapterIndex: string
      characters: number
      locations: number
      nodes: number
    }
  | { type: 'chapter:failed'; bookId: string; chapterIndex: string; message?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; data?: unknown }

export type AppEventType = AppEvent['type']
