#!/usr/bin/env node
'use strict';
// Telegraph FX check: FX.telegraph/telegraphOff/tellProgress clock, the boss
// FX.paintTell style (fill #ff5a2a 0.15 -> 0.5, pulsing #fff0e0 edge over a
// dark outline) and the quiet FX.paintMobTell style (amber fill <= 0.2, thin
// 0.55 edge, no pulse). Normal blending, no shadowBlur.
// Run: node scripts/check-survivor-telegraph.js
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

for (const k of ['telegraph', 'telegraphOff', 'tellProgress', 'paintTell', 'paintMobTell']) {
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
    if (!last || last.s.strokeStyle !== '#fff0e0' || last.s.globalAlpha < 0.85 - 1e-9 || last.s.globalAlpha > 1) fail(tag + ' bright edge');
    if (!last || last.s.lineWidth < 10.5 - 1e-9 || last.s.lineWidth > 13.5 + 1e-9) fail(tag + ' boss edge should be 3.5-4.5 CSS px at dpr 3: ' + (last && last.s.lineWidth));
    if (!dark || dark.s.strokeStyle !== '#7a1a08' || Math.abs(dark.s.lineWidth - last.s.lineWidth - 6) > 1e-9) fail(tag + ' dark 1px outline');
    if (state.globalAlpha !== 1 || state.globalCompositeOperation !== 'source-over') fail(tag + ' should restore alpha/composite');
  }
}
// Boss edge pulses ~3 Hz on the FX clock; reduced motion holds it steady.
function bossEdge() {
  const { ctx, log } = mockCtx(390, 1170);
  FX.paintTell(ctx, 'circle', 100, 100, 60, 0, 0, 0.5);
  const st = log.filter((e) => e.op === 'stroke');
  return st[st.length - 1].s;
}
{
  FX.reset();
  FX.setReducedMotion(false);
  const widths = [];
  const alphas = [];
  for (let i = 0; i < 20; i++) { FX.update(1 / 60); const e = bossEdge(); widths.push(e.lineWidth); alphas.push(e.globalAlpha); }
  const span = Math.max(...widths) - Math.min(...widths);
  if (span < 2) fail('boss edge width should pulse, span ' + span.toFixed(2));
  if (Math.max(...alphas) - Math.min(...alphas) < 0.1) fail('boss edge alpha should pulse');
  // One full period is 1/3 s.
  FX.reset();
  FX.update(0.04);
  const w0 = bossEdge().lineWidth;
  for (let i = 0; i < 20; i++) FX.update(1 / 60);
  if (Math.abs(bossEdge().lineWidth - w0) > 0.05) fail('boss pulse should repeat every 1/3 s');
  FX.setReducedMotion(true);
  const r1 = bossEdge().lineWidth;
  FX.update(0.05);
  if (bossEdge().lineWidth !== r1) fail('reduced motion should hold the boss edge steady');
  FX.setReducedMotion(false);
}

// Mob style: quiet amber, thin edge, never louder than the boss.
const bossMin = { width: 3.5 * 3, alpha: 0.85, fill: 0.5 };
for (const shape of ['line', 'dot']) {
  const widths = [];
  for (const u of [0, 0.5, 1]) {
    const { ctx, log, state } = mockCtx(390, 1170);
    if (shape === 'line') FX.paintMobTell(ctx, 'line', 100, 100, 300, 160, 12, u);
    else FX.paintMobTell(ctx, 'dot', 100, 100, 20, 0, 0, u);
    FX.update(0.05);
    const tag = 'mob ' + shape + '@' + u;
    const fills = log.filter((e) => e.op === 'fill');
    const strokes = log.filter((e) => e.op === 'stroke');
    if (!fills.length || fills.some((f) => f.s.fillStyle !== '#e0a060')) fail(tag + ' fill should be amber #e0a060');
    let a = 0;
    for (const f of fills) a = a + f.s.globalAlpha * (1 - a);
    if (a > 0.2 + 1e-6) fail(tag + ' fill alpha ' + a.toFixed(3) + ' above 0.2');
    if (u === 1 && a < 0.19) fail(tag + ' fill should reach ~0.2');
    if (strokes.length !== 1) fail(tag + ' one thin edge, no outline: ' + strokes.length);
    const e = strokes[0] && strokes[0].s;
    if (!e || e.strokeStyle !== '#ffd0a0' || Math.abs(e.globalAlpha - 0.55) > 1e-9) fail(tag + ' edge #ffd0a0 @ 0.55');
    if (!e || Math.abs(e.lineWidth - 4.5) > 1e-9) fail(tag + ' edge should be 1.5 CSS px at dpr 3');
    if (e && (e.lineWidth >= bossMin.width || e.globalAlpha >= bossMin.alpha || a >= bossMin.fill)) fail(tag + ' must stay quieter than the boss');
    if (log.some((x) => x.op === 'shadowBlur')) fail(tag + ' uses shadowBlur');
    if (log.some((x) => (x.op === 'fill' || x.op === 'stroke') && x.s.globalCompositeOperation !== 'source-over')) fail(tag + ' not normal blending');
    if (state.globalAlpha !== 1) fail(tag + ' should restore alpha');
    if (e) widths.push(e.lineWidth);
  }
  if (new Set(widths).size !== 1) fail('mob ' + shape + ' edge should not pulse');
}
// Dot grows from 30% to full radius.
{
  const radiusAt = (u) => {
    const { ctx, log } = mockCtx(390, 390);
    FX.paintMobTell(ctx, 'dot', 50, 50, 20, 0, 0, u);
    const arc = log.find((e) => e.op === 'arc');
    return arc ? arc.args[2] : -1;
  };
  if (Math.abs(radiusAt(0) - 6) > 1e-9 || Math.abs(radiusAt(1) - 20) > 1e-9) fail('mob dot radius ' + radiusAt(0) + ' -> ' + radiusAt(1));
}
// Bad input is ignored.
{
  const { ctx, log } = mockCtx(390, 390);
  FX.paintTell(ctx, 'circle', NaN, 1, 10, 0, 0, 0.5);
  FX.paintTell(ctx, 'cone', 1, 1, 10, undefined, 1, 0.5);
  FX.paintTell(null, 'circle', 1, 1, 10, 0, 0, 0.5);
  FX.paintMobTell(ctx, 'dot', 1, 1, NaN, 0, 0, 0.5);
  FX.paintMobTell(ctx, 'line', 1, 1, 10, 10, 0, 0.5);
  if (log.length) fail('bad args should draw nothing');
}
if (failed) process.exit(1);
console.log('telegraph ok: clock, boss fill ramp + 3 Hz pulsing edge + dark outline, quiet amber mob tells, source-over, no blur');
