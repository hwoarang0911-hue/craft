// Block interaction: DDA raycast from screen center, wireframe selection box,
// hold-to-break with multi-stage crack overlay + particles, place on hit face.
import * as THREE from 'three';
import { REACH } from './config.js';
import { BLOCKS, B, HOTBAR, buildCrackCanvas } from './blocks.js';

export class Interact {
  constructor(world, player, camera, scene, hud, atlasInfo) {
    this.world = world;
    this.player = player;
    this.camera = camera;
    this.scene = scene;
    this.hud = hud;
    this.hotbarIndex = 0;
    this.mining = null;       // { x, y, z, progress }
    this.buttons = 0;
    this.placeCooldown = 0;
    this.breakCooldown = 0;   // brief pause after a break before the next block takes damage
    this.target = null;

    // selection wireframe (nested boxes fake a thick line)
    const selMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 });
    this.selBox = new THREE.Group();
    for (const s of [1.004, 1.011, 1.018]) {
      this.selBox.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s)), selMat));
    }
    this.selBox.visible = false;
    scene.add(this.selBox);

    // crack overlay
    const crackTex = new THREE.CanvasTexture(buildCrackCanvas());
    crackTex.magFilter = THREE.NearestFilter;
    crackTex.minFilter = THREE.NearestFilter;
    crackTex.generateMipmaps = false;
    crackTex.repeat.set(0.1, 1);
    this.crackTex = crackTex;
    this.crackBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.001, 1.001, 1.001),
      new THREE.MeshBasicMaterial({
        map: crackTex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2,
      }));
    this.crackBox.visible = false;
    scene.add(this.crackBox);

    this.particles = new Particles(scene, atlasInfo);

    // TNT fuses + primed-block indicator
    this.fuses = [];
    this.flash = 0;
    this.primedGeo = new THREE.BoxGeometry(1.04, 1.04, 1.04);
    this.primedMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false,
    });

    window.addEventListener('mousedown', (e) => {
      if (!player.locked) return;
      this.buttons |= (1 << e.button);
      if (e.button === 2) this.tryPlace();
    });
    window.addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!player.locked) return;
      this.selectSlot((this.hotbarIndex + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Digit0' || e.key === '0') {
        const on = this.player.toggleFly();
        this.hud.flashBlockName(on ? 'Fly mode: ON (Space ↑ / Shift ↓)' : 'Fly mode: OFF');
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= HOTBAR.length) this.selectSlot(n - 1);
    });
  }

  selectSlot(i) {
    this.hotbarIndex = i;
    this.hud.setHotbar(i);
    this.hud.flashBlockName(BLOCKS[HOTBAR[i]].name);
  }

  // voxel DDA from camera along view dir
  raycast() {
    const o = this.camera.position;
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const stepX = Math.sign(d.x) || 1, stepY = Math.sign(d.y) || 1, stepZ = Math.sign(d.z) || 1;
    const tdx = Math.abs(1 / (d.x || 1e-9)), tdy = Math.abs(1 / (d.y || 1e-9)), tdz = Math.abs(1 / (d.z || 1e-9));
    let tx = ((stepX > 0 ? x + 1 - o.x : o.x - x)) * tdx;
    let ty = ((stepY > 0 ? y + 1 - o.y : o.y - y)) * tdy;
    let tz = ((stepZ > 0 ? z + 1 - o.z : o.z - z)) * tdz;
    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    while (t <= REACH) {
      const id = this.world.getBlock(x, y, z);
      if (id !== B.AIR && id !== B.WATER && id !== B.LAVA) {
        return { x, y, z, id, nx, ny, nz };
      }
      if (tx < ty && tx < tz) { x += stepX; t = tx; tx += tdx; nx = -stepX; ny = 0; nz = 0; }
      else if (ty < tz) { y += stepY; t = ty; ty += tdy; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tz; tz += tdz; nx = 0; ny = 0; nz = -stepZ; }
    }
    return null;
  }

  update(dt) {
    this.placeCooldown -= dt;
    this.breakCooldown -= dt;
    const hit = this.raycast();
    this.target = hit;
    if (hit) {
      this.selBox.visible = true;
      this.selBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      this.selBox.visible = false;
    }

    // left-click a TNT block to light its fuse (no holding needed)
    if (hit && (this.buttons & 1) && hit.id === B.TNT) {
      this.ignite(hit.x, hit.y, hit.z);
      this.buttons &= ~1; // consume the click so it fires once
      this.mining = null;
      this.crackBox.visible = false;
      this.updateFuses(dt);
      this.particles.update(dt);
      return;
    }

    // mining
    if (hit && (this.buttons & 1)) {
      if (!this.mining || this.mining.x !== hit.x || this.mining.y !== hit.y || this.mining.z !== hit.z) {
        this.mining = { x: hit.x, y: hit.y, z: hit.z, progress: 0, id: hit.id };
      }
      const hard = BLOCKS[hit.id].hard;
      // after a break, hold the next block at 0 damage briefly so chained
      // mining doesn't instantly chew through the second block
      if (this.breakCooldown > 0) {
        this.crackBox.visible = false;
      } else {
        this.mining.progress += dt / hard;
        if (this.mining.progress >= 1) {
          this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
          this.particles.burst(hit.x, hit.y, hit.z, hit.id);
          this.mining = null;
          this.crackBox.visible = false;
          this.breakCooldown = 0.22;
        } else {
          const stage = Math.min(9, Math.floor(this.mining.progress * 10));
          this.crackTex.offset.x = stage * 0.1;
          this.crackBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
          this.crackBox.visible = true;
        }
      }
    } else {
      this.mining = null;
      this.crackBox.visible = false;
      if ((this.buttons & 4) && this.placeCooldown <= 0) this.tryPlace();
    }
    this.updateFuses(dt);
    this.particles.update(dt);
  }

  // ---- TNT ----
  ignite(x, y, z, delay = 0.9) {
    if (this.world.getBlock(x, y, z) !== B.TNT) return;
    if (this.fuses.some((f) => f.x === x && f.y === y && f.z === z)) return;
    // a pulsing white box marks the primed block
    const mesh = new THREE.Mesh(this.primedGeo, this.primedMat.clone());
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.scene.add(mesh);
    this.fuses.push({ x, y, z, t: delay, mesh });
  }

  updateFuses(dt) {
    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const f = this.fuses[i];
      f.t -= dt;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.02);
      f.mesh.material.opacity = 0.25 + pulse * 0.5 * (1 - f.t / 0.9);
      f.mesh.scale.setScalar(1 + (0.9 - f.t) * 0.12);
      if (f.t <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        this.fuses.splice(i, 1);
        this.explode(f.x, f.y, f.z);
      }
    }
  }

  explode(cx, cy, cz, radius = 3.6) {
    const r2 = radius * radius;
    const edits = [];
    const chain = [];
    const ri = Math.ceil(radius);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dz = -ri; dz <= ri; dz++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) continue;
          const x = cx + dx, y = cy + dy, z = cz + dz;
          const id = this.world.getBlock(x, y, z);
          if (id === B.AIR || id === B.BEDROCK || id === B.WATER || id === B.LAVA) continue;
          if (id === B.TNT && !(dx === 0 && dy === 0 && dz === 0)) {
            chain.push([x, y, z]); // nearby TNT detonates in a chain
            continue;
          }
          edits.push({ x, y, z, id: B.AIR });
        }
      }
    }
    // sample a few surface blocks for debris color, then clear
    for (let k = 0; k < 5; k++) {
      const e = edits[(Math.random() * edits.length) | 0];
      if (e) this.particles.burst(e.x, e.y, e.z, e.id);
    }
    this.world.setBlocks(edits);
    this.particles.explosion(cx + 0.5, cy + 0.5, cz + 0.5);
    this.flash = 1;
    for (const [x, y, z] of chain) this.ignite(x, y, z, 0.12 + Math.random() * 0.18);
  }

  // deterministic break for the screenshot harness
  demoBreak() {
    const hit = this.raycast();
    if (!hit) return;
    this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
    this.particles.burst(hit.x, hit.y, hit.z, hit.id);
    this.crackBox.visible = false;
  }

  tryPlace() {
    const hit = this.target ?? this.raycast();
    if (!hit) return;
    let px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
    // plants/torch are replaceable directly
    const hitDef = BLOCKS[hit.id];
    if (hitDef.render === 'cross') { px = hit.x; py = hit.y; pz = hit.z; }
    const cur = this.world.getBlock(px, py, pz);
    const curDef = BLOCKS[cur];
    if (cur !== B.AIR && cur !== B.WATER && curDef.render !== 'cross') return;
    const id = HOTBAR[this.hotbarIndex];
    if (BLOCKS[id].solid && this.player.intersectsCell(px, py, pz)) return;
    // torches need solid ground below
    if (id === B.TORCH && !BLOCKS[this.world.getBlock(px, py - 1, pz)].opaque) return;
    this.world.setBlock(px, py, pz, id);
    this.placeCooldown = 0.22;
  }
}

// Break particles: one InstancedMesh of small cubes, CPU-simmed.
const MAX_P = 460;
class Particles {
  constructor(scene, atlasInfo) {
    this.avgColors = atlasInfo.avgColors;
    const geo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_P);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.parts = [];
    this.dummy = new THREE.Object3D();
  }

  burst(x, y, z, blockId) {
    const tile = BLOCKS[blockId].tiles[2];
    let [r, g, b] = this.avgColors[tile] ?? [0.6, 0.6, 0.6];
    r *= 0.82; g *= 0.82; b *= 0.82;
    for (let i = 0; i < 26 && this.parts.length < MAX_P; i++) {
      const shade = 0.7 + Math.random() * 0.4;
      this.parts.push({
        x: x + 0.2 + Math.random() * 0.6,
        y: y + 0.2 + Math.random() * 0.6,
        z: z + 0.2 + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 3.4,
        vy: Math.random() * 4.2 + 0.6,
        vz: (Math.random() - 0.5) * 3.4,
        life: 0.9 + Math.random() * 0.5,
        r: Math.min(1, r * shade), g: Math.min(1, g * shade), b: Math.min(1, b * shade),
        rot: Math.random() * Math.PI,
      });
    }
  }

  explosion(x, y, z) {
    // bright fireball sparks (bloom catches them) + dark smoke chunks
    for (let i = 0; i < 70 && this.parts.length < MAX_P; i++) {
      const fire = i < 46;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5);
      dir.normalize().multiplyScalar(3 + Math.random() * 7);
      const c = fire
        ? [1, 0.55 + Math.random() * 0.4, 0.12 + Math.random() * 0.2]
        : [0.16, 0.14, 0.12];
      this.parts.push({
        x: x + (Math.random() - 0.5) * 0.8,
        y: y + (Math.random() - 0.5) * 0.8,
        z: z + (Math.random() - 0.5) * 0.8,
        vx: dir.x, vy: Math.abs(dir.y) + 1.5, vz: dir.z,
        life: (fire ? 0.5 : 1.1) + Math.random() * 0.5,
        r: c[0], g: c[1], b: c[2],
        rot: Math.random() * Math.PI,
        big: !fire,
      });
    }
  }

  update(dt) {
    const d = this.dummy;
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy -= (p.big ? 5 : 13) * dt;
      if (p.big) { p.vx *= Math.exp(-2 * dt); p.vz *= Math.exp(-2 * dt); }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const s = Math.min(1, p.life * 2.4) * (p.big ? 2.2 : 1);
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rot, p.rot * 1.3, 0);
      d.scale.setScalar(s);
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      this.mesh.setColorAt(n, new THREE.Color(p.r, p.g, p.b));
      n++;
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
