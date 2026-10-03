import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSettingsDbForTest } from '../src/core/db/settings.ts'
import { callModel } from '../src/core/llm/call.ts'
import { setApiKey, clearApiKey } from '../src/core/llm/credentials.ts'
import { resetModelsForTest } from '../src/core/llm/models.ts'

/**
 * 验证「Key 存进去 → pi-ai 读出来 → 发到请求头上」这条链路。
 *
 * 这一段如果断了，用户填了 Key 也会报「没有凭据」，而且**很难查**：
 * 从界面看 Key 明明存进去了。
 *
 * 用假 Key + 拦截 fetch：不触网，只看请求头里有没有带上它。
 */

interface CapturedRequest {
  url: string
  authorization: string | null
  apiKeyHeader: string | null
}

const captured: CapturedRequest[] = []
const realFetch = globalThis.fetch

function headerOf(headers: unknown, name: string): string | null {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => String(k).toLowerCase() === name.toLowerCase())
    return hit ? String(hit[1]) : null
  }
  const rec = headers as Record<string, string>
  for (const k of Object.keys(rec)) {
    if (k.toLowerCase() === name.toLowerCase()) return rec[k] ?? null
  }
  return null
}

beforeEach(async () => {
  captured.length = 0
  resetModelsForTest()
  await resetSettingsDbForTest()

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? (input instanceof Request ? input.headers : undefined)) as unknown
    captured.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      authorization: headerOf(headers, 'authorization'),
      apiKeyHeader: headerOf(headers, 'x-api-key'),
    })
    // 假装服务端拒了（我们只关心请求头）
    return new Response(
      JSON.stringify({ error: { message: '401 Authentication Fails (test)', type: 'authentication_error' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
})

afterEach(async () => {
  globalThis.fetch = realFetch
  resetModelsForTest()
  await resetSettingsDbForTest()
})

describe('凭据链路（ADR-005 + ADR-004）', () => {
  it('⭐ 存进 IndexedDB 的 Key 会被 pi-ai 读出来发到请求头', async () => {
    await setApiKey('deepseek', 'sk-test-abc123')

    const res = await callModel({
      role: 'extraction',
      system: '测试',
      messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
    })

    // 请求确实发出去了
    expect(captured.length).toBeGreaterThan(0)
    const req = captured[0]!

    // 打到了 DeepSeek
    expect(req.url).toContain('api.deepseek.com')

    // ⭐ Key 真的带上了（任一形式）
    const carried = req.authorization ?? req.apiKeyHeader
    expect(carried, 'Key 没有被带到请求头上 —— 用户填了 Key 也会报「没有凭据」').toBeTruthy()
    expect(carried).toContain('sk-test-abc123')

    // 服务端拒绝 → pi-ai 不抛异常而是返回 stopReason: 'error'
    expect(res.ok).toBe(false)
    expect(res.errorKind).toBe('auth')
  })

  it('清除 Key 后再调用 → 请求头里不该再有它', async () => {
    await setApiKey('deepseek', 'sk-first')
    await clearApiKey('deepseek')
    resetModelsForTest()

    await callModel({
      role: 'extraction',
      system: '测试',
      messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
    })

    const carried = captured[0]?.authorization ?? captured[0]?.apiKeyHeader ?? null
    expect(carried ?? '').not.toContain('sk-first')
  })

  it('换了 Key 之后，发出去的是新的那个', async () => {
    await setApiKey('deepseek', 'sk-old')
    await setApiKey('deepseek', 'sk-new')

    await callModel({
      role: 'extraction',
      system: '测试',
      messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
    })

    const carried = captured[0]?.authorization ?? captured[0]?.apiKeyHeader ?? ''
    expect(carried).toContain('sk-new')
    expect(carried).not.toContain('sk-old')
  })
})

void vi
