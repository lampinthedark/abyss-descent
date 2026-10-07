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

    // spawn points: floor tiles in rooms (not start room center)
    const spawnPoints = [];
    for (let i = 1; i < rooms.length; i++) {
      const r = rooms[i];
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (grid[y][x] === TILE.FLOOR && Utils.chance(0.18)) {
            spawnPoints.push({ x: x + 0.5, y: y + 0.5 });
          }
        }
      }
    }

    return {
      w, h, grid, rooms, TILE,
      startX: start.cx + 0.5,
      startY: start.cy + 0.5,
      stairsX: end.cx + 0.5,
      stairsY: end.cy + 0.5,
      spawnPoints,
      walkable(x, y) {
        const tx = Math.floor(x), ty = Math.floor(y);
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
        return grid[ty][tx] !== TILE.WALL;
      },
      isStairs(x, y) {
        const tx = Math.floor(x), ty = Math.floor(y);
        return tx >= 0 && ty >= 0 && tx < w && ty < h && grid[ty][tx] === TILE.STAIRS;
      },
    };
  }

  function carveRoom(grid, r) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        grid[y][x] = TILE.FLOOR;
      }
    }
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

  return { create, TILE };
})();
