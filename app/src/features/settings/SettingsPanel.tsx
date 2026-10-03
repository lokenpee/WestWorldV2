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
import { exportBook } from '@/core/export/export-book.ts'
import { importBackup, inspectBackup, type InspectResult } from '@/core/export/import-book.ts'
import { useCompileStore } from '@/features/store/compile-store.ts'
import { useUiStore } from '@/features/store/ui-store.ts'

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
  const [busy, setBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<{ bytes: Uint8Array; inspect: InspectResult } | null>(null)
  const [storageInfo, setStorageInfo] = useState<string>('')

  const bookId = useUiStore((s) => s.bookId)
  const setBookId = useUiStore((s) => s.setBookId)

  async function handleExport() {
    if (!bookId) {
      flash('先导入一本书')
      return
    }
    setBusy(true)
    try {
      const { fileName, bytes } = await exportBook(bookId)
      // 下载需要 DOM —— 所以这段在 features 而不是 core（ADR-012）
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      flash(`已导出 ${fileName}`)
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handlePickBackup(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const inspect = await inspectBackup(bytes)
    setImportPreview({ bytes, inspect })
  }

  async function confirmImport() {
    if (!importPreview?.inspect.ok) return
    setBusy(true)
    try {
      const r = await importBackup(importPreview.bytes)
      setBookId(r.bookId)
      setImportPreview(null)
      flash(`已导入 ${r.chapterCount} 章`)
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // 存储占用（浏览器可能拒绝，忽略即可）
    void navigator.storage
      ?.estimate?.()
      .then((e) => {
        const mb = (n?: number) => ((n ?? 0) / 1024 / 1024).toFixed(1)
        setStorageInfo(`已用 ${mb(e.usage)} MB / 可用 ${mb(e.quota)} MB`)
      })
      .catch(() => undefined)
  }, [])

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

      <Section title="数据">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !bookId}
            onClick={() => void handleExport()}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40"
          >
            导出备份（.wwv2）
          </button>
          <label className="cursor-pointer rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">
            导入备份
            <input
              type="file"
              accept=".wwv2,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handlePickBackup(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>

        <p className="text-xs text-neutral-500">
          备份包含：原文、人物、地点、事件节点、事件线。
          <strong>不包含 API Key，也不包含事件日志。</strong>
          导入会**新建一本书**，不会覆盖你现有的数据。
        </p>
        {storageInfo && <p className="text-xs text-neutral-400">浏览器存储：{storageInfo}</p>}

        {importPreview && (
          <div className="rounded border border-neutral-200 p-3">
            {importPreview.inspect.ok ? (
              <>
                <p className="text-sm">
                  备份有效：<strong>{importPreview.inspect.manifest?.book.title}</strong>
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {importPreview.inspect.stats?.chapters} 章 · {importPreview.inspect.stats?.characters} 人物 ·{' '}
                  {importPreview.inspect.stats?.locations} 地点 · {importPreview.inspect.stats?.nodes} 节点 ·{' '}
                  {importPreview.inspect.stats?.eventLines} 事件线
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmImport()}
                    className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
                  >
                    确认导入
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportPreview(null)}
                    className="text-sm text-neutral-500 hover:text-neutral-800"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-red-600">这个文件不能导入：</p>
                <ul className="mt-1 list-inside list-disc text-xs text-red-600">
                  {importPreview.inspect.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setImportPreview(null)}
                  className="mt-2 text-sm text-neutral-500 hover:text-neutral-800"
                >
                  关闭
                </button>
              </>
            )}
          </div>
        )}
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

