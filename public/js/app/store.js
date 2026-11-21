// localStorage with a guard: while `test` is on (debug URL flags, the bot, manual stepping) the guarded keys
// are only remembered for this page, so a test run can never overwrite the player's real best score or tier.
export class Store {
  constructor(prefix, { test = false, guarded = [] } = {}) { this.prefix = prefix; this.test = test; this.guarded = new Set(guarded); this.mem = new Map(); }
  get(k, d) {
    if (this.mem.has(k)) return this.mem.get(k);
    try { const v = localStorage.getItem(this.prefix + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  }
  set(k, v) {
    if (this.test && this.guarded.has(k)) { this.mem.set(k, v); return false; }
    try { localStorage.setItem(this.prefix + k, JSON.stringify(v)); } catch { this.mem.set(k, v); }   // private mode: keep it for the session
    return true;
  }
}
