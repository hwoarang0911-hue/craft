// Chunk mesher: hidden-face culling, per-vertex AO + smooth voxel light,
// greedy merging restricted to faces with identical texture/light/AO
// (never merges across lighting discontinuities). Worker-safe.
import { CHUNK, HEIGHT, vidx } from './config.js';
import { BLOCKS, B } from './blocks.js';
import { skyOf, blockOf } from './lighting.js';

const AO_CURVE = [100, 150, 202, 255]; // occlusion 0..3 -> brightness byte

// dir: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
const NRM = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const T1 = [[0, 0, 1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0]]; // u axis
const T2 = [[0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, 1], [0, 1, 0], [0, 1, 0]]; // v axis
// emitted corner order (du, dv) per dir, CCW from outside
const CORNERS = [
  [[0, 0], [0, 1], [1, 1], [1, 0]],
  [[0, 0], [1, 0], [1, 1], [0, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 0]],
  [[0, 0], [1, 0], [1, 1], [0, 1]],
  [[0, 0], [1, 0], [1, 1], [0, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 0]],
];

class View {
  constructor(store, cx, cz) {
    this.v = []; this.l = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.v.push(store.voxArr(cx + dx, cz + dz));
        this.l.push(store.lightArr(cx + dx, cz + dz));
      }
    }
  }
  // x, z in [-16, 32)
  block(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const arr = this.v[((x >> 4) + 1) + ((z >> 4) + 1) * 3];
    if (!arr) return 255;
    return arr[vidx(x & 15, y, z & 15)];
  }
  light(x, y, z) {
    if (y >= HEIGHT) return 0xf0;
    if (y < 0) return 0;
    const arr = this.l[((x >> 4) + 1) + ((z >> 4) + 1) * 3];
    if (!arr) return 0;
    return arr[vidx(x & 15, y, z & 15)];
  }
}

class Builder {
  constructor() {
    this.pos = []; this.nrm = []; this.uvl = []; this.tile = [];
    this.voxel = []; this.anim = []; this.idx = []; this.nv = 0;
  }
  vert(x, y, z, nx, ny, nz, u, v, tx, ty, sky, blk, ao, sway, glow) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uvl.push(u, v);
    this.tile.push(tx, ty);
    this.voxel.push(Math.round(sky * 17), Math.round(blk * 17), ao);
    this.anim.push(sway, glow);
    return this.nv++;
  }
  quad(a, b, c, d, flip) {
    if (flip) this.idx.push(b, c, d, b, d, a);
    else this.idx.push(a, b, c, a, c, d);
  }
  empty() { return this.nv === 0; }
  pack() {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Int8Array(this.nrm),
      uvl: new Float32Array(this.uvl),
      tile: new Uint8Array(this.tile),
      voxel: new Uint8Array(this.voxel),
      anim: new Uint8Array(this.anim),
      idx: this.nv > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
    };
  }
}

const opq = (id) => id === 255 || BLOCKS[id].opaque;

function faceVisible(id, nid) {
  if (nid === 255) return false;
  if (BLOCKS[nid].opaque) return false;
  if (nid === id) return false; // same-type transparent neighbors cull
  return true;
}

// per-corner AO + smooth light, sampled in the neighbor plane of the face
function cornerData(view, x, y, z, d, du, dv, out, ci) {
  const n = NRM[d], t1 = T1[d], t2 = T2[d];
  const su = du ? 1 : -1, sv = dv ? 1 : -1;
  const bx = x + n[0], by = y + n[1], bz = z + n[2];
  const ax = bx + su * t1[0], ay = by + su * t1[1], az = bz + su * t1[2];
  const cx2 = bx + sv * t2[0], cy2 = by + sv * t2[1], cz2 = bz + sv * t2[2];
  const dx = ax + sv * t2[0], dy = ay + sv * t2[1], dz = az + sv * t2[2];
  const s1 = opq(view.block(ax, ay, az)) ? 1 : 0;
  const s2 = opq(view.block(cx2, cy2, cz2)) ? 1 : 0;
  const co = opq(view.block(dx, dy, dz)) ? 1 : 0;
  const ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + co);

  let sky = 0, blk = 0, cnt = 0;
  const lb = view.light(bx, by, bz);
  sky += skyOf(lb); blk += blockOf(lb); cnt++;
  if (!s1) { const l = view.light(ax, ay, az); sky += skyOf(l); blk += blockOf(l); cnt++; }
  if (!s2) { const l = view.light(cx2, cy2, cz2); sky += skyOf(l); blk += blockOf(l); cnt++; }
  if (!(s1 && s2) && !co) { const l = view.light(dx, dy, dz); sky += skyOf(l); blk += blockOf(l); cnt++; }
  out.ao[ci] = ao;
  out.sky[ci] = sky / cnt;
  out.blk[ci] = blk / cnt;
}

export function meshChunk(store, cx, cz) {
  const view = new View(store, cx, cz);
  const builders = { opaque: new Builder(), cutout: new Builder(), trans: new Builder() };
  const x0 = cx * CHUNK, z0 = cz * CHUNK;

  const entryPool = [];
  let poolI = 0;
  const newEntry = () => {
    if (poolI < entryPool.length) return entryPool[poolI++];
    const e = { key: 0, tile: 0, grp: '', lower: 0, glow: 0, sway: 0, liquid: 0, ao: [0, 0, 0, 0], sky: [0, 0, 0, 0], blk: [0, 0, 0, 0] };
    entryPool.push(e); poolI++;
    return e;
  };

  // ---- greedy cube/liquid faces, per direction ----
  for (let d = 0; d < 6; d++) {
    const axis = d < 2 ? 0 : d < 4 ? 1 : 2;
    const sMax = axis === 1 ? HEIGHT : CHUNK;
    const uMax = axis === 1 ? CHUNK : (axis === 0 ? CHUNK : CHUNK);
    const vMax = axis === 1 ? CHUNK : HEIGHT;
    const mask = new Array(uMax * vMax);

    for (let s = 0; s < sMax; s++) {
      mask.fill(undefined);
      poolI = 0;
      let any = false;

      for (let v = 0; v < vMax; v++) {
        for (let u = 0; u < uMax; u++) {
          // cell coords from (s, u, v)
          let x, y, z;
          if (axis === 0) { x = s; y = v; z = u; }
          else if (axis === 1) { x = u; y = s; z = v; }
          else { x = u; y = v; z = s; }
          const id = view.block(x, y, z);
          if (id === B.AIR) continue;
          const bd = BLOCKS[id];
          if (bd.render === 'none' || bd.render === 'cross' || bd.render === 'torch') continue;
          const n = NRM[d];
          const nid = view.block(x + n[0], y + n[1], z + n[2]);
          if (!faceVisible(id, nid)) continue;

          const e = newEntry();
          e.tile = bd.tiles[d];
          e.grp = bd.group;
          e.glow = bd.glow ? 230 : 0;
          e.sway = 0;
          e.lower = 0;
          e.liquid = 0;
          if (bd.render === 'liquid') {
            const above = view.block(x, y + 1, z);
            if (above !== id) e.lower = 1;
            e.liquid = id === B.WATER ? 1 : 0;
          } else if (bd.sway) {
            e.sway = 140; // leaves: gentle
          }
          if (bd.render === 'liquid' || bd.group === 'trans') {
            // uniform light from the face's neighbor cell, no AO (cleaner on water/glass)
            const l = view.light(x + n[0], y + n[1], z + n[2]);
            const sky = skyOf(l), blk = blockOf(l);
            for (let c = 0; c < 4; c++) { e.ao[c] = 3; e.sky[c] = sky; e.blk[c] = blk; }
          } else {
            const cor = CORNERS[d];
            for (let c = 0; c < 4; c++) cornerData(view, x, y, z, d, cor[c][0], cor[c][1], e, c);
          }
          // mergeable only when fully uniform across corners
          const uni = e.ao[0] === e.ao[1] && e.ao[0] === e.ao[2] && e.ao[0] === e.ao[3]
            && e.sky[0] === e.sky[1] && e.sky[0] === e.sky[2] && e.sky[0] === e.sky[3]
            && e.blk[0] === e.blk[1] && e.blk[0] === e.blk[2] && e.blk[0] === e.blk[3];
          e.key = uni
            ? ((((e.tile * 4 + e.ao[0]) * 16 + e.sky[0]) * 16 + e.blk[0]) * 2 + e.lower) * 2 + (e.sway ? 1 : 0)
            : -1;
          mask[v * uMax + u] = e;
          any = true;
        }
      }
      if (!any) continue;

      // greedy rect merge over the mask
      for (let v = 0; v < vMax; v++) {
        for (let u = 0; u < uMax; u++) {
          const e = mask[v * uMax + u];
          if (!e) continue;
          let w = 1, h = 1;
          if (e.key >= 0) {
            while (u + w < uMax) {
              const m = mask[v * uMax + u + w];
              if (!m || m.key !== e.key) break;
              w++;
            }
            outer: while (v + h < vMax) {
              for (let k = 0; k < w; k++) {
                const m = mask[(v + h) * uMax + u + k];
                if (!m || m.key !== e.key) break outer;
              }
              h++;
            }
          }
          for (let dv2 = 0; dv2 < h; dv2++) {
            for (let du2 = 0; du2 < w; du2++) mask[(v + dv2) * uMax + u + du2] = undefined;
          }
          emitQuad(builders[e.grp], d, axis, s, u, v, w, h, e, x0, z0);
        }
      }
    }
  }

  // ---- cross plants & torches ----
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const id = view.block(x, y, z);
        if (id === B.AIR) continue;
        const bd = BLOCKS[id];
        if (bd.render === 'cross') emitCross(builders[bd.group], view, x, y, z, bd);
        else if (bd.render === 'torch') emitTorch(builders[bd.group], view, x, y, z, bd);
      }
    }
  }

  const out = {};
  for (const g of ['opaque', 'cutout', 'trans']) {
    out[g] = builders[g].empty() ? null : builders[g].pack();
  }
  return out;
}

function emitQuad(b, d, axis, s, u0, v0, w, h, e, x0, z0) {
  const n = NRM[d];
  const cor = CORNERS[d];
  const off = (d === 0 || d === 2 || d === 4) ? 1 : 0;
  const tx = e.tile % 8, ty = (e.tile / 8) | 0;
  const verts = [];
  const bright = [];
  for (let c = 0; c < 4; c++) {
    const du = cor[c][0], dv = cor[c][1];
    const uc = u0 + du * w, vc = v0 + dv * h;
    let x, y, z;
    if (axis === 0) { x = s + off; y = vc; z = uc; }
    else if (axis === 1) { x = uc; y = s + off; z = vc; }
    else { x = uc; y = vc; z = s + off; }
    let py = y;
    // lowered liquid surface: top face entirely, or top edge of side faces
    if (e.lower) {
      if (axis === 1 && d === 2) py -= 0.125;
      else if (axis !== 1 && dv === 1) py -= 0.125;
    }
    const ao = e.ao[c], sky = e.sky[c], blk = e.blk[c];
    // liquids: constant UV (flat color) so merged/unmerged quads match exactly
    const lu = e.liquid ? 0.5 : du * w;
    const lv = e.liquid ? 0.5 : dv * h;
    verts.push(b.vert(
      x, py, z, n[0], n[1], n[2],
      lu, lv, tx, ty,
      sky, blk, AO_CURVE[ao],
      e.sway, e.glow,
    ));
    bright.push(ao * 16 + sky + blk);
  }
  const flip = bright[0] + bright[2] < bright[1] + bright[3];
  b.quad(verts[0], verts[1], verts[2], verts[3], flip);
}

function emitCross(b, view, x, y, z, bd) {
  const l = view.light(x, y, z);
  const sky = skyOf(l), blk = blockOf(l);
  const tx = bd.tiles[0] % 8, ty = (bd.tiles[0] / 8) | 0;
  const m = 0.146, V = 0.999;
  const quads = [
    [[x + m, y, z + m], [x + 1 - m, y, z + 1 - m]],
    [[x + 1 - m, y, z + m], [x + m, y, z + 1 - m]],
  ];
  for (const [[ax, ay, az], [cx, cy, cz]] of quads) {
    const i0 = b.vert(ax, y, az, 0, 1, 0, 0, 0, tx, ty, sky, blk, 255, 0, 0);
    const i1 = b.vert(cx, y, cz, 0, 1, 0, V, 0, tx, ty, sky, blk, 255, 0, 0);
    const i2 = b.vert(cx, y + 1, cz, 0, 1, 0, V, V, tx, ty, sky, blk, 255, bd.sway ? 220 : 0, 0);
    const i3 = b.vert(ax, y + 1, az, 0, 1, 0, 0, V, tx, ty, sky, blk, 255, bd.sway ? 220 : 0, 0);
    b.quad(i0, i1, i2, i3, false);
    b.quad(i3, i2, i1, i0, false); // back side
  }
}

function emitTorch(b, view, x, y, z, bd) {
  const l = view.light(x, y, z);
  const sky = skyOf(l), blk = 15;
  const tx = bd.tiles[0] % 8, ty = (bd.tiles[0] / 8) | 0;
  const ttx = 21 % 8, tty = (21 / 8) | 0; // TORCH_TOP tile
  const x0 = x + 0.4375, x1 = x + 0.5625, z0 = z + 0.4375, z1 = z + 0.5625;
  const y0 = y, y1 = y + 0.625;
  const u0 = 0.4375, u1 = 0.5625, v1 = 0.999;
  const G = 235;
  // 4 sides
  const sides = [
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], 1, 0, 0],
    [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], -1, 0, 0],
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 0, 0, -1],
    [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], 0, 0, 1],
  ];
  for (const sd of sides) {
    const [p0, p1, p2, p3, nx, ny, nz] = sd;
    const i0 = b.vert(p0[0], p0[1], p0[2], nx, ny, nz, u0, 0, tx, ty, sky, blk, 255, 0, G);
    const i1 = b.vert(p1[0], p1[1], p1[2], nx, ny, nz, u1, 0, tx, ty, sky, blk, 255, 0, G);
    const i2 = b.vert(p2[0], p2[1], p2[2], nx, ny, nz, u1, v1, tx, ty, sky, blk, 255, 0, G);
    const i3 = b.vert(p3[0], p3[1], p3[2], nx, ny, nz, u0, v1, tx, ty, sky, blk, 255, 0, G);
    b.quad(i0, i1, i2, i3, false);
  }
  // top
  const i0 = b.vert(x0, y1, z0, 0, 1, 0, 0.38, 0.38, ttx, tty, sky, blk, 255, 0, 255);
  const i1 = b.vert(x0, y1, z1, 0, 1, 0, 0.38, 0.62, ttx, tty, sky, blk, 255, 0, 255);
  const i2 = b.vert(x1, y1, z1, 0, 1, 0, 0.62, 0.62, ttx, tty, sky, blk, 255, 0, 255);
  const i3 = b.vert(x1, y1, z0, 0, 1, 0, 0.62, 0.38, ttx, tty, sky, blk, 255, 0, 255);
  b.quad(i0, i1, i2, i3, false);
}
