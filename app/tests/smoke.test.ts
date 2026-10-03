import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { describe, expect, it } from 'vitest'

// 步骤 0 冒烟测试：确认 TypeBox 与 Vitest 都工作
// 注意：TypeBox 0.34 的 TypeCompiler 在子路径 @sinclair/typebox/compiler，不在根导出
const Ping = Type.Object({
  id: Type.String({ description: '标识' }),
  n: Type.Number({ description: '数值' }),
})

describe('脚手架自检', () => {
  it('TypeBox 能编译并校验', () => {
    const check = TypeCompiler.Compile(Ping)
    expect(check.Check({ id: 'a', n: 1 })).toBe(true)
    expect(check.Check({ id: 'a', n: 'oops' })).toBe(false)
  })

  it('校验失败能给出可读错误', () => {
    const check = TypeCompiler.Compile(Ping)
    const errors = [...check.Errors({ id: 1, n: 2 })]
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.message).toBeTruthy()
  })
})
