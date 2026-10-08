/**
 * The Ash Stair: week-1 dungeon as data on GD's tile grid (32x18 art px per
 * tile, same legend + edge rules as GD's town world.js).
 *
 *   rows     ground chars:  '.' grass void (BLOCKED here)  's' stone floor
 *                           'd' dirt corridor  'c' cobble landing (town sheet)
 *   legend   char -> base tile keys (variant = GD's hash(x,y) % n) + edge prefix
 *   props    [{key, x, y, block, frames?, tile?, overlay?, role?}]  (sheet keys)
 *   spawns   [{monsterId, x, y, room}]   one entry = one pack (size from MONSTERS[id].pack)
 *   entry    {x, y}  where the player appears coming down from town
 *   exits    [{x, y, to:{map, x, y}, key, unlockedBy?}]  stepping on the tile travels
 *   bossRoom {x, y, w, h}  (zone 'ash_stair_boss')
 *   rooms    [{id, kind:'landing'|'pack'|'elite'|'boss', x, y, w, h}]
 *
 * Helpers: RPGContent.Dungeon.keyGrid() -> [[{base, edges:[...]}]],
 * .walkable(x, y), .keysUsed(), .bfs(from), .walkSeconds(from, to).
 * All keys come from rsc-look/phaseb/sheet.json (stone, dirt, grass, props)
 * and rsc-look/town/sheet.json (cobble + edge_grass_cobble_*); the content
 * tests check every key against those sheets.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var C = isNode ? require('./content-core.js') : root.RPGContent;
  factory(C);
  if (isNode) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis, function (C) {
  'use strict';

  var TILE_W = 32, TILE_H = 18, SPEED = 80; // GD: art px per tile, walk px/s

  var ROWS = [
    '........................',
    '.........cccccc.........',
    '.........cccccc.........',
    '.........cccccc.........',
    '...........dd...........',
    '...........dd...........',
    '...........dd...........',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '...........dd...........',
    '...........dd...........',
    '...........dd...........',
    '...ssssssssssssssssss...',
    '...ssssssssssssssssss...',
    '...ssssssssssssssssss...',
    '...ssssssssssssssssss...',
    '...ssssssssssssssssss...',
    '...ssssssssssssssssss...',
    '...ssssssssssssssssss...',
    '...ssssssssssssssssss...',
    '...ssssssssssssssssss...',
    '................dd......',
    '................dd......',
    '................dd......',
    '......ssssssssssssssss..',
    '......ssssssssssssssss..',
    '......ssssssssssssssss..',
    '......ssssssssssssssss..',
    '......ssssssssssssssss..',
    '......ssssssssssssssss..',
    '......ssssssssssssssss..',
    '......ssssssssssssssss..',
    '...........dd...........',
    '...........dd...........',
    '...........dd...........',
    '....ssssssssssssssss....',
    '....ssssssssssssssss....',
    '....ssssssssssssssss....',
    '....ssssssssssssssss....',
    '....ssssssssssssssss....',
    '....ssssssssssssssss....',
    '....ssssssssssssssss....',
    '...........dd...........',
    '...........dd...........',
    '...........dd...........',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '.....ssssssssssssss.....',
    '...........dd...........',
    '...........dd...........',
    '...........dd...........',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..ssssssssssssssssssss..',
    '..........ssss..........',
    '........................',
  ];

  var LEGEND = {
    '.': { base: ['tile_grass_0', 'tile_grass_1', 'tile_grass_2', 'tile_grass_3'], walk: false, sheet: 'phaseb' },
    s: { base: ['tile_stone_0', 'tile_stone_1'], edge: 'edge_grass_stone_', walk: true, sheet: 'phaseb' },
    d: { base: ['tile_dirt_0', 'tile_dirt_1', 'tile_dirt_2'], edge: 'edge_grass_dirt_', walk: true, sheet: 'phaseb' },
    c: { base: ['tile_cobble_0', 'tile_cobble_1', 'tile_cobble_2'], edge: 'edge_grass_cobble_', walk: true, sheet: 'town' },
  };

  var ROOMS = [
    { id: 'landing', kind: 'landing', x: 9, y: 1, w: 6, h: 3 },
    { id: 'hall_1', kind: 'pack', x: 5, y: 7, w: 14, h: 8 },
    { id: 'hall_2', kind: 'pack', x: 3, y: 18, w: 18, h: 9 },
    { id: 'hall_3', kind: 'pack', x: 6, y: 30, w: 16, h: 8 },
    { id: 'hall_4', kind: 'pack', x: 4, y: 41, w: 16, h: 7 },
    { id: 'brute_hall', kind: 'elite', x: 5, y: 51, w: 14, h: 8 },
    { id: 'den', kind: 'boss', x: 2, y: 62, w: 20, h: 13 },
  ];

  var PROPS = [
    // landing + exit
    { key: 'prop_stairs_0', x: 11, y: 1, block: false, role: 'exit_town' },
    { key: 'prop_signpost_0', x: 14, y: 2, block: true },
    // hall 1
    { key: 'prop_pillar_broken_0', x: 5, y: 7, block: true },
    { key: 'prop_pillar_broken_0', x: 18, y: 7, block: true },
    { key: 'prop_bones_0', x: 10, y: 13, block: false },
    { key: 'prop_rock_0', x: 17, y: 14, block: true },
    // hall 2: four pillars = cover from imp embers
    { key: 'prop_pillar_broken_0', x: 7, y: 21, block: true },
    { key: 'prop_pillar_broken_0', x: 16, y: 21, block: true },
    { key: 'prop_pillar_broken_0', x: 7, y: 24, block: true },
    { key: 'prop_pillar_broken_0', x: 16, y: 24, block: true },
    { key: 'prop_bones_1', x: 12, y: 23, block: false },
    // hall 3
    { key: 'prop_ruin_slab_0', x: 13, y: 34, block: false },
    { key: 'prop_rock_1', x: 6, y: 37, block: true },
    { key: 'prop_tuft_0', x: 20, y: 31, block: false },
    // hall 4
    { key: 'prop_ruin_slab_1', x: 9, y: 45, block: false },
    { key: 'prop_rock_2', x: 19, y: 41, block: true },
    { key: 'prop_bones_0', x: 15, y: 46, block: false },
    // brute hall
    { key: 'prop_brazier_0', x: 6, y: 52, block: true, frames: 3 },
    { key: 'prop_brazier_0', x: 17, y: 52, block: true, frames: 3 },
    { key: 'prop_bones_1', x: 9, y: 57, block: false },
    // boss gate + den
    { key: 'prop_arch_0', x: 11, y: 61, block: false, overlay: false, role: 'boss_gate' },
    { key: 'prop_brazier_0', x: 3, y: 63, block: true, frames: 3 },
    { key: 'prop_brazier_0', x: 20, y: 63, block: true, frames: 3 },
    { key: 'prop_brazier_0', x: 3, y: 72, block: true, frames: 3 },
    { key: 'prop_brazier_0', x: 20, y: 72, block: true, frames: 3 },
    { key: 'prop_bones_0', x: 6, y: 69, block: false },
    { key: 'prop_bones_1', x: 17, y: 66, block: false },
    { key: 'prop_stairs_0', x: 11, y: 74, block: false, role: 'exit_town_after_boss' },
  ];

  // Low ruined walls along the void row above each hall (decor on blocked grass),
  // plus dead trees scattered in the void. Deterministic.
  function voidAround(x, y) {
    for (var dy = -2; dy <= 0; dy++) for (var dx = -1; dx <= 1; dx++) {
      var r = ROWS[y + dy];
      if (r && r[x + dx] !== undefined && r[x + dx] !== '.') return false;
    }
    return true;
  }
  (function autoDecor() {
    ROOMS.forEach(function (r) {
      if (r.kind === 'landing') return;
      var y = r.y - 1;
      for (var x = r.x; x < r.x + r.w; x++) {
        if (ROWS[y][x] === '.') PROPS.push({ key: 'prop_wall_low_' + (x % 2), x: x, y: y, block: true, tile: true, decor: true });
      }
    });
    for (var y = 0; y < ROWS.length; y += 3) {
      for (var x = 0; x < ROWS[0].length; x += 1) {
        if (ROWS[y][x] !== '.') continue;
        if (!voidAround(x, y)) continue;   // tall sprites must not poke up into a room
        var h = hash(x, y) % 23;
        if (h === 0) PROPS.push({ key: 'prop_tree_dead_' + (x % 2), x: x, y: y, block: true, decor: true });
        else if (h === 1) PROPS.push({ key: 'prop_rock_' + (y % 3), x: x, y: y, block: true, decor: true });
      }
    }
  })();

  var SPAWNS = [
    { monsterId: 'skeleton', x: 8, y: 10, room: 'hall_1' },
    { monsterId: 'imp', x: 15, y: 12, room: 'hall_1' },
    { monsterId: 'skeleton', x: 12, y: 13, room: 'hall_1' },
    { monsterId: 'imp', x: 16, y: 9, room: 'hall_1' },
    { monsterId: 'skeleton', x: 11, y: 19, room: 'hall_2' },
    { monsterId: 'imp', x: 5, y: 25, room: 'hall_2' },
    { monsterId: 'skeleton', x: 18, y: 25, room: 'hall_2' },
    { monsterId: 'imp', x: 11, y: 25, room: 'hall_2' },
    { monsterId: 'skeleton', x: 4, y: 19, room: 'hall_2' },
    { monsterId: 'imp', x: 9, y: 32, room: 'hall_3' },
    { monsterId: 'skeleton', x: 18, y: 35, room: 'hall_3' },
    { monsterId: 'skeleton', x: 11, y: 36, room: 'hall_3' },
    { monsterId: 'imp', x: 17, y: 31, room: 'hall_3' },
    { monsterId: 'imp', x: 8, y: 36, room: 'hall_3' },
    { monsterId: 'skeleton', x: 7, y: 43, room: 'hall_4' },
    { monsterId: 'imp', x: 16, y: 43, room: 'hall_4' },
    { monsterId: 'skeleton', x: 11, y: 46, room: 'hall_4' },
    { monsterId: 'imp', x: 5, y: 46, room: 'hall_4' },
    { monsterId: 'brute', x: 11, y: 55, room: 'brute_hall' },
    { monsterId: 'ashmaw', x: 11, y: 67, room: 'den' },
  ];

  var ENTRY = { x: 11, y: 3 };
  var EXITS = [
    { x: 11, y: 1, key: 'prop_stairs_0', to: { map: 'town', x: 12, y: 26 } },
    { x: 11, y: 74, key: 'prop_stairs_0', to: { map: 'town', x: 12, y: 26 }, unlockedBy: 'ashmaw' },
  ];
  var BOSS_ROOM = { x: 2, y: 62, w: 20, h: 12 };

  function hash(x, y) {   // GD's world.js variant hash
    var h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  var W = ROWS[0].length, H = ROWS.length;
  function groundAt(x, y) { return (x >= 0 && y >= 0 && x < W && y < H) ? ROWS[y][x] : '.'; }

  var blocked = null;
  function buildBlocked() {
    blocked = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) if (!LEGEND[groundAt(x, y)].walk) blocked[y * W + x] = 1;
    PROPS.forEach(function (p) { if (p.block) blocked[p.y * W + p.x] = 1; });
  }
  function walkable(x, y) {
    if (!blocked) buildBlocked();
    return x >= 0 && y >= 0 && x < W && y < H && !blocked[y * W + x];
  }

  function edgeKeys(x, y) {   // same rules as GD's world.js edgeKeys
    var L = LEGEND[groundAt(x, y)];
    if (!L.edge) return [];
    var pre = L.edge;
    var g = function (dx, dy) { return groundAt(x + dx, y + dy) === '.'; };
    var n = g(0, -1), s = g(0, 1), e = g(1, 0), w = g(-1, 0), out = [];
    var un = n, us = s, ue = e, uw = w;
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
  function keyGrid() {
    var out = [];
    for (var y = 0; y < H; y++) {
      var row = [];
      for (var x = 0; x < W; x++) {
        var L = LEGEND[groundAt(x, y)];
        row.push({ base: L.base[hash(x, y) % L.base.length], edges: edgeKeys(x, y) });
      }
      out.push(row);
    }
    return out;
  }
  function keysUsed() {
    var set = {};
    keyGrid().forEach(function (r) { r.forEach(function (c) { set[c.base] = 1; c.edges.forEach(function (k) { set[k] = 1; }); }); });
    PROPS.forEach(function (p) { set[p.key] = 1; });
    return Object.keys(set).sort();
  }

  // GD's A* step costs in tile-width units: E/W 1, N/S 18/32, diagonal hypot(1, 18/32).
  var NS = TILE_H / TILE_W, DIAG = Math.sqrt(1 + NS * NS);
  var DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, NS], [0, -1, NS], [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG]];
  /** Dijkstra over walkable tiles (no corner cutting). Returns Float64Array of costs (tile widths), Infinity if unreachable. */
  function bfs(from) {
    var dist = new Float64Array(W * H).fill(Infinity);
    var open = [[0, from.x, from.y]];
    dist[from.y * W + from.x] = 0;
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      var cur = open.splice(bi, 1)[0];
      var cx = cur[1], cy = cur[2];
      if (cur[0] > dist[cy * W + cx]) continue;
      for (var k = 0; k < 8; k++) {
        var nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (!walkable(nx, ny)) continue;
        if (DIRS[k][0] && DIRS[k][1] && (!walkable(cx + DIRS[k][0], cy) || !walkable(cx, cy + DIRS[k][1]))) continue;
        var nd = cur[0] + DIRS[k][2];
        if (nd < dist[ny * W + nx]) { dist[ny * W + nx] = nd; open.push([nd, nx, ny]); }
      }
    }
    return dist;
  }
  function walkSeconds(from, to) {
    var d = bfs(from)[to.y * W + to.x];
    return d === Infinity ? Infinity : d * TILE_W / SPEED;
  }

  C.Dungeon = {
    id: 'ash_stair', name: 'The Ash Stair', width: W, height: H, tileW: TILE_W, tileH: TILE_H,
    rows: ROWS, legend: LEGEND, rooms: ROOMS, props: PROPS, spawns: SPAWNS,
    entry: ENTRY, exits: EXITS, exit: EXITS[0], bossRoom: BOSS_ROOM,
    townGate: { map: 'town', x: 12, y: 27, zone: 'ash_stair_gate' },
    groundAt: groundAt, walkable: walkable, edgeKeys: edgeKeys, keyGrid: keyGrid, keysUsed: keysUsed,
    bfs: bfs, walkSeconds: walkSeconds, hash: hash,
  };
  C.DUNGEONS = { ash_stair: C.Dungeon };
});
