/**
 * RPG items: core helpers (namespace, seeded RNG, hashing, clone, events).
 *
 * Every js/rpg/items/*.js file is a classic script that also works under Node:
 *   browser: <script src="js/rpg/items/core.js"></script> ... adds to window.RPGItems
 *   node:    const RPGItems = require('./js/rpg/items/index.js');
 * GD's core lives in js/rpg/ and the old game still has a global `Loot`
 * (js/loot.js), so everything here hangs off ONE global, `RPGItems`.
 * RPGItems.installGlobals(world) adds the short names core calls
 * (Loot, Inventory, Equipment, Bank, Shop, Crafting, ItemSave, ItemIds)
 * once the old js/loot.js is retired.
 *
 * Determinism contract (server re-verification): all randomness that
 * affects an item comes from mulberry32(seed) where seed is a uint32
 * stored on the item / op. hash32 is FNV-1a over UTF-16 code units.
 * A server implementation must port exactly these two functions.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? {} : (root.RPGItems = root.RPGItems || {});
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';

  /** FNV-1a 32-bit hash of a string → uint32. */
  function hash32(str) {
    str = String(str);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /** mulberry32 PRNG: returns fn() → float in [0,1). Deterministic per seed. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    var fn = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return fn;
  }

  /** Small RNG wrapper with helpers. Accepts a seed (number|string) or a () => float. */
  function makeRng(seedOrFn) {
    var next = typeof seedOrFn === 'function' ? seedOrFn
      : mulberry32(typeof seedOrFn === 'string' ? hash32(seedOrFn) : (seedOrFn >>> 0));
    return {
      next: next,
      /** integer in [min, max] inclusive */
      int: function (min, max) { return min + Math.floor(next() * (max - min + 1)); },
      /** uint32, used to mint item/op seeds */
      u32: function () { return Math.floor(next() * 4294967296) >>> 0; },
      chance: function (p) { return next() < p; },
      /** pick from [{weight}] by weight */
      weighted: function (list) {
        var total = 0, i;
        for (i = 0; i < list.length; i++) total += list[i].weight || 0;
        if (total <= 0) return null;
        var r = next() * total;
        for (i = 0; i < list.length; i++) {
          r -= list[i].weight || 0;
          if (r < 0) return list[i];
        }
        return list[list.length - 1];
      },
    };
  }

  /** Mix several values into one uint32 seed (order-sensitive). */
  function mixSeed() {
    var s = '';
    for (var i = 0; i < arguments.length; i++) s += '|' + arguments[i];
    return hash32(s);
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  /** Minimal event emitter; listener errors never break the game loop. */
  function createEmitter() {
    var map = {};
    return {
      on: function (ev, fn) { (map[ev] = map[ev] || []).push(fn); return function () { off(ev, fn); }; },
      off: off,
      emit: function (ev, data) {
        var l = (map[ev] || []).slice().concat(map['*'] || []);
        for (var i = 0; i < l.length; i++) {
          try { l[i](data, ev); } catch (e) { if (typeof console !== 'undefined') console.warn('[RPG] listener error', ev, e); }
        }
      },
    };
    function off(ev, fn) { map[ev] = (map[ev] || []).filter(function (f) { return f !== fn; }); }
  }

  function randomDeviceId() {
    var s = '';
    var c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    for (var i = 0; i < 4; i++) {
      var n = c ? c.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
      s += (n >>> 0).toString(36);
    }
    return 'd' + s.slice(0, 16);
  }

  RPG.Core = {
    hash32: hash32,
    mulberry32: mulberry32,
    makeRng: makeRng,
    mixSeed: mixSeed,
    clone: clone,
    createEmitter: createEmitter,
    randomDeviceId: randomDeviceId,
  };
});
