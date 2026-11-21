// game → app. The game is handed `hooks`; everything it reports ends up on the bus as a DESIGN.md section 6 event.
// A v2 game (game.nativeEvents) calls hooks.event directly. The v1 game only knows the old hook names, so those
// are translated here; that half goes quiet as soon as the game reports natively.
import { legacyResults } from './results.js';

const LANE_W = 3.3;     // DESIGN.md section 1

export function makeHooks(bus, world) {
  let game = null, lane = 0;
  const legacy = () => game && !game.nativeEvents;
  const at = () => { const p = game.skater.root.position; return { x: p.x, y: p.y, z: p.z }; };
  // v1 sound cues that also carry a gameplay moment
  const cue = {
    lane: () => { bus.emit('lane', { from: lane, to: game.lane, air: !!game.air, slide: false }); lane = game.lane; },
    jump: () => bus.emit('jump', { kind: 'full', lane: game.lane }),
    ramp: () => bus.emit('jump', { kind: 'ramp', lane: game.lane }),
    land: () => bus.emit('land', { airT: 0, height: 0, clean: true, big: !!game.bigAir, sketchy: false }),
    nut: n => bus.emit('pickup', { kind: 'nut', streak: n, value: 50 * game.mult, ...at() }),
    arch: n => bus.emit('arch', { i: n - 1, s: game.s, lane: 0, hit: true, perfect: false, got: n, total: world.arches.length, streak: n }),
    grindOn: () => { const r = game.grind; if (r) bus.emit('grindOn', { kind: 'rail', s0: r.s0, s1: r.s1, d: r.lane * LANE_W, h: 0.62 }); },
    grindOff: () => bus.emit('grindOff', { len: game.grindLen, pts: 0, exit: game.air ? 'jump' : 'end' }),
  };
  const hooks = {
    event(name, payload) { bus.emit(name, payload); },
    popup(label, pts, kind) {
      if (!legacy()) return;
      if (kind === 'bad') bus.emit('crash', { kind: label === 'OUCH' ? 'vehicle' : 'obstacle', vehicle: label === 'OUCH', speed: game.speed, lost: 0, ...at() });
      else bus.emit('trick', { id: label.replace(/\s*\d.*$/, '').toLowerCase().replace(/\s+/g, '-') || 'trick', label, pts, kind: kind || 'trick', repeat: 0 });
    },
    mult(m) { if (legacy()) bus.emit('combo', { phase: 'add', pts: 0, mult: m, n: 0, t: 0, tMax: 0, total: 0 }); },
    sfx(name, arg) { if (!legacy()) return; bus.emit('sfx', { name, arg }); cue[name]?.(arg); },
    district(name) { if (legacy()) bus.emit('district', { i: game.district, name, cleanPrev: false }); },
    landmark(l) { if (legacy()) bus.emit('landmark', l); },
    finishLine() { if (legacy()) bus.emit('finishLine', {}); },
    done() { if (legacy()) bus.emit('done', { results: legacyResults(game, world) }); },
  };
  return { hooks, bind(g) { game = g; }, runStart() { lane = 0; if (legacy()) bus.emit('go', {}); } };
}
