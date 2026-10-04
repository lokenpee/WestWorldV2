---
status: accepted
date: 2026-10-03
decision-makers: 用户（产品负责人）
---

# 采用 TypeBox 作为「业务数据 Schema」的唯一来源（数据库 Schema 另行独立维护）

## Context and Problem Statement

**已经发生过一次真实事故**：P2 提示词里让模型输出 `fact` / `status`，但 PRD 的字段表里定的是 `name`+`summary` / `line_status`。后果是**模型输出的字段存不进数据库，而且不报错，只会静默丢失**。

根因是同一个业务数据的形状要在**三处**重复手写：

1. TypeScript 类型（代码里怎么用）
2. 提示词里的字段说明表（让模型怎么输出）
3. 运行时校验（模型输出合不合法）

三处手写 = 迟早不一致，而且不一致是**静默失败**。

**2026-10-03 追加的约束**：项目已决定采用 **PI（`@earendil-works/pi-ai`）作为 Agent 底座**（见 ADR-004 / 006）。PI 的 `Tool` 类型用 **TypeBox** 定义参数。

如果业务数据继续用 Zod，项目里就会同时存在 **两套 schema 系统**（TypeBox 管工具参数、Zod 管业务数据），是纯负担。

## Decision

**项目统一使用 TypeBox 作为「业务数据 Schema」的唯一来源。**

```
app/src/core/schema/*.ts   （TypeBox 定义，唯一手写处）
   ├─→ Static<typeof T>            → TypeScript 类型
   ├─→ T（本身即 JSON Schema）      → 模型 structured output 的 schema
   ├─→ TypeCompiler.Compile(T)     → 运行时校验（不合法则带错误重试）
   └─→ 渲染脚本                    → 提示词里的字段说明表（markdown 表格）
```

**同时明确划清边界**：

> **数据库 Schema（表结构 + 索引）独立维护，不由 TypeBox 生成。**

理由：**业务数据的形状** 与 **存储的索引设计** 是两个不同的问题。后者取决于查询模式（`chapterIndex`、`order`、`name` 这些是为特定查询而建的），强行从业务 schema 派生索引设计会把两件事绑死。

**Non-goals（明确不做）**：

- 不手写 TypeScript `interface` 来描述同一批业务数据
- 不在提示词里手写字段表（必须由 schema 渲染）
- **不用 TypeBox 替代 Dexie 的表结构与索引声明**
- **不引入 Zod**（与 PI 生态冲突，见上）

## Consequences

- **好的**：改业务字段只改一处，类型、校验、提示词同时更新 —— `fact` vs `name` 那类事故在结构上被消除。
- **好的**：与 PI 生态零摩擦 —— 工具参数、业务数据、模型输出全用 TypeBox，没有转换层。
- **好的**：TypeBox 的 schema **本身就是 JSON Schema**（不需要 `zodToJsonSchema` 这类转换）。
- **好的**：数据库索引可以按查询需求自由设计，不被业务 schema 绑架。
- **坏的**：**业务 Schema 与数据库字段有两个来源**，存在漂移风险（缓解：见下）。
- **坏的**：TypeBox 的 API 比 Zod 啰嗦（`Type.Object({...})` vs `z.object({...})`），且类型推导的错误信息不如 Zod 友好。
- **风险**：TypeBox 的 `Static<>` 在复杂联合类型上的推导可能不如 Zod 直观，需要实测。

### 防漂移措施（这个决定成立的前提）

必须写一个测试，保证两边不会各自演化：

- 从 Dexie 的 store 定义里取出字段名集合
- 与对应 TypeBox schema 的 properties 比对
- **不一致就测试失败**

索引名与字段名在 `app/src/core/db/indexes.ts` 里声明常量，Dexie 声明与测试都引用同一份常量。

## Implementation Plan

- **Affected paths**：`app/src/core/schema/`、`app/src/core/db/indexes.ts`、`app/src/core/prompts/`、`app/scripts/render-prompt-schema.ts`、`app/tests/schema-db-drift.test.ts`
- **Dependencies**：`@sinclair/typebox`（PI 已依赖，见 ADR-004）
- **Patterns to follow**：
  - 每个核心实体一个文件：`character.ts`、`location.ts`、`node.ts`、`event-line.ts`
  - 每个文件导出 `Schema`（TypeBox schema）与 `type X = Static<typeof Schema>`
  - 用 `TypeCompiler.Compile(Schema)` 做运行时校验，编译一次后复用（不要每次校验都编译）
  - 提示词字段表由 `pnpm render:prompts` 生成，生成的表格带"自动生成，勿手改"标记
  - 模型输出校验失败时，把校验错误回传给模型重试
- **Patterns to avoid**：
  - ❌ 不要手写 `interface Character { ... }` 与 TypeBox schema 并存
  - ❌ 不要在提示词模板里手写字段表
  - ❌ 不要让 TypeBox 去生成 `stores()` 声明
  - ❌ 不要引入 Zod（会造成两套 schema 系统）
  - ❌ 不要在业务代码里绕过校验直接 `JSON.parse` 模型输出

### Verification

- [ ] `app/src/core/schema/` 里每个实体只有一个 TypeBox 定义，没有平行的手写 interface
- [ ] 改一个业务字段名后，`pnpm typecheck` 立即报出所有未更新的使用点
- [ ] `pnpm render:prompts` 能重新生成提示词字段表，且与 TypeBox schema 一致
- [ ] 传入缺字段 / 类型错误的模型输出，校验能捕获并给出可读错误
- [ ] **漂移测试能在"TypeBox 字段与 Dexie 字段不一致"时失败**（手动制造一次不一致验证它会红）
- [ ] 全仓库搜索：`package.json` 里不存在 `zod`；提示词文件里不存在手写的字段对照表

## Alternatives Considered

- **Zod（原方案，已否决）**：能力与 TypeBox 对等，但 PI 的 `Tool` 类型用 TypeBox —— 会造成两套 schema 系统，或在两者之间做转换。
- **手写 TypeScript 类型 + 手写提示词**：就是当前状态，**已经出过事故**。
- **TypeBox 同时生成数据库表结构**：业务数据形状与索引设计是两个问题，绑死会限制查询优化。
- **不做运行时校验，直接信任模型**：模型会漏字段、写错枚举值，且**静默失败**。

## More Information

**什么情况下该重新考虑**：

- 若 TypeBox 在本项目的复杂联合类型上推导失败 → 局部退回手写 schema + 单独测试
- 若将来放弃 PI → 可以重新评估 Zod（但那时要迁移全部 schema）

相关：ADR-002（Dexie 表结构）、ADR-004（PI / pi-ai）、ADR-007（工具 schema）、《工程约定》第 7 节
