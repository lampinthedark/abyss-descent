/**
 * Survivor visual effects. Combat stays in the game; this file only draws.
 * Safe to call before the atlas loads: missing args and a missing sprite
 * sheet are ignored.
 *
 * Boss / elite silhouette flashes share one photosensitivity budget with the
 * evolution flash (at most 3 per second, and never a full-screen white above
 * 60%). The hit payload has no stable enemy id today, so those silhouette
 * flashes also share a single 0.35s cooldown. If `id` or `fid` is present on
 * the hit options, the 0.35s wait is per id instead (fixed 24-slot table).
 * Sparks still spawn on every hit, inside the particle cap.
 * Second Chance never uses a full-screen flash.
 */
const FX = (function () {
  'use strict';

  const CAP = 200;
  const RING_CAP = 12;
  const SIL_CAP = 10;
  const MAX_B = 8;
  const TRAIL = 4;
  const VOW_CAP = 8;
  const CD_N = 24;
  const ORBIT_SPRITE = 15;
  const FLASH_LIFE = 0.1;
  const TAU = 6.283185307179586;
  const BLADE_W = 35;
  const BLADE_H = 18;

  const parts = new Array(CAP);
  for (let i = 0; i < CAP; i++) {
    parts[i] = { life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, w: 2, h: 2, tone: 0 };
  }
  let partCursor = 0;

  const rings = new Array(RING_CAP);
  for (let i = 0; i < RING_CAP; i++) {
    rings[i] = {
      on: 0, age: 0, dur: 0.2, delay: 0,
      x: 0, y: 0, r0: 0, r1: 0, thick: 2, space: 0, tone: 0,
    };
  }

  const sils = new Array(SIL_CAP);
  for (let i = 0; i < SIL_CAP; i++) {
    sils[i] = { life: 0, x: 0, y: 0, sx: 0, sy: 0, sw: 0, sh: 0, scale: 1, flip: 0 };
  }

  const blades = new Array(MAX_B);
  for (let i = 0; i < MAX_B; i++) {
    const trail = new Array(TRAIL);
    for (let t = 0; t < TRAIL; t++) trail[t] = { x: 0, y: 0, a: 0 };
    blades[i] = {
      x: 0, y: 0, a: 0, holdX: 0, holdY: 0, holdA: 0,
      samples: 0, live: 0, trail: trail,
    };
  }

  const cdKey = new Array(CD_N);
  const cdTime = new Array(CD_N);
  for (let i = 0; i < CD_N; i++) {
    cdKey[i] = null;
    cdTime[i] = -10;
  }

  const flashStamp = [-10, -10, -10];
  const trailAlpha = [0.55, 0.34, 0.2, 0.1];
  const toneColor = ['#ffffff', '#c8cdd4', '#9aa3ad'];

  let clock = 0;
  let stepped = false;
  let vows = 0;
  let vowAng = 0;
  let halo = 0;
  let popOn = 0;
  let popT = 0;
  let popKind = 0;
  let flashLeft = 0;
  let flashSlot = 0;
  let bladeN = 0;
  let bladeStamp = -10;
  let lastBladeSample = -10;
  let globalBossAt = -10;
  let cdCursor = 0;
  let reduce = false;
  let reduceChecked = -1;
  let heroHalf = 0;
  let whiteAtlas = null;
  let bladeImg = null;
  let rng = 1;

  function rand() {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  }

  function ok(n) {
    return typeof n === 'number' && n === n;
  }

  function framePx() {
    const s = typeof Sprites !== 'undefined' ? Sprites : null;
    return (s && s.FRAME) || 16;
  }

  function readReduced() {
    try {
      const fn = typeof matchMedia === 'function'
        ? matchMedia
        : (typeof window !== 'undefined' ? window.matchMedia : null);
      if (typeof fn !== 'function') return false;
      return !!fn('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function reducedNow() {
    if (clock - reduceChecked > 0.4) {
      reduceChecked = clock;
      reduce = readReduced();
    }
    return reduce;
  }

  function heroHalfSprite() {
    if (heroHalf > 0) return heroHalf;
    try {
      const s = typeof Sprites !== 'undefined' ? Sprites : null;
      const fr = s && s.frameRect ? s.frameRect('hero', 'idle', 0) : null;
      if (fr && fr.sh > 0) heroHalf = fr.sh * 0.5;
    } catch (e) {}
    return heroHalf > 0 ? heroHalf : 0;
  }

  function bodyY(y) {
    const half = heroHalfSprite();
    const frame = framePx();
    return half > 0 ? y - half / frame : y;
  }

  function ensureWhite() {
    if (whiteAtlas) return whiteAtlas;
    let atlas = null;
    try {
      const s = typeof Sprites !== 'undefined' ? Sprites : null;
      atlas = s ? s.atlas : null;
    } catch (e) {
      return null;
    }
    if (!atlas || !atlas.width || typeof document === 'undefined' || !document.createElement) return null;
    try {
      const c = document.createElement('canvas');
      c.width = atlas.width;
      c.height = atlas.height;
      const g = c.getContext('2d');
      if (!g || typeof g.drawImage !== 'function' || typeof g.fillRect !== 'function') return null;
      g.imageSmoothingEnabled = false;
      g.drawImage(atlas, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'source-over';
      whiteAtlas = c;
      return c;
    } catch (e) {
      return null;
    }
  }

  function ensureBlade() {
    if (bladeImg) return bladeImg;
    if (typeof document === 'undefined' || !document.createElement) return null;
    try {
      const c = document.createElement('canvas');
      c.width = BLADE_W;
      c.height = BLADE_H;
      const g = c.getContext('2d');
      if (!g || typeof g.fillRect !== 'function') return null;
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#14180c';
      g.fillRect(0, 6, 33, 6);
      g.fillRect(6, 3, 4, 12);
      g.fillStyle = '#3c3830';
      g.fillRect(1, 7, 6, 4);
      g.fillStyle = '#d5dbe4';
      g.fillRect(9, 7, 20, 4);
      g.fillStyle = '#f7f9fc';
      g.fillRect(10, 8, 12, 2);
      g.fillStyle = '#ffffff';
      g.fillRect(12, 8, 5, 1);
      g.fillStyle = '#eef2f6';
      g.fillRect(29, 8, 4, 2);
      g.fillRect(33, 8, 2, 2);
      bladeImg = c;
      return c;
    } catch (e) {
      return null;
    }
  }

  function takePart() {
    for (let n = 0; n < CAP; n++) {
      const i = (partCursor + n) % CAP;
      if (parts[i].life <= 0) {
        partCursor = (i + 1) % CAP;
        return parts[i];
      }
    }
    const p = parts[partCursor];
    partCursor = (partCursor + 1) % CAP;
    return p;
  }

  function takeRing() {
    let best = 0;
    let bestAge = -1;
    for (let i = 0; i < RING_CAP; i++) {
      if (!rings[i].on) return rings[i];
      if (rings[i].age > bestAge) {
        bestAge = rings[i].age;
        best = i;
      }
    }
    return rings[best];
  }

  function takeSil() {
    let best = 0;
    let bestLife = 1e9;
    for (let i = 0; i < SIL_CAP; i++) {
      if (sils[i].life <= 0) return sils[i];
      if (sils[i].life < bestLife) {
        bestLife = sils[i].life;
        best = i;
      }
    }
    return sils[best];
  }

  function spray(x, y, n, life, speed, w, h, whiteOnly) {
    const base = rand() * TAU;
    for (let i = 0; i < n; i++) {
      const p = takePart();
      const a = base + i * 2.399963229728653;
      const sp = speed * (0.62 + rand() * 0.5);
      const dur = life * (0.85 + rand() * 0.3);
      p.life = dur;
      p.max = dur;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.w = w;
      p.h = (i % 2 === 0) ? h : Math.max(2, h - 1);
      p.tone = whiteOnly ? 0 : (i % 3);
    }
  }

  function addRing(o) {
    const r = takeRing();
    r.on = 1;
    r.age = 0;
    r.dur = o.dur > 0 ? o.dur : 0.2;
    r.delay = o.delay > 0 ? o.delay : 0;
    r.x = ok(o.x) ? o.x : 0;
    r.y = ok(o.y) ? o.y : 0;
    r.r0 = ok(o.r0) ? o.r0 : 0;
    r.r1 = ok(o.r1) ? o.r1 : 0;
    r.thick = o.thick > 0 ? o.thick : 2;
    r.space = o.space | 0;
    r.tone = o.tone | 0;
  }

  function spawnSil(x, y, vis) {
    const fr = vis && vis.frame;
    if (!fr || !(fr.sw > 0) || !(fr.sh > 0)) return;
    const s = takeSil();
    s.life = 0.06;
    s.x = x;
    s.y = y;
    s.sx = fr.sx || 0;
    s.sy = fr.sy || 0;
    s.sw = fr.sw;
    s.sh = fr.sh;
    s.scale = vis.scale > 0 ? vis.scale : 1;
    s.flip = vis.flip ? 1 : 0;
  }

  function tryConsumeFlash() {
    let newest = -10;
    let within = 0;
    for (let i = 0; i < 3; i++) {
      const t = flashStamp[i];
      if (t > newest) newest = t;
      if (clock - t < 1) within += 1;
    }
    if (within >= 3) return false;
    if (clock - newest < 0.34) return false;
    flashStamp[flashSlot] = clock;
    flashSlot = (flashSlot + 1) % 3;
    return true;
  }

  function visKey(vis) {
    if (!vis) return null;
    const id = vis.id != null ? vis.id : vis.fid;
    if (typeof id === 'number' && id === id) return id;
    if (typeof id === 'string' && id) return id;
    return null;
  }

  function allowSpriteFlash(vis) {
    if (reducedNow()) return false;
    const key = visKey(vis);
    let slot = -1;
    if (key == null) {
      if (clock - globalBossAt < 0.35) return false;
    } else {
      let free = -1;
      for (let i = 0; i < CD_N; i++) {
        if (cdKey[i] === key) {
          slot = i;
          break;
        }
        if (free < 0 && (cdKey[i] == null || clock - cdTime[i] >= 0.35)) free = i;
      }
      if (slot >= 0) {
        if (clock - cdTime[slot] < 0.35) return false;
      } else {
        slot = free >= 0 ? free : cdCursor;
        cdCursor = (cdCursor + 1) % CD_N;
      }
    }
    if (!tryConsumeFlash()) return false;
    if (key == null) globalBossAt = clock;
    else {
      cdKey[slot] = key;
      cdTime[slot] = clock;
    }
    return true;
  }

  function noteBlades(hx, hy, info) {
    const pos = info && info.positions;
    const n = (pos && pos.length) ? (pos.length > MAX_B ? MAX_B : pos.length) : 0;
    if (!n) {
      bladeN = 0;
      return;
    }
    const sample = lastBladeSample < 0 || clock - lastBladeSample >= 0.04;
    for (let i = 0; i < n; i++) {
      const b = blades[i];
      const p = pos[i];
      const px = p && ok(p.x) ? p.x : hx;
      const py = p && ok(p.y) ? p.y : hy;
      const pa = p && ok(p.angle) ? p.angle : 0;
      if (sample && b.live) {
        const tr = b.trail;
        for (let t = TRAIL - 1; t > 0; t--) {
          tr[t].x = tr[t - 1].x;
          tr[t].y = tr[t - 1].y;
          tr[t].a = tr[t - 1].a;
        }
        tr[0].x = b.holdX;
        tr[0].y = b.holdY;
        tr[0].a = b.holdA;
        if (b.samples < TRAIL) b.samples += 1;
      }
      if (sample) {
        b.holdX = px;
        b.holdY = py;
        b.holdA = pa;
        b.live = 1;
      }
      b.x = px;
      b.y = py;
      b.a = pa;
    }
    for (let i = n; i < MAX_B; i++) {
      blades[i].live = 0;
      blades[i].samples = 0;
    }
    if (sample) lastBladeSample = clock;
    bladeN = n;
    bladeStamp = clock;
  }

  function spawnNova(x, y, radius) {
    if (!(radius > 0)) return;
    addRing({
      space: 0, x: x, y: y, r0: 0, r1: radius,
      thick: halo ? 3 : 2, dur: 0.25, tone: 0,
    });
    if (halo) {
      addRing({
        space: 0, x: x, y: y, r0: 0, r1: radius * 0.8,
        thick: 2, dur: 0.25, delay: 0.04, tone: 0,
      });
    }
  }

  function bladeMul() {
    if (!(popOn && popKind === 1)) return 1;
    const t = popT / 0.42;
    if (t >= 1) return 1;
    if (t < 0.16) return 1.5 + (t / 0.16) * 0.15;
    return 1.65 + ((t - 0.16) / 0.84) * (1 - 1.65);
  }

  function step(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    clock += dt;
    if (flashLeft > 0) flashLeft = Math.max(0, flashLeft - dt);
    if (popOn) {
      popT += dt;
      if (popT > 0.45) popOn = 0;
    }
    vowAng += dt * 1.5;
    if (bladeN && clock - bladeStamp > 0.45) {
      bladeN = 0;
      lastBladeSample = -10;
      for (let i = 0; i < MAX_B; i++) {
        blades[i].live = 0;
        blades[i].samples = 0;
      }
    }
    for (let i = 0; i < CAP; i++) {
      const p = parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const damp = 1 - dt * 1.5;
      p.vx *= damp;
      p.vy *= damp;
    }
    for (let i = 0; i < RING_CAP; i++) {
      const r = rings[i];
      if (!r.on) continue;
      r.age += dt;
      if (r.age > r.delay + r.dur) r.on = 0;
    }
    for (let i = 0; i < SIL_CAP; i++) {
      if (sils[i].life > 0) sils[i].life -= dt;
    }
  }

  function diamondPx(ctx, x, y, r, color) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    ctx.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const span = r - (dy < 0 ? -dy : dy);
      ctx.fillRect(ix - span, iy + dy, span * 2 + 1, 1);
    }
  }

  function emberHalf(zoom) {
    const span = Math.round((7 * zoom) / 3);
    const half = Math.floor(span / 2);
    return half < 2 ? 2 : half;
  }

  function paintEmbers(ctx, zoom) {
    if (!vows) return;
    const lift = heroHalfSprite() * zoom;
    const hx = ctx.canvas.width * 0.5;
    const hy = ctx.canvas.height * 0.5 - lift;
    const rad = ORBIT_SPRITE * zoom;
    const half = emberHalf(zoom);
    const trailR = half > 2 ? half - 1 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < vows; i++) {
      const base = vowAng + (i / vows) * TAU;
      const far = base - 0.84;
      const near = base - 0.42;
      ctx.globalAlpha = 0.28;
      diamondPx(ctx, hx + Math.cos(far) * rad, hy + Math.sin(far) * rad, trailR, '#ffb347');
      ctx.globalAlpha = 0.5;
      diamondPx(ctx, hx + Math.cos(near) * rad, hy + Math.sin(near) * rad, trailR, '#ffb347');
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (let i = 0; i < vows; i++) {
      const a = vowAng + (i / vows) * TAU;
      const x = hx + Math.cos(a) * rad;
      const y = hy + Math.sin(a) * rad;
      diamondPx(ctx, x, y, half + 1, '#0b0a0d');
      diamondPx(ctx, x, y, half, '#ffb347');
      if (zoom >= 2.5) diamondPx(ctx, x, y, 1, '#fff1c9');
      else {
        ctx.fillStyle = '#fff1c9';
        const ix = Math.round(x);
        const iy = Math.round(y);
        ctx.fillRect(ix - 1, iy - 1, 2, 2);
      }
    }
  }

  function paintBlade(ctx, b, zoom, tile, camX, camY, mul, alpha) {
    const img = ensureBlade();
    if (!img || alpha < 0.03) return;
    const sx = b.x * tile + camX;
    const sy = b.y * tile + camY;
    const dw = Math.round(BLADE_W * zoom * mul);
    const dh = Math.round(BLADE_H * zoom * mul);
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy));
    ctx.rotate((b.a || 0) + 1.5707963267948966);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, Math.round(-dw / 2), Math.round(-dh / 2), dw, dh);
    ctx.restore();
  }

  function paint(ctx, cam) {
    const zoom = (cam && ok(cam.zoom) && cam.zoom > 0) ? cam.zoom : 1;
    const tile = framePx() * zoom;
    const camX = cam && ok(cam.x) ? cam.x : 0;
    const camY = cam && ok(cam.y) ? cam.y : 0;
    const viewW = ctx.canvas.width;
    const viewH = ctx.canvas.height;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;

    const img = ensureWhite();
    if (img) {
      for (let i = 0; i < SIL_CAP; i++) {
        const s = sils[i];
        if (s.life <= 0) continue;
        const sc = s.scale > 0 ? s.scale : 1;
        const dw = Math.round(s.sw * zoom * sc);
        const dh = Math.round(s.sh * zoom * sc);
        if (dw < 1 || dh < 1) continue;
        const sx = s.x * tile + camX;
        const sy = s.y * tile + camY;
        const dx = Math.round(sx - dw / 2);
        const dy = Math.round(sy - dh);
        if (s.flip) ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, dx + dw, dy, -dw, dh);
        else ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, dx, dy, dw, dh);
      }
    }

    for (let i = 0; i < CAP; i++) {
      const p = parts[i];
      if (p.life <= 0) continue;
      const sx = Math.round(p.x * tile + camX);
      const sy = Math.round(p.y * tile + camY);
      if (sx < -20 || sy < -20 || sx > viewW + 20 || sy > viewH + 20) continue;
      const a = p.max > 0 ? p.life / p.max : 0;
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#14120f';
      ctx.fillRect(sx - 1, sy - 1, p.w + 2, p.h + 2);
      ctx.fillStyle = toneColor[p.tone] || '#ffffff';
      ctx.fillRect(sx, sy, p.w, p.h);
    }
    ctx.globalAlpha = 1;

    const lift = heroHalfSprite() * zoom;
    const heroX = viewW * 0.5;
    const heroY = viewH * 0.5 - lift;
    for (let i = 0; i < RING_CAP; i++) {
      const r = rings[i];
      if (!r.on) continue;
      const t = r.age - r.delay;
      if (t < 0 || t > r.dur) continue;
      const u = r.dur > 0 ? t / r.dur : 1;
      const radius = r.r0 + (r.r1 - r.r0) * u;
      let px;
      let py;
      let radPx;
      if (r.space === 1) {
        px = heroX;
        py = heroY;
        radPx = radius * zoom;
      } else if (r.space === 2) {
        px = r.x * tile + camX;
        py = r.y * tile + camY - lift;
        radPx = radius * zoom;
      } else {
        px = r.x * tile + camX;
        py = r.y * tile + camY;
        radPx = radius * tile;
      }
      if (!(radPx >= 1.5)) continue;
      ctx.beginPath();
      ctx.arc(px, py, radPx, 0, TAU);
      ctx.strokeStyle = r.tone === 1 ? '#f4efe0' : '#ffffff';
      ctx.lineWidth = r.thick;
      ctx.globalAlpha = 1 - u;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (bladeN) {
      const mul = bladeMul();
      for (let i = 0; i < bladeN; i++) {
        const b = blades[i];
        const ntr = b.samples;
        for (let t = ntr - 1; t >= 0; t--) {
          paintBlade(ctx, b.trail[t], zoom, tile, camX, camY, mul, trailAlpha[t] || 0.1);
        }
        paintBlade(ctx, b, zoom, tile, camX, camY, mul, 1);
      }
    }

    paintEmbers(ctx, zoom);

    if (flashLeft > 0) {
      let a = 0.6 * (flashLeft / FLASH_LIFE);
      if (a > 0.6) a = 0.6;
      if (a > 0.02) {
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, viewW, viewH);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    hit: function (x, y, vis) {
      if (!ok(x) || !ok(y)) return;
      const heavy = !!(vis && (vis.boss || vis.elite));
      if (heavy) spray(x, y, 6, 0.16, 5.6, 5, 5, true);
      else spray(x, y, 4, 0.12, 4.4, 3, 3, true);
      if (heavy && allowSpriteFlash(vis)) spawnSil(x, y, vis);
    },

    death: function (x, y, type, vis) {
      if (!ok(x) || !ok(y)) return;
      spray(x, y, 7, 0.32, 5.2, 4, 3, false);
      spawnSil(x, y, vis);
    },

    cast: function (kind, x, y, info) {
      if (kind === 'nova') {
        if (!ok(x) || !ok(y)) return;
        spawnNova(x, y, info && info.radius);
        return;
      }
      if (kind === 'blade') {
        if (!ok(x) || !ok(y)) return;
        noteBlades(x, y, info);
      }
    },

    pickup: function (x, y) {
      if (!ok(x) || !ok(y)) return;
      spray(x, y, 4, 0.14, 3.4, 2, 2, true);
      addRing({ space: 0, x: x, y: y, r0: 0.06, r1: 0.4, thick: 2, dur: 0.16, tone: 0 });
    },

    levelUp: function () {
      addRing({ space: 1, r0: 8, r1: 22, thick: 2, dur: 0.3, tone: 1 });
    },

    evolve: function (weapon) {
      if (weapon == null || weapon === '') return;
      const id = String(weapon);
      if (id === 'halo' || id === 'nova') halo = 1;
      if (id === 'storm' || id === 'orbit') {
        popKind = 1;
        popOn = 1;
        popT = 0;
      }
      if (reducedNow() || !tryConsumeFlash()) {
        addRing({ space: 1, r0: 12, r1: 28, thick: 2, dur: 0.24, tone: 0 });
        return;
      }
      flashLeft = FLASH_LIFE;
    },

    vow: function (stackCount) {
      let n = stackCount | 0;
      if (n < 0) n = 0;
      if (n > VOW_CAP) n = VOW_CAP;
      vows = n;
    },

    secondChance: function (x, y) {
      if (!ok(x) || !ok(y)) return;
      addRing({ space: 2, x: x, y: y, r0: 30, r1: 5, thick: 2, dur: 0.4, tone: 1 });
      addRing({ space: 2, x: x, y: y, r0: 22, r1: 3, thick: 2, dur: 0.4, delay: 0.03, tone: 0 });
      if (!reducedNow()) spray(x, bodyY(y), 8, 0.28, 6.2, 4, 3, true);
    },

    update: function (dt) {
      step(dt);
      stepped = true;
      ensureWhite();
    },

    draw: function (ctx, cam) {
      if (!ctx || !ctx.canvas) return;
      if (!stepped) step(1 / 60);
      stepped = false;
      paint(ctx, cam || {});
    },
  };
})();
