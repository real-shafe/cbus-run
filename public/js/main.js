// Bootstrap: build the renderer, load the city behind the PLAY button, then wire the app modules together.
//
//   app/bus.js      events: the game's (DESIGN.md section 6) and the app's own, all named 'app:…':
//                   app:state {from, to} · app:countdown {n: 3|2|1|0} · app:quality {tier, prev} · app:sound {muted} · app:resize {w, h}
//   app/events.js   the hooks handed to Game: hooks.event → bus, plus the translation of the v1 hooks
//   app/input.js    keyboard + pointer → the inp object            app/loop.js     frame loop, render policy, step()
//   app/flow.js     the state machine and every transition        app/camera.js   CameraRig.update(dt, game, mode)
//   app/hud.js      in-run HUD                                    app/results.js  results card
//   app/sound.js    bus + flow → Sfx (v1 or v2 calls)             app/quality.js  tier controller, pixel ratio
//   app/loader.js   loading bar and stage labels                  app/store.js    guarded localStorage
//   app/title.js    title-only scene objects
//
// URL flags: ?q=low|mid|high pins the quality tier (?low=1 = phone preset), ?stats=1 shows a stats line,
// and the test flags ?dbg=1 ?bot=1 ?auto=1 ?ts=1..8 (none of which may save a score or a tier).
import * as THREE from 'three';
import * as worldModule from './world.js';
import { Game } from './game.js';
import { Sfx } from './audio.js';
import { Bus } from './app/bus.js';
import { Store } from './app/store.js';
import { Quality } from './app/quality.js';
import { Loader } from './app/loader.js';
import { makeHooks } from './app/events.js';
import { Input } from './app/input.js';
import { CameraRig } from './app/camera.js';
import { Hud } from './app/hud.js';
import { Sound } from './app/sound.js';
import { TitleScene } from './app/title.js';
import { Flow } from './app/flow.js';
import { Loop } from './app/loop.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const opts = { touch: matchMedia('(pointer: coarse)').matches, ts: Math.max(1, Math.min(8, +params.get('ts') || 1)), bot: params.has('bot') };
const store = new Store('acr.', { test: ['dbg', 'bot', 'auto', 'ts'].some(k => params.has(k)), guarded: ['best', 'tier'] });
const bus = new Bus();
const quality = new Quality({ params, store, touch: opts.touch });
const probed = quality.probe();       // the display's refresh interval, measured while the page is still idle

const canvas = $('gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { document.body.insertAdjacentHTML('beforeend', '<div id="err">This needs WebGL, which this browser has switched off.</div>'); throw e; }
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = quality.build.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);
let rig = null, loop = null;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(quality.pixelRatio); renderer.setSize(w, h, false);
  if (rig) rig.resize(w, h); else { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  if (loop) loop.dirty = true;
  bus.emit('app:resize', { w, h });
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ load + build, behind the PLAY button
const loader = new Loader($('playT'), $('loadBar'));
let world, game, events, mapImg;
try {
  const src = window.__cityLoad || { got: 0, total: 0, data: fetch('./data/city.json').then(r => { if (!r.ok) throw new Error('map data ' + r.status); return r.json(); }) };
  const fill = () => { if (src.total) loader.part(src.got / src.total); };
  loader.phase(0, 0.24); const shown = loader.step('Fetching the map'); src.app = true; fill(); await shown;      // the page's own early fetch has been counting bytes
  const poll = setInterval(fill, 100);
  let city; try { city = await src.data; } finally { clearInterval(poll); }
  await probed;
  loader.phase(0.24, 0.76, 8); await loader.step('Building Columbus');
  world = await worldModule.buildWorld(city, scene, renderer, quality.build, loader.step);
  world.setQuality?.(quality.tier);
  loader.phase(0.76, 0.86); await loader.step('Setting out the course');
  events = makeHooks(bus, world);
  game = new Game(world, scene, events.hooks); events.bind(game);
  loader.phase(0.86, 0.9); await loader.step('Drawing the map');
  mapImg = worldModule.drawMap?.(city, 3) ?? null;
} catch (e) { failed(e); }

const sfx = new Sfx();
const sound = new Sound({ sfx, bus, game, world, store, $ });
const input = new Input(canvas);
const hud = new Hud({ $, bus, game, world, mapImg, touch: opts.touch });
const titleScene = new TitleScene(world.route, scene);
rig = new CameraRig(camera, world, bus); rig.resize(innerWidth, innerHeight);
const flow = new Flow({ $, bus, game, world, hud, rig, sound, input, store, titleScene, canvas, opts });
loop = new Loop({ renderer, scene, camera, game, world, rig, hud, sound, input, flow, quality, opts });
flow.loop = loop; flow.onRunStart = () => events.runStart();
loop.updaters.push((dt, time) => titleScene.update(time));
quality.onChange = (tier, prev) => { world.setQuality?.(tier); resize(); bus.emit('app:quality', { tier, prev }); };

// Compile every program and upload every buffer and texture while the loader still covers the canvas, so no
// gameplay frame pays for it. A v2 world does this itself (again here, now that the game's objects exist); for a
// world without precompile() the same is done by hand: one unculled frame with every hidden object switched on.
try {
  loader.phase(0.9, 1); await loader.step('Warming up');
  rig.update(0, game, 'run'); world.update(0, 0, rig.focus, camera);
  if (world.precompile) await world.precompile({ camera });
  else {
    const hidden = [], culled = [];
    scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    try { await renderer.compileAsync(scene, camera); loop.draw(); }
    finally { for (const o of hidden) o.visible = false; for (const o of culled) o.frustumCulled = true; }
  }
  const gl = renderer.getContext(), px = new Uint8Array(4);
  quality.calibrate(() => { loop.draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); });
} catch (e) { failed(e); }

function failed(e) {
  $('playT').textContent = 'Could not load the city. Tap to retry.'; $('loadBar').style.width = '0';
  const b = $('play'); b.disabled = false; b.addEventListener('click', () => location.reload());
  throw e;
}

// ------------------------------------------------------------------ robustness
// A lost GL context cannot be rebuilt in place (the GPU copies of the city are gone): stop, and offer a reload.
const contextGone = e => {
  e.preventDefault(); loop.lost = true; flow.pause(); input.release();
  for (const id of ['hud', 'title', 'end', 'pause']) { $(id).inert = true; $(id).classList.remove('on'); }
  $('ctx').hidden = false; $('ctxBtn').focus();
};
canvas.addEventListener('webglcontextlost', contextGone); canvas.addEventListener('webglcontextrestored', contextGone);
$('ctxBtn').addEventListener('click', () => location.reload());

if (params.has('stats')) {
  const el = $('stats'), k = n => n >= 1000 ? (n / 1000).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(n); let acc = 0, n = 0, cpu = 0;
  el.hidden = false;
  loop.onFrame = ms => {
    acc += ms; n++; cpu = Math.max(cpu, loop.cpu); if (acc < 500) return;
    const r = renderer.info.render;      // counted over the whole frame, shadow pass included
    el.textContent = `${Math.round(1000 * n / acc)} fps · ${(acc / n).toFixed(1)} ms (cpu ${cpu.toFixed(1)}) · ${k(r.triangles)} tris · ${r.calls} calls · ${quality.tier}${quality.pinned ? ' pinned' : ''} @${quality.pixelRatio}x · ${Math.round(1000 / quality.refresh)} Hz`;
    acc = 0; n = 0; cpu = 0;
  };
}

// ------------------------------------------------------------------ go
$('play').disabled = false; $('playT').textContent = 'PLAY'; $('loadBar').style.width = '0';
await flow.go('title');
if (store.test) canvas.style.transition = 'none';
loop.start(); requestAnimationFrame(() => canvas.classList.add('live'));      // after the first title frame is in the canvas

window.__acr = window.__dbg = {
  get mode() { return flow.mode; },                      // v1 names: load | title | intro | run | paused | end
  set mode(v) { rig.free = v === 'free'; },              // 'free' parks the rig so a tool can place the camera
  game, world, camera, renderer, scene, THREE, ready: true,
  startRun: () => flow.start(), setBot(v) { opts.bot = !!v; if (v) flow.tainted = true; },
  bus, flow, loop, rig, hud, sound, sfx, quality, store,
  input: input.inp, controls: input, step: (n, dt) => loop.step(n, dt),
};
if (params.has('auto')) flow.start();
