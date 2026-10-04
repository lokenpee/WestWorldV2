import { useEffect, useState } from 'react'
import {
  DEFAULT_CONCURRENCY,
  getApiKeyHint,
  getCatalogModels,
  getConcurrency,
  getLlmConfig,
  isApiKeyConfigured,
  probeFetchModels,
  probeQuickTest,
  removeApiKey,
  saveApiKey,
  setConcurrency,
  setLlmConfig,
} from '@/core/config/settings.ts'
import { exportBook } from '@/core/export/export-book.ts'
import { importBackup, inspectBackup, type InspectResult } from '@/core/export/import-book.ts'
import { useCompileStore } from '@/features/store/compile-store.ts'
import { useUiStore } from '@/features/store/ui-store.ts'

type StatusTone = 'idle' | 'loading' | 'success' | 'error'
interface Status {
  tone: StatusTone
  text: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-600">
        {label}
        {hint && <span className="ml-1 text-neutral-400">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function StatusLine({ status }: { status: Status }) {
  if (status.tone === 'idle') return null
  const cls =
    status.tone === 'error'
      ? 'text-red-600'
      : status.tone === 'success'
        ? 'text-emerald-600'
        : 'text-neutral-500'
  return <span className={`text-xs ${cls}`}>{status.text}</span>
}

/**
 * 设置界面。
 *
 * 交互参考了同类工具的做法（用户指定学习 lokenpee/WestWorld 的设置页）：
 *   · **🔄 拉取模型** —— 不用手打模型名（最容易输错的一步），顺便验证 Key
 *   · **⚡ 快速测试** —— 配完当场知道能不能用，不用等跑编译才发现配错了
 *   · **状态行实时反馈** —— 进行中 / 成功（带耗时）/ 失败（带原因）
 *
 * 按 ADR-005 第 4 条纪律：这里必须明确告知 Key 是明文存本机的。
 */
export function SettingsPanel() {
  const clearLogs = useCompileStore((s) => s.clearLogs)
  const bookId = useUiStore((s) => s.bookId)
  const setBookId = useUiStore((s) => s.setBookId)

  const [baseUrl, setBaseUrl] = useState('')
  const [extractionModel, setExtractionModel] = useState('')
  const [aggregationModel, setAggregationModel] = useState('')
  const [catalog, setCatalog] = useState<string[]>([])
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [configured, setConfigured] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [concurrency, setConcurrencyState] = useState(DEFAULT_CONCURRENCY)
  const [status, setStatus] = useState<Status>({ tone: 'idle', text: '' })
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<{ bytes: Uint8Array; inspect: InspectResult } | null>(null)
  const [storageInfo, setStorageInfo] = useState('')

  async function refresh() {
    const cfg = await getLlmConfig()
    setBaseUrl(cfg.baseUrl)
    setExtractionModel(cfg.extractionModel)
    setAggregationModel(cfg.aggregationModel)
    setConfigured(await isApiKeyConfigured())
    setHint(await getApiKeyHint())
    setConcurrencyState(await getConcurrency())
  }

  useEffect(() => {
    setCatalog(getCatalogModels())
    void refresh()
    void navigator.storage
      ?.estimate?.()
      .then((e) => {
        const mb = (n?: number) => ((n ?? 0) / 1024 / 1024).toFixed(1)
        setStorageInfo(`已用 ${mb(e.usage)} MB / 可用 ${mb(e.quota)} MB`)
      })
      .catch(() => undefined)
  }, [])

  function flash(msg: string) {
    setSaved(msg)
    setTimeout(() => setSaved(null), 2200)
  }

  async function handleSaveModels() {
    await setLlmConfig({
      baseUrl: baseUrl.trim(),
      extractionModel: extractionModel.trim(),
      aggregationModel: aggregationModel.trim(),
    })
    setStatus({ tone: 'success', text: '已保存模型配置' })
    flash('已保存')
  }

  async function handleFetchModels() {
    setStatus({ tone: 'loading', text: '⏳ 正在拉取模型列表…' })
    try {
      const models = await probeFetchModels()
      if (models.length === 0) {
        setStatus({ tone: 'error', text: '❌ 没拉到模型（Key 可能没权限，或服务端不提供 /models）' })
        return
      }
      setCatalog(models)
      // 当前模型不在列表里就选第一个，避免用户对着不存在的模型名发愁
      if (!models.includes(extractionModel)) setExtractionModel(models[0]!)
      if (!models.includes(aggregationModel)) setAggregationModel(models[0]!)
      setStatus({ tone: 'success', text: `✅ 拉到 ${models.length} 个模型，已填入下拉` })
    } catch (e) {
      setStatus({ tone: 'error', text: `❌ ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  async function handleQuickTest() {
    setStatus({ tone: 'loading', text: '⏳ 正在测试连接…' })
    const r = await probeQuickTest('extraction')
    setStatus(
      r.ok
        ? { tone: 'success', text: `✅ 测试成功（${r.elapsedMs}ms）· 模型回复：${r.detail.slice(0, 30)}` }
        : { tone: 'error', text: `❌ ${r.detail.slice(0, 300)}` },
    )
  }

  async function handleExport() {
    if (!bookId) {
      flash('先导入一本书')
      return
    }
    setBusy(true)
    try {
      const { fileName, bytes } = await exportBook(bookId)
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
    setImportPreview({ bytes, inspect: await inspectBackup(bytes) })
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

  const datalistId = 'ww-model-catalog'
  const modelInputCls =
    'w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm outline-none focus:border-neutral-500'

  return (
    <div className="mx-auto max-w-3xl space-y-4 overflow-auto p-6">
      <h2 className="text-lg font-semibold">设置</h2>

      <Section title="模型与 API">
        <Field label="服务地址" hint="留空使用 DeepSeek 官方地址">
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com"
            className="w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm outline-none focus:border-neutral-500"
          />
        </Field>

        <Field label="API Key" hint="本地模型可留空">
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={configured ? (hint ?? '已配置') : '粘贴 DeepSeek API Key'}
              className="flex-1 rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm outline-none focus:border-neutral-500"
            />
            <button
              type="button"
              disabled={apiKeyDraft.trim() === ''}
              onClick={async () => {
                await saveApiKey(apiKeyDraft)
                setApiKeyDraft('')
                await refresh()
                flash('已保存 Key')
              }}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              保存
            </button>
            <button
              type="button"
              disabled={!configured}
              onClick={async () => {
                await removeApiKey()
                await refresh()
                flash('已清除 Key')
              }}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40"
            >
              清除
            </button>
          </div>
        </Field>

        <Field label="提取用模型" hint="P1 逐章提取 —— 调用量最大，选便宜快的">
          <input
            list={datalistId}
            value={extractionModel}
            onChange={(e) => setExtractionModel(e.target.value)}
            className={modelInputCls}
          />
        </Field>

        <Field label="归并用模型" hint="P2/P3 合并人物与串联事件线 —— 选强的">
          <input
            list={datalistId}
            value={aggregationModel}
            onChange={(e) => setAggregationModel(e.target.value)}
            className={modelInputCls}
          />
        </Field>
        <datalist id={datalistId}>
          {catalog.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleSaveModels()}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
          >
            保存配置
          </button>
          <button
            type="button"
            onClick={() => void handleFetchModels()}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            🔄 拉取模型
          </button>
          <button
            type="button"
            disabled={!configured}
            onClick={() => void handleQuickTest()}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40"
          >
            ⚡ 快速测试
          </button>
          <StatusLine status={status} />
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
          导入会<strong>新建一本书</strong>，不会覆盖你现有的数据。
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

