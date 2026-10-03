/**
 * 错误分类（ADR-009）。
 *
 * ⚠️ 前提：**pi-ai 的模型调用失败不抛异常**，而是返回
 * `{ stopReason: 'error', errorMessage: '...' }`（2026-10-03 浏览器 Spike 实测）。
 * 所以错误分类的输入是 errorMessage，不是 catch 到的异常。
 */
export type ErrorKind =
  | 'network'
  | 'rate_limit'
  | 'server'
  | 'auth'
  | 'content_policy'
  | 'context_length'
  | 'unknown'

export interface RetryPolicy {
  retry: boolean
  maxAttempts: number
  /** 基准退避毫秒。实际延迟 = base * 2^attempt * 抖动 */
  baseDelayMs: number
}

/** ADR-009 的重试表。 */
export const RETRY_POLICY: Record<ErrorKind, RetryPolicy> = {
  network: { retry: true, maxAttempts: 3, baseDelayMs: 1000 },
  rate_limit: { retry: true, maxAttempts: 5, baseDelayMs: 1000 },
  server: { retry: true, maxAttempts: 3, baseDelayMs: 1000 },
  auth: { retry: false, maxAttempts: 1, baseDelayMs: 0 },
  content_policy: { retry: false, maxAttempts: 1, baseDelayMs: 0 },
  context_length: { retry: false, maxAttempts: 1, baseDelayMs: 0 },
  unknown: { retry: false, maxAttempts: 1, baseDelayMs: 0 },
}

/** 从 errorMessage 判断错误类型。这是唯一判定错误类型的地方。 */
export function classifyError(stopReason: string, errorMessage?: string): ErrorKind {
  if (stopReason !== 'error') return 'unknown'
  const msg = (errorMessage ?? '').toLowerCase()

  if (!msg) return 'network'
  if (/\b401\b|\b403\b|authentication|unauthorized|invalid.*api.?key|api key.*invalid/.test(msg)) {
    return 'auth'
  }
  if (/\b429\b|rate.?limit|too many requests|quota/.test(msg)) return 'rate_limit'
  if (/\b5\d\d\b|internal server|bad gateway|service unavailable/.test(msg)) return 'server'
  if (/context length|too many tokens|maximum context|context_length_exceeded/.test(msg)) {
    return 'context_length'
  }
  if (/content.?policy|content filter|safety|blocked/.test(msg)) return 'content_policy'
  if (/fetch failed|network|econnreset|etimedout|timeout|aborted/.test(msg)) return 'network'

  return 'unknown'
}

/** 带抖动的指数退避。抖动必须有 —— 并发同时失败时避免重试风暴。 */
export function backoffDelay(attempt: number, baseDelayMs: number): number {
  const base = baseDelayMs * 2 ** attempt
  const jitter = 0.5 + Math.random()
  return Math.round(base * jitter)
}

/** 从 429 的响应里取出 Retry-After（秒），取不到返回 null。 */
export function parseRetryAfter(errorMessage?: string): number | null {
  if (!errorMessage) return null
  const m = /retry[- ]after["\s:]*(\d+)/i.exec(errorMessage)
  if (!m?.[1]) return null
  const seconds = Number(m[1])
  return Number.isFinite(seconds) ? seconds * 1000 : null
}
