// The camera rig: one update(dt, game, mode) entry. Modes are 'title' | 'intro' | 'run' | 'finish'; each is a
// method, so a new shot is a new method plus a mode name. `t` is the time spent in the current mode.
import * as THREE from 'three';
import { clamp, lerp, damp, smooth } from '../util.js';

export class CameraRig {
  constructor(camera, world, bus) {
    this.camera = camera; this.route = world.route; this.bus = bus;
    this.focus = new THREE.Vector3();       // what the world keeps its shadows and leaves around
    this.free = false;                      // true: the rig leaves the camera alone (inspection shots)
    this.portrait = false; this.time = 0; this.mode = null; this.t = 0;
    this.camD = 0; this.camY = 0; this.shake = 0;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.c = new THREE.Vector3(); this.o = {}; this.o2 = {};
    bus.on('crash', () => { this.shake = 1; });
  }
  resize(w, h) { this.camera.aspect = w / h; this.portrait = h > w * 1.05; this.camera.updateProjectionMatrix(); }
  // start of a fresh run
  reset() { this.camD = this.camY = this.shake = 0; this.t = 0; }
  // replay the current mode's move from its start (the intro crane after a pause)
  restart() { this.t = 0; }

  update(dt, game, mode) {
    this.time += dt;
    if (mode !== this.mode) { this.mode = mode; this.t = 0; } else this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.free) { this.camera.getWorldDirection(this.a); this.focus.copy(this.camera.position).addScaledVector(this.a, 15); return; }
    this[mode](dt, game);
    this.camera.updateProjectionMatrix();
  }

  // where the chase camera sits and looks for the current s / lateral / height
  chase(game, out, look) {
    const back = this.portrait ? 8.8 : 6.7, up = this.portrait ? 4.3 : 3.05, o = this.o, o2 = this.o2;
    this.route.at(game.s - back, this.camD * 0.6, o); out.set(o.x, o.y + up + this.camY * 0.4, o.z);
    this.route.at(game.s + 15, this.camD * 0.8, o2); look.set(o2.x, o2.y + 1.15 + this.camY * 0.35, o2.z);
  }

  // slow orbit over the whole route
  title() {
    const cam = this.camera, t = this.time, a = 0.5 + Math.sin(t * 0.045) * 0.22, R = this.portrait ? 1500 : 1150;
    cam.position.set(80 - Math.cos(a) * R, 250 + Math.sin(t * 0.06) * 30, 1000 + Math.sin(a) * R * 0.9);
    this.look.set(160, this.portrait ? -300 : 30, 620); cam.lookAt(this.look);
    cam.fov = this.portrait ? 66 : 50; this.focus.set(120, 0, 950);
  }
  // crane down onto the start line during the countdown
  intro(dt, game) {
    const cam = this.camera, k = smooth(clamp(this.t / 2.0, 0, 1)), A = this.a, B = this.b, C = this.c;
    this.chase(game, A, B); C.copy(B).sub(A).setY(0).normalize();
    cam.position.set(A.x, A.y + (1 - k) * 34, A.z).addScaledVector(C, -(1 - k) * 46); cam.lookAt(B);
    cam.fov = this.portrait ? 78 : 62; this.focus.copy(B);
  }
  run(dt, game) {
    const cam = this.camera, sp = game.speed01 ?? clamp(game.speed / 30, 0, 1), shake = game.shake ?? this.shake;
    this.camD = damp(this.camD, game.d, 7, dt); this.camY = damp(this.camY, game.y, 9, dt); this.chase(game, this.pos, this.look);
    if (shake > 0) { this.pos.x += (Math.random() - 0.5) * shake * 0.5; this.pos.y += (Math.random() - 0.5) * shake * 0.4; }
    cam.position.copy(this.pos); cam.lookAt(this.look); cam.rotateZ(clamp((game.leanV || 0) * 0.006, -0.06, 0.06));
    cam.fov = damp(cam.fov, (this.portrait ? 76 : 60) + sp * 13, 4, dt); this.focus.copy(this.look);
  }
  // swing round to face the skater with downtown behind
  finish(dt, game) {
    const cam = this.camera, k = smooth(clamp(this.t / 4.5, 0, 1)), at = this.route.at(game.s, game.d, this.o2), sk = this.b.set(at.x, at.y + 0.07 + game.y, at.z), o = this.route.at(game.s, 0, this.o);
    const a = Math.atan2(-o.tz, -o.tx) + k * 2.75 + Math.max(0, this.t - 4.5) * 0.05, R = lerp(7.5, this.portrait ? 13 : 10.5, k);
    this.pos.set(sk.x + Math.cos(a) * R, sk.y + lerp(3.0, 2.2, k), sk.z + Math.sin(a) * R); cam.position.lerp(this.pos, 1 - Math.exp(-5 * dt));
    this.look.lerp(this.a.set(sk.x, sk.y + lerp(1.2, 2.6, k), sk.z), 1 - Math.exp(-6 * dt)); cam.lookAt(this.look);
    cam.fov = damp(cam.fov, this.portrait ? 74 : 56, 3, dt); this.focus.copy(sk);
  }
}
