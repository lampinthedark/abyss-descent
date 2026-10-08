/**
 * Tap / click input (core). One tap is resolved through RPG.tappables
 * (RPG.registerTappable({id, hit(tx, ty) -> entity|null, range, onArrive})):
 *   priority by entity kind: npc > mob > node/station > drop, then tile.
 * At equal priority an owner's tappable beats a core one (core tappables
 * carry core: true), otherwise the most recently registered wins. An entity
 * may carry its own `range` (tiles) to override the tappable's. The hero walks into
 * `range` tiles (default 1.5) of the entity, then onArrive(entity) runs.
 * A tap on nothing walks to the tile (goal snaps to the nearest walkable).
 */
(function (root) {
  'use strict';

  const RPG = (root.RPG = root.RPG || {});
  const DOUBLE_FIRE_MS = 80; // pointer + synthetic mouse guard (same as game.js)
  const PRIORITY = { npc: 0, mob: 1, node: 2, station: 2, drop: 3 };
  const TW = 32;
  const TH = 18;

  function Input(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.lastTap = -1;
    this.marker = null; // { x, y art px, t0, bad }
    this.onTap = null; // optional observer (tests, bench)
    this.enabled = true;
    this._down = this._down.bind(this);
    canvas.addEventListener('pointerdown', this._down, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Stop page scroll / pinch on iOS and Android.
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  }

  Input.prototype._down = function (e) {
    if (e.button != null && e.button > 0) return;
    e.preventDefault();
    const now = e.timeStamp || performance.now();
    if (this.lastTap >= 0 && now - this.lastTap < DOUBLE_FIRE_MS) return;
    this.lastTap = now;
    const rect = this.canvas.getBoundingClientRect();
    const dx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const dy = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    this.tap(dx, dy);
  };

  /** Best entity under (tx, ty) float tiles across all tappables. */
  Input.prototype.resolve = function (tx, ty) {
    const list = RPG.tappables || [];
    let best = null;
    let bestPri = Infinity;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      let e = null;
      try { e = t.hit(tx, ty); } catch (err) { if (root.console) console.error('[tappable ' + t.id + ']', err); }
      if (!e) continue;
      const pri = PRIORITY[e.kind] != null ? PRIORITY[e.kind] : 4;
      // Ties: an owner's tappable beats a core placeholder (t.core); otherwise the later one wins.
      if (pri < bestPri || (pri === bestPri && !(t.core && best && !best.t.core))) { best = { t: t, e: e }; bestPri = pri; }
    }
    return best;
  };

  /** Hit-test a tap at device px (dx, dy). Exposed for tests. */
  Input.prototype.tap = function (dx, dy) {
    if (!this.enabled || (RPG.ui && RPG.ui.isOpen && RPG.ui.isOpen())) return { kind: 'blocked' };
    const hero = RPG.hero;
    const w = this.camera.toWorld(dx, dy);
    const tx = w.x / TW;
    const ty = w.y / TH;
    const now = performance.now();
    const hit = this.resolve(tx, ty);
    let res;
    if (hit) {
      const e = hit.e;
      const range = e.range != null ? e.range : hit.t.range != null ? hit.t.range : 1.5;
      let arrive = function () {
        if (Math.hypot(e.x - hero.x, e.y - hero.y) <= range + 0.75 && typeof hit.t.onArrive === 'function') {
          try { hit.t.onArrive(e); } catch (err) { if (root.console) console.error('[tappable ' + hit.t.id + ' onArrive]', err); }
        }
      };
      this.marker = { x: e.x * TW, y: e.y * TH + 5, t0: now, bad: false, target: true };
      if (Math.hypot(e.x - hero.x, e.y - hero.y) <= range) {
        hero.stop();
        hero.onArrive = null;
        arrive();
        res = { kind: e.kind, target: e, tappable: hit.t.id, walked: false };
      } else {
        // NPCs: stop one tile short, beside them on the hero's side (then the
        // other side, front, back), so neither sprite hides the other or her '!'.
        let gx0 = Math.floor(e.x);
        let gy0 = Math.floor(e.y);
        if (e.kind === 'npc') {
          const side = hero.x < e.x ? -1 : 1;
          const opts = [[side, 0], [-side, 0], [0, 1], [side, 1], [-side, 1], [0, -1]];
          const W = RPG.world;
          for (let k = 0; k < opts.length; k++) {
            const cx = gx0 + opts[k][0];
            const cy = gy0 + opts[k][1];
            if (W.walkable(cx, cy) && W.path({ x: hero.x, y: hero.y }, { x: cx, y: cy }).length) { gx0 = cx; gy0 = cy; break; }
          }
          const face = function () { if (Math.abs(e.x - hero.x) > 0.2) hero.facing = e.x > hero.x ? 1 : -1; };
          const arrive0 = arrive;
          arrive = function () { face(); arrive0(); };
        }
        const cells = hero.walkTo(gx0, gy0);
        hero.onArrive = cells.length ? arrive : null;
        if (!cells.length) arrive();
        res = { kind: e.kind, target: e, tappable: hit.t.id, walked: cells.length > 0, cells: cells.length };
      }
    } else {
      const gx = Math.floor(tx);
      const gy = Math.floor(ty);
      hero.onArrive = null;
      const cells = hero.walkTo(gx, gy);
      const here = hero.tile();
      const goal = root.RpgPath.snapGoal(gx, gy, RPG.world.walkable);
      const bad = !cells.length && !(goal && goal.x === here.x && goal.y === here.y);
      this.marker = { x: w.x, y: w.y, t0: now, bad: bad };
      res = { kind: 'walk', target: { x: gx, y: gy }, cells: cells.length, ok: !bad };
    }
    if (this.onTap) this.onTap(res);
    return res;
  };

  root.RpgInput = { Input: Input, PRIORITY: PRIORITY };
})(typeof window !== 'undefined' ? window : globalThis);
