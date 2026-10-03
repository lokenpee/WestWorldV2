/**
 * 并发池（ADR-008）。
 *
 * 只有十几行 —— 不需要引入任务队列库。
 * 顺序无关：每个章节任务写的是自己那条记录（按 chapterIndex），互不冲突。
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0

  const runners = Array.from({ length: limit }, async () => {
    while (!signal?.aborted) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index] as T
      await worker(item, index)
    }
  })

  await Promise.all(runners)
}
