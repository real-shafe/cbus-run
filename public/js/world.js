// Builds the 3D city from data/city.json (OSM + FEMA lidar heights + USGS terrain).
import * as THREE from 'three';
import { Mesher, rng, clamp, lerp, shortName, canvasTexture } from './util.js';

export const LANE_W = 3.3;
const SW = 4.2;                 // sidewalk width beside the hero road
const ASPHALT = 0x6a6b71;
const SUN_AZ = 222 * Math.PI / 180, SUN_EL = 21 * Math.PI / 180;
export const SUN_DIR = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL)).normalize();

const PAL = {
  brick: [0x8c4a3a, 0x7a3b30, 0x9a5a44, 0x6e3a33, 0xa3684c, 0x84513f, 0xb07a5a, 0x93503c],
  paint: [0xd9d2c4, 0x33383d, 0x4f6d6a, 0xc9b38a, 0x8a9aa8, 0xe6dfd0, 0x384652, 0xb8573f],
  siding: [0xe8e2d2, 0xd8c9a3, 0xa9b7bd, 0xc7d0c0, 0xb5645a, 0x8c9a7a, 0xf0ece2, 0x9aa4b4, 0xcdb9a0, 0x7f8d99],
  stone: [0xc9c1b0, 0xb8b0a0, 0xd6cfbf, 0xa9a69c, 0xbfb7a4],
  concrete: [0xa8a6a0, 0x97958f, 0xb5b2aa, 0x8c8e90],
  glass: [0x40505e, 0x4a5a66, 0x35424e, 0x55606a, 0x3b4a48],
  metal: [0x8f959b, 0x7b8288, 0xa2a39f, 0x6f7a80],
  roofFlat: [0x6a6860, 0x77736b, 0x5a5a5c, 0x807a70, 0x9a9890],
  roofHouse: [0x4a4642, 0x5b4a3f, 0x3f4347, 0x57514c],
};
const TREE_COL = [0xd87a2c, 0xc23f2c, 0xe5b63a, 0x9a5f2a, 0x39563a, 0x8c2f3a];

export async function buildWorld(city, scene, renderer, q, step) {
  const W = { city };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ---------------------------------------------------------------- terrain
  const T = city.terrain, HX = -T.x0, HZ = -T.z0;
  const bin = atob(T.h), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const h16 = new Int16Array(u8.buffer), H = new Float32Array(h16.length); for (let i = 0; i < H.length; i++) H[i] = h16[i] / 10;
  const terrainY = (x, z) => {
    let fx = clamp((x - T.x0) / T.cell, 0, T.nx - 1.001), fz = clamp((z - T.z0) / T.cell, 0, T.nz - 1.001);
    const ix = fx | 0, iz = fz | 0, u = fx - ix, v = fz - iz, o = iz * T.nx + ix;
    const a = H[o], b = H[o + 1], c = H[o + T.nx], d = H[o + T.nx + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  };
  W.terrainY = terrainY;

  // ---------------------------------------------------------------- route
  const RP = city.route, NR = RP.p.length / 3, DS = RP.ds;
  const rx = new Float32Array(NR), ry = new Float32Array(NR), rz = new Float32Array(NR), tx = new Float32Array(NR), tz = new Float32Array(NR), rw = new Float32Array(NR);
  for (let i = 0; i < NR; i++) { rx[i] = RP.p[i * 3] / 10; rz[i] = RP.p[i * 3 + 1] / 10; ry[i] = RP.p[i * 3 + 2] / 10; rw[i] = RP.w[i] / 10; }
  for (let i = 0; i < NR; i++) { const a = Math.max(0, i - 1), b = Math.min(NR - 1, i + 1), dx = rx[b] - rx[a], dz = rz[b] - rz[a], l = Math.hypot(dx, dz); tx[i] = dx / l; tz[i] = dz / l; }
  const cellR = 30, rHash = new Map();
  for (let i = 0; i < NR; i++) { const k = Math.floor(rx[i] / cellR) + ',' + Math.floor(rz[i] / cellR); if (!rHash.has(k)) rHash.set(k, []); rHash.get(k).push(i); }
  const route = W.route = {
    len: RP.len, finish: RP.finish, ds: DS, n: NR, rx, ry, rz, tx, tz, rw, bridge: RP.b, spans: RP.spans, names: RP.names,
    at(s, d = 0, out = {}) {
      const f = s / DS;
      if (f <= 0) { out.x = rx[0] + tx[0] * s; out.z = rz[0] + tz[0] * s; out.y = ry[0]; out.tx = tx[0]; out.tz = tz[0]; out.w = rw[0]; }
      else if (f >= NR - 1) { const e = NR - 1, r = s - e * DS; out.x = rx[e] + tx[e] * r; out.z = rz[e] + tz[e] * r; out.y = ry[e]; out.tx = tx[e]; out.tz = tz[e]; out.w = rw[e]; }
      else {
        const i = f | 0, t = f - i; out.x = lerp(rx[i], rx[i + 1], t); out.y = lerp(ry[i], ry[i + 1], t); out.z = lerp(rz[i], rz[i + 1], t);
        let ax = lerp(tx[i], tx[i + 1], t), az = lerp(tz[i], tz[i + 1], t); const l = Math.hypot(ax, az); out.tx = ax / l; out.tz = az / l; out.w = lerp(rw[i], rw[i + 1], t);
      }
      out.x -= out.tz * d; out.z += out.tx * d; out.yaw = Math.atan2(out.tx, out.tz);
      return out;
    },
    // distance from (x,z) to the centreline (Infinity if farther than maxD)
    near(x, z, maxD = 60) {
      let bd = maxD * maxD; const cx = Math.floor(x / cellR), cz = Math.floor(z / cellR), rr = Math.ceil(maxD / cellR);
      for (let i = cx - rr; i <= cx + rr; i++) for (let j = cz - rr; j <= cz + rr; j++) { const l = rHash.get(i + ',' + j); if (!l) continue; for (const k of l) { const dd = (rx[k] - x) ** 2 + (rz[k] - z) ** 2; if (dd < bd) bd = dd; } }
      return bd < maxD * maxD ? Math.sqrt(bd) : Infinity;
    },
    name(s) { let n = this.names[0].n; for (const e of this.names) if (s >= e.s) n = e.n; return n; },
  };
  const P = (i, d, y = 0) => [rx[i] - tz[i] * d, ry[i] + y, rz[i] + tx[i] * d];
  const hw = i => rw[i] / 2;
  // cross streets (deduplicated) and the samples they occupy
  const cross = W.cross = []; for (const c of city.cross) { if (cross.length && c.s - cross[cross.length - 1].s < 22) { const p = cross[cross.length - 1]; p.sig |= c.sig; p.w = Math.max(p.w, c.w); continue; } cross.push({ ...c, w: clamp(c.w, 7, 26), label: shortName(c.n) }); }
  const inX = new Int16Array(NR).fill(-1);
  cross.forEach((c, ci) => { for (let i = Math.max(0, Math.floor((c.s - c.w / 2 - 2) / DS)); i <= Math.min(NR - 1, Math.ceil((c.s + c.w / 2 + 2) / DS)); i++) inX[i] = ci; });
  W.inX = inX;
  await step('Laying out High Street');

  // ---------------------------------------------------------------- ground texture
  const GW = q.groundTex, GH = q.groundTex * 2;
  const groundTex = canvasTexture(GW, GH, ctx => {
    ctx.fillStyle = '#86816f'; ctx.fillRect(0, 0, GW, GH);
    const r0 = rng(11);
    for (let i = 0; i < 26000; i++) { ctx.fillStyle = r0() < 0.5 ? 'rgba(60,58,48,0.07)' : 'rgba(190,182,160,0.07)'; const s = 2 + r0() * 7; ctx.fillRect(r0() * GW, r0() * GH, s, s); }
    ctx.setTransform(GW / (2 * HX) * 0.1, 0, 0, GH / (2 * HZ) * 0.1, GW / 2, GH / 2);   // world decimetres
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const poly = r => { ctx.beginPath(); ctx.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]); ctx.closePath(); };
    const line = p => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); };
    const CC = ['#7d8b47', '#69994a', '#5e6b3b', '#cbb98a', '#8a765c', '#716c65', '#56575b', '#3f7f9a'];
    for (const c of city.cover) { poly(c.r); ctx.fillStyle = CC[c.k]; ctx.fill(); }
    ctx.fillStyle = '#b1ab9f'; for (const r of city.plazas) { poly(r); ctx.fill(); }
    ctx.fillStyle = '#2b4750'; for (const w of city.water) { poly(w.r); ctx.fill(); }
    ctx.strokeStyle = '#6a655e'; ctx.lineWidth = 52; for (const r of city.rails) { line(r.p); ctx.stroke(); }
    ctx.strokeStyle = '#a5a096'; for (const r of city.roads) if (r.k >= 1 && r.k <= 4 && !r.y) { ctx.lineWidth = r.w + 56; line(r.p); ctx.stroke(); }
    ctx.strokeStyle = '#696a70'; for (const r of city.roads) if (!r.y) { ctx.lineWidth = r.w; line(r.p); ctx.stroke(); }
    ctx.strokeStyle = '#aaa497'; ctx.lineWidth = 20; for (const p of city.paths) { line(p.p); ctx.stroke(); }
    // soft contact shadow + dark pad under every building
    ctx.strokeStyle = 'rgba(30,26,22,0.28)'; ctx.lineWidth = 36; ctx.fillStyle = '#4d4944';
    for (const b of city.buildings) if (!b.m) { poly(b.r); ctx.stroke(); ctx.fill(); }
    // fallen leaves
    const LC = ['rgba(216,122,44,0.5)', 'rgba(194,63,44,0.45)', 'rgba(229,182,58,0.5)', 'rgba(154,95,42,0.45)', null, 'rgba(140,47,58,0.4)'];
    const tr = city.trees;
    for (let i = 0; i < tr.length; i += 4) { const c = LC[tr[i + 2]]; if (!c) continue; ctx.fillStyle = c; for (let k = 0; k < 7; k++) { const a = r0() * 6.28, d = r0() * 55; ctx.beginPath(); ctx.arc(tr[i] + Math.cos(a) * d, tr[i + 1] + Math.sin(a) * d, 5 + r0() * 9, 0, 6.3); ctx.fill(); } }
  }, { aniso: maxAniso });
  {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(T.nx * T.nz * 3), uv = new Float32Array(T.nx * T.nz * 2), idx = new Uint32Array((T.nx - 1) * (T.nz - 1) * 6);
    for (let j = 0, k = 0; j < T.nz; j++) for (let i = 0; i < T.nx; i++, k++) { pos[k * 3] = T.x0 + i * T.cell; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = T.z0 + j * T.cell; uv[k * 2] = i / (T.nx - 1); uv[k * 2 + 1] = 1 - j / (T.nz - 1); }
    for (let j = 0, k = 0; j < T.nz - 1; j++) for (let i = 0; i < T.nx - 1; i++) { const a = j * T.nx + i, b = a + 1, c = a + T.nx, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: groundTex })); m.receiveShadow = true; scene.add(m);
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshLambertMaterial({ color: 0x86816f })); skirt.rotation.x = -Math.PI / 2; skirt.position.y = -13.5; scene.add(skirt);
  }
  await step('Draping terrain');

  // ---------------------------------------------------------------- ordinary streets, rails
  const roadM = new Mesher(), markM = new Mesher(), concM = new Mesher();
  const CONC = 0xa7a39a, CONC2 = 0x9d998f;
  const ribbon = (m, pts, half, yOff, col, fixedY) => {
    const n = pts.length; let pl = null, pr = null;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const p = pts[i], lx = p.x + dz * half, lz = p.z - dx * half, qx = p.x - dz * half, qz = p.z + dx * half;
      const L = [lx, (fixedY ? p.y : terrainY(lx, lz)) + yOff, lz], Rr = [qx, (fixedY ? p.y : terrainY(qx, qz)) + yOff, qz];
      if (pl) { m.tri(...pl, ...pr, ...L, col); m.tri(...pr, ...Rr, ...L, col); }
      pl = L; pr = Rr;
    }
  };
  const densify = (p, y, maxSeg) => {
    const out = [];
    for (let i = 0; i + 2 < p.length; i += 2) {
      const ax = p[i] / 10, az = p[i + 1] / 10, bx = p[i + 2] / 10, bz = p[i + 3] / 10, L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / maxSeg));
      const ya = y ? y[i / 2] / 10 : 0, yb = y ? y[i / 2 + 1] / 10 : 0;
      for (let k = 0; k < n; k++) { const t = k / n; out.push({ x: lerp(ax, bx, t), z: lerp(az, bz, t), y: lerp(ya, yb, t) }); }
      if (i + 4 >= p.length) out.push({ x: bx, z: bz, y: yb });
    }
    return out;
  };
  for (const r of city.roads) {
    const pts = densify(r.p, r.y, 6), half = r.w / 20;
    if (pts.length < 2) continue;
    ribbon(roadM, pts, half, 0.045, ASPHALT, !!r.y);
    if (r.y) {   // bridge: fascia + piers
      let acc = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1]; let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        for (const sgn of [1, -1]) { const ox = dz * half * sgn, oz = -dx * half * sgn; concM.quad([a.x + ox, a.y + 0.9, a.z + oz], [b.x + ox, b.y + 0.9, b.z + oz], [b.x + ox, b.y - 1.1, b.z + oz], [a.x + ox, a.y - 1.1, a.z + oz], CONC2); }
        acc += l;
        if (acc > 30) { acc = 0; const gy = terrainY(a.x, a.z); if (a.y - gy > 3.2) concM.box(half * 1.5, a.y - gy + 1, 1.3, CONC2, a.x, (a.y + gy) / 2 - 0.6, a.z, Math.atan2(dx, dz)); }
      }
    }
    if (!r.o && r.k >= 1 && r.k <= 4 && r.w >= 70) {   // centre line, except where the hero road takes over
      const seg = []; const flush = () => { if (seg.length > 1) ribbon(markM, seg, 0.09, 0.07, 0xc9a436, !!r.y); seg.length = 0; };
      for (const p of pts) { if (route.near(p.x, p.z, 22) < 14) flush(); else seg.push(p); }
      flush();
    }
  }
  for (const r of city.rails) {
    const pts = densify(r.p, r.y, 6); if (pts.length < 2) continue;
    ribbon(roadM, pts, 1.7, 0.03, 0x5d5852, !!r.y);
    for (const o of [-0.72, 0.72]) { const off = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; return { x: p.x + dz / l * o, z: p.z - dx / l * o, y: p.y }; }); ribbon(markM, off, 0.06, 0.14, 0x8f949b, !!r.y); }
  }
  await step('Paving side streets');

  // ---------------------------------------------------------------- the hero road
  const heroM = new Mesher();
  const strip = (m, i0, i1, dL, dR, y, col, skip) => {
    for (let i = i0; i < i1; i++) {
      if (skip && skip(i)) continue;
      const a = P(i, dL(i), y), b = P(i, dR(i), y), c = P(i + 1, dL(i + 1), y), d = P(i + 1, dR(i + 1), y), cc = typeof col === 'function' ? col(i) : col;
      m.tri(...a, ...b, ...c, cc); m.tri(...b, ...d, ...c, cc);
    }
  };
  const rA = rng(5), patch = []; for (let i = 0; i <= NR / 24 + 1; i++) patch.push(new THREE.Color(ASPHALT).offsetHSL(0, 0, (rA() - 0.5) * 0.035));
  strip(heroM, 0, NR - 1, i => -hw(i), i => hw(i), 0.07, i => patch[(i / 24) | 0]);
  const YEL = 0xd2a93a, WHT = 0xd9d8d0, MY = 0.085, noX = i => inX[i] >= 0;
  for (const s of [-1, 1]) {
    strip(markM, 0, NR - 1, () => s * LANE_W / 2 - 0.06, () => s * LANE_W / 2 + 0.06, MY, YEL, noX);
    strip(markM, 0, NR - 1, () => s * (LANE_W / 2 - 0.26) - 0.06, () => s * (LANE_W / 2 - 0.26) + 0.06, MY, YEL, i => noX(i) || i % 6 > 1);
    strip(markM, 0, NR - 1, () => s * LANE_W * 1.5 - 0.06, () => s * LANE_W * 1.5 + 0.06, MY, WHT, i => noX(i) || hw(i) < 6.3);
    strip(markM, 0, NR - 1, () => s * 8.25 - 0.06, () => s * 8.25 + 0.06, MY, WHT, i => noX(i) || hw(i) < 8.9 || i % 6 > 1);
  }
  const o1 = {}, o2 = {}, o3 = {}, o4 = {};
  const pad = (m, s0, s1, d0, d1, y, col) => { route.at(s0, d0, o1); route.at(s0, d1, o2); route.at(s1, d0, o3); route.at(s1, d1, o4); m.tri(o1.x, o1.y + y, o1.z, o2.x, o2.y + y, o2.z, o3.x, o3.y + y, o3.z, col); m.tri(o2.x, o2.y + y, o2.z, o4.x, o4.y + y, o4.z, o3.x, o3.y + y, o3.z, col); };
  for (const c of cross) {
    for (const sc of [c.s - c.w / 2 - 3.6, c.s + c.w / 2 + 3.6]) {
      if (sc < 4 || sc > route.len - 4) continue;
      const h = route.at(sc, 0, {}).w / 2;
      for (let d = -h + 0.7; d < h - 0.9; d += 1.25) pad(markM, sc - 1.5, sc + 1.5, d, d + 0.6, MY, WHT);
    }
    pad(markM, c.s - c.w / 2 - 6.4, c.s - c.w / 2 - 5.9, 0, route.at(c.s, 0, {}).w / 2 - 0.3, MY, WHT);   // stop bar
  }
  // curbs, sidewalks, bridge decks
  const SWC = [new THREE.Color(0xaaa69c), new THREE.Color(0xa29e94)];
  const curbSkip = i => inX[i] >= 0 && !RP.b[i];
  for (const s of [-1, 1]) {
    strip(heroM, 0, NR - 1, i => (s < 0 ? -(hw(i) + SW) : hw(i)), i => (s < 0 ? -hw(i) : hw(i) + SW), 0.22, i => SWC[i & 1], curbSkip);
    for (let i = 0; i < NR - 1; i++) { if (curbSkip(i)) continue; concM.quad(P(i, s * hw(i), 0.22), P(i + 1, s * hw(i + 1), 0.22), P(i + 1, s * hw(i + 1), 0.05), P(i, s * hw(i), 0.05), 0x8f8b82); }
  }
  for (const [s0, s1] of RP.spans) {
    const i0 = Math.round(s0 / DS), i1 = Math.round(s1 / DS), dk = i => Math.max(hw(i) + SW + 0.35, RP.deck[i] || 0);
    for (const s of [-1, 1]) {
      strip(heroM, i0, i1, i => (s < 0 ? -dk(i) : hw(i) + SW), i => (s < 0 ? -(hw(i) + SW) : dk(i)), 0.22, 0xb0aa9e);
      for (let i = i0; i < i1; i++) {
        const a = dk(i) * s, b = dk(i + 1) * s, ai = (dk(i) - 0.32) * s, bi = (dk(i + 1) - 0.32) * s;
        concM.quad(P(i, a, 1.15), P(i + 1, b, 1.15), P(i + 1, b, -1.5), P(i, a, -1.5), CONC);          // fascia + parapet outside
        concM.quad(P(i, ai, 1.15), P(i + 1, bi, 1.15), P(i + 1, bi, 0.2), P(i, ai, 0.2), CONC);         // parapet inside
        concM.quad(P(i, a, 1.15), P(i + 1, b, 1.15), P(i + 1, bi, 1.15), P(i, ai, 1.15), 0xb5b1a8);     // parapet top
        if (i % 2 === 0) { const p = P(i, (dk(i) - 0.16) * s, 1.45); concM.box(0.08, 0.6, 0.08, 0x3a3f44, p[0], p[1], p[2]); }
        const r0 = P(i, (dk(i) - 0.16) * s, 1.72), r1 = P(i + 1, (dk(i + 1) - 0.16) * s, 1.72);
        concM.quad([r0[0], r0[1] + 0.05, r0[2]], [r1[0], r1[1] + 0.05, r1[2]], [r1[0], r1[1] - 0.05, r1[2]], [r0[0], r0[1] - 0.05, r0[2]], 0x3a3f44);
      }
    }
    strip(concM, i0, i1, i => -dk(i), i => dk(i), -1.5, CONC2);
    for (let i = i0 + 9; i < i1 - 6; i += 17) { const gy = terrainY(rx[i], rz[i]); if (ry[i] - gy > 3.5) concM.box(hw(i) * 1.7, ry[i] - gy + 1.5, 2.2, CONC2, rx[i], (ry[i] - 1.5 + gy - 3) / 2 + 0.75, rz[i], Math.atan2(tx[i], tz[i])); }
  }
  {
    const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const roads = new THREE.Mesh(roadM.build(), roadMat); roads.receiveShadow = true; scene.add(roads);
    const heroMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const hero = new THREE.Mesh(heroM.build(), heroMat); hero.receiveShadow = true; scene.add(hero);
    const markMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const marks = new THREE.Mesh(markM.build(), markMat); marks.receiveShadow = true; scene.add(marks);
    const conc = new THREE.Mesh(concM.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); conc.castShadow = conc.receiveShadow = true; scene.add(conc);
  }
  await step('Striping the road');

  // ---------------------------------------------------------------- buildings
  const facadeMat = makeFacadeMaterial();
  W.facadeMat = facadeMat;
  {
    const chunks = new Map(), CH = 260, col = new THREE.Color(), rcol = new THREE.Color();
    const v2 = [];
    let bi = 0;
    for (const b of city.buildings) {
      bi++;
      const n = b.r.length / 2; if (n < 3) continue;
      const ring = []; let area = 0, cx = 0, cz = 0;
      for (let i = 0; i < n; i++) { ring.push([b.r[i * 2] / 10, b.r[i * 2 + 1] / 10]); cx += ring[i][0]; cz += ring[i][1]; }
      for (let i = 0, j = n - 1; i < n; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      if (area < 0) ring.reverse();
      cx /= n; cz /= n;
      const key = Math.floor(cx / CH) + ',' + Math.floor(cz / CH);
      let ch = chunks.get(key); if (!ch) chunks.set(key, ch = { pos: [], nor: [], col: [], wall: [], style: [] });
      const r = rng(bi * 7919 + n), st = styleFor(b, r, Math.abs(area) / 2, col, rcol);
      const yRef = b.y / 10, h = b.h / 10, top = yRef + h, bot = b.m ? yRef + b.m / 10 : b.g / 10 - 0.6, seed = r() * 100;
      const push = (x, y, z, nx, ny, nz, c, u, v, L, kind) => { ch.pos.push(x, y, z); ch.nor.push(nx, ny, nz); ch.col.push(c.r, c.g, c.b); ch.wall.push(u, v, h, L); ch.style.push(st.fh, st.bw, kind, seed); };
      let u0 = 0;
      for (let i = 0; i < n; i++) {
        const a = ring[i], c = ring[(i + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.05) continue;
        const nx = dz / L, nz = -dx / L, k = L < 1.6 ? 0 : st.kind, vb = bot - yRef;
        push(a[0], bot, a[1], nx, 0, nz, col, 0, vb, L, k); push(a[0], top, a[1], nx, 0, nz, col, 0, h, L, k); push(c[0], bot, c[1], nx, 0, nz, col, L, vb, L, k);
        push(c[0], bot, c[1], nx, 0, nz, col, L, vb, L, k); push(a[0], top, a[1], nx, 0, nz, col, 0, h, L, k); push(c[0], top, c[1], nx, 0, nz, col, L, h, L, k);
        u0 += L;
      }
      v2.length = 0; for (const p of ring) v2.push(new THREE.Vector2(p[0], p[1]));
      let tris; try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch { tris = []; }
      for (const t of tris) {
        let [a, c, d] = t; const A = ring[a], C = ring[c], D = ring[d];
        if ((C[0] - A[0]) * (D[1] - A[1]) - (C[1] - A[1]) * (D[0] - A[0]) > 0) { const s = c; c = d; d = s; }
        for (const k of [a, c, d]) push(ring[k][0], top, ring[k][1], 0, 1, 0, rcol, 0, 0, 0, 0);
        if (b.m) for (const k of [a, d, c]) push(ring[k][0], bot, ring[k][1], 0, -1, 0, rcol, 0, 0, 0, 0);
      }
    }
    W.buildingMeshes = [];
    for (const ch of chunks.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(ch.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(ch.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(ch.col, 3)); g.setAttribute('aWall', new THREE.Float32BufferAttribute(ch.wall, 4)); g.setAttribute('aStyle', new THREE.Float32BufferAttribute(ch.style, 4));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, facadeMat); m.castShadow = m.receiveShadow = true; scene.add(m); W.buildingMeshes.push(m);
    }
  }
  await step('Raising 6,000 buildings');

  // ---------------------------------------------------------------- water
  W.waterMats = [];
  for (const w of city.water) {
    const n = w.r.length / 2, v2 = [], pos = [], uv = [];
    for (let i = 0; i < n; i++) { v2.push(new THREE.Vector2(w.r[i * 2] / 10, w.r[i * 2 + 1] / 10)); pos.push(w.r[i * 2] / 10, w.y / 10, w.r[i * 2 + 1] / 10); uv.push(w.r[i * 2] / 240, w.r[i * 2 + 1] / 240); }
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch { continue; }
    const idx = []; for (const [a, b, c] of tris) { const A = v2[a], B = v2[b], C = v2[c]; if ((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) > 0) idx.push(a, c, b); else idx.push(a, b, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const nm = canvasTexture(128, 128, (ctx, cw, chh) => { const r = rng(3); ctx.fillStyle = 'rgb(128,128,255)'; ctx.fillRect(0, 0, cw, chh); for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${(90 + r() * 76) | 0},${(104 + r() * 48) | 0},255,0.5)`; ctx.fillRect(r() * cw, r() * chh, 3 + r() * 14, 1 + r() * 2); } });
    nm.colorSpace = THREE.NoColorSpace; nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshPhongMaterial({ color: 0x2c4a52, specular: 0xffd2a0, shininess: 70, normalMap: nm, normalScale: new THREE.Vector2(0.5, 0.5) });
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); W.waterMats.push(mat);
  }

  // ---------------------------------------------------------------- trees (real OSM positions + species)
  {
    const tr = city.trees, n = tr.length / 4, near = [], far = [];
    for (let i = 0; i < n; i++) { const x = tr[i * 4] / 10, z = tr[i * 4 + 1] / 10, d = route.near(x, z, q.treeNear); (d < q.treeNear ? near : far).push(i); }
    const mk = detail => { const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, r = rng(9); const seen = new Map(); for (let i = 0; i < p.count; i++) { const k = p.getX(i).toFixed(3) + p.getY(i).toFixed(3) + p.getZ(i).toFixed(3); if (!seen.has(k)) seen.set(k, 0.82 + r() * 0.36); const s = seen.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.88, p.getZ(i) * s); } g.computeVertexNormals(); return g; };
    const cone = new THREE.ConeGeometry(1, 2.6, 7); cone.translate(0, 0.4, 0);
    const leafMat = new THREE.MeshLambertMaterial({ flatShading: true }), trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2e });
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), C = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), r = rng(21);
    const place = (list, geo, conif, shadow) => {
      const all = list.filter(i => (tr[i * 4 + 2] === 4) === conif), bands = new Map();
      for (const i of all) { const b = Math.floor(tr[i * 4 + 1] / 4500); if (!bands.has(b)) bands.set(b, []); bands.get(b).push(i); }
      for (const sel of bands.values()) {
      const im = new THREE.InstancedMesh(geo, leafMat, sel.length);
      sel.forEach((i, k) => {
        const x = tr[i * 4] / 10, z = tr[i * 4 + 1] / 10, sz = tr[i * 4 + 3] / 100, R = (conif ? 2.0 : 2.7) * sz, y = terrainY(x, z);
        Q.setFromAxisAngle(up, r() * 6.28); S.set(R, conif ? R * 1.5 : R, R); V.set(x, y + (conif ? 3.2 * sz : 2.6 + R * 0.75), z); M.compose(V, Q, S); im.setMatrixAt(k, M);
        C.setHex(TREE_COL[tr[i * 4 + 2]]).offsetHSL((r() - 0.5) * 0.05, (r() - 0.5) * 0.12, (r() - 0.5) * 0.1); im.setColorAt(k, C);
      });
      im.castShadow = shadow; im.receiveShadow = false; im.computeBoundingSphere(); scene.add(im);
      }
    };
    place(near, mk(1), false, true); place(far, mk(0), false, false); place(near, cone, true, true); place(far, cone, true, false);
    const tg = new THREE.CylinderGeometry(0.13, 0.2, 1, 5); tg.translate(0, 0.5, 0);
    const tm = new THREE.InstancedMesh(tg, trunkMat, near.length);
    near.forEach((i, k) => { const x = tr[i * 4] / 10, z = tr[i * 4 + 1] / 10, sz = tr[i * 4 + 3] / 100; S.set(1.2 * sz, 3.4 * sz, 1.2 * sz); V.set(x, terrainY(x, z) - 0.1, z); Q.identity(); M.compose(V, Q, S); tm.setMatrixAt(k, M); });
    tm.castShadow = true; tm.frustumCulled = false; scene.add(tm);
  }
  await step('Planting 3,800 trees');

  // ---------------------------------------------------------------- street furniture along the route
  const propM = new Mesher(), glowPts = [], litM = new Mesher();
  const F = new THREE.Matrix4(), L4 = new THREE.Matrix4(), o = {};
  const frame = (s, d, y = 0) => { route.at(s, d, o); return F.makeRotationY(o.yaw).setPosition(o.x, o.y + y, o.z).clone(); };
  const putBox = (m, fr, w, h, dd, col, lx, ly, lz) => { const g = new THREE.BoxGeometry(w, h, dd); m.add(g, col, L4.makeTranslation(lx, ly, lz).premultiply(fr)); g.dispose(); };
  const putCyl = (m, fr, rt, rb, h, col, lx, ly, lz, seg = 6, rz = 0) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); if (rz) g.rotateZ(rz); m.add(g, col, L4.makeTranslation(lx, ly, lz).premultiply(fr)); g.dispose(); };
  const POLE = 0x2b3230;
  // lamps: acorn posts in the Short North, taller cobra heads downtown
  for (let s = 14, k = 0; s < route.len - 8; s += 31, k++) {
    const i = Math.round(s / DS); if (inX[i] >= 0) continue;
    const side = k % 2 ? 1 : -1, tall = s > 1800, fr = frame(s, side * (hw(i) + 0.9), 0.22), ht = tall ? 8.2 : 4.6;
    putCyl(propM, fr, 0.07, 0.11, ht, POLE, 0, ht / 2, 0);
    if (tall) { putBox(propM, fr, 1.9, 0.09, 0.09, POLE, side * 0.9, ht, 0); putBox(litM, fr, 0.5, 0.1, 0.22, 0xffe2b0, side * 1.75, ht - 0.08, 0); route.at(s, side * (hw(i) - 0.85), o); glowPts.push(o.x, o.y + ht + 0.1, o.z); }
    else { putCyl(litM, fr, 0.2, 0.13, 0.42, 0xffe6bd, 0, ht + 0.2, 0, 6); putCyl(propM, fr, 0.03, 0.22, 0.14, POLE, 0, ht + 0.48, 0, 6); route.at(s, side * (hw(i) + 0.9), o); glowPts.push(o.x, o.y + ht + 0.4, o.z); }
  }
  for (let i = 0; i < city.lamps.length; i += 2) { const x = city.lamps[i] / 10, z = city.lamps[i + 1] / 10; if (route.near(x, z, 40) < 14) continue; const y = terrainY(x, z); propM.cyl(0.06, 0.1, 5, POLE, x, y + 2.5, z, 5); litM.sphere(0.2, 0xffe6bd, x, y + 5.1, z, 1, 1, 1, 0); glowPts.push(x, y + 5.1, z); }
  // signals + street-name blades
  W.signs = [];
  const signMat = new Map();
  const signTex = label => {
    if (signMat.has(label)) return signMat.get(label);
    const t = canvasTexture(512, 104, (ctx, w, h) => {
      ctx.fillStyle = '#0b6a3b'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#f2f2ee'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.fillStyle = '#f6f6f0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; let fs = 64; ctx.font = `700 ${fs}px "Arial Narrow","Helvetica Neue",Arial,sans-serif`;
      const mw = ctx.measureText(label).width; if (mw > w - 40) { fs *= (w - 40) / mw; ctx.font = `700 ${fs}px "Arial Narrow","Helvetica Neue",Arial,sans-serif`; }
      ctx.fillText(label, w / 2, h / 2 + 3);
    }, { aniso: maxAniso });
    const m = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, fog: true }); m.color.setScalar(0.82); signMat.set(label, m); return m;
  };
  const bladeGeo = new THREE.PlaneGeometry(2.7, 0.55);
  for (const c of cross) {
    const sFar = c.s + c.w / 2 + 2.2, i = clamp(Math.round(sFar / DS), 0, NR - 1), h = hw(i);
    const turnHere = route.names.some(nm => nm.s > 0 && Math.abs(nm.s - c.s) < 40);
    if (c.sig && !turnHere) {
      const fr = frame(sFar, 0, 0.22), px = -(h + 1.0), arm = h + 3.4;
      putCyl(propM, fr, 0.11, 0.16, 6.6, POLE, px, 3.3, 0, 7);
      putCyl(propM, fr, 0.07, 0.09, arm, POLE, px + arm / 2, 6.2, 0, 6, Math.PI / 2);
      for (const lx of [-LANE_W, 0.2, LANE_W + 0.4]) {
        putBox(propM, fr, 0.34, 1.0, 0.3, 0x1c1d1f, lx, 5.55, 0);
        putBox(litM, fr, 0.2, 0.2, 0.06, 0x2a0d0b, lx, 5.87, -0.16); putBox(litM, fr, 0.2, 0.2, 0.06, 0x2e2408, lx, 5.55, -0.16); putBox(litM, fr, 0.22, 0.22, 0.07, 0x4dffa1, lx, 5.23, -0.16);
      }
      const bl = new THREE.Mesh(bladeGeo, signTex(c.label)); route.at(sFar - 0.12, h - 3.0, o); bl.position.set(o.x, o.y + 6.72, o.z); bl.rotation.y = o.yaw + Math.PI; scene.add(bl);
      // the opposing signal's back, for depth
      const fr2 = frame(c.s - c.w / 2 - 2.2, 0, 0.22); putCyl(propM, fr2, 0.11, 0.16, 6.6, POLE, h + 1.0, 3.3, 0, 7); putCyl(propM, fr2, 0.07, 0.09, arm, POLE, h + 1.0 - arm / 2, 6.2, 0, 6, Math.PI / 2);
      for (const lx of [-LANE_W, 0.2]) putBox(propM, fr2, 0.34, 1.0, 0.3, 0x1c1d1f, lx, 5.55, 0);
    } else {
      const fr = frame(sFar, -(h + 0.8), 0.22); putCyl(propM, fr, 0.04, 0.04, 3.4, 0x7d8288, 0, 1.7, 0, 5);
      const bl = new THREE.Mesh(bladeGeo, signTex(c.label)); route.at(sFar - 0.08, h + 0.8, o); bl.scale.setScalar(0.62); bl.position.set(o.x, o.y + 3.5, o.z); bl.rotation.y = o.yaw + Math.PI; scene.add(bl);
    }
  }
  // real bus stops
  for (const st of city.stops) {
    const i = clamp(Math.round(st.s / DS), 0, NR - 1); if (inX[i] >= 0) continue;
    const side = st.d > 0 ? 1 : -1, fr = frame(st.s, side * (hw(i) + 2.4), 0.22);
    putBox(propM, fr, 0.08, 2.3, 3.4, 0x5b6f7a, side * -0.7, 1.15, 0); putBox(propM, fr, 1.5, 0.08, 3.6, 0x2e3438, 0, 2.35, 0);
    putBox(propM, fr, 0.08, 2.3, 0.08, 0x2e3438, side * 0.7, 1.15, 1.7); putBox(propM, fr, 0.08, 2.3, 0.08, 0x2e3438, side * 0.7, 1.15, -1.7);
    putCyl(propM, fr, 0.035, 0.035, 2.8, 0x7d8288, side * 1.2, 1.4, 2.6, 5); putBox(propM, fr, 0.05, 0.55, 0.45, 0x1f5fa8, side * 1.2, 2.6, 2.6);
  }
  // flagpoles
  for (let i = 0; i < city.flags.length; i += 2) { const x = city.flags[i] / 10, z = city.flags[i + 1] / 10, y = terrainY(x, z); propM.cyl(0.05, 0.08, 9, 0xbfc3c7, x, y + 4.5, z, 5); propM.box(1.5, 0.9, 0.03, i % 4 ? 0xb4302e : 0xe9e6dc, x + 0.8, y + 8.4, z, SUN_AZ); }

  // ---------------------------------------------------------------- the Short North arches (real positions)
  W.arches = [];
  {
    const bulbGeo = new THREE.SphereGeometry(0.13, 6, 5);
    for (const a of city.arches) {
      if (a.s < 0) continue;
      const i = clamp(Math.round(a.s / DS), 0, NR - 1), span = Math.max(a.w / 10, rw[i] + 3.2), half = span / 2, fr = frame(a.s, 0, 0.2);
      const curve = (lift, zo) => { const pts = []; for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push(new THREE.Vector3((t - 0.5) * span, 5.0 + lift + 2.7 * Math.sin(Math.PI * t), zo)); } return new THREE.CatmullRomCurve3(pts); };
      for (const [lift, zo] of [[0, 0.22], [0, -0.22], [0.55, 0]]) { const g = new THREE.TubeGeometry(curve(lift, zo), 26, 0.055, 5); propM.add(g, 0x26302c, fr); g.dispose(); }
      for (const sx of [-1, 1]) { putCyl(propM, fr, 0.13, 0.17, 5.3, 0x26302c, sx * half, 2.6, 0, 7); putBox(propM, fr, 0.5, 0.5, 0.5, 0x26302c, sx * half, 0.25, 0); }
      for (let k = 1; k < 16; k++) { const t = k / 16, x = (t - 0.5) * span, y = 5.0 + 2.7 * Math.sin(Math.PI * t); putBox(propM, fr, 0.05, 0.6, 0.05, 0x26302c, x, y + 0.28, 0); }
      const nB = 34, bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.32, 1.0) }), nB), M = new THREE.Matrix4();
      for (let k = 0; k < nB; k++) { const t = (k + 0.5) / nB; M.makeTranslation((t - 0.5) * span, 4.8 + 2.7 * Math.sin(Math.PI * t), 0).premultiply(fr); bulbs.setMatrixAt(k, M); }
      scene.add(bulbs);
      route.at(a.s, 0, o);
      W.arches.push({ s: a.s, mat: bulbs.material, x: o.x, y: o.y + 7.6, z: o.z, lit: false });
      for (const t of [0.2, 0.5, 0.8]) { route.at(a.s, (t - 0.5) * span, o); glowPts.push(o.x, o.y + 4.9 + 2.7 * Math.sin(Math.PI * t), o.z); }
    }
  }
  {
    const props = new THREE.Mesh(propM.build(), new THREE.MeshLambertMaterial({ vertexColors: true })); props.castShadow = true; props.receiveShadow = true; scene.add(props);
    scene.add(new THREE.Mesh(litM.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
    const gt = canvasTexture(64, 64, (ctx) => { const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,236,200,1)'); g.addColorStop(0.25, 'rgba(255,214,150,0.45)'); g.addColorStop(1, 'rgba(255,190,110,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); });
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
    const glow = new THREE.Points(gg, new THREE.PointsMaterial({ map: gt, size: 2.3, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 })); glow.frustumCulled = false; scene.add(glow);
  }
  await step('Hanging the arches');

  // ---------------------------------------------------------------- sky, sun, fog
  const HORIZON = new THREE.Color(0xe8c3a0), ZENITH = new THREE.Color(0x587fb6);
  scene.fog = new THREE.FogExp2(new THREE.Color(0xd9bba3), q.fog);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5200, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR }, uZenith: { value: ZENITH }, uHorizon: { value: HORIZON }, uWarm: { value: new THREE.Color(0xffc98a) }, uSunCol: { value: new THREE.Color(0xffd9a6) }, uCloud: { value: new THREE.Color(0xc9a9b4) }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 uSun, uZenith, uHorizon, uWarm, uSunCol, uCloud; uniform float uTime; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+7.1; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float h = max(d.y, 0.0);
        float sd = max(dot(d, uSun), 0.0);
        float a = dot(normalize(d.xz + 1e-5), normalize(uSun.xz)) * 0.5 + 0.5;
        vec3 hor = mix(uHorizon, uWarm, pow(a, 3.0));
        vec3 col = mix(hor, uZenith, smoothstep(0.0, 0.62, pow(h, 0.62)));
        col += uSunCol * (pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.5);
        vec2 cp = d.xz / (d.y + 0.16) * 1.15 + vec2(uTime * 0.004, 0.0);
        float c = fbm(cp * vec2(0.8, 1.9)); c = smoothstep(0.5, 0.82, c) * smoothstep(0.015, 0.2, d.y);
        vec3 ccol = mix(uCloud, uSunCol * 1.15, clamp(pow(sd, 2.5) * 0.9 + 0.12, 0.0, 1.0));
        col = mix(col, ccol, c * 0.8);
        col += uSunCol * smoothstep(0.9996, 0.99985, sd) * 5.0 * (1.0 - c) + uSunCol * pow(sd, 700.0) * 0.8;
        col = mix(col, hor * 0.92, smoothstep(0.0, -0.12, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xb4c8ee, 0x9a8672, 1.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc48c, 3.4); scene.add(sun); scene.add(sun.target);
  const SH = q.shadowRange;
  if (q.shadows) {
    sun.castShadow = true; sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    const c = sun.shadow.camera; c.left = -SH; c.right = SH; c.top = SH; c.bottom = -SH; c.near = 10; c.far = 1400; c.updateProjectionMatrix();
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.35;
  }
  W.sun = sun; W.hemi = hemi; W.sky = sky;
  const sR = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize(), sU = new THREE.Vector3().crossVectors(SUN_DIR, sR).normalize(), tmp = new THREE.Vector3();

  // ---------------------------------------------------------------- drifting leaves
  const NL = q.leaves, lp = new Float32Array(NL * 3), lc = new Float32Array(NL * 3), lv = new Float32Array(NL * 3), lr = rng(77), cc = new THREE.Color();
  for (let i = 0; i < NL; i++) { lp[i * 3] = (lr() - 0.5) * 70; lp[i * 3 + 1] = lr() * 16; lp[i * 3 + 2] = (lr() - 0.5) * 70; lv[i * 3] = 0.6 + lr(); lv[i * 3 + 1] = 0.5 + lr() * 0.9; lv[i * 3 + 2] = lr() * 6.28; cc.setHex(TREE_COL[[0, 1, 2, 2, 0, 3][(lr() * 6) | 0]]).offsetHSL(0, 0, 0.08); lc[i * 3] = cc.r; lc[i * 3 + 1] = cc.g; lc[i * 3 + 2] = cc.b; }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  const leaves = new THREE.Points(lg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, sizeAttenuation: true })); leaves.frustumCulled = false; scene.add(leaves);
  const lOrigin = new THREE.Vector3();

  W.update = (dt, time, focus, camera) => {
    sky.position.copy(camera.position); sky.material.uniforms.uTime.value = time;
    // texel-snapped shadow frustum that follows the action
    if (q.shadows) {
      const tex = (2 * SH) / q.shadowMap, a = Math.round(focus.dot(sR) / tex) * tex, b = Math.round(focus.dot(sU) / tex) * tex, c = focus.dot(SUN_DIR);
      tmp.copy(sR).multiplyScalar(a).addScaledVector(sU, b).addScaledVector(SUN_DIR, c);
      sun.target.position.copy(tmp); sun.position.copy(tmp).addScaledVector(SUN_DIR, 600);
    } else { sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(SUN_DIR, 600); }
    for (const m of W.waterMats) { m.normalMap.offset.set(time * 0.012, time * 0.02); }
    // leaves wrap around the camera
    lOrigin.copy(camera.position);
    for (let i = 0; i < NL; i++) {
      const k = i * 3; lv[k + 2] += dt * 2;
      lp[k] += (Math.sin(lv[k + 2]) * 0.8 - 1.4 * lv[k]) * dt; lp[k + 1] -= lv[k + 1] * dt; lp[k + 2] += (Math.cos(lv[k + 2] * 0.7) * 0.8 + 0.5) * dt;
      if (lp[k] - lOrigin.x > 35) lp[k] -= 70; else if (lp[k] - lOrigin.x < -35) lp[k] += 70;
      if (lp[k + 2] - lOrigin.z > 35) lp[k + 2] -= 70; else if (lp[k + 2] - lOrigin.z < -35) lp[k + 2] += 70;
      if (lp[k + 1] < lOrigin.y - 6) lp[k + 1] += 18; else if (lp[k + 1] > lOrigin.y + 12) lp[k + 1] -= 18;
    }
    lg.attributes.position.needsUpdate = true;
  };
  return W;
}

// ---------------------------------------------------------------------------
function styleFor(b, r, area, col, rcol) {
  const pick = a => a[(r() * a.length) | 0], h = b.h / 10;
  let kind = 1, fh = 3.4, bw = 3.2, pal = PAL.brick, roof = PAL.roofFlat;
  switch (b.t) {
    case 0: kind = 5; fh = 3.0; bw = 3.4; pal = r() < 0.36 ? PAL.brick : PAL.siding; roof = PAL.roofHouse; break;
    case 1: kind = 1; fh = 3.2; bw = 3.0; pal = r() < 0.7 ? PAL.brick : PAL.paint; break;
    case 2: kind = 2; fh = 3.8; bw = 3.3; pal = r() < 0.62 ? PAL.brick : PAL.paint; break;
    case 3: { const t = r(); if (h > 34 && t < 0.45) { kind = 3; pal = PAL.glass; fh = 3.9; bw = 1.6; } else if (t < 0.7) { kind = 4; pal = r() < 0.5 ? PAL.concrete : PAL.stone; fh = 3.8; bw = 4.5; } else { kind = 2; pal = PAL.brick; fh = 3.8; } break; }
    case 4: if (r() < 0.6) { kind = 3; pal = PAL.glass; fh = 3.9; bw = 1.5; } else { kind = 1; pal = PAL.stone; fh = 3.9; bw = 2.6; } break;
    case 5: kind = 7; fh = 5; bw = 5; pal = r() < 0.5 ? PAL.metal : PAL.brick; break;
    case 6: kind = 0; pal = PAL.siding; roof = PAL.roofHouse; break;
    case 7: kind = 6; fh = 3.2; bw = 8; pal = PAL.concrete; break;
    case 8: kind = 8; fh = 4.6; bw = 3.6; pal = r() < 0.75 ? PAL.stone : PAL.brick; break;
  }
  col.setHex(pick(pal)).offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.06, (r() - 0.5) * 0.06);
  if (b.c) { try { col.set(b.c); if (kind === 3) { kind = 1; fh = 3.9; bw = 2.6; } } catch { /* keep palette colour */ } }
  if (b.mt === 'glass') { kind = 3; fh = 3.9; bw = 1.5; col.setHex(pick(PAL.glass)); if (b.c) { try { col.set(b.c).multiplyScalar(0.55); } catch { /* */ } } }
  rcol.setHex(pick(roof)).offsetHSL(0, 0, (r() - 0.5) * 0.05);
  if (area > 1500 && b.t !== 0 && r() < 0.35) rcol.setHex(0xb9b6ae);
  return { kind, fh, bw };
}

function makeFacadeMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWall; attribute vec4 aStyle; varying vec4 vWall; varying vec4 vStyle;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall; vStyle = aStyle;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vWall; varying vec4 vStyle;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float rectMask(vec2 f, vec2 lo, vec2 hi, vec2 aa){ vec2 a = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f)); return a.x * a.y; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float kind = floor(vStyle.z + 0.5), fh = vStyle.x, seed = vStyle.w, Ht = vWall.z, Lw = vWall.w, v = vWall.y;
          // weathering / masonry grain
          float grain = h21(floor(vec2(vWall.x * 3.0, v * 9.0)) + seed);
          diffuseColor.rgb *= 0.94 + 0.1 * grain;
          if (kind > 0.5) {
            float gf = (kind == 2.0) ? 4.4 : fh;                           // ground-floor height
            float bays = max(1.0, floor(Lw / vStyle.y + 0.5));
            float cx = vWall.x / Lw * bays;
            float fl = v < gf ? 0.0 : 1.0 + floor((v - gf) / fh);
            float fy = v < gf ? v / gf : fract((v - gf) / fh);
            float flTop = v < gf ? gf : gf + fl * fh;
            vec2 id = vec2(floor(cx), fl), f = vec2(fract(cx), fy);
            vec2 aa = vec2(fwidth(cx), fwidth(v) / fh) * 0.75 + 1e-4;
            float rnd = h21(id + seed), rnd2 = h21(id * 1.7 + seed + 3.1);
            vec2 lo = vec2(0.22, 0.24), hi = vec2(0.78, 0.82); float lit = 0.16, glassy = 1.0;
            if (kind == 2.0) { if (fl < 0.5) { lo = vec2(0.06, 0.1); hi = vec2(0.94, 0.72); lit = 0.72; } }
            else if (kind == 3.0) { lo = vec2(0.07, 0.2); hi = vec2(0.96, 0.98); lit = 0.2; }
            else if (kind == 4.0) { lo = vec2(0.03, 0.34); hi = vec2(0.97, 0.8); lit = 0.24; }
            else if (kind == 5.0) { lo = vec2(0.3, 0.3); hi = vec2(0.7, 0.8); lit = rnd2 < 0.55 ? 0.3 : -1.0; }
            else if (kind == 6.0) { lo = vec2(-1.0, 0.5); hi = vec2(2.0, 0.92); glassy = 0.0; }
            else if (kind == 7.0) { lo = vec2(0.2, 0.6); hi = vec2(0.8, 0.86); lit = rnd2 < 0.5 ? 0.1 : -1.0; }
            else if (kind == 8.0) { lo = vec2(0.3, 0.14); hi = vec2(0.7, 0.86); lit = 0.3; }
            float m = rectMask(f, lo, hi, aa);
            m *= step(0.0, v) * step(flTop, Ht - 0.55) * step(0.0, lit + 0.5);
            float fade = clamp(1.25 - max(aa.x, aa.y) * 3.2, 0.0, 1.0);        // dissolve the grid far away
            // cornice + sign band
            float cap = smoothstep(Ht - 0.75, Ht - 0.6, v);
            diffuseColor.rgb *= mix(1.0, 0.8, cap * step(1.5, kind) * step(kind, 2.5) + cap * step(7.5, kind));
            if (kind == 2.0 && fl < 0.5) { float band = step(0.8, fy) * step(fy, 0.97); vec3 bc = 0.25 + 0.55 * vec3(h21(vec2(seed, 1.0)), h21(vec2(seed, 2.0)) * 0.7, h21(vec2(seed, 3.0)) * 0.6); diffuseColor.rgb = mix(diffuseColor.rgb, bc, band * 0.85); }
            if (kind == 6.0) { diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.05, 0.06), m * fade); }
            else {
              vec3 Vv = normalize(vViewPosition);
              vec3 sunV = directionalLights[0].direction;
              float facing = max(dot(normal, sunV), 0.0);
              float glint = pow(max(dot(reflect(-Vv, normal), sunV), 0.0), 26.0);
              vec3 cool = vec3(0.13, 0.18, 0.27), warm = vec3(0.95, 0.5, 0.2);
              vec3 refl = mix(cool, warm * 0.42, smoothstep(0.0, 0.8, facing)) * (0.45 + 0.55 * rnd) + warm * glint * (0.5 + 0.7 * rnd);
              float on = step(rnd, lit);
              vec3 room = mix(vec3(1.0, 0.66, 0.3), vec3(1.0, 0.8, 0.55), rnd2) * (0.35 + 0.45 * rnd2) * on;
              // mullion cross inside each pane
              float mull = 1.0 - 0.35 * step(abs(f.x - 0.5 * (lo.x + hi.x)), 0.012 + aa.x) * step(kind, 2.5);
              float w = m * fade * glassy;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.075, 0.09), w);
              totalEmissiveRadiance += (refl + room) * w * mull;
              // far away, keep a hint of the lit rooms so towers still sparkle
              totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * (1.0 - fade) * lit * 0.12 * m * glassy;
            }
          }
        }`);
  };
  return mat;
}

// North-up overview map (for the minimap / route card): 1 px = scale metres
export function drawMap(city, scale) {
  const T = city.terrain, w = Math.round(-2 * T.x0 / scale), h = Math.round(-2 * T.z0 / scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
  ctx.fillStyle = '#23262b'; ctx.fillRect(0, 0, w, h);
  ctx.setTransform(0.1 / scale, 0, 0, 0.1 / scale, w / 2, h / 2); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const poly = r => { ctx.beginPath(); ctx.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]); ctx.closePath(); };
  const line = p => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); };
  ctx.fillStyle = '#2c3a2c'; for (const cv of city.cover) if (cv.k <= 2) { poly(cv.r); ctx.fill(); }
  ctx.fillStyle = '#24465a'; for (const wt of city.water) { poly(wt.r); ctx.fill(); }
  ctx.fillStyle = '#30343b'; for (const b of city.buildings) if (!b.m) { poly(b.r); ctx.fill(); }
  ctx.strokeStyle = '#4b505a'; for (const r of city.roads) { ctx.lineWidth = Math.max(r.w, 45); line(r.p); ctx.stroke(); }
  ctx.strokeStyle = '#5d6370'; for (const r of city.roads) if (r.k <= 2) { ctx.lineWidth = Math.max(r.w, 70); line(r.p); ctx.stroke(); }
  const rp = city.route.p; ctx.strokeStyle = '#ff8a3c'; ctx.lineWidth = 130; ctx.beginPath(); for (let i = 0; i < rp.length; i += 3) { if (i) ctx.lineTo(rp[i], rp[i + 1]); else ctx.moveTo(rp[i], rp[i + 1]); } ctx.stroke();
  return c;
}
