// Deterministic terrain generation. Worker-safe (no DOM, no three).
import { CHUNK, HEIGHT, SEA, CHUNK_VOL, vidx } from './config.js';
import { B } from './blocks.js';
import { strSeed, mulberry32, makeSimplex, fbm2, fbm3, ridged2, hash2 } from './noise.js';

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Generator {
  constructor(seedStr) {
    const s = strSeed(seedStr);
    this.hashSeed = s;
    const mk = (salt) => makeSimplex(mulberry32(s ^ salt));
    this.nContinent = mk(0x1111);
    this.nDetail = mk(0x2222);
    this.nTemp = mk(0x3333);
    this.nMoist = mk(0x4444);
    this.nMountain = mk(0x5555);
    this.nMountMask = mk(0x6666);
    this.nCaveA = mk(0x7777);
    this.nCaveB = mk(0x8888);
    this.nCheese = mk(0x9999);
    this.nDune = mk(0xaaaa);
    this.colCache = new Map();
  }

  // biome/height info for a world column (cached)
  column(wx, wz) {
    const key = wx + ',' + wz;
    const c = this.colCache.get(key);
    if (c) return c;
    if (this.colCache.size > 60000) this.colCache.clear();

    const cont = fbm2(this.nContinent, wx * 0.0011, wz * 0.0011, 3);
    const temp = fbm2(this.nTemp, wx * 0.0016, wz * 0.0016, 2) * 0.5 + 0.5;
    const moist = fbm2(this.nMoist, wx * 0.0019, wz * 0.0019, 2) * 0.5 + 0.5;
    const mountMask = smoothstep(0.32, 0.72, fbm2(this.nMountMask, wx * 0.0019, wz * 0.0019, 2) * 0.5 + 0.5);
    const detail = fbm2(this.nDetail, wx * 0.02, wz * 0.02, 4);

    // biome weights
    let wDesert = smoothstep(0.58, 0.72, temp) * smoothstep(0.52, 0.34, moist);
    let wForest = smoothstep(0.45, 0.62, moist) * (1 - wDesert);
    let wHills = mountMask;
    let wPlains = Math.max(0, 1 - wDesert - wForest * 0.8 - wHills * 0.6);
    const wSum = wDesert + wForest + wPlains + wHills;
    wDesert /= wSum; wForest /= wSum; wPlains /= wSum; wHills /= wSum;

    const base = SEA + 2 + cont * 11;
    const plainsH = base + detail * 2.6;
    const forestH = base + 1.5 + detail * 4.5;
    const duneH = base + Math.abs(fbm2(this.nDune, wx * 0.012, wz * 0.012, 2)) * 7 + detail * 1.2;
    const ridge = ridged2(this.nMountain, wx * 0.004, wz * 0.004, 4); // ~0..1
    const hillsH = base + 3 + Math.pow(Math.max(0, ridge - 0.35), 1.6) * 95 + detail * 5;

    let h = plainsH * wPlains + forestH * wForest + duneH * wDesert + hillsH * wHills;
    h = Math.round(Math.min(HEIGHT - 8, Math.max(4, h)));

    // dominant biome for surface decoration
    let biome = 'plains', wMax = wPlains;
    if (wForest > wMax) { biome = 'forest'; wMax = wForest; }
    if (wDesert > wMax) { biome = 'desert'; wMax = wDesert; }
    if (wHills > 0.45 && h > SEA + 14) biome = 'hills';

    const out = { h, biome, temp, moist };
    this.colCache.set(key, out);
    return out;
  }

  carved(wx, y, wz, h) {
    // spaghetti caves: intersection of two band noises
    const t = 0.085 + 0.05 * smoothstep(40, 5, y);
    const a = fbm3(this.nCaveA, wx * 0.017, y * 0.028, wz * 0.017, 2);
    if (Math.abs(a) > t + 0.04) return false; // early out
    const b = fbm3(this.nCaveB, wx * 0.017, y * 0.031, wz * 0.017, 2);
    if (Math.abs(a) < t && Math.abs(b) < t + 0.02) return true;
    // cheese caverns, deep only
    if (y < 34) {
      const c = fbm3(this.nCheese, wx * 0.021, y * 0.042, wz * 0.021, 2);
      if (c > 0.66 - 0.12 * smoothstep(34, 8, y)) return true;
    }
    return false;
  }

  treeAt(wx, wz) {
    const col = this.column(wx, wz);
    if (col.h <= SEA + 1) return 0;
    const r = hash2(wx, wz, this.hashSeed ^ 0xbeef);
    if (col.biome === 'forest' && r < 0.022) return 1;
    if (col.biome === 'plains' && r < 0.0035) return 1;
    if (col.biome === 'desert' && r < 0.006) return 2; // cactus
    return 0;
  }

  generate(cx, cz) {
    const vox = new Uint8Array(CHUNK_VOL);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;

    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const wx = x0 + x, wz = z0 + z;
        const { h, biome } = this.column(wx, wz);
        const beach = h <= SEA + 2;
        const snowy = h >= SEA + 34;

        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y === h) {
            if (biome === 'desert' || beach) id = B.SAND;
            else if (snowy) id = B.SNOW;
            else if (biome === 'hills' && h > SEA + 22) id = B.STONE;
            else id = B.GRASS;
          } else if (y > h - 4) {
            if (biome === 'desert' || beach) id = B.SAND;
            else if (biome === 'hills' && h > SEA + 22) id = B.STONE;
            else id = B.DIRT;
          } else id = B.STONE;

          // carve caves (keep sea floor intact near/below sea level columns)
          if (id !== B.BEDROCK && y > 0) {
            const protectTop = h < SEA + 2 ? 10 : 0;
            if (y < h - protectTop || h >= SEA + 2) {
              if (this.carved(wx, y, wz, h)) {
                id = y <= 9 ? B.LAVA : B.AIR;
              }
            }
          }
          vox[vidx(x, y, z)] = id;
        }
        // water fill
        if (h < SEA) {
          for (let y = h + 1; y <= SEA; y++) {
            if (vox[vidx(x, y, z)] === B.AIR) vox[vidx(x, y, z)] = B.WATER;
          }
        }

        // surface decoration (only on intact surface)
        if (vox[vidx(x, h, z)] === B.GRASS && h + 1 < HEIGHT) {
          const r = hash2(wx, wz, this.hashSeed ^ 0xfeed);
          const above = vidx(x, h + 1, z);
          if (vox[above] === B.AIR) {
            if (biome === 'plains' || biome === 'forest') {
              if (r > 0.997) vox[above] = B.POPPY;
              else if (r > 0.994) vox[above] = B.DANDELION;
              else if (r > (biome === 'plains' ? 0.90 : 0.93)) vox[above] = B.TALLGRASS;
            }
          }
        }
      }
    }

    // trees / cacti from a margin so canopies cross chunk borders deterministically
    for (let z = -3; z < CHUNK + 3; z++) {
      for (let x = -3; x < CHUNK + 3; x++) {
        const wx = x0 + x, wz = z0 + z;
        const kind = this.treeAt(wx, wz);
        if (!kind) continue;
        const col = this.column(wx, wz);
        const h = col.h;
        // tree must stand on intact grass surface (re-check carve at h)
        if (this.carved(wx, h, wz, h)) continue;
        const r = hash2(wx * 3 + 1, wz * 5 + 2, this.hashSeed);
        if (kind === 2) {
          // cactus
          const ch = 2 + Math.floor(r * 2);
          for (let dy = 1; dy <= ch; dy++) this.put(vox, x, h + dy, z, B.CACTUS);
          continue;
        }
        const th = 4 + Math.floor(r * 3); // trunk height
        for (let dy = 1; dy <= th; dy++) this.put(vox, x, h + dy, z, B.LOG, true);
        // canopy
        for (let ly = th - 2; ly <= th + 1; ly++) {
          const rad = ly >= th ? 1 : 2;
          for (let dz = -rad; dz <= rad; dz++) {
            for (let dx = -rad; dx <= rad; dx++) {
              if (dx === 0 && dz === 0 && ly <= th) continue;
              if (Math.abs(dx) === rad && Math.abs(dz) === rad) {
                if (hash2(wx + dx * 7, wz + dz * 13 + ly, this.hashSeed) > 0.45) continue;
              }
              this.put(vox, x + dx, h + ly, z + dz, B.LEAVES);
            }
          }
        }
        this.put(vox, x, h + th + 2, z, B.LEAVES);
      }
    }
    return vox;
  }

  put(vox, x, y, z, id, force = false) {
    if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || y < 0 || y >= HEIGHT) return;
    const i = vidx(x, y, z);
    if (force || vox[i] === B.AIR || vox[i] === B.LEAVES) vox[i] = id;
  }
}
