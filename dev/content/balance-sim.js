#!/usr/bin/env node
/**
 * Balance report for week-1 content against GD's combat formula (combat-model.js)
 * and real RPGItems gear (loadouts.js). Prints markdown:
 *   1. monster x gear-tier table (hits, TTK, pack clear, HP lost, death rates)
 *   2. dungeon first-clear estimate (sequential Monte-Carlo run: HP, regen and
 *      the food bag carry from pack to pack)
 *   3. combat XP (1/damage to the style stat, 0.33 to Hitpoints) -> levels after
 *      Q1 / Q2 / the Cinderiron field grind / first Ash Stair clear, and hours to Attack 40 (Wyrmfang).
 *   4. mob danger: each monster's hit chance against each loadout.
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
  return Object.assign({ attack: l.attack, strength: l.strength, defence: l.defence, hitpoints: l.hitpoints, gear: l.gear }, over || {});
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
      netPctHp: runs.reduce((s, r) => s + r.netPctHp, 0) / runs.length,
    };
  }
  return {
    monster: monId, loadout: loadId, hit: M.hitChance(l.attack, l.gear.aim, d.def), max: M.maxHit(l.strength, l.gear.power),
    mobHit: M.mobHitChance(d.atk, l.defence, l.gear.def),
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
  return '| ' + [r.monster, r.loadout, (r.hit * 100).toFixed(0) + '%', r.max, (r.mobHit * 100).toFixed(0) + '%',
    r.hits.toFixed(1) + ' (' + r.hitsP10 + '-' + r.hitsP90 + ')', r.ttkSolo.toFixed(1),
    r.pack.join('-'), r.good.dieFood > 0.5 ? 'dies (' + r.packTtk.toFixed(0) + ')' : r.packTtk.toFixed(1),
    pct(r.never.pctHp), die(r.never.dieNoFood) + ' / ' + die(r.never.dieFood),
    pct(r.good.pctHp), die(r.good.dieNoFood) + ' / ' + die(r.good.dieFood)].join(' | ') + ' |';
}
const HEADER = '| monster | gear | hit | max | mob hit | hits to kill (p10-p90) | solo TTK s | pack | pack clear s | HP lost, never dodge | death never (no food / 6 stews) | HP lost, dodging | death dodging (no food / 6 stews) |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|';

/**
 * Dungeon first-clear estimate at a loadout. Overheads are ASSUMED and listed.
 * Sequential Monte-Carlo: each run walks the spawns in order with one HP pool
 * and one food bag; pack sizes are rolled; out-of-combat regen (2 HP/s after
 * 4 s unhit) runs during the overhead between packs, and the player rests
 * (waits on regen) up to REST before pulling. Food is only eaten mid-fight
 * (below 35% HP). A death costs deathPenaltyS, refills HP and re-fights the pack.
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
const REST = { trashPct: 70, bigPct: 100 };   // ASSUMED: wait on regen to 70% before trash, to full before brute / Ashmaw
const CLEAR_FOOD = { heal: STEW.heal, count: 10 };   // ASSUMED bag for a clear: 10 stews (count what gets eaten)

function dungeonEstimate(loadId, n, policy, o) {
  policy = policy || 'good';
  n = n || 200;
  o = o || {};
  const D = C.Dungeon, l = byId(loadId), p = player(l);
  const maxHp = M.playerHp(l.hitpoints, l.gear.maxHp);
  const rnd = M.rng32(o.seed || 77);
  const explore = o.repeat ? 1.0 : OVERHEAD.exploreFactor;
  let fightS = 0, overS = 0, restS = 0, food = 0, dmg = 0, regen = 0, deaths = 0, xpDmg = 0, maxFood = 0;
  const ate = [];
  const per = {};
  for (let run = 0; run < n; run++) {
    let hp = maxHp, since = 99, bag = CLEAR_FOOD.count, ateRun = 0;
    for (const s of D.spawns) {
      const d = C.MONSTERS[s.monsterId];
      const k = d.pack[0] + Math.floor(rnd() * (d.pack[1] - d.pack[0] + 1));
      const over = OVERHEAD.approachS + OVERHEAD.recoverS + k * OVERHEAD.lootPerMobS + (s.monsterId === 'imp' ? k * OVERHEAD.impChaseS : 0);
      // regen while walking up / looting / reading the room
      const h1 = M.regenAfter(hp, maxHp, since, over); regen += h1 - hp; hp = h1; since += over;
      // rest on regen before the pull
      const want = maxHp * ((d.elite || d.boss) ? REST.bigPct : REST.trashPct) / 100;
      if (hp < want) {
        const wait = Math.max(0, M.REGEN.delayS - since) + (want - hp) / M.REGEN.hpPerS;
        restS += wait; regen += want - hp; hp = want; since += wait;
      }
      let tries = 0;
      for (;;) {
        const r = M.fight(p, Array(k).fill(d), { policy, food: { heal: CLEAR_FOOD.heal, count: bag }, startHp: hp, sinceHit: since, rng: rnd });
        fightS += r.t; dmg += r.dmgTaken; regen += r.regenHp; food += r.eaten; ateRun += r.eaten; bag -= r.eaten;
        overS += r.eaten * OVERHEAD.eatS;
        const key = s.monsterId;
        per[key] = per[key] || { fights: 0, t: 0, taken: 0, eaten: 0, deaths: 0 };
        per[key].fights++; per[key].t += r.t; per[key].taken += r.dmgTaken; per[key].eaten += r.eaten;
        if (!r.dead || ++tries > 4) { hp = Math.max(1, r.hpLeft); since = r.sinceHit; break; }
        deaths++; per[key].deaths++; overS += OVERHEAD.deathPenaltyS; hp = maxHp; since = 99;
      }
      overS += over; xpDmg += k * d.hp;
    }
    maxFood = Math.max(maxFood, ateRun); ate.push(ateRun);
  }
  const walk = D.walkSeconds(D.entry, D.exits[1]) * explore;
  const f = v => v / n;
  const total = f(fightS + overS + restS) + walk;
  const parts = Object.keys(per).map(k => ({ id: k, fightS: f(per[k].t), taken: f(per[k].taken), eaten: f(per[k].eaten), deaths: f(per[k].deaths) }));
  return { loadout: loadId, policy, repeat: !!o.repeat, fightS: f(fightS), overS: f(overS), restS: f(restS), walkS: walk, totalS: total,
    foodStews: f(food), foodMax: maxFood, foodP90: ate.sort((a, b) => a - b)[Math.min(n - 1, Math.floor(0.9 * n))], dmgTaken: f(dmg), regenHp: f(regen), expDeaths: f(deaths), xpDamage: f(xpDmg), maxHp, parts };
}

/**
 * Combat XP model (approved: 1 per damage to the style stat, 0.33 per damage to Hitpoints).
 * Stages from a fresh save. Wearing Cinderiron needs Attack 5 (sword) and Defence 5 (armour),
 * so after Q2 the player grinds the field until both reach 5 under their style split.
 * Styles (share of style XP per stat):
 *   typical - Attack-led rotation: 1/2 Attack, 1/4 Strength, 1/4 Defence (Defence now cuts mob hit chance and gates armour)
 *   even    - Attack / Strength / Defence rotated evenly
 *   attack  - everything on Attack once Defence 5 is reached for the armour (fastest bound)
 */
const STYLES = {
  typical: { a: 1 / 2, s: 1 / 4, d: 1 / 4, label: 'Attack-led rotation (1/2 A, 1/4 S, 1/4 D)' },
  even: { a: 1 / 3, s: 1 / 3, d: 1 / 3, label: 'A/S/D rotated evenly' },
  attack: { a: 1, s: 0, d: 0, defenceFirst: true, label: 'all on Attack (after Defence 5)' },
};
const GEAR_LEVEL = 5;   // Cinderiron tier level in items-db (sword: Attack, armour: Defence)
function q2Damage() { return 5 * C.MONSTERS.goblin.hp + 2.5 * C.MONSTERS.rat.hp; }   // 4 goblins = 2 packs (~5) + one rat pack on the way
function styleXp(st, dmg) {
  const x = M.XP_RATE.style * dmg;
  if (st.defenceFirst) { const d = Math.min(x, M.XP_TABLE[GEAR_LEVEL]); return { a: x - d, s: 0, d }; }
  return { a: x * st.a, s: x * st.s, d: x * st.d };
}
function grindDamage(st) {
  const need = M.XP_TABLE[GEAR_LEVEL] / M.XP_RATE.style;
  const total = st.defenceFirst ? 2 * need : Math.max(need / st.a, need / st.d);
  return Math.max(0, total - q2Damage());
}
function xpModel(clearDamage, paces) {
  const q2Dmg = q2Damage();
  const hp0 = M.XP_TABLE[10];
  const need = M.XP_TABLE[40];
  const styles = {};
  for (const k in STYLES) {
    const st = STYLES[k], grind = grindDamage(st);
    const stages = [
      { stage: 'after_Q1', dmg: 0 },
      { stage: 'after_Q2', dmg: q2Dmg },
      { stage: 'cinderiron_ready', dmg: q2Dmg + grind },
      { stage: 'after_first_clear', dmg: q2Dmg + grind + clearDamage },
    ].map(s => {
      const x = styleXp(st, s.dmg);
      return { stage: s.stage, damage: Math.round(s.dmg), attack: M.levelFor(x.a), strength: M.levelFor(x.s), defence: M.levelFor(x.d),
        hitpoints: M.levelFor(hp0 + M.XP_RATE.hitpoints * s.dmg) };
    });
    // clears after the first one until Attack XP reaches Attack 40
    const startA = styleXp(st, q2Dmg + grind + clearDamage).a;
    const perClearA = st.defenceFirst ? M.XP_RATE.style * clearDamage : M.XP_RATE.style * clearDamage * st.a;
    const clears = Math.max(0, (need - startA) / perClearA);
    const hours = {};
    for (const pk in paces) hours[pk] = clears * paces[pk] / 3600;
    styles[k] = { label: st.label, grindDamage: grind, stages, toA40: { clears, hours } };
  }
  return { styles, q2Damage: q2Dmg, perClearStatXp: M.XP_RATE.style * clearDamage, attack40Xp: need };
}

/** Field time to grind `dmg` damage on goblin packs at a loadout (fight + seek + loot, regen between packs). */
function fieldGrindMinutes(dmg, loadId) {
  const d = C.MONSTERS.goblin, l = byId(loadId), p = player(l);
  const r = M.simulate(p, [d, d, d].slice(0, Math.round((d.pack[0] + d.pack[1]) / 2)), { policy: 'telegraphs' }, 200, 9);
  const mobs = (d.pack[0] + d.pack[1]) / 2;
  const perPack = (r.ttkWon || r.ttk) + 10 + mobs * OVERHEAD.lootPerMobS;   // seek 10 s (quest-times SPEEDS.seekPackS)
  return dmg / (mobs * d.hp) * perPack / 60;
}

/** Mob danger: each monster's hit chance vs each loadout (Defence level + gear.def). */
function dangerTable() {
  return C.MONSTER_IDS.map(id => {
    const d = C.MONSTERS[id];
    const row = { id, hp: d.hp, def: d.def, atk: d.atk, dmg: d.attacks.map(a => a.kind + ' ' + a.dmg).join(', '), vs: {} };
    for (const l of LOADOUTS) row.vs[l.id] = M.mobHitChance(d.atk, l.defence, l.gear.def);
    return row;
  });
}

function main() {
  const json = args.includes('--json');
  const rows = table(N);
  const dEst = [['cinderiron', 'good'], ['cinderiron', 'telegraphs'], ['verdite', 'good'], ['verdite', 'telegraphs']].map(a => dungeonEstimate(a[0], 150, a[1]));
  const repeat = dungeonEstimate('verdite', 150, 'good', { repeat: true });
  const xp = xpModel(dEst[0].xpDamage, { firstClearCinderiron: dEst[0].totalS, repeatVerdite: repeat.totalS });
  const danger = dangerTable();
  const wyrmfangMedianKills = Math.log(2) / -Math.log(1 - 1 / 150);
  if (json) { console.log(JSON.stringify({ rows, dungeon: dEst, repeat, xp, danger }, null, 1)); return; }
  const out = [];
  const pc = v => (v * 100).toFixed(0) + '%';
  out.push('## Mob danger (approved mirrored formula: clamp(0.75 + 0.015*(atk - Defence - gear.def), 0.40, 0.97))\n');
  out.push('| id | hp | def | atk | dmg | ' + LOADOUTS.map(l => l.id + ' (D' + l.defence + ')').join(' | ') + ' |');
  out.push('|---|---|---|---|---|' + LOADOUTS.map(() => '---').join('|') + '|');
  danger.forEach(r => out.push('| ' + [r.id, r.hp, r.def, r.atk, r.dmg].concat(LOADOUTS.map(l => pc(r.vs[l.id]))).join(' | ') + ' |'));
  out.push('\ngear.def is 0 for every RPGItems item today (items have no `def` stat; armour reduces damage instead).\n');
  out.push('## Monster balance (GD formula + approved changes, ' + N + ' seeded fights per cell; Ground Slam cut, skills = Cleave + Sigil Bolt + dodge)\n');
  out.push(HEADER);
  rows.forEach(r => out.push(fmtRow(r)));
  out.push('\nhit = player hit chance; mob hit = monster hit chance vs that loadout; pack clear = a dodging player with 6 stews; "dies (t)" = usually dead after t s. ' +
    'HP lost = damage taken / max HP (gross, before regen). Levels per gear tier are ASSUMED (loadouts.js): starter A/S/D1 H10, rustbound A/S/D3 H10, cinderiron A/S/D8 H12, verdite A/S/D15 H16, tidesteel 25, sunforged 35.');
  out.push('hits to kill = landed hits on a single target; pack values are averaged over every pack size; "dodging" = rolls every slam/charge, half the plain hits when no telegraph is up, walks out of >=0.8 s telegraphs when the roll is on cooldown, side-steps half the projectiles.\n');
  out.push('## Ash Stair clear (estimate, ' + 150 + ' sequential runs each)\n');
  out.push('| gear | player | fights s | overhead s | rest s | walk s | total | stews eaten (mean / p90 / worst run) | HP regenerated | expected deaths |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  dEst.concat([repeat]).forEach(e => out.push('| ' + [e.loadout + (e.repeat ? ' (repeat clear)' : ''), e.policy === 'good' ? 'good dodger' : 'rolls telegraphs only', e.fightS.toFixed(0), e.overS.toFixed(0), e.restS.toFixed(0), e.walkS.toFixed(0), (e.totalS / 60).toFixed(1) + ' min', e.foodStews.toFixed(1) + ' / ' + e.foodP90 + ' / ' + e.foodMax, e.regenHp.toFixed(0), e.expDeaths.toFixed(2)].join(' | ') + ' |'));
  out.push('\nPer spawn type (Cinderiron, good dodger): ' + dEst[0].parts.map(q => q.id + ' ' + q.fightS.toFixed(0) + ' s / ' + q.eaten.toFixed(2) + ' stews').join('; ') + '.');
  out.push('Overheads: ' + JSON.stringify(OVERHEAD) + '; rest before pull: ' + JSON.stringify(REST) + '; food bag ' + CLEAR_FOOD.count + ' stews, eaten only below 35% HP mid-fight. Repeat clears skip the 1.5x explore walk.');
  out.push('Shortest walk entry -> boss: ' + C.Dungeon.walkSeconds(C.Dungeon.entry, { x: 11, y: 67 }).toFixed(1) + ' s (GD metric, 80 px/s).\n');
  out.push('## Combat levels (1 XP per damage to the style stat, 0.33 to Hitpoints)\n');
  out.push('Wearing Cinderiron needs Attack 5 and Defence 5, so after Q2 the player grinds goblin packs until both are 5 (Rustbound set).\n');
  out.push('| style | stage | damage dealt | Attack | Strength | Defence | Hitpoints |');
  out.push('|---|---|---|---|---|---|---|');
  for (const k in xp.styles) xp.styles[k].stages.forEach(s => out.push('| ' + [xp.styles[k].label, s.stage, s.damage, s.attack, s.strength, s.defence, s.hitpoints].join(' | ') + ' |'));
  out.push('\n| style | field grind to Cinderiron | clears after the first to Attack 40 | hours (repeat Verdite pace - first-clear Cinderiron pace) |');
  out.push('|---|---|---|---|');
  for (const k in xp.styles) {
    const S = xp.styles[k];
    out.push('| ' + [S.label, Math.round(S.grindDamage) + ' dmg (~' + Math.round(S.grindDamage / C.MONSTERS.goblin.hp) + ' goblins, ~' + fieldGrindMinutes(S.grindDamage, 'rustbound').toFixed(0) + ' min)',
      S.toA40.clears.toFixed(1), S.toA40.hours.repeatVerdite.toFixed(1) + '-' + S.toA40.hours.firstClearCinderiron.toFixed(1) + ' h'].join(' | ') + ' |');
  }
  out.push('\nAttack 40 = ' + xp.attack40Xp + ' XP. One Ash Stair clear pays ' + Math.round(xp.perClearStatXp) + ' style XP (+' + Math.round(xp.perClearStatXp * M.XP_RATE.hitpoints) + ' Hitpoints). Clear pace: repeat at Verdite ' + (repeat.totalS / 60).toFixed(1) + ' min, first clear at Cinderiron ' + (dEst[0].totalS / 60).toFixed(1) + ' min.');
  out.push('Wyrmfang at 1/150: median ' + wyrmfangMedianKills.toFixed(0) + ' Ashmaw kills (~' + (wyrmfangMedianKills * repeat.totalS / 3600).toFixed(0) + ' h of repeat clears).');
  console.log(out.join('\n'));
}

if (require.main === module) main();
module.exports = { row, table, dungeonEstimate, xpModel, dangerTable, q2Damage, styleXp, grindDamage, fieldGrindMinutes, GEAR_LEVEL, STEW, OVERHEAD, REST, CLEAR_FOOD, STYLES, packSizes };
