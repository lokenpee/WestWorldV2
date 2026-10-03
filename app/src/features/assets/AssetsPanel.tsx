import { useState } from 'react'
import { deleteCharacter, deleteLocation, deleteNode } from '@/core/assets/edit.ts'
import { CompilePanel } from '@/features/compile/CompilePanel.tsx'
import { ImportPanel } from '@/features/import/ImportPanel.tsx'
import { useCharacterSnapshots, useLocations, useNodes, useProgress } from '@/queries/index.ts'
import { useUiStore } from '@/features/store/ui-store.ts'

const TABS = [
  { key: 'characters', label: '人物' },
  { key: 'locations', label: '地点' },
  { key: 'nodes', label: '事件节点' },
] as const

function Empty({ text }: { text: string }) {
  return <p className="p-6 text-sm text-neutral-400">{text}</p>
}

/**
 * 资产工作台：导入 → 进度 → 资产浏览与编辑。
 *
 * 数据全部通过 queries/ 订阅（useLiveQuery）—— 删除/编辑后列表**自动刷新**。
 */
export function AssetsPanel() {
  const bookId = useUiStore((s) => s.bookId)
  const assetTab = useUiStore((s) => s.assetTab)
  const setAssetTab = useUiStore((s) => s.setAssetTab)
  const setSelectedAssetId = useUiStore((s) => s.setSelectedAssetId)
  const [showImport, setShowImport] = useState(false)

  const progress = useProgress(bookId)
  const characters = useCharacterSnapshots(bookId)
  const locations = useLocations(bookId)
  const nodes = useNodes(bookId)

  // 没有书 → 只显示导入
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
  }

  return (
    <div className="flex h-full flex-col">
      {progress && progress.status !== 'idle' && (
        <CompilePanel onCancel={() => useUiStore.getState().setBookId(null)} />
      )}

      <div className="flex items-center gap-1 border-b border-neutral-200 bg-white px-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setAssetTab(t.key)}
            className={
              'border-b-2 px-3 py-2 text-sm transition ' +
              (assetTab === t.key
                ? 'border-neutral-900 font-medium text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-800')
            }
          >
            {t.label}
            <span className="ml-1 text-xs text-neutral-400">{counts[t.key]}</span>
          </button>
        ))}
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
          >
            导入另一本
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {assetTab === 'characters' &&
          (counts.characters === 0 ? (
            <Empty text="还没有人物。提取完成后会出现在这里。" />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {characters?.map((c) => (
                <li
                  key={c.id}
                  className="flex cursor-pointer items-baseline gap-3 px-4 py-2 hover:bg-white"
                  onClick={() => setSelectedAssetId(c.id)}
                >
                  <span className="font-mono text-xs text-neutral-400">{c.id}</span>
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.aliases_mentioned?.length ? (
                    <span className="text-xs text-neutral-400">
                      别名 {c.aliases_mentioned.join(' / ')}
                    </span>
                  ) : null}
                  {c.identity && <span className="text-xs text-neutral-500">{c.identity}</span>}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteCharacter(c.id)
                    }}
                    className="ml-auto text-xs text-neutral-400 hover:text-red-600"
                  >
                    删除
                  </button>
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
                <li key={l.id} className="flex items-baseline gap-3 px-4 py-2 hover:bg-white">
                  <span className="font-mono text-xs text-neutral-400">{l.id}</span>
                  <span className="text-sm font-medium">{l.name}</span>
                  {l.description && (
                    <span className="text-xs text-neutral-500">{l.description}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteLocation(l.id)}
                    className="ml-auto text-xs text-neutral-400 hover:text-red-600"
                  >
                    删除
                  </button>
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
                <li key={n.id} className="px-4 py-2 hover:bg-white">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs text-neutral-400">{n.id}</span>
                    <span className="text-sm font-medium">{n.name}</span>
                    <span className="text-xs text-neutral-400">第 {n.chapterIndex} 章</span>
                    <button
                      type="button"
                      onClick={() => void deleteNode(n.id)}
                      className="ml-auto text-xs text-neutral-400 hover:text-red-600"
                    >
                      删除
                    </button>
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
      </div>
    </div>
  )
}
