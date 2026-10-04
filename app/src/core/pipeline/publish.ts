/**
 * 入库 —— 把「草稿层」冻结成一份可玩的**资产包**。
 *
 * 用户定的规则：
 *   · 入库前的所有编辑都在快照表（characterSnapshots / locationSnapshots）上做
 *   · 点「入库」才生成 characters / locations（固定资产，游戏只读这一份）
 *   · id 在入库时**重新编码**：`C3-P002` → `P001`（编号顺序不重要，只要稳定）
 *   · `nodes.actors` 存的是人名（P1 原样），入库时映射成 `nodes.actorIds`
 *   · `eventLines.characterIds` 在**同一次入库**里由成员节点的 actorIds 汇总
 *   · 再点一次入库 = 用当前草稿生成**新的一份**资产包（整体重算，不叠加）
 *
 * ⚠️ 草稿表**只读不写**：入库不修改 nodes.actors（否则第二次入库就没名字可映射了）。
 */
import type {
  Character,
  EventLine,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredLocationSnapshot,
  StoredNode,
} from '@/core/schema/index.ts'
import { getEventBus, type EventBus } from '@/core/events/bus.ts'
import { getCanonDb } from '@/core/db/canon.ts'
import { listCharacterSnapshots, listEventLines, listLocationSnapshots, listNodes } from '@/core/db/repo.ts'
import { areNamesObviouslySame, normalizeNameForComparison } from './merge-characters.ts'

export interface PublishOptions {
  bus?: EventBus
}

export interface PublishResult {
  /** 生成的人物实体数 */
  characters: number
  /** 生成的地点实体数 */
  locations: number
  /** 被写入了 actorIds 的节点数 */
  mappedNodes: number
  /** 被重算了 characterIds 的事件线数 */
  mappedLines: number
  /** 没能在人物表里找到对应实体的名字（提示用户可能漏人） */
  unmappedNames: string[]
}

/** 3 位补零：P001 / L001。 */
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

/** 从 `C{章号}-...` 里取章号；取不到就当它排在最后。 */
function chapterNoOf(id: string): number {
  const m = /^C([\d.]+)-/.exec(id)
  return m ? Number.parseFloat(m[1]!) : Number.POSITIVE_INFINITY
}

/** 排序：先按最早出现的章节，再按 id。稳定、可复现（编号顺序本身不重要）。 */
function byChapterThenId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ca = chapterNoOf(a.id)
    const cb = chapterNoOf(b.id)
    if (ca !== cb) return ca - cb
    return a.id.localeCompare(b.id, undefined, { numeric: true })
  })
}

/** 人物快照上的所有称呼（主名 + aliases_mentioned + 合并后填的 aliases）。 */
function allNamesOf(s: StoredCharacterSnapshot): string[] {
  const set = new Set<string>()
  if (s.name.trim()) set.add(s.name)
  for (const a of s.aliases_mentioned ?? []) if (a.trim()) set.add(a)
  for (const a of s.aliases ?? []) if (a.trim()) set.add(a)
  return [...set]
}

/**
 * 人名 → 实体 id 的解析器。
 *
 * 先精确匹配（归一化后相等），不行再模糊匹配（互相包含），**只有唯一命中才认** ——
 * 命中多个宁可不认，也不猜错。
 */
export function createNameResolver(entries: Array<{ id: string; names: string[] }>): (name: string) => string | undefined {
  const index = new Map<string, string>()
  for (const e of entries) {
    for (const n of e.names) {
      const key = normalizeNameForComparison(n)
      if (key && !index.has(key)) index.set(key, e.id)
    }
  }
  const cache = new Map<string, string | undefined>()

  return (name: string): string | undefined => {
    const raw = name.trim()
    if (!raw) return undefined
    if (cache.has(raw)) return cache.get(raw)
    const key = normalizeNameForComparison(raw)

    let hit = index.get(key)
    if (!hit) {
      const candidates = new Set<string>()
      for (const [k, id] of index) {
        if (areNamesObviouslySame(k, key)) candidates.add(id)
      }
      if (candidates.size === 1) hit = [...candidates][0]
    }

    cache.set(raw, hit)
    return hit
  }
}

/** 快照 → 人物实体（重编码 id）。 */
export function toCharacterEntity(bookId: string, s: StoredCharacterSnapshot, id: string): Character {
  const aliases = [...new Set(allNamesOf(s))].filter((a) => a !== s.name)
  return {
    id,
    bookId,
    ...(s.chapterIndex ? { chapterIndex: s.chapterIndex } : {}),
    name: s.name,
    aliases,
    roleWeight: s.roleWeight ?? 'NPC',
    ...(s.identity !== undefined ? { identity: s.identity } : {}),
    ...(s.profile !== undefined ? { profile: s.profile } : {}),
    ...(s.appearance !== undefined ? { appearance: s.appearance } : {}),
    ...(s.personality !== undefined ? { personality: s.personality } : {}),
    ...(s.background !== undefined ? { background: s.background } : {}),
    ...(s.speech_style_sample !== undefined ? { speechStyleSample: s.speech_style_sample } : {}),
    relations: s.relations ?? [],
    confidence: s.confidence,
    ...(s.updatedAt !== undefined ? { updatedAt: s.updatedAt } : {}),
  }
}

/** 快照 → 地点实体（重编码 id）。 */
export function toLocationEntity(bookId: string, s: StoredLocationSnapshot, id: string): StoredLocation {
  return {
    id,
    bookId,
    ...(s.chapterIndex ? { chapterIndex: s.chapterIndex } : {}),
    name: s.name,
    ...(s.description !== undefined ? { description: s.description } : {}),
    confidence: s.confidence,
    ...(s.updatedAt !== undefined ? { updatedAt: s.updatedAt } : {}),
  }
}

/** 事件线的涉及人物 = 成员节点 actorIds 的并集（保持节点先后顺序）。 */
export function deriveLineCharacterIds(nodeIds: string[], nodeById: Map<string, StoredNode>): string[] {
  const out = new Set<string>()
  for (const id of nodeIds) {
    const n = nodeById.get(id)
    if (!n) continue
    for (const cid of n.actorIds ?? []) out.add(cid)
  }
  return [...out]
}

/**
 * 执行入库。会**整体重算** characters / locations / nodes.actorIds / eventLines.characterIds。
 */
export async function publishCanon(bookId: string, options: PublishOptions = {}): Promise<PublishResult> {
  const { bus = getEventBus() } = options
  const db = getCanonDb(bookId)

  const [charSnaps, locSnaps, nodes, lines] = await Promise.all([
    listCharacterSnapshots(bookId),
    listLocationSnapshots(bookId),
    listNodes(bookId),
    listEventLines(bookId),
  ])

  bus.emit({ type: 'log', level: 'info', message: `入库：${charSnaps.length} 人物 / ${locSnaps.length} 地点 / ${nodes.length} 节点 / ${lines.length} 事件线` })

  // ① 重新编号（草稿表里保留的是「向前合并」后最早的那条快照）
  const sortedChars = byChapterThenId(charSnaps)
  const sortedLocs = byChapterThenId(locSnaps)

  const characters = sortedChars.map((s, i) => toCharacterEntity(bookId, s, `P${pad3(i + 1)}`))
  const locations = sortedLocs.map((s, i) => toLocationEntity(bookId, s, `L${pad3(i + 1)}`))

  // ② 人名 → 实体 id
  const resolve = createNameResolver(
    sortedChars.map((s, i) => ({ id: `P${pad3(i + 1)}`, names: allNamesOf(s) })),
  )

  const unmappedNames = new Set<string>()
  const nodeById = new Map<string, StoredNode>()
  const nodeUpdates: Array<{ id: string; actorIds: string[] }> = []

  for (const n of nodes) {
    const ids = new Set<string>()
    for (const name of [...n.actors, ...(n.targets ?? [])]) {
      const id = resolve(name)
      if (id) ids.add(id)
      else unmappedNames.add(name)
    }
    const next: StoredNode = { ...n, actorIds: [...ids] }
    nodeById.set(n.id, next)
    nodeUpdates.push({ id: n.id, actorIds: next.actorIds! })
  }

  // ③ 事件线：characterIds 由成员节点汇总（不重新读旧值，天然幂等）
  const lineUpdates = lines.map((l) => ({
    id: l.id,
    characterIds: deriveLineCharacterIds(l.nodeIds, nodeById),
  }))

  // ④ 一次性落库
  await db.transaction('rw', db.characters, db.locations, db.nodes, db.eventLines, async () => {
    await db.characters.clear()
    await db.locations.clear()
    if (characters.length) await db.characters.bulkPut(characters)
    if (locations.length) await db.locations.bulkPut(locations)
    for (const u of nodeUpdates) await db.nodes.update(u.id, { actorIds: u.actorIds })
    for (const u of lineUpdates) await db.eventLines.update(u.id, { characterIds: u.characterIds })
  })

  const unmapped = [...unmappedNames]
  if (unmapped.length) {
    bus.emit({
      type: 'log',
      level: 'warn',
      message: `入库：有 ${unmapped.length} 个名字没匹配上人物（${unmapped.slice(0, 5).join('、')}${unmapped.length > 5 ? '…' : ''}）`,
    })
  }
  bus.emit({ type: 'log', level: 'info', message: `入库完成：${characters.length} 人物 / ${locations.length} 地点` })

  return {
    characters: characters.length,
    locations: locations.length,
    mappedNodes: nodeUpdates.length,
    mappedLines: lineUpdates.length,
    unmappedNames: unmapped,
  }
}

/** 事件线草稿上「涉及人物」的可读展示（入库前用，按 id 拿不到就退回节点 actors）。 */
export function lineCharacterNames(line: EventLine, nodes: StoredNode[]): string[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const out = new Set<string>()
  for (const id of line.nodeIds) {
    for (const a of nodeById.get(id)?.actors ?? []) out.add(a)
  }
  return [...out]
}