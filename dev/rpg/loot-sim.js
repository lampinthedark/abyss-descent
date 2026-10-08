#!/usr/bin/env node
/**
 * Drop-rate simulation for the week-1 slice. Uses the SAME pure roller and
 * pity rules as the game (RPGItems.Loot.rollDrop + nextFirstRare + PITY_KILLS).
 *
 *   node dev/rpg/loot-sim.js [--players 4000] [--town-kpm 4] [--dungeon-kpm 5]
 *                            [--town-min 15] [--run-min 20] [--seed 1] [--json]
 *
 * Route model (assumptions, tune with flags):
 *   - minutes 0..town-min: near-town rat/goblin packs (50/50) at town-kpm
 *   - then dungeon runs of run-min minutes: skeletons/imps (50/50) at dungeon-kpm,
 *     one Grave Brute elite every 5 min, Ashmaw (boss) at the end of each run.
 * "Rare" means Rare-or-better (any beamed gear drop).
 */
'use strict';
const R = require('../../js/rpg/items/index.js');
const { Loot, Core } = R;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}
const OPT = {
  players: arg('players', 4000), townKpm: arg('town-kpm', 4), dungeonKpm: arg('dungeon-kpm', 5), q2: !process.argv.includes('--no-q2'),
  townMin: arg('town-min', 15), runMin: arg('run-min', 20), seed: arg('seed', 1), horizonMin: arg('horizon-min', 240),
};

function rank(r) { return Loot.rarityRank(r); }
function pct(arr, p) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}
function share(arr, limit) { return arr.filter((x) => x != null && x <= limit).length / arr.length; }
function fmt(m) { return m == null ? '  n/a' : (m < 60 ? m.toFixed(1) + ' min' : (m / 60).toFixed(1) + ' h'); }

/** Kill schedule generator: yields { t (minutes), monster }. */
function* schedule(o, rng) {
  let t = 0;
  const townGap = 1 / o.townKpm, dunGap = 1 / o.dungeonKpm;
  while (t < o.townMin) { t += townGap; yield { t, monster: rng.next() < 0.5 ? 'rat' : 'goblin' }; }
  for (;;) {
    const start = t;
    let nextElite = start + 5;
    while (t < start + o.runMin) {
      t += dunGap;
      if (t >= nextElite) { nextElite += 5; yield { t, monster: 'brute', run: start }; }
      else yield { t, monster: rng.next() < 0.5 ? 'skeleton' : 'imp', run: start };
    }
    yield { t, monster: 'ashmaw', run: start, boss: true };
  }
}

const Q2_GOBLINS = 4;   // Q2 "Defeat goblins (n/4)"

/** One player. pity=false disables BOTH the first-Rare and drought pity. */
function player(o, seed, pity, townOnly) {
  const rng = Core.makeRng(seed);
  const st = { pity: 0, firstRare: { done: false, kills: 0, all: 0 } };
  const out = { rare: null, veryRare: null, legendary: null, firstRareForced: false };
  let firstRun = { rare: false, veryRare: false };
  const sched = townOnly ? (function* () { let t = 0; for (;;) { t += 1 / o.townKpm; yield { t, monster: rng.next() < 0.5 ? 'rat' : 'goblin' }; } })() : schedule(o, rng);
  let goblins = 0;
  for (const k of sched) {
    if (k.t > o.horizonMin) break;
    // Q2 safety: the player's 4th field goblin completes Q2's objective (drops.js passes questFinish)
    const q2Kill = k.monster === 'goblin' && k.run == null && ++goblins === Q2_GOBLINS && o.q2;
    const d = Loot.rollDrop(k.monster, rng, pity ? { pity: st.pity, firstRare: st.firstRare, questFinish: q2Kill } : {});
    const best = rank(d.best);
    st.pity = best >= 1 ? 0 : st.pity + 1;
    st.firstRare = Loot.nextFirstRare(st.firstRare, k.monster, d.best);
    if (best >= 1 && out.rare == null) { out.rare = k.t; out.firstRareForced = !!d.firstRareUsed; }
    if (best >= 2 && out.veryRare == null) out.veryRare = k.t;
    if (best >= 3 && out.legendary == null) out.legendary = k.t;
    if (k.run != null && k.run === o.townMin) {
      if (best >= 1 && !k.boss) firstRun.rare = true;
      if (best >= 2) firstRun.veryRare = true;
    }
    if (out.rare != null && out.veryRare != null && out.legendary != null) break;
  }
  out.firstRun = firstRun;
  return out;
}

/** Wyrmfang: boss kills until the drop (boss-only, independent per kill). */
function wyrmfangKills(n, seed) {
  const rng = Core.makeRng(seed);
  const res = [];
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (;;) {
      k++;
      const d = Loot.rollDrop('ashmaw', rng, {});
      if (d.items.some((it) => it.base === 'wyrmfang')) break;
      if (k > 5000) break;
    }
    res.push(k);
  }
  return res;
}

function run(o) {
  const result = { options: o, scenarios: {} };
  for (const [name, pity, townOnly] of [['route_pity', true, false], ['route_no_pity', false, false],
    ['town_only_pity', true, true], ['town_only_no_pity', false, true]]) {
    const ps = [];
    for (let i = 0; i < o.players; i++) ps.push(player(o, Core.mixSeed(o.seed, name.replace('_no_pity', '').replace('_pity', ''), i), pity, townOnly));
    const rare = ps.map((p) => p.rare), vr = ps.map((p) => p.veryRare), leg = ps.map((p) => p.legendary);
    result.scenarios[name] = {
      rare: { median: pct(rare, 0.5), p90: pct(rare, 0.9), p99: pct(rare, 0.99), max: pct(rare, 1), within20: share(rare, 20),
        forcedShare: ps.filter((p) => p.firstRareForced).length / ps.length },
      veryRare: { median: pct(vr, 0.5), p90: pct(vr, 0.9), within20: share(vr, 20), within60: share(vr, 60) },
      legendary: { median: pct(leg, 0.5), within240: share(leg, 240) },
      firstDungeonRun: townOnly ? null : {
        rareBeforeBoss: ps.filter((p) => p.firstRun.rare).length / ps.length,
        veryRareInRun: ps.filter((p) => p.firstRun.veryRare).length / ps.length,
      },
    };
  }
  const wk = wyrmfangKills(Math.min(o.players, 4000), Core.mixSeed(o.seed, 'wyrmfang'));
  const runsPerHour = 60 / o.runMin;
  result.wyrmfang = { rate: '1/150 per Ashmaw kill', medianKills: pct(wk, 0.5), p90Kills: pct(wk, 0.9),
    medianHours: pct(wk, 0.5) / runsPerHour, p90Hours: pct(wk, 0.9) / runsPerHour, runsPerHour };
  return result;
}

function print(r) {
  const o = r.options;
  console.log(`Week-1 loot sim: ${o.players} players/scenario, town ${o.townKpm} kills/min for ${o.townMin} min, ` +
    `dungeon ${o.dungeonKpm} kills/min, ${o.runMin}-min runs ending at the boss, seed ${o.seed}`);
  console.log(`First-Rare pity: near-town kills ${Loot.FIRST_RARE.RAMP_START}+ ramp to ${Loot.FIRST_RARE.RAMP_MAX * 100}% at kill ${Loot.FIRST_RARE.GUARANTEE - 1}, guaranteed at near-town kill ${Loot.FIRST_RARE.GUARANTEE}${o.q2 ? ', Q2 safety on the 4th field goblin' : ' (Q2 safety off)'} (any-kill backup ${Loot.FIRST_RARE.BACKUP_GUARANTEE}); drought pity every ${Loot.PITY_KILLS} kills\n`);
  console.log('scenario            first Rare: median   p90      max     <=20min | Very Rare: median  p90     <=60min | Legendary <=4h');
  for (const [k, s] of Object.entries(r.scenarios)) {
    console.log(`${k.padEnd(20)}            ${fmt(s.rare.median).padStart(8)} ${fmt(s.rare.p90).padStart(8)} ${fmt(s.rare.max).padStart(8)}  ${(s.rare.within20 * 100).toFixed(1).padStart(6)}% |` +
      `   ${fmt(s.veryRare.median).padStart(8)} ${fmt(s.veryRare.p90).padStart(8)} ${(s.veryRare.within60 * 100).toFixed(1).padStart(6)}% | ${(s.legendary.within240 * 100).toFixed(1)}%`);
  }
  const fr = r.scenarios.route_pity.firstDungeonRun;
  console.log(`\nFirst 20-min dungeon run (with pity): Rare+ before the boss ${(fr.rareBeforeBoss * 100).toFixed(1)}%, ` +
    `Very Rare+ anywhere in the run ${(fr.veryRareInRun * 100).toFixed(1)}%, boss Rare+ 100% (guaranteed entry).`);
  console.log(`Share of players whose first Rare came from the first-Rare pity: ${(r.scenarios.town_only_pity.rare.forcedShare * 100).toFixed(1)}% (town only).`);
  const w = r.wyrmfang;
  console.log(`Wyrmfang (${w.rate}): median ${w.medianKills} boss kills = ${w.medianHours.toFixed(1)} h of ${o.runMin}-min runs; p90 ${w.p90Kills} kills = ${w.p90Hours.toFixed(1)} h.`);
}

if (require.main === module) {
  const r = run(OPT);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2)); else print(r);
}
module.exports = { run, OPT };
