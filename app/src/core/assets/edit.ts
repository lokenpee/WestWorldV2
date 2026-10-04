/**
 * 资产编辑 —— 用户在**快照层（草稿）**上操作。
 *
 * 设计要点（用户定的）：
 *   · 用户编辑的就是快照表（characterSnapshots / locationSnapshots / nodes / eventLines）
 *   · 合并 = 向前合并：保留最早的那条，把其余的删掉（id 空着不管）
 *   · 入库是另一个动作（见 core/pipeline/publish.ts），这里只动草稿
 *
 * 所有函数都要 bookId —— 因为**每本书一个库**（ADR-002）。
 */
import type {
  EventLine,
  RoleWeight,
  StoredCharacterSnapshot,
  StoredLocationSnapshot,
  StoredNode,
} from '@/core/schema/index.ts'
import { getCanonDb } from '@/core/db/canon.ts'

// ── 人物快照 ──

export type CharacterSnapshotEdit = Partial<
  Pick<
    StoredCharacterSnapshot,
    'name' | 'aliases' | 'roleWeight' | 'identity' | 'personality' | 'background' | 'appearance'
  >
>

export async function updateCharacterSnapshot(
  bookId: string,
  id: string,
  patch: CharacterSnapshotEdit,
): Promise<void> {
  await getCanonDb(bookId).characterSnapshots.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteCharacterSnapshot(bookId: string, id: string): Promise<void> {
  await getCanonDb(bookId).characterSnapshots.delete(id)
}

/**
 * 手动合并人物：把 `mergeIds` 并入 `keepId`（保留最早的那条）。
 *
 * 规则与自动合并一致：**保留 keepId，其余删掉**。别名与简历信息汇总到保留的那条。
 */
export async function mergeCharacterSnapshots(
  bookId: string,
  keepId: string,
  mergeIds: string[],
): Promise<void> {
  const ids = mergeIds.filter((id) => id !== keepId)
  if (ids.length === 0) return

  const db = getCanonDb(bookId)
  await db.transaction('rw', db.characterSnapshots, async () => {
    const keep = await db.characterSnapshots.get(keepId)
    if (!keep) throw new Error('要保留的那条快照不存在')

    const others = (await db.characterSnapshots.bulkGet(ids)).filter(
      (s): s is StoredCharacterSnapshot => Boolean(s),
    )

    const aliases = new Set<string>([...(keep.aliases ?? []), ...(keep.aliases_mentioned ?? [])])
    for (const o of others) {
      aliases.add(o.name)
      for (const a of o.aliases_mentioned ?? []) aliases.add(a)
      for (const a of o.aliases ?? []) aliases.add(a)
    }
    aliases.delete(keep.name)

    // 保留的那条里没有的字段，从被合并的那里补上（不覆盖已有内容）
    const fill = <K extends keyof StoredCharacterSnapshot>(key: K): StoredCharacterSnapshot[K] | undefined =>
      keep[key] ?? others.find((o) => o[key])?.[key]

    await db.characterSnapshots.update(keepId, {
      aliases: [...aliases],
      roleWeight: keep.roleWeight ?? others.find((o) => o.roleWeight)?.roleWeight,
      identity: fill('identity'),
      personality: fill('personality'),
      background: fill('background'),
      appearance: fill('appearance'),
      updatedAt: new Date().toISOString(),
    })

    await db.characterSnapshots.bulkDelete(ids)
  })
}

/** 改人物层级（用户在 UI 上手动定级）。 */
export async function setCharacterRoleWeight(
  bookId: string,
  id: string,
  roleWeight: RoleWeight,
): Promise<void> {
  await getCanonDb(bookId).characterSnapshots.update(id, {
    roleWeight,
    updatedAt: new Date().toISOString(),
  })
}

// ── 地点快照 ──

export type LocationSnapshotEdit = Partial<Pick<StoredLocationSnapshot, 'name' | 'description'>>

export async function updateLocationSnapshot(
  bookId: string,
  id: string,
  patch: LocationSnapshotEdit,
): Promise<void> {
  await getCanonDb(bookId).locationSnapshots.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteLocationSnapshot(bookId: string, id: string): Promise<void> {
  await getCanonDb(bookId).locationSnapshots.delete(id)
}

/** 手动合并地点：保留 keepId，其余删掉。 */
export async function mergeLocationSnapshots(
  bookId: string,
  keepId: string,
  mergeIds: string[],
): Promise<void> {
  const ids = mergeIds.filter((id) => id !== keepId)
  if (ids.length === 0) return

  const db = getCanonDb(bookId)
  await db.transaction('rw', db.locationSnapshots, async () => {
    const keep = await db.locationSnapshots.get(keepId)
    if (!keep) throw new Error('要保留的那条快照不存在')
    const others = (await db.locationSnapshots.bulkGet(ids)).filter(
      (s): s is StoredLocationSnapshot => Boolean(s),
    )
    await db.locationSnapshots.update(keepId, {
      description: keep.description ?? others.find((o) => o.description)?.description,
      updatedAt: new Date().toISOString(),
    })
    await db.locationSnapshots.bulkDelete(ids)
  })
}

// ── 事件节点 ──

export type NodeEdit = Partial<Pick<StoredNode, 'name' | 'summary' | 'actors' | 'time_text'>>

export async function updateNode(bookId: string, id: string, patch: NodeEdit): Promise<void> {
  await getCanonDb(bookId).nodes.update(id, patch)
}

export async function deleteNode(bookId: string, id: string): Promise<void> {
  await getCanonDb(bookId).nodes.delete(id)
}

// ── 事件线 ──

export type EventLineEdit = Partial<
  Pick<EventLine, 'title' | 'cause' | 'process' | 'result' | 'lineStatus'>
>

export async function updateEventLine(bookId: string, id: string, patch: EventLineEdit): Promise<void> {
  await getCanonDb(bookId).eventLines.update(id, patch)
}

export async function deleteEventLine(bookId: string, id: string): Promise<void> {
  await getCanonDb(bookId).eventLines.delete(id)
}

// ── 入库后的固定资产（只读为主，这里只提供删除）──

export async function deleteCharacter(bookId: string, id: string): Promise<void> {
  await getCanonDb(bookId).characters.delete(id)
}

export async function deleteStoredLocation(bookId: string, id: string): Promise<void> {
  await getCanonDb(bookId).locations.delete(id)
}
