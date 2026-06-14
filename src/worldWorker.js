// World worker: owns voxel + light data, generates terrain, floods light,
// meshes chunks. Main thread only mirrors voxel data for physics/raycast.
import { CHUNK, HEIGHT, CHUNK_VOL, vidx, chunkKey } from './config.js';
import { Generator } from './gen.js';
import { LightEngine } from './lighting.js';
import { meshChunk } from './mesher.js';

let gen = null;
const chunks = new Map();   // key -> { vox, light, cx, cz, meshed }
const wantMesh = new Set(); // keys requested for meshing
const lightDirty = new Set();
const genQueue = [];        // [cx, cz] pairs ordered by priority
let processing = false;

const store = {
  voxArr(cx, cz) { return chunks.get(chunkKey(cx, cz))?.vox ?? null; },
  lightArr(cx, cz) { return chunks.get(chunkKey(cx, cz))?.light ?? null; },
  blockAt(wx, y, wz) {
    if (y < 0) return 1; // treat below world as solid stone-ish
    if (y >= HEIGHT) return 0;
    const c = chunks.get(chunkKey(Math.floor(wx / CHUNK), Math.floor(wz / CHUNK)));
    if (!c) return 255;
    return c.vox[vidx(wx & 15, y, wz & 15)];
  },
  markLightDirty(cx, cz) { lightDirty.add(chunkKey(cx, cz)); },
};
const light = new LightEngine(store);

function ensureChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  let c = chunks.get(key);
  if (c) return c;
  const vox = gen.generate(cx, cz);
  const la = new Uint8Array(CHUNK_VOL);
  c = { vox, light: la, cx, cz, meshed: false };
  chunks.set(key, c);
  const { skyQ, blockQ } = light.initChunk(cx, cz, vox, la);
  lightDirty.clear(); // initial gen: neighbors get remeshed via the dirty pass below
  light.floodSky(skyQ);
  light.floodBlock(blockQ);
  // any already-meshed neighbor touched by the flood needs a remesh
  for (const dk of lightDirty) {
    if (dk !== key && chunks.get(dk)?.meshed) wantMesh.add(dk);
  }
  lightDirty.clear();
  // voxel copy for the main thread (physics + raycast)
  const copy = vox.slice();
  postMessage({ type: 'voxels', cx, cz, vox: copy }, [copy.buffer]);
  return c;
}

function neighborsReady(cx, cz) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!chunks.has(chunkKey(cx + dx, cz + dz))) return false;
    }
  }
  return true;
}

function doMesh(cx, cz) {
  const key = chunkKey(cx, cz);
  const c = chunks.get(key);
  if (!c) return;
  const geo = meshChunk(store, cx, cz);
  c.meshed = true;
  const transfer = [];
  for (const g of ['opaque', 'cutout', 'trans']) {
    const bufs = geo[g];
    if (!bufs) continue;
    transfer.push(bufs.pos.buffer, bufs.nrm.buffer, bufs.uvl.buffer,
      bufs.tile.buffer, bufs.voxel.buffer, bufs.anim.buffer, bufs.idx.buffer);
  }
  postMessage({ type: 'mesh', cx, cz, geo }, transfer);
}

function pump() {
  if (processing) return;
  processing = true;
  const step = () => {
    const t0 = performance.now();
    let did = false;
    while (performance.now() - t0 < 14) {
      // priority: pending meshes whose neighbors are ready, then generation
      let meshedOne = false;
      for (const key of wantMesh) {
        const [cx, cz] = key.split(',').map(Number);
        if (chunks.has(key) && neighborsReady(cx, cz)) {
          wantMesh.delete(key);
          doMesh(cx, cz);
          meshedOne = true; did = true;
          break;
        }
      }
      if (meshedOne) continue;
      if (genQueue.length) {
        const [cx, cz] = genQueue.shift();
        ensureChunk(cx, cz);
        did = true;
        continue;
      }
      break;
    }
    const pendingMeshable = [...wantMesh].some((key) => {
      const [cx, cz] = key.split(',').map(Number);
      return chunks.has(key) && neighborsReady(cx, cz);
    });
    if (genQueue.length || pendingMeshable) {
      setTimeout(step, 0);
    } else {
      processing = false;
      postMessage({ type: 'idle', pendingMesh: wantMesh.size });
    }
  };
  step();
}

function applyEdits(edits) {
  const dirty = new Set();
  for (const { x: wx, y, z: wz, id } of edits) {
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = chunks.get(chunkKey(cx, cz));
    if (!c || y < 0 || y >= HEIGHT) continue;
    const i = vidx(wx & 15, y, wz & 15);
    const oldId = c.vox[i];
    if (oldId === id) continue;
    c.vox[i] = id;
    lightDirty.clear();
    light.updateAtEdit(wx, y, wz, oldId, id);
    for (const dk of lightDirty) dirty.add(dk);
    lightDirty.clear();
    dirty.add(chunkKey(cx, cz));
    // border edits affect neighbor meshes (faces/AO sample across)
    const lx = wx & 15, lz = wz & 15;
    for (const [bx, bz] of [
      [lx === 0 ? -1 : lx === 15 ? 1 : 0, 0],
      [0, lz === 0 ? -1 : lz === 15 ? 1 : 0],
      [lx === 0 ? -1 : lx === 15 ? 1 : 0, lz === 0 ? -1 : lz === 15 ? 1 : 0],
    ]) {
      if (bx || bz) dirty.add(chunkKey(cx + bx, cz + bz));
    }
  }
  // remesh once after all edits (latency-sensitive, so synchronous)
  for (const dk of dirty) {
    const dc = chunks.get(dk);
    if (dc?.meshed) doMesh(dc.cx, dc.cz);
  }
}

onmessage = (ev) => {
  const m = ev.data;
  switch (m.type) {
    case 'init':
      gen = new Generator(m.seed);
      break;
    case 'load': {
      // m.gen: [[cx,cz]...] to generate; m.mesh: [[cx,cz]...] to mesh
      for (const [cx, cz] of m.gen) {
        if (!chunks.has(chunkKey(cx, cz)) && !genQueue.some((q) => q[0] === cx && q[1] === cz)) {
          genQueue.push([cx, cz]);
        }
      }
      for (const [cx, cz] of m.mesh) {
        const key = chunkKey(cx, cz);
        if (!chunks.get(key)?.meshed) wantMesh.add(key);
      }
      pump();
      break;
    }
    case 'unmesh':
      for (const key of m.keys) {
        wantMesh.delete(key);
        const c = chunks.get(key);
        if (c) c.meshed = false;
      }
      break;
    case 'edit':
      applyEdits([m]);
      break;
    case 'editBatch':
      applyEdits(m.edits);
      break;
  }
};
