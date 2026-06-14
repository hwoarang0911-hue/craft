// Main-thread world manager: talks to the world worker, owns chunk meshes,
// mirrors voxel data for physics/raycast, streams chunks around the player.
import * as THREE from 'three';
import { CHUNK, HEIGHT, RENDER_DIST, GEN_DIST, UNLOAD_DIST, SEED, vidx, chunkKey } from './config.js';
import { BLOCKS, B } from './blocks.js';
// inline worker so the build also runs from a single self-contained HTML file
import WorldWorker from './worldWorker.js?worker&inline';

export class World {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.voxels = new Map();   // key -> Uint8Array (mirror for physics)
    this.meshes = new Map();   // key -> { opaque, cutout, trans }
    this.meshedKeys = new Set();
    this.lastChunk = null;
    this.workerIdle = false;
    this.pendingMesh = 1;
    this.onChunkMeshed = null;

    this.worker = new WorldWorker();
    this.worker.onmessage = (ev) => this.onMessage(ev.data);
    // route a worker failure (e.g. blocked inline worker) to the on-screen error
    this.worker.onerror = (e) => {
      window.dispatchEvent(new ErrorEvent('error',
        { message: 'world worker failed: ' + (e.message || 'could not start') }));
    };
    this.worker.postMessage({ type: 'init', seed: SEED });
  }

  onMessage(m) {
    if (m.type === 'voxels') {
      this.voxels.set(chunkKey(m.cx, m.cz), m.vox);
    } else if (m.type === 'mesh') {
      this.buildMeshes(m.cx, m.cz, m.geo);
      this.meshedKeys.add(chunkKey(m.cx, m.cz));
      this.onChunkMeshed?.(m.cx, m.cz);
    } else if (m.type === 'idle') {
      this.workerIdle = true;
      this.pendingMesh = m.pendingMesh;
    }
  }

  buildMeshes(cx, cz, geo) {
    const key = chunkKey(cx, cz);
    this.disposeMeshes(key);
    const set = {};
    for (const g of ['opaque', 'cutout', 'trans']) {
      const p = geo[g];
      if (!p) continue;
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
      bg.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 3));
      bg.setAttribute('uvl', new THREE.BufferAttribute(p.uvl, 2));
      bg.setAttribute('tile', new THREE.BufferAttribute(p.tile, 2));
      bg.setAttribute('voxel', new THREE.BufferAttribute(p.voxel, 3, true));
      bg.setAttribute('anim', new THREE.BufferAttribute(p.anim, 2, true));
      bg.setIndex(new THREE.BufferAttribute(p.idx, 1));
      bg.computeBoundingSphere();
      const mesh = new THREE.Mesh(bg, this.materials[g]);
      mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.castShadow = g !== 'trans';
      mesh.receiveShadow = true;
      if (g === 'trans') mesh.renderOrder = 10;
      this.scene.add(mesh);
      set[g] = mesh;
    }
    this.meshes.set(key, set);
  }

  disposeMeshes(key) {
    const old = this.meshes.get(key);
    if (!old) return;
    for (const g of Object.values(old)) {
      this.scene.remove(g);
      g.geometry.dispose();
    }
    this.meshes.delete(key);
  }

  update(playerPos) {
    const cx = Math.floor(playerPos.x / CHUNK);
    const cz = Math.floor(playerPos.z / CHUNK);
    const ck = chunkKey(cx, cz);
    if (ck === this.lastChunk) return;
    this.lastChunk = ck;

    const mesh = [];
    const genSet = new Map(); // key -> [cx, cz, d2]
    const addGen = (gx, gz) => {
      const k = chunkKey(gx, gz);
      const ddx = gx - cx, ddz = gz - cz;
      if (!genSet.has(k)) genSet.set(k, [gx, gz, ddx * ddx + ddz * ddz]);
    };
    for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
      for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > RENDER_DIST * RENDER_DIST + 2) continue;
        // meshing a chunk needs all 8 neighbors generated
        for (let nz = -1; nz <= 1; nz++) {
          for (let nx = -1; nx <= 1; nx++) addGen(cx + dx + nx, cz + dz + nz);
        }
        if (!this.meshedKeys.has(chunkKey(cx + dx, cz + dz))) {
          mesh.push([cx + dx, cz + dz, d2]);
        }
      }
    }
    const gen = [...genSet.values()];
    gen.sort((a, b) => a[2] - b[2]);
    mesh.sort((a, b) => a[2] - b[2]);
    this.workerIdle = false;
    this.worker.postMessage({
      type: 'load',
      gen: gen.map((g) => [g[0], g[1]]),
      mesh: mesh.map((g) => [g[0], g[1]]),
    });

    // unload far meshes
    const drop = [];
    for (const key of this.meshedKeys) {
      const [kx, kz] = key.split(',').map(Number);
      const ddx = kx - cx, ddz = kz - cz;
      if (ddx * ddx + ddz * ddz > UNLOAD_DIST * UNLOAD_DIST) {
        this.disposeMeshes(key);
        this.meshedKeys.delete(key);
        drop.push(key);
      }
    }
    if (drop.length) this.worker.postMessage({ type: 'unmesh', keys: drop });
  }

  ready(playerPos) {
    const cx = Math.floor(playerPos.x / CHUNK);
    const cz = Math.floor(playerPos.z / CHUNK);
    for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
      for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
        if (dx * dx + dz * dz > RENDER_DIST * RENDER_DIST + 2) continue;
        if (!this.meshedKeys.has(chunkKey(cx + dx, cz + dz))) return false;
      }
    }
    return true;
  }

  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= HEIGHT) return B.AIR;
    const arr = this.voxels.get(chunkKey(Math.floor(wx / CHUNK), Math.floor(wz / CHUNK)));
    if (!arr) return B.AIR;
    return arr[vidx(wx & 15, wy, wz & 15)];
  }

  isSolid(wx, wy, wz) {
    return BLOCKS[this.getBlock(wx, wy, wz)].solid;
  }

  setBlock(wx, wy, wz, id) {
    if (wy < 0 || wy >= HEIGHT) return;
    const arr = this.voxels.get(chunkKey(Math.floor(wx / CHUNK), Math.floor(wz / CHUNK)));
    if (!arr) return;
    arr[vidx(wx & 15, wy, wz & 15)] = id;
    this.worker.postMessage({ type: 'edit', x: wx, y: wy, z: wz, id });
  }

  setBlocks(edits) {
    const ok = [];
    for (const e of edits) {
      if (e.y < 0 || e.y >= HEIGHT) continue;
      const arr = this.voxels.get(chunkKey(Math.floor(e.x / CHUNK), Math.floor(e.z / CHUNK)));
      if (!arr) continue;
      arr[vidx(e.x & 15, e.y, e.z & 15)] = e.id;
      ok.push(e);
    }
    if (ok.length) this.worker.postMessage({ type: 'editBatch', edits: ok });
  }
}
