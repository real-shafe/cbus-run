// Keyboard + pointer → the `inp` object of DESIGN.md section 5.
// Edges (left/right/jump/duck) are queued and handed to the game one per update call; *Held fields are levels.
const CODE = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'duck', KeyS: 'duck' };
const KEY = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'jump', w: 'jump', ' ': 'jump', arrowdown: 'duck', s: 'duck' };
const ACTIONS = ['left', 'right', 'jump', 'duck'];
const REVERSE = 40;      // px a finger must come back before the same touch may act again
const TAP_MS = 300;

export class Input {
  constructor(canvas) {
    this.canvas = canvas; this.enabled = false;
    this.inp = { left: false, right: false, jump: false, duck: false, leftHeld: false, rightHeld: false, jumpHeld: false, duckHeld: false };
    this.pend = { left: 0, right: 0, jump: 0, duck: 0 };
    this.keys = new Map();        // physical key → action, while it is down
    this.forced = new Set();      // actions held through hold() (tests)
    this.g = null;                // the one pointer gesture being tracked
    addEventListener('keydown', e => this.keyDown(e));
    addEventListener('keyup', e => this.keyUp(e));
    canvas.addEventListener('pointerdown', e => this.down(e));
    addEventListener('pointermove', e => this.move(e));
    addEventListener('pointerup', e => this.up(e, true));
    addEventListener('pointercancel', e => this.up(e, false));
    canvas.addEventListener('lostpointercapture', e => this.up(e, false));
    addEventListener('contextmenu', e => e.preventDefault());
  }

  action(e) { return CODE[e.code] || KEY[(e.key || '').toLowerCase()]; }
  // how far a finger travels before it counts as a swipe: grows a little with the screen, never past a short flick
  threshold() { return Math.max(24, Math.min(36, Math.min(innerWidth, innerHeight) * 0.06)); }

  keyDown(e) {
    const a = this.action(e); if (!a || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.enabled) e.preventDefault();
    if (e.repeat) return;
    this.keys.set(e.code || e.key, a);
    if (this.enabled) { this.pend[a]++; this.sync(); }
  }
  keyUp(e) {
    const a = this.action(e); if (!a) return;
    if (this.enabled) e.preventDefault();     // Firefox clicks a focused button on Space keyup
    this.keys.delete(e.code || e.key); this.sync();
  }

  down(e) {
    if (!this.enabled || this.g) return;      // an extra finger neither steals the gesture nor adds to it
    const g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t: performance.now(), axis: null, dir: 0, ext: 0, held: null };
    if (e.pointerType === 'mouse' && e.button === 2) { g.axis = 'btn'; g.held = 'duck'; this.pend.duck++; }
    else if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.g = g; this.sync();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  }
  move(e) {
    const g = this.g; if (!g || e.pointerId !== g.id || g.axis === 'btn') return;
    if (!g.axis) {
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < this.threshold()) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';                     // locked: an arc can never add a second kind of action
      this.fire(g, Math.sign(g.axis === 'x' ? dx : dy), g.axis === 'x' ? e.clientX : e.clientY);
    } else {
      const p = g.axis === 'x' ? e.clientX : e.clientY;
      if ((p - g.ext) * g.dir > 0) g.ext = p;                               // still travelling the same way: same action
      else if ((g.ext - p) * g.dir >= REVERSE) this.fire(g, -g.dir, p);     // came back far enough: a new action
    }
  }
  fire(g, dir, p) {
    g.dir = dir; g.ext = p;
    const a = g.axis === 'x' ? (dir < 0 ? 'left' : 'right') : (dir < 0 ? 'jump' : 'duck');
    g.held = g.axis === 'y' ? a : null;       // up / down swipes hold until the finger lifts
    this.pend[a]++; this.sync();
  }
  up(e, lifted) {
    const g = this.g; if (!g || e.pointerId !== g.id) return;
    this.g = null;
    if (lifted && !g.axis && this.enabled && performance.now() - g.t < TAP_MS) this.pend.jump++;    // tap = hop
    this.sync();
  }

  sync() {
    const i = this.inp, on = this.enabled, has = a => on && (this.forced.has(a) || this.g?.held === a || [...this.keys.values()].includes(a));
    i.leftHeld = has('left'); i.rightHeld = has('right'); i.jumpHeld = has('jump'); i.duckHeld = has('duck');
  }
  enable(on) {
    this.enabled = on;
    if (!on) { this.g = null; for (const a of ACTIONS) { this.pend[a] = 0; this.inp[a] = false; } }
    this.sync();
  }
  // forget everything that is down: the window lost focus, so the matching key-ups will never arrive
  release() { this.keys.clear(); this.forced.clear(); this.g = null; for (const a of ACTIONS) { this.pend[a] = 0; this.inp[a] = false; } this.sync(); }
  // test hooks: press(action) queues one edge, hold(action, on) sets a level
  press(a) { if (this.enabled && a in this.pend) this.pend[a]++; }
  hold(a, on = true) { if (on) this.forced.add(a); else this.forced.delete(a); this.sync(); }

  // call before each game.update: releases at most one queued edge per action
  frame() { for (const a of ACTIONS) if (this.pend[a] > 0) { this.pend[a]--; this.inp[a] = true; } return this.inp; }
  // call after each game.update: an edge lives for exactly one update
  consume() { const i = this.inp; i.left = i.right = i.jump = i.duck = false; }
}
