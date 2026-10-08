/**
 * Stand-in for the Senior Game Dev's items API until the real module ships.
 * Each global is defined ONLY if the real one is absent, so loading the real
 * items scripts first (or later replacing this file) needs no core change.
 *
 * Core consumes, never owns, item shapes:
 *   Loot.rollDrop(monsterId, rng) -> []      (first-Rare pity lives in Loot)
 *   Equipment.getStats()          -> zero stats
 *   Crafting.make(recipeId)       -> null
 *   ItemIds.next()                -> the single item-id function (counter)
 *   ItemSave.flush()              -> no-op (core calls it on every save trigger)
 *
 * RPG.bootItems(): creates the real items world once js/rpg/items/*.js is on
 * the page (window.RPGItems), per docs/rpg-items-integration.md, with
 *   getLevels: () => RPG.skills ? RPG.skills.levels() : {}   (levels is a function)
 * then load / starter kit / lifecycle / installGlobals (replaces these stubs).
 * main.js calls it at boot; without RPGItems (D1) it is a no-op.
 */
(function (root) {
  'use strict';

  // Mark a stub so RPGItems.installGlobals() (js/rpg/items/world.js) replaces
  // it: that installer skips any existing global without __rpgItems.
  function stub(obj) {
    try {
      Object.defineProperty(obj, '__rpgItems', { value: true, enumerable: false });
    } catch (e) {}
    return obj;
  }

  function absent(name) {
    // typeof covers top-level const/let globals that are not window properties.
    try {
      // eslint-disable-next-line no-new-func
      if (new Function('return typeof ' + name + " !== 'undefined'")()) return false;
    } catch (e) {}
    return root[name] === undefined;
  }

  if (absent('Loot')) {
    root.Loot = stub({
      __stub: true,
      rollDrop(monsterId, rng) {
        return [];
      },
    });
  }

  if (absent('Equipment')) {
    root.Equipment = stub({
      __stub: true,
      getStats() {
        return { aim: 0, power: 0, armour: 0, def: 0, maxHp: 0, attackSpeed: 0, crit: 0, lifesteal: 0, cooldown: 0, gather: 0, specials: [] };
      },
    });
  }

  if (absent('Crafting')) {
    root.Crafting = stub({
      __stub: true,
      make(recipeId) {
        return null;
      },
    });
  }

  if (absent('ItemIds')) {
    let n = 0;
    root.ItemIds = stub({
      __stub: true,
      next() {
        n += 1;
        return 'item_stub_' + n;
      },
    });
  }

  if (absent('ItemSave')) {
    root.ItemSave = stub({
      __stub: true,
      flush() {},
    });
  }

  const RPG = (root.RPG = root.RPG || {});
  /** Options core passes to RPGItems.createWorld (contract with Skills & Quests). */
  RPG.itemsWorldOptions = function () {
    return {
      playerId: 'local', // account id once the server exists
      // RPG.skills.levels is a function (Skills & Quests); called on every read.
      getLevels: function () {
        if (!RPG.skills) return {};
        const L = RPG.skills.levels;
        return typeof L === 'function' ? L.call(RPG.skills) : L || {};
      },
    };
  };
  /** Create + install the real items world if its scripts are loaded. Idempotent. */
  RPG.bootItems = function () {
    if (RPG.items) return { ok: true, reason: 'already' };
    const R = root.RPGItems;
    if (!R || typeof R.createWorld !== 'function') return { ok: false, reason: 'no_items_module' };
    const Items = R.createWorld(RPG.itemsWorldOptions());
    const loaded = Items.ItemSave && Items.ItemSave.load ? Items.ItemSave.load() : { ok: false, reason: 'no_save' };
    if (!loaded.ok && loaded.reason === 'no_save' && Items.Inventory && Items.Inventory.grant) {
      Items.Inventory.grant({ src: 'starter', items: [
        { base: 'rustbound_sword' }, { base: 'rustbound_pickaxe' }, { base: 'rustbound_hatchet' },
        { base: 'fishing_rod' }, { base: 'smithing_hammer' }, { base: 'hearth_bread', qty: 3 }] });
    }
    if (Items.ItemSave && Items.ItemSave.installLifecycle) Items.ItemSave.installLifecycle();
    const inst = typeof R.installGlobals === 'function' ? R.installGlobals(Items) : null;
    RPG.items = Items;
    return { ok: true, loaded: loaded, installed: inst };
  };
})(typeof window !== 'undefined' ? window : globalThis);
