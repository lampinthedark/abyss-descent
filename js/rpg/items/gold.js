/**
 * RPG items: gold balance + ledger (read API).
 *
 * Gold is an integer balance on the world, NOT an item stack. It changes
 * only inside op reducers through State.credit/debit with a source tag:
 *   credit: drop | quest | shop_sell | migration
 *   debit:  shop_buy
 * There is deliberately no "purchase"/IAP source: real money never mints gold.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./state.js') : root.RPGItems;
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var S = RPG.State;

  RPG.Modules.gold = {
    name: 'Gold',
    reducers: {},
    api: function (w) {
      return {
        balance: function () { return w.state().gold; },
        canAfford: function (n) { return w.state().gold >= n; },
        /** Most recent ledger entries (newest last): { op, at, delta, src, ref, bal }. */
        ledger: function (n) { var l = w.state().ledger; return RPG.Core.clone(n ? l.slice(-n) : l); },
        /** Lifetime totals by source: { in: {drop: 120, ...}, out: {shop_buy: 40} }. */
        totals: function () { var s = w.state(); return { in: RPG.Core.clone(s.goldIn), out: RPG.Core.clone(s.goldOut) }; },
        SOURCES: { credit: S.GOLD_CREDIT.slice(), debit: S.GOLD_DEBIT.slice() },
      };
    },
  };
});
