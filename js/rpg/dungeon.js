/**
 * Dungeon loader. Zone shape:
 *   { grid, spawns, entry, bossRoom, exit }
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

  /** Small crypt GD can load before real zone data exists. 1 = wall, 0 = floor. */
  function sample() {
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
    };
  }

  function load(zone) {
    if (!zone || typeof zone !== 'object') return { spawned: [], exit: null };
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
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      if (!s || typeof RPG.ai === 'undefined' || typeof RPG.ai.spawnPack !== 'function') continue;
      const id = s.monsterId || s.id;
      const count = s.n == null ? (s.count == null ? 1 : s.count) : s.n;
      const pack = RPG.ai.spawnPack(id, s.x, s.y, count, s.leash);
      for (let j = 0; j < pack.length; j++) {
        if (s.elite) pack[j].elite = true;
        spawned.push(pack[j]);
      }
    }
    if (zone.bossRoom && RPG.ai && RPG.ai.boss && typeof RPG.ai.boss.spawn === 'function') {
      const boss = RPG.ai.boss.spawn(zone.bossRoom.x, zone.bossRoom.y, zone.bossRoom);
      if (boss) spawned.push(boss);
    }
    emit('enter', { zone: zone });
    return { spawned: spawned, exit: zone.exit || null };
  }

  RPG.dungeon = {
    load: load,
    sample: sample,
  };
})(typeof window !== 'undefined' ? window : globalThis);
