// Dev helper: layout, focus and touch audit of every screen at phone / tablet / desktop sizes.
// usage: node tools/audit.mjs <outDir> [baseUrl]
// Per viewport and screen it reports: buttons too small / off screen / covered, panels clipped or overlapping,
// cut-off text, page scroll, focus stops that are not visible (Tab x12), and on touch viewports whether swipes
// of 40 / 80 / 160 px from the right lane each land in the centre lane. Exits 1 if anything is reported.
import { launch, open, fingers } from './drive.mjs';

const outDir = process.argv[2], BASE = process.argv[3] || 'http://127.0.0.1:8811/';
const VPS = [[1440, 900, false], [960, 600, false], [820, 1180, true], [390, 844, true], [360, 640, true], [844, 390, true], [667, 375, true]];
const browser = await launch();
const check = (state) => {
  const W = innerWidth, H = innerHeight, out = [];
  const vis = el => { const r = el.getBoundingClientRect(); let o = 1; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; o *= +cs.opacity; } return r.width > 0 && r.height > 0 && o > 0.5; };
  const rect = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  for (const el of document.querySelectorAll('button')) { if (!vis(el) || el.closest('[inert]')) continue;      // inert = shown but deliberately out of reach
    const r = rect(el); if (r.w < 44 || r.h < 44) out.push(`SMALL ${el.id} ${r.w | 0}x${r.h | 0}`); if (r.l < 0 || r.t < 0 || r.r > W + 0.5 || r.b > H + 0.5) out.push(`OFFSCREEN ${el.id}`); const c = document.elementFromPoint((r.l + r.r) / 2, (r.t + r.b) / 2); if (c !== el && !el.contains(c)) out.push(`COVERED ${el.id} by ${c && (c.id || c.tagName)}`); }
  const ids = { title: ['.kick', 'h1', '.lede', '#play', '#sndBtn2', '#keys', '.fine'], hud: ['#score', '#where', '#right', '#lm', '#map', '#hint'], pause: ['#pause .card'], end: ['#end .card'] }[state] || [];
  const boxes = [];
  for (const sel of ids) { const el = document.querySelector(sel); if (!el || !vis(el)) continue; const r = rect(el); boxes.push([sel, r]); if (r.l < -0.5 || r.t < -0.5 || r.r > W + 0.5 || r.b > H + 0.5) out.push(`CLIPPED ${sel} [${r.l | 0},${r.t | 0},${r.r | 0},${r.b | 0}]`); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i][1], b = boxes[j][1]; if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.push(`OVERLAP ${boxes[i][0]} x ${boxes[j][0]}`); }
  for (const el of document.querySelectorAll('#next, #street, #lmName, #scoreV, #endScore, #medal, .stats b, #endSub, .go span')) if (vis(el) && el.scrollWidth > el.clientWidth + 1) out.push(`TEXT CUT ${el.id || el.className} "${el.textContent.slice(0, 30)}"`);
  for (const row of document.querySelectorAll('.stats div')) { if (!vis(row)) continue; const [a, b] = row.children, ra = rect(a), rb = rect(b); if (ra.r > rb.l - 4 || ra.h > 30 || rb.h > 30) out.push(`STATS ROW "${row.textContent.slice(0, 24)}" collides or wraps`); }
  for (const el of document.querySelectorAll('.go span')) if (vis(el) && rect(el).h > 40) out.push(`BUTTON TEXT WRAPS "${el.textContent}"`);
  if (document.documentElement.scrollWidth > W || document.documentElement.scrollHeight > H) out.push('PAGE SCROLLS');
  return out;
};
// Tab through the page: every stop must be something the player can see
const focusWalk = async page => {
  const bad = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return null; let o = 1; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return el.id || el.tagName; o *= +cs.opacity; } return o > 0.5 ? null : el.id || el.tagName; });
    if (r) bad.push(`FOCUS ON HIDDEN ${r}`);
  }
  return [...new Set(bad)];
};
const state = (page, st, timeout = 60000) => page.waitForFunction(s => window.__acr.flow.state === s, st, { timeout });
let issues = 0;
for (const [w, h, touch] of VPS) {
  const { ctx, page, logs } = await open(browser, BASE + '?ts=8&q=low', { w, h, touch, dsf: touch ? 2 : 1 });
  const res = {}, tag = `${w}x${h}`, press = sel => touch ? page.tap(sel) : page.click(sel), shot = name => page.screenshot({ path: `${outDir}/a_${tag}_${name}.jpg`, type: 'jpeg', quality: 70 });
  await page.waitForTimeout(500); res.title = [...await page.evaluate(check, 'title'), ...await focusWalk(page)]; await shot('title');
  await press('#play'); await state(page, 'run');
  await page.waitForTimeout(450); res.hint = await page.evaluate(check, 'hud'); await shot('hint');
  if (touch) {     // one swipe = one lane, whatever its length
    const f = await fingers(page), bad = [];
    for (const len of [40, 80, 160]) {
      await page.evaluate(() => { const g = window.__acr.game; if (g.warp) g.warp(g.s, 1); else { g.lane = 1; g.d = 3.3; } (g.p || g).invuln = 9; });
      const x0 = w / 2 + len / 2, y = h * 0.7, f0 = await page.evaluate(() => window.__acr.loop.frames);
      await f.swipe([x0, y], [x0 - len, y]); await page.waitForFunction(n => window.__acr.loop.frames >= n, f0 + 3);
      const lane = await page.evaluate(() => window.__acr.game.lane); if (lane !== 0) bad.push(`SWIPE ${len}px from lane 1 ended in lane ${lane}`);
    }
    res.swipe = bad;
  }
  // worst-case HUD content: long street names, big score, top multiplier, landmark card up
  await page.evaluate(() => { const A = window.__acr, g = A.game; if (g.warp) g.warp(3560); else g.s = g.prevS = 3560; (g.scoring || g).score = 1234567; if (g.combo) { g.combo.mult = 12; g.combo.active = true; } else { g.chain = 600; g.mult = 9; } (g.p || g).invuln = 9; A.hud.landmark({ n: 'Greater Columbus Convention Center', f: 'Peter Eisenman’s 1993 pastel railyard of a building.', side: 1 }); });
  await page.waitForTimeout(350); res.hud = await page.evaluate(check, 'hud'); await shot('hud');
  await press('#pauseBtn'); await state(page, 'paused');
  await page.waitForTimeout(500); res.pause = [...await page.evaluate(check, 'pause'), ...await focusWalk(page)]; await shot('pause');
  await press('#resume'); await state(page, 'run');
  await page.evaluate(() => window.__acr.setBot(true));
  await state(page, 'results'); await page.waitForFunction(() => !window.__acr.flow.cardLocked, null, { timeout: 20000 });
  await page.waitForTimeout(700); res.end = [...await page.evaluate(check, 'end'), ...await focusWalk(page)]; await shot('end');
  await press('#again'); await state(page, 'run');
  const again = await page.evaluate(() => ({ mode: window.__acr.mode, score: window.__acr.game.score | 0, s: window.__acr.game.s | 0, mult: document.getElementById('mult').textContent }));
  res.again = again.mode === 'run' && again.s < 60 && again.mult === '×1' ? [] : [`RESTART ${JSON.stringify(again)}`];
  const errs = logs.filter(l => !l.startsWith('warning'));
  const n = Object.values(res).reduce((a, v) => a + v.length, 0) + errs.length; issues += n;
  console.log(tag, touch ? 'touch' : 'mouse', n ? JSON.stringify(res) : 'clean', errs.length ? 'ERRORS ' + errs.join(' | ') : '');
  await ctx.close();
}
await browser.close();
console.log(issues ? `${issues} issue(s)` : 'audit clean at all seven viewports');
process.exit(issues ? 1 : 0);
