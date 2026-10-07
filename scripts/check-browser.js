'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const shots = '/tmp/v11-shots';
fs.mkdirSync(shots, { recursive: true });

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = path.join(root, path.normalize(rel));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function boot(browser, url, touch) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  if (touch) {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  } else {
    await page.setViewport({ width: 1100, height: 800 });
  }
  await page.evaluateOnNewDocument(() => {
    const bag = { backButton: [], appStateChange: [] };
    window.__cap = bag;
    window.__exited = false;
    window.Capacitor = {
      Plugins: {
        App: {
          addListener(name, fn) {
            (bag[name] = bag[name] || []).push(fn);
            return Promise.resolve({ remove() {} });
          },
          exitApp() { window.__exited = true; },
        },
      },
    };
  });
  await page.goto(url, { waitUntil: 'networkidle0' });
  if (errors.length) fail(url + ' console errors: ' + errors.join(' | '));
  page.__errors = errors;
  return page;
}

async function startRun(page) {
  await page.click('#btn-choose');
  await page.waitForSelector('.class-card[data-class="warrior"]');
  await page.click('.class-card[data-class="warrior"]');
  await page.click('#btn-start');
  await page.waitForFunction(() => document.getElementById('floor-text').textContent.includes('Floor 1'));
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
    const desktop = await boot(browser, base, false);
    const deskBar = await desktop.$eval('#touch-bar', (el) => getComputedStyle(el).display);
    if (deskBar !== 'none') fail('desktop showed the attack button: ' + deskBar);
    await desktop.close();

    const phone = await boot(browser, base, true);
    await startRun(phone);
    const bar = await phone.$eval('#touch-bar', (el) => getComputedStyle(el).display);
    if (bar !== 'flex') fail('phone hid the attack button: ' + bar);
    const attack = await phone.$('#touch-attack');
    if (!attack) fail('missing attack button');
    await phone.screenshot({ path: path.join(shots, 'phone-attack.png') });

    const before = await phone.evaluate(() => ({
      hp: document.getElementById('hp-text').textContent,
      muted: GameAudio.isMuted(),
      held: GameAudio.isHeld(),
      pref: localStorage.getItem('abyss-descent-muted'),
    }));
    if (before.held) fail('audio started held');

    await phone.evaluate(() => window.__cap.backButton[0]());
    const paused = await phone.$eval('#pause-screen', (el) => !el.classList.contains('hidden'));
    if (!paused) fail('hardware back did not open pause');
    await phone.screenshot({ path: path.join(shots, 'pause-from-back.png') });

    await phone.evaluate(() => window.__cap.backButton[0]());
    const resumed = await phone.$eval('#pause-screen', (el) => el.classList.contains('hidden'));
    if (!resumed) fail('second back did not resume');

    const life = await phone.$eval('#hp-text', (el) => el.textContent);
    await phone.evaluate(() => {
      const client = null;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__bg = { held: GameAudio.isHeld(), muted: GameAudio.isMuted(), pref: localStorage.getItem('abyss-descent-muted') };
    });
    const hiddenPause = await phone.$eval('#pause-screen', (el) => !el.classList.contains('hidden'));
    if (!hiddenPause) fail('background did not pause');
    const bg = await phone.evaluate(() => window.__bg);
    if (!bg.held || bg.muted) fail('background mute wrote the user setting: ' + JSON.stringify(bg));
    if (bg.pref === '1') fail('background stored a mute');

    await phone.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const back = await phone.evaluate(() => ({
      paused: !document.getElementById('pause-screen').classList.contains('hidden'),
      held: GameAudio.isHeld(),
      muted: GameAudio.isMuted(),
      hp: document.getElementById('hp-text').textContent,
      floor: document.getElementById('floor-text').textContent,
    }));
    if (back.paused || back.held || back.muted) fail('foreground did not resume cleanly: ' + JSON.stringify(back));
    if (back.hp !== life || !back.floor.includes('Floor 1')) fail('background changed the run: ' + JSON.stringify(back));

    await phone.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 250));
    const rotated = await phone.evaluate(() => ({
      w: document.getElementById('game').width,
      h: document.getElementById('game').height,
      floor: document.getElementById('floor-text').textContent,
      attack: getComputedStyle(document.getElementById('touch-bar')).display,
      title: !document.getElementById('title-screen').classList.contains('hidden'),
    }));
    if (rotated.title || rotated.attack !== 'flex' || !rotated.floor.includes('Floor 1')) {
      fail('rotation reset the run: ' + JSON.stringify(rotated));
    }
    if (rotated.w < 400 || rotated.h < 200) fail('canvas did not resize: ' + JSON.stringify(rotated));
    await phone.screenshot({ path: path.join(shots, 'phone-landscape.png') });

    await phone.evaluate(() => window.__cap.backButton[0]());
    phone.once('dialog', (d) => d.dismiss());
    await phone.click('#btn-quit');
    const stayed = await phone.evaluate(() => window.__exited);
    if (stayed) fail('dismissed quit still exited');
    const stillPaused = await phone.$eval('#pause-screen', (el) => !el.classList.contains('hidden'));
    if (!stillPaused) fail('dismissed quit left the pause menu');

    phone.once('dialog', (d) => d.accept());
    await phone.click('#btn-quit');
    await phone.waitForFunction(() => window.__exited === true);
    const titleHidden = await phone.$eval('#title-screen', (el) => el.classList.contains('hidden'));
    if (!titleHidden) fail('native quit should call exitApp and leave the page in place');
    if (phone.__errors.length) fail('phone errors: ' + phone.__errors.join(' | '));
    await phone.close();

    const ads = await boot(browser, base + '?adtest=1', true);
    const panel = await ads.$eval('#adtest-panel', (el) => !el.classList.contains('hidden'));
    if (!panel) fail('ad test panel hidden');
    await ads.click('[data-ad-offer="revive"]');
    const label = await ads.$eval('[data-ad-label]', (el) => el.textContent);
    const prompt = await ads.$eval('#adtest-prompt', (el) => !el.classList.contains('hidden'));
    if (!prompt || label !== 'TEST AD: Revive') fail('ad placeholder missing: ' + label);
    await ads.screenshot({ path: path.join(shots, 'adtest.png') });
    await ads.click('[data-ad-dismiss]');
    const gone = await ads.$eval('#adtest-prompt', (el) => el.classList.contains('hidden'));
    if (!gone) fail('dismiss did not close the placeholder');
    if (ads.__errors.length) fail('adtest errors: ' + ads.__errors.join(' | '));

    const plain = await boot(browser, base, false);
    const noPanel = await plain.$eval('#adtest-panel', (el) => el.classList.contains('hidden'));
    if (!noPanel) fail('ad panel visible without ?adtest=1');
    await plain.close();

    console.log('browser ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
