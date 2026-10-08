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
if (src.indexOf('fillText') >= 0 || src.indexOf('strokeText') >= 0) {
  throw new Error('survivor-fx.js should not draw text');
}
src = src.replace(
  'function step(dt) {',
  'let __peak = 0;\nlet __live = 0;\nfunction __tally() {\n  let n = 0;\n  for (let i = 0; i < CAP; i++) if (parts[i].life > 0) n++;\n  __live = n;\n  if (n > __peak) __peak = n;\n}\nfunction __seed() { rng = 1; }\nfunction step(dt) {\n  __tally();'
);
src = src.replace(
  'LEVELUP_RADIUS: LEVELUP_RADIUS,',
  'LEVELUP_RADIUS: LEVELUP_RADIUS,\n    _peak: function () { return __peak; },\n    _live: function () { return __live; },\n    _seed: function () { __seed(); },\n    _beams: function () { let n = 0; for (let i = 0; i < BEAM_N; i++) if (beams[i].on) n++; return n; },'
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
    fillText: function () { textCalls += 1; },
    strokeText: function () { textCalls += 1; },
  };
  return { ctx: ctx, calls: calls };
}
let textCalls = 0;

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

FX.reset();
FX.beam('cross', 0, 0, 'uncommon');
calls.length = 0;
FX.draw(ctx, cam);
check('uncommon still draws and keeps a slot', FX._beams() === 1 && fills('#5ed37a') > 0);

FX.reset();
let slotThrew = false;
try {
  for (let i = 0; i < 100; i++) FX.beam('common-' + i, i * 0.2, 0, 'common');
  FX.beam('junk-a', 0, 0, 'bogus');
  FX.beam('junk-b', 1, 0, null);
  FX.beam('junk-c', 2, 0, 42);
  FX.beam('junk-d', 3, 0, '');
  FX.beam('junk-e', 4, 0, {});
  FX.beam('junk-f', 5, 0, NaN);
} catch (e) {
  slotThrew = true;
}
check('commons and junk use no beam slots', !slotThrew && FX._beams() === 0);
FX.beam('slot-rare', 0, 0, 'rare');
FX.beam('slot-leg', 1.2, 0, 'Legendary');
calls.length = 0;
FX.draw(ctx, cam);
check('rare and Legendary both get a slot and draw', FX._beams() === 2 && tallOf('#4c7cff', 140) === 1 && tallOf('#ffb43c', 280) === 2);
FX.beam('slot-rare', 0, 0, 'common');
check('a later common clears that beam slot', FX._beams() === 1);

FX.reset();
FX.beam('under', 0, 0, 'rare');
FX.update(0.016);
calls.length = 0;
FX.drawUnder(ctx, cam);
const underOnce = tallOf('#4c7cff', 140);
FX.draw(ctx, cam);
check('drawUnder then draw paints beams once', underOnce === 1 && tallOf('#4c7cff', 140) === 1);

FX.update(0.016);
calls.length = 0;
FX.draw(ctx, cam);
check('draw only paints beams', tallOf('#4c7cff', 140) === 1);

FX.update(0.016);
calls.length = 0;
FX.drawUnder(ctx, cam);
check('drawUnder on this frame paints the column', tallOf('#4c7cff', 140) === 1);
FX.update(0.016);
calls.length = 0;
FX.draw(ctx, cam);
check('draw on the next frame still paints beams', tallOf('#4c7cff', 140) === 1);

FX.update(0.016);
FX.drawUnder(ctx, cam);
FX.reset();
FX.beam('under', 0, 0, 'rare');
calls.length = 0;
FX.draw(ctx, cam);
check('restart still paints beams', tallOf('#4c7cff', 140) === 1);

// Cast telegraphs. x,y are tile coordinates, same as FX.kill.
function telColors() {
  let white = 0;
  let lilac = 0;
  let cyan = 0;
  let far = 0;
  let maxArt = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c[0] !== 'fill') continue;
    if (c[1] === '#5fd8ff') cyan += 1;
    if (c[1] !== '#ffffff' && c[1] !== '#c9a8ff') continue;
    const cx = c[3] + c[5] * 0.5;
    const cy = c[4] + c[6] * 0.5;
    const art = Math.abs(cx - 195) / 3;
    if (art > maxArt) maxArt = art;
    if (art > 1000) far += 1;
    if (c[1] === '#ffffff') white += 1;
    else lilac += 1;
  }
  return { white: white, lilac: lilac, cyan: cyan, far: far, maxArt: maxArt, n: white + lilac };
}

function meanArtRadius() {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c[0] !== 'fill') continue;
    if (c[1] !== '#ffffff' && c[1] !== '#c9a8ff') continue;
    const cx = c[3] + c[5] * 0.5;
    const cy = c[4] + c[6] * 0.5;
    sum += Math.sqrt((cx - 195) * (cx - 195) + (cy - 422) * (cy - 422)) / 3;
    n += 1;
  }
  return n ? sum / n : 0;
}

FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
FX.telegraph('mage', 0, 0, 700);
calls.length = 0;
FX.draw(ctx, cam);
const freshR = meanArtRadius();
check('caster ring starts near 10 art px', freshR > 9 && freshR < 11);
check('caster spark count is 8', telColors().n === 8);
advance(0.35);
calls.length = 0;
FX.draw(ctx, cam);
const midR = meanArtRadius();
check('caster ring eases in', midR > 7 && midR < 9);
FX.telegraph('mage', 0, 0, 700);
calls.length = 0;
FX.draw(ctx, cam);
const restartR = meanArtRadius();
check('same id restarts the ring', restartR > 9 && restartR < 11);
check('same id does not add a second ring', telColors().n === 8);

FX.telegraphOff('mage');
calls.length = 0;
FX.draw(ctx, cam);
check('telegraphOff removes the ring', telColors().n === 0);

FX.telegraph('brief', 0, 0, 200);
advance(0.1);
calls.length = 0;
FX.draw(ctx, cam);
check('telegraph still up before its duration', telColors().n === 8);
advance(0.15);
calls.length = 0;
FX.draw(ctx, cam);
check('telegraph expires after ms', telColors().n === 0);

FX.telegraph('hitch', 0, 0, 700);
FX.update(1);
calls.length = 0;
FX.draw(ctx, cam);
check('a hitch only spends the 0.05s clamp', meanArtRadius() > 9.5);
check('a hitch does not expire a 700ms tell', telColors().n === 8);

FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
FX.telegraph('end', 0, 0, 700);
calls.length = 0;
FX.draw(ctx, cam);
const lilacEarly = telColors().lilac;
advance(0.64);
calls.length = 0;
FX.draw(ctx, cam);
const endCols = telColors();
check('final 80ms adds the lilac release ring', endCols.lilac > lilacEarly + 8);
check('release ring is not cyan', endCols.cyan === 0);

FX.reset();
FX.setReducedMotion(true);
FX.telegraph('still', 0, 0, 700);
calls.length = 0;
FX.draw(ctx, cam);
const stillA = telColors();
const snap = calls.map(function (c) { return c.join(','); }).join('|');
advance(0.3);
calls.length = 0;
FX.draw(ctx, cam);
const stillB = telColors();
const snapB = calls.map(function (c) { return c.join(','); }).join('|');
check('reduced motion is a static ring', snap === snapB && stillA.n > 0);
check('reduced motion ring has 2 white pixels', stillA.white === 2 && stillB.white === 2);
check('reduced motion caster stays at radius 4', stillA.maxArt > 3 && stillA.maxArt < 6);
FX.telegraphOff('still');
FX.telegraph('boss-still', 0, 0, 550, { boss: true });
calls.length = 0;
FX.draw(ctx, cam);
const bossStill = telColors();
check('reduced motion boss ring is larger', bossStill.maxArt > 6 && bossStill.maxArt < 9);
check('reduced motion boss has 2 white pixels', bossStill.white === 2);

FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
FX.telegraph('boss', 0, 0, 550, { boss: true });
calls.length = 0;
FX.draw(ctx, cam);
const bossR = meanArtRadius();
check('boss ring starts near 18 art px', bossR > 17 && bossR < 19);
check('boss uses 14 sparks', telColors().n === 14);
check('boss sparks are 2 art px', calls.some(function (c) { return c[0] === 'fill' && c[5] === 6 && c[6] === 6; }));

function fillCentroid(match) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c[0] !== 'fill' || !match(c)) continue;
    sx += c[3] + c[5] * 0.5;
    sy += c[4] + c[6] * 0.5;
    n += 1;
  }
  return n ? { x: sx / n, y: sy / n, n: n } : { x: 0, y: 0, n: 0 };
}

FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
FX.telegraph('sized', 0, 0, 700, { radius: 1 });
calls.length = 0;
FX.draw(ctx, cam);
check('opts.radius is a tile radius', meanArtRadius() > 15 && meanArtRadius() < 17);

const caster = { id: 7, x: 2.5, y: -0.15 };
FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
FX.telegraph(caster.id, caster.x, caster.y, 700);
calls.length = 0;
FX.draw(ctx, cam);
const telAt = fillCentroid(function (c) { return c[1] === '#ffffff' || c[1] === '#c9a8ff'; });
const casterX = caster.x * 16 * cam.zoom + cam.x;
const casterY = caster.y * 16 * cam.zoom + cam.y;
check('telegraph centre matches the caster', telAt.n > 0 && Math.abs(telAt.x - casterX) <= 1 && Math.abs(telAt.y - casterY) <= 1);

FX.reset();
FX.setReducedMotion(false);
calls.length = 0;
FX.draw(ctx, cam);
for (let i = 0; i < 40; i++) FX.telegraph('c' + i, (i - 20) * 5, 0, 700);
calls.length = 0;
FX.draw(ctx, cam);
const cap = telColors();
console.log('telegraph draw cap fills', cap.n, 'max art', cap.maxArt.toFixed(1));
check('draw cap is 24 telegraphs', cap.n === 24 * 8);
check('draw cap keeps the telegraphs nearest the view', cap.far === 0 && cap.maxArt < 1000);

function monsterFlash(withTel) {
  FX.reset();
  FX.setReducedMotion(false);
  FX.draw(ctx, cam);
  if (withTel) {
    for (let i = 0; i < 40; i++) FX.telegraph(i, (i - 20) * 1.875, (i % 5) * 0.75, 700, i % 11 === 0 ? { boss: true } : null);
  }
  FX._seed();
  for (let i = 0; i < 150; i++) FX.kill((i % 15) * 0.45, ((i / 15) | 0) * 0.4, 'skel', vis);
  FX.update(0.001);
  calls.length = 0;
  textCalls = 0;
  FX.draw(ctx, cam);
  return { live: FX._live(), flash: sils().n, text: textCalls };
}
const bareMonsters = monsterFlash(false);
const telMonsters = monsterFlash(true);
console.log('150 monsters particles', bareMonsters.live, 'with 40 telegraphs', telMonsters.live, 'flashes', bareMonsters.flash, telMonsters.flash);
check('particles stay <= 200 with telegraphs', telMonsters.live <= 200);
check('telegraphs do not change the particle count', telMonsters.live === bareMonsters.live);
check('telegraphs do not change the flash count', telMonsters.flash === bareMonsters.flash);
check('telegraph frames draw no text', telMonsters.text === 0 && textCalls === 0);

function countStyle(color, alpha) {
  let n = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c[0] !== 'fill' || c[1] !== color) continue;
    if (alpha == null || Math.abs(c[2] - alpha) < 0.001) n += 1;
  }
  return n;
}

function centroidX(color) {
  let sx = 0;
  let n = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c[0] !== 'fill' || c[1] !== color || Math.abs(c[2] - 1) > 0.001) continue;
    sx += c[3] + c[5] * 0.5;
    n += 1;
  }
  return n ? sx / n : 0;
}

FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
FX.shield('bubble', 0, 0, 20, 2000);
calls.length = 0;
FX.draw(ctx, cam);
const idleSteel = countStyle('#9fb4c8', 1);
const idleInner = countStyle('#9fb4c8', 0.35);
const idleWhite = countStyle('#ffffff', 1);
check('shield draws a steel hex', idleSteel > 40);
check('shield inner ring is 35% steel', idleInner > 20);
check('shield glint is one white dot', idleWhite === 1);
const idleSnap = calls.map(function (c) { return c.join(','); }).join('|');
advance(0.4);
calls.length = 0;
FX.draw(ctx, cam);
const spun = calls.map(function (c) { return c.join(','); }).join('|');
check('shield hex rotates', spun !== idleSnap && countStyle('#ffffff', 1) === 1);

FX.shield('bubble', 40, 0, 20, 500);
advance(0.4);
calls.length = 0;
FX.draw(ctx, cam);
check('same id restarts the shield', countStyle('#9fb4c8', 1) > 40);
check('restarted shield sits on the new point', Math.abs(centroidX('#9fb4c8') - (40 * 3 + 195)) < 12);
advance(0.15);
calls.length = 0;
FX.draw(ctx, cam);
check('restarted shield expires on its new duration', countStyle('#9fb4c8', 1) === 0);

FX.shield('gone', 0, 0, 18, 2000);
FX.shieldOff('gone');
calls.length = 0;
FX.draw(ctx, cam);
check('shieldOff removes the bubble', countStyle('#9fb4c8', null) === 0);

FX.shield('brief', 0, 0, 18, 200);
advance(0.1);
calls.length = 0;
FX.draw(ctx, cam);
check('shield stays up inside its duration', countStyle('#9fb4c8', 1) > 20);
advance(0.15);
calls.length = 0;
FX.draw(ctx, cam);
check('shield expires after ms', countStyle('#9fb4c8', null) === 0);

function chevronWhites(n) {
  FX.reset();
  FX.setReducedMotion(false);
  FX.draw(ctx, cam);
  FX.shield('hit', 0, 0, 20, 3000);
  for (let i = 0; i < n; i++) FX.shieldHit('hit', 80, 0);
  advance(0.12);
  calls.length = 0;
  FX.draw(ctx, cam);
  return countStyle('#ffffff', null);
}
const sixHits = chevronWhites(6);
const sevenHits = chevronWhites(7);
console.log('chevron whites', sixHits, sevenHits);
check('six hits leave six chevrons', sixHits === 19);
check('a seventh hit is dropped', sevenHits === sixHits);

FX.reset();
FX.setReducedMotion(true);
FX.draw(ctx, cam);
FX.shield('still', 0, 0, 20, 2000);
calls.length = 0;
FX.draw(ctx, cam);
const stillShield = calls.map(function (c) { return c.join(','); }).join('|');
check('reduced motion shield has no glint', countStyle('#ffffff', null) === 0);
check('reduced motion shield keeps the hex', countStyle('#9fb4c8', 1) > 20);
advance(0.3);
calls.length = 0;
FX.draw(ctx, cam);
check('reduced motion shield does not rotate', calls.map(function (c) { return c.join(','); }).join('|') === stillShield);

FX.reset();
FX.setReducedMotion(false);
FX._seed();
const liveBefore = (FX.update(0.001), FX._live());
FX.shield('pop', 0, 0, 18, 2000);
FX.shieldBreak('pop');
calls.length = 0;
textCalls = 0;
FX.draw(ctx, cam);
check('shield break flashes white at 60%', countStyle('#ffffff', 0.6) > 20);
check('shield break draws no text', textCalls === 0);
FX.update(0.001);
const shardLive = FX._live();
console.log('break shards', shardLive);
check('shield break shards use the particle pool', shardLive === liveBefore + 12);
calls.length = 0;
FX.draw(ctx, cam);
check('break ring is steel', countStyle('#9fb4c8', 1) > 10);

FX.reset();
FX.setReducedMotion(true);
FX.draw(ctx, cam);
FX.update(0.001);
const calmLive = FX._live();
FX.shield('calm', 0, 0, 18, 2000);
FX.shieldBreak('calm');
calls.length = 0;
FX.draw(ctx, cam);
FX.update(0.001);
check('reduced motion break is a ring only', countStyle('#9fb4c8', 1) > 10 && countStyle('#ffffff', 0.6) === 0);
check('reduced motion break adds no shards', FX._live() === calmLive);

FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
const seenBreak = [];
for (let i = 0; i < 4; i++) {
  FX.shield('b' + i, i * 70, 0, 16, 2000);
  FX.shieldBreak('b' + i);
}
calls.length = 0;
FX.draw(ctx, cam);
for (let i = 0; i < calls.length; i++) {
  const c = calls[i];
  if (c[0] !== 'fill' || c[1] !== '#ffffff' || Math.abs(c[2] - 0.6) > 0.001) continue;
  const px = c[3] + c[5] * 0.5;
  let nearest = 0;
  let best = 1e9;
  for (let s = 0; s < 4; s++) {
    const cx = s * 70 * 3 + 195;
    const d = px > cx ? px - cx : cx - px;
    if (d < best) {
      best = d;
      nearest = s;
    }
  }
  let known = false;
  for (let k = 0; k < seenBreak.length; k++) if (seenBreak[k] === nearest) known = true;
  if (!known) seenBreak.push(nearest);
}
console.log('instant break flashes', seenBreak.length);
check('break flash budget is 3 per instant', seenBreak.length === 3);

const breakTimes = [];
let breakClock = 0;
let breakLiveMax = 0;
FX.reset();
FX.setReducedMotion(false);
for (let i = 0; i < 50; i++) {
  FX.kill((i % 8) * 0.4, (i % 5) * 0.3, 'skel', vis);
  FX.shield('wave', 0, 0, 18, 2000);
  FX.shieldBreak('wave');
  calls.length = 0;
  FX.draw(ctx, cam);
  let flashes = sils().n;
  if (countStyle('#ffffff', 0.6) > 0) flashes += 1;
  for (let k = 0; k < flashes; k++) breakTimes.push(breakClock);
  FX.update(0.04);
  if (FX._live() > breakLiveMax) breakLiveMax = FX._live();
  breakClock += 0.04;
}
let breakPeak = 0;
for (let i = 0; i < breakTimes.length; i++) {
  let c = 1;
  for (let j = i + 1; j < breakTimes.length && breakTimes[j] - breakTimes[i] < 0.1; j++) c += 1;
  if (c > breakPeak) breakPeak = c;
}
console.log('flash peak with breaks at 25 kills/s', breakPeak, 'particles', breakLiveMax);
check('breaks keep the 0.1s flash cap', breakPeak <= 3);
check('breaks stay inside the particle cap', breakLiveMax <= 200);

FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
FX.spawn(0, 0);
calls.length = 0;
FX.draw(ctx, cam);
const oneSpawn = countStyle('#26252b', null);
check('spawn draws a dark ring', oneSpawn > 8);
advance(0.11);
calls.length = 0;
FX.draw(ctx, cam);
check('spawn ring grows', countStyle('#26252b', null) > oneSpawn);
advance(0.15);
calls.length = 0;
FX.draw(ctx, cam);
check('spawn expires after 220ms', countStyle('#26252b', null) === 0);

FX.reset();
FX.setReducedMotion(false);
FX.draw(ctx, cam);
for (let i = 0; i < 40; i++) FX.spawn((i - 20) * 80, 0);
calls.length = 0;
FX.draw(ctx, cam);
const capped = countStyle('#26252b', null);
console.log('spawn draw cap rings', oneSpawn ? (capped / oneSpawn) : 0);
check('spawns draw the nearest 24', oneSpawn > 0 && capped === oneSpawn * 24);

FX.reset();
FX.setReducedMotion(true);
FX.spawn(0, 0);
calls.length = 0;
FX.draw(ctx, cam);
const spawnStill = calls.map(function (c) { return c.join(','); }).join('|');
check('reduced motion spawn is a ring', countStyle('#26252b', null) > 8);
advance(0.1);
calls.length = 0;
FX.draw(ctx, cam);
check('reduced motion spawn does not expand', calls.map(function (c) { return c.join(','); }).join('|') === spawnStill);

function quietCtx() {
  return {
    canvas: { width: 390, height: 844 },
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    fillStyle: '#ffffff',
    strokeStyle: '#ffffff',
    lineWidth: 1,
    globalCompositeOperation: 'source-over',
    fillRect: function () {},
    drawImage: function () {},
    beginPath: function () {},
    arc: function () {},
    stroke: function () {},
    save: function () {},
    restore: function () {},
    setTransform: function () {},
    fillText: function () { textCalls += 1; },
    strokeText: function () { textCalls += 1; },
  };
}
if (typeof global.gc === 'function') {
  const quiet = quietCtx();
  FX.reset();
  FX.setReducedMotion(false);
  FX.draw(quiet, cam);
  for (let i = 0; i < 32; i++) FX.telegraph(i, (i - 16) * 1.5, (i % 6), 8000, i === 3 ? { boss: true } : null);
  for (let i = 0; i < 150; i++) FX.kill((i % 12) * 0.4, ((i / 12) | 0) * 0.35, 'skel', vis);
  for (let i = 0; i < 160; i++) {
    FX.update(0.016);
    FX.draw(quiet, cam);
  }
  global.gc();
  for (let i = 0; i < 80; i++) {
    FX.update(0.016);
    FX.draw(quiet, cam);
  }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 120; i++) {
    FX.update(0.016);
    FX.draw(quiet, cam);
  }
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const per = (after - before) / 120;
  console.log('telegraph heap bytes/frame', per.toFixed(2));
  check('zero allocations per telegraph frame', per < 16);

  FX.reset();
  FX.setReducedMotion(false);
  FX.draw(quiet, cam);
  FX.shield('s', 0, 0, 22, 20000);
  for (let i = 0; i < 8; i++) FX.spawn((i - 4) * 20, 8);
  for (let i = 0; i < 160; i++) {
    if (i % 8 === 0) {
      FX.spawn((i % 5) * 14, (i % 3) * 10);
      FX.shieldHit('s', 40, 0);
    }
    FX.update(0.016);
    FX.draw(quiet, cam);
  }
  global.gc();
  for (let i = 0; i < 80; i++) {
    if (i % 8 === 0) {
      FX.spawn((i % 5) * 14, (i % 3) * 10);
      FX.shieldHit('s', 40, 0);
    }
    FX.update(0.016);
    FX.draw(quiet, cam);
  }
  global.gc();
  const shieldBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < 120; i++) {
    if (i % 8 === 0) {
      FX.spawn((i % 5) * 14, (i % 3) * 10);
      FX.shieldHit('s', 40, 0);
    }
    FX.update(0.016);
    FX.draw(quiet, cam);
  }
  global.gc();
  const shieldAfter = process.memoryUsage().heapUsed;
  const shieldPer = (shieldAfter - shieldBefore) / 120;
  console.log('shield heap bytes/frame', shieldPer.toFixed(2));
  check('zero allocations per shield frame', shieldPer < 16);
} else {
  console.log('skip alloc check (run with node --expose-gc)');
}

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
check('Legendary gives r=4', tallOf('#f4f2ff', 200) === 1 && fills('#7fb2ff') > 0);

FX.reset();
FX.beam('rare-case', 0, 0, 'RARE');
calls.length = 0;
FX.draw(ctx, cam);
check('RARE gives r=2', tallOf('#4c7cff', 60) === 1 && tallOf('#f4f2ff', 200) === 0);

FX.reset();
FX.beam('vr-case', 0, 0, 'Very Rare');
calls.length = 0;
FX.draw(ctx, cam);
check('Very Rare gives r=3', tallOf('#b48cff', 150) === 1 && tallOf('#f4f2ff', 200) === 0);

FX.reset();
FX.beam('pad-epic', 0, 0, ' Epic ');
calls.length = 0;
FX.draw(ctx, cam);
check('padded Epic gives r=3', tallOf('#b48cff', 150) === 1);

FX.reset();
FX.beam('us-rare', 0, 0, 'very_rare');
calls.length = 0;
FX.draw(ctx, cam);
check('very_rare gives r=3', tallOf('#b48cff', 150) === 1);

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
check('bogus, null and 42 give r=0 with no throw', !rarityThrew && tallOf('#4c7cff', 20) === 0 && tallOf('#b48cff', 20) === 0 && tallOf('#f4f2ff', 20) === 0 && tallOf('#5ed37a', 20) === 0);

if (fails.length) {
  console.error('FAILED', fails.join(', '));
  process.exit(1);
}
console.log('fx61 checks passed');
