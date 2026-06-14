// Headless screenshot harness: boots vite dev server, drives puppeteer
// through the rubric scenarios, saves PNGs + a perf report.
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const SCENARIOS = process.argv[2]
  ? process.argv[2].split(',')
  : ['noon', 'dusk', 'night', 'cave', 'water'];

const outDir = path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const server = await createServer({
  server: { port: 5180, strictPort: true },
  logLevel: 'error',
});
await server.listen();

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-dev-shm-usage',
  ],
});

// 'cycle' expands into a fixed-camera time-lapse across the day
const expanded = [];
for (const s of SCENARIOS) {
  if (s === 'cycle') {
    for (const t of [0.23, 0.27, 0.4, 0.5, 0.62, 0.72, 0.76, 0.82, 0.95]) {
      expanded.push({ name: `cycle-${String(t).replace('.', '')}`, url: `noon&t=${t}&yaw=4.6&pitch=0.15` });
    }
  } else {
    expanded.push({ name: s, url: s });
  }
}

const report = {};
for (const { name: scenario, url: urlScenario } of expanded) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') console.log(`[${scenario}] console.${t}:`, msg.text());
  });
  page.on('pageerror', (err) => console.log(`[${scenario}] pageerror:`, err.message));

  const extra = process.env.SHOT_PARAMS ?? '';
  const url = `http://localhost:5180/?shot=${urlScenario}${extra}`;
  console.log(`[${scenario}] loading ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction('window.READY === true', { timeout: 120000, polling: 250 });
  } catch (e) {
    console.log(`[${scenario}] TIMEOUT waiting for READY`);
  }
  await new Promise((r) => setTimeout(r, 700));
  if (scenario === 'mine') {
    // hold left button: crack overlay mid-progress, then break -> particles
    await page.evaluate('window.__app.interact.buttons = 1');
    await new Promise((r) => setTimeout(r, 850));
    await page.screenshot({ path: path.join(outDir, 'mine-crack.png') });
    await page.evaluate('window.__app.interact.buttons = 0; window.__app.interact.demoBreak()');
    await new Promise((r) => setTimeout(r, 320));
    await page.screenshot({ path: path.join(outDir, 'mine-broken.png') });
  }
  if (scenario === 'tnt') {
    // show the primed (fuse-lit) block first
    await page.evaluate(`(() => {
      const it = window.__app.interact, p = window.__app.player;
      const bx = Math.floor(p.pos.x), bz = Math.floor(p.pos.z), fy = Math.floor(p.pos.y);
      it.ignite(bx, fy + 1, bz - 5, 2.0);
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(outDir, 'tnt-primed.png') });
    // force the detonation deterministically (headless rAF is throttled, so the
    // real fuse timer would lag); capture the blast, then the crater
    await page.evaluate(`(() => {
      const it = window.__app.interact, p = window.__app.player;
      const bx = Math.floor(p.pos.x), bz = Math.floor(p.pos.z), fy = Math.floor(p.pos.y);
      it.fuses.forEach((f) => { it.scene.remove(f.mesh); });
      it.fuses.length = 0;
      it.explode(bx, fy + 1, bz - 5);
    })()`);
    await new Promise((r) => setTimeout(r, 350));
    await page.screenshot({ path: path.join(outDir, 'tnt-blast.png') });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(outDir, 'tnt-after.png') });
  }
  const stats = await page.evaluate('window.__stats ? window.__stats() : null');
  report[scenario] = stats;
  await page.screenshot({ path: path.join(outDir, `${scenario}.png`) });
  console.log(`[${scenario}] saved`, JSON.stringify(stats));
  await page.close();
}

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
await server.close();
console.log('done');
