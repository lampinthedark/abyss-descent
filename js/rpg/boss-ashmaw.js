/**
 * Ashmaw, the crypt boss. Two warned attacks:
 *   slam  — RPG.fx('telegraph', x, y, radius) then a circle hit
 *   charge — RPG.fx('telegraphLine', x1, y1, x2, y2) then a line hit
 * Both windups are at least 600ms and clear with RPG.fx('telegraphOff', id).
 * Shield phase is cut. Do not add it.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});
  const ai = RPG.ai || (RPG.ai = {});

  const WIND = { slam: 720, charge: 780 };
  const FLOOR = 600;
  const SLAM_R = 2.25;
  const CHARGE_REACH = 6;
  const CHARGE_HIT = 0.85;

  function windupMs(kind) {
    const ms = WIND[kind] || FLOOR;
    return ms < FLOOR ? FLOOR : ms;
  }

  function roll() {
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

  function fx() {
    const atk = ai.attacks;
    if (atk && typeof atk.fx === 'function') return atk.fx.apply(null, arguments);
    if (typeof RPG.fx === 'function') {
      try { return RPG.fx.apply(RPG, arguments); } catch (err) { return null; }
    }
    return null;
  }

  function clearTell(id) {
    const atk = ai.attacks;
    if (atk && typeof atk.clearTell === 'function') atk.clearTell(id);
    else fx('telegraphOff', id);
  }

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function heroOf() {
    const hero = RPG.hero;
    if (!hero || typeof hero.x !== 'number' || typeof hero.y !== 'number') return null;
    return hero;
  }

  function hurt(mob) {
    const atk = ai.attacks;
    if (atk && typeof atk.hurtHero === 'function') atk.hurtHero(mob, mob.dmg);
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

  function begin(mob, kind) {
    const ms = windupMs(kind);
    mob.state = kind;
    mob.attackName = kind;
    mob.windupMs = ms;
    mob.windupElapsed = 0;
    mob.attacking = true;
    mob.anim = kind;
    mob.serial = (mob.serial || 0) + 1;
    mob.tellId = mob.id + '-' + kind + '-' + mob.serial;
    if (kind === 'slam') {
      mob.slam = { x: mob.x, y: mob.y, r: SLAM_R };
      mob.line = null;
      fx('telegraph', mob.x, mob.y, SLAM_R, { id: mob.tellId, ms: ms, kind: 'slam' });
    } else {
      const hero = heroOf() || { x: mob.x + 1, y: mob.y };
      const dx = hero.x - mob.x;
      const dy = hero.y - mob.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      mob.slam = null;
      mob.line = {
        x1: mob.x,
        y1: mob.y,
        x2: mob.x + (dx / len) * CHARGE_REACH,
        y2: mob.y + (dy / len) * CHARGE_REACH,
      };
      fx('telegraphLine', mob.line.x1, mob.line.y1, mob.line.x2, mob.line.y2, {
        id: mob.tellId,
        ms: ms,
        kind: 'charge',
      });
    }
  }

  function lunge(mob) {
    const line = mob.line;
    if (!line) return;
    const world = RPG.world;
    let x = line.x2;
    let y = line.y2;
    if (world && typeof world.isBlocked === 'function') {
      const steps = 8;
      let lastX = line.x1;
      let lastY = line.y1;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const nx = line.x1 + (line.x2 - line.x1) * t;
        const ny = line.y1 + (line.y2 - line.y1) * t;
        let blocked = false;
        try { blocked = !!world.isBlocked(nx, ny); } catch (err) { blocked = false; }
        if (blocked) break;
        lastX = nx;
        lastY = ny;
      }
      x = lastX;
      y = lastY;
    }
    mob.x = x;
    mob.y = y;
  }

  function resolve(mob) {
    const kind = mob.state;
    const tell = mob.tellId;
    const hero = heroOf();
    if (kind === 'slam' && mob.slam && hero && !hero.dead) {
      const pad = typeof hero.radius === 'number' ? hero.radius : 0;
      if (dist(hero.x, hero.y, mob.slam.x, mob.slam.y) <= mob.slam.r + pad) hurt(mob);
    } else if (kind === 'charge') {
      lunge(mob);
      if (mob.line && hero && !hero.dead) {
        const pad = typeof hero.radius === 'number' ? hero.radius : 0;
        if (distToSegment(hero.x, hero.y, mob.line) <= CHARGE_HIT + pad) hurt(mob);
      }
    }
    clearTell(tell);
    mob.tellId = null;
    mob.attacking = false;
    mob.anim = 'idle';
    mob.slam = null;
    mob.line = null;
    mob.state = 'chase';
    mob.aggro = true;
    mob.cdMs = 800;
    mob.path = null;
    mob._repath = 0;
  }

  function moveToward(mob, dt, tx, ty) {
    const dx = tx - mob.x;
    const dy = ty - mob.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.05) return;
    const mag = Math.min(mob.speed * dt, d);
    const nx = mob.x + (dx / d) * mag;
    const ny = mob.y + (dy / d) * mag;
    const world = RPG.world;
    let blocked = false;
    if (world && typeof world.isBlocked === 'function') {
      try { blocked = !!world.isBlocked(nx, ny); } catch (err) { blocked = false; }
    }
    if (!blocked) {
      mob.x = nx;
      mob.y = ny;
      mob.anim = 'walk';
    }
  }

  function homeDist(mob) {
    return dist(mob.x, mob.y, mob.spawnX, mob.spawnY);
  }

  function startReturn(mob) {
    if (mob.tellId) clearTell(mob.tellId);
    mob.tellId = null;
    mob.attacking = false;
    mob.slam = null;
    mob.line = null;
    mob.state = 'return';
    mob.aggro = false;
    mob.anim = 'walk';
  }

  function tick(mob, dt) {
    if (!mob || mob.dead) return;
    if (mob.state === 'slam' || mob.state === 'charge') {
      mob.windupElapsed += (dt > 0 ? dt : 0) * 1000;
      if (mob.windupElapsed >= mob.windupMs) resolve(mob);
      return;
    }
    if (mob.state === 'return' || homeDist(mob) > mob.leash) {
      if (mob.state !== 'return') startReturn(mob);
      moveToward(mob, dt, mob.spawnX, mob.spawnY);
      if (homeDist(mob) <= 0.4) {
        mob.state = 'wander';
        mob.aggro = false;
        mob.x = mob.spawnX;
        mob.y = mob.spawnY;
      }
      return;
    }
    const hero = heroOf();
    if (!hero || hero.dead) {
      mob.state = 'wander';
      return;
    }
    const d = dist(mob.x, mob.y, hero.x, hero.y);
    if (d > mob.sight) {
      mob.state = 'wander';
      mob.aggro = false;
      return;
    }
    mob.aggro = true;
    if (mob.cdMs > 0) {
      mob.cdMs -= dt * 1000;
      mob.state = 'chase';
      if (d > 1.6) moveToward(mob, dt, hero.x, hero.y);
      return;
    }
    const kind = roll() < 0.5 ? 'slam' : 'charge';
    begin(mob, kind);
    mob.windupElapsed += (dt > 0 ? dt : 0) * 1000;
    if (mob.windupElapsed >= mob.windupMs) resolve(mob);
  }

  function spawn(x, y, opts) {
    opts = opts || {};
    if (typeof ai.spawnPack !== 'function') return null;
    const leash = typeof opts.leash === 'number' ? opts.leash : undefined;
    const pack = ai.spawnPack('ashmaw', x, y, 1, leash);
    return pack[0] || null;
  }

  ai.boss = {
    spawn: spawn,
    tick: tick,
    windupMs: windupMs,
    WIND: WIND,
    FLOOR: FLOOR,
  };
  ai.bossWindupMs = windupMs;
})(typeof window !== 'undefined' ? window : globalThis);
