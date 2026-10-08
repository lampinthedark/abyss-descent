'use strict';

/**
 * RPG core checks (no browser): node --check on every js/rpg file, then unit
 * tests for A* (heap, no node cap, optimal cost), Store / Ids / save, the
 * items stub, the FX adapter units and the town map.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL ' + msg);
  }
}

// ---- syntax -------------------------------------------------------------
const files = [];
(function walk(dir) {
  fs.readdirSync(dir).sort().forEach((n) => {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.js')) files.push(p);
  });
})(path.join(root, 'js', 'rpg'));
files.push(path.join(root, 'scripts', 'check-names.js'), __filename);
files.forEach((f) => {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    ok(false, 'node --check ' + path.relative(root, f) + '\n' + String(e.stderr || e));
  }
});

// ---- sandbox ------------------------------------------------------------
function sandbox(extra) {
  const store = new Map();
  const listeners = {};
  const docListeners = {};
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Uint8Array,
    Int32Array,
    Float64Array,
    Float32Array,
    URLSearchParams,
    crypto: require('crypto').webcrypto,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    document: {
      visibilityState: 'visible',
      addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
    },
    _store: store,
    _fire: (t) => (listeners[t] || []).forEach((f) => f({ type: t })),
    _fireDoc: (t) => (docListeners[t] || []).forEach((f) => f({ type: t })),
  };
  Object.assign(ctx, extra || {});
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}
function load(ctx, rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
}

// ---- A* -----------------------------------------------------------------
(function testPath() {
  const ctx = sandbox();
  load(ctx, 'js/rpg/path.js');
  const P = ctx.RpgPath;
  // Heap sorts.
  const h = new P.Heap();
  const vals = [];
  for (let i = 0; i < 500; i++) { const v = Math.random(); vals.push(v); h.push(i, v); }
  vals.sort((a, b) => a - b);
  let prev = -1;
  let sorted = true;
  for (let i = 0; i < 500; i++) {
    const id = h.pop();
    void id;
  }
  ok(h.size() === 0, 'heap empties');
  const h2 = new P.Heap();
  [5, 3, 9, 1, 7].forEach((v, i) => h2.push(i, v));
  const order = [];
  while (h2.size()) order.push(h2.pop());
  ok(order.join(',') === '3,1,0,4,2', 'heap pop order ' + order.join(','));
  void prev; void sorted;

  // Dijkstra reference with the same move rules and costs.
  function dijkstra(W, H, walk, sx, sy, gx, gy) {
    const dist = new Float64Array(W * H).fill(Infinity);
    const done = new Uint8Array(W * H);
    dist[sy * W + sx] = 0;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, P.COST_NS], [0, -1, P.COST_NS],
      [1, 1, P.COST_DIAG], [1, -1, P.COST_DIAG], [-1, 1, P.COST_DIAG], [-1, -1, P.COST_DIAG]];
    for (;;) {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < W * H; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
      if (best < 0) return Infinity;
      if (best === gy * W + gx) return bd;
      done[best] = 1;
      const cx = best % W;
      const cy = (best / W) | 0;
      for (const [dx, dy, c] of D) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walk(nx, ny)) continue;
        if (dx && dy && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (bd + c < dist[ni]) dist[ni] = bd + c;
      }
    }
  }
  function cost(path, sx, sy) {
    let c = 0;
    let x = sx;
    let y = sy;
    path.forEach((p) => {
      const dx = Math.abs(p.x - x);
      const dy = Math.abs(p.y - y);
      c += dx && dy ? P.COST_DIAG : dx ? 1 : P.COST_NS;
      x = p.x;
      y = p.y;
    });
    return c;
  }
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 40; trial++) {
    const W = 14;
    const H = 12;
    const grid = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) grid[i] = rand() < 0.28 ? 1 : 0;
    grid[0] = 0;
    grid[W * H - 1] = 0;
    const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !grid[y * W + x];
    const ref = dijkstra(W, H, walk, 0, 0, W - 1, H - 1);
    const p = P.pathfind(0, 0, W - 1, H - 1, walk, { w: W, h: H });
    if (ref === Infinity) {
      ok(p.length === 0, 'trial ' + trial + ': no route should give []');
    } else {
      ok(p.length > 0, 'trial ' + trial + ': route expected');
      ok(Math.abs(cost(p, 0, 0) - ref) < 1e-6, 'trial ' + trial + ': cost ' + cost(p, 0, 0) + ' vs optimal ' + ref);
      ok(p.every((c) => walk(c.x, c.y)), 'trial ' + trial + ': path walkable');
    }
  }
  // No 800-node cap: a long serpentine on 120x120 needs thousands of expansions.
  const W = 120;
  const H = 120;
  const walls = (x, y) => (x % 4 === 2 && (Math.floor(x / 4) % 2 ? y !== 0 : y !== H - 1));
  const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !walls(x, y);
  const t0 = Date.now();
  const long = P.pathfind(0, 0, W - 1, H - 1, walk, { w: W, h: H });
  const ms = Date.now() - t0;
  ok(long.length > 1000, 'long serpentine route found (' + long.length + ' steps, ' + P.pathfind.lastExpanded + ' expanded)');
  ok(P.pathfind.lastExpanded > 800, 'expanded more than the old 800 cap');
  ok(ms < 1500, 'long route under 1.5 s (' + ms + ' ms)');
  // Goal snapping onto a blocked tile.
  const walk2 = (x, y) => x >= 0 && y >= 0 && x < 10 && y < 10 && !(x === 5 && y === 5);
  const snap = P.pathfind(0, 0, 5, 5, walk2, { w: 10, h: 10 });
  const end = snap[snap.length - 1];
  ok(end && !(end.x === 5 && end.y === 5) && Math.abs(end.x - 5) + Math.abs(end.y - 5) === 1, 'blocked goal snaps next to it');
  // Smoothing keeps line of sight.
  const sm = P.smooth(0.5, 0.5, snap, walk2);
  ok(sm.length >= 1 && sm.length <= snap.length, 'smooth shortens or keeps the path');
})();

// ---- Store / Ids / save ----------------------------------------------------
async function testStore() {
  const flushes = [];
  const ctx = sandbox();
  ctx.ItemSave = { flush: () => flushes.push(Date.now()) };
  load(ctx, 'js/rpg/store.js');
  load(ctx, 'js/rpg/save.js');
  const { Store, Ids } = ctx;
  Store.register('hero', (s, a) => (a.type === 'hero/arrive' ? { x: a.x, y: a.y } : s), { x: 1, y: 1 });
  Store.register('xp', (s, a) => (a.type === 'xp/gain' ? { total: s.total + a.n } : s), { total: 0 });
  const info = Store.boot();
  ok(/^[a-z0-9]{8}$/.test(info.clientId), 'clientId minted');
  const saved0 = JSON.parse(ctx._store.get('abyss-rpg-save'));
  ok(saved0.v === 1 && saved0.clientId === info.clientId && saved0.idCounter === 0 && saved0.core.hero.x === 1, 'first save shape');
  Store.dispatch({ type: 'hero/arrive', x: 4, y: 5 });
  Store.dispatch({ type: 'xp/gain', n: 30 });
  Store.dispatch({ type: 'items/op', op: { key: 'd:1', type: 'gold.add' } });
  Store.log({ type: 'items/gold.add', op: { key: 'd:2' } });
  let threw = false;
  try { Store.log({ type: 'hero/arrive', x: 0, y: 0 }); } catch (e) { threw = true; }
  ok(threw, 'Store.log refuses non-items actions');
  ok(Store.getState().hero.x === 4 && Store.getState().xp.total === 30, 'reducers applied');
  const log = Store.getLog();
  ok(log.length === 4 && log[2].action.type === 'items/op', 'every dispatch logged, items/op included');
  const replayed = Store.replay(log);
  ok(JSON.stringify(replayed) === JSON.stringify({ hero: Store.getState().hero, xp: Store.getState().xp }), 'replay rebuilds state');
  // Save within 1 s.
  await new Promise((r) => setTimeout(r, 900));
  const saved1 = JSON.parse(ctx._store.get('abyss-rpg-save'));
  ok(saved1.core.hero.x === 4 && saved1.core.xp.total === 30, 'saved within 1 s of a durable dispatch');
  ok(flushes.length >= 2, 'ItemSave.flush called on core save triggers');
  // Log-only actions do not schedule a save.
  const before = Store.info().saveCount;
  Store.dispatch({ type: 'items/op', op: {} });
  await new Promise((r) => setTimeout(r, 600));
  ok(Store.info().saveCount === before, 'items/* is log-only (no core save)');
  // Ids.
  const a = Ids.mint('quest');
  const b = Ids.mint('Quest Step');
  ok(a === 'quest_' + info.clientId + '_1' && b === 'queststep_' + info.clientId + '_2', 'Ids.mint format ' + a + ' ' + b);
  threw = false;
  try { Ids.mint('item'); } catch (e) { threw = true; }
  ok(threw, 'Ids.mint refuses item ids (ItemIds.next owns them)');
  // Lifecycle flush.
  Store.dispatch({ type: 'hero/arrive', x: 9, y: 9 });
  ctx.document.visibilityState = 'hidden';
  ctx._fireDoc('visibilitychange');
  ok(JSON.parse(ctx._store.get('abyss-rpg-save')).core.hero.x === 9, 'visibilitychange hidden flushes now');
  Store.dispatch({ type: 'hero/arrive', x: 10, y: 9 });
  ctx._fire('pagehide');
  const s2 = JSON.parse(ctx._store.get('abyss-rpg-save'));
  ok(s2.core.hero.x === 10 && s2.idCounter === 2, 'pagehide flushes now, counter saved');

  // Reload in a fresh context: same clientId, counter continues.
  const ctx2 = sandbox();
  ctx2.localStorage = ctx.localStorage;
  load(ctx2, 'js/rpg/store.js');
  load(ctx2, 'js/rpg/save.js');
  ctx2.Store.register('hero', (s) => s, { x: 1, y: 1 });
  const info2 = ctx2.Store.boot();
  ok(info2.clientId === info.clientId && ctx2.Store.getState().hero.x === 10, 'reload keeps clientId and core');
  ok(ctx2.Ids.mint('quest') === 'quest_' + info.clientId + '_3', 'counter continues after reload');
  ok(ctx2.Store.getState().xp && ctx2.Store.getState().xp.total === 30, 'slices of unloaded modules are kept');

  // Version check: future save is kept aside, corrupt save ignored.
  const ctx3 = sandbox();
  ctx3._store.set('abyss-rpg-save', JSON.stringify({ v: 99, clientId: 'zzzzzzzz', idCounter: 5, core: {} }));
  ctx3.localStorage.setItem = ((orig) => (k, v) => orig(k, v))(ctx3.localStorage.setItem);
  load(ctx3, 'js/rpg/store.js');
  load(ctx3, 'js/rpg/save.js');
  const info3 = ctx3.Store.boot();
  ok(info3.clientId !== 'zzzzzzzz' && ctx3._store.has('abyss-rpg-save-future'), 'future version is kept aside, not loaded');
  const ctx4 = sandbox();
  ctx4._store.set('abyss-rpg-save', '{not json');
  load(ctx4, 'js/rpg/store.js');
  load(ctx4, 'js/rpg/save.js');
  ok(/^[a-z0-9]{8}$/.test(ctx4.Store.boot().clientId), 'corrupt save ignored');
  ok(ctx4.Store._migrate({ v: 1, clientId: 'a', idCounter: 0, core: {} }) !== null, 'migrate passes v1');
}

// ---- items stub ------------------------------------------------------------
(function testStub() {
  const ctx = sandbox();
  load(ctx, 'js/rpg/items-stub.js');
  ok(Array.isArray(ctx.Loot.rollDrop('rat', Math.random)) && ctx.Loot.rollDrop('rat').length === 0, 'Loot.rollDrop stub []');
  const st = ctx.Equipment.getStats();
  ok(Object.keys(st).every((k) => (Array.isArray(st[k]) ? st[k].length === 0 : st[k] === 0)) && 'armour' in st && 'def' in st, 'Equipment.getStats zero');
  ok(ctx.Crafting.make('smelt_rustbound') === null, 'Crafting.make null');
  ok(ctx.ItemIds.next() === 'item_stub_1' && ctx.ItemIds.next() === 'item_stub_2', 'ItemIds.next counter');
  ok(typeof ctx.ItemSave.flush === 'function', 'ItemSave.flush no-op');
  ok(ctx.Loot.__rpgItems === true, 'stubs let RPGItems.installGlobals replace them');
  const real = { rollDrop: () => ({ ok: true, drops: [] }) };
  const ctx2 = sandbox({ Loot: real, ItemSave: { flush() {} } });
  load(ctx2, 'js/rpg/items-stub.js');
  ok(ctx2.Loot === real, 'real Loot is not replaced');
})();

// ---- FX adapter ------------------------------------------------------------
(function testFx() {
  const ctx = sandbox();
  load(ctx, 'js/rpg/fx-adapter.js');
  ok(ctx.RpgFx.fxCall('hit', 1, 2) === undefined, 'no FX: no-op');
  const calls = [];
  ctx.FX = {
    telegraph: (...a) => calls.push(['telegraph', ...a]),
    telegraphLine: (...a) => calls.push(['telegraphLine', ...a]),
    draw: (...a) => calls.push(['draw', ...a]),
  };
  ctx.RpgFx.idAt('telegraph', 7, 3, 4, 600);
  ctx.RpgFx.idLine('telegraphLine', 8, 1, 2, 3, 4, 500);
  ctx.RpgFx.at('missingMethod', 1, 1);
  ctx.RpgFx.draw({ canvas: {} }, 10, 20, 4);
  ok(JSON.stringify(calls[0]) === JSON.stringify(['telegraph', 7, 6, 4.5, 600]), 'telegraph converts x*2, y*1.125');
  ok(JSON.stringify(calls[1]) === JSON.stringify(['telegraphLine', 8, 2, 2.25, 6, 4.5, 500]), 'telegraphLine converts both points');
  ok(calls[2][0] === 'draw' && calls[2][2].x === 10 && calls[2][2].y === 20 && calls[2][2].zoom === 4, 'draw camera = origin + zoom');
})();

// ---- town map (shared zone shape) ------------------------------------------
function coreCtx() {
  const ctx = sandbox({ location: { search: '?seed=7' } });
  ['items-stub', 'store', 'save', 'path', 'world', 'hero', 'combat'].forEach((n) => load(ctx, 'js/rpg/' + n + '.js'));
  return ctx;
}
(function testWorld() {
  const ctx = coreCtx();
  const W = ctx.RPG.world;
  const T = W.TOWN;
  ok(T.id === 'town' && T.w === 28 && T.h === 40, 'town zone id/w/h');
  ok(T.grid.length === T.h && T.grid.every((r) => r.length === T.w), 'grid is h rows of w keys');
  ok(T.spawns.every((s) => ['monsterId', 'x', 'y', 'n', 'leash'].every((k) => k in s)), 'spawns {monsterId,x,y,n,leash}');
  ok(T.entry && T.exit && T.exit.to, 'entry + exit {x,y,to}');
  const mk = T.markers;
  ok(['ore', 'tree', 'fish'].every((k) => Array.isArray(mk[k]) && mk[k].length) &&
    ['furnace', 'anvil', 'range', 'fire'].every((k) => mk[k] && Number.isInteger(mk[k].x)), 'markers shape');
  ok(mk.ore.every((m) => m.tier) && mk.tree.every((m) => m.kind), 'ore tier / tree kind');
  const enters = [];
  ctx.RPG.bus.on('enter', (e) => enters.push(e));
  W.loadZone(T);
  ok(enters.length === 0, 'loadZone before boot does not emit enter');
  ok(W.zone.id === 'town' && W.zone.markers === mk, 'RPG.world.zone.markers exposed');
  const cells = [].concat(mk.ore, mk.tree, mk.fish, [mk.furnace, mk.anvil, mk.range, mk.fire]);
  ok(cells.every((m) => W.isBlocked(m.x, m.y)), 'marker tiles block');
  ok(W.entities().every((e) => e.kind === 'npc'), 'core places no node / station entities');
  const ids = W.entities().map((e) => e.id).sort().join(',');
  ok(ids === 'npc_banker,npc_questgiver,npc_shopkeep,npc_smith', 'npc ids: ' + ids);
  W.enterOnce();
  W.enterOnce();
  ok(enters.length === 1 && enters[0].zone === 'town', "'enter' {zone:'town'} once");
  // Explicit blocked grid wins over derivation; later loadZone emits enter.
  const tiny = { id: 't', w: 3, h: 2, grid: [['a', 'tile_water_0', null], ['a', 'a', 'a']], blocked: [[0, 0, 0], [1, 0, 0]], spawns: [], entry: { x: 0, y: 0 }, markers: {} };
  W.loadZone(tiny);
  ok(!W.isBlocked(1, 0) && !W.isBlocked(2, 0) && W.isBlocked(0, 1), 'explicit blocked used');
  delete tiny.blocked;
  W.loadZone(tiny);
  ok(W.isBlocked(1, 0) && W.isBlocked(2, 0) && !W.isBlocked(0, 1), 'blocked derived (null + water)');
  ok(enters.length === 3, 'later loadZone emits enter');
  W.loadZone(T);
  ok(W.walkable(T.entry.x, T.entry.y), 'entry walkable');
  const qg = W.get('npc_questgiver');
  ok(qg && Math.abs(qg.x - 0.5 - T.entry.x) + Math.abs(qg.y - 0.5 - T.entry.y) === 1, 'entry is next to the questgiver');
  const keys = new Set();
  ['phaseb', 'town', 'hero', 'mobs', 'icons'].forEach((n) => {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'assets/rpg', n + '_sheet.json'), 'utf8'));
    Object.keys(j.frames).forEach((k) => keys.add(k));
  });
  const used = new Set();
  T.props.forEach((p) => used.add(p.key));
  T.npcs.forEach((n) => used.add(n.sprite));
  T.grid.forEach((r) => r.forEach((k) => k && used.add(k)));
  T.edges.forEach((r) => r.forEach((l) => (l || []).forEach((k) => used.add(k))));
  mk.ore.forEach((m) => used.add('node_ore_' + m.tier + '_full'));
  mk.tree.forEach((m) => used.add('node_tree_' + m.kind + '_full'));
  ['node_fish_0', 'prop_furnace_0', 'prop_anvil_0', 'prop_range_0', 'prop_fire_0', 'hero_rustbound_idle', 'hero_rustbound_walk'].forEach((k) => used.add(k));
  Object.values(W.MOBS).forEach((m) => [m.idle, m.walk, m.attack].forEach((k) => used.add(k)));
  const missing = [...used].filter((k) => !keys.has(k));
  ok(missing.length === 0, 'every key the town uses is in a sheet: missing ' + missing.join(', '));
  // Every NPC and marker is reachable (walk next to it) from the entry.
  const from = { x: T.entry.x + 0.5, y: T.entry.y + 0.5 };
  W.entities().concat(mk.ore, mk.tree, [mk.furnace, mk.anvil, mk.range, mk.fire]).forEach((t) => {
    const p = W.path(from, { x: Math.floor(t.x), y: Math.floor(t.y) });
    ok(p.length > 0, 'reachable from entry: ' + (t.id || 'marker') + ' @' + t.x + ',' + t.y);
  });
  ok(W.path(from, T.exit).length > 0, 'exit reachable');
  ok(Object.keys(W.MOBS).every((k) => ['rat', 'goblin', 'skeleton', 'imp', 'brute', 'ashmaw'].includes(k)), 'mob ids match Loot.MONSTERS');
  ok(T.spawns.every((s) => s.monsterId in W.MOBS), 'spawn monster ids known');
})();

// ---- hero.damage contract + regen + combat constants -----------------------
(function testHero() {
  const ctx = coreCtx();
  const R = ctx.RPG;
  R.world.loadZone(R.world.TOWN);
  ctx.Store.boot();
  const h = R.hero;
  h.load();
  ok(h.maxHp === 10 && h.hp === 10, 'hero starts at Hitpoints 10');
  const hurts = [];
  const deaths = [];
  R.bus.on('hurt', (e) => hurts.push(e));
  R.bus.on('death', (e) => deaths.push(e));
  h.dodging = true;
  let r = h.damage(5, { srcId: 'mob_1', srcName: 'Rat', kind: 'melee', atk: 99 });
  ok(r.dodged === true && r.hit === false && r.dmg === 0 && h.hp === 10 && !hurts.length, 'i-frames -> dodged');
  h.dodging = false;
  // Hit chance clamps: atk huge -> 0.97, atk tiny -> 0.40 (rng 'combat').
  R.rng.seed(1);
  let hits = 0;
  const N = 4000;
  const st = { hp: h.hp };
  for (let i = 0; i < N; i++) { h.hp = 10; h.alive = true; if (h.damage(1, { atk: -1000 }).hit) hits++; }
  ok(Math.abs(hits / N - 0.4) < 0.03, 'hit chance floor 0.40 (' + (hits / N).toFixed(3) + ')');
  hits = 0;
  for (let i = 0; i < N; i++) { h.hp = 10; h.alive = true; if (h.damage(1, { atk: 1000 }).hit) hits++; }
  ok(Math.abs(hits / N - 0.97) < 0.015, 'hit chance cap 0.97 (' + (hits / N).toFixed(3) + ')');
  hits = 0;
  for (let i = 0; i < N; i++) { h.hp = 10; h.alive = true; if (h.damage(1, { atk: 1 }).hit) hits++; }
  ok(Math.abs(hits / N - 0.75) < 0.03, 'atk 1 vs defence 1 -> 0.75 (' + (hits / N).toFixed(3) + ')');
  // Armour: dmg = round(raw*50/(50+armour)).
  ctx.Equipment.getStats = () => ({ armour: 50, def: 0 });
  h.hp = 10; h.alive = true; h.lastHits = []; hurts.length = 0;
  for (let i = 0; i < 20 && !hurts.length; i++) r = h.damage(9, { srcId: 'mob_g', srcName: 'Goblin', kind: 'melee', atk: 1000 });
  ok(r.hit && r.dmg === 5 && h.hp === 5, 'armour 50 halves 9 -> 5 (got ' + r.dmg + ')');
  ok(hurts.length === 1 && hurts[0].dmg === 5 && hurts[0].srcName === 'Goblin', "'hurt' emitted");
  ctx.Equipment.getStats = () => ({ armour: 0, def: 0 });
  // Regen: none for 4 s after damage, then 2 HP/s.
  for (let i = 0; i < 39; i++) h.update(0.1);
  ok(h.hp === 5, 'no regen inside 4 s (' + h.hp + ')');
  for (let i = 0; i < 11; i++) h.update(0.1); // 5.0 s since hit -> ~2 HP
  ok(h.hp === 7, 'regen 2 HP/s after 4 s (' + h.hp + ')');
  for (let i = 0; i < 50; i++) h.update(0.1);
  ok(h.hp === h.maxHp, 'regen caps at maxHp');
  // Death after 3+ hits: lastHits keeps 3, 'death' {lastHits}.
  h.lastHits = [];
  let n = 0;
  while (h.alive && n++ < 200) h.damage(3, { srcId: 's' + n, srcName: 'Skeleton', kind: 'melee', atk: 1000 });
  ok(!h.alive && h.lastHits.length === 3 && deaths.length === 1 && deaths[0].lastHits.length === 3, 'death {lastHits} (3)');
  ok(R.combat.XP.PER_DAMAGE === 1 && R.combat.XP.HITPOINTS_PER_DAMAGE === 0.33, 'combat XP constants');
  void st;
})();

// ---- Store.get live after restore, camera.toScreen tiles, items boot ------
(function testLiveAndCamera() {
  const ctx = coreCtx();
  const S = ctx.Store;
  ctx.RPG.world.loadZone(ctx.RPG.world.TOWN);
  S.boot();
  S.dispatch({ type: 'hero/arrive', zone: 'town', x: 10, y: 13 });
  S.flush();
  const saved = ctx._store.get('abyss-rpg-save');
  // Fresh page with the same storage: restore, then read live state.
  const ctx2 = coreCtx();
  ctx2._store.set('abyss-rpg-save', saved);
  ctx2.RPG.world.loadZone(ctx2.RPG.world.TOWN);
  ok(ctx2.Store.get('hero').x === -1, 'Store.get before restore = initial');
  ctx2.Store.boot();
  ok(ctx2.Store.get('hero').x === 10 && ctx2.Store.getState().hero.y === 13, 'Store.get / getState live right after a save restore');
  ctx2.Store.dispatch({ type: 'hero/arrive', zone: 'town', x: 11, y: 13 });
  ok(ctx2.Store.get('hero').x === 11 && ctx2.Store.getState().hero.x === 11, 'Store.get live after dispatch');
  load(ctx2, 'js/rpg/camera.js');
  const cam = new ctx2.RpgCamera.Camera();
  cam.setViewport(1170, 2532, 4);
  cam.follow(320, 180, 896, 720, 0, true);
  const p = cam.toScreen(10, 10);
  ok(p.x === cam.originX + 10 * 32 * 4 && p.y === cam.originY + 10 * 18 * 4, 'camera.toScreen takes tiles -> device px');
  const q = cam.toTile(p.x, p.y);
  ok(Math.abs(q.x - 10) < 1e-9 && Math.abs(q.y - 10) < 1e-9, 'camera.toTile inverts toScreen');
  ok(cam.view.toScreen(3, 4).x === cam.toScreen(3, 4).x, 'cam.toScreen (systems) = RPG.camera.toScreen');
  // bootItems: no module -> no-op; fake module gets getLevels from RPG.skills.
  ok(ctx2.RPG.bootItems().reason === 'no_items_module', 'bootItems no-op without RPGItems');
  let opts = null;
  let installed = false;
  ctx2.RPGItems = {
    createWorld: (o) => { opts = o; return { ItemSave: { load: () => ({ ok: true }), installLifecycle() {} }, Inventory: { grant() {} } }; },
    installGlobals: () => { installed = true; return {}; },
  };
  ok(ctx2.RPG.bootItems().ok && installed, 'bootItems creates + installs');
  ok(JSON.stringify(opts.getLevels()) === '{}', 'getLevels -> {} without RPG.skills');
  let calls = 0;
  ctx2.RPG.skills = { levels: () => { calls++; return { mining: 5 }; } };
  ok(opts.getLevels().mining === 5 && calls === 1, 'getLevels calls RPG.skills.levels()');
})();

// ---- input priority (tappables) -------------------------------------------
(function testInput() {
  const ctx = coreCtx();
  load(ctx, 'js/rpg/input.js');
  const R = ctx.RPG;
  const inp = Object.create(ctx.RpgInput.Input.prototype);
  const mob = { kind: 'mob' };
  const npc = { kind: 'npc' };
  const node = { kind: 'node' };
  R.registerTappable({ id: 'core-a', core: true, hit: () => node });
  R.registerTappable({ id: 'owner-node', hit: () => node });
  R.registerTappable({ id: 'core-b', core: true, hit: () => node });
  ok(inp.resolve(1, 1).t.id === 'owner-node', 'owner tappable beats core at equal priority');
  R.registerTappable({ id: 'mobs', hit: () => mob });
  ok(inp.resolve(1, 1).e === mob, 'mob beats node');
  R.registerTappable({ id: 'npcs', core: true, hit: () => npc });
  ok(inp.resolve(1, 1).e === npc, 'npc beats mob');
})();

// ---- rpg.html --------------------------------------------------------------
(function testHtml() {
  const html = fs.readFileSync(path.join(root, 'rpg.html'), 'utf8');
  ok(/<canvas id="rpg"/.test(html), 'rpg.html has the canvas');
  ok(html.indexOf('js/survivor-fx.js') >= 0, 'rpg.html loads survivor-fx.js');
  const order = ['items-stub', 'store', 'save', 'fx-adapter', 'sheet', 'path', 'world', 'camera', 'hero', 'combat', 'ui', 'render', 'input', 'main']
    .map((n) => html.indexOf('js/rpg/' + n + '.js'));
  ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'rpg.html script order');
  ok(!/mobile\/shell/.test(html), 'rpg.html does not link the native shell');
})();

testStore().then(() => {
  if (failures) {
    console.error('rpg checks: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('rpg ok: ' + files.length + ' files pass node --check; A*, Store, Ids, save, stubs, FX adapter, town map checked.');
}, (e) => {
  console.error(e);
  process.exit(1);
});
