import puppeteer from 'puppeteer';
import path from 'node:path';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });
const file = 'file://' + path.resolve('dist-single/index.html') + '?shot=noon';
await page.goto(file, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction('window.READY === true', { timeout: 90000, polling: 250 });
  console.log('SINGLE FILE OK:', JSON.stringify(await page.evaluate('window.__stats()')));
  await page.screenshot({ path: 'shots/singlefile-check.png' });
} catch { console.log('SINGLE FILE TIMEOUT'); }
await browser.close();
process.exit(0);
