/**
 * P2/P3 · 合并 —— 把逐章抽出来的**快照**向前合并。
 *
 * 用户定的规则：
 *   · **向前合并**：一组快照里保留**最早的那条**（`C3-P002`），把其余的删掉
 *   · id 空着不管，**不重新编号**（重新编号是「入库」时的事）
 *   · 合并结果**写回快照表**（用户接下来就在这张表上编辑）
 *
 * 人物和地点走同一套流程：
 *   ① 本地规则分组（归一化 → 判同 → 并查集）
 *   ② AI 别名识别（抓「贾琏 / 琏二爷」「荣国府 / 贾府」这类）
 *   ③ 保留最早那条，字段融合，删掉其余
 */
import type { StoredCharacterSnapshot, StoredLocationSnapshot } from '@/core/schema/index.ts'
import { AliasGroupsSchema, MergedEntitySchema } from '@/core/schema/index.ts'
import {
  listCharacterSnapshots,
  listLocationSnapshots,
  replaceCharacterSnapshots,
  replaceLocationSnapshots,
} from '@/core/db/repo.ts'
import { getEventBus, type EventBus } from '@/core/events/bus.ts'
import { callModel } from '@/core/llm/call.ts'
import { PROMPTS } from '@/core/prompts/index.ts'
import { areNamesObviouslySame, normalizeEntryName } from './merge-characters.ts'
import { runPool } from './pool.ts'

export interface RunMergeOptions {
  signal?: AbortSignal
  deps?: { call?: typeof callModel }
  bus?: EventBus
  /** 是否用 AI 做别名识别与字段融合 */
  useAi?: boolean
}

export interface RunMergeResult {
  status: 'completed' | 'cancelled'
  /** 合并前 / 后每条剩下的记录数（便于日志显示"合并掉了多少"） */
  characters: { before: number; after: number }
  locations: { before: number; after: number }
  cost: number
}

/** 通用并查集 */
class UnionFind<T> {
  private parent = new Map<T, T>()
  add(x: T): void {
    if (!this.parent.has(x)) this.parent.set(x, x)
  }
  find(x: T): T {
    const p = this.parent.get(x)
    if (p === undefined) {
      this.add(x)
      return x
    }
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }
  union(a: T, b: T): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
  groups(): T[][] {
    const out = new Map<T, T[]>()
    for (const k of this.parent.keys()) {
      const r = this.find(k)
      const list = out.get(r) ?? []
      list.push(k)
      out.set(r, list)
    }
    return [...out.values()]
  }
}

interface Named {
  id: string
  name: string
  aliases_mentioned?: string[]
}

/** 本地规则分组：名字归一化后相同、或互相包含（含单字守卫）。 */
export function groupByName<T extends Named>(items: T[], aliasOf: (item: T) => string[] = () => []): T[][] {
  const uf = new UnionFind<string>()
  for (const it of items) uf.add(it.id)

  const match = (a: string, b: string) => areNamesObviouslySame(a, b)

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]!
      const b = items[j]!
      const hit =
        match(a.name, b.name) ||
        aliasOf(a).some((x) => match(x, b.name)) ||
        aliasOf(b).some((x) => match(x, a.name))
      if (hit) uf.union(a.id, b.id)
    }
  }

  const byId = new Map(items.map((it) => [it.id, it]))
  return uf
    .groups()
    .map((ids) => ids.map((id) => byId.get(id)!))
    // 按组内最早出现的 id 排序（`C3-...` 里的章号越小越早）
    .sort((a, b) => earliestChapter(a.map((x) => x.id)) - earliestChapter(b.map((x) => x.id)))
}

/** 从 `C3-P002` 里取出章号，用来排序。 */
export function earliestChapter(ids: string[]): number {
  const nums = ids
    .map((id) => /^C([\d.]+)-/.exec(id)?.[1])
    .map((x) => (x === undefined ? Number.POSITIVE_INFINITY : Number.parseFloat(x)))
    .filter((n) => Number.isFinite(n))
  return nums.length ? Math.min(...nums) : Number.POSITIVE_INFINITY
}

/** 组内保留哪条：**最早的那条**（用户定的"向前合并"）。 */
export function pickEarliest<T extends { id: string }>(group: T[]): T {
  return [...group].sort((a, b) => earliestChapter([a.id]) - earliestChapter([b.id]))[0]!
}

/** 让模型看的名字列表。 */
function buildAliasInput(items: Named[], kindLabel: string): string {
  const head = `下面是这部小说的${kindLabel}名单（每行：id | 名字 | 其他称呼）。请找出哪些名字其实是同一个。`
  const lines = items.map((s) => `${s.id} | ${s.name} | ${(s.aliases_mentioned ?? []).join('/')}`)
  return [head, '', ...lines].join('\n')
}

/** 用 AI 的分组结果合并并查集。 */
function applyAiGroups(
  uf: UnionFind<string>,
  items: Named[],
  groups: Array<{ canonicalName: string; names: string[] }>,
): void {
  const byName = new Map<string, string[]>()
  for (const it of items) {
    const key = normalizeEntryName(it.name)
    const list = byName.get(key) ?? []
    list.push(it.id)
    byName.set(key, list)
  }
  for (const g of groups) {
    const ids: string[] = []
    for (const name of g.names) ids.push(...(byName.get(normalizeEntryName(name)) ?? []))
    for (let i = 1; i < ids.length; i += 1) uf.union(ids[0]!, ids[i]!)
  }
}

export async function runMerge(bookId: string, options: RunMergeOptions = {}): Promise<RunMergeResult> {
  const { signal, deps = {}, bus = getEventBus(), useAi = true } = options
  const call = deps.call ?? callModel
  let cost = 0

  bus.emit({ type: 'task:start', bookId, stage: 'P2', total: 1 })

  // ── 人物 ──
  const chars = await listCharacterSnapshots(bookId)
  let mergedChars = chars
  if (chars.length > 0) {
    const uf = new UnionFind<string>()
    for (const c of chars) uf.add(c.id)
    for (const g of groupByName(chars, (c) => c.aliases ?? [])) {
      for (let i = 1; i < g.length; i += 1) uf.union(g[0]!.id, g[i]!.id)
    }

    if (useAi) {
      bus.emit({ type: 'log', level: 'info', message: `  识别人物别名（AI）…` })
      const res = await call({
        role: 'aggregation',
        system: PROMPTS.detectAliasGroups,
        messages: [{ role: 'user', content: buildAliasInput(chars, '人物'), timestamp: Date.now() }],
        schema: AliasGroupsSchema,
        submitToolDescription: '提交识别出的同人分组。',
        temperature: 0,
        ...(signal ? { signal } : {}),
      })
      for (const u of res.attemptsUsage) cost += u.cost
      if (res.ok && res.data) {
        applyAiGroups(uf, chars, res.data.groups)
        bus.emit({ type: 'log', level: 'info', message: `  AI 识别出 ${res.data.groups.length} 组同人` })
      } else {
        bus.emit({ type: 'log', level: 'warn', message: `  别名识别失败（${res.errorKind ?? 'unknown'}），仅用本地规则` })
      }
    }

    const byId = new Map(chars.map((c) => [c.id, c]))
    const groups = uf.groups().map((ids) => ids.map((id) => byId.get(id)!).filter(Boolean))

    // 每组：保留最早那条，把其余的信息并进去
    const survivors: StoredCharacterSnapshot[] = groups.map((group) => {
      const keep = pickEarliest(group)
      const others = group.filter((g) => g.id !== keep.id)
      if (others.length === 0) return keep

      const aliases = new Set<string>([...(keep.aliases ?? []), ...(keep.aliases_mentioned ?? [])])
      for (const o of others) {
        aliases.add(o.name)
        for (const a of o.aliases_mentioned ?? []) aliases.add(a)
        for (const a of o.aliases ?? []) aliases.add(a)
      }
      aliases.delete(keep.name)

      const fill = <K extends keyof StoredCharacterSnapshot>(key: K) =>
        keep[key] ?? others.find((o) => o[key] !== undefined)?.[key]

      return {
        ...keep,
        aliases: [...aliases],
        identity: fill('identity'),
        personality: fill('personality'),
        background: fill('background'),
        appearance: fill('appearance'),
        profile: fill('profile'),
        speech_style_sample: fill('speech_style_sample'),
        roleWeight: keep.roleWeight ?? others.find((o) => o.roleWeight)?.roleWeight,
        updatedAt: new Date().toISOString(),
      } as StoredCharacterSnapshot
    })

    // AI 字段融合（只对多快照组，写回保留的那条）
    const multi = survivors.filter((s) => groups.find((g) => g.some((x) => x.id === s.id))!.length > 1)
    if (useAi && multi.length > 0) {
      bus.emit({ type: 'log', level: 'info', message: `  融合 ${multi.length} 组人物字段（AI）…` })
      await runPool(
        multi,
        3,
        async (entity) => {
          const group = groups.find((g) => g.some((x) => x.id === entity.id))!
          const res = await call({
            role: 'aggregation',
            system: PROMPTS.mergeWorldAssets,
            messages: [{ role: 'user', content: JSON.stringify({ snapshots: group }, null, 2), timestamp: Date.now() }],
            schema: MergedEntitySchema,
            submitToolDescription: '提交融合后的人物档案。',
            temperature: 0,
            ...(signal ? { signal } : {}),
          })
          for (const u of res.attemptsUsage) cost += u.cost
          if (!res.ok || !res.data) return

          const fused = res.data.entity
          const mergedAliases = [...new Set([...(entity.aliases ?? []), ...(fused.aliases ?? [])])].filter(
            (a) => a !== (fused.name || entity.name),
          )
          Object.assign(entity, {
            name: fused.name || entity.name,
            aliases: mergedAliases,
            roleWeight: fused.roleWeight,
            identity: fused.identity,
            personality: fused.personality,
            background: fused.background,
            appearance: fused.appearance,
            speech_style_sample: fused.speechStyleSample,
            ...(fused.profile ? { profile: fused.profile } : {}),
            updatedAt: new Date().toISOString(),
          })
        },
        signal,
      )
    }

    mergedChars = survivors
    await replaceCharacterSnapshots(bookId, survivors)
    bus.emit({
      type: 'log',
      level: 'info',
      message: `  人物：${chars.length} 条快照 → ${survivors.length} 条（合并掉 ${chars.length - survivors.length}）`,
    })
  }

  // ── 地点 ──
  const locs = await listLocationSnapshots(bookId)
  let mergedLocs = locs
  if (locs.length > 0) {
    const uf = new UnionFind<string>()
    for (const l of locs) uf.add(l.id)
    for (const g of groupByName(locs)) {
      for (let i = 1; i < g.length; i += 1) uf.union(g[0]!.id, g[i]!.id)
    }

    if (useAi) {
      bus.emit({ type: 'log', level: 'info', message: `  识别地点别名（AI）…` })
      const res = await call({
        role: 'aggregation',
        system: PROMPTS.detectAliasGroups,
        messages: [{ role: 'user', content: buildAliasInput(locs, '地点'), timestamp: Date.now() }],
        schema: AliasGroupsSchema,
        submitToolDescription: '提交识别出的同一地点分组。',
        temperature: 0,
        ...(signal ? { signal } : {}),
      })
      for (const u of res.attemptsUsage) cost += u.cost
      if (res.ok && res.data) applyAiGroups(uf, locs, res.data.groups)
    }

    const byId = new Map(locs.map((l) => [l.id, l]))
    const groups = uf.groups().map((ids) => ids.map((id) => byId.get(id)!).filter(Boolean))

    mergedLocs = groups.map((group) => {
      const keep = pickEarliest(group)
      const others = group.filter((g) => g.id !== keep.id)
      if (others.length === 0) return keep
      return {
        ...keep,
        description: keep.description ?? others.find((o) => o.description)?.description,
        updatedAt: new Date().toISOString(),
      } as StoredLocationSnapshot
    })

    await replaceLocationSnapshots(bookId, mergedLocs)
    bus.emit({
      type: 'log',
      level: 'info',
      message: `  地点：${locs.length} 条快照 → ${mergedLocs.length} 条（合并掉 ${locs.length - mergedLocs.length}）`,
    })
  }

  const cancelled = signal?.aborted ?? false
  if (cancelled) bus.emit({ type: 'task:cancelled', bookId, stage: 'P2' })
  else bus.emit({ type: 'task:done', bookId, stage: 'P2', completed: 1, failed: 0 })

  return {
    status: cancelled ? 'cancelled' : 'completed',
    characters: { before: chars.length, after: mergedChars.length },
    locations: { before: locs.length, after: mergedLocs.length },
    cost,
  }
}
