#!/usr/bin/env node
'use strict';
// Telegraph FX check: FX.telegraph/telegraphOff/tellProgress clock and the
// FX.paintTell style (fill #ff5a2a 0.15 -> 0.5, warm edge over a dark outline,
// normal blending, no shadowBlur). Run: node scripts/check-survivor-telegraph.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/survivor-fx.js'), 'utf8');
let failed = 0;
function fail(msg) { failed++; console.error('FAIL ' + msg); }

const context = { console, Math, Float64Array, matchMedia: () => ({ matches: false }) };
vm.createContext(context);
vm.runInContext(src + '\nthis.FX = FX;', context);
const FX = context.FX;

for (const k of ['telegraph', 'telegraphOff', 'tellProgress', 'paintTell']) {
  if (typeof FX[k] !== 'function') fail('FX.' + k + ' missing');
}

// Clock rides FX.update only.
FX.reset();
FX.telegraph(7, 1, 2, 1500);
if (FX.tellProgress(7) !== 0) fail('progress should start at 0');
for (let i = 0; i < 15; i++) FX.update(0.05);
const mid = FX.tellProgress(7);
if (Math.abs(mid - 0.5) > 0.01) fail('progress after 0.75s of 1.5s: ' + mid);
for (let i = 0; i < 30; i++) FX.update(0.05);
if (FX.tellProgress(7) !== 1) fail('progress should clamp at 1');
FX.telegraphOff(7);
if (FX.tellProgress(7) !== -1) fail('telegraphOff should clear');
FX.telegraph('boss', 0, 0);
FX.update(0.05);
if (Math.abs(FX.tellProgress('boss') - 0.05) > 1e-6) fail('default windup should be 1s');
FX.reset();
if (FX.tellProgress('boss') !== -1) fail('reset should clear telegraphs');
for (let i = 0; i < 20; i++) FX.telegraph(i, 0, 0, 500);
FX.telegraphOff(null);

// Mock 2D context recording every state write and draw call.
function mockCtx(cssW, devW) {
  const log = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, shadowBlur: 0 };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k === 'canvas') return { width: devW, height: 100, clientWidth: cssW };
      if (k in t) return t[k];
      return (...args) => log.push({ op: k, args, s: Object.assign({}, t) });
    },
    set(t, k, v) { if (k === 'shadowBlur' && v) log.push({ op: 'shadowBlur' }); t[k] = v; return true; },
  });
  return { ctx, log, state };
}

for (const shape of ['circle', 'cone', 'line']) {
  for (const u of [0, 0.5, 1]) {
    const { ctx, log, state } = mockCtx(390, 1170);
    if (shape === 'circle') FX.paintTell(ctx, 'circle', 100, 100, 60, 0, 0, u);
    else if (shape === 'cone') FX.paintTell(ctx, 'cone', 100, 100, 120, 0.3, 1.6, u);
    else FX.paintTell(ctx, 'line', 100, 100, 400, 260, 30, u);
    const fills = log.filter((e) => e.op === 'fill');
    const strokes = log.filter((e) => e.op === 'stroke');
    const tag = shape + '@' + u;
    if (!fills.length) fail(tag + ' no fill');
    if (fills.some((f) => f.s.fillStyle !== '#ff5a2a')) fail(tag + ' fill colour');
    if (log.some((e) => e.op === 'shadowBlur')) fail(tag + ' uses shadowBlur');
    if (log.some((e) => (e.op === 'fill' || e.op === 'stroke') && e.s.globalCompositeOperation !== 'source-over')) fail(tag + ' not normal blending');
    // Composite fill alpha at the origin.
    let a = 0;
    for (const f of fills) a = a + f.s.globalAlpha * (1 - a);
    const want = u > 0.01 ? 0.15 + 0.35 * u : 0.15;
    if (Math.abs(a - want) > 0.01) fail(tag + ' fill alpha ' + a.toFixed(3) + ' want ' + want);
    const last = strokes[strokes.length - 1];
    const dark = strokes[strokes.length - 2];
    if (!last || last.s.strokeStyle !== '#ffd0a0' || Math.abs(last.s.globalAlpha - 0.9) > 1e-9) fail(tag + ' bright edge');
    if (!last || last.s.lineWidth < 6 || last.s.lineWidth > 9) fail(tag + ' edge should be 2-3 CSS px at dpr 3: ' + (last && last.s.lineWidth));
    if (!dark || dark.s.strokeStyle !== '#7a1a08' || Math.abs(dark.s.lineWidth - last.s.lineWidth - 6) > 1e-9) fail(tag + ' dark 1px outline');
    if (state.globalAlpha !== 1 || state.globalCompositeOperation !== 'source-over') fail(tag + ' should restore alpha/composite');
  }
}
// Bad input is ignored.
{
  const { ctx, log } = mockCtx(390, 390);
  FX.paintTell(ctx, 'circle', NaN, 1, 10, 0, 0, 0.5);
  FX.paintTell(ctx, 'cone', 1, 1, 10, undefined, 1, 0.5);
  FX.paintTell(null, 'circle', 1, 1, 10, 0, 0, 0.5);
  if (log.length) fail('bad args should draw nothing');
}
if (failed) process.exit(1);
console.log('telegraph ok: clock, fill ramp, warm edge + dark outline, source-over, no blur');
