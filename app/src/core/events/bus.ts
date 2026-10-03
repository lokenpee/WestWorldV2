import type { AppEvent } from './types.ts'

/**
 * 极简事件总线（ADR-010）。
 *
 * 关键约束：**监听器抛错不能影响主流程** —— 逐个 try/catch，
 * 坏掉的监听器只打警告并继续（否则一个 UI bug 会让整本编译崩掉）。
 */
export interface EventBus {
  emit(event: AppEvent): void
  /** 订阅全部事件，返回取消订阅函数。 */
  on(handler: (event: AppEvent) => void): () => void
  /** 只订阅某类事件。 */
  onType<T extends AppEvent['type']>(
    type: T,
    handler: (event: Extract<AppEvent, { type: T }>) => void,
  ): () => void
}

export function createEventBus(): EventBus {
  const handlers = new Set<(event: AppEvent) => void>()

  return {
    emit(event) {
      for (const h of handlers) {
        try {
          h(event)
        } catch (err) {
          // 监听器的问题不该中断编译
          console.warn('[event-bus] 监听器抛出异常，已忽略', err)
        }
      }
    },
    on(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    onType(type, handler) {
      return this.on((event) => {
        if (event.type === type) handler(event as Extract<AppEvent, { type: typeof type }>)
      })
    },
  }
}

/** 全局单例（UI 与 pipeline 共用）。 */
let globalBus: EventBus | null = null
export function getEventBus(): EventBus {
  globalBus ??= createEventBus()
  return globalBus
}
