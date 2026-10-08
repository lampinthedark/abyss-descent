/**
 * Abyss Descent RPG core: the window.RPG namespace and the Store.
 * Loaded first of the core files, so every other file (core or owner) can
 * use RPG.bus, RPG.registerSystem, RPG.registerTappable and RPG.rng at load.
 * Contract: docs/rpg-core-hooks.md.
 *
 * Store.dispatch({ type: '<slice>/<verb>', ... }) is the ONLY way saved
 * ("core") state changes. Modules register reducers per slice with
 * Store.register(slice, reducer, initial). Render and FX only read. Every
 * dispatch is appended to a replay log, so Store.replay(log) rebuilds state.
 *
 * Log-only actions: any type starting with 'items/' (e.g. 'items/op') is
 * appended to the log and nothing else: no reducer runs and no core save is
 * scheduled. Items apply and save their own ops; core only mirrors them so
 * one log can be replayed / shipped later (no double apply).
 *
 * Ids.mint(kind) mints NON-ITEM core ids only (quest instances, world events):
 * <kind>_<clientId>_<counter>, counter saved by save.js. Item ids belong to
 * the items module (ItemIds.next()); Ids.mint refuses 'item'.
 */
(function (root) {
  'use strict';

  // ---- RPG namespace ------------------------------------------------------
  const RPG = (root.RPG = root.RPG || {});

  /** RPG.bus.on(evt, fn) -> off(); RPG.bus.emit(evt, data). Listener errors are caught. */
  const handlers = Object.create(null);
  RPG.bus = {
    on(evt, fn) {
      if (typeof fn !== 'function') return function () {};
      (handlers[evt] = handlers[evt] || []).push(fn);
      return function () { RPG.bus.off(evt, fn); };
    },
    off(evt, fn) {
      const l = handlers[evt];
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    emit(evt, data) {
      const l = handlers[evt];
      if (!l || !l.length) return;
      const copy = l.slice();
      for (let i = 0; i < copy.length; i++) {
        try { copy[i](data); } catch (e) { if (root.console) console.error('[RPG.bus ' + evt + ']', e); }
      }
    },
  };

  /**
   * RPG.registerSystem({ id, update(dt), draw(ctx, cam, layer) }).
   * Layers: 'ground', 'under', 'sorted' (use cam.push(footY, fn) to join the
   * y-sort), 'fx', 'ui'. Re-registering an id replaces it.
   */
  const systems = [];
  RPG.systems = systems;
  RPG.registerSystem = function (sys) {
    if (!sys || !sys.id) throw new Error('registerSystem needs an id');
    const i = systems.findIndex(function (s) { return s.id === sys.id; });
    if (i >= 0) systems[i] = sys;
    else systems.push(sys);
    return sys;
  };
  RPG.unregisterSystem = function (id) {
    const i = systems.findIndex(function (s) { return s.id === id; });
    if (i >= 0) systems.splice(i, 1);
  };
  RPG.hasSystem = function (id) {
    return systems.some(function (s) { return s.id === id; });
  };

  /**
   * RPG.registerTappable({ id, hit(tx, ty) -> entity|null, range, onArrive(entity) }).
   * tx, ty are the tap point in float tiles. Input walks the hero into
   * `range` tiles, then calls onArrive. Priority by entity kind:
   * npc > mob > node/station > drop > tile. At equal priority the most
   * recently registered tappable wins (owners override core defaults).
   */
  const tappables = [];
  RPG.tappables = tappables;
  RPG.registerTappable = function (t) {
    if (!t || !t.id || typeof t.hit !== 'function') throw new Error('registerTappable needs id and hit');
    const i = tappables.findIndex(function (x) { return x.id === t.id; });
    if (i >= 0) tappables.splice(i, 1);
    tappables.push(t);
    return t;
  };

  /**
   * RPG.rng(stream) -> () => [0, 1). Seeded streams ('loot', 'ai', 'skill', ...)
   * derived from one base seed (?seed=N or random per session, logged as
   * 'rng/seed'). Never use Math.random in game logic, so seeds replay.
   */
  const streams = Object.create(null);
  let baseSeed = 0;
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    let st = a >>> 0;
    const fn = function () {
      st = (st + 0x6d2b79f5) >>> 0;
      let t = st;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    fn.state = function () { return st; };
    return fn;
  }
  RPG.rng = function (stream) {
    const name = String(stream || 'misc');
    if (!streams[name]) streams[name] = mulberry32((baseSeed ^ hashStr(name)) >>> 0);
    return streams[name];
  };
  RPG.rng.seed = function (n) {
    baseSeed = (Number(n) >>> 0) || 1;
    Object.keys(streams).forEach(function (k) { delete streams[k]; });
    return baseSeed;
  };
  RPG.rng.getSeed = function () { return baseSeed; };
  (function initSeed() {
    let s = NaN;
    try { s = Number(new URLSearchParams(root.location.search).get('seed')); } catch (e) {}
    if (!(s > 0)) s = (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
    RPG.rng.seed(s);
  })();

  // ---- Store ------------------------------------------------------------------
  const LOG_CAP = 5000;
  const reducers = new Map(); // slice -> { reducer, initial }
  let core = {};
  let seq = 0;
  const log = [];
  const listeners = [];
  let onDurable = null; // set by save.js

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  function isLogOnly(type) {
    return type.indexOf('items/') === 0;
  }
  function initialSlice(slice) {
    const r = reducers.get(slice);
    return r ? clone(r.initial) : undefined;
  }

  const Store = {
    /** reducer(sliceState, action) -> next slice state (same object if unchanged). Pure. */
    register(slice, reducer, initial) {
      if (typeof slice !== 'string' || !slice) throw new Error('Store.register: slice name');
      if (typeof reducer !== 'function') throw new Error('Store.register: reducer');
      reducers.set(slice, { reducer: reducer, initial: clone(initial) });
      if (!(slice in core)) core[slice] = clone(initial);
    },

    /** The only way saved state changes. action.durable === false skips the save timer. */
    dispatch(action) {
      if (!action || typeof action.type !== 'string' || !action.type) {
        throw new Error('Store.dispatch: action needs a type');
      }
      const entry = { seq: ++seq, t: Date.now(), action: clone(action) };
      log.push(entry);
      if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
      if (isLogOnly(action.type)) return core;
      let changed = false;
      const next = {};
      Object.keys(core).forEach(function (k) { next[k] = core[k]; });
      reducers.forEach(function (r, slice) {
        const prev = core[slice];
        const out = r.reducer(prev, entry.action);
        if (out !== undefined && out !== prev) {
          next[slice] = out;
          changed = true;
        }
      });
      if (changed) core = next;
      if (action.durable !== false && onDurable) onDurable(entry.action);
      for (let i = 0; i < listeners.length; i++) {
        try { listeners[i](entry.action, core); } catch (e) {}
      }
      return core;
    },

    /** Live core state (the current object; replaced on every change and on a save restore). */
    getState() {
      return core;
    },

    /** Live state of one slice (undefined if unknown). */
    get(slice) {
      return core[slice];
    },

    /** Mirror a log-only action ('items/*'), e.g. Items.on('op', op => Store.log({ type: 'items/op', op })). */
    log(action) {
      if (!action || typeof action.type !== 'string' || !isLogOnly(action.type)) {
        throw new Error("Store.log: only 'items/*' log-only actions");
      }
      return Store.dispatch(action);
    },

    isLogOnly: isLogOnly,

    /** Copy of the replay log ({ seq, t, action }). */
    getLog() {
      return log.slice();
    },

    /** Rebuild core state from fresh slices by replaying a log (pure). */
    replay(entries) {
      const state = {};
      reducers.forEach(function (_r, slice) { state[slice] = initialSlice(slice); });
      (entries || []).forEach(function (e) {
        const action = e && e.action ? e.action : e;
        if (!action || typeof action.type !== 'string' || isLogOnly(action.type)) return;
        reducers.forEach(function (r, slice) {
          const out = r.reducer(state[slice], action);
          if (out !== undefined) state[slice] = out;
        });
      });
      return state;
    },

    subscribe(fn) {
      if (typeof fn === 'function') listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    // ---- used by save.js only ----
    _hydrate(loaded) {
      core = {};
      reducers.forEach(function (_r, slice) {
        core[slice] = loaded && slice in loaded ? loaded[slice] : initialSlice(slice);
      });
      // Keep slices of modules that are not loaded in this build.
      Object.keys(loaded || {}).forEach(function (k) { if (!(k in core)) core[k] = loaded[k]; });
    },
    _onDurable(fn) {
      onDurable = fn;
    },
  };

  // ---- Ids (non-item core ids) ---------------------------------------------
  let clientId = '';
  let idCounter = 0;
  let onMint = null;
  const Ids = {
    /** <kind>_<clientId>_<counter>; kind lowercased [a-z0-9]. Never for items (ItemIds.next()). */
    mint(kind) {
      const k = String(kind || 'id').toLowerCase().replace(/[^a-z0-9]/g, '') || 'id';
      if (k === 'item' || k === 'items') throw new Error('Ids.mint: item ids belong to ItemIds.next()');
      if (!clientId && Store.boot) Store.boot();
      idCounter += 1;
      if (onMint) onMint();
      return k + '_' + clientId + '_' + idCounter;
    },
    clientId() {
      return clientId;
    },
    _set(id, counter) {
      clientId = id;
      idCounter = counter | 0;
    },
    _counter() {
      return idCounter;
    },
    _onMint(fn) {
      onMint = fn;
    },
  };

  root.Store = Store;
  root.Ids = Ids;
})(typeof window !== 'undefined' ? window : globalThis);
