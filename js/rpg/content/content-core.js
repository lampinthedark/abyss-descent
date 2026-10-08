/**
 * RPG content (week-1 slice): namespace, NPCs, zones, town anchor points and
 * the quest-progress helper. Pure data + pure functions; no state, no DOM.
 *
 *   browser: <script src="js/rpg/content/content-core.js"></script> ... -> window.RPGContent
 *   node:    const RPGContent = require('./js/rpg/content/index.js');
 *
 * Shapes are GD's (docs/rpg-content.md):
 *   monster    {id, hp, def, atk, speed, aggro, leash, xp, pack:[min,max], attacks:[{kind, dmg, range, windupMs, cooldownMs}]}
 *   quest step {text, arrowTo, done:{type, target, count}}
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var C = isNode ? {} : (root.RPGContent = root.RPGContent || {});
  factory(C);
  if (isNode) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis, function (C) {
  'use strict';

  C.VERSION = 1;

  /** NPC ids match GD's world.js and the town sheet keys npc_<id>. */
  C.NPCS = {
    questgiver: { id: 'questgiver', name: 'Warden Ilse', key: 'npc_questgiver',
      idle: ['The road out is safe. The road down is not.', 'Keep your blade dry and your bag light.'] },
    smith: { id: 'smith', name: 'Smith Oren', key: 'npc_smith', shop: 'smithy',
      idle: ['Ore in the furnace, bar on the anvil. That is the whole trade.', 'Hammer first, questions after.'] },
    banker: { id: 'banker', name: 'Banker', key: 'npc_banker', bank: true,
      idle: ['Anything you leave here stays here. Even the shiny things.'] },
    shopkeep: { id: 'shopkeep', name: 'Shopkeep', key: 'npc_shopkeep', shop: 'general_store',
      idle: ['Bread, rods, hammers. I buy almost anything that is not nailed down.'] },
  };

  /**
   * Zones a quest arrow or an 'enter' step can point at. Town rects use GD's
   * D1 town grid (world.js, 28x40); dungeon rects use the Ash Stair grid.
   */
  C.ZONES = {
    town:            { id: 'town', name: 'Town', map: 'town', kind: 'map' },
    goblin_field:    { id: 'goblin_field', name: 'Goblin Field', map: 'town', kind: 'area', rect: { x: 2, y: 32, w: 24, h: 6 },
      anchor: { x: 13, y: 34 } },
    ash_stair_gate:  { id: 'ash_stair_gate', name: 'Ash Stair gate', map: 'town', kind: 'area', rect: { x: 11, y: 26, w: 3, h: 2 },
      anchor: { x: 12, y: 27 }, to: { map: 'ash_stair', x: 11, y: 3 } },
    ash_stair:       { id: 'ash_stair', name: 'The Ash Stair', map: 'ash_stair', kind: 'map' },
    ash_stair_brute: { id: 'ash_stair_brute', name: 'Brute hall', map: 'ash_stair', kind: 'area', rect: { x: 5, y: 51, w: 14, h: 8 },
      anchor: { x: 11, y: 55 } },
    ash_stair_boss:  { id: 'ash_stair_boss', name: "Ashmaw's den", map: 'ash_stair', kind: 'area', rect: { x: 2, y: 62, w: 20, h: 12 },
      anchor: { x: 11, y: 67 } },
  };

  /**
   * Where things stand in GD's D1 town (world.js) - used for arrows when core
   * has no live prop to point at, and for the quest time estimates.
   */
  C.TOWN_POINTS = {
    spawn: { x: 9, y: 12 },
    questgiver: { x: 8, y: 12 }, banker: { x: 7, y: 9 }, shopkeep: { x: 17, y: 9 }, smith: { x: 3, y: 16 },
    prop_furnace_0: { x: 3, y: 13 }, prop_anvil_0: { x: 5, y: 15 }, prop_range_0: { x: 21, y: 16 }, prop_fire_0: { x: 9, y: 21 },
    node_ore_rustbound: { x: 21, y: 22 }, node_ore_cinderiron: { x: 24, y: 20 }, node_tree_pine: { x: 7, y: 26 },
    node_tree_ash: { x: 2, y: 24 }, node_fish_0: { x: 17, y: 29 },
    goblin_field: { x: 13, y: 34 }, ash_stair_gate: { x: 12, y: 27 },
  };

  /**
   * Field packs outside the gate, in GD's town coordinates. GD's D1 MOB_SPAWNS
   * already has the first three; the fourth is a suggestion (walkable grass).
   */
  C.FIELD_SPAWNS = [
    { monsterId: 'rat', x: 9, y: 33 },
    { monsterId: 'rat', x: 5, y: 35 },
    { monsterId: 'goblin', x: 19, y: 37 },
    { monsterId: 'goblin', x: 13, y: 37 },
  ];

  /**
   * Pure quest progress. progress = { questId, step, n } (core stores it).
   * ev = { type, target, count? } from core's bus (kill / gather / craft /
   * equip / talk / enter). Returns { progress, advanced, stepDone, questDone }.
   * Craft events are sent for every make, burnt food included (Q2 counts attempts).
   */
  C.advance = function (progress, ev) {
    var q = C.quest(progress.questId);
    if (!q || progress.step >= q.steps.length) return { progress: progress, advanced: false, stepDone: false, questDone: true };
    var st = q.steps[progress.step];
    if (!ev || ev.type !== st.done.type || ev.target !== st.done.target) return { progress: progress, advanced: false, stepDone: false, questDone: false };
    var n = (progress.n || 0) + (ev.count || 1);
    var need = st.done.count || 1;
    var next = { questId: progress.questId, step: progress.step, n: n };
    var stepDone = n >= need;
    if (stepDone) { next.step += 1; next.n = 0; }
    return { progress: next, advanced: true, stepDone: stepDone, questDone: next.step >= q.steps.length };
  };

  /**
   * Tracker line for the current step, with {n}/{count} filled in. Steps whose
   * text has no {n} (e.g. Q1's "Mine Rustbound ore") are shown verbatim; use
   * C.trackerCount() if the UI wants a separate "1/2" badge.
   */
  C.tracker = function (progress) {
    var q = C.quest(progress.questId);
    if (!q) return '';
    if (progress.step >= q.steps.length) return q.title + ': done';
    var st = q.steps[progress.step];
    return st.text.replace('{n}', String(Math.min(progress.n || 0, st.done.count || 1))).replace('{count}', String(st.done.count || 1));
  };

  /** { n, count } for the current step, or null when done. */
  C.trackerCount = function (progress) {
    var q = C.quest(progress.questId);
    if (!q || progress.step >= q.steps.length) return null;
    var st = q.steps[progress.step];
    return { n: Math.min(progress.n || 0, st.done.count || 1), count: st.done.count || 1 };
  };

  C.quest = function (id) {
    for (var i = 0; i < (C.QUESTS || []).length; i++) if (C.QUESTS[i].id === id) return C.QUESTS[i];
    return null;
  };
  C.monster = function (id) { return (C.MONSTERS || {})[id] || null; };
});
