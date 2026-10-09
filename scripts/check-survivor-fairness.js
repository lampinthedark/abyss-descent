'use strict';
// Fairness guard for the medieval demo (Game Player 6/10 round):
// 1. Every hit Malgrath lands (cleave, rain, charge, and imp bolts while he lives) was
//    preceded by a warning that was DRAWN at least 0.6 s before the hit.
// 2. His summons never exceed boss.summonCap alive at once; his body deals no damage.
// 3. Cinder falls fire in the scheduled windows (1:20-2:00, 3:10-3:50) even under chip damage.
// 4. Death recap: the last 3 hits with their source names.
// 5. Loot log: one line per item kind, max 3 lines, gone after 3 s.
// 6. Ads off: one free revive (not under the Oath of Ruin); the second death is final.
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
function fail(msg) { console.error('fairness FAILED: ' + msg); process.exit(1); }

// Same headless boot as check-survivor-medieval.js (fake DOM + canvas, seeded Math.random).
const src = fs.readFileSync(path.join(__dirname, 'check-survivor-medieval.js'), 'utf8');
const bootSrc = src.slice(0, src.indexOf('// Medieval demo (?mode=medieval)'));
const mod = { exports: {} };
new Function('module', 'require', '__dirname', bootSrc + '\nmodule.exports = { boot, memoryStorage };')(mod, require, __dirname);
const { boot } = mod.exports;

const MIN_LEAD = 0.6;
function bossRun(seed, walk) {
  const g = boot(seed, '?headless=1&debug=1&walk=' + walk + '&mode=medieval&autopick=1');
  g.__svStart();
  let s = g.__svSnap();
  let bossAt = null;
  let maxSummons = 0;
  let windows = { a: 0, b: 0 };
  let lastBreaks = 0;
  let revived = false;
  for (let i = 0; i < 400 * 60; i++) {
    s = g.__svStep(1 / 60);
    if (s.state === 'hermit') s = g.__svDismiss();
    if (s.quietBreaks > lastBreaks) {
      if (s.time >= 80 && s.time < 120) windows.a += s.quietBreaks - lastBreaks;
      if (s.time >= 190 && s.time < 230) windows.b += s.quietBreaks - lastBreaks;
      lastBreaks = s.quietBreaks;
    }
    // Draw at 30 fps from 4:50 (warnings only count once they are on screen).
    if (s.time > 290 && i % 2 === 0) g.__svDraw();
    if (bossAt == null && s.boss) bossAt = s.time;
    if (bossAt != null) maxSummons = Math.max(maxSummons, s.summons || 0);
    if (s.state === 'dead' && !revived) { revived = true; s = g.__svRevive(); continue; }
    if (s.state === 'dead' || s.state === 'won') break;
  }
  return { seed, walk, state: s.state, hits: g.__svBossHits(), maxSummons, windows };
}

let total = 0;
const cap = boot(1, '?headless=1&mode=medieval').SurvivorData.MEDIEVAL_CFG.boss.summonCap || 4;
const lines = [];
for (const [seed, walk] of [[1, 'circle'], [2, 'circle'], [3, 'kite'], [5, 'circle']]) {
  const r = bossRun(seed, walk);
  for (const h of r.hits) {
    if (h.tellAt == null) fail(walk + ' seed ' + seed + ': ' + h.src + ' hit at ' + h.t.toFixed(2) + 's with no drawn warning');
    if (h.t - h.tellAt < MIN_LEAD) fail(walk + ' seed ' + seed + ': ' + h.src + ' hit ' + (h.t - h.tellAt).toFixed(2) + 's after its warning (< ' + MIN_LEAD + ')');
    if (/contact/i.test(h.src)) fail('Malgrath contact damage: ' + JSON.stringify(h));
  }
  if (r.maxSummons > cap) fail(walk + ' seed ' + seed + ': ' + r.maxSummons + ' summons alive (cap ' + cap + ')');
  if (r.windows.a < 4 || r.windows.b < 4) fail(walk + ' seed ' + seed + ': cinder volleys in the dead stretches ' + JSON.stringify(r.windows));
  total += r.hits.length;
  const by = {};
  r.hits.forEach((h) => { by[h.src] = (by[h.src] || 0) + 1; });
  lines.push(walk[0] + seed + ' ' + r.state[0] + ' hits ' + r.hits.length + ' ' + JSON.stringify(by) + ' summons<=' + r.maxSummons + ' cinder ' + r.windows.a + '/' + r.windows.b);
}
if (total < 3) fail('too few boss hits to audit (' + total + ')');

// Scripted check: stand inside a cleave and next to him (no contact damage, tell drawn first).
{
  const g = boot(9, '?headless=1&debug=1&mode=medieval&t=299');
  g.__svStart();
  let s;
  for (let i = 0; i < 6 * 60; i++) { s = g.__svStep(1 / 60); if (s.state === 'levelup' || s.state === 'hermit') { g.__svDismiss && g.__svDismiss(); } if (s.boss) break; }
  if (!s.boss) fail('scripted: no boss');
  let hits0 = 0;
  for (let i = 0; i < 20 * 60; i++) {
    const b = g.__svSnap();
    if (b.bossX) g.__svPan(b.bossX + 1.2, b.bossY);
    s = g.__svStep(1 / 60);
    if (i % 2 === 0) g.__svDraw();
    if (s.state === 'levelup' && g.__svChoose) g.__svChoose(0);
    if (s.state === 'dead') { g.__svRevive(); }
    if (s.state === 'won') break;
  }
  const hits = g.__svBossHits();
  hits0 = hits.length;
  for (const h of hits) {
    if (h.tellAt == null || h.t - h.tellAt < MIN_LEAD) fail('scripted: ' + JSON.stringify(h));
    if (/contact/i.test(h.src)) fail('scripted: contact damage ' + JSON.stringify(h));
  }
  if (!hits0) fail('scripted: standing on Malgrath for 20 s took no warned hits');
  lines.push('stand-on-him ' + hits0 + ' warned hits');
}

// Death recap, free revive, Oath.
{
  const g = boot(4, '?headless=1&debug=1&walk=kite&mode=medieval&autopick=1');
  g.__svStart();
  for (let i = 0; i < 40 * 60; i++) { const s = g.__svStep(1 / 60); if (s.state === 'hermit') g.__svDismiss(); }
  g.__svHurt(7);
  let s = g.__svSnap();
  for (let k = 0; k < 30 && s.state !== 'dead'; k++) { g.__svHurt(9999); s = g.__svStep(1 / 60); }
  const recap = g.__svRecap();
  if (!recap.length || recap.length > 3 || !recap.every((l) => /^[A-Za-z].* \d+$/.test(l))) fail('recap ' + JSON.stringify(recap));
  if (s.state !== 'dead' || !s.pendingEnd || !s.reviveOpen) fail('free revive not offered: ' + JSON.stringify({ st: s.state, p: s.pendingEnd, r: s.reviveOpen }));
  s = g.__svRevive();
  if (s.state !== 'playing') fail('free revive did not resume');
  for (let k = 0; k < 30 && s.state !== 'dead'; k++) { g.__svHurt(9999); s = g.__svStep(1 / 60); }
  if (s.pendingEnd || s.reviveOpen) fail('second death offered another revive');
  const o = boot(4, '?headless=1&debug=1&walk=kite&mode=medieval&autopick=1');
  o.__svOath(true);
  o.__svStart();
  o.__svStep(1 / 60);
  let os = o.__svSnap();
  for (let k = 0; k < 30 && os.state !== 'dead'; k++) { o.__svHurt(9999); os = o.__svStep(1 / 60); }
  if (os.pendingEnd || os.reviveOpen) fail('Oath of Ruin got a free revive');
  lines.push('recap ' + recap.join(' / ') + '; free revive once; none under the Oath');
}

// Loot log.
{
  const g = boot(6, '?headless=1&debug=1&mode=medieval');
  g.__svStart();
  g.__svStep(1 / 60);
  let l = g.__svFind('Iron Blade', 'rare');
  l = g.__svFind('Iron Blade', 'rare');
  l = g.__svFind('Iron Blade', 'rare');
  if (l.length !== 1 || !/Iron Blade \u00d73$/.test(l[0])) fail('same item kind should share one line: ' + JSON.stringify(l));
  ['Bone Charm', 'Ember Ring', 'Grave Mail'].forEach((n) => { l = g.__svFind(n, 'epic'); });
  if (l.length !== 3) fail('log should cap at 3 lines: ' + JSON.stringify(l));
  for (let i = 0; i < 3.1 * 60; i++) g.__svStep(1 / 60);
  l = g.__svChatLines();
  if (l.length) fail('log lines should clear after 3 s: ' + JSON.stringify(l));
  lines.push('loot log 1 line per kind, max 3, clears at 3 s');
}
console.log('fairness ok: ' + lines.join('; '));
