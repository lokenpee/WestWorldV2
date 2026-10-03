import { useRef, useState } from 'react'
import { decodeBytes, decodeWith, type DecodeResult } from '@/core/pipeline/decode-text.ts'
import { importBook } from '@/core/pipeline/import-book.ts'
import { runP1 } from '@/core/pipeline/run-p1.ts'
import { splitChapters, type ChapterDraft } from '@/core/pipeline/split-chapters.ts'
import { useUiStore } from '@/features/store/ui-store.ts'

interface Preview {
  fileName: string
  bytes: ArrayBuffer
  decode: DecodeResult
  chapters: ChapterDraft[]
}

/**
 * 导入面板：选文件 → 解码 → 分章预览 → 开始提取。
 *
 * 分章预览这一屏很重要 —— 分章错了，后面全白跑，而且分章是**唯一不花钱就能验证**的环节。
 */
export function ImportPanel() {
  const setBookId = useUiStore((s) => s.setBookId)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setError(null)
    const bytes = await file.arrayBuffer()
    const decode = decodeBytes(bytes)
    const chapters = splitChapters(decode.text)
    setPreview({ fileName: file.name, bytes, decode, chapters })
  }

  function reDecode(encoding: 'utf-8' | 'gbk') {
    if (!preview) return
    const text = decodeWith(preview.bytes, encoding)
    setPreview({ ...preview, decode: { text, encoding, ok: true }, chapters: splitChapters(text) })
  }

  async function start() {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const bookId = `bk_${Date.now().toString(36)}`
      const title = preview.fileName.replace(/\.[^.]+$/, '')
      await importBook({
        id: bookId,
        title,
        text: preview.decode.text,
        sourceFileName: preview.fileName,
      })
      setBookId(bookId)
      // 不 await：让 UI 立刻进入进度界面，编译在后台跑
      void runP1(bookId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h2 className="text-lg font-semibold">导入小说</h2>
      <p className="mt-1 text-sm text-neutral-500">
        MVP 只支持 <code className="rounded bg-neutral-100 px-1">.txt</code>。中文 txt 常见 GBK 编码，会自动探测。
      </p>

      <div
        className="mt-6 rounded-lg border-2 border-dashed border-neutral-300 bg-white p-8 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) void handleFile(file)
        }}
      >
        <p className="text-sm text-neutral-600">把 txt 拖到这里，或</p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-3 rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
        >
          选择文件
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      </div>

      {error && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {preview && (
        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="font-medium">{preview.fileName}</span>
              <span className="ml-2 text-neutral-500">
                编码 {preview.decode.encoding.toUpperCase()} · 切出 {preview.chapters.length} 章
              </span>
            </div>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => reDecode('utf-8')}
                className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
              >
                按 UTF-8 重读
              </button>
              <button
                type="button"
                onClick={() => reDecode('gbk')}
                className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
              >
                按 GBK 重读
              </button>
            </div>
          </div>

          <div className="mt-3 max-h-64 overflow-auto rounded border border-neutral-100">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-neutral-50 text-neutral-500">
                <tr>
                  <th className="px-2 py-1 font-normal">#</th>
                  <th className="px-2 py-1 font-normal">章节名</th>
                  <th className="px-2 py-1 text-right font-normal">字数</th>
                </tr>
              </thead>
              <tbody>
                {preview.chapters.slice(0, 200).map((c) => (
                  <tr key={c.chapterIndex} className="border-t border-neutral-100">
                    <td className="px-2 py-1 text-neutral-400">{c.chapterIndex}</td>
                    <td className="px-2 py-1">{c.chapterName}</td>
                    <td className="px-2 py-1 text-right text-neutral-500">{c.charCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.chapters.length > 200 && (
              <p className="px-2 py-2 text-xs text-neutral-400">
                只显示前 200 章（共 {preview.chapters.length} 章）
              </p>
            )}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {busy ? '正在导入…' : '确认并开始提取'}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="text-sm text-neutral-500 hover:text-neutral-800"
            >
              换一个文件
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
