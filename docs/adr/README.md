# Architecture Decision Records (ADR)

> 本目录遵循 `adr-skill`（vercel/ai）规范：**ADR 是给 coding agent 执行用的规格**，不只是决策备忘录。

## 三个文档的分工

| 文档 | 回答的问题 | 面向 |
|------|-----------|------|
| **PRD**（`/PRD-WestWorldV2.md`） | 要做什么？为什么对用户有价值？ | 产品 |
| **ADR**（本目录） | 选了哪个方案？**否决了什么？代价是什么？怎么落地？** | 实现 |
| **Spec**（`/docs/specs/`） | 具体数据结构、字段、接口签名 | 实现 |

**判断标准**：决定**改了代价大**，或**半年后你会问"当初为什么这么选"** → 写 ADR。

## 本仓库的约定（有意的偏离）

| 项 | 约定 | 说明 |
|----|------|------|
| 目录 | `docs/adr/` | 与 skill 的检测顺序一致 |
| 文件名 | `ADR-NNN-中文标题.md` | **偏离** skill 默认的 `YYYY-MM-DD-title.md`：本项目 ADR 数量可控，编号便于互相引用（正文里会写"见 ADR-003"） |
| 状态 | YAML front matter 里的 `status` | `proposed` / `accepted` / `rejected` / `deprecated` / `superseded` |
| 语言 | 中文正文，英文技术名词 | — |

## ADR 必填结构

```markdown
---
status: proposed
date: YYYY-MM-DD
decision-makers: <谁拥有这个决定>
---

# <动词短语：选择 / 采用 / 替换>

## Context and Problem Statement   ← 为什么现在必须决定
## Decision                          ← 选什么（含 Non-goals）
## Consequences                      ← 好的 / 坏的 / 风险（不许只写好的）
## Implementation Plan               ← 改哪些文件、依赖什么、遵循什么模式、避免什么
### Verification                     ← 可勾选的验证项
## Alternatives Considered           ← 否决了什么，为什么
## More Information                  ← 什么情况下该重新考虑
```

**两条硬要求**：必须写「否决的替代方案」（否则半年后把同一场讨论重来一遍）、必须写「什么情况下该重新考虑」（否则决定会变成教条）。

---

## 目标仓库结构（Implementation Plan 里的路径都以此为准）

```
westworld-v2/
├── src-tauri/                 # Tauri 主进程（Rust 外壳）
├── src/
│   ├── core/                  # 与 UI 无关的核心逻辑，可单测
│   │   ├── schema/            # Zod schema —— 单一真相源（ADR-003）
│   │   ├── db/                # Dexie 数据层（ADR-002）
│   │   ├── llm/               # 模型调用抽象层（ADR-004）
│   │   ├── pipeline/          # P1 / P2 / P2' / P3 编排
│   │   ├── tools/             # Agent 工具接口
│   │   └── prompts/           # 提示词模板
│   ├── workers/               # Web Worker（长任务）
│   ├── features/              # UI 功能模块
│   │   ├── import/            # 导入与分章
│   │   ├── assets/            # 人物 / 地点 / 事件预览
│   │   └── map/               # 事件地图
│   ├── shared/
│   └── main.tsx
├── docs/
│   ├── adr/                   # 本目录
│   └── specs/                 # 设计规格
└── tests/
```

> ⚠️ 代码实际放在 E:\WestWorldV2\app\（用户已定）。上面的 src/ 与 pp/src/ 是同一棵树。

---

## 决策清单

### A 组 · 地基（写第一行代码前必须定）

| # | 标题 | 状态 |
|---|------|------|
| [ADR-001](ADR-001-运行形态与技术栈.md) | 采用纯浏览器 SPA（React + TS + Vite） | ✅ accepted |
| [ADR-002](ADR-002-数据层选型与分库策略.md) | 采用 Dexie 作为 IndexedDB 封装并分库 | ✅ accepted |
| [ADR-003](ADR-003-Schema单一真相源.md) | **TypeBox** 管业务 Schema，数据库 Schema 独立 | ✅ accepted |
| [ADR-004](ADR-004-模型调用抽象层与结构化输出.md) | 采用 **`pi-ai`** 作为模型调用层 | ✅ accepted |
| [ADR-005](ADR-005-密钥存储与隐私边界.md) | 纯浏览器下 API Key 明文存 IndexedDB + 四条纪律 | ✅ accepted |


### B 组 · Agent 与运行时（写 P1 / P2 前必须定）

| # | 标题 | 状态 |
|---|------|------|
| [ADR-006](ADR-006-Agent运行时模型.md) | 采用 **`pi-agent-core`** + 四条约定（不写库 / 有界循环 / 每步记录 / 统一入口） | ✅ accepted |
| [ADR-007](ADR-007-Agent工具接口契约.md) | 工具接口沿用 **pi-ai `Tool`** + 返回上限 + 摘要/详情两级 | ✅ accepted |
| [ADR-008](ADR-008-长任务执行模型.md) | 长任务执行：DOM-free pipeline + 断点续跑 + 暂停 | ✅ accepted |
| [ADR-009](ADR-009-并发限流重试降级.md) | 并发 3 / 错误分类重试 / 单章失败跳过（**不做成本护栏**，留扩展点） | ✅ accepted |
| [ADR-010](ADR-010-可观测性与成本核算.md) | **事件驱动的可观测性**：统一事件总线 + 完整日志窗口 | ✅ accepted |
| [ADR-011](ADR-011-提示词与Schema一致性.md) | 提示词字段表由 TypeBox 自动渲染（手写区 + 生成区） | ✅ accepted |

### C 组 · 数据与接口（落地 M2 前）

| # | 标题 | 状态 |
|---|------|------|
| [ADR-012](ADR-012-模块边界与依赖方向.md) | 分层边界 + 单向依赖，ESLint 强制 | ✅ accepted |
| [ADR-013](ADR-013-导出导入格式与版本兼容.md) | 单个 `.wwv2` 压缩包，导入默认新建 | ✅ accepted |
| [ADR-014](ADR-014-数据迁移与Schema版本策略.md) | Dexie 版本化迁移，区分可重生成 / 不可重生成数据 | ✅ accepted |

### D 组 · UI 与游玩部分（可以晚点）

| # | 标题 | 状态 |
|---|------|------|
| ADR-015 | 地图渲染选型 | ⬜ 未起草 |
| ADR-016 | UI 状态管理与组件方案 | ⬜ 未起草 |
| ADR-017 | Agent 记忆分层与上下文预算（PI 有上下文压缩机制，教程第 8/9 章） | ⬜ 未起草 |
| ADR-018 | 世界线运行时状态与快照实现 | ⬜ 未起草 |
## 配套文件

- **docs/engineering-conventions.md** —— 参数级技术约定（技术栈、分章正则、编码处理、并发、提示词目录、Zod 与 DB 的边界）。**写代码前必读。**

## 不属于 ADR 的东西

- 完整数据 schema（人物 / 地点 / 节点 / 事件线）→ 在 Zod 定义（ADR-003）+ PRD
- 工具函数完整签名 → ADR-012
- 提示词全文 → `prompts/`，后续并入 `src/core/prompts/`

ADR 是**决定记录**，不是**规格文档**。别把完整 schema 塞进 ADR，否则两边会各自过期。







