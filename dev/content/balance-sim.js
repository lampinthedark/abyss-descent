#!/usr/bin/env node
/**
 * Balance report for week-1 content against GD's combat formula (combat-model.js)
 * and real RPGItems gear (loadouts.js). Prints markdown:
 *   1. monster x gear-tier table (hits, TTK, pack clear, HP lost, death rates)
 *   2. dungeon first-clear estimate
 *   3. combat XP -> expected levels after Q1 / Q2 / first Ash Stair clear,
 *      and whether Attack 40 (Wyrmfang) is reachable in week-1 play time.
 *
 *   node dev/content/balance-sim.js [--n 300] [--json]
 * Seeded: same output every run.
 */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '../../js/rpg/content/index.js'));
const M = require('./combat-model.js');
const { LOADOUTS, byId } = require('./loadouts.js');

const STEW = { heal: 12, count: 6 };            // ASSUMED food bag for boss/brute death rates: 6 Traveller's Stew
const args = process.argv.slice(2);
const N = Number(args[args.indexOf('--n') + 1]) || 300;

function player(l, over) {
  return Object.assign({ attack: l.attack, strength: l.strength, hitpoints: l.hitpoints, gear: l.gear }, over || {});
}
function packSizes(d) { const out = []; for (let k = d.pack[0]; k <= d.pack[1]; k++) out.push(k); return out; }
function avgOver(sizes, f) { return sizes.reduce((s, k) => s + f(k), 0) / sizes.length; }

/** One table row: monster vs loadout. */
function row(monId, loadId, n) {
  n = n || N;
  const d = C.MONSTERS[monId], l = byId(loadId), p = player(l);
  const solo = M.simulate(p, [d], { policy: 'never' }, n, 11);
  const sizes = packSizes(d);
  const pk = {};
  for (const pol of ['never', 'good']) {
    const runs = sizes.map(k => M.simulate(p, Array(k).fill(d), { policy: pol }, n, 20 + k));
    const fed = sizes.map(k => M.simulate(p, Array(k).fill(d), { policy: pol, food: STEW }, n, 40 + k));
    pk[pol] = {
      ttk: runs.reduce((s, r) => s + (r.ttkWon || r.ttk), 0) / runs.length,
      pctHp: runs.reduce((s, r) => s + r.pctHp, 0) / runs.length,
      dieNoFood: runs.reduce((s, r) => s + r.pDeath, 0) / runs.length,
      dieFood: fed.reduce((s, r) => s + r.pDeath, 0) / fed.length,
      ttkFed: fed.reduce((s, r) => s + (r.ttkWon || r.ttk), 0) / fed.length,
      eaten: fed.reduce((s, r) => s + r.eaten, 0) / fed.length,
      dmgTaken: runs.reduce((s, r) => s + r.dmgTaken, 0) / runs.length,
    };
  }
  return {
    monster: monId, loadout: loadId, hit: M.hitChance(l.attack, l.gear.aim, d.def), max: M.maxHit(l.strength, l.gear.power),
    hpPlayer: M.playerHp(l.hitpoints, l.gear.maxHp), armour: l.gear.armour,
    hits: solo.landedFirst, hitsP10: solo.landedP10, hitsP90: solo.landedP90, ttkSolo: solo.ttkWon || solo.ttk,
    pack: d.pack, packTtk: pk.good.ttkFed, never: pk.never, good: pk.good,
  };
}

function table(n) {
  const rows = [];
  for (const id of C.MONSTER_IDS) for (const l of LOADOUTS) rows.push(row(id, l.id, n));
  return rows;
}

function fmtRow(r) {
  const pct = v => (v >= 100 ? '**' + v.toFixed(0) + '%**' : v.toFixed(0) + '%');
  const die = v => (v * 100).toFixed(0) + '%';
  return '| ' + [r.monster, r.loadout, (r.hit * 100).toFixed(0) + '%', r.max,
    r.hits.toFixed(1) + ' (' + r.hitsP10 + '-' + r.hitsP90 + ')', r.ttkSolo.toFixed(1),
    r.pack.join('-'), r.good.dieFood > 0.5 ? 'dies (' + r.packTtk.toFixed(0) + ')' : r.packTtk.toFixed(1),
    pct(r.never.pctHp), die(r.never.dieNoFood) + ' / ' + die(r.never.dieFood),
    pct(r.good.pctHp), die(r.good.dieNoFood) + ' / ' + die(r.good.dieFood)].join(' | ') + ' |';
}
const HEADER = '| monster | gear | hit | max | hits to kill (p10-p90) | solo TTK s | pack | pack clear s | HP lost, never dodge | death never (no food / 6 stews) | HP lost, dodging | death dodging (no food / 6 stews) |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|';

/**
 * Dungeon first-clear estimate at a loadout. Overheads are ASSUMED and listed.
 */
const OVERHEAD = {
  approachS: 5,          // spot, walk up, pull a pack
  impChaseS: 3,          // per imp: they hold range 5, you close the gap
  lootPerMobS: 1.5,      // tap drops, glance at beams
  eatS: 0.6,             // per food (one swing)
  recoverS: 8,           // per pack: reposition, read the next room, re-engage cooldowns
  exploreFactor: 1.5,    // first clear walks 1.5x the shortest path (backtracking, looking around)
  deathPenaltyS: 75,     // die -> respawn in town, walk back to the stair and down
};
function dungeonEstimate(loadId, n, policy) {
  policy = policy || 'good';
  n = n || 200;
  const D = C.Dungeon, l = byId(loadId), p = player(l);
  let fightS = 0, overS = 0, food = 0, dmg = 0, deathsExp = 0, xpDmg = 0;
  const parts = [];
  for (const s of D.spawns) {
    const d = C.MONSTERS[s.monsterId];
    const sizes = packSizes(d);
    const runs = sizes.map(k => M.simulate(p, Array(k).fill(d), { policy: policy, food: STEW }, n, 77 + k));
    const ttk = runs.reduce((a, r) => a + (r.ttkWon || r.ttk), 0) / runs.length;
    const taken = runs.reduce((a, r) => a + r.dmgTaken, 0) / runs.length;
    const pDie = runs.reduce((a, r) => a + r.pDeath, 0) / runs.length;
    const mobs = (d.pack[0] + d.pack[1]) / 2;
    const eats = taken / STEW.heal;
    const over = OVERHEAD.approachS + OVERHEAD.recoverS + mobs * OVERHEAD.lootPerMobS +
      (s.monsterId === 'imp' ? mobs * OVERHEAD.impChaseS : 0) + eats * OVERHEAD.eatS;
    // retries: expected extra attempts = p/(1-p), each costs the death penalty + a partial fight
    const retries = pDie / Math.max(0.05, 1 - pDie);
    fightS += ttk * (1 + retries); overS += over + retries * OVERHEAD.deathPenaltyS;
    food += eats; dmg += taken; deathsExp += retries; xpDmg += mobs * d.hp;
    parts.push({ spawn: s.monsterId + '@' + s.room, mobs, ttk, taken, pDie });
  }
  const walk = D.walkSeconds(D.entry, D.exits[1]) * OVERHEAD.exploreFactor;
  const total = fightS + overS + walk;
  return { loadout: loadId, policy, fightS, overS, walkS: walk, totalS: total, foodStews: food, dmgTaken: dmg, expDeaths: deathsExp, xpDamage: xpDmg, parts };
}

/** Combat XP model (GD: 4 per damage to the stat behind the hit, 1.33 per damage to Hitpoints). */
function xpModel(clearDamage) {
  const q2Dmg = 5 * C.MONSTERS.goblin.hp + 2.5 * C.MONSTERS.rat.hp;   // 4 goblins = 2 packs (~5) + one rat pack on the way
  const stages = [
    { id: 'after_Q1', dmg: 0 },
    { id: 'after_Q2', dmg: q2Dmg },
    { id: 'after_first_clear', dmg: q2Dmg + clearDamage },
  ];
  const hp0 = M.XP_TABLE[10];
  const out = stages.map(s => {
    const stat = 4 * s.dmg, hpXp = 1.33 * s.dmg;
    return {
      stage: s.id, damage: Math.round(s.dmg), statXp: Math.round(stat),
      even: M.levelFor(stat / 3), allAttack: M.levelFor(stat), hitpoints: M.levelFor(hp0 + hpXp),
    };
  });
  const perClearStat = 4 * clearDamage;
  const need = M.XP_TABLE[40];
  return { stages: out, perClearStatXp: perClearStat, attack40Xp: need,
    clearsEven: need / (perClearStat / 3), clearsAllAttack: need / perClearStat };
}

function main() {
  const json = args.includes('--json');
  const rows = table(N);
  const dEst = [['cinderiron', 'good'], ['cinderiron', 'telegraphs'], ['verdite', 'good'], ['verdite', 'telegraphs']].map(a => dungeonEstimate(a[0], 200, a[1]));
  const xp = xpModel(dEst[0].xpDamage);
  const minsPerClear = dEst[0].totalS / 60;
  const wyrmfangMedianKills = Math.log(2) / -Math.log(1 - 1 / 150);
  if (json) { console.log(JSON.stringify({ rows, dungeon: dEst, xp }, null, 1)); return; }
  const out = [];
  out.push('## Monster balance (GD formula, ' + N + ' seeded fights per cell; Ground Slam cut, skills = Cleave + Sigil Bolt + dodge)\n');
  out.push(HEADER);
  rows.forEach(r => out.push(fmtRow(r)));
  out.push('\npack clear = a dodging player with 6 stews; "dies (t)" = usually dead after t s. ' +
    'Levels per gear tier are ASSUMED (loadouts.js): starter A1/S1/H10, rustbound A3/S3/H10, cinderiron A8/S8/H12, verdite A15/S15/H16, tidesteel A25/H25, sunforged A35/H35.');
  out.push('hits to kill = landed hits on a single target; pack values are averaged over every pack size; "dodging" = rolls every slam/charge, half the plain hits when no telegraph is up, walks out of >=0.8 s telegraphs when the roll is on cooldown, side-steps half the projectiles.\n');
  out.push('## Ash Stair first clear (estimate)\n');
  out.push('| gear | player | fights s | overhead s | walk s | total | stews eaten | expected deaths |');
  out.push('|---|---|---|---|---|---|---|---|');
  dEst.forEach(e => out.push('| ' + [e.loadout, e.policy === 'good' ? 'good dodger' : 'rolls telegraphs only', e.fightS.toFixed(0), e.overS.toFixed(0), e.walkS.toFixed(0), (e.totalS / 60).toFixed(1) + ' min', e.foodStews.toFixed(1), e.expDeaths.toFixed(2)].join(' | ') + ' |'));
  out.push('\nOverheads: ' + JSON.stringify(OVERHEAD));
  out.push('Shortest walk entry -> boss: ' + C.Dungeon.walkSeconds(C.Dungeon.entry, { x: 11, y: 67 }).toFixed(1) + ' s (GD metric, 80 px/s).\n');
  out.push('## Combat levels from GD\'s XP rate\n');
  out.push('| stage | damage dealt | combat XP | A/S/D if split evenly | Attack if all on Attack | Hitpoints |');
  out.push('|---|---|---|---|---|---|');
  xp.stages.forEach(s => out.push('| ' + [s.stage, s.damage, s.statXp, s.even, s.allAttack, s.hitpoints].join(' | ') + ' |'));
  out.push('\nAttack 40 = ' + xp.attack40Xp + ' XP. One Ash Stair clear pays ' + xp.perClearStatXp + ' combat XP: ' +
    xp.clearsEven.toFixed(1) + ' clears split evenly (~' + (xp.clearsEven * minsPerClear / 60).toFixed(1) + ' h at first-clear pace), ' +
    xp.clearsAllAttack.toFixed(1) + ' clears all on Attack (~' + (xp.clearsAllAttack * minsPerClear / 60).toFixed(1) + ' h).');
  out.push('Wyrmfang at 1/150: median ' + wyrmfangMedianKills.toFixed(0) + ' Ashmaw kills (~' + (wyrmfangMedianKills * minsPerClear / 60).toFixed(0) + ' h of full clears).');
  console.log(out.join('\n'));
}

if (require.main === module) main();
module.exports = { row, table, dungeonEstimate, xpModel, STEW, OVERHEAD, packSizes };
