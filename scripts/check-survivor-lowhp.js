#!/usr/bin/env node
'use strict';
// Low-HP heartbeat + gem trail FX check. Run: node scripts/check-survivor-lowhp.js
// Covers: heart rate across HP, nothing drawn at >= 35%, lub-dub shape,
// alpha cap 0.55, vignette gradient cached per ctx/size, HP-bar flash below
// 15% (<= 3 Hz), reduced motion steady, gem trail cap 64 per frame.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js/survivor-fx.js'), 'utf8');
let failed = 0;
function fail(msg) { failed++; console.error('FAIL ' + msg); }
const context = { console, Math, Float64Array, matchMedia: () => ({ matches: false }) };
vm.createContext(context);
vm.runInContext(src + '\nthis.FX = FX;', context);
const FX = context.FX;

for (const k of ['drawLowHp', 'lowHpFlash', 'drawHpBarFlash', 'heartRate', 'gemTrail']) {
  if (typeof FX[k] !== 'function') fail('FX.' + k + ' missing');
}

function mockCtx(cssW, devW) {
  const log = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 };
  let grads = 0;
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k === 'canvas') return { width: devW, height: 2532, clientWidth: cssW };
      if (k === 'createRadialGradient') return (...a) => { grads++; log.push({ op: k, args: a }); return { addColorStop() {} }; };
      if (k in t) return t[k];
      return (...args) => log.push({ op: k, args, s: Object.assign({}, t) });
    },
    set(t, k, v) { if (k === 'shadowBlur' && v) log.push({ op: 'shadowBlur' }); t[k] = v; return true; },
  });
  return { ctx, log, state, grads: () => grads };
}

// Heart rate: 0 at/above 35%, 60 bpm just below, 140 bpm at 5% and under.
const rate = (hp) => FX.heartRate(hp);
if (rate(1) !== 0 || rate(0.35) !== 0 || rate(0.5) !== 0) fail('no heartbeat at >= 35%');
if (Math.abs(rate(0.3499) - 60) > 0.1) fail('~60 bpm at 35%: ' + rate(0.3499));
if (Math.abs(rate(0.2) - 100) > 1e-6) fail('100 bpm at 20%: ' + rate(0.2));
if (rate(0.05) !== 140 || rate(0.01) !== 140) fail('140 bpm at <= 5%');
for (let h = 0.34; h > 0.05; h -= 0.01) if (rate(h - 0.01) < rate(h)) fail('rate should rise as HP falls');

// Nothing drawn at >= 35%.
FX.reset();
FX.setReducedMotion(false);
{
  const { ctx, log } = mockCtx(390, 1170);
  for (let t = 0; t < 2000; t += 16) FX.drawLowHp(ctx, 1170, 2532, 0.35, t);
  for (let t = 2000; t < 3000; t += 16) FX.drawLowHp(ctx, 1170, 2532, 0.9, t);
  if (log.length) fail('drew at >= 35% HP: ' + log.length + ' calls');
  if (FX.lowHpFlash(0.2, 3000) !== 0) fail('no bar flash at >= 15%');
}

// Beat timing: measure peaks of the vignette alpha over 6 s at a given HP.
function alphaTrace(hp, ms, stepMs) {
  FX.reset();
  const { ctx } = mockCtx(390, 1170);
  const out = [];
  for (let t = 0; t <= ms; t += stepMs) out.push(FX.drawLowHp(ctx, 1170, 2532, hp, t));
  return out;
}
function beatsPerMin(trace, stepMs) {
  // count lub onsets: one-step rises bigger than half the swing (dubs are smaller)
  const span = Math.max(...trace) - Math.min(...trace);
  let n = 0;
  for (let i = 1; i < trace.length; i++) if (trace[i] - trace[i - 1] > span * 0.5) n++;
  return n / (trace.length * stepMs / 60000);
}
for (const [hp, want] of [[0.34, 60 + 80 * (0.01 / 0.3)], [0.2, 100], [0.05, 140]]) {
  const tr = alphaTrace(hp, 12000, 10);
  const bpm = beatsPerMin(tr, 10);
  if (Math.abs(bpm - want) > 6) fail('hp ' + hp + ' measured ' + bpm.toFixed(1) + ' bpm, want ~' + want.toFixed(1));
  const max = Math.max(...tr);
  if (max > 0.55 + 1e-9) fail('vignette alpha above 0.55: ' + max);
  if (hp === 0.05 && max < 0.5) fail('vignette should approach 0.55 at 5%: ' + max);
}
// Lub-dub: within one beat at 60 bpm there is a second, smaller bump ~0.3 beat later.
{
  const tr = alphaTrace(0.3499, 1000, 5);
  const lub = tr.indexOf(Math.max(...tr.slice(0, 20)));
  let dip = 1, dub = 0, dubAt = -1;
  for (let i = 1; i < 120; i++) {
    if (i * 5 < 280) dip = Math.min(dip, tr[i]);
    else if (tr[i] > dub) { dub = tr[i]; dubAt = i * 5; }
  }
  if (!(dub > dip + 0.005) || dubAt < 290 || dubAt > 360) fail('expected a dub bump ~300ms after the lub: dip ' + dip + ' dub ' + dub + ' at ' + dubAt);
  if (!(dub < tr[lub])) fail('dub should be softer than lub');
}
// Phase does not double-advance when flash and vignette share nowMs.
{
  FX.reset();
  const { ctx } = mockCtx(390, 1170);
  FX.drawLowHp(ctx, 1170, 2532, 0.1, 0);
  for (let t = 16; t <= 480; t += 16) { FX.drawLowHp(ctx, 1170, 2532, 0.1, t); FX.lowHpFlash(0.1, t); }
  const ph = FX.lowHpStats().phase;
  const want = (0.48 * rate(0.1) / 60) % 1;
  if (Math.abs(ph - want) > 1e-6) fail('phase double counted: ' + ph + ' want ' + want);
}

// Gradient cache: one build per ctx + size; resize rebuilds once.
{
  FX.reset();
  const m = mockCtx(390, 1170);
  for (let t = 0; t < 1000; t += 16) FX.drawLowHp(m.ctx, 1170, 2532, 0.2, t);
  if (m.grads() !== 1) fail('gradient should be built once, got ' + m.grads());
  for (let t = 1000; t < 1500; t += 16) FX.drawLowHp(m.ctx, 2532, 1170, 0.2, t);
  if (m.grads() !== 2) fail('resize should rebuild once, got ' + m.grads());
  const fills = m.log.filter((e) => e.op === 'fillRect');
  if (fills.some((f) => f.s.globalCompositeOperation !== 'source-over')) fail('vignette must use normal blending');
  if (m.log.some((e) => e.op === 'shadowBlur')) fail('no shadowBlur');
  const tf = m.log.filter((e) => e.op === 'setTransform').pop();
  if (!tf || tf.args[0] !== 1266 || tf.args[3] !== 585) fail('vignette ellipse should scale to the view');
  if (m.log.filter((e) => e.op === 'save').length !== m.log.filter((e) => e.op === 'restore').length) fail('save/restore balance');
}

// HP-bar flash: 0 at >= 15%, lub only (one rise per beat), <= 1.
{
  FX.reset();
  const vals = [];
  for (let t = 0; t <= 6000; t += 10) vals.push(FX.lowHpFlash(0.05, t));
  if (Math.max(...vals) > 1 || Math.min(...vals) < 0) fail('flash out of 0..1');
  let rises = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] - vals[i - 1] > 0.2) rises++;
  const hz = rises / 6;
  if (hz > 3) fail('bar flash above 3 Hz: ' + hz);
  if (Math.abs(hz - 140 / 60) > 0.4) fail('bar flash should follow the beat: ' + hz + ' Hz');
  const { ctx, log } = mockCtx(390, 1170);
  FX.reset();
  FX.lowHpFlash(0.1, 0);
  const f = FX.drawHpBarFlash(ctx, 10, 10, 200, 12, 0.1, 1);
  if (!(f > 0.5) || !log.some((e) => e.op === 'fillRect')) fail('drawHpBarFlash should paint the rect on a beat');
}

// Reduced motion: steady vignette, flash held.
{
  FX.reset();
  FX.setReducedMotion(true);
  const tr = alphaTrace(0.1, 3000, 16);
  if (Math.max(...tr) - Math.min(...tr) > 1e-9 || !(tr[0] > 0)) fail('reduced motion vignette should be steady and visible');
  if (FX.lowHpFlash(0.1, 4000) !== 0.5 || FX.lowHpFlash(0.1, 4100) !== 0.5) fail('reduced motion flash should hold at 0.5');
  FX.setReducedMotion(false);
}

// Gem trail: still gems draw nothing, moving gems a 4-segment streak, cap 64/frame, reset in FX.draw.
{
  FX.reset();
  const { ctx, log } = mockCtx(390, 1170);
  if (FX.gemTrail(ctx, 100, 100, 0, 0) || log.length) fail('resting gem should draw nothing');
  FX.gemTrail(ctx, 100, 100, 600, 0, '#5fd8ff');
  const strokes = log.filter((e) => e.op === 'stroke');
  if (strokes.length !== 4) fail('trail should be 4 segments, got ' + strokes.length);
  const alphas = strokes.map((s) => s.s.globalAlpha);
  if (!alphas.every((a, i) => i === 0 || a < alphas[i - 1])) fail('segments should fade');
  const lines = log.filter((e) => e.op === 'lineTo');
  const tail = lines[lines.length - 1].args[0];
  if (!(tail < 100) || 100 - tail > 22 * 3 + 1e-6) fail('streak should trail behind, <= 22 CSS px: tail x ' + tail);
  let drawn = 1;
  for (let i = 0; i < 100; i++) if (FX.gemTrail(ctx, i, 50, -400, 300)) drawn++;
  if (drawn !== 64) fail('cap 64 trails per frame, drew ' + drawn);
  FX.draw(ctx, { x: 0, y: 0, zoom: 3 });
  if (!FX.gemTrail(ctx, 5, 5, 300, 0)) fail('FX.draw should reset the trail cap');
  if (log.some((e) => e.op === 'shadowBlur')) fail('trail uses shadowBlur');
  if (ctx.globalAlpha !== 1) fail('trail should restore alpha');
  const bad = mockCtx(390, 1170);
  FX.gemTrail(bad.ctx, NaN, 1, 300, 0);
  FX.gemTrail(null, 1, 1, 300, 0);
  if (bad.log.length) fail('bad args draw nothing');
}

if (failed) process.exit(1);
console.log('lowhp ok: 60->140 bpm lub-dub, none at >=35%, alpha <= 0.55, gradient cached, bar flash <= 3 Hz, reduced motion steady, gem trail cap 64');
