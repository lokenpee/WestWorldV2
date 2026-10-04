/**
 * 按配置构建 pi-ai 的 Provider。
 *
 * 为什么需要这个（而不是直接用 deepseekProvider()）：
 *   用户要能改 baseUrl 与模型名。pi-ai 的公开 API 里 baseUrl 不能按请求覆盖，
 *   但 `ApiKeyAuth.resolve()` 可以返回 baseUrl —— 这是官方留的扩展点。
 *
 * 模型定义从 DeepSeek 的官方目录里拿一份做模板，改 id / provider / baseUrl 即可。
 */
import { createProvider, type Provider } from '@earendil-works/pi-ai/models'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek'

export const DEFAULT_BASE_URL = 'https://api.deepseek.com'

export interface ProviderConfig {
  /** provider id（换厂商时改这个，例如 'custom'） */
  id?: string
  /** API 地址。留空用 DeepSeek 官方地址 */
  baseUrl?: string
  /** 要注册的模型名（至少一个） */
  models: string[]
}

/** 拿一个模型定义当模板（字段齐全，改几个字段就能用）。 */
function modelTemplate() {
  const models = deepseekProvider().getModels()
  const t = models[0]
  if (!t) throw new Error('拿不到模型模板：DeepSeek provider 的目录是空的')
  return t
}

export function buildProvider(cfg: ProviderConfig): Provider {
  const id = cfg.id ?? 'deepseek'
  const baseUrl = cfg.baseUrl?.trim() || DEFAULT_BASE_URL
  const template = modelTemplate()

  return createProvider({
    id,
    name: id === 'deepseek' ? 'DeepSeek' : `${id}（自定义）`,
    baseUrl,
    auth: {
      apiKey: {
        name: 'API Key',
        async resolve({ credential }: { credential?: { key?: string } }) {
          const key = credential?.key
          if (!key) return undefined
          // 返回 AuthResult 的形状：{ auth: ModelAuth, ... }
          return { auth: { apiKey: key, baseUrl } }
        },
      },
    },
    models: [...new Set(cfg.models.filter(Boolean))].map((name) => ({
      ...template,
      id: name,
      name,
      provider: id,
      baseUrl,
    })),
    api: openAICompletionsApi(),
  })
}



