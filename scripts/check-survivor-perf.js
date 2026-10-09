'use strict';
// Perf guard: the 3:30 peak wave (medieval, FX on) at phone size in headless Chrome.
// Times each requestAnimationFrame callback (sim + draw + FX + HUD + a forced raster
// flush) and asserts the
// median frame cost against BUDGET_MS. Skips cleanly when puppeteer-core or Chrome
// is not on the machine (set PUPPETEER_CORE / CHROME_PATH to point at them).
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
// Median frame-work budget. Real-time target is 16 ms; see BASELINE note in the log.
const BUDGET_MS = 16;

function findPuppeteer() {
  const tries = [process.env.PUPPETEER_CORE, 'puppeteer-core', '/workspace/art-direction/node_modules/puppeteer-core'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  return null;
}
function findChrome() {
  const tries = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return tries.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
}

const puppeteer = findPuppeteer();
const chrome = findChrome();
if (!puppeteer || !chrome) {
  console.log('perf guard skipped: ' + (!puppeteer ? 'no puppeteer-core' : 'no Chrome'));
  process.exit(0);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const f = path.join(root, rel);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  let code = 0;
  try {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    // Wrap rAF so each frame callback's own cost is recorded.
    await page.evaluateOnNewDocument(() => {
      const raf = window.requestAnimationFrame.bind(window);
      // A 1-pixel readback after each frame forces the canvas to rasterize now, so the
      // time includes the real pixel work (not just recording draw calls).
      window.__frameMs = [];
      let cv = null;
      let cx = null;
      window.requestAnimationFrame = (cb) => raf((t) => {
        const t0 = performance.now();
        cb(t);
        if (!cv) { cv = document.getElementById('game'); cx = cv && cv.getContext('2d'); }
        if (cx) cx.getImageData(0, 0, 1, 1);
        if (window.__frameMs.length < 4000) window.__frameMs.push(performance.now() - t0);
      });
    });
    const url = 'http://127.0.0.1:' + server.address().port + '/survivor.html?mode=medieval&debug=1&t=206&walk=kite&autopick=1';
    await page.goto(url, { waitUntil: 'load' });
    await sleep(800);
    await page.evaluate(() => document.getElementById('sv-play').click());
    // Let the 3:30 wave (cap 90 x density) fill the screen.
    let snap = null;
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      snap = await page.evaluate(() => (window.__svSnap ? window.__svSnap() : null));
      if (snap && snap.state === 'playing' && snap.time > 212 && snap.enemies >= 90) break;
    }
    if (!snap || snap.enemies < 60) throw new Error('peak wave never filled: ' + JSON.stringify(snap && { t: snap.time, en: snap.enemies, state: snap.state }));
    await page.evaluate(() => { window.__frameMs.length = 0; });
    await sleep(6000);
    const res = await page.evaluate(() => {
      const a = window.__frameMs.slice().sort((x, y) => x - y);
      const s = window.__svSnap();
      return { n: a.length, median: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)], enemies: s.enemies, time: s.time, fx: typeof FX !== 'undefined' };
    });
    if (errs.length) throw new Error('page errors: ' + errs.join(' | '));
    if (!res.fx) throw new Error('FX not loaded');
    const line = 'perf guard: 3:30 wave, ' + res.enemies + ' foes, ' + res.n + ' frames, median ' + res.median.toFixed(2) + ' ms, p95 ' + res.p95.toFixed(2) + ' ms (budget ' + BUDGET_MS + ' ms median, 390x844 @2x, headless Chrome, no GPU)';
    if (!(res.median < BUDGET_MS)) { console.error(line); code = 1; } else console.log(line);
  } catch (e) {
    console.error('perf guard failed: ' + (e && e.message || e));
    code = 1;
  }
  await browser.close();
  server.close();
  process.exit(code);
})();
