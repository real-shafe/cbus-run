// Dev helper: headless-Chrome screenshots and scripted driving of the running preview.
// usage: node tools/shot.mjs <outDir> '<json steps>' [width] [height] [url] ['<json opts>']
//   opts: { touch, mobile, dsf }  (touch turns itself on when a step uses tap / swipe / touch)
//   The quality tier is pinned to high (q=high) unless the url sets q or low, so shots do not depend on load.
// A step is an object; its fields are performed in this order:
//   keys: ['ArrowLeft', …]  pressed one after another, keyGap ms apart (default 60)
//   hold: { key, ms }       key held down for ms
//   click: selector         mouse click          drag: [x0, y0, x1, y1]  mouse drag
//   tap: [x, y]             one finger tap       swipe: { from: [x, y], to: [x, y], ms, steps, via: [[x, y]…] }  one finger
//   touch: [[type, [{x, y, id}…], waitMs]…]      raw multi-finger sequence; type is start | move | end | cancel.
//                                                start and move list every finger that is down, end the ones lifted
//                                                (an empty list lifts all)
//   js: expression          evaluated in the page, result printed
//   until: expression       polled until truthy (timeout: ms, default 30000)
//   wait: ms (default 700)  then a screenshot <name>.jpg unless noShot; clip: { x, y, width, height }
// Console errors and warnings are printed at the end.
// The social card (public/og.jpg, 1200x630): node tools/shot.mjs public '[{"name":"og","js":"(__acr.setBot(true), __acr.startRun(), 1)","until":"__acr.mode===\"run\" && __acr.game.s > 178","wait":0,"hide":"#hud"}]' 1200 630 <url>
import { launch, open, fingers } from './drive.mjs';

const [outDir, stepsJson, w = '960', h = '600', rawUrl = 'http://127.0.0.1:8811/?dbg=1', optsJson = '{}'] = process.argv.slice(2);
const steps = JSON.parse(stepsJson), opts = JSON.parse(optsJson);
const url = /[?&](q|low)=/.test(rawUrl) ? rawUrl : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'q=high';
const touch = opts.touch ?? steps.some(s => s.tap || s.swipe || s.touch);
const browser = await launch(), t0 = Date.now();
const { page, logs } = await open(browser, url, { w: +w, h: +h, touch, mobile: opts.mobile ?? false, dsf: opts.dsf ?? 1 });
console.log('ready in', Date.now() - t0, 'ms');
const f = touch ? await fingers(page) : null;
for (const s of steps) {
  for (const k of s.keys || []) { await page.keyboard.press(k); await page.waitForTimeout(s.keyGap ?? 60); }
  if (s.hold) { await page.keyboard.down(s.hold.key); await page.waitForTimeout(s.hold.ms ?? 300); await page.keyboard.up(s.hold.key); }
  if (s.click) await page.click(s.click);
  if (s.drag) { await page.mouse.move(s.drag[0], s.drag[1]); await page.mouse.down(); await page.mouse.move(s.drag[2], s.drag[3], { steps: 4 }); await page.mouse.up(); }
  if (s.tap) await f.tap(s.tap[0], s.tap[1]);
  if (s.swipe) await f.swipe(s.swipe.from, s.swipe.to, s.swipe);
  for (const [type, pts, ms] of s.touch || []) { await f[type](pts); if (ms) await page.waitForTimeout(ms); }
  if (s.js) { const r = await page.evaluate(s.js); if (r !== undefined && r !== null) console.log(s.name, '=>', typeof r === 'string' ? r : JSON.stringify(r)); }
  if (s.until) { try { await page.waitForFunction(s.until, null, { timeout: s.timeout ?? 30000 }); } catch { console.log(s.name, 'TIMED OUT waiting for', s.until); } }
  await page.waitForTimeout(s.wait ?? 700);
  if (s.hide) await page.addStyleTag({ content: `${s.hide} { visibility: hidden !important; }` });
  if (!s.noShot) await page.screenshot({ path: `${outDir}/${s.name}.jpg`, type: 'jpeg', quality: s.clip ? 92 : 80, ...(s.clip ? { clip: s.clip } : {}) });
}
if (logs.length) console.log(logs.slice(0, 15).join('\n'));
await browser.close();
