/**
 * RPG.world: zones, blockers and entities. Units are tiles (float); an
 * entity's (x, y) is its foot point, and the centre of tile (tx, ty) is
 * (tx + 0.5, ty + 0.5). Tiles are 32x18 art px (Phase B grid).
 *
 * Contract (docs/rpg-core-hooks.md):
 *   isBlocked(tx, ty), path(from, to), addEntity(e) -> id, removeEntity(id),
 *   get(id), near(x, y, r, kind?), zone, loadZone(zoneData)
 * RPG.world.zone = { id, w, h, entry, exit, bossRoom, spawns, markers, data }.
 * Extras used by core: pick(tx, ty, kinds?) sprite-rect hit, entities(),
 * forEach(fn), walkable(tx, ty), decor() (static props baked into the
 * ground cache), placeDecor, spriteRect.
 *
 * Zone data (shared shape, also used by Dungeon & Bosses):
 *   { id, w, h,
 *     grid: [[sheetKey | null]]       h rows of w ground keys (null = void, blocks)
 *     blocked: [[0 | 1]]              optional; else derived: null cells and
 *                                     water keys block
 *     spawns: [{monsterId, x, y, n, leash}]
 *     entry: {x, y}, bossRoom: {x, y, w, h}, exit: {x, y, to},
 *     markers: { ore: [{x, y, tier}], tree: [{x, y, kind}], fish: [{x, y}],
 *                furnace: {x, y}, anvil: {x, y}, range: {x, y}, fire: {x, y} },
 *     // optional extras (core):
 *     edges: [[[sheetKey]]]           overlay keys per cell (grass edges)
 *     props: [{key, x, y, fw, fh, tile, block, blocks, anim}]  static decor
 *     npcs: [{id, sprite, name, x, y}] -> kind 'npc' entities (block their tile) }
 * Blocking tiles under every marker are set by loadZone (water fish spots
 * already block). Core does NOT place nodes or stations as entities; Skills &
 * Quests spawns them on 'enter'. loadZone emits 'zone:loaded'; 'enter'
 * {zone: id} is emitted by main.js once after boot, then by every later
 * loadZone.
 */
(function (root) {
  'use strict';

  const RPG = (root.RPG = root.RPG || {});
  const TILE_W = 32;
  const TILE_H = 18;

  // ---- the town (D1 blockout) ----------------------------------------------
  // 28 x 40 tiles, authored as ASCII + decor and compiled (compileAscii) to
  // the shared zone shape. Entry (9,12) stands next to the questgiver (8,12)
  // with the bank (6..8, 6..7) in view on a 390x844 phone (UAT gate 1).
  const TOWN_SRC = {
    id: 'town',
    entry: { x: 9, y: 12 },
    // South road ends at the stairs down (Dungeon & Bosses owns 'dungeon').
    exit: { x: 12, y: 27, to: 'dungeon' },
    ascii: [
      '............................', // 0
      '............................',
      '............................',
      '............................',
      '............................',
      '............................', // 5
      '............................',
      '............................',
      '...cccccccccccccccccccc.....',
      '...cccccccccccccccccccc.....',
      '...cccccppppppppccccccc.....', // 10
      '...cccccppppppppccccccc.....',
      '...cccccppppppppccccccc.....',
      '..ssssscppppppppccccccc.....',
      '..ssssscppppppppccccccc.....',
      '..ssssscppppppppccccccc.....', // 15
      '..ssssscccccccccccccccc.....',
      '..ssssscccccccccccccccc.....',
      '...cccccccccccccccccccc.....',
      '......dd...dd.....dd........',
      '......dd...dd.....dd........', // 20
      '......dd...dd......dddd.....',
      '...ddddd...dd...............',
      '...........dd...............',
      '...........dd...............',
      '...........dd...............', // 25
      '...........ddd..............',
      '............dd...wwwwww.....',
      '...............wwwwwwwwww...',
      '...............wwwwwwwwww...',
      '..............wwwwwwwwwwww..', // 30
      '..............wwwwwwwwwwww..',
      '..............wwwwwwwwwwww..',
      '..............wwwwwwwwwwww..',
      '...............wwwwwwwwww...',
      '................wwwwwwww....', // 35
      '............................',
      '............................',
      '............................',
      '............................',
    ],
    props: [
      // Buildings (facade foot on the bottom footprint row).
      { key: 'prop_bank_0', x: 6, y: 6, fw: 3, fh: 2, block: true, name: 'Bank' },
      { key: 'prop_shop_0', x: 16, y: 6, fw: 2, fh: 2, block: true, name: 'General store' },

      // Bank front.

      // Shop front.
      { key: 'prop_barrel_0', x: 14, y: 8, block: true },
      { key: 'prop_crate_0', x: 15, y: 8, block: true },
      { key: 'prop_shop_shelves_0', x: 19, y: 8, block: true },

      // Flowerbeds by the bank and the shop.
      { key: 'prop_flowerbed_0', x: 5, y: 7, block: true },
      { key: 'prop_flowerbed_0', x: 9, y: 7, block: true },
      { key: 'prop_flowerbed_0', x: 15, y: 7, block: true },
      { key: 'prop_flowerbed_0', x: 18, y: 7, block: true },

      // Market stall east of the plaza (canopy ~1.5 tiles: blocks two).
      { key: 'prop_market_stall_0', x: 18, y: 12, blocks: [[19, 12]], block: true, name: 'Market stall' },

      // Lanterns along the south road out of town (warm flicker glow).
      { key: 'prop_lantern_0', x: 10, y: 20, block: true, anim: 300 },
      { key: 'prop_lantern_0', x: 13, y: 22, block: true, anim: 300 },
      { key: 'prop_lantern_0', x: 10, y: 24, block: true, anim: 300 },
      { key: 'prop_lantern_0', x: 14, y: 26, block: true, anim: 300 },
      { key: 'prop_lantern_0', x: 7, y: 18, block: true, anim: 300 },
      { key: 'prop_lantern_0', x: 16, y: 18, block: true, anim: 300 },

      // Plaza.
      { key: 'prop_well_0', x: 12, y: 13, block: true },
      { key: 'prop_brazier_0', x: 15, y: 10, block: true, anim: 140 },
      { key: 'prop_brazier_0', x: 15, y: 15, block: true, anim: 140 },

      // Smithy yard (stone) and cooking.
      { key: 'prop_barrel_0', x: 6, y: 13, block: true },

      // Stairs down at the end of the south road (zone exit, walkable).
      { key: 'prop_stairs_0', x: 12, y: 27, tile: true },

      // Signs, walls, fences, rocks (Phase B props).
      { key: 'prop_signpost_0', x: 13, y: 19, block: true },
      { key: 'prop_wall_low_0', x: 10, y: 5, tile: true, block: true },
      { key: 'prop_wall_low_1', x: 11, y: 5, tile: true, block: true },
      { key: 'prop_wall_low_0', x: 12, y: 5, tile: true, block: true },
      { key: 'prop_fence_broken_0', x: 15, y: 26, block: true },
      { key: 'prop_fence_broken_1', x: 23, y: 26, block: true },
      { key: 'prop_rock_2', x: 20, y: 23, block: true },
      { key: 'prop_rock_0', x: 25, y: 21, block: true },
      { key: 'prop_rock_1', x: 9, y: 24, block: true },

      // Woods (west): stumps are decor; the live trees are tree markers.
      { key: 'node_tree_ash_stump', x: 4, y: 29 },
      { key: 'node_tree_pine_stump', x: 8, y: 24 },


      // Tufts (decor, walkable).
      { key: 'prop_tuft_0', x: 3, y: 6 }, { key: 'prop_tuft_1', x: 20, y: 4 },
      { key: 'prop_tuft_2', x: 4, y: 20 }, { key: 'prop_tuft_0', x: 16, y: 22 },
      { key: 'prop_tuft_1', x: 9, y: 30 }, { key: 'prop_tuft_2', x: 13, y: 35 },
      { key: 'prop_tuft_0', x: 3, y: 34 }, { key: 'prop_tuft_1', x: 25, y: 18 },
    ],
    // The 4 NPCs (ids fixed by contract; talk event is {npcId}).
    npcs: [
      { id: 'npc_banker', sprite: 'npc_banker', name: 'Banker Maud', x: 7, y: 9 },
      { id: 'npc_shopkeep', sprite: 'npc_shopkeep', name: 'Shopkeep Pell', x: 17, y: 9 },
      { id: 'npc_questgiver', sprite: 'npc_questgiver', name: 'Warden Ilse', x: 8, y: 12 },
      { id: 'npc_smith', sprite: 'npc_smith', name: 'Smith Oren', x: 3, y: 16 },
    ],
    // Gather nodes and stations are markers, not entities: Skills & Quests
    // spawns the real ones on 'enter'; core draws placeholders until then.
    markers: {
      ore: [
        { x: 21, y: 22, tier: 'rustbound' }, { x: 23, y: 22, tier: 'rustbound' }, { x: 22, y: 24, tier: 'rustbound' },
        { x: 24, y: 20, tier: 'cinderiron' }, { x: 24, y: 24, tier: 'verdite' },
        { x: 20, y: 25, tier: 'tidesteel' }, { x: 25, y: 23, tier: 'sunforged' },
      ],
      tree: [
        { x: 2, y: 24, kind: 'ash' }, { x: 5, y: 24, kind: 'ash' }, { x: 3, y: 27, kind: 'ash' },
        { x: 7, y: 26, kind: 'pine' }, { x: 2, y: 30, kind: 'pine' }, { x: 6, y: 30, kind: 'pine' },
      ],
      fish: [{ x: 17, y: 29 }, { x: 20, y: 31 }, { x: 23, y: 33 }],
      furnace: { x: 3, y: 13 },
      anvil: { x: 5, y: 15 },
      range: { x: 21, y: 16 },
      fire: { x: 9, y: 21 },
    },
    // Field packs. Ids match the items owner's Loot.MONSTERS keys exactly
    // (rat, goblin, skeleton, imp, brute = elite, ashmaw = boss).
    // No mob spawns or wanders within r tiles of the Ash Stair gate (UAT/PM rule).
    keepOut: [{ x0: 11, y0: 26, x1: 13, y1: 27, r: 5 }],
    spawns: [
      { monsterId: 'rat', x: 9, y: 33, n: 3, leash: 4, aggro: false },
      { monsterId: 'rat', x: 4, y: 35, n: 2, leash: 4, aggro: false },
      { monsterId: 'goblin', x: 5, y: 31, n: 2, leash: 4, respawn: 10, pull: 'self', area: { x0: 4, y0: 30, x1: 10, y1: 33 } },
      { monsterId: 'goblin', x: 8, y: 32, n: 2, leash: 4, respawn: 10, pull: 'self', area: { x0: 4, y0: 30, x1: 10, y1: 33 } },
    ],
  };
  // Forest ring so the town reads as a clearing (decor, blocks).
  (function border(z) {
    const keys = ['node_tree_pine_full', 'prop_tree_live_0', 'node_tree_ash_full', 'prop_tree_live_1', 'prop_tree_dead_0'];
    const W = z.ascii[0].length;
    let k = 0;
    function put(x, y) { z.props.push({ key: keys[k++ % keys.length], x: x, y: y, block: true }); }
    for (let x = 0; x < W; x += 2) { put(x, 1); put(x, 38); }
    for (let x = 1; x < W; x += 4) { put(x, 3); put(x, 36); }
    for (let y = 5; y < 36; y += 3) { put(0, y); put(W - 1, y + 1); }
  })(TOWN_SRC);

  // Mob sprite sets (frames in mobs_sheet; both face the viewer's left).
  const MOBS = {
    rat: { monsterId: 'rat', name: 'Plague rat', idle: 'mob_rat_idle', walk: 'mob_rat_walk', attack: 'mob_rat_attack', hp: 6 },
    goblin: { monsterId: 'goblin', name: 'Goblin', idle: 'mob_goblin_idle', walk: 'mob_goblin_walk', attack: 'mob_goblin_attack', hp: 14 },
  };


  // ---- state ------------------------------------------------------------------
  let W = 0;
  let H = 0;
  let grid = [];
  let staticBlock = new Uint8Array(0);
  let entBlock = new Uint16Array(0);
  let decor = [];
  let zoneData = null;
  const ents = new Map();
  let entSeq = 0;

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < W && y < H;
  }
  function isBlocked(tx, ty) {
    tx = Math.floor(tx);
    ty = Math.floor(ty);
    if (!inBounds(tx, ty)) return true;
    const i = ty * W + tx;
    return !!(staticBlock[i] || entBlock[i]);
  }
  function walkable(tx, ty) {
    return !isBlocked(tx, ty);
  }
  function keyAt(x, y) {
    return inBounds(x, y) ? grid[y][x] : null;
  }

  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }

  const BASE = {
    '.': ['tile_town_grass_0', 'tile_grass_0', 'tile_town_grass_1', 'tile_grass_1',
      'tile_town_grass_2', 'tile_grass_2', 'tile_town_grass_3', 'tile_grass_3'],
    c: ['tile_cobble_0', 'tile_cobble_1', 'tile_cobble_2'],
    p: ['tile_plaza_0', 'tile_plaza_1'],
    s: ['tile_stone_0', 'tile_stone_1'],
    d: ['tile_town_path_0', 'tile_town_path_1'],
    w: ['tile_water_0', 'tile_water_1'],
  };
  const EDGE = { c: 'edge_grass_cobble_', s: 'edge_grass_stone_', d: 'edge_grass_dirt_', w: 'edge_grass_water_' };

  function legendAt(rows, x, y) {
    return y >= 0 && y < rows.length && x >= 0 && x < rows[0].length ? rows[y][x] : '.';
  }

  function baseKey(rows, x, y) {
    const list = BASE[legendAt(rows, x, y)] || BASE['.'];
    return list[hash(x, y) % list.length];
  }

  /** Grass-over-ground overlays for a non-grass tile, in draw order. */
  function edgeKeys(rows, x, y) {
    const groundAt = function (xx, yy) { return legendAt(rows, xx, yy); };
    const pre = EDGE[groundAt(x, y)];
    if (!pre) return [];
    const g = function (dx, dy) { return groundAt(x + dx, y + dy) === '.'; };
    const n = g(0, -1), s = g(0, 1), e = g(1, 0), w = g(-1, 0);
    const out = [];
    let un = n, us = s, ue = e, uw = w;
    if (n && e) { out.push(pre + 'ne'); un = false; ue = false; }
    if (n && w) { out.push(pre + 'nw'); un = false; uw = false; }
    if (s && e) { out.push(pre + 'se'); us = false; ue = false; }
    if (s && w) { out.push(pre + 'sw'); us = false; uw = false; }
    if (un) out.push(pre + 'n');
    if (us) out.push(pre + 's');
    if (ue) out.push(pre + 'e');
    if (uw) out.push(pre + 'w');
    if (!n && !e && g(1, -1)) out.push(pre + 'inner_ne');
    if (!n && !w && g(-1, -1)) out.push(pre + 'inner_nw');
    if (!s && !e && g(1, 1)) out.push(pre + 'inner_se');
    if (!s && !w && g(-1, 1)) out.push(pre + 'inner_sw');
    return out;
  }

  /**
   * Authored ASCII zone -> shared zone shape. Legend:
   *   . grass  c cobble  p plaza  s stone  d town path  w water (blocks)
   */
  function compileAscii(src) {
    const rows = src.ascii;
    const h = rows.length;
    const w = rows[0].length;
    const g = [];
    const edges = [];
    for (let y = 0; y < h; y++) {
      const gr = [];
      const er = [];
      for (let x = 0; x < w; x++) {
        gr.push(baseKey(rows, x, y));
        const e = edgeKeys(rows, x, y);
        er.push(e.length ? e : null);
      }
      g.push(gr);
      edges.push(er);
    }
    return {
      id: src.id, w: w, h: h, grid: g, edges: edges,
      spawns: src.spawns || [], keepOut: src.keepOut || [], entry: src.entry, exit: src.exit || null, bossRoom: src.bossRoom || null,
      markers: src.markers || {}, props: src.props || [], npcs: src.npcs || [],
    };
  }

  /** Art-px placement of a decor prop: sprite top-left and foot row. */
  function placeDecor(p, size) {
    if (p.fw > 1 || p.fh > 1) {
      const footPx = (p.y + p.fh) * TILE_H - 1;
      return { ax: p.x * TILE_W - 1, ay: footPx - size.footY, foot: footPx };
    }
    if (p.tile) return { ax: p.x * TILE_W - 1, ay: p.y * TILE_H - 1, foot: p.y * TILE_H - 1 + size.footY };
    const fx = (p.x + 0.5) * TILE_W;
    const fy = p.y * TILE_H + 14;
    return { ax: Math.round(fx - Math.floor(size.w / 2)), ay: fy - size.footY, foot: fy };
  }

  /** Art-px foot point of an entity (x, y tiles): (x*32, y*18 + 5). */
  function footPx(e) {
    return { x: e.x * TILE_W, y: e.y * TILE_H + 5 };
  }

  /** Sprite rect of an entity in art px (uses Sheet sizes when loaded). */
  function spriteRect(e) {
    const S = root.Sheet;
    const z = S ? S.size(e.sprite) : { w: 24, h: 32, footX: 12, footY: 31 };
    if (e.overlay) return { x0: Math.floor(e.x) * TILE_W, y0: Math.floor(e.y) * TILE_H, x1: Math.floor(e.x) * TILE_W + z.w, y1: Math.floor(e.y) * TILE_H + z.h };
    const f = footPx(e);
    const fy = e.footY != null ? e.footY : z.footY;
    const fx = e.flip ? z.w - z.footX : z.footX;
    return { x0: f.x - fx, y0: f.y - fy, x1: f.x - fx + z.w, y1: f.y - fy + z.h };
  }

  function setBlock(e, d) {
    if (!e.block) return;
    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);
    if (inBounds(tx, ty)) entBlock[ty * W + tx] = Math.max(0, entBlock[ty * W + tx] + d);
  }

  /** addEntity({ kind, x, y, sprite, ... }) -> id. x, y in tiles (foot point). */
  function addEntity(e) {
    if (!e || !e.kind) throw new Error('addEntity needs a kind');
    if (!e.id) e.id = e.kind + '_' + (++entSeq);
    if (ents.has(e.id)) removeEntity(e.id);
    if (e.frame == null) e.frame = 0;
    if (e.flip == null) e.flip = false;
    ents.set(e.id, e);
    setBlock(e, 1);
    return e.id;
  }

  function removeEntity(id) {
    const e = ents.get(id);
    if (!e) return false;
    setBlock(e, -1);
    ents.delete(id);
    return true;
  }

  function get(id) {
    return ents.get(id) || null;
  }

  /** Entities within r tiles of (x, y), nearest first; optional kind filter. */
  function near(x, y, r, kind) {
    const out = [];
    ents.forEach(function (e) {
      if (kind && e.kind !== kind) return;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= r) out.push({ e: e, d: d });
    });
    out.sort(function (a, b) { return a.d - b.d; });
    return out.map(function (o) { return o.e; });
  }

  /** Front-most entity whose sprite (or tile) is under the tap (float tiles). */
  function pick(tx, ty, kinds) {
    const ax = tx * TILE_W;
    const ay = ty * TILE_H;
    let best = null;
    let bestFoot = -Infinity;
    // Mobs: the one whose sprite centre is closest to the tap; ties (within 2 art px) go to the quest's kill target.
    let mob = null;
    let mobD = Infinity;
    const want = questKillTarget();
    ents.forEach(function (e) {
      if (kinds && kinds.indexOf(e.kind) < 0) return;
      if (e.pickable === false) return;
      const r = spriteRect(e);
      const onTile = Math.floor(e.x) === Math.floor(tx) && Math.floor(e.y) === Math.floor(ty);
      const inRect = ax >= r.x0 && ax < r.x1 && ay >= r.y0 && ay < r.y1;
      if (!onTile && !inRect) return;
      if (e.kind === 'mob') {
        const d = Math.hypot(ax - (r.x0 + r.x1) / 2, ay - (r.y0 + r.y1) / 2);
        const pref = want && mobId(e) === want;
        const mobPref = want && mob && mobId(mob) === want;
        if (d < mobD - 2 || (Math.abs(d - mobD) <= 2 && pref && !mobPref)) { mob = e; mobD = d; }
        return;
      }
      const foot = footPx(e).y + (onTile ? 0.5 : 0);
      if (foot > bestFoot) { best = e; bestFoot = foot; }
    });
    return mob || best;
  }

  function mobId(e) { return e.monsterId || (e.def && e.def.id) || (e.spec && e.spec.id) || null; }

  /** monsterId of the active quest's kill step, or null. */
  function questKillTarget() {
    try {
      const Q = root.RPG && root.RPG.quests;
      if (Q && typeof Q.wantKill === 'function') return Q.wantKill() || null;
      const a = Q && Q.active && Q.active();
      const C = (root.RPG && root.RPG.content) || root.RPGContent;
      const q = a && C && C.quest && C.quest(a.questId);
      const st = q && q.steps && q.steps[a.step];
      return st && st.done && st.done.type === 'kill' ? st.done.target : null;
    } catch (err) { return null; }
  }

  /** path({x,y}, {x,y}) in tiles -> [{x, y}] tile cells (start excluded, goal snapped). */
  function path(from, to, opts) {
    return root.RpgPath.pathfind(from.x, from.y, to.x, to.y, walkable, Object.assign({ w: W, h: H }, opts || {}));
  }

  function markerCells(mk) {
    const out = [];
    ['ore', 'tree', 'fish'].forEach(function (k) { (mk[k] || []).forEach(function (m) { out.push(m); }); });
    ['furnace', 'anvil', 'range', 'fire'].forEach(function (k) { if (mk[k]) out.push(mk[k]); });
    return out;
  }

  let started = false; // set by main.js after the first 'enter'

  /**
   * Load a zone (shared shape above): grid, blockers (given or derived, plus
   * decor and markers), decor, npc entities. Clears all entities.
   */
  function loadZone(z) {
    if (!z || !Array.isArray(z.grid) || !z.grid.length) throw new Error('loadZone: zone needs a grid');
    zoneData = z;
    grid = z.grid;
    H = z.h || grid.length;
    W = z.w || grid[0].length;
    staticBlock = new Uint8Array(W * H);
    entBlock = new Uint16Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let b;
        if (z.blocked) b = z.blocked[y] && z.blocked[y][x] ? 1 : 0;
        else {
          const k = grid[y] ? grid[y][x] : null;
          b = !k || /water/.test(k) ? 1 : 0;
        }
        staticBlock[y * W + x] = b;
      }
    }
    ents.clear();
    decor = [];
    (z.props || []).forEach(function (p, i) {
      const d = Object.assign({ i: i, fw: 1, fh: 1 }, p);
      decor.push(d);
      if (p.block) {
        for (let yy = p.y; yy < p.y + (p.fh || 1); yy++) {
          for (let xx = p.x; xx < p.x + (p.fw || 1); xx++) if (inBounds(xx, yy)) staticBlock[yy * W + xx] = 1;
        }
        (p.blocks || []).forEach(function (b) { if (inBounds(b[0], b[1])) staticBlock[b[1] * W + b[0]] = 1; });
      }
    });
    const markers = z.markers || {};
    markerCells(markers).forEach(function (m) { if (inBounds(m.x, m.y)) staticBlock[m.y * W + m.x] = 1; });
    (z.npcs || []).forEach(function (n, i) {
      addEntity(Object.assign({ anim: 500, block: true }, n, {
        kind: 'npc', x: n.x + 0.5, y: n.y + 0.5, frame: 0, flip: false, seed: 500 + i,
      }));
    });
    api.zone = {
      id: z.id, w: W, h: H,
      entry: z.entry || { x: 0, y: 0 },
      exit: z.exit || null,
      bossRoom: z.bossRoom || null,
      spawns: z.spawns || [],
      keepOut: z.keepOut || [],
      markers: markers,
      data: z,
    };
    api.W = W;
    api.H = H;
    api.pixelW = W * TILE_W;
    api.pixelH = H * TILE_H;
    api.spawn = api.zone.entry;
    if (RPG.bus) {
      RPG.bus.emit('zone:loaded', { zone: z.id });
      if (started) RPG.bus.emit('enter', { zone: z.id });
    }
    return z.id;
  }

  /** main.js: emit the first 'enter' once after boot; later loadZone calls emit it themselves. */
  function enterOnce() {
    if (started) return false;
    started = true;
    if (RPG.bus && api.zone) RPG.bus.emit('enter', { zone: api.zone.id });
    return true;
  }

  const TOWN = compileAscii(TOWN_SRC);

  const api = {
    TILE_W: TILE_W,
    TILE_H: TILE_H,
    TOWN: TOWN,
    TOWN_SRC: TOWN_SRC,
    MOBS: MOBS,
    compileAscii: compileAscii,
    enterOnce: enterOnce,
    zoneId() { return api.zone ? api.zone.id : null; },
    zone: null,
    W: 0,
    H: 0,
    pixelW: 0,
    pixelH: 0,
    spawn: null,
    isBlocked: isBlocked,
    walkable: walkable,
    inBounds: inBounds,
    path: path,
    addEntity: addEntity,
    removeEntity: removeEntity,
    get: get,
    near: near,
    pick: pick,
    loadZone: loadZone,
    entities() { return Array.from(ents.values()); },
    forEach(fn) { ents.forEach(fn); },
    decor() { return decor; },
    zoneData() { return zoneData; },
    keyAt: keyAt,
    placeDecor: placeDecor,
    footPx: footPx,
    spriteRect: spriteRect,
    hash: hash,
  };
  RPG.world = api;
})(typeof window !== 'undefined' ? window : globalThis);
