import { create } from 'zustand'
import type { AppEvent } from '@/core/events/types.ts'
import type { CompileStage, CompileStatus } from '@/core/schema/index.ts'

export interface LogLine {
  id: number
  at: number
  level: 'info' | 'warn' | 'error'
  text: string
}

interface CompileState {
  status: CompileStatus
  stage: CompileStage
  total: number
  completed: number
  failed: number
  cost: number
  /** 实时日志（ADR-010：用户要能看到每一步在做什么） */
  logs: LogLine[]
  pushLog: (line: Omit<LogLine, 'id' | 'at'> & { at?: number }) => void
  clearLogs: () => void
  reset: () => void
  applyEvent: (e: AppEvent) => void
}

const MAX_LOGS = 2000

let logSeq = 0

function fmtCost(cost: number): string {
  return `¥${cost.toFixed(4)}`
}

export const useCompileStore = create<CompileState>((set, get) => ({
  status: 'idle',
  stage: 'P1',
  total: 0,
  completed: 0,
  failed: 0,
  cost: 0,
  logs: [],

  pushLog: (line) =>
    set((s) => {
      const next = [...s.logs, { id: ++logSeq, at: line.at ?? Date.now(), level: line.level, text: line.text }]
      return { logs: next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next }
    }),

  clearLogs: () => set({ logs: [] }),

  reset: () => set({ status: 'idle', completed: 0, failed: 0, cost: 0, total: 0 }),

  /** 把事件总线上的一条事件折进界面状态（UI 只订阅总线，不直接碰 pipeline）。 */
  applyEvent: (e) => {
    const push = get().pushLog
    switch (e.type) {
      case 'task:start':
        set({ status: 'running', stage: e.stage, total: e.total, completed: 0, failed: 0, cost: 0 })
        push({ level: 'info', text: `▶ ${e.stage} 开始 · 共 ${e.total} 章` })
        break
      case 'task:progress':
        set({ completed: e.completed, failed: e.failed, total: e.total, cost: e.cost })
        break
      case 'chapter:start':
        push({ level: 'info', text: `  第 ${e.chapterIndex} 章 开始` })
        break
      case 'chapter:done':
        push({
          level: 'info',
          text: `  ✔ 第 ${e.chapterIndex} 章 完成（人物 ${e.characters} · 地点 ${e.locations} · 节点 ${e.nodes}）`,
        })
        break
      case 'chapter:failed':
        push({ level: 'error', text: `  ✘ 第 ${e.chapterIndex} 章 失败${e.message ? `：${e.message}` : ''}` })
        break
      case 'task:cancelled':
        set({ status: 'cancelled' })
        push({ level: 'warn', text: `■ ${e.stage} 已取消（已完成的章节保留）` })
        break
      case 'task:done': {
        set({ status: 'completed' })
        const cost = get().cost
        push({
          level: 'info',
          text: `✔ ${e.stage} 完成 · 成功 ${e.completed} · 失败 ${e.failed} · 累计 ${fmtCost(cost)}`,
        })
        break
      }
      case 'task:paused':
        set({ status: 'paused' })
        push({ level: 'warn', text: `⏸ ${e.stage} 已暂停` })
        break
      case 'task:resumed':
        set({ status: 'running' })
        push({ level: 'info', text: `▶ ${e.stage} 已恢复` })
        break
      case 'log':
        push({ level: e.level, text: e.message })
        break
    }
  },
}))
