// World/engine constants shared by main thread and workers.
export const CHUNK = 16;          // chunk footprint (x, z)
export const HEIGHT = 96;         // world height (y)
export const SEA = 30;            // sea level
export const RENDER_DIST = 6;     // chunk radius that gets meshed/rendered
export const GEN_DIST = RENDER_DIST + 1; // chunk radius that gets generated (mesher needs neighbors)
export const UNLOAD_DIST = RENDER_DIST + 2;
export const DAY_LENGTH = 80;     // (legacy) seconds for a full linear cycle
export const DAY_SECONDS = 300;   // real seconds spent in the daylight half (t 0.21..0.79)
export const NIGHT_SECONDS = 60;  // real seconds spent in the night half
export const REACH = 5;           // block interaction distance
export const GRAVITY = 24;
export const SEED = 'vaticano-7';

export const COL = CHUNK * CHUNK;            // cells per horizontal layer
export const CHUNK_VOL = COL * HEIGHT;       // cells per chunk

// voxel index inside a chunk: y-major, then z, then x
export const vidx = (x, y, z) => ((y << 8) | (z << 4) | x);

export const chunkKey = (cx, cz) => cx + ',' + cz;
