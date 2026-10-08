/**
 * Dungeon loader.
 * Prefers RPGContent.Dungeon (The Ash Stair: rows, legend, props, spawns,
 * entry, exits, bossRoom, rooms). A thin crypt sample is used only when
 * that content object is missing.
 * Calls RPG.world.loadZone(zone), spawns packs, emits `enter` { zone }.
 * Resets the one-per-run corpse revive.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});

  function installBus() {
    if (typeof RPG.on === 'function' && typeof RPG.emit === 'function') return;
    const ls = {};
    if (typeof RPG.on !== 'function') {
      RPG.on = function (ev, fn) { (ls[ev] || (ls[ev] = [])).push(fn); };
    }
    if (typeof RPG.emit !== 'function') {
      RPG.emit = function (ev, data) {
        const list = ls[ev] || [];
        for (let i = 0; i < list.length; i++) {
          try { list[i](data); } catch (err) {}
        }
      };
    }
  }

  function emit(name, payload) {
    if (RPG.bus && typeof RPG.bus.emit === 'function') {
      try { RPG.bus.emit(name, payload); } catch (err) {}
      return;
    }
    installBus();
    try { RPG.emit(name, payload); } catch (err) {}
  }

  function emptyGrid(w, h) {
    const grid = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const wall = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        row.push(wall ? 1 : 0);
      }
      grid.push(row);
    }
    return grid;
  }

  /**
   * Thin crypt used only when RPGContent.Dungeon is missing.
   * 1 = wall, 0 = floor. Not the Ash Stair.
   */
  function fallbackSample() {
    return {
      id: 'rustbound-crypt',
      name: 'Rustbound Crypt',
      grid: emptyGrid(20, 16),
      entry: { x: 2.5, y: 8 },
      exit: { x: 17.5, y: 8 },
      spawns: [
        { monsterId: 'skeleton', x: 6, y: 5, n: 3, leash: 6 },
        { monsterId: 'skeleton', x: 6, y: 11, n: 3, leash: 6 },
        { monsterId: 'imp', x: 10, y: 8, n: 4, leash: 7 },
        { monsterId: 'brute', x: 13, y: 8, n: 1, leash: 5 },
      ],
      bossRoom: { x: 16, y: 8, monsterId: 'ashmaw', leash: 8 },
      fallback: true,
    };
  }

  function contentDungeon() {
    const C = root.RPGContent;
    if (!C) return null;
    if (C.Dungeon && C.Dungeon.rows) return C.Dungeon;
    if (C.DUNGEONS && C.DUNGEONS.ash_stair && C.DUNGEONS.ash_stair.rows) return C.DUNGEONS.ash_stair;
    return null;
  }

  function gridFrom(dungeon) {
    const rows = dungeon.rows || [];
    const h = dungeon.height || rows.length;
    const w = dungeon.width || (rows[0] ? rows[0].length : 0);
    const grid = [];
    const useWalk = typeof dungeon.walkable === 'function';
    for (let y = 0; y < h; y++) {
      const row = [];
      const line = rows[y] || '';
      for (let x = 0; x < w; x++) {
        if (useWalk) {
          let open = false;
          try { open = !!dungeon.walkable(x, y); } catch (err) { open = false; }
          row.push(open ? 0 : 1);
        } else {
          const ch = line[x];
          const legend = dungeon.legend && dungeon.legend[ch];
          row.push(legend && legend.walk === false ? 1 : 0);
        }
      }
      grid.push(row);
    }
    if (!useWalk && dungeon.props) {
      for (let i = 0; i < dungeon.props.length; i++) {
        const prop = dungeon.props[i];
        if (!prop || !prop.block) continue;
        if (grid[prop.y] && prop.x >= 0 && prop.x < grid[prop.y].length) grid[prop.y][prop.x] = 1;
      }
    }
    return grid;
  }

  /** Copy a content dungeon into the zone object world.loadZone expects. */
  function normalize(zone) {
    if (!zone || typeof zone !== 'object' || !zone.rows) return zone;
    const exits = zone.exits || null;
    return {
      id: zone.id,
      name: zone.name,
      width: zone.width || (zone.rows[0] ? zone.rows[0].length : 0),
      height: zone.height || zone.rows.length,
      tileW: zone.tileW,
      tileH: zone.tileH,
      rows: zone.rows,
      legend: zone.legend,
      props: zone.props,
      rooms: zone.rooms,
      spawns: zone.spawns || [],
      entry: zone.entry,
      exits: exits,
      exit: zone.exit || (exits && exits[0]) || null,
      bossRoom: zone.bossRoom,
      townGate: zone.townGate,
      grid: gridFrom(zone),
      source: 'RPGContent.Dungeon',
    };
  }

  function rollAi() {
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

  function packSpan(id) {
    const live = root.RPGContent && root.RPGContent.MONSTERS && root.RPGContent.MONSTERS[id];
    if (live && live.pack) return live.pack;
    const spec = RPG.ai && RPG.ai.specs && RPG.ai.specs[id];
    return spec && spec.pack;
  }

  function packCount(id, spawn) {
    if (spawn.n != null) return spawn.n;
    if (spawn.count != null) return spawn.count;
    const pack = packSpan(id);
    if (!pack || !pack.length) return 1;
    const min = pack[0] | 0;
    const max = pack.length > 1 ? (pack[1] | 0) : min;
    if (max <= min) return Math.max(1, min);
    return min + Math.floor(rollAi() * ((max - min) + 1));
  }

  function isPointBoss(room) {
    if (!room || typeof room.x !== 'number' || typeof room.y !== 'number') return false;
    if (room.monsterId) return true;
    return room.w == null && room.h == null;
  }

  /** Real Ash Stair when content is present; thin crypt otherwise. */
  function sample() {
    const live = contentDungeon();
    if (live) return normalize(live);
    return fallbackSample();
  }

  function load(zone) {
    if (!zone || typeof zone !== 'object') return { spawned: [], exit: null };
    if (zone.rows) zone = normalize(zone);
    const world = RPG.world;
    if (world && typeof world.loadZone === 'function') {
      try { world.loadZone(zone); } catch (err) {}
    }
    if (RPG.deathRecap && typeof RPG.deathRecap.resetRun === 'function') {
      try { RPG.deathRecap.resetRun(); } catch (err) {}
    }
    if (zone.entry && RPG.hero) {
      if (typeof zone.entry.x === 'number') RPG.hero.x = zone.entry.x;
      if (typeof zone.entry.y === 'number') RPG.hero.y = zone.entry.y;
    }
    const spawned = [];
    const spawns = zone.spawns || [];
    let bossFromSpawn = false;
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      if (!s || typeof RPG.ai === 'undefined' || typeof RPG.ai.spawnPack !== 'function') continue;
      const id = s.monsterId || s.id;
      if (id === 'ashmaw') bossFromSpawn = true;
      const count = packCount(id, s);
      const pack = RPG.ai.spawnPack(id, s.x, s.y, count, s.leash);
      for (let j = 0; j < pack.length; j++) {
        if (s.elite) pack[j].elite = true;
        if (s.room) pack[j].room = s.room;
        spawned.push(pack[j]);
      }
    }
    if (!bossFromSpawn && isPointBoss(zone.bossRoom) && RPG.ai && RPG.ai.boss && typeof RPG.ai.boss.spawn === 'function') {
      const boss = RPG.ai.boss.spawn(zone.bossRoom.x, zone.bossRoom.y, zone.bossRoom);
      if (boss) spawned.push(boss);
    }
    emit('enter', { zone: zone });
    return { spawned: spawned, exit: zone.exit || null };
  }

  const STAIR_SHUT = 'Warden Ilse wants a word before you go down.';

  /** Core calls this before loadZone on the town stairs (12, 27). */
  function canEnter() {
    if (!RPG.quests || typeof RPG.quests.isDone !== 'function') {
      return { ok: false, line: STAIR_SHUT };
    }
    if (!RPG.quests.isDone('q2')) {
      return { ok: false, line: STAIR_SHUT };
    }
    return { ok: true };
  }

  RPG.dungeon = {
    load: load,
    sample: sample,
    normalize: normalize,
    fallbackSample: fallbackSample,
    canEnter: canEnter,
  };
})(typeof window !== 'undefined' ? window : globalThis);
