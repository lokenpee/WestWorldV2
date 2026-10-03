/**
 * P2/P3 · 合并世界资产（人物快照 → 人物实体）。
 *
 * 两步（工程约定第 8 节）：
 *   ① 纯代码规则合并 —— 包含关系、版本后缀（提示词判不了的部分留空）
 *   ② AI 别名识别 —— 抓「贾琏 / 琏二爷」这类昵称
 *
 * 合并的 ID 规则（PRD 2.2）：
 *   **不新建、不删除**。每组挑一个成员保留名字作为主名，生成实体 id（P001…）。
 *   真正需要 `mergedInto` 重定向的是 P3 把 **两个已存在的实体** 再合到一起的情形。
 */
import type { Character, StoredCharacterSnapshot } from '@/core/schema/index.ts'
import { AliasGroupsSchema } from '@/core/schema/index.ts'
import { getCanonDb } from '@/core/db/canon.ts'
import { listCharacterSnapshots } from '@/core/db/repo.ts'
import { getEventBus, type EventBus } from '@/core/events/bus.ts'
import { callModel } from '@/core/llm/call.ts'
import { PROMPTS } from '@/core/prompts/index.ts'
import {
  areNamesObviouslySame,
  groupSnapshots,
  normalizeEntryName,
} from './merge-characters.ts'

export interface RunMergeOptions {
  signal?: AbortSignal
  deps?: { call?: typeof callModel }
  bus?: EventBus
  /** 是否调用 AI 做别名识别。没配 API Key 时设为 false 只跑本地规则。 */
  useAi?: boolean
}

export interface RunMergeResult {
  status: 'completed' | 'cancelled'
  snapshotsProcessed: number
  characterCount: number
  /** 被合并掉的快照数（即：多少快照不是独占一个实体） */
  mergedSnapshotCount: number
  aiUsed: boolean
  cost: number
}

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
  groups(): Map<T, T[]> {
    const out = new Map<T, T[]>()
    for (const k of this.parent.keys()) {
      const r = this.find(k)
      const list = out.get(r) ?? []
      list.push(k)
      out.set(r, list)
    }
    return out
  }
}

function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

/** 让模型看的人物名单（每行：id | 主名 | 已知别名）。 */
export function buildAliasInput(snapshots: StoredCharacterSnapshot[]): string {
  const lines = snapshots.map((s) => {
    const aliases = (s.aliases_mentioned ?? []).join('/')
    return `${s.id} | ${s.name} | ${aliases}`
  })
  return lines.join('\n')
}

export async function runMerge(bookId: string, options: RunMergeOptions = {}): Promise<RunMergeResult> {
  const { signal, deps = {}, bus = getEventBus(), useAi = true } = options
  const call = deps.call ?? callModel

  bus.emit({ type: 'task:start', bookId, stage: 'P2', total: 1 })

  const snapshots = await listCharacterSnapshots(bookId)
  if (snapshots.length === 0) {
    bus.emit({ type: 'task:done', bookId, stage: 'P2', completed: 0, failed: 0 })
    return {
      status: 'completed',
      snapshotsProcessed: 0,
      characterCount: 0,
      mergedSnapshotCount: 0,
      aiUsed: false,
      cost: 0,
    }
  }

  let cost = 0
  const uf = new UnionFind<string>()
  for (const s of snapshots) uf.add(s.id)

  // ── ① 本地规则合并 ──
  for (const g of groupSnapshots(snapshots)) {
    const ids = [g.main.id, ...g.others.map((o) => o.id)]
    for (let i = 1; i < ids.length; i += 1) uf.union(ids[0]!, ids[i]!)
  }

  // ── ② AI 别名识别（昵称靠这一步）──
  let aiUsed = false
  if (useAi) {
    bus.emit({ type: 'log', level: 'info', message: '  正在识别别名（AI）…' })
    const res = await call({
      role: 'aggregation',
      system: PROMPTS.detectAliasGroups,
      messages: [{ role: 'user', content: buildAliasInput(snapshots), timestamp: Date.now() }],
      schema: AliasGroupsSchema,
      submitToolDescription: '提交识别出的同人分组。',
      temperature: 0,
      ...(signal ? { signal } : {}),
    })
    for (const u of res.attemptsUsage) cost += u.cost

    if (res.ok && res.data) {
      aiUsed = true
      const byName = new Map<string, string[]>()
      for (const s of snapshots) {
        const key = normalizeEntryName(s.name)
        const list = byName.get(key) ?? []
        list.push(s.id)
        byName.set(key, list)
      }
      for (const group of res.data.groups) {
        const ids: string[] = []
        for (const name of group.names) {
          ids.push(...(byName.get(normalizeEntryName(name)) ?? []))
        }
        for (let i = 1; i < ids.length; i += 1) uf.union(ids[0]!, ids[i]!)
      }
      bus.emit({ type: 'log', level: 'info', message: `  AI 识别出 ${res.data.groups.length} 组同人` })
    } else {
      bus.emit({
        type: 'log',
        level: 'warn',
        message: `  别名识别失败（${res.errorKind ?? 'unknown'}），仅使用本地规则合并`,
      })
    }
  }

  // ── ③ 成组 → 生成实体 ──
  const byId = new Map(snapshots.map((s) => [s.id, s]))
  const groupList = [...uf.groups().values()]

  // 按「最早出现的章节」排序，保证 id 稳定（同样的输入 → 同样的 P001）
  groupList.sort((a, b) => {
    const ka = a.map((id) => byId.get(id)!).sort((x, y) => x.chapterIndex.localeCompare(y.chapterIndex, undefined, { numeric: true }))[0]
    const kb = b.map((id) => byId.get(id)!).sort((x, y) => x.chapterIndex.localeCompare(y.chapterIndex, undefined, { numeric: true }))[0]
    return (ka?.chapterIndex ?? '').localeCompare(kb?.chapterIndex ?? '', undefined, { numeric: true })
  })

  const now = new Date().toISOString()
  const characters: Character[] = groupList.map((ids, idx) => {
    const members = ids.map((id) => byId.get(id)!).filter(Boolean)
    // 主名：取本地规则认为质量最高的那个；只有一个就用它自己
    const local = groupSnapshots(members)[0]
    const main = local?.main ?? members[0]!

    const aliasSet = new Set<string>()
    for (const m of members) {
      aliasSet.add(m.name)
      for (const a of m.aliases_mentioned ?? []) aliasSet.add(a)
    }
    aliasSet.delete(main.name)

    return {
      id: `P${pad3(idx + 1)}`,
      bookId,
      name: main.name,
      aliases: [...aliasSet],
      // ⚠️ 层级判定属于 AI 融合那一步（提示词 03）；没有 AI 时先保守标成 NPC
      roleWeight: 'NPC',
      ...(main.identity ? { identity: main.identity } : {}),
      ...(main.profile ? { profile: main.profile } : {}),
      ...(main.appearance ? { appearance: main.appearance } : {}),
      ...(main.personality ? { personality: main.personality } : {}),
      ...(main.background ? { background: main.background } : {}),
      ...(main.speech_style_sample ? { speechStyleSample: main.speech_style_sample } : {}),
      relations: [],
      sourceSnapshotIds: members.map((m) => m.id),
      updatedAt: now,
    }
  })

  // ── ④ 落库（先清后写，保证重跑幂等）──
  const db = getCanonDb()
  await db.transaction('rw', db.characters, async () => {
    await db.characters.where('bookId').equals(bookId).delete()
    if (characters.length) await db.characters.bulkPut(characters)
  })

  const mergedSnapshotCount = snapshots.length - characters.length
  bus.emit({
    type: 'log',
    level: 'info',
    message: `  人物实体 ${characters.length} 个（合并掉 ${mergedSnapshotCount} 个重复快照）`,
  })
  bus.emit({ type: 'task:done', bookId, stage: 'P2', completed: 1, failed: 0 })

  return {
    status: 'completed',
    snapshotsProcessed: snapshots.length,
    characterCount: characters.length,
    mergedSnapshotCount,
    aiUsed,
    cost,
  }
}

/** 供 UI / 测试用：读取某本书的人物实体。 */
export async function listCharacters(bookId: string): Promise<Character[]> {
  return getCanonDb().characters.where('bookId').equals(bookId).toArray()
}

export { areNamesObviouslySame }
