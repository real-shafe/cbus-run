// Loading progress on the PLAY button. step(label) shows the name of the stage that is ABOUT TO RUN and
// resolves after the browser has painted it, so the label on screen always names the work in progress.
export class Loader {
  constructor(label, bar) { this.label = label; this.bar = bar; this.lo = 0; this.hi = 0; this.k = 0; this.n = 1; this.step = this.step.bind(this); }
  // the next `expected` steps fill the bar from `lo` to `hi`; extra steps creep toward `hi` without passing it
  phase(lo, hi, expected = 1) { this.lo = lo; this.hi = hi; this.k = 0; this.n = expected; this.set(lo); }
  set(f) { this.bar.style.width = Math.round(Math.min(1, f) * 100) + '%'; }
  // 0..1 inside the current phase (byte progress of the download)
  part(f) { this.set(this.lo + (this.hi - this.lo) * Math.max(0, Math.min(1, f))); }
  step(label) {
    this.label.textContent = label + '…'; this.part(1 - Math.exp(-2.2 * this.k++ / this.n));
    // resolve in a task AFTER the frame that shows the label (a promise resolved inside the rAF callback would run
    // the next stage before that frame is painted); the timer covers a hidden tab, where no frame comes
    return new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(f, 0)); setTimeout(f, 120); });
  }
}
