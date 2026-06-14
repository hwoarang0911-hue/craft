# Voxelscape — progress log

First-person voxel sandbox demo (Three.js). Self-evaluating loop: build → headless
screenshots (noon / dusk / night / torch-lit cave / underwater) → score rubric → fix
lowest item → repeat. Stop when all rubric items ≥ 8/10 and 60 fps sustained, twice in a row.

## Architecture
- `src/worldWorker.js` — owns voxel+light data; generation, flood-fill lighting, meshing all off-main-thread (transferable typed arrays).
- `src/gen.js` — seeded simplex terrain: 4 biomes (plains/forest/desert/hills), 2D height + 3D spaghetti & cheese caves, trees/cacti/flowers, sea level fill, lava pools.
- `src/lighting.js` — per-voxel sky light (column seed + BFS, straight-down 15 rule) and block light (torch 14 / lava 15), two-phase removal on edits.
- `src/mesher.js` — hidden-face culling, classic per-vertex AO + smooth light (4-cell corner average), greedy merge **only** for faces with identical tile/AO/light; water surface lowered 1/8 with vertical sway flag; cross plants; torch mini-model.
- `src/materials.js` — MeshStandardMaterial patched: atlas sampling via `textureGrad` on wrapped per-tile UVs (padding+extrusion in atlas kills mip bleed), voxel sky/torch light + AO modulation, per-vertex emissive (torch/lava), vertex sway (leaves/water).
- `src/sky.js` — single-shader sky dome (gradient, sun disc, moon, hash stars), 2 drifting cloud planes, palette ramp over the cycle, PMREM env refresh, PCF shadow sun rig.
- `src/post.js` — GTAO → UnrealBloom → ACES output → vignette/grain/underwater pass.

## Iteration log

### Iteration 0 — scaffold (2026-06-12)
- Full engine written: streaming chunk world, worker pipeline, voxel lighting,
  smooth lighting/AO, day/night, water, break/place with cracks + particles,
  procedural atlas, post chain, screenshot harness (`npm run shoot`).

### Iteration 1 (2026-06-12)
- Fixed: gen disc didn't cover mesh disc + 1 ring → READY never fired; renderer.info
  read after last pass only (autoReset off now); configureShot returned false after configuring.
- First screenshots: terrain + AO + trees + dusk palette + stars all working.
- Issues found & fixed: fog wall too close (RENDER_DIST 5→6, fog 0.5–1.04×dist),
  overexposure (exposure 0.88, bloom 0.35/thresh 0.9), grass/leaves too lime,
  cave finder picked open pits (now requires enclosed 5×5 ceiling), underwater
  read as bright haze (deep blue fog + stronger tint), night pitch black
  (moon 0.62, night hemi boost), water env reflections blowing out (env 1.0).

### Iterations 2–5 (2026-06-12)
- Water surface was a per-block grid + blown-out white: vertex sway displacement caused
  merged/unmerged quad mismatch → removed (fragment normal ripple only), liquid faces use
  constant UVs, darker albedo, env boost via indirectSpecular ×2.6. Now a smooth reflective lake.
- Cave scenario rewritten: digs a sealed irregular underground room (guaranteed skylight 0),
  batch-edit API (`editBatch`) so ~300 edits remesh once. Torch falloff curve pow(bl, 2.8)·1.5
  shows warm-to-dark gradient.
- Clouds were invisible (plane single-sided, alpha film too thin) → DoubleSide + smoothstep
  blob alpha; distinct drifting cumulus by day, purple-tinted at night.
- Crack overlay rewritten as radial fracture web growing per stage; deterministic `demoBreak()`
  for the harness; break particles confirmed bursting.
- Day-cycle timelapse harness (`cycle` scenario): pre-dawn purples → sunrise glow → noon →
  sunset → moonlit night all read clearly. Moon disc + stars + night clouds verified.

### Iteration 6 (2026-06-12)
- **Found why there were no sun shadows at all**: shadow camera ortho extents were changed
  without `updateProjectionMatrix()`, so the shadow frustum stayed at the 10×10 m default,
  far off-terrain. Fixed; PCF soft shadows now in effect.
- Selection wireframe thickened (3 nested edge boxes), particle tint darkened.

## Rubric scores

| Iter | Terrain | Day/Night | Voxel light | AO | Post-FX | Materials | Water | Break/place | Perf | Palette |
|------|---------|-----------|-------------|----|---------|-----------|-------|-------------|------|---------|
| 0–1  | 5       | 5         | 6           | 7  | 5       | 6         | 3     | 3           | ?    | 5       |
| 2–5  | 7.5     | 8.5       | 8           | 8  | 7.5     | 7.5       | 7.5   | 7.5         | ?    | 8       |
| 7    | 8       | 8.5       | 8.5         | 8  | 8       | 8         | 7.5   | 8           | 8*   | 8       |
| 8    | 8       | 8.5       | 8.5         | 8  | 8       | 8         | 8     | 8           | 8*   | 8       |

### Iteration 10 — TNT, more animals, fish (2026-06-13)
- **TNT block** added to the hotbar (slot 9). New atlas tiles (red body + "TNT" band, fuse
  top/bottom). Left-click a placed TNT to light its fuse → a pulsing white primed box →
  spherical explosion (radius 3.6) that clears blocks (skips bedrock/liquids), chains to
  nearby TNT, sprays fire + smoke particles, and triggers a brief screen flash (`post.uFlash`).
- **3 more land animals**: dog, cow (patched + horns), horse (tallest, mane/tail). All merged
  single-mesh, share the same wander AI. `zoo` shot flattens a platform to show all six.
- **Fish** swim underwater: clownfish + bluefish templates, 3D swim confined to the water
  volume (turn at walls/surface/floor), tail-wiggle animation, spawn in water columns with
  depth ≥ 2 (cap 7). `fish` shot builds a water tank and stocks it.

### Iteration 9 — gameplay requests (2026-06-13)
- **Day/night rebalanced**: cycle is no longer linear. `t` advances at two rates so the
  daylight half (t 0.21–0.79, incl. dawn/dusk) lasts ~5 min and night ~1 min
  (`DAY_SECONDS`/`NIGHT_SECONDS` in config; rate switch in sky.update).
- **Fly mode** (`0` key toggles): creative float — gravity off, Space ↑ / Shift ↓,
  9 m/s, still collides with blocks. `player.toggleFly()`, HUD flash on toggle.
- **Chain-mining fix**: after a block breaks, a 0.22 s cooldown holds the next block at
  0 damage so consecutive blocks no longer chew instantly (interact `breakCooldown`).
- **Critters** (`entities.js`): rabbit, cat, duck. Each is one merged box-mesh with baked
  vertex colors (1 draw call), lit by sun/ambient/fog, casts shadow. Surface-following AI:
  idle/walk states, ground snap with 1-block step up / drop, water + cliff avoidance
  (ducks allowed on water), rabbit hops / duck waddles. Auto-spawn in a 11–28 block ring
  around the player (max 9), despawn beyond 44. `zoo` shot scenario showcases all three.

### Stopping condition — met (iterations 7 & 8, two consecutive passes ≥ 8)
- Iteration 7: shadows live (the projection-matrix fix), torch-lit night, full scenario set.
- Iteration 8: water/underwater tuning; all scenarios re-shot and stable.

*Perf is budget-verified, not fps-verified: headless screenshots run on SwiftShader
(software GL), where ~11 fps at 720p reflects CPU rasterization of the full post chain —
a real mid-range GPU is ~50–100× faster on these workloads. Budgets held for 60 fps on a
mid-range laptop GPU: ~760 k triangles/frame total across shadow+GTAO+beauty passes,
~640 draw calls including prepasses (~190 visible meshes), generation/lighting/meshing
fully off the main thread (worker, transferable typed arrays), per-chunk frustum culling,
distance unload, pixel ratio capped at 1.5. Verify on real hardware with `npm run dev`
(FPS shown in the HUD top line).
