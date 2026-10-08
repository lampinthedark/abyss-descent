/**
 * RPG.hero (the player) and RPG.stats (skills + XP), both saved via Store.
 *
 * RPG.hero: { x, y, hp, maxHp, dodging, alive } in tiles (foot point, tile
 * centre = n + 0.5), plus damage(amount, {srcId, srcName, kind}), heal(n),
 * walkTo(tx, ty) / stop() for core input. Walking: A* (path.js) + string
 * pulling, constant on-screen speed. Facing: -1 (art faces the viewer's
 * left), 1 = mirrored. `dist` drives walk frames.
 *
 * RPG.stats: level(skill), xp(skill), addXp(skill, xp) -> Store
 * 'stats/addXp'. Curve: xpFor(L) = floor(sum_{l<L} floor(l + 300 * 2^(l/7)) / 4), cap 99.
 *
 * damage(raw, {srcId, srcName, kind, atk}) -> {hit, dodged, dmg} follows the
 * contract (i-frames, hit roll on RPG.rng('combat'), armour reduction,
 * lastHits, 'hurt', 'death' {lastHits}). Out-of-combat regen: 2 HP/s after
 * 4 s with no damage. death-recap.js (Dungeon dev) owns the death screen;
 * until it registers, a placeholder respawns the hero at zone.entry after 1.5 s.
 */
(function (root) {
  'use strict';

  const RPG = (root.RPG = root.RPG || {});
  const Store = root.Store;
  const TW = 32;
  const TH = 18;
  const SPEED = 80; // art px per second
  // Combat constants (contract; full combat is D3).
  const HIT_BASE = 0.75;
  const HIT_PER_POINT = 0.015;
  const HIT_MIN = 0.4;
  const HIT_MAX = 0.97;
  const ARMOUR_K = 50; // dmg = round(raw * 50 / (50 + armour))
  const REGEN_DELAY = 4; // s with no damage taken before regen starts
  const REGEN_RATE = 2; // HP per second, out of combat

  function gearStats() {
    try {
      // eslint-disable-next-line no-undef
      const eq = typeof Equipment !== 'undefined' ? Equipment : root.Equipment;
      return (eq && eq.getStats && eq.getStats()) || {};
    } catch (e) {
      return {};
    }
  }
  const SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'mining', 'smithing', 'woodcutting', 'fishing', 'cooking'];

  // ---- XP curve -------------------------------------------------------------
  const XP_TABLE = [0, 0]; // XP_TABLE[L] = xp needed for level L
  (function build() {
    let pts = 0;
    for (let l = 1; l < 99; l++) {
      pts += Math.floor(l + 300 * Math.pow(2, l / 7));
      XP_TABLE[l + 1] = Math.floor(pts / 4);
    }
  })();
  function levelFor(xp) {
    let L = 1;
    while (L < 99 && xp >= XP_TABLE[L + 1]) L++;
    return L;
  }

  const initialXp = {};
  SKILLS.forEach(function (s) { initialXp[s] = 0; });
  initialXp.hitpoints = XP_TABLE[10]; // start at Hitpoints 10

  Store.register('stats', function (state, a) {
    if (a.type !== 'stats/addXp') return state;
    if (SKILLS.indexOf(a.skill) < 0 || !(a.xp > 0)) return state;
    const xp = Object.assign({}, state.xp);
    xp[a.skill] = Math.min(XP_TABLE[99] * 2, (xp[a.skill] || 0) + a.xp);
    return { xp: xp };
  }, { xp: initialXp });

  RPG.stats = {
    SKILLS: SKILLS.slice(),
    xpFor: function (L) { return XP_TABLE[Math.max(1, Math.min(99, L | 0))]; },
    levelFor: levelFor,
    xp: function (skill) {
      const st = Store.getState().stats;
      return (st && st.xp && st.xp[skill]) || 0;
    },
    level: function (skill) {
      return levelFor(RPG.stats.xp(skill));
    },
    /** Goes through Store. Emits 'levelUp' {skill, level} when a level is gained. */
    addXp: function (skill, xp) {
      if (SKILLS.indexOf(skill) < 0 || !(xp > 0)) return RPG.stats.level(skill);
      const before = RPG.stats.level(skill);
      Store.dispatch({ type: 'stats/addXp', skill: skill, xp: xp });
      const after = RPG.stats.level(skill);
      if (after > before && RPG.bus) RPG.bus.emit('levelUp', { skill: skill, level: after });
      if (skill === 'hitpoints') hero.maxHp = after;
      return after;
    },
  };

  // ---- hero slice (saved position) ------------------------------------------
  Store.register('hero', function (state, a) {
    switch (a.type) {
      case 'hero/arrive':
      case 'hero/checkpoint':
        if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) return state;
        if (state && state.x === a.x && state.y === a.y && state.zone === (a.zone || 'town')) return state;
        return { zone: a.zone || 'town', x: a.x, y: a.y };
      default:
        return state;
    }
  }, { zone: 'town', x: -1, y: -1 });

  const hero = {
    x: 0,
    y: 0,
    hp: 10,
    maxHp: 10,
    dodging: false,
    alive: true,
    facing: -1,
    moving: false,
    dist: 0,
    path: [],
    lastHits: [],
    clock: 0, // s of game time (update dt)
    lastHurtT: -1e9,
    regenAcc: 0,

    /**
     * damage(raw, {srcId, srcName, kind, atk}) -> {hit, dodged, dmg}
     *   (a) i-frames: hero.dodging -> {hit: false, dodged: true, dmg: 0}
     *   (b) hit roll on RPG.rng('combat'):
     *       clamp(0.75 + 0.015 * (atk - level('defence') - gear.def), 0.40, 0.97)
     *   (c) dmg = round(raw * 50 / (50 + gear.armour))  (gear = Equipment.getStats())
     *   (d) keeps the last 3 hits in hero.lastHits, emits 'hurt'
     *       {dmg, srcId, srcName, kind}; at 0 hp emits 'death' {lastHits}.
     * A miss emits nothing and records nothing. Core shows no death recap
     * (death-recap.js does).
     */
    damage: function (raw, info) {
      const o = info || {};
      if (!hero.alive || !(raw > 0)) return { hit: false, dodged: false, dmg: 0 };
      if (hero.dodging) return { hit: false, dodged: true, dmg: 0 };
      const g = gearStats();
      const atk = Number(o.atk) || 0;
      const p = Math.max(HIT_MIN, Math.min(HIT_MAX,
        HIT_BASE + HIT_PER_POINT * (atk - RPG.stats.level('defence') - (Number(g.def) || 0))));
      if (!(RPG.rng('combat')() < p)) return { hit: false, dodged: false, dmg: 0 };
      const armour = Math.max(0, Number(g.armour) || 0);
      const dmg = Math.round((raw * ARMOUR_K) / (ARMOUR_K + armour));
      hero.lastHurtT = hero.clock;
      hero.regenAcc = 0;
      hero.hp = Math.max(0, hero.hp - dmg);
      const srcId = o.srcId || null;
      const srcName = o.srcName || '';
      const kind = o.kind || 'melee';
      hero.lastHits.push({ dmg: dmg, srcId: srcId, srcName: srcName, kind: kind, t: Date.now() });
      if (hero.lastHits.length > 3) hero.lastHits.shift();
      if (RPG.bus) RPG.bus.emit('hurt', { dmg: dmg, srcId: srcId, srcName: srcName, kind: kind });
      if (hero.hp <= 0) {
        hero.alive = false;
        hero.stop();
        if (RPG.bus) RPG.bus.emit('death', { lastHits: hero.lastHits.slice() });
        // PLACEHOLDER until death-recap.js: respawn at the zone entry (no recap UI).
        setTimeout(function () {
          if (hero.alive || RPG.hasSystem('death-recap')) return;
          hero.respawn();
        }, 1500);
      }
      return { hit: true, dodged: false, dmg: dmg };
    },

    heal: function (n) {
      if (!hero.alive || !(n > 0)) return hero.hp;
      hero.hp = Math.min(hero.maxHp, hero.hp + Math.round(n));
      return hero.hp;
    },

    respawn: function () {
      const sp = (RPG.world.zone && RPG.world.zone.entry) || { x: 0, y: 0 };
      hero.placeAt(sp.x, sp.y);
      hero.hp = hero.maxHp;
      hero.alive = true;
      hero.lastHits = [];
    },

    tile: function () {
      return { x: Math.floor(hero.x), y: Math.floor(hero.y) };
    },

    placeAt: function (tx, ty) {
      hero.x = tx + 0.5;
      hero.y = ty + 0.5;
      hero.path = [];
      hero.moving = false;
    },

    /** Walk to tile (tx, ty) (goal snaps to the nearest walkable). Returns the A* cells. */
    walkTo: function (tx, ty) {
      if (!hero.alive) return [];
      const cells = RPG.world.path({ x: hero.x, y: hero.y }, { x: tx, y: ty });
      if (!cells.length) return cells;
      hero.path = root.RpgPath.smooth(hero.x, hero.y, cells, RPG.world.walkable);
      hero.moving = true;
      const last = cells[cells.length - 1];
      Store.dispatch({ type: 'hero/walk', to: { x: last.x, y: last.y }, durable: false }); // logged, not saved
      return cells;
    },

    stop: function () {
      if (!hero.moving) return;
      hero.path = [];
      hero.moving = false;
      const t = hero.tile();
      Store.dispatch({ type: 'hero/arrive', zone: RPG.world.zoneId(), x: t.x, y: t.y });
    },

    /** Out-of-combat regen: 2 HP/s once 4 s pass with no damage taken. */
    regen: function (dt) {
      if (!hero.alive || hero.hp >= hero.maxHp || hero.clock - hero.lastHurtT < REGEN_DELAY) {
        hero.regenAcc = 0;
        return;
      }
      hero.regenAcc += REGEN_RATE * dt;
      if (hero.regenAcc >= 1) {
        const n = Math.floor(hero.regenAcc);
        hero.regenAcc -= n;
        hero.hp = Math.min(hero.maxHp, hero.hp + n);
      }
    },

    update: function (dt) {
      hero.clock += dt;
      hero.regen(dt);
      if (!hero.moving) return;
      let budget = SPEED * dt;
      while (budget > 0 && hero.path.length) {
        const wp = hero.path[0];
        const dxp = (wp.x - hero.x) * TW;
        const dyp = (wp.y - hero.y) * TH;
        const d = Math.hypot(dxp, dyp);
        if (Math.abs(dxp) > 0.5) hero.facing = dxp > 0 ? 1 : -1;
        if (d <= budget) {
          hero.dist += d;
          hero.x = wp.x;
          hero.y = wp.y;
          hero.path.shift();
          budget -= d;
        } else {
          hero.dist += budget;
          hero.x += ((dxp / d) * budget) / TW;
          hero.y += ((dyp / d) * budget) / TH;
          budget = 0;
        }
      }
      if (!hero.path.length) {
        hero.moving = false;
        const t = hero.tile();
        Store.dispatch({ type: 'hero/arrive', zone: RPG.world.zoneId(), x: t.x, y: t.y });
        if (typeof hero.onArrive === 'function') {
          const fn = hero.onArrive;
          hero.onArrive = null;
          fn();
        }
      }
    },

    /** Restore position and HP after Store.boot(). */
    load: function () {
      const st = Store.getState().hero || {};
      const sp = (RPG.world.zone && RPG.world.zone.entry) || { x: 0, y: 0 };
      const ok = Number.isInteger(st.x) && Number.isInteger(st.y) && st.zone === RPG.world.zoneId() && RPG.world.walkable(st.x, st.y);
      hero.placeAt(ok ? st.x : sp.x, ok ? st.y : sp.y);
      hero.maxHp = RPG.stats.level('hitpoints');
      hero.hp = hero.maxHp;
    },
  };

  RPG.hero = hero;
})(typeof window !== 'undefined' ? window : globalThis);
