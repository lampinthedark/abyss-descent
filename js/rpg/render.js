/**
 * Top-down renderer (core). Full-screen canvas at devicePixelRatio
 * resolution, integer device-px-per-art-px scale, imageSmoothing off.
 *
 * Draw order (systems registered with RPG.registerSystem draw at the named
 * layers, in registration order, with ctx in device px and the camera's cam):
 *   1. cached ground: zone grid tiles + edges + static decor with soft
 *      shadows, built once in 1x art px (the optional warm grade is baked
 *      into the atlases by Sheet), then water shimmer        -> 'ground'
 *   2. live decor (tree canopy sway, braziers, lanterns), flat entities
 *      (overlay), tap marker                                  -> 'under'
 *   3. y-sorted by foot: entities (npc / mob / drop / owners' nodes and
 *      stations), the hero over its ring, `_top` overlays of tall sprites an
 *      actor stands behind, and anything systems cam.push(footY, fn) ('sorted')
 *   4. warm glow + embers / smoke at furnace, fire, range, brazier, lantern,
 *      chimney; then FX (survivor-fx via RPG.fx)               -> 'fx'
 *   5.                                                         -> 'ui'
 *
 * Sprites for entities: e.sprite (sheet key), e.frame or e.anim (ms per
 * frame), e.flip, optional e.footY override; foot point = (x*32, y*18 + 5)
 * art px. Missing keys draw labelled placeholder boxes (sheet.js).
 *
 * The 'core-marker-placeholders' system draws gather nodes and stations from
 * RPG.world.zone.markers until RPG.skills exists (Skills & Quests then spawns
 * the real entities on 'enter').
 *
 * prefers-reduced-motion (or ?motion=0): no sway, bob, shimmer motion,
 * flicker or particles; glows stay steady. All glow is warm orange / amber.
 */
(function (root) {
  'use strict';

  const RPG = (root.RPG = root.RPG || {});
  const TW = 32;
  const TH = 18;
  const BG = '#1b2416';
  const CREAM = '#f4efe0'; // hero ring + tap marker
  const GLOW_RE = /furnace|fire|range|brazier|chimney|lantern|torch/;
  const TREE_RE = /tree/;
  const MAX_PARTS = 120;
  const LAYERS = ['ground', 'under', 'sorted', 'fx', 'ui'];

  function reducedMotion() {
    try {
      const q = new URLSearchParams(root.location.search).get('motion');
      if (q === '0') return true;
      if (q === '1') return false;
      return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  /** Tiny deterministic noise in [0, 1). */
  function rnd(i) {
    const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function shadowWidth(o) {
    if (o.fw > 1 || o.fh > 1 || o.overlay || o.tile) return 0;
    if (/tuft|stump|bones|flowerbed/.test(o.key)) return 0;
    if (o.kind === 'mob') return /rat/.test(o.key) ? 16 : 18;
    if (o.kind === 'npc') return 18;
    if (TREE_RE.test(o.key)) return Math.min(30, Math.round(o.w * 0.7));
    return Math.min(30, Math.max(8, Math.round(o.w * 0.8)));
  }

  function overlaps(p, ax0, ay0, ax1, ay1) {
    return p.ax < ax1 && p.ax + p.w > ax0 && p.ay < ay1 && p.ay + p.h > ay0;
  }

  function Renderer(canvas, world, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.camera = camera;
    this.dpr = 1;
    this.s = 4;
    this.cssW = 0;
    this.cssH = 0;
    this.originX = 0;
    this.originY = 0;
    this.ground = null;
    this.live = [];
    this.tops = [];
    this.emitters = [];
    this.water = [];
    this.markerObjs = [];
    this.ringGlow = null;
    this.ringGlowS = 0;
    this.shadows = Object.create(null);
    this.glowSprite = null;
    this.reduced = reducedMotion();
    this.alive = true;
    this.stats = { draws: 0, aliveMs: 0, parts: 0, systemsMs: 0 };
    this.px = new Float32Array(MAX_PARTS);
    this.py = new Float32Array(MAX_PARTS);
    this.pvx = new Float32Array(MAX_PARTS);
    this.pvy = new Float32Array(MAX_PARTS);
    this.plife = new Float32Array(MAX_PARTS);
    this.pmax = new Float32Array(MAX_PARTS);
    this.pkind = new Uint8Array(MAX_PARTS); // 0 free, 1 ember, 2 smoke
    this.lastT = 0;
    this.sortList = [];
    const self = this;
    try {
      const mq = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq && mq.addEventListener) mq.addEventListener('change', function () { self.reduced = reducedMotion(); });
    } catch (e) {}
    camera.view.push = function (footY, fn) {
      self.sortList.push({ foot: footY * TH + 5, fn: fn });
    };
  }

  Renderer.prototype.resize = function () {
    const vv = root.visualViewport;
    const cssW = Math.max(1, Math.round(vv && vv.width ? vv.width : root.innerWidth));
    const cssH = Math.max(1, Math.round(vv && vv.height ? vv.height : root.innerHeight));
    const dpr = Math.max(1, Math.min(4, root.devicePixelRatio || 1));
    const c = this.canvas;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    // About 9 tiles across the short way: portrait 390x844 @3 -> 4, desktop 1280x720 -> 4.
    const s = Math.floor(Math.min(c.width / (9 * TW), c.height / (9 * TH)));
    this.s = Math.max(2, Math.min(10, s));
    this.camera.setViewport(c.width, c.height, this.s);
    this.ringGlow = null;
    this.ctx.imageSmoothingEnabled = false;
  };

  /** Soft elliptical shadow sprite in 1x art px, cached by width. */
  Renderer.prototype.shadow = function (w) {
    const key = w | 0;
    if (this.shadows[key]) return this.shadows[key];
    const h = Math.max(3, Math.round(key * 0.32));
    const c = document.createElement('canvas');
    c.width = key + 2;
    c.height = h + 2;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(14, 16, 8, 0.16)';
    g.beginPath();
    g.ellipse(c.width / 2, c.height / 2, key / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(14, 16, 8, 0.14)';
    g.beginPath();
    g.ellipse(c.width / 2, c.height / 2, key * 0.36, h * 0.34, 0, 0, Math.PI * 2);
    g.fill();
    this.shadows[key] = c;
    return c;
  };


  /** Warm additive glow sprite (smooth, drawn with smoothing on). */
  Renderer.prototype.glow = function () {
    if (this.glowSprite) return this.glowSprite;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255, 170, 70, 0.55)');
    gr.addColorStop(0.35, 'rgba(255, 130, 40, 0.24)');
    gr.addColorStop(1, 'rgba(255, 100, 20, 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    this.glowSprite = c;
    return c;
  };


  Renderer.prototype.drawHeroRing = function (ctx, x, y) {
    const s = this.s;
    if (!this.ringGlow || this.ringGlowS !== s) {
      this.ringGlowS = s;
      const gr = ctx.createRadialGradient(0, 0, 3 * s, 0, 0, 22 * s);
      gr.addColorStop(0, 'rgba(6, 4, 6, 0.88)');
      gr.addColorStop(0.38, 'rgba(6, 4, 6, 0.55)');
      gr.addColorStop(1, 'rgba(6, 4, 6, 0)');
      this.ringGlow = gr;
    }
    ctx.save();
    ctx.translate(x, y - 10 * s);
    ctx.fillStyle = this.ringGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 22 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y - s, 12 * s, 0, Math.PI * 2);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = CREAM;
    ctx.stroke();
  };


  /**
   * Hero: real Rustbound frames when loaded (idle by time, walk by distance,
   * mirrored when facing the viewer's right), placeholder box otherwise.
   */
  Renderer.prototype.drawHero = function (ctx, x, y, hero, t) {
    const s = this.s;
    const Sheet = root.Sheet;
    // Bare hands until a weapon is equipped (Equipment.getStats().weapon),
    // then the Rustbound frames. Checked at most every 250 ms.
    if (!this._armAt || t - this._armAt > 250 || t < this._armAt) {
      this._armAt = t;
      let armed = false;
      try { const st = root.Equipment && root.Equipment.getStats && root.Equipment.getStats(); armed = !!(st && st.weapon) && !(root.RPG.isToolItem && root.RPG.isToolItem(st.weapon.base)); } catch (e) { armed = false; }
      this._armed = armed;
    }
    const set = (!this._armed && Sheet.has('hero_bare_idle')) ? 'hero_bare' : 'hero_rustbound';
    hero.spriteSet = set;
    if (hero.swingT > 0 && !hero.moving && Sheet.has(set + '_attack')) {
      const ak = set + '_attack';
      const n = (Sheet.size(ak) || {}).frames || 4;
      const fr = Math.min(n - 1, Math.floor((1 - hero.swingT / 0.35) * n));
      Sheet.drawFoot(ctx, ak, x, y, s, fr, hero.facing > 0);
      return;
    }
    const key = set + (hero.moving ? '_walk' : '_idle');
    if (Sheet.has(key)) {
      const fr = hero.moving
        ? Math.floor((hero.dist || 0) / 7) // one walk frame per 7 art px moved
        : (this.reduced ? 0 : Sheet.frameAtTime(key, t, 500));
      Sheet.drawFoot(ctx, key, x, y, s, fr, hero.facing > 0);
      return;
    }
    const bob = hero.moving ? (Math.floor(t / 120) % 2) * s : 0;
    const bx = Math.round(x - 6 * s);
    const by = Math.round(y - 18 * s - bob);
    ctx.fillStyle = '#14120f';
    ctx.fillRect(bx - s, by - 9 * s, 14 * s, 27 * s + bob);
    ctx.fillStyle = '#c4532f'; // warm hues are hero-only
    ctx.fillRect(bx, by, 12 * s, 17 * s + bob);
    ctx.fillStyle = '#efe2c4';
    ctx.fillRect(bx + 4 * s, by + 2 * s, 4 * s, 13 * s);
    ctx.fillStyle = '#f0c8a2';
    ctx.fillRect(bx + 2 * s, by - 8 * s, 8 * s, 7 * s);
  };


  Renderer.prototype.drawMarker = function (ctx, m, t) {
    if (!m) return;
    const age = t - m.t0;
    if (age > 900 || age < 0) return;
    const s = this.s;
    const p = this.toScreen(m.x, m.y);
    const a = 1 - age / 900;
    const r = Math.round((3 + (1 - a) * 2) * s);
    ctx.globalAlpha = a;
    ctx.fillStyle = m.bad ? '#d24a3c' : CREAM;
    for (let i = -r; i <= r; i += s) {
      ctx.fillRect(Math.round(p.x + i - s / 2), Math.round(p.y + i - s / 2), s, s);
      ctx.fillRect(Math.round(p.x + i - s / 2), Math.round(p.y - i - s / 2), s, s);
    }
    ctx.globalAlpha = 1;
  };


  /** Slow shimmer: two short light glints per visible water tile. */
  Renderer.prototype.drawWater = function (ctx, t, vx0, vy0, vx1, vy1) {
    const s = this.s;
    const wl = this.water;
    const still = this.reduced;
    ctx.fillStyle = 'rgb(214, 236, 246)';
    for (let i = 0; i < wl.length; i += 2) {
      const x = wl[i];
      const y = wl[i + 1];
      const ax = x * TW;
      const ay = y * TH;
      if (ax > vx1 || ax + TW < vx0 || ay > vy1 || ay + TH < vy0) continue;
      const h = this.world.hash(x, y);
      for (let k = 0; k < 2; k++) {
        const ph = ((h >>> (k * 8)) & 255) / 40.7;
        const a = still ? 0.12 : 0.05 + 0.2 * Math.max(0, Math.sin(t / 1100 + ph));
        if (a < 0.06) continue;
        const gx = 4 + ((h >>> (k * 5 + 3)) % 22) + (still ? 0 : Math.round(Math.sin(t / 1700 + ph) * 2));
        const gy = 3 + ((h >>> (k * 7 + 1)) % 12);
        ctx.globalAlpha = a;
        ctx.fillRect(this.originX + (ax + gx) * s, this.originY + (ay + gy) * s, (3 + k) * s, s);
      }
    }
    ctx.globalAlpha = 1;
  };


  /** Spawn and move embers / smoke; dt in seconds. */
  Renderer.prototype.stepParticles = function (dt, vx0, vy0, vx1, vy1) {
    if (this.reduced || !this.alive) {
      this.pkind.fill(0);
      return;
    }
    for (let e = 0; e < this.emitters.length; e++) {
      const em = this.emitters[e];
      if (em.gx < vx0 || em.gx > vx1 || em.gy < vy0 || em.gy > vy1) continue;
      em.acc += em.embers * dt;
      em.sacc += em.smoke * dt;
      while (em.acc >= 1) { em.acc -= 1; this.spawn(1, em); }
      while (em.sacc >= 1) { em.sacc -= 1; this.spawn(2, em); }
    }
    let n = 0;
    for (let i = 0; i < MAX_PARTS; i++) {
      if (!this.pkind[i]) continue;
      this.plife[i] += dt;
      if (this.plife[i] >= this.pmax[i]) { this.pkind[i] = 0; continue; }
      this.px[i] += this.pvx[i] * dt;
      this.py[i] += this.pvy[i] * dt;
      if (this.pkind[i] === 1) this.pvx[i] += (Math.random() - 0.5) * 30 * dt;
      else this.pvx[i] += 3 * dt; // smoke drifts with a light breeze
      n++;
    }
    this.stats.parts = n;
  };

  Renderer.prototype.spawn = function (kind, em) {
    for (let i = 0; i < MAX_PARTS; i++) {
      if (this.pkind[i]) continue;
      this.pkind[i] = kind;
      this.plife[i] = 0;
      const top = em.kind === 'furnace' || em.kind === 'chimney' ? em.top + 4 : em.gy - 4;
      if (kind === 1) {
        this.px[i] = em.gx + (Math.random() - 0.5) * 8;
        this.py[i] = em.gy - 2;
        this.pvx[i] = (Math.random() - 0.5) * 6;
        this.pvy[i] = -14 - Math.random() * 12;
        this.pmax[i] = 0.9 + Math.random() * 0.8;
      } else {
        this.px[i] = em.gx + (Math.random() - 0.5) * 6;
        this.py[i] = top;
        this.pvx[i] = (Math.random() - 0.5) * 3;
        this.pvy[i] = -7 - Math.random() * 5;
        this.pmax[i] = 2 + Math.random() * 1.2;
      }
      return;
    }
  };

  Renderer.prototype.drawGlowsAndParticles = function (ctx, t, vx0, vy0, vx1, vy1) {
    if (!this.alive) return;
    const s = this.s;
    const glow = this.glow();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    for (let e = 0; e < this.emitters.length; e++) {
      const em = this.emitters[e];
      if (em.gx + em.r < vx0 || em.gx - em.r > vx1 || em.gy + em.r < vy0 || em.gy - em.r > vy1) continue;
      const f = this.reduced ? 0.8
        : 0.68 + 0.16 * Math.sin(t / 90 + em.phase) + 0.12 * Math.sin(t / 37 + em.phase * 3);
      const r = em.r * (this.reduced ? 1 : 0.94 + 0.06 * Math.sin(t / 160 + em.phase));
      ctx.globalAlpha = Math.max(0, Math.min(1, f));
      ctx.drawImage(glow, this.originX + (em.gx - r) * s, this.originY + (em.gy - r) * s, 2 * r * s, 2 * r * s);
    }
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    if (this.reduced) return;
    for (let i = 0; i < MAX_PARTS; i++) {
      const k = this.pkind[i];
      if (!k) continue;
      const life = this.plife[i] / this.pmax[i];
      const x = Math.round(this.originX + Math.round(this.px[i]) * s);
      const y = Math.round(this.originY + Math.round(this.py[i]) * s);
      if (k === 1) {
        ctx.globalAlpha = 1 - life;
        ctx.fillStyle = life < 0.4 ? '#ffd07a' : '#ff8a3a';
        ctx.fillRect(x, y, s, s);
      } else {
        ctx.globalAlpha = 0.32 * (1 - life);
        ctx.fillStyle = '#8b8a86';
        const z = (life < 0.5 ? 2 : 3) * s;
        ctx.fillRect(x, y, z, z);
      }
    }
    ctx.globalAlpha = 1;
  };


  /** Fill derived sprite fields (size, _top, sway, shadow) for a decor or entity-like object. */
  Renderer.prototype.prep = function (o) {
    const Sheet = root.Sheet;
    const key = o.sprite || o.key;
    if (o._pk === key) return o;
    const z = Sheet.size(key);
    o._pk = key;
    o.key = key;
    o.w = z.w;
    o.h = z.h;
    o._footX = z.footX;
    o._footY = z.footY;
    o.topH = Sheet.has(key + '_top') ? Sheet.size(key + '_top').h : 0;
    o.tree = TREE_RE.test(key) && o.topH > 0;
    o.shadowW = shadowWidth(o);
    if (o.phase == null) o.phase = rnd((o.i != null ? o.i : o.seed || 0) + 1) * Math.PI * 2;
    return o;
  };

  /** Art-px box of an entity-like object from its tile foot point. */
  Renderer.prototype.place = function (o) {
    this.prep(o);
    if (o.overlay) {
      o.ax = Math.floor(o.x) * TW;
      o.ay = Math.floor(o.y) * TH;
      o.foot = o.ay;
      return o;
    }
    const fx = Math.round(o.x * TW);
    const fy = Math.round(o.y * TH + 5);
    const footY = o.footY != null ? o.footY : o._footY;
    o.ax = fx - (o.flip ? o.w - o._footX : o._footX);
    o.ay = fy - footY;
    o.foot = fy;
    return o;
  };

  function frameAt(o, t) {
    if (!o.anim) return o.frame || 0;
    return Math.floor((t + ((o.i != null ? o.i : o.seed || 0) * 137) % o.anim) / o.anim);
  }

  /** Canopy sway in whole art px (-1, 0, 1), slow and per-tree. */
  Renderer.prototype.sway = function (o, t) {
    if (this.reduced || !this.alive) return 0;
    return Math.round(Math.sin(t / 1400 + o.phase) * 1.2);
  };

  /** NPC idle bob: 0 or 1 art px. */
  Renderer.prototype.bob = function (o, t) {
    if (this.reduced || !this.alive || o.kind !== 'npc') return 0;
    return Math.sin(t / 700 + o.phase) > 0.35 ? 1 : 0;
  };

  Renderer.prototype.drawShadow = function (ctx, o) {
    if (!o.shadowW || !this.alive) return;
    const s = this.s;
    const sh = this.shadow(o.shadowW);
    ctx.drawImage(sh,
      Math.round(this.originX + (o.ax + o.w / 2 - sh.width / 2) * s),
      Math.round(this.originY + (o.foot - sh.height / 2) * s),
      sh.width * s, sh.height * s);
  };

  /** Draw a placed sprite object (or only its _top), with sway / bob / flip. */
  Renderer.prototype.drawSprite = function (ctx, o, t, topOnly) {
    const Sheet = root.Sheet;
    const s = this.s;
    const dx = this.originX + o.ax * s;
    const dy = this.originY + (o.ay - this.bob(o, t)) * s;
    const fr = frameAt(o, t);
    if (o.tree && !o.flip) {
      const sw = this.sway(o, t) * s;
      if (!topOnly) Sheet.drawRows(ctx, o.key, dx, dy + o.topH * s, s, fr, o.topH, o.h - o.topH);
      Sheet.drawRows(ctx, o.key, dx + sw, dy, s, fr, 0, o.topH);
      return;
    }
    Sheet.draw(ctx, topOnly ? o.key + '_top' : o.key, dx, dy, s, fr, o.flip);
  };

  /** Does a hero / NPC / mob stand behind this tall sprite (needs its _top on top)? */
  Renderer.prototype.needTop = function (o, hero) {
    if (!o.topH) return false;
    if (hero && hero.ay < o.foot && overlaps(o, hero.ax - 18, hero.ay - 42, hero.ax + 18, hero.ay + 2)) return true;
    const acts = this.actors;
    for (let j = 0; j < acts.length; j++) {
      const n = acts[j];
      if (n !== o && n.foot < o.foot && overlaps(o, n.ax, n.ay, n.ax + n.w, n.ay + n.h)) return true;
    }
    return false;
  };

  function addEmitter(list, o, kind, gx, gy) {
    const big = kind === 'furnace' || kind === 'chimney';
    const seed = (o.i != null ? o.i : o.seed || 0) + gx * 7 + gy * 13;
    list.push({
      kind: kind,
      top: o.ay != null ? o.ay : gy - 20,
      gx: gx,
      gy: gy,
      phase: rnd(seed + 3) * Math.PI * 2,
      r: big ? 30 : kind === 'fire' ? 26 : kind === 'lantern' ? 16 : kind === 'range' ? 18 : 20,
      embers: kind === 'range' || kind === 'lantern' ? 0 : big ? 5 : 4, // per second
      smoke: big || kind === 'range' || kind === 'chimney' ? 2.5 : kind === 'fire' ? 1.5 : 0,
      acc: rnd(seed + 7),
      sacc: rnd(seed + 11),
    });
  }

  /** Build the cached ground layer, decor lists, marker placeholders and glow emitters. */
  Renderer.prototype.build = function () {
    const W = this.world;
    const Sheet = root.Sheet;
    const z = W.zone && W.zone.data;
    if (!z) return;
    const c = document.createElement('canvas');
    const zw = W.W;
    const zh = W.H;
    c.width = zw * TW;
    c.height = zh * TH;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    this.water = [];
    for (let y = 0; y < zh; y++) {
      for (let x = 0; x < zw; x++) {
        const key = z.grid[y][x];
        if (!key) {
          g.fillStyle = BG;
          g.fillRect(x * TW, y * TH, TW, TH);
          continue;
        }
        Sheet.draw(g, key, x * TW, y * TH, 1, 0);
        const edges = z.edges && z.edges[y] && z.edges[y][x];
        if (edges) for (let i = 0; i < edges.length; i++) Sheet.draw(g, edges[i], x * TW, y * TH, 1, 0);
        if (/water/.test(key)) this.water.push(x, y);
      }
    }
    const statics = [];
    this.live = [];
    this.tops = [];
    this.emitters = [];
    W.decor().forEach(function (p) {
      this.prep(p);
      const pl = W.placeDecor(p, Sheet.size(p.key));
      p.ax = pl.ax;
      p.ay = pl.ay;
      p.foot = pl.foot;
      if (Sheet.size(p.key).frames > 1 || p.anim || p.tree) this.live.push(p);
      else statics.push(p);
      if (p.topH) this.tops.push(p);
      const m = GLOW_RE.exec(p.key);
      if (m) {
        const fy = m[0] === 'fire' ? 0.55 : m[0] === 'brazier' || m[0] === 'lantern' ? 0.25 : 0.62;
        addEmitter(this.emitters, p, m[0], p.ax + p.w / 2, p.ay + p.h * fy);
      }
    }, this);
    statics.sort(function (a, b) { return a.foot - b.foot || a.ax - b.ax; });
    statics.forEach(function (p) {
      if (p.shadowW) {
        const sh = this.shadow(p.shadowW);
        g.drawImage(sh, Math.round(p.ax + p.w / 2 - sh.width / 2), Math.round(p.foot - sh.height / 2));
      }
      Sheet.draw(g, p.key, p.ax, p.ay, 1, 0);
    }, this);
    this.live.sort(function (a, b) { return a.foot - b.foot; });
    // Placeholder nodes / stations from markers (drawn by 'core-marker-placeholders').
    this.markerObjs = markerSprites(W.zone.markers || {});
    this.markerObjs.forEach(function (o) {
      this.place(o);
      const m = GLOW_RE.exec(o.key);
      if (m) {
        const fy = m[0] === 'fire' ? 0.55 : 0.62;
        addEmitter(this.emitters, o, m[0], o.ax + o.w / 2, o.ay + o.h * fy);
      }
    }, this);
    this.ground = c;
  };

  /** Marker -> placeholder sprite objects (keys from the town sheet). */
  const STATION_SPRITES = { furnace: ['prop_furnace_0', 200], anvil: ['prop_anvil_0', 0], range: ['prop_range_0', 200], fire: ['prop_fire_0', 140] };
  function markerSprites(mk) {
    const out = [];
    let n = 0;
    (mk.ore || []).forEach(function (m) {
      out.push({ kind: 'node', node: 'ore', tier: m.tier, x: m.x + 0.5, y: m.y + 0.5, sprite: 'node_ore_' + (m.tier || 'rustbound') + '_full', seed: 900 + n++ });
    });
    (mk.tree || []).forEach(function (m) {
      out.push({ kind: 'node', node: 'tree', tier: m.kind, x: m.x + 0.5, y: m.y + 0.5, sprite: 'node_tree_' + (m.kind || 'ash') + '_full', seed: 900 + n++ });
    });
    (mk.fish || []).forEach(function (m) {
      out.push({ kind: 'node', node: 'fish', x: m.x + 0.5, y: m.y + 0.5, sprite: 'node_fish_0', overlay: true, anim: 220, seed: 900 + n++ });
    });
    Object.keys(STATION_SPRITES).forEach(function (k) {
      const m = mk[k];
      if (!m) return;
      out.push({ kind: 'station', station: k, x: m.x + 0.5, y: m.y + 0.5, sprite: STATION_SPRITES[k][0], anim: STATION_SPRITES[k][1], seed: 900 + n++ });
    });
    return out;
  }

  /** Device px -> art px world point. */
  Renderer.prototype.toWorld = function (dx, dy) {
    return this.camera.toWorld(dx, dy);
  };

  /** Art px world point -> device px. */
  Renderer.prototype.toScreen = function (ax, ay) {
    return this.camera.artToScreen(ax, ay);
  };

  Renderer.prototype.drawSystems = function (ctx, layer) {
    const list = RPG.systems || [];
    const cam = this.camera.view;
    for (let i = 0; i < list.length; i++) {
      const sys = list[i];
      if (typeof sys.draw !== 'function') continue;
      try {
        sys.draw(ctx, cam, layer);
      } catch (e) {
        if (!sys._warned) { sys._warned = true; if (root.console) console.error('[system ' + sys.id + ' draw]', e); }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
    }
  };

  /**
   * Draw one frame. hero = RPG.hero (+ ax, ay foot art px), marker = tap marker.
   */
  Renderer.prototype.frame = function (t, hero, marker) {
    const ctx = this.ctx;
    const s = this.s;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    this.originX = this.camera.originX;
    this.originY = this.camera.originY;
    const now = function () { return root.performance.now(); };
    let aliveMs = 0;
    let sysMs = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cw, ch);
    let draws = 0;

    // 1. ground cache, visible sub-rect only, at integer device px.
    if (this.ground) {
      const gw = this.ground.width;
      const gh = this.ground.height;
      const sx = Math.max(0, Math.floor(-this.originX / s));
      const sy = Math.max(0, Math.floor(-this.originY / s));
      const sw = Math.min(gw - sx, Math.ceil(cw / s) + 2);
      const sh = Math.min(gh - sy, Math.ceil(ch / s) + 2);
      if (sw > 0 && sh > 0) {
        ctx.drawImage(this.ground, sx, sy, sw, sh, this.originX + sx * s, this.originY + sy * s, sw * s, sh * s);
        draws++;
      }
    }
    const vx0 = -this.originX / s - 64;
    const vy0 = -this.originY / s - 64;
    const vx1 = vx0 + cw / s + 128;
    const vy1 = vy0 + ch / s + 128;
    let a0 = now();
    if (this.alive) this.drawWater(ctx, t, vx0 + 64, vy0 + 64, vx1 - 64, vy1 - 64);
    aliveMs += now() - a0;
    a0 = now();
    this.drawSystems(ctx, 'ground');
    sysMs += now() - a0;

    // 2. live decor, flat entities, tap marker, 'under'.
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      if (!overlaps(p, vx0, vy0, vx1, vy1)) continue;
      this.drawShadow(ctx, p);
      this.drawSprite(ctx, p, t, false);
      draws++;
    }
    const actors = [];
    const flat = [];
    const self = this;
    this.world.forEach(function (e) {
      if (e.hidden) return;
      self.place(e);
      if (!overlaps(e, vx0, vy0, vx1, vy1)) return;
      if (e.overlay) flat.push(e);
      else actors.push(e);
    });
    this.actors = actors;
    for (let i = 0; i < flat.length; i++) { this.drawSprite(ctx, flat[i], t, false); draws++; }
    this.drawMarker(ctx, marker, t);
    a0 = now();
    this.drawSystems(ctx, 'under');
    sysMs += now() - a0;

    // 3. sorted.
    const list = this.sortList;
    list.length = 0;
    for (let i = 0; i < actors.length; i++) {
      const e = actors[i];
      list.push({ foot: e.foot, e: e });
      if (e.topH && this.needTop(e, hero)) list.push({ foot: e.foot + 0.01, top: e });
    }
    list.push({ foot: hero.ay, hero: true });
    for (let i = 0; i < this.tops.length; i++) {
      const p = this.tops[i];
      if (overlaps(p, vx0, vy0, vx1, vy1) && this.needTop(p, hero)) list.push({ foot: p.foot + 0.01, top: p });
    }
    a0 = now();
    this.drawSystems(ctx, 'sorted'); // systems cam.push() into list
    sysMs += now() - a0;
    list.sort(function (a, b) { return a.foot - b.foot; });
    const cam = this.camera.view;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it.hero) {
        const hx = Math.round(this.originX + hero.ax * s);
        const hy = Math.round(this.originY + hero.ay * s);
        this.drawHeroRing(ctx, hx, hy);
        this.drawHero(ctx, hx, hy, hero, t);
      } else if (it.e) {
        const a = it.e.alpha == null ? 1 : Math.max(0, Math.min(1, it.e.alpha));
        if (a <= 0) continue;
        if (a < 1) ctx.globalAlpha = a;
        if (typeof it.e.draw === 'function') it.e.draw(ctx, cam, t);
        else {
          this.drawShadow(ctx, it.e);
          this.drawSprite(ctx, it.e, t, false);
        }
        if (a < 1) ctx.globalAlpha = 1;
      } else if (it.top) {
        this.drawSprite(ctx, it.top, t, true);
      } else if (it.fn) {
        try { it.fn(ctx, cam); } catch (err) {}
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
      }
      draws++;
    }

    // 4. glow + particles, FX, 'fx'.
    a0 = now();
    this.stepParticles(dt, vx0, vy0, vx1, vy1);
    this.drawGlowsAndParticles(ctx, t, vx0, vy0, vx1, vy1);
    aliveMs += now() - a0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (RPG.fxDraw) RPG.fxDraw(ctx, this.originX, this.originY, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    a0 = now();
    this.drawSystems(ctx, 'fx');
    // 5. 'ui'.
    this.drawSystems(ctx, 'ui');
    sysMs += now() - a0;
    this.stats.aliveMs = aliveMs;
    this.stats.systemsMs = sysMs;
    this.stats.draws = draws;
  };

  /**
   * PLACEHOLDER (core): draw gather nodes and stations from zone markers
   * until RPG.skills exists. Skills & Quests spawns the real entities on 'enter'.
   */
  RPG.registerSystem({
    id: 'core-marker-placeholders',
    update: function () {},
    draw: function (ctx, cam, layer) {
      const r = RPG.renderer;
      if (!r || RPG.skills || !r.markerObjs.length) return;
      const t = r.lastT;
      if (layer === 'under') {
        r.markerObjs.forEach(function (o) { if (o.overlay) r.drawSprite(ctx, o, t, false); });
      } else if (layer === 'sorted') {
        const hero = RPG.hero;
        r.markerObjs.forEach(function (o) {
          if (o.overlay) return;
          if (o.ax > -r.originX / r.s + r.canvas.width / r.s + 64 || o.ax + o.w < -r.originX / r.s - 64) return;
          cam.push(o.y, function (c) { r.drawShadow(c, o); r.drawSprite(c, o, t, false); });
          if (o.topH && r.needTop(o, hero)) cam.push(o.y + 0.001, function (c) { r.drawSprite(c, o, t, true); });
        });
      }
    },
  });

  root.RpgRender = { Renderer: Renderer, LAYERS: LAYERS };
})(typeof window !== 'undefined' ? window : globalThis);
