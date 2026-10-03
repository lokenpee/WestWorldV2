import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/features/store/ui-store.ts'

interface Line {
  role: 'player' | 'narrator'
  text: string
}

/**
 * 游玩界面（对话窗口）。
 *
 * ⚠️ 当前版本只做到「资产提取与编辑」—— Director / Editor / Narrator（M3~M5）
 * 还没实现。所以这里**明确告诉用户"还没接上"**，而不是假装成功。
 */
export function PlayPanel() {
  const bookId = useUiStore((s) => s.bookId)
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  function send() {
    const text = input.trim()
    if (!text || !bookId) return
    setInput('')
    setLines((prev) => [
      ...prev,
      { role: 'player', text },
      {
        role: 'narrator',
        text: '（游玩逻辑尚未接入。Director / Editor / Narrator 属于下一阶段 —— 当前版本完成到「资产提取与编辑」。）',
      },
    ])
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-auto p-6">
        {lines.length === 0 && (
          <p className="text-sm text-neutral-400">还没有开始游玩。这里将来是对话窗口。</p>
        )}
        {lines.map((l, i) => (
          <div key={i} className={l.role === 'player' ? 'text-right' : ''}>
            <div
              className={
                'inline-block max-w-[70%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ' +
                (l.role === 'player'
                  ? 'bg-neutral-900 text-white'
                  : 'bg-white text-neutral-800 ring-1 ring-neutral-200')
              }
            >
              {l.text}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-neutral-200 bg-white p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={bookId ? '我想做什么…' : '先导入一本书'}
            disabled={!bookId}
            className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 disabled:bg-neutral-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={!bookId || input.trim() === ''}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
