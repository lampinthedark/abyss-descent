#!/usr/bin/env node
'use strict';
// Game feel batch 3 check (design/game-feel.md 7 and 8): level-up pillar
// (16 art px wide, grows to 64 art px over 200 ms outCubic, fades 250 ms,
// drawn under the hero, flat rects, reduced motion = no growth), slow-mo
// constants (0.3 s at 30%), gem chain pitch (+1 semitone per gem within
// 400 ms, cap +12, multiplier 2^(n/12)), gem idle bob (1 px, 800 ms), and
// the card CSS in survivor.html (slide up 220 ms outBack, 60 ms stagger, pick
// scale 1.1 + 120 ms flash <= 60%, reduced-motion fade, XP bar 120 ms outQuad).
// Run: node scripts/check-survivor-feel-b3.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/survivor-fx.js'), 'utf8');
let failed = 0;
function fail(msg) { failed++; console.error('FAIL ' + msg); }
const context = { console, Math, Float64Array, Uint8Array, matchMedia: () => ({ matches: false }) };
vm.createContext(context);
vm.runInContext(src + '\nthis.FX = FX;', context);
const FX = context.FX;
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-6);
function adv(sec) { const n = Math.round(sec / 0.01); for (let i = 0; i < n; i++) FX.update(0.01); }
function mockCtx() {
  const log = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, imageSmoothingEnabled: true };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k === 'canvas') return { width: 1170, height: 2532, clientWidth: 390 };
      if (k in t) return t[k];
      return (...args) => log.push({ op: k, args, s: Object.assign({}, t) });
    },
    set(t, k, v) { if (k === 'shadowBlur' && v) log.push({ op: 'shadowBlur' }); t[k] = v; return true; },
  });
  return { ctx, log };
}
const cam = { x: 585, y: 1266, zoom: 5 };
function under() { const { ctx, log } = mockCtx(); FX.drawUnder(ctx, cam); return log; }
function over() { const { ctx, log } = mockCtx(); FX.draw(ctx, cam); return log; }
const core = (log) => log.filter((e) => e.op === 'fillRect' && e.s.fillStyle === '#ffffff');

for (const k of ['pillar', 'gemChainStep', 'gemChainIndex', 'gemBob', 'reducedMotion']) {
  if (typeof FX[k] !== 'function') fail('FX.' + k + ' missing');
}
if (FX.LEVEL_SLOW_S !== 0.3 || FX.LEVEL_SLOW_SCALE !== 0.3) fail('level-up slow-mo 0.3 s at 30%');
if (FX.PILLAR_MS !== 450 || FX.GEM_CHAIN_MAX !== 12) fail('batch 3 constants');

// ---- Pillar
FX.reset();
FX.setReducedMotion(false);
FX.levelUp(0, 0, { radius: 48 });
let p = FX.pillar();
if (p.h !== 0 || p.a !== 1) fail('pillar starts at height 0');
adv(0.1);
p = FX.pillar();
if (!near(p.h, 0.875, 1e-6)) fail('pillar outCubic at 100 ms: ' + p.h);
adv(0.1);
p = FX.pillar();
if (!near(p.h, 1) || !near(p.a, 1, 1e-6)) fail('full 64 px at 200 ms');
{
  const log = under();
  const widest = Math.max(...log.filter((e) => e.op === 'fillRect' && e.s.fillStyle === '#fff0b0').map((e) => e.args[2]));
  if (widest !== 16 * 5) fail('pillar 16 art px wide: ' + widest);
  const top = Math.min(...log.filter((e) => e.op === 'fillRect' && e.s.fillStyle === '#fff0b0').map((e) => e.args[1]));
  if (1266 - top !== 64 * 5) fail('pillar 64 art px tall: ' + (1266 - top));
  if (!core(log).length) fail('pillar core drawn');
  if (log.some((e) => e.op === 'save' || e.op === 'shadowBlur' || e.op === 'createLinearGradient')) fail('pillar: flat rects, no save/blur/gradients');
  if (core(over()).some((e) => e.args[2] === 4 * 5)) fail('pillar is drawn under the hero (drawUnder), not in FX.draw');
}
adv(0.13);
p = FX.pillar();
if (!near(p.a, 0.48, 1e-6)) fail('pillar fades over 250 ms: ' + p.a);
adv(0.12);
if (FX.pillar().a !== 0 || core(under()).length) fail('pillar gone after 450 ms');
FX.levelUp(); // unplaced (screen) level-up: no pillar
if (FX.pillar().a !== 0) fail('no pillar without a position');
FX.setReducedMotion(true);
FX.levelUp(0, 0);
p = FX.pillar();
if (p.h !== 1 || !(p.a > 0.9)) fail('reduced: full height at once (no growth)');
FX.setReducedMotion(false);

// ---- Gem chain pitch
FX.reset();
adv(0.5);
if (!near(FX.gemChainStep(), 1) || FX.gemChainIndex() !== 0) fail('first gem: pitch 1, index 0');
for (let n = 1; n <= 14; n++) {
  adv(0.1);
  const r = FX.gemChainStep();
  const want = Math.min(n, 12);
  if (!near(r, Math.pow(2, want / 12)) || FX.gemChainIndex() !== want) { fail('gem ' + n + ': +' + want + ' semitones, got ' + r); break; }
}
if (!near(FX.gemChainStep(), 2)) fail('capped at +12 (x2)');
adv(0.41);
if (FX.gemChainIndex() !== 0) fail('index drops after 400 ms');
if (!near(FX.gemChainStep(), 1)) fail('chain restarts after 400 ms');
adv(0.39);
if (!near(FX.gemChainStep(), Math.pow(2, 1 / 12))) fail('within 400 ms keeps climbing');
FX.reset();
if (FX.gemChainIndex() !== 0 || !near(FX.gemChainStep(), 1)) fail('reset clears the chain');

// ---- Gem bob
FX.reset();
let lo = 9;
let hi = -9;
for (let i = 0; i < 80; i++) { const b = FX.gemBob(0.3); lo = Math.min(lo, b); hi = Math.max(hi, b); FX.update(0.01); }
if (!(lo >= 0 && lo < 0.02 && hi <= 1 && hi > 0.98)) fail('gem bob spans 0..1 art px: ' + lo + '..' + hi);
const b0 = FX.gemBob(1.7);
adv(0.8);
if (!near(FX.gemBob(1.7), b0, 1e-6)) fail('gem bob period 800 ms');
FX.setReducedMotion(true);
if (FX.gemBob(0.3) !== 0) fail('reduced: no gem bob');
FX.setReducedMotion(false);

// ---- Cards / XP bar CSS + pick script in survivor.html
const html = fs.readFileSync(path.join(root, 'survivor.html'), 'utf8');
const style = (/<style id="sv-feel-b3">([\s\S]*?)<\/style>/.exec(html) || [])[1] || '';
if (!style) fail('survivor.html batch 3 style block');
if (!/#sv-xp \{ transition: width 120ms cubic-bezier\(0\.5, 1, 0\.89, 1\)/.test(style)) fail('XP bar tween 120 ms outQuad');
if (!/sv-card-in 220ms cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/.test(style)) fail('cards 220 ms outBack');
for (const [n, ms] of [[2, 60], [3, 120], [4, 180]]) {
  if (!style.includes('nth-child(' + n + ') { animation-delay: ' + ms + 'ms; }')) fail('stagger 60 ms: card ' + n);
}
if (!/from \{ transform: translateY\(100vh\); \}/.test(style)) fail('cards slide up from the bottom');
if (!/sv-card-pick 120ms/.test(style) || !/scale\(1\.1\)/.test(style)) fail('pick: scale 1.1 over 120 ms');
if (!/sv-card-flash \{ from \{ opacity: 0\.6; \}/.test(style)) fail('pick flash capped at 60%');
if (!/prefers-reduced-motion: reduce/.test(style) || !/sv-card-fade 120ms/.test(style) || !/opacity: 0\.3/.test(style)) fail('reduced motion: fade, 50% flash');
if (/box-shadow|filter: blur|drop-shadow/.test(style)) fail('no shadows/blur in card animation');
const script = (/game feel batch 3: card pick pulse[\s\S]*?<script>([\s\S]*?)<\/script>/.exec(html) || [])[1] || '';
if (!/PICK_MS = 120/.test(script) || !/stopImmediatePropagation/.test(script) || !/dispatchEvent\(new MouseEvent\('click'/.test(script)) fail('pick script: 120 ms pulse, then the game\'s own click handler');
if (/choose\(|applyChoice|state\s*=/.test(script)) fail('pick script must not hold game logic');

if (failed) process.exit(1);
console.log('feel b3 ok: pillar 16x64 art px, outCubic 200 ms + 250 ms fade, under the hero, flat; slow-mo 0.3 s @30%; gem chain +1 semitone/400 ms cap +12 (x2); gem bob 1 px/800 ms; cards 220 ms outBack, 60 ms stagger, pick 1.1 + 120 ms flash, reduced fade; XP 120 ms outQuad');
