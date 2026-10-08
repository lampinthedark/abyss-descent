/**
 * Enemy attack timing for Abyss Descent.
 * Live windupMs comes from content (melee/ranged >= 400, slam/charge >= 600).
 * Content windup is held on animation frame 0, and is always >= sheet ms[0].
 * Clip keys: melee/ranged `${sprite}_attack`, slam `${sprite}_slam`, charge `${sprite}_charge`.
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

  function externalRow(id) {
    const content = RPG.content;
    if (!content || !id) return null;
    const bag = content.monsters || content.mobs;
    if (!bag) return null;
    if (Array.isArray(bag)) {
      for (let i = 0; i < bag.length; i++) {
        const row = bag[i];
        if (row && (row.id === id || row.monsterId === id)) return row;
      }
      return null;
    }
    return bag[id] || null;
  }

  function attacksOf(monsterId) {
    const spec = ai.specs && ai.specs[monsterId];
    const base = (spec && spec.attacks) || {};
    const over = (externalRow(monsterId) && externalRow(monsterId).attacks) || {};
    const keys = ['melee', 'ranged', 'attack', 'slam', 'charge'];
    const out = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!base[k] && !over[k]) continue;
      out[k] = {};
      const src = [base[k] || {}, over[k] || {}];
      for (let s = 0; s < src.length; s++) {
        const row = src[s];
        for (const name in row) {
          if (Object.prototype.hasOwnProperty.call(row, name)) out[k][name] = row[name];
        }
      }
    }
    return out;
  }

  function spriteOf(monsterId) {
    const ext = externalRow(monsterId);
    if (ext && ext.sprite) return ext.sprite;
    const spec = ai.specs && ai.specs[monsterId];
    if (spec && spec.sprite) return spec.sprite;
    return 'mob_' + monsterId;
  }

  function sheetPackOf(monsterId) {
    const ext = externalRow(monsterId);
    if (ext && (ext.sheet || ext.atlas)) return ext.sheet || ext.atlas;
    const spec = ai.specs && ai.specs[monsterId];
    if (spec && spec.sheet) return spec.sheet;
    if (monsterId === 'rat' || monsterId === 'goblin') return 'mobs';
    return 'mobs2';
  }

  function suffixFor(kind) {
    if (!kind || kind === 'melee' || kind === 'ranged' || kind === 'claw' || kind === 'attack') return 'attack';
    return kind;
  }

  function animKeyFor(monsterId, kind) {
    return spriteOf(monsterId) + '_' + suffixFor(kind);
  }

  function attackKey(monsterId) {
    return animKeyFor(monsterId, 'attack');
  }

  function nestedSheet(pack) {
    const sheets = RPG.sheets;
    if (sheets && sheets[pack]) return sheets[pack];
    const sheet = RPG.sheet || root.SHEET;
    if (!sheet || !pack) return null;
    const nested = sheet[pack];
    if (nested && (nested.frames || nested.anims || nested.animations || nested.keys)) return nested;
    return null;
  }

  function flatSheet() {
    const sheet = RPG.sheet || root.SHEET;
    if (!sheet) return null;
    if (sheet.frames || sheet.anims || sheet.animations || sheet.keys) return sheet;
    return null;
  }

  /** Field rats/goblins read `mobs`. Dungeon ids read `mobs2` when that atlas exists. */
  function atlasFor(pack) {
    const nested = nestedSheet(pack);
    if (nested) return nested;
    if (pack === 'mobs2' && nestedSheet('mobs2')) return null;
    if (pack === 'mobs' && nestedSheet('mobs')) return null;
    return flatSheet();
  }

  function animRecord(atlas, key) {
    if (!atlas || !key) return null;
    const anims = atlas.anims || atlas.animations;
    if (anims && anims[key]) return anims[key];
    if (atlas.frames && atlas.frames[key]) return atlas.frames[key];
    if (atlas.keys && atlas.keys[key]) return atlas.keys[key];
    return null;
  }

  function clipReady(pack, key) {
    return !!animRecord(atlasFor(pack), key);
  }

  function frame0Ms(monsterId, kind) {
    const pack = sheetPackOf(monsterId);
    const anim = animRecord(atlasFor(pack), animKeyFor(monsterId, kind));
    if (!anim) return 0;
    if (Array.isArray(anim.ms) && typeof anim.ms[0] === 'number') return anim.ms[0];
    if (Array.isArray(anim.frames)) {
      const frame = anim.frames[0];
      if (typeof frame === 'number') return frame;
      if (frame && typeof frame.ms === 'number') return frame.ms;
      if (frame && typeof frame.duration === 'number') return frame.duration;
    }
    return 0;
  }

  function rowFor(monsterId, kind) {
    const attacks = attacksOf(monsterId);
    const suffix = suffixFor(kind);
    if (suffix === 'attack') return attacks.melee || attacks.ranged || attacks.attack || null;
    return attacks[kind] || attacks[suffix] || null;
  }

  function floorFor(kind) {
    if (kind === 'slam' || kind === 'charge') return 600;
    return MELEE_FLOOR;
  }

  function windupFor(monsterId, kind) {
    const use = kind || 'melee';
    const row = rowFor(monsterId, use);
    const contentMs = row && typeof row.windupMs === 'number' ? row.windupMs : (MELEE_MS[monsterId] || floorFor(use));
    const first = frame0Ms(monsterId, use);
    const ms = contentMs > first ? contentMs : first;
    const floor = floorFor(use);
    return ms < floor ? floor : ms;
  }

  function windupMs(monsterId) {
    return windupFor(monsterId, 'melee');
  }

  function pose(mob, kind, frame) {
    if (!mob) return;
    const suffix = suffixFor(kind);
    const sprite = mob.sprite || spriteOf(mob.monsterId);
    mob.anim = suffix;
    mob.animKey = sprite + '_' + suffix;
    mob.animFrame = frame;
    mob.holdFrame = frame;
    mob.attacking = true;
  }

  function poseIdle(mob) {
    if (!mob) return;
    mob.anim = 'idle';
    mob.animKey = (mob.sheet && mob.sheet.idle) || ((mob.sprite || spriteOf(mob.monsterId)) + '_idle');
    mob.animFrame = 0;
    mob.holdFrame = 0;
    mob.attacking = false;
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

  function holdWindup(mob) {
    mob.animFrame = 0;
    mob.holdFrame = 0;
  }

  function startMelee(mob, dtSec) {
    const kind = mob && mob.style === 'ranged' ? 'ranged' : 'melee';
    const ms = windupFor(mob.monsterId, kind);
    mob.state = 'windup';
    mob.windupMs = ms;
    mob.windupElapsed = 0;
    pose(mob, kind, 0);
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    holdWindup(mob);
    if (mob.windupElapsed >= mob.windupMs) return finishMelee(mob);
    return 'wind';
  }

  function finishMelee(mob) {
    const hero = heroOf();
    const hit = inReach(mob, hero) && heroLiving(hero);
    mob.state = mob.aggro ? 'chase' : 'wander';
    mob.windupElapsed = mob.windupMs;
    mob.cdMs = 420;
    poseIdle(mob);
    if (hit) hurtHero(mob, mob.dmg);
    return hit ? 'hit' : 'whiff';
  }

  function advanceMelee(mob, dtSec) {
    if (!mob || mob.state !== 'windup') return null;
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    holdWindup(mob);
    if (mob.windupElapsed < mob.windupMs) return 'wind';
    return finishMelee(mob);
  }

  function cancelMelee(mob) {
    if (!mob || mob.state !== 'windup') return;
    mob.state = 'return';
    poseIdle(mob);
  }

  function slamRadius(mob) {
    if (mob && typeof mob.slamR === 'number') return mob.slamR;
    const row = rowFor(mob && mob.monsterId, 'slam');
    if (row && typeof row.radius === 'number') return row.radius;
    return 2.1;
  }

  function inSlam(mob, hero) {
    if (!mob || !hero) return false;
    if (typeof hero.x !== 'number' || typeof hero.y !== 'number') return false;
    return dist(mob.x, mob.y, hero.x, hero.y) <= slamRadius(mob);
  }

  function finishSlam(mob) {
    const hero = heroOf();
    const radius = slamRadius(mob);
    const pad = hero && typeof hero.radius === 'number' ? hero.radius : 0;
    const hit = hero && heroLiving(hero) && dist(mob.x, mob.y, hero.x, hero.y) <= radius + pad;
    if (mob.tellId) clearTell(mob.tellId);
    mob.tellId = null;
    mob.slam = null;
    mob.state = mob.aggro ? 'chase' : 'wander';
    mob.cdMs = 700;
    poseIdle(mob);
    if (hit) hurtHero(mob, mob.dmg);
    return hit ? 'hit' : 'whiff';
  }

  function startSlam(mob, dtSec) {
    const ms = windupFor(mob.monsterId, 'slam');
    mob.state = 'slam';
    mob.windupMs = ms;
    mob.windupElapsed = 0;
    mob.serial = (mob.serial || 0) + 1;
    mob.tellId = mob.id + '-slam-' + mob.serial;
    mob.slam = { x: mob.x, y: mob.y, r: slamRadius(mob) };
    pose(mob, 'slam', 0);
    fx('telegraph', mob.x, mob.y, mob.slam.r, { id: mob.tellId, ms: ms, kind: 'slam' });
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    holdWindup(mob);
    if (mob.windupElapsed >= mob.windupMs) return finishSlam(mob);
    return 'wind';
  }

  function advanceSlam(mob, dtSec) {
    if (!mob || mob.state !== 'slam') return null;
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    holdWindup(mob);
    if (mob.windupElapsed < mob.windupMs) return 'wind';
    return finishSlam(mob);
  }

  function cancelSlam(mob) {
    if (!mob) return;
    if (mob.tellId) clearTell(mob.tellId);
    mob.tellId = null;
    mob.slam = null;
    poseIdle(mob);
  }

  ai.attacks = {
    MELEE_FLOOR: MELEE_FLOOR,
    MELEE_MS: MELEE_MS,
    MELEE_IDS: MELEE_IDS,
    windupMs: windupMs,
    windupFor: windupFor,
    attackKey: attackKey,
    animKeyFor: animKeyFor,
    attacksOf: attacksOf,
    clipReady: clipReady,
    frame0Ms: frame0Ms,
    pose: pose,
    poseIdle: poseIdle,
    inReach: inReach,
    inSlam: inSlam,
    slamRadius: slamRadius,
    hurtHero: hurtHero,
    startMelee: startMelee,
    advanceMelee: advanceMelee,
    cancelMelee: cancelMelee,
    startSlam: startSlam,
    advanceSlam: advanceSlam,
    cancelSlam: cancelSlam,
    fx: fx,
    clearTell: clearTell,
  };
  ai.meleeWindupMs = windupMs;
})(typeof window !== 'undefined' ? window : globalThis);
