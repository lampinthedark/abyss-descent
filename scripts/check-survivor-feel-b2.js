#!/usr/bin/env node
'use strict';
// Game feel batch 2 check (design/game-feel.md 6 and 4): Dawnbreaker
// cinematic timings (1.6 s, sim hold until 1.2 s, dim 60% outQuad in 300 ms
// and lift 1.2-1.6 s, merge flash 80 ms at 0.9 s within the 60% cap, S3 at
// 0.9 s, title 0.6 -> 1.0 outBack over 250 ms), never stacks with hitstop,
// reduced motion = 0.8 s cut / 50% flash / halved shake; no save/restore or
// shadowBlur; the evolve sweep fires without a second flash. Hero walk:
// 4 deg lean outQuad 80 ms, 10 fps (12 cap) run frames, 1 px bob per frame
// pair, stop squash 1.08 x 0.92 outBack 100 ms, idle breath 1.0-1.03 over
// 1200 ms, 2 dust motes per 180 ms, reduced motion calm.
// Run: node scripts/check-survivor-feel-b2.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js/survivor-fx.js'), 'utf8');
let failed = 0;
function fail(msg) { failed++; console.error('FAIL ' + msg); }
// Minimal canvas stub so FX can paint its cached icons / tinted atlas.
function stubCanvas() {
  const g = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  return { width: 0, height: 0, getContext: () => g };
}
const context = { console, Math, Float64Array, Uint8Array, matchMedia: () => ({ matches: false }), document: { createElement: stubCanvas } };
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
function drawLog() { const { ctx, log } = mockCtx(); FX.draw(ctx, { x: 585, y: 1266, zoom: 5 }); return log; }
const full = (e) => e.op === 'fillRect' && e.args[0] === 0 && e.args[1] === 0 && e.args[2] === 1170 && e.args[3] === 2532;
function whiteFlash(log) { let a = 0; for (const e of log) if (full(e) && e.s.fillStyle === '#ffffff') a = Math.max(a, e.s.globalAlpha); return a; }
function dimAlpha(log) { let a = 0; for (const e of log) if (full(e) && e.s.fillStyle === '#000000') a = Math.max(a, e.s.globalAlpha); return a; }

for (const k of ['evoCinematic', 'evoHold', 'evoActive', 'evoTime', 'evoTitleScale', 'evoDim', 'heroWalk', 'heroPose']) {
  if (typeof FX[k] !== 'function') fail('FX.' + k + ' missing');
}
if (FX.EVO_MS !== 1600 || FX.EVO_FIRE_MS !== 1200 || FX.EVO_SHORT_MS !== 800 || FX.WALK_FPS !== 10) fail('batch 2 constants');

// ---- Cinematic timeline
FX.reset();
FX.setReducedMotion(false);
const opts = { x: 0, y: 0, facing: 1, sprite: 'hero' };
if (!near(FX.evoCinematic('storm', opts), 1.6)) fail('cinematic is 1.6 s');
if (FX.evoCinematic('storm', opts) !== 0) fail('a second cinematic does not stack');
if (!FX.evoHold() || !FX.evoActive()) fail('hold from 0');
adv(0.15);
if (!near(FX.evoDim(), 0.6 * 0.75, 0.01)) fail('dim outQuad at 150 ms: ' + FX.evoDim());
if (FX.evoTitleScale() !== -1) fail('no title before 900 ms');
if (FX.shakeAmp() !== 0) fail('no shake before 900 ms');
adv(0.15);
if (!near(FX.evoDim(), 0.6, 1e-6)) fail('dim 60% from 300 ms: ' + FX.evoDim());
if (!near(dimAlpha(drawLog()), 0.6, 1e-6)) fail('dim drawn at 0.6 black');
adv(0.3); // 0.6 s: icons in flight
{
  const log = drawLog();
  if (log.filter((e) => e.op === 'drawImage').length < 1) fail('icons drawn during 300-900 ms');
  if (whiteFlash(log) > 0) fail('no flash before the merge');
}
adv(0.31); // 0.91 s
{
  const a = whiteFlash(drawLog());
  if (!(a > 0.3 && a <= 0.6 + 1e-9)) fail('merge flash at ~900 ms within 60%: ' + a);
}
if (!(FX.shakeAmp() > 4.5 && FX.shakeAmp() <= 6)) fail('S3 at 900 ms: ' + FX.shakeAmp());
const t0 = FX.evoTitleScale();
if (!(t0 >= 0.6 && t0 < 0.75)) fail('title starts at 0.6: ' + t0);
let peak = 0;
for (let i = 0; i < 25; i++) { adv(0.01); peak = Math.max(peak, FX.evoTitleScale()); }
if (!(peak > 1.02)) fail('title overshoots (outBack): ' + peak);
adv(0.02); // ~1.18 s
if (whiteFlash(drawLog()) > 0) fail('flash gone after 80 ms');
if (!near(FX.evoTitleScale(), 1)) fail('title holds at 1.0 after 250 ms');
if (!FX.evoHold()) fail('still holding before 1.2 s');
adv(0.03); // 1.21 s
if (FX.evoHold()) fail('hold ends at 1.2 s (the slash fires)');
if (!FX.evoActive()) fail('cinematic still lifting the dim');
if (!(FX.evoDim() < 0.6 && FX.evoDim() > 0.5)) fail('dim lifts from 1.2 s: ' + FX.evoDim());
// The game commits now: FX.evolve fires the sweep but no second full-screen flash.
FX.evolve('storm', { x: 0, y: 0, radius: 40 });
if (!(FX.sweepRadius() >= 0)) fail('sweep fires at 1.2 s');
adv(0.01);
if (whiteFlash(drawLog()) > 0) fail('evolve during the cinematic must not flash again');
adv(0.4);
if (FX.evoActive() || FX.evoDim() !== 0) fail('cinematic over at 1.6 s');
{
  const log = drawLog();
  if (dimAlpha(log) > 0) fail('no dim after 1.6 s');
}

// ---- Never stacks with hitstop
FX.reset();
adv(0.5);
FX.hitstop({ elite: true });
if (!(FX.hitstopLeft() > 0)) fail('setup: elite hitstop');
FX.evoCinematic('storm', opts);
if (FX.hitstopLeft() !== 0) fail('a running hitstop is dropped when the cinematic starts');
if (FX.hitstop({ elite: true }) !== 0) fail('no hitstop during the cinematic');
adv(1.62);
if (FX.hitstop({ elite: true }) !== 0) fail('no hitstop within 150 ms after');
adv(0.16);
FX.consumeHitstop(0.5);
if (!(FX.hitstop({ elite: true }) > 0)) fail('hitstop back after the cinematic');

// ---- No save/restore, no shadowBlur, no text across the whole cinematic
FX.reset();
FX.evoCinematic('storm', opts);
for (let i = 0; i < 170; i++) {
  const log = drawLog();
  if (log.some((e) => e.op === 'save' || e.op === 'shadowBlur' || e.op === 'fillText')) { fail('no save/shadowBlur/fillText in the cinematic at ' + i * 10 + ' ms'); break; }
  FX.update(0.01);
}

// ---- Reduced motion: 0.8 s cut, hold 0.6 s, title no overshoot, 50% flash, halved shake
FX.reset();
FX.setReducedMotion(true);
if (!near(FX.evoCinematic('storm', opts), 0.8)) fail('reduced: 0.8 s');
adv(0.46);
if (!near(FX.evoTitleScale(), 1)) fail('reduced: title at 1.0, no overshoot');
{
  const a = whiteFlash(drawLog());
  if (!(a > 0 && a <= 0.3 + 1e-9)) fail('reduced: flash at 50% (<= 0.3): ' + a);
}
{
  let m = 0;
  for (let i = 0; i < 5; i++) { const o = FX.shakeOffset(); m = Math.max(m, Math.abs(o.x), Math.abs(o.y)); }
  if (!(FX.shakeAmp() > 0) || m > 3.01) fail('reduced: S3 halved (<= 3 px): ' + m);
}
adv(0.15);
if (FX.evoHold()) fail('reduced: hold ends at 0.6 s');
adv(0.2);
if (FX.evoActive()) fail('reduced: over at 0.8 s');
FX.setReducedMotion(false);

// ---- Hero walk
const DEG4 = (4 * Math.PI) / 180;
function walk(sec, dx, dy, moving, ratio) { const n = Math.round(sec / 0.01); for (let i = 0; i < n; i++) FX.heroWalk(0.01, dx, dy, moving, 0, 0, ratio || 1); }
FX.reset();
if (FX.heroPose() !== FX.heroPose()) fail('heroPose returns one shared object');
walk(0.05, 0.05, 0, true); // change frame = age 0, then 4 x 10 ms
if (!near(FX.heroPose().rot, DEG4 * 0.75, 0.002)) fail('lean outQuad at 40 ms: ' + FX.heroPose().rot);
walk(0.04, 0.05, 0, true);
if (!near(FX.heroPose().rot, DEG4)) fail('lean 4 deg after 80 ms');
walk(0.1, -0.05, 0, true);
if (!near(FX.heroPose().rot, -DEG4)) fail('lean -4 deg moving left');
walk(0.1, 0, 0.05, true);
if (!near(FX.heroPose().rot, 0)) fail('no lean moving straight up/down');
// Frames: 10 fps (animT * 8 = frame index), capped at 12.
FX.reset();
walk(1, 0.05, 0, true);
if (!near(FX.heroPose().animT * 8, 10, 0.05)) fail('10 fps run frames: ' + FX.heroPose().animT * 8);
FX.reset();
walk(1, 0.05, 0, true, 1.5);
if (!near(FX.heroPose().animT * 8, 12, 0.05)) fail('12 fps cap with faster boots: ' + FX.heroPose().animT * 8);
// Bob: -1 art px on the second frame of each pair, 0 on the first.
FX.reset();
const bobs = new Set();
for (let i = 0; i < 40; i++) {
  FX.heroWalk(0.01, 0.05, 0, true, 0, 0, 1);
  const p = FX.heroPose();
  const odd = Math.floor(p.animT * 8) & 1;
  if (p.bob !== (odd ? -1 : 0)) { fail('bob 1 px per frame pair'); break; }
  bobs.add(p.bob);
}
if (bobs.size !== 2) fail('bob alternates');
// Stop squash 1.08 x 0.92 back over 100 ms (outBack), then idle breath.
FX.heroWalk(0.01, 0, 0, false, 0, 0, 1);
let p = FX.heroPose();
if (!near(p.sx, 1.08) || !near(p.sy, 0.92)) fail('stop squash ~1.08 x 0.92: ' + p.sx + ' x ' + p.sy);
if (p.rot === 0 && p.bob !== 0) fail('no bob when stopped');
let over = false;
for (let i = 0; i < 9; i++) { FX.heroWalk(0.01, 0, 0, false, 0, 0, 1); if (FX.heroPose().sx < 1) over = true; }
if (!over) fail('stop squash overshoots (outBack)');
FX.heroWalk(0.01, 0, 0, false, 0, 0, 1);
p = FX.heroPose();
if (!near(p.sx, 1) || p.sy < 1 || p.sy > 1.03 + 1e-9) fail('squash done by 100 ms, breath in range: ' + p.sx + ' ' + p.sy);
walk(0.6 - 0.11, 0, 0, false);
if (!near(FX.heroPose().sy, 1.03, 0.002)) fail('breath peaks at 1.03 at 600 ms: ' + FX.heroPose().sy);
walk(0.6, 0, 0, false);
if (!near(FX.heroPose().sy, 1, 0.002)) fail('breath back to 1.0 at 1200 ms: ' + FX.heroPose().sy);
// Dust: 2 motes per 180 ms while moving (count the dust colour in FX.draw).
FX.reset();
let maxDust = 0;
let seen = 0;
for (let i = 0; i < 100; i++) {
  FX.heroWalk(0.01, 0.05, 0, true, 0, 0, 1);
  FX.update(0.01);
  const n = drawLog().filter((e) => e.op === 'fillRect' && e.s.fillStyle === '#a8987a').length;
  if (n > maxDust) maxDust = n;
  if (n > 0) seen++;
}
if (maxDust < 2 || maxDust > 6) fail('dust: 2 per puff, ~2 puffs alive, got max ' + maxDust);
if (seen < 80) fail('dust keeps puffing while moving');
// Reduced motion: frames still play, no lean/bob/squash/breath.
FX.reset();
FX.setReducedMotion(true);
walk(0.3, 0.05, 0, true);
p = FX.heroPose();
if (p.rot !== 0 || p.bob !== 0 || !(p.animT > 0)) fail('reduced: no lean/bob, frames play');
FX.heroWalk(0.01, 0, 0, false, 0, 0, 1);
walk(0.5, 0, 0, false);
p = FX.heroPose();
if (p.sx !== 1 || p.sy !== 1) fail('reduced: no squash/breath');
FX.setReducedMotion(false);

if (failed) process.exit(1);
console.log('feel b2 ok: evo 1.6 s (hold 1.2, dim 60% 300 ms in / 1.2-1.6 out, flash 80 ms @0.9 <=60%, S3 @0.9, title 0.6->1.0 outBack 250 ms), no hitstop stack, one flash, reduced 0.8 s / 50% / halved; walk lean 4 deg 80 ms, 10-12 fps, bob 1 px/pair, stop 1.08x0.92 100 ms, breath 1.03/1200 ms, dust 2/180 ms');
