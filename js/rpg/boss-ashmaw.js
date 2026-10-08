/**
 * Ashmaw, the crypt boss.
 *   claw   — mob_ashmaw_attack, frame 0 held for the melee windup
 *   slam   — mob_ashmaw_slam, RPG.fx('telegraph') then a circle hit
 *   charge — mob_ashmaw_charge, frame 0 through the tell, frame 1 for the dash
 * Slam and charge windups are at least 600ms and clear with RPG.fx('telegraphOff', id).
 * Shield phase is cut. Do not add it.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});
  const ai = RPG.ai || (RPG.ai = {});

  const WIND = { claw: 650, slam: 1000, charge: 900 };
  const FLOOR = 600;
  const SLAM_R = 2.5;
  const CHARGE_REACH = 7;
  const CHARGE_HIT = 0.85;

  function attackRow(kind) {
    const mapped = kind === 'claw' ? 'melee' : kind;
    const atk = ai.attacks;
    const rows = atk && typeof atk.attacksOf === 'function' ? atk.attacksOf('ashmaw') : null;
    return (rows && rows[mapped]) || null;
  }

  function windupMs(kind) {
    const atk = ai.attacks;
    const mapped = kind === 'claw' ? 'melee' : kind;
    if (atk && typeof atk.windupFor === 'function') return atk.windupFor('ashmaw', mapped);
    const ms = WIND[kind] || WIND[mapped] || FLOOR;
    return ms < FLOOR ? FLOOR : ms;
  }

  function slamRadius() {
    const row = attackRow('slam');
    if (row && typeof row.radius === 'number') return row.radius;
    if (row && typeof row.range === 'number') return row.range;
    return SLAM_R;
  }

  function chargeReach() {
    const row = attackRow('charge');
    if (row && typeof row.range === 'number') return row.range;
    return CHARGE_REACH;
  }

  function clawReach(mob, hero) {
    const row = attackRow('claw');
    const melee = row && typeof row.range === 'number' ? row.range : (mob.melee || 1.2);
    const pad = hero && typeof hero.radius === 'number' ? hero.radius : 0;
    return melee + pad;
  }

  function attackDamage(kind, mob) {
    const row = attackRow(kind);
    if (row && typeof row.dmg === 'number') return row.dmg;
    return mob && mob.dmg;
  }

  function cooldownFor(kind, mob) {
    const row = attackRow(kind);
    let cd = row && typeof row.cooldownMs === 'number' ? row.cooldownMs : 800;
    const en = mob && mob.enrage;
    if (en && mob.maxHp > 0 && (mob.hp / mob.maxHp) * 100 <= en.belowHpPct) {
      const mult = en.cooldownMult;
      if (typeof mult === 'number' && mult > 0) cd *= mult;
    }
    return cd;
  }

  function pose(mob, kind, frame) {
    const atk = ai.attacks;
    if (atk && typeof atk.pose === 'function') {
      atk.pose(mob, kind, frame);
      return;
    }
    mob.animFrame = frame;
    mob.holdFrame = frame;
  }

  function poseIdle(mob) {
    const atk = ai.attacks;
    if (atk && typeof atk.poseIdle === 'function') atk.poseIdle(mob);
    else mob.attacking = false;
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

  function hurt(mob, kind) {
    const atk = ai.attacks;
    const row = attackRow(kind);
    const dmg = attackDamage(kind, mob);
    const srcName = (row && row.srcName) || (mob && (mob.label || mob.name)) || '';
    const info = {
      amount: dmg,
      dmg: dmg,
      srcId: mob ? mob.id : '',
      monsterId: mob ? mob.monsterId : 'ashmaw',
      name: srcName || 'Ashmaw the Wyrmling',
      srcName: srcName,
      attack: row && (row.name || row.kind) || kind,
      crit: false,
      target: 'hero',
    };
    if (atk && typeof atk.hurtHero === 'function') atk.hurtHero(mob, dmg, info);
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
    mob.state = kind === 'claw' ? 'claw' : kind;
    mob.attackName = kind;
    mob.windupMs = ms;
    mob.windupElapsed = 0;
    mob.attacking = true;
    mob.serial = (mob.serial || 0) + 1;
    mob.tellId = mob.id + '-' + kind + '-' + mob.serial;
    pose(mob, kind === 'claw' ? 'melee' : kind, 0);
    if (kind === 'slam') {
      const radius = slamRadius();
      mob.slam = { x: mob.x, y: mob.y, r: radius };
      mob.line = null;
      fx('telegraph', mob.x, mob.y, radius, { id: mob.tellId, ms: ms, kind: 'slam' });
    } else if (kind === 'charge') {
      const reach = chargeReach();
      const hero = heroOf() || { x: mob.x + 1, y: mob.y };
      const dx = hero.x - mob.x;
      const dy = hero.y - mob.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      mob.slam = null;
      mob.line = {
        x1: mob.x,
        y1: mob.y,
        x2: mob.x + (dx / len) * reach,
        y2: mob.y + (dy / len) * reach,
      };
      fx('telegraphLine', mob.line.x1, mob.line.y1, mob.line.x2, mob.line.y2, {
        id: mob.tellId,
        ms: ms,
        kind: 'charge',
      });
    } else {
      mob.slam = null;
      mob.line = null;
      mob.tellId = null;
    }
  }

  function endAttack(mob, kind) {
    mob.tellId = null;
    mob.slam = null;
    mob.line = null;
    mob.state = 'chase';
    mob.aggro = true;
    mob.cdMs = cooldownFor(kind || mob.attackName, mob);
    mob.path = null;
    mob._repath = 0;
    poseIdle(mob);
  }

  function beginDash(mob) {
    const line = mob.line;
    const tell = mob.tellId;
    const hero = heroOf();
    if (line && hero && !hero.dead) {
      const pad = typeof hero.radius === 'number' ? hero.radius : 0;
      if (distToSegment(hero.x, hero.y, line) <= CHARGE_HIT + pad) hurt(mob, 'charge');
    }
    clearTell(tell);
    mob.tellId = null;
    mob.slam = null;
    const row = ai.attacks && ai.attacks.attacksOf ? ai.attacks.attacksOf('ashmaw').charge : null;
    mob.dashMs = row && typeof row.dashMs === 'number' ? row.dashMs : 240;
    mob.dashT = 0;
    mob.dashFrom = { x: mob.x, y: mob.y };
    mob.dashTo = line ? { x: line.x2, y: line.y2 } : { x: mob.x, y: mob.y };
    mob.line = null;
    mob.state = 'dash';
    mob.aggro = true;
    pose(mob, 'charge', 1);
  }

  function advanceDash(mob, dt) {
    pose(mob, 'charge', 1);
    const ms = mob.dashMs > 0 ? mob.dashMs : 240;
    mob.dashT = (mob.dashT || 0) + (dt > 0 ? dt : 0) * 1000;
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
    if (t >= 1 || blocked) endAttack(mob, 'charge');
  }

  function resolve(mob) {
    const kind = mob.state;
    const hero = heroOf();
    if (kind === 'slam' && mob.slam && hero && !hero.dead) {
      const pad = typeof hero.radius === 'number' ? hero.radius : 0;
      if (dist(hero.x, hero.y, mob.slam.x, mob.slam.y) <= mob.slam.r + pad) hurt(mob, 'slam');
      clearTell(mob.tellId);
      endAttack(mob, 'slam');
      return;
    }
    if (kind === 'charge') {
      beginDash(mob);
      return;
    }
    if (kind === 'claw') {
      const reach = clawReach(mob, hero);
      if (hero && !hero.dead && dist(hero.x, hero.y, mob.x, mob.y) <= reach) hurt(mob, 'claw');
      endAttack(mob, 'claw');
    }
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
      if (!mob.attacking) {
        mob.anim = 'walk';
        mob.animKey = mob.sheet && mob.sheet.walk;
        mob.animFrame = 0;
      }
    }
  }

  function homeDist(mob) {
    return dist(mob.x, mob.y, mob.spawnX, mob.spawnY);
  }

  function startReturn(mob) {
    if (mob.tellId) clearTell(mob.tellId);
    mob.tellId = null;
    mob.slam = null;
    mob.line = null;
    mob.dashFrom = null;
    mob.dashTo = null;
    mob.state = 'return';
    mob.aggro = false;
    poseIdle(mob);
    mob.anim = 'walk';
    mob.animKey = mob.sheet && mob.sheet.walk;
  }

  function tick(mob, dt) {
    if (!mob || mob.dead) return;
    if (mob.state === 'dash') {
      advanceDash(mob, dt);
      return;
    }
    if (mob.state === 'slam' || mob.state === 'charge' || mob.state === 'claw') {
      mob.windupElapsed += (dt > 0 ? dt : 0) * 1000;
      pose(mob, mob.state === 'claw' ? 'melee' : mob.state, 0);
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
    const close = clawReach(mob, hero);
    const ring = slamRadius();
    const rush = chargeReach();
    const r = roll();
    let kind = null;
    if (d <= close) {
      if (r < 0.5) kind = 'claw';
      else if (r < 0.75) kind = 'slam';
      else kind = 'charge';
    } else if (d <= ring) {
      kind = r < 0.5 ? 'slam' : 'charge';
    } else if (d <= rush) {
      kind = 'charge';
    }
    if (!kind) {
      mob.state = 'chase';
      moveToward(mob, dt, hero.x, hero.y);
      return;
    }
    begin(mob, kind);
    mob.windupElapsed += (dt > 0 ? dt : 0) * 1000;
    if (mob.windupElapsed >= mob.windupMs) resolve(mob);
  }

  /**
   * Nameplate paint. Same call the Skills & Quests rumour screen uses.
   * No-ops when the shared helper is not on the page. Does not map the preview.
   */
  function canDropPanel(ctx, x, y) {
    if (!RPG.ui || typeof RPG.ui.drawDropRows !== 'function') return;
    const Loot = root.Loot;
    if (!Loot || typeof Loot.preview !== 'function') return;
    return RPG.ui.drawDropRows(ctx, x, y, Loot.preview('ashmaw'));
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
    canDropPanel: canDropPanel,
    WIND: WIND,
    FLOOR: FLOOR,
  };
  RPG.boss = ai.boss;
  ai.bossWindupMs = windupMs;
})(typeof window !== 'undefined' ? window : globalThis);
