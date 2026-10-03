// THROWAWAY SPIKE — 用 headless Chrome 加载页面并抓取 window.__SPIKE_RESULT__
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5199/';
const profile = mkdtempSync(join(tmpdir(), 'spike-chrome-'));

// 用一个中间页面把 window.__SPIKE_RESULT__ 写进 DOM，这样 --dump-dom 就能拿到
const probe = `
<script>
(async () => {
  const dom = await (await fetch('${URL}')).text();
  document.write('<pre id="page"></pre>');
  document.getElementById('page').textContent = dom;
})();
<\/script>`;
writeFileSync(join(profile, 'probe.html'), probe);

const args = [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  '--virtual-time-budget=45000',
  '--dump-dom',
  URL,
];

const r = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
console.log('exitCode =', r.status);
if (r.error) console.log('spawn error =', String(r.error));
if (r.stderr) console.log('--- stderr ---\n' + r.stderr.split('\n').slice(0, 15).join('\n'));
console.log('--- DOM (前 6000 字符) ---');
console.log((r.stdout || '').slice(0, 6000));
