/**
 * RPG items: persistence (items part of the save only; core saves its own part).
 *
 * - Keys: `abyss-rpg-items:a`, `:b` (two slots) + `abyss-rpg-items:ptr`.
 *   Atomic write: write the INACTIVE slot, read it back, verify, then flip
 *   the pointer. A crash mid-write leaves the previous slot intact. Load
 *   falls back to the other slot if the pointed one is missing/corrupt.
 * - Payload: { schema, savedAt, rev, sum, state, outbox }. `sum` is FNV-1a
 *   over the JSON so torn/edited writes are detected.
 * - Schema version + forward migrations (MIGRATIONS[n] upgrades n -> n+1).
 *   A save from a NEWER build is never overwritten (saving is blocked).
 * - Op log / outbox: every committed op ({ key: "<deviceId>:<seq>", type, p,
 *   at, rev }) is kept until ack()'d by the server, in the same atomic write.
 * - Triggers (match core): debounced save within 1 s of any change, and an
 *   immediate flush() on visibilitychange→hidden, pagehide, beforeunload and
 *   Capacitor app pause / appStateChange(isActive:false). Core may also call
 *   ItemSave.flush() itself.
 * - Does NOT read the old game's `abyss-descent-save-v1` (new RPG, new key).
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./state.js') : root.RPGItems;
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var Core = RPG.Core, S = RPG.State;

  var CURRENT_SCHEMA = 1;
  var PREFIX = 'abyss-rpg-items';
  var DEBOUNCE_MS = 750;      // < 1 s, and never pushed back by later changes
  var OUTBOX_KEEP = 2000;
  var MIGRATIONS = {};        // e.g. MIGRATIONS[1] = function (payload) { ...; payload.schema = 2; return payload; }

  function memoryStorage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      _dump: function () { return m; },
    };
  }
  function defaultStorage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var t = '__rpg_items_probe__';
        localStorage.setItem(t, '1'); localStorage.removeItem(t);
        return localStorage;
      }
    } catch (e) { /* private mode etc. */ }
    return memoryStorage();
  }

  function checksum(state, outbox) { return Core.hash32(JSON.stringify(state) + '|' + JSON.stringify(outbox)); }

  function parseSlot(raw) {
    if (!raw) return { ok: false, reason: 'missing' };
    var p;
    try { p = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'corrupt_json' }; }
    if (!p || typeof p !== 'object' || !p.state || typeof p.schema !== 'number') return { ok: false, reason: 'bad_shape' };
    if (p.sum !== checksum(p.state, p.outbox || [])) return { ok: false, reason: 'bad_checksum' };
    return { ok: true, payload: p };
  }

  function migrate(payload) {
    var p = payload;
    if (p.schema > CURRENT_SCHEMA) return { ok: false, reason: 'future_schema', schema: p.schema };
    var steps = [];
    while (p.schema < CURRENT_SCHEMA) {
      var fn = MIGRATIONS[p.schema];
      if (!fn) return { ok: false, reason: 'no_migration_from_' + p.schema };
      var from = p.schema;
      p = fn(Core.clone(p));
      if (!p || p.schema !== from + 1) return { ok: false, reason: 'migration_failed_' + from };
      steps.push(from + '->' + p.schema);
    }
    return { ok: true, payload: p, steps: steps };
  }

  RPG.Modules.itemSave = {
    name: 'ItemSave',
    reducers: {},
    CURRENT_SCHEMA: CURRENT_SCHEMA, MIGRATIONS: MIGRATIONS, PREFIX: PREFIX, memoryStorage: memoryStorage,
    api: function (w) {
      var store = w.opts.storage || defaultStorage();
      var prefix = w.opts.saveKey || PREFIX;
      var K = { a: prefix + ':a', b: prefix + ':b', ptr: prefix + ':ptr' };
      var timer = null, dirty = false, blocked = null, saves = 0, lastError = null;
      var setT = w.opts.setTimeout || (typeof setTimeout !== 'undefined' ? setTimeout : null);
      var clearT = w.opts.clearTimeout || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
      var delay = w.opts.saveDelayMs != null ? w.opts.saveDelayMs : DEBOUNCE_MS;

      function readPtr() {
        try { var p = JSON.parse(store.getItem(K.ptr) || 'null'); return p && (p.slot === 'a' || p.slot === 'b') ? p : null; }
        catch (e) { return null; }
      }

      var api = {
        CURRENT_SCHEMA: CURRENT_SCHEMA,
        keys: K,
        /** Write now (atomic two-slot swap). Returns { ok, slot, rev } or { ok:false, reason }. */
        save: function () {
          if (blocked) return { ok: false, reason: blocked };
          var st = w.state(), outbox = w.outbox();
          if (outbox.length > OUTBOX_KEEP) { w._trimOutbox(OUTBOX_KEEP); outbox = w.outbox(); }
          var payload = { schema: CURRENT_SCHEMA, savedAt: w.now(), rev: st.rev, sum: checksum(st, outbox), state: st, outbox: outbox,
            outboxOverflow: !!w._outboxOverflow() };
          var raw = JSON.stringify(payload);
          var ptr = readPtr();
          var slot = ptr && ptr.slot === 'a' ? 'b' : 'a';
          try {
            store.setItem(K[slot], raw);
            if (store.getItem(K[slot]) !== raw) throw new Error('readback mismatch');
            store.setItem(K.ptr, JSON.stringify({ slot: slot, rev: st.rev, at: payload.savedAt }));
          } catch (e) {
            lastError = String(e && e.message || e);
            w.emit('save_error', { reason: lastError });
            return { ok: false, reason: 'write_failed', error: lastError };
          }
          dirty = false; saves++;
          w.emit('saved', { slot: slot, rev: st.rev });
          return { ok: true, slot: slot, rev: st.rev };
        },
        /** Load the newest valid slot into the world. Returns { ok, from, steps } or { ok:false, reason }. */
        load: function () {
          var ptr = readPtr();
          var order = ptr ? [ptr.slot, ptr.slot === 'a' ? 'b' : 'a'] : ['a', 'b'];
          var cands = [];
          order.forEach(function (sl) { var r = parseSlot(store.getItem(K[sl])); if (r.ok) cands.push({ slot: sl, p: r.payload }); });
          if (!cands.length) {
            var anyRaw = store.getItem(K.a) || store.getItem(K.b);
            return { ok: false, reason: anyRaw ? 'corrupt' : 'no_save' };
          }
          // Prefer the pointer's slot; if it's bad, the other valid one.
          var pick = cands[0];
          var m = migrate(pick.p);
          if (!m.ok) {
            if (m.reason === 'future_schema') blocked = 'future_schema';
            w.emit('save_error', { reason: m.reason });
            return { ok: false, reason: m.reason };
          }
          var st = m.payload.state;
          if (st.deviceId !== w.state().deviceId && w.opts.deviceId) st.deviceId = w.opts.deviceId;
          w._replaceState(st, m.payload.outbox || [], !!m.payload.outboxOverflow);
          var problems = S.checkInvariants(w.state());
          if (problems.length) w.emit('save_warning', { problems: problems });
          w.emit('loaded', { slot: pick.slot, rev: st.rev, steps: m.steps });
          return { ok: true, from: pick.slot, fallback: !!ptr && pick.slot !== ptr.slot, steps: m.steps, warnings: problems };
        },
        clear: function () { [K.a, K.b, K.ptr].forEach(function (k) { try { store.removeItem(k); } catch (e) {} }); },
        has: function () { return !!(store.getItem(K.a) || store.getItem(K.b)); },
        /** Mark dirty and schedule a save within DEBOUNCE_MS (not pushed back by later changes). */
        schedule: function () {
          dirty = true;
          if (timer || !setT || w.opts.autosave === false) return;
          timer = setT(function () { timer = null; if (dirty) api.save(); }, delay);
        },
        /** Save immediately if anything changed (or force). Safe to call any time. */
        flush: function (force) {
          if (timer && clearT) { clearT(timer); timer = null; }
          if (dirty || force) return api.save();
          return { ok: true, skipped: true };
        },
        isDirty: function () { return dirty; },
        stats: function () { return { saves: saves, dirty: dirty, blocked: blocked, lastError: lastError }; },
        /** Ops not yet acknowledged by the server (oldest first). */
        pendingOps: function () { return w.outbox(); },
        /** Server ack: drop ops with seq <= uptoSeq for this device. */
        ack: function (uptoSeq) { w._ack(uptoSeq); api.schedule(); },
        registerMigration: function (fromSchema, fn) { MIGRATIONS[fromSchema] = fn; },
        /**
         * Hook the save triggers core uses. env defaults to the browser globals.
         * Returns an uninstall function.
         */
        installLifecycle: function (env) {
          env = env || {};
          var win = env.window || (typeof window !== 'undefined' ? window : null);
          var doc = env.document || (typeof document !== 'undefined' ? document : null);
          var offs = [];
          function on(t, ev, fn) { if (t && t.addEventListener) { t.addEventListener(ev, fn); offs.push(function () { t.removeEventListener(ev, fn); }); } }
          var flushNow = function () { try { api.flush(); } catch (e) {} };
          on(doc, 'visibilitychange', function () { if (doc.visibilityState === 'hidden') flushNow(); });
          on(win, 'pagehide', flushNow);
          on(win, 'beforeunload', flushNow);
          on(doc, 'pause', flushNow);   // Cordova-style pause event some WebViews fire
          var app = env.capacitorApp || capacitorApp(win);
          if (app && typeof app.addListener === 'function') {
            [['pause', flushNow], ['appStateChange', function (ev) { if (ev && ev.isActive === false) flushNow(); }]].forEach(function (pair) {
              try {
                var h = app.addListener(pair[0], pair[1]);
                if (h && typeof h.catch === 'function') h.catch(function () {});
                offs.push(function () { Promise.resolve(h).then(function (x) { if (x && x.remove) x.remove(); }).catch(function () {}); });
              } catch (e) {}
            });
          }
          return function () { offs.forEach(function (f) { f(); }); offs = []; };
        },
      };
      return api;
    },
  };

  function capacitorApp(win) {
    try {
      var cap = win && win.Capacitor;
      if (!cap) return null;
      if (cap.Plugins && cap.Plugins.App) return cap.Plugins.App;
      if (typeof cap.registerPlugin === 'function') return cap.registerPlugin('App');
    } catch (e) {}
    return null;
  }
});
