// In-run HUD. Values that are state (score, speed, multiplier, progress, street) are read from the game every
// frame; moments (tricks, crashes, districts, landmarks, lessons) arrive on the bus. Its timers run on the HUD's
// own clock, which only advances while a run is on screen, so a pause or a restart can never strand them.
import { clamp, shortName } from '../util.js';
import { fmt, MPH } from './results.js';

const kbd = (keys, what, sep = ' ') => `<span>${keys.map(k => `<kbd>${k}</kbd>`).join('')}${sep}${what}</span>`;
// the control legend: `full` is the title's version (its kbd margins space it; it also lists pause)
export const legend = (touch, full) => { const sep = full ? '' : ' '; return touch
  ? kbd(['swipe ← →'], 'lanes', sep) + kbd(['swipe ↑ / tap'], 'jump', sep) + kbd(['swipe ↓'], 'duck', sep)
  : kbd(['←', '→'], 'lanes', sep) + kbd(['Space'], 'jump', sep) + kbd(['↓'], 'duck', sep) + (full ? kbd(['P'], 'pause', sep) : ''); };
// teach.action → [touch gesture, key, what it does]
const LESSON = {
  left: ['swipe ←', '←', 'change lane'], right: ['swipe →', '→', 'change lane'], jump: ['tap', 'Space', 'hop'],
  'hold-jump': ['swipe ↑ and hold', 'hold Space', 'jump higher'], duck: ['swipe ↓ and hold', 'hold ↓', 'duck under'],
  slide: ['hold ↓, then swipe ← →', 'hold ↓ + ← →', 'powerslide'], grind: ['jump onto it', 'Space onto it', 'grind'], thread: ['hop through the lights', 'Space through the lights', 'thread the arch'],
};
const MAP = 248, MAP_PX = 3, MAP_ZOOM = 1.15, MAP_HZ = 20;

export class Hud {
  constructor({ $, bus, game, world, mapImg, touch }) {
    this.$ = $; this.game = game; this.world = world; this.mapImg = mapImg; this.touch = touch;
    this.el = $('hud'); this.pops = $('pops'); this.cache = {}; this.popSlot = 0; this.o = {};
    this.hintT = 0; this.lmT = 0; this.mapT = 0; this.ci = 0; this.multV = 1; this.scoreV = -1;
    this.mapCtx = mapImg ? $('map').getContext('2d') : null; if (!mapImg) $('map').hidden = true;
    bus.on('trick', p => this.pop(p.label, p.pts, p.kind));
    bus.on('crash', p => this.pop(p.vehicle ? 'OUCH' : 'WIPEOUT', 0, 'bad'));
    bus.on('combo', p => { if (p.phase === 'bank' && p.total) this.pop(`COMBO ×${p.mult}`, p.total, 'trick'); });
    bus.on('flow', p => { if (p.level > p.prev) this.pop(`FLOW ${p.level}`, 0, 'arch'); });
    bus.on('pickup', p => { if (p.kind === 'gold') this.pop('GOLDEN BUCKEYE', p.value, 'arch'); else if (p.kind === 'letter') this.pop(`LETTER ${p.letter}`, p.value, 'arch'); });
    bus.on('district', p => this.district(p.name));
    bus.on('landmark', l => this.landmark(l));
    bus.on('teach', p => { const l = LESSON[p.action]; if (l) this.hint(kbd([l[touch ? 0 : 1]], l[2]), 3.2); });
  }

  // visible and usable only while `on`; `frozen` keeps it on screen but out of reach (pause)
  show(on) { this.el.classList.toggle('on', on); this.el.inert = !on; }
  freeze(on) { this.el.classList.toggle('frozen', on); this.el.inert = on || !this.el.classList.contains('on'); }
  // a new run starts from a clean HUD
  reset() {
    this.pops.replaceChildren(); this.popSlot = 0; this.hintT = this.lmT = this.mapT = 0; this.ci = 0; this.cache = {}; this.scoreV = -1;
    for (const id of ['lm', 'hint', 'district']) this.$(id).classList.remove('show');
    this.count(null); this.mult(1, false); this.freeze(false);
  }

  text(id, v) { if (this.cache[id] !== v) { this.cache[id] = v; this.$(id).textContent = v; } }
  mult(m, bump) {
    const el = this.$('mult'); this.multV = m; el.textContent = '×' + m; el.classList.toggle('one', m === 1);
    el.classList.remove('bump'); if (bump) { void el.offsetWidth; el.classList.add('bump'); }
  }
  pop(label, pts, kind) {
    const el = document.createElement('div'); el.className = 'pop ' + (kind || '');
    el.textContent = label; if (pts) { const s = document.createElement('span'); s.textContent = '+' + fmt(pts); el.appendChild(s); }
    el.style.top = (this.popSlot++ % 3) * 36 + 'px'; el.addEventListener('animationend', () => el.remove()); this.pops.appendChild(el);
  }
  replay(id, cls) { const el = this.$(id); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); return el; }
  district(name) { this.$('district').textContent = name; this.replay('district', 'show'); }
  landmark(l) {
    this.$('lmSide').textContent = l.n === 'COSI' ? 'DEAD AHEAD' : l.side > 0 ? 'ON YOUR RIGHT' : 'ON YOUR LEFT'; this.$('lmName').textContent = l.n; this.$('lmFact').textContent = l.f || '';
    this.$('hint').classList.remove('show'); this.hintT = 0; this.$('lm').classList.add('show'); this.lmT = 5.2;
  }
  hint(html, sec) { const h = this.$('hint'); h.innerHTML = html; h.classList.add('show'); this.hintT = sec; this.$('lm').classList.remove('show'); this.lmT = 0; }
  // the big countdown digit; null clears it
  count(text) { if (text == null) this.$('count').classList.remove('tick'); else { this.$('count').textContent = text; this.replay('count', 'tick'); } }

  frame(dt) {
    const g = this.game, R = this.world.route, s = g.s;
    const score = Math.round(g.score); if (score !== this.scoreV) { this.scoreV = score; this.$('scoreV').textContent = fmt(score); }
    this.text('speedV', String(Math.round(g.mph ?? g.speed * MPH)));
    const m = Math.max(1, (g.combo ? g.combo.mult : g.mult) | 0); if (m !== this.multV) this.mult(m, m > this.multV);
    const p = (clamp(s / R.finish, 0, 1)).toFixed(3); if (this.cache.prog !== p) { this.cache.prog = p; this.$('progV').style.transform = `scaleX(${p})`; }
    const name = R.name(s); if (this.cache.name !== name) { this.cache.name = name; this.$('street').textContent = shortName(name).toUpperCase(); }
    const X = this.world.cross; if (this.ci > 0 && X[this.ci - 1].s > s + 4) this.ci = 0;
    while (this.ci < X.length && X[this.ci].s <= s + 4) this.ci++;
    const nx = X[this.ci];
    if (nx) { const ft = Math.max(50, Math.round((nx.s - s) * 3.281 / 50) * 50), key = nx.label + ft; if (this.cache.next !== key) { this.cache.next = key; this.$('next').innerHTML = `<b>${nx.label}</b> · ${ft >= 1000 ? (ft / 5280).toFixed(1) + ' mi' : ft + ' ft'}`; } }
    else if (this.cache.next !== 'cosi') { this.cache.next = 'cosi'; this.$('next').innerHTML = '<b>COSI</b> · finish'; }
    this.tick(dt);
    if (this.mapCtx && performance.now() >= this.mapT) { this.mapT = performance.now() + 1000 / MAP_HZ; this.minimap(); }
  }
  // the HUD's timers (hint and landmark card)
  tick(dt) {
    if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.$('hint').classList.remove('show');
    if (this.lmT > 0 && (this.lmT -= dt) <= 0) this.$('lm').classList.remove('show');
  }
  minimap() {
    const c = this.mapCtx, img = this.mapImg, W = MAP, o = this.world.route.at(this.game.s, 0, this.o);
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, W); c.save(); c.beginPath(); c.arc(W / 2, W / 2, W / 2, 0, 6.3); c.clip();
    c.translate(W / 2, W * 0.62); c.rotate(-Math.atan2(o.tx, -o.tz)); c.scale(MAP_ZOOM, MAP_ZOOM); c.translate(-(o.x + img.width * MAP_PX / 2) / MAP_PX, -(o.z + img.height * MAP_PX / 2) / MAP_PX);
    c.drawImage(img, 0, 0); c.restore();
    c.fillStyle = '#fff'; c.strokeStyle = '#14161a'; c.lineWidth = 3; c.beginPath(); c.moveTo(W / 2, W * 0.62 - 15); c.lineTo(W / 2 + 10, W * 0.62 + 10); c.lineTo(W / 2, W * 0.62 + 4); c.lineTo(W / 2 - 10, W * 0.62 + 10); c.closePath(); c.stroke(); c.fill();
  }
}
