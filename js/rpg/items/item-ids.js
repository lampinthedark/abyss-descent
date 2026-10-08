/**
 * RPG items: THE item-id function.
 *
 *   ItemIds.next()  ->  "item_<clientId>_<counter>"
 *
 * Items own item ids. Core must not mint item ids itself (GD's Ids.mint is
 * for core's own records). Ids from here are PROVISIONAL: the instance
 * carries untrusted:true and sid:null until the server confirms it and
 * ItemIds.adopt(uid, sid) records the server id. The counter is saved with
 * the items and never goes backwards, so a provisional id is never reused
 * on this device. The format matches core's `<kind>_<clientId>_<counter>`.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./core.js') : root.RPGItems;
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var RE = /^([a-z]+)_([A-Za-z0-9]+)_(\d+)$/;

  /** Low-level: advance the saved counter on a (draft) state. Only reducers call this. */
  function next(state, kind) {
    state.idCounter += 1;
    return (kind || 'item') + '_' + state.deviceId + '_' + state.idCounter;
  }
  function parse(id) {
    var m = RE.exec(String(id));
    return m ? { kind: m[1], clientId: m[2], n: Number(m[3]) } : null;
  }
  RPG.ItemIds = {
    next: next,
    parse: parse,
    isProvisional: function (inst) { return !!inst && inst.untrusted !== false && !inst.sid; },
  };
});
