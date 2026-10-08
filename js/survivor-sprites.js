/**
 * Top-down placeholders for survivor mode.
 * Drop a 16–32px sheet in later with SurvivorSprites.useSheet(image, atlas).
 * No art is bundled. Clips are idle, walk, and death. Frames are indexes on the sheet.
 *
 * atlas example:
 * {
 *   frame: 32, cols: 8,
 *   hero: { idle: [0], walk: [1, 2, 3], death: [4] },
 *   skel: { idle: [8], walk: [9, 10], death: [11] }
 * }
 */
const SurvivorSprites = (() => {
  const FRAME = 32;
  let sheet = null;
  let atlas = null;

  function useSheet(image, map) {
    sheet = image || null;
    atlas = map || null;
  }

  function drawSheet(ctx, kind, clip, time, x, y, size) {
    if (!sheet || !atlas || !atlas[kind] || !atlas[kind][clip]) return false;
    const frames = atlas[kind][clip];
    if (!frames.length) return false;
    const frame = atlas.frame || FRAME;
    const cols = atlas.cols || 8;
    const idx = frames[Math.floor((time || 0) * 8) % frames.length];
    const col = idx % cols;
    const row = (idx / cols) | 0;
    ctx.drawImage(sheet, col * frame, row * frame, frame, frame, x - size / 2, y - size / 2, size, size);
    return true;
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

  function drawHeroRing(ctx, x, y) {
    ring(ctx, x, y, 20, '#ffe08a', 'rgba(255, 214, 120, 0.28)');
  }

  function drawHero(ctx, x, y, o) {
    const clip = o.dying ? 'death' : o.moving ? 'walk' : 'idle';
    if (drawSheet(ctx, 'hero', clip, o.time, x, y, 36)) return;
    const flash = o.flash;
    const bob = o.moving ? Math.sin((o.time || 0) * 10) * 1.5 : 0;
    const face = flash ? '#ffffff' : (o.skin || '#f0d2a8');
    const body = flash ? '#ffffff' : (o.cape || '#6a5344');
    const trim = flash ? '#ffffff' : (o.armor || '#e6ebf2');
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y + bob, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#140e0c';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y + bob, 11, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffe08a';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 3 + bob, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();
    ctx.fillStyle = trim;
    ctx.fillRect(x - 3, y + 1 + bob, 6, 5);
    const dir = o.facing < 0 ? -1 : 1;
    ctx.strokeStyle = flash ? '#ffffff' : (o.weapon || '#f0d080');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + dir * 6, y + bob);
    ctx.lineTo(x + dir * 16, y - 8 + bob);
    ctx.stroke();
  }

  function drawFoe(ctx, x, y, o) {
    const dying = o.dying > 0;
    const fade = dying ? Math.max(0, o.dying / 0.22) : 1;
    const pop = dying ? 1 + (1 - fade) * 0.5 : 1;
    const clip = dying ? 'death' : 'walk';
    const r = (o.boss ? 16 : o.eid === 'brute' ? 13 : o.eid === 'imp' ? 9 : 10) * (o.scale || 1) * pop;
    if (drawSheet(ctx, o.eid || 'skel', clip, o.time, x, y, r * 2.4)) return;
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = o.flash ? '#ffffff' : (o.color || '#9aa');
    ctx.fill();
    if (!o.crowd) {
      ctx.lineWidth = o.boss ? 3 : 2;
      ctx.strokeStyle = '#140e0c';
      ctx.stroke();
    }
    if (!o.crowd && o.eid === 'imp' && !o.flash) {
      ctx.fillStyle = '#3a100c';
      ctx.fillRect(x - r, y - r - 2, 3, 5);
      ctx.fillRect(x + r - 3, y - r - 2, 3, 5);
    }
    if (dying && fade > 0.35) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + (1 - fade) * 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawGem(ctx, x, y) {
    ctx.fillStyle = 'rgba(255, 236, 70, 0.45)';
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fillStyle = '#f6ff4a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1a1208';
    ctx.stroke();
  }

  function drawHermit(ctx, x, y, time) {
    if (drawSheet(ctx, 'hermit', 'idle', time, x, y, 32)) return;
    const bob = Math.sin((time || 0) * 2) * 1;
    ring(ctx, x, y + 8, 14, '#e0c080', 'rgba(90, 60, 40, 0.35)');
    ctx.beginPath();
    ctx.arc(x, y - 2 + bob, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#140e0c';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - 2 + bob, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#6a5344';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - 6 + bob, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#f0d2a8';
    ctx.fill();
  }

  return { FRAME, useSheet, drawHeroRing, drawHero, drawFoe, drawGem, drawHermit };
})();
