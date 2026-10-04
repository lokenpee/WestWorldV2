/**
 * 端到端检查（开发工具）。
 *
 * 用 Chrome DevTools Protocol 打开页面、注入数据、点击、读 DOM ——
 * 因为环境里没有 Playwright，而 --dump-dom 只能看首屏。
 *
 * 用法：node scripts/e2e-check.mjs http://localhost:5201/ [截图目录]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.argv[2] ?? 'http://localhost:5201/'
// 用随机端口：固定端口会被上一次没杀干净的 Chrome 占用，导致连到旧实例
const PORT = 9400 + Math.floor(Math.random() * 500)
const SHOT_DIR = process.argv[3] ?? null

const BOOK_ID = 'bk_e2e'

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

/** 往设置库里塞一本书（书架在设置库，不在 canon 库）。 */
const SEED_BOOK = `
(async () => {
  const req = indexedDB.open('westworld_settings')
  const db = await new Promise((res, rej) => {
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  const stores = [...db.objectStoreNames]
  const has = (n) => stores.includes(n)
  const tx = db.transaction(['books'].filter(has), 'readwrite')
  tx.objectStore('books').put({ id: '${BOOK_ID}', title: 'E2E 测试书', createdAt: new Date(2000, 0, 1).toISOString() })
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
  db.close()
  return 'book seeded'
})()
`

/**
 * 往 canon 库（每本书一个）里塞资产。
 * 人物 / 地点读的是**快照表**（草稿层）；characters / locations 是入库后的固定资产。
 */
const SEED_CANON = `
(async () => {
  const req = indexedDB.open('westworld_canon_${BOOK_ID}')
  const db = await new Promise((res, rej) => {
    req.onupgradeneeded = () => rej(new Error('canon 库应先由应用创建（需要先选中这本书）'))
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })

  const tx = db.transaction(['characterSnapshots','locationSnapshots','characters','locations','eventLines','nodes'], 'readwrite')

  const snaps = [
    { id: 'C1-P001', chapterIndex: '1', name: '贾琏', aliases: ['琏二爷'], aliases_mentioned: ['琏二爷'], roleWeight: '重要配角', identity: '荣国府长孙', confidence: 0.9 },
    { id: 'C4-P001', chapterIndex: '4', name: '贾赦', roleWeight: '重要配角', identity: '荣国府长子', confidence: 0.9 },
    { id: 'C9-P001', chapterIndex: '9', name: '琪官', roleWeight: 'NPC', identity: '戏子', confidence: 0.9 },
  ]
  for (const c of snaps) {
    tx.objectStore('characterSnapshots').put({
      ...c, bookId: '${BOOK_ID}', chapterName: '第' + c.chapterIndex + '章', updatedAt: '',
    })
  }
  tx.objectStore('locationSnapshots').put({
    id: 'C1-L001', bookId: '${BOOK_ID}', chapterIndex: '1', chapterName: '第一章',
    name: '荣国府', description: '贾府主宅', confidence: 0.9,
  })

  // 入库后的固定资产（资产包）
  const chars = [
    { id: 'P001', name: '贾琏', aliases: ['琏二爷'], roleWeight: '重要配角', identity: '荣国府长孙' },
    { id: 'P002', name: '贾赦', aliases: [], roleWeight: '重要配角', identity: '荣国府长子' },
    { id: 'P003', name: '琪官', aliases: ['蒋玉菡'], roleWeight: 'NPC', identity: '戏子' },
  ]
  for (const c of chars) {
    tx.objectStore('characters').put({
      ...c, bookId: '${BOOK_ID}', relations: [], confidence: 0.9, updatedAt: '',
    })
  }
  tx.objectStore('locations').put({ id: 'L001', bookId: '${BOOK_ID}', chapterIndex: '1', name: '荣国府', confidence: 0.9 })

  const nodes = [
    ['C1-N001', '1', '资金异常', '贾琏手头忽然宽裕', ['贾琏']],
    ['C4-N001', '4', '贾赦的走私迹象', '田产被悄悄变卖', ['贾赦']],
    ['C9-N001', '9', '琪官逃跑', '琪官从忠顺王府逃出', ['琪官']],
    ['C12-N001', '12', '琪官举报', '琪官供出走私链条', ['琪官', '贾赦']],
    ['C20-N001', '20', '贾母求情', '贾母进宫求情', ['贾母']],
  ]
  nodes.forEach(([id, ch, name, summary, actors], i) => {
    tx.objectStore('nodes').put({
      id, bookId: '${BOOK_ID}', chapterIndex: ch, chapterName: '第' + ch + '章', order: i,
      name, summary, actors, quote: '……原文……', confidence: 0.9, createdBy: 'P1', eventLineIds: []
    })
  })

  const lines = [
    { id: 'L01', title: '贾赦父子走私案', nodeIds: ['C1-N001','C4-N001','C12-N001','C20-N001'], chapters: ['1','4','12','20'], characterIds: ['P001','P002'] },
    { id: 'L02', title: '琪官儿事件', nodeIds: ['C9-N001','C12-N001'], chapters: ['9','12'], characterIds: ['P003'] },
  ]
  for (const l of lines) {
    tx.objectStore('eventLines').put({
      ...l, bookId: '${BOOK_ID}', cause: '起因一句话', process: '经过一句话', result: '结果一句话',
      lineStatus: 'open', updatedAt: ''
    })
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
  db.close()
  return 'canon seeded'
})()
`

async function main() {
  const ws = new WebSocket(await targetWs())
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const send = makeSend(ws)

  await send('Page.enable')
  // 用大视口，截图才能反映真实桌面布局
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  })
  await send('Runtime.enable')
  await send('Page.navigate', { url: URL })
  await sleep(1500)

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''))
    return r.result.value
  }

  async function shot(name) {
    if (!SHOT_DIR) return
    const r = await send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(SHOT_DIR, { recursive: true })
    writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(r.data, 'base64'))
  }
  const results = []
  const check = (step, ok) => results.push({ step, ok })

  check('首屏渲染（导入页）', String(await evalJs('document.body.textContent')).includes('导入小说'))

  // ① 先塞书架 → 重载 → 应用选中这本书，同时把它的 canon 库建出来
  await evalJs(SEED_BOOK)
  await send('Page.reload')
  await sleep(1500)
  // ② 再塞资产 → 重载 → 资产界面有东西可显示
  await evalJs(SEED_CANON)
  await send('Page.reload')
  await sleep(1800)
  const assetText = await evalJs('document.body.textContent')
  await shot('01-assets')
  check('自动选中已有书籍（不再退回导入页）', assetText.includes('人物') && assetText.includes('事件网络'))
  check('人物快照显示', assetText.includes('贾琏') && assetText.includes('C1-P001'))
  check('资产包状态显示（已入库）', assetText.includes('资产包'))

  // 点一个人物 → 打开编辑抽屉
  await evalJs(`[...document.querySelectorAll('li')].find(li => li.textContent.includes('C1-P001'))?.click()`)
  await sleep(500)
  const detailText = await evalJs('document.body.textContent')
  await shot('05-edit')
  check('点人物打开编辑抽屉', detailText.includes('手动合并'))
  check('编辑抽屉有字段', detailText.includes('主名') && detailText.includes('性格'))

  // 改一个字段并保存 → 列表应当自动刷新
  await evalJs(`(() => {
    const inputs = [...document.querySelectorAll('input')];
    const idx = inputs.findIndex(i => i.previousElementSibling?.textContent === '身份');
    const target = idx >= 0 ? inputs[idx] : null;
    if (!target) return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(target, '荣国府长孙（改）');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`)
  await sleep(200)
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '保存')?.click()`)
  await sleep(600)
  check('保存后自动生效', (await evalJs('document.body.textContent')).includes('荣国府长孙（改）'))
  // 试跑一章（不点开始，只验证入口在）
  check('有「试跑一章」入口', (await evalJs('document.body.textContent')).includes('试跑一章'))
  check('有「入库」入口', (await evalJs('document.body.textContent')).includes('入库'))

  // 真的点一次「入库」→ 应出现结果提示
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '入库')?.click()`)
  await sleep(900)
  check('点「入库」后给出结果反馈', (await evalJs('document.body.textContent')).includes('已入库'))

  // 切到「事件线」
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('事件线'))?.click()`)
  await sleep(400)
  const lineText = await evalJs('document.body.textContent')
  check('事件线显示（含起因经过结果）', lineText.includes('贾赦父子走私案') && lineText.includes('起因'))

  // 切到「事件网络」—— React Flow 应当挂载
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('事件网络'))?.click()`)
  await sleep(900)
  const netText = await evalJs('document.body.textContent')
  const hasFlow = await evalJs(`!!document.querySelector('.react-flow')`)
  await shot('02-network')
  check('事件网络渲染（React Flow 挂载）', hasFlow)
  check('网络图例显示', netText.includes('双击一条线'))

  // 设置 / 游玩
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '设置')?.click()`)
  await sleep(400)
  const settingsText = await evalJs('document.body.textContent')
  await shot('03-settings')
  check('设置界面（含 API Key 与明文告知）', settingsText.includes('API Key') && settingsText.includes('明文保存在本机浏览器存储'))
  check('设置界面有备份导出/导入', settingsText.includes('导出备份') && settingsText.includes('导入备份'))
  check('备份说明写清「不含 API Key」', settingsText.includes('不包含 API Key'))

  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === '游玩')?.click()`)
  await sleep(400)
  await shot('04-play')
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