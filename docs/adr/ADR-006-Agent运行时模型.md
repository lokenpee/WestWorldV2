---
status: accepted
date: 2026-10-03
decision-makers: 用户（产品负责人）
---

# 采用 `@earendil-works/pi-agent-core` 作为 Agent 运行时，并在其上施加四条硬约定

## Context and Problem Statement

M1 的每一步都不是单次模型调用 —— 它是**多轮工具调用**：

- P2 串事件线时，Agent 要能自己决定"我要去看某个区间还有没有别的节点""我要回原文找那一环"
- 提示词里已经写了 `query_nodes` / `read_original` / `query_event_lines` 这些工具

**没有 Agent 运行时，就写不出 P1/P2/P3 的代码。**

原方案是自建一个有界循环控制器。但 `@earendil-works/pi-agent-core` 已经把 agent loop、工具执行、状态管理、中断都做完了，而且只依赖 `pi-ai` + `typebox`（无 Node 专属依赖）。

## Decision

**采用 `@earendil-works/pi-agent-core` 作为 Agent 运行时。**

**PI 提供**（直接用，不重写）：agent loop、工具执行（`sequential` / `parallel` 两种模式）、状态管理、中断（abort）、流式响应、`beforeToolCall` / `afterToolCall` 钩子、附件支持。

### 我们在 PI 之上施加的四条硬约定

#### ① ⭐ Agent 永不直接写数据库

**这是最重要的一条。**

Agent 只能：
- **读**（通过只读工具）
- **返回结构化操作意图**（在最终输出里）

真正写库由**代码**执行：先 TypeBox 校验，再落库，并写变更账本。

**实现方式**：用 `beforeToolCall` 钩子做**白名单校验** —— 只允许注册表里标记为 `read` 的工具执行，其余一律 `{ block: true }` 并给出原因。

**理由**：

1. **可校验** —— 模型返回的写操作先过 schema，非法就重试
2. **可回滚** —— 批量提交，失败不产生半成品
3. **可审计** —— 每次写入进变更账本
4. **避免半途失败** —— 如果 Agent 在一个循环里写了 3 条、第 4 条崩了，数据就烂了

#### ② 有界循环

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `maxSteps` | **6** | 工具调用轮数上限（用 PI 的提前终止机制实现） |
| `runTimeoutMs` | **180000**（3 分钟） | 单次 run 的 wall-clock 上限 |
| 单工具结果上限 | **64 KB** | 见 ADR-007 |
| 单工具返回条数上限 | **200** | 见 ADR-007 |

**超限后的行为**：不是报错，而是**降级为已知信息下的保守结论**，并在结果里标记 `degraded: true`。

#### ③ 每个生命周期都要发事件（不只是"记录"）

**用户的明确要求**：日志窗口要能让用户看到**每一步在做什么**。所以不是"往日志表写一行"，而是**发事件，由订阅者消费**。

**做法**：挂载 PI 的 `Agent.subscribe()`，把 PI 的 `AgentEvent` 转发到我们的事件总线（详见 ADR-010）。

PI 提供的事件（直接转发，不重新发明）：

| 层 | 事件 |
|----|------|
| Agent | `agent_start` / `agent_end` |
| Turn | `turn_start` / `turn_end` |
| Message | `message_start` / `message_update` / `message_end` |
| Tool | `tool_execution_start` / `tool_execution_update` / `tool_execution_end` |

**再叠加我们的任务级事件**（PI 不知道"章节""窗口"这些概念）：`chapter_start` / `chapter_done` / `chapter_failed` / `chapter_retry` / `progress` / `cost_update`。

**关键约束**：事件必须在**正确的位置**发出来 —— 入口是 `runAgent` 里统一挂载 `subscribe()`，而不是在每个 pass 里散落着发。

> 注意区分两个机制：`beforeToolCall` / `afterToolCall` 是**钩子**（可以改行为、可以拦截），`subscribe()` 是**事件**（只读广播）。拦截写工具用钩子，报送进度用事件。

#### ④ 错误判定必须看 `stopReason`，不能靠 try/catch

**这是 2026-10-03 浏览器 Spike 中实测发现的陷阱。**

`models.complete()` **失败时不抛异常**，而是返回：

```js
{ stopReason: 'error', errorMessage: '401: Authentication Fails ...' }
```

网络错误 / 401 / 限流 / 内容被拒，**全都走这条路径**。

```js
// ❌ 错误写法：失败会静默通过
try { const res = await models.complete(...); } catch (e) { ... }

// ✅ 正确写法
const res = await models.complete(...);
if (res.stopReason === 'error') { /* 重试 / 降级 / 上报 */ }
```

**必须做的**：在 `runAgent` 里集中处理 `stopReason`，各 pass 不各自判断。

#### ⑤ 每个 pass 只调用一个统一的 `runAgent`

各 pass（P1/P2/P3）**不自己写循环**，只调用 `app/src/core/agent/run.ts` 暴露的统一入口。

**Non-goals（明确不做）**：

- 不重写 agent loop（PI 已提供）
- 不做多 Agent 互相协作（本项目是**单 Agent + 工具**）
- 不做 Agent 自主探索（无步数上限的循环）
- 不给 Agent 任何写库工具

## Consequences

- **好的**：省掉整个 agent loop 的开发与调试。
- **好的**：`beforeToolCall` / `afterToolCall` 钩子让"禁止写库"和"可观测性"变成**一处配置**，而不是散落各处。
- **好的**：`sequential` / `parallel` 工具执行模式现成，配合 ADR-009 的并发策略。
- **好的**：中断（abort）与流式现成。
- **坏的**：接受 PI 的循环形态与升级节奏；如果我们要的循环语义与它差别很大，就得绕。
- **坏的**：`maxSteps=6` 对复杂场景可能不够，需要实测调整。
- **风险**：PI 的钩子语义（`terminate` 的"全部工具都置 true 才提前终止"这类细节）需要实测确认，不能只靠文档。

## Implementation Plan

- **Affected paths**：`app/src/core/agent/run.ts`（统一入口 + 四条约定的配置）、`app/src/core/agent/hooks.ts`（`beforeToolCall` 白名单、`afterToolCall` 记录）、`app/src/core/agent/types.ts`
- **Dependencies**：`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@sinclair/typebox`
- **Patterns to follow**：
  - `runAgent({ promptId, input, tools, limits })` 作为唯一入口，内部完成 PI Agent 的装配
  - 工具白名单与 `limits` 从 ADR-007 的工具注册表里读，不重复声明
  - `degraded` / `steps` / `usage` 作为返回值的一部分，供上层判断
- **Patterns to avoid**：
  - ❌ 不要在 pipeline 里自己写 while 循环调模型
  - ❌ 不要给 Agent 任何写库的工具
  - ❌ 不要把工具结果原样塞进上下文而不做大小控制

### Verification

- [x] ✅ **pi-ai 浏览器冒烟测试已验证通过**（2026-10-03，见 `docs/spikes/2026-10-03-pi-ai-browser-verification.md`）。**待补**：带工具调用的完整 `pi-agent-core` run
- [ ] 模型连续返回 tool_call 时能正确循环，并在第 `maxSteps` 步强制收尾
- [ ] **写库尝试被拦截**：注册一个测试用写工具，验证 `beforeToolCall` 能 block 它并返回可读原因
- [ ] 工具参数不合法时返回结构化错误，模型能自我修正（实测一次）
- [ ] 单个工具返回超过 64 KB 时被截断，且结果里带截断提示
- [ ] abort 触发后当前模型请求中断，已完成步骤保留
- [ ] **stopReason: 'error' 能被正确识别并触发重试/降级**（不依赖 try/catch）
- [ ] 每次 run 结束能拿到完整步骤记录（含 token 用量）`r`n- [ ] **`Agent.subscribe()` 已挂载**：PI 的 10 个生命周期事件都被转发到事件总线（见 ADR-010）
- [ ] 全仓库搜索：`app/src/core/tools/` 下不存在任何写库的工具

## Alternatives Considered

- **自建薄循环控制器（原方案，已否决）**：能完全贴合我们的语义，但 agent loop、工具执行、中断、流式都要自己写并自己踩坑；PI 已做完且浏览器可用。
- **给 Agent 写库工具，让它自己改**：实现最简单，但**半途失败会产生不一致数据**，且无法回滚与审计。
- **多 Agent 互相协作**：本项目每个阶段任务明确（抽节点 / 串线 / 合并），不需要 Agent 之间对话，只会增加成本与不可控性。
- **无步数上限的自主循环**：成本不可预测。

## More Information

**什么情况下该重新考虑**：

- 若 PI 的循环语义与我们的需求冲突到需要大量绕过 → 评估自建薄循环，但保留 pi-ai（ADR-004）
- 若 `maxSteps=6` 实测经常不够 → 按任务类型分别配置上限（P2 给 10，P1 给 3）
- 若将来需要 Agent 写库 → 必须同时引入事务与回滚机制，不能只放开权限

相关：ADR-003（TypeBox）、ADR-004（pi-ai）、ADR-007（工具契约）、ADR-009（并发与重试）、ADR-010（可观测性）


