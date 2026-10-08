/**
 * Kill path for mobs. One `kill` emit, then Loot.rollDrop.
 * Rare+ beams only when the drop says d.beam.
 * Ashmaw always leaves a beamed rare or better. If the items table
 * does not, a placeholder Ashmaw Cache is spawned until it does.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});
  let dropSeq = 1;

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

  function fx(name) {
    const args = [name];
    for (let i = 1; i < arguments.length; i++) args.push(arguments[i]);
    if (typeof RPG.fx === 'function') {
      try { return RPG.fx.apply(RPG, args); } catch (err) { return null; }
    }
    if (RPG.ai && RPG.ai.attacks && typeof RPG.ai.attacks.fx === 'function') {
      try { return RPG.ai.attacks.fx.apply(null, args); } catch (err) { return null; }
    }
    return null;
  }

  function lootRng() {
    try {
      if (typeof RPG.rng === 'function') {
        const gen = RPG.rng('loot');
        if (typeof gen === 'function') return gen;
      }
    } catch (err) {}
    let s = 90210;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function lootApi() {
    if (root.Loot && typeof root.Loot.rollDrop === 'function') return root.Loot;
    if (RPG.Loot && typeof RPG.Loot.rollDrop === 'function') return RPG.Loot;
    if (RPG.items && typeof RPG.items.rollDrop === 'function') return RPG.items;
    return null;
  }

  function asList(rolled) {
    if (!rolled) return [];
    if (Array.isArray(rolled)) return rolled.filter(Boolean);
    if (Array.isArray(rolled.drops)) {
      return rolled.drops.filter(Boolean).map(function (drop) {
        if (rolled.beam && drop.beam == null) drop.beam = true;
        return drop;
      });
    }
    if (rolled.item) {
      const item = rolled.item;
      if (rolled.beam && item.beam == null) item.beam = true;
      return [item];
    }
    return [rolled];
  }

  function isRarePlus(drop) {
    if (!drop || !drop.beam) return false;
    const rarity = String(drop.rarity || '').toLowerCase();
    return rarity === 'rare' || rarity === 'epic' || rarity === 'legendary' || rarity === 'unique';
  }

  function ensureBossDrop(list, mob) {
    if (!mob || mob.monsterId !== 'ashmaw') return list;
    for (let i = 0; i < list.length; i++) {
      if (isRarePlus(list[i])) return list;
    }
    list.push({
      id: 'ashmaw-cache',
      name: 'Ashmaw Cache',
      rarity: 'rare',
      beam: true,
      placeholder: true,
      monsterId: 'ashmaw',
    });
    return list;
  }

  function spawnDrop(drop, mob, index) {
    const ent = {
      id: 'drop-' + (dropSeq++),
      kind: 'drop',
      x: mob.x + 0.28 * index,
      y: mob.y + 0.18 * (index % 2),
      item: drop,
      rarity: drop.rarity || '',
      beam: !!drop.beam,
      label: drop.name || drop.rarity || 'Drop',
      monsterId: mob.monsterId,
      taken: false,
    };
    ent.onTap = function () { pickup(ent); };
    const world = RPG.world;
    if (world && typeof world.addEntity === 'function') {
      try { world.addEntity(ent); } catch (err) {}
    }
    if (typeof RPG.registerTappable === 'function') {
      try { RPG.registerTappable(ent); } catch (err) {}
    }
    if (drop.beam) {
      fx('beam', ent.x, ent.y, drop.rarity || 'rare', drop);
    }
    return ent;
  }

  function pickup(ent) {
    if (!ent || ent.taken) return;
    ent.taken = true;
    const item = ent.item;
    const hero = RPG.hero;
    if (hero && Array.isArray(hero.inventory)) hero.inventory.push(item);
    if (RPG.items && typeof RPG.items.grant === 'function') {
      try { RPG.items.grant(item, ent); } catch (err) {}
    }
    const world = RPG.world;
    if (world && typeof world.removeEntity === 'function') {
      try { world.removeEntity(ent); } catch (err) {}
    }
  }

  function onKill(mob) {
    if (!mob || mob._killEmitted) return [];
    mob._killEmitted = true;
    const rng = lootRng();
    let rolled = null;
    const api = lootApi();
    if (api) {
      try { rolled = api.rollDrop(mob.monsterId, rng, mob.x, mob.y); } catch (err) { rolled = null; }
    }
    const list = ensureBossDrop(asList(rolled), mob);
    const spawned = [];
    for (let i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      spawned.push(spawnDrop(list[i], mob, i));
    }
    emit('kill', {
      monsterId: mob.monsterId,
      x: mob.x,
      y: mob.y,
      elite: !!mob.elite,
      boss: !!mob.boss,
    });
    if (RPG.ai && typeof RPG.ai.forget === 'function') {
      try { RPG.ai.forget(mob); } catch (err) {}
    }
    // Leave the mob in the world. Death holds the last corpse frame (or an
    // idle box when that clip is missing) until core despawns it.
    return spawned;
  }

  RPG.drops = {
    onKill: onKill,
    pickup: pickup,
    isRarePlus: isRarePlus,
  };
})(typeof window !== 'undefined' ? window : globalThis);
