/**
 * Core save (position, XP, quests; items save their own part).
 * Key 'abyss-rpg-save' = { v, clientId, idCounter, core }.
 * Written within 1 s of a durable Store.dispatch or an Ids.mint, and at once
 * on visibilitychange (hidden), pagehide and Capacitor app pause. Every one
 * of those triggers also calls ItemSave.flush() through a guard.
 * Load checks the version: older saves go through migrate(), newer ones are
 * kept aside under '<key>-future' and never overwritten silently.
 */
(function (root) {
  'use strict';

  const Store = root.Store;
  const Ids = root.Ids;
  const KEY = 'abyss-rpg-save';
  const VERSION = 1;
  const DELAY_MS = 400; // well inside the 1 s promise

  let timer = 0;
  let dirty = false;
  let lastSaveAt = 0;
  let saveCount = 0;
  let storageOk = true;
  let booted = false;

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function flushItems() {
    try {
      // eslint-disable-next-line no-undef
      const box = typeof ItemSave !== 'undefined' ? ItemSave : root.ItemSave;
      if (box && typeof box.flush === 'function') box.flush();
    } catch (e) {}
  }

  /** Upgrade an older save to VERSION. Stub: v1 is the first shape. */
  function migrate(data) {
    if (!data || typeof data !== 'object') return null;
    const out = data;
    // if (out.v === 1) { out.v = 2; ... }
    return out.v === VERSION ? out : null;
  }

  function read() {
    const ls = storage();
    if (!ls) return null;
    let raw = null;
    try { raw = ls.getItem(KEY); } catch (e) { return null; }
    if (!raw) return null;
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { return null; }
    if (!data || typeof data !== 'object' || typeof data.v !== 'number') return null;
    if (data.v > VERSION) {
      try { ls.setItem(KEY + '-future', raw); } catch (e) {}
      return null;
    }
    if (data.v < VERSION) data = migrate(data);
    if (!data || typeof data.clientId !== 'string' || !data.clientId) return null;
    if (!Number.isFinite(data.idCounter) || data.idCounter < 0) data.idCounter = 0;
    if (!data.core || typeof data.core !== 'object') data.core = {};
    return data;
  }

  function newClientId() {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    const c = root.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const buf = new Uint8Array(8);
      c.getRandomValues(buf);
      for (let i = 0; i < buf.length; i++) s += abc[buf[i] % abc.length];
    } else {
      for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
    }
    return s;
  }

  function write() {
    flushItems();
    if (timer) { clearTimeout(timer); timer = 0; }
    const clientId = Ids.clientId();
    if (!clientId) return false;
    const ls = storage();
    if (!ls) return false;
    const data = { v: VERSION, clientId: clientId, idCounter: Ids._counter(), core: Store.getState() };
    try {
      ls.setItem(KEY, JSON.stringify(data));
      storageOk = true;
      dirty = false;
      lastSaveAt = Date.now();
      saveCount += 1;
      return true;
    } catch (e) {
      storageOk = false;
      return false;
    }
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(write, DELAY_MS);
  }

  function boot() {
    if (booted) return info();
    booted = true;
    const data = read();
    if (data) {
      Ids._set(data.clientId, Math.floor(data.idCounter));
      Store._hydrate(data.core);
    } else {
      Ids._set(newClientId(), 0);
      Store._hydrate({});
      write();
    }
    return info();
  }

  function info() {
    return {
      clientId: Ids.clientId(),
      idCounter: Ids._counter(),
      logLength: Store.getLog().length,
      dirty: dirty,
      lastSaveAt: lastSaveAt,
      saveCount: saveCount,
      storageOk: storageOk,
    };
  }

  /** Lifecycle flush: core's last state (e.g. the hero's live tile), then write. */
  function flushNow() {
    try { if (typeof Save.onBeforeFlush === 'function') Save.onBeforeFlush(); } catch (e) {}
    write();
  }

  const Save = {
    KEY: KEY,
    VERSION: VERSION,
    boot: boot,
    read: read,
    write: write,
    schedule: schedule,
    migrate: migrate,
    info: info,
    flushNow: flushNow,
    /** Write now if anything changed since the last write. */
    flush() {
      if (dirty || timer) return write();
      flushItems();
      return false;
    },
    onBeforeFlush: null,
  };

  Store._onDurable(schedule);
  Ids._onMint(schedule);
  // Convenience aliases on Store (boot / flush / info / save key).
  Store.boot = boot;
  Store.flush = Save.flush;
  Store.flushNow = flushNow;
  Store.info = info;
  Store.SAVE_KEY = KEY;
  Store.SAVE_VERSION = VERSION;
  Store._migrate = migrate;

  if (root.document && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('visibilitychange', function () {
      if (root.document.visibilityState === 'hidden') flushNow();
    });
    root.document.addEventListener('pause', flushNow, false); // Cordova-style pause
  }
  if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', flushNow);
  try {
    const cap = root.Capacitor;
    const app = cap && cap.Plugins && cap.Plugins.App;
    if (app && typeof app.addListener === 'function') {
      app.addListener('pause', flushNow);
      app.addListener('appStateChange', function (s) { if (s && s.isActive === false) flushNow(); });
    }
  } catch (e) {}

  root.Save = Save;
})(typeof window !== 'undefined' ? window : globalThis);
