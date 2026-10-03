# WestWorld V2

> 导入一本小说，得到一个可以住进去、并且会持续演化的世界。
>
> **当前状态**：V1.0 —— 规格与工程骨架就绪，实现进行中。

---

## 这个项目是什么

用户只需要导入一本小说，系统自动把它编译成两类资产：

- **世界资产**：人物（主要人物 / 重要配角 / NPC / 路人）、地点、关系、规则
- **叙事资产**：事件节点 → 事件线 → 事件网络（就像《底特律：变人》的那张流程图）

用户可以自由编辑、舍弃这些资产，并在地图上看到整个故事的网络结构。

---

## 目录结构

```
WestWorldV2/
├── PRD-WestWorldV2.md          ← 产品规格（M1 提取链路 + M2 数据模型）
├── docs/
│   ├── adr/                    ← 架构决策记录（ADR-001 ~ 014，全部 accepted）
│   ├── plans/                  ← 实施计划
│   ├── spikes/                 ← 可行性验证报告
│   ├── engineering-conventions.md  ← 参数级技术约定（写代码前必读）
│   └── *.md
├── prompts/                    ← 提示词（4 份：2 份提取 + 2 份合并）
├── app/                        ← 代码（React + TypeScript + Vite）
├── spike/                      ← 一次性验证代码（pi-ai 浏览器可行性）
├── archive/                    ← 历史版本
└── *.md                        ← 原始 idea 与评审报告
```

## 文档优先级（写代码前按顺序读）

1. **`docs/engineering-conventions.md`** —— 技术栈、分章正则、并发、提示词组织
2. **`docs/adr/README.md`** —— 14 条架构决策，每条都有"否决的替代方案"
3. **`PRD-WestWorldV2.md`** —— 要提取什么、字段是什么、流程是什么
4. **`docs/plans/`** —— 施工顺序

---

## 技术栈

| 层 | 选型 |
|----|------|
| 运行形态 | 纯浏览器 SPA（无桌面外壳） |
| 前端 | React + TypeScript + Vite + Tailwind |
| 存储 | IndexedDB（Dexie），Canon 库 / 世界线库分离 |
| Schema | TypeBox（业务数据唯一来源） |
| Agent | `@earendil-works/pi-agent-core` |
| 模型 | `@earendil-works/pi-ai`（首发 DeepSeek） |
| 可视化 | React Flow |

---

## 开发

```bash
cd app
pnpm install
pnpm dev          # 开发
pnpm lint         # ESLint（含 ADR-012 模块边界规则）
pnpm typecheck
pnpm test         # Vitest
pnpm build
```

## 已完成的验证

- ✅ **pi-ai 可在浏览器运行**（含真实网络请求、无 CORS 问题）—— 见 `docs/spikes/`
- ✅ **ADR-012 模块边界由 ESLint 机器强制**（故意违规会被 `pnpm lint` 拦下）
- ✅ 工程脚手架四项检查全绿（lint / typecheck / test / build）

## License

MIT
