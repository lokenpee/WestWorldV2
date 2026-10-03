import { useState } from 'react'
import { tryOneChapter, type TryOneResult } from '@/core/pipeline/try-one.ts'

const STAGE_LABEL: Record<string, string> = {
  worldAssets: '世界资产',
  narrativeAssets: '叙事资产',
}

/**
 * 试跑一章 —— 把「原文」和「抽出来的东西」并排放在一起。
 *
 * 这是唯一需要人判断质量的环节：跑一整本书要花钱花时间，试跑一章几秒就能看出
 * 模型是不是在「记录」而不是在「解释」、有没有把一段里的多个事实合在一起。
 *
 * **不写入数据库** —— 试跑结果只用于看，不满意就去改提示词再试。
 */
export function TryOnePanel({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const [result, setResult] = useState<TryOneResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      setResult(await tryOneChapter(bookId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <div className="flex h-full w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2">
          <span className="text-sm font-medium">试跑一章</span>
          <span className="text-xs text-neutral-500">
            用真实模型跑一章，看看抽出来的东西对不对（<strong>不写入数据库</strong>）
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-xs text-neutral-500 hover:text-neutral-800"
          >
            关闭
          </button>
        </header>

        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2">
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {running ? '正在跑第一章…' : result ? '重跑' : '开始试跑'}
          </button>
          {result && (
            <span className="text-xs text-neutral-500">
              第 {result.chapterIndex} 章 · {result.durationMs}ms · ¥{result.cost.toFixed(4)} · 人物{' '}
              {result.characters.length} · 地点 {result.locations.length} · 节点 {result.nodes.length}
            </span>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>

        {result && result.failures.length > 0 && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
            {result.failures.map((f) => (
              <div key={f.stage}>
                {STAGE_LABEL[f.stage] ?? f.stage} 调用失败（{f.errorKind ?? 'unknown'}，尝试 {f.attempts} 次）
                {f.errorMessage ? `：${f.errorMessage.slice(0, 200)}` : ''}
              </div>
            ))}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-neutral-200">
          <div className="overflow-auto p-4">
            <h3 className="mb-2 text-xs font-medium text-neutral-500">原文</h3>
            <pre className="whitespace-pre-wrap text-xs leading-6 text-neutral-700">
              {result?.sourceText ?? '（还没跑）'}
            </pre>
            {result?.sourceTruncated && (
              <p className="mt-2 text-[10px] text-neutral-400">只显示前 2000 字</p>
            )}
          </div>

          <div className="overflow-auto p-4">
            <h3 className="mb-2 text-xs font-medium text-neutral-500">抽出来的东西</h3>

            {!result && <p className="text-xs text-neutral-400">点「开始试跑」后，这里会显示提取结果。</p>}

            {result && (
              <div className="space-y-4">
                <section>
                  <div className="mb-1 text-xs font-medium">人物（{result.characters.length}）</div>
                  <ul className="space-y-1">
                    {result.characters.map((c) => (
                      <li key={c.id} className="rounded border border-neutral-200 px-2 py-1.5">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{c.name}</span>
                          <span className="font-mono text-[10px] text-neutral-400">{c.id}</span>
                          {c.aliases_mentioned?.length ? (
                            <span className="text-[10px] text-neutral-500">
                              别名 {c.aliases_mentioned.join('/')}
                            </span>
                          ) : null}
                        </div>
                        {c.identity && <div className="text-[11px] text-neutral-500">{c.identity}</div>}
                        {c.personality && (
                          <div className="text-[11px] text-neutral-600">性格：{c.personality}</div>
                        )}
                        {c.speech_style_sample && (
                          <div className="mt-0.5 border-l-2 border-neutral-200 pl-2 text-[11px] italic text-neutral-500">
                            {c.speech_style_sample}
                          </div>
                        )}
                      </li>
                    ))}
                    {result.characters.length === 0 && (
                      <li className="text-xs text-neutral-400">（没抽到人物）</li>
                    )}
                  </ul>
                </section>

                <section>
                  <div className="mb-1 text-xs font-medium">地点（{result.locations.length}）</div>
                  <ul className="space-y-1">
                    {result.locations.map((l) => (
                      <li key={l.id} className="text-[11px] text-neutral-600">
                        {l.name}
                        {l.description ? ` — ${l.description}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>

                <section>
                  <div className="mb-1 text-xs font-medium">事件节点（{result.nodes.length}）</div>
                  <ul className="space-y-1">
                    {result.nodes.map((n) => (
                      <li key={n.id} className="rounded border border-neutral-200 px-2 py-1.5">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{n.name}</span>
                          <span className="font-mono text-[10px] text-neutral-400">{n.id}</span>
                        </div>
                        <div className="text-[11px] text-neutral-600">{n.summary}</div>
                        {n.actors.length > 0 && (
                          <div className="text-[10px] text-neutral-400">涉及：{n.actors.join('、')}</div>
                        )}
                        {n.quote && (
                          <div className="mt-0.5 border-l-2 border-neutral-200 pl-2 text-[10px] italic text-neutral-500">
                            {n.quote}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                <p className="rounded bg-neutral-50 p-2 text-[10px] leading-4 text-neutral-500">
                  <strong>人工判断要点</strong>：① 人物有没有漏抽 / 多抽 ② 节点是在「记录事实」还是在
                  「下结论」（后者不该出现） ③ 一段里的多个事实有没有被拆开 ④ 节点有没有带原文出处
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
