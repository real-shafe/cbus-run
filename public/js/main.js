import * as THREE from 'three';
import { buildWorld, drawMap } from './world.js';
import { Game, MPH } from './game.js';
import { Sfx } from './audio.js';
import { clamp, lerp, damp, smooth, shortName } from './util.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;
const low = (touch && Math.min(screen.width, screen.height) < 900) || params.has('low');
const q = low
  ? { shadows: false, shadowMap: 1024, shadowRange: 110, groundTex: 1024, treeNear: 110, leaves: 110, fog: 0.00048, dpr: 1.5 }
  : { shadows: true, shadowMap: 2048, shadowRange: 150, groundTex: 2048, treeNear: 170, leaves: 260, fog: 0.00045, dpr: 1.5 };

const canvas = $('gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { document.body.insertAdjacentHTML('beforeend', '<div id="err">This needs WebGL, which this browser has switched off.</div>'); throw e; }
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = q.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
let portrait = false, pixelRatio = Math.min(devicePixelRatio || 1, q.dpr);
function resize() { const w = innerWidth, h = innerHeight; renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false); camera.aspect = w / h; portrait = h > w * 1.05; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ sound + persisted bits
const sfx = new Sfx();
const store = { get(k, d) { try { const v = localStorage.getItem('acr.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('acr.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
let muted = store.get('muted', false), best = store.get('best', 0);
function paintSound() { sfx.setMuted(muted); for (const el of document.querySelectorAll('.wave')) el.style.display = muted ? 'none' : ''; $('sndBtn3').textContent = 'Sound: ' + (muted ? 'off' : 'on'); for (const id of ['sndBtn', 'sndBtn2']) $(id).setAttribute('aria-pressed', String(!muted)); }
function toggleSound() { muted = !muted; store.set('muted', muted); sfx.init(); paintSound(); sfx.play('ui'); }
for (const id of ['sndBtn', 'sndBtn2', 'sndBtn3']) $(id).addEventListener('click', toggleSound);
paintSound();
$('keys').innerHTML = touch
  ? '<span><kbd>swipe ← →</kbd>lanes</span><span><kbd>swipe ↑ / tap</kbd>jump</span><span><kbd>swipe ↓</kbd>duck</span>'
  : '<span><kbd>←</kbd><kbd>→</kbd>lanes</span><span><kbd>Space</kbd>jump</span><span><kbd>↓</kbd>duck</span><span><kbd>P</kbd>pause</span>';
const fmt = n => Math.round(n).toLocaleString('en-US');
if (best) $('best').textContent = 'Your best: ' + fmt(best);

// ------------------------------------------------------------------ load + build
let mode = 'load', world, game, mapImg;
const STEPS = 9; let stepN = 0;
const step = label => { stepN++; $('playT').textContent = label + '…'; $('loadBar').style.width = Math.round(stepN / STEPS * 100) + '%'; return new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 60); }); };
let city;
try {
  await step('Fetching the map');
  const res = await fetch('./data/city.json'); if (!res.ok) throw new Error('map data ' + res.status);
  city = await res.json();
  world = await buildWorld(city, scene, renderer, q, step);
} catch (e) { $('playT').textContent = 'Could not load the city. Reload to retry.'; throw e; }

const route = world.route, o = {}, o2 = {};
let endT = 0;
const hooks = {
  popup(label, pts, kind) { pop(label, pts, kind); },
  mult(m) { const el = $('mult'); el.textContent = '×' + m; el.classList.toggle('one', m === 1); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 160); },
  sfx(name, arg) { sfx.play(name, arg); },
  district(n) { const el = $('district'); el.textContent = n; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); },
  landmark(l) { showLandmark(l); },
  finishLine() { $('hud').classList.remove('on'); endT = 0; },
  done() { showResults(); },
};
game = new Game(world, scene, hooks);
mapImg = drawMap(city, 3);
await step('Ready');

// glowing route band for the title view
const routeLine = (() => {
  const pos = [], idx = [], n = route.n;
  for (let i = 0; i < n; i++) { const s = i * route.ds; if (s > route.finish + 6) break; route.at(s, -7, o); pos.push(o.x, o.y + 3, o.z); route.at(s, 7, o); pos.push(o.x, o.y + 3, o.z); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.9, 0.25), transparent: true, opacity: 0.9, side: THREE.DoubleSide, fog: false, depthWrite: false })); m.frustumCulled = false; scene.add(m); return m;
})();
// ------------------------------------------------------------------ HUD helpers
let popSlot = 0;
function pop(label, pts, kind) {
  const el = document.createElement('div'); el.className = 'pop ' + (kind || '');
  el.textContent = label; if (pts) { const s = document.createElement('span'); s.textContent = '+' + fmt(pts); el.appendChild(s); }
  el.style.top = (popSlot++ % 3) * 36 + 'px'; $('pops').appendChild(el); setTimeout(() => el.remove(), 1200);
}
let lmTimer = 0;
function showLandmark(l) {
  $('lmSide').textContent = l.n === 'COSI' ? 'DEAD AHEAD' : l.side > 0 ? 'ON YOUR RIGHT' : 'ON YOUR LEFT'; $('lmName').textContent = l.n; $('lmFact').textContent = l.f;
  $('hint').classList.remove('show'); $('lm').classList.add('show'); clearTimeout(lmTimer); lmTimer = setTimeout(() => $('lm').classList.remove('show'), 5200);
}
const hudCache = {};
const setText = (id, v) => { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } };
const mapCtx = $('map').getContext('2d');
function drawMini() {
  const c = mapCtx, W = 248, sc = 3, zoom = 1.15; route.at(game.s, 0, o);
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, W); c.save(); c.beginPath(); c.arc(W / 2, W / 2, W / 2, 0, 6.3); c.clip();
  c.translate(W / 2, W * 0.62); c.rotate(-Math.atan2(o.tx, -o.tz)); c.scale(zoom, zoom); c.translate(-(o.x + mapImg.width * sc / 2) / sc, -(o.z + mapImg.height * sc / 2) / sc);
  c.drawImage(mapImg, 0, 0); c.restore();
  c.fillStyle = '#fff'; c.strokeStyle = '#14161a'; c.lineWidth = 3; c.beginPath(); c.moveTo(W / 2, W * 0.62 - 15); c.lineTo(W / 2 + 10, W * 0.62 + 10); c.lineTo(W / 2, W * 0.62 + 4); c.lineTo(W / 2 - 10, W * 0.62 + 10); c.closePath(); c.stroke(); c.fill();
}
function hud() {
  setText('scoreV', fmt(game.score)); setText('speedV', String(Math.round(game.mph)));
  $('progV').style.width = (clamp(game.s / route.finish, 0, 1) * 100).toFixed(1) + '%';
  setText('street', shortName(route.name(game.s)).toUpperCase());
  let nx = null; for (const c of world.cross) if (c.s > game.s + 4) { nx = c; break; }
  if (nx) { const ft = Math.max(50, Math.round((nx.s - game.s) * 3.281 / 50) * 50); const key = nx.label + ft; if (hudCache.next !== key) { hudCache.next = key; $('next').innerHTML = `<b>${nx.label}</b> · ${ft >= 1000 ? (ft / 5280).toFixed(1) + ' mi' : ft + ' ft'}`; } }
  else if (hudCache.next !== 'cosi') { hudCache.next = 'cosi'; $('next').innerHTML = '<b>COSI</b> · finish'; }
  drawMini();
}

// ------------------------------------------------------------------ input
const inp = { left: false, right: false, jump: false, duck: false, duckHeld: false };
const held = new Set();
let botOn = params.has('bot');
const TS = Math.max(1, Math.min(8, +params.get('ts') || 1));   // test-only time scale
addEventListener('keydown', e => {
  if (e.repeat) { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (mode === 'title' && (k === 'enter' || k === ' ')) { if (document.activeElement?.tagName === 'BUTTON' && document.activeElement !== $('play')) return; e.preventDefault(); startRun(); return; }
  if (mode === 'end' && k === 'r') { e.preventDefault(); startRun(); return; }
  if (k === 'm') { toggleSound(); return; }
  if (k === 'p' || k === 'escape') { if (mode === 'run') pause(); else if (mode === 'paused') resume(); return; }
  if (mode !== 'run') return;
  if (k === 'arrowleft' || k === 'a') inp.left = true;
  else if (k === 'arrowright' || k === 'd') inp.right = true;
  else if (k === 'arrowup' || k === 'w' || k === ' ') inp.jump = true;
  else if (k === 'arrowdown' || k === 's') { inp.duck = true; held.add('duck'); }
  else return;
  e.preventDefault();
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k === 'arrowdown' || k === 's') held.delete('duck'); });
let tp = null;
canvas.addEventListener('pointerdown', e => { if (mode !== 'run') return; tp = { x: e.clientX, y: e.clientY, t: performance.now(), used: false, id: e.pointerId, touch: e.pointerType !== 'mouse' }; });
addEventListener('pointermove', e => {
  if (!tp || e.pointerId !== tp.id || mode !== 'run') return;
  const dx = e.clientX - tp.x, dy = e.clientY - tp.y, th = 26;
  if (Math.abs(dx) > th && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) inp.left = true; else inp.right = true; tp.x = e.clientX; tp.y = e.clientY; tp.used = true; }
  else if (Math.abs(dy) > th) { if (dy < 0) inp.jump = true; else inp.duck = true; tp.x = e.clientX; tp.y = e.clientY; tp.used = true; }
});
addEventListener('pointerup', e => { if (!tp || e.pointerId !== tp.id) return; if (!tp.used && tp.touch && performance.now() - tp.t < 260 && mode === 'run') inp.jump = true; tp = null; });
addEventListener('pointercancel', () => { tp = null; });
addEventListener('contextmenu', e => e.preventDefault());

// ------------------------------------------------------------------ flow
const show = (id, on) => $(id).classList.toggle('on', on);
let introT = 0, time = 0, camD = 0, camY = 0, tickN = -1, frames = 0, slowAcc = 0, last = performance.now();
const fade = on => new Promise(r => { $('fade').classList.toggle('on', on); setTimeout(r, on ? 340 : 60); });
async function startRun() {
  if (mode === 'intro' || mode === 'load') return;
  mode = 'intro'; sfx.init(); sfx.play('ui');
  show('title', false); show('end', false); show('pause', false);
  await fade(true);
  game.reset(); routeLine.visible = false;
  introT = 0; tickN = -1; camD = 0; camY = 0; frames = 0; slowAcc = 0; hudCache.next = null; $('lm').classList.remove('show'); $('district').classList.remove('show');
  hud(); $('hud').classList.add('on'); fade(false);
  sfx.music(true);
}
function pause() { if (mode !== 'run') return; mode = 'paused'; show('pause', true); sfx.music(false); sfx.frame(0, false, false, false); $('resume').focus(); }
function resume() { if (mode !== 'paused') return; mode = 'run'; show('pause', false); sfx.music(true); last = performance.now(); canvas.focus(); }
async function toTitle() { await fade(true); mode = 'title'; show('end', false); show('pause', false); show('title', true); $('hud').classList.remove('on'); routeLine.visible = true; game.reset(); game.cull(-1e6); game.skater.root.visible = false; sfx.music(false); fade(false); $('play').focus(); }
function showResults() {
  const g = game, t = g.time, mm = Math.floor(t / 60), ss = Math.floor(t % 60), clean = g.hits === 0;
  if (clean) g.score += 5000;
  const total = Math.round(g.score), isBest = total > best, prevBest = best;
  if (isBest) { best = total; store.set('best', best); $('best').textContent = 'Your best: ' + fmt(best); }
  const tiers = [[0, 'TOURIST'], [40000, 'LOCAL'], [100000, 'SHORT NORTH REGULAR'], [190000, 'HIGH STREET HERO'], [290000, 'ARCH CITY LEGEND']];
  let tier = tiers[0][1]; for (const [min, name] of tiers) if (total >= min) tier = name;
  $('endSub').textContent = `Short North to COSI in ${mm}:${String(ss).padStart(2, '0')}.` + (clean ? ' Clean run: +5,000.' : '') + (isBest ? ' New best!' : prevBest ? ` Best ${fmt(prevBest)}.` : '');
  $('endScore').textContent = fmt(total); $('medal').textContent = tier;
  $('stTime').textContent = `${mm}:${String(ss).padStart(2, '0')}`; $('stTop').textContent = Math.round(g.top * MPH) + ' mph'; $('stNuts').textContent = `${g.nutsGot} / ${g.totalNuts}`;
  $('stArch').textContent = `${g.archGot} / ${world.arches.length}`; $('stTricks').textContent = String(g.tricks); $('stHits').textContent = String(g.hits);
  mode = 'end'; show('end', true); sfx.music(false); setTimeout(() => $('again').focus(), 50);
}
$('play').addEventListener('click', startRun); $('again').addEventListener('click', startRun); $('restart').addEventListener('click', startRun);
$('resume').addEventListener('click', resume); $('pauseBtn').addEventListener('click', pause); $('toTitle').addEventListener('click', toTitle); $('quit').addEventListener('click', toTitle);
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'run' && !botOn) pause(); });

// ------------------------------------------------------------------ cameras
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), focus = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
function chase(out, look) {
  const g = game, back = portrait ? 8.8 : 6.7, up = portrait ? 4.3 : 3.05;
  route.at(g.s - back, camD * 0.6, o); out.set(o.x, o.y + up + camY * 0.4, o.z);
  route.at(g.s + 15, camD * 0.8, o2); look.set(o2.x, o2.y + 1.15 + camY * 0.35, o2.z);
}
function titleCam(t) {
  const a = 0.5 + Math.sin(t * 0.045) * 0.22, R = portrait ? 1500 : 1150;
  camera.position.set(80 - Math.cos(a) * R, 250 + Math.sin(t * 0.06) * 30, 1000 + Math.sin(a) * R * 0.9); camLook.set(160, portrait ? -300 : 30, 620); camera.lookAt(camLook);
  camera.fov = portrait ? 66 : 50; camera.updateProjectionMatrix(); focus.set(120, 0, 950);
}

// ------------------------------------------------------------------ main loop
const noInp = { left: false, right: false, jump: false, duck: false, duckHeld: false };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
  if (mode === 'paused') { renderer.render(scene, camera); return; }
  time += dt;
  if (mode === 'title' || mode === 'load') { titleCam(time); routeLine.material.opacity = 0.7 + Math.sin(time * 2.4) * 0.2; }
  else if (mode === 'intro') {
    introT += dt; game.update(dt, noInp);
    const k = smooth(clamp(introT / 2.0, 0, 1)); chase(tmpA, tmpB);
    tmpC.copy(tmpB).sub(tmpA).setY(0).normalize();
    camera.position.set(tmpA.x, tmpA.y + (1 - k) * 34, tmpA.z).addScaledVector(tmpC, -(1 - k) * 46); camera.lookAt(tmpB);
    camera.fov = portrait ? 78 : 62; camera.updateProjectionMatrix(); focus.copy(tmpB);
    const n = Math.floor((introT - 0.25) / 0.62);
    if (n !== tickN && n >= 0 && n <= 3) {
      tickN = n; const el = $('count'); el.textContent = n < 3 ? String(3 - n) : 'GO'; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); sfx.play(n < 3 ? 'count' : 'go');
      if (n === 3) { game.start(); mode = 'run'; canvas.focus(); const h = $('hint'); h.innerHTML = touch ? '<span><kbd>swipe ← →</kbd> lanes</span><span><kbd>swipe ↑ / tap</kbd> jump</span><span><kbd>swipe ↓</kbd> duck</span>' : '<span><kbd>←</kbd><kbd>→</kbd> lanes</span><span><kbd>Space</kbd> jump</span><span><kbd>↓</kbd> duck</span>'; h.classList.add('show'); setTimeout(() => h.classList.remove('show'), 4200); }
    }
  }
  else if (mode === 'run' || mode === 'end') {
    const g = game;
    if (mode === 'run') {
      inp.duckHeld = held.has('duck');
      for (let k = 0; k < TS && mode === 'run'; k++) { if (botOn) g.bot(inp); g.update(dt, inp); inp.left = inp.right = inp.jump = inp.duck = false; }
    } else g.update(dt, noInp);
    const sp = clamp(g.speed / 30, 0, 1);
    if (g.state === 'run') {
      camD = damp(camD, g.d, 7, dt); camY = damp(camY, g.y, 9, dt); chase(camPos, camLook);
      if (g.shake > 0) { camPos.x += (Math.random() - 0.5) * g.shake * 0.5; camPos.y += (Math.random() - 0.5) * g.shake * 0.4; }
      camera.position.copy(camPos); camera.lookAt(camLook); camera.rotateZ(clamp(g.leanV * 0.006, -0.06, 0.06));
      camera.fov = damp(camera.fov, (portrait ? 76 : 60) + sp * 13, 4, dt); camera.updateProjectionMatrix(); focus.copy(camLook);
      hud();
      // settle on a quality the machine can hold
      if (++frames > 40 && frames <= 220) { slowAcc += dt; if (frames === 220) { const avg = slowAcc / 180; if (avg > 0.03) { if (world.sun.castShadow) { world.sun.castShadow = false; renderer.shadowMap.enabled = false; } else if (pixelRatio > 1) { pixelRatio = 1; resize(); } frames = 0; slowAcc = 0; } } }
    } else {
      // finish: swing round to face the skater with downtown behind
      endT += dt; const sk = g.skater.root.position, k = smooth(clamp(endT / 4.5, 0, 1));
      route.at(g.s, 0, o); const a0 = Math.atan2(-o.tz, -o.tx), a = a0 + k * 2.75 + Math.max(0, endT - 4.5) * 0.05, Rr = lerp(7.5, portrait ? 13 : 10.5, k);
      camPos.set(sk.x + Math.cos(a) * Rr, sk.y + lerp(3.0, 2.2, k), sk.z + Math.sin(a) * Rr); camera.position.lerp(camPos, 1 - Math.exp(-5 * dt));
      camLook.lerp(tmpA.set(sk.x, sk.y + lerp(1.2, 2.6, k), sk.z), 1 - Math.exp(-6 * dt)); camera.lookAt(camLook);
      camera.fov = damp(camera.fov, portrait ? 74 : 56, 3, dt); camera.updateProjectionMatrix(); focus.copy(sk);
    }
    sfx.frame(sp, g.air, !!g.grind, g.state === 'run' || g.state === 'finish');
  }
  world.update(dt, time, focus, camera);
  renderer.render(scene, camera);
}
game.cull(-1e6); game.skater.root.visible = false;
mode = 'title'; $('play').disabled = false; $('playT').textContent = 'PLAY'; $('loadBar').style.width = '0'; $('play').focus();
requestAnimationFrame(frame);
window.__acr = { get mode() { return mode; }, game, world, camera, renderer, scene, startRun, setBot(v) { botOn = v; }, THREE, ready: true };
window.__dbg = window.__acr;
if (params.has('auto')) startRun();
