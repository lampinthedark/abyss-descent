/**
 * RPG items: bank. Flat list (400 stacks) with an optional tab number per
 * entry (0 = main, 1..8 user tabs). Every stackable merges into one entry;
 * non-stackable gear keeps one entry per item (each has its own rolls).
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

  function bankIndex(s, uid) {
    for (var i = 0; i < s.bank.items.length; i++) if (s.bank.items[i].uid === uid) return i;
    return -1;
  }
  function bankPut(s, inst, tab) {
    S.claim(s, inst);
    for (var i = 0; i < s.bank.items.length; i++) {
      var b = s.bank.items[i];
      if (Gen.canStack(b, inst)) {
        if (b.qty + inst.qty > S.MAX_STACK) S.fail('stack_overflow');
        b.qty += inst.qty;
        return { index: i, uid: b.uid, merged: true };
      }
    }
    if (s.bank.items.length >= s.bank.cap) S.fail('bank_full');
    inst.tab = tab != null ? tab : (inst.tab || 0);
    s.bank.items.push(inst);
    return { index: s.bank.items.length - 1, uid: inst.uid, merged: false };
  }
  function bankAccepts(s, inst) {
    if (s.bank.items.length < s.bank.cap) return true;
    return s.bank.items.some(function (b) { return Gen.canStack(b, inst); });
  }
  function depositSlot(s, slot, qty) {
    var it = s.inv[slot];
    if (!it) S.fail('no_item');
    // Check BEFORE touching the backpack: deposit_all catches bank_full per slot,
    // so a throw after invTake would lose the item inside the draft.
    if (!bankAccepts(s, it)) S.fail('bank_full');
    var t = S.invTake(s, slot, qty == null ? it.qty : qty);
    delete t.tab;
    return bankPut(s, t);
  }

  var reducers = {
    'bank.deposit': function (s, p, op, X) {
      var i = S.invIndex(s, p.uid);
      if (i < 0) S.fail('no_item');
      var r = depositSlot(s, i, p.qty);
      X.emit('bank', { reason: 'deposit' }); X.emit('inventory', { reason: 'deposit' });
      return r;
    },
    /** Deposit every backpack slot that fits; fails only if nothing could move. */
    'bank.deposit_all': function (s, p, op, X) {
      var moved = 0, left = 0;
      for (var i = 0; i < s.inv.length; i++) {
        if (!s.inv[i]) continue;
        try { depositSlot(s, i); moved++; }
        catch (e) { if (e instanceof S.ItemError && e.reason === 'bank_full') left++; else throw e; }
      }
      if (!moved) S.fail(left ? 'bank_full' : 'nothing_to_deposit');
      X.emit('bank', { reason: 'deposit_all' }); X.emit('inventory', { reason: 'deposit_all' });
      return { moved: moved, left: left };
    },
    'bank.withdraw': function (s, p, op, X) {
      var i = bankIndex(s, p.uid);
      if (i < 0) S.fail('no_item');
      var it = s.bank.items[i];
      var qty = p.qty == null ? it.qty : p.qty;
      var t = S.takeFrom(s, s.bank.items, i, qty, function (k) { s.bank.items.splice(k, 1); });
      delete t.tab;
      var put = S.invPut(s, t);   // inventory_full -> whole op rolls back
      X.emit('bank', { reason: 'withdraw' }); X.emit('inventory', { reason: 'withdraw' });
      return put;
    },
    'bank.tab': function (s, p, op, X) {
      var i = bankIndex(s, p.uid);
      if (i < 0) S.fail('no_item');
      if (!(Number.isInteger(p.tab) && p.tab >= 0 && p.tab < S.BANK_TABS)) S.fail('bad_tab');
      s.bank.items[i].tab = p.tab;
      X.emit('bank', { reason: 'tab' });
      return {};
    },
    'bank.move': function (s, p, op, X) {
      var i = bankIndex(s, p.uid);
      if (i < 0) S.fail('no_item');
      var to = Math.max(0, Math.min(s.bank.items.length - 1, p.index | 0));
      var it = s.bank.items.splice(i, 1)[0];
      s.bank.items.splice(to, 0, it);
      X.emit('bank', { reason: 'move' });
      return { index: to };
    },
  };

  function entryView(it, i) {
    var v = RPG.Modules.inventory.view(it, i);
    v.tab = it.tab || 0;
    return v;
  }

  RPG.Modules.bank = {
    name: 'Bank',
    reducers: reducers,
    api: function (w) {
      var api = {
        /** Emits 'bank:open' with the view; the UI listens and shows the panel. */
        open: function () { var v = api.view(); w.emit('bank:open', v); return v; },
        close: function () { w.emit('bank:close', {}); },
        view: function (tab) {
          var s = w.state();
          return { cap: s.bank.cap, used: s.bank.items.length, tabs: S.BANK_TABS, gold: s.gold,
            items: api.list(tab) };
        },
        list: function (tab) {
          return w.state().bank.items.map(entryView).filter(function (v) { return tab == null || v.tab === tab; });
        },
        /** Case-insensitive search over names, base names, categories, rarity and affix text. */
        search: function (q) {
          q = String(q || '').toLowerCase().trim();
          if (!q) return api.list();
          return w.state().bank.items.filter(function (it) {
            var d = Gen.describe(it);
            var hay = [d.name, d.baseName, d.rarityName, Db.getBase(it.base).cat, it.base]
              .concat(d.lines.map(function (l) { return l.text; })).join(' ').toLowerCase();
            return hay.indexOf(q) >= 0;
          }).map(function (it) { return entryView(it, bankIndex(w.state(), it.uid)); });
        },
        /** deposit(uid | inventory slot, qty?) */
        deposit: function (uidOrSlot, qty) {
          var uid = typeof uidOrSlot === 'number' ? (w.state().inv[uidOrSlot] || {}).uid : uidOrSlot;
          return w.commit('bank.deposit', { uid: uid, qty: qty });
        },
        depositAll: function () { return w.commit('bank.deposit_all', {}); },
        withdraw: function (uid, qty) { return w.commit('bank.withdraw', { uid: uid, qty: qty }); },
        setTab: function (uid, tab) { return w.commit('bank.tab', { uid: uid, tab: tab }); },
        move: function (uid, index) { return w.commit('bank.move', { uid: uid, index: index }); },
        count: function (baseId) {
          return w.state().bank.items.reduce(function (n, it) { return n + (it.base === baseId ? it.qty : 0); }, 0);
        },
        get: function (uid) { var i = bankIndex(w.state(), uid); return i < 0 ? null : Gen.describe(w.state().bank.items[i]); },
        item: function (uid) { var i = bankIndex(w.state(), uid); return i < 0 ? null : Core.clone(w.state().bank.items[i]); },
      };
      return api;
    },
  };
});
