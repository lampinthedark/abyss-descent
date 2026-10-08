/**
 * RPG.combat: D3 action combat lives here (core). D1 ships the signatures
 * only, so owners can code against them; nothing is wired to input yet.
 *
 * Plan (docs/rpg-core-hooks.md, PLAN.md): hit chance from Attack + gear aim vs
 * Defence + armour, damage from Strength + gear power (Equipment.getStats()),
 * 3 cooldown skills (Cleave, Ground Slam, Sigil Bolt), dodge roll with
 * 0.35 s i-frames and a 2 s cooldown. Mobs implement
 * takeHit(dmg, {crit, srcId, knock}) -> {dead}; core emits 'kill' unless the
 * owner already did.
 */
(function (root) {
  'use strict';

  const RPG = (root.RPG = root.RPG || {});

  function gear() {
    try {
      // eslint-disable-next-line no-undef
      const eq = typeof Equipment !== 'undefined' ? Equipment : root.Equipment;
      return (eq && eq.getStats && eq.getStats()) || {};
    } catch (e) {
      return {};
    }
  }

  // Combat XP constants (contract): per point of damage dealt, 1 XP to the
  // style's stat (attack / strength / defence) plus 0.33 XP to Hitpoints.
  // Combat code calls RPG.stats.addXp itself; core grants nothing in D1.
  const XP = Object.freeze({ PER_DAMAGE: 1, HITPOINTS_PER_DAMAGE: 0.33 });

  RPG.combat = {
    XP: XP,
    /** XP to grant for `dmg` damage dealt in a style: {stat, hitpoints}. */
    xpFor: function (dmg) {
      const d = Math.max(0, dmg || 0);
      return { stat: d * XP.PER_DAMAGE, hitpoints: d * XP.HITPOINTS_PER_DAMAGE };
    },
    DODGE_IFRAMES: 0.35,
    DODGE_COOLDOWN: 2,
    /** Chance (0..1) that the hero hits a target with defence `def`. D3 tunes this. */
    hitChance: function (def) {
      const att = RPG.stats.level('attack') + (gear().aim || 0);
      const d = Math.max(0, def || 0);
      return Math.max(0.05, Math.min(0.95, (att + 8) / (att + d + 16)));
    },
    /** Max hit from Strength + gear power. D3 tunes this. */
    maxHit: function () {
      const w = gear().weapon;
      if (!w || (RPG.isToolItem && RPG.isToolItem(w.base))) return 1; // unarmed fist (PM ruling): Q1's sword is the payoff
      return Math.max(1, Math.floor(1 + (RPG.stats.level('strength') + (gear().power || 0)) / 4));
    },
    /** D3: swing at a mob entity. Stub: no-op. */
    attack: function (target) {
      return { ok: false, reason: 'not_in_d1' };
    },
    /** D3: dodge roll toward (dx, dy). Stub: no-op. */
    dodge: function (dx, dy) {
      return { ok: false, reason: 'not_in_d1' };
    },
    /** D4: cast 'cleave' | 'ground_slam' | 'sigil_bolt'. Stub: no-op. */
    cast: function (skillId, target) {
      return { ok: false, reason: 'not_in_d1' };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
