import { useEffect, useState } from 'react'
import { deleteCharacter, deleteEventLine, deleteLocation, deleteNode } from '@/core/assets/edit.ts'
import { runAll } from '@/core/pipeline/run-all.ts'
import { AssetDetail, type AssetItem } from '@/features/assets/AssetDetail.tsx'
import { CompilePanel } from '@/features/compile/CompilePanel.tsx'
import { ImportPanel } from '@/features/import/ImportPanel.tsx'
import { NetworkPanel } from '@/features/network/NetworkPanel.tsx'
import {
  useBooks,
  useCharacters,
  useEventLines,
  useLocations,
  useNodes,
  useProgress,
} from '@/queries/index.ts'
import { useUiStore } from '@/features/store/ui-store.ts'

const TABS = [
  { key: 'characters', label: '人物' },
  { key: 'locations', label: '地点' },
  { key: 'nodes', label: '事件节点' },
  { key: 'lines', label: '事件线' },
  { key: 'network', label: '事件网络' },
] as const

function Empty({ text }: { text: string }) {
  return <p className="p-6 text-sm text-neutral-400">{text}</p>
}

function Stop({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto text-xs text-neutral-400 hover:text-red-600"
    >
      删除
    </button>
  )
}

/**
 * 资产工作台：导入 → 进度 → 资产浏览/编辑 → 事件网络。
 *
 * 数据通过 queries/ 订阅（useLiveQuery）—— 编辑或删除后列表**自动刷新**。
 * 点任意一项会在右侧打开编辑抽屉。
 */
export function AssetsPanel() {
  const bookId = useUiStore((s) => s.bookId)
  const assetTab = useUiStore((s) => s.assetTab)
  const setAssetTab = useUiStore((s) => s.setAssetTab)
  const setBookId = useUiStore((s) => s.setBookId)
  const [showImport, setShowImport] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [selected, setSelected] = useState<AssetItem | null>(null)

  const books = useBooks()
  const progress = useProgress(bookId)
  const characters = useCharacters(bookId)
  const locations = useLocations(bookId)
  const nodes = useNodes(bookId)
  const lines = useEventLines(bookId)

  // 刷新页面后 store 是空的 —— 自动选最近的一本书，而不是让用户重新导入
  useEffect(() => {
    if (!bookId && books && books.length > 0) setBookId(books[0]!.id)
  }, [bookId, books, setBookId])

  if (!bookId || showImport) {
    return (
      <div className="h-full overflow-auto">
        {showImport && bookId && (
          <div className="border-b border-neutral-200 bg-white px-4 py-2">
            <button
              type="button"
              onClick={() => setShowImport(false)}
              className="text-sm text-neutral-500 hover:text-neutral-800"
            >
              ← 返回当前书籍
            </button>
          </div>
        )}
        <ImportPanel />
      </div>
    )
  }

  const counts = {
    characters: characters?.length ?? 0,
    locations: locations?.length ?? 0,
    nodes: nodes?.length ?? 0,
    lines: lines?.length ?? 0,
  }

  return (
    <div className="flex h-full flex-col">
      {progress && progress.status !== 'idle' && (
        <CompilePanel />
      )}

      <div className="flex items-center gap-1 border-b border-neutral-200 bg-white px-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setAssetTab(t.key)
              setSelected(null)
            }}
            className={
              'border-b-2 px-3 py-2 text-sm transition ' +
              (assetTab === t.key
                ? 'border-neutral-900 font-medium text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-800')
            }
          >
            {t.label}
            {t.key !== 'network' && (
              <span className="ml-1 text-xs text-neutral-400">
                {counts[t.key as keyof typeof counts]}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={rerunning}
            onClick={async () => {
              setRerunning(true)
              try {
                await runAll(bookId)
              } finally {
                setRerunning(false)
              }
            }}
            className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
          >
            {rerunning ? '重跑中…' : '重跑合并'}
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
          >
            导入另一本
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto">
          {assetTab === 'characters' &&
            (counts.characters === 0 ? (
              <Empty text="还没有人物实体。提取+合并完成后会出现在这里。" />
            ) : (
              <ul className="divide-y divide-neutral-100">
                {characters?.map((c) => (
                  <li
                    key={c.id}
                    onClick={() => setSelected({ kind: 'character', item: c })}
                    className={
                      'flex cursor-pointer items-baseline gap-3 px-4 py-2 hover:bg-white ' +
                      (selected?.kind === 'character' && selected.item.id === c.id ? 'bg-white' : '')
                    }
                  >
                    <span className="font-mono text-xs text-neutral-400">{c.id}</span>
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                      {c.roleWeight}
                    </span>
                    {c.mergedInto && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                        → {c.mergedInto}
                      </span>
                    )}
                    {c.aliases.length > 0 && (
                      <span className="text-xs text-neutral-400">别名 {c.aliases.join(' / ')}</span>
                    )}
                    {c.identity && <span className="text-xs text-neutral-500">{c.identity}</span>}
                    <span className="ml-auto text-[10px] text-neutral-400">
                      {c.sourceSnapshotIds.length} 个快照
                    </span>
                    <Stop
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteCharacter(c.id)
                      }}
                    />
                  </li>
                ))}
              </ul>
            ))}

          {assetTab === 'locations' &&
            (counts.locations === 0 ? (
              <Empty text="还没有地点。" />
            ) : (
              <ul className="divide-y divide-neutral-100">
                {locations?.map((l) => (
                  <li
                    key={l.id}
                    onClick={() => setSelected({ kind: 'location', item: l })}
                    className={
                      'flex cursor-pointer items-baseline gap-3 px-4 py-2 hover:bg-white ' +
                      (selected?.kind === 'location' && selected.item.id === l.id ? 'bg-white' : '')
                    }
                  >
                    <span className="font-mono text-xs text-neutral-400">{l.id}</span>
                    <span className="text-sm font-medium">{l.name}</span>
                    {l.description && (
                      <span className="text-xs text-neutral-500">{l.description}</span>
                    )}
                    <Stop
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteLocation(l.id)
                      }}
                    />
                  </li>
                ))}
              </ul>
            ))}

          {assetTab === 'nodes' &&
            (counts.nodes === 0 ? (
              <Empty text="还没有事件节点。" />
            ) : (
              <ul className="divide-y divide-neutral-100">
                {nodes?.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => setSelected({ kind: 'node', item: n })}
                    className={
                      'cursor-pointer px-4 py-2 hover:bg-white ' +
                      (selected?.kind === 'node' && selected.item.id === n.id ? 'bg-white' : '')
                    }
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-xs text-neutral-400">{n.id}</span>
                      <span className="text-sm font-medium">{n.name}</span>
                      <span className="text-xs text-neutral-400">第 {n.chapterIndex} 章</span>
                      {n.eventLineIds && n.eventLineIds.length > 0 && (
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                          {n.eventLineIds.join(' / ')}
                        </span>
                      )}
                      <Stop
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteNode(n.id)
                        }}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">{n.summary}</p>
                    {n.quote && (
                      <p className="mt-1 border-l-2 border-neutral-200 pl-2 text-xs italic text-neutral-400">
                        {n.quote}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ))}

          {assetTab === 'lines' &&
            (counts.lines === 0 ? (
              <Empty text="还没有事件线。跑完串联后会出现在这里。" />
            ) : (
              <ul className="divide-y divide-neutral-100">
                {lines?.map((l) => (
                  <li
                    key={l.id}
                    onClick={() => setSelected({ kind: 'line', item: l })}
                    className={
                      'cursor-pointer px-4 py-3 hover:bg-white ' +
                      (selected?.kind === 'line' && selected.item.id === l.id ? 'bg-white' : '')
                    }
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-xs text-neutral-400">{l.id}</span>
                      <span className="text-sm font-medium">{l.title}</span>
                      <span
                        className={
                          'rounded px-1.5 py-0.5 text-[10px] ' +
                          (l.lineStatus === 'closed'
                            ? 'bg-neutral-100 text-neutral-600'
                            : 'bg-emerald-50 text-emerald-700')
                        }
                      >
                        {l.lineStatus === 'closed' ? '已结束' : '进行中'}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        {l.nodeIds.length} 节点 · 第 {l.chapters[0] ?? '?'}
                        {l.chapters.length > 1 ? `–${l.chapters[l.chapters.length - 1]}` : ''} 章
                      </span>
                      <Stop
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteEventLine(l.id)
                        }}
                      />
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-neutral-600">
                      {l.cause && <p>起因：{l.cause}</p>}
                      {l.process && <p>经过：{l.process}</p>}
                      {l.result && <p>结果：{l.result}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            ))}

          {assetTab === 'network' && <NetworkPanel lines={lines ?? []} nodes={nodes ?? []} />}
        </div>

        {selected && assetTab !== 'network' && (
          <AssetDetail
            asset={selected}
            allCharacters={characters ?? []}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

