/**
 * Sprite sheets for the RPG. Loads one or more { image, json } atlases
 * (3x PNG + sheet.json in 1x art px), merges their keys (later sheets win on
 * clashes) and draws by key at an integer device-px-per-art-px scale.
 *
 * The 3x PNG is reduced once to an exact 1x atlas (it is a pure 3x nearest
 * upscale), so every draw is an integer-scale nearest blit: sharp at any DPR.
 *
 * Sheets are data-driven: assets/rpg/sheets.json lists them in load order,
 * so a replacement PNG + JSON (e.g. the town colour pass) drops straight in.
 * grade: true sheets get an optional warm sunlit grade baked into the 1x
 * atlas once at load (zero per-frame cost; ?grade=0 turns it off).
 *
 * Any key that is missing draws a labelled
 * placeholder box sized from PLACEHOLDER (or 24x32), so the game never breaks
 * on art that has not landed yet.
 */
(function (root) {
  'use strict';

  const frames = Object.create(null); // key -> { atlas, x, y, w, h, frames, footY }
  const atlases = [];
  const missingSeen = Object.create(null);
  let readyFlag = false;

  const PLACEHOLDER = {
    hero_idle_s: [16, 28],
    hero_walk_s: [16, 28],
    mob_rat_idle: [20, 12],
  };

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image failed: ' + src)); };
      img.src = src;
    });
  }

  function loadJson(src) {
    return fetch(src, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('json failed: ' + src + ' ' + r.status);
      return r.json();
    });
  }

  function reduceAtlas(img, factor) {
    const w = Math.round(img.width / factor);
    const h = Math.round(img.height / factor);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h);
    return c;
  }

  /**
   * Warm sunlit grade, baked once per atlas: a light warm overlay plus a
   * small saturation lift on opaque pixels only.
   */
  function gradeAtlas(canvas) {
    const g = canvas.getContext('2d');
    let img;
    try {
      img = g.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      return canvas; // tainted (file://) - skip the grade
    }
    const d = img.data;
    const WR = 255, WG = 206, WB = 150, MIX = 0.07, SAT = 1.03; // subtle: the town art is already warm
    function ov(c, w) {
      return c < 128 ? (2 * c * w) / 255 : 255 - (2 * (255 - c) * (255 - w)) / 255;
    }
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let r = d[i], gg = d[i + 1], b = d[i + 2];
      r += (ov(r, WR) - r) * MIX;
      gg += (ov(gg, WG) - gg) * MIX;
      b += (ov(b, WB) - b) * MIX;
      const L = 0.299 * r + 0.587 * gg + 0.114 * b;
      d[i] = Math.max(0, Math.min(255, L + (r - L) * SAT + 2));
      d[i + 1] = Math.max(0, Math.min(255, L + (gg - L) * SAT + 1));
      d[i + 2] = Math.max(0, Math.min(255, L + (b - L) * SAT - 1));
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  function addAtlas(canvas, json) {
    const index = atlases.length;
    atlases.push(canvas);
    const src = (json && json.frames) || {};
    Object.keys(src).forEach(function (key) {
      const f = src[key];
      frames[key] = {
        atlas: index,
        x: f.x | 0,
        y: f.y | 0,
        w: f.w | 0,
        h: f.h | 0,
        frames: Math.max(1, f.frames | 0),
        footY: f.footY == null ? null : f.footY | 0,
        footX: f.footX == null ? null : f.footX | 0,
        ms: Array.isArray(f.ms) ? f.ms.slice() : null,
        hitFrame: f.hit_frame == null ? null : f.hit_frame | 0,
      };
    });
  }

  /**
   * sources: [{ image: 'assets/rpg/x_3x.png', json: 'assets/rpg/x.json', scale: 3 }, ...]
   * Later entries win on key clashes. A failed sheet is skipped (its keys
   * then draw as placeholders) instead of stopping the game.
   */
  function load(sources, opts) {
    const o = opts || {};
    const jobs = (sources || []).map(function (s) {
      return Promise.all([loadImage(s.image), loadJson(s.json)]).then(
        function (pair) { return { pair: pair, s: s }; },
        function (err) { return { err: err, s: s }; }
      );
    });
    return Promise.all(jobs).then(function (results) {
      const errors = [];
      results.forEach(function (r) {
        if (r.err) {
          errors.push(String(r.err.message || r.err));
          return;
        }
        const img = r.pair[0];
        const json = r.pair[1];
        const factor = r.s.scale || 3;
        let atlas = factor === 1 ? img : reduceAtlas(img, factor);
        if (r.s.grade && o.grade !== false && atlas.getContext) atlas = gradeAtlas(atlas);
        addAtlas(atlas, json);
      });
      readyFlag = true;
      return { keys: Object.keys(frames).length, errors: errors };
    });
  }

  /** Load the sheets listed in a manifest JSON (paths relative to it). */
  function loadManifest(url, opts) {
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    return loadJson(url).then(function (m) {
      const list = (m.sheets || []).map(function (e) {
        return { id: e.id, image: base + e.image, json: base + e.json, scale: e.scale || 3, grade: !!e.grade };
      });
      return load(list, opts);
    });
  }

  function has(key) {
    return !!frames[key];
  }

  function get(key) {
    return frames[key] || null;
  }

  /** Size and foot row for a key, real or placeholder. */
  function size(key) {
    const f = frames[key];
    if (f) {
      return {
        w: f.w, h: f.h, frames: f.frames,
        footY: f.footY == null ? f.h - 1 : f.footY,
        footX: f.footX == null ? Math.floor(f.w / 2) : f.footX,
      };
    }
    const p = PLACEHOLDER[key] || [24, 32];
    return { w: p[0], h: p[1], footY: p[1] - 1, footX: Math.floor(p[0] / 2), frames: 1 };
  }

  function placeholder(ctx, key, dx, dy, w, h, s) {
    missingSeen[key] = true;
    const W = w * s;
    const H = h * s;
    ctx.fillStyle = 'rgba(40, 36, 48, 0.78)';
    ctx.fillRect(dx, dy, W, H);
    ctx.strokeStyle = '#e8e0c8';
    ctx.lineWidth = Math.max(1, Math.round(s / 2));
    ctx.strokeRect(dx + ctx.lineWidth / 2, dy + ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
    const fs = Math.max(8, Math.round(4 * s));
    ctx.font = fs + 'px monospace';
    ctx.fillStyle = '#e8e0c8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = key.length > 14 ? key.slice(0, 13) + '…' : key;
    ctx.fillText(label, dx + W / 2, dy + H / 2, W - 2);
  }

  /**
   * Draw key with its top-left at device px (dx, dy). frame wraps.
   * flip mirrors horizontally inside the same box.
   */
  function draw(ctx, key, dx, dy, s, frame, flip) {
    const f = frames[key];
    dx = Math.round(dx);
    dy = Math.round(dy);
    if (!f) {
      const z = size(key);
      placeholder(ctx, key, dx, dy, z.w, z.h, s);
      return false;
    }
    const i = f.frames > 1 ? ((frame | 0) % f.frames + f.frames) % f.frames : 0;
    if (flip) {
      ctx.save();
      ctx.translate(dx + f.w * s, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(atlases[f.atlas], f.x + i * f.w, f.y, f.w, f.h, 0, 0, f.w * s, f.h * s);
      ctx.restore();
    } else {
      ctx.drawImage(atlases[f.atlas], f.x + i * f.w, f.y, f.w, f.h, dx, dy, f.w * s, f.h * s);
    }
    return true;
  }

  /** Draw only source rows [y0, y0 + rows) of a key, top-left of those rows at (dx, dy). */
  function drawRows(ctx, key, dx, dy, s, frame, y0, rows) {
    const f = frames[key];
    if (!f) return false;
    const i = f.frames > 1 ? ((frame | 0) % f.frames + f.frames) % f.frames : 0;
    const r = Math.max(0, Math.min(rows, f.h - y0));
    if (r <= 0) return false;
    ctx.drawImage(atlases[f.atlas], f.x + i * f.w, f.y + y0, f.w, r, Math.round(dx), Math.round(dy), f.w * s, r * s);
    return true;
  }

  /** Frame index for a key at time t (ms) using its per-frame ms list. */
  function frameAtTime(key, t, fallbackMs) {
    const f = frames[key];
    if (!f || f.frames <= 1) return 0;
    const ms = f.ms && f.ms.length === f.frames ? f.ms : null;
    if (!ms) return Math.floor(t / (fallbackMs || 200)) % f.frames;
    let total = 0;
    for (let i = 0; i < ms.length; i++) total += ms[i];
    let k = t % total;
    for (let i = 0; i < ms.length; i++) {
      if (k < ms[i]) return i;
      k -= ms[i];
    }
    return 0;
  }

  /** Draw key so its foot anchor (footX, footY) lands on device px (fx, fy). */
  function drawFoot(ctx, key, fx, fy, s, frame, flip) {
    const z = size(key);
    const ax = flip ? z.w - z.footX : z.footX;
    return draw(ctx, key, fx - ax * s, fy - z.footY * s, s, frame, flip);
  }

  root.Sheet = {
    load: load,
    loadManifest: loadManifest,
    drawRows: drawRows,
    frameAtTime: frameAtTime,
    has: has,
    get: get,
    size: size,
    draw: draw,
    drawFoot: drawFoot,
    ready() { return readyFlag; },
    keys() { return Object.keys(frames); },
    missing() { return Object.keys(missingSeen); },
    PLACEHOLDER: PLACEHOLDER,
  };
})(typeof window !== 'undefined' ? window : globalThis);
