// Low-poly models: the skater, traffic, construction clutter, buckeyes.
// Local frame for everything here: +z forward, +y up, +x = left.
import * as THREE from 'three';
import { Mesher, canvasTexture } from './util.js';

const lambert = () => new THREE.MeshLambertMaterial({ vertexColors: true });
const basic = () => new THREE.MeshBasicMaterial({ vertexColors: true });
const ORANGE = 0xf26a1b, WHITE = 0xecebe4, DARK = 0x1d1f22;

// ------------------------------------------------------------------ vehicles
function taperBox(w, h, d, taper) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setZ(i, p.getZ(i) * taper + (taper < 1 ? -0.12 : 0)); p.setX(i, p.getX(i) * 0.9); }
  g.computeVertexNormals(); return g;
}
function carGeos(len, wid, ht) {
  const body = new Mesher(), det = new Mesher(), lit = new Mesher(), cabH = ht - 0.92;
  body.box(wid, 0.62, len, 0xffffff, 0, 0.6, 0);
  body.box(wid * 0.82, 0.07, len * 0.4, 0xffffff, 0, 0.92 + cabH + 0.02, -len * 0.06);
  det.add(taperBox(wid * 0.93, cabH, len * 0.56, 0.74), 0x1c2630, new THREE.Matrix4().makeTranslation(0, 0.92 + cabH / 2, -len * 0.04));
  det.box(wid * 0.98, 0.14, len * 1.01, 0x24262a, 0, 0.32, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) det.cyl(0.33, 0.33, 0.24, 0x131416, sx * (wid / 2 - 0.1), 0.33, sz * len * 0.31, 10, 0, Math.PI / 2);
  for (const sx of [-1, 1]) { lit.box(0.34, 0.16, 0.06, 0xfff0c8, sx * (wid / 2 - 0.3), 0.7, len / 2 + 0.01); lit.box(0.36, 0.14, 0.06, 0xff2a1a, sx * (wid / 2 - 0.3), 0.74, -len / 2 - 0.01); }
  return { body: body.build(), det: det.build(), lit: lit.build() };
}
function busGeos() {
  const L = 12, Wd = 2.55, Ht = 3.1, body = new Mesher(), det = new Mesher(), lit = new Mesher();
  body.box(Wd, Ht - 0.45, L, 0xffffff, 0, 0.45 + (Ht - 0.45) / 2, 0);
  det.box(Wd + 0.02, 0.95, L - 1.4, 0x1a222b, 0, 2.05, -0.2);              // window band
  det.box(Wd + 0.03, 0.22, L + 0.02, 0x1f6fb5, 0, 1.25, 0);                 // stripe
  det.box(Wd + 0.03, 0.1, L + 0.02, 0x9fc93c, 0, 1.06, 0);
  det.box(Wd - 0.2, 1.25, 0.06, 0x1a222b, 0, 2.0, L / 2 + 0.01);            // windscreen
  det.box(Wd - 0.3, 0.9, 0.06, 0x1a222b, 0, 2.2, -L / 2 - 0.01);
  det.box(Wd, 0.3, L, 0x26282c, 0, 0.42, 0);
  for (const sx of [-1, 1]) for (const z of [3.9, -2.6, -3.9]) det.cyl(0.48, 0.48, 0.3, 0x131416, sx * (Wd / 2 - 0.12), 0.48, z, 10, 0, Math.PI / 2);
  for (const sx of [-1, 1]) { lit.box(0.3, 0.2, 0.06, 0xfff0c8, sx * 0.9, 0.85, L / 2 + 0.02); lit.box(0.28, 0.3, 0.06, 0xff2a1a, sx * 1.0, 1.0, -L / 2 - 0.02); }
  lit.box(1.5, 0.3, 0.06, 0xffa51f, 0, 2.86, L / 2 + 0.02); lit.box(1.2, 0.26, 0.06, 0xffa51f, 0, 2.86, -L / 2 - 0.02);
  return { body: body.build(), det: det.build(), lit: lit.build() };
}
export const CAR_COLORS = [0xd9dadc, 0x2a2d33, 0x8f9499, 0xb1262b, 0x23466e, 0xe8e6df, 0x5a6b4d, 0x1a1b1d, 0xc7b79a, 0x7a1f22, 0x3f6f8f];
export function makeVehicleKit() {
  const matDet = lambert(), matLit = basic();
  const kinds = { sedan: { ...carGeos(4.5, 1.85, 1.45), len: 4.5, wid: 1.85, ht: 1.45 }, suv: { ...carGeos(4.8, 1.95, 1.78), len: 4.8, wid: 1.95, ht: 1.78 }, bus: { ...busGeos(), len: 12, wid: 2.55, ht: 3.1 } };
  const make = (kind, color) => {
    const k = kinds[kind], g = new THREE.Group();
    const b = new THREE.Mesh(k.body, new THREE.MeshLambertMaterial({ color })); b.castShadow = true; g.add(b);
    const d = new THREE.Mesh(k.det, matDet); d.castShadow = true; g.add(d);
    g.add(new THREE.Mesh(k.lit, matLit));
    g.userData = { len: k.len, wid: k.wid, ht: k.ht, kind };
    return g;
  };
  return { kinds, make, matDet, matLit };
}

// ------------------------------------------------------------------ construction clutter
export function makeClutterKit() {
  const mat = lambert(), geos = {};
  { // a row of three barrels across one lane
    const m = new Mesher();
    for (const x of [-0.95, 0, 0.95]) {
      const seg = [[0.0, 0.1, 0x18191b, 0.36], [0.1, 0.38, ORANGE, 0.3], [0.38, 0.52, WHITE, 0.29], [0.52, 0.7, ORANGE, 0.28], [0.7, 0.84, WHITE, 0.27], [0.84, 1.02, ORANGE, 0.26]];
      for (const [a, b, c, r] of seg) m.cyl(r - 0.01, r, b - a, c, x, (a + b) / 2, 0, 10);
    }
    geos.barrels = m.build();
  }
  { // type-II barricade
    const m = new Mesher();
    for (const x of [-1.1, 1.1]) { m.box(0.07, 1.1, 0.07, 0xd8d8d2, x, 0.55, 0.22, 0, 0.18); m.box(0.07, 1.1, 0.07, 0xd8d8d2, x, 0.55, -0.22, 0, -0.18); }
    for (const y of [0.55, 0.92]) for (let k = 0; k < 8; k++) m.box(0.31, 0.24, 0.05, k % 2 ? WHITE : ORANGE, -1.09 + k * 0.31, y, 0.12 + (0.92 - y) * 0.3);
    m.box(0.16, 0.16, 0.12, 0xffb020, -0.9, 1.16, 0.1); m.box(0.16, 0.16, 0.12, 0xffb020, 0.9, 1.16, 0.1);
    geos.barricade = m.build();
  }
  { // low clearance bar (duck)
    const m = new Mesher();
    for (const x of [-1.5, 1.5]) { m.box(0.14, 1.95, 0.14, ORANGE, x, 0.975, 0); m.box(0.6, 0.12, 0.6, DARK, x, 0.06, 0); }
    for (let k = 0; k < 10; k++) m.box(0.3, 0.34, 0.16, k % 2 ? 0x1b1b1c : 0xf2c21a, -1.35 + k * 0.3, 1.56, 0);
    geos.bar = m.build();
  }
  { // arrow board trailer body (the arrow face is a separate plane)
    const m = new Mesher();
    m.box(1.7, 0.3, 2.2, 0xe08a1c, 0, 0.55, 0); m.box(0.12, 1.5, 0.12, 0x44474b, 0, 1.4, 0);
    m.box(2.5, 1.35, 0.14, 0x141516, 0, 2.6, 0);
    for (const x of [-0.95, 0.95]) m.cyl(0.32, 0.32, 0.2, 0x131416, x, 0.32, -0.2, 10, 0, Math.PI / 2);
    m.box(0.08, 0.5, 0.08, 0x44474b, 0, 0.25, 1.0);
    geos.arrow = m.build();
  }
  { // kicker ramp
    const m = new Mesher(), w = 1.25, L = 2.8, h = 0.85, ply = 0xc8a060, side = 0x8a6c3c;
    m.quad([-w, 0, -L / 2], [w, 0, -L / 2], [w, h, L / 2], [-w, h, L / 2], ply);
    m.tri(w, 0, -L / 2, w, 0, L / 2, w, h, L / 2, side); m.tri(-w, 0, -L / 2, -w, h, L / 2, -w, 0, L / 2, side);
    m.quad([-w, h, L / 2], [w, h, L / 2], [w, 0, L / 2], [-w, 0, L / 2], side);
    for (const z of [-0.6, 0.2]) { const y = (z + L / 2) / L * h + 0.02; m.tri(0, y + 0.2, z + 0.65, -0.55, y, z, 0.55, y, z, 0xf2c21a); }
    geos.ramp = m.build();
  }
  const arrowTex = dir => canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#101112'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffb21e'; ctx.shadowColor = '#ff9a00'; ctx.shadowBlur = 8;
    const dot = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.3); ctx.fill(); };
    for (let k = 0; k < 7; k++) dot(48 + k * 27, 64);
    const tip = dir > 0 ? 48 : 210, s = dir > 0 ? 1 : -1; for (let k = 1; k <= 2; k++) { dot(tip + s * k * 22, 64 - k * 20); dot(tip + s * k * 22, 64 + k * 20); }
  });
  // arrow pointing to the player's left (+x) and right (-x); the face looks back up the road (-z)
  const arrowMats = { L: new THREE.MeshBasicMaterial({ map: arrowTex(1) }), R: new THREE.MeshBasicMaterial({ map: arrowTex(-1) }) };
  const faceGeo = new THREE.PlaneGeometry(2.4, 1.2);
  const make = (type, opt) => {
    const mesh = new THREE.Mesh(geos[type], mat); mesh.castShadow = true;
    if (type !== 'arrow') return mesh;
    const g = new THREE.Group(); g.add(mesh);
    const face = new THREE.Mesh(faceGeo, arrowMats[opt]); face.position.set(0, 2.6, -0.08); face.rotation.y = Math.PI; g.add(face); g.userData.face = face;
    return g;
  };
  return { make, geos, mat };
}

export function buckeyeGeo() {
  const g = new THREE.IcosahedronGeometry(0.3, 2), p = g.attributes.position, col = new Float32Array(p.count * 3), a = new THREE.Color(0x6b3216), b = new THREE.Color(0xe2c08e), eye = new THREE.Vector3(0, 0.25, -0.97).normalize(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); const c = v.dot(eye) > 0.74 ? b : a; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}

// ------------------------------------------------------------------ the skater
export function makeSkater() {
  const root = new THREE.Group(), lean = new THREE.Group(), boardG = new THREE.Group(), body = new THREE.Group();
  root.add(lean); lean.add(boardG); lean.add(body);
  const mat = lambert(), mesh = m => { const o = new THREE.Mesh(m.build(), mat); o.castShadow = true; return o; };
  // board
  { const m = new Mesher(); m.box(0.26, 0.035, 1.02, 0xc9a064, 0, 0.115, 0); m.box(0.24, 0.02, 0.2, 0xc9a064, 0, 0.14, 0.56, 0, -0.35); m.box(0.24, 0.02, 0.2, 0xc9a064, 0, 0.14, -0.56, 0, 0.35); m.box(0.262, 0.012, 1.0, 0xb3202c, 0, 0.094, 0);
    for (const z of [-0.36, 0.36]) { m.box(0.2, 0.04, 0.06, 0x9aa0a6, 0, 0.07, z); for (const x of [-0.13, 0.13]) m.cyl(0.05, 0.05, 0.05, 0xe8843a, x, 0.05, z, 8, 0, Math.PI / 2); }
    boardG.add(mesh(m)); }
  // stance: body turned so the chest faces +x (left); head looks down the road
  const HOOD = 0x8d939b, PANTS = 0x2b2e35, SKIN = 0xd9a47c, RED = 0xb3202c, SHOE = 0xeeeeea;
  const hips = new THREE.Group(); hips.position.y = 0.92; body.add(hips);
  const part = (w, h, d, c, x, y, z) => { const m = new Mesher(); m.box(w, h, d, c, x, y, z); return mesh(m); };
  const legF = new THREE.Group(), legB = new THREE.Group(); legF.position.set(0, 0, 0.2); legB.position.set(0, 0, -0.2); hips.add(legF, legB);
  for (const L of [legF, legB]) { const thigh = new THREE.Group(), shin = new THREE.Group(); thigh.add(part(0.15, 0.42, 0.17, PANTS, 0, -0.21, 0)); shin.position.y = -0.4; shin.add(part(0.13, 0.4, 0.15, PANTS, 0, -0.2, 0)); shin.add(part(0.24, 0.09, 0.14, SHOE, 0.04, -0.4, 0)); thigh.add(shin); L.add(thigh); L.userData = { thigh, shin }; }
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(part(0.24, 0.5, 0.4, HOOD, 0, 0.29, 0)); torso.add(part(0.25, 0.14, 0.41, PANTS, 0, 0.02, 0)); torso.add(part(0.1, 0.24, 0.3, 0x7d838b, -0.15, 0.36, 0));
  const head = new THREE.Group(); head.position.y = 0.66; torso.add(head);
  { const m = new Mesher(); m.sphere(0.135, SKIN, 0, 0, 0, 1, 1.08, 1, 1); m.sphere(0.155, RED, 0, 0.035, 0, 1, 0.82, 1.06, 1); m.box(0.22, 0.03, 0.1, RED, 0, 0.02, 0.15); head.add(mesh(m)); }
  const armF = new THREE.Group(), armB = new THREE.Group(); armF.position.set(0, 0.5, 0.24); armB.position.set(0, 0.5, -0.24); torso.add(armF, armB);
  for (const A of [armF, armB]) { A.add(part(0.11, 0.5, 0.12, HOOD, 0, -0.24, 0)); A.add(part(0.09, 0.09, 0.09, SKIN, 0, -0.52, 0)); }
  // scarf tail
  const scarf = []; let prev = torso;
  for (let k = 0; k < 4; k++) { const s = new THREE.Group(); s.position.set(k ? 0 : -0.06, k ? 0 : 0.56, k ? -0.2 : -0.12); s.add(part(0.05, 0.1 - k * 0.012, 0.22, RED, 0, 0, -0.1)); prev.add(s); prev = s; scarf.push(s); }
  torso.add(part(0.27, 0.09, 0.43, RED, 0, 0.56, 0));
  const S = { root, lean, boardG, body, hips, torso, head, legF, legB, armF, armB, scarf, t: 0 };
  // pose(dt, p): p = { crouch 0..1, air 0..1, lean (rad), grind 0..1, bail 0..1, speed 0..1, push 0..1, cheer 0..1 }
  S.pose = (dt, p) => {
    S.t += dt; const t = S.t, cr = Math.max(p.crouch, p.air * 0.55), wob = Math.sin(t * 7) * 0.02;
    hips.position.y = 0.92 - cr * 0.36 + wob * 0.3;
    for (const L of [legF, legB]) { const s = L === legF ? 1 : -1; L.userData.thigh.rotation.z = 0.25 + cr * 0.95; L.userData.shin.rotation.z = -(0.5 + cr * 1.75); L.userData.thigh.rotation.x = s * (0.12 + cr * 0.1); }
    torso.rotation.z = -(0.18 + cr * 0.55) + p.cheer * 0.2; torso.rotation.y = -0.5 + p.cheer * 0.5; torso.rotation.x = wob;
    head.rotation.y = 0.5 - p.cheer * 0.5; head.rotation.z = (0.18 + cr * 0.4) * 0.8;
    const up = p.air * 1.5 + p.grind * 0.9 + p.cheer * 2.6;
    armF.rotation.x = -(0.5 + up * 0.75) + Math.sin(t * 5) * 0.05; armB.rotation.x = 0.5 + up * 0.75 + Math.cos(t * 5) * 0.05; armF.rotation.z = armB.rotation.z = 0.25 + cr * 0.3;
    lean.rotation.z = p.lean; lean.rotation.x = -p.air * 0.1;
    boardG.rotation.y = p.grind * Math.PI / 2; boardG.rotation.x = -p.pop * 0.5; boardG.rotation.z = p.flip * Math.PI * 2;
    body.rotation.y = p.grind * 0.35; body.rotation.x = p.bail * Math.PI * 2;
    const fl = 0.25 + p.speed * 0.9;
    scarf.forEach((s, k) => { s.rotation.x = -0.25 * fl + Math.sin(t * 11 + k * 1.1) * 0.22 * fl; s.rotation.y = Math.sin(t * 8 + k) * 0.25 * fl; });
  };
  return S;
}
