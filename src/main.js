// Entry point: wires renderer, world streaming, player, interaction, sky, post.
// Also exposes a headless screenshot harness driven by ?shot=<scenario>.
import * as THREE from 'three';
import { CHUNK, HEIGHT, SEA, RENDER_DIST, vidx, chunkKey } from './config.js';
import { B, BLOCKS, HOTBAR, buildAtlasCanvas } from './blocks.js';
import { makeChunkMaterials, tickMaterials } from './materials.js';
import { World } from './world.js';
import { Player, EYE } from './player.js';
import { Interact } from './interact.js';
import { SkySystem } from './sky.js';
import { Post } from './post.js';
import { Hud } from './hud.js';
import { Critters } from './entities.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');

const app = document.getElementById('app');

// Surface crashes the player would otherwise never see. A thrown WebGL/context
// error aborts the rest of this module, leaving only the static "Click to play"
// hint on screen — which reads as "the menu shows but nothing loads".
let fatalShown = false;
function fatal(msg) {
  if (fatalShown) return;
  fatalShown = true;
  const hint = document.getElementById('hint');
  if (!hint) return;
  hint.style.display = '';
  hint.innerHTML = '<b>Voxelscape — 실행 불가 / cannot start</b><br>'
    + '<span style="font-size:13px;opacity:0.9;white-space:pre-wrap;line-height:1.5">'
    + String(msg).replace(/</g, '&lt;') + '</span>';
}
window.addEventListener('error', (e) => { if (e && e.message) fatal(e.message); });
window.addEventListener('unhandledrejection', (e) => {
  fatal((e && e.reason && e.reason.message) || (e && e.reason) || 'unknown error');
});

// three r184 renders only on WebGL2; give a clear reason instead of a dead screen.
function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); }
  catch { return false; }
}
if (!hasWebGL2()) {
  fatal('이 브라우저/기기에서 WebGL2를 쓸 수 없습니다.\n'
    + 'No WebGL2 available. Turn on hardware acceleration, update the browser,\n'
    + 'or open in desktop Chrome / Edge / Firefox.');
  throw new Error('WebGL2 unavailable');
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e1) {
  try {
    // retry with a more permissive config — some GPUs reject high-performance/AA
    renderer = new THREE.WebGLRenderer({ antialias: false });
  } catch (e2) {
    fatal('WebGL 초기화 실패 / failed to create a WebGL context:\n' + e2.message
      + '\n하드웨어 가속을 켜고 새로고침해 보세요.');
    throw e2;
  }
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
// Set the renderer look here too, so the post-less fallback path still matches.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 1400);

const { canvas: atlasCanvas, avgColors } = buildAtlasCanvas();
const materials = makeChunkMaterials(atlasCanvas);
const world = new World(scene, materials);
const player = new Player(camera, renderer.domElement);
const hud = new Hud(atlasCanvas);
const interact = new Interact(world, player, camera, scene, hud, { avgColors });
const sky = new SkySystem(scene, renderer);
// Post-processing is the most fragile part on weak/old GPUs (float render
// targets, GTAO). If it can't be built — or later renders pure black — we fall
// back to direct rendering so the world is always visible. `?nopost` forces it.
let post = null;
if (!params.has('nopost')) {
  try { post = new Post(renderer, scene, camera); }
  catch (e) { console.warn('post-processing unavailable, using direct render:', e); }
}
const critters = new Critters(scene, world);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (post) post.resize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- spawn
let spawned = false;
function surfaceY(x, z) {
  for (let y = HEIGHT - 1; y > 0; y--) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR && BLOCKS[id].solid) return y;
  }
  return SEA + 1;
}

function trySpawn() {
  if (spawned) return;
  const arr = world.voxels.get(chunkKey(0, 0));
  if (!arr) return;
  // pick a dry column near origin
  let bx = 8, bz = 8, by = surfaceY(8, 8);
  for (let r = 0; r < 14 && by <= SEA; r++) {
    const x = 4 + ((r * 7) % 12), z = 4 + ((r * 5) % 12);
    const y = surfaceY(x, z);
    if (y > SEA) { bx = x; bz = z; by = y; }
  }
  player.pos.set(bx + 0.5, by + 1.02, bz + 0.5);
  player.vel.set(0, 0, 0);
  spawned = true;
}

world.onChunkMeshed = () => { trySpawn(); };
player.frozen = true; // until spawn + world ready

// ---------------------------------------------------------------- shot harness
const SHOT_TIMES = {
  noon: 0.5, dusk: 0.74, dawn: 0.3, night: 0.015, cave: 0.5,
  water: 0.45, watertop: 0.45, mine: 0.42, sky: 0.46, blocks: 0.38,
  zoo: 0.42, fish: 0.45, tnt: 0.42,
};
let shotConfigured = false;
let freezeTime = false;

if (shotMode) {
  document.getElementById('hint').style.display = 'none';
  sky.time = SHOT_TIMES[shotMode] ?? 0.5;
  if (params.get('t')) sky.time = parseFloat(params.get('t'));
  freezeTime = true;
}

function findCavePocket() {
  // scan mirrored voxels for a roomy underground air pocket
  let best = null;
  for (const [key, arr] of world.voxels) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx) > 3 || Math.abs(cz) > 3) continue;
    for (let z = 2; z < 14; z++) {
      for (let x = 2; x < 14; x++) {
        for (let y = 12; y < 22; y++) {
          if (arr[vidx(x, y, z)] !== B.AIR) continue;
          if (arr[vidx(x, y + 1, z)] !== B.AIR) continue;
          if (!BLOCKS[arr[vidx(x, y - 1, z)]].opaque) continue;
          // genuinely underground: every nearby column needs a solid ceiling
          let enclosed = true;
          for (let dz = -2; dz <= 2 && enclosed; dz++) {
            for (let dx = -2; dx <= 2 && enclosed; dx++) {
              const xx = x + dx, zz = z + dz;
              if (xx < 0 || xx > 15 || zz < 0 || zz > 15) continue;
              let ceiling = false;
              for (let cy = y + 1; cy <= Math.min(HEIGHT - 1, y + 14); cy++) {
                const cid = arr[vidx(xx, cy, zz)];
                if (cid !== B.AIR && BLOCKS[cid].opaque) { ceiling = true; break; }
              }
              if (!ceiling) enclosed = false;
            }
          }
          if (!enclosed) continue;
          // measure local openness
          let open = 0;
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              const xx = x + dx, zz = z + dz;
              if (xx < 0 || xx > 15 || zz < 0 || zz > 15) continue;
              if (arr[vidx(xx, y, zz)] === B.AIR) open++;
            }
          }
          if (!best || open > best.open) {
            best = { x: cx * CHUNK + x, y, z: cz * CHUNK + z, open };
          }
        }
      }
    }
  }
  return best;
}

function findWaterSpot() {
  for (const [key, arr] of world.voxels) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx) > 4 || Math.abs(cz) > 4) continue;
    for (let z = 3; z < 13; z++) {
      for (let x = 3; x < 13; x++) {
        if (arr[vidx(x, SEA, z)] === B.WATER && arr[vidx(x, SEA - 2, z)] === B.WATER) {
          return { x: cx * CHUNK + x, y: SEA, z: cz * CHUNK + z };
        }
      }
    }
  }
  return null;
}

function configureShot() {
  if (!shotMode || shotConfigured) return true;
  if (!world.ready(player.pos) || !spawned) return false;
  player.frozen = true;

  const setCam = (x, y, z, yaw, pitch) => {
    player.pos.set(x, y, z);
    player.yaw = yaw;
    player.pitch = pitch;
    player.syncCamera();
  };

  if (shotMode === 'cave') {
    // dig a sealed underground room (skylight 0 guaranteed) and torch-light it
    const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
    const by = 13;
    const edits = [];
    for (let dy = 0; dy <= 3; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -5; dx <= 5; dx++) {
          // irregular walls so it reads as a cave, not a box
          const edge = Math.abs(dx) === 5 || Math.abs(dz) === 4 || dy === 3;
          if (edge && ((dx * 7 + dz * 13 + dy * 5) % 3 === 0)) continue;
          edits.push({ x: bx + dx, y: by + dy, z: bz + dz, id: B.AIR });
        }
      }
    }
    edits.push({ x: bx + 3, y: by, z: bz - 2, id: B.TORCH });
    edits.push({ x: bx - 4, y: by, z: bz + 2, id: B.TORCH });
    world.setBlocks(edits);
    setCam(bx + 0.5 - 1, by + 0.55, bz + 0.5 + 2.6, -0.5, 0.02);
  } else if (shotMode === 'water') {
    const p = findWaterSpot();
    if (p) setCam(p.x + 0.5, p.y - 1.4, p.z + 0.5, 0.6, 0.3);
  } else if (shotMode === 'watertop') {
    const p = findWaterSpot();
    if (p) setCam(p.x + 0.5, p.y + 6, p.z + 0.5, 0.8, -0.5);
  } else if (shotMode === 'mine') {
    // place a stone pillar and aim exactly at its upper block
    const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
    const fy = Math.floor(player.pos.y);
    world.setBlocks([
      { x: bx - 2, y: fy, z: bz + 2, id: B.STONE },
      { x: bx - 2, y: fy + 1, z: bz + 2, id: B.STONE },
    ]);
    const ex = player.pos.x, ey = player.pos.y + EYE, ez = player.pos.z;
    const tx = bx - 2 + 0.5, ty = fy + 1.5, tz = bz + 2 + 0.5;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    setCam(player.pos.x, player.pos.y, player.pos.z, yaw, pitch);
  } else if (shotMode === 'sky') {
    setCam(player.pos.x, player.pos.y, player.pos.z, 4.2, 0.85);
  } else if (shotMode === 'zoo') {
    // flatten a grass platform so all six land critters are clearly visible
    critters.auto = false;
    const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
    const fy = Math.floor(player.pos.y) - 1;
    const edits = [];
    for (let dz = -9; dz <= 0; dz++) {
      for (let dx = -6; dx <= 7; dx++) {
        edits.push({ x: bx + dx, y: fy, z: bz + dz, id: B.GRASS });
        for (let dy = 1; dy <= 4; dy++) edits.push({ x: bx + dx, y: fy + dy, z: bz + dz, id: B.AIR });
      }
    }
    world.setBlocks(edits);
    const gy = fy + 1;
    critters.spawn('rabbit', bx - 3.5, bz - 4, gy);
    critters.spawn('dog', bx - 1.6, bz - 5, gy);
    critters.spawn('cat', bx - 0.2, bz - 4, gy);
    critters.spawn('duck', bx + 1.2, bz - 4.5, gy);
    critters.spawn('cow', bx + 3, bz - 6, gy);
    critters.spawn('horse', bx + 5, bz - 7, gy);
    setCam(bx + 0.5, gy + 0.5, bz + 1.5, 0, -0.12);
  } else if (shotMode === 'fish') {
    // build a water tank around the camera and stock it with fish
    critters.auto = false;
    const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
    const cy = Math.floor(player.pos.y) + 1;
    const edits = [];
    for (let dy = -2; dy <= 3; dy++) {
      for (let dz = -6; dz <= 6; dz++) {
        for (let dx = -6; dx <= 6; dx++) {
          edits.push({ x: bx + dx, y: cy + dy, z: bz + dz, id: B.WATER });
        }
      }
    }
    world.setBlocks(edits);
    for (let i = 0; i < 8; i++) {
      critters.spawnFish(bx - 3 + ((i * 5) % 7), bz - 3 + ((i * 2) % 6));
    }
    setCam(bx + 0.5, cy + 0.8, bz + 3.5, 0, 0.02);
  } else if (shotMode === 'tnt') {
    // a wall of TNT mid-detonation
    const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
    const fy = Math.floor(player.pos.y);
    const edits = [];
    for (let dy = 0; dy < 3; dy++) for (let dx = -1; dx <= 1; dx++) {
      edits.push({ x: bx + dx, y: fy + dy, z: bz - 5, id: B.TNT });
    }
    world.setBlocks(edits);
    setCam(player.pos.x, player.pos.y, player.pos.z, 0, -0.05);
  } else if (shotMode === 'night') {
    // torches in the foreground: warm pools against the cool moonlit night
    const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
    const spots = [[-4, 3], [-1, 1], [-6, 7]];
    const edits = [];
    for (const [dx, dz] of spots) {
      const ty = surfaceY(bx + dx, bz + dz);
      edits.push({ x: bx + dx, y: ty + 1, z: bz + dz, id: B.TORCH });
    }
    world.setBlocks(edits);
    setCam(player.pos.x, player.pos.y, player.pos.z, 2.7, -0.18);
  } else if (shotMode === 'blocks') {
    // build a floating display wall of the hotbar blocks against the sky
    const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
    const by = Math.floor(player.pos.y) + 3;
    const edits = [];
    for (let i = 0; i < HOTBAR.length; i++) {
      const col = bx - 4 + i;
      edits.push({ x: col, y: by, z: bz - 5, id: B.STONE });
      edits.push({ x: col, y: by + 1, z: bz - 5, id: HOTBAR[i] });
    }
    world.setBlocks(edits);
    setCam(bx + 0.5, by - 2.2, bz + 0.5, 0, 0.18);
  } else {
    // surface shots: stand at spawn, look at terrain
    const yaw = params.get('yaw') ? parseFloat(params.get('yaw')) : 2.45;
    const pitch = params.get('pitch') ? parseFloat(params.get('pitch')) : -0.12;
    setCam(player.pos.x, player.pos.y, player.pos.z, yaw, pitch);
  }
  // explicit overrides (any subset)
  const ov = (k, cur) => params.get(k) !== null ? parseFloat(params.get(k)) : cur;
  setCam(ov('px', player.pos.x), ov('py', player.pos.y), ov('pz', player.pos.z),
    ov('yaw', player.yaw), ov('pitch', player.pitch));
  shotConfigured = true;
  return true;
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
renderer.info.autoReset = false;
let lastInfo = { calls: 0, triangles: 0 };
let elapsed = 0;
let framesAfterReady = 0;
let readySettleFrames = shotMode ? 30 : 5;
window.READY = false;
const frameTimes = [];
let postProbed = false;

// Render the frame through post-processing, but degrade to a plain render the
// instant post throws — a broken post chain must never blank the whole screen.
function renderFrame(dt) {
  if (post) {
    try { post.render(dt); return; }
    catch (e) {
      console.warn('post-processing failed mid-run, falling back to direct render:', e);
      post = null;
    }
  }
  renderer.render(scene, camera);
}

// Some GPUs build the post chain fine but render it pure black (unsupported
// float targets). Compare a direct render against the post output once; if the
// post frame is effectively black while the scene is lit, drop post for good.
function probePost() {
  if (postProbed) return;
  postProbed = true;
  if (!post) return;
  try {
    const gl = renderer.getContext();
    const w = renderer.domElement.width, h = renderer.domElement.height, N = 16;
    const sx = Math.max(0, (w >> 1) - (N >> 1)), sy = Math.max(0, (h >> 1) - (N >> 1));
    const buf = new Uint8Array(N * N * 4);
    const lum = () => {
      let s = 0;
      for (let i = 0; i < buf.length; i += 4) s += buf[i] + buf[i + 1] + buf[i + 2];
      return s / (N * N * 3);
    };
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    gl.readPixels(sx, sy, N, N, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const directLum = lum();
    post.render(0);
    gl.readPixels(sx, sy, N, N, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const postLum = lum();
    if (directLum > 12 && postLum < directLum * 0.18) {
      console.warn(`post output near-black (direct=${directLum.toFixed(1)}, `
        + `post=${postLum.toFixed(1)}); disabling post-processing`);
      post = null;
    }
  } catch (e) {
    console.warn('post probe failed:', e);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;

  world.update(player.pos);
  if (spawned && !shotMode && world.ready(player.pos)) player.frozen = false;
  player.update(dt, world);
  if (player.locked || shotMode) interact.update(dt);
  if (spawned && (!shotMode || shotMode === 'zoo' || shotMode === 'fish')) {
    critters.update(dt, player.pos);
  }

  const skyState = sky.update(dt, camera.position, freezeTime);
  if (post) post.setNight(skyState.nightF);
  // explosion flash decays each frame
  interact.flash = Math.max(0, (interact.flash || 0) - dt * 3.2);
  if (post) post.setFlash(interact.flash * 0.6);
  tickMaterials(materials, elapsed);

  // underwater handling
  const headBlock = world.getBlock(
    Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z));
  const under = headBlock === B.WATER;
  if (post) post.setUnderwater(under);
  sky.setUnderwater(under);

  renderer.info.reset();
  renderFrame(dt);
  lastInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };

  frameTimes.push(dt);
  if (frameTimes.length > 240) frameTimes.shift();
  hud.tick(dt, BLOCKS[HOTBAR[interact.hotbarIndex]].name,
    shotMode ? '' : ` · ${Math.round(player.pos.x)},${Math.round(player.pos.y)},${Math.round(player.pos.z)}`);

  // readiness for the screenshot harness
  if (!window.READY && spawned && world.ready(player.pos)) {
    if (!shotMode || configureShot()) {
      framesAfterReady++;
      if (framesAfterReady >= readySettleFrames) { probePost(); window.READY = true; }
    }
  }
}

window.__stats = () => {
  const avg = frameTimes.length ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 1;
  return {
    fps: 1 / avg,
    calls: lastInfo.calls,
    triangles: lastInfo.triangles,
    chunks: world.meshedKeys.size,
    time: sky.time,
  };
};
window.__app = { world, player, sky, renderer, interact, camera, critters };

animate();
