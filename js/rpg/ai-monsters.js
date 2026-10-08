/**
 * Field monsters: wander, aggro, pack alert, leash, A* chase.
 * GD entry: RPG.ai.spawnPack(monsterId, x, y, n, leash)
 * Also Monsters.spawnField(zoneOrPoints) for the goblin field outside town.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});
  const ai = RPG.ai || (RPG.ai = {});

  const SPECS = {
    rat: {
      id: 'rat', label: 'Rat', hp: 14, dmg: 3, speed: 2.4,
      sight: 3.6, leash: 7, melee: 0.72, radius: 0.28, color: '#8d7b5a',
      elite: false, boss: false,
    },
    goblin: {
      id: 'goblin', label: 'Goblin', hp: 28, dmg: 6, speed: 2.05,
      sight: 4.2, leash: 9, melee: 0.8, radius: 0.32, color: '#6f8f3a',
      elite: false, boss: false,
    },
    skeleton: {
      id: 'skeleton', label: 'Skeleton', hp: 40, dmg: 8, speed: 1.7,
      sight: 4.6, leash: 10, melee: 0.85, radius: 0.32, color: '#d9d3c4',
      elite: false, boss: false,
    },
    imp: {
      id: 'imp', label: 'Imp', hp: 22, dmg: 5, speed: 2.5,
      sight: 5, leash: 10, melee: 0.7, radius: 0.26, color: '#d15a34',
      elite: false, boss: false,
    },
    brute: {
      id: 'brute', label: 'Brute', hp: 96, dmg: 14, speed: 1.25,
      sight: 4.4, leash: 8, melee: 1.0, radius: 0.46, color: '#6b5246',
      elite: true, boss: false,
    },
    ashmaw: {
      id: 'ashmaw', label: 'Ashmaw', hp: 320, dmg: 18, speed: 1.7,
      sight: 8, leash: 16, melee: 1.3, radius: 0.7, color: '#8e2e2e',
      elite: false, boss: true,
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

  function sheetHas(key) {
    const sheet = RPG.sheet || root.SHEET;
    if (!sheet || !key) return false;
    try {
      if (typeof sheet.has === 'function' && sheet.has(key)) return true;
    } catch (err) {}
    if (sheet.frames && sheet.frames[key]) return true;
    if (sheet.keys && sheet.keys[key]) return true;
    const anims = sheet.anims || sheet.animations;
    if (anims && anims[key]) return true;
    return false;
  }

  function sheetKeys(id) {
    return {
      idle: 'mob_' + id + '_idle',
      walk: 'mob_' + id + '_walk',
      attack: 'mob_' + id + '_attack',
    };
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

  function addToWorld(ent) {
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
      try { path = world.path(mob.x, mob.y, tx, ty); } catch (err) { path = null; }
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
    if (!blocked(nx, ny)) {
      mob.x = nx;
      mob.y = ny;
    } else if (!blocked(nx, mob.y)) {
      mob.x = nx;
    } else if (!blocked(mob.x, ny)) {
      mob.y = ny;
    } else {
      mob.path = null;
      mob._repath = 0;
      return false;
    }
    if (dx !== 0) mob.facing = dx > 0 ? 1 : -1;
    mob.anim = mob.attacking ? 'attack' : 'walk';
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

  function alertPack(mob) {
    for (let i = 0; i < mobs.length; i++) {
      const other = mobs[i];
      if (!other || other.dead) continue;
      if (other.packId !== mob.packId) continue;
      if (other.state === 'return') continue;
      other.aggro = true;
      if (other.state !== 'windup' && other.state !== 'slam' && other.state !== 'charge') {
        other.state = 'chase';
      }
    }
  }

  function sense(mob) {
    if (!mob || mob.dead || mob.state === 'return') return;
    const hero = heroPos();
    if (!hero || hero.dead) return;
    if (dist(mob.x, mob.y, hero.x, hero.y) <= mob.sight) alertPack(mob);
  }

  function startReturn(mob) {
    const atk = attacks();
    if (mob.state === 'windup' && atk && atk.cancelMelee) atk.cancelMelee(mob);
    if (mob.tellId && atk && atk.clearTell) atk.clearTell(mob.tellId);
    mob.tellId = null;
    mob.state = 'return';
    mob.aggro = false;
    mob.attacking = false;
    mob.anim = 'walk';
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
    if (mob.hp <= 0) {
      mob.hp = 0;
      mob.dead = true;
      mob.state = 'dead';
      mob.aggro = false;
      finishKill(mob);
      return { dead: true };
    }
    return { dead: false };
  }

  function decorate(mob, spec) {
    const keys = sheetKeys(spec.id);
    mob.sheet = keys;
    mob.label = spec.label;
    mob.color = spec.color;
    mob.artKnown = spec.id === 'rat' || spec.id === 'goblin';
    mob.placeholder = !sheetHas(keys.idle) && !sheetHas(keys.attack);
    mob.render = {
      mode: mob.placeholder ? 'box' : 'sheet',
      label: spec.label,
      fill: spec.color,
      keys: keys,
    };
    mob.anim = 'idle';
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
      dmg: spec.dmg,
      speed: spec.speed,
      sight: spec.sight,
      leash: leashR,
      melee: spec.melee,
      radius: spec.radius,
      elite: !!spec.elite,
      boss: !!spec.boss,
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

  function spawnPack(monsterId, x, y, n, leash) {
    const spec = SPECS[monsterId];
    if (!spec || typeof x !== 'number' || typeof y !== 'number') return [];
    const count = Math.max(1, n == null ? 1 : Math.floor(n));
    const leashR = typeof leash === 'number' ? leash : spec.leash;
    const packId = 'pack-' + (packSeq++);
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const off = offsetFor(i, count);
      const mob = createMob(spec, x + off.x, y + off.y, packId, leashR);
      mobs.push(mob);
      addToWorld(mob);
      spawned.push(mob);
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
      const ang = roll('ai') * Math.PI * 2;
      const rad = 0.4 + roll('ai') * 0.8;
      mob.wanderTo = {
        x: mob.spawnX + Math.cos(ang) * rad,
        y: mob.spawnY + Math.sin(ang) * rad,
      };
      mob.wanderLeft = 0.8 + roll('ai');
      mob.path = null;
      mob._repath = 0;
    }
    moveToward(mob, dt, mob.wanderTo.x, mob.wanderTo.y);
    if (homeDist(mob) > mob.leash) {
      mob.x = mob.spawnX;
      mob.y = mob.spawnY;
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
    if (mob.state === 'windup') {
      if (homeDist(mob) > mob.leash) {
        startReturn(mob);
      } else if (atk && atk.advanceMelee) {
        atk.advanceMelee(mob, dt);
        return;
      }
    }
    if (mob.state !== 'windup' && mob.cdMs > 0) mob.cdMs -= dt * 1000;

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
      mob.state = 'chase';
      if (atk && typeof atk.inReach === 'function' && atk.inReach(mob, hero) && mob.cdMs <= 0) {
        atk.startMelee(mob, dt);
        return;
      }
      moveToward(mob, dt, hero.x, hero.y);
      if (homeDist(mob) > mob.leash) startReturn(mob);
      return;
    }

    mob.state = 'wander';
    mob.aggro = false;
    wander(mob, dt);
  }

  function tickOnce(dt) {
    const snapshot = mobs.slice();
    for (let i = 0; i < snapshot.length; i++) sense(snapshot[i]);
    for (let i = 0; i < snapshot.length; i++) act(snapshot[i], dt);
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
        RPG.registerSystem({ id: 'ai', name: 'ai', tick: fn, update: fn });
      } catch (err2) {}
    }
  }

  ai.spawnPack = spawnPack;
  ai.spawnField = spawnField;
  ai.tick = tick;
  ai.forget = forget;
  ai.specs = SPECS;
  ai.FIELD = FIELD;

  const Monsters = root.Monsters || (root.Monsters = {});
  Monsters.spawnPack = spawnPack;
  Monsters.spawnField = spawnField;
  Monsters.specs = SPECS;

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
