/** Survivor mode. Top-down arena. One thumb steers; the staff fires on its own. */
(() => {
  let TILE = 48;
  let zoom = 3;
  const ARENA = 18;
  const CELL = 3;
  const RUN_SECONDS = 600;
  const MINI_AT = 300;
  const PARTICLE_CAP = 40;
  const FLOAT_CAP = 24;
  const GEM_CAP = 180;

  const search = (typeof location !== 'undefined' && location.search) || '';
  const debug = /(?:^|[?&])debug=1(?:&|$)/.test(search);
  const bench = /(?:^|[?&])bench=1(?:&|$)/.test(search);
  const previewMatch = /(?:^|[?&])preview=([a-z]+)/.exec(search);
  let previewOnce = previewMatch ? previewMatch[1] : '';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const T = SurvivorData.TUNING;
  const hero = Classes.get(SurvivorData.HERO);
  const typeById = {};
  Entities.ENEMY_TYPES.forEach(t => { typeById[t.id] = t; });

  const enemies = [];
  const enemyPool = [];
  const gems = [];
  const gemPool = [];
  const shots = [];
  const shotPool = [];
  const particles = [];
  const particlePool = [];
  const floats = [];
  const floatPool = [];
  const drawOrder = [];
  const grid = new Map();

  let state = 'title';
  let resumeState = null;
  let backgrounded = false;
  let time = 0;
  let kills = 0;
  let levelUps = 0;
  let runGold = 0;
  let bankedAmount = 0;
  let doubled = false;
  let revived = false;
  let ended = false;
  let minuteMark = 0;
  let spawnAcc = 0;
  let boss5 = false;
  let curse = 0;
  let pickLeft = 0;
  let novaSeq = 0;
  let pierceSeq = 0;
  let hitSnd = 0;
  let lootSnd = 0;
  let camX = 0;
  let camY = 0;
  let shakeMag = 0;
  let shakePhase = 0;
  let reduceMotion = false;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}
  let animT = 0;
  let owned = { bolt: 1 };
  let cds = { bolt: T.firstBolt, nova: 1.6, pierce: 1.2 };
  let orbitAngle = 0;
  let offers = [];
  const keys = {};
  const joy = { on: false, ox: 0, oy: 0, x: 0, y: 0, id: null };
  const hermit = { on: false, used: false, x: 0, y: 0 };
  const player = blankPlayer();
  let hits = 0;
  let fpsSmooth = 0;
  let benchFrames = [];
  let benchStart = 0;
  let benchDone = false;

  function blankPlayer() {
    return {
      x: 0, y: 0,
      classId: hero.id,
      life: hero.base.life,
      maxLife: hero.base.life,
      facing: 1,
      moving: false,
      swing: 0,
      hitFlash: 0,
      invuln: 0.4,
      xp: 0,
      level: 1,
    };
  }

  function $(id) { return document.getElementById(id); }

  function show(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
  function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }

  function track(name) {
    try { if (name) Analytics.event(name); } catch (e) {}
  }

  function sfx(name) {
    try { GameAudio.sfx(name); } catch (e) {}
  }

  function resize() {
    const wrap = canvas.parentElement || document.body;
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight;
    zoom = w < 760 ? 3 : 2;
    TILE = SurvivorSprites.FRAME * zoom;
    SurvivorSprites.setZoom(zoom);
    canvas.width = Math.max(320, Math.floor(w));
    canvas.height = Math.max(240, Math.floor(h));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.imageSmoothingEnabled = false;
  }

  function worldToScreen(x, y) {
    return { x: x * TILE + camX, y: y * TILE + camY };
  }

  function addShake(amount) {
    if (reduceMotion || bench || !(amount > 0)) return;
    shakeMag = Math.min(5.5, shakeMag + amount);
  }

  function clampArena(obj, limit) {
    const d = Math.hypot(obj.x, obj.y);
    if (d > limit) {
      obj.x *= limit / d;
      obj.y *= limit / d;
    }
  }

  function hpFor(id, bossFlag) {
    const wave = 1 + Math.floor(time / 60) * 0.18;
    let hp = id === 'imp' ? 14 : id === 'brute' ? 36 : T.earlyHp;
    hp = Math.round(hp * wave);
    if (bossFlag) hp = Math.round(520 * (1 + Math.max(0, time - MINI_AT) / 600));
    if (curse > 0) hp = Math.round(hp * 1.5);
    return hp;
  }

  function spawnEnemy(id, x, y, opts) {
    const type = typeById[id] || typeById.skel;
    const en = enemyPool.pop() || {};
    const bossFlag = !!(opts && opts.boss);
    en.alive = true;
    en.eid = type.id;
    en.name = (opts && opts.name) || type.name;
    en.color = type.id === 'imp' ? '#7b4fd4' : type.id === 'brute' ? '#8e97a3' : type.id === 'wraith' ? '#8a7498' : '#d7dbe3';
    en.x = x;
    en.y = y;
    en.radius = type.radius || 0.32;
    en.speed = (type.speed || 1) * (bossFlag ? 0.28 : 0.42);
    en.dmg = bossFlag ? 14 : (type.id === 'brute' ? 8 : type.id === 'imp' ? 5 : 4);
    en.maxLife = bench ? 99999 : hpFor(type.id, bossFlag);
    en.life = en.maxLife;
    en.boss = bossFlag;
    en.hitFlash = 0;
    en.dying = 0;
    en.kx = 0;
    en.ky = 0;
    en.touchCd = 0.3;
    en.facing = x < player.x ? 1 : -1;
    en.scale = bossFlag ? 1.75 : (type.id === 'brute' ? 1.28 : type.id === 'imp' ? 0.95 : 1.05);
    en.gold = bossFlag ? SurvivorData.REWARDS.gold.mini : (SurvivorData.REWARDS.gold[type.id] || 1);
    en.xp = type.id === 'brute' ? 5 : T.gemXp;
    enemies.push(en);
    return en;
  }

  function releaseEnemy(i) {
    const en = enemies[i];
    const last = enemies.pop();
    if (i < enemies.length) enemies[i] = last;
    enemyPool.push(en);
  }

  function dropGem(en) {
    if (gems.length >= GEM_CAP) {
      const old = gems.shift();
      player.xp += old.value;
      gemPool.push(old);
    }
    const g = gemPool.pop() || {};
    g.x = en.x;
    g.y = en.y;
    g.value = en.xp;
    g.vx = 0;
    g.vy = 0;
    g.fly = 0;
    gems.push(g);
  }

  function spawnShot(kind, x, y, vx, vy, dmg, life) {
    const s = shotPool.pop() || {};
    s.kind = kind;
    s.x = x;
    s.y = y;
    s.vx = vx;
    s.vy = vy;
    s.dmg = dmg;
    s.life = life;
    s.r = kind === 'nova' ? 0.2 : 0.28;
    s.seq = kind === 'nova' ? ++novaSeq : kind === 'pierce' ? ++pierceSeq : 0;
    shots.push(s);
  }

  function floatText(x, y, text, color, big) {
    let f;
    if (floats.length >= FLOAT_CAP) f = floats.shift();
    else f = floatPool.pop() || {};
    f.x = x;
    f.y = y;
    f.text = text;
    f.color = color;
    f.life = 0.72;
    f.max = 0.72;
    f.big = !!big;
    floats.push(f);
  }

  function spark(x, y, color, n, speed) {
    if (bench) return;
    for (let i = 0; i < n && particles.length < PARTICLE_CAP; i++) {
      const p = particlePool.pop() || {};
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.55 + Math.random() * 0.45);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.life = 0.28;
      p.color = color;
      particles.push(p);
    }
  }

  function burst(x, y, color) {
    if (enemies.length > 140) return;
    spark(x, y, color, 3, 2.2);
  }

  function power() {
    return 1 + (owned.might || 0) * 0.12;
  }
  function haste() {
    return Math.pow(0.92, owned.haste || 0);
  }
  function area() {
    return 1 + (owned.area || 0) * 0.12;
  }
  function boltDamage() {
    const rank = Math.max(1, owned.bolt || 1);
    return T.boltDamage * (1 + (rank - 1) * 0.22) * power();
  }
  function magnetR() {
    return 5 + (owned.magnet || 0) * 0.7;
  }

  function hurt(amount, heavy) {
    if (bench || player.invuln > 0 || state !== 'playing') return;
    const dmg = Math.max(1, amount - (owned.armor || 0) * 2);
    player.life -= dmg;
    player.hitFlash = 0.16;
    player.invuln = 0.45;
    addShake(heavy ? 4.2 : 2.6);
    floatText(player.x, player.y - 0.4, String(dmg), '#ff8060', true);
    sfx('hurt');
    if (player.life <= 0) {
      player.life = 0;
      finish('dead');
    }
  }

  function damageEnemy(en, amount, opts) {
    if (!en || en.life <= 0 || en.dying > 0) return;
    const tick = !!(opts && opts.tick);
    en.life -= amount;
    if (!tick) {
      en.hitFlash = 0.08;
      hits += 1;
    }
    if (!tick && time - hitSnd > 0.08) {
      hitSnd = time;
      sfx('hit');
    }
    if (!tick) {
      const big = amount >= 18 || !!en.boss;
      floatText(en.x, en.y - 0.15, String(Math.max(1, Math.round(amount))), '#ffffff', big);
      spark(en.x, en.y, '#ffffff', 3, 2.2);
      if (!en.boss && en.eid !== 'brute') {
        const d = Math.hypot(en.x - player.x, en.y - player.y) || 1;
        en.kx = ((en.x - player.x) / d) * 5;
        en.ky = ((en.y - player.y) / d) * 5;
      }
      if (en.boss && amount >= 4) addShake(2.4);
    }
    if (en.life <= 0) {
      en.life = 0;
      en.dying = 0.22;
      en.hitFlash = 0.08;
      kills += 1;
      runGold += en.gold;
      dropGem(en);
      burst(en.x, en.y, '#ffffff');
      if (en.boss) addShake(4.5);
      else if (en.eid === 'brute') addShake(2.6);
    }
  }

  function rebuildGrid() {
    grid.clear();
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.dying > 0) continue;
      const key = ((en.x / CELL) | 0) + ',' + ((en.y / CELL) | 0);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(en);
    }
  }

  function nearby(x, y, rad, fn) {
    const span = Math.max(1, Math.ceil(rad / CELL));
    const c0 = (x / CELL) | 0;
    const r0 = (y / CELL) | 0;
    for (let cy = r0 - span; cy <= r0 + span; cy++) {
      for (let cx = c0 - span; cx <= c0 + span; cx++) {
        const bucket = grid.get(cx + ',' + cy);
        if (!bucket) continue;
        for (let n = 0; n < bucket.length; n++) fn(bucket[n]);
      }
    }
  }

  function nearestEnemy(x, y, rad) {
    let best = null;
    let bd = rad;
    nearby(x, y, rad, (en) => {
      if (en.life <= 0) return;
      const d = Math.hypot(en.x - x, en.y - y);
      if (d < bd) { bd = d; best = en; }
    });
    return best;
  }

  function openingPack() {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const dist = 3.3 + (i % 3) * 0.3;
      spawnEnemy('skel', Math.cos(ang) * dist, Math.sin(ang) * dist);
    }
  }

  function director(dt) {
    if (bench) return;
    if (time >= MINI_AT && !boss5) {
      boss5 = true;
      const ang = Math.random() * Math.PI * 2;
      spawnEnemy('brute', player.x + Math.cos(ang) * 6.5, player.y + Math.sin(ang) * 6.5, {
        boss: true, name: 'Risen Demon',
      });
      sfx('portal');
    }
    if (!hermit.used && !hermit.on && time >= 75) {
      hermit.on = true;
      hermit.x = Utils.clamp(player.x + 2.6, -ARENA + 2, ARENA - 2);
      hermit.y = Utils.clamp(player.y + 1.4, -ARENA + 2, ARENA - 2);
    }
    if (time >= RUN_SECONDS) {
      runGold += SurvivorData.REWARDS.gold.win;
      finish('won');
      return;
    }
    const rate = time < 20 ? 1.3 : time < 60 ? 2.1 : time < 180 ? 4.2 : time < MINI_AT ? 6.5 : 9;
    const cap = time < 40 ? 16 : time < 120 ? 42 : time < MINI_AT ? 90 : 150;
    spawnAcc += rate * dt;
    let guard = 0;
    while (spawnAcc >= 1 && enemies.length < cap && guard++ < 8) {
      spawnAcc -= 1;
      const roll = Math.random();
      let id = 'skel';
      if (time > 35 && roll > 0.58) id = 'imp';
      if (time > 80 && roll > 0.84) id = 'brute';
      const ang = Math.random() * Math.PI * 2;
      const dist = 8.5 + Math.random() * 2.5;
      spawnEnemy(id, player.x + Math.cos(ang) * dist, player.y + Math.sin(ang) * dist);
    }
  }

  function tickWeapons(dt) {
    cds.bolt -= dt;
    cds.nova -= dt;
    cds.pierce -= dt;
    const aim = nearestEnemy(player.x, player.y, 8.5);
    if (owned.bolt && cds.bolt <= 0 && aim) {
      const dx = aim.x - player.x;
      const dy = aim.y - player.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = T.boltSpeed * (1 + (owned.area || 0) * 0.04);
      spawnShot('bolt', player.x, player.y, (dx / d) * sp, (dy / d) * sp, boltDamage(), 1.4);
      player.swing = 0.16;
      cds.bolt = (0.58 - Math.min(0.28, (owned.bolt - 1) * 0.05)) * haste();
      player.facing = dx >= 0 ? 1 : -1;
      sfx('cast');
    }
    if (owned.nova && cds.nova <= 0) {
      const dmg = (10 + owned.nova * 4) * power();
      spawnShot('nova', player.x, player.y, 0, 0, dmg, 0.45);
      cds.nova = (3.4 - owned.nova * 0.25) * haste();
      sfx('cast');
    }
    if (owned.pierce && cds.pierce <= 0 && aim) {
      const dx = aim.x - player.x;
      const dy = aim.y - player.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = 11;
      const dmg = (16 + owned.pierce * 5) * power();
      spawnShot('pierce', player.x, player.y, (dx / d) * sp, (dy / d) * sp, dmg, 1.1);
      cds.pierce = (2.4 - owned.pierce * 0.15) * haste();
      sfx('swing');
    }
    if (owned.orbit) {
      orbitAngle += dt * (2.2 + owned.orbit * 0.25);
      const count = Math.min(owned.orbit, 4);
      const rad = (1.55 + owned.orbit * 0.12) * area();
      const dmg = (8 + owned.orbit * 3) * power() * dt * 2.2;
      for (let i = 0; i < count; i++) {
        const a = orbitAngle + (i / count) * Math.PI * 2;
        const bx = player.x + Math.cos(a) * rad;
        const by = player.y + Math.sin(a) * rad;
        nearby(bx, by, 1.2, (en) => {
          if (Math.hypot(en.x - bx, en.y - by) < 0.7) damageEnemy(en, dmg, { tick: true });
        });
      }
    }
  }

  function tickShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.life -= dt;
      if (s.kind === 'nova') {
        s.r += dt * 7.5 * area();
        nearby(s.x, s.y, s.r + 0.6, (en) => {
          if (en._nova === s.seq) return;
          const d = Math.hypot(en.x - s.x, en.y - s.y);
          if (d < s.r && d > s.r - 0.85) {
            en._nova = s.seq;
            damageEnemy(en, s.dmg);
          }
        });
      } else {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const hitR = s.kind === 'pierce' ? 0.55 * area() : 0.42;
        nearby(s.x, s.y, hitR + 0.4, (en) => {
          if (s.kind === 'pierce') {
            if (en._pierce === s.seq) return;
            if (Math.hypot(en.x - s.x, en.y - s.y) > hitR) return;
            en._pierce = s.seq;
            damageEnemy(en, s.dmg);
            return;
          }
          if (Math.hypot(en.x - s.x, en.y - s.y) <= hitR) {
            damageEnemy(en, s.dmg);
            s.life = 0;
          }
        });
      }
      if (s.life <= 0) {
        shots.splice(i, 1);
        shotPool.push(s);
      }
    }
  }

  function tickEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (en.hitFlash > 0) en.hitFlash -= dt;
      if (en.dying > 0) {
        en.dying -= dt;
        if (en.dying <= 0) releaseEnemy(i);
        continue;
      }
      if (en.life <= 0) { releaseEnemy(i); continue; }
      if (en.kx || en.ky) {
        en.x += en.kx * dt;
        en.y += en.ky * dt;
        const damp = Math.max(0, 1 - dt * 8);
        en.kx *= damp;
        en.ky *= damp;
      }
      const dx = player.x - en.x;
      const dy = player.y - en.y;
      const dist = Math.hypot(dx, dy) || 1;
      en.x += (dx / dist) * en.speed * dt;
      en.y += (dy / dist) * en.speed * dt;
      en.facing = dx >= 0 ? 1 : -1;
      if (en.touchCd > 0) en.touchCd -= dt;
      if (dist < en.radius + 0.48 && en.touchCd <= 0) {
        en.touchCd = 0.7;
        hurt(en.dmg, en.boss);
      }
    }
  }

  function tickGems(dt) {
    const pull = magnetR();
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const dx = player.x - g.x;
      const dy = player.y - g.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < pull) g.fly = 1;
      if (g.fly) {
        const accel = 42;
        g.vx += (dx / dist) * accel * dt;
        g.vy += (dy / dist) * accel * dt;
        const sp = Math.hypot(g.vx, g.vy);
        if (sp > 18) {
          const k = 18 / sp;
          g.vx *= k;
          g.vy *= k;
        }
        g.x += g.vx * dt;
        g.y += g.vy * dt;
      }
      const ndx = player.x - g.x;
      const ndy = player.y - g.y;
      if (ndx * ndx + ndy * ndy < 0.18) {
        player.xp += g.value;
        spark(player.x, player.y, '#ffffff', 3, 2.6);
        gems.splice(i, 1);
        g.fly = 0;
        g.vx = 0;
        g.vy = 0;
        gemPool.push(g);
        if (time - lootSnd > 0.07) {
          lootSnd = time;
          sfx('loot');
        }
      }
    }
  }

  function checkLevel() {
    if (bench || state !== 'playing') return;
    const need = SurvivorData.xpToNext(player.level);
    if (player.xp < need) return;
    player.xp -= need;
    player.level += 1;
    levelUps += 1;
    openLevel();
  }

  function syncBank() {
    const extra = Math.round(runGold - bankedAmount);
    if (extra <= 0) return;
    SurvivorData.bankGold(extra);
    bankedAmount = runGold;
  }

  function sim(dt) {
    time += dt;
    const minuteNow = Math.floor(time / 60);
    while (minuteMark < minuteNow && minuteMark < 10) {
      minuteMark += 1;
      track(SurvivorData.minuteReachedEvent(minuteMark));
    }
    animT += dt;
    if (player.hitFlash > 0) player.hitFlash -= dt;
    if (player.swing > 0) player.swing = Math.max(0, player.swing - dt);
    if (player.invuln > 0) player.invuln -= dt;
    if (shakeMag > 0) {
      shakeMag = Math.max(0, shakeMag - dt * 12);
      shakePhase += dt * 46;
    }
    if (curse > 0) curse = Math.max(0, curse - dt);
    movePlayer(dt);
    director(dt);
    if (state !== 'playing') return;
    rebuildGrid();
    tickWeapons(dt);
    tickShots(dt);
    tickEnemies(dt);
    if (state !== 'playing') return;
    tickGems(dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) {
        particlePool.push(p);
        particles.splice(i, 1);
      }
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dt;
      f.y -= dt * (f.big ? 1.05 : 0.7);
      if (f.life <= 0) {
        floatPool.push(f);
        floats.splice(i, 1);
      }
    }
    if (hermit.on && !hermit.used && Math.hypot(player.x - hermit.x, player.y - hermit.y) < 1.25) {
      openHermit();
      return;
    }
    checkLevel();
  }

  function movePlayer(dt) {
    let sx = 0;
    let sy = 0;
    if (keys.w || keys.arrowup) sy -= 1;
    if (keys.s || keys.arrowdown) sy += 1;
    if (keys.a || keys.arrowleft) sx -= 1;
    if (keys.d || keys.arrowright) sx += 1;
    if (joy.on) {
      const jx = joy.x - joy.ox;
      const jy = joy.y - joy.oy;
      const mag = Math.hypot(jx, jy);
      if (mag > 14) {
        const scale = Math.min(1, (mag - 14) / 64);
        sx = (jx / mag) * scale;
        sy = (jy / mag) * scale;
      }
    }
    if (sx === 0 && sy === 0) {
      player.moving = false;
      return;
    }
    player.moving = true;
    const len = Math.hypot(sx, sy) || 1;
    const sp = hero.base.move * (1 + (owned.haste || 0) * 0.03);
    player.x += (sx / len) * sp * dt;
    player.y += (sy / len) * sp * dt;
    if (sx !== 0) player.facing = sx > 0 ? 1 : -1;
    clampArena(player, ARENA - 1.2);
  }

  function clearPools() {
    enemies.length = 0;
    gems.length = 0;
    shots.length = 0;
    particles.length = 0;
    floats.length = 0;
    grid.clear();
  }

  function resetRun() {
    clearPools();
    const fresh = blankPlayer();
    Object.assign(player, fresh);
    time = 0;
    kills = 0;
    levelUps = 0;
    runGold = 0;
    bankedAmount = 0;
    doubled = false;
    revived = false;
    ended = false;
    minuteMark = 0;
    spawnAcc = 0;
    boss5 = false;
    curse = 0;
    pickLeft = 0;
    hits = 0;
    owned = { bolt: 1 };
    cds = { bolt: T.firstBolt, nova: 1.6, pierce: 1.2 };
    orbitAngle = 0;
    hermit.on = false;
    hermit.used = false;
    joy.on = false;
  }

  function startRun() {
    const preview = previewOnce;
    previewOnce = '';
    resetRun();
    if (preview === 'crowd' || preview === 'boss') time = MINI_AT - 1;
    state = 'playing';
    hide('sv-title');
    hide('sv-level');
    hide('sv-end');
    hide('sv-pause');
    hide('sv-hermit');
    show('sv-hud');
    if (bench) {
      for (let i = 0; i < 300; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 0.45 + Math.random() * 6.2;
        const id = i % 7 === 0 ? 'brute' : i % 3 === 0 ? 'imp' : 'skel';
        spawnEnemy(id, Math.cos(ang) * dist, Math.sin(ang) * dist);
      }
    } else if (preview === 'crowd') {
      openingPack();
      for (let i = 0; i < 110; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 1.15 + Math.random() * 3.1;
        const id = i % 8 === 0 ? 'brute' : i % 2 === 0 ? 'imp' : 'skel';
        spawnEnemy(id, Math.cos(ang) * dist, Math.sin(ang) * dist);
      }
      spawnEnemy('brute', 2.1, 0.4, { boss: true, name: 'Risen Demon' });
      boss5 = true;
    } else if (preview === 'boss') {
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const id = i % 4 === 0 ? 'imp' : 'skel';
        spawnEnemy(id, Math.cos(ang) * (1.5 + (i % 3) * 0.45), Math.sin(ang) * (1.5 + (i % 3) * 0.45));
      }
      spawnEnemy('brute', 1.7, 0.15, { boss: true, name: 'Risen Demon' });
      boss5 = true;
    } else if (preview === 'juice') {
      cds.bolt = 0.05;
      for (let i = 0; i < 28; i++) {
        const ang = (i / 28) * Math.PI * 2;
        const dist = 2.15 + (i % 5) * 0.72;
        const id = i % 11 === 0 ? 'brute' : i % 3 === 0 ? 'imp' : 'skel';
        const en = spawnEnemy(id, Math.cos(ang) * dist, Math.sin(ang) * dist);
        en.maxLife = id === 'brute' ? 40 : 18;
        en.life = en.maxLife;
      }
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 + 0.2;
        const dist = 3.8 + (i % 4) * 0.22;
        const g = gemPool.pop() || {};
        g.x = Math.cos(ang) * dist;
        g.y = Math.sin(ang) * dist;
        g.value = 1;
        g.vx = 0;
        g.vy = 0;
        g.fly = 0;
        gems.push(g);
      }
    } else {
      openingPack();
    }
    track('survivor-run-started');
    if (preview === 'level') {
      player.xp = SurvivorData.xpToNext(1);
      checkLevel();
    } else if (preview === 'dead') {
      kills = 12;
      player.level = 3;
      levelUps = 2;
      runGold = 18;
      time = 48;
      finish('dead');
    }
    sfx('ui');
  }

  function finish(kind) {
    if (ended) return;
    ended = true;
    state = kind === 'won' ? 'won' : 'dead';
    joy.on = false;
    track(SurvivorData.levelReachedEvent(player.level));
    track(SurvivorData.levelUpCountEvent(levelUps));
    if (kind === 'won') track('survivor-won');
    else track(SurvivorData.deathEvent(time));
    sfx(kind === 'won' ? 'clear' : 'defeat');
    syncBank();
    const title = $('sv-end-title');
    if (title) title.textContent = kind === 'won' ? 'You survived' : 'You have fallen';
    const stats = $('sv-end-stats');
    if (stats) {
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      const clock = m + ':' + String(s).padStart(2, '0');
      stats.textContent = 'Time ' + clock + '  ·  Kills ' + kills + '  ·  Level ' + player.level + '  ·  Gold ' + runGold;
    }
    const reviveBtn = $('sv-revive');
    if (reviveBtn) reviveBtn.classList.toggle('hidden', kind !== 'dead' || revived);
    hide('sv-level');
    hide('sv-pause');
    hide('sv-hermit');
    show('sv-end');
  }

  function openLevel() {
    state = 'levelup';
    joy.on = false;
    offers = SurvivorData.pickOffers(owned);
    const box = $('sv-cards');
    box.innerHTML = '';
    offers.forEach((item, i) => {
      const lv = owned[item.id] || 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sv-card';
      btn.dataset.choice = String(i);
      const rank = item.kind === 'reward' ? '' : '<span>Rank ' + (lv + 1) + '</span>';
      btn.innerHTML = '<b>' + item.name + '</b>' + rank + '<small>' + item.blurb + '</small>';
      box.appendChild(btn);
    });
    show('sv-level');
    sfx('level');
  }

  function applyChoice(item) {
    if (!item) return;
    if (item.id === 'purse') {
      runGold += SurvivorData.REWARDS.gold.purse;
      return;
    }
    if (item.id === 'heal') {
      player.life = Math.min(player.maxLife, player.life + player.maxLife * 0.3);
      return;
    }
    owned[item.id] = (owned[item.id] || 0) + 1;
    if (item.id === 'vitality') {
      player.maxLife += 15;
      player.life += 15;
    }
  }

  function choose(index) {
    if (state !== 'levelup') return;
    applyChoice(offers[index]);
    hide('sv-level');
    if (pickLeft > 1) {
      pickLeft -= 1;
      openLevel();
      return;
    }
    pickLeft = 0;
    state = 'playing';
    sfx('ui');
  }

  function rerollOffers() {
    if (state !== 'levelup') return;
    offers = SurvivorData.pickOffers(owned);
    openLevel();
  }

  function openHermit() {
    hermit.on = false;
    hermit.used = true;
    state = 'hermit';
    joy.on = false;
    show('sv-hermit');
    sfx('talk');
  }

  function acceptHermit() {
    hide('sv-hermit');
    curse = 60;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      en.maxLife = Math.round(en.maxLife * 1.5);
      en.life = Math.round(en.life * 1.5);
    }
    pickLeft = 2;
    openLevel();
  }

  function declineHermit() {
    hide('sv-hermit');
    state = 'playing';
  }

  function openPause() {
    if (state !== 'playing') return;
    state = 'paused';
    joy.on = false;
    show('sv-pause');
  }

  function resumePlay() {
    if (state !== 'paused') return;
    state = 'playing';
    hide('sv-pause');
  }

  function onHardwareBack() {
    if (state === 'paused') { resumePlay(); return; }
    if (state === 'playing') openPause();
  }

  function quitToTitle() {
    let ok = false;
    try { ok = window.confirm('Quit this run?'); } catch (e) { ok = false; }
    if (!ok) return;
    const app = capacitorApp();
    if (app && typeof app.exitApp === 'function') {
      try { app.exitApp(); return; } catch (e) {}
    }
    state = 'title';
    joy.on = false;
    hide('sv-pause');
    hide('sv-hud');
    hide('sv-end');
    show('sv-title');
  }

  function capacitorApp() {
    try {
      const cap = window.Capacitor;
      if (!cap) return null;
      if (cap.Plugins && cap.Plugins.App) return cap.Plugins.App;
      if (typeof cap.registerPlugin === 'function') return cap.registerPlugin('App');
    } catch (e) {}
    return null;
  }

  function onBackground() {
    if (backgrounded) return;
    backgrounded = true;
    try { GameAudio.holdMute(true); } catch (e) {}
    if (state === 'playing') {
      resumeState = 'playing';
      state = 'paused';
      show('sv-pause');
    }
  }

  function onForeground() {
    if (!backgrounded) return;
    backgrounded = false;
    try { GameAudio.holdMute(false); } catch (e) {}
    if (resumeState === 'playing' && state === 'paused') {
      resumeState = null;
      state = 'playing';
      hide('sv-pause');
    } else {
      resumeState = null;
    }
  }

  function bindLife() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onBackground();
      else onForeground();
    });
    const app = capacitorApp();
    if (!app || typeof app.addListener !== 'function') return;
    try {
      const back = app.addListener('backButton', () => { try { onHardwareBack(); } catch (e) {} });
      const change = app.addListener('appStateChange', (ev) => {
        try {
          if (ev && ev.isActive === false) onBackground();
          else onForeground();
        } catch (e) {}
      });
      if (back && back.catch) back.catch(() => {});
      if (change && change.catch) change.catch(() => {});
    } catch (e) {}
  }

  function hud() {
    const hp = $('sv-hp');
    const hpText = $('sv-hp-text');
    const xp = $('sv-xp');
    const xpText = $('sv-xp-text');
    if (hp) hp.style.width = (100 * player.life / player.maxLife) + '%';
    if (hpText) hpText.textContent = Math.ceil(player.life) + '/' + player.maxLife;
    const need = SurvivorData.xpToNext(player.level);
    if (xp) xp.style.width = (100 * Math.min(1, player.xp / need)) + '%';
    if (xpText) xpText.textContent = 'Lv ' + player.level;
    const clock = $('sv-time');
    if (clock) {
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      clock.textContent = m + ':' + String(s).padStart(2, '0');
    }
    const k = $('sv-kills');
    if (k) k.textContent = 'Kills ' + kills;
    const g = $('sv-gold');
    if (g) g.textContent = 'Gold ' + runGold;
    const vow = $('sv-vow');
    if (vow) {
      vow.classList.toggle('hidden', curse <= 0);
      vow.textContent = 'Vow ' + Math.ceil(curse) + 's';
    }
    const fps = $('sv-fps');
    if (fps && debug) {
      fps.classList.remove('hidden');
      fps.textContent = Math.round(fpsSmooth) + ' fps' + (bench ? ' · ' + enemies.length + ' foes' : '');
    }
  }

  function drawArena() {
    ctx.imageSmoothingEnabled = false;
    SurvivorSprites.drawGround(ctx, camX, camY, ARENA);
  }

  function heroOpts() {
    return {
      flash: player.hitFlash > 0,
      moving: player.moving,
      facing: player.facing,
      time: animT,
      lunge: player.swing || 0,
    };
  }

  function drawHeroBody() {
    const s = worldToScreen(player.x, player.y);
    SurvivorSprites.drawHero(ctx, s.x, s.y, heroOpts());
    if (player.life < player.maxLife) {
      ctx.fillStyle = '#200808';
      ctx.fillRect(s.x - 16, s.y - 30 * zoom - 4, 32, 4);
      ctx.fillStyle = '#c03030';
      ctx.fillRect(s.x - 16, s.y - 30 * zoom - 4, 32 * (player.life / player.maxLife), 4);
    }
  }

  function drawFoe(en, crowd) {
    const s = worldToScreen(en.x, en.y);
    if (s.x < -96 || s.y < -120 || s.x > canvas.width + 96 || s.y > canvas.height + 40) return;
    SurvivorSprites.drawFoe(ctx, s.x, s.y, {
      eid: en.eid,
      boss: en.boss,
      facing: en.facing,
      scale: en.scale,
      color: en.color,
      flash: en.hitFlash > 0,
      dying: en.dying || 0,
      crowd: crowd,
      time: animT,
    });
  }

  function drawGem(g) {
    const s = worldToScreen(g.x, g.y);
    if (s.x < -20 || s.y < -20 || s.x > canvas.width + 20 || s.y > canvas.height + 20) return;
    SurvivorSprites.drawGem(ctx, s.x, s.y);
  }

  function drawHermit() {
    if (!hermit.on) return;
    const s = worldToScreen(hermit.x, hermit.y);
    SurvivorSprites.drawHermit(ctx, s.x, s.y, animT);
    ctx.fillStyle = '#d8dce4';
    ctx.font = '11px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('Hermit', s.x, s.y + 18);
  }

  function drawWeapons() {
    if (owned.orbit) {
      const count = Math.min(owned.orbit, 4);
      const rad = (1.55 + owned.orbit * 0.12) * area();
      for (let i = 0; i < count; i++) {
        const a = orbitAngle + (i / count) * Math.PI * 2;
        const s = worldToScreen(player.x + Math.cos(a) * rad, player.y + Math.sin(a) * rad);
        SurvivorSprites.drawBolt(ctx, s.x, s.y, a);
      }
    }
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const s = worldToScreen(shot.x, shot.y);
      if (shot.kind === 'nova') {
        const px = shot.r * TILE;
        ctx.beginPath();
        ctx.arc(s.x, s.y, px, 0, Math.PI * 2);
        ctx.strokeStyle = '#14180c';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = '#e8ff6a';
        ctx.lineWidth = 3;
        ctx.stroke();
      } else {
        SurvivorSprites.drawBolt(ctx, s.x, s.y, Math.atan2(shot.vy, shot.vx));
      }
    }
  }

  function drawJoy() {
    if (!joy.on) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const ox = (joy.ox - rect.left) * scaleX;
    const oy = (joy.oy - rect.top) * scaleY;
    const x = (joy.x - rect.left) * scaleX;
    const y = (joy.y - rect.top) * scaleY;
    ctx.strokeStyle = 'rgba(224,192,128,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ox, oy, 46 * scaleX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(224,160,96,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 18 * scaleX, 0, Math.PI * 2);
    ctx.fill();
  }

  function byY(a, b) { return a.y - b.y; }

  function drawActors() {
    drawOrder.length = 0;
    for (let i = 0; i < enemies.length; i++) drawOrder.push(enemies[i]);
    drawOrder.sort(byY);
    const crowd = enemies.length > 100;
    let hermitDrawn = !hermit.on;
    for (let i = 0; i < drawOrder.length; i++) {
      const en = drawOrder[i];
      if (!hermitDrawn && hermit.y <= en.y) {
        drawHermit();
        hermitDrawn = true;
      }
      drawFoe(en, crowd);
    }
    if (!hermitDrawn) drawHermit();
    const s = worldToScreen(player.x, player.y);
    SurvivorSprites.drawHeroRing(ctx, s.x, s.y);
    drawHeroBody();
  }

  function drawFloats() {
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (let i = 0; i < floats.length; i++) {
      const f = floats[i];
      const s = worldToScreen(f.x, f.y);
      const max = f.max || 0.72;
      const age = 1 - f.life / max;
      const pop = 1 + Math.max(0, (f.big ? 0.5 : 0.22) - age) * (f.big ? 1.35 : 1.15);
      const size = Math.round((f.big ? 28 : 15) * pop);
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 2.4));
      ctx.font = (f.big ? '800 ' : 'bold ') + size + 'px Segoe UI';
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#140e0c';
      ctx.strokeText(f.text, s.x, s.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    camX = Math.round(canvas.width / 2 - player.x * TILE);
    camY = Math.round(canvas.height / 2 - player.y * TILE);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#100c0c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (shakeMag > 0) {
      ctx.translate(
        Math.round(Math.sin(shakePhase) * shakeMag),
        Math.round(Math.cos(shakePhase * 0.83) * shakeMag)
      );
    }
    drawArena();
    for (let i = 0; i < gems.length; i++) {
      if (!gems[i].fly) drawGem(gems[i]);
    }
    drawActors();
    for (let i = 0; i < gems.length; i++) {
      if (gems[i].fly) drawGem(gems[i]);
    }
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const s = worldToScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life * 3);
      ctx.fillStyle = '#140e0c';
      ctx.fillRect(s.x - 2.5, s.y - 2.5, 5, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    drawWeapons();
    drawFloats();
    ctx.restore();
    drawJoy();
  }

  function uiBlock(target) {
    return target && target.closest && target.closest('button, a, .sv-card, .panel, #adtest-panel, #adtest-prompt');
  }

  function bind() {
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 80));
    $('sv-play').addEventListener('click', () => startRun());
    $('sv-resume').addEventListener('click', () => resumePlay());
    $('sv-pause-btn').addEventListener('click', () => openPause());
    $('sv-quit').addEventListener('click', () => quitToTitle());
    $('sv-restart').addEventListener('click', () => {
      track('survivor-restart');
      startRun();
    });
    $('sv-revive').addEventListener('click', () => {
      if (state !== 'dead' || revived) return;
      try { Ads.offerRevive(); } catch (e) {}
    });
    $('sv-double').addEventListener('click', () => {
      if (state !== 'dead' && state !== 'won') return;
      try { Ads.offerDoubleGold(); } catch (e) {}
    });
    $('sv-reroll').addEventListener('click', () => {
      if (state !== 'levelup') return;
      try { Ads.offerReroll(); } catch (e) {}
    });
    $('sv-cards').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-choice]');
      if (!btn) return;
      choose(Number(btn.dataset.choice));
    });
    $('sv-hermit-yes').addEventListener('click', () => acceptHermit());
    $('sv-hermit-no').addEventListener('click', () => declineHermit());

    window.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase();
      if (k === 'escape') {
        e.preventDefault();
        if (state === 'paused') resumePlay();
        else if (state === 'playing') openPause();
        return;
      }
      if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k.indexOf('arrow') === 0) {
        e.preventDefault();
        keys[k] = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      keys[(e.key || '').toLowerCase()] = false;
    });

    function down(e) {
      if (e.button != null && e.button !== 0) return;
      if (uiBlock(e.target)) return;
      if (state !== 'playing') return;
      joy.on = true;
      joy.id = e.pointerId;
      joy.ox = joy.x = e.clientX;
      joy.oy = joy.y = e.clientY;
    }
    function move(e) {
      if (!joy.on || (e.pointerId != null && e.pointerId !== joy.id)) return;
      joy.x = e.clientX;
      joy.y = e.clientY;
    }
    function up(e) {
      if (e.pointerId != null && joy.id != null && e.pointerId !== joy.id) return;
      joy.on = false;
      joy.id = null;
    }
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    try {
      Ads.setFlush(false);
      Ads.setCombat(() => state === 'playing' || state === 'paused' || state === 'hermit');
      Ads.onResult((kind, reason) => {
        if (reason !== 'accept') return;
        if (kind === 'reroll' && state === 'levelup') rerollOffers();
        if (kind === 'revive' && state === 'dead' && !revived) {
          revived = true;
          player.life = Math.round(player.maxLife * 0.55);
          player.invuln = 1.4;
          ended = false;
          state = 'playing';
          hide('sv-end');
          for (let i = enemies.length - 1; i >= 0; i--) {
            const en = enemies[i];
            if (Math.hypot(en.x - player.x, en.y - player.y) < 3.2) releaseEnemy(i);
          }
        }
        if (kind === 'gold' && (state === 'dead' || state === 'won') && !doubled) {
          doubled = true;
          const extra = Math.round(runGold * (SurvivorData.REWARDS.doubleMult - 1));
          runGold += extra;
          syncBank();
          const stats = $('sv-end-stats');
          if (stats) stats.textContent = stats.textContent.replace(/Gold \d+/, 'Gold ' + runGold);
        }
      });
    } catch (e) {}
    bindLife();
    if (debug) {
      window.__sv = () => ({
        state, time, kills, level: player.level, levelUps, hits,
        enemies: enemies.length, gems: gems.length, floats: floats.length,
        x: player.x, y: player.y, life: player.life,
        art: SurvivorSprites.ready(),
      });
      if (/preview=juice/.test(search)) {
        window.__svFlash = () => {
          let n = 0;
          for (let i = 0; i < enemies.length && n < 6; i++) {
            const en = enemies[i];
            if (en.dying > 0 || en.life <= 0) continue;
            en.hitFlash = 0.08;
            n += 1;
          }
          return n;
        };
        window.__svGems = () => {
          for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * Math.PI * 2 + 0.2;
            const dist = 3.2 + (i % 4) * 0.4;
            const g = gemPool.pop() || {};
            g.x = player.x + Math.cos(ang) * dist;
            g.y = player.y + Math.sin(ang) * dist;
            g.value = 1;
            g.vx = 0;
            g.vy = 0;
            g.fly = 0;
            gems.push(g);
          }
          return gems.length;
        };
      }
    }
  }

  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    if (dt > 0) {
      const inst = 1 / dt;
      fpsSmooth = fpsSmooth ? fpsSmooth * 0.9 + inst * 0.1 : inst;
    }
    if (state === 'playing') sim(dt);
    else animT += dt;
    if (bench && state === 'playing') {
      if (!benchStart) benchStart = now;
      benchFrames.push(dt);
      if (!benchDone && now - benchStart > 3000) {
        benchDone = true;
        let sum = 0;
        let min = Infinity;
        for (let i = 0; i < benchFrames.length; i++) {
          const f = 1 / benchFrames[i];
          sum += f;
          if (f < min) min = f;
        }
        const avg = sum / benchFrames.length;
        window.__fps = { avg, min, enemies: enemies.length, frames: benchFrames.length };
        const out = $('sv-bench');
        if (out) {
          out.classList.remove('hidden');
          out.textContent = 'Bench ' + enemies.length + ' foes · avg ' + avg.toFixed(1) + ' fps · min ' + min.toFixed(1);
        }
      }
    }
    draw();
    hud();
    requestAnimationFrame(frame);
  }

  bind();
  SurvivorSprites.load('assets/0x72/dungeon-tileset-ii.png?v=3');
  if (bench || previewOnce) startRun();
  requestAnimationFrame(frame);
})();
