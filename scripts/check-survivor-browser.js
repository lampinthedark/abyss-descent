'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const shots = '/opt/cursor/artifacts';
fs.mkdirSync(shots, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = path.join(root, path.normalize(rel));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('missing'); return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function fail(msg) { console.error(msg); process.exit(1); }

async function pageWith(browser, url, viewport) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: 'networkidle0' });
  page.__errors = errors;
  return page;
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port + '/';
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const desk = { width: 1100, height: 800 };
    const title = await pageWith(browser, base + 'survivor.html?debug=1', desk);
    if (title.__errors.length) fail('title errors: ' + title.__errors.join(' | '));
    const playCount = await title.$$eval('button', (els) => els.filter(b => b.id === 'sv-play').length);
    if (playCount !== 1) fail('expected one Play button');
    await title.screenshot({ path: path.join(shots, 'survivor-title.png') });
    const t0 = Date.now();
    await title.click('#sv-play');
    await title.keyboard.down('KeyD');
    await title.waitForFunction(() => window.__sv && window.__sv().state === 'playing');
    const movedAt = Date.now();
    await new Promise(r => setTimeout(r, 1500));
    const early = await title.evaluate(() => window.__sv());
    if (!(early.x > 1 && Math.abs(early.y) < 0.6)) fail('top-down axes: ' + JSON.stringify(early));
    if (!early.art) fail('tileset did not load');
    if (movedAt - t0 > 10000) fail('took too long to move: ' + (movedAt - t0));
    await title.screenshot({ path: path.join(shots, 'survivor-early.png') });
    await title.screenshot({ path: path.join(shots, 'survivor-topdown-desktop.png') });
    await title.waitForFunction(() => window.__sv().hits > 0, { timeout: 8000 });
    const hit = await title.evaluate(() => window.__sv());
    if (hit.time > 5 && hit.hits < 1) fail('first hit was late');
    await title.waitForFunction(() => window.__sv().level >= 2, { timeout: 60000 });
    const lvl = await title.evaluate(() => window.__sv());
    if (lvl.time > 60) fail('first level-up after 60s: ' + JSON.stringify(lvl));
    await title.keyboard.up('KeyD');
    if (title.__errors.length) fail('play errors: ' + title.__errors.join(' | '));
    await title.close();

    const crowd = await pageWith(browser, base + 'survivor.html?debug=1&preview=crowd', desk);
    await crowd.waitForFunction(() => window.__sv && window.__sv().enemies > 40);
    await new Promise(r => setTimeout(r, 400));
    await crowd.screenshot({ path: path.join(shots, 'survivor-crowd.png') });
    if (crowd.__errors.length) fail('crowd errors: ' + crowd.__errors.join(' | '));
    await crowd.close();

    const level = await pageWith(browser, base + 'survivor.html?debug=1&preview=level', desk);
    await level.waitForSelector('#sv-level:not(.hidden) .sv-card');
    const cards = await level.$$eval('.sv-card', (els) => els.length);
    if (cards !== 3) fail('expected 3 level cards, got ' + cards);
    const cardH = await level.$eval('.sv-card', (el) => el.getBoundingClientRect().height);
    if (cardH < 80) fail('level card is too small: ' + cardH);
    await level.screenshot({ path: path.join(shots, 'survivor-level.png') });
    await level.close();

    const dead = await pageWith(browser, base + 'survivor.html?debug=1&preview=dead', desk);
    await dead.waitForSelector('#sv-end:not(.hidden) #sv-restart');
    const endText = await dead.$eval('#sv-end-stats', (el) => el.textContent);
    if (!/Time/.test(endText) || !/Kills/.test(endText) || !/Level/.test(endText)) fail('end stats: ' + endText);
    await dead.screenshot({ path: path.join(shots, 'survivor-death.png') });
    await dead.click('#sv-restart');
    await dead.waitForFunction(() => window.__sv && window.__sv().state === 'playing' && window.__sv().kills === 0);
    await dead.close();

    const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
    const portrait = await pageWith(browser, base + 'survivor.html?debug=1', phone);
    await portrait.click('#sv-play');
    await portrait.mouse.move(120, 620);
    await portrait.mouse.down();
    await portrait.mouse.move(180, 560);
    await new Promise(r => setTimeout(r, 200));
    await portrait.screenshot({ path: path.join(shots, 'survivor-joystick-portrait.png') });
    await portrait.screenshot({ path: path.join(shots, 'survivor-topdown-portrait.png') });
    await portrait.mouse.up();
    if (portrait.__errors.length) fail('portrait errors: ' + portrait.__errors.join(' | '));
    await portrait.close();

    const land = { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
    const landscape = await pageWith(browser, base + 'survivor.html?debug=1', land);
    await landscape.click('#sv-play');
    await landscape.mouse.move(180, 240);
    await landscape.mouse.down();
    await landscape.mouse.move(260, 200);
    await new Promise(r => setTimeout(r, 200));
    await landscape.screenshot({ path: path.join(shots, 'survivor-joystick-landscape.png') });
    await landscape.mouse.up();
    if (landscape.__errors.length) fail('landscape errors: ' + landscape.__errors.join(' | '));
    await landscape.close();

    const ads = await pageWith(browser, base + 'survivor.html?debug=1&adtest=1', desk);
    await ads.click('#sv-play');
    await ads.click('[data-ad-offer="revive"]');
    const held = await ads.$eval('#adtest-held', (el) => !el.classList.contains('hidden') && el.textContent.includes('held'));
    const promptHidden = await ads.$eval('#adtest-prompt', (el) => el.classList.contains('hidden'));
    if (!held || !promptHidden) fail('ad showed during play');
    await ads.goto(base + 'survivor.html?debug=1&adtest=1&preview=level', { waitUntil: 'networkidle0' });
    await ads.waitForSelector('#sv-reroll');
    await ads.click('#sv-reroll');
    const label = await ads.$eval('[data-ad-label]', (el) => el.textContent);
    const shown = await ads.$eval('#adtest-prompt', (el) => !el.classList.contains('hidden'));
    if (!shown || label !== 'TEST AD: Reroll') fail('reroll prompt: ' + label);
    await ads.close();

    const juice = await pageWith(browser, base + 'survivor.html?debug=1&preview=juice', desk);
    await juice.waitForFunction(() => {
      const s = window.__sv();
      return s && s.state === 'playing' && s.hits >= 1 && s.floats > 0;
    }, { timeout: 8000 });
    await juice.evaluate(() => { window.__svGems(); window.__svFlash(); });
    await new Promise(r => setTimeout(r, 180));
    await juice.screenshot({ path: path.join(shots, 'survivor-juice-desktop.png') });
    await juice.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await juice.evaluate(() => { window.__svGems(); window.__svFlash(); });
    await new Promise(r => setTimeout(r, 160));
    await juice.screenshot({ path: path.join(shots, 'survivor-juice-portrait.png') });
    if (juice.__errors.length) fail('juice errors: ' + juice.__errors.join(' | '));
    await juice.close();

    const five = await pageWith(browser, base + 'survivor.html?debug=1&preview=crowd', phone);
    await five.waitForFunction(() => window.__sv && window.__sv().art && window.__sv().time > 290 && window.__sv().enemies > 20, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 500));
    await five.screenshot({ path: path.join(shots, 'survivor-phone-5min.png') });
    if (five.__errors.length) fail('five minute errors: ' + five.__errors.join(' | '));
    await five.close();

    const boss = await pageWith(browser, base + 'survivor.html?debug=1&preview=boss', desk);
    await boss.waitForFunction(() => window.__sv && window.__sv().art && window.__sv().enemies > 5, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 600));
    await boss.screenshot({ path: path.join(shots, 'survivor-boss.png') });
    if (boss.__errors.length) fail('boss errors: ' + boss.__errors.join(' | '));
    await boss.close();

    const bench = await pageWith(browser, base + 'survivor.html?debug=1&bench=1', desk);
    await bench.waitForFunction(() => window.__fps && window.__fps.frames > 30, { timeout: 20000 });
    const fps = await bench.evaluate(() => window.__fps);
    console.log('FPS', JSON.stringify(fps));
    if (fps.enemies < 300) fail('bench spawned ' + fps.enemies);
    if (fps.avg < 55) fail('avg fps ' + fps.avg);
    fs.writeFileSync(path.join(shots, 'survivor-fps.json'), JSON.stringify(fps, null, 2));
    await bench.screenshot({ path: path.join(shots, 'survivor-bench.png') });
    if (bench.__errors.length) fail('bench errors: ' + bench.__errors.join(' | '));
    await bench.close();

    const swarmed = await pageWith(browser, base + 'survivor.html?debug=1&bench=1', phone);
    await swarmed.waitForFunction(() => window.__sv && window.__sv().enemies >= 300, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 400));
    await swarmed.screenshot({ path: path.join(shots, 'survivor-phone-crowd.png') });
    if (swarmed.__errors.length) fail('phone crowd errors: ' + swarmed.__errors.join(' | '));
    await swarmed.close();

    const old = await pageWith(browser, base + 'index.html', desk);
    const link = await old.$eval('.mode-link a', (el) => el.textContent + ' ' + el.getAttribute('href'));
    if (!link.includes('Try: Survivor mode (beta)') || !link.includes('survivor.html?v=1')) fail('link: ' + link);
    if (old.__errors.length) fail('index errors: ' + old.__errors.join(' | '));
    await old.close();

    console.log('survivor browser ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
