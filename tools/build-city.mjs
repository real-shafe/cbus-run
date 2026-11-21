// Fuses OpenStreetMap + FEMA USA Structures (lidar heights) + USGS 3DEP terrain
// into public/data/city.json for the game. Run: node tools/build-city.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const C = p => path.join(here, 'cache', p);

// ---------- projection (local tangent plane, metres; x = east, z = south) ----------
const LAT0 = 39.972, LON0 = -83.003, Y0 = 225;
const ph = LAT0 * Math.PI / 180;
const MLAT = 111132.92 - 559.82 * Math.cos(2 * ph) + 1.175 * Math.cos(4 * ph);
const MLON = 111412.84 * Math.cos(ph) - 93.5 * Math.cos(3 * ph);
const X = lon => (lon - LON0) * MLON, Z = lat => -(lat - LAT0) * MLAT;
const HALF_X = 1250, HALF_Z = 2250;           // world half-extents (terrain grid)

// ---------- terrain (USGS 3DEP GeoTIFF, uncompressed float32 tiles) ----------
function loadDem() {
  const b = fs.readFileSync(C('dem.tif'));
  const r16 = o => b.readUInt16LE(o), r32 = o => b.readUInt32LE(o);
  const ifd = r32(4), n = r16(ifd), tag = {};
  for (let i = 0; i < n; i++) { const o = ifd + 2 + i * 12; tag[r16(o)] = { type: r16(o + 2), cnt: r32(o + 4), vo: o + 8 }; }
  const val = t => (tag[t].type === 3 ? r16(tag[t].vo) : r32(tag[t].vo));
  const arr = t => { const e = tag[t], out = [], off = e.cnt > 1 ? r32(e.vo) : e.vo; for (let k = 0; k < e.cnt; k++) out.push(e.type === 3 ? r16(off + k * 2) : r32(off + k * 4)); return out; };
  const dbl = t => { const e = tag[t], off = r32(e.vo), out = []; for (let k = 0; k < e.cnt; k++) out.push(b.readDoubleLE(off + k * 8)); return out; };
  const W = val(256), H = val(257), tw = val(322), th = val(323), offs = arr(324);
  if (val(259) !== 1 || val(258) !== 32) throw new Error('unexpected DEM encoding');
  const scale = dbl(33550), tie = dbl(33922);
  const grid = new Float32Array(W * H), across = Math.ceil(W / tw);
  offs.forEach((off, ti) => {
    const tx = ti % across, ty = Math.floor(ti / across);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const gx = tx * tw + x, gy = ty * th + y;
      if (gx < W && gy < H) grid[gy * W + gx] = b.readFloatLE(off + (y * tw + x) * 4);
    }
  });
  return { W, H, grid, lonW: tie[3], latN: tie[4], sx: scale[0], sy: scale[1] };
}
const dem = loadDem();
function demXZ(x, z) {
  const lon = LON0 + x / MLON, lat = LAT0 - z / MLAT;
  let fx = (lon - dem.lonW) / dem.sx - 0.5, fy = (dem.latN - lat) / dem.sy - 0.5;
  fx = Math.max(0, Math.min(dem.W - 1.001, fx)); fy = Math.max(0, Math.min(dem.H - 1.001, fy));
  const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy, g = dem.grid, W = dem.W;
  const v = g[iy * W + ix] * (1 - ax) * (1 - ay) + g[iy * W + ix + 1] * ax * (1 - ay) + g[(iy + 1) * W + ix] * (1 - ax) * ay + g[(iy + 1) * W + ix + 1] * ax * ay;
  return v - Y0;
}

// ---------- OSM ----------
const osm = JSON.parse(fs.readFileSync(C('osm.json')));
const nodes = new Map(), ways = [], rels = [], wayById = new Map();
for (const e of osm.elements) {
  if (e.type === 'node') { const old = nodes.get(e.id); nodes.set(e.id, { id: e.id, x: X(e.lon), z: Z(e.lat), tags: e.tags || old?.tags }); }
  else if (e.type === 'way') { e.tags = e.tags || {}; ways.push(e); wayById.set(e.id, e); }
  else if (e.type === 'relation') rels.push(e);
}
const wpts = w => w.nodes.map(id => nodes.get(id)).filter(Boolean);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inWorld = (p, pad = 0) => Math.abs(p.x) <= HALF_X + pad && Math.abs(p.z) <= HALF_Z + pad;
const parseLen = s => { if (s == null) return NaN; const v = parseFloat(s); if (!isFinite(v)) return NaN; return /ft|'|feet/.test(String(s)) ? v * 0.3048 : v; };
const q = v => Math.round(v * 10);   // decimetre quantisation

// ---------- route: N High St (Short North) -> W Broad St -> COSI ----------
const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const ROUTE_NAMES = new Set(['North High Street', 'West Broad Street']);
const adj = new Map();
const addEdge = (a, b, w) => { if (!adj.has(a.id)) adj.set(a.id, []); adj.get(a.id).push({ to: b.id, d: dist(a, b), way: w }); };
for (const w of ways) {
  if (!DRIVE.has(w.tags.highway) || !ROUTE_NAMES.has(w.tags.name)) continue;
  const p = wpts(w);
  for (let i = 0; i + 1 < p.length; i++) {
    if (w.tags.oneway !== '-1') addEdge(p[i], p[i + 1], w);
    if (w.tags.oneway !== 'yes') addEdge(p[i + 1], p[i], w);
  }
}
function nearestGraphNode(lat, lon, name) {
  const t = { x: X(lon), z: Z(lat) }; let best = null, bd = 1e9;
  for (const [id, es] of adj) { if (name && !es.some(e => e.way.tags.name === name)) continue; const d = dist(nodes.get(id), t); if (d < bd) { bd = d; best = id; } }
  return best;
}
const startId = nearestGraphNode(39.98985, -83.00606, 'North High Street');
const endId = nearestGraphNode(39.9615, -83.0094, 'West Broad Street');
function dijkstra(src, dst) {
  const D = new Map([[src, 0]]), prev = new Map(), done = new Set();
  for (;;) {
    let u = null, ud = Infinity;
    for (const [k, v] of D) if (!done.has(k) && v < ud) { ud = v; u = k; }
    if (u == null) throw new Error('route not connected');
    if (u === dst) break;
    done.add(u);
    for (const e of adj.get(u) || []) { const nd = ud + e.d; if (nd < (D.get(e.to) ?? Infinity)) { D.set(e.to, nd); prev.set(e.to, { from: u, way: e.way }); } }
  }
  const out = []; let c = dst;
  while (c !== src) { const p = prev.get(c); out.push({ id: c, way: p.way }); c = p.from; }
  out.push({ id: src, way: out[out.length - 1].way });
  return out.reverse();
}
const pathNodes = dijkstra(startId, endId).map(n => ({ ...nodes.get(n.id), way: n.way }));

// simplify (Douglas-Peucker), round the corners, resample every 2 m
function simplify(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const rec = (a, b) => {
    let md = 0, mi = -1; const ax = pts[a].x, az = pts[a].z, dx = pts[b].x - ax, dz = pts[b].z - az, L = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i].x - ax) * dz - (pts[i].z - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; rec(a, mi); rec(mi, b); }
  };
  rec(0, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
}
function fillet(pts, R) {
  const out = [pts[0]];
  for (let i = 1; i + 1 < pts.length; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    let v1x = p.x - a.x, v1z = p.z - a.z, v2x = b.x - p.x, v2z = b.z - p.z;
    const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z); v1x /= l1; v1z /= l1; v2x /= l2; v2z /= l2;
    const dot = Math.max(-1, Math.min(1, v1x * v2x + v1z * v2z)), th = Math.acos(dot);
    if (th < 0.02) { out.push(p); continue; }
    let t = R * Math.tan(th / 2); t = Math.min(t, 0.45 * l1, 0.45 * l2);
    const r = t / Math.tan(th / 2), sgn = Math.sign(v1x * v2z - v1z * v2x);
    const A = { x: p.x - v1x * t, z: p.z - v1z * t };
    const cx = A.x - v1z * r * sgn, cz = A.z + v1x * r * sgn;
    const a0 = Math.atan2(A.z - cz, A.x - cx), steps = Math.max(2, Math.ceil(r * th / 1.2));
    for (let k = 0; k <= steps; k++) { const ang = a0 + sgn * th * k / steps; out.push({ x: cx + r * Math.cos(ang), z: cz + r * Math.sin(ang) }); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function resample(pts, ds) {
  const out = [{ x: pts[0].x, z: pts[0].z }]; let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = dist(a, b); let t = ds - carry;
    while (t <= L) { out.push({ x: a.x + (b.x - a.x) * t / L, z: a.z + (b.z - a.z) * t / L }); t += ds; }
    carry = L - (t - ds);
  }
  return out;
}
const DS = 2;
let R = resample(fillet(simplify(pathNodes, 0.7), 17), DS);
for (let pass = 0; pass < 3; pass++) {   // light smoothing of digitising kinks
  const c = R.map(p => ({ ...p }));
  for (let i = 2; i < R.length - 2; i++) { c[i].x = (R[i - 2].x + R[i - 1].x * 2 + R[i].x * 3 + R[i + 1].x * 2 + R[i + 2].x) / 9; c[i].z = (R[i - 2].z + R[i - 1].z * 2 + R[i].z * 3 + R[i + 1].z * 2 + R[i + 2].z) / 9; }
  R = c;
}
const NR = R.length, ROUTE_LEN = (NR - 1) * DS;
// tangent per sample
for (let i = 0; i < NR; i++) { const a = R[Math.max(0, i - 1)], b = R[Math.min(NR - 1, i + 1)], L = dist(a, b); R[i].tx = (b.x - a.x) / L; R[i].tz = (b.z - a.z) / L; }
// nearest route sample + signed lateral offset (d > 0 = right-hand side when travelling)
const RB = 40, rIndex = new Map();
R.forEach((p, i) => { const k = Math.floor(p.x / RB) + ',' + Math.floor(p.z / RB); if (!rIndex.has(k)) rIndex.set(k, []); rIndex.get(k).push(i); });
function projRoute(x, z, maxD = 160) {
  let bi = -1, bd = maxD * maxD; const cx = Math.floor(x / RB), cz = Math.floor(z / RB), rr = Math.ceil(maxD / RB);
  for (let i = cx - rr; i <= cx + rr; i++) for (let j = cz - rr; j <= cz + rr; j++) { const l = rIndex.get(i + ',' + j); if (!l) continue; for (const k of l) { const dd = (R[k].x - x) ** 2 + (R[k].z - z) ** 2; if (dd < bd) { bd = dd; bi = k; } } }
  if (bi < 0) return null;
  const p = R[bi], dx = x - p.x, dz = z - p.z, along = dx * p.tx + dz * p.tz, lat = dx * -p.tz + dz * p.tx;
  return { i: bi, s: bi * DS + along, d: lat, dist: Math.sqrt(bd) };
}

// per-sample street name, width, bridge flag (from the OSM way under each path edge)
const curbWidth = w => { const v = parseLen(w.tags.width); if (v > 5) return v; const l = parseFloat(w.tags.lanes); return isFinite(l) ? l * 3.4 + 1 : 13; };
for (const p of R) { p.w = 13; p.bridge = 0; p.name = ''; }
{
  let cur = 0;
  for (let k = 0; k + 1 < pathNodes.length; k++) {
    const a = pathNodes[k], b = pathNodes[k + 1], w = b.way, mid = projRoute((a.x + b.x) / 2, (a.z + b.z) / 2), pb = projRoute(b.x, b.z);
    const iEnd = k + 2 === pathNodes.length ? NR - 1 : Math.max(cur, pb ? pb.i : cur);
    for (let i = cur; i <= iEnd; i++) { R[i].w = curbWidth(w); R[i].bridge = w.tags.bridge ? 1 : 0; R[i].name = w.tags.name; R[i].lanes = parseFloat(w.tags.lanes) || 4; }
    cur = iEnd; void mid;
  }
}
// widths: clamp + smooth
{ const w0 = R.map(p => Math.max(11.5, Math.min(19, p.w))); for (let i = 0; i < NR; i++) { let s = 0, n = 0; for (let k = -10; k <= 10; k++) { const j = i + k; if (j >= 0 && j < NR) { s += w0[j]; n++; } } R[i].w = s / n; } }
// bridge spans (merge close ones), then elevation profile with decks interpolated
let spans = [];
for (let i = 0; i < NR; i++) if (R[i].bridge) { if (spans.length && i - spans[spans.length - 1][1] <= 14) spans[spans.length - 1][1] = i; else spans.push([i, i]); }
spans = spans.map(([a, b]) => [Math.max(0, a - 5), Math.min(NR - 1, b + 5)]);
const yRaw = R.map(p => demXZ(p.x, p.z));
for (const [a, b] of spans) for (let i = a; i <= b; i++) yRaw[i] = yRaw[a] + (yRaw[b] - yRaw[a]) * (i - a) / (b - a);
let ys = yRaw.slice();
for (let pass = 0; pass < 3; pass++) { const c = ys.slice(); for (let i = 0; i < NR; i++) { let s = 0, n = 0; for (let k = -9; k <= 9; k++) { const j = Math.max(0, Math.min(NR - 1, i + k)); s += ys[j]; n++; } c[i] = s / n; } ys = c; }
R.forEach((p, i) => { p.y = ys[i]; p.bridge = 0; });
for (const [a, b] of spans) for (let i = a; i <= b; i++) R[i].bridge = 1;
const routeY = s => { const f = Math.max(0, Math.min(NR - 1.001, s / DS)), i = Math.floor(f); return R[i].y + (R[i + 1].y - R[i].y) * (f - i); };

// ---------- terrain grid (10 m), carved flat under the route ----------
const CELL = 10, GNX = 2 * HALF_X / CELL + 1, GNZ = 2 * HALF_Z / CELL + 1;
const G = new Float32Array(GNX * GNZ);
for (let j = 0; j < GNZ; j++) for (let i = 0; i < GNX; i++) {
  const x = -HALF_X + i * CELL, z = -HALF_Z + j * CELL; let y = demXZ(x, z);
  const pr = projRoute(x, z, 60);
  if (pr && pr.s > -20 && pr.s < ROUTE_LEN + 20) {
    const p = R[pr.i], inner = p.w / 2 + 9, outer = inner + 22, ad = Math.abs(pr.d);
    if (ad < outer) {
      if (p.bridge) { if (ad < inner + 6) y = Math.min(y, p.y - 1.6); }       // keep ground clear of the deck
      else { const t = ad <= inner ? 1 : 1 - (ad - inner) / (outer - inner); const ts = t * t * (3 - 2 * t); y = y * (1 - ts) + (p.y - 0.02) * ts; }
    }
  }
  G[j * GNX + i] = y;
}
function groundY(x, z) {
  let fx = (x + HALF_X) / CELL, fz = (z + HALF_Z) / CELL;
  fx = Math.max(0, Math.min(GNX - 1.001, fx)); fz = Math.max(0, Math.min(GNZ - 1.001, fz));
  const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz;
  return G[iz * GNX + ix] * (1 - ax) * (1 - az) + G[iz * GNX + ix + 1] * ax * (1 - az) + G[(iz + 1) * GNX + ix] * (1 - ax) * az + G[(iz + 1) * GNX + ix + 1] * ax * az;
}

// ---------- polygon helpers ----------
const ringOfNodes = ids => { const r = ids.map(id => nodes.get(id)).filter(Boolean).map(p => [p.x, p.z]); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop(); return r.length >= 3 ? r : null; };
function assembleRings(wayList) {
  const segs = wayList.map(w => w.nodes.slice()), rings = [];
  while (segs.length) {
    let cur = segs.pop(), guard = 0;
    while (cur[0] !== cur[cur.length - 1] && guard++ < 500) {
      const tail = cur[cur.length - 1]; let k = segs.findIndex(s => s[0] === tail || s[s.length - 1] === tail);
      if (k < 0) break;
      let s = segs.splice(k, 1)[0]; if (s[0] !== tail) s = s.reverse();
      cur = cur.concat(s.slice(1));
    }
    const r = ringOfNodes(cur); if (r) rings.push(r);
  }
  return rings;
}
const areaOf = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
const centroidOf = r => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };
const pip = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
class Grid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  add(o, r) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of r) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } const c = this.cell; for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) { const k = i + ',' + j; if (!this.m.has(k)) this.m.set(k, []); this.m.get(k).push(o); } }
  at(x, z) { return this.m.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell)) || []; }
}
function clipRing(r, hx, hz) {   // Sutherland-Hodgman against the world rectangle
  const edges = [[p => p[0] >= -hx, (a, b) => { const t = (-hx - a[0]) / (b[0] - a[0]); return [-hx, a[1] + (b[1] - a[1]) * t]; }], [p => p[0] <= hx, (a, b) => { const t = (hx - a[0]) / (b[0] - a[0]); return [hx, a[1] + (b[1] - a[1]) * t]; }], [p => p[1] >= -hz, (a, b) => { const t = (-hz - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, -hz]; }], [p => p[1] <= hz, (a, b) => { const t = (hz - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, hz]; }]];
  let out = r;
  for (const [inside, cut] of edges) { const inp = out; out = []; for (let i = 0; i < inp.length; i++) { const a = inp[i], b = inp[(i + 1) % inp.length], ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(cut(a, b)); } if (out.length < 3) return null; }
  return out;
}
const flat = r => { const o = []; for (const p of r) o.push(q(p[0]), q(p[1])); return o; };

// ---------- FEMA USA Structures (lidar heights + occupancy) ----------
const fema = [], femaGrid = new Grid(60);
for (const f of fs.readdirSync(path.join(here, 'cache')).filter(f => /^structs-\d+\.json$/.test(f))) {
  for (const ft of JSON.parse(fs.readFileSync(C(f))).features) {
    const g = ft.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) { const r = poly[0].map(c => [X(c[0]), Z(c[1])]); const o = { r, h: ft.properties.HEIGHT, occ: ft.properties.OCC_CLS, area: Math.abs(areaOf(r)) }; fema.push(o); femaGrid.add(o, r); }
  }
}
const femaAt = (x, z) => femaGrid.at(x, z).find(o => pip(o.r, x, z));

// ---------- buildings ----------
const bEnts = [], pEnts = [];
const pushEnt = (ring, tags, isPart, id) => { const a = Math.abs(areaOf(ring)); if (a < 4) return; const [cx, cz] = centroidOf(ring); if (!inWorld({ x: cx, z: cz }, 20)) return; (isPart ? pEnts : bEnts).push({ ring, tags, area: a, cx, cz, id, parts: [], partArea: 0 }); };
for (const w of ways) {
  const isB = w.tags.building && w.tags.building !== 'no', isP = w.tags['building:part'] && w.tags['building:part'] !== 'no';
  if (!isB && !isP) continue;
  const r = ringOfNodes(w.nodes); if (r) pushEnt(r, w.tags, !isB && isP, w.id);
}
for (const rl of rels) {
  const t = rl.tags || {}; const isB = t.building && t.building !== 'no', isP = t['building:part'];
  if (!isB && !isP) continue;
  const outer = rl.members.filter(m => m.type === 'way' && m.role !== 'inner').map(m => wayById.get(m.ref)).filter(Boolean);
  for (const r of assembleRings(outer)) pushEnt(r, t, !isB && !!isP, rl.id);
}
const bGrid = new Grid(50); for (const b of bEnts) bGrid.add(b, b.ring);
for (const p of pEnts) { const par = bGrid.at(p.cx, p.cz).filter(b => pip(b.ring, p.cx, p.cz)).sort((a, b) => a.area - b.area)[0]; if (par) { p.parent = par; par.parts.push(p); par.partArea += p.area; } }

const DEF_H = { garage: 3.2, garages: 3.2, shed: 2.8, carport: 3, roof: 5, detached: 7.5, house: 7.5, terrace: 8.5, semidetached_house: 7.5, residential: 9, apartments: 11, commercial: 7, retail: 6, office: 12, industrial: 8, warehouse: 8, church: 15, school: 10, university: 13, college: 13, hospital: 16, hotel: 18, public: 12, civic: 11, parking: 12, service: 4, construction: 9, stadium: 22, yes: 7 };
const lvH = n => (n <= 3 ? n * 4.0 + 1 : n <= 12 ? n * 3.7 + 2 : n * 3.9 + 4);
function classify(tags, h, area, occ) {
  const b = tags.building || tags['building:part'];
  if (tags.parking === 'multi-storey' || b === 'parking') return 7;
  if (['garage', 'garages', 'shed', 'carport', 'roof', 'service'].includes(b)) return 6;
  if (h >= 55) return 4;
  if (['church', 'cathedral', 'chapel', 'school', 'university', 'college', 'stadium', 'public', 'civic', 'government', 'hospital', 'train_station'].includes(b) || tags.tourism === 'museum' || tags.amenity === 'theatre' || tags.amenity === 'courthouse' || tags.amenity === 'place_of_worship') return 8;
  if (['detached', 'house', 'terrace', 'semidetached_house', 'bungalow'].includes(b)) return 0;
  if (['apartments', 'residential', 'dormitory', 'hotel'].includes(b)) return h > 9 || area > 320 ? 1 : 0;
  if (['industrial', 'warehouse'].includes(b)) return 5;
  if (['office'].includes(b) || h >= 22) return 3;
  if (['commercial', 'retail'].includes(b) || tags.shop || tags.amenity) return 2;
  if (occ === 'Residential') return area > 320 || h > 10 ? 1 : 0;
  if (occ === 'Industrial') return 5;
  if (occ === 'Government' || occ === 'Education' || occ === 'Assembly') return 8;
  return area < 60 ? 6 : 2;
}
const hstat = { tag: 0, lidar: 0, levels: 0, lidarLoose: 0, def: 0 };
function resolveHeight(e) {
  const t = e.tags, f = femaAt(e.cx, e.cz); e.occ = f?.occ;
  const hTag = parseLen(t.height), lv = parseFloat(t['building:levels']);
  if (hTag > 1) { hstat.tag++; return hTag; }
  const lidar = f && f.h > 2.2 ? f.h : NaN, tight = f && f.area > e.area * 0.6 && f.area < e.area * 1.7;
  if (isFinite(lidar) && tight) { hstat.lidar++; return Math.max(lidar, isFinite(lv) ? lv * 2.7 : 0); }
  if (isFinite(lv) && lv > 0) { hstat.levels++; return lvH(lv); }
  if (isFinite(lidar) && e.area > 30) { hstat.lidarLoose++; return Math.min(lidar, 40); }
  hstat.def++; return DEF_H[t.building] ?? 7;
}
const outB = [];
function emit(e, h, mh, yref, gmin, type, parent) {
  const t = e.tags, o = { r: flat(e.ring), h: q(h), y: q(yref), g: q(gmin), t: type };
  if (mh > 0.05) o.m = q(mh);
  const col = t['building:colour'] || parent?.tags['building:colour']; if (col) o.c = col;
  const mat = t['building:material'] || parent?.tags['building:material']; if (mat) o.mt = mat;
  const nm = t.name || t['addr:housename']; if (nm && !e.parent) o.n = nm;
  if (t['roof:shape'] && t['roof:shape'] !== 'flat') o.rs = t['roof:shape'];
  outB.push(o); return o;
}
for (const e of bEnts) {
  e.h = resolveHeight(e);
  // ground reference
  const gs = e.ring.map(p => groundY(p[0], p[1])).concat(groundY(e.cx, e.cz)).sort((a, b) => a - b);
  e.gmin = gs[0]; e.yref = gs[Math.floor(gs.length / 2)];
  const pr = projRoute(e.cx, e.cz, 70);
  e.pr = pr;
  if (pr && pr.s > 0 && pr.s < ROUTE_LEN) {
    const p = R[pr.i];
    if (p.bridge && e.yref < p.y - 2.5) { e.yref = p.y; e.gmin = p.y - 1.4; e.onDeck = Math.abs(pr.d) + Math.sqrt(e.area) / 2 + 4; p.deck = Math.max(p.deck || 0, e.onDeck); }
    else if (Math.abs(pr.d) < p.w / 2 + 30 && !p.bridge) { e.yref = Math.max(e.yref, Math.min(p.y, e.yref + 1.5)); }
  }
  e.type = classify(e.tags, e.h, e.area, e.occ);
  const lv = parseFloat(e.tags['building:levels']);
  e.perLevel = isFinite(lv) && lv > 0 ? e.h / lv : NaN;
}
// anything straddling the street itself is a skywalk: lift it clear
for (const p of R) p.over = 0;
let skywalks = 0;
for (let i = 0; i < NR; i += 2) for (const e of bGrid.at(R[i].x, R[i].z)) if (!e.sky && pip(e.ring, R[i].x, R[i].z)) { e.sky = 1; skywalks++; }
let nOutline = 0, nParts = 0, fixedFloat = 0;
for (const e of bEnts) {
  const useParts = e.parts.length && e.partArea >= e.area * 0.5;
  let minH = parseLen(e.tags.min_height); if (!(minH > 0)) minH = 0;
  if (e.tags.building === 'roof') minH = Math.max(minH, e.h - 0.7);
  if (e.sky) { minH = Math.max(minH, 6); e.h = Math.max(e.h, minH + 4); }
  if (!useParts) { emit(e, e.h, minH, e.yref, e.gmin, e.type); nOutline++; }
  else {
    // parts that float (min_level) with nothing mapped beneath them: stand them on a podium
    const partBase = p => { const t = p.tags, a = parseLen(t.min_height), ml = parseFloat(t['building:min_level']); return a > 0 ? a : ml > 0 ? ml * (isFinite(e.perLevel) ? e.perLevel : 3.7) : 0; };
    const grounded = e.parts.filter(p => partBase(p) < 3).reduce((a, p) => a + p.area, 0);
    if (grounded < e.area * 0.45) { const lows = e.parts.map(partBase).filter(v => v >= 3); const podium = lows.length ? Math.min(...lows) : e.h; emit(e, Math.max(4, Math.min(podium, e.h)), minH, e.yref, e.gmin, e.type); nOutline++; }
  }
  const solved = [];
  for (const p of e.parts) {
    const t = p.tags, lv = parseFloat(t['building:levels']), ml = parseFloat(t['building:min_level']);
    const per = isFinite(e.perLevel) ? e.perLevel : NaN;
    let h = parseLen(t.height); if (!(h > 1)) h = isFinite(lv) && lv > 0 ? (isFinite(per) ? lv * per : lvH(lv)) : e.h;
    let mh = parseLen(t.min_height); if (!(mh > 0)) mh = isFinite(ml) && ml > 0 ? ml * (isFinite(per) ? per : 3.7) : 0;
    if (e.sky) { mh = Math.max(mh, 6); h = Math.max(h, mh + 4); }
    solved.push({ p, h, mh });
  }
  // a part hanging in mid-air (min_level typos) is dropped onto whatever is mapped beneath it
  for (const a of solved) {
    if (a.mh < 3 || e.sky) continue;
    const under = solved.filter(b => b !== a && b.mh < a.mh && pip(b.p.ring, a.p.cx, a.p.cz));
    if (!useParts && e.h >= a.mh - 1.5) continue;
    if (under.some(b => b.h >= a.mh - 1.5)) continue;
    a.mh = under.length ? Math.max(...under.map(b => b.h)) : 0; fixedFloat++;
  }
  for (const { p, h, mh } of solved) {
    if (h - mh < 0.5) continue;
    if (!useParts && h <= e.h + 0.3 && mh < e.h) continue;   // hidden inside the outline
    emit(p, h, mh, e.yref, e.gmin, classify({ ...e.tags, ...p.tags, building: e.tags.building }, Math.max(h, e.h), e.area, e.occ), e); nParts++;
  }
}
for (const p of pEnts) if (!p.parent) { const h = parseLen(p.tags.height) || lvH(parseFloat(p.tags['building:levels']) || 2); const g = groundY(p.cx, p.cz); emit(p, h, parseLen(p.tags.min_height) || 0, g, g - 1, classify(p.tags, h, p.area)); nParts++; }

// ---------- roads ----------
const ROAD_K = { motorway: 0, trunk: 0, motorway_link: 0, trunk_link: 0, primary: 1, primary_link: 1, secondary: 2, secondary_link: 2, tertiary: 3, tertiary_link: 3, residential: 4, unclassified: 4, living_street: 4, service: 5, pedestrian: 6 };
const PATHS = new Set(['footway', 'path', 'cycleway', 'steps']);
const routeEdge = new Set(); for (let k = 0; k + 1 < pathNodes.length; k++) routeEdge.add(pathNodes[k].id + '>' + pathNodes[k + 1].id).add(pathNodes[k + 1].id + '>' + pathNodes[k].id);
const roads = [], paths = [], plazas = [];
// merge bridge ways into chains so decks interpolate between their real abutments
const bridgeWays = ways.filter(w => (w.tags.highway || w.tags.railway === 'rail') && w.tags.bridge && w.tags.bridge !== 'no');
const endMap = new Map(); for (const w of bridgeWays) for (const id of [w.nodes[0], w.nodes[w.nodes.length - 1]]) { if (!endMap.has(id)) endMap.set(id, []); endMap.get(id).push(w); }
const deckY = new Map();   // way id -> per-node y
{
  const seen = new Set();
  for (const w0 of bridgeWays) {
    if (seen.has(w0.id)) continue;
    let chain = [w0], ids = w0.nodes.slice(); seen.add(w0.id);
    for (let grow = true; grow;) {
      grow = false;
      for (const [endId, atHead] of [[ids[ids.length - 1], false], [ids[0], true]]) {
        const nx = (endMap.get(endId) || []).filter(w => !seen.has(w.id) && (w.tags.highway || 'rail') === (w0.tags.highway || 'rail'));
        if (nx.length !== 1) continue;
        const w = nx[0]; seen.add(w.id); chain.push(w); let nn = w.nodes.slice();
        if (atHead) { if (nn[nn.length - 1] !== endId) nn.reverse(); ids = nn.slice(0, -1).concat(ids); } else { if (nn[0] !== endId) nn.reverse(); ids = ids.concat(nn.slice(1)); }
        grow = true;
      }
    }
    const P = ids.map(id => nodes.get(id)).filter(Boolean); if (P.length < 2) continue;
    const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + dist(P[i - 1], P[i]));
    const yA = groundY(P[0].x, P[0].z), yB = groundY(P[P.length - 1].x, P[P.length - 1].z), L = cum[cum.length - 1] || 1;
    const lay = parseFloat(w0.tags.layer) || 1;
    const yOf = new Map(); P.forEach((p, i) => { const lin = yA + (yB - yA) * cum[i] / L, t = cum[i] / L; yOf.set(p.id, Math.max(lin, groundY(p.x, p.z) + (lay > 0 ? Math.min(5.5, 30 * t * (1 - t)) * 0 : 0))); });
    // a deck must clear the ground beneath it: raise mid-span if the straight line would bury it
    for (const w of chain) deckY.set(w.id, w.nodes.map(id => yOf.get(id)));
  }
}
function splitInside(P, extra) {   // keep the runs of a polyline that are inside the world
  const runs = []; let cur = null;
  P.forEach((p, i) => { if (inWorld(p, 30)) { if (!cur) { cur = { p: [], e: [] }; runs.push(cur); } cur.p.push(p); cur.e.push(extra ? extra[i] : null); } else cur = null; });
  return runs.filter(r => r.p.length >= 2);
}
let routeWaySkipped = 0;
for (const w of ways) {
  const hw = w.tags.highway; if (!hw) continue;
  const P = wpts(w); if (P.length < 2) continue;
  if (w.tags.area === 'yes' && (hw === 'pedestrian' || hw === 'footway')) { const r = ringOfNodes(w.nodes); if (r) { const c = clipRing(r, HALF_X, HALF_Z); if (c) plazas.push(flat(c)); } continue; }
  if (w.tags.tunnel && w.tags.tunnel !== 'no') continue;
  if (PATHS.has(hw)) { for (const run of splitInside(P)) paths.push({ p: run.p.flatMap(p => [q(p.x), q(p.z)]), k: hw === 'steps' ? 1 : hw === 'cycleway' ? 2 : 0 }); continue; }
  const k = ROAD_K[hw]; if (k == null) continue;
  // skip the pieces the hero road replaces
  let onRoute = 0; for (let i = 0; i + 1 < P.length; i++) if (routeEdge.has(P[i].id + '>' + P[i + 1].id)) onRoute++;
  if (onRoute === P.length - 1) { routeWaySkipped++; continue; }
  const lanes = parseFloat(w.tags.lanes);
  let wd = parseLen(w.tags.width);
  if (!(wd > 2.5)) wd = isFinite(lanes) ? lanes * 3.5 + (k === 0 ? 3 : 0.8) : [11, 13, 11, 10, 8.5, 4.6, 6][k];
  if (hw.endsWith('_link')) wd = Math.min(wd, 7.5);
  const dy = deckY.get(w.id);
  for (const run of splitInside(P, dy)) {
    const o = { k, w: q(wd), p: run.p.flatMap(p => [q(p.x), q(p.z)]) };
    if (dy) o.y = run.e.map(v => q(v));
    if (w.tags.name) o.n = w.tags.name;
    if (w.tags.oneway === 'yes') o.o = 1;
    if (isFinite(lanes)) o.l = lanes;
    roads.push(o);
  }
}
const rails = [];
for (const w of ways) {
  if (w.tags.railway !== 'rail' || (w.tags.tunnel && w.tags.tunnel !== 'no')) continue;
  const dy = deckY.get(w.id);
  for (const run of splitInside(wpts(w), dy)) { const o = { p: run.p.flatMap(p => [q(p.x), q(p.z)]) }; if (dy) o.y = run.e.map(v => q(v)); rails.push(o); }
}

// ---------- cross streets + signals along the route ----------
const signalNodes = [...nodes.values()].filter(n => n.tags?.highway === 'traffic_signals');
const nodeWays = new Map(); for (const w of ways) if (DRIVE.has(w.tags.highway) && w.tags.name) for (const id of w.nodes) { if (!nodeWays.has(id)) nodeWays.set(id, []); nodeWays.get(id).push(w); }
let cross = [];
for (const pn of pathNodes) {
  for (const w of nodeWays.get(pn.id) || []) {
    if (ROUTE_NAMES.has(w.tags.name) && w.tags.name === pn.way.tags.name) continue;
    const pr = projRoute(pn.x, pn.z); if (!pr) continue;
    const idx = w.nodes.indexOf(pn.id), a = nodes.get(w.nodes[Math.max(0, idx - 1)]), b = nodes.get(w.nodes[Math.min(w.nodes.length - 1, idx + 1)]);
    cross.push({ s: pr.s, n: w.tags.name, k: ROAD_K[w.tags.highway], w: parseLen(w.tags.width) || (parseFloat(w.tags.lanes) || 2) * 3.5 + 1, sig: signalNodes.some(sn => dist(sn, pn) < 32) ? 1 : 0, ang: a && b ? Math.atan2(b.z - a.z, b.x - a.x) : 0 });
  }
}
cross.sort((a, b) => a.s - b.s);
// merge: same street name within 70 m, or the two halves of a divided street
const merged = [];
for (const c of cross) {
  const base = n => n.replace(/^(East|West|North|South) /, '');
  const m = merged.find(o => Math.abs(o.s - c.s) < 70 && base(o.n) === base(c.n));
  if (m) { m.s0 = Math.min(m.s0, c.s); m.s1 = Math.max(m.s1, c.s); m.sig |= c.sig; m.w = Math.max(m.w, c.w); if (m.n !== c.n) m.n2 = c.n; }
  else merged.push({ ...c, s0: c.s, s1: c.s });
}
cross = merged.map(c => ({ s: Math.round((c.s0 + c.s1) / 2), n: c.n, n2: c.n2, k: c.k, w: Math.round(c.w + (c.s1 - c.s0)), sig: c.sig, a: +c.ang.toFixed(3) })).filter(c => c.s > 10 && c.s < ROUTE_LEN - 10);

// ---------- ground cover polygons (for the baked ground texture) ----------
const cover = [];
const coverType = t => {
  if (t.leisure === 'pitch') return 1;
  if (['park', 'garden', 'playground', 'dog_park', 'common'].includes(t.leisure)) return 0;
  if (['grass', 'meadow', 'recreation_ground', 'village_green', 'cemetery', 'greenfield', 'flowerbed'].includes(t.landuse)) return 0;
  if (t.natural === 'scrub' || t.natural === 'wood' || t.landuse === 'forest') return 2;
  if (t.natural === 'sand') return 3;
  if (['construction', 'brownfield'].includes(t.landuse)) return 4;
  if (t.landuse === 'railway') return 5;
  if (t.amenity === 'parking' && !t.building) return 6;
  if (t.leisure === 'swimming_pool' || (t.natural === 'water' && t.water !== 'river')) return 7;
  return -1;
};
for (const w of ways) { const k = coverType(w.tags); if (k < 0) continue; const r = ringOfNodes(w.nodes); if (!r || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue; const c = clipRing(r, HALF_X, HALF_Z); if (c) cover.push({ k, r: flat(c), a: Math.abs(areaOf(c)) }); }
cover.sort((a, b) => b.a - a.a); cover.forEach(c => delete c.a);

// ---------- water ----------
const water = [];
for (const rl of rels) {
  if (rl.tags?.natural !== 'water') continue;
  const outer = rl.members.filter(m => m.type === 'way' && m.role !== 'inner').map(m => wayById.get(m.ref)).filter(Boolean);
  for (const r of assembleRings(outer)) { const c = clipRing(r, HALF_X + 400, HALF_Z + 400); if (!c || Math.abs(areaOf(c)) < 400) continue; const ysamp = c.map(p => demXZ(p[0], p[1])).sort((a, b) => a - b); water.push({ r: flat(c), y: q(ysamp[Math.floor(ysamp.length * 0.15)] + 0.25) }); }
}

// ---------- point features ----------
const GENUS = { Acer: 1, Liquidambar: 1, Nyssa: 1, Cornus: 1, Ginkgo: 2, Gleditsia: 2, Betula: 2, Tilia: 2, Liriodendron: 2, Ulmus: 2, Fraxinus: 2, Populus: 2, Larix: 2, Quercus: 3, Fagus: 3, Carya: 3, Aesculus: 3, Taxodium: 3, Platanus: 3, Zelkova: 3, Pyrus: 5, Malus: 5, Prunus: 5, Amelanchier: 5, Cercis: 5, Syringa: 5 };
const trees = [];
let seedN = 7; const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
const treeType = t => { if (t.leaf_type === 'needleleaved' && t.genus !== 'Larix' && t.genus !== 'Taxodium') return 4; return GENUS[t.genus] ?? 0; };
for (const n of nodes.values()) {
  if (n.tags?.natural !== 'tree' || !inWorld(n)) continue;
  const pr = projRoute(n.x, n.z, 30); if (pr && Math.abs(pr.d) < R[pr.i].w / 2 + 0.4) continue;   // never in the roadway
  trees.push(q(n.x), q(n.z), treeType(n.tags), Math.round(70 + rnd() * 60));
}
for (const w of ways) if (w.tags.natural === 'tree_row') { const P = wpts(w); for (let i = 0; i + 1 < P.length; i++) { const L = dist(P[i], P[i + 1]), n = Math.max(1, Math.round(L / 8)); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; trees.push(q(P[i].x + (P[i + 1].x - P[i].x) * t), q(P[i].z + (P[i + 1].z - P[i].z) * t), 0, Math.round(80 + rnd() * 50)); } } }
const ptsOf = (pred) => { const o = []; for (const n of nodes.values()) if (n.tags && pred(n.tags) && inWorld(n)) o.push(q(n.x), q(n.z)); return o; };
const lamps = ptsOf(t => t.highway === 'street_lamp');
const signals = ptsOf(t => t.highway === 'traffic_signals');
const flags = ptsOf(t => t.man_made === 'flagpole');
const stops = []; for (const n of nodes.values()) if (n.tags?.highway === 'bus_stop') { const pr = projRoute(n.x, n.z, 22); if (pr && pr.s > 5 && pr.s < ROUTE_LEN - 5) stops.push({ s: Math.round(pr.s), d: +pr.d.toFixed(1), n: n.tags.name || '' }); }
const arches = [];
for (const w of ways) if (w.tags.man_made === 'gantry') { const P = wpts(w); if (P.length < 2) continue; const a = P[0], b = P[P.length - 1], cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, pr = projRoute(cx, cz, 25); arches.push({ x: q(cx), z: q(cz), a: +Math.atan2(b.z - a.z, b.x - a.x).toFixed(3), w: q(dist(a, b)), s: pr ? Math.round(pr.s) : -1 }); }
arches.sort((a, b) => a.s - b.s);

// ---------- landmarks + districts ----------
const LM = [
  ['Short North Arts District', 39.9868, -83.0054, 'Galleries, patios and 17 lit arches along High Street.'],
  ['Goodale Park', 39.9757, -83.0062, 'Given to the city in 1851 by Dr. Lincoln Goodale.'],
  ['North Market', 39.9718, -83.0043, 'Columbus’s public market since 1876.'],
  ['Greater Columbus Convention Center', 39.9712, -83.0008, 'Peter Eisenman’s 1993 pastel railyard of a building.'],
  ['The Cap at Union Station', 39.9704, -83.0022, 'Shops built on a bridge so I-670 disappears beneath High Street.'],
  ['Nationwide Arena', 39.9693, -83.0061, 'Home ice of the Blue Jackets, just to the west.'],
  ['One Nationwide Plaza', 39.9682, -83.0022, '40 storeys of insurance headquarters, 1978.'],
  ['Rhodes State Office Tower', 39.9633, -82.9993, 'Tallest in Columbus at 629 ft.'],
  ['Ohio Statehouse', 39.9614, -82.9990, 'Finished in 1861. Greek Revival, with a drum where you expect a dome.'],
  ['LeVeque Tower', 39.9622, -83.0022, 'Art Deco, 1927. At 555½ ft it was drawn to out-top the Washington Monument.'],
  ['Scioto Mile', 39.9617, -83.0042, 'Riverfront parks where downtown meets the Scioto.'],
  ['Discovery Bridge', 39.9617, -83.0054, 'Broad Street’s crossing of the Scioto River.'],
  ['COSI', 39.9597, -83.0071, 'Center of Science and Industry. Finish line.'],
];
const landmarks = LM.map(([n, lat, lon, f]) => { const x = X(lon), z = Z(lat), pr = projRoute(x, z, 600); return { n, f, x: q(x), z: q(z), s: Math.round(Math.max(0, Math.min(ROUTE_LEN, pr.s))), side: pr.d > 0 ? 1 : -1 }; }).sort((a, b) => a.s - b.s);
const crossS = re => cross.find(c => re.test(c.n))?.s;
const districts = [
  { s: 0, n: 'Short North' },
  { s: crossS(/Goodale/) ?? 1500, n: 'Arena District' },
  { s: crossS(/Spring/) ?? 2300, n: 'Downtown' },
  { s: (crossS(/Gay/) ?? 2700), n: 'Capitol Square' },
  { s: (crossS(/Front/) ?? 3000), n: 'Scioto Mile' },
];
const cosi = landmarks.find(l => l.n === 'COSI');
const finishS = Math.min(ROUTE_LEN - 70, cosi.s + 15);
districts.push({ s: Math.round((spans[spans.length - 1][1]) * DS), n: 'Scioto Peninsula' });

// ---------- write ----------
const g16 = new Int16Array(G.length); for (let i = 0; i < G.length; i++) g16[i] = Math.round(G[i] * 10);
const city = {
  meta: { lat0: LAT0, lon0: LON0, mlat: MLAT, mlon: MLON, y0: Y0, built: new Date().toISOString().slice(0, 10), osmBase: osm.osm3s?.timestamp_osm_base, sources: ['OpenStreetMap contributors (ODbL)', 'FEMA / ORNL USA Structures (lidar building heights)', 'USGS 3DEP (terrain)'] },
  terrain: { x0: -HALF_X, z0: -HALF_Z, cell: CELL, nx: GNX, nz: GNZ, h: Buffer.from(g16.buffer).toString('base64') },
  route: { ds: DS, len: ROUTE_LEN, finish: finishS, p: R.flatMap(p => [q(p.x), q(p.z), q(p.y)]), w: R.map(p => q(p.w)), b: R.map(p => p.bridge), deck: R.map(p => Math.round(p.deck || 0)), names: (() => { const o = []; R.forEach((p, i) => { if (!o.length || o[o.length - 1].n !== p.name) o.push({ s: i * DS, n: p.name }); }); return o; })(), spans: spans.map(([a, b]) => [a * DS, b * DS]) },
  cross, districts, landmarks, arches, stops,
  buildings: outB, roads, paths, plazas, rails, cover, water,
  trees, lamps, signals, flags,
};
const out = path.join(here, '..', 'public', 'data'); fs.mkdirSync(out, { recursive: true });
const json = JSON.stringify(city); fs.writeFileSync(path.join(out, 'city.json'), json);

console.log(`route ${ROUTE_LEN} m, ${NR} samples, finish at ${finishS}; streets: ${city.route.names.map(n => n.n + '@' + n.s).join(', ')}`);
console.log('bridge spans (m):', city.route.spans.map(s => s.join('-')).join(' | '), ' route way pieces replaced:', routeWaySkipped);
console.log('elevation along route:', [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(t => routeY(t * ROUTE_LEN).toFixed(1)).join(' '));
console.log('width along route:', R.filter((_, i) => i % 150 === 0).map(p => p.w.toFixed(1)).join(' '));
console.log(`cross streets (${cross.length}):`, cross.map(c => `${c.n.replace(/ (Street|Avenue|Boulevard)$/, '')}@${c.s}${c.sig ? '*' : ''}`).join(', '));
console.log('districts:', districts.map(d => d.n + '@' + d.s).join(', '));
console.log('landmarks:', landmarks.map(d => d.n + '@' + d.s + (d.side > 0 ? 'R' : 'L')).join(', '));
console.log('arches on route:', arches.filter(a => a.s >= 0).map(a => a.s + ':' + (a.w / 10).toFixed(0) + 'm').join(' '), '| off-route', arches.filter(a => a.s < 0).length);
console.log(`buildings: ${bEnts.length} outlines, ${pEnts.length} parts -> emitted ${outB.length} (${nOutline} outlines, ${nParts} parts), skywalks ${skywalks}, floating parts grounded ${fixedFloat}; height source`, hstat);
console.log('tallest:', outB.filter(b => b.n).sort((a, b) => b.h - a.h).slice(0, 10).map(b => `${b.n} ${(b.h / 10).toFixed(0)}m`).join(', '));
console.log(`roads ${roads.length}, paths ${paths.length}, plazas ${plazas.length}, rails ${rails.length}, cover ${cover.length}, water ${water.length} (y ${water.map(w => w.y / 10).join(',')}), trees ${trees.length / 4}, lamps ${lamps.length / 2}, signals ${signals.length / 2}, flags ${flags.length / 2}, stops ${stops.length}`);
console.log('deck widths at spans:', spans.map(([a, b]) => Math.max(...R.slice(a, b + 1).map(p => p.deck || 0)).toFixed(0)).join(', '));
console.log(`city.json ${(json.length / 1e6).toFixed(2)} MB`);
if (process.env.DEBUGB) {
  const [bx, bz] = process.env.DEBUGB.split(',').map(Number);
  for (const e of bEnts) if (Math.hypot(e.cx - bx, e.cz - bz) < 45) { console.log('BUILDING', e.id, JSON.stringify(e.tags), 'h', e.h.toFixed(1), 'area', e.area.toFixed(0), 'partArea', e.partArea.toFixed(0), 'parts', e.parts.length); for (const p of e.parts) console.log('   part', p.id, 'area', p.area.toFixed(0), JSON.stringify(p.tags)); }
  for (const p of pEnts) if (!p.parent && Math.hypot(p.cx - bx, p.cz - bz) < 45) console.log('ORPHAN part', p.id, p.area.toFixed(0), JSON.stringify(p.tags));
}
if (process.env.DEBUG) {
  for (let i = 1000; i < NR; i += 8) console.log(i * DS, 'route', R[i].y.toFixed(1), 'dem', demXZ(R[i].x, R[i].z).toFixed(1), 'L', demXZ(R[i].x + R[i].tz * 25, R[i].z - R[i].tx * 25).toFixed(1), 'R', demXZ(R[i].x - R[i].tz * 25, R[i].z + R[i].tx * 25).toFixed(1), R[i].bridge ? 'BRIDGE' : '', R[i].deck ? 'deck' + R[i].deck.toFixed(0) : '');
  for (const e of bEnts) if (e.onDeck) console.log('onDeck', e.tags.name || e.id, 's', e.pr.s.toFixed(0), 'd', e.pr.d.toFixed(0), 'area', e.area.toFixed(0), 'h', e.h.toFixed(0));
}
