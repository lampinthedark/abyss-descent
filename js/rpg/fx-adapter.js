/**
 * Guarded bridge from the RPG core to js/survivor-fx.js (owned by the UI
 * specialist; we only call it). Every call no-ops when FX or the method is
 * missing.
 *
 * survivor-fx.js declares `const FX` at the top level, which is a global
 * binding but NOT a window property, so we look up both `FX` and `window.FX`.
 *
 * Units: our world tiles are 32x18 art px. FX works in 16x16 art px tiles and
 * draws at x * 16 * zoom + cam.x. With zoom = our device px per art px:
 *   fxX = x * 2, fxY = y * 1.125   (tile units)
 */
(function (root) {
  'use strict';

  const FX_TILE = 16;
  const TILE_W = 32;
  const TILE_H = 18;
  const KX = TILE_W / FX_TILE; // 2
  const KY = TILE_H / FX_TILE; // 1.125
  const stats = { calls: 0, skipped: 0, ms: 0 };
  const cam = { x: 0, y: 0, zoom: 1 };

  function box() {
    let fx = null;
    try {
      // eslint-disable-next-line no-undef
      fx = typeof FX !== 'undefined' ? FX : null;
    } catch (e) {
      fx = null;
    }
    return fx || root.FX || null;
  }

  function now() {
    return root.performance && root.performance.now ? root.performance.now() : Date.now();
  }

  /** fxCall(name, ...args): guarded raw call, no unit conversion. */
  function fxCall(name) {
    const fx = box();
    const fn = fx && fx[name];
    if (typeof fn !== 'function') {
      stats.skipped += 1;
      return undefined;
    }
    const args = Array.prototype.slice.call(arguments, 1);
    const t0 = now();
    try {
      return fn.apply(fx, args);
    } catch (e) {
      return undefined;
    } finally {
      stats.calls += 1;
      stats.ms += now() - t0;
    }
  }

  function toFx(x, y) {
    return { x: x * KX, y: y * KY };
  }

  function toFxX(x) { return x * KX; }
  function toFxY(y) { return y * KY; }

  const RpgFx = {
    fxCall: fxCall,
    toFx: toFx,
    toFxX: toFxX,
    toFxY: toFxY,
    stats: stats,
    available(name) {
      const fx = box();
      return !!fx && (name ? typeof fx[name] === 'function' : true);
    },
    /** Point effects: name(x, y, ...rest) with our tile coords. */
    at(name, x, y) {
      const rest = Array.prototype.slice.call(arguments, 3);
      return fxCall.apply(null, [name, toFxX(x), toFxY(y)].concat(rest));
    },
    /** Id + point effects: telegraph(id, x, y, ms, opts), shield(id, x, y, ...), beam(id, x, y, ...). */
    idAt(name, id, x, y) {
      const rest = Array.prototype.slice.call(arguments, 4);
      return fxCall.apply(null, [name, id, toFxX(x), toFxY(y)].concat(rest));
    },
    /** Id + two points: telegraphLine(id, x, y, toX, toY, ms, opts), lootPull(id, x, y, toX, toY, ms, rarity). */
    idLine(name, id, x, y, toX, toY) {
      const rest = Array.prototype.slice.call(arguments, 6);
      return fxCall.apply(null, [name, id, toFxX(x), toFxY(y), toFxX(toX), toFxY(toY)].concat(rest));
    },
    /** Tile radius on our grid -> FX tiles (FX tiles are square; use the width scale). */
    radius(r) {
      return r * KX;
    },
    /**
     * Camera for FX.draw: originX/originY are the device-px screen position of
     * world (0,0); scale is device px per art px.
     */
    camera(originX, originY, scale) {
      cam.x = originX;
      cam.y = originY;
      cam.zoom = scale;
      return cam;
    },
    update(dt) {
      return fxCall('update', dt);
    },
    draw(ctx, originX, originY, scale) {
      return fxCall('draw', ctx, RpgFx.camera(originX, originY, scale));
    },
  };

  /**
   * Which argument indices are (x, y) tile pairs per FX method, and which are
   * radii in tiles. Everything else passes through unchanged.
   */
  const POINTS = {
    telegraph: [1], telegraphLine: [1, 3], lootPull: [1, 3], beam: [1], shield: [1], shieldHit: [1],
    hit: [0], kill: [0], death: [0], pickup: [0], spawn: [0], levelUp: [0], secondChance: [0], cast: [1],
  };
  const RADII = { shield: [3] };
  const OPT_RADIUS = { telegraph: 4, telegraphLine: 6 }; // opts index; radius/r/size/width in tiles

  /**
   * RPG.fx(name, ...args): guarded FX call in OUR tile units. Converts tile
   * points to FX's 16 px square tiles (x*2, y*1.125) and tile radii (x2).
   */
  function rpgFx(name) {
    const args = Array.prototype.slice.call(arguments, 1);
    const pts = POINTS[name];
    if (pts) {
      for (let i = 0; i < pts.length; i++) {
        const k = pts[i];
        if (typeof args[k] === 'number') args[k] = toFxX(args[k]);
        if (typeof args[k + 1] === 'number') args[k + 1] = toFxY(args[k + 1]);
      }
    }
    const rad = RADII[name];
    if (rad) rad.forEach(function (k) { if (typeof args[k] === 'number') args[k] = args[k] * KX; });
    const oi = OPT_RADIUS[name];
    if (oi != null && args[oi] && typeof args[oi] === 'object') {
      const o = Object.assign({}, args[oi]);
      ['radius', 'r', 'size', 'width'].forEach(function (f) { if (typeof o[f] === 'number') o[f] = o[f] * KX; });
      args[oi] = o;
    }
    return fxCall.apply(null, [name].concat(args));
  }

  RpgFx.rpgFx = rpgFx;
  root.RpgFx = RpgFx;
  root.fxCall = root.fxCall || fxCall;
  const RPG = (root.RPG = root.RPG || {});
  RPG.fx = rpgFx;
})(typeof window !== 'undefined' ? window : globalThis);
