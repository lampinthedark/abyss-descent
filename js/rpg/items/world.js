/**
 * RPG items: the world (one player's item state) + the op engine.
 *
 *   const Items = RPGItems.createWorld({ playerId, getLevels, now });
 *   Items.ItemSave.load(); Items.ItemSave.installLifecycle();
 *   RPGItems.installGlobals(Items);   // window.Loot / Inventory / Equipment / ...
 *
 * Every saved item change goes through commit(type, payload):
 *   validate+apply on a cloned draft (module reducers) -> swap in -> log op ->
 *   emit events -> schedule save. A reducer that throws ItemError aborts with
 *   NO change (this is what makes crafting/buying/equipping atomic).
 * Ops carry everything needed to replay them (seeds, level snapshots, time),
 * so world.replay(ops) rebuilds identical state; ops already applied (by
 * deviceId:seq) are skipped, which makes delivery idempotent.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./state.js') : root.RPGItems;
  if (isNode) ['./gold.js', './inventory.js', './ground.js', './equipment.js', './bank.js', './shop.js', './crafting.js', './item-save.js']
    .forEach(function (f) { require(f); });
  factory(RPG, root);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG, root) {
  'use strict';
  var Core = RPG.Core, S = RPG.State;
  var MODULE_ORDER = ['gold', 'inventory', 'ground', 'equipment', 'bank', 'shop', 'crafting', 'itemSave'];

  var idsReducers = {
    /** Reserve an id from THE item id counter (ItemIds.next()). */
    'ids.reserve': function (s, p) { return { id: RPG.ItemIds.next(s, p.kind || 'item') }; },
    /** Server confirmed an item: record its server id, mark trusted. */
    'ids.adopt': function (s, p, op, X) {
      var f = S.findItem(s, p.uid);
      if (!f) S.fail('no_item');
      if (!p.sid) S.fail('bad_sid');
      f.item.sid = String(p.sid);
      f.item.untrusted = false;
      X.emit('ids', { uid: p.uid, sid: f.item.sid });
      return {};
    },
  };

  function allReducers() {
    var all = {};
    Object.keys(idsReducers).forEach(function (k) { all[k] = idsReducers[k]; });
    MODULE_ORDER.forEach(function (m) {
      var mod = RPG.Modules[m];
      if (!mod) throw new Error('RPGItems module missing: ' + m + ' (check <script> order)');
      Object.keys(mod.reducers).forEach(function (k) { all[k] = mod.reducers[k]; });
    });
    return all;
  }

  function createWorld(opts) {
    opts = opts || {};
    var REDUCERS = allReducers();
    var emitter = Core.createEmitter();
    var deviceId = opts.deviceId || Core.randomDeviceId();
    var state = S.newState({ playerId: opts.playerId, deviceId: deviceId,
      lootSeed: opts.lootSeed != null ? opts.lootSeed : Core.hash32(deviceId + '|loot') });
    var outbox = [];
    var overflow = false;
    var nowFn = opts.now || function () { return Date.now(); };

    var w = {
      opts: opts,
      state: function () { return state; },
      outbox: function () { return outbox.slice(); },
      now: function () { return nowFn(); },
      levels: function () { try { return (opts.getLevels && opts.getLevels()) || {}; } catch (e) { return {}; } },
      emit: function (ev, d) { emitter.emit(ev, d); },
      commit: function (type, payload) {
        var op = { key: state.deviceId + ':' + (state.seq + 1), dev: state.deviceId, seq: state.seq + 1,
          type: type, p: Core.clone(payload), at: nowFn() };
        return apply(op, true);
      },
      _replaceState: function (st, ob, of) { state = st; outbox = ob.slice(); overflow = of; emitter.emit('change', { type: 'load' }); },
      _trimOutbox: function (n) { if (outbox.length > n) { outbox = outbox.slice(-n); overflow = true; } },
      _outboxOverflow: function () { return overflow; },
      _ack: function (upto) { outbox = outbox.filter(function (o) { return o.dev !== state.deviceId || o.seq > upto; }); },
    };

    function apply(op, local) {
      if ((state.applied[op.dev] || 0) >= op.seq) return { ok: true, duplicate: true, op: op.key };
      var reducer = REDUCERS[op.type];
      if (!reducer) return { ok: false, reason: 'unknown_op' };
      var draft = Core.clone(state);
      var events = [];
      var X = { emit: function (e, d) { events.push([e, d]); } };
      var result;
      try {
        result = reducer(draft, op.p, op, X) || {};
      } catch (e) {
        if (e instanceof S.ItemError) {
          emitter.emit('rejected', { type: op.type, reason: e.reason, info: e.info });
          return { ok: false, reason: e.reason, info: e.info };
        }
        throw e;
      }
      draft.applied[op.dev] = op.seq;
      if (op.dev === draft.deviceId) draft.seq = Math.max(draft.seq, op.seq);
      draft.rev += 1;
      op.rev = draft.rev;
      state = draft;
      if (local) outbox.push(op);
      emitter.emit('op', op);
      events.forEach(function (ev) { emitter.emit(ev[0], ev[1]); });
      emitter.emit('change', { type: op.type });
      if (api.ItemSave) api.ItemSave.schedule();
      var out = { ok: true, op: op.key };
      for (var k in result) out[k] = result[k];
      return out;
    }

    var api = {
      on: emitter.on, off: emitter.off,
      /** Read-only deep copy of the full item state. */
      snapshot: function () { return Core.clone(state); },
      /** Apply ops from a log (server replay / another tab). Already-applied keys are skipped. */
      replay: function (ops) { return ops.map(function (op) { return apply(Core.clone(op), false); }); },
      checkInvariants: function () { return S.checkInvariants(state); },
      deviceId: function () { return state.deviceId; },
      ItemIds: {
        /** THE item id function: provisional "item_<clientId>_<n>"; core must not mint item ids. */
        next: function (kind) { var r = w.commit('ids.reserve', { kind: kind || 'item' }); return r.ok ? r.id : null; },
        /** Record a server id for a provisional item (sync layer, week 3+). */
        adopt: function (uid, sid) { return w.commit('ids.adopt', { uid: uid, sid: sid }); },
        parse: RPG.ItemIds.parse,
        isProvisional: RPG.ItemIds.isProvisional,
      },
      _w: w,
    };
    MODULE_ORDER.forEach(function (m) {
      var mod = RPG.Modules[m];
      api[mod.name] = mod.api(w);
      if (mod.extra) { var ex = mod.extra(w); for (var k in ex) api[k] = ex[k]; }
    });
    return api;
  }

  var GLOBAL_NAMES = ['Loot', 'Inventory', 'Equipment', 'Bank', 'Shop', 'Crafting', 'ItemSave', 'ItemIds', 'Gold', 'Ground'];
  /**
   * Expose the short names from GD's plan (Loot.rollDrop, Equipment.getStats, ...)
   * as globals bound to one world. Refuses to clobber the OLD js/loot.js `Loot`
   * unless force is set (retire js/loot.js first, as the plan says).
   */
  function installGlobals(world, target, force) {
    target = target || root;
    var skipped = [];
    GLOBAL_NAMES.forEach(function (n) {
      var cur = target[n];
      var isOldLoot = n === 'Loot' && cur && typeof cur.dropFromEnemy === 'function';
      if (cur && !force && (isOldLoot || !cur.__rpgItems)) { skipped.push(n); return; }
      var v = world[n];
      try { Object.defineProperty(v, '__rpgItems', { value: true, enumerable: false }); } catch (e) {}
      target[n] = v;
    });
    return { installed: GLOBAL_NAMES.filter(function (n) { return skipped.indexOf(n) < 0; }), skipped: skipped };
  }

  RPG.createWorld = createWorld;
  RPG.installGlobals = installGlobals;
  RPG.GLOBAL_NAMES = GLOBAL_NAMES;
});
