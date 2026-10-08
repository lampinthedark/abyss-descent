/**
 * Field monsters: wander, aggro, pack alert, leash, A* chase.
 * GD entry: RPG.ai.spawnPack(monsterId, x, y, n, leash)
 * Also Monsters.spawnField(zoneOrPoints) for the goblin field outside town.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});
  const ai = RPG.ai || (RPG.ai = {});

  // Fallback when RPGContent.MONSTERS is not loaded. Numbers match that table.
  const SPECS = {
    rat: {
      id: 'rat', label: 'Plague Rat', hp: 10, def: 0, atk: 1, dmg: 1, speed: 2.4,
      sight: 3, leash: 7, melee: 1, pack: [2, 3], radius: 0.28, color: '#8d7b5a',
      elite: false, boss: false, sprite: 'mob_rat', sheet: 'mobs',
      attacks: {
        melee: { kind: 'melee', anim: 'mob_rat_attack', dmg: 1, range: 1, windupMs: 400, cooldownMs: 1400, srcName: 'Plague Rat' },
      },
    },
    goblin: {
      id: 'goblin', label: 'Ditch Goblin', hp: 22, def: 3, atk: 8, dmg: 2, speed: 2.0,
      sight: 4, leash: 8, melee: 1, pack: [2, 3], radius: 0.32, color: '#6f8f3a',
      elite: false, boss: false, sprite: 'mob_goblin', sheet: 'mobs',
      attacks: {
        melee: { kind: 'melee', anim: 'mob_goblin_attack', dmg: 2, range: 1, windupMs: 500, cooldownMs: 2300, srcName: 'Ditch Goblin' },
        ranged: { kind: 'ranged', anim: 'mob_goblin_attack', dmg: 2, range: 4, windupMs: 700, cooldownMs: 7000, minRange: 2, projectile: 'rock', srcName: 'Ditch Goblin' },
      },
    },
    skeleton: {
      id: 'skeleton', label: 'Rattlebone Skeleton', hp: 100, def: 10, atk: 14, dmg: 2, speed: 1.6,
      sight: 5, leash: 9, melee: 1, pack: [2, 3], radius: 0.32, color: '#d9d3c4',
      elite: false, boss: false, sprite: 'mob_skeleton', sheet: 'mobs2',
      attacks: {
        melee: { kind: 'melee', anim: 'mob_skeleton_attack', dmg: 2, range: 1, windupMs: 550, cooldownMs: 2600, srcName: 'Rattlebone Skeleton' },
      },
    },
    imp: {
      id: 'imp', label: 'Cinder Imp', hp: 65, def: 8, atk: 18, dmg: 3, speed: 2.4,
      sight: 6, leash: 10, melee: 5, pack: [2, 3], radius: 0.26, color: '#d15a34',
      elite: false, boss: false, sprite: 'mob_imp', sheet: 'mobs2', style: 'ranged',
      attacks: {
        ranged: { kind: 'ranged', anim: 'mob_imp_attack', dmg: 3, range: 5, windupMs: 600, cooldownMs: 2600, projectile: 'ember', srcName: 'Cinder Imp' },
      },
    },
    brute: {
      id: 'brute', label: 'Grave Brute', hp: 300, def: 14, atk: 24, dmg: 3, speed: 1.4,
      sight: 6, leash: 12, melee: 1, pack: [1, 1], radius: 0.46, color: '#6b5246',
      elite: true, boss: false, sprite: 'mob_brute', sheet: 'mobs2',
      attacks: {
        slam: { kind: 'slam', anim: 'mob_brute_slam', dmg: 22, range: 1.5, radius: 1.5, windupMs: 800, cooldownMs: 7000, telegraph: 'ring', srcName: 'Grave Brute' },
        charge: { kind: 'charge', anim: 'mob_brute_charge', dmg: 18, range: 5, windupMs: 700, cooldownMs: 9000, telegraph: 'line', dashMs: 240, srcName: 'Grave Brute' },
        melee: { kind: 'melee', anim: 'mob_brute_attack', dmg: 3, range: 1, windupMs: 600, cooldownMs: 1800, srcName: 'Grave Brute' },
      },
    },
    ashmaw: {
      id: 'ashmaw', label: 'Ashmaw the Wyrmling', hp: 960, def: 8, atk: 30, dmg: 5, speed: 1.6,
      sight: 8, leash: 99, melee: 1.2, pack: [1, 1], radius: 0.7, color: '#8e2e2e',
      elite: false, boss: true, sprite: 'mob_ashmaw', sheet: 'mobs2',
      enrage: { belowHpPct: 30, cooldownMult: 0.75 },
      attacks: {
        slam: { kind: 'slam', anim: 'mob_ashmaw_slam', dmg: 24, range: 2.5, radius: 2.5, windupMs: 1000, cooldownMs: 8000, telegraph: 'ring', name: 'Cinder Ring', srcName: 'Ashmaw the Wyrmling' },
        charge: { kind: 'charge', anim: 'mob_ashmaw_charge', dmg: 20, range: 7, windupMs: 900, cooldownMs: 11000, telegraph: 'line', name: 'Ash Rush', dashMs: 240, srcName: 'Ashmaw the Wyrmling' },
        melee: { kind: 'melee', anim: 'mob_ashmaw_attack', dmg: 5, range: 1.2, windupMs: 650, cooldownMs: 2000, name: 'Claw', srcName: 'Ashmaw the Wyrmling' },
      },
    },
  };

  /** Placeholder outside-town field. Pass real tiles from the town exit. */
  const FIELD = [
    { monsterId: 'rat', x: 18, y: 14, n: 3, leash: 7 },
    { monsterId: 'goblin', x: 24, y: 16, n: 4, leash: 9 },
    { monsterId: 'goblin', x: 22, y: 22, n: 3, leash: 9 },
    { monsterId: 'rat', x: 28, y: 20, n: 2, leash: 7 },
  ];

  const mobs = [];
  let seq = 1;
  let packSeq = 1;
  const SUBSTEP = 0.05;

  function attacks() {
    return ai.attacks || null;
  }

  function roll(stream) {
    try {
      if (typeof RPG.rng === 'function') {
        const gen = RPG.rng(stream || 'ai');
        if (typeof gen === 'function') {
          const n = gen();
          if (typeof n === 'number' && n === n) return n;
        }
      }
    } catch (err) {}
    return fallbackRng(stream || 'ai');
  }

  const seeds = { ai: 127, loot: 311 };
  function fallbackRng(stream) {
    let s = seeds[stream] || 127;
    s = (s * 1664525 + 1013904223) >>> 0;
    seeds[stream] = s;
    return s / 4294967296;
  }

  function contentOverride(id) {
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
    const bag = root.RPGContent && root.RPGContent.MONSTERS;
    if (!bag || !id) return null;
    return bag[id] || null;
  }

  function firstNum() {
    for (let i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] === 'number') return arguments[i];
    }
    return 0;
  }

  function mergedSpec(id) {
    const base = SPECS[id];
    const live = liveRow(id);
    const over = contentOverride(id);
    if (!base && !live && !over) return null;
    const src = live || {};
    const o = over || {};
    const seed = base || {
      id: id,
      label: id,
      hp: 10,
      def: 0,
      atk: 1,
      dmg: 1,
      speed: 1.6,
      sight: 4,
      leash: 8,
      melee: 1,
      pack: [1, 1],
      radius: 0.32,
      color: '#888888',
      elite: false,
      boss: false,
      sprite: 'mob_' + id,
      sheet: id === 'rat' || id === 'goblin' ? 'mobs' : 'mobs2',
      attacks: {},
    };
    const atkApi = attacks();
    const rows = atkApi && typeof atkApi.attacksOf === 'function' ? atkApi.attacksOf(id) : (seed.attacks || {});
    const meleeRange = rows.melee && typeof rows.melee.range === 'number'
      ? rows.melee.range
      : (rows.ranged && typeof rows.ranged.range === 'number' ? rows.ranged.range : seed.melee);
    const style = rows.melee ? 'melee' : (rows.ranged ? 'ranged' : (seed.style || 'melee'));
    const primary = rows.melee || rows.ranged || rows.slam || rows.charge;
    return {
      id: id,
      label: o.name || src.name || seed.label,
      hp: firstNum(o.hp, src.hp, seed.hp),
      def: firstNum(o.def, src.def, seed.def),
      atk: firstNum(o.atk, src.atk, seed.atk),
      dmg: primary && typeof primary.dmg === 'number' ? primary.dmg : seed.dmg,
      speed: firstNum(o.speed, src.speed, seed.speed),
      sight: firstNum(o.aggro, src.aggro, o.sight, src.sight, seed.sight),
      leash: firstNum(o.leash, src.leash, seed.leash),
      melee: meleeRange,
      pack: o.pack || src.pack || seed.pack,
      radius: seed.radius,
      color: seed.color,
      elite: typeof o.elite === 'boolean' ? o.elite : (typeof src.elite === 'boolean' ? src.elite : !!seed.elite),
      boss: typeof o.boss === 'boolean' ? o.boss : (typeof src.boss === 'boolean' ? src.boss : !!seed.boss),
      sprite: canonSprite(id, o.sprite || src.sprite || seed.sprite),
      sheet: o.sheet || o.atlas || src.sheet || src.atlas || seed.sheet,
      style: style,
      enrage: o.enrage || src.enrage || seed.enrage || null,
      attacks: rows,
    };
  }

  function attacksOf(spec) {
    const atk = ai.attacks;
    if (atk && typeof atk.attacksOf === 'function') return atk.attacksOf(spec.id);
    return (spec && spec.attacks) || {};
  }

  function canonSprite(monsterId, sprite) {
    if (monsterId === 'ashmaw' || sprite === 'mob_boss') return 'mob_ashmaw';
    return sprite || ('mob_' + monsterId);
  }

  function optionalClip(sprite, suffix, idle) {
    const key = sprite + '_' + suffix;
    const atk = ai.attacks;
    if (atk && typeof atk.clipOnMobs2 === 'function' && atk.clipOnMobs2(key)) return key;
    return idle;
  }

  function sheetKeysFor(sprite, attacks, monsterId) {
    const atk = ai.attacks;
    const clip = function (kind, fallback) {
      if (atk && typeof atk.animKeyFor === 'function') return atk.animKeyFor(monsterId, kind);
      return fallback;
    };
    const idle = sprite + '_idle';
    const keys = {
      idle: idle,
      walk: sprite + '_walk',
      attack: sprite + '_attack',
    };
    if (attacks.melee) keys.attack = clip('melee', keys.attack);
    else if (attacks.ranged) keys.attack = clip('ranged', keys.attack);
    if (attacks.slam) keys.slam = clip('slam', sprite + '_slam');
    if (attacks.charge) keys.charge = clip('charge', sprite + '_charge');
    keys.hurt = optionalClip(sprite, 'hurt', idle);
    keys.death = optionalClip(sprite, 'death', idle);
    if (sprite === 'mob_goblin') keys.throw = optionalClip(sprite, 'throw', idle);
    return keys;
  }

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function blocked(x, y) {
    const world = RPG.world;
    if (!world || typeof world.isBlocked !== 'function') return false;
    try { return !!world.isBlocked(x, y); } catch (err) { return false; }
  }

  /** D1 exports this from main.js onto the world. Missing means the tile is clear. */
  function clearOfKeepOut(x, y) {
    const world = RPG.world;
    if (!world || typeof world.clearOfKeepOut !== 'function') return true;
    try { return !!world.clearOfKeepOut(x, y); } catch (err) { return true; }
  }

  function inArea(area, x, y) {
    if (!area) return true;
    return x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1;
  }

  function spotOk(x, y, area) {
    if (!inArea(area, x, y)) return false;
    if (!clearOfKeepOut(x, y)) return false;
    if (blocked(x, y)) return false;
    return true;
  }

  function placeIn(x, y, area, i) {
    const spread = [0, 0.45, -0.45, 0.9, -0.9];
    const ox = spread[i % spread.length];
    const oy = spread[Math.floor(i / spread.length) % spread.length] * 0.35;
    const first = { x: x + ox, y: y + oy };
    if (spotOk(first.x, first.y, area)) return first;
    if (spotOk(x, y, area)) return { x: x, y: y };
    const box = area || { x0: x - 2, y0: y - 2, x1: x + 2, y1: y + 2 };
    for (let yy = box.y0; yy <= box.y1 + 0.001; yy += 0.5) {
      for (let xx = box.x0; xx <= box.x1 + 0.001; xx += 0.5) {
        if (spotOk(xx, yy, area)) return { x: xx, y: yy };
      }
    }
    return { x: x, y: y };
  }

  /**
   * Core's renderer draws e.sprite (a full sheet key) at e.frame, or loops it
   * every e.anim ms, mirrored by e.flip (frames face left). Our own state lives
   * in spriteBase / pose / animKey / animFrame; this mirrors it each tick.
   */
  function sheetHas(key, pack) {
    if (!key) return false;
    const S = root.Sheet;
    if (S && typeof S.has === 'function' && S.has(key)) return true;
    const atk = ai.attacks;
    return !!(pack && atk && typeof atk.clipReady === 'function' && atk.clipReady(pack, key));
  }

  function loopMs(key, fallback) {
    const S = root.Sheet;
    const rec = S && typeof S.get === 'function' ? S.get(key) : null;
    if (rec && Array.isArray(rec.ms) && typeof rec.ms[0] === 'number' && rec.ms[0] > 0) return rec.ms[0];
    return fallback;
  }

  function syncRender(mob) {
    if (!mob) return;
    const keys = mob.sheet || {};
    const pack = mob.sheetPack;
    const idle = keys.idle || ((mob.spriteBase || 'mob') + '_idle');
    let key = mob.animKey || idle;
    if (!sheetHas(key, pack)) {
      const walk = keys.walk;
      key = (mob.pose === 'walk' && sheetHas(walk, pack)) ? walk : idle;
    }
    if (mob.pose === 'walk' && keys.walk && sheetHas(keys.walk, pack) && key === idle) key = keys.walk;
    mob.sprite = key;
    const looping = !mob.dead && (mob.pose === 'idle' || mob.pose === 'walk');
    if (looping) {
      mob.anim = loopMs(key, mob.pose === 'walk' ? 150 : 360);
      mob.frame = 0;
    } else {
      mob.anim = 0;
      mob.frame = mob.holdFrame != null && mob.dead ? mob.holdFrame : (mob.animFrame | 0);
    }
    mob.flip = (mob.facing || 0) > 0;
    const ready = sheetHas(key, pack) || sheetHas(keys.attack, pack);
    mob.placeholder = !ready;
    if (mob.render) mob.render.mode = ready ? 'sheet' : 'box';
  }

  function addToWorld(ent) {
    syncRender(ent);
    const world = RPG.world;
    if (!world || typeof world.addEntity !== 'function') return;
    try { world.addEntity(ent); } catch (err) {}
  }

  function removeFromWorld(ent) {
    const world = RPG.world;
    if (!world || typeof world.removeEntity !== 'function') return;
    try { world.removeEntity(ent); } catch (err) {}
  }

  function requestPath(mob, tx, ty) {
    let path = null;
    const world = RPG.world;
    if (world && typeof world.path === 'function') {
      try {
        if (world.path.length >= 4) path = world.path(mob.x, mob.y, tx, ty);
        else path = world.path({ x: mob.x, y: mob.y }, { x: tx, y: ty });
      } catch (err) { path = null; }
    }
    if (!Array.isArray(path) || !path.length) path = [{ x: tx, y: ty }];
    const out = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      if (dist(p.x, p.y, mob.x, mob.y) <= 0.12) continue;
      out.push({ x: p.x, y: p.y });
    }
    if (!out.length) out.push({ x: tx, y: ty });
    return out;
  }

  function moveToward(mob, dt, tx, ty) {
    const goalMoved = mob._goalX == null || dist(mob._goalX, mob._goalY, tx, ty) > 0.45;
    mob._repath = (mob._repath || 0) - dt;
    if (!mob.path || !mob.path.length || goalMoved || mob._repath <= 0) {
      mob._goalX = tx;
      mob._goalY = ty;
      mob._repath = 0.35;
      mob.path = requestPath(mob, tx, ty);
    }
    const wp = mob.path[0];
    if (!wp) return;
    if (step(mob, wp.x, wp.y, dt)) mob.path.shift();
  }

  function step(mob, tx, ty, dt) {
    const dx = tx - mob.x;
    const dy = ty - mob.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.04) return true;
    const mag = Math.min(mob.speed * dt, d);
    const nx = mob.x + (dx / d) * mag;
    const ny = mob.y + (dy / d) * mag;
    const wandering = !mob.aggro && mob.state !== 'return' && mob.state !== 'chase';
    function legal(px, py) {
      if (!clearOfKeepOut(px, py)) return false;
      if (blocked(px, py)) return false;
      if (wandering && mob.area && !inArea(mob.area, px, py)) return false;
      return true;
    }
    if (legal(nx, ny)) {
      mob.x = nx;
      mob.y = ny;
    } else if (legal(nx, mob.y)) {
      mob.x = nx;
    } else if (legal(mob.x, ny)) {
      mob.y = ny;
    } else {
      mob.path = null;
      mob._repath = 0;
      if (mob.aggro && !clearOfKeepOut(nx, ny)) mob._giveUp = true;
      return false;
    }
    if (dx !== 0) mob.facing = dx > 0 ? 1 : -1;
    if (!mob.attacking) {
      mob.pose = 'walk';
      if (mob.sheet && mob.sheet.walk) mob.animKey = mob.sheet.walk;
      mob.animFrame = 0;
    }
    return dist(mob.x, mob.y, tx, ty) < 0.04;
  }

  function homeDist(mob) {
    return dist(mob.x, mob.y, mob.spawnX, mob.spawnY);
  }

  function heroPos() {
    const hero = RPG.hero;
    if (!hero || typeof hero.x !== 'number' || typeof hero.y !== 'number') return null;
    return hero;
  }

  const FIELD_CAP = 2;

  function pairChasers() {
    let n = 0;
    for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i];
      if (m && !m.dead && m.scope === 'pair' && m.aggro) n++;
    }
    return n;
  }

  function alertPack(mob) {
    let slots = mob.scope === 'pair' ? Math.max(0, FIELD_CAP - pairChasers()) : 99;
    for (let i = 0; i < mobs.length; i++) {
      const other = mobs[i];
      if (!other || other.dead) continue;
      if (other.packId !== mob.packId) continue;
      if (other.state === 'return') continue;
      if (!other.aggro) {
        if (mob.scope === 'pair') {
          if (slots <= 0) continue;
          slots -= 1;
        }
        other.aggro = true;
      }
      if (other.state !== 'windup' && other.state !== 'slam' && other.state !== 'charge' && other.state !== 'dash' && other.state !== 'claw') {
        other.state = 'chase';
      }
    }
  }

  /** Town field uses tile Chebyshev, not the content sight radius. */
  function tileChebyshev(ax, ay, bx, by) {
    return Math.max(Math.abs(Math.floor(ax) - Math.floor(bx)), Math.abs(Math.floor(ay) - Math.floor(by)));
  }

  function seesHero(mob, hero) {
    if (typeof mob.townAggro === 'number') return tileChebyshev(mob.x, mob.y, hero.x, hero.y) <= mob.townAggro;
    return dist(mob.x, mob.y, hero.x, hero.y) <= mob.sight;
  }

  function sense(mob) {
    if (!mob || mob.dead || mob.state === 'return') return;
    const hero = heroPos();
    if (!hero || hero.dead) return;
    if (!seesHero(mob, hero)) return;
    if (!clearOfKeepOut(hero.x, hero.y)) return;
    if (mob.scope === 'pair' && !mob.aggro && pairChasers() >= FIELD_CAP) return;
    alertPack(mob);
  }

  function giveUpChase(mob) {
    const atk = attacks();
    if (mob.state === 'windup' && atk && atk.cancelMelee) atk.cancelMelee(mob);
    if (mob.state === 'slam' && atk && atk.cancelSlam) atk.cancelSlam(mob);
    if ((mob.state === 'charge' || mob.state === 'dash') && atk && atk.cancelCharge) atk.cancelCharge(mob);
    if (mob.tellId && atk && atk.clearTell) atk.clearTell(mob.tellId);
    mob.tellId = null;
    mob._giveUp = false;
    mob.aggro = false;
    mob.attacking = false;
    mob.state = 'wander';
    mob.path = null;
    mob.wanderTo = null;
    mob._repath = 0;
  }

  function startReturn(mob) {
    const atk = attacks();
    if (mob.state === 'windup' && atk && atk.cancelMelee) atk.cancelMelee(mob);
    if (mob.state === 'slam' && atk && atk.cancelSlam) atk.cancelSlam(mob);
    if ((mob.state === 'charge' || mob.state === 'dash') && atk && atk.cancelCharge) atk.cancelCharge(mob);
    if (mob.tellId && atk && atk.clearTell) atk.clearTell(mob.tellId);
    mob.tellId = null;
    mob.state = 'return';
    mob.aggro = false;
    mob.attacking = false;
    mob.pose = 'walk';
    mob.path = null;
    mob._repath = 0;
  }

  function applyKnock(mob, knock) {
    if (!knock) return;
    let kx = 0;
    let ky = 0;
    if (typeof knock === 'number') {
      const hero = heroPos();
      if (!hero) return;
      const dx = mob.x - hero.x;
      const dy = mob.y - hero.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      kx = (dx / d) * knock;
      ky = (dy / d) * knock;
    } else {
      kx = knock.x || 0;
      ky = knock.y || 0;
    }
    const nx = mob.x + kx;
    const ny = mob.y + ky;
    if (!blocked(nx, ny)) {
      mob.x = nx;
      mob.y = ny;
    }
  }

  function finishKill(mob) {
    if (mob._killEmitted) return;
    if (RPG.drops && typeof RPG.drops.onKill === 'function') {
      RPG.drops.onKill(mob);
      return;
    }
    mob._killEmitted = true;
    forget(mob);
    removeFromWorld(mob);
  }

  function poseLife(mob, which) {
    const idle = (mob.sheet && mob.sheet.idle) || ((mob.spriteBase || 'mob') + '_idle');
    const key = mob.sheet && mob.sheet[which];
    const clip = !!(key && key !== idle);
    mob.attacking = false;
    mob.corpse = false;
    if (!clip) {
      mob.pose = 'idle';
      mob.animKey = idle;
      mob.animFrame = 0;
      mob.holdFrame = 0;
      if (which === 'death' && mob.render) mob.render.mode = 'box';
      return;
    }
    mob.pose = which;
    mob.animKey = key;
    if (which === 'death') {
      const atk = ai.attacks;
      const last = atk && typeof atk.corpseFrame === 'function' ? atk.corpseFrame(key) : 0;
      mob.animFrame = last;
      mob.holdFrame = last;
      mob.corpse = true;
      return;
    }
    mob.animFrame = 0;
    mob.holdFrame = 0;
  }

  function takeHit(mob, dmg, info) {
    info = info || {};
    if (mob.dead) return { dead: true };
    const amount = Math.max(0, Number(dmg) || 0);
    mob.hp -= amount;
    if (info.crit) mob.lastCrit = true;
    if (info.srcId) mob.lastSrc = info.srcId;
    applyKnock(mob, info.knock);
    mob.hitFlash = 0.12;
    if (mob.state !== 'return' && !mob.boss) alertPack(mob);
    if (mob.hp <= 0) poseLife(mob, 'death');
    else poseLife(mob, 'hurt');
    if (mob.hp <= 0) mob.dead = true;
    syncRender(mob);
    if (mob.hp <= 0) {
      mob.hp = 0;
      mob.dead = true;
      mob.state = 'dead';
      mob.aggro = false;
      scheduleRespawn(mob);
      finishKill(mob);
      return { dead: true };
    }
    return { dead: false };
  }

  function decorate(mob, spec) {
    const attacks = attacksOf(spec);
    const sprite = canonSprite(spec.id, spec.sprite || ('mob_' + spec.id));
    const pack = spec.sheet || (spec.id === 'rat' || spec.id === 'goblin' ? 'mobs' : 'mobs2');
    const keys = sheetKeysFor(sprite, attacks, spec.id);
    const atk = ai.attacks;
    const ready = atk && typeof atk.clipReady === 'function' ? atk.clipReady(pack, keys.attack) : false;
    mob.spriteBase = sprite;
    mob.sheetPack = pack;
    mob.sheet = keys;
    mob.attacks = attacks;
    mob.slamR = attacks.slam && attacks.slam.radius;
    mob.label = spec.label;
    mob.color = spec.color;
    mob.style = spec.style || 'melee';
    mob.artKnown = pack === 'mobs';
    mob.placeholder = !ready;
    mob.animFrame = 0;
    mob.holdFrame = 0;
    mob.render = {
      mode: mob.placeholder ? 'box' : 'sheet',
      label: spec.label,
      fill: spec.color,
      keys: keys,
      sheet: pack,
    };
    mob.pose = 'idle';
    mob.animKey = keys.idle;
  }

  function createMob(spec, x, y, packId, leashR) {
    const mob = {
      id: spec.id + '-' + (seq++),
      kind: 'mob',
      monsterId: spec.id,
      name: spec.label,
      x: x,
      y: y,
      spawnX: x,
      spawnY: y,
      hp: spec.hp,
      maxHp: spec.hp,
      def: spec.def || 0,
      atk: spec.atk || 0,
      dmg: spec.dmg,
      speed: spec.speed,
      sight: spec.sight,
      leash: leashR,
      melee: spec.melee,
      radius: spec.radius,
      elite: !!spec.elite,
      boss: !!spec.boss,
      enrage: spec.enrage || null,
      packId: packId,
      state: 'wander',
      aggro: false,
      facing: 1,
      path: null,
      cdMs: 0,
      dead: false,
    };
    decorate(mob, spec);
    mob.takeHit = function (dmg, info) { return takeHit(mob, dmg, info); };
    return mob;
  }

  function offsetFor(i, n) {
    if (n <= 1) return { x: 0, y: 0 };
    const ang = (i / n) * Math.PI * 2;
    return { x: Math.cos(ang) * 1.35, y: Math.sin(ang) * 1.35 };
  }

  function stampField(mob, x, y, opts) {
    const area = opts.area || null;
    const field = !!(area || opts.scope === 'pair');
    mob.anchorX = x;
    mob.anchorY = y;
    mob.area = area;
    mob.scope = field ? 'pair' : (opts.scope || 'pack');
    mob.respawnSec = typeof opts.respawn === 'number' ? opts.respawn : 0;
    if (typeof opts.aggroRadius === 'number') mob.townAggro = opts.aggroRadius;
    if (field) {
      mob.spawnX = x;
      mob.spawnY = y;
    }
  }

  function spawnPack(monsterId, x, y, n, leash, opts) {
    opts = opts || {};
    const spec = mergedSpec(monsterId);
    if (!spec || typeof x !== 'number' || typeof y !== 'number') return [];
    const count = Math.max(1, n == null ? 1 : Math.floor(n));
    const leashR = typeof leash === 'number' ? leash : spec.leash;
    const packId = opts.packId || ('pack-' + (packSeq++));
    const field = !!(opts.area || opts.scope === 'pair');
    const spawned = [];
    for (let i = 0; i < count; i++) {
      let px = x;
      let py = y;
      if (field) {
        const spot = placeIn(x, y, opts.area || null, i);
        px = spot.x;
        py = spot.y;
      } else {
        const off = offsetFor(i, count);
        px = x + off.x;
        py = y + off.y;
        if (!spotOk(px, py, null)) {
          const spot = placeIn(x, y, null, i);
          px = spot.x;
          py = spot.y;
        }
      }
      const mob = createMob(spec, px, py, packId, leashR);
      stampField(mob, x, y, opts);
      mobs.push(mob);
      addToWorld(mob);
      spawned.push(mob);
    }
    return spawned;
  }

  /** Town proximity is 2 tiles. A zone may set `aggroRadius` itself. Content sight stays on the spec. */
  function zoneAggroRadius(zone) {
    if (!zone) return null;
    if (typeof zone.aggroRadius === 'number') return zone.aggroRadius;
    const id = zone.id || zone.zone || (zone.data && (zone.data.id || zone.data.zone));
    if (id === 'town') return 2;
    return null;
  }

  /** One spawn entry is one pack. Town entries with `area` are pair-scoped. */
  function spawnZone(zone) {
    const spawns = zone && (zone.spawns || (zone.data && zone.data.spawns));
    if (!spawns) return [];
    const aggroRadius = zoneAggroRadius(zone);
    const spawned = [];
    for (let i = 0; i < spawns.length; i++) {
      const sp = spawns[i];
      if (!sp) continue;
      const id = sp.monsterId || sp.id;
      if (!id || typeof sp.x !== 'number' || typeof sp.y !== 'number') continue;
      const count = sp.n != null ? sp.n : (sp.count != null ? sp.count : 1);
      const pack = spawnPack(id, sp.x, sp.y, count, sp.leash, {
        area: sp.area || null,
        respawn: sp.respawn,
        scope: sp.area ? 'pair' : 'pack',
        aggroRadius: aggroRadius,
      });
      for (let j = 0; j < pack.length; j++) spawned.push(pack[j]);
    }
    return spawned;
  }

  function resolvePoints(zoneOrPoints) {
    if (!zoneOrPoints) return FIELD.slice();
    if (Array.isArray(zoneOrPoints)) return zoneOrPoints;
    if (Array.isArray(zoneOrPoints.spawns)) return zoneOrPoints.spawns;
    if (Array.isArray(zoneOrPoints.points)) return zoneOrPoints.points;
    if (typeof zoneOrPoints.x === 'number' && typeof zoneOrPoints.y === 'number') return [zoneOrPoints];
    return FIELD.slice();
  }

  function spawnField(zoneOrPoints) {
    if (zoneOrPoints && !Array.isArray(zoneOrPoints) && Array.isArray(zoneOrPoints.spawns)) {
      return spawnZone(zoneOrPoints);
    }
    const points = resolvePoints(zoneOrPoints);
    const spawned = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p) continue;
      const id = p.monsterId || p.id || 'goblin';
      const count = p.n == null ? (p.count == null ? 3 : p.count) : p.n;
      const pack = spawnPack(id, p.x, p.y, count, p.leash);
      for (let j = 0; j < pack.length; j++) spawned.push(pack[j]);
    }
    return spawned;
  }

  function wander(mob, dt) {
    mob.wanderLeft = (mob.wanderLeft || 0) - dt;
    if (!mob.wanderTo || mob.wanderLeft <= 0) {
      let tx;
      let ty;
      if (mob.area) {
        tx = mob.area.x0 + roll('ai') * (mob.area.x1 - mob.area.x0);
        ty = mob.area.y0 + roll('ai') * (mob.area.y1 - mob.area.y0);
      } else {
        const ang = roll('ai') * Math.PI * 2;
        const rad = 0.4 + roll('ai') * 0.8;
        tx = mob.spawnX + Math.cos(ang) * rad;
        ty = mob.spawnY + Math.sin(ang) * rad;
      }
      if (!spotOk(tx, ty, mob.area)) {
        mob.wanderTo = null;
        mob.wanderLeft = 0.25;
        return;
      }
      mob.wanderTo = { x: tx, y: ty };
      mob.wanderLeft = 0.8 + roll('ai');
      mob.path = null;
      mob._repath = 0;
    }
    if (!mob.wanderTo || !spotOk(mob.wanderTo.x, mob.wanderTo.y, mob.area)) {
      mob.wanderTo = null;
      return;
    }
    moveToward(mob, dt, mob.wanderTo.x, mob.wanderTo.y);
    if (mob.area && !inArea(mob.area, mob.x, mob.y)) {
      const cx = Math.min(mob.area.x1, Math.max(mob.area.x0, mob.x));
      const cy = Math.min(mob.area.y1, Math.max(mob.area.y0, mob.y));
      if (spotOk(cx, cy, mob.area)) {
        mob.x = cx;
        mob.y = cy;
      }
      mob.wanderTo = null;
    }
    if (homeDist(mob) > mob.leash) {
      if (spotOk(mob.spawnX, mob.spawnY, mob.area)) {
        mob.x = mob.spawnX;
        mob.y = mob.spawnY;
      }
      mob.wanderTo = null;
    }
  }

  function act(mob, dt) {
    if (!mob || mob.dead) return;
    if (mob.boss) {
      const boss = ai.boss;
      if (boss && typeof boss.tick === 'function') boss.tick(mob, dt);
      return;
    }
    const atk = attacks();
    const busy = mob.state === 'windup' || mob.state === 'slam' || mob.state === 'charge' || mob.state === 'dash';
    if (busy) {
      if (homeDist(mob) > mob.leash) {
        startReturn(mob);
      } else if (mob.state === 'dash' && atk && atk.advanceDash) {
        atk.advanceDash(mob, dt);
        return;
      } else if (mob.state === 'charge' && atk && atk.advanceCharge) {
        atk.advanceCharge(mob, dt);
        return;
      } else if (mob.state === 'slam' && atk && atk.advanceSlam) {
        atk.advanceSlam(mob, dt);
        return;
      } else if (mob.state === 'windup' && atk && atk.advanceMelee) {
        atk.advanceMelee(mob, dt);
        return;
      }
    }
    if (!busy && mob.cdMs > 0) mob.cdMs -= dt * 1000;
    if (!busy && mob.cds) {
      const dtMs = dt * 1000;
      for (const key in mob.cds) {
        if (mob.cds[key] > 0) mob.cds[key] = Math.max(0, mob.cds[key] - dtMs);
      }
    }

    if (mob.state === 'return' || (mob.aggro && homeDist(mob) > mob.leash)) {
      if (mob.state !== 'return') startReturn(mob);
      moveToward(mob, dt, mob.spawnX, mob.spawnY);
      if (homeDist(mob) <= 0.35) {
        mob.state = 'wander';
        mob.aggro = false;
        mob.path = null;
        mob.wanderTo = null;
        mob.wanderLeft = 0.2;
        mob.x = mob.spawnX;
        mob.y = mob.spawnY;
      }
      return;
    }

    const hero = heroPos();
    if (mob.aggro && hero && !hero.dead) {
      if (!clearOfKeepOut(hero.x, hero.y)) {
        giveUpChase(mob);
        wander(mob, dt);
        return;
      }
      const picked = atk && typeof atk.chooseAttack === 'function' ? atk.chooseAttack(mob, hero) : null;
      if (picked === 'melee' || picked === 'ranged') {
        atk.startMelee(mob, dt, picked);
        return;
      }
      if (picked === 'slam' && atk.startSlam) {
        atk.startSlam(mob, dt);
        return;
      }
      if (picked === 'charge' && atk.startCharge) {
        atk.startCharge(mob, dt);
        return;
      }
      mob.state = 'chase';
      if (atk && typeof atk.shouldKite === 'function' && atk.shouldKite(mob, hero)) {
        const dx = mob.x - hero.x;
        const dy = mob.y - hero.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        moveToward(mob, dt, mob.x + (dx / d) * 1.5, mob.y + (dy / d) * 1.5);
      } else {
        moveToward(mob, dt, hero.x, hero.y);
      }
      if (mob._giveUp) {
        giveUpChase(mob);
        return;
      }
      if (!clearOfKeepOut(mob.x, mob.y)) {
        giveUpChase(mob);
        return;
      }
      if (homeDist(mob) > mob.leash) startReturn(mob);
      return;
    }

    mob.state = 'wander';
    mob.aggro = false;
    wander(mob, dt);
  }

  const respawns = [];

  function scheduleRespawn(mob) {
    if (!mob || !(mob.respawnSec > 0) || mob._respawnQueued) return;
    mob._respawnQueued = true;
    respawns.push({
      left: mob.respawnSec,
      monsterId: mob.monsterId,
      x: typeof mob.anchorX === 'number' ? mob.anchorX : mob.spawnX,
      y: typeof mob.anchorY === 'number' ? mob.anchorY : mob.spawnY,
      leash: mob.leash,
      area: mob.area || null,
      respawn: mob.respawnSec,
      scope: mob.scope || 'pack',
      packId: mob.packId,
      aggroRadius: typeof mob.townAggro === 'number' ? mob.townAggro : null,
    });
  }

  function tickRespawns(dt) {
    for (let i = respawns.length - 1; i >= 0; i--) {
      const job = respawns[i];
      job.left -= dt;
      if (job.left > 0) continue;
      respawns.splice(i, 1);
      const spec = mergedSpec(job.monsterId);
      if (!spec) continue;
      const spot = placeIn(job.x, job.y, job.area, 0);
      const mob = createMob(spec, spot.x, spot.y, job.packId, job.leash);
      stampField(mob, job.x, job.y, {
        area: job.area,
        scope: job.scope,
        respawn: job.respawn,
        aggroRadius: job.aggroRadius,
      });
      mobs.push(mob);
      addToWorld(mob);
    }
  }

  function tickOnce(dt) {
    tickRespawns(dt);
    const snapshot = mobs.slice();
    for (let i = 0; i < snapshot.length; i++) sense(snapshot[i]);
    for (let i = 0; i < snapshot.length; i++) act(snapshot[i], dt);
    for (let i = 0; i < mobs.length; i++) syncRender(mobs[i]);
  }

  function tick(dt) {
    if (!(dt > 0)) return;
    let left = dt;
    while (left > 0.0001) {
      const stepDt = left > SUBSTEP ? SUBSTEP : left;
      tickOnce(stepDt);
      left -= stepDt;
    }
  }

  function forget(mob) {
    const i = mobs.indexOf(mob);
    if (i >= 0) mobs.splice(i, 1);
  }

  function boot() {
    if (ai._booted) return;
    ai._booted = true;
    const fn = function (dt) { tick(dt); };
    if (typeof RPG.registerSystem !== 'function') return;
    try {
      RPG.registerSystem('ai', fn);
    } catch (err) {
      try {
        RPG.registerSystem({ id: 'ai-monsters', name: 'ai', tick: fn, update: fn });
      } catch (err2) {}
    }
  }

  ai.spawnPack = spawnPack;
  ai.spawnZone = spawnZone;
  ai.spawnField = spawnField;
  ai.tick = tick;
  ai.syncRender = syncRender;
  ai.forget = forget;
  ai.specs = SPECS;
  ai.FIELD = FIELD;

  const Monsters = root.Monsters || (root.Monsters = {});
  Monsters.spawnPack = spawnPack;
  Monsters.spawnZone = spawnZone;
  Monsters.spawnField = spawnField;
  Monsters.specs = SPECS;

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
