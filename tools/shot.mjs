// Dev helper: headless-Chrome screenshots of the running preview.
// usage: node tools/shot.mjs <outDir> '<json [{name, js, wait}]>' [width] [height] [url]
import { createRequire } from 'module';
const require = createRequire(new URL('../../arabic-sound-lab/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [outDir, shotsJson, w = '960', h = '600', url = 'http://127.0.0.1:8811/?dbg=1'] = process.argv.slice(2);
const shots = JSON.parse(shotsJson);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 400)));
const t0 = Date.now();
await page.goto(url);
try { await page.waitForFunction('window.__dbg && window.__dbg.ready', null, { timeout: 90000 }); } catch (e) { console.log('not ready:', String(e).slice(0, 200)); }
console.log('ready in', Date.now() - t0, 'ms');
for (const s of shots) {
  for (const k of s.keys || []) { await page.keyboard.press(k); await page.waitForTimeout(s.keyGap ?? 60); }
  if (s.click) await page.click(s.click);
  if (s.drag) { await page.mouse.move(s.drag[0], s.drag[1]); await page.mouse.down(); await page.mouse.move(s.drag[2], s.drag[3], { steps: 4 }); await page.mouse.up(); }
  if (s.js) { const r = await page.evaluate(s.js); if (r !== undefined && r !== null) console.log(s.name, '=>', typeof r === 'string' ? r : JSON.stringify(r)); }
  await page.waitForTimeout(s.wait ?? 700);
  if (!s.noShot) await page.screenshot({ path: `${outDir}/${s.name}.jpg`, type: 'jpeg', quality: s.clip ? 92 : 80, ...(s.clip ? { clip: s.clip } : {}) });
}
if (logs.length) console.log(logs.slice(0, 15).join('\n'));
await browser.close();
