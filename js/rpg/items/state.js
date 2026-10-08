/**
 * RPG items: world state shape + low-level helpers shared by the module
 * reducers (inventory, equipment, bank, shop, crafting, gold).
 *
 * Reducers run on a cloned draft inside world.commit(); throwing
 * ItemError aborts the op and leaves the real state untouched (atomic).
 * Reducers are written so the same code can run server-side.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./item-gen.js') : root.RPGItems;
  if (isNode) require('./item-ids.js');
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var Db = RPG.ItemsDb, Gen = RPG.ItemGen;

  var INV_SIZE = 28;
  var BANK_CAP = 400;
  var BANK_TABS = 9;
  var LEDGER_KEEP = 200;
  var GROUND_MS = 3 * 60 * 1000;      // unclaimed ground items vanish after 3 min
  var MAX_STACK = 2147483647;

  /** Where gold may come from / go to. Nothing else can change the balance. */
  var GOLD_CREDIT = ['drop', 'quest', 'shop_sell', 'migration'];
  var GOLD_DEBIT = ['shop_buy'];
  /** Where items may come from / go to. */
  var ITEM_SOURCES = ['drop', 'quest', 'shop_buy', 'craft', 'gather', 'migration', 'starter', 'dev'];
  var ITEM_SINKS = ['shop_sell', 'craft', 'consume', 'destroy', 'despawn', 'quest_turnin'];

  function ItemError(reason, info) {
    this.name = 'ItemError';
    this.reason = reason;
    this.info = info || null;
    this.message = 'item op failed: ' + reason;
  }
  ItemError.prototype = Object.create(Error.prototype);
  function fail(reason, info) { throw new ItemError(reason, info); }

  function newState(opts) {
    opts = opts || {};
    var equip = {};
    Db.SLOTS.forEach(function (s) { equip[s] = null; });
    var inv = [];
    for (var i = 0; i < INV_SIZE; i++) inv.push(null);
    return {
      schema: 1,
      playerId: opts.playerId || 'local',
      deviceId: opts.deviceId,
      lootSeed: (opts.lootSeed >>> 0) || 1,
      seq: 0,               // last local op seq (op key = deviceId:seq)
      rev: 0,               // bumps on every applied op (local or remote)
      idCounter: 0,         // provisional item id counter, never reused
      inv: inv,
      equip: equip,
      bank: { cap: BANK_CAP, items: [] },
      gold: 0,
      goldIn: {}, goldOut: {}, ledger: [],
      ground: [],
      shops: {},
      kills: 0, pity: 0,
      firstRare: { done: false, kills: 0, all: 0 },   // one-time new-player pity (Loot.FIRST_RARE): kills = near-town, all = every kill
      minted: {}, burned: {}, flowIn: {}, flowOut: {},
      applied: {},          // deviceId -> last applied seq (idempotency)
    };
  }

  function mintUid(s) { return RPG.ItemIds.next(s, 'item'); }

  /** Record an item entering existence (faucet). */
  function mint(s, inst, src) {
    if (ITEM_SOURCES.indexOf(src) < 0) fail('bad_item_source', src);
    var errs = Gen.validate(inst);
    if (errs.length) fail('invalid_item', errs);
    if (!inst.uid) inst.uid = mintUid(s);
    s.minted[inst.base] = (s.minted[inst.base] || 0) + inst.qty;
    s.flowIn[src] = (s.flowIn[src] || 0) + inst.qty;
    return inst;
  }
  /** Record qty of an item leaving existence (sink). */
  function burn(s, baseId, qty, sink) {
    if (ITEM_SINKS.indexOf(sink) < 0) fail('bad_item_sink', sink);
    s.burned[baseId] = (s.burned[baseId] || 0) + qty;
    s.flowOut[sink] = (s.flowOut[sink] || 0) + qty;
  }

  function claim(s, inst) {
    inst.owner = s.playerId;
    if (inst.bound && !inst.boundTo) inst.boundTo = s.playerId;
    return inst;
  }

  /* ----------------------------------------------------------- inventory */
  function invIndex(s, uid) {
    for (var i = 0; i < s.inv.length; i++) if (s.inv[i] && s.inv[i].uid === uid) return i;
    return -1;
  }
  function invFree(s) {
    var n = 0;
    for (var i = 0; i < s.inv.length; i++) if (!s.inv[i]) n++;
    return n;
  }
  function invCount(s, baseId) {
    var n = 0;
    for (var i = 0; i < s.inv.length; i++) if (s.inv[i] && s.inv[i].base === baseId) n += s.inv[i].qty;
    return n;
  }
  /** Put an instance into the backpack (merging stacks). Throws inventory_full. */
  function invPut(s, inst, preferSlot) {
    var base = Db.getBase(inst.base);
    claim(s, inst);
    if (base.stackable) {
      for (var i = 0; i < s.inv.length; i++) {
        var it = s.inv[i];
        if (it && Gen.canStack(it, inst)) {
          if (it.qty + inst.qty > MAX_STACK) fail('stack_overflow');
          it.qty += inst.qty;
          return { slot: i, uid: it.uid, merged: true };
        }
      }
    }
    var slot = (preferSlot != null && preferSlot >= 0 && !s.inv[preferSlot]) ? preferSlot : s.inv.indexOf(null);
    if (slot < 0) fail('inventory_full');
    if (!inst.uid) inst.uid = mintUid(s);
    s.inv[slot] = inst;
    return { slot: slot, uid: inst.uid, merged: false };
  }
  /** Would these instances fit (simulated on a copy)? */
  function invFits(s, insts) {
    var probe = { inv: s.inv.map(function (x) { return x ? { base: x.base, rarity: x.rarity, bound: x.bound, boundTo: x.boundTo, qty: x.qty, uid: x.uid } : null; }),
      playerId: s.playerId, deviceId: 'probe', idCounter: 0 };
    try { insts.forEach(function (x) { invPut(probe, JSON.parse(JSON.stringify(x))); }); return true; }
    catch (e) { if (e instanceof ItemError) return false; throw e; }
  }
  /**
   * Take qty from the stack/item in a container array at index. Returns the
   * taken instance (whole object if all taken; a split copy with a fresh uid
   * otherwise). Never leaves a zero/negative stack.
   */
  function takeFrom(s, arr, index, qty, removeSlot) {
    var it = arr[index];
    if (!it) fail('no_item');
    if (qty == null) qty = it.qty;
    if (!(Number.isInteger(qty) && qty >= 1)) fail('bad_qty');
    if (qty > it.qty) fail('not_enough');
    if (qty === it.qty) { removeSlot(index); return it; }
    var part = JSON.parse(JSON.stringify(it));
    part.qty = qty;
    part.uid = mintUid(s);
    part.sid = null;
    it.qty -= qty;
    return part;
  }
  function invTake(s, slot, qty) {
    return takeFrom(s, s.inv, slot, qty, function (i) { s.inv[i] = null; });
  }
  /** Remove qty of a base from the backpack across stacks (for crafting inputs, quest hand-ins). */
  function invTakeBase(s, baseId, qty) {
    if (invCount(s, baseId) < qty) fail('missing_input', { base: baseId, need: qty, have: invCount(s, baseId) });
    var left = qty, out = [];
    for (var i = s.inv.length - 1; i >= 0 && left > 0; i--) {
      var it = s.inv[i];
      if (!it || it.base !== baseId) continue;
      var n = Math.min(left, it.qty);
      out.push(invTake(s, i, n));
      left -= n;
    }
    return out;
  }

  /* ---------------------------------------------------------------- gold */
  function credit(s, amount, src, ref, op) {
    if (GOLD_CREDIT.indexOf(src) < 0) fail('bad_gold_source', src);
    if (!(Number.isInteger(amount) && amount >= 0)) fail('bad_amount');
    if (amount === 0) return 0;
    s.gold += amount;
    s.goldIn[src] = (s.goldIn[src] || 0) + amount;
    ledger(s, amount, src, ref, op);
    return amount;
  }
  function debit(s, amount, src, ref, op) {
    if (GOLD_DEBIT.indexOf(src) < 0) fail('bad_gold_sink', src);
    if (!(Number.isInteger(amount) && amount >= 0)) fail('bad_amount');
    if (amount > s.gold) fail('not_enough_gold', { need: amount, have: s.gold });
    if (amount === 0) return 0;
    s.gold -= amount;
    s.goldOut[src] = (s.goldOut[src] || 0) + amount;
    ledger(s, -amount, src, ref, op);
    return amount;
  }
  function ledger(s, delta, src, ref, op) {
    s.ledger.push({ op: op ? op.key : null, at: op ? op.at : 0, delta: delta, src: src, ref: ref || null, bal: s.gold });
    if (s.ledger.length > LEDGER_KEEP) s.ledger.splice(0, s.ledger.length - LEDGER_KEEP);
  }

  /* ------------------------------------------------------------- queries */
  /** Every item instance with its location. */
  function allItems(s) {
    var out = [];
    s.inv.forEach(function (it, i) { if (it) out.push({ where: 'inv', at: i, item: it }); });
    Db.SLOTS.forEach(function (k) { if (s.equip[k]) out.push({ where: 'equip', at: k, item: s.equip[k] }); });
    s.bank.items.forEach(function (it, i) { out.push({ where: 'bank', at: i, item: it }); });
    s.ground.forEach(function (g, i) { if (g.item) out.push({ where: 'ground', at: i, item: g.item }); });
    return out;
  }
  function holdings(s) {
    var h = {};
    allItems(s).forEach(function (e) { h[e.item.base] = (h[e.item.base] || 0) + e.item.qty; });
    return h;
  }
  function findItem(s, uid) {
    var all = allItems(s);
    for (var i = 0; i < all.length; i++) if (all[i].item.uid === uid) return all[i];
    return null;
  }

  /**
   * Invariant check used by tests (and usable as a debug assert in-game).
   * Returns [] when healthy.
   */
  function checkInvariants(s) {
    var errs = [];
    var seen = {};
    allItems(s).forEach(function (e) {
      var it = e.item;
      if (!it.uid) errs.push('item without uid at ' + e.where);
      else if (seen[it.uid]) errs.push('duplicate uid ' + it.uid);
      seen[it.uid] = true;
      if (!(Number.isInteger(it.qty) && it.qty >= 1)) errs.push('bad qty ' + it.qty + ' on ' + it.uid);
      var v = Gen.validate(it);
      if (v.length) errs.push(it.uid + ': ' + v.join(','));
      if (e.where !== 'ground' && it.owner !== s.playerId) errs.push('foreign owner ' + it.uid);
      if (it.bound && e.where !== 'ground' && it.boundTo !== s.playerId) errs.push('bound item not bound to owner ' + it.uid);
      var pid = RPG.ItemIds.parse(it.uid);
      if (!pid && !it.sid) errs.push('malformed uid ' + it.uid);
      if (pid && pid.clientId === s.deviceId && pid.n > s.idCounter) errs.push('uid beyond counter ' + it.uid);
    });
    if (s.inv.length !== INV_SIZE) errs.push('inventory size ' + s.inv.length);
    if (s.bank.items.length > s.bank.cap) errs.push('bank over capacity');
    Db.SLOTS.forEach(function (k) {
      var it = s.equip[k];
      if (it && Db.getBase(it.base).slot !== k) errs.push('wrong slot ' + k + ' for ' + it.base);
    });
    if (s.equip.weapon && Db.getBase(s.equip.weapon.base).twoHanded && s.equip.offhand) errs.push('offhand with two-handed weapon');
    var h = holdings(s);
    var bases = {};
    Object.keys(h).concat(Object.keys(s.minted), Object.keys(s.burned)).forEach(function (b) { bases[b] = 1; });
    Object.keys(bases).forEach(function (b) {
      var expect = (s.minted[b] || 0) - (s.burned[b] || 0);
      if ((h[b] || 0) !== expect) errs.push('conservation ' + b + ': have ' + (h[b] || 0) + ' expected ' + expect);
    });
    if (!(Number.isInteger(s.gold) && s.gold >= 0)) errs.push('bad gold ' + s.gold);
    var gin = 0, gout = 0, k;
    for (k in s.goldIn) { gin += s.goldIn[k]; if (GOLD_CREDIT.indexOf(k) < 0) errs.push('untagged gold source ' + k); }
    for (k in s.goldOut) { gout += s.goldOut[k]; if (GOLD_DEBIT.indexOf(k) < 0) errs.push('untagged gold sink ' + k); }
    if (gin - gout !== s.gold) errs.push('gold ledger mismatch ' + (gin - gout) + ' vs ' + s.gold);
    return errs;
  }

  RPG.State = {
    INV_SIZE: INV_SIZE, BANK_CAP: BANK_CAP, BANK_TABS: BANK_TABS, GROUND_MS: GROUND_MS, MAX_STACK: MAX_STACK,
    GOLD_CREDIT: GOLD_CREDIT, GOLD_DEBIT: GOLD_DEBIT, ITEM_SOURCES: ITEM_SOURCES, ITEM_SINKS: ITEM_SINKS,
    ItemError: ItemError, fail: fail, newState: newState, mintUid: mintUid, mint: mint, burn: burn, claim: claim,
    invIndex: invIndex, invFree: invFree, invCount: invCount, invPut: invPut, invFits: invFits,
    takeFrom: takeFrom, invTake: invTake, invTakeBase: invTakeBase,
    credit: credit, debit: debit, allItems: allItems, holdings: holdings, findItem: findItem,
    checkInvariants: checkInvariants,
  };
  RPG.Modules = RPG.Modules || {};
});
