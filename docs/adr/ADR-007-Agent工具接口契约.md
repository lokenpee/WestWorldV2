---
status: accepted
date: 2026-10-03
decision-makers: 用户（产品负责人）
---

# 工具接口沿用 pi-ai 的 `Tool` 类型，并在其上强制返回上限与摘要/详情两级

## Context and Problem Statement

PRD 2.7 与提示词里已经出现了这些工具名：

`query_nodes`、`query_event_lines`、`query_characters`、`read_original`、`graph.neighbors`、`graph.path`、`graph.subgraph`

**但一个签名都没有定义** —— 入参是什么、返回什么、返回多少条、超了怎么办，全空着。

两个具体的致命问题：

1. **数据量不可控**：P2 一次要处理 100 章的节点。如果 `query_nodes({chapter_range:["1","100"]})` 返回全部 500 个节点的完整内容，**上下文直接爆炸**。
2. **接口漂移**：工具的参数名如果手写两处（代码 + 提示词），就会重演 `fact` vs `name` 那类事故。

## Decision

### 1. 工具定义沿用 pi-ai 的 `Tool` 类型（TypeBox）

```typescript
import { Type, type Tool } from '@earendil-works/pi-ai';

const queryNodes: Tool = {
  name: 'query_nodes',
  description: '……什么时候用 / 什么时候别用……',
  parameters: Type.Object({
    chapter_range: Type.Optional(Type.Array(Type.String())),
    actor: Type.Optional(Type.String()),
    event_line_id: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number())
  }),
  constrainedSampling: { type: 'json_schema', strict: 'prefer' }
};
```

**参数 schema 是唯一来源**：模型看到的 JSON Schema、参数校验、提示词里的工具说明，全部从它派生（与 ADR-003 一致）。

### 2. 我们在 pi-ai `Tool` 之上的包装

pi-ai 的 `Tool` **没有**返回上限的概念。我们用一个 wrapper 补上：

```typescript
interface OurTool {
  tool: Tool;                              // 给 PI / 模型的执行定义
  kind: 'read' | 'write';                  // ⚠️ 本项目只允许 'read'（ADR-006）
  limits: {
    maxResults: number;
    maxBytes: number;                      // 默认 64 KB
    defaultLimit: number;
  };
  execute(args, ctx): Promise<unknown>;    // 真正执行 + 裁剪
  returns: TSchema;                        // 返回值 schema（用于自检与文档）
}
```

**`kind: 'write'` 在本项目里不存在。**（见 ADR-006：Agent 永不直接写库）

### 3. 返回策略：摘要优先，详情按需

每个查询类工具都必须支持**两级返回**：

| 模式 | 返回什么 | 何时用 |
|------|---------|--------|
| **摘要模式**（默认） | id + 名称 + 一行概述 + 关键字段 | 大范围扫描、找线索 |
| **详情模式**（显式指定 id） | 完整字段（含 quote 原文片段） | 确认某个具体对象 |

**理由**：Agent 先粗看再细查，比一次拉全量省得多。P2 扫 100 章时，摘要模式的差别是"几 KB"和"几百 KB"。

### 4. 超限行为

- 超过 `maxResults`：返回前 N 条 + `truncated: true` + `totalCount`
- 超过 `maxBytes`：逐条裁剪（先去掉 `quote`，再去掉次要字段），并标注 `fields_omitted`
- **截断信息必须让模型看见**，否则它会以为"就这么多"

### 5. M1 的工具清单

#### 查询类（只读，`kind: 'read'`）

| 工具 | 参数 | 返回 | maxResults |
|------|------|------|-----------|
| `query_nodes` | `{ chapter_range?, time_range?, actor?, event_line_id?, status?, limit? }` | 节点**摘要**数组 | 200 |
| `get_node_detail` | `{ ids: string[] }` | 节点**完整**数据 | 20 |
| `query_event_lines` | `{ status?, chapter_range?, character?, limit? }` | 事件线摘要 | 50 |
| `get_event_line_detail` | `{ ids: string[] }` | 事件线完整数据（含全部 node_ids） | 10 |
| `query_characters` | `{ name_like?, roleWeight?, limit? }` | 人物实体摘要 | 100 |
| `get_character_detail` | `{ ids: string[] }` | 人物完整档案 | 20 |
| `read_original` | `{ chapter_range: [string, string], maxChars? }` | 原文文本 | 限 20 万字/次 |
| `graph_neighbors` | `{ id, depth?, edge_types? }` | 邻居节点 + 边 | 100 |
| `graph_path` | `{ from, to, maxDepth? }` | 路径（节点 + 边序列） | — |
| `graph_subgraph` | `{ seed_ids, depth }` | 子图（节点 + 边） | 100 |

#### 写入类

**没有。**（见 ADR-006）

写入意图通过 Agent 的**最终结构化输出**返回，由代码校验后执行。

### 6. 工具错误怎么返回给模型

工具执行失败时**不中断循环**，返回结构化错误，让模型自己决定下一步：

```json
{ "error": "INVALID_ARGS", "message": "chapter_range 必须是两个字符串", "hint": "例如 [\"80\", \"120\"]" }
```

错误码：`INVALID_ARGS` / `NOT_FOUND` / `TOO_LARGE` / `INTERNAL`

**只有** `INTERNAL`（代码 bug）才中断整个 run。

## Consequences

- **好的**：工具 schema 直接就是 pi-ai 认的格式，无需转换层。
- **好的**：数据量有硬上限，上下文不会因为一次工具调用爆炸。
- **好的**：截断信息对模型可见，它会知道结果不完整并收窄查询。
- **坏的**：两级返回让工具数量翻倍（`query_nodes` + `get_node_detail`），实现工作量大一些。
- **坏的**：`maxResults` / `maxBytes` 的默认值需要实测调整。
- **风险**：`read_original` 一次最多 20 万字，若 Agent 频繁调用会导致 token 成本飙升 —— 必须在可观测性里单独统计调用次数。

## Implementation Plan

- **Affected paths**：`app/src/core/tools/`（每个工具一个文件 + `registry.ts`）、`app/src/core/tools/types.ts`（`OurTool` 接口）、`app/src/core/tools/limits.ts`（裁剪公共 helper）
- **Dependencies**：`@earendil-works/pi-ai`、`@sinclair/typebox`
- **Patterns to follow**：
  - 每个工具导出 `defineTool({ tool, kind: 'read', limits, execute, returns })`
  - `registry.ts` 汇总，Agent 只拿到注册表里显式列出的工具
  - `description` 要写清"什么时候用 / 什么时候别用" —— 这是模型选对工具的关键
  - 返回值裁剪逻辑写在 `limits.ts`，不让每个工具各写一遍
- **Patterns to avoid**：
  - ❌ 不要在工具里直接 `db.put()`
  - ❌ 不要定义没有 `limits` 的工具
  - ❌ 不要在 `description` 里手写参数说明（会与 TypeBox schema 漂移）
  - ❌ 不要定义 `kind: 'write'` 的工具

### Verification

- [ ] 每个工具都有 `tool.parameters`（TypeBox）/ `limits` / `returns`，且 `pnpm typecheck` 通过
- [ ] `query_nodes` 在结果超过 200 条时返回 `truncated: true` 与 `totalCount`
- [ ] `read_original` 请求超过 20 万字时被拒绝并给出可读错误
- [ ] 传入非法参数时，Agent 收到 `INVALID_ARGS` 并能自我修正（实测一次）
- [ ] 全仓库搜索：`app/src/core/tools/` 下不存在 `db.put` / `db.add` / `db.delete`
- [ ] 工具注册表里没有任何 `kind: 'write'` 的工具

## Alternatives Considered

- **自定义一套工具类型（不用 pi-ai 的 `Tool`）**：需要写 TypeBox → pi-ai Tool 的转换层，且 pi-ai 升级时要跟着改。
- **只定义工具名，参数由提示词描述**：会重演 `fact` vs `name` 的漂移事故，且参数校验缺失。
- **不设返回上限，全量返回**：P2 一次扫描 100 章会直接撑爆上下文。
- **不区分摘要 / 详情**：要么全量浪费 token，要么摘要不足导致 Agent 反复查询。
- **给 Agent 写库工具**：见 ADR-006。

## More Information

**什么情况下该重新考虑**：

- 若 `maxResults=200` 实测导致上下文仍然过大 → 降低默认值 + 强制摘要模式
- 若 Agent 频繁调用 `read_original` 导致成本失控 → 加调用次数上限或结果缓存
- 若工具数量增长到 20+ → 按场景分组（P1 工具集 / P2 工具集 / 运行时工具集），避免模型选错

相关：ADR-003（TypeBox）、ADR-004（pi-ai）、ADR-006（Agent 运行时）
