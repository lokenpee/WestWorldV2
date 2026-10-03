import { useEffect, useState } from 'react'
import {
  DEFAULT_CONCURRENCY,
  getApiKeyHint,
  getConcurrency,
  getModelConfig,
  isApiKeyConfigured,
  removeApiKey,
  saveApiKey,
  setConcurrency,
} from '@/core/config/settings.ts'
import { useCompileStore } from '@/features/store/compile-store.ts'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/**
 * 设置界面。
 *
 * 按 ADR-005 的第 4 条纪律：这里必须**明确告知**"Key 以明文存在浏览器本地"。
 */
export function SettingsPanel() {
  const cfg = getModelConfig()
  const clearLogs = useCompileStore((s) => s.clearLogs)

  const [configured, setConfigured] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [draftKey, setDraftKey] = useState('')
  const [concurrency, setConcurrencyState] = useState(DEFAULT_CONCURRENCY)
  const [saved, setSaved] = useState<string | null>(null)

  async function refresh() {
    setConfigured(await isApiKeyConfigured())
    setHint(await getApiKeyHint())
    setConcurrencyState(await getConcurrency())
  }

  useEffect(() => {
    void refresh()
  }, [])

  function flash(msg: string) {
    setSaved(msg)
    setTimeout(() => setSaved(null), 2000)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 overflow-auto p-6">
      <h2 className="text-lg font-semibold">设置</h2>

      <Section title="模型">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-neutral-500">供应商</span>
          <span className="font-mono">{cfg.provider}</span>
          <span className="text-neutral-500">提取用模型</span>
          <span className="font-mono">{cfg.models.extraction}</span>
          <span className="text-neutral-500">归并用模型</span>
          <span className="font-mono">{cfg.models.aggregation}</span>
        </div>
        <p className="text-xs text-neutral-500">
          MVP 锁定 DeepSeek。后续适配更多供应商时只改这里，不动 pipeline。
        </p>
      </Section>

      <Section title="API Key">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-500">当前</span>
          {configured ? (
            <span className="font-mono">{hint ?? '已配置'}</span>
          ) : (
            <span className="text-amber-600">未配置</span>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="粘贴 DeepSeek API Key"
            className="flex-1 rounded border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500"
          />
          <button
            type="button"
            disabled={draftKey.trim() === ''}
            onClick={async () => {
              await saveApiKey(draftKey)
              setDraftKey('')
              await refresh()
              flash('已保存')
            }}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            保存
          </button>
          <button
            type="button"
            disabled={!configured}
            onClick={async () => {
              await removeApiKey()
              await refresh()
              flash('已清除')
            }}
            className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-40"
          >
            清除
          </button>
        </div>

        <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
          ⚠️ Key <strong>以明文保存在本机浏览器存储里</strong>（IndexedDB）。它不会被导出到备份文件、也不会写进日志，
          但本机的其他脚本可以读到 —— 只建议在这台个人电脑上使用。
        </p>
        <p className="text-xs text-neutral-500">
          调用模型时，会把当前章节的正文发送给你配置的模型服务商。本机存储的数据不经过任何中间服务器。
        </p>
      </Section>

      <Section title="编译">
        <label className="flex items-center gap-3 text-sm">
          <span className="w-24 text-neutral-500">并发数</span>
          <input
            type="number"
            min={1}
            max={16}
            value={concurrency}
            onChange={(e) => setConcurrencyState(Number(e.target.value))}
            className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={async () => {
              await setConcurrency(concurrency)
              await refresh()
              flash('已保存')
            }}
            className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
          >
            保存
          </button>
          <span className="text-xs text-neutral-400">越高越快，但更容易触发服务商限流</span>
        </label>

        <button
          type="button"
          onClick={clearLogs}
          className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
        >
          清空日志窗口
        </button>
      </Section>

      <Section title="关于">
        <p className="text-sm text-neutral-600">
          WestWorld V2 · v1.0 —— 导入小说 → 提取世界资产与叙事资产 → 编辑 → 事件网络可视化。
        </p>
        <p className="text-xs text-neutral-500">
          游玩逻辑（Director / Editor / Narrator）属于下一阶段。
        </p>
      </Section>

      {saved && (
        <div className="fixed bottom-4 right-4 rounded bg-neutral-900 px-3 py-2 text-sm text-white">
          {saved}
        </div>
      )}
    </div>
  )
}
