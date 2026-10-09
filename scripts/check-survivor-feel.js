#!/usr/bin/env node
'use strict';
// Game feel batch 1 check (design/game-feel.md 1, 2 + shake rules, plus the
// perf limits): shake levels / no stacking / cap / normal mobs never shake /
// reduced motion halves; hitstop rules (elites, boss crits, never normal mobs,
// max not sum, 150 ms gap, sim clock only); knockback and squash timing;
// death pop/shrink/white; shards 4-6 at the end of the pop, 350 ms, colours,
// cap 120 in the fixed pool, 1-2 above 80 foes, pop skip above 150; flat
// batched shard drawing; drawWhite. Run: node scripts/check-survivor-feel.js
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
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-6);
function adv(sec) { const n = Math.round(sec / 0.01); for (let i = 0; i < n; i++) FX.update(0.01); }

for (const k of ['shake', 'shakeAmp', 'hitstop', 'hitstopLeft', 'consumeHitstop', 'knockTiles', 'knockStep', 'foePose', 'drawWhite', 'shardCount']) {
  if (typeof FX[k] !== 'function') fail('FX.' + k + ' missing');
}

// ---- Shake
FX.reset();
FX.setReducedMotion(false);
const want = [[1, 2, 120], [2, 4, 200], [3, 6, 300], [4, 8, 400]];
for (const [lv, amp, ms] of want) {
  FX.reset();
  if (!FX.shake(lv)) fail('S' + lv + ' should start');
  if (!near(FX.shakeAmp(), amp)) fail('S' + lv + ' amp ' + FX.shakeAmp());
  adv(ms / 2000);
  if (!near(FX.shakeAmp(), amp * 0.25, 0.05)) fail('S' + lv + ' outQuad decay at half: ' + FX.shakeAmp());
  adv(ms / 2000 + 0.01);
  if (FX.shakeAmp() !== 0) fail('S' + lv + ' should end after ' + ms + ' ms');
}
// No stacking: weaker or equal shakes never add or replace a stronger running one.
FX.reset();
FX.shake(3);
if (FX.shake(1) || FX.shake(2) || FX.shake(3)) fail('weaker/equal shake must not replace a running S3');
if (!near(FX.shakeAmp(), 6)) fail('S3 stays at 6, no stacking: ' + FX.shakeAmp());
for (let i = 0; i < 50; i++) FX.shake(4);
if (FX.shakeAmp() > 8) fail('cap 8 px: ' + FX.shakeAmp());
// A fresh shake replaces only when stronger than what is left.
FX.reset();
FX.shake(2);
adv(0.15); // S2 left: 4 * (0.05/0.2)^2 = 0.25
if (!FX.shake(1)) fail('S1 should replace a nearly finished S2');
// Offsets stay within the cap, rotation not exposed, reduced motion halves.
FX.reset();
FX.shake(4);
let maxOff = 0;
for (let i = 0; i < 40; i++) { const o = FX.shakeOffset(); maxOff = Math.max(maxOff, Math.abs(o.x), Math.abs(o.y)); FX.update(0.01); }
if (maxOff > 8 || maxOff < 1) fail('S4 offsets within 8 px and visible: ' + maxOff);
FX.reset();
FX.setReducedMotion(true);
FX.shake(4);
let maxRm = 0;
for (let i = 0; i < 40; i++) { const o = FX.shakeOffset(); maxRm = Math.max(maxRm, Math.abs(o.x), Math.abs(o.y)); FX.update(0.01); }
if (maxRm > 4 + 1e-9) fail('reduced motion halves shake: ' + maxRm);
FX.setReducedMotion(false);
// Normal mobs never shake: hits and deaths of normal mobs.
FX.reset();
const frame = { sx: 0, sy: 0, sw: 16, sh: 16 };
for (let i = 0; i < 30; i++) {
  FX.hit(i * 0.1, 0, { frame, scale: 1, crit: i % 2 === 0 });
  FX.kill(i * 0.1, 1, 'skel', { frame, color: '#ffffff', sprite: 'skel', crowd: 10 });
  FX.update(0.016);
  if (FX.shakeAmp() !== 0) { fail('normal mob hit/death shook the screen'); break; }
}
FX.reset();
FX.kill(0, 0, 'skel', { frame, elite: true, sprite: 'goblin' });
if (!near(FX.shakeAmp(), 4)) fail('elite death = S2: ' + FX.shakeAmp());
FX.reset();
FX.kill(0, 0, 'boss', { frame, boss: true });
if (!near(FX.shakeAmp(), 8)) fail('boss death = S4: ' + FX.shakeAmp());

// ---- Hitstop
FX.reset();
if (FX.hitstop({ crit: true }) !== 0 || FX.hitstop({}) !== 0) fail('never hitstop on normal mobs (crit or not)');
if (FX.hitstop({ boss: true }) !== 0) fail('boss non-crit: no hitstop');
if (!near(FX.hitstop({ elite: true }), 0.06)) fail('elite hit 60 ms');
// Same frame: elite + boss crit -> one stop, max not sum.
FX.hitstop({ boss: true, crit: true });
FX.hitstop({ elite: true, crit: true });
if (!near(FX.hitstopLeft(), 0.06)) fail('overlapping stops take the max: ' + FX.hitstopLeft());
// Sim dt scaling: frozen for 60 ms, then the remainder.
// 4 * 16 = 64 ms > 60: the 4th frame should have returned 4 ms.
FX.reset();
FX.hitstop({ elite: true });
let simT = 0;
for (let i = 0; i < 4; i++) simT += FX.consumeHitstop(0.016);
if (!near(simT, 0.004, 1e-9)) fail('remainder after a 60 ms stop: ' + simT);
// 150 ms gap after the stop ends.
if (FX.hitstop({ elite: true }) !== 0) fail('no new stop right after one ends');
for (let i = 0; i < 9; i++) FX.consumeHitstop(0.016); // 144 ms (+4 ms already)
if (FX.hitstop({ elite: true }) !== 0) fail('gap not over at 148 ms');
FX.consumeHitstop(0.016);
if (!near(FX.hitstop({ elite: true }), 0.06)) fail('new stop after the 150 ms gap');
FX.reset();
if (!near(FX.hitstop({ boss: true, crit: true }), 0.04)) fail('boss crit 40 ms');
FX.reset();
FX.setReducedMotion(true);
if (FX.hitstop({ elite: true, crit: true }) !== 0) fail('reduced motion: no hitstop');
FX.setReducedMotion(false);
if (FX.consumeHitstop(0.016) !== 0.016) fail('no stop: sim dt passes through');

// ---- Knockback + squash + flash
if (!near(FX.knockTiles({}), 6 / 16) || !near(FX.knockTiles({ elite: true }), 3 / 16) || FX.knockTiles({ boss: true }) !== 0) fail('knockback 6 / 3 / 0 px');
let sum = 0;
for (let t = 0; t < 0.2; t += 0.01) sum += FX.knockStep(t, 0.01);
if (!near(sum, 1, 1e-9)) fail('knockback total fraction 1: ' + sum);
if (!near(FX.knockStep(0, 0.045), 0.75)) fail('knockback outQuad: 75% at half time');
if (FX.knockStep(0.09, 0.01) !== 0) fail('knockback done by 90 ms');
let p = FX.foePose(0, 0.06, -1, 1);
if (!near(p.sx, 1.15) || !near(p.sy, 0.85) || p.white !== 1) fail('hit: squash 1.15x0.85 + white');
p = FX.foePose(0.1, 0, -1, 1);
if (!near(p.sx, 1) || !near(p.sy, 1) || p.white !== 0) fail('squash back to 1 at 100 ms, no flash after 60 ms');
p = FX.foePose(0.07, 0, -1, 1);
if (!(p.sx < 1)) fail('outBack overshoot below 1 near the end: ' + p.sx);
if (FX.HIT_FLASH !== 0.06) fail('hit flash 60 ms');
FX.setReducedMotion(true);
if (FX.foePose(0, 0.06, -1, 1).white !== 0.5) fail('reduced motion: flashes at 50%');
FX.setReducedMotion(false);
// Death: pop to 1.25 by 60 ms, white shrink to 0 by 180 ms (inQuad).
p = FX.foePose(9, 0, 0.03, 1);
if (!near(p.sx, 1 + 0.25 * 0.75) || p.white !== 0) fail('pop outQuad toward 1.25, no white yet: ' + p.sx);
p = FX.foePose(9, 0, 0.06, 1);
if (!near(p.sx, 1.25) || p.white !== 1) fail('1.25 at 60 ms, white shrink starts');
p = FX.foePose(9, 0, 0.12, 1);
if (!near(p.sx, 1.25 * 0.75) || p.white !== 1) fail('inQuad shrink at half (0.9375) in white: ' + p.sx);
p = FX.foePose(9, 0, 0.18, 1);
if (p.sx !== 0) fail('gone at 180 ms');
p = FX.foePose(9, 0, 0.09, 0);
if (p.white !== 0 || !(p.sx < 1)) fail('skipped pop: plain shrink, no white');
if (!near(FX.DEATH_S, 0.18) || !near(FX.POP_S, 0.06)) fail('death constants');

// ---- Shards
function mockCtx() {
  const log = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 };
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
FX.reset();
FX.kill(0, 0, 'skel', { frame, sprite: 'skel', crowd: 10 });
if (FX.shardCount() !== 0) fail('shards wait for the end of the pop');
adv(0.06);
const n0 = FX.shardCount();
if (n0 < 4 || n0 > 6) fail('4-6 shards per normal death, got ' + n0);
adv(0.3);
if (FX.shardCount() !== n0) fail('shards still alive at 300 ms');
adv(0.06);
if (FX.shardCount() !== 0) fail('shards gone after 350 ms');
// Colours by kind.
const colours = { skel: '#e8e0c8', goblin: '#6cbf4a', imp: '#ff8a2a', chort: '#d0302a' };
for (const sp of Object.keys(colours)) {
  FX.reset();
  FX.kill(0, 0, 'skel', { frame, sprite: sp, crowd: 0 });
  adv(0.07);
  const { ctx, log } = mockCtx();
  FX.draw(ctx, { x: 0, y: 0, zoom: 3 });
  const rects = log.filter((e) => e.op === 'fillRect' && e.s.fillStyle === colours[sp]);
  if (rects.length < 4) fail(sp + ' shards should be ' + colours[sp] + ', got ' + rects.length);
}
// Elite: 10 shards; crowd > 80: 1-2; crowd > 150: every second pop skipped.
FX.reset();
FX.kill(0, 0, 'skel', { frame, sprite: 'goblin', elite: true });
adv(0.07);
if (FX.shardCount() !== 10) fail('elite death 10 shards, got ' + FX.shardCount());
FX.reset();
let pops = 0;
for (let i = 0; i < 20; i++) {
  const before = FX.shardCount();
  pops += FX.kill(0, 0, 'skel', { frame, sprite: 'skel', crowd: 100 });
  adv(0.07);
  const got = FX.shardCount() - before;
  if (got < 1 || got > 2) { fail('above 80 foes: 1-2 shards, got ' + got); break; }
  adv(0.4);
}
if (pops !== 20) fail('80-150 foes keep every pop: ' + pops);
FX.reset();
pops = 0;
for (let i = 0; i < 20; i++) pops += FX.kill(0, 0, 'skel', { frame, sprite: 'skel', crowd: 200 });
if (pops !== 10) fail('above 150 foes every second pop is skipped: ' + pops + '/20');
// Cap 120: 60 kills in one frame (300 asked) never exceed it; pool is fixed.
FX.reset();
for (let i = 0; i < 60; i++) FX.kill(i * 0.01, 0, 'skel', { frame, sprite: 'skel', crowd: 10 });
adv(0.07);
if (FX.shardCount() > 120) fail('shard cap 120: ' + FX.shardCount());
if (FX.shardCount() < 100) fail('cap should fill, got ' + FX.shardCount());
// Batched flat draw: one fillStyle per colour run, alpha 1, no save/restore/shadowBlur.
{
  FX.reset();
  for (let i = 0; i < 10; i++) FX.kill(i * 0.2, 0, 'skel', { frame, sprite: i % 2 ? 'imp' : 'skel', crowd: 10 });
  adv(0.07);
  const { ctx, log } = mockCtx();
  FX.draw(ctx, { x: 0, y: 0, zoom: 3 });
  const shardRects = log.filter((e) => e.op === 'fillRect' && (e.s.fillStyle === '#e8e0c8' || e.s.fillStyle === '#ff8a2a'));
  let switches = 0;
  for (let i = 1; i < shardRects.length; i++) if (shardRects[i].s.fillStyle !== shardRects[i - 1].s.fillStyle) switches++;
  if (switches > 1) fail('shards should batch by colour, colour switches: ' + switches);
  if (shardRects.some((e) => e.s.globalAlpha !== 1)) fail('shards are flat (alpha 1)');
  if (log.some((e) => e.op === 'save' || e.op === 'shadowBlur')) fail('no save/restore or shadowBlur in FX.draw');
}

// ---- drawWhite: one drawImage at the sprite's feet-anchored rect (needs the white atlas).
{
  const { ctx, log } = mockCtx();
  const okDraw = FX.drawWhite(ctx, { frame, scale: 1, flip: false }, 100, 100, 1);
  if (okDraw && log.filter((e) => e.op === 'drawImage').length !== 1) fail('drawWhite: one drawImage');
  if (FX.drawWhite(ctx, { frame, scale: 1 }, NaN, 1, 1) || FX.drawWhite(ctx, null, 1, 1, 1)) fail('drawWhite bad args');
}

if (failed) process.exit(1);
console.log('feel ok: S1-S4 2/4/6/8 px 120-400 ms, no stacking, cap 8, normal mobs never shake, hitstop elite 60 / boss crit 40 max-not-sum + 150 ms gap, knock 6/3/0 px 90 ms, squash 100 ms, pop 60 + shrink 120 white, shards 4-6/10/1-2, 350 ms, cap 120, batched flat');
