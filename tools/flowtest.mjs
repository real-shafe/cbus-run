// Regression test of the app shell: input, flow, timers, focus, quality, render policy, loading, scoring.
// usage: node tools/flowtest.mjs [baseUrl] [section,section…] [--score=N]
//   --score=N  the score a fixed-step bot run must end on (392827 with the v1 game); without it the two bot
//              runs only have to agree with each other
// Exits 1 when any check fails. Deterministic checks step the clock with __acr.step(); the rest use real input.
import { launch, open, fingers } from './drive.mjs';

const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), pos = args.filter(a => !a.startsWith('--'));
const BASE = pos[0] || 'http://127.0.0.1:8811/', ONLY = pos[1] ? pos[1].split(',') : null;
const EXPECT = +(flags.find(f => f.startsWith('--score=')) || '').slice(8) || null;
const url = q => BASE + (q ? '?' + q : '');
const browser = await launch();
const out = [], errors = [];
const check = (name, ok, detail = '') => { out.push({ name, ok }); console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail !== '' ? '   [' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// helpers that live in the page
const HELPERS = () => {
  window.T = {
    // step the clock by hand until the flow reaches `state`
    until(state, sec = 30) { const A = window.__acr; let n = 0; while (A.flow.state !== state && n++ < sec * 60) A.step(1); return A.flow.state === state; },
    toRun() { const A = window.__acr; A.step(1); A.startRun(); return this.until('run'); },
    visible(el) { if (!el || el === document.body) return true; let o = 1; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false; o *= +cs.opacity; } return o > 0.5; },
    // count the edges the game is handed; `safe` also keeps the skater from wiping out mid-test
    spy(safe = true) { const A = window.__acr, g = A.game, up = g.update.bind(g); window.seen = { left: 0, right: 0, jump: 0, duck: 0 }; g.update = (dt, inp, raw) => { if (A.flow.state === 'run') { for (const k in window.seen) if (inp[k]) window.seen[k]++; if (safe) (g.p || g).invuln = 9; } return up(dt, inp, raw); }; },
    clear() { for (const k in window.seen) window.seen[k] = 0; },
    lane(L) { const g = window.__acr.game; if (g.warp) g.warp(g.s, L); else { g.lane = L; g.d = L * 3.3; } },
    // every sound the app asks for, by name, whichever Sfx vocabulary it uses (calls a Sfx makes on itself are not counted)
    sounds() { const sfx = window.__acr.sfx; let depth = 0; window.played = []; for (const k of ['play', 'event', 'stinger']) { const f = sfx[k]; if (f) sfx[k] = (n, a) => { if (!depth) window.played.push(n); depth++; try { return f.call(sfx, n, a); } finally { depth--; } }; } },
    finishSoon(m = 25) { const g = window.__acr.game, s = window.__acr.world.route.finish - m; if (g.warp) g.warp(s); else g.s = g.prevS = s; },
  };
};
const page0 = async (q, o = {}) => { const p = await open(browser, url(q), { init: HELPERS, ...o }); p.tag = q; return p; };
const done = async p => { for (const l of p.logs) errors.push(`${p.tag}: ${l}`); await p.ctx.close(); };
const state = page => page.evaluate(() => window.__acr.flow.state);
const waitState = (page, st, timeout = 60000) => page.waitForFunction(s => window.__acr.flow.state === s, st, { timeout, polling: 30 });
const frames = async (page, n = 3) => { const f0 = await page.evaluate(() => window.__acr.loop.frames); await page.waitForFunction(f => window.__acr.loop.frames >= f, f0 + n, { polling: 15 }); };
const realRun = async page => { await page.evaluate(() => { window.__acr.startRun(); }); await waitState(page, 'run'); };
const center = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);

const sections = {
  // ------------------------------------------------------------------ touch: one swipe = one action
  async touch() {
    const p = await page0('dbg=1&q=low', { w: 390, h: 844, touch: true, dsf: 2 }), { page } = p, f = await fingers(page);
    await page.evaluate(() => window.T.spy()); await realRun(page);
    const read = () => page.evaluate(() => ({ lane: window.__acr.game.lane, ...window.seen, held: [window.__acr.input.jumpHeld, window.__acr.input.duckHeld] }));
    const setLane = L => page.evaluate(L => { window.T.lane(L); window.T.clear(); }, L);
    const bad = [];
    for (const L of [-1, 0, 1]) for (const dir of [-1, 1]) for (const len of [60, 100, 140, 200]) {
      await setLane(L); const x0 = 195 - dir * len / 2;
      await f.swipe([x0, 600], [x0 + dir * len, 600], { ms: len > 150 ? 220 : 110 }); await frames(page);
      const r = await read(), want = Math.max(-1, Math.min(1, L + dir)), n = dir < 0 ? r.left : r.right, other = r.left + r.right + r.jump + r.duck - n;
      if (r.lane !== want || n !== 1 || other !== 0) bad.push({ L, dir, len, ...r });
    }
    check('touch: 60-200 px swipe = exactly one lane, both directions, from every lane (24 swipes)', bad.length === 0, bad.slice(0, 4));

    await setLane(1);                                          // second finger lands mid-swipe and stays
    await f.start([{ x: 300, y: 600, id: 0 }]); await f.move([{ x: 285, y: 600, id: 0 }]);
    await f.start([{ x: 285, y: 600, id: 0 }, { x: 90, y: 320, id: 1 }]);
    for (const x of [260, 230, 200, 180]) { await sleep(15); await f.move([{ x, y: 600, id: 0 }, { x: 90, y: 320, id: 1 }]); }
    await f.end([{ x: 180, y: 600, id: 0 }]); await sleep(40); await f.end(); await frames(page);       // the swiping finger lifts first
    let r = await read(); check('touch: a second finger landing mid-swipe neither drops nor doubles it', r.left === 1 && r.right + r.jump + r.duck === 0 && r.lane === 0, r);

    await setLane(0);                                          // resting thumb, then a second finger swipes and taps
    await f.start([{ x: 80, y: 700, id: 0 }]); await sleep(30);
    await f.start([{ x: 80, y: 700, id: 0 }, { x: 150, y: 400, id: 1 }]);
    for (const x of [190, 230, 270, 300]) { await sleep(15); await f.move([{ x: 80, y: 700, id: 0 }, { x, y: 400, id: 1 }]); }
    await f.end([{ x: 300, y: 400, id: 1 }]); await sleep(30);
    await f.start([{ x: 80, y: 700, id: 0 }, { x: 250, y: 300, id: 2 }]); await sleep(40); await f.end([{ x: 250, y: 300, id: 2 }]);
    await sleep(380); await f.end(); await frames(page);
    r = await read(); check('touch: a second finger does nothing (swipe and tap while another finger rests)', r.left + r.right + r.jump + r.duck === 0 && r.lane === 0, r);

    await setLane(1); await f.swipe([300, 600], [196, 516], { via: [[196, 600]], ms: 180, steps: 12 }); await frames(page);
    r = await read(); check('touch: thumb arc (104 px left curling 84 px up) = one lane change, no jump', r.left === 1 && r.jump === 0 && r.lane === 0, r);

    await setLane(0); await f.swipe([200, 600], [120, 600], { keep: true }); for (const x of [150, 190, 230]) { await sleep(15); await f.move([{ x, y: 600, id: 0 }]); }
    await f.end(); await frames(page);
    r = await read(); check('touch: reversing by 40 px or more re-arms the same finger (left, then right)', r.left === 1 && r.right === 1 && r.lane === 0, r);

    await setLane(0); await f.swipe([195, 620], [195, 520], { keep: true }); await frames(page);
    r = await read(); const upHeld = r.held[0]; await f.end(); await frames(page); const r2 = await read();
    check('touch: 100 px up-swipe = one jump, jumpHeld until the finger lifts', r.jump === 1 && upHeld === true && r2.held[0] === false && r2.jump === 1, { ...r, after: r2.held });

    await setLane(0); await f.swipe([195, 520], [195, 620], { keep: true }); await frames(page);
    r = await read(); const dnHeld = r.held[1]; await f.end(); await frames(page); const r3 = await read();
    check('touch: down-swipe = one duck, duckHeld until the finger lifts', r.duck === 1 && dnHeld === true && r3.held[1] === false && r3.duck === 1, { ...r, after: r3.held });

    await setLane(0); await f.tap(195, 600); await frames(page);
    r = await read(); check('touch: tap = one hop (jump edge, nothing held)', r.jump === 1 && r.left + r.right + r.duck === 0 && r.held[0] === false, r);
    await done(p);
  },

  // ------------------------------------------------------------------ keyboard edges and levels
  async keys() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    await page.evaluate(() => { window.T.spy(); window.T.sounds(); }); await realRun(page);
    const read = () => page.evaluate(() => ({ lane: window.__acr.game.lane, ...window.seen, duckHeld: window.__acr.input.duckHeld, jumpHeld: window.__acr.input.jumpHeld }));
    await page.evaluate(() => { window.T.clear(); window.played.length = 0; });
    await page.keyboard.press('ArrowLeft'); await frames(page); await page.keyboard.press('d'); await frames(page); await page.keyboard.press('Space'); await frames(page);
    let r = await read(); check('keys: ArrowLeft, D and Space each give exactly one edge', r.left === 1 && r.right === 1 && r.jump === 1 && r.duck === 0 && r.lane === 0, r);
    const lanes = await page.evaluate(() => window.played.filter(n => n === 'lane').length); check('audio: two lane changes play two lane sounds', lanes === 2, lanes);
    await page.evaluate(() => window.T.clear());
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await frames(page); await page.keyboard.up('ArrowRight'); await frames(page);
    r = await read(); check('keys: auto-repeat of a held key is still one edge', r.right === 1, r);
    await page.keyboard.down('ArrowDown'); await frames(page); const held = (await read()).duckHeld; await page.keyboard.up('ArrowDown'); await frames(page);
    r = await read(); check('keys: Down is duckHeld while down and released on key-up', held === true && r.duckHeld === false, { held, after: r.duckHeld });
    await page.evaluate(() => window.T.clear());
    const box = await page.evaluate(() => [innerWidth / 2, innerHeight * 0.6]);
    await page.mouse.click(box[0], box[1]); await frames(page);
    r = await read(); check('mouse: a click on the road is a hop', r.jump === 1, r);
    await done(p);
  },

  // ------------------------------------------------------------------ HUD state survives nothing across runs
  async hud() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    const r = await page.evaluate(() => {
      const A = window.__acr, g = A.game, T = window.T, badge = () => ({ text: document.getElementById('mult').textContent, one: document.getElementById('mult').classList.contains('one') });
      T.toRun(); const own = Object.getOwnPropertyDescriptor(g, 'combo');
      Object.defineProperty(g, 'combo', { configurable: true, writable: true, value: { active: true, mult: 7, pts: 100, t: 2, tMax: 2.5 } }); A.hud.frame(0); const during = badge();
      if (own) Object.defineProperty(g, 'combo', own); else delete g.combo;
      A.flow.pause(); A.startRun(); T.until('run'); A.step(3); A.hud.frame(0);
      return { during, after: badge(), real: g.combo ? g.combo.mult : g.mult };
    });
    check('hud: multiplier badge follows the game and is ×1 again after a restart', r.during.text === '×7' && !r.during.one && r.after.text === '×1' && r.after.one, r);
    await done(p);
  },

  // ------------------------------------------------------------------ leaving the window pauses and releases keys
  async blur() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    await realRun(page); await page.keyboard.down('ArrowDown'); await frames(page);
    const before = await page.evaluate(() => window.__acr.input.duckHeld);
    // a real, trusted blur: focus moves into another browsing context
    const trusted = await page.evaluate(() => new Promise(res => { addEventListener('blur', e => res(e.isTrusted), { once: true }); const f = document.createElement('iframe'); f.id = 'thief'; document.body.appendChild(f); f.contentWindow.focus(); }));
    await sleep(200);
    const a = await page.evaluate(() => ({ state: window.__acr.flow.state, duckHeld: window.__acr.input.duckHeld, keys: window.__acr.controls.keys.size, s: window.__acr.game.s }));
    await sleep(600); const s2 = await page.evaluate(() => window.__acr.game.s);
    check('blur: losing window focus pauses the run', trusted && a.state === 'paused' && s2 === a.s, { trusted, ...a, s2 });
    check('blur: keys held at that moment are released', before === true && a.duckHeld === false && a.keys === 0, { before, ...a });
    await page.keyboard.up('ArrowDown');
    await page.evaluate(() => { document.getElementById('thief').remove(); window.focus(); window.__acr.flow.resume(); }); await waitState(page, 'run'); await frames(page, 6);
    await sleep(1300);                                                   // longer than one tap-duck lasts
    const b = await page.evaluate(() => ({ duckHeld: window.__acr.input.duckHeld, crouch: window.__acr.game.crouch ?? 0, duck: !!window.__acr.game.duck }));
    check('blur: no stuck crouch after resuming', b.duckHeld === false && b.crouch < 0.5 && !b.duck, b);
    // tab hidden: pauses and draws nothing
    const h = await page.evaluate(async () => {
      const A = window.__acr; Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
      const st = A.flow.state, f0 = A.loop.frames; await new Promise(r => setTimeout(r, 500)); const drawn = A.loop.frames - f0;
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); return { st, drawn };
    });
    check('hidden tab: pauses and renders nothing', h.st === 'paused' && h.drawn === 0, h);
    await done(p);
  },

  // ------------------------------------------------------------------ nothing invisible can be focused or clicked
  async focus() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    const tabs = async n => { const seen = []; for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); seen.push(await page.evaluate(() => { const el = document.activeElement; return { id: el.id || el.tagName, vis: window.T.visible(el) }; })); } return seen; };
    const judge = (name, seen, allowed, first) => { const ids = [...new Set(seen.map(s => s.id))], ok = seen.every(s => s.vis && allowed.includes(s.id)); check(`focus: ${name}: Tab only reaches visible controls`, ok, ids.join(' ')); if (first) check(`focus: ${name}: focus starts on ${first.want}`, first.got === first.want, first.got); };
    const active = () => page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    const tf = await active(); judge('title', await tabs(12), ['play', 'sndBtn2', 'BODY'], { want: 'play', got: tf });
    const rects = {}; for (const id of ['play', 'again', 'toTitle', 'resume', 'restart', 'quit', 'pauseBtn', 'sndBtn']) rects[id] = await center(page, '#' + id);
    await realRun(page);
    const a0 = await active(), s0 = await page.evaluate(() => window.__acr.game.s);
    check('focus: run: focus starts on the game canvas', a0 === 'gl', a0);
    const hits = await page.evaluate(rects => Object.entries(rects).filter(([id]) => !['pauseBtn', 'sndBtn'].includes(id)).map(([id, [x, y]]) => { const el = document.elementFromPoint(x, y); return [id, el && (el.id || el.tagName)]; }).filter(([id, hit]) => hit === id), rects);
    check('focus: hidden overlay buttons are not hit-testable mid-run', hits.length === 0, hits);
    for (const id of ['play', 'restart', 'quit', 'toTitle']) await page.mouse.click(rects[id][0], rects[id][1]);
    await sleep(500); let r = await page.evaluate(() => ({ state: window.__acr.flow.state, s: window.__acr.game.s }));
    check('focus: clicking where hidden buttons sit does nothing mid-run', r.state === 'run' && r.s > s0, r);
    // mouse click on the HUD sound button must not leave focus there
    await page.mouse.click(rects.sndBtn[0], rects.sndBtn[1]); await sleep(100); const af = await active(); await page.mouse.click(rects.sndBtn[0], rects.sndBtn[1]);
    check('focus: after a mouse click on a HUD button, focus is back on the game', af === 'gl', af);
    // Tab from the game reaches the two HUD buttons; the third Tab leaves the page (v1: it landed on the invisible PLAY)
    await page.evaluate(() => document.getElementById('gl').focus());
    const seen = await tabs(2); check('focus: run: Tab reaches exactly the two visible HUD buttons', seen.map(x => x.id).join() === 'sndBtn,pauseBtn' && seen.every(x => x.vis), seen);
    await page.keyboard.press('Tab'); await sleep(450); const third = await page.evaluate(() => { const el = document.activeElement; return { id: el.id || el.tagName, vis: window.T.visible(el) }; });
    await page.keyboard.press('Enter'); await sleep(900);
    r = await page.evaluate(() => ({ state: window.__acr.flow.state, s: window.__acr.game.s }));
    check('focus: Tab x3 + Enter mid-run lands on something visible and cannot wipe the run', third.vis && r.s >= s0 && ['run', 'paused', 'resume'].includes(r.state), { third, ...r });
    if (r.state === 'paused') await page.evaluate(() => window.__acr.flow.resume());
    await waitState(page, 'run');
    await page.keyboard.press('p'); await waitState(page, 'paused'); await sleep(450);
    const pf = await active(); judge('pause', await tabs(10), ['resume', 'restart', 'sndBtn3', 'quit', 'BODY'], { want: 'resume', got: pf });
    await page.evaluate(() => window.__acr.flow.resume()); await waitState(page, 'run');
    // finish coast: the faded HUD must be dead
    await page.evaluate(() => window.T.finishSoon(30)); await waitState(page, 'finish'); await sleep(450);
    await page.mouse.click(rects.pauseBtn[0], rects.pauseBtn[1]); await sleep(300);
    r = await page.evaluate(() => ({ state: window.__acr.flow.state, hudVis: getComputedStyle(document.getElementById('hud')).visibility, inert: document.getElementById('hud').inert }));
    check('focus: the faded HUD cannot be clicked during the finish coast', r.state !== 'paused' && r.inert === true, r);
    await waitState(page, 'results'); await page.waitForFunction(() => !window.__acr.flow.cardLocked, null, { timeout: 20000 }); await sleep(450);
    const ef = await active(); judge('results', await tabs(8), ['again', 'toTitle', 'BODY'], { want: 'again', got: ef });
    await done(p);
  },

  // ------------------------------------------------------------------ transitions cannot interleave
  async flow() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    const snap = () => page.evaluate(() => { const A = window.__acr, on = id => document.getElementById(id).classList.contains('on'); return { state: A.flow.state, hud: on('hud'), title: on('title'), pause: on('pause'), end: on('end'), skater: A.game.skater.root.visible, line: A.flow.titleScene.line.visible, locked: A.flow.locked }; });
    const rects = {}; for (const id of ['play', 'again', 'toTitle', 'restart', 'quit']) rects[id] = await center(page, '#' + id);
    // camera must not cut to the intro crane before the fade is opaque
    const cut = await page.evaluate(async () => { const A = window.__acr, y0 = A.camera.position.y; document.getElementById('play').click(); await new Promise(r => setTimeout(r, 90)); return { y0, y: A.camera.position.y, state: A.flow.state, locked: A.flow.locked }; });
    check('flow: PLAY keeps the title camera until the fade has covered it', cut.state === 'title' && cut.locked && Math.abs(cut.y - cut.y0) < 5, cut);
    await page.mouse.click(rects.play[0], rects.play[1]); await page.mouse.click(rects.play[0], rects.play[1]);      // extra clicks during the fade
    await waitState(page, 'run'); await sleep(300);
    // pause → Back to title, then Restart 120 ms later (the v1 race)
    await page.keyboard.press('p'); await waitState(page, 'paused'); await sleep(450);
    await page.mouse.click(rects.quit[0], rects.quit[1]); await sleep(120); await page.mouse.click(rects.restart[0], rects.restart[1]);
    await sleep(1600); let s = await snap();
    check('flow: Back to title then Restart inside the fade ends in one clean state', s.state === 'title' && s.title && !s.hud && !s.pause && !s.skater && s.line && !s.locked, s);
    await page.mouse.click(rects.play[0], rects.play[1]); await waitState(page, 'run');
    // the paused run must not simulate under the restart fade
    await page.keyboard.press('p'); await waitState(page, 'paused'); await sleep(450);
    const under = await page.evaluate(async rects => {
      const A = window.__acr, g = A.game, s0 = g.s, log = []; document.getElementById('restart').click();
      for (let i = 0; i < 40 && A.flow.locked; i++) { log.push(g.s); await new Promise(r => requestAnimationFrame(r)); }
      return { s0, moved: log.some(v => v !== s0), n: log.length, pops: document.getElementById('pops').children.length, state: A.flow.state };
    }, rects);
    check('flow: the old run is frozen under the Restart fade and leaves no popups', !under.moved && under.pops === 0 && under.n > 2, under);
    await waitState(page, 'run');
    // results: Title, then R 100 ms later
    await page.evaluate(() => window.T.finishSoon(20)); await waitState(page, 'results'); await page.waitForFunction(() => !window.__acr.flow.cardLocked, null, { timeout: 20000 });
    const tt = await center(page, '#toTitle'); await page.mouse.click(tt[0], tt[1]); await sleep(100); await page.keyboard.press('r'); await sleep(1600); s = await snap();
    check('flow: Title then R inside the fade ends in one clean state', s.state === 'title' && s.title && !s.hud && !s.end && !s.skater && s.line && !s.locked, s);
    const illegal = await page.evaluate(async () => { const A = window.__acr; return [await A.flow.go('run'), await A.flow.go('results'), await A.flow.go('paused'), A.flow.state]; });
    check('flow: illegal moves are refused (title → run / results / paused)', illegal.join() === 'false,false,false,title', illegal);
    await done(p);
  },

  // ------------------------------------------------------------------ timers die with their state
  async timers() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    await page.evaluate(() => window.T.sounds());
    await page.click('#play'); await waitState(page, 'run');
    const first = await page.evaluate(() => window.played.filter(n => n === 'count' || n === 'go' || n.startsWith('countdown')));
    check('timers: first countdown after load is exactly 3-2-1-GO (no double beep)', first.join() === 'count,count,count,go' || first.join() === 'countdown3,countdown2,countdown1,go', first);
    const r = await page.evaluate(() => {
      const A = window.__acr, T = window.T, el = document.getElementById('hint'), hint = () => el.classList.contains('show'), log = {}; let legend = '';
      A.step(60); log.t1 = hint();                       // 1 s into the run: hint is up
      A.flow.pause(); A.startRun(); T.until('run');       // quick restart
      A.step(18); log.restart03 = hint(); legend = el.innerHTML;       // 0.3 s after the new GO
      A.step(216); log.restart39 = hint();                // 3.9 s
      A.step(30); log.restart44 = hint() && el.innerHTML === legend;       // 4.4 s: gone (or replaced by a lesson of the v2 game)
      const digits = []; const count = A.hud.count.bind(A.hud); A.hud.count = t => { if (t != null) digits.push(t); return count(t); };
      A.flow.pause(); A.startRun(); T.until('intro'); A.step(30); A.flow.pause(); A.step(240);       // pause mid-countdown and wait 4 s
      log.pausedState = A.flow.state; log.digitsWhilePaused = digits.slice();
      A.flow.resume(); T.until('run'); log.digits = digits; log.gameState = A.game.state;
      return log;
    });
    check('timers: control hint survives a quick restart for its full 4.2 s', r.t1 && r.restart03 && r.restart39 && !r.restart44, r);
    check('timers: a countdown paused part-way stops, then replays whole on resume', r.pausedState === 'paused' && r.digitsWhilePaused.join('') === '3' && r.digits.join('') === '3321GO', r);
    await done(p);
  },

  // ------------------------------------------------------------------ results card and resume countdown
  async results() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    await realRun(page); await page.evaluate(() => window.T.finishSoon(25)); await waitState(page, 'finish');
    // mash jump (key + pointer on the button's spot) through the coast and for 3 s after the card appears
    let shownAt = 0, dismissed = false; const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await page.keyboard.press('Space'); const at = await center(page, '#again'); await page.mouse.click(at[0], at[1]); await sleep(90);
      const st = await state(page);
      if (st === 'results' && !shownAt) shownAt = Date.now();
      if (shownAt && st !== 'results') { dismissed = true; break; }
      if (shownAt && Date.now() - shownAt > 3000) break;
    }
    const locked = await page.evaluate(() => window.__acr.flow.cardLocked);
    check('results: jump taps and clicks on the button spot never dismiss the card (3 s of mashing)', shownAt > 0 && !dismissed && locked, { shownAt: shownAt - t0, dismissed, locked });
    await page.waitForFunction(() => !window.__acr.flow.cardLocked, null, { timeout: 5000 }); const unlockMs = Date.now() - t0;
    await page.keyboard.press('Space'); await sleep(600);
    check('results: Space does not dismiss it even when unlocked', await state(page) === 'results', unlockMs);
    await page.keyboard.press('Enter'); await sleep(900);
    const st = await state(page); check('results: Enter (or R, or the button) restarts', st === 'intro' || st === 'run', st);
    await done(p);

    const q = await page0('dbg=1&bot=1&q=low'), r = await q.page.evaluate(() => {
      const A = window.__acr, T = window.T, log = {};
      T.toRun(); T.finishSoon(20); T.until('results');
      A.step(70); log.at117 = A.flow.cardLocked; log.r117 = [A.flow.start !== undefined, document.getElementById('endRow').inert];
      A.step(3); log.at122 = A.flow.cardLocked; log.inert = document.getElementById('endRow').inert;
      // resume countdown
      A.startRun(); T.until('run'); A.step(60); A.flow.pause(); const s0 = A.game.s;
      A.flow.resume(); log.resumeState = A.flow.state; log.mode = A.mode; A.step(72); log.stillFrozen = A.flow.state === 'resume' && A.game.s === s0 && !A.controls.enabled;
      let n = 72; while (A.flow.state === 'resume' && n < 240) { log.digit = document.getElementById('count').textContent; A.step(1); n++; }
      log.countdownS = +(n / 60).toFixed(2); log.afterState = A.flow.state; A.step(10); log.moving = A.game.s > s0; log.enabled = A.controls.enabled;
      return log;
    });
    check('results: the card is locked for 1.2 s, then unlocks by itself', r.at117 === true && r.at122 === false && r.inert === false, r);
    check('pause: Resume runs a 3-2-1 with the world frozen before control returns', r.resumeState === 'resume' && r.mode === 'paused' && r.stillFrozen && r.digit === '1' && r.countdownS >= 1.4 && r.countdownS <= 2.6 && r.afterState === 'run' && r.moving && r.enabled, r);
    await done(q);
  },

  // ------------------------------------------------------------------ quality controller
  async quality() {
    const p = await page0('dbg=1'), { page } = p;
    const r = await page.evaluate(() => {
      const A = window.__acr, Q = A.quality, log = {}, feed = (ms, sec) => { for (let t = 0; t < sec * 1000; t += ms) Q.sample(ms, 'run'); return Q.tier; };
      const fresh = hz => { Q.pinned = false; Q.set('high'); Q.refresh = 1000 / hz; Q.bad = Q.good = 0; Q.upWait = 8; Q.settle = 0; };
      const progs = () => { A.loop.draw(); return A.renderer.info.programs.length; }, p0 = progs();
      fresh(30); log.hz30 = feed(1000 / 30, 40);                    // steady 30 Hz display
      fresh(60); log.hz60 = feed(1000 / 60, 40);
      fresh(120); log.hz120 = feed(1000 / 120, 40);
      fresh(60); log.oneBadWindow = feed(30, 2.7); log.twoBadWindows = feed(30, 2.1);         // 33 fps on a 60 Hz display
      log.pMid = progs(); log.stillBad = feed(30, 5); log.pLow = progs();
      log.floor = feed(30, 10);
      log.up7 = feed(1000 / 60, 7); log.up10 = feed(1000 / 60, 3.5);                           // holds 60 again: one step up after ~8 s
      log.failed = feed(30, 5.5); log.upWait = Q.upWait;                                       // …and it could not hold it: back down, wait longer
      log.patient = feed(1000 / 60, 20); log.patient2 = feed(1000 / 60, 16);
      fresh(60); const mix = []; for (let i = 0; i < 400; i++) mix.push(i % 5 < 2 ? 33.4 : 16.7); for (const ms of mix) Q.sample(ms, 'run'); log.janky = Q.tier;   // 40 % dropped frames
      fresh(60); for (let i = 0; i < 200; i++) Q.sample(16.7, 'run'); Q.sample(900, 'run'); for (let i = 0; i < 400; i++) Q.sample(16.7, 'run'); log.stall = Q.tier;
      fresh(60); for (let i = 0; i < 30; i++) Q.sample(1000 / 30, 'still'); log.idleProbe = Math.round(1000 / Q.refresh);
      fresh(60); for (let i = 0; i < 60; i++) Q.sample(i % 2 ? 50 : 1000 / 30, 'title'); log.titleSlow = Math.round(1000 / Q.refresh);       // a slow title must not look like a slow screen
      Q.refresh = 1000 / 30; for (let i = 0; i < 30; i++) Q.sample(1000 / 120, 'title'); log.titleFast = Math.round(1000 / Q.refresh);
      fresh(60); for (let i = 0; i < 30; i++) Q.sample(80, 'still'); log.floor30 = Math.round(1000 / Q.refresh);
      fresh(60); Q.set('low'); log.dprLow = Q.pixelRatio; Q.set('high'); log.pEnd = progs(); log.p0 = p0;
      return log;
    });
    check('quality: a steady 30 Hz display is not downgraded (40 s)', r.hz30 === 'high', r.hz30);
    check('quality: steady 60 Hz and 120 Hz displays stay put', r.hz60 === 'high' && r.hz120 === 'high', [r.hz60, r.hz120]);
    check('quality: 33 fps on a 60 Hz display steps down after two 2 s windows, not one', r.oneBadWindow === 'high' && r.twoBadWindows === 'mid' && r.stillBad === 'low' && r.floor === 'low', [r.oneBadWindow, r.twoBadWindows, r.stillBad, r.floor]);
    check('quality: steps back up after 8 s of good frames, then backs off when that fails', r.up7 === 'low' && r.up10 === 'mid' && r.failed === 'low' && r.upWait === 32 && r.patient === 'low' && r.patient2 === 'mid', [r.up7, r.up10, r.failed, r.upWait, r.patient, r.patient2]);
    check('quality: 40 % dropped frames count as slow even though the median looks fine', r.janky !== 'high', r.janky);
    check('quality: one long stall is not evidence', r.stall === 'high', r.stall);
    check('quality: the display rate is re-measured while paused; the title can only show it is faster; never below 30 Hz', r.idleProbe === 30 && r.titleSlow === 60 && r.titleFast === 120 && r.floor30 === 30, [r.idleProbe, r.titleSlow, r.titleFast, r.floor30]);
    check('quality: tier changes compile no shader', r.pMid === r.p0 && r.pLow === r.p0 && r.pEnd === r.p0, [r.p0, r.pMid, r.pLow, r.pEnd]);
    await done(p);
    for (const [q, tier, shadows] of [['q=low', 'low', false], ['low=1', 'low', false], ['q=mid', 'mid', true], ['q=high', 'high', true]]) {
      const a = await page0(q, { dsf: 2 }), v = await a.page.evaluate(() => { const Q = window.__acr.quality; for (let t = 0; t < 30000; t += 40) Q.sample(40, 'run'); return { tier: Q.tier, pinned: Q.pinned, shadows: Q.build.shadows, pr: window.__acr.renderer.getPixelRatio(), saved: localStorage.getItem('acr.tier') }; });
      check(`quality: ?${q} pins ${tier}`, v.tier === tier && v.pinned && v.shadows === shadows && v.pr === { low: 1, mid: 1.5, high: 2 }[tier] && v.saved === null, v);
      await done(a);
    }
    // real loop under virtual display clocks
    for (const hz of [30, 60, 120]) {
      const a = await page0('dbg=1&bot=1', { init: `(${VCLOCK})(${1000 / hz}); (${HELPERS})()` });
      await a.page.evaluate(() => { const Q = window.__acr.quality; Q.pinned = false; Q.set('high'); window.__acr.startRun(); });
      await waitState(a.page, 'run'); const f0 = await a.page.evaluate(() => window.__vf);
      await a.page.waitForFunction(([f, n]) => window.__vf >= f + n, [f0, hz * 12], { timeout: 240000, polling: 100 });
      const v = await a.page.evaluate(() => { const Q = window.__acr.quality; return { tier: Q.tier, hz: +(1000 / Q.refresh).toFixed(1), ratio: +Q.last.ratio.toFixed(2), state: window.__acr.flow.state }; });
      check(`quality: real loop on a ${hz} Hz display for 12 s: rate detected, tier kept`, v.tier === 'high' && Math.abs(v.hz - hz) < 1 && v.state === 'run', v);
      await done(a);
    }
  },

  // ------------------------------------------------------------------ render policy and GL context loss
  async render() {
    const a = await page0('dbg=1&q=high', { init: `(${VCLOCK})(${1000 / 60}); (${HELPERS})()` }), { page } = a;
    const span = async n => { const [v0, f0] = await page.evaluate(() => [window.__vf, window.__acr.loop.frames]); await page.waitForFunction(([v, n]) => window.__vf >= v + n, [v0, n], { timeout: 120000, polling: 50 }); const [v1, f1] = await page.evaluate(() => [window.__vf, window.__acr.loop.frames]); return (f1 - f0) / (v1 - v0); };
    const title = await span(120); check('render: title draws about every other frame (30 fps on a 60 Hz display)', title > 0.45 && title < 0.55, title.toFixed(3));
    await realRun(page); const run = await span(120); check('render: the run draws every frame', run > 0.97, run.toFixed(3));
    const progs0 = await page.evaluate(() => window.__acr.renderer.info.programs.length);
    await page.keyboard.press('p'); await waitState(page, 'paused'); await sleep(200);
    const f0 = await page.evaluate(() => window.__acr.loop.frames); await span(90); const f1 = await page.evaluate(() => window.__acr.loop.frames);
    await page.setViewportSize({ width: 900, height: 600 }); await span(30); const f2 = await page.evaluate(() => window.__acr.loop.frames);
    check('render: paused draws nothing, a resize draws once', f1 === f0 && f2 > f1 && f2 <= f1 + 3, { paused: f1 - f0, afterResize: f2 - f1 });
    const lost = await page.evaluate(async () => { const A = window.__acr; A.flow.resume(); await new Promise(r => setTimeout(r, 50)); A.renderer.forceContextLoss(); await new Promise(r => setTimeout(r, 400)); const f = A.loop.frames; await new Promise(r => setTimeout(r, 300)); return { ctx: !document.getElementById('ctx').hidden, lost: A.loop.lost, state: A.flow.state, drawn: A.loop.frames - f, focus: document.activeElement.id, hudInert: document.getElementById('hud').inert }; });
    check('context lost: run stops, nothing draws, "Tap to reload" is up and focused', lost.ctx && lost.lost && lost.drawn === 0 && lost.focus === 'ctxBtn' && lost.state !== 'run', lost);
    a.logs.splice(0, a.logs.length, ...a.logs.filter(l => !/context lost|CONTEXT_LOST/i.test(l)));      // the loss itself is logged by three.js
    await done(a);
  },

  // ------------------------------------------------------------------ loading
  async loading() {
    const WATCH = () => {
      window.__labels = []; let last = null;
      new MutationObserver(() => { const el = document.getElementById('playT'); if (!el) return; const v = el.textContent; if (v !== last) { last = v; window.__labels.push([v, document.getElementById('play').disabled, !!(window.__acr && window.__acr.ready)]); } }).observe(document, { childList: true, subtree: true, characterData: true });
    };
    const a = await page0('q=high', { init: `(${WATCH})(); (${HELPERS})()` }), { page } = a;
    const r = await page.evaluate(() => { const e = performance.getEntriesByType('resource'), at = n => e.find(x => x.name.includes(n)); return { labels: window.__labels, city: at('city.json')?.startTime, three: at('three.module')?.responseEnd, main: at('js/main.js')?.responseEnd, cityCount: e.filter(x => x.name.includes('city.json')).length, progs: window.__acr.renderer.info.programs.length, live: document.getElementById('gl').classList.contains('live') }; });
    const names = r.labels.map(l => l[0]), i = names.indexOf('PLAY');
    check('loading: PLAY stays disabled through every stage, the last one being the warm-up', i > 3 && r.labels.slice(0, i).every(l => l[1] === true) && r.labels[i][1] === false && names[i - 1] === 'Warming up…' && names.includes('Fetching the map…'), names.join(' | '));
    check('loading: city.json is requested once, before the module graph has arrived', r.cityCount === 1 && r.city < r.three && r.city < r.main, { cityStart: r.city | 0, threeEnd: r.three | 0, mainEnd: r.main | 0, requests: r.cityCount });
    // nothing may compile once PLAY is enabled: ride the whole route with the bot and compare program counts
    await page.evaluate(() => { window.__acr.setBot(true); window.__acr.startRun(); }); await waitState(page, 'run'); await sleep(1500);
    const p1 = await page.evaluate(() => window.__acr.renderer.info.programs.length);
    check('loading: the first seconds of a run compile no shader (programs ' + r.progs + ' → ' + p1 + ')', p1 === r.progs, [r.progs, p1]);
    await done(a);
  },

  // ------------------------------------------------------------------ small promises
  async misc() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    const free = await page.evaluate(async () => { const A = window.__acr; A.mode = 'free'; A.camera.position.set(100, 80, 900); await new Promise(r => setTimeout(r, 300)); const held = A.camera.position.y === 80 && A.rig.free; A.mode = 'title'; await new Promise(r => setTimeout(r, 300)); return { held, back: A.camera.position.y !== 80 && !A.rig.free, mode: A.mode }; });
    check("tools: __acr.mode = 'free' parks the camera rig, any other value hands it back", free.held && free.back && free.mode === 'title', free);
    const stats = await page.evaluate(() => document.getElementById('stats').hidden);
    await done(p);
    const q = await page0('q=low&stats=1'); await sleep(1200);
    const line = await q.page.evaluate(() => document.getElementById('stats').textContent);
    check('stats: ?stats=1 shows fps, frame ms, triangles, calls and tier (hidden without it)', stats === true && /fps .* ms .* tris .* calls .* low pinned/.test(line), line);
    await done(q);
    // the map fails to load: say so, and let the button retry
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } }), pg = await ctx.newPage();
    await pg.route('**/data/city.json', r => r.fulfill({ status: 503, body: 'no' })); await pg.goto(url('q=low'));
    await pg.waitForFunction(() => /retry/i.test(document.getElementById('playT').textContent), null, { timeout: 30000 });
    const f = await pg.evaluate(() => ({ label: document.getElementById('playT').textContent, disabled: document.getElementById('play').disabled, ready: !!(window.__acr && window.__acr.ready) }));
    await pg.unroute('**/data/city.json'); await pg.click('#play'); await pg.waitForFunction('window.__acr && window.__acr.ready', null, { timeout: 90000 });
    check('loading: a failed download is reported on the button, and tapping it retries', /Could not load/.test(f.label) && !f.disabled && !f.ready, f);
    await ctx.close();
  },

  // ------------------------------------------------------------------ the v2 contract, exercised against stand-ins
  async contract() {
    const p = await page0('dbg=1&q=low'), { page } = p;
    const r = await page.evaluate(async () => {
      const A = window.__acr, g = A.game, T = window.T, log = {}, calls = [];
      T.toRun(); A.step(30);
      const up = g.update.bind(g); g.update = (dt, inp, raw) => { calls.push([dt, raw]); return up(dt, inp, raw); };
      // the game always gets real time; hit-stop and slow-motion only change what the camera and world follow
      A.loop.manual = true; const view = [];
      if (g.slowmo) { g.hitStop = 0.05; view.push(A.loop.advance(1 / 60, 1)); g.hitStop = 0; g.slowmo(1, 0.3); view.push(A.loop.advance(1 / 60, 1)); g.slowT = 0; view.push(A.loop.advance(1 / 60, 1)); }
      else { g.hitStop = 0.05; view.push(A.loop.advance(1 / 60, 1)); delete g.hitStop; g.timeScale = 0.3; view.push(A.loop.advance(1 / 60, 1)); delete g.timeScale; view.push(A.loop.advance(1 / 60, 1)); }
      log.time = { view, real: calls.every(c => Math.abs(c[0] - 1 / 60) < 1e-12) && calls.length === 3 };
      // native events: hooks.event goes straight to the bus, the legacy hooks fall silent
      const seen = []; A.bus.tap((n, pl) => seen.push(n)); T.sounds(); const pops = () => [...document.getElementById('pops').children].map(e => e.textContent);
      g.nativeEvents = true; g.hooks.popup('OLD', 5, 'trick'); g.hooks.sfx('lane'); g.hooks.mult(3);
      log.legacySilent = seen.length === 0 && window.played.length === 0 && pops().length === 0;
      g.hooks.event('trick', { id: 'kickflip', label: 'KICKFLIP', pts: 150, kind: 'trick', repeat: 0 }); g.hooks.event('lane', { from: 0, to: 1, air: false, slide: false });
      g.hooks.event('crash', { kind: 'vehicle', vehicle: true, speed: 20, lost: 0, x: 0, y: 0, z: 0 }); g.hooks.event('teach', { id: 't1', action: 'duck', s: 100, lane: 0 });
      log.native = { seen: seen.join(), pops: pops(), played: window.played.join(), hint: document.getElementById('hint').textContent, shake: A.rig.shake };
      g.nativeEvents = false;
      // v2 audio: a Sfx with event / stinger / frame(object) gets exactly those
      const { Sound } = await import('./js/app/sound.js'), { Bus } = await import('./js/app/bus.js');
      const got = { event: [], stinger: [], frame: [], play: [] }, bus = new Bus();
      const sfx = { ctx: null, init() {}, setMuted() {}, music() {}, play(n) { got.play.push(n); }, event(n, pl) { got.event.push(n); }, stinger(n) { got.stinger.push(n); }, frame(...a) { got.frame.push(a); } };
      const game = { nativeEvents: true, speed: 24, speed01: 0.5, s: 1900, air: true, grind: null, slide: -1, duck: false, boost: 0.4, flow: 3, combo: { active: true, mult: 4, t: 1, tMax: 2.5 } };
      const snd = new Sound({ sfx, bus, game, world: A.world, store: { get: (k, d) => d, set() {} }, $: id => document.getElementById(id) });
      bus.emit('district', { i: 1, name: 'Arena District' }); bus.emit('go', {}); bus.emit('pickup', { kind: 'nut', streak: 2 }); bus.emit('app:state', { from: 'a', to: 'b' });
      snd.stinger('countdown3'); snd.frame(true, false);
      log.v2audio = { ...got, frame: got.frame[0] };
      A.sound.paint();
      return log;
    });
    const v = r.time.view; check('loop: the game is stepped in real time; hitStop / timeScale scale only the view time', r.time.real && v[0] === 0 && Math.abs(v[1] - 0.3 / 60) < 1e-12 && Math.abs(v[2] - 1 / 60) < 1e-12, r.time);
    check('events: with game.nativeEvents the legacy hooks are silent', r.legacySilent === true, r.legacySilent);
    const n = r.native; check('events: hooks.event reaches bus, HUD, camera and the Sfx', n.seen === 'trick,lane,crash,teach' && n.pops.join() === 'KICKFLIP+150,OUCH' && (n.played === 'trick,lane,crash,honk' || n.played === 'trick,lane,crash,teach') && /duck/.test(n.hint) && n.shake === 1, n);
    const a = r.v2audio, f = a.frame[0], keys = ['running', 'paused', 'speed01', 'air', 'grind', 'slide', 'duck', 'boost', 'flow', 'comboT', 'comboMult', 'district', 'progress', 'dusk'];
    check('audio: a v2 Sfx gets event() for every game event, stinger() and frame(object)', a.event.join() === 'district,go,pickup' && a.stinger.join() === 'countdown3' && a.play.length === 0 && a.frame.length === 1 && keys.every(k => k in f) && f.district === 1 && f.comboT === 0.4 && f.comboMult === 4 && f.slide === -1 && f.running === true, a);
    await done(p);
  },

  // ------------------------------------------------------------------ the bot must score exactly what it always did
  async bot() {
    const a = await page0('dbg=1&bot=1&q=high'), stepped = await a.page.evaluate(() => {
      const A = window.__acr, seen = new Set(); A.bus.tap(n => seen.add(n)); window.T.sounds();
      window.T.toRun(); let n = 0; while (A.flow.state !== 'results' && n++ < 40000) A.step(1, 1 / 60);
      return { score: Math.round(A.game.score), card: document.getElementById('endScore').textContent, sub: document.getElementById('endSub').textContent, best: localStorage.getItem('acr.best'), events: [...seen].sort() };
    });
    const need = ['go', 'lane', 'jump', 'land', 'pickup', 'arch', 'trick', 'combo', 'district', 'landmark', 'finishLine', 'done', 'app:state', 'app:countdown'];
    check('events: a run puts the DESIGN.md events on the bus', need.every(n => stepped.events.includes(n)), stepped.events.join(' '));
    check('store: a test run does not write the best score', stepped.best === null && /not saved/.test(stepped.sub), stepped.sub);
    await done(a);
    const b = await page0('dbg=1&bot=1&auto=1&ts=8&q=high', { init: `(${VCLOCK})(${1000 / 60}); (${HELPERS})()` });
    const p0 = await b.page.evaluate(() => window.__acr.renderer.info.programs.length);
    await waitState(b.page, 'results', 600000);
    const real = await b.page.evaluate(() => ({ score: Math.round(window.__acr.game.score), card: document.getElementById('endScore').textContent, progs: window.__acr.renderer.info.programs.length, frames: window.__vf }));
    check(`bot: fixed-step run and real loop on a virtual 60 Hz clock agree (${stepped.card} / ${real.card})`, stepped.score === real.score && stepped.card === real.card, [stepped.score, real.score]);
    if (EXPECT) check(`bot: score is the expected ${EXPECT.toLocaleString('en-US')}`, real.score === EXPECT && stepped.score === EXPECT, [stepped.score, real.score]);
    check('bot: a whole rendered run compiles no shader (programs ' + p0 + ' → ' + real.progs + ')', real.progs === p0, [p0, real.progs]);
    await done(b);
  },

  // ------------------------------------------------------------------ real keys, start to finish
  async keyrun() {
    const a = await page0('ts=4&q=low'), { page } = a;
    await page.evaluate(() => { const A = window.__acr; window.T.spy(false); window.ev = { lane: 0, jump: 0, crash: 0 }; for (const k in window.ev) A.bus.on(k, () => window.ev[k]++); });
    await page.click('#play'); await waitState(page, 'run');
    const KEY = { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Space', duck: 'ArrowDown' }; let presses = 0; const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      const want = await page.evaluate(() => { const A = window.__acr; if (A.flow.state !== 'run') return A.flow.state; const tmp = { left: false, right: false, jump: false, duck: false }; A.game.bot(tmp); return tmp; });
      if (typeof want === 'string') { if (want === 'results') break; await sleep(100); continue; }
      for (const k in KEY) if (want[k]) { await page.keyboard.press(KEY[k]); presses++; }
      await sleep(25);
    }
    const r = await page.evaluate(() => ({ state: window.__acr.flow.state, mode: window.__acr.mode, card: document.getElementById('endScore').textContent, end: document.getElementById('end').classList.contains('on'), seen: window.seen, ev: window.ev, time: +window.__acr.game.time.toFixed(1), s: window.__acr.game.s | 0 }));
    check('keyboard run: real key presses carry the skater to the finish and the results card', r.state === 'results' && r.mode === 'end' && r.end && r.ev.lane > 5 && r.ev.jump > 5 && r.seen.left + r.seen.right > 5, { presses, ...r });
    await done(a);
  },

  // ------------------------------------------------------------------ a real score is saved, a test score is not
  async store() {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } }), logs = [];
    const load = async q => { const page = await ctx.newPage(); page.on('pageerror', e => logs.push(String(e))); await page.addInitScript(HELPERS); await page.goto(url(q)); await page.waitForFunction('window.__acr && window.__acr.ready', null, { timeout: 90000 }); return page; };
    let page = await load('q=low');
    await page.click('#play'); await waitState(page, 'run'); await page.evaluate(() => window.T.finishSoon(20)); await waitState(page, 'results');
    const a = await page.evaluate(() => ({ score: window.__acr.flow.lastResults.score, best: localStorage.getItem('acr.best'), sub: document.getElementById('endSub').textContent }));
    check('store: a normal run saves its best score', a.score > 0 && +a.best === a.score && /New best/.test(a.sub), a);
    await page.close(); page = await load('dbg=1&bot=1&q=low');
    const b = await page.evaluate(() => { const A = window.__acr; window.T.toRun(); let n = 0; while (A.flow.state !== 'results' && n++ < 40000) A.step(1, 1 / 60); return { score: A.flow.lastResults.score, best: localStorage.getItem('acr.best'), shown: document.getElementById('best').textContent, sub: document.getElementById('endSub').textContent }; });
    check('store: a later, higher test run leaves it alone', b.score > a.score && +b.best === a.score && /not saved/.test(b.sub), b);
    for (const l of logs) errors.push('store: ' + l); await ctx.close();
  },
};

// replaces requestAnimationFrame with a display that ticks exactly every `step` ms
const VCLOCK = step => { const raf = window.requestAnimationFrame.bind(window); let vt = performance.now(); window.__vf = 0; window.requestAnimationFrame = cb => raf(() => { vt += step; window.__vf++; cb(vt); }); };

for (const [name, fn] of Object.entries(sections)) {
  if (ONLY && !ONLY.includes(name)) continue;
  console.log(name);
  try { await fn(); } catch (e) { check(`${name}: section crashed`, false, String(e).slice(0, 300)); }
}
await browser.close();
check('no console errors, warnings or page errors in any session', errors.length === 0, errors.slice(0, 6));
const failed = out.filter(o => !o.ok);
console.log(`\n${out.length - failed.length} / ${out.length} checks passed`);
process.exit(failed.length ? 1 : 0);
