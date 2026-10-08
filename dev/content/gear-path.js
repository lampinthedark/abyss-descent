#!/usr/bin/env node
/**
 * Post-Q2 path into the Ash Stair in Cinderiron, for a cold player.
 *
 * A cold player after Q1 + Q2 has: Rustbound sword + shield, pickaxe, hammer,
 * Mining 74 XP (Q1 reward 40 + 2 ore), Smithing 100 XP (Q1 reward 60 + 2 smelts
 * + the sword), the Q1/Q2 gold, Attack/Strength/Defence from the Q2 fights.
 * To fight in Cinderiron they need (a) Attack/Defence 3 (combat grind, balance-sim)
 * and (b) the gear, from any of:
 *   - smithing: mine Cinderiron ore (Mining 5), smelt (Smithing 5), smith
 *     (Smithing 5-9 by piece), levelling on Rustbound first;
 *   - the Smithy's stock (RPGItems shop prices; whatever it stocks);
 *   - drops (goblin uncommon table: Rustbound-or-Cinderiron gear, Cinderiron ore).
 * Every action uses the existing rates (quest-times SPEEDS, RPGItems recipe /
 * node XP). The planner searches how much Rustbound to mine/smith for XP and
 * picks the fastest plan per target. Drops are reported as expected bonus only
 * (not relied on).
 *
 *   node dev/content/gear-path.js [--json]
 */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '../../js/rpg/content/index.js'));
const R = require(path.join(__dirname, '../../js/rpg/items/index.js'));
const M = require('./combat-model.js');
const QT = require('./quest-times.js');
const Db = R.ItemsDb, CR = R.Modules.crafting, SH = R.Modules.shop;
const SP = QT.SPEEDS, P = C.TOWN_POINTS, walkS = QT.walkS;

const SET = ['sword', 'shield', 'helm', 'cuirass', 'greaves', 'gauntlets', 'sabatons'];
const TARGETS = {
  full: { label: 'full Cinderiron set (the balance-sim loadout)', pieces: SET },
  core: { label: 'Cinderiron sword + cuirass (weapon + body)', pieces: ['sword', 'cuirass'] },
};

function xpLvl(xp) { return M.levelFor(xp); }
/** Skill XP a cold player holds after Q1 + Q2. */
function coldStart() {
  const q1 = C.quest('q1_blade');
  const mining = (q1.rewards.xp.mining || 0) + 2 * CR.NODES.node_ore_rustbound.xp;
  const smithing = (q1.rewards.xp.smithing || 0) + 2 * CR.RECIPES.smelt_rustbound.xp + CR.RECIPES.smith_rustbound_sword.xp;
  const gold = C.quest('q1_blade').rewards.gold + C.quest('q2_field').rewards.gold;
  return { mining, smithing, gold };
}

/** Smithy buy price for a base at full stock, or null if not stocked (opts.shopPieces overrides the stock list). */
function shopPrice(base, shopPieces) {
  const def = SH.SHOPS.smithy;
  if (shopPieces && !shopPieces.some(k => 'cinderiron_' + k === base)) return null;
  const e = shopPieces ? { base } : def.stock.find(s => s.base === base);
  return e ? Math.max(1, Math.ceil(Db.getBase(base).value * def.buyMult)) : null;
}

/**
 * Plan: given which pieces are bought, how many Rustbound ores (r) and spare
 * Cinderiron ores to take, simulate the XP and return null (infeasible) or the time.
 */
function simulatePlan(smithPieces, r, spare, start) {
  const mineXp = start.mining + r * CR.NODES.node_ore_rustbound.xp;
  if (smithPieces.length && xpLvl(mineXp) < CR.NODES.node_ore_cinderiron.level) return null;
  const recipes = smithPieces.map(k => CR.RECIPES['smith_cinderiron_' + k]).sort((a, b) => a.level - b.level);
  const cBars = recipes.reduce((s, x) => s + x.inputs[0].qty, 0) + spare;
  let sm = start.smithing, smelts = 0, smiths = 0, rBars = 0, cLeft = cBars;
  // furnace 1: smelt every Rustbound ore
  sm += r * CR.RECIPES.smelt_rustbound.xp; smelts += r; rBars = r;
  // anvil 1: smith Rustbound bars (12 XP/bar, any recipe at/below level) until Smithing 5 for the Cinderiron furnace
  const rbXp = (10 + Db.TIER_BY_ID.rustbound.level * 2);
  const needC = CR.RECIPES.smelt_cinderiron.level;
  while (smithPieces.length && xpLvl(sm) < needC && rBars > 0) { sm += rbXp; rBars--; smiths++; }
  if (smithPieces.length && xpLvl(sm) < needC) return null;
  // furnace 2: smelt Cinderiron
  if (smithPieces.length) { sm += cBars * CR.RECIPES.smelt_cinderiron.xp; smelts += cBars; }
  // anvil 2: pieces in level order, filler first from spare Rustbound bars, then Cinderiron dirks
  const dirk = CR.RECIPES.smith_cinderiron_dirk;
  for (const rc of recipes) {
    while (xpLvl(sm) < rc.level) {
      if (rBars > 0) { sm += rbXp; rBars--; smiths++; }
      else if (cLeft - recipes.filter(x => x !== rc).length >= 0 && cLeft > needBars(recipes, rc)) { sm += dirk.xp; cLeft -= 1; smiths++; }
      else return null;
    }
    sm += rc.xp; cLeft -= rc.inputs[0].qty; smiths++;
  }
  const actS = (r + (smithPieces.length ? cBars : 0)) * SP.mineS + smelts * SP.smeltS + smiths * SP.smithS;
  return { r, cOre: smithPieces.length ? cBars : 0, smelts, smiths, actS, smithingXp: sm, miningXp: mineXp + (smithPieces.length ? cBars * CR.NODES.node_ore_cinderiron.xp : 0) };
  function needBars(all, cur) {   // bars still required for cur and every later piece
    const i = all.indexOf(cur); return all.slice(i).reduce((s, x) => s + x.inputs[0].qty, 0);
  }
}

function walkLegs(smithing, buying) {
  const legs = [];
  let at = P.questgiver;
  const go = (label, to) => { legs.push([label, walkS(at, to)]); at = to; };
  if (buying) go('walk to Smith Oren', P.smith);
  if (smithing) {
    go('walk to Rustbound rocks', P.node_ore_rustbound);
    go('walk to Cinderiron rocks', P.node_ore_cinderiron);
    go('walk to furnace', P.prop_furnace_0);
    go('walk furnace -> anvil', P.prop_anvil_0);
    go('walk anvil -> furnace', P.prop_furnace_0);
    go('walk furnace -> anvil', P.prop_anvil_0);
  }
  go('walk to the goblin field', P.goblin_field);
  return legs;
}

/**
 * Fastest plan for a target, given which pieces the shop sells and the gold on hand.
 * opts.buy: true -> buy every stocked piece the player can afford (cheapest first).
 */
function bestPlan(targetId, opts) {
  opts = opts || {};
  const start = Object.assign(coldStart(), opts.start || {});
  const T = TARGETS[targetId];
  const gold = opts.gold != null ? opts.gold : start.gold;
  let bought = [], spent = 0;
  if (opts.buy !== false) {
    const stocked = T.pieces.map(k => ({ k, p: shopPrice('cinderiron_' + k, opts.shopPieces) })).filter(x => x.p != null).sort((a, b) => a.p - b.p);
    for (const x of stocked) if (spent + x.p <= gold) { bought.push(x.k); spent += x.p; }
  }
  const smithPieces = T.pieces.filter(k => !bought.includes(k));
  let best = null;
  for (let r = 0; r <= 60; r++) for (let spare = 0; spare <= 12; spare++) {
    const s = simulatePlan(smithPieces, r, spare, start);
    if (s && (!best || s.actS < best.actS)) best = s;
    if (!smithPieces.length) break;
  }
  if (!best) return { target: targetId, feasible: false };
  const legs = walkLegs(smithPieces.length > 0, bought.length > 0);
  const stations = (smithPieces.length ? 4 : 0) + (bought.length ? 1 : 0);
  const uiS = stations * SP.readTrackerS + (bought.length ? SP.equipS : 0) + SP.equipS * (T.pieces.length ? 1 : 0);
  const walk = legs.reduce((s, l) => s + l[1], 0);
  const totalS = best.actS + walk + uiS;
  return { target: targetId, label: T.label, feasible: true, bought, spent, gold, smithPieces, plan: best, walkS: walk, uiS, totalS };
}

/** Full post-Q2 path: combat grind (balance-sim) + gear, raw and with new-player slack. */
function postQ2(targetId, styleId, opts) {
  const B = require('./balance-sim.js');
  const st = B.STYLES[styleId || 'typical'];
  const grindDmg = B.grindDamage(st);
  const grindS = B.fieldGrindMinutes(grindDmg, 'rustbound') * 60;
  const gear = bestPlan(targetId, Object.assign({}, opts || {}, { gold: (opts && opts.gold) != null ? opts.gold : expectedGold(grindDmg) }));
  const raw = grindS + (gear.feasible ? gear.totalS : Infinity);
  return { target: targetId, style: styleId || 'typical', grindS, gear, rawS: raw, slackS: raw * QT.NEW_PLAYER_SLACK };
}

/** Expected gold after Q1 + Q2 + the grind: quest gold + coin drops (no selling assumed). */
function expectedGold(grindDmg) {
  const L = R.Loot.MONSTERS;
  const coin = id => L[id].gold.chance * (L[id].gold.min + L[id].gold.max) / 2;
  const q2Kills = { goblin: 5, rat: 2.5 };
  const grindGoblins = grindDmg / C.MONSTERS.goblin.hp;
  return Math.floor(coldStart().gold + q2Kills.goblin * coin('goblin') + q2Kills.rat * coin('rat') + grindGoblins * coin('goblin'));
}

/**
 * Near-town kill timeline for a cold player of a style (fewest kills: Q2's 4
 * goblins in two packs of 2, no rats; then the grind's goblins), with times
 * from the quest legs and the grind (x new-player slack), and the seeded
 * first-Rare roll over it. Returns { kills, fieldEndS, hit, maxKill, maxS, perSeed }.
 */
function fieldFirstRare(styleId, seeds) {
  const B = require('./balance-sim.js');
  const Q = QT.estimates(), k = QT.NEW_PLAYER_SLACK;
  const st = B.STYLES[styleId];
  const q2 = Q[1];
  let t = Q[0].totalS, times = [];
  for (const [label, s] of q2.legs) {
    if (/^defeat 4 goblins/.test(label)) { for (let i = 1; i <= 4; i++) times.push(t + s * i / 4); }
    t += s;
  }
  const grindKills = Math.ceil(B.grindDamage(st) / C.MONSTERS.goblin.hp);
  const grindS = B.fieldGrindMinutes(B.grindDamage(st), 'rustbound') * 60;
  for (let i = 1; i <= grindKills; i++) times.push(t + grindS * i / grindKills);
  times = times.map(x => x * k);
  const FR = R.Loot.FIRST_RARE;
  let hit = 0, maxKill = 0, maxS = 0;
  for (let sd = 0; sd < (seeds || 2000); sd++) {
    const rng = M.rng32(31337 + sd * 7919);
    let fr = { done: false, kills: 0, all: 0 }, at = null;
    for (let i = 0; i < times.length && !fr.done; i++) {
      fr = R.Loot.rollDrop('goblin', rng, { firstRare: fr }).firstRare;
      if (fr.done) at = i;
    }
    if (at != null) { hit++; maxKill = Math.max(maxKill, at + 1); maxS = Math.max(maxS, times[at]); }
  }
  return { style: styleId, kills: times.length, q2Kills: 4, grindKills, fieldEndS: times[times.length - 1], guarantee: FR.GUARANTEE,
    hitRate: hit / (seeds || 2000), maxKill, maxS };
}

const BEFORE_SHOP = ['sword'];   // smithy stock before this change: Cinderiron sword only
function report() {
  const rows = [];
  for (const [when, o] of [['before (smithy: sword only)', { shopPieces: BEFORE_SHOP }], ['now (smithy: sword + cuirass)', {}]])
    for (const t of Object.keys(TARGETS)) for (const s of ['typical', 'even', 'attack']) rows.push(Object.assign({ when }, postQ2(t, s, o)));
  return rows;
}
if (require.main === module) {
  const rows = report();
  const fr = ['typical', 'even', 'attack'].map(x => fieldFirstRare(x));
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows, firstRare: fr }, null, 1)); process.exit(0); }
  const cs = coldStart();
  console.log('Cold player after Q2: Mining ' + cs.mining + ' XP (L' + xpLvl(cs.mining) + '), Smithing ' + cs.smithing + ' XP (L' + xpLvl(cs.smithing) + '), quest gold ' + cs.gold + '.');
  console.log('Smithy Cinderiron stock now: ' + SET.map(k => k + ' ' + (shopPrice('cinderiron_' + k) != null ? shopPrice('cinderiron_' + k) + 'g' : '-')).join(', ') + '.');
  console.log('Recipes: ' + SET.map(k => k + ' Smithing ' + CR.RECIPES['smith_cinderiron_' + k].level + ' / ' + CR.RECIPES['smith_cinderiron_' + k].inputs[0].qty + ' bars').join(', ') + '; ore Mining ' + CR.NODES.node_ore_cinderiron.level + ', smelt Smithing ' + CR.RECIPES.smelt_cinderiron.level + '.\n');
  console.log('| shop | target | style | gold | bought | smithed | Rustbound ore | Cinderiron ore | smelts | smiths | gear min | combat grind min | post-Q2 raw min | x' + QT.NEW_PLAYER_SLACK + ' slack min |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const o of rows) {
    const g = o.gear;
    console.log('| ' + [o.when, g.label, o.style, g.gold, (g.bought || []).join('+') || '-', (g.smithPieces || []).join('+') || '-', g.plan ? g.plan.r : '-', g.plan ? g.plan.cOre : '-',
      g.plan ? g.plan.smelts : '-', g.plan ? g.plan.smiths : '-', g.feasible ? (g.totalS / 60).toFixed(1) : 'n/a', (o.grindS / 60).toFixed(1), (o.rawS / 60).toFixed(1), (o.slackS / 60).toFixed(1)].join(' | ') + ' |');
  }
  const FR = R.Loot.FIRST_RARE;
  console.log('\nFirst Rare on the goblin field (RPGItems FIRST_RARE: ramp from near-town kill ' + FR.RAMP_START + ' to ' + (FR.RAMP_MAX * 100) + '%, guaranteed at near-town kill ' + FR.GUARANTEE + '; any-kill backup at ' + FR.BACKUP_GUARANTEE + '). Fewest-kill timeline per style (Q2: 4 goblins, no rats; then the grind), x' + QT.NEW_PLAYER_SLACK + ' slack, 2000 seeds:\n');
  console.log('| style | near-town kills before the dungeon | first Rare on the field | latest kill | latest time from Q1 start |');
  console.log('|---|---|---|---|---|');
  fr.forEach(f => console.log('| ' + [f.style, f.kills + ' (Q2 ' + f.q2Kills + ' + grind ' + f.grindKills + ')', (f.hitRate * 100).toFixed(1) + '%', f.maxKill, (f.maxS / 60).toFixed(1) + ' min'].join(' | ') + ' |'));
}
module.exports = { TARGETS, BEFORE_SHOP, fieldFirstRare, coldStart, shopPrice, bestPlan, postQ2, expectedGold, simulatePlan, report };
