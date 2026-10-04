/**
 * 配置探测 —— 学自参考实现的「🔄 拉取模型」与「⚡ 快速测试」。
 *
 * 为什么需要：
 *   配错 Key / 模型名 / 地址，如果等到跑编译才发现，就白花了钱和时间。
 *   这两个动作让用户在设置页**当场**知道"能不能用"。
 */

export interface ProbeTarget {
  baseUrl: string
  apiKey: string
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * 拉取可用模型列表（OpenAI 兼容的 `GET /models`）。
 *
 * 好处有二：① 不用手打模型名（最容易输错的一步） ② 顺便验证 Key 能不能用。
 */
export async function fetchModelList(target: ProbeTarget, signal?: AbortSignal): Promise<string[]> {
  const url = `${normalizeBase(target.baseUrl)}/models`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${target.apiKey}` },
    ...(signal ? { signal } : {}),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${body ? `：${body.slice(0, 200)}` : ''}`)
  }

  const json = (await res.json()) as { data?: Array<{ id?: string }> }
  const ids = (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  return [...new Set(ids)].sort()
}

export interface QuickTestResult {
  ok: boolean
  elapsedMs: number
  /** 成功时是模型的回复片段；失败时是错误信息 */
  detail: string
}

/**
 * 快速测试 —— 真实发一个最小请求。
 *
 * 不走 pi-ai，直接用 fetch：这里要验证的是「地址 + Key + 模型名」三者能不能通，
 * 用最直接的方式最不容易被中间层掩盖问题。
 */
export async function quickTestModel(
  target: ProbeTarget & { model: string },
  signal?: AbortSignal,
): Promise<QuickTestResult> {
  const started = performance.now()
  const url = `${normalizeBase(target.baseUrl)}/chat/completions`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: 'user', content: '回复一个字：好' }],
        max_tokens: 8,
        stream: false,
      }),
      ...(signal ? { signal } : {}),
    })

    const elapsedMs = Math.round(performance.now() - started)
    const body = await res.text()

    if (!res.ok) {
      return {
        ok: false,
        elapsedMs,
        detail: `${res.status} ${res.statusText}${body ? `：${body.slice(0, 300)}` : ''}`,
      }
    }

    let reply = ''
    try {
      const json = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> }
      reply = json.choices?.[0]?.message?.content?.trim() ?? ''
    } catch {
      reply = body.slice(0, 120)
    }

    return { ok: true, elapsedMs, detail: reply || '（模型返回了空内容，但连接是通的）' }
  } catch (e) {
    return {
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}
