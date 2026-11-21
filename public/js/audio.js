// All sound is synthesised with WebAudio: board roll, wind, pickups, and a small generative backing loop.
const PENT = [0, 2, 4, 7, 9];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.musicOn = false; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; ch[i] = w * 0.5 + last * 6; }
    this.noise = buf;
    const loop = (type, freq, q) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { f, g }; };
    this.roll = loop('bandpass', 260, 0.7); this.wind = loop('highpass', 1800, 0.3); this.grindN = loop('bandpass', 3400, 5);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; this.musicBus.connect(lp); lp.connect(this.master);
    this.nextBeat = 0; this.beat = 0;
  }
  setMuted(m) { this.muted = m; if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03); }
  music(on) { this.musicOn = on; if (!this.ctx) return; this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, on ? 0.6 : 0.15); if (on && this.nextBeat < this.ctx.currentTime) this.nextBeat = this.ctx.currentTime + 0.05; }

  // continuous layers; call every frame
  frame(speed01, air, grind, running) {
    const c = this.ctx; if (!c) return; const t = c.currentTime, on = running ? 1 : 0;
    this.roll.g.gain.setTargetAtTime(on * (air || grind ? 0 : 0.05 + speed01 * 0.16), t, 0.04); this.roll.f.frequency.setTargetAtTime(180 + speed01 * 420, t, 0.1);
    this.wind.g.gain.setTargetAtTime(on * speed01 * speed01 * 0.07, t, 0.15);
    this.grindN.g.gain.setTargetAtTime(on * (grind ? 0.16 : 0), t, 0.02);
    if (this.musicOn) this.schedule(speed01);
  }
  tone(freq, dur, type = 'sine', vol = 0.2, when = 0, slideTo = 0, dest) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.03);
  }
  burst(dur, type, f0, f1, vol = 0.25, when = 0, q = 0.8, dest) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + when, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.master); s.start(t, Math.random()); s.stop(t + dur + 0.03);
  }
  play(name, arg = 0) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'lane': this.burst(0.09, 'bandpass', 1500, 600, 0.12); break;
      case 'jump': this.tone(210, 0.13, 'triangle', 0.16, 0, 430); this.burst(0.05, 'highpass', 2500, 4000, 0.1); break;
      case 'ramp': this.tone(160, 0.3, 'sawtooth', 0.09, 0, 640); this.burst(0.3, 'bandpass', 500, 2600, 0.18); break;
      case 'land': this.tone(110, 0.12, 'sine', 0.3, 0, 60); this.burst(0.07, 'lowpass', 900, 300, 0.2); break;
      case 'nut': { const k = Math.min(arg, 14), n = 76 + PENT[k % 5] + 12 * Math.floor(k / 5); this.tone(midi(n), 0.12, 'triangle', 0.13); this.tone(midi(n + 12), 0.08, 'sine', 0.05, 0.01); break; }
      case 'arch': { const root = 60 + MAJOR[(arg - 1) % 7] + 12 * Math.floor((arg - 1) / 7); for (const [i, iv] of [0, 4, 7, 12].entries()) { this.tone(midi(root + iv), 0.9, 'sine', 0.12, i * 0.045); this.tone(midi(root + iv) * 2.01, 0.5, 'sine', 0.035, i * 0.045); } break; }
      case 'trick': this.tone(660, 0.09, 'square', 0.06); this.tone(990, 0.14, 'square', 0.06, 0.07); break;
      case 'whoosh': this.burst(0.28, 'bandpass', 2200, 300, 0.2, 0, 1.4); break;
      case 'crash': this.burst(0.5, 'lowpass', 2400, 120, 0.55); this.tone(90, 0.3, 'sine', 0.5, 0, 38); this.tone(180, 0.2, 'square', 0.08, 0, 60); break;
      case 'honk': this.tone(392, 0.36, 'square', 0.07, 0.08); this.tone(494, 0.36, 'square', 0.07, 0.08); break;
      case 'grindOn': this.burst(0.12, 'bandpass', 5000, 3000, 0.25, 0, 4); this.tone(1320, 0.3, 'sine', 0.05); break;
      case 'grindOff': this.burst(0.08, 'highpass', 3000, 5000, 0.1); break;
      case 'count': this.tone(440, 0.12, 'square', 0.1); break;
      case 'go': this.tone(880, 0.35, 'square', 0.12); this.tone(1320, 0.35, 'triangle', 0.1); break;
      case 'finish': [0, 4, 7, 12, 16, 19, 24].forEach((iv, i) => { this.tone(midi(60 + iv), 0.5, 'triangle', 0.14, i * 0.09); this.tone(midi(72 + iv), 0.4, 'sine', 0.06, i * 0.09); }); break;
      case 'ui': this.tone(520, 0.06, 'triangle', 0.1); break;
    }
  }
  // generative loop: four warm chords, bass, soft drums; busier as the board gets faster
  schedule(speed01) {
    const c = this.ctx, spb = 60 / 104 / 2, bus = this.musicBus;
    const CH = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67]];
    while (this.nextBeat < c.currentTime + 0.18) {
      const b = this.beat, bar = Math.floor(b / 8) % 4, st = b % 8, when = this.nextBeat - c.currentTime, ch = CH[bar];
      if (st === 0) for (const n of ch) { this.tone(midi(n), spb * 7.6, 'sawtooth', 0.022, when, 0, bus); this.tone(midi(n) * 1.004, spb * 7.6, 'triangle', 0.03, when, 0, bus); }
      if (st === 0 || st === 3 || st === 6) this.tone(midi(ch[0] - 24), spb * 1.6, 'triangle', 0.2, when, 0, bus);
      if (st % 4 === 0) this.tone(120, 0.14, 'sine', 0.32, when, 42, bus);
      if (st % 4 === 2) this.burst(0.1, 'bandpass', 1900, 1200, 0.1, when, 1, bus);
      this.burst(0.03, 'highpass', 7000, 9000, st % 2 ? 0.035 + speed01 * 0.03 : 0.02, when, 0.7, bus);
      if (speed01 > 0.55 && (st === 1 || st === 4 || st === 7)) this.tone(midi(ch[(b * 5) % 4] + 12), spb * 0.9, 'triangle', 0.05, when, 0, bus);
      this.nextBeat += spb; this.beat++;
    }
  }
}
