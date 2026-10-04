import { useLiveQuery } from 'dexie-react-hooks'
import { getCanonDb } from '@/core/db/canon.ts'
import { getSettingsDb } from '@/core/db/settings.ts'
import type {
  Character,
  EventLine,
  Book,
  CompileProgress,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredLocationSnapshot,
  StoredNode,
} from '@/core/schema/index.ts'

/**
 * UI 的数据订阅层（ADR-012 的 queries/）。
 *
 * 只用 useLiveQuery 做订阅与转发，**不含业务逻辑**。
 * 好处：资产被编辑/删除后，列表**自动刷新** —— 不需要手写"改完记得 refresh"。
 *
 * 分两层：
 *   · 快照（draft）：P1 产出 + P2/P3 合并 + 用户编辑，**入库前**看这些
 *   · 实体（frozen）：入库后生成，游戏只读这些
 */

const byId = <T extends { id: string }>(rows: T[]): T[] =>
  rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

export function useBooks(): Book[] | undefined {
  // 书架在设置库（跨书全局）；createdAt 没建索引，取回来内存排序
  return useLiveQuery(async () => {
    const rows = await getSettingsDb().books.toArray()
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [])
}

export function useProgress(bookId: string | null): CompileProgress | undefined {
  return useLiveQuery(async () => {
    if (!bookId) return undefined
    return getCanonDb(bookId).compileProgress.get('P1')
  }, [bookId])
}

// ── 草稿层（入库前编辑的对象）──

export function useCharacterSnapshots(bookId: string | null): StoredCharacterSnapshot[] | undefined {
  return useLiveQuery(
    async () => (bookId ? byId(await getCanonDb(bookId).characterSnapshots.toArray()) : []),
    [bookId],
  )
}

export function useLocationSnapshots(bookId: string | null): StoredLocationSnapshot[] | undefined {
  return useLiveQuery(
    async () => (bookId ? byId(await getCanonDb(bookId).locationSnapshots.toArray()) : []),
    [bookId],
  )
}

export function useNodes(bookId: string | null): StoredNode[] | undefined {
  return useLiveQuery(async () => {
    if (!bookId) return []
    const rows = await getCanonDb(bookId).nodes.toArray()
    return rows.sort((a, b) =>
      a.chapterIndex === b.chapterIndex
        ? a.order - b.order
        : a.chapterIndex.localeCompare(b.chapterIndex, undefined, { numeric: true }),
    )
  }, [bookId])
}

export function useEventLines(bookId: string | null): EventLine[] | undefined {
  return useLiveQuery(
    async () => (bookId ? byId(await getCanonDb(bookId).eventLines.toArray()) : []),
    [bookId],
  )
}

// ── 实体层（入库后才有的固定资产）──

export function useCharacters(bookId: string | null): Character[] | undefined {
  return useLiveQuery(
    async () => (bookId ? byId(await getCanonDb(bookId).characters.toArray()) : []),
    [bookId],
  )
}

export function useLocations(bookId: string | null): StoredLocation[] | undefined {
  return useLiveQuery(
    async () => (bookId ? byId(await getCanonDb(bookId).locations.toArray()) : []),
    [bookId],
  )
}