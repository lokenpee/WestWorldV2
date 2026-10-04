import { useEffect, useMemo, useState } from 'react'
import {
  deleteCharacterSnapshot,
  deleteEventLine,
  deleteLocationSnapshot,
  deleteNode,
} from '@/core/assets/edit.ts'
import { runAll } from '@/core/pipeline/run-all.ts'
import { publishCanon } from '@/core/pipeline/publish.ts'
import { AssetDetail, type AssetItem, type MergeCandidate } from '@/features/assets/AssetDetail.tsx'
import { CompilePanel } from '@/features/compile/CompilePanel.tsx'
import { ImportPanel } from '@/features/import/ImportPanel.tsx'
import { TryOnePanel } from '@/features/assets/TryOnePanel.tsx'
import { NetworkPanel } from '@/features/network/NetworkPanel.tsx'
import {
  useBooks,
  useCharacters,
  useCharacterSnapshots,
  useEventLines,
  useLocationSnapshots,
  useNodes,
  useProgress,
} from '@/queries/index.ts'
import { useUiStore } from '@/features/store/ui-store.ts'
import type { RoleWeight } from '@/core/schema/index.ts'

const TABS = [
  { key: 'characters', label: '人物' },
  { key: 'locations', label: '地点' },
  { key: 'nodes', label: '事件节点' },
  { key: 'lines', label: '事件线' },
  { key: 'network', label: '事件网络' },
] as const

const ROLE_FILTERS: Array<'全部' | RoleWeight> = ['全部', '主要人物', '重要配角', 'NPC', '路人']

function Empty({ text }: { text: string }) {
  return <p className="p-6 text-sm text-neutral-400">{text}</p>
}

function Stop({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-neutral-400 hover:text-red-600">
      删除
    </button>
  )
}

/**
 * 资产工作台：导入 → 进度 → 资产浏览/编辑 → 入库 → 事件网络。
 *
 * ⚠️ 入库前，人物 / 地点列表读的是**快照表（草稿层）**，不是 characters / locations。
 * 点「入库」之后才生成固定资产（游戏只读那一份）。再点一次 = 生成新的一份。
 */
export function AssetsPanel() {
  const bookId = useUiStore((s) => s.bookId)
  const assetTab = useUiStore((s) => s.assetTab)
  const setAssetTab = useUiStore((s) => s.setAssetTab)
  const setBookId = useUiStore((s) => s.setBookId)
  const [showImport, setShowImport] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishedNote, setPublishedNote] = useState<string | null>(null)
  const [selected, setSelected] = useState<AssetItem | null>(null)
  const [trying, setTrying] = useState(false)
  const [roleFilter, setRoleFilter] = useState<'全部' | RoleWeight>('全部')

  const books = useBooks()
  const progress = useProgress(bookId)
  const characterSnapshots = useCharacterSnapshots(bookId)
  const locationSnapshots = useLocationSnapshots(bookId)
  const nodes = useNodes(bookId)
  const lines = useEventLines(bookId)
  // 固定资产（入库后才有）—— 只用来显示"资产包"状态
  const publishedCharacters = useCharacters(bookId)

  // 刷新页面后 store 是空的 —— 自动选最近的一本书，而不是让用户重新导入
  useEffect(() => {
    if (!bookId && books && books.length > 0) setBookId(books[0]!.id)
  }, [bookId, books, setBookId])

  const visibleCharacters = useMemo(() => {
    const list = characterSnapshots ?? []
    return roleFilter === '全部' ? list : list.filter((c) => (c.roleWeight ?? 'NPC') === roleFilter)
  }, [characterSnapshots, roleFilter])

  const publish = async () => {
    if (!bookId) return
    setPublishing(true)
    try {
      const r = await publishCanon(bookId)
      setPublishedNote(
        `已入库：${r.characters} 人物 · ${r.locations} 地点` +
          (r.unmappedNames.length ? ` · ${r.unmappedNames.length} 个名字没匹配上` : ''),
      )
    } finally {
      setPublishing(false)
    }
  }

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
    characters: characterSnapshots?.length ?? 0,
    locations: locationSnapshots?.length ?? 0,
    nodes: nodes?.length ?? 0,
    lines: lines?.length ?? 0,
  }

  const published = (publishedCharacters?.length ?? 0) > 0

  const characterCandidates: MergeCandidate[] = (characterSnapshots ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }))
  const locationCandidates: MergeCandidate[] = (locationSnapshots ?? []).map((l) => ({
    id: l.id,
    name: l.name,
  }))

  return (
    <div className="flex h-full flex-col">
      {progress && progress.status !== 'idle' && <CompilePanel />}

      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 bg-white px-4">
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
        <div className="ml-auto flex items-center gap-2 py-1">
          <span
            className={
              'rounded px-2 py-0.5 text-[10px] ' +
              (published ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500')
            }
            title="入库后生成固定资产，游戏只读这一份；再点一次入库会用当前草稿生成新的一份"
          >
            {published ? `资产包：${publishedCharacters?.length ?? 0} 人物` : '未入库'}
          </span>
          <button
            type="button"
            onClick={() => setTrying(true)}
            className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
          >
            试跑一章
          </button>
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
            {rerunning ? '重跑中…' : '重跑全部'}
          </button>
          <button
            type="button"
            disabled={publishing}
            onClick={() => void publish()}
            className="rounded bg-neutral-900 px-3 py-1 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {publishing ? '入库中…' : '入库'}
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

      {publishedNote && (
        <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-800">
          {publishedNote}
          <button
            type="button"
            onClick={() => setPublishedNote(null)}
            className="ml-auto text-emerald-600 hover:text-emerald-900"
          >
            知道了
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto">
          {assetTab === 'characters' && (
            <>
              <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-neutral-100 bg-neutral-50 px-4 py-1.5">
                {ROLE_FILTERS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoleFilter(r)}
                    className={
                      'rounded px-2 py-0.5 text-[11px] ' +
                      (roleFilter === r
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-500 hover:bg-neutral-200')
                    }
                  >
                    {r}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-neutral-400">草稿层（快照）· 入库后冻结</span>
              </div>
              {visibleCharacters.length === 0 ? (
                <Empty text="还没有人物快照。提取+合并完成后会出现在这里。" />
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {visibleCharacters.map((c) => (
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
                        {c.roleWeight ?? 'NPC'}
                      </span>
                      {(c.aliases?.length ?? 0) > 0 && (
                        <span className="text-xs text-neutral-400">别名 {c.aliases!.join(' / ')}</span>
                      )}
                      {c.identity && <span className="text-xs text-neutral-500">{c.identity}</span>}
                      <Stop
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteCharacterSnapshot(bookId, c.id)
                          setSelected(null)
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {assetTab === 'locations' &&
            ((locationSnapshots?.length ?? 0) === 0 ? (
              <Empty text="还没有地点快照。提取+合并完成后会出现在这里。" />
            ) : (
              <ul className="divide-y divide-neutral-100">
                {locationSnapshots?.map((l) => (
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
                        void deleteLocationSnapshot(bookId, l.id)
                        setSelected(null)
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
                          void deleteNode(bookId, n.id)
                          setSelected(null)
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
                          void deleteEventLine(bookId, l.id)
                          setSelected(null)
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
            bookId={bookId}
            asset={selected}
            mergeCandidates={selected.kind === 'character' ? characterCandidates : locationCandidates}
            onClose={() => setSelected(null)}
            onChanged={() => {
              /* useLiveQuery 会自动刷新，无需手动 */
            }}
          />
        )}
      </div>

      {trying && <TryOnePanel bookId={bookId} onClose={() => setTrying(false)} />}
    </div>
  )
}