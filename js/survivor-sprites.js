/**
 * Survivor sprites. 0x72's 16px sheet, drawn from one atlas at an integer zoom.
 * Idle and run are four frames. Attack is a lunge. Death is the hit-flash and fade.
 * Drop-in sheets still work through useSheet, but the packed atlas is what the game draws.
 */
const SurvivorSprites = (() => {
  const FRAME = 16;
  const CREAM = '#f4efe0';
  let zoom = 3;
  let ready = false;
  let atlas = null;
  let scaled = null;
  let floorPattern = null;
  let floorPatternZoom = 0;
  let floorPatternVow = 0;
  let floorVow = 0;
  const FLOOR_CHUNK = 16;
  let scratch = null;
  let decalScratch = null;
  const clips = {};

  function clamp(n) { return n < 0 ? 0 : n > 255 ? 255 : n | 0; }

  function isRobe(r, g, b) {
    return b > 90 && b > r + 15 && r < 170;
  }

  function ember(r, g, b) {
    const l = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
    return [clamp(110 + l * 150), clamp(32 + l * 140), clamp(12 + l * 40)];
  }

  function isWarm(r, g, b) {
    return r > 80 && r > g + 15 && r > b;
  }

  function violet(r, g, b) {
    const l = (r + g + b) / 3 / 255;
    return [clamp(50 + l * 160), clamp(20 + l * 130), clamp(90 + l * 265)];
  }

  function skelInk(r, g, b) {
    if (r < 70 && g < 70 && b < 70) return [18, 16, 14];
    const l = (r + g + b) / 3;
    const t = Math.min(1, Math.max(0, (l - 90) / 170));
    const g0 = 78 + t * 42;
    return [clamp(g0 * 1.04), clamp(g0), clamp(g0 * 0.94)];
  }

  function mossInk(r, g, b) {
    if (r < 40 && g < 40 && b < 40) return [16, 18, 14];
    const l = (r + g + b) / 3;
    return [clamp(l * 0.52), clamp(l * 0.74), clamp(l * 0.46)];
  }

  function duskInk(r, g, b) {
    if (r < 40 && g < 40 && b < 40) return [18, 14, 22];
    const l = (r + g + b) / 3 / 255;
    return [clamp(78 + l * 70), clamp(58 + l * 55), clamp(96 + l * 70)];
  }

  function ogreInk(r, g, b) {
    if (r < 48 && g < 48 && b < 48) return null;
    if (isWarm(r, g, b)) {
      const l = Math.min(255, (r + g + b) / 3 + 48);
      return [clamp(l * 0.62), clamp(l * 0.84), clamp(l * 0.74)];
    }
    const l = (r + g + b) / 3;
    if (l < 120) {
      return [clamp(r + 22), clamp(g + 36), clamp(b + 28)];
    }
    return null;
  }

  function rects(x, y, w, h, n, step) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: x + i * (step || w), y, w, h });
    return out;
  }

  const LAYOUT = {
    hero: {
      mode: 'hero',
      idle: rects(128, 164, 16, 28, 4),
      run: rects(192, 164, 16, 28, 4),
    },
    imp: {
      mode: 'imp',
      idle: rects(368, 64, 16, 16, 4),
      run: rects(432, 64, 16, 16, 4),
    },
    skel: {
      mode: 'skel',
      idle: rects(368, 88, 16, 16, 4),
      run: rects(432, 88, 16, 16, 4),
    },
    brute: {
      mode: 'ogre',
      idle: rects(16, 380, 32, 36, 4, 32),
      run: rects(144, 380, 32, 36, 4, 32),
    },
    boss: {
      mode: 'copy',
      idle: rects(16, 428, 32, 36, 4, 32),
      run: rects(144, 428, 32, 36, 4, 32),
    },
    hermit: {
      mode: 'copy',
      idle: rects(368, 225, 16, 23, 4),
      run: rects(368, 225, 16, 23, 4),
    },
    charger: {
      mode: 'moss',
      idle: rects(368, 112, 16, 16, 4),
      run: rects(432, 112, 16, 16, 4),
    },
    shooter: {
      mode: 'dusk',
      idle: rects(368, 176, 16, 16, 4),
      run: rects(432, 176, 16, 16, 4),
    },
    warden: {
      mode: 'moss',
      idle: rects(16, 380, 32, 36, 4, 32),
      run: rects(144, 380, 32, 36, 4, 32),
    },
  };

  function paintSheetFrame(img, rect, mode) {
    const pad = (mode === 'hero' || mode === 'skel') ? 1 : 0;
    const w = rect.w + pad * 2;
    const h = rect.h + pad * 2;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, rect.x, rect.y, rect.w, rect.h, pad, pad, rect.w, rect.h);
    const im = g.getImageData(0, 0, w, h);
    const d = im.data;
    const srcA = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) srcA[i] = d[i * 4 + 3];
    for (let i = 0; i < w * h; i++) {
      if (srcA[i] < 16) continue;
      const o = i * 4;
      const r = d[o];
      const gc = d[o + 1];
      const b = d[o + 2];
      let next = null;
      if (mode === 'hero' && isRobe(r, gc, b)) next = ember(r, gc, b);
      else if (mode === 'imp' && isWarm(r, gc, b)) next = violet(r, gc, b);
      else if (mode === 'ogre') next = ogreInk(r, gc, b);
      else if (mode === 'moss') next = mossInk(r, gc, b);
      else if (mode === 'dusk') next = duskInk(r, gc, b);
      else if (mode === 'skel') next = skelInk(r, gc, b);
      if (next) {
        d[o] = next[0];
        d[o + 1] = next[1];
        d[o + 2] = next[2];
      }
    }
    if (mode === 'hero') {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (srcA[p] > 16) continue;
          const touch = (x > 0 && srcA[p - 1] > 16)
            || (x + 1 < w && srcA[p + 1] > 16)
            || (y > 0 && srcA[p - w] > 16)
            || (y + 1 < h && srcA[p + w] > 16);
          if (!touch) continue;
          const o = p * 4;
          d[o] = 0xf4;
          d[o + 1] = 0xef;
          d[o + 2] = 0xe0;
          d[o + 3] = 255;
        }
      }
    }
    if (mode === 'skel') {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (srcA[p] > 16) continue;
          const touch = (x > 0 && srcA[p - 1] > 16)
            || (x + 1 < w && srcA[p + 1] > 16)
            || (y > 0 && srcA[p - w] > 16)
            || (y + 1 < h && srcA[p + w] > 16);
          if (!touch) continue;
          const o = p * 4;
          d[o] = 14;
          d[o + 1] = 12;
          d[o + 2] = 10;
          d[o + 3] = 255;
        }
      }
    }
    g.putImageData(im, 0, 0);
    return { canvas: c, w, h, pad };
  }

  function paintGem() {
    const w = 10;
    const h = 10;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const ink = g.getImageData(0, 0, w, h);
    const d = ink.data;
    const px = (x, y, hex) => {
      const o = (y * w + x) * 4;
      d[o] = parseInt(hex.slice(1, 3), 16);
      d[o + 1] = parseInt(hex.slice(3, 5), 16);
      d[o + 2] = parseInt(hex.slice(5, 7), 16);
      d[o + 3] = 255;
    };
    const gem = [
      '..XXXX....',
      '.XCCCCX...',
      'XCCWWCCX..',
      'XCWWCCCCX.',
      'XCCCCCCCX.',
      '.XCCCCCX..',
      '..XXXXX...',
      '...XXX....',
    ];
    for (let y = 0; y < gem.length; y++) {
      for (let x = 0; x < gem[y].length; x++) {
        const ch = gem[y][x];
        if (ch === 'X') px(x, y, '#102028');
        else if (ch === 'C') px(x, y, '#5fd8ff');
        else if (ch === 'W') px(x, y, '#e7f8ff');
      }
    }
    g.putImageData(ink, 0, 0);
    return { canvas: c, w, h, pad: 0 };
  }

  function paintBolt() {
    const w = 14;
    const h = 7;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#14180c';
    g.fillRect(0, 0, 14, 7);
    g.fillStyle = '#e8ff6a';
    g.fillRect(1, 1, 12, 5);
    g.fillStyle = '#f6ffc4';
    g.fillRect(2, 2, 6, 1);
    return { canvas: c, w, h, pad: 0 };
  }

  function paintEmber() {
    const c = document.createElement('canvas');
    c.width = 5;
    c.height = 5;
    const g = c.getContext('2d');
    g.fillStyle = '#e07a28';
    g.fillRect(1, 0, 3, 5);
    g.fillRect(0, 1, 5, 3);
    g.fillStyle = '#ffb15a';
    g.fillRect(2, 1, 2, 3);
    g.fillStyle = '#fff1c0';
    g.fillRect(2, 2, 1, 1);
    return { canvas: c, w: 5, h: 5, pad: 0 };
  }

  function pack(list) {
    const gap = 1;
    let x = 0;
    let y = 0;
    let rowH = 0;
    const maxW = 512;
    const placed = [];
    list.forEach((item) => {
      if (x + item.w + gap > maxW) {
        x = 0;
        y += rowH + gap;
        rowH = 0;
      }
      placed.push({ item, x, y });
      rowH = Math.max(rowH, item.h);
      x += item.w + gap;
    });
    const atlasH = y + rowH + gap;
    const canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = Math.max(1, atlasH);
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    placed.forEach((p) => {
      g.drawImage(p.item.canvas, p.x, p.y);
      const key = p.item.key;
      if (!clips[key]) clips[key] = [];
      clips[key].push({ x: p.x, y: p.y, w: p.item.w, h: p.item.h, pad: p.item.pad || 0 });
    });
    return canvas;
  }

  function rebuildScaled() {
    if (!atlas) return;
    const c = document.createElement('canvas');
    c.width = atlas.width * zoom;
    c.height = atlas.height * zoom;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(atlas, 0, 0, c.width, c.height);
    scaled = c;
    floorPattern = null;
    floorPatternZoom = 0;
  }

  function build(img) {
    Object.keys(clips).forEach((k) => delete clips[k]);
    const list = [];
    Object.keys(LAYOUT).forEach((id) => {
      const spec = LAYOUT[id];
      ['idle', 'run'].forEach((clip) => {
        spec[clip].forEach((rect) => {
          const painted = paintSheetFrame(img, rect, spec.mode);
          painted.key = id + ':' + clip;
          list.push(painted);
        });
      });
    });
    const floors = [
      { key: 'floor1', x: 16, y: 64 },
      { key: 'floor2', x: 32, y: 64 },
      { key: 'floor4', x: 16, y: 80 },
      { key: 'skull', x: 288, y: 432 },
    ];
    floors.forEach((f) => {
      const painted = paintSheetFrame(img, { x: f.x, y: f.y, w: 16, h: 16 }, 'copy');
      painted.key = f.key;
      list.push(painted);
    });
    const gem = paintGem();
    gem.key = 'gem';
    list.push(gem);
    const bolt = paintBolt();
    bolt.key = 'bolt';
    list.push(bolt);
    const mote = paintEmber();
    mote.key = 'ember';
    list.push(mote);
    atlas = pack(list);
    ready = true;
    rebuildScaled();
  }

  function load(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        build(img);
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  function setZoom(z) {
    const next = Math.max(1, z | 0);
    if (next === zoom && scaled) return;
    zoom = next;
    if (atlas) rebuildScaled();
  }

  function frameAt(key, time) {
    const list = clips[key];
    if (!list || !list.length) return null;
    const i = Math.floor((time || 0) * 8) % list.length;
    return list[i];
  }

  const clipKeys = {};
  function frameNamed(id, clip, time) {
    let row = clipKeys[id];
    if (!row) {
      row = {};
      clipKeys[id] = row;
    }
    let key = row[clip];
    if (!key) {
      key = id + ':' + clip;
      row[clip] = key;
    }
    return frameAt(key, time);
  }

  const rectScratch = { sx: 0, sy: 0, sw: 0, sh: 0 };

  function blit(ctx, fr, dx, dy, flip, flash, alpha, scale) {
    if (!fr || !scaled) return;
    const k = scale || 1;
    const sw = fr.w * zoom;
    const sh = fr.h * zoom;
    const dw = Math.max(1, Math.round(sw * k));
    const dh = Math.max(1, Math.round(sh * k));
    const sx = fr.x * zoom;
    const sy = fr.y * zoom;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (flash) {
      if (!scratch) scratch = document.createElement('canvas');
      if (scratch.width < dw || scratch.height < dh) {
        scratch.width = Math.max(scratch.width, dw);
        scratch.height = Math.max(scratch.height, dh);
      }
      const s = scratch.getContext('2d');
      s.imageSmoothingEnabled = false;
      s.clearRect(0, 0, dw, dh);
      s.globalCompositeOperation = 'source-over';
      if (flip) s.drawImage(scaled, sx, sy, sw, sh, dw, 0, -dw, dh);
      else s.drawImage(scaled, sx, sy, sw, sh, 0, 0, dw, dh);
      s.globalCompositeOperation = 'source-atop';
      s.fillStyle = '#ffffff';
      s.fillRect(0, 0, dw, dh);
      s.globalCompositeOperation = 'source-over';
      ctx.drawImage(scratch, 0, 0, dw, dh, dx, dy, dw, dh);
    } else if (flip) {
      ctx.drawImage(scaled, sx, sy, sw, sh, dx + dw, dy, -dw, dh);
    } else {
      ctx.drawImage(scaled, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    ctx.globalAlpha = 1;
  }

  let ringGlow = null;
  let ringGlowZoom = 0;

  function drawHeroRing(ctx, x, y) {
    const body = y - 10 * zoom;
    const halo = 22 * zoom;
    if (!ringGlow || ringGlowZoom !== zoom) {
      ringGlowZoom = zoom;
      ringGlow = ctx.createRadialGradient(0, 0, 3 * zoom, 0, 0, halo);
      ringGlow.addColorStop(0, 'rgba(6, 4, 6, 0.88)');
      ringGlow.addColorStop(0.38, 'rgba(6, 4, 6, 0.55)');
      ringGlow.addColorStop(1, 'rgba(6, 4, 6, 0)');
    }
    ctx.save();
    ctx.translate(x, body);
    ctx.fillStyle = ringGlow;
    ctx.beginPath();
    ctx.arc(0, 0, halo, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y - zoom, 12 * zoom, 0, Math.PI * 2);
    ctx.lineWidth = zoom * 3;
    ctx.strokeStyle = CREAM;
    ctx.stroke();
  }

  function drawHero(ctx, x, y, o) {
    if (!ready) return drawHeroFallback(ctx, x, y, o);
    const clip = o.moving ? 'run' : 'idle';
    const fr = frameNamed('hero', clip, o.time);
    if (!fr) return;
    const lunge = Math.max(0, Math.min(1, (o.lunge || 0) / 0.16));
    const face = o.facing < 0 ? -1 : 1;
    const foot = (fr.h - (fr.pad || 0)) * zoom;
    const dx = Math.round(x - (fr.w * zoom) / 2 + face * Math.round(lunge * 3 * zoom));
    const dy = Math.round(y - foot + (lunge ? zoom : 0));
    drawEmber(ctx, x, y, o.time || 0, face, o.moving);
    blit(ctx, fr, dx, dy, face > 0, o.flash, 1);
  }

  function drawEmber(ctx, x, y, time, face, moving) {
    const fr = frameAt('ember', 0);
    if (!fr) return;
    const n = moving ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const back = -face * (5 + i * 4) * zoom;
      const bob = Math.round(Math.sin(time * 9 + i * 1.7) * zoom);
      const rise = Math.round((-6 - (moving ? i * 2 : i * 5)) * zoom + bob);
      const dx = Math.round(x + back - (fr.w * zoom) / 2);
      const dy = Math.round(y + rise);
      blit(ctx, fr, dx, dy, false, false, moving ? 0.9 : 0.55);
    }
  }

  function drawFoe(ctx, x, y, o) {
    if (!ready) return drawFoeFallback(ctx, x, y, o);
    const id = o.sprite || (o.boss ? 'boss' : (o.eid === 'brute' ? 'brute' : o.eid === 'imp' ? 'imp' : o.eid === 'charger' ? 'charger' : o.eid === 'shooter' ? 'shooter' : 'skel'));
    const dying = o.dying > 0;
    const clip = dying ? 'idle' : 'run';
    const fr = frameNamed(id, clip, o.time || 0);
    if (!fr) return;
    const fade = dying ? Math.max(0, o.dying / 0.22) : 1;
    const grow = dying ? Math.round((1 - fade) * zoom) : 0;
    const scale = o.scale == null ? 1 : o.scale;
    const foot = (fr.h - (fr.pad || 0)) * zoom * scale;
    const dw = Math.max(1, Math.round(fr.w * zoom * scale)) + grow;
    const dh = Math.max(1, Math.round(fr.h * zoom * scale)) + grow;
    const dx = Math.round(x - dw / 2);
    const dy = Math.round(y - foot - grow);
    const faceRight = (o.facing || 1) > 0;
    if (grow) {
      ctx.imageSmoothingEnabled = false;
      const sw = fr.w * zoom;
      const sh = fr.h * zoom;
      ctx.globalAlpha = fade;
      const sx = fr.x * zoom;
      const sy = fr.y * zoom;
      if (faceRight) ctx.drawImage(scaled, sx, sy, sw, sh, dx + dw, dy, -dw, dh);
      else ctx.drawImage(scaled, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
      return;
    }
    blit(ctx, fr, dx, dy, faceRight, o.flash, fade, scale);
  }

  function drawGem(ctx, x, y, scale) {
    const k = scale || 1;
    if (!ready) return drawGemFallback(ctx, x, y, k);
    const fr = frameAt('gem', 0);
    if (!fr) return;
    blit(ctx, fr, Math.round(x - (fr.w * zoom * k) / 2), Math.round(y - (fr.h * zoom * k) / 2), false, false, 1, k);
  }

  function drawBolt(ctx, x, y, angle) {
    if (!ready) return drawBoltFallback(ctx, x, y, angle);
    const fr = frameAt('bolt', 0);
    if (!fr) return;
    const sw = fr.w * zoom;
    const sh = fr.h * zoom;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle || 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scaled, fr.x * zoom, fr.y * zoom, sw, sh, Math.round(-sw / 2), Math.round(-sh / 2), sw, sh);
    ctx.restore();
  }

  function drawHermit(ctx, x, y, time) {
    if (!ready) return;
    const fr = frameAt('hermit:idle', time || 0);
    if (!fr) return;
    const foot = fr.h * zoom;
    blit(ctx, fr, Math.round(x - (fr.w * zoom) / 2), Math.round(y - foot), false, false, 1);
  }

  function tileHash(tx, ty) {
    return ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
  }

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function setFloorVow(count) {
    const next = Math.max(0, Math.min(3, count | 0));
    if (next === floorVow) return;
    floorVow = next;
    floorPattern = null;
  }

  function stampDecal(g, fr, dx, dy, px) {
    if (!decalScratch) decalScratch = document.createElement('canvas');
    if (decalScratch.width < px || decalScratch.height < px) {
      decalScratch.width = Math.max(decalScratch.width, px);
      decalScratch.height = Math.max(decalScratch.height, px);
    }
    const s = decalScratch.getContext('2d');
    s.imageSmoothingEnabled = false;
    s.clearRect(0, 0, px, px);
    s.drawImage(scaled, fr.x * zoom, fr.y * zoom, fr.w * zoom, fr.h * zoom, 0, 0, px, px);
    const img = s.getImageData(0, 0, px, px);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const dull = 54 + (lum - 128) * 0.1;
      data[i] = clamp(dull * 1.02);
      data[i + 1] = clamp(dull * 0.86);
      data[i + 2] = clamp(dull * 0.8);
      data[i + 3] = Math.round(data[i + 3] * 0.42);
    }
    s.putImageData(img, 0, 0);
    g.drawImage(decalScratch, 0, 0, px, px, dx, dy, px, px);
  }

  function tintFloor(g, canvas) {
    // Vow 4 and 5 stay on the vow-3 tint (floorVow is clamped). Shift each
    // pixel toward moonlit blue but keep its brightness offset, so grout,
    // tiles and decals do not collapse into one flat colour.
    if (floorVow <= 0) return;
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;
    const t = floorVow / 3;
    const dark = 1 - 0.28 * t;
    const rMix = (1 - 0.55 * t) * dark;
    const gMix = (1 - 0.22 * t) * dark;
    const bMix = (1 + 0.18 * t) * dark;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      const r = data[i];
      const gv = data[i + 1];
      const b = data[i + 2];
      const lum = (r + gv + b) / 3;
      data[i] = clamp(lum * rMix + (r - lum));
      data[i + 1] = clamp(lum * gMix + (gv - lum));
      data[i + 2] = clamp(lum * bMix + (b - lum));
    }
    g.putImageData(img, 0, 0);
  }

  function ensureFloorPattern() {
    if (floorPattern && floorPatternZoom === zoom && floorPatternVow === floorVow) return floorPattern;
    const px = FRAME * zoom;
    const c = document.createElement('canvas');
    c.width = FLOOR_CHUNK * px;
    c.height = FLOOR_CHUNK * px;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let ty = 0; ty < FLOOR_CHUNK; ty++) {
      for (let tx = 0; tx < FLOOR_CHUNK; tx++) {
        const h = tileHash(tx, ty);
        const name = h % 9 === 0 ? 'floor4' : h % 5 === 0 ? 'floor2' : 'floor1';
        const fr = frameAt(name, 0);
        if (!fr) continue;
        const dx = tx * px;
        const dy = ty * px;
        g.drawImage(scaled, fr.x * zoom, fr.y * zoom, fr.w * zoom, fr.h * zoom, dx, dy, px, px);
        // About a third of the old skull/bone stamps, and those that remain
        // sit close to the floor colour so they don't read as skeletons.
        if (h % 111 === 0) {
          const skull = frameAt('skull', 0);
          if (skull) stampDecal(g, skull, dx, dy, px);
        }
      }
    }
    tintFloor(g, c);
    floorPattern = c;
    floorPatternZoom = zoom;
    floorPatternVow = floorVow;
    return c;
  }

  function drawGround(ctx, camX, camY, viewW, viewH) {
    if (!ready || !scaled) return;
    const pat = ensureFloorPattern();
    const px = FRAME * zoom;
    const chunk = FLOOR_CHUNK * px;
    const left = Math.floor(-camX / px);
    const top = Math.floor(-camY / px);
    let x = (left - mod(left, FLOOR_CHUNK)) * px + camX;
    const y0 = (top - mod(top, FLOOR_CHUNK)) * px + camY;
    const x0 = x;
    for (let y = y0; y < viewH; y += chunk) {
      for (x = x0; x < viewW; x += chunk) {
        ctx.drawImage(pat, Math.round(x), Math.round(y));
      }
    }
  }

  function ring(ctx, x, y, radius, stroke, fill) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  function drawHeroFallback(ctx, x, y) {
    ring(ctx, x, y, 20, CREAM, 'rgba(244, 239, 224, 0.28)');
    ctx.beginPath();
    ctx.arc(x, y - 10, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#e07a28';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = CREAM;
    ctx.stroke();
  }

  function drawFoeFallback(ctx, x, y, o) {
    const r = o.boss ? 16 : o.eid === 'brute' ? 13 : 10;
    ctx.beginPath();
    ctx.arc(x, y - r, r, 0, Math.PI * 2);
    ctx.fillStyle = o.flash ? '#ffffff' : (o.eid === 'imp' || o.eid === 'shooter' ? '#7b4fd4' : o.boss ? '#da4e38' : o.eid === 'charger' ? '#6d8a62' : o.eid === 'brute' ? '#6d8a72' : '#8a847c');
    ctx.fill();
  }

  function drawGemFallback(ctx, x, y, scale) {
    const k = scale || 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 8 * k);
    ctx.lineTo(x + 6 * k, y);
    ctx.lineTo(x, y + 7 * k);
    ctx.lineTo(x - 6 * k, y);
    ctx.closePath();
    ctx.fillStyle = '#5fd8ff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#102028';
    ctx.stroke();
  }

  function drawBoltFallback(ctx, x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.fillStyle = '#14180c';
    ctx.fillRect(-7, -3.5, 14, 7);
    ctx.fillStyle = '#e8ff6a';
    ctx.fillRect(-6, -2.5, 12, 5);
    ctx.restore();
  }

  function useSheet() {}

  function frameRect(id, clip, time) {
    const fr = frameNamed(id, clip, time);
    if (!fr) return null;
    rectScratch.sx = fr.x;
    rectScratch.sy = fr.y;
    rectScratch.sw = fr.w;
    rectScratch.sh = fr.h;
    return rectScratch;
  }

  return {
    FRAME,
    load,
    setZoom,
    ready: () => ready,
    get atlas() { return atlas; },
    frameRect,
    useSheet,
    drawHeroRing,
    drawHero,
    drawFoe,
    drawGem,
    drawBolt,
    drawHermit,
    drawGround,
    setFloorVow,
  };
})();

const Sprites = SurvivorSprites;
