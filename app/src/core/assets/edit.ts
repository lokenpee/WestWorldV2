/**
 * 资产的编辑与删除（以及手动归并）。
 *
 * 放在 core/assets/ 而不是 features/ 里，是为了让 UI 只调用函数、
 * 不直接碰数据库（ADR-012 第 3 条）。
 *
 * 原则：**只允许改内容字段，禁止改结构字段**（id / bookId / chapterIndex / 来源引用）——
 * 结构字段被改会让节点与事件线的引用断链。
 */
import type {
  Character,
  EventLine,
  RoleWeight,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredNode,
} from '@/core/schema/index.ts'
import { getCanonDb } from '@/core/db/canon.ts'

// ── 人物快照（P1 原始观察，一般不改，但允许修错）──

export type CharacterSnapshotEdit = Partial<
  Pick<StoredCharacterSnapshot, 'name' | 'identity' | 'personality' | 'background' | 'appearance'>
>

export async function updateCharacterSnapshot(id: string, patch: CharacterSnapshotEdit): Promise<void> {
  await getCanonDb().characterSnapshots.update(id, patch)
}

export async function deleteCharacterSnapshot(id: string): Promise<void> {
  await getCanonDb().characterSnapshots.delete(id)
}

// ── 人物实体（P2/P3 合并产物）──

export type CharacterEdit = Partial<
  Pick<
    Character,
    'name' | 'aliases' | 'roleWeight' | 'identity' | 'personality' | 'background' | 'appearance'
  >
>

export async function updateCharacter(id: string, patch: CharacterEdit): Promise<void> {
  await getCanonDb().characters.update(id, patch)
}

export async function deleteCharacter(id: string): Promise<void> {
  await getCanonDb().characters.delete(id)
}

/** 改人物的层级（主要人物 / 重要配角 / NPC / 路人）。 */
export async function setRoleWeight(id: string, roleWeight: RoleWeight): Promise<void> {
  await getCanonDb().characters.update(id, { roleWeight })
}

/**
 * 手动归并两个人物实体（ADR：支持用户手动归并）。
 *
 * 规则与自动合并一致：**保留 `keepId`，另一个写 `mergedInto` 重定向，并回填引用**。
 * 不删除被合并的实体 —— 可追溯、可撤销、防悬空引用。
 */
export async function mergeCharacters(keepId: string, mergeId: string): Promise<void> {
  if (keepId === mergeId) throw new Error('不能把自己合并到自己')

  const db = getCanonDb()
  await db.transaction('rw', db.characters, db.nodes, db.eventLines, async () => {
    const keep = await db.characters.get(keepId)
    const drop = await db.characters.get(mergeId)
    if (!keep || !drop) throw new Error('人物实体不存在')

    // 1) 合并内容到保留的那个（主名不变，别名汇总）
    const aliases = [...new Set([...keep.aliases, drop.name, ...drop.aliases])].filter(
      (a) => a !== keep.name,
    )
    await db.characters.update(keepId, {
      aliases,
      sourceSnapshotIds: [...new Set([...keep.sourceSnapshotIds, ...drop.sourceSnapshotIds])],
    })

    // 2) 被合并的实体标记重定向（不删）
    await db.characters.update(mergeId, { mergedInto: keepId })

    // 3) 回填引用：事件线里的 characterIds
    const lines = await db.eventLines.where('bookId').equals(keep.bookId).toArray()
    for (const l of lines) {
      if (!l.characterIds.includes(mergeId)) continue
      const next = [...new Set(l.characterIds.map((c) => (c === mergeId ? keepId : c)))]
      await db.eventLines.update(l.id, { characterIds: next })
    }
  })
}

/** 撤销一次手动归并（把 mergedInto 清掉）。 */
export async function unmergeCharacter(id: string): Promise<void> {
  await getCanonDb().characters.update(id, { mergedInto: undefined })
}

// ── 地点 ──

export type LocationEdit = Partial<Pick<StoredLocation, 'name' | 'description'>>

export async function updateLocation(id: string, patch: LocationEdit): Promise<void> {
  await getCanonDb().locations.update(id, patch)
}

export async function deleteLocation(id: string): Promise<void> {
  await getCanonDb().locations.delete(id)
}

// ── 事件节点 ──

export type NodeEdit = Partial<Pick<StoredNode, 'name' | 'summary' | 'actors' | 'time_text'>>

export async function updateNode(id: string, patch: NodeEdit): Promise<void> {
  await getCanonDb().nodes.update(id, patch)
}

export async function deleteNode(id: string): Promise<void> {
  await getCanonDb().nodes.delete(id)
}

// ── 事件线 ──

export type EventLineEdit = Partial<
  Pick<EventLine, 'title' | 'cause' | 'process' | 'result' | 'lineStatus'>
>

export async function updateEventLine(id: string, patch: EventLineEdit): Promise<void> {
  await getCanonDb().eventLines.update(id, patch)
}

export async function deleteEventLine(id: string): Promise<void> {
  await getCanonDb().eventLines.delete(id)
}
