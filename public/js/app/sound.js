// bus + flow → Sfx. Speaks the v2 audio contract (event / stinger / frame(object)) when the Sfx has it and the
// v1 calls (play / frame(speed01, air, grind, running)) when it does not.
import { clamp } from '../util.js';

// v2 game events voiced on a v1 Sfx: event → [play name, arg]
const V1_EVENT = {
  lane: () => ['lane'], jump: p => [p.kind === 'ramp' || p.kind === 'kicker' ? 'ramp' : 'jump'], land: () => ['land'],
  pickup: p => ['nut', p.streak || 1], arch: p => p.hit ? ['arch', p.got] : null, trick: () => ['trick'], near: () => ['whoosh'],
  crash: () => ['crash'], grindOn: () => ['grindOn'], grindOff: () => ['grindOff'], go: () => ['go'], finishLine: () => ['finish'],
};
const V1_STINGER = { countdown3: 'count', countdown2: 'count', countdown1: 'count', go: 'go' };

export class Sound {
  constructor({ sfx, bus, game, world, store, $ }) {
    this.sfx = sfx; this.bus = bus; this.game = game; this.world = world; this.store = store; this.$ = $;
    this.v2 = typeof sfx.event === 'function';
    this.muted = store.get('muted', false); this.district = 0; this.state = {};
    bus.on('district', p => { this.district = p.i | 0; });
    bus.tap((name, p) => this.route(name, p));
    this.paint();
  }
  route(name, p) {
    if (name.startsWith('app:')) return;
    if (name === 'sfx') { this.sfx.play(p.name, p.arg); return; }       // the v1 game voices itself through this one
    if (!this.game.nativeEvents) return;
    if (this.v2) this.sfx.event(name, p);
    else { const m = V1_EVENT[name]?.(p); if (m) this.sfx.play(m[0], m[1]); if (name === 'crash' && p.vehicle) this.sfx.play('honk'); }
  }
  // flow moments: 'title' | 'countdown3' | 'countdown2' | 'countdown1' | 'go' | 'results' | 'tierUp' | 'pauseOn' | 'pauseOff'.
  // Returns what the Sfx returns (a v2 Sfx answers a countdown with the seconds to the next beat). 'go' is only
  // sent for a v1 game; a v2 game's own go / finishLine events reach the Sfx through event().
  stinger(name, arg) { if (this.sfx.stinger) return this.sfx.stinger(name, arg); if (V1_STINGER[name]) this.sfx.play(V1_STINGER[name]); }
  ui() { this.sfx.play('ui'); }
  music(on) { this.sfx.music(on); }
  // create or wake the audio context; only ever called from a user gesture or a run start
  unlock() { this.sfx.init(); }
  // wake an existing context that the browser suspended or interrupted (never creates one)
  wake() { const c = this.sfx.ctx; if (c && c.state !== 'running') c.resume?.().catch(() => {}); }

  // continuous layers, once per presented frame
  frame(running, paused) {
    const g = this.game, sp = g.speed01 ?? clamp(g.speed / 30, 0, 1);
    if (!this.v2) { this.sfx.frame(sp, !!g.air, !!g.grind, running); return; }
    const f = this.state, c = g.combo || {};
    f.running = running; f.paused = paused; f.speed01 = sp; f.air = !!g.air; f.grind = !!g.grind; f.slide = g.slide || 0; f.duck = !!g.duck;
    f.boost = g.boost || 0; f.flow = g.flow || 1; f.comboT = c.active && c.tMax ? clamp(c.t / c.tMax, 0, 1) : 0; f.comboMult = c.mult ?? g.mult ?? 1;
    f.district = Math.max(0, this.district); f.progress = clamp(g.s / this.world.route.finish, 0, 1); f.dusk = this.world.env?.dusk ?? 0;
    this.sfx.frame(f);
  }

  toggle() { this.muted = !this.muted; this.store.set('muted', this.muted); this.unlock(); this.paint(); this.ui(); this.bus.emit('app:sound', { muted: this.muted }); }
  paint() {
    this.sfx.setMuted(this.muted);
    for (const el of document.querySelectorAll('.wave')) el.style.display = this.muted ? 'none' : '';
    this.$('sndBtn3').textContent = 'Sound: ' + (this.muted ? 'off' : 'on');
    for (const id of ['sndBtn', 'sndBtn2', 'sndBtn3']) this.$(id).setAttribute('aria-pressed', String(!this.muted));
  }
}
