# Spike 报告：pi-ai 能否在浏览器里运行

> **结论：能。全部通过，包括真实网络请求。**
> 日期：2026-10-03
> 验证方式：Vite 构建 → headless Chrome 加载 → 抓取页面内的执行结果
> 一次性代码：`spike/pi-ai-browser/`（**验证完可整个删除**）

---

## 要验证的问题

1. `@earendil-works/pi-ai` 能否被 Vite 打包进浏览器产物（不因 Node 专属模块而失败）
2. 运行时能否 `createModels()` + 注册 `deepseekProvider()`
3. 能否读出模型目录
4. **能否真的从浏览器发起对 DeepSeek API 的网络请求**（这决定了"前端直连"这条路线成不成立）

---

## 结果：4/4 通过

```
[1-import]     { ok: true }                          ← 模块在浏览器里加载成功
[2-provider]   { ok: true, id: "deepseek",
                 baseUrl: "https://api.deepseek.com" }
[3-catalog]    { ok: true, count: 2,
                 ids: ["deepseek-flash", "deepseek-v4-pro"] }
[4-complete]   { stopReason: "error",
                 errorMessage: "401: Authentication Fails, Your api key: ****-key is invalid
                                (request_id: 8691afb3-c935-41bd-87d4-1f14b169d95c)",
                 fetchCalls: [{
                   url: "https://api.deepseek.com/chat/completions",
                   status: 401,
                   ms: 10
                 }] }
```

### 第 4 条为什么是决定性的

我们用**故意填错的 API Key** 发起请求，期望看到的不是"成功"，而是**"请求真的发出去了，被服务端拒绝了"**。

结果拿到了 DeepSeek 服务器返回的 **真实 401 + request_id**。这证明了三件事：

| 证明 | 含义 |
|------|------|
| OpenAI SDK 在浏览器里跑起来了 | 不是打包期就崩，是真的执行了 |
| **请求真的到了 `api.deepseek.com`** | fetch 发出去并拿到了响应 |
| **没有被 CORS 拦截** | ⭐ **DeepSeek 允许浏览器直连** —— "前端直连"这条路线成立 |

> 如果有 CORS 问题，我们看到的会是 `TypeError: Failed to fetch`，而不是服务端返回的 401。

---

## 打包结果（代码分割正常）

```
dist/index.html                               0.35 kB
dist/assets/deepseek-KKp8vuF7.js              2.51 kB │ gzip:  1.08 kB   ← provider 目录
dist/assets/index-Bjonuapg.js                 4.11 kB │ gzip:  1.90 kB
dist/assets/models-fI6cSSa_.js               21.98 kB │ gzip:  6.55 kB   ← 模型运行时
dist/assets/openai-completions-DlaT0T94.js  312.52 kB │ gzip: 79.79 kB   ← 懒加载 chunk
```

**lazy import 生效了**：OpenAI SDK（312 KB）被切成独立 chunk，只在第一次真正调用模型时才加载。

## 唯一的构建警告（无害）

```
Module "node:fs" has been externalized for browser compatibility,
imported by ".../pi-ai/dist/utils/provider-env.js"
```

`provider-env.js` 里有一处 `require("node:fs")`，但它在 **Bun 专属分支**里，且入口有 `typeof process === "undefined"` 的守卫 —— 浏览器里永远不会执行到。Vite 把它 externalize 成空桩，无害。

---

## ⚠️ 验证中发现的一个实现陷阱（必须写进 ADR-006）

**`models.complete()` 失败时不抛异常，而是返回 `stopReason: "error"` 并附带 `errorMessage`。**

```js
const res = await models.complete(...);
// ❌ 不要写 try/catch 就以为能捕获模型调用失败
// ✅ 必须检查 res.stopReason
if (res.stopReason === 'error') {
  // 网络错误 / 401 / 限流 / 内容被拒，全都在这里
}
```

如果按常规 try/catch 写，**所有模型调用失败都会静默通过**，以为拿到了结果。这个坑必须在实现时避开。

---

## 对 ADR 的影响

| ADR | 影响 |
|-----|------|
| **ADR-001**（纯浏览器） | ✅ 无需修改 —— 直连路线验证成立 |
| **ADR-004**（采用 pi-ai） | ✅ 验证通过，可保持 accepted |
| **ADR-006**（Agent 运行时） | ⚠️ 需补充：错误处理必须检查 `stopReason`，不能靠 try/catch |
| 工程约定 | ⚠️ 需补充：只 import 用到的 provider 子路径这条已验证有效 |

## 一次性代码

`spike/pi-ai-browser/` 是**一次性验证代码**，不含任何生产逻辑，**验证完成后可直接删除**。
（保留它只是为了方便复现；它不是项目的一部分。）
