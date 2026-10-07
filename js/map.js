/** Procedural room+corridor dungeon */
const MapGen = (() => {
  const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2 };

  function create(floor = 1) {
    const w = 36 + Math.min(floor, 8) * 2;
    const h = 28 + Math.min(floor, 8) * 2;
    const grid = Array.from({ length: h }, () => Array(w).fill(TILE.WALL));
    const rooms = [];
    const roomCount = 6 + Math.min(floor, 6);

    for (let attempt = 0; attempt < 80 && rooms.length < roomCount; attempt++) {
      const rw = Utils.randInt(5, 9);
      const rh = Utils.randInt(4, 8);
      const rx = Utils.randInt(1, w - rw - 2);
      const ry = Utils.randInt(1, h - rh - 2);
      const room = { x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) };
      let ok = true;
      for (const o of rooms) {
        if (room.x < o.x + o.w + 1 && room.x + room.w + 1 > o.x &&
            room.y < o.y + o.h + 1 && room.y + room.h + 1 > o.y) { ok = false; break; }
      }
      if (!ok) continue;
      carveRoom(grid, room);
      rooms.push(room);
    }

    // corridors
    for (let i = 1; i < rooms.length; i++) {
      carveCorridor(grid, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy);
    }
    // extra loops
    if (rooms.length > 3) {
      carveCorridor(grid, rooms[0].cx, rooms[0].cy, rooms[rooms.length - 1].cx, rooms[rooms.length - 1].cy);
    }

    const start = rooms[0];
    const end = rooms[rooms.length - 1];
    grid[end.cy][end.cx] = TILE.STAIRS;

    // Spawn on open floor inside rooms, inset from walls so bodies aren't in the void.
    const spawnPoints = [];
    for (let i = 1; i < rooms.length; i++) {
      const pool = roomFloors(grid, rooms[i], w, h, true);
      const fallback = pool.length ? pool : roomFloors(grid, rooms[i], w, h, false);
      const step = Math.max(1, Math.floor(fallback.length / 4));
      for (let k = 0; k < fallback.length; k += step) spawnPoints.push(fallback[k]);
    }

    return attach({
      w, h, grid, rooms, TILE,
      startX: start.cx + 0.5,
      startY: start.cy + 0.5,
      stairsX: end.cx + 0.5,
      stairsY: end.cy + 0.5,
      spawnPoints,
    });
  }

  function roomFloors(grid, room, w, h, openOnly) {
    const spots = [];
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (grid[y][x] !== TILE.FLOOR) continue;
        if (openOnly && !openFloor(grid, x, y, w, h)) continue;
        spots.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
    return spots;
  }

  function openFloor(grid, x, y, w, h) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
      if (grid[ny][nx] === TILE.WALL) return false;
    }
    return true;
  }

  function nearestWalkable(map, x, y) {
    if (map.walkable(x, y)) return { x, y };
    const cx = Math.floor(x), cy = Math.floor(y);
    let best = null, bd = Infinity;
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!map.walkable(nx + 0.5, ny + 0.5)) continue;
          const px = nx + 0.5, py = ny + 0.5;
          const d = (px - x) * (px - x) + (py - y) * (py - y);
          if (d < bd) { bd = d; best = { x: px, y: py }; }
        }
      }
      if (best) return best;
    }
    return { x: map.startX, y: map.startY };
  }

  /** A floor tile inside the room, preferring open tiles near the anchor. */
  function roomSpot(map, room, ax, ay, minDist) {
    if (!room) return nearestWalkable(map, ax, ay);
    const spots = [];
    for (let pass = 0; pass < 2; pass++) {
      const pad = pass === 0 && room.w >= 5 && room.h >= 5 ? 1 : 0;
      for (let y = room.y + pad; y < room.y + room.h - pad; y++) {
        for (let x = room.x + pad; x < room.x + room.w - pad; x++) {
          if (!map.grid[y] || map.grid[y][x] !== map.TILE.FLOOR) continue;
          const px = x + 0.5, py = y + 0.5;
          const d = Math.hypot(px - ax, py - ay);
          if (minDist && d < minDist - 0.01) continue;
          spots.push({ x: px, y: py, d });
        }
      }
      if (spots.length) break;
    }
    if (!spots.length) return nearestWalkable(map, ax, ay);
    spots.sort((a, b) => a.d - b.d);
    return spots[0];
  }

  function carveRoom(grid, r) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        grid[y][x] = TILE.FLOOR;
      }
    }
  }

  function attach(map) {
    const { w, h, grid, TILE } = map;
    map.walkable = function (x, y) {
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
      return grid[ty][tx] !== TILE.WALL;
    };
    map.isStairs = function (x, y) {
      const tx = Math.floor(x), ty = Math.floor(y);
      return tx >= 0 && ty >= 0 && tx < w && ty < h && grid[ty][tx] === TILE.STAIRS;
    };
    return map;
  }

  function snapshot(map) {
    return {
      w: map.w,
      h: map.h,
      grid: map.grid.map(row => row.join('')).join('|'),
      startX: map.startX,
      startY: map.startY,
      stairsX: map.stairsX,
      stairsY: map.stairsY,
    };
  }

  function restore(data) {
    if (!data || !data.w || !data.h || typeof data.grid !== 'string') return null;
    const rows = data.grid.split('|');
    if (rows.length !== data.h) return null;
    const grid = [];
    for (const row of rows) {
      if (row.length !== data.w) return null;
      const cells = [];
      for (let i = 0; i < row.length; i++) {
        const n = row.charCodeAt(i) - 48;
        if (n !== 0 && n !== 1 && n !== 2) return null;
        cells.push(n);
      }
      grid.push(cells);
    }
    return attach({
      w: data.w,
      h: data.h,
      grid,
      rooms: [],
      TILE,
      startX: data.startX,
      startY: data.startY,
      stairsX: data.stairsX,
      stairsY: data.stairsY,
      spawnPoints: [],
    });
  }

  function carveCorridor(grid, x1, y1, x2, y2) {
    let x = x1, y = y1;
    while (x !== x2) {
      grid[y][x] = TILE.FLOOR;
      if (y > 0) grid[y - 1][x] = Math.random() < 0.3 ? grid[y - 1][x] : TILE.FLOOR;
      x += x < x2 ? 1 : -1;
    }
    while (y !== y2) {
      grid[y][x] = TILE.FLOOR;
      if (x > 0) grid[y][x - 1] = Math.random() < 0.3 ? grid[y][x - 1] : TILE.FLOOR;
      y += y < y2 ? 1 : -1;
    }
    grid[y2][x2] = TILE.FLOOR;
  }

  return { create, snapshot, restore, TILE, nearestWalkable, roomSpot };
})();
