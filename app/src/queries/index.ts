import { useLiveQuery } from 'dexie-react-hooks'
import { getCanonDb } from '@/core/db/canon.ts'
import type {
  Character,
  EventLine,
  Book,
  CompileProgress,
  StoredCharacterSnapshot,
  StoredLocation,
  StoredNode,
} from '@/core/schema/index.ts'

/**
 * UI 的数据订阅层（ADR-012 的 queries/）。
 *
 * 只用 useLiveQuery 做订阅与转发，**不含业务逻辑**。
 * 好处：资产被编辑/删除后，列表**自动刷新** —— 不需要手写"改完记得 refresh"。
 */

export function useBooks(): Book[] | undefined {
  // 同 repo.listBooks：books 没为 createdAt 建索引，不能 orderBy，取回来内存排序
  return useLiveQuery(async () => {
    const rows = await getCanonDb().books.toArray()
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [])
}

export function useProgress(bookId: string | null): CompileProgress | undefined {
  return useLiveQuery(
    async () => (bookId ? getCanonDb().compileProgress.get([bookId, 'P1']) : undefined),
    [bookId],
  )
}

export function useCharacterSnapshots(bookId: string | null): StoredCharacterSnapshot[] | undefined {
  return useLiveQuery(
    async () => (bookId ? getCanonDb().characterSnapshots.where('bookId').equals(bookId).toArray() : []),
    [bookId],
  )
}

export function useLocations(bookId: string | null): StoredLocation[] | undefined {
  return useLiveQuery(
    async () => (bookId ? getCanonDb().locations.where('bookId').equals(bookId).toArray() : []),
    [bookId],
  )
}

export function useNodes(bookId: string | null): StoredNode[] | undefined {
  return useLiveQuery(async () => {
    if (!bookId) return []
    const rows = await getCanonDb().nodes.where('bookId').equals(bookId).toArray()
    return rows.sort((a, b) =>
      a.chapterIndex === b.chapterIndex
        ? a.order - b.order
        : a.chapterIndex.localeCompare(b.chapterIndex, undefined, { numeric: true }),
    )
  }, [bookId])
}

export function useCharacters(bookId: string | null): Character[] | undefined {
  return useLiveQuery(
    async () => (bookId ? getCanonDb().characters.where('bookId').equals(bookId).toArray() : []),
    [bookId],
  )
}

export function useEventLines(bookId: string | null): EventLine[] | undefined {
  return useLiveQuery(async () => {
    if (!bookId) return []
    const rows = await getCanonDb().eventLines.where('bookId').equals(bookId).toArray()
    return rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }, [bookId])
}

