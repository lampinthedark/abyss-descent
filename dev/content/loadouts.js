/**
 * Gear loadouts for the balance sim, built from real RPGItems Normal items and
 * summed exactly like Equipment.getStats() (base stats; Normal rolls no affixes).
 * Levels are the ASSUMED skill levels a player has when wearing that tier
 * (see docs/rpg-content.md "Balance"): they follow the quest-chain XP model
 * in balance-sim.js (Q1 -> A1, Q2 -> ~A4, first dungeon entry ~A8, ...).
 */
'use strict';
const path = require('path');
const R = require(path.join(__dirname, '../../js/rpg/items/index.js'));

function statsOf(baseIds) {
  const t = { aim: 0, power: 0, armour: 0, maxHp: 0, attackSpeed: 0, crit: 0, lifesteal: 0, cooldown: 0, gather: 0 };
  for (const id of baseIds) {
    const inst = R.ItemGen.createInstance(id, { rarity: 'normal', seed: 1 });
    const s = R.ItemGen.stats(inst);
    for (const k in t) t[k] += s[k] || 0;
  }
  return t;
}
const SET = ['sword', 'shield', 'helm', 'cuirass', 'greaves', 'gauntlets', 'sabatons'];
function set(tier) { return SET.map(k => tier + '_' + k); }

const LOADOUTS = [
  { id: 'starter',    label: 'Rustbound sword only (end of Q1)', items: ['rustbound_sword'],
    attack: 1, strength: 1, defence: 1, hitpoints: 10 },
  { id: 'rustbound',  label: 'Rustbound set (Q2)', items: set('rustbound'),
    attack: 3, strength: 3, defence: 3, hitpoints: 10 },
  { id: 'cinderiron', label: 'Cinderiron set (Q3 entry)', items: set('cinderiron'),
    attack: 8, strength: 8, defence: 8, hitpoints: 12 },
  { id: 'verdite',    label: 'Verdite set', items: set('verdite'),
    attack: 15, strength: 15, defence: 15, hitpoints: 16 },
  { id: 'tidesteel',  label: 'Tidesteel set', items: set('tidesteel'),
    attack: 25, strength: 25, defence: 25, hitpoints: 25 },
  { id: 'sunforged',  label: 'Sunforged set', items: set('sunforged'),
    attack: 35, strength: 35, defence: 35, hitpoints: 35 },
];
for (const L of LOADOUTS) L.gear = statsOf(L.items);

/**
 * What a cold player actually walks in with after the post-Q2 path (gear-path.js):
 * Cinderiron sword + cuirass bought from the smithy, the Q2 Rustbound shield.
 * Not in the main table; used for the entry checks (real levels grow through the clear).
 */
const ENTRY = { id: 'cinderiron_entry', label: 'Cinderiron sword + cuirass, Rustbound shield (cold-player entry kit)',
  items: ['cinderiron_sword', 'cinderiron_cuirass', 'rustbound_shield'], attack: 8, strength: 8, defence: 8, hitpoints: 12 };
ENTRY.gear = statsOf(ENTRY.items);

module.exports = { LOADOUTS, ENTRY, statsOf, byId: id => LOADOUTS.find(l => l.id === id) || (id === ENTRY.id ? ENTRY : undefined) };
