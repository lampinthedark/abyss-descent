/** Procedural room+corridor dungeon */
const MapGen = (() => {
  const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2 };

  function create(floor = 1) {
    const w = 36 + Math.min(floor, 8) * 2;
    const h = 28 + Math.min(floor, 8) * 2;
    const grid = Array.from({ length: h }, () => Array(w).fill(TILE.WALL));
    const rooms = [];
    const roomCount = 6 + Math.min(floor, 6);

    for (let attempt = 0; attempt < 120 && rooms.length < roomCount; attempt++) {
      const first = rooms.length === 0;
      // Entrance room is large so the Hermit can stand down-screen of the player
      // with two lit floor tiles behind the sprite, not against the void.
      const rw = first ? Utils.randInt(8, 10) : Utils.randInt(6, 9);
      const rh = first ? Utils.randInt(7, 9) : Utils.randInt(6, 8);
      const rx = Utils.randInt(3, Math.max(3, w - rw - 4));
      const ry = Utils.randInt(3, Math.max(3, h - rh - 4));
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

    // Only tiles whose up-screen neighbors are also floor. Sprites draw upward,
    // so a body on the back edge stands in the black beside the lit diamonds.
    const spawnPoints = [];
    for (let i = 1; i < rooms.length; i++) {
      const r = rooms[i];
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (grid[y][x] === TILE.WALL || grid[y][x] === TILE.STAIRS) continue;
          if (!tileGrounded(grid, x, y, w, h)) continue;
          spawnPoints.push({ x: x + 0.5, y: y + 0.5 });
        }
      }
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

  // Feet sit on (x,y). The sprite reaches about two tiles up-screen (negative x/y).
  function tileGrounded(grid, x, y, w, h) {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    if (grid[y][x] === TILE.WALL) return false;
    for (let dy = -2; dy <= 0; dy++) {
      for (let dx = -2; dx <= 0; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
        if (grid[ny][nx] === TILE.WALL) return false;
      }
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

  /** Nearest tile center a sprite can stand on without drawing into the void. */
  function nearestGrounded(map, x, y, maxR = 8) {
    if (map.grounded && map.grounded(x, y)) {
      return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
    }
    const cx = Math.floor(x), cy = Math.floor(y);
    let best = null, bd = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!map.grounded(nx + 0.5, ny + 0.5)) continue;
          const px = nx + 0.5, py = ny + 0.5;
          const d = (px - x) * (px - x) + (py - y) * (py - y);
          if (d < bd) { bd = d; best = { x: px, y: py }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** A grounded tile near the anchor, preferring down-screen so the body overlaps floor. */
  function placeBeside(map, ax, ay) {
    const tx = Math.floor(ax), ty = Math.floor(ay);
    const offsets = [[1, 1], [2, 1], [1, 2], [2, 2], [1, 0], [0, 1], [3, 1], [1, 3], [2, 0], [0, 2], [3, 2], [2, 3]];
    for (const [dx, dy] of offsets) {
      const x = tx + dx + 0.5, y = ty + dy + 0.5;
      if (!map.grounded(x, y)) continue;
      if (map.isStairs(x, y)) continue;
      return { x, y };
    }
    return nearestGrounded(map, ax + 1, ay + 1, 10) || nearestWalkable(map, ax, ay);
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
    map.grounded = function (x, y) {
      return tileGrounded(grid, Math.floor(x), Math.floor(y), w, h);
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

  function paintFloor(grid, x, y) {
    const h = grid.length, w = grid[0].length;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    if (grid[y][x] === TILE.STAIRS) return;
    grid[y][x] = TILE.FLOOR;
  }

  function carveCorridor(grid, x1, y1, x2, y2) {
    let x = x1, y = y1;
    // Stamp a 3×3 block toward up-screen so the center tile stays visually grounded.
    const stamp = (px, py) => {
      for (let dy = -2; dy <= 0; dy++) {
        for (let dx = -2; dx <= 0; dx++) paintFloor(grid, px + dx, py + dy);
      }
    };
    stamp(x, y);
    while (x !== x2) {
      x += x < x2 ? 1 : -1;
      stamp(x, y);
    }
    while (y !== y2) {
      y += y < y2 ? 1 : -1;
      stamp(x, y);
    }
    stamp(x2, y2);
  }

  return { create, snapshot, restore, TILE, nearestWalkable, nearestGrounded, placeBeside, roomSpot };
})();
