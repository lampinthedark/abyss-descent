/** Shared helpers */
const Utils = {
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  lerp(a, b, t) { return a + (b - a) * t; },
  dist(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return Math.hypot(dx, dy);
  },
  rand(a, b) { return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(Utils.rand(a, b + 1)); },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  chance(p) { return Math.random() < p; },
  /** World tile → isometric screen (relative to camera) */
  iso(tx, ty, tileW = 64, tileH = 32) {
    return {
      x: (tx - ty) * (tileW / 2),
      y: (tx + ty) * (tileH / 2),
    };
  },
  /** Screen point → approximate world tile (given camera offset) */
  screenToWorld(sx, sy, camX, camY, tileW = 64, tileH = 32) {
    const x = sx - camX;
    const y = sy - camY;
    const tx = (x / (tileW / 2) + y / (tileH / 2)) / 2;
    const ty = (y / (tileH / 2) - x / (tileW / 2)) / 2;
    return { x: tx, y: ty };
  },
  /** Simple A* on grid (walkable = fn(x,y) true) */
  pathfind(sx, sy, gx, gy, walkable, maxNodes = 800) {
    const key = (x, y) => x + ',' + y;
    // Tile centers are n+0.5. Math.round(n+0.5) lands on n+1, one tile past the goal.
    const start = { x: Math.floor(sx), y: Math.floor(sy) };
    const goal = { x: Math.floor(gx), y: Math.floor(gy) };
    if (!walkable(goal.x, goal.y)) {
      // snap to nearest walkable near goal
      let best = null, bd = Infinity;
      for (let r = 1; r <= 4; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            const nx = goal.x + dx, ny = goal.y + dy;
            if (walkable(nx, ny)) {
              const d = Math.abs(dx) + Math.abs(dy);
              if (d < bd) { bd = d; best = { x: nx, y: ny }; }
            }
          }
        }
        if (best) break;
      }
      if (!best) return [];
      goal.x = best.x; goal.y = best.y;
    }
    const open = [{ x: start.x, y: start.y, g: 0, f: 0, parent: null }];
    const closed = new Set();
    const openMap = new Map();
    openMap.set(key(start.x, start.y), open[0]);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    let nodes = 0;
    while (open.length && nodes++ < maxNodes) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      openMap.delete(key(cur.x, cur.y));
      if (cur.x === goal.x && cur.y === goal.y) {
        const path = [];
        let p = cur;
        while (p) { path.push({ x: p.x, y: p.y }); p = p.parent; }
        path.reverse();
        return path.slice(1); // skip current cell
      }
      closed.add(key(cur.x, cur.y));
      for (const [dx, dy] of dirs) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const k = key(nx, ny);
        if (closed.has(k) || !walkable(nx, ny)) continue;
        // no corner cutting
        if (dx && dy && (!walkable(cur.x + dx, cur.y) || !walkable(cur.x, cur.y + dy))) continue;
        const cost = (dx && dy) ? 1.414 : 1;
        const g = cur.g + cost;
        const h = Math.hypot(goal.x - nx, goal.y - ny);
        const existing = openMap.get(k);
        if (existing && existing.g <= g) continue;
        const node = { x: nx, y: ny, g, f: g + h, parent: cur };
        if (existing) {
          Object.assign(existing, node);
        } else {
          open.push(node);
          openMap.set(k, node);
        }
      }
    }
    return [];
  },
};
