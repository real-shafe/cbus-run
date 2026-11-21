// Shared by the dev tools: headless GPU Chrome, a page that waits for the game, and real fingers through CDP.
// playwright-core is borrowed from a sibling project; nothing is installed here.
import { createRequire } from 'module';
const require = createRequire(new URL('../../arabic-sound-lab/package.json', import.meta.url));
const { chromium } = require('playwright-core');

export const launch = () => chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });

// Opens `url` and waits until the game is ready. Returns { ctx, page, logs }; logs collects console errors,
// warnings and page errors. `init` is a script run before the page's own.
export async function open(browser, url, { w = 960, h = 600, touch = false, mobile = touch, dsf = 1, init, initArg } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: mobile, deviceScaleFactor: dsf });
  const page = await ctx.newPage(), logs = [];
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/favicon/.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 400)));
  if (init) await page.addInitScript(init, initArg);
  await page.goto(url);
  try { await page.waitForFunction('window.__acr && window.__acr.ready', null, { timeout: 90000 }); } catch (e) { logs.push('not ready: ' + String(e).slice(0, 200)); }
  return { ctx, page, logs };
}

// Real touch input (the page must have been opened with touch: true). Points are {x, y, id}. start and move list
// every finger that is down; end lists the fingers being lifted, and end() with no list lifts them all.
export async function fingers(page) {
  const cdp = await page.context().newCDPSession(page), pause = ms => new Promise(r => setTimeout(r, ms));
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 8, radiusY: 8, force: 1 })) });
  const f = {
    start: pts => send('touchStart', pts), move: pts => send('touchMove', pts), end: (pts = []) => send('touchEnd', pts), cancel: () => send('touchCancel', []),
    // one finger from `from` to `to` (optionally through `via` points) in `ms`, then lifted unless keep is set
    async swipe(from, to, { ms = 120, steps = 8, via = [], keep = false, id = 0, others = [] } = {}) {
      const path = [from, ...via, to], segs = path.length - 1;
      await f.start([{ x: from[0], y: from[1], id }, ...others]);
      for (let i = 1; i <= steps; i++) {
        const u = i / steps * segs, k = Math.min(segs - 1, Math.floor(u)), t = u - k, a = path[k], b = path[k + 1];
        await pause(ms / steps); await f.move([{ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, id }, ...others]);
      }
      if (!keep) await f.end(others.length ? [{ x: to[0], y: to[1], id }] : []);
    },
    async tap(x, y, ms = 60) { await f.start([{ x, y }]); await pause(ms); await f.end([]); },
  };
  return f;
}
