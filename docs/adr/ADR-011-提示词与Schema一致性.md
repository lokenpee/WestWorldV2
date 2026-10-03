---
status: accepted
date: 2026-10-03
decision-makers: 用户（产品负责人）
---

# 提示词的字段表由 TypeBox 自动渲染，手写区与生成区用标记分隔

## Context and Problem Statement

ADR-003 定下"提示词里的字段表必须由 TypeBox schema 生成，不手写"，但**没有定义机制**。

**已经发生过的事故**：P2 提示词里让模型输出 `fact` / `status`，但字段表里定的是 `name`+`summary` / `line_status` —— 模型输出的字段存不进数据库，而且不报错，静默丢失。

根因：**提示词是给模型看的，schema 是给代码看的，两边各自演化就必然不一致**。

## Decision

### 1. 提示词文件是"手写区 + 生成区"的混合体

```markdown
# P1-A · 提取世界资产

## 角色
（手写：角色设定）

## 铁律
1. 只记录文本中确实写到的……
（手写：规则、示例）

## 输出格式

<!-- AUTO-GENERATED:START source=schema/character-snapshot.ts#CharacterSnapshotSchema -->
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 本章主要使用的称呼 |
| `identity` | string? | ⬜ | 身份 / 职务 / 归属 |
……
<!-- AUTO-GENERATED:END -->

## 自检清单
- [ ] ……（手写）
```

**分工明确**：

| 部分 | 谁负责 |
|------|--------|
| 角色设定 / 铁律 / 示例 / 自检清单 | **手写** |
| 字段表（字段名 / 类型 / 必填 / 说明） | **自动生成** |

### 2. 字段说明写在 TypeBox schema 里

字段的中文说明作为 `description` 写在 schema 定义里，渲染时读出来 —— **这样说明本身也只有一个来源**：

```typescript
export const CharacterSnapshotSchema = Type.Object({
  name: Type.String({ description: '本章主要使用的称呼（可能是别名）' }),
  identity: Type.Optional(Type.String({ description: '身份 / 职务 / 归属' })),
  // …
}, { additionalProperties: false });
```

渲染规则：

- 字段名 → `` `name` ``
- 类型 → `string` / `number` / `string[]` / 嵌套对象
- 必填 → `Type.Optional` 的显示 ⬜，否则 ✅
- 说明 → `description`

### 3. 生成脚本

```
pnpm render:prompts
  → 读取 app/src/core/schema/*.ts
  → 定位每个提示词文件里的 AUTO-GENERATED 标记
  → 替换标记之间的内容
```

脚本只改标记之间的部分，**标记之外一个字符都不动**。

### 4. 防漂移：测试 + 一致性检查

两个机制，缺一不可：

1. **测试**：跑一遍渲染，比较渲染结果与磁盘上的内容 —— **有差异就失败**（说明有人改了 schema 但忘了重新渲染，或者手改了生成区）
2. **一致性检查**：提示词里**不允许出现未加标记的字段表**（用正则粗查 markdown 表格里是否出现 schema 里的字段名）

## Consequences

- **好的**：字段名、类型、说明都只有一个来源，`fact` vs `name` 那类事故在结构上不可能再发生。
- **好的**：改 schema 后跑一次 `pnpm render:prompts` 就同步了，成本极低。
- **好的**：手写区（角色、铁律、示例）保持完全的灵活性，不受生成机制约束。
- **坏的**：多了一个构建步骤，忘记跑会被测试拦下来（但这正是想要的效果）。
- **坏的**：字段的 `description` 要写成中文且面向模型（这是一份"元提示词"），写起来需要一点自觉。
- **风险**：复杂的嵌套 schema 渲染成 markdown 表格会比较难读，可能需要降级为"嵌套对象单独一小节"。

## Implementation Plan

- **Affected paths**：`app/scripts/render-prompt-schema.ts`、`app/src/core/schema/*.ts`（补 `description`）、`prompts/**/*.md`（加 AUTO-GENERATED 标记）、`app/tests/prompt-schema-sync.test.ts`、`package.json`（加 `render:prompts` 脚本）
- **Dependencies**：无新增（TypeBox 已有；markdown 表格手写生成即可，不需要额外库）
- **Patterns to follow**：
  - 每个 schema 的每个字段都要有 `description`（中文，面向模型解释）
  - 标记格式统一：`<!-- AUTO-GENERATED:START source=<相对路径>#<导出名> -->`
  - 生成脚本用 `--check` 参数支持"只检查不写入"（给测试用）
- **Patterns to avoid**：
  - ❌ 不要在生成区手写内容（会被覆盖）
  - ❌ 不要在提示词里手写字段表
  - ❌ 不要让脚本改动标记之外的任何内容

### Verification

- [ ] `pnpm render:prompts` 能从 schema 正确渲染出全部 4 份提示词的字段表
- [ ] 改一个 schema 字段名后跑 `pnpm render:prompts --check`，测试失败
- [ ] 手动修改生成区内容后跑 `--check`，测试失败
- [ ] 渲染后，标记之外的文字（角色 / 铁律 / 自检清单）一个字符都没变
- [ ] 全仓库搜索：提示词里不存在未加标记的字段表

## Alternatives Considered

- **手写字段表 + 人工比对**：就是当前状态，**已经出过事故**。
- **把提示词整个从 schema 生成**：会把"铁律""示例""自检清单"这类真正需要人写的东西也框死，得不偿失。
- **运行时动态拼提示词（不落文件）**：提示词不可读、不可 diff、不可手动调，调 prompt 会非常痛苦。
- **只靠 code review 检查一致性**：人会累，机器不会。

## More Information

**什么情况下该重新考虑**：

- 若嵌套 schema 渲染出的表格无法阅读 → 改为"顶层表格 + 嵌套对象分段"
- 若提示词数量增长到 10+ → 考虑按 schema 分组生成

相关：ADR-003（TypeBox 单一来源）、ADR-007（工具 schema 同样来自 TypeBox）、《工程约定》第 6 节
