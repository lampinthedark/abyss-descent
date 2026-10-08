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
    await title.keyboard.up('KeyD');
    await title.screenshot({ path: path.join(shots, 'survivor-early.png') });
    await title.screenshot({ path: path.join(shots, 'survivor-topdown-desktop.png') });
    await title.waitForFunction(() => window.__sv().hits > 0, { timeout: 8000 });
    const hit = await title.evaluate(() => window.__sv());
    if (hit.time > 5 && hit.hits < 1) fail('first hit was late');
    await title.keyboard.down('KeyA');
    await new Promise(r => setTimeout(r, 1200));
    await title.keyboard.up('KeyA');
    const levelDeadline = Date.now() + 60000;
    let lvl = await title.evaluate(() => window.__sv());
    while (lvl.level < 2 && Date.now() < levelDeadline) {
      if (lvl.state === 'hermit') await title.click('#sv-hermit-no');
      await new Promise(r => setTimeout(r, 200));
      lvl = await title.evaluate(() => window.__sv());
    }
    if (lvl.level < 2) fail('no level-up: ' + JSON.stringify(lvl) + ' errors ' + title.__errors.join(' | '));
    if (lvl.time > 60) fail('first level-up after 60s: ' + JSON.stringify(lvl));
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
    await level.evaluate(() => window.__svGuard());
    await level.click('.sv-card');
    const cardBlocked = await level.evaluate(() => window.__sv().state);
    if (cardBlocked !== 'levelup') fail('level card skipped the 300ms guard, state ' + cardBlocked);
    await level.screenshot({ path: path.join(shots, 'survivor-level.png') });
    await level.close();

    const build = await pageWith(browser, base + 'survivor.html?debug=1&preview=build', desk);
    await build.waitForSelector('#sv-level:not(.hidden) .sv-card.evolves .sv-evo');
    const buildRow = await build.evaluate(() => ({
      icons: document.querySelectorAll('#sv-build .sv-ico.on').length,
      hint: document.querySelector('.sv-evo').textContent,
      pips: document.querySelector('.sv-rank') ? document.querySelector('.sv-rank').textContent : '',
    }));
    if (buildRow.icons < 2) fail('build row icons: ' + JSON.stringify(buildRow));
    if (!/Storm of Blades|Cinder Halo/.test(buildRow.hint)) fail('evolve hint: ' + buildRow.hint);
    if (!/\/5/.test(buildRow.pips)) fail('rank pips: ' + buildRow.pips);
    await build.screenshot({ path: path.join(shots, 'survivor-level-build.png') });
    await build.close();

    const buildLand = await pageWith(browser, base + 'survivor.html?debug=1&preview=build', { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await buildLand.waitForSelector('#sv-level:not(.hidden) .sv-card.evolves');
    const landDir = await buildLand.$eval('#sv-cards', (el) => getComputedStyle(el).flexDirection);
    if (landDir !== 'row') fail('landscape cards should sit in a row: ' + landDir);
    await buildLand.screenshot({ path: path.join(shots, 'survivor-level-landscape.png') });
    await buildLand.close();

    const warden = await pageWith(browser, base + 'survivor.html?debug=1&preview=warden', desk);
    await warden.waitForFunction(() => {
      const warn = document.getElementById('sv-warn');
      const bar = document.getElementById('sv-boss');
      return warn && bar && !warn.classList.contains('hidden') && !bar.classList.contains('hidden') && window.__sv && window.__sv().art;
    }, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 250));
    await warden.screenshot({ path: path.join(shots, 'survivor-warden.png') });
    if (warden.__errors.length) fail('warden errors: ' + warden.__errors.join(' | '));
    await warden.close();

    const tells = await pageWith(browser, base + 'survivor.html?debug=1&preview=tells', desk);
    await tells.waitForFunction(() => window.__sv && window.__sv().art && window.__sv().enemies >= 2, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 200));
    await tells.screenshot({ path: path.join(shots, 'survivor-tells.png') });
    if (tells.__errors.length) fail('tell errors: ' + tells.__errors.join(' | '));
    await tells.close();

    const phone = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
    const phoneLevel = await pageWith(browser, base + 'survivor.html?debug=1&preview=build', phone);
    await phoneLevel.waitForSelector('#sv-level:not(.hidden) .sv-card');
    const phoneCard = await phoneLevel.evaluate(() => {
      const card = document.querySelector('.sv-card');
      const box = card.getBoundingClientRect();
      const titleSize = parseFloat(getComputedStyle(card.querySelector('b')).fontSize);
      const bodySize = parseFloat(getComputedStyle(card.querySelector('small:not(.sv-evo)') || card.querySelector('small')).fontSize);
      const dir = getComputedStyle(document.getElementById('sv-cards')).flexDirection;
      return { h: box.height, w: box.width, titleSize, bodySize, dir };
    });
    if (phoneCard.h < 44 || phoneCard.w < 200) fail('phone card tap target: ' + JSON.stringify(phoneCard));
    if (phoneCard.titleSize < 22 || phoneCard.bodySize < 16) fail('phone card text: ' + JSON.stringify(phoneCard));
    if (phoneCard.dir !== 'column') fail('phone cards should stack: ' + phoneCard.dir);
    const phoneHint = await phoneLevel.$eval('.sv-evo', (el) => el.textContent);
    if (!/Storm of Blades|Cinder Halo/.test(phoneHint)) fail('portrait evolve hint: ' + phoneHint);
    const rerollBox = await phoneLevel.$eval('#sv-reroll', (el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    if (rerollBox.h < 48 || rerollBox.w < 48) fail('reroll hit area: ' + JSON.stringify(rerollBox));
    await phoneLevel.screenshot({ path: path.join(shots, 'survivor-level-portrait.png') });
    if (phoneLevel.__errors.length) fail('phone level errors: ' + phoneLevel.__errors.join(' | '));
    await phoneLevel.close();

    const dead = await pageWith(browser, base + 'survivor.html?debug=1&preview=dead', desk);
    await dead.waitForSelector('#sv-end:not(.hidden) #sv-restart');
    const endText = await dead.$eval('#sv-end-stats', (el) => el.textContent);
    if (!/survived/.test(endText) || !/kills/.test(endText) || !/level/.test(endText)) fail('end stats: ' + endText);
    const best = await dead.$eval('#sv-best', (el) => ({ on: !el.classList.contains('hidden'), text: el.textContent }));
    const away = await dead.$eval('#sv-next', (el) => el.textContent);
    const banked = await dead.$eval('#sv-end-gold', (el) => el.textContent);
    if (!best.on || !/NEW BEST/i.test(best.text)) fail('new best badge: ' + JSON.stringify(best));
    if (!/gold away/.test(away)) fail('gold away: ' + away);
    if (!/gold banked/.test(banked)) fail('gold banked: ' + banked);
    await dead.screenshot({ path: path.join(shots, 'survivor-death.png') });
    await dead.click('#sv-end-shop');
    await dead.waitForSelector('#sv-shop:not(.hidden) .sv-shop-buy');
    const shopInfo = await dead.evaluate(() => {
      const buys = Array.from(document.querySelectorAll('.sv-shop-buy')).map((el) => {
        const r = el.getBoundingClientRect();
        return { h: r.height, w: r.width, text: el.textContent };
      });
      return {
        buys: buys.length,
        minH: Math.min.apply(null, buys.map((b) => b.h)),
        minW: Math.min.apply(null, buys.map((b) => b.w)),
        text: document.getElementById('sv-shop').textContent,
      };
    });
    if (shopInfo.buys < 6) fail('shop rows: ' + shopInfo.buys);
    if (shopInfo.minH < 48 || shopInfo.minW < 48) fail('shop hit area: ' + JSON.stringify(shopInfo));
    if (!/Cosmetics: coming soon/.test(shopInfo.text)) fail('cosmetics slot: ' + shopInfo.text);
    await dead.screenshot({ path: path.join(shots, 'survivor-shop.png') });
    await dead.click('#sv-shop-close');
    await dead.waitForSelector('#sv-end:not(.hidden) #sv-restart');
    await dead.evaluate(() => window.__svGuard());
    await dead.click('#sv-restart');
    const guarded = await dead.evaluate(() => window.__sv().state);
    if (guarded !== 'dead') fail('restart skipped the 300ms guard, state ' + guarded);
    await new Promise(r => setTimeout(r, 360));
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
    const adHits = await deadAd.evaluate(() => ['sv-revive', 'sv-double', 'sv-end-shop'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { id: id, w: r.width, h: r.height };
    }));
    if (adHits.some((b) => b.h < 48 || b.w < 48)) fail('death hit areas: ' + JSON.stringify(adHits));
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

    const doubled = await pageWith(browser, base + 'survivor.html?debug=1&adtest=1&preview=dead', desk);
    await doubled.waitForSelector('#sv-end:not(.hidden) #sv-end-time');
    await new Promise(r => setTimeout(r, 360));
    const beforeTime = await doubled.$eval('#sv-end-time', (el) => el.textContent);
    await doubled.click('#sv-double');
    await doubled.waitForSelector('#adtest-prompt:not(.hidden) [data-ad-accept]');
    await doubled.click('[data-ad-accept]');
    const afterGold = await doubled.evaluate(() => ({
      disabled: document.getElementById('sv-double').disabled,
      time: document.getElementById('sv-end-time').textContent,
      timeTag: document.getElementById('sv-end-time').tagName,
      gold: document.getElementById('sv-end-gold').textContent,
      stats: document.getElementById('sv-end-stats').textContent,
    }));
    if (!/\d:\d\d/.test(afterGold.time) || afterGold.time !== beforeTime) fail('double gold wiped the time: ' + JSON.stringify(afterGold));
    if (!/36 gold banked/.test(afterGold.gold)) fail('double gold amount: ' + afterGold.gold);
    if (!/survived/.test(afterGold.stats) || !/kills/.test(afterGold.stats)) fail('double gold wiped stats: ' + afterGold.stats);
    if (!afterGold.disabled) fail('double gold stayed tappable: ' + JSON.stringify(afterGold));
    await doubled.screenshot({ path: path.join(shots, 'survivor-death-doubled.png') });
    const secondAd = await doubled.evaluate(() => ({
      hidden: document.getElementById('sv-double').classList.contains('hidden'),
      prompt: !document.getElementById('adtest-prompt').classList.contains('hidden'),
    }));
    if (!secondAd.hidden || secondAd.prompt) fail('double gold stayed offered: ' + JSON.stringify(secondAd));
    await new Promise(r => setTimeout(r, 360));
    await doubled.click('#sv-revive');
    await doubled.waitForSelector('#adtest-prompt:not(.hidden) [data-ad-accept]');
    await doubled.click('[data-ad-accept]');
    await doubled.waitForFunction(() => window.__sv && window.__sv().state === 'playing');
    await doubled.evaluate(() => window.__svHurt(9999));
    await doubled.waitForFunction(() => window.__sv && window.__sv().state === 'dead');
    const second = await doubled.evaluate(() => ({
      time: document.getElementById('sv-end-time') && document.getElementById('sv-end-time').textContent,
      gold: document.getElementById('sv-end-gold') && document.getElementById('sv-end-gold').textContent,
      hidden: document.getElementById('sv-double').classList.contains('hidden'),
    }));
    if (!second.time || !/\d:\d\d/.test(second.time)) fail('second death lost the time: ' + JSON.stringify(second));
    if (!/36 gold banked/.test(second.gold || '')) fail('double gold applied again after revive: ' + JSON.stringify(second));
    if (!second.hidden) fail('double gold was offered again after revive: ' + JSON.stringify(second));
    await doubled.close();

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
    await new Promise(r => setTimeout(r, 360));
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
    await hermit.screenshot({ path: path.join(shots, 'survivor-hermit.png') });
    await new Promise(r => setTimeout(r, 360));
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
    await new Promise(r => setTimeout(r, 360));
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
      return s && s.hits >= 1;
    }, { timeout: 8000 });
    if (await juice.evaluate(() => window.__sv().state === 'levelup')) {
      await new Promise(r => setTimeout(r, 360));
      await juice.click('#sv-cards .sv-card');
    }
    await juice.waitForFunction(() => {
      const s = window.__sv();
      return s && s.state === 'playing' && s.floats > 0;
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

    const minute3 = await pageWith(browser, base + 'survivor.html?debug=1&preview=minute3', phone);
    await minute3.waitForFunction(() => {
      const s = window.__sv && window.__sv();
      return s && s.art && s.time > 170 && s.time < 200 && s.enemies > 20;
    }, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 300));
    await minute3.screenshot({ path: path.join(shots, 'survivor-phone-3min.png') });
    if (minute3.__errors.length) fail('minute 3 errors: ' + minute3.__errors.join(' | '));
    await minute3.close();

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

    const bench = await pageWith(browser, base + 'survivor.html?v=6&debug=1&bench=1', desk);
    await bench.waitForFunction(() => window.__fps && window.__fps.frames > 30, { timeout: 30000 });
    const fps = await bench.evaluate(() => window.__fps);
    const benchText = await bench.$eval('#sv-bench', (el) => el.textContent);
    const fpsSize = await bench.$eval('#sv-fps', (el) => parseFloat(getComputedStyle(el).fontSize));
    const benchSize = await bench.$eval('#sv-bench', (el) => parseFloat(getComputedStyle(el).fontSize));
    console.log('FPS', JSON.stringify(fps), benchText, 'live', fpsSize, 'result', benchSize);
    if (fps.enemies < 300) fail('bench spawned ' + fps.enemies);
    if (fps.avg < 55) fail('avg fps ' + fps.avg);
    if (typeof fps.slow !== 'number' || typeof fps.slowPct !== 'number') fail('bench slow frames: ' + JSON.stringify(fps));
    if (fps.slowPct < 0 || fps.slowPct > 100) fail('bench slow percent: ' + fps.slowPct);
    if (!/avg /.test(benchText) || !/min /.test(benchText) || !/dpr/.test(benchText)) fail('bench result: ' + benchText);
    if (!/frames over 33ms/.test(benchText) || !/%/.test(benchText)) fail('bench slow line: ' + benchText);
    if (!(fps.dpr > 0) || !fps.screen) fail('bench device info: ' + JSON.stringify(fps));
    if (fpsSize < 24) fail('live fps is too small: ' + fpsSize);
    if (benchSize < 24) fail('bench result is too small: ' + benchSize);
    fs.writeFileSync(path.join(shots, 'survivor-fps.json'), JSON.stringify(fps, null, 2));
    await bench.screenshot({ path: path.join(shots, 'survivor-bench.png') });
    if (bench.__errors.length) fail('bench errors: ' + bench.__errors.join(' | '));
    await bench.close();

    const swarmed = await pageWith(browser, base + 'survivor.html?debug=1&bench=1', phone);
    await swarmed.waitForFunction(() => window.__sv && window.__sv().enemies >= 300, { timeout: 8000 });
    await new Promise(r => setTimeout(r, 400));
    await swarmed.screenshot({ path: path.join(shots, 'survivor-phone-crowd.png') });
    const dropInfo = await swarmed.evaluate(() => window.__svDrops());
    if (!dropInfo || dropInfo.enemies < 100) fail('drop crowd: ' + JSON.stringify(dropInfo));
    await swarmed.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const dropPixels = await swarmed.evaluate((spots) => {
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const want = {
        common: [138, 133, 125],
        uncommon: [94, 211, 122],
        rare: [76, 124, 255],
        epic: [208, 180, 255],
        legendary: [242, 246, 255],
      };
      return spots.map((spot) => {
        const rgb = want[spot.rarity];
        let hits = 0;
        let sample = null;
        const cx = Math.round(spot.x);
        const cy = Math.round(spot.y);
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const px = ctx.getImageData(cx + dx, cy + dy, 1, 1).data;
            if (!sample) sample = [px[0], px[1], px[2]];
            if (Math.abs(px[0] - rgb[0]) < 18 && Math.abs(px[1] - rgb[1]) < 18 && Math.abs(px[2] - rgb[2]) < 18) hits += 1;
          }
        }
        return { rarity: spot.rarity, hits: hits, sample: sample, x: cx, y: cy };
      });
    }, dropInfo.spots);
    const dropLeft = await swarmed.evaluate(() => window.__svItems());
    await swarmed.screenshot({ path: path.join(shots, 'survivor-drops-crowd.png') });
    console.log('drops', JSON.stringify({ enemies: dropInfo.enemies, pixels: dropPixels, left: dropLeft }));
    dropPixels.forEach((row) => {
      if (row.hits < 8) fail('rarity square ' + row.rarity + ' not on the floor: ' + JSON.stringify(row));
    });
    ['common', 'uncommon', 'rare', 'epic', 'legendary'].forEach((rarity) => {
      if (dropLeft.indexOf(rarity) < 0) fail('missing floor drop ' + rarity + ': ' + dropLeft.join(','));
    });
    if (swarmed.__errors.length) fail('phone crowd errors: ' + swarmed.__errors.join(' | '));
    await swarmed.close();

    const phoneDead = await pageWith(browser, base + 'survivor.html?debug=1&preview=dead', phone);
    await phoneDead.waitForSelector('#sv-end:not(.hidden) #sv-restart');
    const restartPlace = await phoneDead.evaluate(() => {
      const r = document.getElementById('sv-restart').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: window.innerHeight };
    });
    if (restartPlace.bottom < restartPlace.h * 0.82) fail('portrait restart is not in the thumb zone: ' + JSON.stringify(restartPlace));
    await phoneDead.screenshot({ path: path.join(shots, 'survivor-death-portrait.png') });
    if (phoneDead.__errors.length) fail('portrait death errors: ' + phoneDead.__errors.join(' | '));
    await phoneDead.close();

    const ward = await pageWith(browser, base + 'survivor.html?debug=1&t=150&walk=circle', desk);
    await ward.click('#sv-play');
    await ward.waitForFunction(() => {
      const bar = document.getElementById('sv-boss');
      const name = document.getElementById('sv-boss-name');
      return bar && name && !bar.classList.contains('hidden') && /Grave Warden/.test(name.textContent);
    }, { timeout: 8000 });
    const casters = await ward.evaluate(() => window.__svCount('shooter'));
    if (casters !== 0) fail('casters alive at the warden spawn: ' + casters);
    await ward.screenshot({ path: path.join(shots, 'survivor-warden-spawn.png') });
    await new Promise(r => setTimeout(r, 8000));
    await ward.screenshot({ path: path.join(shots, 'survivor-warden-mid.png') });
    await ward.screenshot({ path: path.join(shots, 'survivor-warden-t150.png') });
    await ward.screenshot({ path: path.join(shots, 'survivor-hud.png') });
    await ward.evaluate(() => window.__svSetVows(0));
    await new Promise(r => setTimeout(r, 200));
    await ward.screenshot({ path: path.join(shots, 'survivor-floor-vows-0.png') });
    await ward.evaluate(() => window.__svSetVows(2));
    await new Promise(r => setTimeout(r, 200));
    await ward.screenshot({ path: path.join(shots, 'survivor-floor-vows-2.png') });
    await ward.evaluate(() => window.__svSetVows(3));
    await new Promise(r => setTimeout(r, 200));
    await ward.mouse.move(240, 700);
    await ward.mouse.down();
    await ward.mouse.move(340, 620);
    await new Promise(r => setTimeout(r, 250));
    await ward.screenshot({ path: path.join(shots, 'survivor-joystick-vows-3.png') });
    await ward.mouse.up();
    const vowBadge = await ward.$eval('#sv-vow-badge', (el) => ({ hidden: el.classList.contains('hidden'), text: el.textContent }));
    if (vowBadge.hidden || vowBadge.text !== 'Vow x3') fail('vow badge: ' + JSON.stringify(vowBadge));
    await ward.screenshot({ path: path.join(shots, 'survivor-floor-vows-3.png') });
    await ward.evaluate(() => window.__svSetVows(5));
    await new Promise(r => setTimeout(r, 200));
    await ward.screenshot({ path: path.join(shots, 'survivor-floor-vows-5.png') });
    await ward.waitForFunction(() => window.__svSnap && window.__svSnap().chest, { timeout: 40000 });
    await ward.evaluate(() => {
      const at = window.__svChestAt();
      window.__svPan(at.x + 40, at.y);
    });
    await new Promise(r => setTimeout(r, 250));
    if (!await ward.evaluate(() => window.__svChestArrow())) fail('chest edge arrow did not draw');
    await ward.screenshot({ path: path.join(shots, 'survivor-chest-arrow.png') });
    if (ward.__errors.length) fail('warden errors: ' + ward.__errors.join(' | '));
    await ward.close();

    const chance = await pageWith(browser, base + 'survivor.html?debug=1', desk);
    await chance.click('#sv-play');
    await chance.waitForFunction(() => window.__sv && window.__sv().state === 'playing');
    await chance.evaluate(() => { window.__svArmRevival(); window.__svHurt(9999); });
    await chance.waitForFunction(() => /Second Chance/.test(document.getElementById('sv-warn').textContent || ''));
    await chance.screenshot({ path: path.join(shots, 'survivor-second-chance.png') });
    const chanceState = await chance.evaluate(() => window.__svSnap());
    if (!(chanceState.life > 0) || chanceState.state !== 'playing') fail('second chance banner state: ' + JSON.stringify(chanceState));
    if (chance.__errors.length) fail('second chance errors: ' + chance.__errors.join(' | '));
    await chance.close();

    const evo = await pageWith(browser, base + 'survivor.html?debug=1&t=100&walk=circle', desk);
    await evo.click('#sv-play');
    const evoDeadline = Date.now() + 50000;
    let evoSnap = await evo.evaluate(() => window.__svSnap());
    while (!(evoSnap.evolved && evoSnap.evolved.length) && Date.now() < evoDeadline) {
      if (evoSnap.state === 'levelup' || evoSnap.state === 'hermit') {
        await new Promise(r => setTimeout(r, 360));
        await evo.evaluate(() => {
          const level = document.getElementById('sv-level');
          const hermitBox = document.getElementById('sv-hermit');
          const card = document.querySelector('#sv-cards .sv-card');
          const no = document.getElementById('sv-hermit-no');
          if (level && !level.classList.contains('hidden') && card) card.click();
          else if (hermitBox && !hermitBox.classList.contains('hidden') && no) no.click();
        });
      }
      await new Promise(r => setTimeout(r, 250));
      evoSnap = await evo.evaluate(() => window.__svSnap());
    }
    if (!(evoSnap.evolved && evoSnap.evolved.length)) fail('no evolution: ' + JSON.stringify(evoSnap));
    if (!(evoSnap.time < 135)) fail('first evolution after 2:15: ' + JSON.stringify(evoSnap));
    await evo.screenshot({ path: path.join(shots, 'survivor-evo.png') });
    console.log('browser evolution at ' + evoSnap.time.toFixed(1) + 's ' + evoSnap.evolved.join(','));
    if (evo.__errors.length) fail('evolution errors: ' + evo.__errors.join(' | '));
    await evo.close();

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
