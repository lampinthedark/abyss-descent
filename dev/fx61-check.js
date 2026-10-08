/**
 * Headless checks for the v6.1 kill flash budget and shake cooldown.
 * Run: node dev/fx61-check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '..', 'js', 'survivor-fx.js');
let src = fs.readFileSync(srcPath, 'utf8');
if (src.indexOf('owned') >= 0) throw new Error('owned leaked into fx');
src = src.replace(
  'function step(dt) {',
  'let __peak = 0;\nfunction __tally() {\n  let n = 0;\n  for (let i = 0; i < CAP; i++) if (parts[i].life > 0) n++;\n  if (n > __peak) __peak = n;\n}\nfunction step(dt) {\n  __tally();'
);
src = src.replace(
  'LEVELUP_RADIUS: LEVELUP_RADIUS,',
  'LEVELUP_RADIUS: LEVELUP_RADIUS,\n    _peak: function () { return __peak; },'
);

function makeCtx() {
  const calls = [];
  const ctx = {
    canvas: { width: 390, height: 844 },
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    fillStyle: '#ffffff',
    strokeStyle: '#ffffff',
    lineWidth: 1,
    globalCompositeOperation: 'source-over',
    fillRect: function (x, y, w, h) {
      calls.push(['fill', this.fillStyle, this.globalAlpha, x, y, w, h]);
    },
    drawImage: function () {
      calls.push(['img', this.globalAlpha, arguments.length]);
    },
    beginPath: function () {},
    arc: function (x, y, r) {
      this._arcR = r;
    },
    stroke: function () {
      calls.push(['arc', this._arcR, this.strokeStyle, this.globalAlpha]);
    },
    save: function () {},
    restore: function () {},
    setTransform: function () {},
  };
  return { ctx: ctx, calls: calls };
}

const { ctx, calls } = makeCtx();
const sandbox = {
  console: console,
  document: {
    createElement: function () {
      return {
        width: 0,
        height: 0,
        getContext: function () {
          return {
            imageSmoothingEnabled: false,
            fillStyle: '',
            globalCompositeOperation: 'source-over',
            drawImage: function () {},
            fillRect: function () {},
          };
        },
      };
    },
  },
  Sprites: { atlas: { width: 16, height: 16 } },
  window: {},
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.FX = FX;\n', sandbox);
const FX = sandbox.FX;

const vis = { frame: { sx: 0, sy: 0, sw: 8, sh: 8, pad: 0 }, scale: 1, flip: 0 };
const cam = { x: 195, y: 422, zoom: 3 };

function sils() {
  let n = 0;
  let maxA = 0;
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] === 'img') {
      n += 1;
      if (calls[i][1] > maxA) maxA = calls[i][1];
    }
  }
  return { n: n, maxA: maxA };
}

function fills(color) {
  let n = 0;
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] === 'fill' && calls[i][1] === color) n += 1;
  }
  return n;
}

function advance(t) {
  let left = t;
  while (left > 0.0000001) {
    const d = left > 0.05 ? 0.05 : left;
    FX.update(d);
    left -= d;
  }
}

function mag() {
  const o = FX.shakeOffset();
  return Math.sqrt(o.x * o.x + o.y * o.y);
}

const fails = [];
function check(name, cond) {
  if (!cond) fails.push(name);
  else console.log('ok', name);
}

FX.setReducedMotion(false);
FX.reset();

// Burst: 10 kills in one instant still want a flash, but only 3 land.
for (let i = 0; i < 10; i++) FX.kill(0.2 * i, 0, 'skel', vis);
calls.length = 0;
FX.draw(ctx, cam);
const burst = sils();
check('burst flashes are 3', burst.n === 3);
check('burst flash alpha <= 0.6', burst.maxA > 0 && burst.maxA <= 0.6);

// Those 10 did not include a rate above 20, so a fresh window can flash again.
advance(0.6);
FX.reset();
calls.length = 0;

// Sustained 25 kills per second. Record each drawn silhouette against our clock.
const times = [];
let clock = 0;
FX.reset();
FX.setReducedMotion(false);
for (let i = 0; i < 50; i++) {
  FX.kill((i % 8) * 0.4, (i % 5) * 0.3, 'skel', vis);
  calls.length = 0;
  FX.draw(ctx, cam);
  const n = sils().n;
  for (let k = 0; k < n; k++) times.push(clock);
  FX.update(0.04);
  clock += 0.04;
}
let peak = 0;
for (let i = 0; i < times.length; i++) {
  let c = 1;
  for (let j = i + 1; j < times.length && times[j] - times[i] < 0.1; j++) c += 1;
  if (c > peak) peak = c;
}
let late = 0;
for (let i = 0; i < times.length; i++) if (times[i] >= 0.5) late += 1;
console.log('peak flashes per 0.1s at 25 kills/s:', peak, 'total', times.length, 'after 0.5s', late);
check('25/s peak flashes <= 3', peak <= 3);
check('25/s no flashes once the horde is hot', late === 0);

// LOD: above 20/s is one chunk and no flash, and it does not spend the window.
FX.reset();
FX.setReducedMotion(false);
for (let i = 0; i < 12; i++) {
  FX.kill(0, 0, 'skel', vis);
  FX.update(0.01);
}
advance(0.12);
calls.length = 0;
FX.draw(ctx, cam);
const before = fills('#8a6cff');
FX.kill(1, 0, 'skel', vis);
calls.length = 0;
FX.draw(ctx, cam);
const afterHot = sils();
check('hot horde adds no flash', afterHot.n === 0);
check('hot horde adds 1 chunk', fills('#8a6cff') - before === 1);

// Between 10 and 20 per second: 2 chunks, flash still allowed once the window is free.
FX.reset();
for (let i = 0; i < 5; i++) {
  FX.kill(0, 0, 'skel', { color: '#8a6cff' });
  FX.update(0.02);
}
calls.length = 0;
FX.draw(ctx, cam);
const midBefore = fills('#8a6cff');
FX.kill(1, 0, 'skel', { color: '#8a6cff' });
calls.length = 0;
FX.draw(ctx, cam);
check('mid horde is 2 chunks', fills('#8a6cff') - midBefore === 2);

// A quiet kill is 3 to 5 chunks. Elite is 8. Boss is 16.
FX.reset();
calls.length = 0;
FX.draw(ctx, cam);
const q0 = fills('#8a6cff');
FX.kill(0, 0, 'skel', { color: '#8a6cff' });
calls.length = 0;
FX.draw(ctx, cam);
const quiet = fills('#8a6cff') - q0;
check('quiet kill is 3-5 chunks', quiet >= 3 && quiet <= 5);

FX.reset();
FX.kill(0, 0, 'brute', { elite: true, color: '#8a6cff' });
calls.length = 0;
FX.draw(ctx, cam);
check('elite is 8 chunks', fills('#8a6cff') === 8);

FX.reset();
FX.kill(0, 0, 'boss', { color: '#8a6cff' });
calls.length = 0;
FX.draw(ctx, cam);
check('boss is 16 chunks', fills('#8a6cff') === 16);

// Shake cooldown: a second kill inside 0.5s does not refresh.
FX.reset();
FX.setReducedMotion(false);
const same = FX.shakeOffset();
check('shake object is reused', FX.shakeOffset() === same);
FX.kill(0, 0, 'brute', { elite: true });
FX.update(0.016);
const eliteMag = mag();
check('elite shake is about 2 art px', eliteMag > 0.8 && eliteMag <= 2.05);
FX.update(0.05);
FX.kill(0, 0, 'boss', { boss: true });
FX.update(0.016);
const blocked = mag();
check('boss kill during cooldown does not jump to 4px', blocked < eliteMag && blocked < 1.6);
advance(0.2);
check('cooldown does not extend the shake', mag() === 0);
advance(0.3);
FX.kill(0, 0, 'boss', { boss: true });
const bossMag = (function () {
  let best = 0;
  for (let i = 0; i < 10; i++) {
    FX.update(0.008);
    const m = mag();
    if (m > best) best = m;
  }
  return best;
})();
console.log('boss shake peak art px', bossMag.toFixed(2));
check('boss shake after cooldown is about 4 art px', bossMag > 3 && bossMag <= 4.05);

FX.setReducedMotion(true);
FX.kill(0, 0, 'boss', { boss: true, frame: vis.frame });
check('reduced motion shake is zero', mag() === 0);
calls.length = 0;
FX.draw(ctx, cam);
check('reduced motion kill has no flash', sils().n === 0);
FX.setReducedMotion(false);

// Level-up radius.
FX.reset();
FX.setReducedMotion(true);
check('LEVELUP_RADIUS is 48', FX.LEVELUP_RADIUS === 48);
FX.levelUp(2, 3, { radius: 48 });
advance(0.11);
calls.length = 0;
FX.draw(ctx, cam);
const arcs = [];
for (let i = 0; i < calls.length; i++) if (calls[i][0] === 'arc') arcs.push(calls[i]);
arcs.sort(function (a, b) { return a[1] - b[1]; });
check('level-up has two rings', arcs.length >= 2);
const whiteR = arcs[0][1];
check('level-up radius tracks opts.radius', Math.abs(whiteR - 24 * 3) < 2);
check('level-up has a cyan edge', arcs.some(function (a) { return a[2] === '#5fd8ff'; }));

FX.reset();
FX.levelUp(2, 3, { radius: 30 });
advance(0.22);
calls.length = 0;
FX.draw(ctx, cam);
let maxR = 0;
for (let i = 0; i < calls.length; i++) if (calls[i][0] === 'arc' && calls[i][1] > maxR) maxR = calls[i][1];
check('custom radius is honoured', Math.abs(maxR - 31 * 3) < 2);
FX.setReducedMotion(false);

// Beams are complete, and rare+ off-screen drops get an arrow.
FX.reset();
FX.beam('c', 0, 0, 'common');
FX.beam('u', 0.8, 0, 'uncommon');
FX.beam('r', 1.6, 0, 'rare');
FX.beam('e', 2.4, 0, 'epic');
FX.beam('l', 3.2, 0, 'legendary');
calls.length = 0;
FX.draw(ctx, cam);
check('uncommon glint is green', fills('#5ed37a') > 0);
check('rare column is blue', fills('#4c7cff') > 0);
check('epic column is purple', fills('#b48cff') > 0);
check('rare and epic have a white core', fills('#ffffff') === 2);
check('legendary is a double gold column', fills('#ffb43c') >= 2 && fills('#ffd27a') >= 2);
check('legendary dropped the alternating pearl edges', fills('#7fb2ff') === 0 && fills('#c9b6ff') === 0);
let minBody = 1;
let edgeA = -1;
let rareH = 0;
let epicW = 0;
const darkX = [];
const coreX = [];
for (let i = 0; i < calls.length; i++) {
  const c = calls[i];
  if (c[0] !== 'fill' || c[6] < 20) continue;
  if (c[1] === '#4c7cff' || c[1] === '#b48cff' || c[1] === '#ffffff' || c[1] === '#ffb43c' || c[1] === '#ffd27a') {
    if (c[2] < minBody) minBody = c[2];
  }
  if (c[1] === '#14120f') edgeA = c[2];
  if (c[1] === '#4c7cff' && c[6] > rareH) rareH = c[6];
  if (c[1] === '#b48cff') epicW = c[5];
  if (c[1] === '#14120f' && c[6] >= 280) darkX.push(c[3]);
  if (c[1] === '#ffb43c' && c[6] >= 280) coreX.push(c[3]);
}
darkX.sort(function (p, q) { return p - q; });
coreX.sort(function (p, q) { return p - q; });
check('column body alpha stays at least 0.85', minBody >= 0.85);
check('dark edge is about 70% alpha', edgeA > 0.65 && edgeA < 0.75);
check('rare column is 72 CSS px tall at zoom 3', rareH === 72 * 2);
check('epic body strip is 1 CSS px wide at zoom 3', epicW === 2);
check('legendary dark edges touch in the middle', darkX.length >= 4 && darkX[2] - darkX[1] === 2 && coreX.length === 2 && coreX[1] - coreX[0] === 6);
FX.beam('r', 0.2, 0, 'rare');
calls.length = 0;
FX.draw(ctx, cam);
const rareAfter = fills('#4c7cff');
calls.length = 0;
FX.draw(ctx, cam);
check('repeating beam() does not add another burst', fills('#4c7cff') === rareAfter);

FX.beam('off', -8, 0, 'rare');
FX.beam('off2', 12, -6, 'epic');
FX.beam('off3', 0, 14, 'legendary');
calls.length = 0;
FX.draw(ctx, cam);
let edgeBlue = 0;
for (let i = 0; i < calls.length; i++) {
  const c = calls[i];
  if (c[0] === 'fill' && (c[1] === '#4c7cff' || c[1] === '#b48cff' || c[1] === '#ffb43c') && c[3] < 40) edgeBlue += 1;
}
check('off-screen arrows sit on the inset edge', edgeBlue > 0);

FX.reset();
FX.beam('vr', 0, 0, 'very rare');
calls.length = 0;
FX.draw(ctx, cam);
check('very rare uses the epic column', fills('#b48cff') > 0 && fills('#ffffff') > 0);

function srgbLin(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function grayRgb(rgb) {
  const y = Math.round(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
  return [y, y, y];
}
function contrast(a, b) {
  const la = 0.2126 * srgbLin(a[0]) + 0.7152 * srgbLin(a[1]) + 0.0722 * srgbLin(a[2]);
  const lb = 0.2126 * srgbLin(b[0]) + 0.7152 * srgbLin(b[1]) + 0.0722 * srgbLin(b[2]);
  const hi = la > lb ? la : lb;
  const lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}
const grass = [0x5d, 0x7f, 0x32];
const floorMed = [72, 59, 58];
const beamInk = {
  'rare core': [255, 255, 255],
  'epic core': [255, 255, 255],
  'legendary core': [0xff, 0xb4, 0x3c],
  'dark edge': [0x14, 0x12, 0x0f],
};
Object.keys(beamInk).forEach(function (name) {
  const fg = grayRgb(beamInk[name]);
  const vsGrass = contrast(fg, grayRgb(grass));
  const vsFloor = contrast(fg, grayRgb(floorMed));
  console.log('grayscale', name, 'grass', vsGrass.toFixed(2), 'floor', vsFloor.toFixed(2));
});
check('rare core contrast vs grass and floor', contrast(grayRgb([255, 255, 255]), grayRgb(grass)) >= 1.7 && contrast(grayRgb([255, 255, 255]), grayRgb(floorMed)) >= 1.7);
check('legendary core contrast vs grass and floor', contrast(grayRgb([0xff, 0xb4, 0x3c]), grayRgb(grass)) >= 1.7 && contrast(grayRgb([0xff, 0xb4, 0x3c]), grayRgb(floorMed)) >= 1.7);
check('dark edge contrast vs grass and floor', contrast(grayRgb([0x14, 0x12, 0x0f]), grayRgb(grass)) >= 1.7 && contrast(grayRgb([0x14, 0x12, 0x0f]), grayRgb(floorMed)) >= 1.7);

// 400 deaths at 25/s plus 20 beams stay inside the 200 cap.
FX.reset();
const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
for (let i = 0; i < 20; i++) {
  const x = i < 3 ? -6 - i : (i - 8) * 0.7;
  FX.beam('b' + i, x, (i % 5) * 0.4, rarities[i % 5]);
}
for (let i = 0; i < 400; i++) {
  FX.kill((i % 12) * 0.5, (i % 9) * 0.4, 'skel', { color: '#8a6cff', frame: vis.frame });
  FX.update(0.04);
}
check('particle peak <= 200', FX._peak() <= 200);
console.log('particle peak at 25/s', FX._peak());

// One-frame pile of 400 still cannot grow the pool.
FX.reset();
for (let i = 0; i < 400; i++) FX.kill(i * 0.01, 0, 'skel', vis);
FX.update(0.016);
console.log('particle peak one-frame burst', FX._peak());
check('burst particle peak <= 200', FX._peak() <= 200);

function tallOf(color, minH) {
  let n = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c[0] === 'fill' && c[1] === color && c[6] >= minH) n += 1;
  }
  return n;
}

FX.reset();
FX.beam('leg-case', 0, 0, 'Legendary');
calls.length = 0;
FX.draw(ctx, cam);
check('Legendary gives r=4 and draws the double gold beam', tallOf('#ffb43c', 280) === 2 && tallOf('#ffd27a', 280) === 2);

FX.reset();
FX.beam('rare-case', 0, 0, 'RARE');
calls.length = 0;
FX.draw(ctx, cam);
check('RARE gives r=2', tallOf('#4c7cff', 140) === 1 && tallOf('#ffb43c', 200) === 0);

FX.reset();
FX.beam('vr-case', 0, 0, 'Very Rare');
calls.length = 0;
FX.draw(ctx, cam);
check('Very Rare gives r=3', tallOf('#b48cff', 180) >= 1 && tallOf('#ffffff', 180) === 1 && tallOf('#ffb43c', 200) === 0);

FX.reset();
FX.beam('pad-epic', 0, 0, ' Epic ');
calls.length = 0;
FX.draw(ctx, cam);
check('padded Epic gives r=3', tallOf('#b48cff', 180) >= 1 && tallOf('#ffffff', 180) === 1);

FX.reset();
FX.beam('us-rare', 0, 0, 'very_rare');
calls.length = 0;
FX.draw(ctx, cam);
check('very_rare gives r=3', tallOf('#b48cff', 180) >= 1 && tallOf('#ffffff', 180) === 1);

FX.reset();
let rarityThrew = false;
try {
  FX.beam('bad1', 0, 0, 'bogus');
  FX.beam('bad2', 1, 0, null);
  FX.beam('bad3', 2, 0, 42);
  FX.beam('bad4', 3, 0, undefined);
} catch (e) {
  rarityThrew = true;
}
calls.length = 0;
FX.draw(ctx, cam);
check('bogus, null and 42 give r=0 with no throw', !rarityThrew && tallOf('#4c7cff', 20) === 0 && tallOf('#b48cff', 20) === 0 && tallOf('#ffb43c', 20) === 0 && tallOf('#5ed37a', 20) === 0);

if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('fx61 checks passed');
