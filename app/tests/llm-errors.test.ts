import { describe, expect, it } from 'vitest'
import { backoffDelay, classifyError, parseRetryAfter, RETRY_POLICY } from '../src/core/llm/errors.ts'

describe('错误分类（ADR-009 的重试表的输入）', () => {
  it('401 / invalid api key → auth（不重试）', () => {
    const kind = classifyError('error', '401: Authentication Fails, Your api key: ****-key is invalid')
    expect(kind).toBe('auth')
    expect(RETRY_POLICY[kind].retry).toBe(false)
  })

  it('429 → rate_limit（重试 5 次）', () => {
    const kind = classifyError('error', '429 Too Many Requests')
    expect(kind).toBe('rate_limit')
    expect(RETRY_POLICY[kind].retry).toBe(true)
    expect(RETRY_POLICY[kind].maxAttempts).toBe(5)
  })

  it('5xx → server（重试 3 次）', () => {
    expect(classifyError('error', '502 Bad Gateway')).toBe('server')
    expect(classifyError('error', '503 Service Unavailable')).toBe('server')
  })

  it('上下文超长 → context_length（不重试）', () => {
    const kind = classifyError('error', 'maximum context length exceeded')
    expect(kind).toBe('context_length')
    expect(RETRY_POLICY[kind].retry).toBe(false)
  })

  it('内容被拒 → content_policy（不重试）', () => {
    expect(classifyError('error', 'content policy violation')).toBe('content_policy')
  })

  it('网络错误 → network（重试）', () => {
    expect(classifyError('error', 'fetch failed')).toBe('network')
    expect(classifyError('error', 'ECONNRESET')).toBe('network')
  })

  it('空 errorMessage 当作网络错误', () => {
    expect(classifyError('error', undefined)).toBe('network')
  })

  it('stopReason 不是 error 时返回 unknown', () => {
    expect(classifyError('stop', undefined)).toBe('unknown')
  })
})

describe('退避与 Retry-After', () => {
  it('退避带抖动：同一 attempt 多次调用结果不全相同', () => {
    const samples = Array.from({ length: 20 }, () => backoffDelay(2, 1000))
    expect(new Set(samples).size).toBeGreaterThan(1)
  })

  it('退避落在合理区间（base * 2^attempt 的 0.5x ~ 1.5x）', () => {
    for (let i = 0; i < 50; i += 1) {
      const d = backoffDelay(1, 1000)
      expect(d).toBeGreaterThanOrEqual(1000)
      expect(d).toBeLessThanOrEqual(3000)
    }
  })

  it('能解析 Retry-After 秒数', () => {
    expect(parseRetryAfter('429 rate limited, Retry-After: 12')).toBe(12000)
  })

  it('无 Retry-After 返回 null', () => {
    expect(parseRetryAfter('429 too many requests')).toBeNull()
    expect(parseRetryAfter(undefined)).toBeNull()
  })
})
