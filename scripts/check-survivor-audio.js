'use strict';
// Audio guard for the medieval demo.
// 1. Static: every clip in MEDIEVAL_CFG.audio exists as .ogg and .m4a, mono-sized,
//    first-load SFX stays under FIRST_LOAD_KB and the lazy music under MUSIC_KB, and
//    every clip carries a voice limit and a synth fallback.
// 2. Headless Chrome (skips if puppeteer-core / Chrome are missing): after the Play
//    tap all clips decode, the music starts, a 40-hit burst plays at most `limit`
//    voices, mute persists in the profile, and the store build (&debug=1, no
//    &debughud=1) shows no fps / bench text.
const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const FIRST_LOAD_KB = 600;
const MUSIC_KB = 1500;

const vm = require('vm');
const SD = (() => {
  const ctx = vm.createContext({ console, Math, JSON });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/survivor-data.js'), 'utf8') + '\nthis.SurvivorData = SurvivorData;', ctx);
  return ctx.SurvivorData;
})();
const A = SD.MEDIEVAL_CFG.audio;
assert(A && A.clips && A.music, 'MEDIEVAL_CFG.audio missing');
const dir = path.join(root, A.base);
const need = ['hit', 'sword', 'death', 'gem', 'level', 'chest', 'boss', 'warn', 'hurt', 'ui', 'victory', 'defeat'];
need.forEach((n) => assert(A.clips[n], 'missing clip ' + n));
const size = (f) => fs.statSync(path.join(dir, f)).size;
const sums = { ogg: 0, m4a: 0 };
const files = new Set();
Object.keys(A.clips).forEach((n) => {
  const c = A.clips[n];
  assert(Array.isArray(c.files) && c.files.length, n + ': no files');
  assert(c.fallback, n + ': no synth fallback');
  assert(c.limit > 0 && c.limit <= 6, n + ': voice limit must be 1..6');
  c.files.forEach((f) => files.add(f));
});
files.forEach((f) => ['ogg', 'm4a'].forEach((e) => { sums[e] += size(f + '.' + e); }));
const music = { ogg: size(A.music.file + '.ogg'), m4a: size(A.music.file + '.m4a') };
assert(A.clips.hit.limit <= 6 && (A.clips.hit.window || 100) >= 100, 'hit must be capped at 6 per 100 ms');
assert(A.clips.gem.chain > 0, 'gem pickup needs a rising chain');
['ogg', 'm4a'].forEach((e) => {
  assert(sums[e] / 1024 < FIRST_LOAD_KB, 'first-load ' + e + ' ' + (sums[e] / 1024).toFixed(0) + ' KB');
  assert(music[e] / 1024 < MUSIC_KB, 'music ' + e + ' ' + (music[e] / 1024).toFixed(0) + ' KB');
});
assert(A.music.gain <= 0.5, 'music should default low');
console.log('audio static OK: ' + files.size + ' files, sfx ' + (sums.ogg / 1024).toFixed(0) + ' KB ogg / '
  + (sums.m4a / 1024).toFixed(0) + ' KB m4a, music (lazy) ' + (music.ogg / 1024).toFixed(0) + ' / ' + (music.m4a / 1024).toFixed(0) + ' KB');

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
if (!puppeteer || !chrome) { console.log('audio browser check skipped'); process.exit(0); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(root, rel);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] });
  let code = 0;
  try {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const base = 'http://127.0.0.1:' + server.address().port + '/survivor.html?mode=medieval';
    await page.goto(base + '&debug=1&fresh=1', { waitUntil: 'load' });
    await sleep(500);
    const pre = await page.evaluate(() => GameAudio.sampleState());
    assert.strictEqual(pre.music, false, 'music must not start before the first tap');
    // A real tap (pointer events), which is what the autoplay unlock listens for.
    await page.tap('#sv-play');
    let st = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      st = await page.evaluate(() => GameAudio.sampleState());
      if (st.ready >= 1 && st.music) break;
    }
    assert(st.ready > 0 && st.failed === 0, 'clips did not decode: ' + JSON.stringify(st));
    assert(st.music, 'music did not start after the tap: ' + JSON.stringify(st));
    const burst = await page.evaluate(() => {
      const before = GameAudio.sampleState().voices;
      for (let i = 0; i < 40; i++) GameAudio.sfx('hit');
      return GameAudio.sampleState().voices - before;
    });
    assert(burst >= 1 && burst <= A.clips.hit.limit, 'hit burst played ' + burst + ' voices');
    // Safari path: the .m4a set must decode too (skipped if this Chrome has no AAC).
    const m4a = await page.evaluate(async (names) => {
      if (!document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"')) return 'skip';
      const ac = new OfflineAudioContext(1, 44100, 44100);
      const bad = [];
      for (const n of names) {
        try { await ac.decodeAudioData(await (await fetch('assets/audio/medieval/' + n + '.m4a')).arrayBuffer()); } catch (e) { bad.push(n); }
      }
      return bad;
    }, [...files, A.music.file]);
    assert(m4a === 'skip' || m4a.length === 0, 'm4a failed to decode: ' + m4a);
    const hud = await page.evaluate(() => ['sv-fps', 'sv-bench'].map((id) => {
      const el = document.getElementById(id);
      return el && !el.hidden && getComputedStyle(el).display !== 'none' && el.textContent.trim() ? id : null;
    }).filter(Boolean));
    assert.deepStrictEqual(hud, [], 'debug text visible without &debughud=1');
    await page.evaluate(() => GameAudio.setMuted(true));
    await page.goto(base, { waitUntil: 'load' });
    await sleep(300);
    const mutedAfter = await page.evaluate(() => GameAudio.isMuted());
    assert.strictEqual(mutedAfter, true, 'mute did not persist');
    assert.deepStrictEqual(errs, [], 'page errors: ' + errs.join(' | '));
    console.log('audio browser OK: ' + st.ready + ' clips decoded (' + st.ext + '), music on after tap, 40-hit burst -> ' + burst + ' voices, mute persists, no debug HUD, m4a ' + (m4a === 'skip' ? 'skipped' : 'all decode'));
  } catch (e) {
    console.error('audio check FAILED: ' + e.message);
    code = 1;
  } finally {
    await browser.close();
    server.close();
    process.exit(code);
  }
})();
