// End-of-run summary: paints the results card from the object of DESIGN.md section 6 (`game.results()`), and
// builds that object for the v1 game, which has no results() of its own.
export const MPH = 2.23694;
const V1_TIERS = [[0, 'TOURIST'], [40000, 'LOCAL'], [100000, 'SHORT NORTH REGULAR'], [190000, 'HIGH STREET HERO'], [290000, 'ARCH CITY LEGEND']];
export const fmt = n => Math.round(n).toLocaleString('en-US');
const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const count = v => Array.isArray(v) ? v.length : v | 0;

export function legacyResults(game, world) {
  const clean = game.hits === 0; if (clean) game.score += 5000;       // v1 paid the clean-run bonus on the card
  const score = Math.round(game.score); let ti = 0; V1_TIERS.forEach(([min], i) => { if (score >= min) ti = i; });
  return { score, time: game.time, par: null, timeBonus: 0, tier: V1_TIERS[ti][1], tierIndex: ti, tiers: V1_TIERS, nextTierAt: V1_TIERS[ti + 1]?.[0] ?? null,
    bySource: null, byDistrict: null, nuts: game.nutsGot, nutsTotal: game.totalNuts, gold: 0, letters: '', arches: world.arches.map(a => !!a.lit),
    bestCombo: 0, wipeouts: game.hits, topSpeed: game.top, grindM: 0, missed: null, tricks: game.tricks, cleanBonus: clean ? 5000 : 0 };
}

// r: results object; best: { prev, isBest, saved }
export function paintResults($, r, best) {
  const t = clock(r.time), arches = Array.isArray(r.arches) ? r.arches : [];
  $('endSub').textContent = `Short North to COSI in ${t}.` + (r.cleanBonus ? ` Clean run: +${fmt(r.cleanBonus)}.` : '')
    + (!best.saved ? ' Test run: score not saved.' : best.isBest ? ' New best!' : best.prev ? ` Best ${fmt(best.prev)}.` : '')
    + (typeof r.missed === 'string' && r.missed ? ` ${r.missed}.` : '');             // v2: the one thing most worth going back for
  $('endScore').textContent = fmt(r.score); $('medal').textContent = r.tier;
  $('stTime').textContent = t; $('stTop').textContent = Math.round(r.topSpeed * MPH) + ' mph';
  $('stNuts').textContent = `${r.nuts} / ${r.nutsTotal}`; $('stArch').textContent = `${arches.filter(Boolean).length} / ${arches.length}`;
  const combo = r.tricks == null;                                      // the v2 game counts combos, not tricks
  $('stTricksL').textContent = combo ? 'Best combo' : 'Tricks'; $('stTricks').textContent = combo ? fmt(r.bestCombo || 0) : String(r.tricks);
  $('stHits').textContent = String(count(r.wipeouts));
}
