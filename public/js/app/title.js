// What only the title view shows: the glowing band that traces the route through the city.
import * as THREE from 'three';

export class TitleScene {
  constructor(route, scene) {
    const pos = [], idx = [], o = {};
    for (let i = 0; i < route.n; i++) {
      const s = i * route.ds; if (s > route.finish + 6) break;
      route.at(s, -7, o); pos.push(o.x, o.y + 3, o.z); route.at(s, 7, o); pos.push(o.x, o.y + 3, o.z);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.line = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.9, 0.25), transparent: true, opacity: 0.9, side: THREE.DoubleSide, fog: false, depthWrite: false }));
    this.line.frustumCulled = false; scene.add(this.line);
  }
  show(on) { this.line.visible = on; }
  update(time) { if (this.line.visible) this.line.material.opacity = 0.7 + Math.sin(time * 2.4) * 0.2; }
}
