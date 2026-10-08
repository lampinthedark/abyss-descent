/**
 * 8-way A* on the tile grid, ported from js/utils.js pathfind():
 * same no-corner-cutting rule and the same snap-to-nearest-walkable goal,
 * but with a binary heap (no open.sort() per step) and NO 800-node cap.
 *
 * Tiles are 32x18 art px, so step costs follow on-screen distance:
 * east/west 1, north/south 18/32, diagonal hypot(1, 18/32). The heuristic is
 * the same metric (admissible), so paths look straight on screen.
 */
(function (root) {
  'use strict';

  const SY = 18 / 32;
  const DIAG = Math.hypot(1, SY);
  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, SY], [0, -1, SY],
    [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
  ];

  /** Min-heap of node indices keyed by f. Lazy deletion (stale entries skipped). */
  function Heap() {
    this.ids = [];
    this.keys = [];
  }
  Heap.prototype.size = function () { return this.ids.length; };
  Heap.prototype.push = function (id, key) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  };
  Heap.prototype.pop = function () {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop();
    const lastKey = keys.pop();
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  };

  function heuristic(ax, ay, bx, by) {
    return Math.hypot(bx - ax, (by - ay) * SY);
  }

  /** Nearest walkable tile to (gx, gy) within radius 4 (same rule as utils.js). */
  function snapGoal(gx, gy, walkable) {
    if (walkable(gx, gy)) return { x: gx, y: gy };
    let best = null;
    let bd = Infinity;
    for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (walkable(nx, ny)) {
            const d = Math.abs(dx) + Math.abs(dy) * SY;
            if (d < bd) { bd = d; best = { x: nx, y: ny }; }
          }
        }
      }
      if (best) break;
    }
    return best;
  }

  /**
   * pathfind(sx, sy, gx, gy, walkable, opts) -> [{x, y}, ...] tile cells,
   * start excluded, goal included. [] when there is no route.
   * walkable(x, y) must return false out of bounds. opts.w / opts.h bound the
   * grid (used for flat indices); opts.maxNodes is optional (default: none).
   */
  function pathfind(sx, sy, gx, gy, walkable, opts) {
    const o = opts || {};
    const W = o.w | 0;
    const H = o.h | 0;
    if (!(W > 0 && H > 0)) throw new Error('pathfind needs opts.w and opts.h');
    const maxNodes = o.maxNodes > 0 ? o.maxNodes : Infinity;
    const start = { x: Math.floor(sx), y: Math.floor(sy) };
    const goal = snapGoal(Math.floor(gx), Math.floor(gy), walkable);
    if (!goal) return [];
    if (start.x === goal.x && start.y === goal.y) return [];
    const N = W * H;
    const g = new Float64Array(N).fill(Infinity);
    const parent = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new Heap();
    const sIdx = start.y * W + start.x;
    const gIdx = goal.y * W + goal.x;
    g[sIdx] = 0;
    heap.push(sIdx, heuristic(start.x, start.y, goal.x, goal.y));
    let expanded = 0;
    while (heap.size() && expanded < maxNodes) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      expanded += 1;
      if (cur === gIdx) {
        const out = [];
        let p = cur;
        while (p !== -1 && p !== sIdx) {
          out.push({ x: p % W, y: (p / W) | 0 });
          p = parent[p];
        }
        out.reverse();
        pathfind.lastExpanded = expanded;
        return out;
      }
      const cx = cur % W;
      const cy = (cur / W) | 0;
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0];
        const dy = DIRS[d][1];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (closed[ni] || !walkable(nx, ny)) continue;
        if (dx && dy && (!walkable(cx + dx, cy) || !walkable(cx, cy + dy))) continue;
        const ng = g[cur] + DIRS[d][2];
        if (ng >= g[ni]) continue;
        g[ni] = ng;
        parent[ni] = cur;
        heap.push(ni, ng + heuristic(nx, ny, goal.x, goal.y));
      }
    }
    pathfind.lastExpanded = expanded;
    return [];
  }

  /**
   * Line of sight between two tile-unit points for a body of radius r tiles
   * (checked on both side rails), sampled every 0.1 tile.
   */
  function clearLine(ax, ay, bx, by, walkable, r) {
    const rad = r == null ? 0.28 : r;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return true;
    const nx = -dy / len;
    const ny = dx / len;
    const steps = Math.ceil(len / 0.1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = ax + dx * t;
      const py = ay + dy * t;
      if (!walkable(Math.floor(px), Math.floor(py))) return false;
      if (!walkable(Math.floor(px + nx * rad), Math.floor(py + ny * rad))) return false;
      if (!walkable(Math.floor(px - nx * rad), Math.floor(py - ny * rad))) return false;
    }
    return true;
  }

  /**
   * Turn A* cells into tile-unit waypoints (cell centres), dropping corners
   * that have a clear straight line (string pulling) for smooth walking.
   */
  function smooth(fromX, fromY, cells, walkable) {
    const pts = cells.map(function (c) { return { x: c.x + 0.5, y: c.y + 0.5 }; });
    if (pts.length < 2) return pts;
    const out = [];
    let ax = fromX;
    let ay = fromY;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !clearLine(ax, ay, pts[j].x, pts[j].y, walkable)) j--;
      out.push(pts[j]);
      ax = pts[j].x;
      ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }

  root.RpgPath = {
    pathfind: pathfind,
    smooth: smooth,
    clearLine: clearLine,
    snapGoal: snapGoal,
    Heap: Heap,
    COST_NS: SY,
    COST_DIAG: DIAG,
  };
})(typeof window !== 'undefined' ? window : globalThis);
