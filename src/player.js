// First-person player: pointer lock, WASD + jump, gravity, AABB collision
// against the voxel grid (per-axis sweep), swimming in water.
import * as THREE from 'three';
import { GRAVITY } from './config.js';
import { B } from './blocks.js';

const W = 0.6;       // player width
const H = 1.8;       // player height
export const EYE = 1.62;

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.pos = new THREE.Vector3(8, 60, 8); // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.keys = new Set();
    this.locked = false;
    this.frozen = false;
    this.flying = false;

    camera.rotation.order = 'YXZ';

    domElement.addEventListener('click', () => {
      if (!this.locked && !this.frozen) domElement.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === domElement;
      document.getElementById('hint').style.display = this.locked ? 'none' : '';
      document.getElementById('crosshair').style.display = this.locked ? '' : 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch -= e.movementY * 0.0023;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  aabbCollides(world, px, py, pz) {
    const x0 = Math.floor(px - W / 2), x1 = Math.floor(px + W / 2);
    const y0 = Math.floor(py), y1 = Math.floor(py + H - 0.001);
    const z0 = Math.floor(pz - W / 2), z1 = Math.floor(pz + W / 2);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (world.isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  update(dt, world) {
    if (this.frozen) {
      this.syncCamera();
      return;
    }
    dt = Math.min(dt, 0.05);
    const feet = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z));
    const head = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z));
    this.inWater = feet === B.WATER || head === B.WATER;
    this.headInWater = head === B.WATER;

    // input direction in world space
    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const r = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let ax = (-sin * f + cos * r);
    let az = (-cos * f - sin * r);
    const len = Math.hypot(ax, az);
    if (len > 0) { ax /= len; az /= len; }

    const speed = this.flying ? 9 : (this.inWater ? 4.2 : 5.6);
    const accel = this.flying ? 70 : (this.onGround ? 60 : (this.inWater ? 30 : 14));
    this.vel.x += ax * accel * dt;
    this.vel.z += az * accel * dt;
    // clamp horizontal speed + friction
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (hv > speed) { this.vel.x *= speed / hv; this.vel.z *= speed / hv; }
    const fric = this.flying ? Math.exp(-9 * dt)
      : this.onGround ? Math.exp(-12 * dt) : (this.inWater ? Math.exp(-4 * dt) : Math.exp(-1.2 * dt));
    if (len === 0) { this.vel.x *= fric; this.vel.z *= fric; }

    if (this.flying) {
      // creative float: Space up, Shift down, no gravity
      const up = (this.keys.has('Space') ? 1 : 0)
        - (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0);
      this.vel.y += up * 80 * dt;
      this.vel.y *= Math.exp((up === 0 ? -12 : -3) * dt);
      this.vel.y = Math.max(-9, Math.min(9, this.vel.y));
    } else if (this.inWater) {
      this.vel.y -= GRAVITY * 0.22 * dt;
      this.vel.y *= Math.exp(-2.6 * dt);
      if (this.keys.has('Space')) this.vel.y += 26 * dt;
      this.vel.y = Math.max(-5, Math.min(5, this.vel.y));
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.keys.has('Space') && this.onGround) {
        this.vel.y = 8.2;
        this.onGround = false;
      }
    }

    // per-axis sweep with sub-steps to avoid tunneling
    const steps = Math.max(1, Math.ceil((Math.abs(this.vel.y) + 6) * dt / 0.4));
    for (let s = 0; s < steps; s++) {
      this.moveAxis(world, 'x', this.vel.x * dt / steps);
      this.moveAxis(world, 'z', this.vel.z * dt / steps);
      this.moveAxis(world, 'y', this.vel.y * dt / steps);
    }
    if (this.pos.y < -10) { this.pos.y = 80; this.vel.set(0, 0, 0); }
    this.syncCamera();
  }

  moveAxis(world, axis, d) {
    if (d === 0) return;
    const p = this.pos;
    const next = { x: p.x, y: p.y, z: p.z };
    next[axis] += d;
    if (!this.aabbCollides(world, next.x, next.y, next.z)) {
      p[axis] = next[axis];
      if (axis === 'y') this.onGround = false;
      return;
    }
    // collide: clamp to block face
    if (axis === 'y') {
      if (d < 0) {
        p.y = Math.floor(p.y + d) + 1 + 0.0001;
        this.onGround = true;
      } else {
        p.y = Math.floor(p.y + H + d) - H - 0.0001;
      }
      this.vel.y = 0;
    } else if (axis === 'x') {
      p.x = d > 0
        ? Math.floor(p.x + W / 2 + d) - W / 2 - 0.0001
        : Math.floor(p.x - W / 2 + d) + 1 + W / 2 + 0.0001;
      this.vel.x = 0;
    } else {
      p.z = d > 0
        ? Math.floor(p.z + W / 2 + d) - W / 2 - 0.0001
        : Math.floor(p.z - W / 2 + d) + 1 + W / 2 + 0.0001;
      this.vel.z = 0;
    }
  }

  toggleFly() {
    this.flying = !this.flying;
    this.vel.y = 0;
    return this.flying;
  }

  syncCamera() {
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  // would placing a block at cell (x,y,z) intersect the player AABB?
  intersectsCell(x, y, z) {
    return x + 1 > this.pos.x - W / 2 && x < this.pos.x + W / 2 &&
      y + 1 > this.pos.y && y < this.pos.y + H &&
      z + 1 > this.pos.z - W / 2 && z < this.pos.z + W / 2;
  }
}
