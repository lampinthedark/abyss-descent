/**
 * Enemy attack timing for Abyss Descent.
 * Melee windups never resolve before 400ms. Sheet attack clips
 * (mob_<id>_attack) replace the default when they are longer.
 * Boss slam / charge timings live in boss-ashmaw.js.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});
  const ai = RPG.ai || (RPG.ai = {});

  /** Defaults, milliseconds. Used when the sheet has no attack clip. */
  const MELEE_MS = {
    rat: 450,
    goblin: 480,
    skeleton: 520,
    imp: 420,
    brute: 560,
  };
  const MELEE_FLOOR = 400;
  const MELEE_IDS = ['rat', 'goblin', 'skeleton', 'imp', 'brute'];

  function attackKey(monsterId) {
    return 'mob_' + monsterId + '_attack';
  }

  function sheetAttackMs(monsterId) {
    const sheet = RPG.sheet || root.SHEET;
    if (!sheet || !monsterId) return 0;
    const key = attackKey(monsterId);
    const anims = sheet.anims || sheet.animations || {};
    const anim = anims[key];
    if (anim) {
      if (typeof anim.duration === 'number') return anim.duration;
      if (typeof anim.durationMs === 'number') return anim.durationMs;
      if (typeof anim.ms === 'number') return anim.ms;
      if (Array.isArray(anim.frames) && typeof anim.frameMs === 'number') {
        return anim.frames.length * anim.frameMs;
      }
    }
    const frames = sheet.frames || {};
    const names = Object.keys(frames);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (name !== key && name.indexOf(key + '_') !== 0 && name.indexOf(key + '/') !== 0) continue;
      count++;
      const fr = frames[name];
      const d = fr && (fr.duration || fr.durationMs || fr.ms);
      if (typeof d === 'number') sum += d;
    }
    if (sum > 0) return sum;
    if (count > 0 && typeof sheet.frameMs === 'number') return count * sheet.frameMs;
    return 0;
  }

  function windupMs(monsterId) {
    const fromSheet = sheetAttackMs(monsterId);
    const chosen = fromSheet > 0 ? fromSheet : (MELEE_MS[monsterId] || MELEE_FLOOR);
    return chosen < MELEE_FLOOR ? MELEE_FLOOR : chosen;
  }

  function fx(name) {
    const args = [name];
    for (let i = 1; i < arguments.length; i++) args.push(arguments[i]);
    if (typeof RPG.fx === 'function') {
      try { return RPG.fx.apply(RPG, args); } catch (err) { return null; }
    }
    const FX = root.FX;
    if (!FX) return null;
    const fn = FX[name];
    if (typeof fn !== 'function') return null;
    try { return fn.apply(FX, args.slice(1)); } catch (err) { return null; }
  }

  function clearTell(id) {
    if (id == null) return;
    fx('telegraphOff', id);
  }

  function heroOf() {
    return RPG.hero || null;
  }

  function reach(mob, hero) {
    const melee = typeof mob.melee === 'number' ? mob.melee : 0.8;
    const radius = hero && typeof hero.radius === 'number' ? hero.radius : 0;
    return melee + radius;
  }

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function inReach(mob, hero) {
    if (!mob || !hero) return false;
    if (typeof hero.x !== 'number' || typeof hero.y !== 'number') return false;
    return dist(mob.x, mob.y, hero.x, hero.y) <= reach(mob, hero);
  }

  function heroLiving(hero) {
    if (!hero || hero.dead) return false;
    if (typeof hero.hp === 'number' && hero.hp <= 0) return false;
    if (typeof hero.hp !== 'number' && typeof hero.life === 'number' && hero.life <= 0) return false;
    return true;
  }

  /**
   * Apply a hit to the hero. Core should implement hero.takeHit and emit `hurt`
   * from there. We do not emit hurt ourselves.
   */
  function hurtHero(mob, amount, info) {
    const hero = heroOf();
    if (!heroLiving(hero)) return false;
    const dmg = typeof amount === 'number' ? amount : (mob && mob.dmg) || 0;
    if (!(dmg > 0)) return false;
    const payload = info || {
      amount: dmg,
      dmg: dmg,
      srcId: mob ? mob.id : '',
      monsterId: mob ? mob.monsterId : '',
      name: mob ? (mob.label || mob.monsterId) : '',
      crit: false,
      target: 'hero',
    };
    if (typeof hero.takeHit === 'function') {
      try { hero.takeHit(dmg, payload); } catch (err) {}
      return true;
    }
    if (typeof hero.hp === 'number') {
      hero.hp -= dmg;
      return true;
    }
    if (typeof hero.life === 'number') {
      hero.life -= dmg;
      return true;
    }
    return false;
  }

  function startMelee(mob, dtSec) {
    const ms = windupMs(mob.monsterId);
    mob.state = 'windup';
    mob.windupMs = ms;
    mob.windupElapsed = 0;
    mob.anim = 'attack';
    mob.animKey = attackKey(mob.monsterId);
    mob.attacking = true;
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    if (mob.windupElapsed >= mob.windupMs) return finishMelee(mob);
    return 'wind';
  }

  function finishMelee(mob) {
    const hero = heroOf();
    const hit = inReach(mob, hero) && heroLiving(hero);
    mob.state = mob.aggro ? 'chase' : 'wander';
    mob.attacking = false;
    mob.anim = 'idle';
    mob.windupElapsed = mob.windupMs;
    mob.cdMs = 420;
    if (hit) hurtHero(mob, mob.dmg);
    return hit ? 'hit' : 'whiff';
  }

  function advanceMelee(mob, dtSec) {
    if (!mob || mob.state !== 'windup') return null;
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    if (mob.windupElapsed < mob.windupMs) return 'wind';
    return finishMelee(mob);
  }

  function cancelMelee(mob) {
    if (!mob || mob.state !== 'windup') return;
    mob.state = 'return';
    mob.attacking = false;
    mob.anim = 'idle';
  }

  ai.attacks = {
    MELEE_FLOOR: MELEE_FLOOR,
    MELEE_MS: MELEE_MS,
    MELEE_IDS: MELEE_IDS,
    windupMs: windupMs,
    attackKey: attackKey,
    sheetAttackMs: sheetAttackMs,
    inReach: inReach,
    hurtHero: hurtHero,
    startMelee: startMelee,
    advanceMelee: advanceMelee,
    cancelMelee: cancelMelee,
    fx: fx,
    clearTell: clearTell,
  };
  ai.meleeWindupMs = windupMs;
})(typeof window !== 'undefined' ? window : globalThis);
