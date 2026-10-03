import { useEffect, useState } from 'react'
import {
  mergeCharacters,
  unmergeCharacter,
  updateCharacter,
  updateEventLine,
  updateLocation,
  updateNode,
} from '@/core/assets/edit.ts'
import type {
  Character,
  EventLine,
  RoleWeight,
  StoredLocation,
  StoredNode,
} from '@/core/schema/index.ts'

const ROLE_WEIGHTS: RoleWeight[] = ['主要人物', '重要配角', 'NPC', '路人']

export type AssetKind = 'character' | 'location' | 'node' | 'line'

export type AssetItem =
  | { kind: 'character'; item: Character }
  | { kind: 'location'; item: StoredLocation }
  | { kind: 'node'; item: StoredNode }
  | { kind: 'line'; item: EventLine }

type FieldSpec = {
  key: string
  label: string
  multiline?: boolean
  /** 逗号分隔的数组字段 */
  csv?: boolean
}

const FIELDS: Record<AssetKind, FieldSpec[]> = {
  character: [
    { key: 'name', label: '主名' },
    { key: 'aliases', label: '别名（逗号分隔）', csv: true },
    { key: 'identity', label: '身份' },
    { key: 'personality', label: '性格', multiline: true },
    { key: 'background', label: '背景', multiline: true },
    { key: 'appearance', label: '外貌', multiline: true },
  ],
  location: [
    { key: 'name', label: '名称' },
    { key: 'description', label: '描述', multiline: true },
  ],
  node: [
    { key: 'name', label: '事件名称' },
    { key: 'summary', label: '概述', multiline: true },
    { key: 'actors', label: '涉及人物（逗号分隔）', csv: true },
    { key: 'time_text', label: '原文时间（可空）' },
  ],
  line: [
    { key: 'title', label: '事件线名称' },
    { key: 'cause', label: '起因', multiline: true },
    { key: 'process', label: '经过', multiline: true },
    { key: 'result', label: '结果', multiline: true },
  ],
}

function toEditable(item: AssetItem): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of FIELDS[item.kind]) {
    const raw = (item.item as unknown as Record<string, unknown>)[f.key]
    out[f.key] = f.csv
      ? Array.isArray(raw)
        ? raw.join(', ')
        : ''
      : typeof raw === 'string'
        ? raw
        : ''
  }
  return out
}

function fromEditable(kind: AssetKind, values: Record<string, string>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const f of FIELDS[kind]) {
    const v = values[f.key] ?? ''
    if (f.csv) {
      patch[f.key] = v
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
    } else {
      patch[f.key] = v.trim() === '' ? undefined : v
    }
  }
  return patch
}

function Field({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-500">{spec.label}</span>
      {spec.multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full resize-y rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-500"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-500"
        />
      )}
    </label>
  )
}

export function AssetDetail({
  asset,
  allCharacters,
  onClose,
}: {
  asset: AssetItem
  allCharacters: Character[]
  onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => toEditable(asset))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [mergeTarget, setMergeTarget] = useState('')

  // 切换选中项时重置表单
  useEffect(() => {
    setValues(toEditable(asset))
    setSavedAt(0)
  }, [asset])

  async function save() {
    setSaving(true)
    try {
      const patch = fromEditable(asset.kind, values)
      if (asset.kind === 'character') await updateCharacter(asset.item.id, patch)
      else if (asset.kind === 'location') await updateLocation(asset.item.id, patch)
      else if (asset.kind === 'node') await updateNode(asset.item.id, patch)
      else await updateEventLine(asset.item.id, patch)
      setSavedAt(Date.now())
    } finally {
      setSaving(false)
    }
  }

  const id = asset.item.id

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-neutral-200 bg-white">
      <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2">
        <span className="font-mono text-xs text-neutral-400">{id}</span>
        <span className="text-sm font-medium">编辑</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs text-neutral-500 hover:text-neutral-800"
        >
          关闭
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        {FIELDS[asset.kind].map((f) => (
          <Field
            key={f.key}
            spec={f}
            value={values[f.key] ?? ''}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}

        {/* 人物特有：层级 */}
        {asset.kind === 'character' && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">层级</span>
            <select
              value={asset.item.roleWeight}
              onChange={async (e) => {
                await updateCharacter(id, { roleWeight: e.target.value as RoleWeight })
                setSavedAt(Date.now())
              }}
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              {ROLE_WEIGHTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* 事件线特有：状态 */}
        {asset.kind === 'line' && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500">状态</span>
            <select
              value={asset.item.lineStatus}
              onChange={async (e) => {
                await updateEventLine(id, { lineStatus: e.target.value as 'open' | 'closed' })
                setSavedAt(Date.now())
              }}
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value="open">进行中</option>
              <option value="closed">已结束</option>
            </select>
          </label>
        )}

        {/* 人物特有：手动归并 */}
        {asset.kind === 'character' && (
          <div className="rounded border border-neutral-200 p-3">
            <div className="mb-2 text-xs font-medium text-neutral-600">手动归并</div>
            {asset.item.mergedInto ? (
              <div className="space-y-2">
                <p className="text-xs text-neutral-500">
                  已被合并到 <span className="font-mono">{asset.item.mergedInto}</span>
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    await unmergeCharacter(id)
                    setSavedAt(Date.now())
                  }}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
                >
                  撤销归并
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                  className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                >
                  <option value="">选择要并入的人物…</option>
                  {allCharacters
                    .filter((c) => c.id !== id && !c.mergedInto)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id} {c.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!mergeTarget}
                  onClick={async () => {
                    await mergeCharacters(mergeTarget, id)
                    setMergeTarget('')
                    setSavedAt(Date.now())
                  }}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
                >
                  并入
                </button>
              </div>
            )}
            <p className="mt-2 text-[10px] leading-4 text-neutral-400">
              归并是「保留对方、把你标记为已合并」——不删除、可撤销、引用会自动回填。
            </p>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-neutral-200 px-4 py-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {savedAt > 0 && <span className="text-xs text-emerald-600">已保存</span>}
      </footer>
    </aside>
  )
}
