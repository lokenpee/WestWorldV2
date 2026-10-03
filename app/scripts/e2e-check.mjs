/**
 * 端到端检查（开发工具）。
 *
 * 用 Chrome DevTools Protocol 打开页面、注入数据、点击、读 DOM ——
 * 因为环境里没有 Playwright，而 --dump-dom 只能看首屏。
 *
 * 用法：node scripts/e2e-check.mjs http://localhost:5201/
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.argv[2] ?? 'http://localhost:5201/'
// 用随机端口：固定端口会被上一次没杀干净的 Chrome 占用，导致连到旧实例
const PORT = 9400 + Math.floor(Math.random() * 500)

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
    URL,
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
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
}

/** 往 IndexedDB 里塞一本书 + 人物 + 事件线，让资产界面有东西可显示。 */
const SEED = `
(async () => {
  // 不指定版本：应用加载时已经用 Dexie 建好库（Dexie 会把版本号 ×10，写死会 VersionError）
  const req = indexedDB.open('westworld_canon')
  const db = await new Promise((res, rej) => {
    req.onupgradeneeded = () => { throw new Error('库不存在：应用应当先建好') }

    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  const tx = db.transaction(['books','characters','eventLines','nodes'], 'readwrite')
  tx.objectStore('books').put({ id: 'bk_e2e', title: 'E2E 测试书', createdAt: new Date().toISOString() })
  tx.objectStore('characters').put({
    id: 'P001', bookId: 'bk_e2e', name: '贾琏', aliases: ['琏二爷'], roleWeight: 'NPC',
    relations: [], sourceSnapshotIds: ['C1-P001'], updatedAt: ''
  })
  tx.objectStore('nodes').put({
    id: 'C1-N001', bookId: 'bk_e2e', chapterIndex: '1', chapterName: '第一章', order: 0,
    name: '资金异常', summary: '手头宽裕', actors: ['贾琏'], quote: '……', confidence: 0.9, createdBy: 'P1'
  })
  tx.objectStore('eventLines').put({
    id: 'L01', bookId: 'bk_e2e', title: '走私案', nodeIds: ['C1-N001'], chapters: ['1'],
    cause: '起', process: '经', result: '果', lineStatus: 'open', characterIds: ['P001'], updatedAt: ''
  })
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
  db.close()
  return 'seeded'
})()
`

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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }

  const results = []
  const check = (step, ok) => results.push({ step, ok })

  check('首屏渲染（导入页）', String(await evalJs('document.body.textContent')).includes('导入小说'))

  // 注入数据后重载 —— 应该自动选中那本书并显示资产 tab
  await evalJs(SEED)
  await send('Page.reload')
  await sleep(1800)
  const assetText = await evalJs('document.body.textContent')
  check('自动选中已有书籍（不再退回导入页）', assetText.includes('人物') && assetText.includes('事件网络'))
  check('人物实体显示', assetText.includes('贾琏') && assetText.includes('P001'))

  // 点一个人物 → 打开编辑抽屉
  await evalJs(`[...document.querySelectorAll('li')].find(li => li.textContent.includes('P001'))?.click()`)
  await sleep(500)
  const detailText = await evalJs('document.body.textContent')
  check('点人物打开编辑抽屉', detailText.includes('手动归并'))
  check('编辑抽屉有字段', detailText.includes('主名') && detailText.includes('性格'))

  // 改一个字段并保存 → 列表应当自动刷新
  await evalJs(`(() => {
    const inputs = [...document.querySelectorAll('input')];
    const idx = inputs.findIndex(i => i.previousElementSibling?.textContent === '身份');
    const target = idx >= 0 ? inputs[idx] : null;
    if (!target) return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(target, '荣国府长孙');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`)
  await sleep(200)
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '保存')?.click()`)
  await sleep(600)
  check('保存后自动生效', (await evalJs('document.body.textContent')).includes('荣国府长孙'))
  // 切到「事件线」
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('事件线'))?.click()`)
  await sleep(400)
  const lineText = await evalJs('document.body.textContent')
  check('事件线显示（含起因经过结果）', lineText.includes('走私案') && lineText.includes('起因'))

  // 切到「事件网络」—— React Flow 应当挂载
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('事件网络'))?.click()`)
  await sleep(900)
  const netText = await evalJs('document.body.textContent')
  const hasFlow = await evalJs(`!!document.querySelector('.react-flow')`)
  check('事件网络渲染（React Flow 挂载）', hasFlow)
  check('网络图例显示', netText.includes('双击一条线'))

  // 设置 / 游玩
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '设置')?.click()`)
  await sleep(400)
  const settingsText = await evalJs('document.body.textContent')
  check('设置界面（含 API Key 与明文告知）', settingsText.includes('API Key') && settingsText.includes('明文保存在本机浏览器存储'))

  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '游玩')?.click()`)
  await sleep(400)
  check('游玩界面', (await evalJs('document.body.textContent')).includes('还没有开始游玩'))

  console.log('检查项：')
  for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.step}`)

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






