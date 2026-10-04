import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Type } from '@sinclair/typebox'

// ── 用假的 pi-ai 替换真实模块（避免测试触网）──
const completeMock = vi.fn()

vi.mock('@earendil-works/pi-ai/models', () => ({
  createModels: () => ({
    setProvider: vi.fn(),
    getModels: () => [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }],
    getModel: (_p: string, id: string) => ({ id, provider: 'deepseek' }),
    complete: completeMock,
  }),
  // provider.ts 会用它构建 provider —— mock 里给一个等价的最小实现
  createProvider: (opts: { id: string; name?: string; baseUrl?: string; models: unknown[] }) => ({
    id: opts.id,
    name: opts.name ?? opts.id,
    baseUrl: opts.baseUrl,
    getModels: () => opts.models,
  }),
}))

// provider.ts 会从 DeepSeek 目录里拿一个模型当模板，所以 mock 必须提供 getModels
vi.mock('@earendil-works/pi-ai/providers/deepseek', () => ({
  deepseekProvider: () => ({
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    getModels: () => [
      {
        id: 'deepseek-flash',
        name: 'DeepSeek Flash',
        api: 'openai-completions',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        reasoning: false,
        input: ['text'],
        cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8000,
      },
    ],
  }),
}))

const { callModel, SUBMIT_TOOL_NAME } = await import('../src/core/llm/call.ts')
const { resetModelsForTest } = await import('../src/core/llm/models.ts')

const ResultSchema = Type.Object({
  name: Type.String(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
})

function assistant(over: Record<string, unknown> = {}) {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-flash',
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0.001, output: 0.002 } },
    stopReason: 'stop',
    ...over,
  }
}

const userMsg = [{ role: 'user' as const, content: 'hi', timestamp: Date.now() }]

describe('callModel：失败判定（pi-ai 不抛异常）', () => {
  beforeEach(() => {
    completeMock.mockReset()
    resetModelsForTest()
  })

  it('401 认证失败 → 立即返回失败，不重试', async () => {
    completeMock.mockResolvedValue(
      assistant({ stopReason: 'error', errorMessage: '401: Authentication Fails' }),
    )
    const r = await callModel({ role: 'extraction', system: 's', messages: userMsg })
    expect(r.ok).toBe(false)
    expect(r.errorKind).toBe('auth')
    expect(r.attempts).toBe(1)
    expect(completeMock).toHaveBeenCalledTimes(1)
  })

  it('429 限流 → 重试（用 Retry-After 缩短等待）', async () => {
    completeMock
      .mockResolvedValueOnce(
        assistant({ stopReason: 'error', errorMessage: '429 rate limited, Retry-After: 0' }),
      )
      .mockResolvedValueOnce(assistant({ content: [{ type: 'text', text: '好了' }] }))

    const r = await callModel({ role: 'extraction', system: 's', messages: userMsg })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
    expect(completeMock).toHaveBeenCalledTimes(2)
  })

  it('每次尝试的用量都被累计（成本统计用）', async () => {
    completeMock
      .mockResolvedValueOnce(
        assistant({ stopReason: 'error', errorMessage: '429 rate limited, Retry-After: 0' }),
      )
      .mockResolvedValueOnce(assistant({ content: [{ type: 'text', text: 'ok' }] }))

    const r = await callModel({ role: 'extraction', system: 's', messages: userMsg })
    expect(r.attemptsUsage).toHaveLength(2)
    expect(r.attemptsUsage[0]?.totalTokens).toBe(15)
  })
})

describe('callModel：结构化输出（submit 工具）', () => {
  beforeEach(() => {
    completeMock.mockReset()
    resetModelsForTest()
  })

  it('模型调了 submit 工具且参数合法 → 返回校验后的数据', async () => {
    completeMock.mockResolvedValue(
      assistant({
        content: [
          {
            type: 'toolCall',
            id: 't1',
            name: SUBMIT_TOOL_NAME,
            arguments: { name: '贾琏', confidence: 0.9 },
          },
        ],
      }),
    )
    const r = await callModel({
      role: 'extraction',
      system: 's',
      messages: userMsg,
      schema: ResultSchema,
    })
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ name: '贾琏', confidence: 0.9 })
  })

  it('模型没调工具（只回了文本）→ 重试，并把要求写回去', async () => {
    completeMock
      .mockResolvedValueOnce(assistant({ content: [{ type: 'text', text: '我抽到了贾琏' }] }))
      .mockResolvedValueOnce(
        assistant({
          content: [
            { type: 'toolCall', id: 't1', name: SUBMIT_TOOL_NAME, arguments: { name: '贾琏', confidence: 0.9 } },
          ],
        }),
      )

    const r = await callModel({
      role: 'extraction',
      system: 's',
      messages: userMsg,
      schema: ResultSchema,
    })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
  })

  it('参数不合法 → 重试，并把校验错误回传给模型', async () => {
    completeMock
      .mockResolvedValueOnce(
        assistant({
          content: [
            { type: 'toolCall', id: 't1', name: SUBMIT_TOOL_NAME, arguments: { name: '贾琏', confidence: 2 } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        assistant({
          content: [
            { type: 'toolCall', id: 't2', name: SUBMIT_TOOL_NAME, arguments: { name: '贾琏', confidence: 0.8 } },
          ],
        }),
      )

    const r = await callModel({
      role: 'extraction',
      system: 's',
      messages: userMsg,
      schema: ResultSchema,
    })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)

    // 第二次调用时，历史里应当多了一条说明校验错误的消息
    const secondCallContext = completeMock.mock.calls[1]?.[1] as { messages: unknown[] }
    const sent = JSON.stringify(secondCallContext.messages)
    expect(sent).toContain('不符合 schema')
  })

  it('无 schema 时直接返回文本', async () => {
    completeMock.mockResolvedValue(assistant({ content: [{ type: 'text', text: '纯文本回复' }] }))
    const r = await callModel({ role: 'extraction', system: 's', messages: userMsg })
    expect(r.ok).toBe(true)
    expect(r.data).toBe('纯文本回复')
  })
})


