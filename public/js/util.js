import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const smooth = t => t * t * (3 - 2 * t);

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shortName(n) {
  return (n || '')
    .replace(/^North /, 'N ').replace(/^South /, 'S ').replace(/^East /, 'E ').replace(/^West /, 'W ')
    .replace(/ Street$/, ' St').replace(/ Avenue$/, ' Ave').replace(/ Boulevard$/, ' Blvd')
    .replace(/ Place$/, ' Pl').replace(/ Drive$/, ' Dr').replace(/ Road$/, ' Rd').replace(/ Alley$/, ' Aly');
}

const _c = new THREE.Color();
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();

// Accumulates coloured triangles into one BufferGeometry.
export class Mesher {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  get count() { return this.pos.length / 3; }
  color(c) { return typeof c === 'number' ? _c.setHex(c) : c; }
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, c) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    c = this.color(c);
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
  }
  // a,b,c,d counter-clockwise seen from the front
  quad(a, b, c, d, col) {
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], col);
  }
  add(geom, col, matrix) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const p = g.attributes.position, n = g.attributes.normal, gc = g.attributes.color;
    if (matrix) _m3.getNormalMatrix(matrix);
    const c = col != null ? this.color(col) : null; const r = c ? c.r : 1, gg = c ? c.g : 1, b = c ? c.b : 1;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i); _n.fromBufferAttribute(n, i);
      if (matrix) { _v.applyMatrix4(matrix); _n.applyMatrix3(_m3).normalize(); }
      this.pos.push(_v.x, _v.y, _v.z); this.nor.push(_n.x, _n.y, _n.z);
      if (gc && !c) this.col.push(gc.getX(i), gc.getY(i), gc.getZ(i)); else this.col.push(r, gg, b);
    }
    if (g !== geom) g.dispose();
    return this;
  }
  box(w, h, d, col, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const g = new THREE.BoxGeometry(w, h, d); this.add(g, col, m); g.dispose(); return this;
  }
  cyl(rt, rb, h, col, x = 0, y = 0, z = 0, seg = 8, rx = 0, rz = 0, ry = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const g = new THREE.CylinderGeometry(rt, rb, h, seg); this.add(g, col, m); g.dispose(); return this;
  }
  sphere(r, col, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, detail = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    const g = new THREE.IcosahedronGeometry(r, detail); this.add(g, col, m); g.dispose(); return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.aniso) t.anisotropy = opts.aniso;
  return t;
}
