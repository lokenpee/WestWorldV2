/**
 * 端到端检查（一次性开发工具）。
 *
 * 用 Chrome DevTools Protocol 打开页面、点击、读 DOM ——
 * 因为环境里没有 Playwright，而 `--dump-dom` 只能看首屏。
 *
 * 用法：node scripts/e2e-check.mjs http://localhost:5201/
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.argv[2] ?? 'http://localhost:5201/'
const PORT = 9333

const profile = mkdtempSync(join(tmpdir(), 'ww-e2e-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targetWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('Chrome 调试端口没起来')
}

let msgId = 0
function makeSend(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
}

async function main() {
  const ws = new WebSocket(await targetWs())
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const send = makeSend(ws)

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL })
  await sleep(1500)

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }

  const results = []

  // 首屏：资产 tab
  results.push({
    step: '首屏渲染',
    ok: (await evalJs('document.body.innerText')).includes('导入小说'),
  })

  // 点「设置」
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '设置')?.click()`)
  await sleep(400)
  const settingsText = await evalJs('document.body.innerText')
  results.push({ step: '切到「设置」', ok: settingsText.includes('API Key') && settingsText.includes('并发数') })
  results.push({ step: '设置里有明文存储告知', ok: settingsText.includes('明文保存在本机浏览器存储') })

  // 点「游玩」
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '游玩')?.click()`)
  await sleep(400)
  const playText = await evalJs('document.body.innerText')
  results.push({ step: '切到「游玩」', ok: playText.includes('还没有开始游玩') })

  // 回「资产」
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '资产')?.click()`)
  await sleep(400)
  results.push({ step: '切回「资产」', ok: (await evalJs('document.body.innerText')).includes('导入小说') })

  // 控制台报错检查
  const errors = await evalJs('window.__e2eErrors ? window.__e2eErrors.length : 0')

  console.log('检查项：')
  for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.step}`)
  console.log(`\n控制台错误数：${errors}`)

  const failed = results.filter((r) => !r.ok).length
  ws.close()
  chrome.kill()
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('检查失败：', e)
  chrome.kill()
  process.exit(1)
})

