/**
 * RPG items: 28-slot backpack.
 *
 * Stackables (ores, bars, logs, fish, food, junk) merge into one slot.
 * A full backpack either refuses cleanly (default) or, when the caller
 * passes overflow:'ground', puts the overflow on the ground.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./state.js') : root.RPGItems;
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var S = RPG.State, Db = RPG.ItemsDb, Gen = RPG.ItemGen, Core = RPG.Core;
  var GRANT_SOURCES = ['quest', 'starter', 'dev', 'gather'];

  function groundPut(s, item, p, op) {
    s.ground.push({ gid: item.uid, item: item, x: p.x || 0, y: p.y || 0, until: op.at + S.GROUND_MS, src: 'overflow' });
  }

  var reducers = {
    /** Faucet for quest rewards / starter kit. p: { src, ref, items:[inst], gold, overflow, x, y } */
    'inv.grant': function (s, p, op, X) {
      if (GRANT_SOURCES.indexOf(p.src) < 0) S.fail('bad_item_source', p.src);
      var placed = [], grounded = [];
      (p.items || []).forEach(function (raw) {
        var inst = Core.clone(raw);
        inst.uid = null;
        S.mint(s, inst, p.src);
        try { placed.push(S.invPut(s, inst)); }
        catch (e) {
          if (!(e instanceof S.ItemError) || e.reason !== 'inventory_full' || p.overflow !== 'ground') throw e;
          groundPut(s, inst, p, op);
          grounded.push(inst.uid);
        }
      });
      var gold = 0;
      if (p.gold) {
        if (p.src !== 'quest') S.fail('bad_gold_source', p.src);
        gold = S.credit(s, p.gold, 'quest', p.ref, op);
        X.emit('gold', { balance: s.gold, delta: gold, src: 'quest' });
      }
      X.emit('inventory', { reason: 'grant' });
      if (grounded.length) X.emit('ground', { added: grounded });
      return { placed: placed, grounded: grounded, gold: gold };
    },
    /** p: { uid } or { base }, qty, sink: consume|destroy|quest_turnin */
    'inv.remove': function (s, p, op, X) {
      var sink = p.sink || 'destroy';
      if (['consume', 'destroy', 'quest_turnin'].indexOf(sink) < 0) S.fail('bad_item_sink', sink);
      var qty = p.qty == null ? 1 : p.qty;
      var taken;
      if (p.uid) {
        var i = S.invIndex(s, p.uid);
        if (i < 0) S.fail('no_item');
        taken = [S.invTake(s, i, qty)];
      } else {
        if (!(Number.isInteger(qty) && qty >= 1)) S.fail('bad_qty');
        taken = S.invTakeBase(s, p.base, qty);
      }
      taken.forEach(function (t) { S.burn(s, t.base, t.qty, sink); });
      X.emit('inventory', { reason: 'remove' });
      return { removed: taken.reduce(function (a, t) { return a + t.qty; }, 0) };
    },
    /** Swap two backpack slots. */
    'inv.move': function (s, p, op, X) {
      var a = p.from, b = p.to;
      if (!(a >= 0 && a < S.INV_SIZE && b >= 0 && b < S.INV_SIZE) || a !== Math.floor(a) || b !== Math.floor(b)) S.fail('bad_slot');
      if (!s.inv[a]) S.fail('no_item');
      var t = s.inv[a]; s.inv[a] = s.inv[b]; s.inv[b] = t;
      X.emit('inventory', { reason: 'move' });
      return {};
    },
    /** Eat one food from a slot. Returns heal for the game to apply. */
    'inv.use': function (s, p, op, X) {
      var it = s.inv[p.slot];
      if (!it) S.fail('no_item');
      var base = Db.getBase(it.base);
      if (!base.heal) S.fail('not_usable');
      var t = S.invTake(s, p.slot, 1);
      S.burn(s, t.base, 1, 'consume');
      X.emit('inventory', { reason: 'use' });
      X.emit('consume', { base: base.id, heal: base.heal });
      return { heal: base.heal, base: base.id };
    },
    /** Drop from backpack to the ground. Quest items cannot be dropped (destroy them instead). */
    'inv.drop': function (s, p, op, X) {
      var it = s.inv[p.slot];
      if (!it) S.fail('no_item');
      if (Db.getBase(it.base).quest) S.fail('cannot_drop_quest_item');
      var t = S.invTake(s, p.slot, p.qty == null ? it.qty : p.qty);
      groundPut(s, t, p, op);
      s.ground[s.ground.length - 1].src = 'player';
      X.emit('inventory', { reason: 'drop' });
      X.emit('ground', { added: [t.uid] });
      return { gid: t.uid };
    },
  };

  function view(it, slot) {
    if (!it) return null;
    var base = Db.getBase(it.base);
    return {
      slot: slot, uid: it.uid, base: it.base, name: Gen.displayName(it), qty: it.qty,
      stackable: base.stackable, rarity: it.rarity, color: Db.colorFor(it.rarity), bound: it.bound,
      equipSlot: base.slot || null, usable: !!base.heal,
    };
  }

  RPG.Modules.inventory = {
    name: 'Inventory',
    reducers: reducers,
    view: view,
    api: function (w) {
      function makeItems(list, seedTag) {
        var s = w.state();
        return list.map(function (e, i) {
          var base = Db.getBase(e.base);
          return Gen.createInstance(e.base, {
            rarity: e.rarity, qty: base.stackable ? (e.qty || 1) : 1,
            seed: e.seed != null ? e.seed : Core.mixSeed(s.lootSeed, seedTag, s.seq + 1, i),
            origin: { src: e.src || 'quest', ref: e.ref || null, at: w.now() },
          });
        });
      }
      function expand(list) {
        // Non-stackables with qty > 1 become N separate instances.
        var out = [];
        list.forEach(function (e) {
          var base = Db.getBase(e.base);
          var n = base.stackable ? 1 : Math.max(1, e.qty || 1);
          for (var i = 0; i < n; i++) out.push(Object.assign({}, e, { qty: base.stackable ? e.qty : 1 }));
        });
        return out;
      }
      var api = {
        SIZE: S.INV_SIZE,
        /**
         * Add a fresh item (quest reward, starter kit). Loot goes through Ground.pickup instead.
         * opts: { src:'quest'|'starter'|'dev'|'gather', ref, rarity, seed, overflow:'ground'|'refuse', x, y }
         */
        add: function (baseId, qty, opts) {
          opts = opts || {};
          return api.grant({ src: opts.src || 'quest', ref: opts.ref, overflow: opts.overflow, x: opts.x, y: opts.y,
            items: [{ base: baseId, qty: qty || 1, rarity: opts.rarity, seed: opts.seed }] });
        },
        /** Quest reward bundle: { src:'quest', ref, gold, items:[{base, qty, rarity}], overflow, x, y } */
        grant: function (g) {
          var items = makeItems(expand(g.items || []).map(function (e) { return Object.assign({ src: g.src, ref: g.ref }, e); }), 'grant');
          return w.commit('inv.grant', { src: g.src || 'quest', ref: g.ref || null, items: items, gold: g.gold || 0,
            overflow: g.overflow || 'refuse', x: g.x, y: g.y });
        },
        /** remove(baseIdOrUid, qty=1, sink='destroy'|'consume'|'quest_turnin') */
        remove: function (idOrBase, qty, sink) {
          var p = Db.hasBase(idOrBase) ? { base: idOrBase } : { uid: idOrBase };
          p.qty = qty == null ? 1 : qty;
          p.sink = sink || 'destroy';
          return w.commit('inv.remove', p);
        },
        has: function (baseId, qty) { return S.invCount(w.state(), baseId) >= (qty == null ? 1 : qty); },
        count: function (baseId) { return S.invCount(w.state(), baseId); },
        free: function () { return S.invFree(w.state()); },
        isFull: function () { return S.invFree(w.state()) === 0; },
        /** Would these fit? [{base, qty}] */
        fits: function (list) { return S.invFits(w.state(), makeItems(expand(list), 'probe')); },
        move: function (from, to) { return w.commit('inv.move', { from: from, to: to }); },
        use: function (slot) { return w.commit('inv.use', { slot: slot }); },
        drop: function (slot, qty, x, y) { return w.commit('inv.drop', { slot: slot, qty: qty, x: x, y: y }); },
        /** 28 entries (null = empty) for the grid UI. */
        list: function () { return w.state().inv.map(view); },
        get: function (slot) { var it = w.state().inv[slot]; return it ? Gen.describe(it) : null; },
        slotOf: function (uid) { return S.invIndex(w.state(), uid); },
        item: function (slot) { return Core.clone(w.state().inv[slot]); },
      };
      return api;
    },
  };
});
