/**
 * Week-1 monsters in GD's shape:
 *   {id, name, hp, def, speed (tiles/s), aggro (tiles), leash (tiles), xp, pack:[min,max],
 *    attacks:[{kind:'melee'|'ranged'|'charge'|'slam', dmg, range (tiles), windupMs, cooldownMs, ...}]}
 *
 * - def is NEW (GD's hit formula needs target.def).
 * - xp = 4 x hp: the stat XP a full kill pays under GD's per-damage rule
 *   (plus 1.33 x hp to Hitpoints). Informational; GD awards per damage.
 * - Every windupMs >= 400; boss attacks >= 600. 'charge' draws telegraphLine
 *   (length = range), 'slam' draws telegraph (ring radius = radius, or range).
 * - cooldownMs is per attack, counted from the hit; balance-sim also rests a
 *   mob 500 ms between any two attacks (REST_MS).
 * - Stats tuned with dev/content/balance-sim.js against GD's formula and the
 *   RPGItems tiers; see docs/rpg-content.md for the table.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var C = isNode ? require('./content-core.js') : root.RPGContent;
  factory(C);
  if (isNode) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis, function (C) {
  'use strict';

  C.REST_MS = 500;
  C.MIN_WINDUP_MS = 400;
  C.MIN_BOSS_WINDUP_MS = 600;

  var M = {
    rat: {
      id: 'rat', name: 'Plague Rat', zone: 'goblin_field', sprite: 'mob_rat',
      hp: 10, def: 0, speed: 2.4, aggro: 3, leash: 7, pack: [2, 3],
      attacks: [
        { kind: 'melee', dmg: 1, range: 1, windupMs: 400, cooldownMs: 1400 },
      ],
    },
    goblin: {
      id: 'goblin', name: 'Ditch Goblin', zone: 'goblin_field', sprite: 'mob_goblin',
      hp: 22, def: 3, speed: 2.0, aggro: 4, leash: 8, pack: [2, 3],
      attacks: [
        { kind: 'melee', dmg: 2, range: 1, windupMs: 500, cooldownMs: 2300 },
        { kind: 'ranged', dmg: 2, range: 4, windupMs: 700, cooldownMs: 7000, minRange: 2, projectile: 'rock' },
      ],
    },
    skeleton: {
      id: 'skeleton', name: 'Rattlebone Skeleton', zone: 'ash_stair', sprite: 'mob_skeleton',
      hp: 100, def: 10, speed: 1.6, aggro: 5, leash: 9, pack: [2, 3],
      attacks: [
        { kind: 'melee', dmg: 2, range: 1, windupMs: 550, cooldownMs: 2600 },
      ],
    },
    imp: {
      id: 'imp', name: 'Cinder Imp', zone: 'ash_stair', sprite: 'mob_imp',
      hp: 65, def: 8, speed: 2.4, aggro: 6, leash: 10, pack: [2, 3],
      attacks: [
        // ranged only: imps hold ~4-5 tiles and hop back when you close in (kite AI)
        { kind: 'ranged', dmg: 3, range: 5, windupMs: 600, cooldownMs: 2600, projectile: 'ember' },
      ],
    },
    brute: {
      id: 'brute', name: 'Grave Brute', zone: 'ash_stair_brute', sprite: 'mob_brute', elite: true,
      hp: 300, def: 14, speed: 1.4, aggro: 6, leash: 12, pack: [1, 1],
      attacks: [
        { kind: 'slam', dmg: 22, range: 1.5, radius: 1.5, windupMs: 800, cooldownMs: 7000, telegraph: 'ring' },
        { kind: 'charge', dmg: 18, range: 5, windupMs: 700, cooldownMs: 9000, telegraph: 'line' },
        { kind: 'melee', dmg: 3, range: 1, windupMs: 600, cooldownMs: 1800 },
      ],
    },
    ashmaw: {
      id: 'ashmaw', name: 'Ashmaw the Wyrmling', zone: 'ash_stair_boss', sprite: 'mob_ashmaw', boss: true,
      hp: 960, def: 8, speed: 1.6, aggro: 8, leash: 99, pack: [1, 1],
      attacks: [
        { kind: 'slam', dmg: 24, range: 2.5, radius: 2.5, windupMs: 1000, cooldownMs: 8000, telegraph: 'ring', name: 'Cinder Ring' },
        { kind: 'charge', dmg: 20, range: 7, windupMs: 900, cooldownMs: 11000, telegraph: 'line', name: 'Ash Rush' },
        { kind: 'melee', dmg: 5, range: 1.2, windupMs: 650, cooldownMs: 2000, name: 'Claw' },
      ],
      enrage: { belowHpPct: 30, cooldownMult: 0.75 },
    },
  };
  Object.keys(M).forEach(function (k) { M[k].xp = M[k].hp * 4; });

  C.MONSTERS = M;
  C.MONSTER_IDS = Object.keys(M);
  C.TELEGRAPH = { charge: 'telegraphLine', slam: 'telegraph' };
});
