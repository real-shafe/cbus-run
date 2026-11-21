// Synchronous event bus. Game events (DESIGN.md section 6) and app events (all named 'app:…') share it.
// A listener that throws is reported after the emit returns, so it can never abort the game step that emitted.
const later = e => setTimeout(() => { throw e; });

export class Bus {
  constructor() { this.subs = new Map(); this.taps = new Set(); }
  on(name, fn) { let s = this.subs.get(name); if (!s) this.subs.set(name, s = new Set()); s.add(fn); return () => s.delete(fn); }
  once(name, fn) { const off = this.on(name, p => { off(); fn(p); }); return off; }
  off(name, fn) { this.subs.get(name)?.delete(fn); }
  // hears every event as fn(name, payload)
  tap(fn) { this.taps.add(fn); return () => this.taps.delete(fn); }
  emit(name, payload = {}) {
    const s = this.subs.get(name);
    if (s) for (const fn of s) { try { fn(payload); } catch (e) { later(e); } }
    for (const fn of this.taps) { try { fn(name, payload); } catch (e) { later(e); } }
  }
}
