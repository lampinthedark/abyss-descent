/**
 * Enemy attack timing for Abyss Descent.
 * Live stats come from RPGContent.MONSTERS when that script is loaded,
 * otherwise the fallback table in ai-monsters.js (same shape).
 * Windup floors: field melee/ranged >= 400, brute slam/charge >= 600, Ashmaw >= 600.
 * Content windup is held on animation frame 0, and is always >= sheet ms[0].
 * Clip keys: melee/ranged `${sprite}_attack`, slam `${sprite}_slam`, charge `${sprite}_charge`.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});
  const ai = RPG.ai || (RPG.ai = {});

  /** Defaults, milliseconds. Used when a record has no windupMs. */
  const MELEE_MS = {
    rat: 400,
    goblin: 500,
    skeleton: 550,
    imp: 600,
    brute: 600,
    ashmaw: 650,
  };
  const MELEE_FLOOR = 400;
  const MELEE_IDS = ['rat', 'goblin', 'skeleton', 'imp', 'brute'];
  const REST_MS = 500;
  const CHARGE_HIT = 0.85;

  function contentRow(id) {
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

  function liveRow(id) {
    const C = root.RPGContent;
    const bag = C && C.MONSTERS;
    if (!bag || !id) return null;
    return bag[id] || null;
  }

  function externalRow(id) {
    const live = liveRow(id);
    const over = contentRow(id);
    if (!live && !over) return null;
    return Object.assign({}, live || {}, over || {});
  }

  function normalizeAttacks(raw) {
    const out = {};
    if (!raw) return out;
    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i++) {
        const row = raw[i];
        if (!row || !row.kind) continue;
        const k = row.kind === 'claw' ? 'melee' : row.kind;
        out[k] = Object.assign({}, row);
      }
      return out;
    }
    const keys = ['melee', 'ranged', 'attack', 'slam', 'charge'];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (raw[k]) out[k] = Object.assign({}, raw[k]);
    }
    return out;
  }

  function attacksOf(monsterId) {
    const spec = ai.specs && ai.specs[monsterId];
    const live = liveRow(monsterId);
    let out = normalizeAttacks(spec && spec.attacks);
    if (live && live.attacks) out = normalizeAttacks(live.attacks);
    const over = contentRow(monsterId);
    if (over && over.attacks) {
      const extra = normalizeAttacks(over.attacks);
      const keys = Object.keys(extra);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        out[k] = Object.assign({}, out[k] || {}, extra[k]);
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
    const use = kind === 'claw' ? 'melee' : (kind || 'melee');
    if (use === 'melee' || use === 'attack') return attacks.melee || attacks.attack || null;
    return attacks[use] || null;
  }

  function floorFor(monsterId, kind) {
    if (monsterId === 'ashmaw') return 600;
    if (kind === 'slam' || kind === 'charge') return 600;
    return MELEE_FLOOR;
  }

  function windupFor(monsterId, kind) {
    const use = kind || 'melee';
    let row = rowFor(monsterId, use);
    let animKind = use;
    if (!row && (use === 'melee' || use === 'attack' || use === 'claw')) {
      row = rowFor(monsterId, 'ranged');
      animKind = 'ranged';
    }
    const contentMs = row && typeof row.windupMs === 'number' ? row.windupMs : (MELEE_MS[monsterId] || floorFor(monsterId, use));
    const first = frame0Ms(monsterId, animKind);
    const ms = contentMs > first ? contentMs : first;
    const floor = floorFor(monsterId, use);
    return ms < floor ? floor : ms;
  }

  function windupMs(monsterId) {
    return windupFor(monsterId, 'melee');
  }

  function restMs() {
    const C = root.RPGContent;
    if (C && typeof C.REST_MS === 'number') return C.REST_MS;
    return REST_MS;
  }

  function enrageMult(mob) {
    if (!mob || !mob.enrage || !(mob.maxHp > 0)) return 1;
    const pct = (mob.hp / mob.maxHp) * 100;
    if (pct > mob.enrage.belowHpPct) return 1;
    const mult = mob.enrage.cooldownMult;
    return typeof mult === 'number' && mult > 0 ? mult : 1;
  }

  function armCooldown(mob, kind) {
    const row = rowFor(mob && mob.monsterId, kind);
    let cd = row && typeof row.cooldownMs === 'number' ? row.cooldownMs : restMs();
    const mult = enrageMult(mob);
    cd = cd * mult;
    if (!mob.cds) mob.cds = {};
    mob.cds[kind] = cd;
    mob.cdMs = restMs() * mult;
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
    const row = mob && rowFor(mob.monsterId, 'melee');
    const melee = row && typeof row.range === 'number' ? row.range : (mob && typeof mob.melee === 'number' ? mob.melee : 0.8);
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

  function hitInfo(mob, row, dmg) {
    const srcName = (row && row.srcName) || (mob && (mob.label || mob.name)) || '';
    return {
      amount: dmg,
      dmg: dmg,
      srcId: mob ? mob.id : '',
      monsterId: mob ? mob.monsterId : '',
      name: srcName || (mob ? mob.monsterId : ''),
      srcName: srcName,
      attack: row && (row.name || row.kind) || '',
      crit: false,
      target: 'hero',
    };
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
    const payload = info || hitInfo(mob, null, dmg);
    payload.amount = dmg;
    payload.dmg = dmg;
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

  function kindReady(mob, kind) {
    if (!mob) return false;
    if (mob.cdMs > 0) return false;
    if (mob.cds && mob.cds[kind] > 0) return false;
    return true;
  }

  function unit() {
    try {
      if (typeof RPG.rng === 'function') {
        const gen = RPG.rng('ai');
        if (typeof gen === 'function') {
          const n = gen();
          if (typeof n === 'number' && n === n) return n;
        }
      }
    } catch (err) {}
    return 0;
  }

  function chooseAttack(mob, hero) {
    if (!mob || !hero || hero.dead) return null;
    if (typeof hero.x !== 'number' || typeof hero.y !== 'number') return null;
    if (mob.cdMs > 0) return null;
    const d = dist(mob.x, mob.y, hero.x, hero.y);
    const pad = typeof hero.radius === 'number' ? hero.radius : 0;
    const melee = rowFor(mob.monsterId, 'melee');
    const ranged = attacksOf(mob.monsterId).ranged || null;
    const slam = rowFor(mob.monsterId, 'slam');
    const charge = rowFor(mob.monsterId, 'charge');
    if (melee && kindReady(mob, 'melee')) {
      const range = typeof melee.range === 'number' ? melee.range : (mob.melee || 0.8);
      if (d <= range + pad) return 'melee';
    }
    if (ranged && kindReady(mob, 'ranged')) {
      const min = typeof ranged.minRange === 'number' ? ranged.minRange : 0;
      const max = (typeof ranged.range === 'number' ? ranged.range : 4) + pad;
      if (d <= max && d >= min) return 'ranged';
    }
    const slamR = slam && (typeof slam.radius === 'number' ? slam.radius : slam.range);
    const inSlamBand = !!(slam && kindReady(mob, 'slam') && typeof slamR === 'number' && d <= slamR);
    const meleeEdge = melee && typeof melee.range === 'number' ? melee.range + pad : 0;
    const inChargeBand = !!(charge && kindReady(mob, 'charge') && typeof charge.range === 'number' && d <= charge.range && d > meleeEdge);
    if (inSlamBand && inChargeBand) return unit() < 0.5 ? 'slam' : 'charge';
    if (inSlamBand) return 'slam';
    if (inChargeBand) return 'charge';
    return null;
  }

  function bandHit(mob, kind) {
    const hero = heroOf();
    if (!heroLiving(hero) || typeof hero.x !== 'number') return false;
    const row = rowFor(mob.monsterId, kind);
    const range = row && typeof row.range === 'number' ? row.range : (mob.melee || 0.8);
    const min = row && typeof row.minRange === 'number' ? row.minRange : 0;
    const pad = typeof hero.radius === 'number' ? hero.radius : 0;
    const d = dist(mob.x, mob.y, hero.x, hero.y);
    return d <= range + pad && d + 0.0001 >= min;
  }

  function startMelee(mob, dtSec, kind) {
    const use = kind || (mob && mob.style === 'ranged' ? 'ranged' : 'melee');
    const ms = windupFor(mob.monsterId, use);
    mob.attackKind = use;
    mob.state = 'windup';
    mob.windupMs = ms;
    mob.windupElapsed = 0;
    pose(mob, use, 0);
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    holdWindup(mob);
    if (mob.windupElapsed >= mob.windupMs) return finishMelee(mob);
    return 'wind';
  }

  function finishMelee(mob) {
    const kind = mob.attackKind || (mob.style === 'ranged' ? 'ranged' : 'melee');
    const row = rowFor(mob.monsterId, kind);
    const hit = bandHit(mob, kind);
    const dmg = row && typeof row.dmg === 'number' ? row.dmg : mob.dmg;
    mob.state = mob.aggro ? 'chase' : 'wander';
    mob.windupElapsed = mob.windupMs;
    armCooldown(mob, kind);
    poseIdle(mob);
    if (hit) hurtHero(mob, dmg, hitInfo(mob, row, dmg));
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
    if (row && typeof row.range === 'number') return row.range;
    return 1.5;
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
    const row = rowFor(mob.monsterId, 'slam');
    const dmg = row && typeof row.dmg === 'number' ? row.dmg : mob.dmg;
    const hit = hero && heroLiving(hero) && dist(mob.x, mob.y, hero.x, hero.y) <= radius + pad;
    if (mob.tellId) clearTell(mob.tellId);
    mob.tellId = null;
    mob.slam = null;
    mob.state = mob.aggro ? 'chase' : 'wander';
    armCooldown(mob, 'slam');
    poseIdle(mob);
    if (hit) hurtHero(mob, dmg, hitInfo(mob, row, dmg));
    return hit ? 'hit' : 'whiff';
  }

  function startSlam(mob, dtSec) {
    const ms = windupFor(mob.monsterId, 'slam');
    mob.attackKind = 'slam';
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

  function distToSegment(px, py, line) {
    const x1 = line.x1;
    const y1 = line.y1;
    const x2 = line.x2;
    const y2 = line.y2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0.0001) return dist(px, py, x1, y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return dist(px, py, x1 + dx * t, y1 + dy * t);
  }

  function beginDash(mob) {
    const row = rowFor(mob.monsterId, 'charge');
    const line = mob.line;
    const hero = heroOf();
    const pad = hero && typeof hero.radius === 'number' ? hero.radius : 0;
    const dmg = row && typeof row.dmg === 'number' ? row.dmg : mob.dmg;
    const hit = !!(line && hero && heroLiving(hero) && distToSegment(hero.x, hero.y, line) <= CHARGE_HIT + pad);
    if (mob.tellId) clearTell(mob.tellId);
    mob.tellId = null;
    mob.slam = null;
    if (hit) hurtHero(mob, dmg, hitInfo(mob, row, dmg));
    mob.dashMs = row && typeof row.dashMs === 'number' ? row.dashMs : 240;
    mob.dashT = 0;
    mob.dashFrom = { x: mob.x, y: mob.y };
    mob.dashTo = line ? { x: line.x2, y: line.y2 } : { x: mob.x, y: mob.y };
    mob.line = null;
    mob.state = 'dash';
    pose(mob, 'charge', 1);
    return hit ? 'hit' : 'whiff';
  }

  function startCharge(mob, dtSec) {
    const row = rowFor(mob.monsterId, 'charge');
    const ms = windupFor(mob.monsterId, 'charge');
    const reach = row && typeof row.range === 'number' ? row.range : 5;
    const hero = heroOf() || { x: mob.x + 1, y: mob.y };
    const dx = hero.x - mob.x;
    const dy = hero.y - mob.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    mob.attackKind = 'charge';
    mob.state = 'charge';
    mob.windupMs = ms;
    mob.windupElapsed = 0;
    mob.serial = (mob.serial || 0) + 1;
    mob.tellId = mob.id + '-charge-' + mob.serial;
    mob.slam = null;
    mob.line = {
      x1: mob.x,
      y1: mob.y,
      x2: mob.x + (dx / len) * reach,
      y2: mob.y + (dy / len) * reach,
    };
    pose(mob, 'charge', 0);
    fx('telegraphLine', mob.line.x1, mob.line.y1, mob.line.x2, mob.line.y2, {
      id: mob.tellId,
      ms: ms,
      kind: 'charge',
    });
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    holdWindup(mob);
    if (mob.windupElapsed >= mob.windupMs) return beginDash(mob);
    return 'wind';
  }

  function advanceCharge(mob, dtSec) {
    if (!mob || mob.state !== 'charge') return null;
    const dtMs = (dtSec > 0 ? dtSec : 0) * 1000;
    mob.windupElapsed += dtMs;
    holdWindup(mob);
    if (mob.windupElapsed < mob.windupMs) return 'wind';
    return beginDash(mob);
  }

  function advanceDash(mob, dtSec) {
    if (!mob || mob.state !== 'dash') return null;
    pose(mob, 'charge', 1);
    const ms = mob.dashMs > 0 ? mob.dashMs : 240;
    mob.dashT = (mob.dashT || 0) + (dtSec > 0 ? dtSec : 0) * 1000;
    const t = mob.dashT >= ms ? 1 : mob.dashT / ms;
    const from = mob.dashFrom || { x: mob.x, y: mob.y };
    const to = mob.dashTo || from;
    const nx = from.x + (to.x - from.x) * t;
    const ny = from.y + (to.y - from.y) * t;
    let blocked = false;
    const world = RPG.world;
    if (world && typeof world.isBlocked === 'function') {
      try { blocked = !!world.isBlocked(nx, ny); } catch (err) { blocked = false; }
    }
    if (!blocked) {
      mob.x = nx;
      mob.y = ny;
    }
    if (t >= 1 || blocked) {
      armCooldown(mob, 'charge');
      mob.state = mob.aggro ? 'chase' : 'wander';
      mob.dashFrom = null;
      mob.dashTo = null;
      poseIdle(mob);
      return 'done';
    }
    return 'dash';
  }

  function cancelCharge(mob) {
    if (!mob) return;
    if (mob.tellId) clearTell(mob.tellId);
    mob.tellId = null;
    mob.line = null;
    mob.dashFrom = null;
    mob.dashTo = null;
    poseIdle(mob);
  }

  function shouldKite(mob, hero) {
    if (!mob || !hero) return false;
    const attacks = attacksOf(mob.monsterId);
    if (!attacks.ranged || attacks.melee) return false;
    if (typeof hero.x !== 'number') return false;
    return dist(mob.x, mob.y, hero.x, hero.y) < 4;
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
    chooseAttack: chooseAttack,
    shouldKite: shouldKite,
    startMelee: startMelee,
    advanceMelee: advanceMelee,
    cancelMelee: cancelMelee,
    startSlam: startSlam,
    advanceSlam: advanceSlam,
    cancelSlam: cancelSlam,
    startCharge: startCharge,
    advanceCharge: advanceCharge,
    advanceDash: advanceDash,
    cancelCharge: cancelCharge,
    fx: fx,
    clearTell: clearTell,
  };
  ai.meleeWindupMs = windupMs;
})(typeof window !== 'undefined' ? window : globalThis);
