import type { Static, TSchema } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

/**
 * 编译一次，缓存复用。
 *
 * 注意：TypeCompiler 在子路径 `@sinclair/typebox/compiler`，
 * 从根导出 import 会拿到 undefined（0.34 版实测）。
 */
type AnyCheck = {
  Check(value: unknown): boolean
  Errors(value: unknown): IterableIterator<{ message: string; path: string }>
}

const compiled = new WeakMap<TSchema, AnyCheck>()

export function compileSchema<T extends TSchema>(schema: T): AnyCheck {
  const cached = compiled.get(schema)
  if (cached) return cached
  const check = TypeCompiler.Compile(schema) as unknown as AnyCheck
  compiled.set(schema, check)
  return check
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] }

/**
 * 校验模型输出。
 *
 * 失败时返回可读错误列表 —— 这些错误会**原样回传给模型**让它自我修正
 * （见 ADR-009：结构化输出校验失败要带错误信息重试）。
 */
export function validate<T extends TSchema>(
  schema: T,
  data: unknown,
): ValidationResult<Static<T>> {
  const check = compileSchema(schema)
  if (check.Check(data)) {
    return { ok: true, value: data as Static<T> }
  }
  const errors = [...check.Errors(data)].map((e) => `${e.path || '/'}: ${e.message}`)
  return { ok: false, errors }
}
