/**
 * Survivor visual effects. Combat stays in the game; this file only draws.
 * Safe to call before the atlas loads: missing args and a missing sprite
 * sheet are ignored.
 *
 * Boss / elite hit silhouettes share one photosensitivity budget with the
 * evolution flash and with boss death silhouettes (at most 3 per second,
 * never closer than 0.34s). Every silhouette, hit or death, draws at most
 * 60% white. Hit silhouettes also wait 0.35s per `id` or `fid` (one global
 * timer when neither is set; fixed 24-slot table). Sparks still spawn on
 * every hit. Death silhouettes are capped at 3 per 0.1s and skipped entirely
 * when reduced motion is on. Shards still play. Gem pickups
 * (`FX.pickup(x, y, 'gem', {chain})`) climb from 4 particles at 2px to
 * 12 particles at 4px at chain 12. FX.kill (FX.death is an alias) uses that
 * same 3-per-0.1s silhouette window at 60% white. Above 20 kills per second
 * the kill is one chunk and no flash. Elite and boss shakes wait 0.5s.
 * A second full-screen evolve within 1s of the last one is a hero ring.
 * The evolve sweep (`FX.EVOLVE_SWEEP_MS`, 400) rides that same clock: every
 * effect advances only by the dt passed to FX.update. FX.sweepRadius() is the
 * front edge in art px, or -1 when no sweep is running.
 * Time moves only in FX.update. FX.reset() clears a run. FX.setReducedMotion
 * overrides the matchMedia check. Second Chance never flashes the screen.
 * FX.telegraph(id, x, y, ms, opts) warns at a cast point. x and y are tile
 * coordinates, the same units as FX.beam, FX.kill, and FX.pickup. Screen position
 * is x * framePx * zoom + cam, matching those calls. Spark size and the default
 * ring stay in art px. A numeric opts.radius, opts.r, or opts.size is a radius
 * in tiles. It uses its own 32-slot table, never the particle pool, and never a
 * white flash. opts.boss enlarges the default ring.
 * FX.shield, FX.shieldHit, and FX.spawn use those same tile coordinates.
 * Shield radius is in tiles. The anchor GD passes is the foe's feet, the
 * same point drawFoe uses. Body radius is r - 0.9, and the boss is drawn
 * at scale body/0.9. The opaque body on that 36px sheet is centred 16
 * source px above the foot row, so the bubble, hit sparks, and break
 * shards rise by body/0.9 tiles. opts.lift, in tiles, overrides that.
 * Line width and pixel snap stay in art px.
 * Its bubble, chevrons, and arrival puffs sit on fixed tables. Only a shield
 * break's shards use the particle pool, and its one white flash shares the
 * 3-per-0.1s death window.
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
  const BEAM_N = 64;
  // Spec heights and widths are CSS px at the desktop zoom constant
  // cssPerArt = 2 (survivor.js resize; the initial zoom). Art px = CSS px / 2:
  // rare 1 x 36, epic 1.5 x 48, legendary 1 x 72 per column. One CSS px is
  // drawn round(zoom / 2) device px wide, which matches a CSS pixel when
  // zoom is cssPerArt * dpr.
  const BEAM_CSS_PER_ART = 2;
  const TEL_N = 32;
  const TEL_DRAW = 24;
  const SH_N = 8;
  const CH_PER = 6;
  const CH_N = SH_N * CH_PER;
  const SP_N = 32;
  const SP_DRAW = 24;
  const BR_N = 8;
  const SPAWN_MS = 220;
  const KILL_N = 32;
  const TINT_N = 16;
  const LEVELUP_RADIUS = 48;
  const EVOLVE_SWEEP_MS = 400;
  const SWEEP_N = 40;
  const ORBIT_SPRITE = 15;
  const FLASH_LIFE = 0.1;
  const TAU = 6.283185307179586;
  const BLADE_W = 35;
  const BLADE_H = 18;

  // A non-integer store first keeps these fields unboxed, so later writes do not allocate.
  const parts = new Array(CAP);
  for (let i = 0; i < CAP; i++) {
    const p = parts[i] = {
      life: 0.5, max: 0.5, x: 0.5, y: 0.5, vx: 0.5, vy: 0.5, w: 2, h: 2, tone: 0, peak: 0.5,
      art: 0, grav: 0, screen: 0, sweep: 0, ang: 0.5,
    };
    p.life = 0;
    p.max = 1;
    p.x = 0;
    p.y = 0;
    p.vx = 0;
    p.vy = 0;
    p.peak = 1;
    p.ang = 0;
  }
  let partCursor = 0;

  const rings = new Array(RING_CAP);
  for (let i = 0; i < RING_CAP; i++) {
    const r = rings[i] = {
      on: 0, age: 0.5, dur: 0.5, delay: 0.5,
      x: 0.5, y: 0.5, r0: 0.5, r1: 0.5, thick: 2, space: 0, tone: 0,
    };
    r.age = 0;
    r.dur = 0.2;
    r.delay = 0;
    r.x = 0;
    r.y = 0;
    r.r0 = 0;
    r.r1 = 0;
  }

  const sils = new Array(SIL_CAP);
  for (let i = 0; i < SIL_CAP; i++) {
    const s = sils[i] = { life: 0.5, x: 0.5, y: 0.5, sx: 0, sy: 0, sw: 0, sh: 0, scale: 0.5, flip: 0, pad: 0, a: 0.5 };
    s.life = 0;
    s.x = 0;
    s.y = 0;
    s.scale = 1;
    s.a = 1;
  }

  const blades = new Array(MAX_B);
  for (let i = 0; i < MAX_B; i++) {
    const trail = new Array(TRAIL);
    for (let t = 0; t < TRAIL; t++) {
      const tr = trail[t] = { x: 0.5, y: 0.5, a: 0.5 };
      tr.x = 0;
      tr.y = 0;
      tr.a = 0;
    }
    const b = blades[i] = {
      x: 0.5, y: 0.5, a: 0.5, holdX: 0.5, holdY: 0.5, holdA: 0.5,
      samples: 0, live: 0, trail: trail,
    };
    b.x = 0;
    b.y = 0;
    b.a = 0;
    b.holdX = 0;
    b.holdY = 0;
    b.holdA = 0;
  }

  const cdKey = new Array(CD_N);
  const cdTime = new Array(CD_N);
  for (let i = 0; i < CD_N; i++) {
    cdKey[i] = null;
    cdTime[i] = -10;
  }

  const flashStamp = [-10, -10, -10];
  const deathSilStamp = [-10, -10, -10];
  const trailAlpha = [0.55, 0.34, 0.2, 0.1];
  const toneColor = [
    '#ffffff', '#c8cdd4', '#9aa3ad', '#5fd8ff', '#8a6cff',
    '#b9b4aa', '#5ed37a', '#4c7cff', '#b48cff', '#f4f2ff',
  ];
  const tints = new Array(TINT_N);
  for (let i = 0; i < TINT_N; i++) tints[i] = '#8a6cff';
  let tintCursor = 0;

  const killStamp = new Array(KILL_N);
  for (let i = 0; i < KILL_N; i++) killStamp[i] = -10;
  let killSlot = 0;

  const beams = new Array(BEAM_N);
  for (let i = 0; i < BEAM_N; i++) {
    const b = beams[i] = { on: 0, id: 0, x: 0.5, y: 0.5, r: 0, age: 0.5 };
    b.x = 0;
    b.y = 0;
    b.age = 0;
  }

  const tels = new Array(TEL_N);
  for (let i = 0; i < TEL_N; i++) {
    const t = tels[i] = { on: 0, id: null, x: 0.5, y: 0.5, age: 0.5, dur: 0.5, boss: 0, rad: 0.5, mark: 0 };
    t.x = 0;
    t.y = 0;
    t.age = 0;
    t.dur = 0.7;
    t.rad = 0;
  }
  let telGen = 0;

  const shields = new Array(SH_N);
  const shEdge = new Array(CH_N);
  for (let i = 0; i < SH_N; i++) {
    const s = shields[i] = { on: 0, id: null, x: 0.5, y: 0.5, r: 0.5, age: 0.5, dur: 0.5, lift: 0.5 };
    s.x = 0;
    s.y = 0;
    s.r = 16;
    s.lift = 0;
    s.age = 0;
    s.dur = 1;
  }
  for (let i = 0; i < CH_N; i++) shEdge[i] = 0;

  const chevs = new Array(CH_N);
  for (let i = 0; i < CH_N; i++) {
    const c = chevs[i] = { on: 0, age: 0.5, x: 0.5, y: 0.5, nx: 0.5, ny: 0.5, px: 0.5, py: 0.5 };
    c.age = 0;
    c.x = 0;
    c.y = 0;
    c.nx = 1;
    c.ny = 0;
    c.px = 0;
    c.py = 1;
  }

  const spawns = new Array(SP_N);
  for (let i = 0; i < SP_N; i++) {
    const s = spawns[i] = { on: 0, x: 0.5, y: 0.5, age: 0.5, mark: 0 };
    s.x = 0;
    s.y = 0;
    s.age = 0;
  }
  let spGen = 0;

  const breaks = new Array(BR_N);
  for (let i = 0; i < BR_N; i++) {
    const b = breaks[i] = { on: 0, x: 0.5, y: 0.5, r: 0.5, age: 0.5, flash: 0 };
    b.x = 0;
    b.y = 0;
    b.r = 0;
    b.age = 0;
  }

  const hexUx = new Array(6);
  const hexUy = new Array(6);
  const hexVX = new Array(6);
  const hexVY = new Array(6);
  for (let i = 0; i < 6; i++) {
    const a = -1.5707963267948966 + (i / 6) * TAU;
    hexUx[i] = Math.cos(a);
    hexUy[i] = Math.sin(a);
    hexVX[i] = 0;
    hexVY[i] = 0;
  }
  let shieldTone = 0;
  let shQx = 0;
  let shQy = 0;

  const shakeOut = { x: 0.5, y: 0.5 };
  shakeOut.x = 0;
  shakeOut.y = 0;
  let shakeAmp = 0.5;
  let shakeLife = 0.5;
  let shakeMax = 0.5;
  shakeAmp = 0;
  shakeLife = 0;
  shakeMax = 1;
  let shakeAt = -10;

  const sweepOut = { x: 0.5, y: 0.5 };
  sweepOut.x = 0;
  sweepOut.y = 0;
  let sweepOn = 0;
  let sweepEnd = 0;
  let sweepAge = 0.5;
  let sweepDur = 0.5;
  let sweepMax = 0.5;
  let sweepX = 0.5;
  let sweepY = 0.5;
  let sweepScreen = 0;
  sweepAge = 0;
  sweepDur = EVOLVE_SWEEP_MS / 1000;
  sweepMax = 0;
  sweepX = 0;
  sweepY = 0;
  let lastW = 0;
  let lastH = 0;
  let lastZoom = 0.5;
  let lastCamX = 0.5;
  let lastCamY = 0.5;
  lastZoom = 0;
  lastCamX = 0;
  lastCamY = 0;

  const GROUND_N = 20;
  const groundX = new Array(GROUND_N);
  const groundY = new Array(GROUND_N);
  (function () {
    let n = 0;
    for (let x = -4; x <= 3; x++) {
      groundX[n] = x;
      groundY[n] = -2;
      n += 1;
      groundX[n] = x;
      groundY[n] = 1;
      n += 1;
    }
    groundX[n] = -5; groundY[n] = -1; n += 1;
    groundX[n] = 4; groundY[n] = -1; n += 1;
    groundX[n] = -5; groundY[n] = 0; n += 1;
    groundX[n] = 4; groundY[n] = 0;
  })();

  let clock = 0;
  let frameTick = 0;
  let underTick = -1;
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
  let evolveFlashAt = -10;
  let deathSilSlot = 0;
  let reduce = false;
  let reduceChecked = -1;
  let reduceOverride = null;
  let reduceQuery = null;
  let reduceQueryRead = false;
  const emptyCam = { x: 0, y: 0, zoom: 0 };
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
    if (!reduceQueryRead) {
      reduceQueryRead = true;
      try {
        const fn = typeof matchMedia === 'function'
          ? matchMedia
          : (typeof window !== 'undefined' ? window.matchMedia : null);
        if (typeof fn === 'function') reduceQuery = fn('(prefers-reduced-motion: reduce)');
      } catch (e) {}
    }
    return !!(reduceQuery && reduceQuery.matches);
  }

  function reducedNow() {
    if (reduceOverride != null) return reduceOverride;
    if (clock - reduceChecked > 0.4) {
      reduceChecked = clock;
      reduce = readReduced();
    }
    return reduce;
  }

  // Hero and skel frames in the atlas include a 1px pad (18×30 and 18×18).
  // The game anchors feet at (h - pad), so the padded frame hangs below y.
  function framePad(fr) {
    if (!fr) return 0;
    if (typeof fr.pad === 'number') return fr.pad > 0 ? fr.pad : 0;
    if (fr.sw === 18 && (fr.sh === 18 || fr.sh === 30)) return 1;
    return 0;
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

  function releasePart(p) {
    p.art = 0;
    p.grav = 0;
    p.screen = 0;
    p.sweep = 0;
  }

  function takePart() {
    for (let n = 0; n < CAP; n++) {
      const i = (partCursor + n) % CAP;
      if (parts[i].sweep) continue;
      if (parts[i].life <= 0) {
        partCursor = (i + 1) % CAP;
        releasePart(parts[i]);
        return parts[i];
      }
    }
    for (let n = 0; n < CAP; n++) {
      const i = (partCursor + n) % CAP;
      if (parts[i].sweep) continue;
      partCursor = (i + 1) % CAP;
      releasePart(parts[i]);
      return parts[i];
    }
    return parts[SWEEP_N];
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

  function spray(x, y, n, life, speed, w, h, whiteOnly, peak, gem) {
    const base = rand() * TAU;
    const bright = peak > 0 ? (peak > 1 ? 1 : peak) : 1;
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
      p.h = gem ? h : ((i % 2 === 0) ? h : Math.max(2, h - 1));
      p.tone = gem ? 3 : (whiteOnly ? 0 : (i % 3));
      p.peak = bright;
      p.art = 0;
      p.grav = 0;
      p.screen = 0;
    }
  }

  function colorTone(color) {
    if (!color || color === '#8a6cff') return 4;
    for (let i = 0; i < TINT_N; i++) {
      if (tints[i] === color) return 20 + i;
    }
    tints[tintCursor] = color;
    const id = 20 + tintCursor;
    tintCursor = (tintCursor + 1) % TINT_N;
    return id;
  }
  shieldTone = colorTone('#9fb4c8');

  function noteKill() {
    killStamp[killSlot] = clock;
    killSlot = (killSlot + 1) % KILL_N;
  }

  function killRate() {
    let n = 0;
    for (let i = 0; i < KILL_N; i++) {
      if (clock - killStamp[i] < 0.5) n += 1;
    }
    return n * 2;
  }

  function spawnChunks(x, y, n, tone) {
    if (n <= 0) return;
    const base = rand() * TAU;
    const stepA = TAU / n;
    for (let i = 0; i < n; i++) {
      const p = takePart();
      const a = base + i * stepA;
      const sp = 1.6 + rand() * 2.4;
      const dur = 0.25 + rand() * 0.1;
      p.life = dur;
      p.max = dur;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 1.4;
      const sz = rand() < 0.45 ? 1 : 2;
      p.w = sz;
      p.h = sz;
      p.tone = tone;
      p.peak = 1;
      p.art = 1;
      p.grav = 8;
      p.screen = 0;
    }
  }

  function spawnStreaks(x, y, screenMode) {
    for (let i = 0; i < 12; i++) {
      const p = takePart();
      const a = (i / 12) * TAU;
      const sp = screenMode ? 88 : 6;
      const dur = 0.18;
      const horiz = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a));
      p.life = dur;
      p.max = dur;
      p.x = screenMode ? 0 : x;
      p.y = screenMode ? 0 : y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.w = horiz ? 3 : 1;
      p.h = horiz ? 1 : 3;
      p.tone = (i & 1) ? 3 : 0;
      p.peak = 1;
      p.art = 1;
      p.grav = 0;
      p.screen = screenMode ? 1 : 0;
    }
  }

  function spawnLoot(x, y, rarity) {
    const n = rarity <= 0 ? 4 : (rarity === 1 ? 5 : 6);
    const life = rarity <= 0 ? 0.01 : 0.15;
    const tone = 5 + (rarity > 4 ? 4 : rarity);
    const base = rand() * TAU;
    for (let i = 0; i < n; i++) {
      const p = takePart();
      const a = base + i * (TAU / n);
      const sp = 1.4 + rand() * 1.8;
      const dur = life * (0.85 + rand() * 0.3);
      p.life = dur;
      p.max = dur;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 0.6;
      p.w = 1;
      p.h = 1;
      p.tone = tone;
      p.peak = 1;
      p.art = 1;
      p.grav = 0;
      p.screen = 0;
    }
  }

  function rarityId(r) {
    if (typeof r === 'number' || r == null) return 0;
    let raw;
    if (typeof r === 'string') raw = r;
    else {
      try { raw = String(r); } catch (e) { return 0; }
    }
    if (typeof raw !== 'string' || !raw) return 0;
    const name = raw.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name === 'uncommon') return 1;
    if (name === 'rare') return 2;
    if (name === 'epic' || name === 'very rare' || name === 'veryrare') return 3;
    if (name === 'legendary') return 4;
    return 0;
  }

  function takeBeam() {
    let oldest = 0;
    let age = -1;
    for (let i = 0; i < BEAM_N; i++) {
      if (!beams[i].on) return beams[i];
      if (beams[i].age > age) {
        age = beams[i].age;
        oldest = i;
      }
    }
    return beams[oldest];
  }

  function beamOn(id, x, y, rarity) {
    if (!ok(x) || !ok(y)) return;
    const r = rarityId(rarity);
    // Common and unknown names draw nothing. Uncommon still draws its green cross.
    if (r <= 0) {
      beamClear(id);
      return;
    }
    let slot = null;
    for (let i = 0; i < BEAM_N; i++) {
      if (beams[i].on && beams[i].id === id) slot = beams[i];
    }
    const fresh = !slot;
    if (!slot) slot = takeBeam();
    slot.on = 1;
    slot.id = id;
    slot.x = x;
    slot.y = y;
    slot.r = r;
    if (fresh) {
      slot.age = 0;
      spawnLoot(x, y, r);
    }
  }

  function beamClear(id) {
    for (let i = 0; i < BEAM_N; i++) {
      if (beams[i].on && beams[i].id === id) beams[i].on = 0;
    }
  }

  function tryShake(amp) {
    if (reducedNow()) return;
    if (clock - shakeAt < 0.5) return;
    shakeAt = clock;
    shakeAmp = amp;
    shakeLife = amp >= 4 ? 0.18 : 0.14;
    shakeMax = shakeLife;
  }

  function readShake() {
    shakeOut.x = 0;
    shakeOut.y = 0;
    if (reducedNow() || shakeLife <= 0 || shakeMax <= 0) return shakeOut;
    const mag = shakeAmp * (shakeLife / shakeMax);
    shakeOut.x = Math.sin(clock * 47) * mag;
    shakeOut.y = Math.cos(clock * 41) * mag * 0.65;
    return shakeOut;
  }

  function doKill(x, y, type, opts) {
    if (!ok(x) || !ok(y)) return;
    noteKill();
    const rate = killRate();
    const elite = !!(opts && opts.elite);
    const boss = !!(opts && opts.boss) || type === 'boss';
    let chunks = 3;
    let flash = true;
    if (rate > 20) {
      chunks = 1;
      flash = false;
    } else if (rate > 10) {
      chunks = 2;
    } else if (boss) {
      chunks = 16;
    } else if (elite) {
      chunks = 8;
    } else {
      chunks = 3 + ((rand() * 3) | 0);
    }
    spawnChunks(x, y, chunks, colorTone(opts && opts.color));
    if (elite || boss) {
      addRing(0, x, y, 0.18, 1.05, 2, 0.26, 0, 0);
      if (boss) addRing(0, x, y, 0.28, 1.45, 2, 0.3, 0.04, 0);
      tryShake(boss ? 4 : 2);
    }
    if (!flash) return;
    if (reducedNow()) {
      if (!elite && !boss) addRing(0, x, y, 0.08, 0.62, 2, 0.2, 0, 0);
      return;
    }
    const fr = opts && opts.frame;
    if (!fr || !(fr.sw > 0) || !(fr.sh > 0)) return;
    if (!deathWindowOpen()) return;
    commitDeathWindow();
    spawnSil(x, y, opts, 0.6, 0.012);
  }

  function addRing(space, x, y, r0, r1, thick, dur, delay, tone) {
    const r = takeRing();
    r.on = 1;
    r.age = 0;
    r.dur = dur > 0 ? dur : 0.2;
    r.delay = delay > 0 ? delay : 0;
    r.x = ok(x) ? x : 0;
    r.y = ok(y) ? y : 0;
    r.r0 = ok(r0) ? r0 : 0;
    r.r1 = ok(r1) ? r1 : 0;
    r.thick = thick > 0 ? thick : 2;
    r.space = space | 0;
    r.tone = tone | 0;
  }

  function spawnSil(x, y, vis, alpha, life) {
    const fr = vis && vis.frame;
    if (!fr || !(fr.sw > 0) || !(fr.sh > 0)) return;
    const s = takeSil();
    s.life = life > 0 ? life : 0.06;
    s.x = x;
    s.y = y;
    s.sx = fr.sx || 0;
    s.sy = fr.sy || 0;
    s.sw = fr.sw;
    s.sh = fr.sh;
    s.scale = vis.scale > 0 ? vis.scale : 1;
    s.flip = vis.flip ? 1 : 0;
    s.pad = framePad(fr);
    let a = alpha > 0 ? alpha : 0.6;
    if (a > 0.6) a = 0.6;
    s.a = a;
  }

  function deathWindowOpen() {
    let within = 0;
    for (let i = 0; i < 3; i++) {
      if (clock - deathSilStamp[i] < 0.1) within += 1;
    }
    return within < 3;
  }

  function commitDeathWindow() {
    deathSilStamp[deathSilSlot] = clock;
    deathSilSlot = (deathSilSlot + 1) % 3;
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
    addRing(0, x, y, 0, radius, halo ? 3 : 2, 0.25, 0, 0);
    if (halo) addRing(0, x, y, 0, radius * 0.8, 2, 0.25, 0.04, 0);
  }

  function bladeMul() {
    if (!(popOn && popKind === 1)) return 1;
    const t = popT / 0.42;
    if (t >= 1) return 1;
    if (t < 0.16) return 1.5 + (t / 0.16) * 0.15;
    return 1.65 + ((t - 0.16) / 0.84) * (1 - 1.65);
  }

  function defaultSweepRadius() {
    const zoom = lastZoom > 0 ? lastZoom : 3;
    const w = lastW > 0 ? lastW : 390;
    const h = lastH > 0 ? lastH : 844;
    const lift = heroHalfSprite() * zoom;
    const hx = w * 0.5;
    const hy = h * 0.5 - lift;
    const dx = hx > (w - hx) ? hx : (w - hx);
    const dy = hy > (h - hy) ? hy : (h - hy);
    return Math.sqrt(dx * dx + dy * dy) / zoom;
  }

  function sweepFront() {
    let u = sweepDur > 0 ? sweepAge / sweepDur : 1;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    const inv = 1 - u;
    return sweepMax * (1 - inv * inv);
  }

  function placeSweepPart(p) {
    const front = sweepFront();
    const c = Math.cos(p.ang);
    const s = Math.sin(p.ang);
    if (p.screen) {
      p.x = c * front;
      p.y = s * front;
    } else {
      const tiles = front / 16;
      p.x = sweepX + c * tiles;
      p.y = sweepY + s * tiles;
    }
  }

  function clearSweepParts() {
    for (let i = 0; i < SWEEP_N; i++) {
      parts[i].life = 0;
      parts[i].sweep = 0;
    }
  }

  function spawnSweepChunks() {
    const dur = EVOLVE_SWEEP_MS / 1000;
    for (let i = 0; i < SWEEP_N; i++) {
      const p = parts[i];
      p.life = dur;
      p.max = dur;
      p.ang = (i / SWEEP_N) * TAU;
      p.w = 2;
      p.h = 2;
      p.tone = (i & 1) ? 3 : 0;
      p.peak = 1;
      p.art = 1;
      p.grav = 0;
      p.screen = sweepScreen;
      p.sweep = 1;
      p.vx = 0;
      p.vy = 0;
      placeSweepPart(p);
    }
  }

  function beginSweep(opts, withChunks) {
    let rad = defaultSweepRadius();
    if (opts && opts.radius > 0) rad = opts.radius;
    sweepOn = 1;
    sweepEnd = 0;
    sweepAge = 0;
    sweepDur = EVOLVE_SWEEP_MS / 1000;
    sweepMax = rad;
    if (opts && ok(opts.x) && ok(opts.y)) {
      sweepX = opts.x;
      sweepY = opts.y;
      sweepScreen = 0;
    } else {
      sweepX = 0;
      sweepY = 0;
      sweepScreen = 1;
    }
    sweepOut.x = sweepX;
    sweepOut.y = sweepY;
    if (withChunks) spawnSweepChunks();
    else clearSweepParts();
  }

  function readSweepRadius() {
    if (!sweepOn) return -1;
    return sweepFront();
  }

  function telCell(zoom) {
    const cell = zoom >= 1 ? Math.round(zoom) : 1;
    return cell > 0 ? cell : 1;
  }

  function telPlot(ctx, sx, sy, ix, iy, rad, zoom, cell, half, color, mark) {
    ctx.fillStyle = (mark && iy === 0 && (ix === rad || ix === -rad)) ? '#ffffff' : color;
    ctx.fillRect(Math.round(sx + ix * zoom) - half, Math.round(sy + iy * zoom) - half, cell, cell);
  }

  function telOct(ctx, sx, sy, x, y, rad, zoom, cell, half, color, mark) {
    telPlot(ctx, sx, sy, x, y, rad, zoom, cell, half, color, mark);
    if (x) telPlot(ctx, sx, sy, -x, y, rad, zoom, cell, half, color, mark);
    if (y) telPlot(ctx, sx, sy, x, -y, rad, zoom, cell, half, color, mark);
    if (x && y) telPlot(ctx, sx, sy, -x, -y, rad, zoom, cell, half, color, mark);
    if (x !== y) {
      telPlot(ctx, sx, sy, y, x, rad, zoom, cell, half, color, mark);
      if (y) telPlot(ctx, sx, sy, -y, x, rad, zoom, cell, half, color, mark);
      if (x) telPlot(ctx, sx, sy, y, -x, rad, zoom, cell, half, color, mark);
      if (x && y) telPlot(ctx, sx, sy, -y, -x, rad, zoom, cell, half, color, mark);
    }
  }

  // 1 art-px lilac ring on the pixel grid. mark draws the left and right pixels white.
  function paintPixelRing(ctx, sx, sy, radArt, zoom, color, mark) {
    const cell = telCell(zoom);
    const half = cell >> 1;
    const r = radArt | 0;
    let x = 0;
    let y = r;
    let d = 1 - r;
    while (x <= y) {
      telOct(ctx, sx, sy, x, y, r, zoom, cell, half, color, mark);
      x += 1;
      if (d < 0) d += 2 * x + 1;
      else {
        y -= 1;
        d += 2 * (x - y) + 1;
      }
    }
  }

  function tileSpan(zoom) {
    const z = zoom > 0 ? zoom : 1;
    return framePx() * z;
  }

  function paintTelegraph(ctx, t, zoom, camX, camY, calm) {
    const span = tileSpan(zoom);
    const sx = t.x * span + camX;
    const sy = t.y * span + camY;
    ctx.globalAlpha = 1;
    if (calm) {
      paintPixelRing(ctx, sx, sy, t.boss ? 7 : 4, zoom, '#c9a8ff', 1);
      return;
    }
    let u = t.dur > 0 ? t.age / t.dur : 1;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    const eased = u * u;
    let r0 = t.boss ? 18 : 10;
    if (t.rad > 0) r0 = t.rad * framePx();
    const rad = r0 + (2 - r0) * eased;
    const n = t.boss ? 14 : 8;
    const cell = telCell(zoom);
    const s = (t.boss ? 2 : 1) * cell;
    const half = s >> 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - 1.5707963267948966;
      const px = Math.round(sx + Math.cos(a) * rad * zoom) - half;
      const py = Math.round(sy + Math.sin(a) * rad * zoom) - half;
      ctx.fillStyle = (i & 1) ? '#c9a8ff' : '#ffffff';
      ctx.fillRect(px, py, s, s);
    }
    if (t.dur - t.age <= 0.08) paintPixelRing(ctx, sx, sy, 3, zoom, '#c9a8ff', 0);
  }

  function paintTels(ctx, zoom, camX, camY, viewW, viewH, calm) {
    telGen += 1;
    if (telGen > 1000000000) {
      telGen = 1;
      for (let i = 0; i < TEL_N; i++) tels[i].mark = 0;
    }
    let active = 0;
    for (let i = 0; i < TEL_N; i++) if (tels[i].on) active += 1;
    const limit = active > TEL_DRAW ? TEL_DRAW : active;
    const hx = viewW * 0.5;
    const hy = viewH * 0.5;
    for (let n = 0; n < limit; n++) {
      let best = -1;
      let bestD = 0;
      for (let i = 0; i < TEL_N; i++) {
        const t = tels[i];
        if (!t.on || t.mark === telGen) continue;
        const span = tileSpan(zoom);
        const dx = t.x * span + camX - hx;
        const dy = t.y * span + camY - hy;
        const d = dx * dx + dy * dy;
        if (best < 0 || d < bestD) {
          best = i;
          bestD = d;
        }
      }
      if (best < 0) break;
      tels[best].mark = telGen;
      paintTelegraph(ctx, tels[best], zoom, camX, camY, calm);
    }
  }

  function telFarSlot() {
    const zoom = lastZoom > 0 ? lastZoom : 3;
    const w = lastW > 0 ? lastW : 390;
    const h = lastH > 0 ? lastH : 844;
    const hx = w * 0.5;
    const hy = h * 0.5;
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < TEL_N; i++) {
      const t = tels[i];
      const span = tileSpan(zoom);
      const dx = t.x * span + lastCamX - hx;
      const dy = t.y * span + lastCamY - hy;
      const d = dx * dx + dy * dy;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    return tels[best];
  }

  function telegraphOn(id, x, y, ms, opts) {
    if (!ok(x) || !ok(y)) return;
    let dur = 0.7;
    if (ok(ms) && ms > 0) dur = ms * 0.001;
    const boss = opts && opts.boss ? 1 : 0;
    let rad = 0;
    if (opts && opts.radius > 0) rad = opts.radius;
    else if (opts && opts.r > 0) rad = opts.r;
    else if (opts && opts.size > 0) rad = opts.size;
    let slot = null;
    for (let i = 0; i < TEL_N; i++) {
      if (tels[i].on && tels[i].id === id) {
        slot = tels[i];
        break;
      }
    }
    if (!slot) {
      for (let i = 0; i < TEL_N; i++) {
        if (!tels[i].on) {
          slot = tels[i];
          break;
        }
      }
    }
    if (!slot) slot = telFarSlot();
    slot.on = 1;
    slot.id = id;
    slot.x = x;
    slot.y = y;
    slot.age = 0;
    slot.dur = dur;
    slot.boss = boss;
    slot.rad = rad;
  }

  function telegraphClear(id) {
    for (let i = 0; i < TEL_N; i++) {
      if (tels[i].on && tels[i].id === id) tels[i].on = 0;
    }
  }

  function plotArt(ctx, sx, sy, ix, iy, zoom, cell, half) {
    ctx.fillRect(Math.round(sx + ix * zoom) - half, Math.round(sy + iy * zoom) - half, cell, cell);
  }

  function artLine(ctx, sx, sy, x0, y0, x1, y1, zoom, cell, half, color) {
    ctx.fillStyle = color;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const adx = dx < 0 ? -dx : dx;
    const ady = dy < 0 ? -dy : dy;
    const steps = adx > ady ? adx : ady;
    if (!(steps > 0)) {
      plotArt(ctx, sx, sy, x0, y0, zoom, cell, half);
      return;
    }
    const inv = 1 / steps;
    for (let i = 0; i <= steps; i++) {
      const t = i * inv;
      plotArt(ctx, sx, sy, Math.round(x0 + dx * t), Math.round(y0 + dy * t), zoom, cell, half);
    }
  }

  function layHex(rot, r) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i < 6; i++) {
      const bx = hexUx[i] * r;
      const by = hexUy[i] * r;
      hexVX[i] = Math.round(bx * c - by * s);
      hexVY[i] = Math.round(bx * s + by * c);
    }
  }

  function shieldSpin() {
    if (reducedNow()) return 0;
    return clock * 0.25 * TAU;
  }

  function clearChevrons(slot) {
    const base = slot * CH_PER;
    for (let k = 0; k < CH_PER; k++) chevs[base + k].on = 0;
  }

  function clearEdges(slot) {
    const base = slot * CH_PER;
    for (let k = 0; k < CH_PER; k++) shEdge[base + k] = 0;
  }

  function shieldFar() {
    const zoom = lastZoom > 0 ? lastZoom : 3;
    const w = lastW > 0 ? lastW : 390;
    const h = lastH > 0 ? lastH : 844;
    const hx = w * 0.5;
    const hy = h * 0.5;
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < SH_N; i++) {
      const s = shields[i];
      const span = tileSpan(zoom);
      const dx = s.x * span + lastCamX - hx;
      const dy = shieldCY(s) * span + lastCamY - hy;
      const d = dx * dx + dy * dy;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function findShield(id) {
    for (let i = 0; i < SH_N; i++) {
      if (shields[i].on && shields[i].id === id) return i;
    }
    return -1;
  }

  const SHIELD_PAD = 0.9;
  const BODY_RISE_SRC = 16;

  function shieldLiftOf(r, opts) {
    if (opts && ok(opts.lift)) return opts.lift;
    const body = r - SHIELD_PAD;
    if (!(body > 0)) return 0;
    return body * BODY_RISE_SRC / (SHIELD_PAD * framePx());
  }

  function shieldCY(s) {
    return s.y - s.lift;
  }

  function shieldOn(id, x, y, r, ms, opts) {
    if (!ok(x) || !ok(y) || !(r > 0)) return;
    let dur = 1;
    if (ok(ms) && ms > 0) dur = ms * 0.001;
    let idx = findShield(id);
    if (idx < 0) {
      for (let i = 0; i < SH_N; i++) {
        if (!shields[i].on) {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) idx = shieldFar();
    else if (!shields[idx].on) clearChevrons(idx);
    if (!shields[idx].on || shields[idx].id !== id) {
      clearChevrons(idx);
      clearEdges(idx);
    }
    const s = shields[idx];
    s.on = 1;
    s.id = id;
    s.x = x;
    s.y = y;
    s.r = r;
    s.lift = shieldLiftOf(r, opts);
    s.age = 0;
    s.dur = dur;
    clearEdges(idx);
  }

  function shieldClear(id) {
    const idx = findShield(id);
    if (idx < 0) return;
    shields[idx].on = 0;
    clearEdges(idx);
    clearChevrons(idx);
  }

  function shieldNearest(dx, dy) {
    let bestD = 1e18;
    let bestE = 0;
    let bestX = 0;
    let bestY = 0;
    for (let i = 0; i < 6; i++) {
      const j = i === 5 ? 0 : i + 1;
      const ax = hexVX[i];
      const ay = hexVY[i];
      const abx = hexVX[j] - ax;
      const aby = hexVY[j] - ay;
      const ab2 = abx * abx + aby * aby;
      let t = 0;
      if (ab2 > 0) t = ((dx - ax) * abx + (dy - ay) * aby) / ab2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const qx = ax + abx * t;
      const qy = ay + aby * t;
      const ex = dx - qx;
      const ey = dy - qy;
      const d = ex * ex + ey * ey;
      if (d < bestD) {
        bestD = d;
        bestE = i;
        bestX = qx;
        bestY = qy;
      }
    }
    shQx = bestX;
    shQy = bestY;
    return bestE;
  }

  function shieldHit(id, x, y) {
    const idx = findShield(id);
    if (idx < 0 || !ok(x) || !ok(y)) return;
    const s = shields[idx];
    const frame = framePx();
    const cy = shieldCY(s);
    layHex(shieldSpin(), s.r * frame);
    const edge = shieldNearest((x - s.x) * frame, (y - cy) * frame);
    const base = idx * CH_PER;
    let slot = -1;
    for (let k = 0; k < CH_PER; k++) {
      if (!chevs[base + k].on) {
        slot = base + k;
        break;
      }
    }
    shEdge[base + edge] = 0.08;
    if (slot < 0) return;
    let nx = shQx;
    let ny = shQy;
    let len = Math.sqrt(nx * nx + ny * ny);
    if (!(len > 0.001)) {
      nx = 1;
      ny = 0;
      len = 1;
    }
    nx /= len;
    ny /= len;
    const ch = chevs[slot];
    ch.on = 1;
    ch.age = 0;
    ch.x = s.x + shQx / frame;
    ch.y = cy + shQy / frame;
    ch.nx = nx;
    ch.ny = ny;
    ch.px = -ny;
    ch.py = nx;
  }

  function takeBreak() {
    let best = 0;
    let bestAge = -1;
    for (let i = 0; i < BR_N; i++) {
      if (!breaks[i].on) return breaks[i];
      if (breaks[i].age > bestAge) {
        bestAge = breaks[i].age;
        best = i;
      }
    }
    return breaks[best];
  }

  function shatterShards(x, y, r) {
    for (let i = 0; i < 12; i++) {
      const p = takePart();
      const a = (i / 12) * TAU;
      p.life = 0.18;
      p.max = 0.18;
      p.x = x + Math.cos(a) * r;
      p.y = y + Math.sin(a) * r;
      p.vx = Math.cos(a) * 4;
      p.vy = Math.sin(a) * 4;
      p.w = 2;
      p.h = 2;
      p.tone = (i & 1) ? 0 : shieldTone;
      p.peak = 1;
      p.art = 1;
      p.grav = 0;
      p.screen = 0;
    }
  }

  function shieldBreak(id) {
    const idx = findShield(id);
    if (idx < 0) return;
    const s = shields[idx];
    const x = s.x;
    const y = shieldCY(s);
    const r = s.r;
    s.on = 0;
    clearEdges(idx);
    clearChevrons(idx);
    const calm = reducedNow();
    if (!calm) shatterShards(x, y, r);
    const b = takeBreak();
    b.on = 1;
    b.x = x;
    b.y = y;
    b.r = r;
    b.age = 0;
    b.flash = 0;
    if (!calm && deathWindowOpen()) {
      commitDeathWindow();
      b.flash = 1;
    }
  }

  function spawnFar() {
    const zoom = lastZoom > 0 ? lastZoom : 3;
    const w = lastW > 0 ? lastW : 390;
    const h = lastH > 0 ? lastH : 844;
    const hx = w * 0.5;
    const hy = h * 0.5;
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < SP_N; i++) {
      const s = spawns[i];
      const span = tileSpan(zoom);
      const dx = s.x * span + lastCamX - hx;
      const dy = s.y * span + lastCamY - hy;
      const d = dx * dx + dy * dy;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    return spawns[best];
  }

  function spawnOn(x, y) {
    if (!ok(x) || !ok(y)) return;
    let slot = null;
    for (let i = 0; i < SP_N; i++) {
      if (!spawns[i].on) {
        slot = spawns[i];
        break;
      }
    }
    if (!slot) slot = spawnFar();
    slot.on = 1;
    slot.x = x;
    slot.y = y;
    slot.age = 0;
  }

  function paintChevron(ctx, ch, zoom, camX, camY, cell, half) {
    const u = ch.age / 0.16;
    let fade = 1 - u;
    if (fade < 0) fade = 0;
    if (fade <= 0.02) return;
    const dist = u * 4;
    const span = tileSpan(zoom);
    const sx = ch.x * span + camX + ch.nx * dist * zoom;
    const sy = ch.y * span + camY + ch.ny * dist * zoom;
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#ffffff';
    plotArt(ctx, sx, sy, Math.round(ch.nx), Math.round(ch.ny), zoom, cell, half);
    plotArt(ctx, sx, sy, Math.round(-ch.nx + ch.px), Math.round(-ch.ny + ch.py), zoom, cell, half);
    plotArt(ctx, sx, sy, Math.round(-ch.nx - ch.px), Math.round(-ch.ny - ch.py), zoom, cell, half);
  }

  function paintShield(ctx, s, idx, zoom, camX, camY, calm) {
    const span = tileSpan(zoom);
    const sx = s.x * span + camX;
    const sy = shieldCY(s) * span + camY;
    const cell = telCell(zoom);
    const half = cell >> 1;
    const radArt = s.r * framePx();
    layHex(shieldSpin(), radArt);
    ctx.globalAlpha = 1;
    const base = idx * CH_PER;
    for (let i = 0; i < 6; i++) {
      const j = i === 5 ? 0 : i + 1;
      const color = shEdge[base + i] > 0 ? '#ffffff' : '#9fb4c8';
      artLine(ctx, sx, sy, hexVX[i], hexVY[i], hexVX[j], hexVY[j], zoom, cell, half, color);
    }
    const inner = Math.round(radArt - 2);
    if (inner >= 2) {
      ctx.globalAlpha = 0.35;
      paintPixelRing(ctx, sx, sy, inner, zoom, '#9fb4c8', 0);
      ctx.globalAlpha = 1;
    }
    if (!calm) {
      let turns = clock;
      let u = turns - Math.floor(turns);
      if (u < 0) u += 1;
      const along = u * 6;
      let e = along | 0;
      if (e < 0) e = 0;
      if (e > 5) e = 5;
      const t = along - e;
      const j = e === 5 ? 0 : e + 1;
      const gx = hexVX[e] + (hexVX[j] - hexVX[e]) * t;
      const gy = hexVY[e] + (hexVY[j] - hexVY[e]) * t;
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      plotArt(ctx, sx, sy, Math.round(gx), Math.round(gy), zoom, cell, half);
    }
    for (let k = 0; k < CH_PER; k++) {
      const ch = chevs[base + k];
      if (ch.on) paintChevron(ctx, ch, zoom, camX, camY, cell, half);
    }
    ctx.globalAlpha = 1;
  }

  function paintShields(ctx, zoom, camX, camY, calm) {
    for (let i = 0; i < SH_N; i++) {
      if (shields[i].on) paintShield(ctx, shields[i], i, zoom, camX, camY, calm);
    }
    for (let i = 0; i < BR_N; i++) {
      const b = breaks[i];
      if (!b.on) continue;
      const span = tileSpan(zoom);
      const sx = b.x * span + camX;
      const sy = b.y * span + camY;
      let u = b.age / 0.18;
      if (u < 0) u = 0;
      if (u > 1) u = 1;
      const radArt = b.r * framePx();
      const rad = Math.round(radArt + 8 * u);
      ctx.globalAlpha = 1;
      if (rad >= 1) paintPixelRing(ctx, sx, sy, rad, zoom, '#9fb4c8', 0);
      if (b.flash && b.age < 0.012) {
        const cell = telCell(zoom);
        const half = cell >> 1;
        layHex(shieldSpin(), radArt);
        ctx.globalAlpha = 0.6;
        for (let e = 0; e < 6; e++) {
          const j = e === 5 ? 0 : e + 1;
          artLine(ctx, sx, sy, hexVX[e], hexVY[e], hexVX[j], hexVY[j], zoom, cell, half, '#ffffff');
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  function paintSpawnOne(ctx, s, zoom, camX, camY, calm) {
    const span = tileSpan(zoom);
    const sx = s.x * span + camX;
    const sy = s.y * span + camY;
    ctx.globalAlpha = 1;
    if (calm) {
      paintPixelRing(ctx, sx, sy, 6, zoom, '#26252b', 0);
      return;
    }
    let u = s.age / (SPAWN_MS * 0.001);
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    const rad = 3 + 6 * u;
    const ri = Math.round(rad);
    if (ri >= 1) paintPixelRing(ctx, sx, sy, ri, zoom, '#26252b', 0);
    const cell = telCell(zoom);
    const half = cell >> 1;
    ctx.fillStyle = '#141318';
    for (let k = 0; k < 4; k++) {
      const a = k * 1.5707963267948966;
      plotArt(ctx, sx, sy, Math.round(Math.cos(a) * rad), Math.round(Math.sin(a) * rad), zoom, cell, half);
    }
  }

  function paintSpawns(ctx, zoom, camX, camY, viewW, viewH, calm) {
    spGen += 1;
    if (spGen > 1000000000) {
      spGen = 1;
      for (let i = 0; i < SP_N; i++) spawns[i].mark = 0;
    }
    let active = 0;
    for (let i = 0; i < SP_N; i++) if (spawns[i].on) active += 1;
    const limit = active > SP_DRAW ? SP_DRAW : active;
    const hx = viewW * 0.5;
    const hy = viewH * 0.5;
    for (let n = 0; n < limit; n++) {
      let best = -1;
      let bestD = 0;
      for (let i = 0; i < SP_N; i++) {
        const s = spawns[i];
        if (!s.on || s.mark === spGen) continue;
        const span = tileSpan(zoom);
        const dx = s.x * span + camX - hx;
        const dy = s.y * span + camY - hy;
        const d = dx * dx + dy * dy;
        if (best < 0 || d < bestD) {
          best = i;
          bestD = d;
        }
      }
      if (best < 0) break;
      spawns[best].mark = spGen;
      paintSpawnOne(ctx, spawns[best], zoom, camX, camY, calm);
    }
  }

  function step(dt) {
    if (!(dt > 0)) return;
    frameTick += 1;
    if (dt > 0.05) dt = 0.05;
    clock += dt;
    if (flashLeft > 0) flashLeft = Math.max(0, flashLeft - dt);
    if (popOn) {
      popT += dt;
      if (popT > 0.45) popOn = 0;
    }
    if (!reducedNow()) vowAng += dt * 1.5;
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
      if (p.life <= 0 || p.sweep) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grav) {
        p.vy += p.grav * dt;
      } else {
        const damp = 1 - dt * 1.5;
        p.vx *= damp;
        p.vy *= damp;
      }
    }
    if (sweepEnd) {
      sweepOn = 0;
      sweepEnd = 0;
      clearSweepParts();
    } else if (sweepOn) {
      sweepAge += dt;
      if (sweepAge + 0.0001 >= sweepDur) {
        sweepAge = sweepDur;
        sweepEnd = 1;
      }
      for (let i = 0; i < SWEEP_N; i++) {
        const p = parts[i];
        if (p.sweep && p.life > 0) placeSweepPart(p);
      }
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
    if (shakeLife > 0) {
      shakeLife -= dt;
      if (shakeLife < 0) shakeLife = 0;
    }
    for (let i = 0; i < BEAM_N; i++) {
      if (beams[i].on) beams[i].age += dt;
    }
    for (let i = 0; i < TEL_N; i++) {
      const t = tels[i];
      if (!t.on) continue;
      t.age += dt;
      if (t.age >= t.dur) t.on = 0;
    }
    for (let i = 0; i < SH_N; i++) {
      const s = shields[i];
      if (!s.on) continue;
      s.age += dt;
      const base = i * CH_PER;
      for (let k = 0; k < CH_PER; k++) {
        if (shEdge[base + k] > 0) {
          shEdge[base + k] -= dt;
          if (shEdge[base + k] < 0) shEdge[base + k] = 0;
        }
      }
      if (s.age >= s.dur) {
        s.on = 0;
        clearEdges(i);
        clearChevrons(i);
      }
    }
    for (let i = 0; i < CH_N; i++) {
      const c = chevs[i];
      if (!c.on) continue;
      c.age += dt;
      if (c.age >= 0.16) c.on = 0;
    }
    for (let i = 0; i < SP_N; i++) {
      const s = spawns[i];
      if (!s.on) continue;
      s.age += dt;
      if (s.age >= SPAWN_MS * 0.001) s.on = 0;
    }
    for (let i = 0; i < BR_N; i++) {
      const b = breaks[i];
      if (!b.on) continue;
      b.age += dt;
      if (b.age >= 0.18) b.on = 0;
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
    // Odd diamond; 3px radius is 7px, the smallest size that stays at least 6px.
    return half < 3 ? 3 : half;
  }

  function paintEmbers(ctx, zoom, calm) {
    if (!vows) return;
    const lift = heroHalfSprite() * zoom;
    const hx = ctx.canvas.width * 0.5;
    const hy = ctx.canvas.height * 0.5 - lift;
    const rad = ORBIT_SPRITE * zoom;
    const half = emberHalf(zoom);
    const trailR = half > 2 ? half - 1 : 1;
    const spin = calm ? -1.5707963267948966 : vowAng;
    if (!calm) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < vows; i++) {
        const base = spin + (i / vows) * TAU;
        const far = base - 0.84;
        const near = base - 0.42;
        ctx.globalAlpha = 0.28;
        diamondPx(ctx, hx + Math.cos(far) * rad, hy + Math.sin(far) * rad, trailR, '#ffb347');
        ctx.globalAlpha = 0.5;
        diamondPx(ctx, hx + Math.cos(near) * rad, hy + Math.sin(near) * rad, trailR, '#ffb347');
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (let i = 0; i < vows; i++) {
      const a = spin + (i / vows) * TAU;
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

  function beamAlpha() {
    if (reducedNow()) return 0.8;
    const s = Math.sin(clock * 12.566370614359172);
    let a = 0.82 + s * 0.1;
    if (a < 0.72) a = 0.72;
    if (a > 0.92) a = 0.92;
    return a;
  }

  function columnAlpha() {
    if (reducedNow()) return 0.9;
    const s = Math.sin(clock * 12.566370614359172);
    const a = 0.9 + s * 0.05;
    return a < 0.85 ? 0.85 : a;
  }

  function legendAlpha() {
    if (reducedNow()) return 0.9;
    const s = Math.sin(clock * 6.283185307179586);
    const a = 0.9 + s * 0.05;
    return a < 0.85 ? 0.85 : a;
  }

  function rarityFill(r) {
    if (r === 1) return '#5ed37a';
    if (r === 2) return '#4c7cff';
    if (r === 3) return '#b48cff';
    if (r === 4) return '#ffb43c';
    return '#b9b4aa';
  }

  function beamUnit(zoom) {
    const u = Math.round(zoom / BEAM_CSS_PER_ART);
    return u > 1 ? u : 1;
  }

  function paintStrip(ctx, x, y, w, h, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function paintBeams(ctx, zoom, tile, camX, camY, viewW, viewH) {
    const a = beamAlpha();
    const calm = reducedNow();
    const cell = Math.max(1, zoom | 0);
    const unit = beamUnit(zoom);
    for (let i = 0; i < BEAM_N; i++) {
      const b = beams[i];
      if (!b.on || b.r <= 0) continue;
      const sx = Math.round(b.x * tile + camX);
      const sy = Math.round(b.y * tile + camY);
      if (b.r === 1) {
        const s = 6 * cell;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#5ed37a';
        ctx.fillRect(sx - (s >> 1), sy - (cell >> 1), s, cell);
        ctx.fillRect(sx - (cell >> 1), sy - (s >> 1), cell, s);
        continue;
      }
      const legend = b.r === 4;
      const hCss = b.r === 2 ? 72 : (legend ? 144 : 96);
      const strips = b.r === 2 ? 4 : (legend ? 8 : 5);
      const h = hCss * unit;
      const span = strips * unit;
      const x0 = Math.round(sx - span * 0.5);
      const y0 = Math.round(sy - h);
      const bodyA = legend ? legendAlpha() : columnAlpha();
      if (sx > -span && sx < viewW + span && sy > -8 && y0 < viewH + 8) {
        if (b.r === 2) {
          paintStrip(ctx, x0, y0, unit, h, '#14120f', 0.7);
          paintStrip(ctx, x0 + unit, y0, unit, h, '#4c7cff', bodyA);
          paintStrip(ctx, x0 + unit * 2, y0, unit, h, '#ffffff', bodyA);
          paintStrip(ctx, x0 + unit * 3, y0, unit, h, '#14120f', 0.7);
        } else if (!legend) {
          paintStrip(ctx, x0, y0, unit, h, '#14120f', 0.7);
          paintStrip(ctx, x0 + unit, y0, unit, h, '#b48cff', bodyA);
          paintStrip(ctx, x0 + unit * 2, y0, unit, h, '#ffffff', bodyA);
          paintStrip(ctx, x0 + unit * 3, y0, unit, h, '#b48cff', bodyA);
          paintStrip(ctx, x0 + unit * 4, y0, unit, h, '#14120f', 0.7);
        } else {
          paintStrip(ctx, x0, y0, unit, h, '#14120f', 0.7);
          paintStrip(ctx, x0 + unit, y0, unit, h, '#ffd27a', bodyA);
          paintStrip(ctx, x0 + unit * 2, y0, unit, h, '#ffb43c', bodyA);
          paintStrip(ctx, x0 + unit * 3, y0, unit, h, '#14120f', 0.7);
          paintStrip(ctx, x0 + unit * 4, y0, unit, h, '#14120f', 0.7);
          paintStrip(ctx, x0 + unit * 5, y0, unit, h, '#ffb43c', bodyA);
          paintStrip(ctx, x0 + unit * 6, y0, unit, h, '#ffd27a', bodyA);
          paintStrip(ctx, x0 + unit * 7, y0, unit, h, '#14120f', 0.7);
        }
        if (b.r >= 3) {
          const count = legend ? 3 : 2;
          ctx.globalAlpha = bodyA;
          ctx.fillStyle = legend ? '#ffd27a' : '#b48cff';
          for (let s = 0; s < count; s++) {
            let ph = (s + 1) * (hCss / (count + 1));
            if (!calm) ph = (clock * 20 + s * (hCss / count)) % hCss;
            ctx.fillRect(Math.round(x0 + span + unit), Math.round(sy - ph * unit), unit, unit);
          }
        }
      }
      if (sy > -16 && sy < viewH + 16 && sx > -40 && sx < viewW + 40) {
        paintGround(ctx, Math.round(sx), Math.round(sy), cell, rarityFill(b.r), legend ? bodyA : 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function paintOneArrow(ctx, ax, ay, dir, cell) {
    const c = cell;
    if (dir === 0) {
      const x = Math.round(ax - c);
      const y = Math.round(ay - c * 2);
      ctx.fillRect(x + c, y, c, c);
      ctx.fillRect(x, y + c, c * 3, c);
      ctx.fillRect(x + c, y + c * 2, c, c);
      ctx.fillRect(x + c, y + c * 3, c, c);
      ctx.fillRect(x + c, y + c * 4, c, c);
    } else if (dir === 1) {
      const x = Math.round(ax - c);
      const y = Math.round(ay - c * 2);
      ctx.fillRect(x + c, y, c, c);
      ctx.fillRect(x + c, y + c, c, c);
      ctx.fillRect(x + c, y + c * 2, c, c);
      ctx.fillRect(x, y + c * 3, c * 3, c);
      ctx.fillRect(x + c, y + c * 4, c, c);
    } else if (dir === 2) {
      const x = Math.round(ax - c * 2);
      const y = Math.round(ay - c);
      ctx.fillRect(x, y, c, c);
      ctx.fillRect(x, y + c * 2, c, c);
      ctx.fillRect(x + c, y, c, c);
      ctx.fillRect(x + c, y + c * 2, c, c);
      ctx.fillRect(x, y + c, c * 5, c);
    } else {
      const x = Math.round(ax - c * 2);
      const y = Math.round(ay - c);
      ctx.fillRect(x + c * 4, y, c, c);
      ctx.fillRect(x + c * 4, y + c * 2, c, c);
      ctx.fillRect(x + c * 3, y, c, c);
      ctx.fillRect(x + c * 3, y + c * 2, c, c);
      ctx.fillRect(x, y + c, c * 5, c);
    }
  }

  function paintGround(ctx, sx, sy, cell, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const c = cell;
    for (let i = 0; i < GROUND_N; i++) {
      ctx.fillRect(sx + groundX[i] * c, sy + groundY[i] * c, c, c);
    }
  }

  function paintSweep(ctx, zoom, tile, camX, camY, heroX, heroY) {
    if (!sweepOn) return;
    const front = sweepFront();
    if (!(front > 1)) return;
    let px;
    let py;
    if (sweepScreen) {
      px = heroX;
      py = heroY;
    } else {
      px = sweepX * tile + camX;
      py = sweepY * tile + camY;
    }
    const cell = Math.max(1, zoom | 0);
    let u = sweepDur > 0 ? sweepAge / sweepDur : 1;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    ctx.globalAlpha = 0.9 - u * 0.25;
    ctx.lineWidth = cell;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, (front - 0.5) * zoom), 0, TAU);
    ctx.strokeStyle = '#5fd8ff';
    ctx.stroke();
    const inner = (front - 1.5) * zoom;
    if (inner > 1) {
      ctx.beginPath();
      ctx.arc(px, py, inner, 0, TAU);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function paintBeamArrows(ctx, zoom, tile, camX, camY, viewW, viewH) {
    const cell = Math.max(1, zoom | 0);
    const inset = 8 * cell;
    for (let i = 0; i < BEAM_N; i++) {
      const b = beams[i];
      if (!b.on || b.r < 2) continue;
      const sx = b.x * tile + camX;
      const sy = b.y * tile + camY;
      if (sx >= 0 && sy >= 0 && sx <= viewW && sy <= viewH) continue;
      let ax = sx;
      let ay = sy;
      if (ax < inset) ax = inset;
      else if (ax > viewW - inset) ax = viewW - inset;
      if (ay < inset) ay = inset;
      else if (ay > viewH - inset) ay = viewH - inset;
      const dx = sx - ax;
      const dy = sy - ay;
      let dir = 0;
      if (Math.abs(dx) > Math.abs(dy)) dir = dx < 0 ? 2 : 3;
      else dir = dy < 0 ? 0 : 1;
      ctx.globalAlpha = 1;
      ctx.fillStyle = rarityFill(b.r);
      paintOneArrow(ctx, ax, ay, dir, cell);
    }
    ctx.globalAlpha = 1;
  }

  function paintBeamsNow(ctx, cam) {
    const zoom = (cam && ok(cam.zoom) && cam.zoom > 0) ? cam.zoom : 1;
    const tile = framePx() * zoom;
    const camX = cam && ok(cam.x) ? cam.x : 0;
    const camY = cam && ok(cam.y) ? cam.y : 0;
    const viewW = ctx.canvas.width;
    const viewH = ctx.canvas.height;
    lastW = viewW;
    lastH = viewH;
    lastZoom = zoom;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    paintBeams(ctx, zoom, tile, camX, camY, viewW, viewH);
    ctx.globalAlpha = 1;
  }

  function paint(ctx, cam, skipBeams) {
    const zoom = (cam && ok(cam.zoom) && cam.zoom > 0) ? cam.zoom : 1;
    const tile = framePx() * zoom;
    const camX = cam && ok(cam.x) ? cam.x : 0;
    const camY = cam && ok(cam.y) ? cam.y : 0;
    const viewW = ctx.canvas.width;
    const viewH = ctx.canvas.height;
    lastW = viewW;
    lastH = viewH;
    lastZoom = zoom;
    lastCamX = camX;
    lastCamY = camY;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;

    const calm = reducedNow();
    const img = ensureWhite();
    if (img) {
      for (let i = 0; i < SIL_CAP; i++) {
        const s = sils[i];
        if (s.life <= 0) continue;
        const sc = s.scale > 0 ? s.scale : 1;
        const dw = Math.max(1, Math.round(s.sw * zoom * sc));
        const dh = Math.max(1, Math.round(s.sh * zoom * sc));
        const pad = s.pad > 0 ? s.pad : 0;
        const foot = (s.sh - pad) * zoom * sc;
        const sx = s.x * tile + camX;
        const sy = s.y * tile + camY;
        const dx = Math.round(sx - dw / 2);
        const dy = Math.round(sy - foot);
        ctx.globalAlpha = Math.min(0.6, s.a > 0 ? s.a : 0.6);
        if (s.flip) ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, dx + dw, dy, -dw, dh);
        else ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, dx, dy, dw, dh);
      }
      ctx.globalAlpha = 1;
    }

    const lift = heroHalfSprite() * zoom;
    const heroX = viewW * 0.5;
    const heroY = viewH * 0.5 - lift;
    paintSweep(ctx, zoom, tile, camX, camY, heroX, heroY);
    for (let i = 0; i < CAP; i++) {
      const p = parts[i];
      if (p.life <= 0) continue;
      let sx;
      let sy;
      if (p.screen) {
        sx = Math.round(heroX + p.x * zoom);
        sy = Math.round(heroY + p.y * zoom);
      } else {
        sx = Math.round(p.x * tile + camX);
        sy = Math.round(p.y * tile + camY);
      }
      if (sx < -20 || sy < -20 || sx > viewW + 20 || sy > viewH + 20) continue;
      let a = p.max > 0 ? p.life / p.max : 0;
      if (p.peak > 0 && p.peak < 1) a *= p.peak;
      if (a > 1) a = 1;
      if (a <= 0.02) continue;
      const dw = p.art ? Math.max(1, Math.round(p.w * zoom)) : p.w;
      const dh = p.art ? Math.max(1, Math.round(p.h * zoom)) : p.h;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#14120f';
      ctx.fillRect(sx - 1, sy - 1, dw + 2, dh + 2);
      ctx.fillStyle = p.tone >= 20 ? (tints[p.tone - 20] || '#8a6cff') : (toneColor[p.tone] || '#ffffff');
      ctx.fillRect(sx, sy, dw, dh);
      if (p.tone === 3 && dw > 1 && dh > 1) {
        ctx.fillStyle = '#ffffff';
        const cw = dw > 2 ? 2 : 1;
        const ch = dh > 2 ? 2 : 1;
        ctx.fillRect(sx + ((dw - cw) >> 1), sy + ((dh - ch) >> 1), cw, ch);
      }
    }
    ctx.globalAlpha = 1;
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
      } else if (r.space === 3) {
        px = r.x * tile + camX;
        py = r.y * tile + camY;
        radPx = radius * zoom;
      } else {
        px = r.x * tile + camX;
        py = r.y * tile + camY;
        radPx = radius * tile;
      }
      if (!(radPx >= 1.5)) continue;
      ctx.beginPath();
      ctx.arc(px, py, radPx, 0, TAU);
      ctx.strokeStyle = r.tone === 1 ? '#f4efe0' : (r.tone === 2 ? '#5fd8ff' : '#ffffff');
      ctx.lineWidth = r.thick;
      ctx.globalAlpha = 1 - u;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (bladeN) {
      const mul = bladeMul();
      for (let i = 0; i < bladeN; i++) {
        const b = blades[i];
        if (!calm) {
          const ntr = b.samples;
          for (let t = ntr - 1; t >= 0; t--) {
            paintBlade(ctx, b.trail[t], zoom, tile, camX, camY, mul, trailAlpha[t] || 0.1);
          }
        }
        paintBlade(ctx, b, zoom, tile, camX, camY, mul, 1);
      }
    }

    paintEmbers(ctx, zoom, calm);
    if (!skipBeams) paintBeams(ctx, zoom, tile, camX, camY, viewW, viewH);
    paintBeamArrows(ctx, zoom, tile, camX, camY, viewW, viewH);
    paintTels(ctx, zoom, camX, camY, viewW, viewH, calm);
    paintSpawns(ctx, zoom, camX, camY, viewW, viewH, calm);
    paintShields(ctx, zoom, camX, camY, calm);

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
      const crit = !!(vis && vis.crit);
      if (heavy) spray(x, y, crit ? 7 : 6, 0.16, 5.6, crit ? 6 : 5, crit ? 6 : 5, true);
      else spray(x, y, crit ? 5 : 4, crit ? 0.14 : 0.12, crit ? 4.8 : 4.4, crit ? 4 : 3, crit ? 4 : 3, true);
      if (heavy && allowSpriteFlash(vis)) spawnSil(x, y, vis, 0.6);
    },

    death: function (x, y, type, vis) {
      doKill(x, y, type, vis);
    },

    kill: function (x, y, type, opts) {
      doKill(x, y, type, opts);
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

    pickup: function (x, y, kind, info) {
      if (!ok(x) || !ok(y)) return;
      if (kind === 'gem') {
        let c = (info && info.chain) || 1;
        if (c < 1) c = 1;
        if (c > 12) c = 12;
        if (reducedNow()) c = 1;
        const t = (c - 1) / 11;
        const n = Math.round(4 + t * 8);
        const size = Math.round(2 + t * 2);
        const spread = 3.4 * (1 + t * 0.35);
        const peak = 0.7 + t * 0.3;
        spray(x, y, n, 0.14, spread, size, size, true, peak, true);
      } else {
        spray(x, y, 4, 0.14, 3.4, 2, 2, true);
      }
      addRing(0, x, y, 0.06, 0.4, 2, 0.16, 0, 0);
    },

    levelUp: function (x, y, opts) {
      let rad = LEVELUP_RADIUS;
      if (opts && opts.radius > 0) rad = opts.radius;
      const placed = ok(x) && ok(y);
      const space = placed ? 3 : 1;
      const px = placed ? x : 0;
      const py = placed ? y : 0;
      addRing(space, px, py, 0, rad, 2, 0.22, 0, 0);
      addRing(space, px, py, 1, rad + 1, 1, 0.22, 0, 2);
      if (!reducedNow()) spawnStreaks(px, py, placed ? 0 : 1);
    },

    evolve: function (weapon, opts) {
      if (weapon == null || weapon === '') return;
      if (weapon === 'halo' || weapon === 'nova') halo = 1;
      if (weapon === 'storm' || weapon === 'orbit') {
        popKind = 1;
        popOn = 1;
        popT = 0;
      }
      if (clock - evolveFlashAt < 1) {
        addRing(1, 0, 0, 12, 28, 2, 0.24, 0, 0);
        return;
      }
      if (reducedNow()) {
        evolveFlashAt = clock;
        beginSweep(opts, false);
        return;
      }
      if (!tryConsumeFlash()) {
        addRing(1, 0, 0, 12, 28, 2, 0.24, 0, 0);
        return;
      }
      evolveFlashAt = clock;
      flashLeft = FLASH_LIFE;
      beginSweep(opts, true);
    },

    vow: function (stackCount) {
      let n = stackCount | 0;
      if (n < 0) n = 0;
      if (n > VOW_CAP) n = VOW_CAP;
      vows = n;
    },

    secondChance: function (x, y) {
      if (!ok(x) || !ok(y)) return;
      addRing(2, x, y, 30, 5, 2, 0.4, 0, 1);
      addRing(2, x, y, 22, 3, 2, 0.4, 0.03, 0);
      if (!reducedNow()) spray(x, bodyY(y), 8, 0.28, 6.2, 4, 3, true);
    },

    reset: function () {
      clock = 0;
      frameTick = 0;
      underTick = -1;
      vows = 0;
      vowAng = 0;
      halo = 0;
      popOn = 0;
      popT = 0;
      popKind = 0;
      flashLeft = 0;
      flashSlot = 0;
      bladeN = 0;
      bladeStamp = -10;
      lastBladeSample = -10;
      globalBossAt = -10;
      cdCursor = 0;
      evolveFlashAt = -10;
      deathSilSlot = 0;
      reduceChecked = -1;
      for (let i = 0; i < 3; i++) {
        flashStamp[i] = -10;
        deathSilStamp[i] = -10;
      }
      for (let i = 0; i < CD_N; i++) {
        cdKey[i] = null;
        cdTime[i] = -10;
      }
      for (let i = 0; i < CAP; i++) parts[i].life = 0;
      for (let i = 0; i < RING_CAP; i++) rings[i].on = 0;
      for (let i = 0; i < SIL_CAP; i++) sils[i].life = 0;
      for (let i = 0; i < BEAM_N; i++) beams[i].on = 0;
      for (let i = 0; i < TEL_N; i++) tels[i].on = 0;
      for (let i = 0; i < SH_N; i++) {
        shields[i].on = 0;
        clearEdges(i);
        clearChevrons(i);
      }
      for (let i = 0; i < SP_N; i++) spawns[i].on = 0;
      for (let i = 0; i < BR_N; i++) breaks[i].on = 0;
      for (let i = 0; i < KILL_N; i++) killStamp[i] = -10;
      killSlot = 0;
      shakeAmp = 0;
      shakeLife = 0;
      shakeMax = 1;
      shakeAt = -10;
      shakeOut.x = 0;
      shakeOut.y = 0;
      sweepOn = 0;
      sweepEnd = 0;
      sweepAge = 0;
      sweepMax = 0;
      sweepX = 0;
      sweepY = 0;
      sweepScreen = 0;
      sweepOut.x = 0;
      sweepOut.y = 0;
      clearSweepParts();
      for (let i = 0; i < MAX_B; i++) {
        const b = blades[i];
        b.live = 0;
        b.samples = 0;
        b.x = 0;
        b.y = 0;
        b.a = 0;
        b.holdX = 0;
        b.holdY = 0;
        b.holdA = 0;
        for (let t = 0; t < TRAIL; t++) {
          b.trail[t].x = 0;
          b.trail[t].y = 0;
          b.trail[t].a = 0;
        }
      }
    },

    setReducedMotion: function (flag) {
      reduceOverride = !!flag;
      reduce = reduceOverride;
    },

    update: function (dt) {
      step(dt);
      ensureWhite();
    },

    draw: function (ctx, cam) {
      if (!ctx || !ctx.canvas) return;
      let skip = 0;
      if (underTick === frameTick) {
        skip = 1;
        underTick = -1;
      }
      paint(ctx, cam || emptyCam, skip);
    },

    drawUnder: function (ctx, cam) {
      if (!ctx || !ctx.canvas) return;
      if (underTick === frameTick) return;
      underTick = frameTick;
      paintBeamsNow(ctx, cam || emptyCam);
    },

    drawBeamArrows: function (ctx, cam, w, h) {
      if (!ctx || !ctx.canvas) return;
      const view = cam || emptyCam;
      const zoom = view.zoom > 0 ? view.zoom : 3;
      const tile = zoom * 16;
      const camX = ok(view.x) ? view.x : 0;
      const camY = ok(view.y) ? view.y : 0;
      const viewW = w > 0 ? w : ctx.canvas.width;
      const viewH = h > 0 ? h : ctx.canvas.height;
      paintBeamArrows(ctx, zoom, tile, camX, camY, viewW, viewH);
    },

    beam: function (id, x, y, rarity) {
      beamOn(id, x, y, rarity);
    },

    beamOff: function (id) {
      beamClear(id);
    },

    telegraph: function (id, x, y, ms, opts) {
      telegraphOn(id, x, y, ms, opts);
    },

    telegraphOff: function (id) {
      telegraphClear(id);
    },

    shield: function (id, x, y, r, ms, opts) {
      shieldOn(id, x, y, r, ms, opts);
    },

    shieldOff: function (id) {
      shieldClear(id);
    },

    shieldHit: function (id, x, y) {
      shieldHit(id, x, y);
    },

    shieldBreak: function (id) {
      shieldBreak(id);
    },

    spawn: function (x, y) {
      spawnOn(x, y);
    },

    shakeOffset: function () {
      return readShake();
    },

    sweepRadius: function () {
      return readSweepRadius();
    },

    sweepCenter: function () {
      sweepOut.x = sweepX;
      sweepOut.y = sweepY;
      return sweepOut;
    },

    LEVELUP_RADIUS: LEVELUP_RADIUS,
    EVOLVE_SWEEP_MS: EVOLVE_SWEEP_MS,
  };
})();
