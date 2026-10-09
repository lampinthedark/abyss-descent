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
 *
 * Attack telegraphs: FX.telegraph(id, x, y, tellMs) starts a windup clock for
 * `id` (tellMs defaults to 1000) and FX.telegraphOff(id) ends it;
 * FX.tellProgress(id) reads 0..1 (-1 when idle). FX.paintTell(ctx, shape, x,
 * y, a, b, c, u) draws one warning in screen px, normal blending, no blur:
 * 'circle' (a = radius), 'cone' (a = radius, b = aim, c = arc) or 'line'
 * (a, b = end x/y, c = half width). u is windup progress 0..1. The fill is
 * #ff5a2a and grows from the origin out while its alpha ramps 0.15 -> 0.5; a
 * 3.5-4.5 CSS px #fff0e0 edge pulsing at 3 Hz (steady with reduced motion)
 * over a 1px #7a1a08 outline reads in greyscale. FX.paintMobTell takes the
 * same args for regular monsters, 'line' (charge lane) or 'dot' (orb that
 * grows from 30% to radius a): amber #e0a060 fill 0.06 -> 0.2 and a 1.5 CSS
 * px #ffd0a0 edge at 0.55, no pulse, no outline. Always the quieter of the two.
 *
 * Low HP: FX.drawLowHp(ctx, w, h, hpFrac, nowMs), once per frame after the
 * world in screen space, draws nothing at 35% HP or more. Below that a dark
 * red (#5a0a06 -> #a0140a) edge vignette, centre clear, beats lub-dub from 60
 * bpm at 35% to 140 bpm at 5%, edge alpha up to 0.55. The gradient is built
 * once per ctx and size. FX.lowHpFlash(hpFrac, nowMs) gives a 0..1 HP-bar
 * flash below 15% (lub only, at most 2.33 Hz); FX.drawHpBarFlash paints it on
 * a canvas rect. Reduced motion: steady vignette, flash held at 0.5.
 * FX.gemTrail(ctx, x, y, vx, vy, colour) draws a 4-segment fading streak and
 * a sparkle behind a moving gem (screen px, px/s), at most 64 per frame
 * (the count resets in FX.draw).
 *
 * FX.bossGuard(x, y, radius) (world tiles like FX.hit; radius in CSS px,
 * default 40) flashes a pale #e8eef8 2.5 CSS px ring with 5 sheen ticks when a
 * hit glances off the boss: grows 15% and fades from 0.8 over 220 ms in the
 * FX.draw pass. One new ring per 180 ms (extra calls return false), 4 pooled.
 * Reduced motion: no growth, 120 ms fade. FX.guardNumberStyle is the grey
 * {color, scale} for glanced damage numbers.
 *
 * Game feel batch 2 (design/game-feel.md 6 and 4) lives in its own section,
 * "---- game feel batch 2 ----": FX.evoCinematic / evoHold / evoTitleScale
 * (Dawnbreaker 1.6 s moment, sim held to 1.2 s) and FX.heroWalk / heroPose.
 *
 * Game feel batch 1 (design/game-feel.md 1, 2 and the shake rules):
 * FX.shake(level 1..4) = S1 2px/120ms, S2 4/200, S3 6/300, S4 8/400 (art px,
 * outQuad decay, value noise, no rotation). Never stacks: a shake replaces
 * the running one only if stronger than what is left; cap 8. Reduced motion
 * halves it. FX.hitstop(vis) -> seconds: elites 60 ms, boss crits 40 ms,
 * never normal mobs, 150 ms gap, none with reduced motion; overlapping stops
 * take the max, never the sum. The game scales its sim dt with
 * FX.consumeHitstop(dt) (0 while frozen); FX.hitstopLeft() reads it. The
 * renderer never stops. FX.knockTiles(vis)
 * (6 px, elite 3, boss 0) + FX.knockStep(age, dt) (outQuad over 90 ms).
 * FX.foePose(hitAge, flashLeft, deathAge, pop) fills one shared {sx, sy,
 * white}: squash 1.15x0.85 back over 100 ms (outBack); death pop to 1.25
 * (60 ms) then inQuad shrink to 0 (120 ms) in white. FX.drawWhite(ctx, vis,
 * x, y, a) overlays the sprite from the cached white atlas (one drawImage,
 * no scratch canvas). Flashes are 60 ms (FX.HIT_FLASH), 50% with reduced
 * motion. FX.kill returns 1/0 (white pop on/off) and bursts 4-6 shards
 * (bone, goblin green, imp orange, devil red) at the end of the pop: 350 ms,
 * 20-40 px with gravity; elites 10 + a 24 px outCubic ring + S2. Above 80
 * live foes (opts.crowd) a kill is 1-2 shards; above 150 every second pop
 * is skipped. Shards live in the fixed particle pool, cap at 120 and recycle
 * the oldest; they draw as flat rects batched by colour.
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
      art: 0, grav: 0, screen: 0, sweep: 0, ang: 0.5, shard: 0,
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
  let lastRing = 0;

  const rings = new Array(RING_CAP);
  for (let i = 0; i < RING_CAP; i++) {
    const r = rings[i] = {
      on: 0, age: 0.5, dur: 0.5, delay: 0.5,
      x: 0.5, y: 0.5, r0: 0.5, r1: 0.5, thick: 2, space: 0, tone: 0, ease: 0,
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

  // ---- Game feel, batch 1 (design/game-feel.md: hit reaction, deaths, shake).
  // Shake levels S1..S4: amplitude in art px (the game multiplies by zoom), seconds.
  const SHAKE_AMP = [0, 2, 4, 6, 8];
  const SHAKE_DUR = [0, 0.12, 0.2, 0.3, 0.4];
  const SHAKE_CAP = 8;
  let shakeSeed = 0;
  // Hit reaction.
  const HIT_FLASH = 0.06;
  const KNOCK_T = 0.09;
  const KNOCK_PX = 6;
  const KNOCK_PX_ELITE = 3;
  const SQUASH_T = 0.1;
  const SQUASH_X = 1.15;
  const SQUASH_Y = 0.85;
  const STOP_CRIT = 0.04;
  const STOP_ELITE = 0.06;
  const STOP_GAP = 0.15;
  let stopEnd = -10;
  let stopLeft = 0;
  let stopClock = 0;
  // Death: pop to 1.25 (60 ms), shrink to 0 with inQuad (120 ms) while white;
  // 4-6 shards at the end of the pop, 350 ms, 20-40 px with gravity.
  const POP_T = 0.06;
  const SHRINK_T = 0.12;
  const DEATH_T = POP_T + SHRINK_T;
  const POP_SCALE = 1.25;
  const SHARD_LIFE = 0.35;
  const SHARD_CAP = 120;
  const CROWD_N = 150; // spec: skip every second white pop above 150 foes
  const THIN_N = 80;   // perf limit: 1-2 shards per death above 80 foes
  const SHARD_BONE = '#e8e0c8';
  const SHARD_GOBLIN = '#6cbf4a';
  const SHARD_IMP = '#ff8a2a';
  const SHARD_DEVIL = '#d0302a';
  const BURST_N = 32;
  const SHARD_TONE_N = 8;
  const shardTones = new Uint8Array(SHARD_TONE_N);
  const burstT = new Float64Array(BURST_N);
  const burstX = new Float64Array(BURST_N);
  const burstY = new Float64Array(BURST_N);
  const burstNum = new Uint8Array(BURST_N);
  const burstTone = new Uint8Array(BURST_N);
  const burstOn = new Uint8Array(BURST_N);
  let burstCursor = 0;
  let crowdKill = 0;
  const pose = { sx: 1, sy: 1, white: 0.5 };
  pose.white = 0;

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
  lastZoom = 0;

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

  // Telegraph windups: fixed slots, no per-frame allocation.
  const TELL_N = 8;
  const TELL_FILL = '#ff5a2a';
  const TELL_EDGE = '#fff0e0';
  const TELL_DARK = '#7a1a08';
  const TELL_A0 = 0.15;
  const TELL_A1 = 0.5;
  // Boss edge pulses at 3 Hz on the FX clock: 3.5 -> 4.5 CSS px, alpha 0.85 -> 1.
  const TELL_EDGE_CSS = 3.5;
  const TELL_PULSE_CSS = 1;
  const TELL_EDGE_A0 = 0.85;
  const TELL_EDGE_A1 = 1;
  const TELL_PULSE_HZ = 3;
  // Regular monster warnings: quiet amber, thin edge, no pulse, no outline.
  const MOB_FILL = '#e0a060';
  const MOB_EDGE = '#ffd0a0';
  const MOB_A0 = 0.06;
  const MOB_A1 = 0.2;
  const MOB_EDGE_A = 0.55;
  const MOB_EDGE_CSS = 1.5;
  const MOB_DOT_MIN = 0.3;
  const tellKey = new Array(TELL_N);
  const tellAge = new Float64Array(TELL_N);
  const tellDur = new Float64Array(TELL_N);
  const tellX = new Float64Array(TELL_N);
  const tellY = new Float64Array(TELL_N);
  for (let i = 0; i < TELL_N; i++) tellKey[i] = null;

  // Low-HP heartbeat: elliptical edge vignette, gradient cached per ctx/size.
  const LOWHP_AT = 0.35;
  const LOWHP_FLOOR = 0.05;
  const FLASH_AT = 0.15;
  const BPM_SLOW = 60;
  const BPM_FAST = 140;
  const LOWHP_ALPHA = 0.55;
  const DUB_AT = 0.3;
  let heartPhase = 0;
  let heartNow = -1;
  let heartBpm = 0;
  let vigCtx = null;
  let vigW = 0;
  let vigH = 0;
  let vigGrad = null;
  let vigBuilds = 0;

  // Gem glint streaks: stateless per call, capped per frame.
  const TRAIL_CAP = 64;
  const TRAIL_SEG = 4;
  const TRAIL_SEC = 0.07;
  const TRAIL_MAX_CSS = 22;
  const GEM_GLINT = '#5fd8ff';
  let trailCount = 0;

  // Boss guard: pale ring when a hit glances off Malgrath's hide.
  const GUARD_N = 4;
  const GUARD_GAP = 0.18;
  const GUARD_DUR = 0.22;
  const GUARD_DUR_CALM = 0.12;
  const GUARD_GROW = 0.15;
  const GUARD_ALPHA = 0.8;
  const GUARD_CSS = 2.5;
  const GUARD_R = 40;
  const GUARD_TICKS = 5;
  const GUARD_COLOR = '#e8eef8';
  const guardNumberStyle = Object.freeze({ color: '#9aa0a8', scale: 0.75 });
  const guardOn = new Uint8Array(GUARD_N);
  const guardAge = new Float64Array(GUARD_N);
  const guardDur = new Float64Array(GUARD_N);
  const guardX = new Float64Array(GUARD_N);
  const guardY = new Float64Array(GUARD_N);
  const guardR = new Float64Array(GUARD_N);
  const guardSpin = new Float64Array(GUARD_N);
  const guardCalm = new Uint8Array(GUARD_N);
  let guardAt = -10;
  let guardSerial = 0;
  let heroHalf = 0;
  let whiteAtlas = null;
  let whiteSrc = null; // atlas the white copy was baked from (rebake if Sprites repacks)
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
    let atlas = null;
    try {
      const s = typeof Sprites !== 'undefined' ? Sprites : null;
      atlas = s ? s.atlas : null;
    } catch (e) {
      return whiteAtlas;
    }
    if (whiteAtlas && (whiteSrc === atlas || !atlas)) return whiteAtlas;
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
      whiteSrc = atlas;
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
    p.shard = 0;
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
    if (r === 'uncommon') return 1;
    if (r === 'rare') return 2;
    if (r === 'epic') return 3;
    if (r === 'legendary') return 4;
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
    let slot = null;
    for (let i = 0; i < BEAM_N; i++) {
      if (beams[i].on && beams[i].id === id) slot = beams[i];
    }
    const fresh = !slot;
    if (!slot) slot = takeBeam();
    const r = rarityId(rarity);
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

  function shakeNow() {
    if (shakeLife <= 0 || shakeMax <= 0) return 0;
    const k = shakeLife / shakeMax; // 1 -> 0; outQuad decay: amp * k^2
    return shakeAmp * k * k;
  }

  // Levels 1..4 (S1..S4). Never stacks: replaces the running shake only when
  // its amplitude beats what is left of it. Hard cap 8 art px.
  function shakeLevel(level) {
    const lv = level >= 4 ? 4 : (level >= 1 ? (level | 0) : 0);
    if (!lv) return false;
    let amp = SHAKE_AMP[lv];
    if (amp > SHAKE_CAP) amp = SHAKE_CAP;
    if (!(amp > shakeNow())) return false;
    shakeAt = clock;
    shakeAmp = amp;
    shakeLife = SHAKE_DUR[lv];
    shakeMax = shakeLife;
    shakeSeed = (shakeSeed + 17) % 997;
    return true;
  }

  function noise1(i) {
    const v = Math.sin(i * 12.9898 + shakeSeed * 78.233) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1;
  }

  // Smoothed value noise at 30 Hz, two channels, rotation stays 0.
  function noiseAt(t, ch) {
    const f = t * 30 + ch * 101;
    const i = Math.floor(f);
    const u = f - i;
    const w = u * u * (3 - 2 * u);
    const a = noise1(i);
    return a + (noise1(i + 1) - a) * w;
  }

  function readShake() {
    shakeOut.x = 0;
    shakeOut.y = 0;
    let mag = shakeNow();
    if (!(mag > 0)) return shakeOut;
    if (reducedNow()) mag *= 0.5;
    if (mag > SHAKE_CAP) mag = SHAKE_CAP;
    const t = shakeMax - shakeLife;
    shakeOut.x = noiseAt(t, 0) * mag;
    shakeOut.y = noiseAt(t, 1) * mag;
    return shakeOut;
  }

  function outQuad(u) { return 1 - (1 - u) * (1 - u); }
  function inQuad(u) { return u * u; }
  function outCubic(u) { const v = 1 - u; return 1 - v * v * v; }
  function outBack(u) {
    const c1 = 1.70158;
    const v = u - 1;
    return 1 + (c1 + 1) * v * v * v + c1 * v * v;
  }

  // Hitstop seconds for a hit (0 = none). Normal mobs never; elites 60 ms on
  // any hit, the boss 40 ms on crits only; none with reduced motion. Never
  // stacks: while a stop runs, a new one only raises what is left to the max
  // (not the sum); after it ends the next waits 150 ms. Time runs only in
  // FX.consumeHitstop(dt), which the game calls with its sim dt.
  function hitstopFor(vis) {
    if (!vis || reducedNow()) return 0;
    if (evoBusy()) return 0; // batch 2: never during / right after the evolution cinematic
    const elite = !!vis.elite && !vis.boss;
    const boss = !!vis.boss;
    if (!elite && !boss) return 0;
    const dur = elite ? STOP_ELITE : (vis.crit ? STOP_CRIT : 0);
    if (!(dur > 0)) return 0;
    if (stopLeft > 0) {
      if (dur > stopLeft) stopLeft = dur;
      return stopLeft;
    }
    if (stopClock < stopEnd + STOP_GAP - 1e-9) return 0;
    stopLeft = dur;
    stopEnd = stopClock + dur;
    return dur;
  }

  // Returns the sim dt to use this frame: 0 while frozen, the remainder on
  // the frame a stop ends. Only the sim clock pauses; keep drawing.
  function consumeHitstop(dt) {
    if (!(dt > 0)) return 0;
    stopClock += dt;
    if (stopLeft <= 0) return dt;
    if (stopLeft >= dt) {
      stopLeft -= dt;
      if (stopLeft < 1e-9) stopLeft = 0;
      if (stopLeft === 0) stopEnd = stopClock;
      return 0;
    }
    const rest = dt - stopLeft;
    stopLeft = 0;
    stopEnd = stopClock - rest;
    return rest;
  }

  // Knockback distance in tiles: 6 art px, elites 3, the boss 0.
  function knockTiles(vis) {
    if (!vis || vis.boss) return 0;
    return (vis.elite ? KNOCK_PX_ELITE : KNOCK_PX) / framePx();
  }

  // Fraction of the knockback travelled between age and age + dt (outQuad, 90 ms).
  function knockStep(age, dt) {
    if (!ok(age) || !ok(dt) || dt <= 0 || age >= KNOCK_T) return 0;
    const a0 = age < 0 ? 0 : age / KNOCK_T;
    let a1 = (age + dt) / KNOCK_T;
    if (a1 > 1) a1 = 1;
    return outQuad(a1) - outQuad(a0);
  }

  function flashAlpha() {
    return reducedNow() ? 0.5 : 1;
  }

  // Shared pose (no allocation): scale X/Y around the feet and white overlay
  // alpha. hitAge: s since the last hit (squash). flashLeft: the game's hit
  // flash timer. deathAge: s since death (-1 alive). pop: 0 when FX.kill
  // skipped the white pop (crowd rule).
  function foePose(hitAge, flashLeft, deathAge, pop) {
    pose.sx = 1;
    pose.sy = 1;
    pose.white = flashLeft > 0 ? flashAlpha() : 0;
    if (ok(deathAge) && deathAge >= 0) {
      if (pop === 0) {
        const u = deathAge >= DEATH_T ? 1 : deathAge / DEATH_T;
        const k = 1 - inQuad(u);
        pose.sx = k;
        pose.sy = k;
        pose.white = 0;
      } else if (deathAge < POP_T) {
        const k = 1 + (POP_SCALE - 1) * outQuad(deathAge / POP_T);
        pose.sx = k;
        pose.sy = k;
      } else {
        const u = deathAge >= DEATH_T ? 1 : (deathAge - POP_T) / SHRINK_T;
        const k = POP_SCALE * (1 - inQuad(u));
        pose.sx = k;
        pose.sy = k;
        pose.white = flashAlpha();
      }
      return pose;
    }
    if (ok(hitAge) && hitAge >= 0 && hitAge < SQUASH_T) {
      const e = outBack(hitAge / SQUASH_T);
      pose.sx = SQUASH_X + (1 - SQUASH_X) * e;
      pose.sy = SQUASH_Y + (1 - SQUASH_Y) * e;
    }
    return pose;
  }

  // White overlay for a foe sprite from the cached white atlas, drawn exactly
  // where Sprites.drawFoe puts it (screen px, feet at x, y). One drawImage.
  function drawWhite(ctx, vis, x, y, alpha) {
    if (!ctx || !vis || !(alpha > 0.01) || !ok(x) || !ok(y)) return false;
    const fr = vis.frame;
    if (!fr || !(fr.sw > 0) || !(fr.sh > 0)) return false;
    const img = ensureWhite();
    if (!img) return false;
    // Zoom comes from the last FX.draw; before the first one the size is unknown, so skip.
    if (!(lastZoom > 0)) return false;
    const zoom = lastZoom;
    const sc = vis.scale > 0 ? vis.scale : 1;
    const dw = Math.max(1, Math.round(fr.sw * zoom * sc));
    const dh = Math.max(1, Math.round(fr.sh * zoom * sc));
    const foot = (fr.sh - framePad(fr)) * zoom * sc;
    const dx = Math.round(x - dw / 2);
    const dy = Math.round(y - foot);
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    if (vis.flip) ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, dx + dw, dy, -dw, dh);
    else ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, dw, dh);
    ctx.globalAlpha = prev;
    return true;
  }

  function shardColor(type, opts) {
    const sp = opts && opts.sprite;
    const id = sp || type || '';
    if (id === 'goblin') return SHARD_GOBLIN;
    if (id === 'imp' || id === 'shooter') return SHARD_IMP;
    if (id === 'chort' || id === 'charger' || id === 'boss' || id === 'demon') return SHARD_DEVIL;
    if (id === 'skel' || id === 'armored' || id === 'brute') return SHARD_BONE;
    return opts && opts.color ? opts.color : SHARD_BONE;
  }

  function liveShards() {
    let n = 0;
    for (let i = 0; i < CAP; i++) if (parts[i].shard && parts[i].life > 0) n++;
    return n;
  }

  // Shards over the 120 cap recycle the oldest shard instead of spawning more.
  function takeShard(live) {
    if (live < SHARD_CAP) return takePart();
    let best = -1;
    let bestLife = 1e9;
    for (let i = 0; i < CAP; i++) {
      const p = parts[i];
      if (p.shard && p.life > 0 && p.life < bestLife) { bestLife = p.life; best = i; }
    }
    return best >= 0 ? parts[best] : takePart();
  }

  function spawnShards(x, y, n, tone) {
    if (n <= 0) return;
    let live = liveShards();
    const base = rand() * TAU;
    const stepA = TAU / n;
    const frame = framePx();
    for (let i = 0; i < n; i++) {
      const p = takeShard(live);
      if (!p.shard || p.life <= 0) live++;
      releasePart(p);
      const a = base + i * stepA + (rand() - 0.5) * 0.5;
      // 20-40 art px over 350 ms.
      const dist = (20 + rand() * 20) / frame;
      const sp = dist / SHARD_LIFE;
      p.life = SHARD_LIFE;
      p.max = SHARD_LIFE;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 2;
      const sz = rand() < 0.45 ? 1 : 2;
      p.w = sz;
      p.h = sz;
      p.tone = tone;
      p.peak = 1;
      p.art = 1;
      p.grav = 10;
      p.screen = 0;
      p.shard = 1;
    }
  }

  function queueShards(x, y, n, tone, delay) {
    const i = burstCursor;
    burstCursor = (burstCursor + 1) % BURST_N;
    if (burstOn[i]) spawnShards(burstX[i], burstY[i], burstNum[i], burstTone[i]);
    burstOn[i] = 1;
    burstT[i] = delay;
    burstX[i] = x;
    burstY[i] = y;
    burstNum[i] = n;
    burstTone[i] = tone;
  }

  // Returns 1 when the white pop should play, 0 when the crowd rule skips it.
  function doKill(x, y, type, opts) {
    if (!ok(x) || !ok(y)) return 0;
    noteKill();
    const elite = !!(opts && opts.elite);
    const boss = !!(opts && opts.boss) || type === 'boss';
    const live = opts && ok(opts.crowd) ? opts.crowd : 0;
    let pop = 1;
    let n;
    if (boss) n = 16;
    else if (elite) n = 10;
    else if (live > THIN_N) {
      crowdKill = (crowdKill + 1) & 1;
      n = 1 + crowdKill;
      if (live > CROWD_N && crowdKill === 0) pop = 0;
    } else n = 4 + ((rand() * 3) | 0);
    const tone = colorTone(shardColor(type, opts));
    queueShards(x, y, n, tone, pop ? POP_T : 0);
    if (elite || boss) {
      addRing(0, x, y, 0.2, 24 / framePx(), 2, 0.25, 0, 0);
      rings[lastRing].ease = 1;
      if (boss) addRing(0, x, y, 0.28, 1.45, 2, 0.3, 0.04, 0);
      shakeLevel(boss ? 4 : 2);
    }
    if (!pop) return 0;
    if (reducedNow()) {
      if (!elite && !boss) addRing(0, x, y, 0.08, 0.62, 2, 0.2, 0, 0);
      return 1;
    }
    const fr = opts && opts.frame;
    if (!fr || !(fr.sw > 0) || !(fr.sh > 0)) return 1;
    if (!deathWindowOpen()) return 1;
    commitDeathWindow();
    spawnSil(x, y, opts, 0.6, 0.012);
    return 1;
  }

  function addRing(space, x, y, r0, r1, thick, dur, delay, tone) {
    const r = takeRing();
    lastRing = rings.indexOf(r);
    r.ease = 0;
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

  function step(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    clock += dt;
    evoStep(dt); // batch 2
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
    for (let i = 0; i < BURST_N; i++) {
      if (!burstOn[i]) continue;
      burstT[i] -= dt;
      if (burstT[i] <= 0) {
        burstOn[i] = 0;
        spawnShards(burstX[i], burstY[i], burstNum[i], burstTone[i]);
      }
    }
    for (let i = 0; i < BEAM_N; i++) {
      if (beams[i].on) beams[i].age += dt;
    }
    for (let i = 0; i < TELL_N; i++) {
      if (tellKey[i] !== null) tellAge[i] += dt;
    }
    for (let i = 0; i < GUARD_N; i++) {
      if (!guardOn[i]) continue;
      guardAge[i] += dt;
      if (guardAge[i] >= guardDur[i]) guardOn[i] = 0;
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

  function legendAlpha() {
    if (reducedNow()) return 0.55;
    const s = Math.sin(clock * 6.283185307179586);
    return 0.46 + s * 0.16;
  }

  function rarityFill(r) {
    if (r === 1) return '#5ed37a';
    if (r === 2) return '#4c7cff';
    if (r === 3) return '#b48cff';
    if (r === 4) return '#f4f2ff';
    return '#b9b4aa';
  }

  function paintBeams(ctx, zoom, tile, camX, camY, viewW, viewH) {
    const a = beamAlpha();
    const calm = reducedNow();
    const cell = Math.max(1, zoom | 0);
    for (let i = 0; i < BEAM_N; i++) {
      const b = beams[i];
      if (!b.on || b.r <= 0) continue;
      const sx = Math.round(b.x * tile + camX);
      const sy = Math.round(b.y * tile + camY);
      const colA = b.r === 4 ? legendAlpha() : a;
      ctx.globalAlpha = colA;
      if (b.r === 1) {
        const s = 6 * cell;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#5ed37a';
        ctx.fillRect(sx - (s >> 1), sy - (cell >> 1), s, cell);
        ctx.fillRect(sx - (cell >> 1), sy - (s >> 1), cell, s);
        continue;
      }
      const hArt = b.r === 2 ? 24 : (b.r === 3 ? 56 : 72);
      const wArt = b.r === 2 ? 2 : (b.r === 3 ? 3 : 4);
      const h = hArt * cell;
      const w = wArt * cell;
      const x0 = Math.round(sx - w / 2);
      const y0 = Math.round(sy - h);
      if (sx > -w && sx < viewW + w && sy > -8 && y0 < viewH + 8) {
        if (b.r === 4) {
          ctx.fillStyle = '#f4f2ff';
          ctx.fillRect(x0, y0, w, h);
          for (let row = 0; row < hArt; row++) {
            ctx.fillStyle = (row & 1) ? '#c9b6ff' : '#7fb2ff';
            const yy = y0 + row * cell;
            ctx.fillRect(x0, yy, cell, cell);
            ctx.fillRect(x0 + (wArt - 1) * cell, yy, cell, cell);
          }
        } else {
          ctx.fillStyle = rarityFill(b.r);
          ctx.fillRect(x0, y0, w, h);
        }
        ctx.fillStyle = rarityFill(b.r);
        ctx.fillRect(sx - cell, sy - cell, cell * 2, cell);
        if (b.r >= 3) {
          const count = b.r === 4 ? 3 : 2;
          ctx.fillStyle = b.r === 4 ? '#7fb2ff' : '#b48cff';
          for (let s = 0; s < count; s++) {
            let ph = (s + 1) * (hArt / (count + 1));
            if (!calm) ph = (clock * 20 + s * (hArt / count)) % hArt;
            ctx.fillRect(Math.round(sx + w * 0.5 + cell), Math.round(sy - ph * cell), cell, cell);
          }
        }
      }
      if (sy > -16 && sy < viewH + 16 && sx > -40 && sx < viewW + 40) {
        paintGround(ctx, Math.round(sx), Math.round(sy), cell, rarityFill(b.r), b.r === 4 ? colA : 1);
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

  function tellSlot(id, make) {
    const key = id == null ? 0 : id;
    let free = -1;
    let oldest = 0;
    for (let i = 0; i < TELL_N; i++) {
      if (tellKey[i] === key) return i;
      if (tellKey[i] === null) { if (free < 0) free = i; }
      else if (tellAge[i] > tellAge[oldest]) oldest = i;
    }
    if (!make) return -1;
    return free >= 0 ? free : oldest;
  }

  function tellOn(id, x, y, tellMs) {
    const i = tellSlot(id, true);
    tellKey[i] = id == null ? 0 : id;
    tellAge[i] = 0;
    tellDur[i] = ok(tellMs) && tellMs > 0 ? tellMs / 1000 : 1;
    tellX[i] = ok(x) ? x : 0;
    tellY[i] = ok(y) ? y : 0;
  }

  function tellOff(id) {
    const i = tellSlot(id, false);
    if (i >= 0) tellKey[i] = null;
  }

  function tellProgress(id) {
    const i = tellSlot(id, false);
    if (i < 0) return -1;
    const u = tellAge[i] / (tellDur[i] || 1);
    return u < 0 ? 0 : (u > 1 ? 1 : u);
  }

  // Device px per CSS px for this canvas (falls back to 1 off-DOM).
  function cssScale(canvas) {
    const cw = canvas && canvas.clientWidth;
    if (!(cw > 0) || !(canvas.width > 0)) return 1;
    const k = canvas.width / cw;
    return k > 0.5 && k < 8 ? k : 1;
  }

  function tellPath(ctx, shape, x, y, a, b, c, k) {
    ctx.beginPath();
    if (shape === 'cone') {
      const r = a * k;
      ctx.moveTo(x, y);
      ctx.arc(x, y, r > 0 ? r : 0, b - c / 2, b + c / 2);
      ctx.closePath();
    } else if (shape === 'line') {
      const ex = x + (a - x) * k;
      const ey = y + (b - y) * k;
      const dx = a - x;
      const dy = b - y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = (-dy / d) * c;
      const ny = (dx / d) * c;
      const ang = Math.atan2(dy, dx);
      ctx.moveTo(x + nx, y + ny);
      ctx.lineTo(ex + nx, ey + ny);
      ctx.arc(ex, ey, c, ang + Math.PI / 2, ang - Math.PI / 2, true);
      ctx.lineTo(x - nx, y - ny);
      ctx.arc(x, y, c, ang - Math.PI / 2, ang + Math.PI / 2, true);
      ctx.closePath();
    } else {
      const r = a * k;
      ctx.arc(x, y, r > 0 ? r : 0, 0, TAU);
    }
  }

  function tellArgsOk(ctx, shape, x, y, a, b, c) {
    if (!ctx || !ok(x) || !ok(y) || !ok(a)) return false;
    if (shape === 'cone') return ok(b) && ok(c);
    if (shape === 'line') return ok(b) && ok(c) && c > 0;
    return a > 0;
  }

  function clamp01(u) {
    return ok(u) ? (u < 0 ? 0 : (u > 1 ? 1 : u)) : 1;
  }

  // 0..1 boss pulse; steady mid value with reduced motion.
  function tellPulse() {
    if (reducedNow()) return 0.5;
    return 0.5 + 0.5 * Math.sin(clock * TAU * TELL_PULSE_HZ);
  }

  // Base zone at a0, then a fill grown from the origin that stacks to
  // a0 + (a1 - a0) * t inside the grown area.
  function tellFill(ctx, shape, x, y, a, b, c, t, fill, a0, a1) {
    ctx.fillStyle = fill;
    ctx.globalAlpha = a0;
    tellPath(ctx, shape, x, y, a, b, c, 1);
    ctx.fill();
    if (t <= 0.01) return false;
    ctx.globalAlpha = ((a1 - a0) * t) / (1 - a0);
    tellPath(ctx, shape, x, y, a, b, c, t);
    ctx.fill();
    return true;
  }

  function paintTell(ctx, shape, x, y, a, b, c, u) {
    if (shape === 'dot') shape = 'circle';
    if (!tellArgsOk(ctx, shape, x, y, a, b, c)) return;
    const t = clamp01(u);
    const px = cssScale(ctx.canvas);
    const prevAlpha = ctx.globalAlpha;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (tellFill(ctx, shape, x, y, a, b, c, t, TELL_FILL, TELL_A0, TELL_A1)) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = TELL_EDGE;
      ctx.lineWidth = px;
      ctx.stroke();
    }
    // Outer edge: a dark outline 1 CSS px each side under a bright pulsing line.
    const s = tellPulse();
    const edge = (TELL_EDGE_CSS + TELL_PULSE_CSS * s) * px;
    tellPath(ctx, shape, x, y, a, b, c, 1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = TELL_DARK;
    ctx.lineWidth = edge + 2 * px;
    ctx.stroke();
    ctx.globalAlpha = TELL_EDGE_A0 + (TELL_EDGE_A1 - TELL_EDGE_A0) * s;
    ctx.strokeStyle = TELL_EDGE;
    ctx.lineWidth = edge;
    ctx.stroke();
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
  }

  // Quiet warning for regular monsters: 'line' (charge lane, a/b end, c half
  // width) or 'dot' (orb whose radius grows from 30% of a to a).
  function paintMobTell(ctx, shape, x, y, a, b, c, u) {
    if (shape !== 'line') shape = 'dot';
    if (!tellArgsOk(ctx, shape, x, y, a, b, c)) return;
    const t = clamp01(u);
    const px = cssScale(ctx.canvas);
    const prevAlpha = ctx.globalAlpha;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = MOB_FILL;
    if (shape === 'line') {
      tellFill(ctx, shape, x, y, a, b, c, t, MOB_FILL, MOB_A0, MOB_A1);
      tellPath(ctx, shape, x, y, a, b, c, 1);
    } else {
      ctx.globalAlpha = MOB_A0 + (MOB_A1 - MOB_A0) * t;
      tellPath(ctx, 'circle', x, y, a, 0, 0, MOB_DOT_MIN + (1 - MOB_DOT_MIN) * t);
      ctx.fill();
    }
    ctx.globalAlpha = MOB_EDGE_A;
    ctx.strokeStyle = MOB_EDGE;
    ctx.lineWidth = MOB_EDGE_CSS * px;
    ctx.stroke();
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevOp;
  }

  function heartRate(hp) {
    if (!ok(hp) || hp >= LOWHP_AT) return 0;
    const k = hp <= LOWHP_FLOOR ? 1 : (LOWHP_AT - hp) / (LOWHP_AT - LOWHP_FLOOR);
    return BPM_SLOW + (BPM_FAST - BPM_SLOW) * k;
  }

  // Advances the beat phase once per distinct nowMs (gaps capped at 0.1s),
  // so drawLowHp and lowHpFlash can share a frame without double counting.
  function heartTick(hp, nowMs) {
    heartBpm = heartRate(hp);
    if (!ok(nowMs)) return;
    if (heartNow >= 0 && nowMs > heartNow && heartBpm > 0) {
      let dt = (nowMs - heartNow) / 1000;
      if (dt > 0.1) dt = 0.1;
      heartPhase += dt * heartBpm / 60;
      heartPhase -= Math.floor(heartPhase);
    }
    if (nowMs !== heartNow) heartNow = nowMs;
  }

  function lubEnv(ph) {
    return Math.exp(-ph / 0.6);
  }

  // Lub then a softer dub 0.3 beat later. The dub rides on the lub's tail,
  // so brightness drops once per beat (<= 2.33 Hz at 140 bpm).
  function heartPulse(ph) {
    let v = lubEnv(ph);
    if (ph >= DUB_AT) v += 0.35 * Math.exp(-(ph - DUB_AT) / 0.25);
    return v > 1 ? 1 : v;
  }

  function lowHpSeverity(hp) {
    if (hp <= LOWHP_FLOOR) return 1;
    return (LOWHP_AT - hp) / (LOWHP_AT - LOWHP_FLOOR);
  }

  function lowHpAlpha(hp) {
    if (!ok(hp) || hp >= LOWHP_AT) return 0;
    const p = reducedNow() ? 0.5 : heartPulse(heartPhase);
    return LOWHP_ALPHA * (0.55 + 0.45 * p) * (0.5 + 0.5 * lowHpSeverity(hp));
  }

  function vignette(ctx, w, h) {
    if (vigGrad && vigCtx === ctx && vigW === w && vigH === h) return vigGrad;
    // Unit-space ellipse (scaled to the view at draw time): clear inside 0.62,
    // #5a0a06 at the screen edge midpoints, #a0140a in the corners.
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.4142);
    g.addColorStop(0, 'rgba(90, 10, 6, 0)');
    g.addColorStop(0.44, 'rgba(90, 10, 6, 0)');
    g.addColorStop(0.6, 'rgba(90, 10, 6, 0.45)');
    g.addColorStop(0.71, 'rgba(110, 14, 8, 0.85)');
    g.addColorStop(1, 'rgba(160, 20, 10, 1)');
    vigGrad = g;
    vigCtx = ctx;
    vigW = w;
    vigH = h;
    vigBuilds++;
    return g;
  }

  function drawLowHp(ctx, w, h, hp, nowMs) {
    heartTick(hp, nowMs);
    if (!ctx || !(w > 0) || !(h > 0)) return 0;
    const a = lowHpAlpha(hp);
    if (a <= 0.005) return 0;
    const g = vignette(ctx, w, h);
    ctx.save();
    ctx.setTransform(w / 2, 0, 0, h / 2, w / 2, h / 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    return a;
  }

  // 0..1 HP-bar flash below 15%: lub only (one flash per beat, <= 2.33 Hz),
  // stronger as HP falls. Steady 0.5 with reduced motion.
  function lowHpFlash(hp, nowMs) {
    heartTick(hp, nowMs);
    if (!ok(hp) || hp >= FLASH_AT) return 0;
    if (reducedNow()) return 0.5;
    const sev = hp <= LOWHP_FLOOR ? 1 : (FLASH_AT - hp) / (FLASH_AT - LOWHP_FLOOR);
    return lubEnv(heartPhase) * (0.6 + 0.4 * sev);
  }

  function drawHpBarFlash(ctx, x, y, w, h, hp, nowMs) {
    const f = lowHpFlash(hp, nowMs);
    if (!ctx || !(f > 0.02) || !ok(x) || !ok(y) || !(w > 0) || !(h > 0)) return f;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = 0.55 * f;
    ctx.fillStyle = '#ffd8c8';
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = prev;
    return f;
  }

  // Short fading streak behind a moving gem plus a tiny blinking sparkle.
  // x, y: screen px; vx, vy: screen px per second.
  function gemTrail(ctx, x, y, vx, vy, colour) {
    if (!ctx || !ok(x) || !ok(y) || !ok(vx) || !ok(vy)) return false;
    if (trailCount >= TRAIL_CAP) return false;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 20) return false;
    trailCount++;
    const px = cssScale(ctx.canvas);
    let len = speed * TRAIL_SEC;
    const max = TRAIL_MAX_CSS * px;
    if (len > max) len = max;
    const ux = -vx / speed;
    const uy = -vy / speed;
    const seg = len / TRAIL_SEG;
    const prevAlpha = ctx.globalAlpha;
    ctx.lineCap = 'round';
    ctx.strokeStyle = typeof colour === 'string' && colour ? colour : GEM_GLINT;
    for (let i = 0; i < TRAIL_SEG; i++) {
      const f = 1 - i / TRAIL_SEG;
      ctx.globalAlpha = 0.7 * f;
      ctx.lineWidth = (0.8 + 2.2 * f) * px;
      ctx.beginPath();
      ctx.moveTo(x + ux * seg * i, y + uy * seg * i);
      ctx.lineTo(x + ux * seg * (i + 1), y + uy * seg * (i + 1));
      ctx.stroke();
    }
    // Sparkle: phase per trail slot so neighbours do not blink together.
    const tw = Math.sin(clock * 18 + trailCount * 2.3);
    if (tw > 0.2) {
      const r = (1 + 1.5 * tw) * px;
      const t = px;
      const sx = x - ux * 2 * px + uy * 3 * px;
      const sy = y - uy * 2 * px - ux * 3 * px;
      ctx.globalAlpha = 0.9 * tw;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - r, sy - t / 2, r * 2, t);
      ctx.fillRect(sx - t / 2, sy - r, t, r * 2);
    }
    ctx.globalAlpha = prevAlpha;
    return true;
  }

  // x, y in world tiles (same space as FX.hit / FX.telegraph); radius in CSS px.
  function bossGuard(x, y, radius) {
    if (!ok(x) || !ok(y)) return false;
    if (clock - guardAt < GUARD_GAP - 1e-9) return false;
    let slot = -1;
    let oldest = 0;
    for (let i = 0; i < GUARD_N; i++) {
      if (!guardOn[i]) { slot = i; break; }
      if (guardAge[i] > guardAge[oldest]) oldest = i;
    }
    if (slot < 0) slot = oldest;
    const calm = reducedNow();
    guardAt = clock;
    guardSerial++;
    guardOn[slot] = 1;
    guardAge[slot] = 0;
    guardDur[slot] = calm ? GUARD_DUR_CALM : GUARD_DUR;
    guardX[slot] = x;
    guardY[slot] = y;
    guardR[slot] = ok(radius) && radius > 0 ? radius : GUARD_R;
    guardSpin[slot] = guardSerial * 1.9;
    guardCalm[slot] = calm ? 1 : 0;
    return true;
  }

  function guardLive() {
    let n = 0;
    for (let i = 0; i < GUARD_N; i++) if (guardOn[i]) n++;
    return n;
  }

  function paintGuards(ctx, tile, camX, camY, viewW, viewH) {
    let any = 0;
    for (let i = 0; i < GUARD_N; i++) any |= guardOn[i];
    if (!any) return;
    const px = cssScale(ctx.canvas);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = GUARD_COLOR;
    ctx.lineCap = 'round';
    for (let i = 0; i < GUARD_N; i++) {
      if (!guardOn[i]) continue;
      const u = guardDur[i] > 0 ? guardAge[i] / guardDur[i] : 1;
      if (u >= 1) continue;
      const cx = guardX[i] * tile + camX;
      const cy = guardY[i] * tile + camY;
      const r = guardR[i] * px * (guardCalm[i] ? 1 : 1 + GUARD_GROW * u);
      if (cx < -r - 20 || cy < -r - 20 || cx > viewW + r + 20 || cy > viewH + r + 20) continue;
      const a = GUARD_ALPHA * (1 - u) * (1 - u * 0.35);
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.lineWidth = GUARD_CSS * px;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
      // Shield sheen: short radial ticks just outside the ring, one stroke.
      const r0 = r + 2.5 * px;
      const r1 = r + 7 * px;
      const spin = guardSpin[i];
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      for (let k = 0; k < GUARD_TICKS; k++) {
        const ang = spin + (k * TAU) / GUARD_TICKS;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        ctx.moveTo(cx + c * r0, cy + sn * r0);
        ctx.lineTo(cx + c * r1, cy + sn * r1);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Death shards: flat-colour rects, one fillStyle per colour, alpha 1, no
  // save/restore. They shrink over their last 100 ms instead of fading.
  function paintShards(ctx, zoom, tile, camX, camY, viewW, viewH) {
    let nTone = 0;
    for (let i = 0; i < CAP; i++) {
      const p = parts[i];
      if (!p.shard || p.life <= 0) continue;
      let seen = false;
      for (let k = 0; k < nTone; k++) if (shardTones[k] === p.tone) { seen = true; break; }
      if (!seen && nTone < SHARD_TONE_N) shardTones[nTone++] = p.tone;
    }
    if (!nTone) return;
    ctx.globalAlpha = 1;
    for (let k = 0; k < nTone; k++) {
      const tone = shardTones[k];
      ctx.fillStyle = tone >= 20 ? (tints[tone - 20] || '#e8e0c8') : (toneColor[tone] || '#ffffff');
      for (let i = 0; i < CAP; i++) {
        const p = parts[i];
        if (!p.shard || p.life <= 0 || p.tone !== tone) continue;
        const sx = Math.round(p.x * tile + camX);
        const sy = Math.round(p.y * tile + camY);
        if (sx < -20 || sy < -20 || sx > viewW + 20 || sy > viewH + 20) continue;
        const k2 = p.life < 0.1 ? p.life / 0.1 : 1;
        const d = Math.max(1, Math.round(p.w * zoom * k2));
        ctx.fillRect(sx, sy, d, d);
      }
    }
  }

  // ---- game feel batch 2: Dawnbreaker evolution cinematic + hero walk ----
  // design/game-feel.md section 6 (evolution moment) and section 4 (hero walk).
  // Self-contained: state, helpers and paint for batch 2 live here; the only
  // touches elsewhere are one-line calls marked "batch 2" (step, paint,
  // evolve, hitstopFor, reset) and the "batch 2" API block. Everything rides
  // the FX clock (FX.update dt). Preallocated; nothing allocates per frame.

  // Evolution cinematic timings in seconds. Full: 1.6 s. Reduced motion: a
  // 0.8 s cut (no icon flight, no ring growth, no title overshoot, 50% flash).
  const EVO_FULL = { dimIn: 0.3, flyA: 0.3, flyB: 0.9, flash: 0.08, ringA: 0.9, ringB: 1.2, title: 0.25, fire: 1.2, end: 1.6 };
  const EVO_SHORT = { dimIn: 0.15, flyA: 0.15, flyB: 0.45, flash: 0.08, ringA: 0.45, ringB: 0.6, title: 0, fire: 0.6, end: 0.8 };
  const EVO_DIM = 0.6;          // 60% black
  const EVO_GOLD = '#ffd24a';
  const EVO_GOLD_DEEP = '#b07a12';
  const EVO_FLASH_A = 0.6;      // shares the 60% white photosensitivity cap
  const EVO_QUIET = 0.15;       // hitstop stays off this long after the cinematic
  let evoOn = 0;
  let evoAge = 0;
  let evoT = EVO_FULL;
  let evoShort = 0;
  let evoX = 0;
  let evoY = 0;
  let evoFace = 1;
  let evoSprite = 'hero';
  let evoShook = 0;
  let evoFlashed = 0;
  let evoFlashLeft = 0;
  let evoQuiet = 0;
  let goldAtlas = null;
  let goldSrc = null;
  let gauntletImg = null;

  function evoBusy() {
    return evoOn === 1 || evoQuiet > 0;
  }

  function evoStart(id, opts) {
    if (evoOn) return 0;
    evoOn = 1;
    evoAge = 0;
    evoShort = reducedNow() ? 1 : 0;
    evoT = evoShort ? EVO_SHORT : EVO_FULL;
    evoX = opts && ok(opts.x) ? opts.x : 0;
    evoY = opts && ok(opts.y) ? opts.y : 0;
    evoFace = opts && opts.facing < 0 ? -1 : 1;
    evoSprite = opts && opts.sprite ? opts.sprite : 'hero';
    evoShook = 0;
    evoFlashed = 0;
    evoFlashLeft = 0;
    // Never stacks with hitstop: a running stop is dropped, new ones refused.
    stopLeft = 0;
    return evoT.end;
  }

  function evoStep(dt) {
    if (evoFlashLeft > 0) evoFlashLeft = Math.max(0, evoFlashLeft - dt);
    if (evoQuiet > 0) evoQuiet = Math.max(0, evoQuiet - dt);
    if (!evoOn) return;
    evoAge += dt;
    const t = evoT;
    if (!evoFlashed && evoAge >= t.flyB) {
      evoFlashed = 1;
      // Merge flash, 80 ms, inside the shared 3-per-second flash budget.
      if (tryConsumeFlash()) evoFlashLeft = t.flash;
    }
    if (!evoShook && evoAge >= t.ringA) {
      evoShook = 1;
      shakeLevel(3); // S3; reduced motion halves it (shake rules)
    }
    if (evoAge >= t.end) {
      evoOn = 0;
      evoQuiet = EVO_QUIET;
    }
  }

  // Sim stays paused while this is true (0 .. fire).
  function evoHold() {
    return evoOn === 1 && evoAge < evoT.fire;
  }

  // Title scale for the game's banner: -1 before it shows, then 0.6 -> 1.0
  // outBack over 250 ms and hold (reduced motion: 1, no overshoot).
  function evoTitleScale() {
    if (!evoOn || evoAge < evoT.ringA) return -1;
    if (evoShort || !(evoT.title > 0)) return 1;
    const u = (evoAge - evoT.ringA) / evoT.title;
    if (u >= 1) return 1;
    return 0.6 + 0.4 * outBack(u);
  }

  function evoDimAlpha() {
    if (!evoOn) return 0;
    const t = evoT;
    if (evoAge < t.dimIn) return EVO_DIM * outQuad(evoAge / t.dimIn);
    if (evoAge < t.fire) return EVO_DIM;
    const u = (evoAge - t.fire) / (t.end - t.fire);
    return u >= 1 ? 0 : EVO_DIM * (1 - outQuad(u));
  }

  // 0..1 strength of the gold hero glow (and hero/icon visibility).
  function evoGlow() {
    if (!evoOn) return 0;
    const t = evoT;
    if (evoAge < t.dimIn) return outQuad(evoAge / t.dimIn);
    if (evoAge < t.fire) return 1;
    const u = (evoAge - t.fire) / (t.end - t.fire);
    return u >= 1 ? 0 : 1 - u;
  }

  function ensureGold() {
    let atlas = null;
    try {
      const s = typeof Sprites !== 'undefined' ? Sprites : null;
      atlas = s ? s.atlas : null;
    } catch (e) {
      return goldAtlas;
    }
    if (goldAtlas && (goldSrc === atlas || !atlas)) return goldAtlas;
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
      g.fillStyle = EVO_GOLD;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'source-over';
      goldAtlas = c;
      goldSrc = atlas;
      return c;
    } catch (e) {
      return null;
    }
  }

  // 12x12 pixel Iron Gauntlet icon, painted once.
  function ensureGauntlet() {
    if (gauntletImg) return gauntletImg;
    if (typeof document === 'undefined' || !document.createElement) return null;
    try {
      const c = document.createElement('canvas');
      c.width = 12;
      c.height = 12;
      const g = c.getContext('2d');
      if (!g || typeof g.fillRect !== 'function') return null;
      g.fillStyle = '#14120f';
      g.fillRect(1, 0, 10, 12);
      g.fillStyle = '#8c939e';
      g.fillRect(2, 1, 2, 4);
      g.fillRect(4, 1, 2, 4);
      g.fillRect(6, 1, 2, 4);
      g.fillRect(8, 2, 2, 3);
      g.fillRect(2, 5, 8, 4);
      g.fillStyle = '#d6dbe2';
      g.fillRect(2, 1, 1, 3);
      g.fillRect(4, 1, 1, 3);
      g.fillRect(6, 1, 1, 3);
      g.fillRect(2, 5, 7, 1);
      g.fillStyle = '#6a4a2a';
      g.fillRect(3, 9, 6, 2);
      gauntletImg = c;
      return c;
    } catch (e) {
      return null;
    }
  }

  function heroFrame() {
    try {
      const s = typeof Sprites !== 'undefined' ? Sprites : null;
      return s && s.frameRect ? s.frameRect(evoSprite, 'idle', 0) : null;
    } catch (e) {
      return null;
    }
  }

  // One atlas blit, feet-anchored at (x, y), optionally scaled about the body centre.
  function blitFrame(ctx, img, fr, x, y, zoom, k, flip) {
    const dw = Math.max(1, Math.round(fr.sw * zoom * k));
    const dh = Math.max(1, Math.round(fr.sh * zoom * k));
    const foot = (fr.sh - framePad(fr)) * zoom;
    const cy = y - foot + (fr.sh * zoom) / 2;
    const dx = Math.round(x - dw / 2);
    const dy = Math.round(cy - dh / 2);
    if (flip) ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, dx + dw, dy, -dw, dh);
    else ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, dw, dh);
  }

  function paintEvo(ctx, zoom, tile, camX, camY, viewW, viewH) {
    if (!evoOn) {
      if (evoFlashLeft > 0) paintEvoFlash(ctx, viewW, viewH);
      return;
    }
    const t = evoT;
    const cell = Math.max(1, zoom | 0);
    const dim = evoDimAlpha();
    if (dim > 0.01) {
      ctx.globalAlpha = dim;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, viewW, viewH);
    }
    const hx = evoX * tile + camX;
    const hy = evoY * tile + camY;
    const fr = heroFrame();
    const half = fr ? (fr.sh - framePad(fr)) * zoom * 0.5 : 8 * zoom;
    const by = hy - half; // body centre
    const glow = evoGlow();
    ctx.imageSmoothingEnabled = false;
    if (fr && glow > 0.01) {
      const gold = ensureGold();
      let atlas = null;
      try { atlas = typeof Sprites !== 'undefined' ? Sprites.atlas : null; } catch (e) { atlas = null; }
      const flip = evoFace > 0;
      if (gold) {
        ctx.globalAlpha = 0.45 * glow;
        blitFrame(ctx, gold, fr, hx, hy, zoom, 1.22, flip);
      }
      if (atlas && dim > 0.01) {
        // The hero sits above the dim.
        ctx.globalAlpha = 1;
        blitFrame(ctx, atlas, fr, hx, hy, zoom, 1, flip);
      }
      if (gold) {
        ctx.globalAlpha = 0.5 * glow;
        blitFrame(ctx, gold, fr, hx, hy, zoom, 1, flip);
      }
    }
    // Oathblade + Iron Gauntlet fly into the hero (inQuad) and merge.
    if (evoAge >= t.flyA && evoAge < t.flyB) {
      const u = (evoAge - t.flyA) / (t.flyB - t.flyA);
      const blade = ensureBlade();
      const gaunt = ensureGauntlet();
      let bx;
      let bY;
      let gx;
      let gy;
      let a = 1;
      if (evoShort) {
        a = u;
        bx = hx - 10 * cell;
        gx = hx + 10 * cell;
        bY = by;
        gy = by;
      } else {
        const p = inQuad(u);
        const sx = 0.36 * viewW;
        const sy = 0.22 * viewH;
        bx = hx - sx * (1 - p);
        gx = hx + sx * (1 - p);
        bY = by - sy * (1 - p);
        gy = bY;
      }
      ctx.globalAlpha = a;
      if (blade) {
        const w = BLADE_W * cell;
        const h = BLADE_H * cell;
        // FX.draw runs at the identity transform: rotate -45 deg in place, no save/restore.
        ctx.setTransform(0.7071, -0.7071, 0.7071, 0.7071, Math.round(bx), Math.round(bY));
        ctx.drawImage(blade, Math.round(-w / 2), Math.round(-h / 2), Math.round(w), Math.round(h));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (gaunt) {
        const s = 18 * cell;
        ctx.drawImage(gaunt, Math.round(gx - s / 2), Math.round(gy - s / 2), s, s);
      }
    }
    // Gold ring from 0 to the far screen corner (outCubic), then fades with the dim.
    if (evoAge >= t.ringA) {
      const u = Math.min(1, (evoAge - t.ringA) / (t.ringB - t.ringA));
      const fx0 = hx > viewW - hx ? hx : viewW - hx;
      const fy0 = by > viewH - by ? by : viewH - by;
      const far = Math.sqrt(fx0 * fx0 + fy0 * fy0) + 4 * cell;
      let r;
      let a;
      if (evoShort) {
        r = 0.36 * (viewW < viewH ? viewW : viewH);
        a = u < 1 ? u : 1;
      } else {
        r = far * outCubic(u);
        a = 1;
      }
      if (evoAge > t.fire) a *= Math.max(0, 1 - (evoAge - t.fire) / (t.end - t.fire));
      if (r > 1 && a > 0.02) {
        ctx.globalAlpha = a;
        ctx.lineWidth = 3 * cell;
        ctx.strokeStyle = EVO_GOLD_DEEP;
        ctx.beginPath();
        ctx.arc(hx, by, r + cell, 0, TAU);
        ctx.stroke();
        ctx.lineWidth = 2 * cell;
        ctx.strokeStyle = EVO_GOLD;
        ctx.beginPath();
        ctx.arc(hx, by, r, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (evoFlashLeft > 0) paintEvoFlash(ctx, viewW, viewH);
  }

  function paintEvoFlash(ctx, viewW, viewH) {
    let a = EVO_FLASH_A * (evoFlashLeft / evoT.flash) * (evoShort ? 0.5 : 1);
    if (a > EVO_FLASH_A) a = EVO_FLASH_A;
    if (a <= 0.02) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.globalAlpha = 1;
  }

  // Hero walk (section 4). The game calls FX.heroWalk once per sim step and
  // reads FX.heroPose() when drawing the hero (feet-anchored transform).
  const WALK_FPS = 10;
  const WALK_FPS_FAST = 12;
  const LEAN_RAD = (4 * Math.PI) / 180;
  const LEAN_T = 0.08;
  const BOB_ART = 1;
  const DUST_GAP = 0.18;
  const DUST_LIFE = 0.3;
  const DUST_COLOR = '#a8987a';
  const STOP_T = 0.1;
  const STOP_SX = 1.08;
  const STOP_SY = 0.92;
  const BREATH_T = 1.2;
  const BREATH_Y = 0.03;
  let walkOn = 0;
  let walkPhase = 0;
  let leanFrom = 0;
  let leanTo = 0;
  let leanAge = 1;
  let stopAge = 9;
  let breathT = 0;
  let dustT = 0;
  const walkPose = { rot: 0, sx: 1, sy: 1, bob: 0, animT: 0 };

  function leanNow() {
    const u = leanAge >= LEAN_T ? 1 : leanAge / LEAN_T;
    return leanFrom + (leanTo - leanFrom) * outQuad(u);
  }

  function spawnDust(x, y, dx) {
    const tone = colorTone(DUST_COLOR);
    const back = dx > 0 ? -1 : dx < 0 ? 1 : 0;
    for (let k = 0; k < 2; k++) {
      const p = takePart();
      p.life = DUST_LIFE;
      p.max = DUST_LIFE;
      p.x = x + (k ? 0.12 : -0.12) * (back || 1) * 0.5;
      p.y = y - 0.03;
      p.vx = back * (0.5 + rand() * 0.4) + (rand() - 0.5) * 0.3;
      p.vy = -0.45 - rand() * 0.35;
      p.w = 1;
      p.h = 1;
      p.tone = tone;
      p.peak = 0.75;
      p.art = 1;
      p.grav = 2.2;
      p.screen = 0;
    }
  }

  function heroWalk(dt, dx, dy, moving, x, y, speedRatio) {
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 0.05;
    const calm = reducedNow();
    const on = moving ? 1 : 0;
    // Ages count from the frame an event happens (that frame draws age 0).
    if (stopAge < 9) stopAge += on ? 9 : dt;
    let target = 0;
    if (on && !calm) {
      const len = Math.sqrt(dx * dx + dy * dy);
      const hx = len > 1e-9 ? dx / len : 0;
      if (hx >= 0.3) target = LEAN_RAD;
      else if (hx <= -0.3) target = -LEAN_RAD;
    }
    if (target !== leanTo) {
      leanFrom = leanNow();
      leanTo = target;
      leanAge = 0;
    } else if (leanAge < 1) {
      leanAge += dt;
    }
    if (on) {
      let fps = WALK_FPS;
      if (speedRatio > 1) fps = Math.min(WALK_FPS_FAST, WALK_FPS * speedRatio);
      if (!walkOn) dustT = DUST_GAP * 0.5;
      walkPhase += dt * fps;
      if (walkPhase > 1e6) walkPhase -= 1e6;
      dustT -= dt;
      if (dustT <= 0) {
        dustT += DUST_GAP;
        if (ok(x) && ok(y)) spawnDust(x, y, dx);
      }
      breathT = 0;
    } else {
      if (walkOn && !calm) stopAge = 0;
      breathT += dt;
      if (breathT >= BREATH_T) breathT -= BREATH_T;
    }
    walkOn = on;
  }

  function heroPose() {
    const calm = reducedNow();
    walkPose.rot = leanNow();
    walkPose.sx = 1;
    walkPose.sy = 1;
    walkPose.bob = 0;
    walkPose.animT = walkPhase / 8; // sprites play frame floor(time * 8)
    if (walkOn && !calm && (Math.floor(walkPhase) & 1)) walkPose.bob = -BOB_ART;
    if (stopAge < STOP_T && !calm) {
      const e = outBack(stopAge / STOP_T);
      walkPose.sx = STOP_SX + (1 - STOP_SX) * e;
      walkPose.sy = STOP_SY + (1 - STOP_SY) * e;
    } else if (!walkOn && !calm) {
      walkPose.sy = 1 + BREATH_Y * (0.5 - 0.5 * Math.cos((TAU * breathT) / BREATH_T));
    }
    return walkPose;
  }

  function resetB2() {
    evoOn = 0;
    evoAge = 0;
    evoShook = 0;
    evoFlashed = 0;
    evoFlashLeft = 0;
    evoQuiet = 0;
    walkOn = 0;
    walkPhase = 0;
    leanFrom = 0;
    leanTo = 0;
    leanAge = 1;
    stopAge = 9;
    breathT = 0;
    dustT = 0;
  }
  // ---- end game feel batch 2 ----

  function paint(ctx, cam) {
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
      if (p.life <= 0 || p.shard) continue;
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
    paintShards(ctx, zoom, tile, camX, camY, viewW, viewH);
    for (let i = 0; i < RING_CAP; i++) {
      const r = rings[i];
      if (!r.on) continue;
      const t = r.age - r.delay;
      if (t < 0 || t > r.dur) continue;
      const u = r.dur > 0 ? t / r.dur : 1;
      const radius = r.r0 + (r.r1 - r.r0) * (r.ease ? outCubic(u) : u);
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
    paintGuards(ctx, tile, camX, camY, viewW, viewH);

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
    paintBeamArrows(ctx, zoom, tile, camX, camY, viewW, viewH);

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
    paintEvo(ctx, zoom, tile, camX, camY, viewW, viewH); // batch 2
    ctx.globalAlpha = 1;
    trailCount = 0;
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
      return doKill(x, y, type, vis);
    },

    kill: function (x, y, type, opts) {
      return doKill(x, y, type, opts);
    },

    shake: function (level) {
      return shakeLevel(level);
    },

    shakeAmp: function () {
      return shakeNow();
    },

    hitstop: function (vis) {
      return hitstopFor(vis);
    },

    hitstopLeft: function () {
      return stopLeft;
    },

    consumeHitstop: function (dt) {
      return consumeHitstop(dt);
    },

    knockTiles: function (vis) {
      return knockTiles(vis);
    },

    knockStep: function (age, dt) {
      return knockStep(age, dt);
    },

    foePose: function (hitAge, flashLeft, deathAge, pop) {
      return foePose(hitAge, flashLeft, deathAge, pop);
    },

    drawWhite: function (ctx, vis, x, y, alpha) {
      return drawWhite(ctx, vis, x, y, alpha);
    },

    shardCount: function () {
      return liveShards();
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
      if (evoOn) {
        // batch 2: the cinematic already flashed; fire the 360 sweep straight away.
        evolveFlashAt = clock;
        beginSweep(opts, !reducedNow());
        return;
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
      resetB2(); // batch 2
      clock = 0;
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
      for (let i = 0; i < KILL_N; i++) killStamp[i] = -10;
      killSlot = 0;
      for (let i = 0; i < TELL_N; i++) tellKey[i] = null;
      heartPhase = 0;
      for (let i = 0; i < GUARD_N; i++) guardOn[i] = 0;
      guardAt = -10;
      heartNow = -1;
      trailCount = 0;
      shakeAmp = 0;
      shakeLife = 0;
      shakeMax = 1;
      shakeAt = -10;
      stopEnd = -10;
      stopLeft = 0;
      stopClock = 0;
      crowdKill = 0;
      for (let i = 0; i < BURST_N; i++) burstOn[i] = 0;
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
      paint(ctx, cam || emptyCam);
    },

    drawUnder: function (ctx, cam) {
      if (!ctx || !ctx.canvas) return;
      const view = cam || emptyCam;
      const zoom = (view && ok(view.zoom) && view.zoom > 0) ? view.zoom : 1;
      const tile = framePx() * zoom;
      const camX = view && ok(view.x) ? view.x : 0;
      const camY = view && ok(view.y) ? view.y : 0;
      ctx.imageSmoothingEnabled = false;
      paintBeams(ctx, zoom, tile, camX, camY, ctx.canvas.width, ctx.canvas.height);
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

    telegraph: function (id, x, y, tellMs) {
      tellOn(id, x, y, tellMs);
    },

    telegraphOff: function (id) {
      tellOff(id);
    },

    tellProgress: function (id) {
      return tellProgress(id);
    },

    paintTell: function (ctx, shape, x, y, a, b, c, u) {
      paintTell(ctx, shape, x, y, a, b, c, u);
    },

    bossGuard: function (x, y, radius) {
      return bossGuard(x, y, radius);
    },

    guardLive: function () {
      return guardLive();
    },

    drawLowHp: function (ctx, w, h, hpFrac, nowMs) {
      return drawLowHp(ctx, w, h, hpFrac, nowMs);
    },

    lowHpFlash: function (hpFrac, nowMs) {
      return lowHpFlash(hpFrac, nowMs);
    },

    drawHpBarFlash: function (ctx, x, y, w, h, hpFrac, nowMs) {
      return drawHpBarFlash(ctx, x, y, w, h, hpFrac, nowMs);
    },

    heartRate: function (hpFrac) {
      return heartRate(hpFrac);
    },

    lowHpStats: function () {
      return { bpm: heartBpm, phase: heartPhase, builds: vigBuilds, trails: trailCount };
    },

    gemTrail: function (ctx, x, y, vx, vy, colour) {
      return gemTrail(ctx, x, y, vx, vy, colour);
    },

    paintMobTell: function (ctx, shape, x, y, a, b, c, u) {
      paintMobTell(ctx, shape, x, y, a, b, c, u);
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
    TELL_FILL: TELL_FILL,
    TELL_EDGE: TELL_EDGE,
    TELL_DARK: TELL_DARK,
    MOB_FILL: MOB_FILL,
    MOB_EDGE: MOB_EDGE,
    LOWHP_AT: LOWHP_AT,
    HIT_FLASH: HIT_FLASH,
    DEATH_S: DEATH_T,
    POP_S: POP_T,
    SHARD_CAP: SHARD_CAP,
    SHAKE_AMP: SHAKE_AMP,
    SHAKE_MS: [0, 120, 200, 300, 400],
    guardNumberStyle: guardNumberStyle,
    GUARD_MS: GUARD_DUR * 1000,
    GUARD_GAP_MS: GUARD_GAP * 1000,
    LOWHP_FLASH_AT: FLASH_AT,
    GEM_TRAIL_CAP: TRAIL_CAP,

    // ---- game feel batch 2 API ----
    // FX.evoCinematic(id, {x, y, facing, sprite}) starts the Dawnbreaker moment
    // (world tiles; returns its length in s, 0 if one is already running).
    // While FX.evoHold() is true the game pauses its sim (FX keeps updating);
    // when it turns false (1.2 s; 0.6 s reduced) the game commits the
    // evolution and the 360 sweep fires. FX.evoTitleScale() drives the banner.
    evoCinematic: function (id, opts) { return evoStart(id, opts); },
    evoHold: function () { return evoHold(); },
    evoActive: function () { return evoOn === 1; },
    evoTime: function () { return evoOn ? evoAge : -1; },
    evoTitleScale: function () { return evoTitleScale(); },
    evoDim: function () { return evoDimAlpha(); },
    // FX.heroWalk(dt, dx, dy, moving, x, y, speedRatio) once per sim step;
    // FX.heroPose() -> shared {rot (rad), sx, sy, bob (art px), animT}.
    heroWalk: heroWalk,
    heroPose: heroPose,
    EVO_MS: EVO_FULL.end * 1000,
    EVO_FIRE_MS: EVO_FULL.fire * 1000,
    EVO_SHORT_MS: EVO_SHORT.end * 1000,
    WALK_FPS: WALK_FPS,
    // ---- end game feel batch 2 API ----
  };
})();
