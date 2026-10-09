#!/usr/bin/env node
'use strict';
// Boss guard ring FX check. Run: node scripts/check-survivor-bossguard.js
// Covers: throttle (one ring per 180 ms), pool cap 4, 220 ms fade + 15% growth,
// colour/width/alpha, world-tile coordinates, reduced motion, reset, bad args.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js/survivor-fx.js'), 'utf8');
let failed = 0;
function fail(msg) { failed++; console.error('FAIL ' + msg); }
const context = { console, Math, Float64Array, Uint8Array, matchMedia: () => ({ matches: false }) };
vm.createContext(context);
vm.runInContext(src + '\nthis.FX = FX;', context);
const FX = context.FX;

if (typeof FX.bossGuard !== 'function') fail('FX.bossGuard missing');
const st = FX.guardNumberStyle;
if (!st || st.color !== '#9aa0a8' || st.scale !== 0.75 || !Object.isFrozen(st)) fail('FX.guardNumberStyle {color:#9aa0a8, scale:0.75}, frozen');

function mockCtx(cssW, devW) {
  const log = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k === 'canvas') return { width: devW, height: 2532, clientWidth: cssW };
      if (k in t) return t[k];
      return (...args) => log.push({ op: k, args, s: Object.assign({}, t) });
    },
    set(t, k, v) { if (k === 'shadowBlur' && v) log.push({ op: 'shadowBlur' }); t[k] = v; return true; },
  });
  return { ctx, log };
}
// FX.update clamps dt at 0.05 s, so advance in 10 ms steps.
function adv(sec) { const n = Math.round(sec / 0.01); for (let i = 0; i < n; i++) FX.update(0.01); }
const cam = { x: 100, y: 200, zoom: 3 }; // tile = 16 * 3 = 48 px
function ringsNow() {
  const { ctx, log } = mockCtx(390, 1170);
  FX.draw(ctx, cam);
  const out = [];
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.op === 'arc' && e.s.strokeStyle === '#e8eef8') {
      const st2 = log.slice(i).find((x) => x.op === 'stroke');
      out.push({ x: e.args[0], y: e.args[1], r: e.args[2], a: st2.s.globalAlpha, w: st2.s.lineWidth, op: st2.s.globalCompositeOperation });
    }
  }
  if (log.some((e) => e.op === 'shadowBlur')) fail('guard uses shadowBlur');
  return { rings: out, log };
}

// Throttle: extra calls within 180 ms are ignored.
FX.reset();
FX.setReducedMotion(false);
if (!FX.bossGuard(2, 3)) fail('first guard should be accepted');
if (FX.bossGuard(2, 3)) fail('same-frame repeat should be ignored');
adv(0.1);
if (FX.bossGuard(2, 3)) fail('call at 100 ms should be ignored');
adv(0.05);
if (FX.bossGuard(2, 3)) fail('call at 150 ms should be ignored');
adv(0.03);
if (!FX.bossGuard(2, 3)) fail('call at 180 ms should be accepted');
if (FX.guardLive() !== 2) fail('two rings live, got ' + FX.guardLive());
// Spam at 60 fps for 2 s: accepted <= 2000/180 + 1.
FX.reset();
let accepted = 0;
for (let f = 0; f < 120; f++) { if (FX.bossGuard(0, 0)) accepted++; if (FX.bossGuard(0, 0)) accepted++; FX.update(1 / 60); }
if (accepted > 12 || accepted < 10) fail('throttle: ' + accepted + ' rings in 2 s');
// Pool cap: never more than 4 live, even if the clock jumps in small steps.
FX.reset();
let maxLive = 0;
for (let f = 0; f < 200; f++) { FX.bossGuard(0, 0); adv(0.05); maxLive = Math.max(maxLive, FX.guardLive()); }
if (maxLive > 4) fail('pool cap 4, saw ' + maxLive);
if (ringsNow().rings.length > 4) fail('drew more than 4 rings');

// Look + fade timing: world (2, 3) -> screen (2*48+100, 3*48+200); radius 40 CSS px * 3.
FX.reset();
FX.bossGuard(2, 3);
let r = ringsNow().rings;
if (r.length !== 1) fail('one ring expected, got ' + r.length);
else {
  if (r[0].x !== 196 || r[0].y !== 344) fail('world tiles -> screen: ' + r[0].x + ',' + r[0].y);
  if (Math.abs(r[0].r - 120) > 1e-6) fail('default radius 40 CSS px: ' + r[0].r);
  if (Math.abs(r[0].a - 0.8) > 1e-6) fail('peak alpha 0.8: ' + r[0].a);
  if (Math.abs(r[0].w - 7.5) > 1e-6) fail('2.5 CSS px edge: ' + r[0].w);
  if (r[0].op !== 'source-over') fail('normal blending');
}
const ticks = ringsNow().log.filter((e) => e.op === 'moveTo').length;
if (ticks < 4 || ticks > 6) fail('4-6 sheen ticks, got ' + ticks);
adv(0.11);
r = ringsNow().rings;
if (!r.length || Math.abs(r[0].r - 120 * 1.075) > 1e-6) fail('half-way radius should be +7.5%: ' + (r[0] && r[0].r));
if (!r.length || !(r[0].a < 0.45 && r[0].a > 0.25)) fail('half-way alpha: ' + (r[0] && r[0].a));
adv(0.1);
r = ringsNow().rings;
if (!r.length || r[0].r > 120 * 1.15 + 1e-6 || r[0].r < 120 * 1.13) fail('near end radius ~+15%: ' + (r[0] && r[0].r));
adv(0.02);
if (FX.guardLive() !== 0 || ringsNow().rings.length) fail('ring should be gone after 220 ms');
// Radius arg.
FX.reset();
FX.bossGuard(0, 0, 60);
r = ringsNow().rings;
if (!r.length || Math.abs(r[0].r - 180) > 1e-6) fail('radius arg 60 CSS px: ' + (r[0] && r[0].r));

// Reduced motion: no expansion, short fade (<= 150 ms).
FX.reset();
FX.setReducedMotion(true);
FX.bossGuard(0, 0);
const r0 = ringsNow().rings[0].r;
adv(0.06);
const mid = ringsNow().rings[0];
if (!mid || mid.r !== r0) fail('reduced motion: ring should not grow');
if (!mid || !(mid.a < 0.8)) fail('reduced motion: ring should fade');
adv(0.07);
if (FX.guardLive() !== 0) fail('reduced motion fade should end by 130 ms');
FX.setReducedMotion(false);

// Reset clears; bad args ignored.
FX.reset();
FX.bossGuard(1, 1);
FX.reset();
if (FX.guardLive() !== 0 || ringsNow().rings.length) fail('reset should clear rings');
if (!FX.bossGuard(1, 1)) fail('reset should clear the throttle');
FX.reset();
if (FX.bossGuard(NaN, 1) || FX.bossGuard(1, undefined) || FX.guardLive()) fail('bad coords should be ignored');

if (failed) process.exit(1);
console.log('bossguard ok: 180 ms throttle, pool 4, 220 ms fade +15%, #e8eef8 2.5 CSS px @0.8, world tiles, reduced motion, reset');
