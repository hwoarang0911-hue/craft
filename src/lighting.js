// Voxel light engine: sky light + block light flood fill over a chunk store.
// Light is packed per cell in a Uint8Array: high nibble = sky, low nibble = block.
// Worker-safe; operates through a store interface:
//   store.blockAt(wx, y, wz)  -> block id (255 if chunk not loaded)
//   store.lightArr(cx, cz)    -> Uint8Array | null
//   store.markLightDirty(cx, cz)
import { CHUNK, HEIGHT, vidx } from './config.js';
import { BLOCKS, B } from './blocks.js';

export const skyOf = (l) => l >> 4;
export const blockOf = (l) => l & 15;

const OPQ = new Uint8Array(256);
const ATT = new Uint8Array(256);
const EMIT = new Uint8Array(256);
for (let i = 0; i < BLOCKS.length; i++) {
  OPQ[i] = BLOCKS[i].opaque ? 1 : 0;
  ATT[i] = BLOCKS[i].atten;
  EMIT[i] = BLOCKS[i].emit;
}
OPQ[255] = 1; // unloaded chunks block light (re-flooded when they arrive)

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

export class LightEngine {
  constructor(store) {
    this.store = store;
  }

  getLight(wx, y, wz) {
    if (y < 0 || y >= HEIGHT) return 0xf0; // above world = full sky
    const arr = this.store.lightArr(Math.floor(wx / CHUNK), Math.floor(wz / CHUNK));
    if (!arr) return 0;
    return arr[vidx(wx & 15, y, wz & 15)];
  }

  setLight(wx, y, wz, v) {
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const arr = this.store.lightArr(cx, cz);
    if (!arr) return;
    arr[vidx(wx & 15, y, wz & 15)] = v;
    const lx = wx & 15, lz = wz & 15;
    this.store.markLightDirty(cx, cz);
    // light at chunk borders affects neighbor meshes (smooth lighting samples)
    if (lx === 0) this.store.markLightDirty(cx - 1, cz);
    if (lx === 15) this.store.markLightDirty(cx + 1, cz);
    if (lz === 0) this.store.markLightDirty(cx, cz - 1);
    if (lz === 15) this.store.markLightDirty(cx, cz + 1);
  }

  // Initial lighting for a freshly generated chunk: vertical sky columns +
  // emitters, then seeds returned for a world flood (caller floods).
  initChunk(cx, cz, vox, light) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const skyQ = [], blockQ = [];
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        let level = 15;
        for (let y = HEIGHT - 1; y >= 0; y--) {
          const i = vidx(x, y, z);
          const id = vox[i];
          if (id !== B.AIR) {
            if (OPQ[id] && EMIT[id] === 0) level = 0;
            else level = Math.max(0, level - Math.max(1, ATT[id]));
          }
          if (level > 0) light[i] = level << 4;
          if (EMIT[id] > 0) {
            light[i] = (light[i] & 0xf0) | EMIT[id];
            blockQ.push(x0 + x, y, z0 + z);
          }
          if (level > 1) skyQ.push(x0 + x, y, z0 + z);
        }
      }
    }
    // seed from already-lit neighbor borders so light flows into this chunk
    for (let z = -1; z <= CHUNK; z++) {
      for (let x = -1; x <= CHUNK; x++) {
        if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK) continue;
        if ((x === -1 || x === CHUNK) && (z === -1 || z === CHUNK)) continue;
        const wx = x0 + x, wz = z0 + z;
        for (let y = 0; y < HEIGHT; y++) {
          const l = this.getLight(wx, y, wz);
          if (skyOf(l) > 1) skyQ.push(wx, y, wz);
          if (blockOf(l) > 1) blockQ.push(wx, y, wz);
        }
      }
    }
    return { skyQ, blockQ };
  }

  floodSky(queue) { this._flood(queue, true); }
  floodBlock(queue) { this._flood(queue, false); }

  _flood(queue, isSky) {
    // queue: flat [x,y,z, ...]
    for (let qi = 0; qi < queue.length; qi += 3) {
      const x = queue[qi], y = queue[qi + 1], z = queue[qi + 2];
      const cur = this.getLight(x, y, z);
      const level = isSky ? skyOf(cur) : blockOf(cur);
      if (level <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= HEIGHT) continue;
        const id = this.store.blockAt(nx, ny, nz);
        if (id === 255 || OPQ[id]) continue;
        const att = Math.max(1, ATT[id]);
        // sky light travels straight down without loss through air
        let target;
        if (isSky && d === 3 && level === 15 && ATT[id] === 0) target = 15;
        else target = level - att;
        if (target <= 0) continue;
        const nl = this.getLight(nx, ny, nz);
        const nLevel = isSky ? skyOf(nl) : blockOf(nl);
        if (nLevel >= target) continue;
        const packed = isSky ? ((target << 4) | (nl & 15)) : ((nl & 0xf0) | target);
        this.setLight(nx, ny, nz, packed);
        queue.push(nx, ny, nz);
      }
    }
  }

  // Standard two-phase removal. Returns nothing; re-floods internally.
  _remove(x, y, z, isSky) {
    const start = this.getLight(x, y, z);
    const startLevel = isSky ? skyOf(start) : blockOf(start);
    this.setLight(x, y, z, isSky ? (start & 15) : (start & 0xf0));
    const removeQ = [x, y, z, startLevel];
    const refillQ = [];
    for (let qi = 0; qi < removeQ.length; qi += 4) {
      const cx = removeQ[qi], cy = removeQ[qi + 1], cz = removeQ[qi + 2], lvl = removeQ[qi + 3];
      for (let d = 0; d < 6; d++) {
        const nx = cx + DX[d], ny = cy + DY[d], nz = cz + DZ[d];
        if (ny < 0 || ny >= HEIGHT) continue;
        const nl = this.getLight(nx, ny, nz);
        const nLevel = isSky ? skyOf(nl) : blockOf(nl);
        if (nLevel === 0) continue;
        const fedByMe = nLevel < lvl || (isSky && d === 3 && lvl === 15 && nLevel === 15);
        if (fedByMe) {
          this.setLight(nx, ny, nz, isSky ? (nl & 15) : (nl & 0xf0));
          removeQ.push(nx, ny, nz, nLevel);
        } else {
          refillQ.push(nx, ny, nz);
        }
      }
    }
    this._flood(refillQ, isSky);
  }

  // Called after a block edit at (x,y,z): fix both channels.
  updateAtEdit(x, y, z, oldId, newId) {
    // block light channel
    if (EMIT[oldId] > 0) this._remove(x, y, z, false);
    if (EMIT[newId] > 0) {
      const l = this.getLight(x, y, z);
      this.setLight(x, y, z, (l & 0xf0) | EMIT[newId]);
      this.floodBlock([x, y, z]);
    }
    const wasOpen = !OPQ[oldId], nowOpen = !OPQ[newId];
    if (wasOpen && !nowOpen) {
      // cell got blocked: kill light passing through it
      this._remove(x, y, z, true);
      if (EMIT[newId] === 0) this._remove(x, y, z, false);
    } else if (nowOpen) {
      // cell opened (or stayed open with different attenuation): re-pull from neighbors
      this._remove(x, y, z, true);
      if (EMIT[newId] === 0 && EMIT[oldId] === 0) this._remove(x, y, z, false);
      const seeds = [];
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        seeds.push(nx, ny, nz);
      }
      // above-world sky feed
      if (y === HEIGHT - 1) {
        const l = this.getLight(x, y, z);
        this.setLight(x, y, z, (15 << 4) | (l & 15));
        seeds.push(x, y, z);
      }
      this.floodSky(seeds.slice());
      this.floodBlock(seeds.slice());
    }
  }
}
