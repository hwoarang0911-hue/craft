// Wandering critters: rabbit, cat, duck. Each is a single merged box-mesh
// (1 draw call) with baked vertex colors, lit by the scene sun/ambient/fog.
// Simple surface-following AI: idle/walk states, ground snap, step up/down,
// water + cliff avoidance, species-specific hop/waddle animation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HEIGHT } from './config.js';
import { B, BLOCKS } from './blocks.js';

function box(parts, cx, cy, cz, w, h, d, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  parts.push(g);
}

function finish(parts) {
  const geo = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  geo.computeBoundingSphere();
  geo.computeVertexNormals();
  return geo;
}

// Models face +Z; feet at y=0.
function buildRabbit() {
  const p = [];
  const fur = 0xd7d2c8, light = 0xe9e5dd, ear = 0xcdb8b2, dark = 0x2a2622;
  box(p, 0.11, 0.06, 0.1, 0.1, 0.12, 0.16, fur);   // front feet
  box(p, -0.11, 0.06, 0.1, 0.1, 0.12, 0.16, fur);
  box(p, 0.11, 0.07, -0.14, 0.12, 0.14, 0.2, fur); // hind feet
  box(p, -0.11, 0.07, -0.14, 0.12, 0.14, 0.2, fur);
  box(p, 0, 0.26, -0.02, 0.32, 0.28, 0.44, fur);   // body
  box(p, 0, 0.4, 0.26, 0.26, 0.26, 0.24, light);   // head
  box(p, 0.07, 0.2, -0.27, 0.12, 0.12, 0.1, light); // tail
  box(p, -0.07, 0.62, 0.24, 0.07, 0.26, 0.05, ear); // ears
  box(p, 0.07, 0.62, 0.24, 0.07, 0.26, 0.05, ear);
  box(p, -0.08, 0.44, 0.38, 0.04, 0.04, 0.03, dark); // eyes
  box(p, 0.08, 0.44, 0.38, 0.04, 0.04, 0.03, dark);
  return finish(p);
}

function buildCat() {
  const p = [];
  const body = 0xd9852f, head = 0xe09542, ear = 0xb96c26, leg = 0xc9802f, dark = 0x241f1a;
  box(p, 0.09, 0.1, 0.16, 0.08, 0.22, 0.08, leg);  // legs
  box(p, -0.09, 0.1, 0.16, 0.08, 0.22, 0.08, leg);
  box(p, 0.09, 0.1, -0.16, 0.08, 0.22, 0.08, leg);
  box(p, -0.09, 0.1, -0.16, 0.08, 0.22, 0.08, leg);
  box(p, 0, 0.3, 0, 0.26, 0.24, 0.5, body);        // body
  box(p, 0, 0.38, 0.3, 0.26, 0.24, 0.22, head);    // head
  box(p, -0.08, 0.54, 0.3, 0.07, 0.09, 0.05, ear); // ears
  box(p, 0.08, 0.54, 0.3, 0.07, 0.09, 0.05, ear);
  box(p, 0, 0.42, -0.3, 0.08, 0.08, 0.16, body);   // tail base
  box(p, 0, 0.56, -0.36, 0.08, 0.2, 0.08, body);   // tail up
  box(p, -0.07, 0.42, 0.42, 0.04, 0.05, 0.03, dark); // eyes
  box(p, 0.07, 0.42, 0.42, 0.04, 0.05, 0.03, dark);
  return finish(p);
}

function buildDuck() {
  const p = [];
  const body = 0xf0cb38, head = 0xf3d24a, beak = 0xe8902a, wing = 0xe4be32, dark = 0x231f17;
  box(p, 0.07, 0.03, -0.05, 0.06, 0.06, 0.1, beak); // feet
  box(p, -0.07, 0.03, -0.05, 0.06, 0.06, 0.1, beak);
  box(p, 0, 0.22, 0, 0.3, 0.26, 0.42, body);        // body
  box(p, 0.16, 0.24, 0.02, 0.04, 0.18, 0.26, wing); // wings
  box(p, -0.16, 0.24, 0.02, 0.04, 0.18, 0.26, wing);
  box(p, 0, 0.32, -0.24, 0.18, 0.16, 0.12, body);   // tail up
  box(p, 0, 0.46, 0.16, 0.2, 0.2, 0.2, head);       // head
  box(p, 0, 0.44, 0.32, 0.13, 0.07, 0.12, beak);    // beak
  box(p, -0.07, 0.5, 0.26, 0.04, 0.05, 0.03, dark); // eyes
  box(p, 0.07, 0.5, 0.26, 0.04, 0.05, 0.03, dark);
  return finish(p);
}

function buildDog() {
  const p = [];
  const body = 0x9a6a3c, head = 0xa6743f, snout = 0x704a28, ear = 0x5c3a20, dark = 0x231a12;
  box(p, 0.09, 0.09, 0.16, 0.07, 0.18, 0.07, body);  // legs
  box(p, -0.09, 0.09, 0.16, 0.07, 0.18, 0.07, body);
  box(p, 0.09, 0.09, -0.14, 0.07, 0.18, 0.07, body);
  box(p, -0.09, 0.09, -0.14, 0.07, 0.18, 0.07, body);
  box(p, 0, 0.28, 0, 0.22, 0.22, 0.46, body);        // body
  box(p, 0, 0.36, 0.28, 0.22, 0.22, 0.2, head);      // head
  box(p, 0, 0.31, 0.42, 0.12, 0.11, 0.1, snout);     // snout
  box(p, -0.1, 0.44, 0.28, 0.05, 0.13, 0.04, ear);   // floppy ears
  box(p, 0.1, 0.44, 0.28, 0.05, 0.13, 0.04, ear);
  box(p, 0, 0.42, -0.27, 0.06, 0.16, 0.06, body);    // tail (up)
  box(p, -0.07, 0.4, 0.4, 0.04, 0.04, 0.03, dark);   // eyes
  box(p, 0.07, 0.4, 0.4, 0.04, 0.04, 0.03, dark);
  return finish(p);
}

function buildCow() {
  const p = [];
  const white = 0xe7e3d8, patch = 0x35302c, snout = 0xd49a8c, leg = 0x33302c, horn = 0xd8d0bc, dark = 0x201c18;
  box(p, 0.14, 0.13, 0.22, 0.1, 0.26, 0.1, leg);     // legs
  box(p, -0.14, 0.13, 0.22, 0.1, 0.26, 0.1, leg);
  box(p, 0.14, 0.13, -0.22, 0.1, 0.26, 0.1, leg);
  box(p, -0.14, 0.13, -0.22, 0.1, 0.26, 0.1, leg);
  box(p, 0, 0.46, 0, 0.42, 0.36, 0.68, white);       // body
  box(p, 0.15, 0.5, 0.12, 0.14, 0.2, 0.2, patch);    // patches
  box(p, -0.16, 0.42, -0.16, 0.12, 0.18, 0.2, patch);
  box(p, 0, 0.56, 0.42, 0.3, 0.28, 0.24, white);     // head
  box(p, 0, 0.5, 0.56, 0.22, 0.18, 0.1, snout);      // muzzle
  box(p, -0.11, 0.74, 0.42, 0.05, 0.06, 0.05, horn); // horns
  box(p, 0.11, 0.74, 0.42, 0.05, 0.06, 0.05, horn);
  box(p, -0.2, 0.6, 0.42, 0.06, 0.05, 0.05, white);  // ears
  box(p, 0.2, 0.6, 0.42, 0.06, 0.05, 0.05, white);
  box(p, 0, 0.5, -0.36, 0.05, 0.32, 0.05, patch);    // tail
  box(p, -0.08, 0.58, 0.55, 0.04, 0.05, 0.03, dark); // eyes
  box(p, 0.08, 0.58, 0.55, 0.04, 0.05, 0.03, dark);
  return finish(p);
}

function buildHorse() {
  const p = [];
  const body = 0x6e4a2a, snout = 0x573922, dark = 0x1d140c;
  box(p, 0.13, 0.17, 0.24, 0.09, 0.34, 0.09, body);  // legs
  box(p, -0.13, 0.17, 0.24, 0.09, 0.34, 0.09, body);
  box(p, 0.13, 0.17, -0.24, 0.09, 0.34, 0.09, body);
  box(p, -0.13, 0.17, -0.24, 0.09, 0.34, 0.09, body);
  box(p, 0, 0.6, 0, 0.34, 0.34, 0.74, body);         // body
  box(p, 0, 0.78, 0.34, 0.18, 0.32, 0.18, body);     // neck
  box(p, 0, 0.93, 0.46, 0.16, 0.18, 0.32, body);     // head
  box(p, 0, 0.87, 0.62, 0.14, 0.14, 0.12, snout);    // muzzle
  box(p, 0, 0.9, 0.28, 0.06, 0.24, 0.18, 0x372414);  // mane
  box(p, -0.06, 1.06, 0.42, 0.05, 0.1, 0.04, body);  // ears
  box(p, 0.06, 1.06, 0.42, 0.05, 0.1, 0.04, body);
  box(p, 0, 0.62, -0.38, 0.07, 0.36, 0.07, 0x372414); // tail
  box(p, -0.08, 0.95, 0.6, 0.04, 0.05, 0.03, dark);   // eyes
  box(p, 0.08, 0.95, 0.6, 0.04, 0.05, 0.03, dark);
  return finish(p);
}

// fish: built centered on origin (swims, no feet), faces +Z
function buildFish(c1, c2, belly) {
  const p = [];
  const dark = 0x10100c;
  box(p, 0, 0, 0.02, 0.12, 0.2, 0.34, c1);           // body
  box(p, 0, -0.07, 0, 0.1, 0.06, 0.28, belly);       // belly
  box(p, 0, 0, -0.24, 0.02, 0.18, 0.14, c2);         // tail fin
  box(p, 0, 0.14, 0.0, 0.02, 0.1, 0.14, c2);         // dorsal fin
  box(p, 0.07, -0.02, 0.04, 0.08, 0.02, 0.1, c2);    // side fins
  box(p, -0.07, -0.02, 0.04, 0.08, 0.02, 0.1, c2);
  box(p, -0.05, 0.02, 0.16, 0.03, 0.03, 0.02, dark); // eyes
  box(p, 0.05, 0.02, 0.16, 0.03, 0.03, 0.02, dark);
  return finish(p);
}

const SPECIES = {
  rabbit: { speed: 2.6, hop: 0.22, idle: [0.6, 1.8], walk: [1.0, 2.2], turn: 1.4, scale: 0.95, kind: 'land' },
  cat:    { speed: 1.9, hop: 0.0,  idle: [1.2, 3.0], walk: [2.0, 4.0], turn: 0.9, scale: 1.05, kind: 'land' },
  duck:   { speed: 1.5, hop: 0.0,  idle: [0.8, 2.2], walk: [1.5, 3.2], turn: 1.1, scale: 0.95, water: true, kind: 'land' },
  dog:    { speed: 2.4, hop: 0.0,  idle: [0.8, 2.2], walk: [1.5, 3.2], turn: 1.1, scale: 1.0, kind: 'land' },
  cow:    { speed: 1.2, hop: 0.0,  idle: [1.5, 3.5], walk: [2.0, 4.5], turn: 0.7, scale: 1.0, kind: 'land' },
  horse:  { speed: 2.9, hop: 0.0,  idle: [1.0, 2.8], walk: [2.5, 5.0], turn: 0.8, scale: 1.0, kind: 'land' },
  fish:   { speed: 2.0, hop: 0.0,  idle: [0.5, 1.4], walk: [1.2, 2.6], turn: 1.7, scale: 1.0, kind: 'fish' },
};
const LAND = ['rabbit', 'cat', 'duck', 'dog', 'cow', 'horse'];
const MAX = 12;
const FISH_MAX = 7;

export class Critters {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    this.templates = {
      rabbit: buildRabbit(), cat: buildCat(), duck: buildDuck(),
      dog: buildDog(), cow: buildCow(), horse: buildHorse(),
      fish: buildFish(0xe8732e, 0xc85a22, 0xf0c39a),   // clownfish-ish
      fish2: buildFish(0x4f8fd0, 0x35699e, 0xbfd6ea),  // bluefish
    };
    this.animals = [];
    this.spawnTimer = 0.4;
    this.fishCount = 0;
    this.auto = true;
  }

  // water column at (x,z): { top, bottom } world-y of the water span, or null.
  waterColumn(x, z) {
    let top = -1;
    const scanTop = Math.min(HEIGHT - 1, 70);
    for (let y = scanTop; y > 0; y--) {
      if (this.world.getBlock(x, y, z) === B.WATER) { top = y; break; }
      if (this.world.getBlock(x, y, z) !== B.AIR) return null; // hit solid before water
    }
    if (top < 0) return null;
    let bottom = top;
    while (bottom > 1 && this.world.getBlock(x, bottom - 1, z) === B.WATER) bottom--;
    return { top, bottom };
  }

  // top air level over column (x,z): (highest solid y) + 1, or null if unloaded/none.
  groundTop(x, z, yHint) {
    const top = Math.min(HEIGHT - 1, Math.floor(yHint) + 5);
    for (let y = top; y > 0; y--) {
      const id = this.world.getBlock(x, y, z);
      if (id === B.AIR) continue;
      if (id === B.WATER) return { y: y + 1, water: true };
      if (BLOCKS[id].solid) return { y: y + 1, water: false };
    }
    return null;
  }

  spawn(species, wx, wz, yHint = 70) {
    const g = this.groundTop(Math.floor(wx), Math.floor(wz), yHint);
    if (!g) return null;
    const sp = SPECIES[species];
    if (g.water && !sp.water) return null;
    const mesh = new THREE.Mesh(this.templates[species], this.mat);
    mesh.castShadow = true;
    mesh.scale.setScalar(sp.scale);
    this.scene.add(mesh);
    const a = {
      species, sp, mesh,
      x: wx, y: g.y, z: wz,
      heading: Math.random() * Math.PI * 2,
      state: 'idle', stateT: 1 + Math.random(),
      phase: 0, dead: false,
    };
    mesh.position.set(a.x, a.y, a.z);
    mesh.rotation.y = a.heading;
    this.animals.push(a);
    return a;
  }

  spawnFish(wx, wz) {
    const x = Math.floor(wx), z = Math.floor(wz);
    const w = this.waterColumn(x, z);
    if (!w || w.top - w.bottom < 1) return null; // need >= 2 blocks of water
    const tmpl = Math.random() < 0.5 ? 'fish' : 'fish2';
    const mesh = new THREE.Mesh(this.templates[tmpl], this.mat);
    mesh.castShadow = false;
    mesh.scale.setScalar(0.9 + Math.random() * 0.3);
    this.scene.add(mesh);
    const y = w.bottom + 0.5 + Math.random() * Math.max(0.2, (w.top - w.bottom) - 0.6);
    const a = {
      species: 'fish', sp: SPECIES.fish, mesh,
      x: wx + 0.5, y, z: wz + 0.5,
      heading: Math.random() * Math.PI * 2, vy: 0,
      state: 'walk', stateT: 0.5 + Math.random(),
      phase: Math.random() * 6, dead: false,
    };
    mesh.position.set(a.x, a.y, a.z);
    this.animals.push(a);
    this.fishCount++;
    return a;
  }

  trySpawnNear(px, pz) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 11 + Math.random() * 18;
      const wx = px + Math.cos(ang) * r;
      const wz = pz + Math.sin(ang) * r;
      const g = this.groundTop(Math.floor(wx), Math.floor(wz), 70);
      if (!g) continue;
      if (g.water) {
        // water spot: usually a fish below the surface, sometimes a duck on top
        if (this.fishCount < FISH_MAX && Math.random() < 0.7) {
          if (this.spawnFish(wx, wz)) return true;
        }
        if (this.spawn('duck', wx, wz)) return true;
      } else {
        const species = LAND[(Math.random() * (LAND.length - 1)) | 0]; // land set excl. duck-only water
        if (this.spawn(species === 'duck' ? 'dog' : species, wx, wz)) return true;
      }
    }
    return false;
  }

  // fish: 3D swim confined to the water volume; tail-wiggle animation
  stepFish(a, dt) {
    const sp = a.sp;
    const x = Math.floor(a.x), z = Math.floor(a.z);
    const w = this.waterColumn(x, z);
    if (!w) { a.dead = true; return; }
    a.stateT -= dt;
    if (a.stateT <= 0) {
      a.stateT = sp.idle[0] + Math.random() * (sp.walk[1] - sp.idle[0]);
      a.heading += (Math.random() - 0.5) * 2 * sp.turn;
      a.vy = (Math.random() - 0.5) * 0.8;
    }
    const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
    const nx = a.x + fx * sp.speed * dt;
    const nz = a.z + fz * sp.speed * dt;
    let ny = a.y + a.vy * dt;
    // keep submerged with a little margin
    const lo = w.bottom + 0.35, hi = w.top + 0.7;
    if (ny < lo) { ny = lo; a.vy = Math.abs(a.vy); }
    if (ny > hi) { ny = hi; a.vy = -Math.abs(a.vy); }
    // only enter cells that are water; otherwise turn away
    if (this.world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz)) === B.WATER) {
      a.x = nx; a.z = nz; a.y = ny;
    } else {
      a.heading += 1.8 + Math.random();
      a.vy = -a.vy;
    }
    a.phase += dt * 9;
    const wiggle = Math.sin(a.phase) * 0.25;
    a.mesh.position.set(a.x, a.y, a.z);
    a.mesh.rotation.set(0, a.heading + wiggle, Math.sin(a.phase * 0.5) * 0.12);
  }

  step(a, dt, px, pz) {
    const sp = a.sp;
    a.stateT -= dt;
    if (a.stateT <= 0) {
      if (a.state === 'walk') {
        a.state = 'idle';
        a.stateT = sp.idle[0] + Math.random() * (sp.idle[1] - sp.idle[0]);
      } else {
        a.state = 'walk';
        a.stateT = sp.walk[0] + Math.random() * (sp.walk[1] - sp.walk[0]);
        a.heading += (Math.random() - 0.5) * 2 * sp.turn;
      }
    }

    let moved = false;
    if (a.state === 'walk') {
      const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
      const nx = a.x + fx * sp.speed * dt;
      const nz = a.z + fz * sp.speed * dt;
      const g = this.groundTop(Math.floor(nx), Math.floor(nz), a.y);
      if (!g) {
        a.dead = true; // wandered into unloaded world
      } else {
        const step = g.y - a.y;
        const blockedWater = g.water && !sp.water;
        if (step <= 1.05 && step >= -2.5 && !blockedWater) {
          a.x = nx; a.z = nz; a.targetY = g.y; moved = true;
        } else {
          a.heading += 1.8 + Math.random(); // turn away from wall/cliff/water
        }
      }
    }
    if (a.targetY === undefined) a.targetY = a.y;
    a.y += (a.targetY - a.y) * Math.min(1, dt * 12);

    // animation
    let yOff = 0, roll = 0;
    if (moved) {
      a.phase += dt * sp.speed * 4.5;
      if (sp.hop > 0) yOff = Math.abs(Math.sin(a.phase)) * sp.hop;      // rabbit hops
      else { yOff = Math.abs(Math.sin(a.phase)) * 0.04; roll = Math.sin(a.phase) * (a.species === 'duck' ? 0.14 : 0.06); }
    }
    a.mesh.position.set(a.x, a.y + yOff, a.z);
    a.mesh.rotation.set(0, a.heading, roll);
  }

  remove(a) {
    this.scene.remove(a.mesh);
    if (a.species === 'fish') this.fishCount--;
  }

  update(dt, playerPos) {
    const px = playerPos.x, pz = playerPos.z;
    if (this.auto) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.animals.length < MAX) {
        this.trySpawnNear(px, pz);
        // fill up faster while sparse, then relax
        this.spawnTimer = (this.animals.length < 5 ? 0.5 : 1.4) + Math.random();
      }
    }
    const d = Math.min(dt, 0.05);
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      if (a.sp.kind === 'fish') this.stepFish(a, d);
      else this.step(a, d, px, pz);
      const dx = a.x - px, dz = a.z - pz;
      if (a.dead || dx * dx + dz * dz > 44 * 44) {
        this.remove(a);
        this.animals.splice(i, 1);
      }
    }
  }
}
