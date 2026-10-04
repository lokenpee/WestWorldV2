import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchModelList, quickTestModel } from '../src/core/llm/probe.ts'

/**
 * 「🔄 拉取模型」与「⚡ 快速测试」的测试。
 *
 * 这两个动作是用户在设置页**当场**判断"配好没有"的依据 ——
 * 它们要是误报（明明不通却说成功），用户会带着错误配置去跑编译，白花钱。
 */

const captured: Array<{ url: string; method: string; authorization: string | null }> = []
const realFetch = globalThis.fetch

function headerOf(headers: unknown, name: string): string | null {
  const rec = (headers ?? {}) as Record<string, string>
  for (const k of Object.keys(rec)) if (k.toLowerCase() === name.toLowerCase()) return rec[k] ?? null
  return null
}

function mockFetch(handler: (url: string) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    captured.push({
      url,
      method: init?.method ?? 'GET',
      authorization: headerOf(init?.headers, 'authorization'),
    })
    return handler(url)
  }) as typeof fetch
}

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  globalThis.fetch = realFetch
  void vi
})

const target = { baseUrl: 'https://api.deepseek.com/', apiKey: 'sk-test-1' }

describe('🔄 拉取模型列表', () => {
  it('成功 → 返回去重且排序的模型名', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({ data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }, { id: 'deepseek-flash' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )

    const models = await fetchModelList(target)
    expect(models).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
  })

  it('⭐ 地址末尾的斜杠会被规整（不会拼出 //models）', async () => {
    mockFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await fetchModelList(target)
    expect(captured[0]?.url).toBe('https://api.deepseek.com/models')
  })

  it('带上 Bearer Token', async () => {
    mockFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await fetchModelList(target)
    expect(captured[0]?.authorization).toBe('Bearer sk-test-1')
  })

  it('HTTP 失败 → 抛出带状态码的错误（用户能看到原因）', async () => {
    mockFetch(() => new Response('{"error":"bad key"}', { status: 401, statusText: 'Unauthorized' }))
    await expect(fetchModelList(target)).rejects.toThrow(/401/)
  })

  it('响应里没有 data 字段 → 返回空数组，不崩', async () => {
    mockFetch(() => new Response('{}', { status: 200 }))
    expect(await fetchModelList(target)).toEqual([])
  })
})

describe('⚡ 快速测试', () => {
  it('成功 → ok + 耗时 + 模型回复', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '好' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const r = await quickTestModel({ ...target, model: 'deepseek-flash' })
    expect(r.ok).toBe(true)
    expect(r.detail).toBe('好')
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('打到 /chat/completions 并把模型名带上', async () => {
    let sentBody = ''
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      captured.push({ url, method: init?.method ?? '', authorization: headerOf(init?.headers, 'authorization') })
      sentBody = String(init?.body ?? '')
      return new Response(JSON.stringify({ choices: [{ message: { content: '好' } }] }), { status: 200 })
    }) as typeof fetch

    await quickTestModel({ ...target, model: 'my-model' })
    expect(captured[0]?.url).toBe('https://api.deepseek.com/chat/completions')
    expect(sentBody).toContain('my-model')
  })

  it('⭐ 401 → ok:false 且带上错误信息（不抛异常）', async () => {
    mockFetch(() => new Response('{"error":{"message":"Authentication Fails"}}', { status: 401, statusText: 'Unauthorized' }))
    const r = await quickTestModel({ ...target, model: 'x' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('401')
  })

  it('网络异常 → ok:false，不抛（设置页不该因为网络问题崩掉）', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch

    const r = await quickTestModel({ ...target, model: 'x' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('Failed to fetch')
  })
})
