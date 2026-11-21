// Quality controller. Owns the tier ('low' | 'mid' | 'high'), the renderer pixel ratio and the calls to
// W.setQuality(tier). Everything it changes at run time is free of shader recompiles: pixel ratio and whatever
// the world does inside setQuality. Build-time choices (shadows, texture sizes) are fixed in `build` before the
// world exists and never change afterwards.
export const TIERS = ['low', 'mid', 'high'];
const DPR = { low: 1, mid: 1.5, high: 2 };      // pixel ratio caps (the device's own ratio caps them further)
// what buildWorld receives: the v1 `q` fields (minus dpr, which lives here now) plus `tier`
const BUILD = {
  low: { shadows: false, shadowMap: 1024, shadowRange: 110, groundTex: 1024, treeNear: 110, leaves: 110, fog: 0.00048 },
  high: { shadows: true, shadowMap: 2048, shadowRange: 150, groundTex: 2048, treeNear: 170, leaves: 260, fog: 0.00045 },
};
const RATES = [240, 165, 144, 120, 90, 75, 60, 50, 48, 30, 24];
const snap = ms => { for (const hz of RATES) if (Math.abs(ms - 1000 / hz) < 60 / hz) return 1000 / hz; return ms; };   // within 6 %
const WINDOW_MS = 2000, STALL_MS = 250, SETTLE_MS = 600, PROBE_FRAMES = 24;

export class Quality {
  constructor({ params, store, touch }) {
    this.store = store; this.onChange = null;
    const phone = touch && Math.min(screen.width, screen.height) < 900;
    const pin = TIERS.includes(params.get('q')) ? params.get('q') : params.has('low') ? 'low' : null;
    const weak = phone || (navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4;
    const saved = store.get('tier', null);
    this.pinned = !!pin;
    this.tier = pin || (TIERS.includes(saved) ? saved : weak ? 'mid' : 'high');      // a guess; calibrate() corrects it behind the loader
    this.build = { ...BUILD[pin === 'low' || (!pin && phone) ? 'low' : 'high'], tier: this.tier };
    this.refresh = 1000 / 60;       // display interval in ms, until probe() or a quiet stretch measures it
    this.win = []; this.winT = 0; this.idle = []; this.idleKind = null; this.settle = 0;
    this.bad = 0; this.good = 0; this.upWait = 8; this.upAt = -1e9; this.clock = 0;
    this.last = { med: 0, ratio: 0, slow: 0 };
  }
  get pixelRatio() { return Math.min(window.devicePixelRatio || 1, DPR[this.tier]); }
  // frame budget in ms: a display slower than 60 Hz is judged against its own interval, a faster one against 60 fps
  get target() { return Math.max(this.refresh, 1000 / 60); }

  // The display interval, measured at boot while nothing is drawn and the main thread is idle. Resolves when it
  // has enough frames, or after `maxMs` (a hidden tab produces none).
  probe(maxMs = 300) {
    return new Promise(done => {
      const d = []; let last = 0, over = false;
      const end = () => { if (over) return; over = true; if (d.length >= 6) this.learn(d, true); done(this.refresh); };
      const f = t => { if (over) return; if (last) d.push(t - last); last = t; if (d.length < PROBE_FRAMES) requestAnimationFrame(f); else end(); };
      requestAnimationFrame(f); setTimeout(end, maxMs);
    });
  }
  // deltas → display interval. The lower quartile ignores late frames; no real display is slower than 30 Hz, so a
  // slow machine can never pass for a slow screen beyond that. `raise` false only ever corrects downward.
  learn(deltas, raise) {
    const ms = Math.min(1000 / 30, snap(deltas.sort((a, b) => a - b)[deltas.length >> 2]));
    if (raise || ms < this.refresh) this.refresh = ms;
  }

  // Call once per animation frame with the time since the previous one and what that frame was:
  //   'run'    the run is live and drawn: the only frames that are evidence about load
  //   'still'  nothing is being drawn (paused): the cadence is the display's own, so the estimate can move either way
  //   'title'  the light title view: can show the display is faster than believed, never slower
  sample(ms, kind) {
    this.clock += ms;
    if ((kind === 'still' || kind === 'title') && kind === this.idleKind && ms < STALL_MS) { this.idle.push(ms); if (this.idle.length >= PROBE_FRAMES) { this.learn(this.idle, kind === 'still'); this.idle.length = 0; } }
    else { this.idle.length = 0; this.idleKind = kind; }
    if (kind !== 'run' || ms > STALL_MS) { this.win.length = 0; this.winT = 0; return; }    // a pause or a stall is not evidence
    if (this.settle > 0) { this.settle -= ms; return; }
    this.win.push(ms); this.winT += ms;
    if (this.winT < WINDOW_MS) return;
    const s = this.win.sort((a, b) => a - b), n = s.length, med = s[n >> 1], fast = s[(n * 0.1) | 0];
    if (fast < this.refresh * 0.85) this.refresh = snap(fast);                        // the display is quicker than believed
    const target = this.target; let slow = 0; for (const v of s) if (v > target * 1.5) slow++;
    this.win = []; this.winT = 0;
    this.judge(med / target, slow / n, med);
  }
  // Hysteresis: two bad windows (or one terrible one) step down; `upWait` seconds of good windows step up, and
  // a step up that has to be taken back within 12 s makes the next attempt wait four times as long.
  judge(ratio, slow, med) {
    this.last = { med, ratio, slow };
    if (this.pinned) return;
    if (ratio > 1.3 || slow > 0.3) { this.good = 0; if (++this.bad >= (ratio > 1.9 ? 1 : 2)) this.shift(-1); }
    else { this.bad = 0; if (ratio < 1.12 && slow < 0.08) { this.good += WINDOW_MS / 1000; if (this.good >= this.upWait) this.shift(1); } else this.good = 0; }
  }
  shift(d) {
    const i = TIERS.indexOf(this.tier) + d; this.bad = this.good = 0;
    if (i < 0 || i >= TIERS.length) return;
    if (d < 0 && this.clock - this.upAt < 12000) this.upWait = Math.min(this.upWait * 4, 512);
    if (d > 0) this.upAt = this.clock;
    this.set(TIERS[i]);
  }
  set(tier, pin = false) {
    if (!TIERS.includes(tier)) return;
    if (pin) this.pinned = true;
    const prev = this.tier; this.tier = tier; this.settle = SETTLE_MS; this.win = []; this.winT = 0;
    if (!this.pinned) this.store.set('tier', tier);
    if (tier !== prev) this.onChange?.(tier, prev);
  }

  // One-off start-up benchmark behind the loader: `draw` renders one frame and blocks until the GPU has finished.
  // Corrects the starting guess before the first run instead of during it.
  calibrate(draw) {
    if (this.pinned) return;
    const time = () => { const t = []; for (let k = 0; k < 5; k++) { const a = performance.now(); draw(); t.push(performance.now() - a); } return t.sort((a, b) => a - b)[2]; };
    draw();
    for (let guard = 0; guard < 2; guard++) {
      const r = time() / this.target, i = TIERS.indexOf(this.tier);
      if (r > 1.1 && i > 0) this.set(TIERS[i - 1]);
      else if (r < 0.35 && i < TIERS.length - 1 && guard === 0) { this.set(TIERS[i + 1]); break; }
      else break;
    }
    this.settle = 0;
  }
}
