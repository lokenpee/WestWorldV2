import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] ?? 'http://localhost:5200/';
const profile = mkdtempSync(join(tmpdir(), 'ww-check-'));
const r = spawnSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--virtual-time-budget=15000', '--dump-dom', URL,
], { encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
if (r.error) { console.log('spawn error:', String(r.error)); process.exit(2); }
console.log('exitCode =', r.status);
console.log(r.stdout || '(空)');
