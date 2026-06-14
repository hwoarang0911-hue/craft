// Minimal HUD: FPS + selected block line, hotbar with atlas-rendered icons.
import { BLOCKS, HOTBAR, CELL, PAD, TILE_PX, ATLAS_COLS } from './blocks.js';

export class Hud {
  constructor(atlasCanvas) {
    this.topline = document.getElementById('topline');
    this.blockname = document.getElementById('blockname');
    this.hotbarEl = document.getElementById('hotbar');
    this.slots = [];
    this.nameTimer = null;

    for (let i = 0; i < HOTBAR.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === 0 ? ' sel' : '');
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      slot.appendChild(key);
      const icon = document.createElement('canvas');
      icon.width = 16; icon.height = 16;
      const ctx = icon.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const def = BLOCKS[HOTBAR[i]];
      const tile = def.render === 'cube' || def.render === 'liquid' ? def.tiles[4] : def.tiles[0];
      const sx = (tile % ATLAS_COLS) * CELL + PAD;
      const sy = Math.floor(tile / ATLAS_COLS) * CELL + PAD;
      ctx.drawImage(atlasCanvas, sx, sy, TILE_PX, TILE_PX, 0, 0, 16, 16);
      slot.appendChild(icon);
      this.hotbarEl.appendChild(slot);
      this.slots.push(slot);
    }

    this.fps = 60;
    this.fpsSamples = [];
  }

  setHotbar(i) {
    this.slots.forEach((s, j) => s.classList.toggle('sel', j === i));
  }

  flashBlockName(name) {
    this.blockname.textContent = name;
    this.blockname.style.opacity = '1';
    clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => { this.blockname.style.opacity = '0'; }, 1200);
  }

  tick(dt, selectedName, extra = '') {
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fps = 1 / Math.max(1e-4, avg);
    this.topline.textContent = `${Math.round(this.fps)} fps · ${selectedName}${extra}`;
  }
}
