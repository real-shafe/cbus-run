// The flow state machine:
//   loading → title → intro → run ⇄ paused → finish → results        ('resume' is the 3-2-1 between paused and run)
// Rules it enforces:
//   - a state changes only through go()/set(); EDGES lists every legal move
//   - a faded move holds a lock from the first frame of the fade until the swap, so nothing else can start
//   - the old state keeps its camera and simulation until the fade is opaque; the swap happens in one call
//   - after()/countdown() timers belong to the state that made them and die when it exits
//   - time comes from tick(dt), called by the loop: nothing here advances while the tab is hidden
import { paintResults, fmt } from './results.js';
import { legend } from './hud.js';

const EDGES = {
  loading: ['title'], title: ['intro'], intro: ['run', 'paused'], run: ['paused', 'finish'],
  paused: ['resume', 'intro', 'title'], resume: ['run', 'paused'], finish: ['results'], results: ['intro', 'title'],
};
const MODE = { loading: 'load', title: 'title', intro: 'intro', run: 'run', paused: 'paused', resume: 'paused', finish: 'run', results: 'end' };   // the v1 names tools know
const LIVE = ['intro', 'run', 'resume'];          // states a pause can interrupt
const FADE_S = 0.34, RESULTS_LOCK_S = 1.2, RESULTS_QUIET_S = 0.5;

export class Flow {
  constructor(parts) {
    Object.assign(this, parts);       // $, bus, game, world, hud, rig, sound, input, store, titleScene, canvas, opts { touch, ts, bot }
    this.state = 'loading'; this.locked = false; this.clock = 0; this.timers = []; this.waits = [];
    this.resumeTo = 'run'; this.pauseAfter = false; this.tainted = false; this.cardLocked = false; this.cardAt = 0; this.best = this.store.get('best', 0);
    this.overlays = ['title', 'end', 'pause'].map(id => this.$(id));
    this.bus.on('finishLine', () => this.go('finish'));
    this.bus.on('done', p => { if (this.state === 'run') this.set('finish'); this.go('results', p.results || this.game.results?.()); });
    this.wire();
    this.paintBest(); this.$('keys').innerHTML = legend(this.opts.touch, true);
  }
  get mode() { return MODE[this.state]; }
  get botOn() { return this.opts.bot; }

  // ---------------------------------------------------------------- clock and timers
  after(sec, fn) { this.timers.push({ at: this.clock + sec, fn }); }
  tick(dt) {
    this.clock += dt;
    for (const list of [this.waits, this.timers]) for (;;) { const i = list.findIndex(t => t.at <= this.clock); if (i < 0) break; list.splice(i, 1)[0].fn(); }
    if (this.cardLocked && this.clock >= this.cardAt) this.unlockCard();
  }
  // 3 · 2 · 1 · GO. A v2 Sfx answers each count with the seconds until the next one, so GO lands on its beat.
  countdown(first, gap, done) {
    const beat = n => {
      if (n === 0) { this.hud.count('GO'); if (!this.game.nativeEvents) this.sound.stinger('go'); this.bus.emit('app:countdown', { n }); done(); return; }
      this.hud.count(String(n)); const wait = this.sound.stinger('countdown' + n); this.bus.emit('app:countdown', { n });
      this.after(wait > 0.2 && wait < 2 ? wait : gap, () => beat(n - 1));
    };
    this.after(first, () => beat(3));
  }

  // ---------------------------------------------------------------- transitions
  // Resolves true when the move happened, false when it was not legal right now.
  go(to, arg) {
    if (to === 'run' && this.state === 'paused') to = 'resume';
    if (this.locked || !EDGES[this.state].includes(to)) return Promise.resolve(false);
    const faded = this.state !== 'loading' && (to === 'title' || (to === 'intro' && !arg?.keep));
    if (!faded) { this.set(to, arg); return Promise.resolve(true); }
    return this.fadeTo(to, arg);
  }
  // The swap runs inside tick() when the fade is opaque (not in a promise continuation), so stepping the clock
  // by hand moves through it deterministically.
  fadeTo(to, arg) {
    this.locked = true; for (const o of this.overlays) o.inert = true;
    this.$('fade').classList.add('on');
    return new Promise(done => this.waits.push({ at: this.clock + FADE_S, fn: () => {
      this.set(to, arg);
      this.$('fade').classList.remove('on'); this.locked = false;
      if (this.pauseAfter) { this.pauseAfter = false; this.pause(); }      // the window went away mid-fade
      done(true);
    } }));
  }
  set(to, arg) {
    const from = this.state; this.timers.length = 0;
    this.exit[from]?.call(this, to);
    this.state = to;
    this.enter[to].call(this, from, arg);
    this.bus.emit('app:state', { from, to });
  }
  overlay(id) {
    for (const o of this.overlays) { const on = o.id === id; o.classList.toggle('on', on); o.inert = !on; }
    this.canvas.tabIndex = id ? -1 : 0;      // with a card up, Tab stays inside the card
  }

  enter = {
    title() {
      this.game.reset(); this.game.cull?.(-1e6); if (this.game.skater) this.game.skater.root.visible = false;
      this.titleScene.show(true); this.hud.show(false); this.overlay('title');
      this.sound.music(false); this.sound.stinger('title'); this.$('play').focus();
    },
    intro(from, arg) {
      if (!arg?.keep) {                       // a fresh run (not the countdown restarting after a pause)
        this.game.reset(); this.hud.reset(); this.rig.reset();
        this.tainted = this.botOn || this.opts.ts > 1 || this.store.test;
      }
      this.titleScene.show(false); this.overlay(null); this.hud.show(true); this.hud.frame(0); this.rig.restart();
      this.sound.music(true); this.canvas.focus({ preventScroll: true });
      this.countdown(0.25, 0.62, () => this.go('run'));
    },
    run(from) {
      if (from === 'intro') { this.game.start(); this.onRunStart?.(); this.hud.hint(legend(this.opts.touch, false), 4.2); }      // once per run: GO
      this.sound.music(true); this.input.enable(true); this.canvas.focus({ preventScroll: true });
    },
    paused(from) {
      this.resumeTo = from === 'intro' ? 'intro' : 'run';
      this.hud.count(null); this.hud.freeze(true); this.overlay('pause');
      this.sound.music(false); this.sound.stinger('pauseOn'); this.sound.frame(false, true);
      this.loop.dirty = true; this.$('resume').focus();
    },
    resume() { this.overlay(null); this.canvas.focus({ preventScroll: true }); this.countdown(0.1, 0.5, () => this.go('run')); },
    finish() { this.hud.show(false); },       // the finish cue is the game's finishLine event
    results(from, r) {
      const prev = this.best, saved = !this.tainted && !this.store.test, isBest = r.score > prev;
      if (isBest && saved) { this.best = r.score; this.store.set('best', r.score); this.paintBest(); }
      paintResults(this.$, r, { prev, isBest, saved });
      this.lastResults = r; this.overlay('end'); this.lockCard();
      this.sound.music(false); this.sound.stinger('results');
    },
  };
  exit = {
    run() { this.input.enable(false); },
    paused() { this.sound.stinger('pauseOff'); this.hud.freeze(false); },
    results() { this.unlockCard(false); },
  };

  // The results card ignores everything until it has been up for RESULTS_LOCK_S and the player has been still for
  // RESULTS_QUIET_S, so jump taps and held keys from the last metres can never dismiss it.
  lockCard() { this.cardLocked = true; this.cardAt = this.clock + RESULTS_LOCK_S; this.$('end').classList.add('locked'); this.$('endRow').inert = true; this.$('endCard').focus({ preventScroll: true }); }
  unlockCard(focus = true) { this.cardLocked = false; this.$('end').classList.remove('locked'); this.$('endRow').inert = false; if (focus) this.$('again').focus({ preventScroll: true }); }
  poke() { if (this.cardLocked) this.cardAt = Math.max(this.cardAt, this.clock + RESULTS_QUIET_S); }

  paintBest() { if (this.best) this.$('best').textContent = 'Your best: ' + fmt(this.best); }

  // ---------------------------------------------------------------- actions (what buttons, keys and tools call)
  // PLAY, RUN IT AGAIN, Restart run. From a live run this is the debug restart (`__acr.startRun()`); no control reaches it.
  start() {
    if (this.state === 'loading' || this.locked || (this.state === 'results' && this.cardLocked)) return Promise.resolve(false);
    this.sound.unlock(); this.sound.ui();
    return LIVE.includes(this.state) || this.state === 'finish' ? this.fadeTo('intro') : this.go('intro');
  }
  pause() { return LIVE.includes(this.state) ? this.go('paused') : Promise.resolve(false); }
  resume() { if (this.state !== 'paused') return Promise.resolve(false); this.sound.unlock(); return this.resumeTo === 'intro' ? this.go('intro', { keep: true }) : this.go('resume'); }
  toTitle() { return this.state === 'results' && this.cardLocked ? Promise.resolve(false) : this.go('title'); }
  // the tab or window went away: drop held input and stop the run (an unattended bot run keeps going)
  away() { this.input.release(); if (this.botOn) return; if (this.locked) this.pauseAfter = true; else this.pause(); }

  wire() {
    const $ = this.$, click = (id, fn) => $(id).addEventListener('click', e => { fn(); if (e.detail && this.state === 'run') this.canvas.focus({ preventScroll: true }); });
    click('play', () => this.start()); click('again', () => this.start()); click('restart', () => this.start());
    click('resume', () => this.resume()); click('pauseBtn', () => this.pause()); click('toTitle', () => this.toTitle()); click('quit', () => this.toTitle());
    for (const id of ['sndBtn', 'sndBtn2', 'sndBtn3']) click(id, () => this.sound.toggle());

    addEventListener('keydown', e => {
      this.poke(); this.sound.wake();
      const k = (e.key || '').toLowerCase(), st = this.state, focused = document.activeElement, onButton = focused?.tagName === 'BUTTON';
      if (st === 'results' && k === ' ') { e.preventDefault(); return; }               // a jump key never presses a results button
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || st === 'loading') return;
      if (st === 'title' && (k === 'enter' || k === ' ')) { if (onButton && focused !== $('play')) return; e.preventDefault(); this.start(); }
      else if (st === 'results' && (k === 'r' || k === 'enter')) { if (k === 'enter' && focused === $('toTitle')) return; e.preventDefault(); this.start(); }
      else if (k === 'm') this.sound.toggle();
      else if (k === 'p' || k === 'escape') { if (st === 'paused') this.resume(); else this.pause(); }
    });
    addEventListener('keyup', e => { if (this.state === 'results' && e.key === ' ') e.preventDefault(); });
    addEventListener('pointerdown', () => { this.poke(); this.sound.wake(); }, true);
    addEventListener('blur', () => this.away());
    addEventListener('pagehide', () => this.away());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.away(); else { this.loop.wake(); this.sound.wake(); } });
  }
}
