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
  const logs = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    logs.push(msg.text());
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: 'networkidle0' });
  page.__errors = errors;
  page.__logs = logs;
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
    await title.waitForFunction(() => window.__sv && window.__sv().state === 'playing');
    const merged = await title.evaluate(() => window.__svMerge());
    if (!merged || merged.added !== 1 || merged.text !== '15') fail('damage numbers did not merge: ' + JSON.stringify(merged));
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

    const farPage = await pageWith(browser, base + 'survivor.html?debug=1', desk);
    await farPage.click('#sv-play');
    await farPage.waitForFunction(() => window.__sv && window.__sv().art && window.__sv().state === 'playing');
    await farPage.evaluate(() => window.__svPan(48, -36));
    await new Promise(r => setTimeout(r, 200));
    const far = await farPage.evaluate(() => window.__sv());
    if (Math.hypot(far.x, far.y) < 40) fail('could not leave the old arena: ' + JSON.stringify(far));
    const corners = await farPage.evaluate(() => {
      const c = document.getElementById('game');
      const g = c.getContext('2d');
      const pts = [[4, 4], [c.width - 5, 4], [4, c.height - 5], [c.width - 5, c.height - 5]];
      return pts.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3));
    });
    if (corners.some((p) => p[0] < 28 && p[1] < 24 && p[2] < 24)) fail('dark floor edge: ' + JSON.stringify(corners));
    await farPage.screenshot({ path: path.join(shots, 'survivor-endless.png') });
    if (farPage.__errors.length) fail('endless errors: ' + farPage.__errors.join(' | '));
    await farPage.close();

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

    const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
    const phoneLevel = await pageWith(browser, base + 'survivor.html?debug=1&preview=level', phone);
    await phoneLevel.waitForSelector('#sv-level:not(.hidden) .sv-card');
    const phoneCard = await phoneLevel.evaluate(() => {
      const card = document.querySelector('.sv-card');
      const box = card.getBoundingClientRect();
      const titleSize = parseFloat(getComputedStyle(card.querySelector('b')).fontSize);
      const bodySize = parseFloat(getComputedStyle(card.querySelector('small')).fontSize);
      const dir = getComputedStyle(document.getElementById('sv-cards')).flexDirection;
      return { h: box.height, w: box.width, titleSize, bodySize, dir };
    });
    if (phoneCard.h < 44 || phoneCard.w < 200) fail('phone card tap target: ' + JSON.stringify(phoneCard));
    if (phoneCard.titleSize < 22 || phoneCard.bodySize < 16) fail('phone card text: ' + JSON.stringify(phoneCard));
    if (phoneCard.dir !== 'column') fail('phone cards should stack: ' + phoneCard.dir);
    await phoneLevel.screenshot({ path: path.join(shots, 'survivor-level-portrait.png') });
    if (phoneLevel.__errors.length) fail('phone level errors: ' + phoneLevel.__errors.join(' | '));
    await phoneLevel.close();

    const dead = await pageWith(browser, base + 'survivor.html?debug=1&preview=dead', desk);
    await dead.waitForSelector('#sv-end:not(.hidden) #sv-restart');
    const endText = await dead.$eval('#sv-end-stats', (el) => el.textContent);
    if (!/Time/.test(endText) || !/Kills/.test(endText) || !/Level/.test(endText)) fail('end stats: ' + endText);
    await dead.screenshot({ path: path.join(shots, 'survivor-death.png') });
    await dead.click('#sv-restart');
    await dead.waitForFunction(() => window.__sv && window.__sv().state === 'playing' && window.__sv().kills === 0);
    await dead.close();

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
    const held = await ads.$eval('#adtest-held', (el) => el.classList.contains('hidden'));
    const promptHidden = await ads.$eval('#adtest-prompt', (el) => el.classList.contains('hidden'));
    if (!held || !promptHidden) fail('revive was held or shown mid-fight');
    if (!ads.__logs.some((line) => line.indexOf('ad dropped: revive') >= 0)) fail('mid-fight drop was not logged');
    await ads.goto(base + 'survivor.html?debug=1&adtest=1&preview=level', { waitUntil: 'networkidle0' });
    await ads.waitForSelector('#sv-reroll');
    await ads.click('[data-ad-offer="gold"]');
    const goldHidden = await ads.$eval('#adtest-prompt', (el) => el.classList.contains('hidden'));
    if (!goldHidden) fail('double gold showed over level-up cards');
    if (!ads.__logs.some((line) => line.indexOf('ad dropped: gold') >= 0)) fail('level-up gold drop was not logged');
    await ads.click('#sv-reroll');
    const label = await ads.$eval('[data-ad-label]', (el) => el.textContent);
    const shown = await ads.$eval('#adtest-prompt', (el) => !el.classList.contains('hidden'));
    if (!shown || label !== 'TEST AD: Reroll') fail('reroll prompt: ' + label);
    await ads.close();

    const deadAd = await pageWith(browser, base + 'survivor.html?debug=1&adtest=1&preview=dead', desk);
    await deadAd.waitForSelector('#sv-end:not(.hidden) #sv-revive');
    const deathBtns = await deadAd.evaluate(() => ({
      revive: !document.getElementById('sv-revive').classList.contains('hidden'),
      gold: !document.getElementById('sv-double').classList.contains('hidden'),
      prompt: document.getElementById('adtest-prompt').classList.contains('hidden'),
    }));
    if (!deathBtns.revive || !deathBtns.gold || !deathBtns.prompt) fail('death screen ads: ' + JSON.stringify(deathBtns));
    await deadAd.screenshot({ path: path.join(shots, 'survivor-death-adtest.png') });
    await deadAd.click('#sv-revive');
    const reviveLabel = await deadAd.$eval('[data-ad-label]', (el) => el.textContent);
    if (reviveLabel !== 'TEST AD: Revive') fail('death revive prompt: ' + reviveLabel);
    await deadAd.click('[data-ad-dismiss]');
    await deadAd.click('#sv-double');
    const goldLabel = await deadAd.$eval('[data-ad-label]', (el) => el.textContent);
    if (goldLabel !== 'TEST AD: Double gold') fail('death gold prompt: ' + goldLabel);
    await deadAd.close();

    const plain = await pageWith(browser, base + 'survivor.html?debug=1&preview=dead', desk);
    await plain.waitForSelector('#sv-end:not(.hidden) #sv-restart');
    const plainAds = await plain.evaluate(() => ({
      panel: document.getElementById('adtest-panel').classList.contains('hidden'),
      prompt: document.getElementById('adtest-prompt').classList.contains('hidden'),
      revive: document.getElementById('sv-revive').classList.contains('hidden'),
      gold: document.getElementById('sv-double').classList.contains('hidden'),
      descent: !!document.getElementById('title-screen'),
    }));
    if (!plainAds.panel || !plainAds.prompt || !plainAds.revive || !plainAds.gold || plainAds.descent) {
      fail('plain url showed an ad or the descent menu: ' + JSON.stringify(plainAds));
    }
    await plain.close();

    const freeRoll = await pageWith(browser, base + 'survivor.html?debug=1&preview=level', desk);
    await freeRoll.waitForSelector('#sv-level:not(.hidden) .sv-card');
    const firstCards = await freeRoll.$$eval('.sv-card b', (els) => els.map((el) => el.textContent).join('|'));
    await freeRoll.click('#sv-reroll');
    const secondCards = await freeRoll.$$eval('.sv-card b', (els) => els.map((el) => el.textContent).join('|'));
    const used = await freeRoll.$eval('#sv-reroll', (el) => el.disabled && el.textContent);
    if (secondCards === firstCards) fail('free reroll did not change cards: ' + firstCards);
    if (used !== 'used') fail('reroll label: ' + used);
    const promptStill = await freeRoll.$eval('#adtest-prompt', (el) => el.classList.contains('hidden'));
    if (!promptStill) fail('free reroll opened an ad');
    await freeRoll.close();

    const hermit = await pageWith(browser, base + 'survivor.html?debug=1&preview=hermit', desk);
    await hermit.waitForSelector('#sv-hermit:not(.hidden) #sv-hermit-yes');
    await hermit.click('#sv-hermit-yes');
    const vowed = await hermit.evaluate(() => ({
      level: document.getElementById('sv-level').classList.contains('hidden'),
      vow: !document.getElementById('sv-vow').classList.contains('hidden'),
      state: window.__sv().state,
      payout: window.__sv().vow,
    }));
    if (!vowed.level || !vowed.vow || vowed.state !== 'playing' || !vowed.payout) {
      fail('vow paid out early: ' + JSON.stringify(vowed));
    }
    await hermit.evaluate(() => window.__svEndVow());
    await hermit.waitForSelector('#sv-level:not(.hidden) .sv-card', { timeout: 4000 });
    const picks = await hermit.$$eval('.sv-card', (els) => els.length);
    if (picks !== 3) fail('vow payout cards: ' + picks);
    await hermit.close();

    const hermitDead = await pageWith(browser, base + 'survivor.html?debug=1&preview=hermit', desk);
    await hermitDead.waitForSelector('#sv-hermit-yes');
    await hermitDead.click('#sv-hermit-yes');
    await hermitDead.evaluate(() => window.__svHurt(9999));
    await hermitDead.waitForFunction(() => window.__sv().state === 'dead');
    await new Promise(r => setTimeout(r, 400));
    const noPayout = await hermitDead.evaluate(() => ({
      level: document.getElementById('sv-level').classList.contains('hidden'),
      vow: window.__sv().vow,
    }));
    if (!noPayout.level || noPayout.vow) fail('death still paid the vow: ' + JSON.stringify(noPayout));
    await hermitDead.close();

    const drag = await pageWith(browser, base + 'survivor.html?debug=1', desk);
    await drag.click('#sv-play');
    await drag.waitForFunction(() => window.__sv && window.__sv().state === 'playing');
    const origin = await drag.evaluate(() => window.__sv());
    await drag.mouse.move(480, 420);
    await drag.mouse.down();
    await drag.mouse.move(640, 420, { steps: 10 });
    await new Promise(r => setTimeout(r, 350));
    const dragged = await drag.evaluate(() => window.__sv());
    await drag.mouse.up();
    if (!(dragged.x > origin.x + 0.35)) fail('mouse drag did not move the hero: ' + JSON.stringify({ origin, dragged }));
    const nearGem = await drag.evaluate(() => window.__svGem(20));
    await drag.waitForFunction((token) => window.__svGemGone(token), { timeout: 2000 }, nearGem);
    await drag.evaluate(() => window.__svMagnet(2));
    const farGem = await drag.evaluate(() => window.__svGem(90));
    await drag.waitForFunction((token) => window.__svGemGone(token), { timeout: 2000 }, farGem);
    if (drag.__errors.length) fail('drag errors: ' + drag.__errors.join(' | '));
    await drag.close();

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

    const bench = await pageWith(browser, base + 'survivor.html?v=3&debug=1&bench=1', desk);
    await bench.waitForFunction(() => window.__fps && window.__fps.frames > 30, { timeout: 25000 });
    const fps = await bench.evaluate(() => window.__fps);
    const benchText = await bench.$eval('#sv-bench', (el) => el.textContent);
    const fpsSize = await bench.$eval('#sv-fps', (el) => parseFloat(getComputedStyle(el).fontSize));
    console.log('FPS', JSON.stringify(fps), benchText, 'live', fpsSize);
    if (fps.enemies < 300) fail('bench spawned ' + fps.enemies);
    if (fps.avg < 55) fail('avg fps ' + fps.avg);
    if (!/avg /.test(benchText) || !/min /.test(benchText) || !/dpr/.test(benchText)) fail('bench result: ' + benchText);
    if (!(fps.dpr > 0) || !fps.screen) fail('bench device info: ' + JSON.stringify(fps));
    if (fpsSize < 24) fail('live fps is too small: ' + fpsSize);
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
