// Gameplay: the course laid along the real route, the skater, traffic, scoring.
import * as THREE from 'three';
import { rng, clamp, lerp, damp, smooth, Mesher, canvasTexture } from './util.js';
import { LANE_W } from './world.js';
import { makeVehicleKit, makeClutterKit, buckeyeGeo, makeSkater, CAR_COLORS } from './props.js';

const GRAV = 21, JUMP_V = 8.6, RAMP_V = 11.4, RAIL_H = 0.62;
const V0 = 18, V1 = 30;
export const MPH = 2.23694;
const laneD = l => l * LANE_W;

export class Game {
  constructor(world, scene, hooks) {
    this.world = world; this.scene = scene; this.hooks = hooks; this.route = world.route;
    this.vehicles = makeVehicleKit(); this.clutter = makeClutterKit();
    this.skater = makeSkater(); scene.add(this.skater.root);
    this.group = new THREE.Group(); scene.add(this.group);
    this.o = {}; this.o2 = {};
    this.vnom = s => lerp(V0, V1, smooth(clamp(s / this.route.finish, 0, 1)));
    this.buildCourse();
    this.buildParked();
    this.buildSparks();
    this.reset();
  }

  // ------------------------------------------------------------ course
  buildCourse() {
    const R = this.route, r = rng(20261121), W = this.world;
    const obs = this.obs = [], nuts = this.nuts = [], rails = this.rails = [], ramps = this.ramps = [];
    const blocked = [];
    const free = (s0, s1, lane) => !blocked.some(b => b.lane === lane && s0 < b.s1 && s1 > b.s0);
    const reserve = (s0, s1, lane) => blocked.push({ s0, s1, lane });
    const line = (s0, n, lane, h = 0.95, gap = 4) => { for (let k = 0; k < n; k++) nuts.push({ s: s0 + k * gap, d: laneD(lane), h }); };
    const arc = (s0, lane, len, peak) => { const n = Math.max(4, Math.round(len / 3.2)); for (let k = 0; k <= n; k++) { const t = k / n; nuts.push({ s: s0 + t * len, d: laneD(lane), h: 0.95 + peak * 4 * t * (1 - t) }); } };
    const turnS = R.names.length > 1 ? R.names[1].s : -999;
    const END = R.finish - 85;

    // city buses waiting at the real stops on the right-hand curb
    let lastBus = -999;
    for (const st of W.city.stops) {
      if (st.d <= 0 || st.s < 260 || st.s > END || st.s - lastBus < 330 || Math.abs(st.s - turnS) < 70) continue;
      const i = Math.round(st.s / R.ds); if (W.inX[i] >= 0 || R.bridge[i]) continue;
      obs.push({ type: 'bus', lane: 1, s: st.s, half: 6.0, hd: 1.3, y0: 0, y1: 3.1, tall: true, v: 0, stop: st.n });
      reserve(st.s - 75, st.s + 30, 1); lastBus = st.s;
    }
    // grind rails down the middle of the bridges
    for (const [a, b] of R.spans) {
      let s = a + 16;
      while (s + 40 < b - 10) { const len = Math.min(lerp(52, 74, r()), b - 12 - s); rails.push({ s0: s, s1: s + len, lane: 0 }); reserve(s - 14, s + len + 12, 0); for (let x = s + 4; x < s + len - 2; x += 5) nuts.push({ s: x, d: 0, h: RAIL_H + 0.95 }); s += len + 24; }
    }
    // an arc of buckeyes to hop through every arch
    for (const a of W.arches) { if (a.s < 150 || a.s > END) continue; arc(a.s - 8, 0, 16, 1.35); reserve(a.s - 13, a.s + 13, 0); }

    let s = 150, slot = 0;
    while (s < END) {
      const prog = s / R.finish, turn = Math.abs(s - turnS) < 46, onSpan = R.spans.some(sp => s > sp[0] - 6 && s < sp[1] + 6);
      if (!turn) {
        // --- centre lane: construction clutter
        let arrowSide = 0;
        if (free(s - 10, s + 10, 0)) {
          const x = r();
          if (x < 0.24) { obs.push({ type: 'barrels', lane: 0, s, half: 0.42, hd: 1.3, y0: 0, y1: 1.0 }); arc(s - 7, 0, 14, 1.2); if (prog > 0.45 && r() < 0.35) obs.push({ type: 'barrels', lane: 0, s: s + 5.5, half: 0.42, hd: 1.3, y0: 0, y1: 1.0 }); }
          else if (x < 0.44) { obs.push({ type: 'barricade', lane: 0, s, half: 0.35, hd: 1.3, y0: 0, y1: 1.1 }); arc(s - 7, 0, 14, 1.25); }
          else if (x < 0.64) { obs.push({ type: 'bar', lane: 0, s, half: 0.25, hd: 1.55, y0: 1.36, y1: 2.0 }); line(s - 8, 5, 0, 0.5); }
          else if (x < 0.76 && prog > 0.08 && !onSpan) {
            arrowSide = r() < 0.5 ? -1 : 1;
            if (!free(s - 60, s + 30, arrowSide)) arrowSide = -arrowSide;
            if (free(s - 60, s + 30, arrowSide)) { obs.push({ type: 'arrow', lane: 0, s, half: 1.2, hd: 1.3, y0: 0, y1: 3.3, tall: true, dir: arrowSide }); reserve(s - 62, s + 32, arrowSide); line(s - 40, 3, 0); line(s - 24, 7, arrowSide); }
            else arrowSide = 0;
          }
          else if (x < 0.88 && s + 40 < END) { ramps.push({ s, lane: 0 }); obs.push({ type: 'barrels', lane: 0, s: s + 9, half: 0.42, hd: 1.3, y0: 0, y1: 1.0 }, { type: 'barricade', lane: 0, s: s + 14.5, half: 0.35, hd: 1.3, y0: 0, y1: 1.1 }); arc(s + 1.5, 0, 24, 2.7); reserve(s - 8, s + 34, 0); }
          else line(s - 8, 5, 0);
        }
        // --- side lanes: traffic
        const x = r(), want = x < 0.16 ? [] : x < 0.5 ? [-1] : x < 0.84 ? [1] : [-1, 1];
        for (const ln of want) {
          if (ln === arrowSide) continue;
          const sm = s + (r() - 0.3) * 14, v = ln < 0 ? -(8.5 + r() * 3.5) : 6 + r() * 3;
          const lead = ln < 0 ? 5 : 9, spawn = sm - v * lead, lo = Math.min(sm, spawn) - 14, hi = Math.max(sm, spawn) + 14;
          if (!free(sm - 20, sm + 20, ln) || (ln > 0 && !free(lo, hi, ln)) || spawn > R.len - 20) continue;
          obs.push({ type: r() < 0.68 ? 'sedan' : 'suv', lane: ln, s: spawn, spawn, sm, v, lead, half: 2.0, hd: 0.93, y0: 0, y1: 1.42, vehicle: true, color: CAR_COLORS[(r() * CAR_COLORS.length) | 0] });
          reserve(sm - 17, sm + 17, ln);
        }
        for (const ln of [-1, 1]) if (!want.includes(ln) && ln !== arrowSide && r() < 0.42 && free(s - 12, s + 20, ln)) line(s - 6, 5, ln);
      }
      s += lerp(44, 31, prog) * (0.85 + r() * 0.35); slot++;
    }
    nuts.sort((a, b) => a.s - b.s);
    for (let i = nuts.length - 1; i > 0; i--) if (Math.abs(nuts[i].s - nuts[i - 1].s) < 1.2 && Math.abs(nuts[i].d - nuts[i - 1].d) < 0.5) nuts.splice(i, 1);
    this.nuts = nuts.filter(n => n.s > 60 && n.s < R.finish - 12);

    // ---- meshes
    const o = this.o;
    for (const ob of obs) {
      ob.d = laneD(ob.lane);
      if (ob.vehicle || ob.type === 'bus') { ob.mesh = this.vehicles.make(ob.type, ob.type === 'bus' ? 0xf2f2ee : ob.color); if (ob.type !== 'bus') { ob.y1 = ob.mesh.userData.ht - 0.03; ob.half = ob.mesh.userData.len / 2 - 0.25; } }
      else ob.mesh = this.clutter.make(ob.type, ob.dir > 0 ? 'R' : 'L');
      this.group.add(ob.mesh); this.placeOb(ob);
    }
    for (const rp of ramps) { rp.mesh = this.clutter.make('ramp'); R.at(rp.s + 0.2, 0, o); rp.mesh.position.set(o.x, o.y + 0.07, o.z); rp.mesh.rotation.y = o.yaw; this.group.add(rp.mesh); }
    { // rails: one merged mesh
      const m = new Mesher(), STEEL = 0xb9c0c8, a = {}, b = {};
      for (const rl of rails) {
        for (let x = rl.s0; x < rl.s1; x += 2) {
          R.at(x, 0, a); R.at(Math.min(rl.s1, x + 2), 0, b); const ya = a.y + 0.07, yb = b.y + 0.07, w = 0.05;
          for (const [h0, h1] of [[RAIL_H - 0.08, RAIL_H]]) { m.quad([a.x - a.tz * -w, ya + h1, a.z + a.tx * -w], [a.x - a.tz * w, ya + h1, a.z + a.tx * w], [b.x - b.tz * w, yb + h1, b.z + b.tx * w], [b.x - b.tz * -w, yb + h1, b.z + b.tx * -w], STEEL); for (const sd of [-w, w]) m.quad([a.x - a.tz * sd, ya + h1, a.z + a.tx * sd], [b.x - b.tz * sd, yb + h1, b.z + b.tx * sd], [b.x - b.tz * sd, yb + h0, b.z + b.tx * sd], [a.x - a.tz * sd, ya + h0, a.z + a.tx * sd], 0x8d949c); }
          if (((x - rl.s0) / 2) % 2 === 0) m.box(0.07, RAIL_H, 0.07, 0x5d6268, a.x, ya + RAIL_H / 2 - 0.04, a.z);
        }
        R.at(rl.s0 - 1.1, 0, a); m.box(0.5, 0.04, 2.6, 0xf2c21a, a.x, a.y + 0.07 + RAIL_H / 2, a.z, a.yaw, -Math.atan2(RAIL_H, 2.4));
      }
      const mesh = new THREE.Mesh(m.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); mesh.castShadow = true; this.group.add(mesh);
    }
    { // buckeyes
      const n = this.nuts.length, im = this.nutMesh = new THREE.InstancedMesh(buckeyeGeo(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a1c0a }), n);
      im.frustumCulled = false; im.castShadow = false; this.group.add(im);
      const gp = new Float32Array(n * 3);
      this.nuts.forEach((nt, i) => { R.at(nt.s, nt.d, o); nt.x = o.x; nt.y = o.y + 0.07 + nt.h; nt.z = o.z; nt.yaw = o.yaw; gp[i * 3] = nt.x; gp[i * 3 + 1] = nt.y; gp[i * 3 + 2] = nt.z; });
      const gt = canvasTexture(64, 64, ctx => { const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,214,120,0.95)'); g.addColorStop(0.35, 'rgba(255,170,60,0.35)'); g.addColorStop(1, 'rgba(255,150,40,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); });
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
      this.nutGlow = new THREE.Points(gg, new THREE.PointsMaterial({ map: gt, size: 1.15, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 })); this.nutGlow.frustumCulled = false; this.group.add(this.nutGlow);
    }
    this.totalNuts = this.nuts.length;
    { // finish line at COSI: checkered strip + banner
      const m = new Mesher(), fs = R.finish, hw = R.at(fs, 0, o).w / 2, a = {}, b = {}, c = {}, d = {};
      for (let row = 0; row < 3; row++) for (let k = 0, x = -hw; x < hw - 0.01; x += 0.8, k++) {
        const x1 = Math.min(hw, x + 0.8), s0 = fs + row * 0.8, col = (k + row) % 2 ? 0x17181a : 0xf2f1ea;
        R.at(s0, x, a); R.at(s0, x1, b); R.at(s0 + 0.8, x, c); R.at(s0 + 0.8, x1, d);
        m.tri(a.x, a.y + 0.1, a.z, b.x, b.y + 0.1, b.z, c.x, c.y + 0.1, c.z, col); m.tri(b.x, b.y + 0.1, b.z, d.x, d.y + 0.1, d.z, c.x, c.y + 0.1, c.z, col);
      }
      R.at(fs + 1.2, 0, o);
      for (const sx of [-1, 1]) { R.at(fs + 1.2, sx * (hw + 0.7), a); m.cyl(0.16, 0.2, 7.4, 0xb3202c, a.x, a.y + 3.7, a.z, 8); m.box(0.9, 0.5, 0.9, 0x2b2e35, a.x, a.y + 0.25, a.z, o.yaw); }
      m.box(hw * 2 + 1.8, 0.16, 0.16, 0x2b2e35, o.x, o.y + 7.3, o.z, o.yaw); m.box(hw * 2 + 1.8, 0.16, 0.16, 0x2b2e35, o.x, o.y + 5.3, o.z, o.yaw);
      const mesh = new THREE.Mesh(m.build(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 })); mesh.castShadow = true; this.scene.add(mesh);
      const tex = canvasTexture(1024, 160, (ctx, w, h) => {
        ctx.fillStyle = '#f4f2ea'; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) { ctx.fillStyle = '#17181a'; ctx.fillRect(i * 40, j * 40, 40, 40); ctx.fillRect(w - 160 + i * 40, j * 40, 40, 40); }
        ctx.fillStyle = '#b3202c'; ctx.font = '800 104px "Arial Narrow","Helvetica Neue",Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('FINISH  ·  COSI', w / 2, h / 2 + 6);
      });
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 1.4, 1.85), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); ban.material.color.setScalar(0.86);
      ban.position.set(o.x, o.y + 6.3, o.z); ban.rotation.y = o.yaw + Math.PI; this.scene.add(ban);
    }
  }

  // only the stretch around the skater is ever drawn
  cull(s) {
    for (const ob of this.obs) ob.mesh.visible = (ob.vehicle ? ob.active : true) && (ob.knock || (ob.s > s - 70 && ob.s < s + 520)) && !ob.gone;
    for (const rp of this.ramps) rp.mesh.visible = rp.s > s - 70 && rp.s < s + 520;
  }

  placeOb(ob) {
    const o = this.route.at(ob.s, ob.d, this.o);
    ob.mesh.position.set(o.x, o.y + 0.07, o.z);
    ob.mesh.rotation.set(0, o.yaw + (ob.v < 0 ? Math.PI : 0), 0);
  }

  // parked cars along the curbs wherever the real street is wide enough
  buildParked() {
    const R = this.route, r = rng(99), kit = this.vehicles, k = kit.kinds.sedan, spots = [], o = this.o;
    for (let s = 20; s < R.len - 10; s += 6.1) {
      const i = Math.round(s / R.ds), hw = R.rw[i] / 2;
      if (hw < LANE_W * 1.5 + 2.25 || this.world.inX[i] >= 0 || this.world.inX[Math.min(R.n - 1, i + 3)] >= 0 || this.world.inX[Math.max(0, i - 3)] >= 0 || R.bridge[i]) continue;
      for (const side of [-1, 1]) { if (r() > 0.6) continue; if (side > 0 && this.obs.some(ob => ob.type === 'bus' && Math.abs(ob.s - s) < 16)) continue; if (this.world.city.stops.some(st => Math.sign(st.d) === side && Math.abs(st.s - s) < 12)) continue; spots.push({ s, d: side * (hw - 1.12), side }); }
    }
    const body = new THREE.InstancedMesh(k.body, new THREE.MeshLambertMaterial(), spots.length), det = new THREE.InstancedMesh(k.det, kit.matDet, spots.length), lit = new THREE.InstancedMesh(k.lit, kit.matLit, spots.length);
    const M = new THREE.Matrix4(), c = new THREE.Color();
    spots.forEach((sp, i) => { R.at(sp.s, sp.d, o); M.makeRotationY(o.yaw + (sp.side < 0 ? Math.PI : 0)).setPosition(o.x, o.y + 0.07, o.z); body.setMatrixAt(i, M); det.setMatrixAt(i, M); lit.setMatrixAt(i, M); body.setColorAt(i, c.setHex(CAR_COLORS[(r() * CAR_COLORS.length) | 0])); });
    body.castShadow = det.castShadow = true; for (const m of [body, det, lit]) { m.frustumCulled = false; this.scene.add(m); }
    lit.material = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x555555 });
  }

  buildSparks() {
    const N = 90; this.sp = { N, p: new Float32Array(N * 3), v: new Float32Array(N * 3), life: new Float32Array(N), next: 0 };
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.sp.p, 3));
    this.sp.mesh = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(2.4, 1.2, 0.35), size: 0.085, sizeAttenuation: true })); this.sp.mesh.frustumCulled = false; this.scene.add(this.sp.mesh);
    for (let i = 0; i < N; i++) this.sp.p[i * 3 + 1] = -999;
  }
  spark(x, y, z, n, spread, up) {
    const sp = this.sp;
    for (let k = 0; k < n; k++) { const i = sp.next = (sp.next + 1) % sp.N; sp.p[i * 3] = x; sp.p[i * 3 + 1] = y; sp.p[i * 3 + 2] = z; sp.v[i * 3] = (Math.random() - 0.5) * spread; sp.v[i * 3 + 1] = Math.random() * up; sp.v[i * 3 + 2] = (Math.random() - 0.5) * spread; sp.life[i] = 0.35 + Math.random() * 0.35; }
  }

  // ------------------------------------------------------------ state
  reset() {
    Object.assign(this, { s: 8, prevS: 8, d: 0, lane: 0, y: 0, vy: 0, speed: 0, air: false, grind: null, duckT: 0, jumpBuf: 0, bigAir: false, invuln: 0, bail: 0, flip: 0, pop: 0, leanV: 0,
      score: 0, chain: 0, mult: 1, time: 0, top: 0, hits: 0, nutsGot: 0, archGot: 0, tricks: 0, state: 'ready', ni: 0, nutRun: 0, nutT: 0, cheer: 0, crouch: 0, shake: 0, district: -1, lmi: 0, ci: 0, grindLen: 0 });
    for (const ob of this.obs) { ob.hit = ob.passed = ob.ghost = ob.gone = false; ob.active = !ob.vehicle; ob.done = false; ob.knock = null; if (ob.vehicle) ob.s = ob.spawn; this.placeOb(ob); }
    for (const rp of this.ramps) rp.used = false;
    const M = new THREE.Matrix4(), gp = this.nutGlow.geometry.attributes.position;
    this.nuts.forEach((n, i) => { n.taken = false; M.makeRotationY(n.yaw).setPosition(n.x, n.y, n.z); this.nutMesh.setMatrixAt(i, M); gp.setXYZ(i, n.x, n.y, n.z); });
    this.nutMesh.instanceMatrix.needsUpdate = true; gp.needsUpdate = true;
    for (const a of this.world.arches) { a.lit = false; a.mat.color.setRGB(1.5, 1.32, 1.0); }
    this.cull(this.state === 'ready' ? this.s : -1e6);
    this.syncSkater(0);
  }
  start() { this.state = 'run'; }

  get mph() { return this.speed * MPH; }
  railAt(s, d) { for (const rl of this.rails) if (s >= rl.s0 && s <= rl.s1 && Math.abs(d - laneD(rl.lane)) < 1.25) return rl; return null; }
  addScore(pts, label, kind) { const p = Math.round(pts * this.mult); this.score += p; if (label) this.hooks.popup(label, p, kind); }
  bump(n) { this.chain += n; const m = Math.min(9, 1 + Math.floor(Math.sqrt(this.chain / 9))); if (m !== this.mult) { this.mult = m; this.hooks.mult(m); } }

  crash(ob) {
    if (this.invuln > 0) return;
    this.hits++; this.invuln = 1.5; this.speed = Math.min(this.speed, 6.5); this.chain = Math.floor(this.chain * 0.3); this.bump(0);
    this.bail = 1; this.shake = 1; this.grind = null; this.hooks.sfx('crash'); this.hooks.popup(ob.vehicle || ob.type === 'bus' ? 'OUCH' : 'WIPEOUT', 0, 'bad');
    if (ob) { ob.ghost = true; if (!ob.vehicle && ob.type !== 'bus' && ob.type !== 'arrow') ob.knock = { vx: (Math.random() - 0.5) * 6, vy: 6 + Math.random() * 3, vz: 0, spin: (Math.random() - 0.5) * 14, fwd: this.speed + 9 }; }
  }

  // ------------------------------------------------------------ frame
  update(dt, inp) {
    const R = this.route, W = this.world;
    this.invuln = Math.max(0, this.invuln - dt); this.bail = Math.max(0, this.bail - dt * 1.5); this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.state === 'ready') { this.syncSkater(dt); return; }
    if (this.state === 'run') {
      this.time += dt;
      const target = this.vnom(this.s);
      this.speed += clamp(target - this.speed, -30 * dt, (this.speed < target * 0.75 ? 8 : 3.2) * dt);
      if (inp.left && this.lane > -1) { this.lane--; this.hooks.sfx('lane'); }
      if (inp.right && this.lane < 1) { this.lane++; this.hooks.sfx('lane'); }
      if (inp.jump) this.jumpBuf = 0.15; else this.jumpBuf -= dt;
      if (inp.duck) this.duckT = 0.72;
      if (inp.duckHeld) this.duckT = Math.max(this.duckT, 0.12);
    } else {                                                   // finishing: coast to a stop at COSI
      this.speed = Math.max(0, this.speed - (this.speed > 6 ? 11 : 5) * dt); this.lane = 0; this.jumpBuf = 0; this.duckT = 0;
      this.cheer = damp(this.cheer, this.speed < 4 ? 1 : 0, 4, dt);
      if (this.speed <= 0 && this.state === 'finish') { this.state = 'done'; this.hooks.done(); }
    }
    this.duckT = Math.max(0, this.duckT - dt);
    this.prevS = this.s; this.s += this.speed * dt; this.top = Math.max(this.top, this.speed);
    const s = this.s, tD = laneD(this.lane), d0 = this.d; this.d = damp(this.d, tD, 13, dt); this.leanV = damp(this.leanV, (this.d - d0) / Math.max(dt, 1e-3), 12, dt);

    // rails / ground / jumping
    const rail = this.state === 'run' ? this.railAt(s, this.d) : null, groundH = rail ? RAIL_H : 0;
    let onGround = this.y <= groundH + 0.02 && this.vy <= 0;
    if (onGround) {
      if (this.air) { this.air = false; this.hooks.sfx('land'); if (this.bigAir) { this.bigAir = false; this.addScore(400, 'BIG AIR', 'trick'); this.bump(3); this.tricks++; } }
      this.y = damp(this.y, groundH, 30, dt); this.vy = 0;
      if (rail && !this.grind) { this.grind = rail; this.grindLen = 0; this.hooks.sfx('grindOn'); }
    }
    if (!rail && this.grind) { this.endGrind(); }
    if (this.grind) {
      const add = this.speed * dt; this.grindLen += add; this.score += add * 8 * this.mult;
      const o = R.at(s, this.d, this.o); if (Math.random() < dt * 60) this.spark(o.x, o.y + RAIL_H + 0.12, o.z, 2, 3.5, 3.5);
    }
    if (this.jumpBuf > 0 && onGround) {
      this.vy = JUMP_V; this.y = Math.max(this.y, groundH) + 0.03; this.air = true; this.jumpBuf = 0; onGround = false; this.pop = 1; this.hooks.sfx('jump');
      if (this.grind) this.endGrind();
    }
    for (const rp of this.ramps) if (!rp.used && this.prevS < rp.s && s >= rp.s) { rp.used = true; if (Math.abs(this.d - laneD(rp.lane)) < 1.3 && this.y < 0.4) { this.vy = RAMP_V; this.y += 0.05; this.air = true; this.bigAir = true; this.flip = 1; onGround = false; this.hooks.sfx('ramp'); } }
    if (!onGround) { this.vy -= GRAV * (this.duckT > 0 && this.vy < 2 ? 2.6 : 1) * dt; this.y += this.vy * dt; if (this.y < groundH) { this.y = groundH; } if (this.y > groundH + 0.05) this.air = true; }
    this.pop = Math.max(0, this.pop - dt * 3.2); this.flip = Math.max(0, this.flip - dt * 1.25);
    const ducking = this.duckT > 0 && !this.air, pH = ducking ? 1.0 : (this.air ? 1.45 : 1.75);

    if (this.state === 'run') {
      this.score += this.speed * dt * 2 * this.mult;
      // traffic
      for (const ob of this.obs) {
        if (ob.vehicle) {
          if (!ob.active && !ob.done && s >= ob.sm - this.vnom(ob.sm) * ob.lead) { ob.active = true; ob.s = ob.spawn; }
          if (ob.active) { ob.s += ob.v * dt; this.placeOb(ob); if (ob.s < s - 60 || ob.s > R.len + 30) { ob.active = false; ob.done = true; } }
        }
        if (ob.knock) { const k = ob.knock, m = ob.mesh; k.vy -= 20 * dt; m.position.y += k.vy * dt; const o = R.at(s, 0, this.o); m.position.x += (o.tx * k.fwd - o.tz * k.vx) * dt; m.position.z += (o.tz * k.fwd + o.tx * k.vx) * dt; m.rotation.x += k.spin * dt; m.rotation.z += k.spin * 0.6 * dt; k.fwd *= 1 - dt; if (m.position.y < o.y - 1) { ob.knock = null; ob.gone = true; } continue; }
        if (!ob.active || ob.ghost) continue;
        const ds = ob.s - s;
        if (ds < -40 || ds > 60) continue;
        const sameLane = Math.abs(this.d - ob.d) < ob.hd + 0.4;
        if (Math.abs(ds) < ob.half + 0.38 && sameLane && this.y < ob.y1 - 0.06 && this.y + pH > ob.y0 + 0.06) { this.crash(ob); if (ob.vehicle) this.hooks.sfx('honk'); continue; }
        if (!ob.passed && ds < -(ob.half + 0.4)) {
          ob.passed = true;
          if (sameLane && this.invuln <= 0) {
            if (ob.y0 > 0) { this.addScore(200, 'LIMBO', 'trick'); this.bump(3); this.tricks++; }
            else if (ob.vehicle) { this.addScore(750, 'CAR HOP', 'trick'); this.bump(4); this.tricks++; }
            else { this.addScore(150, 'HOP', 'trick'); this.bump(2); }
            this.hooks.sfx('trick');
          } else if ((ob.vehicle || ob.type === 'bus') && Math.abs(this.d - ob.d) < LANE_W + 1.0 && this.invuln <= 0) { this.addScore(250, 'CLOSE CALL', 'trick'); this.bump(2); this.hooks.sfx('whoosh'); }
        }
      }
      // buckeyes
      const nuts = this.nuts; while (this.ni < nuts.length && nuts[this.ni].s < s - 4) this.ni++;
      this.nutT -= dt; if (this.nutT <= 0) this.nutRun = 0;
      for (let i = this.ni; i < nuts.length && nuts[i].s < s + 3; i++) {
        const n = nuts[i]; if (n.taken) continue;
        if (Math.abs(n.s - s) < 1.25 && Math.abs(n.d - this.d) < 1.05 && n.h > this.y - 0.2 && n.h < this.y + pH + 0.55) {
          n.taken = true; this.nutsGot++; this.nutRun++; this.nutT = 0.8; this.score += 50 * this.mult; this.bump(1); this.hooks.sfx('nut', this.nutRun);
          this.hideNut(i);
        }
      }
      // arches
      for (const a of W.arches) if (!a.lit && this.prevS < a.s && s >= a.s) {
        a.lit = true; this.archGot++; const hop = this.y > 0.5; a.mat.color.setRGB(2.4, 0.55, 0.3);
        this.addScore(hop ? 600 : 300, hop ? `ARCH HOP ${this.archGot}/${W.arches.length}` : `ARCH ${this.archGot}/${W.arches.length}`, 'arch'); this.bump(2); this.hooks.sfx('arch', this.archGot);
      }
      // places
      const ds = W.city.districts; while (this.district + 1 < ds.length && s >= ds[this.district + 1].s) { this.district++; this.hooks.district(ds[this.district].n); }
      const lm = W.city.landmarks; while (this.lmi < lm.length && s >= lm[this.lmi].s - 150) { this.hooks.landmark(lm[this.lmi]); this.lmi++; }
      if (s >= R.finish) { this.state = 'finish'; if (this.grind) this.endGrind(); this.hooks.sfx('finish'); this.hooks.finishLine(); }
    }
    // spinning buckeyes near the skater
    { const M = this._M || (this._M = new THREE.Matrix4()), t = performance.now() / 1000; let any = false;
      for (let i = this.ni; i < this.nuts.length && this.nuts[i].s < s + 170; i++) { const n = this.nuts[i]; if (n.taken) continue; M.makeRotationY(n.yaw + t * 2.2 + i).setPosition(n.x, n.y + Math.sin(t * 3 + i) * 0.06, n.z); this.nutMesh.setMatrixAt(i, M); any = true; }
      if (any) this.nutMesh.instanceMatrix.needsUpdate = true; }
    // sparks
    { const sp = this.sp; for (let i = 0; i < sp.N; i++) if (sp.life[i] > 0) { sp.life[i] -= dt; sp.v[i * 3 + 1] -= 14 * dt; sp.p[i * 3] += sp.v[i * 3] * dt; sp.p[i * 3 + 1] += sp.v[i * 3 + 1] * dt; sp.p[i * 3 + 2] += sp.v[i * 3 + 2] * dt; if (sp.life[i] <= 0) sp.p[i * 3 + 1] = -999; } sp.mesh.geometry.attributes.position.needsUpdate = true; }
    this.cull(s);
    this.syncSkater(dt, ducking);
  }
  endGrind() { if (this.grindLen > 6) { this.addScore(this.grindLen * 4, `GRIND ${Math.round(this.grindLen * 3.28)} ft`, 'trick'); this.bump(3); this.tricks++; } this.grind = null; this.hooks.sfx('grindOff'); }
  hideNut(i) { const M = this._Z || (this._Z = new THREE.Matrix4().makeScale(0, 0, 0)); this.nutMesh.setMatrixAt(i, M); this.nutMesh.instanceMatrix.needsUpdate = true; const gp = this.nutGlow.geometry.attributes.position; gp.setY(i, -999); gp.needsUpdate = true; }

  syncSkater(dt, ducking) {
    const o = this.route.at(this.s, this.d, this.o), sk = this.skater;
    sk.root.position.set(o.x, o.y + 0.07 + this.y, o.z); sk.root.rotation.y = o.yaw;
    this.crouch = damp(this.crouch, ducking ? 1 : 0, 18, dt || 0.016);
    sk.root.visible = this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0;
    sk.pose(dt || 0, { crouch: this.crouch, air: this.air ? 1 : 0, lean: clamp(-this.leanV * 0.035, -0.5, 0.5), grind: this.grind ? 1 : 0, bail: this.bail, speed: clamp(this.speed / V1, 0, 1), pop: this.pop, flip: this.flip, cheer: this.cheer });
  }

  // ------------------------------------------------------------ test pilot (also drives the attract loop)
  bot(inp) {
    const s = this.s, sp = Math.max(this.speed, 5);
    const threat = (lane, horizon) => { let best = null, bt = horizon; for (const ob of this.obs) { if (!ob.active || ob.ghost || ob.lane !== lane) continue; const gap = ob.s - ob.half - s; if (gap < -ob.half * 2 - 1) continue; const t = Math.max(0, gap) / Math.max(1, sp - (ob.v || 0)); if (t < bt) { bt = t; best = ob; } } return best ? { ob: best, t: bt } : null; };
    const here = threat(this.lane, 1.25);
    if (here) {
      const ob = here.ob;
      if (ob.tall || ob.vehicle) {
        const opts = [-1, 0, 1].filter(l => l !== this.lane && Math.abs(l - this.lane) === 1 && !threat(l, 1.7));
        if (ob.dir && opts.includes(this.lane + ob.dir)) { if (ob.dir < 0) inp.left = true; else inp.right = true; }
        else if (opts.length) { if (opts[0] < this.lane) inp.left = true; else inp.right = true; }
        else if (!ob.tall && here.t < 0.22) inp.jump = true;
      } else if (ob.y0 > 0) { if (here.t < 0.3) inp.duck = true; }
      else if (here.t < 0.2 && !this.air) inp.jump = true;
    } else if (!this.air) {
      // drift toward buckeyes when the way is clear
      for (let i = this.ni; i < this.nuts.length && this.nuts[i].s < s + 26; i++) { const n = this.nuts[i]; if (n.taken || n.s < s + 8) continue; const l = Math.round(n.d / LANE_W); if (l !== this.lane && !threat(l, 1.6) && Math.abs(l - this.lane) === 1) { if (l < this.lane) inp.left = true; else inp.right = true; } break; }
      for (const a of this.world.arches) if (!a.lit && this.lane === 0 && a.s - s > 5 && a.s - s < 5 + sp * 0.12) inp.jump = true;
    }
  }
}
