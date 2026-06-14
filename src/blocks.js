// Block definitions (worker-safe) + procedural texture atlas (main thread only).
import { hash2 } from './noise.js';

// ---- tile ids in the atlas ----
export const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4,
  LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7, WATER: 8, GLASS: 9,
  TORCH: 10, LAVA: 11, TALLGRASS: 12, POPPY: 13, DANDELION: 14,
  SNOW: 15, SNOW_SIDE: 16, BEDROCK: 17, CACTUS_SIDE: 18, CACTUS_TOP: 19,
  PLANKS: 20, TORCH_TOP: 21, TNT_SIDE: 22, TNT_TOP: 23, TNT_BOT: 24,
};

export const ATLAS_COLS = 8;       // cells per row
export const CELL = 32;            // px per atlas cell (16 content + 8 pad each side)
export const PAD = 8;
export const TILE_PX = 16;
export const ATLAS_SIZE = ATLAS_COLS * CELL; // 256

// ---- block ids ----
export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6,
  WATER: 7, GLASS: 8, TORCH: 9, LAVA: 10, SNOW: 11, BEDROCK: 12,
  TALLGRASS: 13, POPPY: 14, DANDELION: 15, CACTUS: 16, TNT: 17,
};

// tiles: [+x, -x, +y, -y, +z, -z]
const cube = (t) => [t, t, t, t, t, t];
export const BLOCKS = [];
function def(id, name, opts) {
  BLOCKS[id] = {
    id, name,
    render: opts.render ?? 'cube',         // cube | cross | liquid | torch | none
    solid: opts.solid ?? true,             // collision
    opaque: opts.opaque ?? true,           // light fully blocked / hides neighbor faces
    atten: opts.atten ?? 0,                // extra light attenuation for non-opaque
    emit: opts.emit ?? 0,                  // block light emission 0..15
    hard: opts.hard ?? 0.6,                // seconds to break
    tiles: opts.tiles ?? cube(T.STONE),
    group: opts.group ?? 'opaque',         // opaque | cutout | trans
    glow: opts.glow ?? 0,                  // emissive boost baked per-vertex
    sway: opts.sway ?? 0,
  };
}

def(B.AIR, 'Air', { render: 'none', solid: false, opaque: false, hard: 0 });
def(B.GRASS, 'Grass', { tiles: [T.GRASS_SIDE, T.GRASS_SIDE, T.GRASS_TOP, T.DIRT, T.GRASS_SIDE, T.GRASS_SIDE], hard: 0.45 });
def(B.DIRT, 'Dirt', { tiles: cube(T.DIRT), hard: 0.4 });
def(B.STONE, 'Stone', { tiles: cube(T.STONE), hard: 1.4 });
def(B.SAND, 'Sand', { tiles: cube(T.SAND), hard: 0.4 });
def(B.LOG, 'Oak Log', { tiles: [T.LOG_SIDE, T.LOG_SIDE, T.LOG_TOP, T.LOG_TOP, T.LOG_SIDE, T.LOG_SIDE], hard: 1.0 });
def(B.LEAVES, 'Leaves', { tiles: cube(T.LEAVES), opaque: false, atten: 1, group: 'cutout', hard: 0.25, sway: 1 });
def(B.WATER, 'Water', { render: 'liquid', solid: false, opaque: false, atten: 2, group: 'trans', hard: Infinity });
def(B.GLASS, 'Glass', { tiles: cube(T.GLASS), opaque: false, group: 'trans', hard: 0.3 });
def(B.TORCH, 'Torch', { render: 'torch', solid: false, opaque: false, emit: 14, group: 'cutout', hard: 0.05, glow: 1, tiles: cube(T.TORCH) });
def(B.LAVA, 'Lava', { render: 'liquid', solid: false, opaque: true, emit: 15, group: 'opaque', hard: Infinity, glow: 1, tiles: cube(T.LAVA) });
def(B.SNOW, 'Snowy Grass', { tiles: [T.SNOW_SIDE, T.SNOW_SIDE, T.SNOW, T.DIRT, T.SNOW_SIDE, T.SNOW_SIDE], hard: 0.5 });
def(B.BEDROCK, 'Bedrock', { tiles: cube(T.BEDROCK), hard: Infinity });
def(B.TALLGRASS, 'Tall Grass', { render: 'cross', solid: false, opaque: false, group: 'cutout', hard: 0.05, tiles: cube(T.TALLGRASS), sway: 1 });
def(B.POPPY, 'Poppy', { render: 'cross', solid: false, opaque: false, group: 'cutout', hard: 0.05, tiles: cube(T.POPPY), sway: 1 });
def(B.DANDELION, 'Dandelion', { render: 'cross', solid: false, opaque: false, group: 'cutout', hard: 0.05, tiles: cube(T.DANDELION), sway: 1 });
def(B.CACTUS, 'Cactus', { tiles: [T.CACTUS_SIDE, T.CACTUS_SIDE, T.CACTUS_TOP, T.CACTUS_TOP, T.CACTUS_SIDE, T.CACTUS_SIDE], hard: 0.4 });
def(B.TNT, 'TNT', { tiles: [T.TNT_SIDE, T.TNT_SIDE, T.TNT_TOP, T.TNT_BOT, T.TNT_SIDE, T.TNT_SIDE], hard: 0.2 });

export const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.SAND, B.LOG, B.LEAVES, B.GLASS, B.TORCH, B.TNT];

export const isOpaque = (id) => BLOCKS[id]?.opaque ?? false;
export const isSolid = (id) => BLOCKS[id]?.solid ?? false;
export const atten = (id) => BLOCKS[id]?.atten ?? 0;
export const emit = (id) => BLOCKS[id]?.emit ?? 0;

// =====================================================================
// Procedural atlas (main thread only — uses canvas)
// =====================================================================

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// per-tile pixel painters: (x, y, rnd) -> [r, g, b, a]
function painter(tile) {
  const n = (x, y, s = 0) => hash2(x + tile * 131, y + s * 977, 0x9e3779b9);
  const vnoise = (x, y, scale, s = 0) => {
    // value noise on 16px tile, wrapping
    const fx = (x / scale), fy = (y / scale);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const w = 16 / scale;
    const h = (i, j) => n(((i % w) + w) % w, ((j % w) + w) % w, s + 7);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (h(x0, y0) * (1 - sx) + h(x0 + 1, y0) * sx) * (1 - sy) +
           (h(x0, y0 + 1) * (1 - sx) + h(x0 + 1, y0 + 1) * sx) * sy;
  };
  switch (tile) {
    case T.GRASS_TOP: return (x, y) => {
      const v = vnoise(x, y, 4, 1) * 0.5 + n(x, y) * 0.5;
      const blade = n(x, y, 3) > 0.88;
      let r = 74 + v * 28, g = 124 + v * 34, b = 52 + v * 20;
      if (blade) { r += 14; g += 22; b += 6; }
      return [r, g, b, 255];
    };
    case T.GRASS_SIDE: return (x, y) => {
      const edge = 3 + Math.round(n(x, 0, 5) * 2.2);
      if (y < edge) {
        const v = n(x, y, 1);
        return [72 + v * 26, 120 + v * 32, 50 + v * 18, 255];
      }
      const v = vnoise(x, y, 4, 2) * 0.6 + n(x, y) * 0.4;
      return [118 + v * 26, 85 + v * 20, 58 + v * 14, 255];
    };
    case T.DIRT: return (x, y) => {
      const v = vnoise(x, y, 4, 2) * 0.6 + n(x, y) * 0.4;
      const pebble = n(x, y, 9) > 0.93;
      let r = 118 + v * 28, g = 85 + v * 21, b = 58 + v * 15;
      if (pebble) { r *= 0.72; g *= 0.72; b *= 0.74; }
      return [r, g, b, 255];
    };
    case T.STONE: return (x, y) => {
      const v = vnoise(x, y, 5, 3) * 0.65 + n(x, y) * 0.35;
      const crack = vnoise(x + 31, y * 1.7, 3, 4);
      let l = 118 + v * 34;
      if (crack > 0.78) l *= 0.74;
      return [l, l * 0.99, l * 0.96, 255];
    };
    case T.SAND: return (x, y) => {
      const ripple = Math.sin((y + vnoise(x, y, 5, 1) * 4) * 1.1) * 0.5 + 0.5;
      const v = n(x, y) * 0.5 + ripple * 0.5;
      return [188 + v * 24, 167 + v * 22, 118 + v * 20, 255];
    };
    case T.LOG_SIDE: return (x, y) => {
      const streak = vnoise(x * 3, y, 6, 1);
      const v = streak * 0.7 + n(x, y) * 0.3;
      const groove = (n(x, 0, 6) > 0.7 && n(x, y, 8) > 0.45);
      let r = 96 + v * 30, g = 72 + v * 22, b = 44 + v * 14;
      if (groove) { r *= 0.7; g *= 0.7; b *= 0.7; }
      return [r, g, b, 255];
    };
    case T.LOG_TOP: return (x, y) => {
      const d = Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2);
      const ring = Math.sin(d * 2.6 + vnoise(x, y, 6, 2) * 2) * 0.5 + 0.5;
      const v = ring * 0.7 + n(x, y) * 0.3;
      if (d > 7.2) return [88, 66, 40, 255];
      return [142 + v * 32, 110 + v * 26, 70 + v * 18, 255];
    };
    case T.LEAVES: return (x, y) => {
      const v = vnoise(x, y, 4, 1) * 0.55 + n(x, y) * 0.45;
      const hole = n(x, y, 11) > 0.88;
      if (hole) return [0, 0, 0, 0];
      const deep = n(x, y, 12) > 0.72;
      let r = 64 + v * 40, g = 122 + v * 48, b = 50 + v * 26;
      if (deep) { r *= 0.7; g *= 0.7; b *= 0.7; }
      return [r, g, b, 255];
    };
    case T.WATER: return (x, y) => {
      // flat color: all surface detail comes from shader ripples/reflection
      const v = n(x, y) * 0.12;
      return [16 + v * 6, 50 + v * 8, 112 + v * 10, 235];
    };
    case T.GLASS: return (x, y) => {
      const border = x === 0 || y === 0 || x === 15 || y === 15;
      if (border) return [205, 225, 235, 180];
      const shine = (x + y === 12 || x + y === 13 || x + y === 21);
      if (shine && x > 2 && y > 2) return [235, 245, 250, 95];
      return [200, 225, 235, 24];
    };
    case T.TORCH: return (x, y) => {
      // stick in middle columns, glowing head on top portion
      if (x < 6 || x > 9) return [0, 0, 0, 0];
      if (y < 4) {
        const f = n(x, y, 2);
        if (y === 0 && (x === 6 || x === 9)) return [255, 220, 130, 255];
        return [252 - f * 30, 196 - f * 50, 88 - f * 30, 255];
      }
      const v = n(x, y);
      return [110 + v * 26, 80 + v * 20, 48 + v * 12, 255];
    };
    case T.TORCH_TOP: return (x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 2) return [0, 0, 0, 0];
      return [255, 228, 140, 255];
    };
    case T.LAVA: return (x, y) => {
      const v = vnoise(x, y, 5, 1);
      const crust = vnoise(x + 17, y + 9, 4, 3) > 0.62;
      if (crust) return [96 + v * 40, 30 + v * 16, 12, 255];
      const hot = vnoise(x, y, 3, 5);
      return [240 + hot * 15, 120 + hot * 90, 24 + hot * 30, 255];
    };
    case T.TALLGRASS: return (x, y) => {
      // fan of blades rising from the bottom center
      for (let b = 0; b < 9; b++) {
        const baseX = 3 + b * 1.25 + n(b, 0, 4) * 1.5;
        const lean = (baseX - 8) * 0.09 + (n(b, 1, 5) - 0.5) * 0.22;
        const h = 6 + n(b, 2, 6) * 9;          // blade height
        const topY = 16 - h;
        if (y < topY) continue;
        const bladeX = baseX + (16 - y) * lean * 1.6;
        if (Math.abs(x - bladeX) < 0.75) {
          const v = n(x, y, 7);
          const tip = y < topY + 2 ? 1.18 : 1;
          return [(92 + v * 30) * tip, (152 + v * 38) * tip, (62 + v * 20) * tip, 255];
        }
      }
      return [0, 0, 0, 0];
    };
    case T.POPPY: return (x, y) => {
      const cx = 7.5, stem = Math.abs(x - cx) < 0.9 && y > 5;
      const d = Math.sqrt((x - 7.5) ** 2 + (y - 4) ** 2);
      if (d < 2.6) {
        const v = n(x, y, 2);
        if (d < 0.9) return [40, 30, 26, 255];
        return [205 + v * 40, 40 + v * 26, 38 + v * 18, 255];
      }
      if (stem) return [70, 120, 52, 255];
      if (Math.abs(x - cx - 2.5) < 1 && Math.abs(y - 10) < 1) return [70, 120, 52, 255];
      return [0, 0, 0, 0];
    };
    case T.DANDELION: return (x, y) => {
      const cx = 7.5, stem = Math.abs(x - cx) < 0.9 && y > 5;
      const d = Math.sqrt((x - 7.5) ** 2 + (y - 4.2) ** 2);
      if (d < 2.3) {
        const v = n(x, y, 2);
        return [240 + v * 15, 200 + v * 30, 50 + v * 30, 255];
      }
      if (stem) return [70, 120, 52, 255];
      return [0, 0, 0, 0];
    };
    case T.SNOW: return (x, y) => {
      const v = vnoise(x, y, 5, 1) * 0.5 + n(x, y) * 0.5;
      return [228 + v * 22, 234 + v * 18, 244 + v * 11, 255];
    };
    case T.SNOW_SIDE: return (x, y) => {
      const edge = 4 + Math.round(n(x, 0, 5) * 2);
      if (y < edge) {
        const v = n(x, y, 1);
        return [226 + v * 22, 232 + v * 18, 242 + v * 12, 255];
      }
      const v = vnoise(x, y, 4, 2) * 0.6 + n(x, y) * 0.4;
      return [118 + v * 26, 85 + v * 20, 58 + v * 14, 255];
    };
    case T.BEDROCK: return (x, y) => {
      const v = vnoise(x, y, 3, 1) * 0.7 + n(x, y) * 0.3;
      const l = 36 + v * 56;
      return [l, l, l + 3, 255];
    };
    case T.CACTUS_SIDE: return (x, y) => {
      const rib = (x % 4 === 1);
      const v = n(x, y);
      let r = 58 + v * 18, g = 124 + v * 28, b = 58 + v * 16;
      if (rib) { r *= 0.74; g *= 0.74; b *= 0.74; }
      if (x % 4 === 3 && y % 5 === 2) return [228, 232, 200, 255];
      return [r, g, b, 255];
    };
    case T.CACTUS_TOP: return (x, y) => {
      const v = n(x, y);
      const edge = x < 1 || y < 1 || x > 14 || y > 14;
      const l = edge ? 0.72 : 1;
      return [(70 + v * 18) * l, (138 + v * 26) * l, (66 + v * 14) * l, 255];
    };
    case T.PLANKS: return (x, y) => {
      const row = Math.floor(y / 4);
      const gap = y % 4 === 3 || (x === ((row * 7 + 3) % 16));
      const v = vnoise(x * 2, y, 5, 1) * 0.6 + n(x, y) * 0.4;
      let r = 158 + v * 28, g = 122 + v * 22, b = 76 + v * 16;
      if (gap) { r *= 0.66; g *= 0.66; b *= 0.66; }
      return [r, g, b, 255];
    };
    case T.TNT_SIDE: return (x, y) => {
      // red body, dark frame, pale central band reading "TNT"
      const band = y >= 6 && y <= 9;
      if (band) {
        const letter = (y === 7 || y === 8) && [2, 3, 7, 8, 12, 13].includes(x);
        if (letter) return [54, 36, 34, 255];
        const v = n(x, y);
        return [224 - v * 16, 224 - v * 16, 210 - v * 18, 255];
      }
      const frame = x === 0 || x === 15 || y === 0 || y === 15;
      const v = n(x, y);
      let r = 176 + v * 26, g = 46 + v * 16, b = 34 + v * 12;
      if (frame) { r *= 0.66; g *= 0.66; b *= 0.66; }
      return [r, g, b, 255];
    };
    case T.TNT_TOP: return (x, y) => {
      const cx = Math.abs(x - 7.5), cy = Math.abs(y - 7.5);
      const v = n(x, y);
      if (cx < 1.4 && cy < 1.4) return [58, 46, 42, 255]; // fuse hole
      const frame = x === 0 || x === 15 || y === 0 || y === 15;
      let r = 158 + v * 22, g = 74 + v * 16, b = 56 + v * 12;
      if (frame) { r *= 0.7; g *= 0.7; b *= 0.7; }
      return [r, g, b, 255];
    };
    case T.TNT_BOT: return (x, y) => {
      const v = n(x, y);
      const frame = x === 0 || x === 15 || y === 0 || y === 15;
      let r = 110 + v * 20, g = 52 + v * 12, b = 40 + v * 10;
      if (frame) { r *= 0.72; g *= 0.72; b *= 0.72; }
      return [r, g, b, 255];
    };
    default: return () => [255, 0, 255, 255];
  }
}

// Build atlas canvas with edge extrusion into padding (mipmap bleed fix).
export function buildAtlasCanvas() {
  const numTiles = 25;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(ATLAS_SIZE, ATLAS_SIZE);
  const data = img.data;
  const avgColors = [];

  for (let tile = 0; tile < numTiles; tile++) {
    const paint = painter(tile);
    const tcx = (tile % ATLAS_COLS) * CELL;
    const tcy = Math.floor(tile / ATLAS_COLS) * CELL;
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let py = -PAD; py < TILE_PX + PAD; py++) {
      for (let px = -PAD; px < TILE_PX + PAD; px++) {
        // extrude: clamp into the 16x16 content
        const sx = clamp(px, 0, TILE_PX - 1);
        const sy = clamp(py, 0, TILE_PX - 1);
        const [r, g, b, a] = paint(sx, sy);
        const dx = tcx + PAD + px, dy = tcy + PAD + py;
        const di = (dy * ATLAS_SIZE + dx) * 4;
        data[di] = clamp(Math.round(r), 0, 255);
        data[di + 1] = clamp(Math.round(g), 0, 255);
        data[di + 2] = clamp(Math.round(b), 0, 255);
        data[di + 3] = clamp(Math.round(a), 0, 255);
        if (px >= 0 && px < TILE_PX && py >= 0 && py < TILE_PX && a > 64) {
          ar += r; ag += g; ab += b; an++;
        }
      }
    }
    avgColors[tile] = an ? [ar / an / 255, ag / an / 255, ab / an / 255] : [1, 1, 1];
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, avgColors };
}

// 10-stage crack strip (no mipmaps needed)
export function buildCrackCanvas() {
  const stages = 10, S = 16;
  const canvas = document.createElement('canvas');
  canvas.width = S * stages;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S * stages, S);
  const d = img.data;
  for (let st = 0; st < stages; st++) {
    // radial cracks growing from the center with stage; same rays each stage
    const rays = 8;
    const cells = new Set();
    const put = (px, py) => {
      if (px >= 0 && px <= 15 && py >= 0 && py <= 15) {
        cells.add(Math.round(px) + ',' + Math.round(py));
      }
    };
    for (let w = 0; w < rays; w++) {
      const baseA = (w / rays) * Math.PI * 2 + hash2(w, 3, 17) * 0.8;
      const maxLen = 2.5 + st * 1.15; // grows to the edge by the last stage
      let x = 7.5, y = 7.5, a = baseA;
      for (let s = 0; s < maxLen; s++) {
        put(x, y);
        put(x + (s % 2), y + ((s + 1) % 2)); // thicken the line
        a = baseA + (hash2(w * 31 + s, 9, 13) - 0.5) * 1.0;
        x += Math.cos(a) * 1.15; y += Math.sin(a) * 1.15;
        if (x < -1 || x > 16 || y < -1 || y > 16) break;
        // forks make later stages read as a shatter web
        if (st > 3 && s > 1 && hash2(w * 7 + s, st, 23) > 0.72) {
          const fa = a + (hash2(w + s, st, 29) > 0.5 ? 1.3 : -1.3);
          put(x + Math.cos(fa), y + Math.sin(fa));
          put(x + Math.cos(fa) * 2, y + Math.sin(fa) * 2);
        }
      }
    }
    for (const c of cells) {
      const [x, y] = c.split(',').map(Number);
      const di = (y * S * stages + st * S + x) * 4;
      const dark = 10 + hash2(x, y, st) * 22;
      d[di] = dark; d[di + 1] = dark; d[di + 2] = dark;
      d[di + 3] = 175 + (st / 9) * 80;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
