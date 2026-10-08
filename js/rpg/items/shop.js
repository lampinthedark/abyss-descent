/**
 * RPG items: NPC shops with stock and restock timers.
 *
 * Pricing guarantees (tested): for any item and any stock level
 *   unit sell price <= floor(0.6 * value) < value <= unit buy price
 * so selling and buying back can never create gold. Shops are a gold sink.
 * Shops REFUSE Legendary and chase items (reason 'not_sellable') so nobody
 * loses one by accident. Other Rare+ or bound items sold to a shop are
 * destroyed (never restocked), so a shop can't strip the bound flag or
 * launder rolls.
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

  var MAX_SELL_MULT = 0.6;   // hard ceiling, enforced on load
  var MIN_BUY_MULT = 1.0;    // hard floor, enforced on load
  var MAX_QTY = 1000;

  var SHOPS = {
    general_store: {
      name: 'General Store', keeper: 'npc_shopkeep', buyMult: 1.0, sellMult: 0.4, restockMs: 60000, buys: 'all',
      stock: [
        { base: 'hearth_bread', qty: 20 }, { base: 'smithing_hammer', qty: 5 }, { base: 'fishing_rod', qty: 5 },
        { base: 'flint_striker', qty: 5 }, { base: 'rustbound_pickaxe', qty: 3 }, { base: 'rustbound_hatchet', qty: 3 },
      ],
    },
    smithy: {
      name: 'Ember & Anvil Smithy', keeper: 'npc_smith', buyMult: 1.15, sellMult: 0.55, restockMs: 120000,
      buys: ['gear', 'tool', 'bar', 'ore'],
      stock: [
        { base: 'rustbound_sword', qty: 3 }, { base: 'rustbound_shield', qty: 2 }, { base: 'rustbound_helm', qty: 2 },
        { base: 'cinderiron_sword', qty: 1 }, { base: 'cinderiron_pickaxe', qty: 2 }, { base: 'cinderiron_hatchet', qty: 2 },
        { base: 'rustbound_bar', qty: 10 }, { base: 'rustbound_ore', qty: 15 },
      ],
    },
    tackle: {
      name: 'Brineworks Tackle', keeper: 'npc_fisher', buyMult: 1.1, sellMult: 0.5, restockMs: 90000,
      buys: ['fish_raw', 'food'],
      stock: [
        { base: 'fishing_rod', qty: 5 }, { base: 'mudminnow', qty: 10 }, { base: 'brookfin', qty: 5 },
        { base: 'travellers_stew', qty: 4 },
      ],
    },
  };

  function checkShopDefs() {
    var errs = [];
    Object.keys(SHOPS).forEach(function (id) {
      var d = SHOPS[id];
      if (!(d.buyMult >= MIN_BUY_MULT)) errs.push(id + ': buyMult < 1');
      if (!(d.sellMult > 0 && d.sellMult <= MAX_SELL_MULT)) errs.push(id + ': sellMult > 0.6');
      d.stock.forEach(function (e) { if (!Db.hasBase(e.base)) errs.push(id + ': unknown ' + e.base); });
    });
    return errs;
  }

  function target(def, baseId) {
    for (var i = 0; i < def.stock.length; i++) if (def.stock[i].base === baseId) return def.stock[i].qty;
    return 0;
  }

  /** Unit buy price at a given stock level. Scarcer stock costs up to +30%. Always >= value. */
  function unitBuy(def, baseId, stock) {
    var v = Db.getBase(baseId).value;
    var t = target(def, baseId);
    var scarcity = t > 0 ? Math.max(0, Math.min(1, (t - stock) / t)) : 0;
    return Math.max(1, Math.ceil(v * def.buyMult * (1 + 0.3 * scarcity)));
  }
  /** Unit sell price for an instance at a given stock level. Glutted stock pays less. Always <= 0.6 * value. */
  function unitSell(def, inst, stock) {
    var v = Gen.value(inst);
    var t = target(def, inst.base);
    var glut = Math.max(0, Math.min(1, stock / (t + 10)));
    return Math.max(0, Math.floor(v * Math.min(def.sellMult, MAX_SELL_MULT) * (1 - 0.5 * glut)));
  }
  function buyTotal(def, baseId, stock, qty) {
    var sum = 0;
    for (var i = 0; i < qty; i++) sum += unitBuy(def, baseId, stock - i);
    return sum;
  }
  function sellTotal(def, inst, stock, qty) {
    var sum = 0;
    for (var i = 0; i < qty; i++) sum += unitSell(def, inst, stock + i);
    return sum;
  }

  /** Legendary or chase-flagged: no shop will ever take it. */
  function notSellable(inst, base) {
    return inst.rarity === 'legendary' || !!base.chase || !!base.legendary;
  }

  function shopBuys(def, base) {
    if (base.quest || !base.tradeable) return false;
    return def.buys === 'all' || def.buys.indexOf(base.cat) >= 0;
  }

  /** Lazily create + restock a shop state to time `at` (stock drifts 1 step per restockMs toward target). */
  function settle(s, shopId, at) {
    var def = SHOPS[shopId];
    if (!def) S.fail('unknown_shop');
    var st = s.shops[shopId];
    if (!st) {
      st = s.shops[shopId] = { t: at, stock: {} };
      def.stock.forEach(function (e) { st.stock[e.base] = e.qty; });
      return st;
    }
    var steps = Math.floor(Math.max(0, at - st.t) / def.restockMs);
    if (steps > 0) {
      Object.keys(st.stock).forEach(function (b) {
        var tq = target(def, b), q = st.stock[b];
        if (q < tq) q = Math.min(tq, q + steps); else if (q > tq) q = Math.max(tq, q - steps);
        if (q === 0 && tq === 0) delete st.stock[b]; else st.stock[b] = q;
      });
      def.stock.forEach(function (e) { if (st.stock[e.base] == null) st.stock[e.base] = Math.min(e.qty, steps); });
      st.t += steps * def.restockMs;
    }
    // A clock that goes backwards just yields 0 steps; t never rewinds, so no double restock.
    return st;
  }

  var reducers = {
    /** p: { shop, base, qty, at, seed } */
    'shop.buy': function (s, p, op, X) {
      var def = SHOPS[p.shop];
      if (!def) S.fail('unknown_shop');
      var qty = p.qty;
      if (!(Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY)) S.fail('bad_qty');
      var st = settle(s, p.shop, p.at);
      var have = st.stock[p.base] || 0;
      if (have < qty) S.fail('out_of_stock', { have: have });
      var base = Db.getBase(p.base);
      var cost = buyTotal(def, p.base, have, qty);
      S.debit(s, cost, 'shop_buy', p.shop, op);
      st.stock[p.base] = have - qty;
      var n = base.stackable ? 1 : qty;
      for (var i = 0; i < n; i++) {
        var inst = Gen.createInstance(p.base, { qty: base.stackable ? qty : 1, seed: Core.mixSeed(p.seed, i),
          origin: { src: 'shop_buy', ref: p.shop, at: p.at } });
        S.mint(s, inst, 'shop_buy');
        S.invPut(s, inst);   // inventory_full -> whole op rolls back (gold too)
      }
      X.emit('gold', { balance: s.gold, delta: -cost, src: 'shop_buy' });
      X.emit('inventory', { reason: 'buy' });
      X.emit('shop', { shopId: p.shop });
      return { cost: cost };
    },
    /** p: { shop, uid, qty, at } */
    'shop.sell': function (s, p, op, X) {
      var def = SHOPS[p.shop];
      if (!def) S.fail('unknown_shop');
      var i = S.invIndex(s, p.uid);
      if (i < 0) S.fail('no_item');
      var it = s.inv[i];
      var base = Db.getBase(it.base);
      if (notSellable(it, base)) S.fail('not_sellable');
      if (!shopBuys(def, base)) S.fail('shop_wont_buy');
      var st = settle(s, p.shop, p.at);
      var qty = p.qty == null ? it.qty : p.qty;
      var probe = Core.clone(it);
      var t = S.invTake(s, i, qty);
      var stock = st.stock[t.base] || 0;
      var pay = sellTotal(def, probe, stock, t.qty);
      S.burn(s, t.base, t.qty, 'shop_sell');
      var restock = (t.rarity === 'normal' || t.rarity === 'material') && !t.bound;
      if (restock) st.stock[t.base] = stock + t.qty;
      S.credit(s, pay, 'shop_sell', p.shop, op);
      X.emit('gold', { balance: s.gold, delta: pay, src: 'shop_sell' });
      X.emit('inventory', { reason: 'sell' });
      X.emit('shop', { shopId: p.shop });
      return { paid: pay, restocked: restock };
    },
  };

  RPG.Modules.shop = {
    name: 'Shop',
    reducers: reducers,
    api: function (w) {
      function stockView(shopId) {
        // Read-only restock preview on a copy (real restock happens inside ops).
        var s = Core.clone({ shops: w.state().shops });
        var st = settle(s, shopId, w.now());
        var def = SHOPS[shopId];
        return Object.keys(st.stock).map(function (b) {
          var q = st.stock[b];
          return { base: b, name: Db.getBase(b).name, qty: q, buy: q > 0 ? unitBuy(def, b, q) : null,
            color: Db.colorFor(Db.defaultRarity(Db.getBase(b))) };
        });
      }
      var api = {
        SHOPS: SHOPS,
        /** Emits 'shop:open' with { shopId, name, items:[{base,name,qty,buy}] }. */
        open: function (shopId) {
          if (!SHOPS[shopId]) return null;
          var v = { shopId: shopId, name: SHOPS[shopId].name, items: stockView(shopId), gold: w.state().gold };
          w.emit('shop:open', v);
          return v;
        },
        close: function (shopId) { w.emit('shop:close', { shopId: shopId }); },
        buy: function (shopId, baseId, qty) {
          var s = w.state();
          return w.commit('shop.buy', { shop: shopId, base: baseId, qty: qty == null ? 1 : qty, at: w.now(),
            seed: Core.mixSeed(s.lootSeed, 'buy', s.seq + 1) });
        },
        sell: function (shopId, uidOrSlot, qty) {
          var uid = typeof uidOrSlot === 'number' ? (w.state().inv[uidOrSlot] || {}).uid : uidOrSlot;
          return w.commit('shop.sell', { shop: shopId, uid: uid, qty: qty, at: w.now() });
        },
        /** Quote for the tooltip: what this shop pays for qty of the item (null = won't buy). */
        /** True if no shop will buy it (Legendary / chase). UI hides "Sell" for these. */
        isSellable: function (uid) {
          var f = S.findItem(w.state(), uid);
          return !!f && !notSellable(f.item, Db.getBase(f.item.base)) && !Db.getBase(f.item.base).quest && Db.getBase(f.item.base).tradeable;
        },
        sellQuote: function (shopId, uid, qty) {
          var f = S.findItem(w.state(), uid), def = SHOPS[shopId];
          if (!f || !def || notSellable(f.item, Db.getBase(f.item.base)) || !shopBuys(def, Db.getBase(f.item.base))) return null;
          var s = Core.clone({ shops: w.state().shops });
          var st = settle(s, shopId, w.now());
          return sellTotal(def, f.item, st.stock[f.item.base] || 0, qty == null ? f.item.qty : qty);
        },
        buyQuote: function (shopId, baseId, qty) {
          var def = SHOPS[shopId];
          if (!def) return null;
          var s = Core.clone({ shops: w.state().shops });
          var st = settle(s, shopId, w.now());
          var have = st.stock[baseId] || 0;
          qty = qty == null ? 1 : qty;
          return have >= qty ? buyTotal(def, baseId, have, qty) : null;
        },
      };
      return api;
    },
    SHOPS: SHOPS, unitBuy: unitBuy, unitSell: unitSell, checkShopDefs: checkShopDefs, shopBuys: shopBuys, notSellable: notSellable,
    MAX_SELL_MULT: MAX_SELL_MULT, MIN_BUY_MULT: MIN_BUY_MULT,
  };
});
