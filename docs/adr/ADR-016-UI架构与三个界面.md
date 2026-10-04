---
status: accepted
date: 2026-10-03
decision-makers: 用户（产品负责人）
---

# UI 分三个界面，用 Zustand 管状态，不做路由

## Context and Problem Statement

用户明确 UI 由两部分构成：

> "一个是**游玩界面**（普通的对话窗口），一个是**设置界面**"

加上本范围（M1/M2）必须有的资产编辑与事件网络可视化，实际是**三个界面**：

1. **资产工作台** —— 导入小说、看编译进度、编辑/舍弃资产、看事件网络
2. **游玩界面** —— 对话窗口（读正文、输入行动）
3. **设置界面** —— 模型配置、API Key、并发数、调试开关等

需要定：状态怎么管、界面怎么切、组件怎么做、数据怎么与 UI 同步。

## Decision

### 1. 三个界面，用顶层 tab 切换，**不引入路由库**

```
┌─────────────────────────────────────┐
│  [资产]  [游玩]  [设置]              │  ← 顶层 tab
├─────────────────────────────────────┤
│                                     │
│         当前界面内容                  │
│                                     │
└─────────────────────────────────────┘
```

**不用 react-router**：本地单机应用，没有 URL 分享 / 深链 / 浏览器前进后退的需求。用 Zustand 里的 `activeView` 状态切换即可，少一个依赖。

> 例外：将来若要"打开某个世界线的某个存档"，可以在 Zustand 里存 `{ view, bookId, worldlineId }` 这样的上下文，不需要 URL。

### 2. 状态管理：Zustand

| 候选 | 判断 |
|------|------|
| **Zustand** ⭐ | 轻（~1KB）、无样板、不需要 Provider 包裹、适合本地应用 |
| Redux Toolkit | 对单人项目过重，样板多 |
| Jotai | 原子化，适合细粒度状态，但我们的状态是"界面 + 当前书籍"这种粗粒度 |
| Context | 会导致大面积重渲染，且没有 selector |

**只放两类状态在 Zustand**：

- **界面状态**：`activeView`、当前 `bookId` / `worldlineId`、选中的节点/事件线
- **编译状态**：任务状态、进度（由 ADR-010 的事件总线推送进来）

**不放**：业务数据（人物/节点/事件线）—— 那些在 IndexedDB 里，由 `useLiveQuery` 订阅。

### 3. 数据与 UI 的同步：`dexie-react-hooks` 的 `useLiveQuery`

```typescript
// features/assets/CharacterList.tsx
const characters = useLiveQuery(
  () => getCanonDb(bookId).characterSnapshots.toArray(),
  [bookId]
)
```

**为什么这个选择重要**：用户要能**自由编辑、舍弃**资产。用 `useLiveQuery` 后，编辑写库 → UI 自动刷新，**不需要手动维护"改了要记得刷新"的逻辑** —— 这是最容易出 bug 的地方。

### 4. 组件：Tailwind + shadcn/ui（沿用工程约定）

- 布局与样式：Tailwind
- 基础组件（Button / Dialog / Tabs / Select / Table / Toast）：shadcn/ui（复制进 `src/features/ui/`，可改）
- 事件网络：React Flow（见 ADR-015）

### 5. 三个界面的内容

#### ① 资产工作台

```
[导入小说]                                ← 未编译时
   ↓
[进度条 + 实时日志窗口]                    ← 编译中（ADR-010）
   ↓
├─ 人物（四层文件夹：主要/重要配角/NPC/路人）
├─ 地点（平铺）
└─ 事件网络（React Flow 地图）
   ↑ 每个资产可编辑 / 删除；人物支持手动合并
```

#### ② 游玩界面（对话窗口）

```
┌─────────────────────────────────────┐
│  正文流（叙述 + 玩家输入）              │
│  ……                                  │
├─────────────────────────────────────┤
│  [输入框：我想做什么……]        [发送]  │
└─────────────────────────────────────┘
```

**本范围只需把它做出来（能显示、能输入）**，真正的判定与叙事由后续模块（M3~M5）接。

#### ③ 设置界面

| 分组 | 配置项 |
|------|--------|
| **模型** | 供应商（首发 DeepSeek）、模型名、base URL |
| **凭据** | API Key（打码显示、明确告知明文存储，见 ADR-005） |
| **编译** | 并发数（默认 3）、调试日志开关、清空日志 |
| **数据** | 导出备份 / 导入备份、清空全部数据、存储占用（ADR-013） |
| **关于** | 版本号、隐私说明（"本机存储，调用模型时会发送章节正文"） |

## Consequences

- **好的**：三个界面用 tab 切换，结构简单，不需要路由的复杂度。
- **好的**：`useLiveQuery` 让"编辑资产 → UI 刷新"自动同步，消除一整类 bug。
- **好的**：Zustand 只管界面状态，业务数据在 IndexedDB，职责清晰。
- **坏的**：没有 URL 意味着不能分享"指向某个事件线的链接"（对本地个人工具不是问题）。
- **风险**：`useLiveQuery` 在监听大表（上万节点）时会有性能开销，需要限制查询范围（按 bookId / 按事件线）。

## Implementation Plan

- **Affected paths**：`app/src/features/app-shell/`（顶层 tab 与布局）、`app/src/features/store/`（Zustand store）、`app/src/features/assets/`、`app/src/features/network/`、`app/src/features/play/`、`app/src/features/settings/`、`app/src/features/ui/`（shadcn 组件）
- **Dependencies**：`zustand`、`shadcn/ui`（按需引入）、`@xyflow/react`、`@dagrejs/dagre`
- **Patterns to follow**：
  - Zustand store 按域拆分：`uiStore`（界面）、`compileStore`（编译状态）
  - 业务数据一律通过 `core/` 暴露的函数读写，UI 不直接 import `db`（ADR-012 会拦）
  - 编辑操作走 `core/` 的写函数（含校验），不直接 `db.put`
- **Patterns to avoid**：
  - ❌ 不要在 React 组件里直接 `import { db } from '@/core/db'`（ESLint 会拦）
  - ❌ 不要把业务数据存进 Zustand（会造成两份数据不同步）
  - ❌ 不要为了"以后可能要"而引入路由

### Verification

- [ ] 三个界面能通过顶层 tab 切换
- [ ] 在资产界面删除一个人物，列表立即更新（`useLiveQuery` 生效）
- [ ] 设置界面能保存 API Key 并显示为打码
- [ ] 设置界面能改并发数并持久化
- [ ] 游玩界面能接收输入并清空（接上后续模块前的占位行为）
- [ ] 全仓库搜索：`app/src/features/` 下不直接 import `@/core/db`

## Alternatives Considered

- **react-router / TanStack Router**：需要 URL 语义的场景才划算；本地单机应用不需要。
- **Redux Toolkit**：样板多，为单人项目引入不必要的仪式感。
- **把业务数据也放进 Zustand**：会产生"IndexedDB 与 store 两份真相"，必然不同步。
- **组件库用 antd / MUI**：Tailwind + shadcn 更轻、可改，且与 React Flow 的自定义节点风格更容易统一。

## More Information

**什么情况下该重新考虑**：

- 若需要分享"指向某个事件线/世界线的链接" → 引入 hash 路由
- 若状态复杂度上升（多本书、多世界线并行编辑）→ 评估把 `uiStore` 拆得更细
- 若 `useLiveQuery` 在大表上出现性能问题 → 改为分页查询 + 手动失效

相关：ADR-012（UI 不能直接依赖 db）、ADR-015（地图渲染）、ADR-010（编译进度事件）、ADR-005（Key 显示）、ADR-013（备份导入导出）
