// The frame loop. One animation frame = advance (flow clock, then the game) + present (camera, world, HUD,
// audio, render). Render policy: the run draws every frame, the title about 30 times a second, a pause draws
// once and again only after a resize, a hidden tab or a lost GL context draws nothing.
const MAX_DT = 0.05, MIN_DT = 0.001, TITLE_DT = 1 / 30;
const VIEW = { loading: 'title', title: 'title', intro: 'intro', run: 'run', paused: null, resume: null, finish: 'finish', results: 'finish' };

export class Loop {
  constructor(parts) {
    Object.assign(this, parts);       // renderer, scene, camera, game, world, rig, hud, sound, input, flow, quality, opts { ts, bot }, onFrame
    this.time = 0; this.last = 0; this.dirty = true; this.manual = false; this.lost = false; this.titleAcc = TITLE_DT; this.frames = 0; this.cpu = 0;
    this.updaters = [];                        // extra per-frame work: fn(sdt, time, state), after the world, before the HUD
    this.none = { left: false, right: false, jump: false, duck: false, leftHeld: false, rightHeld: false, jumpHeld: false, duckHeld: false };
    this.renderer.info.autoReset = false;      // so the shadow pass is part of the per-frame counts
    this.frame = this.frame.bind(this);
  }
  start() { this.last = performance.now(); requestAnimationFrame(this.frame); }
  // forget the gap: the next frame must not see the time spent hidden as one long step
  wake() { this.last = performance.now(); this.dirty = true; }

  frame(now) {
    requestAnimationFrame(this.frame);
    const ms = now - this.last; this.last = now;
    if (document.hidden || this.lost) return;
    const t0 = performance.now(), st = this.flow.state, frozen = st === 'paused' || st === 'resume';
    this.quality.sample(ms, this.manual ? null : frozen ? 'still' : st === 'run' ? 'run' : st === 'title' ? 'title' : null);
    const dt = Math.min(MAX_DT, Math.max(MIN_DT, ms / 1000));
    if (!this.manual) this.flow.tick(Math.min(0.1, Math.max(0, ms / 1000)));
    if (frozen) { if (this.dirty) { this.dirty = false; this.draw(); } }
    else {
      const sim = this.manual ? dt : this.advance(dt, this.opts.ts);
      if (VIEW[this.flow.state] !== 'title') this.present(sim, this.manual ? 0 : dt);
      else if ((this.titleAcc += dt) >= TITLE_DT - 0.002) { this.present(this.titleAcc, 0); this.titleAcc = 0; }
    }
    this.cpu = performance.now() - t0;
    this.onFrame?.(ms);
  }

  // Steps the game for one frame of `dt` seconds (`steps` updates per frame: the ?ts test scale). The game always
  // gets real time: it owns its fixed step, hit-stop and slow-motion. Returns the time the camera and world should
  // follow instead: dt scaled by game.timeScale, and 0 while game.hitStop is counting down.
  advance(dt, steps = 1) {
    const g = this.game, st = this.flow.state;
    if (st === 'title' || st === 'loading') return dt;
    if (st === 'intro' || st === 'results') { g.update(dt, this.none); return dt; }
    for (let k = 0; k < steps && this.flow.state !== 'results'; k++) {
      if (this.flow.state === 'run') { const inp = this.input.frame(); if (this.opts.bot) g.bot(inp); g.update(dt, inp); this.input.consume(); }
      else g.update(dt, this.none);            // coasting past the line
    }
    return g.hitStop > 0 ? 0 : dt * Math.max(0, g.timeScale ?? 1);
  }

  // sdt moves what belongs to the game world (camera, world); hudDt moves the HUD's own timers
  present(sdt, hudDt) {
    const st = this.flow.state, gs = this.game.state;
    this.time += sdt;
    this.rig.update(sdt, this.game, VIEW[st]);
    // a v2 world culls by view: the whole city from above on the title, the window around the rider otherwise
    this.world.setView?.(this.rig.free ? { mode: 'auto', s: null } : VIEW[st] === 'title' ? { mode: 'overview', s: null } : { mode: 'run', s: this.game.s });
    this.world.update(sdt, this.time, this.rig.focus, this.camera);
    for (const fn of this.updaters) fn(sdt, this.time, st);
    if (st === 'run') this.hud.frame(hudDt);
    this.sound.frame(gs === 'run' || gs === 'finish', false);
    this.draw();
  }
  // the one place a frame is drawn; replace `render` to put a post-processing chain in its place
  render() { this.renderer.render(this.scene, this.camera); }
  draw() { this.renderer.info.reset(); this.render(); this.frames++; }

  // Deterministic stepping for tests: n fixed steps of the flow clock, the game and the HUD timers; no camera, no
  // rendering, one game update per step whatever ?ts says. The first call switches the animation loop to manual
  // (it keeps presenting but stops advancing); set `manual = false` to hand time back to the display.
  step(n = 1, dt = 1 / 60) {
    this.manual = true; this.flow.tainted = true; this.flow.store.test = true;
    for (let i = 0; i < n; i++) {
      this.flow.tick(dt); const st = this.flow.state;
      if (st === 'paused' || st === 'resume') continue;
      this.advance(dt, 1); if (this.flow.state === 'run') this.hud.tick(dt);
    }
    return this.flow.state;
  }
}
