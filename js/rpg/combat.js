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
    /** Seconds between swings: gear().speed if the weapon sets it, else SWING. */
    SWING: 0.9,
    RANGE: 1.5,
    target: null,
    /**
     * Lock onto a mob: the hero closes to RANGE and swings on a cooldown
     * until it dies, the hero dies, or the player taps something else.
     */
    attack: function (target) {
      if (!target || target.kind !== 'mob' || target.dead || typeof target.takeHit !== 'function') {
        return { ok: false, reason: 'no_target' };
      }
      if (!RPG.hero || !RPG.hero.alive) return { ok: false, reason: 'dead' };
      RPG.combat.target = target;
      return { ok: true };
    },
    /** One swing now (tests call this directly). Returns {hit, dmg, dead}. */
    swing: function (target) {
      const hero = RPG.hero;
      const rng = RPG.rng ? RPG.rng('combat') : Math.random;
      const hit = rng() < RPG.combat.hitChance(target.def);
      const dmg = hit ? 1 + Math.floor(rng() * RPG.combat.maxHit()) : 0;
      hero.swingT = 0.35;
      if (Math.abs(target.x - hero.x) > 0.1) hero.facing = target.x > hero.x ? 1 : -1;
      let res = { dead: false };
      try { res = target.takeHit(dmg, { srcId: 'hero' }) || res; } catch (err) { if (root.console) console.error('[takeHit]', err); }
      if (dmg > 0) {
        const xp = RPG.combat.xpFor(dmg);
        RPG.stats.addXp('attack', xp.stat);
        RPG.stats.addXp('hitpoints', xp.hitpoints);
        if (RPG.fx) RPG.fx('hit', target.x, target.y - 0.4, { elite: target.elite, boss: target.boss });
      }
      floats.push({ x: target.x, y: target.y, text: String(dmg), hit: dmg > 0, t: 0 });
      if (floats.length > 12) floats.shift();
      return { hit: hit, dmg: dmg, dead: !!res.dead };
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

  // ---- swing loop + damage numbers (core-combat) ---------------------------
  const floats = [];
  let cd = 0;
  let repathT = 0;
  function update(dt) {
    cd = Math.max(0, cd - dt);
    const hero = RPG.hero;
    if (!hero) return;
    if (hero.swingT > 0) hero.swingT = Math.max(0, hero.swingT - dt);
    for (let i = floats.length - 1; i >= 0; i--) { floats[i].t += dt; if (floats[i].t > 0.9) floats.splice(i, 1); }
    const e = RPG.combat.target;
    if (!e) return;
    if (e.dead || !hero.alive || (RPG.world && RPG.world.get && e.id && !RPG.world.get(e.id))) { RPG.combat.target = null; return; }
    const d = Math.hypot(e.x - hero.x, e.y - hero.y);
    if (d <= RPG.combat.RANGE) {
      if (hero.moving) hero.stop();
      if (cd <= 0) {
        cd = gear().speed || RPG.combat.SWING;
        const r = RPG.combat.swing(e);
        if (r.dead) RPG.combat.target = null;
      }
      return;
    }
    // Out of reach: follow (re-path at most every 0.4 s), drop it if it is far off.
    if (d > 9) { RPG.combat.target = null; return; }
    repathT -= dt;
    if (repathT <= 0) { repathT = 0.4; hero.walkTo(Math.floor(e.x), Math.floor(e.y)); }
  }
  function draw(ctx, cam, layer) {
    if (layer !== 'ui' || !floats.length || !RPG.camera || !RPG.camera.toScreen) return;
    const dpr = root.devicePixelRatio || 1;
    ctx.textAlign = 'center';
    ctx.font = 'bold ' + Math.round(13 * dpr) + 'px monospace';
    ctx.lineWidth = Math.max(2, Math.round(3 * dpr));
    for (let i = 0; i < floats.length; i++) {
      const f = floats[i];
      const p = RPG.camera.toScreen(f.x, f.y);
      const y = p.y - (34 + 22 * f.t) * dpr;
      ctx.globalAlpha = Math.min(1, (0.9 - f.t) / 0.3);
      ctx.strokeStyle = '#14120f';
      ctx.strokeText(f.text, p.x, y);
      ctx.fillStyle = f.hit ? '#ffffff' : '#9a9a9a'; // house rule: white hit, grey 0
      ctx.fillText(f.text, p.x, y);
    }
    ctx.globalAlpha = 1;
  }
  RPG.combat._floats = floats;
  if (typeof RPG.registerSystem === 'function') RPG.registerSystem({ id: 'core-combat', update: update, draw: draw });
  else (RPG._pendingSystems = RPG._pendingSystems || []).push({ id: 'core-combat', update: update, draw: draw });
})(typeof window !== 'undefined' ? window : globalThis);
