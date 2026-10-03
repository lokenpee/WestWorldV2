import { useEffect, useRef } from 'react'
import { useCompileStore } from '@/features/store/compile-store.ts'

/**
 * 进度 + 实时日志窗口（ADR-010）。
 *
 * 用户要求："完完整整的日志窗口必须做，用户必须能看到到底每一步在做什么"。
 * 这里订阅 compileStore（它由事件总线喂），所以日志是**实时**的。
 */
export function CompilePanel({ onCancel }: { onCancel?: () => void }) {
  const { status, stage, total, completed, failed, cost, logs, cancelRun } = useCompileStore()
  const logRef = useRef<HTMLDivElement>(null)

  // 有新日志就滚到底
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length])

  const pct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0
  const running = status === 'running'

  return (
    <div className="border-b border-neutral-200 bg-white px-4 py-3">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">{stage} 提取</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full bg-neutral-800 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-40 text-right text-xs tabular-nums text-neutral-500">
          {completed} / {total} 章 · 失败 {failed} · ¥{cost.toFixed(4)}
        </span>
        {running && (
          <button
            type="button"
            onClick={() => {
              cancelRun()
              onCancel?.()
            }}
            className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
          >
            取消
          </button>
        )}
      </div>

      <div
        ref={logRef}
        className="mt-3 h-40 overflow-auto rounded bg-neutral-950 p-2 font-mono text-[11px] leading-5 text-neutral-300"
      >
        {logs.length === 0 && <span className="text-neutral-600">等待中…</span>}
        {logs.map((l) => (
          <div
            key={l.id}
            className={
              l.level === 'error'
                ? 'text-red-400'
                : l.level === 'warn'
                  ? 'text-amber-300'
                  : 'text-neutral-300'
            }
          >
            <span className="text-neutral-600">{new Date(l.at).toLocaleTimeString('zh-CN')} </span>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  )
}

