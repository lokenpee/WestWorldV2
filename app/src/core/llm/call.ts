import type { AssistantMessage, Context, Message, Tool, ToolCall } from '@earendil-works/pi-ai'
import type { Static, TSchema } from '@sinclair/typebox'
import { validate } from '@/core/schema/index.ts'
import { getLlmConfig } from '@/core/config/settings.ts'
import {
  backoffDelay,
  classifyError,
  parseRetryAfter,
  RETRY_POLICY,
  type ErrorKind,
} from './errors.ts'
import { getModelsForConfig, resolveModel, type ModelRole } from './models.ts'

/** 结构化输出用的「提交工具」。模型必须调它来交结果。 */
export const SUBMIT_TOOL_NAME = 'submit_result'

export interface CallUsage {
  input: number
  output: number
  totalTokens: number
  /** 本次调用的费用（由 pi-ai 按模型单价算出） */
  cost: number
}

export interface CallModelOptions<T extends TSchema> {
  role: ModelRole
  system: string
  messages: Message[]
  /**
   * 给了 schema 就走**结构化输出**：定义一个只读的「提交工具」，
   * 强制模型通过工具调用交结果，再用 TypeBox 校验工具参数。
   */
  schema?: T
  /** 告诉模型这个提交工具是干什么的（写进工具描述）。 */
  submitToolDescription?: string
  temperature?: number
  signal?: AbortSignal
}

export interface CallModelResult<T> {
  ok: boolean
  data?: T
  stopReason: string
  errorKind?: ErrorKind
  errorMessage?: string
  usage?: CallUsage
  /** 每次尝试的用量（重试会产生多条，用于成本统计） */
  attemptsUsage: CallUsage[]
  attempts: number
}

function toUsage(msg: AssistantMessage): CallUsage {
  const u = msg.usage
  return {
    input: u.input,
    output: u.output,
    totalTokens: u.totalTokens,
    cost: (u.cost?.input ?? 0) + (u.cost?.output ?? 0),
  }
}

/** 拼接 assistant 消息里的文本块。 */
function textOf(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

/** 找模型提交的工具调用。 */
function findSubmitCall(msg: AssistantMessage): ToolCall | undefined {
  return msg.content.find(
    (c): c is ToolCall => c.type === 'toolCall' && c.name === SUBMIT_TOOL_NAME,
  )
}

function buildSubmitTool(schema: TSchema, description?: string): Tool {
  return {
    name: SUBMIT_TOOL_NAME,
    description:
      description ??
      '把提取结果作为结构化数据提交。**必须调用这个工具提交结果**，不要用普通文本回复。',
    parameters: schema,
    constrainedSampling: { type: 'json_schema', strict: 'prefer' },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 统一的模型调用封装。
 *
 * 三件事（ADR-004 / ADR-006 / ADR-009）：
 *   1. ⚠️ **失败不抛异常** —— pi-ai 返回 `stopReason: 'error'`，必须显式检查
 *   2. 结构化输出过 TypeBox 校验，失败把错误回传给模型重试
 *   3. 按错误类型决定是否重试（认证错误立即放弃，限流尊重 Retry-After）
 */
export async function callModel<T extends TSchema>(
  opts: CallModelOptions<T>,
): Promise<CallModelResult<Static<T>>> {
  const cfg = await getLlmConfig()
  const model = resolveModel(opts.role, cfg)
  const models = getModelsForConfig(cfg)
  const attemptsUsage: CallUsage[] = []
  const messages: Message[] = [...opts.messages]

  let attempt = 0
  let lastKind: ErrorKind | undefined
  let lastError: string | undefined
  let lastStopReason = 'unknown'
  /** 累计允许的最大尝试次数：取当前已知策略里最大的那个 */
  const hardCap = Math.max(...Object.values(RETRY_POLICY).map((p) => p.maxAttempts))

  while (attempt < hardCap) {
    attempt += 1

    const tools: Tool[] | undefined = opts.schema
      ? [buildSubmitTool(opts.schema, opts.submitToolDescription)]
      : undefined
    const context: Context = {
      messages,
      ...(opts.system ? { systemPrompt: opts.system } : {}),
      ...(tools ? { tools } : {}),
    }

    const res = await models.complete(model, context, {
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    })

    const usage = toUsage(res)
    attemptsUsage.push(usage)
    lastStopReason = res.stopReason

    // ── 1) 失败：pi-ai 不抛异常，看 stopReason ──
    if (res.stopReason === 'error' || res.stopReason === 'aborted') {
      lastError = res.errorMessage
      lastKind = classifyError(res.stopReason, res.errorMessage)
      const policy = RETRY_POLICY[lastKind]

      if (res.stopReason === 'aborted' || !policy.retry || attempt >= policy.maxAttempts) {
        return {
          ok: false,
          stopReason: res.stopReason,
          errorKind: lastKind,
          ...(lastError ? { errorMessage: lastError } : {}),
          usage,
          attemptsUsage,
          attempts: attempt,
        }
      }

      const retryAfter = lastKind === 'rate_limit' ? parseRetryAfter(res.errorMessage) : null
      await sleep(retryAfter ?? backoffDelay(attempt - 1, policy.baseDelayMs))
      continue
    }

    // ── 2) 没给 schema：直接把文本返回 ──
    if (!opts.schema) {
      return {
        ok: true,
        data: textOf(res) as unknown as Static<T>,
        stopReason: res.stopReason,
        usage,
        attemptsUsage,
        attempts: attempt,
      }
    }

    // ── 3) 给了 schema：校验「提交工具」的参数 ──
    const call = findSubmitCall(res)
    if (!call) {
      lastKind = 'unknown'
      lastError = '模型没有调用 submit_result 工具'
      messages.push({
        role: 'user',
        content:
          `你没有调用 \`${SUBMIT_TOOL_NAME}\` 工具，无法接收结果。请**只通过调用该工具**提交结构化结果，不要用文本回复。`,
        timestamp: Date.now(),
      })
      continue
    }

    const checked = validate(opts.schema, call.arguments)
    if (!checked.ok) {
      lastKind = 'unknown'
      lastError = checked.errors.join('\n')
      messages.push({
        role: 'user',
        content: `你上一次提交的结果不符合 schema，错误如下。请修正后重新调用 \`${SUBMIT_TOOL_NAME}\`：\n${lastError}`,
        timestamp: Date.now(),
      })
      continue
    }

    return {
      ok: true,
      data: checked.value,
      stopReason: res.stopReason,
      usage,
      attemptsUsage,
      attempts: attempt,
    }
  }

  return {
    ok: false,
    stopReason: lastStopReason,
    ...(lastKind ? { errorKind: lastKind } : {}),
    ...(lastError ? { errorMessage: lastError } : {}),
    attemptsUsage,
    attempts: attempt,
  }
}

