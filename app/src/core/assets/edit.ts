/**
 * 资产的编辑与删除。
 *
 * 放在 core/assets/ 而不是 features/ 里，是为了让 UI 只调用函数、
 * 不直接碰数据库（ADR-012 第 3 条）。
 */
import type {
  StoredCharacterSnapshot,
  StoredLocation,
  StoredNode,
} from '@/core/schema/index.ts'
import { getCanonDb } from '@/core/db/canon.ts'

/** 只允许改这些字段 —— 避免 UI 误改 id / bookId 这类结构字段。 */
export type CharacterEdit = Partial<
  Pick<StoredCharacterSnapshot, 'name' | 'identity' | 'personality' | 'background' | 'appearance'>
>
export type LocationEdit = Partial<Pick<StoredLocation, 'name' | 'description'>>
export type NodeEdit = Partial<Pick<StoredNode, 'name' | 'summary' | 'actors' | 'time_text'>>

export async function updateCharacter(id: string, patch: CharacterEdit): Promise<void> {
  await getCanonDb().characterSnapshots.update(id, patch)
}

export async function deleteCharacter(id: string): Promise<void> {
  await getCanonDb().characterSnapshots.delete(id)
}

export async function updateLocation(id: string, patch: LocationEdit): Promise<void> {
  await getCanonDb().locations.update(id, patch)
}

export async function deleteLocation(id: string): Promise<void> {
  await getCanonDb().locations.delete(id)
}

export async function updateNode(id: string, patch: NodeEdit): Promise<void> {
  await getCanonDb().nodes.update(id, patch)
}

export async function deleteNode(id: string): Promise<void> {
  await getCanonDb().nodes.delete(id)
}


// ── 事件线 ──

export type EventLineEdit = Partial<Pick<import('@/core/schema/index.ts').EventLine, 'title' | 'cause' | 'process' | 'result' | 'lineStatus'>>

export async function updateEventLine(id: string, patch: EventLineEdit): Promise<void> {
  await getCanonDb().eventLines.update(id, patch)
}

export async function deleteEventLine(id: string): Promise<void> {
  await getCanonDb().eventLines.delete(id)
}
