// Dev helper: layout audit of every screen at phone / tablet / desktop sizes (fit, tap size, overlap).
import { createRequire } from 'module';
const require = createRequire(new URL('../../arabic-sound-lab/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const outDir = process.argv[2], BASE = process.argv[3] || 'http://127.0.0.1:8811/';
const VPS = [[1440, 900, false], [960, 600, false], [820, 1180, true], [390, 844, true], [360, 640, true], [844, 390, true], [667, 375, true]];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const check = (state) => {
  const W = innerWidth, H = innerHeight, out = [];
  const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && o > 0.5; };
  const rect = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  for (const el of document.querySelectorAll('button')) { if (!vis(el)) continue; const r = rect(el); if (r.w < 44 || r.h < 44) out.push(`SMALL ${el.id} ${r.w | 0}x${r.h | 0}`); if (r.l < 0 || r.t < 0 || r.r > W + 0.5 || r.b > H + 0.5) out.push(`OFFSCREEN ${el.id}`); const c = document.elementFromPoint((r.l + r.r) / 2, (r.t + r.b) / 2); if (c !== el && !el.contains(c)) out.push(`COVERED ${el.id} by ${c && (c.id || c.tagName)}`); }
  const ids = { title: ['.kick', 'h1', '.lede', '#play', '#sndBtn2', '#keys', '.fine'], hud: ['#score', '#where', '#right', '#lm', '#map', '#hint'], pause: ['#pause .card'], end: ['#end .card'] }[state] || [];
  const boxes = [];
  for (const sel of ids) { const el = document.querySelector(sel); if (!el || !vis(el)) continue; const r = rect(el); boxes.push([sel, r]); if (r.l < -0.5 || r.t < -0.5 || r.r > W + 0.5 || r.b > H + 0.5) out.push(`CLIPPED ${sel} [${r.l | 0},${r.t | 0},${r.r | 0},${r.b | 0}]`); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i][1], b = boxes[j][1]; if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.push(`OVERLAP ${boxes[i][0]} x ${boxes[j][0]}`); }
  for (const el of document.querySelectorAll('#next, #street, #lmName, #scoreV, #endScore, #medal, .stats b, #endSub')) if (vis(el) && el.scrollWidth > el.clientWidth + 1) out.push(`TEXT CUT ${el.id || el.className} "${el.textContent.slice(0, 30)}"`);
  if (document.documentElement.scrollWidth > W || document.documentElement.scrollHeight > H) out.push('PAGE SCROLLS');
  return out;
};
for (const [w, h, touch] of VPS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200))); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await page.goto(BASE + '?ts=8'); await page.waitForFunction('window.__acr && window.__acr.ready', null, { timeout: 90000 });
  const res = {}; const tag = `${w}x${h}`;
  await page.waitForTimeout(500); res.title = await page.evaluate(check, 'title'); await page.screenshot({ path: `${outDir}/a_${tag}_title.jpg`, type: 'jpeg', quality: 70 });
  if (touch) await page.tap('#play'); else await page.click('#play');
  await page.waitForFunction('window.__acr.mode === "run"', null, { timeout: 20000 });
  await page.waitForTimeout(450); res.hint = await page.evaluate(check, 'hud'); await page.screenshot({ path: `${outDir}/a_${tag}_hint.jpg`, type: 'jpeg', quality: 70 });
  // worst-case HUD content: long street names, big score, landmark card + hint both up
  await page.evaluate(() => { const g = window.__acr.game; g.score = 1234567; g.mult = 9; document.getElementById('mult').textContent = '×9'; document.getElementById('hint').classList.remove('show'); document.getElementById('lm').classList.add('show'); document.getElementById('lmName').textContent = 'Greater Columbus Convention Center'; document.getElementById('lmFact').textContent = 'Peter Eisenman’s 1993 pastel railyard of a building.'; document.getElementById('lmSide').textContent = 'ON YOUR RIGHT'; g.s = g.prevS = 3560; g.invuln = 9; });
  await page.waitForTimeout(350); res.hud = await page.evaluate(check, 'hud'); await page.screenshot({ path: `${outDir}/a_${tag}_hud.jpg`, type: 'jpeg', quality: 70 });
  if (touch) await page.tap('#pauseBtn'); else await page.click('#pauseBtn');
  await page.waitForTimeout(500); res.pause = await page.evaluate(check, 'pause'); await page.screenshot({ path: `${outDir}/a_${tag}_pause.jpg`, type: 'jpeg', quality: 70 });
  if (touch) await page.tap('#resume'); else await page.click('#resume');
  await page.evaluate(() => window.__acr.setBot(true));
  await page.waitForFunction('window.__acr.mode === "end"', null, { timeout: 60000 });
  await page.waitForTimeout(700); res.end = await page.evaluate(check, 'end'); await page.screenshot({ path: `${outDir}/a_${tag}_end.jpg`, type: 'jpeg', quality: 70 });
  if (touch) await page.tap('#again'); else await page.click('#again');
  await page.waitForFunction('window.__acr.mode === "run"', null, { timeout: 20000 });
  res.again = [await page.evaluate(() => `mode ${window.__acr.mode} score ${window.__acr.game.score | 0} s ${window.__acr.game.s | 0}`)];
  console.log(tag, touch ? 'touch' : 'mouse', JSON.stringify(res), errs.length ? 'ERRORS ' + errs.join(' | ') : '');
  await ctx.close();
}
await browser.close();
