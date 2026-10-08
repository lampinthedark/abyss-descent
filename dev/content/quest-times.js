#!/usr/bin/env node
/**
 * Time estimate per quest at ASSUMED speeds (printed with the result).
 * Walks use GD's metric (32x18 tiles, 80 art px/s, octile with N/S = 18/32 of
 * E/W) between the town points in RPGContent.TOWN_POINTS, times a detour
 * factor for buildings/water. Combat comes from the GD-formula sim.
 *
 *   node dev/content/quest-times.js [--json]
 */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '../../js/rpg/content/index.js'));
const M = require('./combat-model.js');
const { byId } = require('./loadouts.js');

const SPEEDS = {
  pxPerS: 80, tileW: 32, tileH: 18, detour: 1.25,
  dialogueOfferS: 15, dialogueTurnInS: 8, readTrackerS: 2,
  mineS: 3.0,           // per ore at Mining 1 with a Rustbound pickaxe (GD's swing timer; ASSUMED)
  smeltS: 1.8, smithS: 2.4, cookS: 1.8,
  fishS: 4.0,           // per catch at Fishing 1
  equipS: 4,            // open bag, tap the sword, close
  seekPackS: 10,        // find / walk to the next pack inside a zone
  lootPerMobS: 1.5,
};
const P = C.TOWN_POINTS;
const NEW_PLAYER_SLACK = 2.5;   // first-time player: reads the UI, misses taps, wanders

function walkS(a, b) {
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  const ns = SPEEDS.tileH / SPEEDS.tileW, diag = Math.hypot(1, ns);
  const m = Math.min(dx, dy);
  const cost = m * diag + (dx - m) * 1 + (dy - m) * ns;   // tile widths
  return cost * SPEEDS.tileW / SPEEDS.pxPerS * SPEEDS.detour;
}

function goblinFightS(loadout, kills) {
  const l = byId(loadout), d = C.MONSTERS.goblin;
  const p = { attack: l.attack, strength: l.strength, defence: l.defence, hitpoints: l.hitpoints, gear: l.gear };
  const avgPack = (d.pack[0] + d.pack[1]) / 2;
  const packs = Math.ceil(kills / avgPack);
  let t = 0, taken = 0;
  for (let k = d.pack[0]; k <= d.pack[1]; k++) {
    const r = M.simulate(p, Array(k).fill(d), { policy: 'telegraphs' }, 300, 5 + k);
    t += (r.ttkWon || r.ttk); taken += r.pctHp;
  }
  const n = d.pack[1] - d.pack[0] + 1;
  return { packs, perPackS: t / n, pctHpPerPack: taken / n, totalS: packs * (t / n + SPEEDS.seekPackS + avgPack * SPEEDS.lootPerMobS) };
}

function q1() {
  const legs = [];
  legs.push(['offer dialogue + Accept', SPEEDS.dialogueOfferS]);
  legs.push(['walk questgiver -> Rustbound rocks', walkS(P.questgiver, P.node_ore_rustbound)]);
  legs.push(['mine 2 ore', 2 * SPEEDS.mineS]);
  legs.push(['walk rocks -> furnace', walkS(P.node_ore_rustbound, P.prop_furnace_0)]);
  legs.push(['smelt 2 bars', 2 * SPEEDS.smeltS + SPEEDS.readTrackerS]);
  legs.push(['walk furnace -> anvil', walkS(P.prop_furnace_0, P.prop_anvil_0)]);
  legs.push(['smith sword', SPEEDS.smithS + SPEEDS.readTrackerS]);
  legs.push(['equip from bag', SPEEDS.equipS]);
  legs.push(['walk anvil -> questgiver', walkS(P.prop_anvil_0, P.questgiver)]);
  legs.push(['turn-in dialogue', SPEEDS.dialogueTurnInS]);
  return { id: 'q1_blade', legs };
}
function q2() {
  const f = goblinFightS('starter', 4);
  const legs = [];
  legs.push(['offer dialogue + Accept', SPEEDS.dialogueOfferS]);
  legs.push(['walk questgiver -> pond', walkS(P.questgiver, P.node_fish_0)]);
  legs.push(['catch 2 fish', 2 * SPEEDS.fishS]);
  legs.push(['walk pond -> range', walkS(P.node_fish_0, P.prop_range_0)]);
  legs.push(['cook 2 (attempts count)', 2 * SPEEDS.cookS + SPEEDS.readTrackerS]);
  legs.push(['walk range -> goblin field', walkS(P.prop_range_0, P.goblin_field)]);
  legs.push(['defeat 4 goblins (' + f.packs + ' packs, sword only, ~' + f.pctHpPerPack.toFixed(0) + '% HP per pack)', f.totalS]);
  legs.push(['walk field -> questgiver', walkS(P.goblin_field, P.questgiver)]);
  legs.push(['turn-in dialogue', SPEEDS.dialogueTurnInS]);
  return { id: 'q2_field', legs };
}
function q3stub() {
  let clear = null;
  try { clear = require('./balance-sim.js').dungeonEstimate('cinderiron', 120, 'good').totalS; } catch (e) { clear = 900; }
  const legs = [];
  legs.push(['offer dialogue + Accept', SPEEDS.dialogueOfferS]);
  legs.push(['walk questgiver -> Ash Stair gate', walkS(P.questgiver, P.ash_stair_gate)]);
  legs.push(['first clear of the Ash Stair at Cinderiron (balance-sim)', clear]);
  legs.push(['walk gate -> questgiver', walkS(P.ash_stair_gate, P.questgiver)]);
  legs.push(['turn-in dialogue', SPEEDS.dialogueTurnInS]);
  return { id: 'q3_ashmaw', legs, stub: true };
}

function estimates() {
  return [q1(), q2(), q3stub()].map(q => Object.assign(q, { totalS: q.legs.reduce((s, l) => s + l[1], 0) }));
}

if (require.main === module) {
  const all = estimates();
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ SPEEDS, quests: all }, null, 1)); process.exit(0); }
  for (const q of all) {
    console.log('\n### ' + q.id + (q.stub ? ' (stub, week 2)' : '') + ': ' + (q.totalS / 60).toFixed(1) + ' min' +
      (q.stub ? '' : ' (x' + NEW_PLAYER_SLACK + ' new-player slack: ' + (q.totalS * NEW_PLAYER_SLACK / 60).toFixed(1) + ' min)'));
    for (const [k, v] of q.legs) console.log('- ' + k + ': ' + v.toFixed(1) + ' s');
  }
  const both = all[0].totalS + all[1].totalS;
  console.log('\n### Q1 + Q2 combined: ' + (both / 60).toFixed(1) + ' min (x' + NEW_PLAYER_SLACK + ' new-player slack: ' + (both * NEW_PLAYER_SLACK / 60).toFixed(1) + ' min)');
  console.log('\nAssumed speeds: ' + JSON.stringify(SPEEDS));
  const ok = all[0].totalS < 600;
  console.log('\nQ1 under 10 min (UAT gate 2): ' + (ok ? 'YES' : 'NO') + ' (' + (all[0].totalS / 60).toFixed(1) + ' min)');
  if (!ok) process.exitCode = 1;
}
module.exports = { SPEEDS, NEW_PLAYER_SLACK, walkS, estimates };
