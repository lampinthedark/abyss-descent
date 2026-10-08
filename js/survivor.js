/** Survivor mode. Top-down arena. One thumb steers; the staff fires on its own. */
(() => {
  let TILE = 48;
  let zoom = 3;
  const CELL = 3;
  const RUN_SECONDS = 600;
  const MINI_AT = 300;
  const PARTICLE_CAP = 40;
  const FLOAT_CAP = 40;
  const GEM_CAP = 180;

  const search = (typeof location !== 'undefined' && location.search) || '';
  const debug = /(?:^|[?&])debug=1(?:&|$)/.test(search);
  const bench = /(?:^|[?&])bench=1(?:&|$)/.test(search);
  const headless = /(?:^|[?&])headless=1(?:&|$)/.test(search);
  const adsOn = /(?:^|[?&])adtest=1(?:&|$)/.test(search);
  const previewMatch = /(?:^|[?&])preview=([a-z0-9]+)/.exec(search);
  let previewOnce = previewMatch ? previewMatch[1] : '';
  const debugClockMatch = /(?:^|[?&])t=(\d+(?:\.\d+)?)(?:&|$)/.exec(search);
  const debugClock = debug && debugClockMatch ? Number(debugClockMatch[1]) : 0;
  const walkCircle = !!(debug && /(?:^|[?&])walk=circle(?:&|$)/.test(search));

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
  const drawOrder = new Array(64);
  let drawCount = 0;
  const GRID_N = 2048;
  const gridBuckets = new Array(GRID_N);
  const gridCount = new Int16Array(GRID_N);
  const gridStamp = new Int32Array(GRID_N);
  const gridCx = new Int32Array(GRID_N);
  const gridCy = new Int32Array(GRID_N);
  let gridGen = 1;
  const nearList = new Array(512);
  let nearCount = 0;
  const spotScratch = { x: 0, y: 0 };
  const chainInfo = { chain: 1 };
  const novaInfo = { radius: 0, rank: 1 };
  const bladePos = [
    { x: 0, y: 0, angle: 0 },
    { x: 0, y: 0, angle: 0 },
    { x: 0, y: 0, angle: 0 },
    { x: 0, y: 0, angle: 0 },
    { x: 0, y: 0, angle: 0 },
    { x: 0, y: 0, angle: 0 },
    { x: 0, y: 0, angle: 0 },
    { x: 0, y: 0, angle: 0 },
  ];
  const bladeView = [];
  const bladeInfo = { radius: 0, positions: bladeView };
  const camInfo = { x: 0, y: 0, zoom: 2 };
  const heroDraw = { flash: false, moving: false, facing: 1, time: 0, lunge: 0 };
  const foeDraw = {
    eid: '', sprite: '', boss: false, facing: 1, scale: 1, color: '#d7dbe3',
    flash: false, dying: 0, crowd: false, time: 0,
  };
  const visScratch = { frame: null, scale: 1, flip: false, boss: false, elite: false, fid: 0 };
  const gemKeyX = [];
  const gemKeyY = [];
  const gemLists = [];
  const gemListN = [];
  let gemKeyN = 0;

  function len2(x, y) {
    return Math.sqrt(x * x + y * y);
  }
  const emptyBonus = { might: 0, life: 0, greed: 0 };
  const numText = [];
  const fontCache = {};
  const RARITY_FILL = {
    common: '#8a857d',
    uncommon: '#5ed37a',
    rare: '#4c7cff',
    epic: '#d0b4ff',
    legendary: '#f2f6ff',
  };

  let state = 'title';
  let resumeState = null;
  let backgrounded = false;
  let time = 0;
  let kills = 0;
  let levelUps = 0;
  let runGold = 0;
  let goldMilli = 0;
  let gemChain = 0;
  let gemChainAt = -10;
  let doubleLocked = false;
  let bankedAmount = 0;
  let doubled = false;
  let revived = false;
  let ended = false;
  let minuteMark = 0;
  let spawnAcc = 0;
  let boss5 = false;
  let curse = 0;
  let pickLeft = 0;
  let vowPayout = false;
  let vowResume = false;
  let vowCount = 0;
  let vowsSurvived = 0;
  let vowActive = false;
  let hermitDeclines = 0;
  let nextVowAt = 32;
  let vowSeen = false;
  let spawnSerial = 0;
  let eliteWarned = false;
  let eliteSpawned = false;
  let wardenCleared = false;
  let demonCleared = false;
  let demonWarned = false;
  let banner = '';
  let bannerT = 0;
  let warnOn = false;
  let nextOfferLine = '';
  let secondChanceFx = 0;
  const evoQueued = {};
  let evolveFreeze = 0;
  let evolvePending = '';
  const evolveQueue = [];
  let spawnedThisFrame = 0;
  let uiGuardUntil = 0;
  let regen = 0;
  let revivalLeft = 0;
  let secondChance = 0;
  let partnerPulse = 0;
  const evoLog = [];
  let simTick = 0;
  let scriptMove = null;
  let chestReady = false;
  const evolved = {};
  const foeShots = [];
  const foeShotPool = [];
  let rerollUsed = false;
  let foeSeq = 1;
  let novaSeq = 0;
  let pierceSeq = 0;
  let hitSnd = 0;
  let lootSnd = 0;
  let camX = 0;
  let camY = 0;
  let shakeMag = 0;
  let shakePhase = 0;
  let reduceMotion = false;
  let reduceQuery = null;
  try {
    reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = !!reduceQuery.matches;
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

  function shopRank(id) {
    try { return SurvivorSave.rank(id); } catch (e) { return 0; }
  }

  function itemStats() {
    try { return SurvivorSave.itemBonus(); } catch (e) { return emptyBonus; }
  }

  function ntext(n) {
    const v = n | 0;
    if (v >= 0 && v < 400) {
      let s = numText[v];
      if (!s) {
        s = String(v);
        numText[v] = s;
      }
      return s;
    }
    return String(v);
  }

  function floatFont(big, size) {
    const key = (big ? 1000 : 0) + size;
    let s = fontCache[key];
    if (!s) {
      s = (big ? '800 ' : 'bold ') + size + 'px Segoe UI';
      fontCache[key] = s;
    }
    return s;
  }

  function vowMult() {
    if (vowCount >= 3) return 3;
    if (vowCount === 2) return 2;
    if (vowCount === 1) return 1.5;
    return 1;
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function tapBlocked() {
    return nowMs() < uiGuardUntil;
  }

  function grantGold(amount) {
    if (!(amount > 0)) return;
    goldMilli += Math.round(amount * 1000);
    const whole = Math.floor(goldMilli / 1000);
    if (whole <= 0) return;
    runGold += whole;
    goldMilli -= whole * 1000;
  }

  // Pickup streak for the later sound pass: +1 semitone per gem, capped at 12.
  function bumpGemChain() {
    if (time - gemChainAt > 0.4) gemChain = 0;
    gemChain += 1;
    gemChainAt = time;
    return gemChain;
  }

  function gemChainPitch() {
    return Math.min(12, gemChain);
  }

  function blankPlayer() {
    let bonusLife = 0;
    try { bonusLife = SurvivorSave.itemBonus().life + shopRank('vitality') * 12; } catch (e) {}
    const maxLife = Math.max(1, Math.round(hero.base.life + bonusLife));
    return {
      x: 0, y: 0,
      classId: hero.id,
      life: maxLife,
      maxLife: maxLife,
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

  function sxOf(x) { return x * TILE + camX; }
  function syOf(y) { return y * TILE + camY; }

  function addShake(amount) {
    if (reduceMotion || bench || !(amount > 0)) return;
    shakeMag = Math.min(5.5, shakeMag + amount);
  }

  function hpFor(id, bossKind) {
    const wave = 1 + Math.floor(time / 60) * 0.12;
    let hp = T.earlyHp;
    if (id === 'imp') hp = 16;
    else if (id === 'charger') hp = 28;
    else if (id === 'shooter') hp = 18;
    else if (id === 'brute') hp = 40;
    if (bossKind === 'warden') hp = 990;
    else if (bossKind === 'demon') hp = 1800;
    else hp = Math.round(hp * wave);
    if (curse > 0) hp = Math.round(hp * 1.5);
    return hp;
  }

  typeById.charger = { id: 'charger', name: 'Charger', speed: 1.25, radius: 0.34, behaviour: 'charger' };
  typeById.shooter = { id: 'shooter', name: 'Shooter', speed: 1.05, radius: 0.3, behaviour: 'shooter' };

  function spawnEnemy(id, x, y, opts) {
    const type = typeById[id] || typeById.skel;
    const en = enemyPool.pop() || {};
    const bossKind = (opts && opts.bossKind) || '';
    const bossFlag = !!bossKind || !!(opts && opts.boss);
    en.alive = true;
    en.eid = type.id;
    en.name = (opts && opts.name) || type.name;
    en.color = type.id === 'imp' || type.id === 'shooter' ? '#7b4fd4' : type.id === 'charger' ? '#6d8a62' : type.id === 'brute' ? '#8e97a3' : '#d7dbe3';
    en.x = x;
    en.y = y;
    en.radius = type.radius || 0.32;
    en.speed = (type.speed || 1) * (bossFlag ? 0.58 : 0.5);
    en.dmg = bossFlag ? 12 : (type.id === 'brute' ? 8 : type.id === 'charger' ? 7 : type.id === 'imp' ? 5 : type.id === 'shooter' ? 4 : 5);
    en.maxLife = bench ? 99999 : hpFor(type.id, bossKind || (bossFlag ? 'demon' : ''));
    en.life = en.maxLife;
    en.boss = bossFlag;
    en.bossKind = bossKind || (bossFlag ? 'demon' : '');
    en.sprite = bossKind === 'warden' ? 'warden' : '';
    en.elite = bossFlag || type.id === 'brute';
    en.behaviour = bossFlag ? 'boss' : (type.behaviour || 'seek');
    if (!en.ai) en.ai = { mode: 'seek', t: 0, vx: 1, vy: 0 };
    else {
      en.ai.mode = 'seek';
      en.ai.t = 0;
      en.ai.vx = 1;
      en.ai.vy = 0;
    }
    en.hitFlash = 0;
    en.dying = 0;
    en.kx = 0;
    en.ky = 0;
    en.touchCd = 0.25;
    en.facing = x < player.x ? 1 : -1;
    en.fid = ++foeSeq;
    en.scale = bossKind === 'demon' || (bossFlag && !bossKind) ? 1 : bossKind === 'warden' ? 0.9 : (type.id === 'brute' ? 0.625 : 1);
    if (bossKind === 'warden') en.radius = 0.78;
    else if (bossFlag) en.radius = 0.9;
    en.flashAt = 0;
    const greed = (1 + shopRank('greed') * 0.08) * (1 + (itemStats().greed || 0)) * vowMult();
    const baseGold = bossFlag ? SurvivorData.REWARDS.gold.mini : (SurvivorData.REWARDS.gold[type.id] || 1);
    en.gold = baseGold * greed;
    en.xp = bossFlag ? 14 : type.id === 'brute' ? 5 : T.gemXp;
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
    g.kind = 'gem';
    g.item = null;
    g.vx = 0;
    g.vy = 0;
    g.fly = 0;
    g.age = 0;
    g.big = false;
    gems.push(g);
    if (en.boss) dropPickup(en, 'chest', null);
    else if (en.elite && (en.fid % 4 === 0)) dropPickup(en, 'heart', null);
    if (en.boss || (en.elite && en.fid % 5 === 0)) {
      try { dropPickup(en, 'item', SurvivorSave.mintDrop(en.boss ? 'boss' : 'elite')); } catch (e) {}
    }
  }

  function dropPickup(en, kind, item) {
    if (gems.length >= GEM_CAP) return;
    const g = gemPool.pop() || {};
    g.x = en.x + (kind === 'item' ? 0.45 : kind === 'heart' ? -0.35 : 0);
    g.y = en.y + (kind === 'chest' ? 0.2 : 0);
    g.kind = kind;
    g.value = 0;
    g.item = item || null;
    g.vx = 0;
    g.vy = 0;
    g.fly = 0;
    g.age = 0;
    g.big = false;
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

  function floatText(x, y, text, color, big, fid, amount) {
    if (fid) {
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        if (f.fid === fid && time - f.stamp < 0.25) {
          f.amount += amount || 0;
          f.text = ntext(f.amount);
          f.x = x;
          f.y = y;
          f.stamp = time;
          f.life = 0.72;
          f.big = !!big || f.amount >= 18;
          return;
        }
      }
    }
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
    f.fid = fid || 0;
    f.amount = amount || 0;
    f.stamp = time;
    floats.push(f);
  }

  let fxUpdateMs = 0;
  let fxDrawMs = 0;

  function fxCall(name, a, b, c, d) {
    const box = typeof FX !== 'undefined' ? FX : null;
    const fn = box && box[name];
    if (typeof fn !== 'function') return;
    if (name === 'secondChance') secondChanceFx += 1;
    const t0 = nowMs();
    const n = arguments.length;
    if (n <= 1) fn.call(box);
    else if (n === 2) fn.call(box, a);
    else if (n === 3) fn.call(box, a, b);
    else if (n === 4) fn.call(box, a, b, c);
    else fn.call(box, a, b, c, d);
    const spent = nowMs() - t0;
    if (name === 'draw') fxDrawMs += spent;
    else fxUpdateMs += spent;
  }

  function foeVisual(en) {
    const known = en.eid === 'brute' || en.eid === 'imp' || en.eid === 'skel' || en.eid === 'charger' || en.eid === 'shooter';
    const id = en.sprite || (en.boss ? 'boss' : (known ? en.eid : 'skel'));
    const clip = en.dying > 0 ? 'idle' : 'run';
    let frame = null;
    try { frame = SurvivorSprites.frameRect(id, clip, animT); } catch (e) {}
    visScratch.frame = frame;
    visScratch.scale = en.scale || 1;
    visScratch.flip = (en.facing || 1) > 0;
    visScratch.boss = !!en.boss;
    visScratch.elite = !!en.elite && !en.boss;
    visScratch.fid = en.fid;
    return visScratch;
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
    const steps = [0, 0.06, 0.1, 0.24, 0.3, 0.48];
    const rank = Math.min(5, owned.might || 0);
    let itemMight = 0;
    try { itemMight = itemStats().might; } catch (e) {}
    return (1 + steps[rank]) * (1 + shopRank('might') * 0.06 + itemMight);
  }
  function haste() {
    const steps = [1, 0.94, 0.9, 0.78, 0.74, 0.62];
    const rank = Math.min(5, owned.haste || 0);
    return steps[rank];
  }
  function area() {
    const steps = [0, 0.06, 0.1, 0.22, 0.28, 0.42];
    const rank = Math.min(5, owned.area || 0);
    return 1 + steps[rank];
  }
  function armorCut() {
    const steps = [0, 1, 2, 3, 4, 6];
    return steps[Math.min(5, owned.armor || 0)];
  }
  function moveSpeed() {
    const hasteMove = 1 + Math.min(5, owned.haste || 0) * 0.02;
    return hero.base.move * hasteMove * (1 + shopRank('stride') * 0.04);
  }
  function boltDamage() {
    const rank = Math.max(1, Math.min(5, owned.bolt || 1));
    const steps = [1, 1.15, 1.35, 1.5, 1.85];
    return T.boltDamage * steps[rank - 1] * power();
  }
  function pxToWorld(px) {
    return px / Math.max(1, TILE);
  }
  function magnetR() {
    const ranks = (owned.magnet || 0) + shopRank('magnet');
    return pxToWorld(150 + ranks * 40);
  }
  function pickupR() {
    return pxToWorld(36);
  }

  function hurt(amount, heavy) {
    if (bench || player.invuln > 0 || state !== 'playing') return;
    const dmg = Math.max(1, amount - armorCut());
    player.life -= dmg;
    player.hitFlash = 0.16;
    player.invuln = 0.45;
    addShake(heavy ? 4.2 : 2.6);
      floatText(player.x, player.y - 0.4, ntext(dmg), '#ff8060', true);
    sfx('hurt');
    if (player.life <= 0) {
      if (revivalLeft > 0) {
        revivalLeft -= 1;
        secondChance += 1;
        player.maxLife = Math.max(1, Math.round(player.maxLife));
        player.life = Math.max(1, Math.round(player.maxLife * 0.3));
        player.invuln = 1.35;
        raiseBanner('Second Chance!');
        fxCall('secondChance', player.x, player.y);
        return;
      }
      player.life = 0;
      finish('dead');
    }
  }

  function damageEnemy(en, amount, tick) {
    if (!en || en.life <= 0 || en.dying > 0) return;
    en.life -= amount;
    if (!tick) {
      const heavy = !!(en.boss || en.elite);
      if (!heavy || time >= (en.flashAt || 0)) {
        en.hitFlash = 0.08;
        if (heavy) en.flashAt = time + 0.35;
      }
      hits += 1;
    }
    if (!tick && time - hitSnd > 0.08) {
      hitSnd = time;
      sfx('hit');
    }
    if (!tick) {
      const shown = Math.max(1, Math.round(amount));
      const big = shown >= 18 || !!en.boss;
      floatText(en.x, en.y - 0.15, ntext(shown), '#ffffff', big, en.fid, shown);
      spark(en.x, en.y, '#ffffff', 3, 2.2);
      fxCall('hit', en.x, en.y, foeVisual(en));
      if (!en.boss && en.eid !== 'brute') {
        const d = len2(en.x - player.x, en.y - player.y) || 1;
        en.kx = ((en.x - player.x) / d) * 5;
        en.ky = ((en.y - player.y) / d) * 5;
      }
      if (en.boss && amount >= 4) addShake(2.4);
    }
    if (en.life <= 0) {
      en.life = 0;
      en.dying = 0.22;
      if (en.bossKind === 'warden') wardenCleared = true;
      else if (en.boss) demonCleared = true;
      if (!(en.boss || en.elite) || time >= (en.flashAt || 0)) {
        en.hitFlash = 0.08;
        if (en.boss || en.elite) en.flashAt = time + 0.35;
      }
      kills += 1;
      grantGold(en.gold);
      dropGem(en);
      burst(en.x, en.y, '#ffffff');
      fxCall('death', en.x, en.y, en.eid, foeVisual(en));
      if (en.boss) addShake(4.5);
      else if (en.eid === 'brute') addShake(2.6);
    }
  }

  function cellHash(cx, cy) {
    return ((cx * 73856093) ^ (cy * 19349663)) & (GRID_N - 1);
  }

  function rebuildGrid() {
    gridGen += 1;
    if (gridGen >= 0x7fffffff) {
      gridStamp.fill(0);
      gridGen = 1;
    }
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.dying > 0) continue;
      const cx = (en.x / CELL) | 0;
      const cy = (en.y / CELL) | 0;
      const h = cellHash(cx, cy);
      for (let probe = 0; probe < 6; probe++) {
        const slot = (h + probe) & (GRID_N - 1);
        if (gridStamp[slot] !== gridGen) {
          gridStamp[slot] = gridGen;
          gridCx[slot] = cx;
          gridCy[slot] = cy;
          gridCount[slot] = 0;
          if (!gridBuckets[slot]) gridBuckets[slot] = new Array(4);
        }
        if (gridCx[slot] === cx && gridCy[slot] === cy) {
          const bucket = gridBuckets[slot];
          const at = gridCount[slot];
          bucket[at] = en;
          gridCount[slot] = at + 1;
          break;
        }
      }
    }
  }

  function nearbyFill(x, y, rad) {
    nearCount = 0;
    const span = rad <= CELL ? 1 : Math.ceil(rad / CELL);
    const c0 = (x / CELL) | 0;
    const r0 = (y / CELL) | 0;
    for (let cy = r0 - span; cy <= r0 + span; cy++) {
      for (let cx = c0 - span; cx <= c0 + span; cx++) {
        const h = cellHash(cx, cy);
        for (let probe = 0; probe < 6; probe++) {
          const slot = (h + probe) & (GRID_N - 1);
          if (gridStamp[slot] !== gridGen) break;
          if (gridCx[slot] !== cx || gridCy[slot] !== cy) continue;
          const bucket = gridBuckets[slot];
          const count = gridCount[slot];
          for (let n = 0; n < count; n++) nearList[nearCount++] = bucket[n];
          break;
        }
      }
    }
  }

  function nearestEnemy(x, y, rad) {
    nearbyFill(x, y, rad);
    let best = null;
    let bd = rad * rad;
    for (let n = 0; n < nearCount; n++) {
      const en = nearList[n];
      if (en.life <= 0) continue;
      const dx = en.x - x;
      const dy = en.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = en; }
    }
    return best;
  }

  function onScreen(en) {
    const halfW = canvas.width / (TILE * 2) + 0.35;
    const halfH = canvas.height / (TILE * 2) + 0.35;
    return Math.abs(en.x - player.x) <= halfW && Math.abs(en.y - player.y) <= halfH;
  }

  function aimEnemy(x, y, rad) {
    nearbyFill(x, y, rad);
    let best = null;
    let bd = rad * rad;
    for (let n = 0; n < nearCount; n++) {
      const en = nearList[n];
      if (en.life <= 0 || en.dying > 0) continue;
      const dx = en.x - x;
      const dy = en.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = en; }
    }
    return best;
  }

  // Ash bolts alternate: one shot at the on-screen boss, the next at the
  // nearest other foe. With no boss in range they use the nearest target.
  let boltBossTurn = true;
  function aimBolt(x, y, rad) {
    const rad2 = rad * rad;
    let best = null;
    let bd = rad2;
    let boss = null;
    let bossD = rad2;
    let trash = null;
    let trashD = rad2;
    nearbyFill(x, y, rad);
    for (let n = 0; n < nearCount; n++) {
      const en = nearList[n];
      if (en.life <= 0 || en.dying > 0) continue;
      const dx = en.x - x;
      const dy = en.y - y;
      const d = dx * dx + dy * dy;
      if (d >= rad2) continue;
      if (d < bd) { bd = d; best = en; }
      if (!onScreen(en)) continue;
      if (en.boss) {
        if (d < bossD) { bossD = d; boss = en; }
      } else if (d < trashD) {
        trashD = d;
        trash = en;
      }
    }
    if (boss && trash) {
      const pick = boltBossTurn ? boss : trash;
      boltBossTurn = !boltBossTurn;
      return pick;
    }
    return boss || best;
  }

  function bodyReach(en) {
    if (!en || !(en.boss || en.elite)) return 0;
    return (en.radius || 0.32) * 0.55;
  }

  function openingPack() {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const dist = 7.2;
      spawnEnemy(i === 0 ? 'imp' : 'skel', Math.cos(ang) * dist, Math.sin(ang) * dist);
    }
  }

  function viewLimit() {
    const halfW = canvas.width / (TILE * 2);
    const halfH = canvas.height / (TILE * 2);
    return len2(halfW, halfH) + 4;
  }

  function cullFarEnemies() {
    const limit = viewLimit();
    const limit2 = limit * limit;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (en.boss) continue;
      const dx = en.x - player.x;
      const dy = en.y - player.y;
      if (dx * dx + dy * dy > limit2) releaseEnemy(i);
    }
  }

  function raiseBanner(text, pulse) {
    banner = text;
    bannerT = pulse ? 2.15 : 2;
    warnOn = true;
    const el = $('sv-warn');
    if (el) {
      el.textContent = text;
      el.classList.remove('hidden');
      el.classList.toggle('sv-pulse', !!pulse && !reduceMotion);
    }
    sfx('portal');
  }

  function clearBossUi() {
    banner = '';
    bannerT = 0;
    warnOn = false;
    const el = $('sv-warn');
    if (el) {
      el.textContent = '';
      el.classList.add('hidden');
      el.classList.remove('sv-pulse');
    }
    const bossBar = $('sv-boss');
    if (bossBar) bossBar.classList.add('hidden');
    const name = $('sv-boss-name');
    if (name) name.textContent = '';
    const hp = $('sv-boss-hp');
    if (hp) hp.style.width = '0%';
  }

  function spawnRing(pad) {
    spawnSerial += 1;
    const ang = spawnSerial * 2.399963;
    const ring = Math.max(4.4, 9.2 - time * 0.016) + (pad || 0);
    spotScratch.x = player.x + Math.cos(ang) * ring;
    spotScratch.y = player.y + Math.sin(ang) * ring;
    return spotScratch;
  }

  function wardenAlive() {
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.bossKind === 'warden' && en.life > 0 && en.dying <= 0) return true;
    }
    return false;
  }

  function burstCasters() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (en.eid === 'shooter' && en.life > 0 && en.dying <= 0) damageEnemy(en, en.life + 1);
    }
  }

  function spawnKind() {
    const n = spawnSerial;
    if (time < 70) return n % 4 === 0 ? 'imp' : 'skel';
    if (time < 100) return n % 10 === 0 ? 'charger' : n % 4 === 0 ? 'imp' : 'skel';
    if (time >= MINI_AT && !wardenAlive() && n % 8 === 0) return 'shooter';
    if (time > 95 && n % 6 === 0) return 'charger';
    if (time > 55 && n % 11 === 0) return 'brute';
    if (n % 3 === 0) return 'imp';
    return 'skel';
  }

  function spawnRate() {
    if (time < 50) return 0.4;
    if (time < 95) return 0.78;
    if (time < 125) return 1.65;
    if (time < 155) return 2.15;
    return 2.7;
  }

  function spawnCap() {
    if (time < 40) return 9;
    if (time < 80) return 20;
    if (time < 120) return 32;
    if (time < 170) return 44;
    return 56;
  }

  function director(dt) {
    if (bench) return;
    cullFarEnemies();
    if (bannerT > 0) {
      bannerT = Math.max(0, bannerT - dt);
      if (bannerT <= 0) {
        warnOn = false;
        const el = $('sv-warn');
        if (el) {
          el.classList.add('hidden');
          el.classList.remove('sv-pulse');
        }
      }
    }
    if (!eliteWarned && time >= 148) {
      eliteWarned = true;
      raiseBanner('Grave Warden approaches', true);
    }
    if (!eliteSpawned && time >= 150) {
      eliteSpawned = true;
      burstCasters();
      const spot = spawnBossEdge();
      spawnEnemy('brute', spot.x, spot.y, { bossKind: 'warden', name: 'Grave Warden' });
    }
    if (!demonWarned && time >= MINI_AT - 2) {
      demonWarned = true;
      raiseBanner('Risen Demon approaches', true);
    }
    if (time >= MINI_AT && !boss5) {
      boss5 = true;
      const spot = spawnBossEdge();
      spawnEnemy('brute', spot.x, spot.y, { bossKind: 'demon', name: 'Risen Demon' });
    }
    if (state === 'playing' && !hermit.on && curse <= 0 && !vowPayout && time >= nextVowAt) {
      hermit.x = player.x + 2.4;
      hermit.y = player.y + 1.2;
      vowSeen = true;
      fxCall('vow', vowCount);
      openHermit();
      return;
    }
    if (time >= RUN_SECONDS) {
      runGold += SurvivorData.REWARDS.gold.win;
      finish('won');
      return;
    }
    const cap = spawnCap();
    const pressure = bossFightOn() ? 0.45 : 1;
    spawnAcc += spawnRate() * pressure * dt;
    let guard = 0;
    while (spawnAcc >= 1 && enemies.length < cap && guard++ < 6) {
      spawnAcc -= 1;
      spawnedThisFrame += 1;
      const spot = spawnRing(0);
      spawnEnemy(spawnKind(), spot.x, spot.y);
    }
  }

  function bossFightOn() {
    if (demonWarned && !demonCleared) return true;
    if (eliteWarned && !wardenCleared && time < MINI_AT) return true;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.boss && en.life > 0 && en.dying <= 0) return true;
    }
    return false;
  }

  function spawnBossEdge() {
    const halfW = Math.max(2.4, canvas.width / (TILE * 2) - 1.35);
    const halfH = Math.max(2.4, canvas.height / (TILE * 2) - 1.35);
    const ang = Math.random() * Math.PI * 2;
    const sx = Math.cos(ang);
    const sy = Math.sin(ang);
    const fit = 1 / Math.max(Math.abs(sx) / halfW, Math.abs(sy) / halfH);
    spotScratch.x = player.x + sx * fit * 0.9;
    spotScratch.y = player.y + sy * fit * 0.9;
    return spotScratch;
  }

  function leashBoss(en, dt) {
    const halfW = canvas.width / (TILE * 2);
    const halfH = canvas.height / (TILE * 2);
    const reach = Math.max(5.5, Math.min(halfW, halfH) * 0.7);
    let dx = en.x - player.x;
    let dy = en.y - player.y;
    let dist = len2(dx, dy) || 1;
    if (dist > reach) {
      const step = Math.min(dist - reach, Math.max(4.2, en.speed * 6) * dt);
      en.x -= (dx / dist) * step;
      en.y -= (dy / dist) * step;
      dx = en.x - player.x;
      dy = en.y - player.y;
      dist = len2(dx, dy) || 1;
    }
    const pad = 0.8;
    if (Math.abs(dx) > halfW - pad || Math.abs(dy) > halfH - pad) {
      const tx = player.x + Math.max(-(halfW - pad), Math.min(halfW - pad, dx));
      const ty = player.y + Math.max(-(halfH - pad), Math.min(halfH - pad, dy));
      const lx = tx - en.x;
      const ly = ty - en.y;
      const ld = len2(lx, ly) || 1;
      const step = Math.min(ld, Math.max(4.2, en.speed * 6) * dt);
      en.x += (lx / ld) * step;
      en.y += (ly / ld) * step;
    }
  }

  function spawnOffscreen(pad) {
    const extra = pad || 1.15;
    const halfW = canvas.width / (TILE * 2) + extra;
    const halfH = canvas.height / (TILE * 2) + extra;
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { spotScratch.x = player.x - halfW; spotScratch.y = player.y + (Math.random() * 2 - 1) * halfH; }
    else if (side === 1) { spotScratch.x = player.x + halfW; spotScratch.y = player.y + (Math.random() * 2 - 1) * halfH; }
    else if (side === 2) { spotScratch.x = player.x + (Math.random() * 2 - 1) * halfW; spotScratch.y = player.y - halfH; }
    else { spotScratch.x = player.x + (Math.random() * 2 - 1) * halfW; spotScratch.y = player.y + halfH; }
    return spotScratch;
  }

  let novaQueue = 0;

  function fireNova(rank) {
    const dmg = (12 + rank * 6) * power();
    const life = rank >= 5 ? 0.7 : rank >= 4 ? 0.58 : 0.48;
    const evolvedNova = !!evolved.nova;
    spawnShot('nova', player.x, player.y, 0, 0, dmg, life);
    const radius = life * (evolvedNova ? 9.2 : 7.2) * area();
    novaInfo.radius = radius;
    novaInfo.rank = rank;
    fxCall('cast', 'nova', player.x, player.y, novaInfo);
    sfx('cast');
    return radius;
  }

  function tickWeapons(dt) {
    cds.bolt -= dt;
    cds.nova -= dt;
    cds.pierce -= dt;
    if (novaQueue > 0) {
      novaQueue -= dt;
      if (novaQueue <= 0) fireNova(owned.nova || 1);
    }
    const halfW = canvas.width / (TILE * 2);
    const halfH = canvas.height / (TILE * 2);
    const aimReach = Math.max(8.5, Math.min(halfW, halfH) * 0.92);
    const lineAim = aimEnemy(player.x, player.y, aimReach);
    const boltRank = Math.max(1, Math.min(5, owned.bolt || 1));
    if (owned.bolt && cds.bolt <= 0) {
      const sp = T.boltSpeed * (1 + (boltRank >= 4 ? 0.12 : 0));
      const base = boltDamage();
      const volley = boltRank >= 5 ? 3 : boltRank >= 3 ? 2 : 1;
      let fired = 0;
      let face = player.facing;
      for (let i = 0; i < volley; i++) {
        const aim = aimBolt(player.x, player.y, aimReach);
        if (!aim) continue;
        const dx = aim.x - player.x;
        const dy = aim.y - player.y;
        const spread = (i - (volley - 1) / 2) * 0.08;
        const ang = Math.atan2(dy, dx) + spread;
        spawnShot('bolt', player.x, player.y, Math.cos(ang) * sp, Math.sin(ang) * sp, base * (i === 0 ? 1 : 0.65), 1.4);
        face = dx >= 0 ? 1 : -1;
        fired += 1;
      }
      if (fired) {
        player.swing = 0.16;
        const cd = [0.62, 0.56, 0.5, 0.42, 0.36][boltRank - 1];
        cds.bolt = cd * haste();
        player.facing = face;
        sfx('cast');
      }
    }
    const novaRank = Math.max(0, Math.min(5, owned.nova || 0));
    if (novaRank && cds.nova <= 0) {
      fireNova(novaRank);
      if (novaRank >= 3) novaQueue = 0.18;
      if (novaRank >= 5 || evolved.nova) novaQueue = Math.min(novaQueue || 0.16, 0.16);
      const table = [3.15, 2.7, 2.35, 2.05, 1.75];
      cds.nova = Math.max(0.8, table[novaRank - 1] * haste() * (evolved.nova ? 0.82 : 1));
    }
    const pierceRank = Math.max(0, Math.min(5, owned.pierce || 0));
    if (pierceRank && cds.pierce <= 0 && lineAim) {
      const dx = lineAim.x - player.x;
      const dy = lineAim.y - player.y;
      const d = len2(dx, dy) || 1;
      const sp = pierceRank >= 4 ? 12.5 : 11;
      const dmg = (14 + pierceRank * 6) * power() * (pierceRank >= 3 ? 1.15 : 1);
      const lines = pierceRank >= 5 ? 2 : 1;
      for (let i = 0; i < lines; i++) {
        const side = (i === 0 ? -1 : 1) * (lines > 1 ? 0.28 : 0);
        const px = player.x + (-dy / d) * side;
        const py = player.y + (dx / d) * side;
        spawnShot('pierce', px, py, (dx / d) * sp, (dy / d) * sp, dmg, 1.15);
      }
      cds.pierce = Math.max(0.7, (2.5 - pierceRank * 0.18) * haste());
      sfx('swing');
    }
    if (owned.orbit) {
      const orbitRank = Math.max(1, Math.min(5, owned.orbit));
      const storm = !!evolved.orbit;
      const spin = (storm ? 3.4 : 2.1) + orbitRank * 0.22;
      orbitAngle += dt * spin;
      const count = storm ? 5 : (orbitRank >= 5 ? 3 : orbitRank >= 3 ? 2 : 1);
      const rad = ((storm ? 2.15 : 1.45) + (orbitRank >= 4 ? 0.45 : 0.12)) * area();
      const dmg = (7 + orbitRank * 3) * power() * dt * (storm ? 2.8 : 2.2);
      for (let i = 0; i < count; i++) {
        const a = orbitAngle + (i / count) * Math.PI * 2;
        const bx = player.x + Math.cos(a) * rad;
        const by = player.y + Math.sin(a) * rad;
        const slot = bladePos[i];
        slot.x = bx;
        slot.y = by;
        slot.angle = a;
        bladeView[i] = slot;
        nearbyFill(bx, by, 1.6);
        for (let n = 0; n < nearCount; n++) {
          const en = nearList[n];
          const reach = 0.72 + bodyReach(en);
          const dx = en.x - bx;
          const dy = en.y - by;
          if (dx * dx + dy * dy < reach * reach) damageEnemy(en, dmg, true);
        }
      }
      bladeView.length = count;
      bladeInfo.radius = rad;
      bladeInfo.positions = bladeView;
      fxCall('cast', 'blade', player.x, player.y, bladeInfo);
    }
  }

  function tickShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.life -= dt;
      if (s.kind === 'nova') {
        const grow = dt * (evolved.nova ? 8.6 : 7.2) * area();
        const steps = Math.max(1, Math.ceil(grow / 0.35));
        const slice = grow / steps;
        const band = s.life > 0.2 && (owned.nova || 0) >= 5 ? 1.15 : 0.9;
        for (let k = 0; k < steps; k++) {
          s.r += slice;
          nearbyFill(s.x, s.y, s.r + 0.6);
          for (let n = 0; n < nearCount; n++) {
            const en = nearList[n];
            if (en._nova === s.seq) continue;
            const dx = en.x - s.x;
            const dy = en.y - s.y;
            const dist2 = dx * dx + dy * dy;
            const outer = s.r + bodyReach(en);
            const inner = s.r - band - bodyReach(en);
            if (dist2 < outer * outer && (inner <= 0 || dist2 > inner * inner)) {
              en._nova = s.seq;
              damageEnemy(en, s.dmg);
            }
          }
        }
      } else {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const hitR = s.kind === 'pierce' ? 0.55 * area() : 0.42;
        nearbyFill(s.x, s.y, hitR + 1.2);
        for (let n = 0; n < nearCount; n++) {
          const en = nearList[n];
          const reach = hitR + bodyReach(en);
          const hit2 = reach * reach;
          const sdx = en.x - s.x;
          const sdy = en.y - s.y;
          const sd2 = sdx * sdx + sdy * sdy;
          if (s.kind === 'pierce') {
            if (en._pierce === s.seq) continue;
            if (sd2 > hit2) continue;
            en._pierce = s.seq;
            damageEnemy(en, s.dmg);
            continue;
          }
          if (sd2 <= hit2) {
            damageEnemy(en, s.dmg);
            s.life = 0;
          }
        }
      }
      if (s.life <= 0) {
        shots.splice(i, 1);
        shotPool.push(s);
      }
    }
  }

  function spawnFoeShot(x, y, vx, vy, dmg) {
    const s = foeShotPool.pop() || {};
    s.x = x;
    s.y = y;
    s.vx = vx;
    s.vy = vy;
    s.dmg = dmg;
    s.life = 3.2;
    foeShots.push(s);
  }

  function tickFoeShots(dt) {
    for (let i = foeShots.length - 1; i >= 0; i--) {
      const s = foeShots[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (len2(s.x - player.x, s.y - player.y) < 0.46) {
        hurt(s.dmg, false);
        s.life = 0;
      }
      if (s.life <= 0) {
        foeShots.splice(i, 1);
        foeShotPool.push(s);
      }
    }
  }

  function steer(en, dt, speed) {
    const dx = player.x - en.x;
    const dy = player.y - en.y;
    const dist = len2(dx, dy) || 1;
    en.x += (dx / dist) * speed * dt;
    en.y += (dy / dist) * speed * dt;
    en.facing = dx >= 0 ? 1 : -1;
    return dist;
  }

  function touchPlayer(en, dist, dmg, dt) {
    if (en.touchCd > 0) en.touchCd -= dt;
    if (dist < en.radius + 0.48 && en.touchCd <= 0) {
      en.touchCd = 0.7;
      hurt(dmg == null ? en.dmg : dmg, en.boss);
    }
  }

  function tickCharger(en, dt) {
    const ai = en.ai;
    const dx = player.x - en.x;
    const dy = player.y - en.y;
    const dist = len2(dx, dy) || 1;
    if (ai.mode === 'seek') {
      steer(en, dt, en.speed);
      if (dist < 4.6) {
        ai.mode = 'tell';
        ai.t = 0.6;
        ai.vx = dx / dist;
        ai.vy = dy / dist;
      }
    } else if (ai.mode === 'tell') {
      ai.t -= dt;
      en.facing = ai.vx >= 0 ? 1 : -1;
      if (ai.t <= 0) {
        ai.mode = 'dash';
        ai.t = 0.38;
      }
    } else if (ai.mode === 'dash') {
      ai.t -= dt;
      en.x += ai.vx * 8.2 * dt;
      en.y += ai.vy * 8.2 * dt;
      en.facing = ai.vx >= 0 ? 1 : -1;
      const hit = len2(player.x - en.x, player.y - en.y);
      if (hit < en.radius + 0.5 && en.touchCd <= 0) {
        en.touchCd = 0.8;
        hurt(en.dmg + 3, false);
      }
      if (ai.t <= 0) {
        ai.mode = 'recover';
        ai.t = 0.85;
      }
    } else {
      ai.t -= dt;
      if (ai.t <= 0) ai.mode = 'seek';
    }
    if (ai.mode === 'seek') touchPlayer(en, dist, en.dmg, dt);
  }

  function tickShooter(en, dt) {
    const ai = en.ai;
    const dx = player.x - en.x;
    const dy = player.y - en.y;
    const dist = len2(dx, dy) || 1;
    en.facing = dx >= 0 ? 1 : -1;
    if (ai.mode === 'tell') {
      ai.t -= dt;
      if (ai.t <= 0) {
        const sp = 2.7;
        spawnFoeShot(en.x, en.y, (dx / dist) * sp, (dy / dist) * sp, 5);
        ai.mode = 'recover';
        ai.t = 2.6;
      }
      return;
    }
    if (ai.mode === 'recover') {
      ai.t -= dt;
      if (dist < 3.4) steerAway(en, dt, dx, dy, dist);
      if (ai.t <= 0) ai.mode = 'seek';
      return;
    }
    if (dist < 3.6) steerAway(en, dt, dx, dy, dist);
    else if (dist > 6.4) steer(en, dt, en.speed * 0.85);
    if (dist < 8.5 && dist > 2.8) {
      ai.mode = 'tell';
      ai.t = 0.7;
    }
  }

  function steerAway(en, dt, dx, dy, dist) {
    en.x -= (dx / dist) * en.speed * dt;
    en.y -= (dy / dist) * en.speed * dt;
  }

  function tickBoss(en, dt) {
    const ai = en.ai;
    const dx = player.x - en.x;
    const dy = player.y - en.y;
    const dist = len2(dx, dy) || 1;
    en.facing = dx >= 0 ? 1 : -1;
    if (ai.mode === 'tell') {
      ai.t -= dt;
      if (ai.t <= 0) {
        if (ai.kind === 'slam') {
          if (dist < 2.15) hurt(en.dmg + 6, true);
          ai.mode = 'recover';
          ai.t = 1.1;
        } else {
          const base = Math.atan2(dy, dx);
          for (let i = -1; i <= 1; i++) {
            const ang = base + i * 0.32;
            spawnFoeShot(en.x, en.y, Math.cos(ang) * 3.1, Math.sin(ang) * 3.1, 7);
          }
          ai.mode = 'recover';
          ai.t = 1.3;
        }
      }
      return;
    }
    if (ai.mode === 'recover') {
      ai.t -= dt;
      steer(en, dt, en.speed * 0.8);
      touchPlayer(en, dist, en.dmg, dt);
      if (ai.t <= 0) ai.mode = 'seek';
      return;
    }
    steer(en, dt, en.speed);
    touchPlayer(en, dist, en.dmg, dt);
    ai.t += dt;
    if (ai.t > 2.4) {
      ai.mode = 'tell';
      ai.kind = ai.kind === 'slam' ? 'volley' : 'slam';
      ai.t = ai.kind === 'slam' ? 0.75 : 0.55;
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
      if (!en.ai) en.ai = { mode: 'seek', t: 0, vx: 1, vy: 0 };
      if (en.behaviour === 'charger') tickCharger(en, dt);
      else if (en.behaviour === 'shooter') tickShooter(en, dt);
      else if (en.behaviour === 'boss') {
        tickBoss(en, dt);
        leashBoss(en, dt);
      }
      else {
        const dx = player.x - en.x;
        const dy = player.y - en.y;
        const dist = len2(dx, dy) || 1;
        en.x += (dx / dist) * en.speed * dt;
        en.y += (dy / dist) * en.speed * dt;
        en.facing = dx >= 0 ? 1 : -1;
        touchPlayer(en, dist, en.dmg, dt);
      }
    }
  }

  function releaseGemAt(i) {
    const g = gems[i];
    const last = gems.pop();
    if (i < gems.length) gems[i] = last;
    g.fly = 0;
    g.vx = 0;
    g.vy = 0;
    gemPool.push(g);
  }

  function mergeOldGems() {
    gemKeyN = 0;
    const cell = Math.max(2.5, pxToWorld(240));
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if ((g.kind || 'gem') !== 'gem' || g.fly) continue;
      if ((g.age || 0) < 15) continue;
      const cx = (g.x / cell) | 0;
      const cy = (g.y / cell) | 0;
      let at = -1;
      for (let k = 0; k < gemKeyN; k++) {
        if (gemKeyX[k] === cx && gemKeyY[k] === cy) { at = k; break; }
      }
      if (at < 0) {
        at = gemKeyN;
        gemKeyX[at] = cx;
        gemKeyY[at] = cy;
        if (!gemLists[at]) gemLists[at] = [];
        gemListN[at] = 0;
        gemKeyN += 1;
      }
      const list = gemLists[at];
      const n = gemListN[at];
      list[n] = g;
      gemListN[at] = n + 1;
    }
    for (let k = 0; k < gemKeyN; k++) {
      const list = gemLists[k];
      const count = gemListN[k];
      if (count < 2) continue;
      let value = 0;
      let x = 0;
      let y = 0;
      for (let n = 0; n < count; n++) {
        value += list[n].value || 0;
        x += list[n].x;
        y += list[n].y;
      }
      const keep = list[0];
      keep.x = x / count;
      keep.y = y / count;
      keep.value = value;
      keep.big = true;
      keep.kind = 'gem';
      keep.age = 15;
      keep.fly = 0;
      for (let n = count - 1; n >= 1; n--) {
        const idx = gems.indexOf(list[n]);
        if (idx >= 0) releaseGemAt(idx);
      }
    }
  }

  function tickGems(dt) {
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if ((g.kind || 'gem') === 'gem' && !g.fly) g.age = (g.age || 0) + dt;
    }
    mergeOldGems();
    const pull = magnetR();
    const grab = pickupR();
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const dx = player.x - g.x;
      const dy = player.y - g.y;
      const dist = len2(dx, dy);
      if (dist < pull) g.fly = 1;
      if (g.fly && dist > 0) {
        const step = Math.min(dist, (14 + (owned.magnet || 0) * 4) * dt);
        g.x += (dx / dist) * step;
        g.y += (dy / dist) * step;
      }
      const left = len2(player.x - g.x, player.y - g.y);
      if (left <= grab || (g.fly && left < 0.08)) {
        const kind = g.kind || 'gem';
        if (kind === 'heart') {
          player.life = Math.min(player.maxLife, player.life + 16);
        } else if (kind === 'chest') {
          grantGold(40 * vowMult());
          chestReady = true;
        } else if (kind === 'item' && g.item) {
          try { SurvivorSave.addItem(g.item); } catch (e) {}
        } else {
          player.xp += g.value || 0;
        }
        spark(player.x, player.y, '#ffffff', 3, 2.6);
        if (kind === 'gem') {
          chainInfo.chain = bumpGemChain();
          fxCall('pickup', g.x, g.y, 'gem', chainInfo);
        } else {
          fxCall('pickup', g.x, g.y, kind === 'item' && g.item ? g.item.rarity : kind);
        }
        releaseGemAt(i);
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
    fxCall('levelUp');
    openLevel();
  }

  function syncBank() {
    const extra = Math.round(runGold - bankedAmount);
    if (extra <= 0) return;
    SurvivorData.bankGold(extra);
    bankedAmount = runGold;
  }

  function sim(dt) {
    simTick += 1;
    spawnedThisFrame = 0;
    if (evolveFreeze > 0) {
      evolveFreeze = Math.max(0, evolveFreeze - dt);
      animT += dt;
      fxCall('update', dt);
      if (evolveFreeze <= 0 && evolvePending) {
        player.invuln = Math.max(player.invuln, 0.5);
        const evolvedId = evolvePending;
        evolvePending = '';
        evoLog.push({ id: evolvedId, t: time, tick: simTick });
        fxCall('evolve', evolvedId);
        if (evolveQueue.length) beginEvolve();
      }
      return;
    }
    time += dt;
    const minuteNow = Math.floor(time / 60);
    while (minuteMark < minuteNow && minuteMark < 10) {
      minuteMark += 1;
      track(SurvivorData.minuteReachedEvent(minuteMark));
    }
    animT += dt;
    fxCall('update', dt);
    if (player.hitFlash > 0) player.hitFlash -= dt;
    if (player.swing > 0) player.swing = Math.max(0, player.swing - dt);
    if (player.invuln > 0) player.invuln -= dt;
    if (regen > 0) {
      regen = Math.max(0, regen - dt);
      player.life = Math.min(player.maxLife, player.life + 6 * dt);
    }
    if (shakeMag > 0) {
      shakeMag = Math.max(0, shakeMag - dt * 12);
      shakePhase += dt * 46;
    }
    if (curse > 0) {
      curse = Math.max(0, curse - dt);
      if (vowPayout && curse <= 0) {
        vowPayout = false;
        if (vowActive) {
          vowsSurvived += 1;
          vowActive = false;
        }
        pickLeft = 2;
        syncVowChrome();
        openLevel();
        return;
      }
    }
    syncVowChrome();
    movePlayer(dt);
    director(dt);
    if (state !== 'playing') return;
    rebuildGrid();
    tickWeapons(dt);
    tickShots(dt);
    tickEnemies(dt);
    tickFoeShots(dt);
    if (state !== 'playing') return;
    tickGems(dt);
    if (chestReady && state === 'playing') {
      chestReady = false;
      grantChest();
      return;
    }
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
    if (hermit.on && !hermit.used && len2(player.x - hermit.x, player.y - hermit.y) < 1.25) {
      openHermit();
      return;
    }
    checkLevel();
  }

  function movePlayer(dt) {
    let sx = 0;
    let sy = 0;
    let steered = false;
    if (scriptMove) {
      sx = scriptMove.x || 0;
      sy = scriptMove.y || 0;
      steered = true;
    } else {
      if (keys.w || keys.arrowup) { sy -= 1; steered = true; }
      if (keys.s || keys.arrowdown) { sy += 1; steered = true; }
      if (keys.a || keys.arrowleft) { sx -= 1; steered = true; }
      if (keys.d || keys.arrowright) { sx += 1; steered = true; }
      if (joy.on) {
        const jx = joy.x - joy.ox;
        const jy = joy.y - joy.oy;
        const mag = len2(jx, jy);
        if (mag > 14) {
          const scale = Math.min(1, (mag - 14) / 64);
          sx = (jx / mag) * scale;
          sy = (jy / mag) * scale;
          steered = true;
        }
      }
    }
    if (!steered && walkCircle) {
      const radius = pxToWorld(120);
      const ang = time * (Math.PI * 2 / 8);
      sx = Math.cos(ang) * radius - player.x;
      sy = Math.sin(ang) * radius - player.y;
      if (len2(sx, sy) < 0.08) {
        player.moving = false;
        return;
      }
    }
    if (sx === 0 && sy === 0) {
      player.moving = false;
      return;
    }
    player.moving = true;
    const len = len2(sx, sy) || 1;
    const sp = moveSpeed();
    player.x += (sx / len) * sp * dt;
    player.y += (sy / len) * sp * dt;
    if (sx !== 0) player.facing = sx > 0 ? 1 : -1;
  }

  function clearPools() {
    enemies.length = 0;
    gems.length = 0;
    shots.length = 0;
    foeShots.length = 0;
    particles.length = 0;
    floats.length = 0;
    gridGen += 1;
    if (gridGen >= 0x7fffffff) {
      gridStamp.fill(0);
      gridGen = 1;
    }
  }

  function resetRun() {
    try { if (SurvivorSave.reload) SurvivorSave.reload(); } catch (e) {}
    clearPools();
    const fresh = blankPlayer();
    Object.assign(player, fresh);
    time = 0;
    kills = 0;
    levelUps = 0;
    runGold = 0;
    goldMilli = 0;
    gemChain = 0;
    gemChainAt = -10;
    boltBossTurn = true;
    bankedAmount = 0;
    doubled = false;
    doubleLocked = false;
    revived = false;
    ended = false;
    minuteMark = 0;
    spawnAcc = 0;
    boss5 = false;
    curse = 0;
    vowPayout = false;
    vowResume = false;
    vowCount = 0;
    vowsSurvived = 0;
    vowActive = false;
    hermitDeclines = 0;
    try { SurvivorSprites.setFloorVow(0); } catch (e) {}
    Object.keys(evolved).forEach((k) => { delete evolved[k]; });
    pickLeft = 0;
    rerollUsed = false;
    hits = 0;
    owned = { bolt: 1 };
    cds = { bolt: T.firstBolt, nova: 1.6, pierce: 1.2 };
    orbitAngle = 0;
    hermit.on = false;
    hermit.used = false;
    joy.on = false;
    nextVowAt = 20 + Math.random() * 25;
    vowSeen = false;
    spawnSerial = 0;
    eliteWarned = false;
    eliteSpawned = false;
    wardenCleared = false;
    demonCleared = false;
    demonWarned = false;
    clearBossUi();
    nextOfferLine = '';
    secondChanceFx = 0;
    const queuedKeys = Object.keys(evoQueued);
    for (let qi = 0; qi < queuedKeys.length; qi++) delete evoQueued[queuedKeys[qi]];
    evolveFreeze = 0;
    evolvePending = '';
    evolveQueue.length = 0;
    novaQueue = 0;
    regen = 0;
    chestReady = false;
    scriptMove = null;
    revivalLeft = shopRank('revival') > 0 ? 1 : 0;
    secondChance = 0;
    partnerPulse = 0;
    evoLog.length = 0;
    uiGuardUntil = 0;
    fxCall('reset');
    fxCall('vow', 0);
  }

  function syncReducedMotion(flag) {
    if (flag != null) reduceMotion = !!flag;
    fxCall('setReducedMotion', !!reduceMotion);
  }

  function startRun() {
    const preview = previewOnce;
    previewOnce = '';
    resetRun();
    if (preview === 'crowd' || preview === 'boss' || preview === 'minute3' || preview === 'warden' || preview === 'tells' || preview === 'build') {
      nextVowAt = 1e9;
    }
    if (preview === 'crowd' || preview === 'boss') {
      time = MINI_AT - 1;
      eliteWarned = true;
      eliteSpawned = true;
      demonWarned = true;
    }
    if (preview === 'minute3') {
      time = 178;
      eliteWarned = true;
      eliteSpawned = true;
    }
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
      player.invuln = 3;
      openingPack();
      for (let i = 0; i < 28; i++) {
        const ang = (i / 28) * Math.PI * 2 + 0.2;
        const dist = 0.48 + (i % 4) * 0.16;
        const id = i % 7 === 0 ? 'brute' : i % 3 === 0 ? 'imp' : 'skel';
        spawnEnemy(id, Math.cos(ang) * dist, Math.sin(ang) * dist);
      }
      for (let i = 0; i < 90; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 1.35 + Math.random() * 2.6;
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
    } else if (preview === 'minute3') {
      player.invuln = 8;
      for (let i = 0; i < 46; i++) {
        const ang = (i / 46) * Math.PI * 2;
        const dist = 1.15 + (i % 5) * 0.55;
        const id = i % 9 === 0 ? 'charger' : i % 7 === 0 ? 'shooter' : i % 5 === 0 ? 'brute' : i % 2 === 0 ? 'imp' : 'skel';
        const en = spawnEnemy(id, Math.cos(ang) * dist, Math.sin(ang) * dist);
        en.maxLife = 240;
        en.life = 240;
      }
    } else if (preview === 'warden') {
      time = 151;
      eliteWarned = true;
      eliteSpawned = true;
      player.invuln = 8;
      raiseBanner('Grave Warden approaches', true);
      bannerT = 30;
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        spawnEnemy(i % 2 ? 'imp' : 'skel', Math.cos(ang) * 3.2, Math.sin(ang) * 3.2);
      }
      const warden = spawnEnemy('brute', 2.5, 0.15, { bossKind: 'warden', name: 'Grave Warden' });
      warden.life = Math.round(warden.maxLife * 0.72);
    } else if (preview === 'tells') {
      time = 112;
      player.invuln = 8;
      const charger = spawnEnemy('charger', 2.5, -0.15);
      charger.ai.mode = 'tell';
      charger.ai.t = 30;
      charger.ai.vx = -1;
      charger.ai.vy = 0.08;
      const shooter = spawnEnemy('shooter', -3.2, 1.15);
      shooter.ai.mode = 'tell';
      shooter.ai.t = 30;
      spawnFoeShot(-1.7, 0.55, 0.15, -0.02, 5);
      spawnFoeShot(-0.55, 0.9, 0.12, 0.02, 5);
      spawnEnemy('skel', 3.4, 1.5);
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
    if (!preview && debugClock > 0) fastForward(debugClock);
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
    } else if (preview === 'hermit') {
      openHermit();
    } else if (preview === 'build') {
      owned.bolt = 2;
      owned.orbit = 4;
      owned.nova = 1;
      owned.might = 2;
      player.level = 8;
      time = 96;
      kills = 84;
      for (let n = 0; n < 40; n++) {
        openLevel();
        const hinted = offers.some((item) => {
          const evo = SurvivorData.evolutionFor(item.id);
          return !!(evo && (item.evolveName || item.evolveOf || item.evolvesWith));
        });
        if (hinted) break;
      }
    }
    sfx('ui');
  }

  function picksForTime(seconds) {
    const table = [
      'bolt', 'orbit', 'bolt', 'might', 'nova', 'haste', 'orbit',
      'bolt', 'tempo', 'orbit', 'might', 'nova', 'orbit', 'cinder', 'haste', 'pierce',
    ];
    const gates = [31, 49, 62, 75, 89, 104, 142, 164, 190, 213, 245, 271, 298, 320, 350, 380];
    let n = 0;
    for (let i = 0; i < gates.length; i++) {
      if (seconds >= gates[i]) n = i + 1;
    }
    return table.slice(0, Math.min(table.length, n));
  }

  function fastForward(seconds) {
    clearPools();
    time = seconds;
    minuteMark = Math.floor(time / 60);
    nextVowAt = time + 80;
    const picks = picksForTime(seconds);
    picks.forEach((id) => {
      owned[id] = (owned[id] || 0) + 1;
      if (id === 'vitality') {
        const rank = owned.vitality;
        const gain = rank === 3 ? 20 : rank === 5 ? 28 : 12;
        player.maxLife += gain;
        player.life += gain;
      }
    });
    player.level = 1 + picks.length;
    levelUps = picks.length;
    player.xp = 0;
    const n = Math.min(12, Math.max(8, Math.round(spawnCap() * 0.22)));
    for (let i = 0; i < n; i++) {
      spawnSerial += 1;
      const spot = spawnRing(0.4);
      spawnEnemy(spawnKind(), spot.x, spot.y);
    }
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const bases = ['iron-blade', 'bone-charm', 'ash-bead', 'iron-blade', 'bone-charm'];
    rarities.forEach((rarity, i) => {
      let item = null;
      try { item = SurvivorSave.createItem(bases[i], rarity); } catch (e) { item = null; }
      const g = gemPool.pop() || {};
      const ang = -1.1 + i * 0.5;
      g.x = player.x + Math.cos(ang) * 1.7;
      g.y = player.y + 2.4;
      g.kind = 'item';
      g.item = item || { rarity: rarity, name: rarity };
      g.value = 0;
      g.age = 0;
      g.big = false;
      g.fly = 0;
      g.vx = 0;
      g.vy = 0;
      gems.push(g);
    });
    if (time >= 295) {
      eliteWarned = true;
      eliteSpawned = true;
      wardenCleared = true;
      demonWarned = true;
      boss5 = true;
      raiseBanner('Risen Demon approaches', true);
      bannerT = 2.4;
      const spot = spawnBossEdge();
      spawnEnemy('brute', spot.x, spot.y, { bossKind: 'demon', name: 'Risen Demon' });
    } else if (time >= 148) {
      eliteWarned = true;
      eliteSpawned = true;
      raiseBanner('Grave Warden approaches', true);
      bannerT = 2.4;
      const spot = spawnBossEdge();
      spawnEnemy('brute', spot.x, spot.y, { bossKind: 'warden', name: 'Grave Warden' });
    }
  }

  function finish(kind) {
    if (ended) return;
    ended = true;
    vowResume = !!(vowPayout && curse > 0);
    vowPayout = false;
    state = kind === 'won' ? 'won' : 'dead';
    joy.on = false;
    track(SurvivorData.levelReachedEvent(player.level));
    track(SurvivorData.levelUpCountEvent(levelUps));
    if (kind === 'won') track('survivor-won');
    else track(SurvivorData.deathEvent(time));
    sfx(kind === 'won' ? 'clear' : 'defeat');
    syncBank();
    let record = { isBest: false, previous: 0, gold: runGold, next: null };
    try { record = SurvivorSave.recordRun({ time: time, kills: kills, level: player.level }); } catch (e) {}
    const title = $('sv-end-title');
    if (title) title.textContent = kind === 'won' ? 'You survived' : 'You fell';
    const best = $('sv-best');
    if (best) best.classList.toggle('hidden', !record.isBest);
    const prev = $('sv-prev');
    if (prev) {
      if (record.previous > 0) {
        const pm = Math.floor(record.previous / 60);
        const ps = Math.floor(record.previous % 60);
        prev.textContent = 'Previous best: ' + pm + ':' + String(ps).padStart(2, '0');
      } else prev.textContent = 'Previous best: none';
    }
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    const clock = m + ':' + String(s).padStart(2, '0');
    const endTime = $('sv-end-time');
    const endKills = $('sv-end-kills');
    const endLevel = $('sv-end-level');
    const endGold = $('sv-end-gold');
    if (endTime) endTime.textContent = clock;
    if (endKills) endKills.textContent = String(kills);
    if (endLevel) endLevel.textContent = String(player.level);
    if (endGold) endGold.textContent = '+' + runGold + ' gold banked';
    paintNextOffer(record.next);
    const vowsLine = $('sv-end-vows');
    if (vowsLine) vowsLine.textContent = 'Vows survived: ' + vowsSurvived;
    uiGuardUntil = nowMs() + 300;
    const reviveBtn = $('sv-revive');
    if (reviveBtn) reviveBtn.classList.toggle('hidden', !adsOn || kind !== 'dead' || revived);
    const goldBtn = $('sv-double');
    if (goldBtn) {
      const offer = !!(adsOn && !doubled && (kind === 'dead' || kind === 'won'));
      goldBtn.disabled = !offer;
      goldBtn.classList.toggle('hidden', !offer);
    }
    hide('sv-level');
    hide('sv-pause');
    hide('sv-hermit');
    show('sv-end');
  }

  function iconSvg(id) {
    const paths = {
      bolt: '<path d="M13 2 L6 13 H11 L9 22 L18 10 H13 Z"/>',
      blade: '<path d="M5 19 L15 4 L18 7 L8 21 Z"/>',
      nova: '<circle cx="12" cy="12" r="3"/><path d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22 M5 5 L7.5 7.5 M16.5 16.5 L19 19 M19 5 L16.5 7.5 M7.5 16.5 L5 19"/>',
      pierce: '<path d="M3 12 H18 L14 8 M18 12 L14 16"/>',
      might: '<path d="M7 20 V10 L12 4 L17 10 V20 Z"/>',
      haste: '<path d="M13 3 L6 13 H11 L9 21 L18 10 H13 Z"/>',
      magnet: '<path d="M7 4 V12 A5 5 0 0 0 17 12 V4 M7 4 H10 V11 M14 4 H17 V11"/>',
      heart: '<path d="M12 19 L5 12 A4 4 0 0 1 12 8 A4 4 0 0 1 19 12 Z"/>',
      area: '<circle cx="12" cy="12" r="7"/>',
      armor: '<path d="M12 3 L19 6 V12 C19 16 12 20 12 20 C12 20 5 16 5 12 V6 Z"/>',
      tempo: '<path d="M4 16 L9 8 L13 14 L20 4"/>',
      cinder: '<circle cx="12" cy="13" r="4"/>',
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[id] || paths.bolt) + '</svg>';
  }

  function pipHtml(next, max) {
    let html = '<span class="sv-pips">';
    for (let i = 1; i <= max; i++) html += '<i class="' + (i <= next ? 'on' : '') + '"></i>';
    html += '</span><span class="sv-rank">' + next + '/' + max + '</span>';
    return html;
  }

  function buildRowHtml() {
    let html = '<div class="sv-build-set">';
    SurvivorData.WEAPONS.forEach((w) => {
      const lv = owned[w.id] || 0;
      html += '<i class="sv-ico' + (lv ? ' on' : '') + '" title="' + w.name + '">' + (lv ? iconSvg(w.icon || w.id) : '') + '</i>';
    });
    html += '<i class="sv-ico"></i><i class="sv-ico"></i></div><div class="sv-build-set">';
    SurvivorData.PASSIVES.forEach((p) => {
      const lv = owned[p.id] || 0;
      if (!lv) return;
      html += '<i class="sv-ico on" title="' + p.name + '">' + iconSvg(p.icon || p.id) + '</i>';
    });
    const empty = Math.max(0, 4 - SurvivorData.PASSIVES.filter((p) => owned[p.id]).length);
    for (let i = 0; i < Math.min(4, empty); i++) html += '<i class="sv-ico"></i>';
    return html + '</div>';
  }

  let shopReturn = 'title';

  function revivePlayer() {
    if (state !== 'dead' || revived) return;
    revived = true;
    player.life = Math.round(player.maxLife * 0.55);
    player.invuln = 1.4;
    ended = false;
    if (vowResume && curse > 0) vowPayout = true;
    vowResume = false;
    state = 'playing';
    hide('sv-end');
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (len2(en.x - player.x, en.y - player.y) < 3.2) releaseEnemy(i);
    }
  }

  function openShop(from) {
    shopReturn = from || 'title';
    if (shopReturn === 'end') hide('sv-end');
    const list = $('sv-shop-list');
    const goldEl = $('sv-shop-gold');
    let purse = 0;
    try { purse = SurvivorSave.gold(); } catch (e) {}
    if (goldEl) goldEl.textContent = purse + ' gold';
    if (list) {
      list.innerHTML = '';
      let rows = [];
      try { rows = SurvivorSave.shopList(); } catch (e) {}
      rows.forEach((u) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sv-shop-buy';
        btn.disabled = u.soldOut || purse < u.cost;
        btn.textContent = u.soldOut ? u.name + ' maxed' : u.label + ' · ' + u.cost + 'g';
        btn.addEventListener('click', () => {
          if (buyUpgrade(u.id).ok) openShop(shopReturn);
        });
        const note = document.createElement('small');
        note.textContent = u.blurb + (u.rank ? ' · rank ' + u.rank + '/' + u.max : '');
        list.appendChild(btn);
        list.appendChild(note);
      });
    }
    hide('sv-title');
    show('sv-shop');
  }

  function buyUpgrade(id) {
    let res = { ok: false };
    try { res = SurvivorSave.buy(id); } catch (e) {}
    if (res.ok) paintNextOffer();
    return res;
  }

  function paintNextOffer(nxt) {
    let next = nxt;
    if (next === undefined) {
      try { next = SurvivorSave.nextUpgrade(); } catch (e) { next = null; }
    }
    let line = 'Every upgrade is yours';
    if (next && next.away <= 0) line = 'Ready to buy: ' + next.label;
    else if (next) line = 'Next upgrade: ' + next.label + ', ' + next.away + ' gold away';
    nextOfferLine = line;
    const el = $('sv-next');
    if (el) el.textContent = line;
    const fill = $('sv-next-fill');
    if (fill && next && next.cost) {
      const span = Math.max(1, next.cost);
      fill.style.width = Math.round(100 * (1 - next.away / span)) + '%';
    }
  }

  function closeShop() {
    hide('sv-shop');
    if (shopReturn === 'end') {
      paintNextOffer();
      show('sv-end');
    } else show('sv-title');
  }

  function openLevel() {
    applyQueuedEvolutions();
    state = 'levelup';
    joy.on = false;
    uiGuardUntil = nowMs() + 300;
    partnerPulse += 1;
    offers = SurvivorData.pickOffers(owned, null, { forcePartner: true });
    const title = $('sv-level-title');
    if (title) title.textContent = pickLeft > 0 ? 'Vow reward' : ('Level ' + player.level);
    const lv = $('sv-level-lv');
    if (lv) lv.textContent = 'Lv ' + player.level;
    const clock = $('sv-level-clock');
    if (clock) {
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      clock.textContent = m + ':' + String(s).padStart(2, '0') + ' · ' + kills + ' kills';
    }
    const build = $('sv-build');
    if (build) build.innerHTML = buildRowHtml();
    const box = $('sv-cards');
    if (box) {
      box.innerHTML = '';
      offers.forEach((item, i) => {
        const have = owned[item.id] || 0;
        const next = have + 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.choice = String(i);
        const hintText = evoHint(item);
        const showEvo = !!hintText;
        btn.className = 'sv-card' + (showEvo ? ' evolves' : '');
        const tag = showEvo ? '<em class="sv-tag">Evolves</em>' : (!have && item.kind !== 'reward' ? '<em class="sv-tag new">New</em>' : '');
        const hint = showEvo ? '<small class="sv-evo">' + hintText + '</small>' : '';
        const blurb = item.kind === 'reward' ? item.blurb : SurvivorData.rankText(item, next);
        const rank = item.maxLevel && item.kind !== 'reward' ? pipHtml(Math.min(next, item.maxLevel), item.maxLevel) : '';
        btn.innerHTML = '<span class="sv-card-ico">' + iconSvg(item.icon || item.id) + '</span><span class="sv-card-copy"><b>' + item.name + '</b>' + rank + hint + '<small>' + blurb + '</small></span>' + tag;
        box.appendChild(btn);
      });
    }
    const reroll = $('sv-reroll');
    if (reroll) {
      const spent = rerollUsed && !adsOn;
      reroll.disabled = spent;
      reroll.textContent = spent ? 'used' : (adsOn ? 'Reroll' : 'Reroll  1 free');
    }
    show('sv-level');
    sfx('level');
  }

  function beginEvolve() {
    if (evolvePending || evolveFreeze > 0) return;
    const id = evolveQueue.shift();
    if (!id) return;
    evolvePending = id;
    evolveFreeze = 0.12;
  }

  function grantEvolve(id) {
    evolveQueue.push(id);
    beginEvolve();
  }

  function applyChoice(item) {
    if (!item) return;
    if (item.id === 'purse') {
      runGold += SurvivorData.REWARDS.gold.purse;
      return;
    }
    if (item.id === 'heal') {
      player.life = Math.min(player.maxLife, player.life + player.maxLife * 0.3);
      regen = Math.max(regen, 3);
      return;
    }
    owned[item.id] = (owned[item.id] || 0) + 1;
    if (item.id === 'vitality') {
      const rank = owned.vitality;
      const gain = rank === 3 ? 20 : rank === 5 ? 28 : 12;
      player.maxLife += gain;
      player.life += gain;
    }
    queueEvolutions();
  }

  function evoWeaponId(item) {
    if (!item) return '';
    if (item.evolvesWith) return item.id;
    return item.evolveOf || '';
  }

  function evoHint(item) {
    const evo = SurvivorData.evolutionFor(item.id);
    if (!evo || !(item.evolveName || item.evolveOf || item.evolvesWith)) return '';
    const weaponId = evoWeaponId(item);
    if (weaponId && evolved[weaponId]) return '';
    return '-> ' + evo.name;
  }

  function grantChest() {
    const bases = ['iron-blade', 'bone-charm', 'ash-bead'];
    try {
      const base = bases[spawnSerial % bases.length];
      SurvivorSave.addItem(SurvivorSave.createItem(base, 'rare'));
    } catch (e) {}
    checkEvolutions();
  }

  function queueEvolutions() {
    const weapons = SurvivorData.WEAPONS;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      if (!w.evolvesWith || evolved[w.id] || evoQueued[w.id]) continue;
      if ((owned[w.id] || 0) >= w.maxLevel && (owned[w.evolvesWith] || 0) > 0) evoQueued[w.id] = true;
    }
  }

  function applyQueuedEvolutions() {
    const weapons = SurvivorData.WEAPONS;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      if (!evoQueued[w.id] || evolved[w.id]) continue;
      evolved[w.id] = w.evolvesWith;
      evoQueued[w.id] = false;
      const evo = SurvivorData.evolutionFor(w.id);
      grantEvolve(evo ? evo.id : w.id);
    }
  }

  function checkEvolutions() {
    const weapons = SurvivorData.WEAPONS;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      if (!w.evolvesWith || evolved[w.id]) continue;
      if ((owned[w.id] || 0) >= w.maxLevel && (owned[w.evolvesWith] || 0) > 0) {
        evolved[w.id] = w.evolvesWith;
        evoQueued[w.id] = false;
        const evo = SurvivorData.evolutionFor(w.id);
        grantEvolve(evo ? evo.id : w.id);
      }
    }
  }

  function choose(index) {
    if (state !== 'levelup') return;
    if (tapBlocked()) return;
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

  function differentOffers(prev) {
    const before = prev.map((o) => o.id).sort().join(',');
    let next = prev;
    for (let n = 0; n < 8; n++) {
      next = SurvivorData.pickOffers(owned, null, { forcePartner: true });
      const key = next.map((o) => o.id).sort().join(',');
      if (key !== before) return next;
    }
    return next;
  }

  function rerollOffers() {
    if (state !== 'levelup' || rerollUsed) return;
    offers = differentOffers(offers);
    if (!adsOn) rerollUsed = true;
    openLevel();
  }

  function openHermit() {
    hermit.on = false;
    hermit.used = true;
    state = 'hermit';
    joy.on = false;
    uiGuardUntil = nowMs() + 300;
    show('sv-hermit');
    sfx('talk');
  }

  function acceptHermit() {
    hide('sv-hermit');
    curse = 60;
    vowPayout = true;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      en.maxLife = Math.round(en.maxLife * 1.5);
      en.life = Math.round(en.life * 1.5);
    }
    state = 'playing';
    vowCount += 1;
    vowActive = true;
    nextVowAt = time + 150;
    try { SurvivorSprites.setFloorVow(vowCount); } catch (e) {}
    fxCall('vow', vowCount);
    syncVowChrome();
  }

  let vowSecShown = -1;
  let vowBadgeShown = '';

  function syncVowChrome() {
    const active = curse > 0 && state !== 'dead' && state !== 'won' && state !== 'title';
    const vow = $('sv-vow');
    if (vow) {
      vow.classList.toggle('hidden', !active);
      if (active) {
        const secs = Math.ceil(curse);
        if (secs !== vowSecShown) {
          vowSecShown = secs;
          vow.textContent = 'Vow ' + secs + 's';
        }
      } else vowSecShown = -1;
    }
    const badge = $('sv-vow-badge');
    if (badge) {
      badge.classList.toggle('hidden', !active);
      if (active) {
        const mult = vowMult();
        const label = mult === 1.5 ? 'Vow x1.5' : mult === 2 ? 'Vow x2' : mult === 3 ? 'Vow x3' : ('Vow x' + mult);
        if (label !== vowBadgeShown) {
          vowBadgeShown = label;
          badge.textContent = label;
        }
      } else vowBadgeShown = '';
    }
  }

  function declineHermit() {
    hide('sv-hermit');
    hermitDeclines += 1;
    if (hermitDeclines >= 2) nextVowAt = 1e9;
    else nextVowAt = time + 75;
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
    clearBossUi();
    syncVowChrome();
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

  let hudHp = -1;
  let hudMax = -1;
  let hudLv = -1;
  let hudXpPct = -1;
  let hudClock = -1;
  let hudKills = -1;
  let hudGold = -1;
  let hudBoss = '';
  let hudBossPct = -1;
  let hudFpsText = '';
  const DIG2 = [];
  for (let di = 0; di < 60; di++) DIG2.push(di < 10 ? ('0' + di) : String(di));

  function hud() {
    const hp = $('sv-hp');
    const hpText = $('sv-hp-text');
    const xp = $('sv-xp');
    const xpText = $('sv-xp-text');
    player.maxLife = Math.max(1, Math.round(player.maxLife));
    if (player.life > player.maxLife) player.life = player.maxLife;
    if (player.life < 0) player.life = 0;
    const maxHp = player.maxLife;
    const curHp = Math.max(0, Math.min(maxHp, Math.round(player.life)));
    if (curHp !== hudHp || maxHp !== hudMax) {
      hudHp = curHp;
      hudMax = maxHp;
      if (hp) hp.style.width = (100 * curHp / maxHp) + '%';
      if (hpText) hpText.textContent = curHp + '/' + maxHp;
    }
    const need = SurvivorData.xpToNext(player.level);
    const xpPct = Math.round(100 * Math.min(1, player.xp / need));
    if (player.level !== hudLv || xpPct !== hudXpPct) {
      hudLv = player.level;
      hudXpPct = xpPct;
      if (xp) xp.style.width = xpPct + '%';
      if (xpText) xpText.textContent = 'Lv ' + player.level;
    }
    const clock = $('sv-time');
    if (clock) {
      const whole = Math.floor(time);
      if (whole !== hudClock) {
        hudClock = whole;
        const m = Math.floor(whole / 60);
        const s = whole % 60;
        clock.textContent = m + ':' + DIG2[s];
      }
    }
    const k = $('sv-kills');
    if (k && kills !== hudKills) {
      hudKills = kills;
      k.textContent = 'Kills ' + kills;
    }
    const g = $('sv-gold');
    const goldShown = Math.floor(runGold);
    if (g && goldShown !== hudGold) {
      hudGold = goldShown;
      g.textContent = 'Gold ' + goldShown;
    }
    syncVowChrome();
    let liveBoss = null;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.boss && en.life > 0 && en.dying <= 0) liveBoss = en;
    }
    const bossBar = $('sv-boss');
    if (bossBar) {
      bossBar.classList.toggle('hidden', !liveBoss);
      if (liveBoss) {
        const name = $('sv-boss-name');
        const bar = $('sv-boss-hp');
        if (name && name.textContent !== liveBoss.name) name.textContent = liveBoss.name;
        const pct = Math.round(100 * liveBoss.life / liveBoss.maxLife);
        if (bar && (liveBoss.name !== hudBoss || pct !== hudBossPct)) {
          hudBoss = liveBoss.name;
          hudBossPct = pct;
          bar.style.width = pct + '%';
        }
      } else if (hudBoss) {
        hudBoss = '';
        hudBossPct = -1;
      }
    }
    const fps = $('sv-fps');
    if (fps && debug) {
      const text = Math.round(fpsSmooth) + ' fps' + (bench ? ' · ' + enemies.length + ' foes' : '');
      if (text !== hudFpsText) {
        hudFpsText = text;
        fps.classList.remove('hidden');
        fps.textContent = text;
      }
    }
  }

  function drawArena() {
    ctx.imageSmoothingEnabled = false;
    SurvivorSprites.drawGround(ctx, camX, camY, canvas.width, canvas.height);
  }

  function fillHeroDraw() {
    heroDraw.flash = player.hitFlash > 0;
    heroDraw.moving = player.moving;
    heroDraw.facing = player.facing;
    heroDraw.time = animT;
    heroDraw.lunge = player.swing || 0;
    return heroDraw;
  }

  function drawHeroBody() {
    const x = sxOf(player.x);
    const y = syOf(player.y);
    SurvivorSprites.drawHero(ctx, x, y, fillHeroDraw());
    if (player.life < player.maxLife) {
      ctx.fillStyle = '#200808';
      ctx.fillRect(x - 16, y - 30 * zoom - 4, 32, 4);
      ctx.fillStyle = '#c03030';
      ctx.fillRect(x - 16, y - 30 * zoom - 4, 32 * (player.life / player.maxLife), 4);
    }
  }

  function drawFoe(en, crowd) {
    const x = sxOf(en.x);
    const y = syOf(en.y);
    if (x < -96 || y < -120 || x > canvas.width + 96 || y > canvas.height + 40) return;
    foeDraw.eid = en.eid;
    foeDraw.sprite = en.sprite;
    foeDraw.boss = en.boss;
    foeDraw.facing = en.facing;
    foeDraw.scale = en.scale;
    foeDraw.color = en.color;
    foeDraw.flash = en.hitFlash > 0;
    foeDraw.dying = en.dying || 0;
    foeDraw.crowd = crowd;
    foeDraw.time = animT;
    SurvivorSprites.drawFoe(ctx, x, y, foeDraw);
    drawTell(en, x, y);
  }

  function drawTell(en, x, y) {
    const ai = en.ai;
    if (!ai || ai.mode !== 'tell') return;
    ctx.save();
    if (en.behaviour === 'charger') {
      ctx.strokeStyle = '#d0b4ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ai.vx * 36, y + ai.vy * 36);
      ctx.stroke();
    } else if (en.behaviour === 'shooter') {
      const grow = ai.t > 0.7 ? 0.72 : (1 - Math.max(0, ai.t) / 0.7);
      ctx.fillStyle = '#d0b4ff';
      ctx.globalAlpha = 0.35 + grow * 0.65;
      ctx.beginPath();
      ctx.arc(x, y - 18, 4 + grow * 8, 0, Math.PI * 2);
      ctx.fill();
    } else if (en.behaviour === 'boss' && ai.kind === 'slam') {
      ctx.strokeStyle = '#d0b4ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 2.15 * TILE, 0, Math.PI * 2);
      ctx.stroke();
    } else if (en.behaviour === 'boss') {
      ctx.fillStyle = '#f4efe0';
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x - 3, y - 28, 6, 6);
    }
    ctx.restore();
  }

  function drawGem(g) {
    const sx = sxOf(g.x);
    const sy = syOf(g.y);
    if (sx < -40 || sy < -40 || sx > canvas.width + 40 || sy > canvas.height + 40) return;
    const kind = g.kind || 'gem';
    if (kind === 'gem') {
      SurvivorSprites.drawGem(ctx, sx, sy, g.big ? 1.85 : 1);
      return;
    }
    if (kind === 'heart') {
      ctx.fillStyle = '#14120f';
      ctx.fillRect(sx - 6, sy - 6, 12, 12);
      ctx.fillStyle = '#5ed37a';
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
      ctx.fillStyle = '#102014';
      ctx.fillRect(sx - 1, sy - 3, 2, 6);
      ctx.fillRect(sx - 3, sy - 1, 6, 2);
      return;
    }
    if (kind === 'chest') {
      ctx.fillStyle = '#2a2418';
      ctx.fillRect(sx - 8, sy - 7, 16, 14);
      ctx.strokeStyle = '#d0b4ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 8, sy - 7, 16, 14);
      return;
    }
    drawRaritySquare(sx, sy, g.item);
  }

  function drawRaritySquare(x, y, item) {
    x = Math.round(x);
    y = Math.round(y);
    const rarity = (item && item.rarity) || 'common';
    const fill = RARITY_FILL[rarity] || '#8a857d';
    const big = rarity === 'epic' || rarity === 'legendary';
    const size = big ? 19 : 16;
    const left = Math.round(x - size / 2);
    const top = Math.round(y - size / 2);
    if (big) {
      const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(animT * Math.PI * 2 * 1.6));
      const column = rarity === 'legendary' ? '#f2f6ff' : '#d0b4ff';
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = column;
      ctx.shadowColor = rarity === 'legendary' ? '#7fb2ff88' : '#d0b4ff66';
      ctx.shadowBlur = 3;
      ctx.fillRect(x - 1, top - 46, 2, 46);
      ctx.restore();
    }
    ctx.fillStyle = fill;
    ctx.fillRect(left, top, size, size);
    ctx.lineWidth = 2;
    ctx.strokeStyle = rarity === 'legendary' ? '#7fb2ff' : '#0b0a0d';
    ctx.strokeRect(left + 1, top + 1, size - 2, size - 2);
    if (rarity === 'legendary') {
      ctx.strokeStyle = '#c9b6ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(left - 2, top - 2, size + 4, size + 4);
    }
  }

  function drawHermit() {
    if (!hermit.on) return;
    const hx = sxOf(hermit.x);
    const hy = syOf(hermit.y);
    SurvivorSprites.drawHermit(ctx, hx, hy, animT);
    ctx.fillStyle = '#d8dce4';
    ctx.font = '11px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('Hermit', hx, hy + 18);
  }

  function fxPresent() {
    return typeof FX !== 'undefined' && !!FX && typeof FX.cast === 'function';
  }

  function drawWeapons() {
    const fx = fxPresent();
    if (owned.orbit && !fx) {
      const count = Math.min(owned.orbit, 4);
      const rad = (1.55 + owned.orbit * 0.12) * area();
      for (let i = 0; i < count; i++) {
        const a = orbitAngle + (i / count) * Math.PI * 2;
        const bx = sxOf(player.x + Math.cos(a) * rad);
        const by = syOf(player.y + Math.sin(a) * rad);
        SurvivorSprites.drawBolt(ctx, bx, by, a);
      }
    }
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const sx = sxOf(shot.x);
      const sy = syOf(shot.y);
      if (shot.kind === 'nova') {
        if (!fx) {
          const px = shot.r * TILE;
          ctx.beginPath();
          ctx.arc(sx, sy, px, 0, Math.PI * 2);
          ctx.strokeStyle = '#14180c';
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.strokeStyle = '#e8ff6a';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      } else {
        SurvivorSprites.drawBolt(ctx, sx, sy, Math.atan2(shot.vy, shot.vx));
      }
    }
    for (let i = 0; i < foeShots.length; i++) {
      const shot = foeShots[i];
      const fx = sxOf(shot.x);
      const fy = syOf(shot.y);
      ctx.fillStyle = '#1a1020';
      ctx.beginPath();
      ctx.arc(fx, fy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d0b4ff';
      ctx.beginPath();
      ctx.arc(fx, fy, 4, 0, Math.PI * 2);
      ctx.fill();
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
    ctx.strokeStyle = 'rgba(200,208,220,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ox, oy, 46 * scaleX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(228,234,242,0.7)';
    ctx.beginPath();
    ctx.arc(x, y, 18 * scaleX, 0, Math.PI * 2);
    ctx.fill();
  }

  function siftByY(arr, i, n) {
    while (true) {
      let m = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < n && arr[l].y > arr[m].y) m = l;
      if (r < n && arr[r].y > arr[m].y) m = r;
      if (m === i) return;
      const tmp = arr[i];
      arr[i] = arr[m];
      arr[m] = tmp;
      i = m;
    }
  }

  function sortByY(arr, n) {
    for (let i = (n >> 1) - 1; i >= 0; i--) siftByY(arr, i, n);
    for (let end = n - 1; end > 0; end--) {
      const tmp = arr[0];
      arr[0] = arr[end];
      arr[end] = tmp;
      siftByY(arr, 0, end);
    }
  }

  function drawFoes() {
    drawCount = 0;
    for (let i = 0; i < enemies.length; i++) drawOrder[drawCount++] = enemies[i];
    sortByY(drawOrder, drawCount);
    const crowd = enemies.length > 100;
    let hermitDrawn = !hermit.on;
    for (let i = 0; i < drawCount; i++) {
      const en = drawOrder[i];
      if (!hermitDrawn && hermit.y <= en.y) {
        drawHermit();
        hermitDrawn = true;
      }
      drawFoe(en, crowd);
    }
    if (!hermitDrawn) drawHermit();
  }

  function drawHeroActor() {
    SurvivorSprites.drawHeroRing(ctx, sxOf(player.x), syOf(player.y));
    drawHeroBody();
  }

  function drawFloats() {
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (let i = 0; i < floats.length; i++) {
      const f = floats[i];
      const fx = sxOf(f.x);
      const fy = syOf(f.y);
      const max = f.max || 0.72;
      const age = 1 - f.life / max;
      const pop = 1 + Math.max(0, (f.big ? 0.5 : 0.22) - age) * (f.big ? 1.35 : 1.15);
      const size = Math.round((f.big ? 28 : 15) * pop);
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 2.4));
      ctx.font = floatFont(!!f.big, size);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#140e0c';
      ctx.strokeText(f.text, fx, fy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, fx, fy);
    }
    ctx.globalAlpha = 1;
  }

  function drawChestArrows() {
    const pad = 36;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.kind !== 'chest') continue;
      const x = g.x * TILE + camX;
      const y = g.y * TILE + camY;
      if (x >= pad && y >= pad && x <= w - pad && y <= h - pad) continue;
      let dx = x - cx;
      let dy = y - cy;
      const dist = len2(dx, dy) || 1;
      dx /= dist;
      dy /= dist;
      const maxX = w * 0.5 - pad;
      const maxY = h * 0.5 - pad;
      const scale = 1 / Math.max(Math.abs(dx) / maxX, Math.abs(dy) / maxY);
      const ax = cx + dx * scale;
      const ay = cy + dy * scale;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = '#d0b4ff';
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, 9);
      ctx.lineTo(-10, -9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function chestArrowOn() {
    const pad = 36;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.kind !== 'chest') continue;
      const x = g.x * TILE + (canvas.width / 2 - player.x * TILE);
      const y = g.y * TILE + (canvas.height / 2 - player.y * TILE);
      if (x < pad || y < pad || x > canvas.width - pad || y > canvas.height - pad) return true;
    }
    return false;
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
    drawFoes();
    for (let i = 0; i < gems.length; i++) drawGem(gems[i]);
    drawHeroActor();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const px = sxOf(p.x);
      const py = syOf(p.y);
      ctx.globalAlpha = Math.max(0, p.life * 3);
      ctx.fillStyle = '#140e0c';
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    drawWeapons();
    drawFloats();
    ctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    camInfo.x = camX;
    camInfo.y = camY;
    camInfo.zoom = zoom;
    fxCall('draw', ctx, camInfo);
    drawChestArrows();
    ctx.restore();
    drawJoy();
  }

  function uiBlock(target) {
    return target && target.closest && target.closest('button, a, .sv-card, .panel, #adtest-panel, #adtest-prompt');
  }

  function applyDoubleGold() {
    if (doubled) return false;
    if (state !== 'dead' && state !== 'won') return false;
    doubled = true;
    doubleLocked = true;
    const extra = Math.round(runGold * (SurvivorData.REWARDS.doubleMult - 1));
    runGold += extra;
    goldMilli = Math.round(goldMilli * SurvivorData.REWARDS.doubleMult);
    const spill = Math.floor(goldMilli / 1000);
    if (spill > 0) {
      runGold += spill;
      goldMilli -= spill * 1000;
    }
    syncBank();
    const goldEl = $('sv-end-gold');
    if (goldEl) goldEl.textContent = '+' + runGold + ' gold banked';
    paintNextOffer();
    const btn = $('sv-double');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('hidden');
    }
    return true;
  }

  function doubleOffered() {
    return !!(adsOn && !doubled && (state === 'dead' || state === 'won'));
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
      if (tapBlocked()) return;
      track('survivor-restart');
      startRun();
    });
    const titleShop = $('sv-title-shop');
    if (titleShop) titleShop.addEventListener('click', () => openShop('title'));
    const endShop = $('sv-end-shop');
    if (endShop) endShop.addEventListener('click', () => openShop('end'));
    const shopClose = $('sv-shop-close');
    if (shopClose) shopClose.addEventListener('click', () => closeShop());
    $('sv-revive').addEventListener('click', () => {
      if (tapBlocked()) return;
      if (state !== 'dead' || revived) return;
      try { Ads.offerRevive(); } catch (e) {}
    });
    $('sv-double').addEventListener('click', () => {
      if (tapBlocked() || doubleLocked || doubled) return;
      if (state !== 'dead' && state !== 'won') return;
      const btn = $('sv-double');
      if (btn && btn.disabled) return;
      doubleLocked = true;
      if (btn) btn.disabled = true;
      try { Ads.offerDoubleGold(); } catch (e) {}
    });
    $('sv-reroll').addEventListener('click', () => {
      if (tapBlocked()) return;
      if (state !== 'levelup' || (rerollUsed && !adsOn)) return;
      if (adsOn) {
        try { Ads.offerReroll(); } catch (e) {}
        return;
      }
      rerollOffers();
    });
    $('sv-cards').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-choice]');
      if (!btn) return;
      choose(Number(btn.dataset.choice));
    });
    $('sv-hermit-yes').addEventListener('click', () => {
      if (tapBlocked()) return;
      acceptHermit();
    });
    $('sv-hermit-no').addEventListener('click', () => {
      if (tapBlocked()) return;
      declineHermit();
    });

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
      if (e.cancelable) e.preventDefault();
      const cap = e.target && e.target.setPointerCapture ? e.target : $('game-wrap');
      try { if (cap && cap.setPointerCapture) cap.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function move(e) {
      if (!joy.on || e.pointerId !== joy.id) return;
      joy.x = e.clientX;
      joy.y = e.clientY;
      if (e.cancelable) e.preventDefault();
    }
    function up(e) {
      if (e.pointerId !== joy.id) return;
      joy.on = false;
      joy.id = null;
    }
    const pointerOpts = { passive: false };
    window.addEventListener('pointerdown', down, pointerOpts);
    window.addEventListener('pointermove', move, pointerOpts);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    try {
      Ads.setAllow((kind) => {
        if (kind === 'reroll') return state === 'levelup';
        if (kind === 'revive') return state === 'dead';
        if (kind === 'gold') return state === 'dead' || state === 'won';
        return false;
      });
      Ads.onResult((kind, reason) => {
        if (reason !== 'accept') return;
        if (kind === 'reroll' && state === 'levelup') rerollOffers();
        if (kind === 'revive' && state === 'dead' && !revived) revivePlayer();
        if (kind === 'gold' && (state === 'dead' || state === 'won')) applyDoubleGold();
      });
    } catch (e) {}
    syncReducedMotion();
    if (reduceQuery && typeof reduceQuery.addEventListener === 'function') {
      reduceQuery.addEventListener('change', () => syncReducedMotion(reduceQuery.matches));
    }
    bindLife();
    if (debug) {
      window.__sv = () => ({
        state, time, kills, level: player.level, levelUps, hits,
        enemies: enemies.length, gems: gems.length, floats: floats.length,
        x: player.x, y: player.y, life: player.life, xp: player.xp,
        art: SurvivorSprites.ready(),
        vow: vowPayout, curse, vowCount,
      });
      window.__svSnap = () => snapRun();
      window.__svCount = (id) => {
        let n = 0;
        for (let i = 0; i < enemies.length; i++) {
          if (enemies[i].eid === id && enemies[i].life > 0 && enemies[i].dying <= 0) n += 1;
        }
        return n;
      };
      window.__svChestAt = () => {
        for (let i = 0; i < gems.length; i++) {
          if (gems[i].kind === 'chest') return { x: gems[i].x, y: gems[i].y };
        }
        return null;
      };
      window.__svChestArrow = () => chestArrowOn();
      window.__svArmRevival = () => { revivalLeft = 1; player.life = player.maxLife; return snapRun(); };
      window.__svSetVows = (n) => {
        vowCount = Math.max(0, n | 0);
        curse = vowCount > 0 ? 60 : 0;
        vowPayout = curse > 0;
        vowActive = curse > 0;
        try { SurvivorSprites.setFloorVow(vowCount); } catch (e) {}
        fxCall('vow', vowCount);
        syncVowChrome();
        return vowCount;
      };
      window.__svDrops = () => {
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
        const bases = ['iron-blade', 'bone-charm', 'ash-bead', 'iron-blade', 'bone-charm'];
        const camLeft = Math.round(canvas.width / 2 - player.x * TILE);
        const camTop = Math.round(canvas.height / 2 - player.y * TILE);
        const spots = [];
        for (let i = 0; i < rarities.length; i++) {
          const rarity = rarities[i];
          let item = null;
          try { item = SurvivorSave.createItem(bases[i], rarity); } catch (err) { item = null; }
          const g = gemPool.pop() || {};
          g.x = player.x + (i - 2) * 1.2;
          g.y = player.y + 4.6;
          g.kind = 'item';
          g.item = item || { rarity: rarity, name: rarity };
          g.value = 0;
          g.age = 0;
          g.big = false;
          g.fly = 0;
          g.vx = 0;
          g.vy = 0;
          gems.push(g);
          spots.push({
            rarity: rarity,
            x: g.x * TILE + camLeft,
            y: g.y * TILE + camTop,
          });
        }
        return { enemies: enemies.length, spots: spots };
      };
      window.__svItems = () => gems.filter((g) => g.kind === 'item').map((g) => (g.item && g.item.rarity) || '');
      window.__svPan = (x, y) => { player.x = x; player.y = y; };
      window.__svEndVow = () => { if (vowPayout) curse = 0.02; return curse; };
      window.__svHurt = (n) => { player.invuln = 0; hurt(n || 9999, true); return state; };
      window.__svGuard = () => { uiGuardUntil = (performance.now ? performance.now() : Date.now()) + 300; return state; };
      let gemToken = 1;
      window.__svGem = (px) => {
        const token = ++gemToken;
        gems.length = 0;
        const g = gemPool.pop() || {};
        g.x = player.x + (px || 20) / TILE;
        g.y = player.y;
        g.value = 1;
        g.vx = 0;
        g.vy = 0;
        g.fly = 0;
        g.token = token;
        gems.push(g);
        return token;
      };
      window.__svGemGone = (token) => !gems.some((g) => g.token === token);
      window.__svMagnet = (rank) => { owned.magnet = rank || 1; return magnetR() * TILE; };
      window.__svMerge = () => {
        let en = null;
        for (let i = 0; i < enemies.length; i++) {
          if (enemies[i].life > 0 && enemies[i].dying <= 0) { en = enemies[i]; break; }
        }
        if (!en) return null;
        const before = floats.length;
        for (let n = 0; n < 5; n++) damageEnemy(en, 3);
        const last = floats[floats.length - 1];
        return { added: floats.length - before, text: last ? last.text : '', floats: floats.length };
      };
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
  const slowLog = [];
  let allocSum = 0;
  let allocN = 0;
  let allocPos = 0;
  let allocPosN = 0;
  let heapAt = 0;
  function frame(now) {
    const raw = last ? (now - last) / 1000 : 0.016;
    const dt = Math.min(0.05, raw);
    last = now;
    if (dt > 0) {
      const inst = 1 / dt;
      fpsSmooth = fpsSmooth ? fpsSmooth * 0.9 + inst * 0.1 : inst;
    }
    fxUpdateMs = 0;
    fxDrawMs = 0;
    if (bench && typeof performance !== 'undefined' && performance.memory) heapAt = performance.memory.usedJSHeapSize;
    const updateStart = nowMs();
    if (state === 'playing') sim(dt);
    else animT += dt;
    const updateMs = nowMs() - updateStart;
    const drawStart = nowMs();
    draw();
    const drawMs = nowMs() - drawStart;
    if (bench && state === 'playing' && !benchDone) {
      if (!benchStart) benchStart = now;
      const elapsed = now - benchStart;
      // Skip the first 2s (atlas and spawn), then sample about 10s of real frame gaps.
      if (elapsed > 2000) {
        benchFrames.push(raw);
        if (raw > 0.033) {
          const gapMs = raw * 1000;
          const work = updateMs + drawMs;
          let cause = 'update';
          if (work < gapMs * 0.45) cause = '?gc';
          else if (spawnedThisFrame >= 3) cause = 'spawn';
          else if (drawMs >= updateMs) cause = 'draw';
          slowLog.push({
            gap: Math.round(gapMs * 10) / 10,
            spawn: spawnedThisFrame,
            enemies: enemies.length,
            shots: shots.length,
            foeShots: foeShots.length,
            particles: particles.length,
            drops: gems.length,
            update: Math.round(updateMs * 10) / 10,
            draw: Math.round(drawMs * 10) / 10,
            fx: Math.round((fxUpdateMs + fxDrawMs) * 10) / 10,
            cause: cause,
          });
        }
      }
      if (elapsed > 12000 && benchFrames.length) {
        benchDone = true;
        let sum = 0;
        let min = Infinity;
        let slow = 0;
        for (let i = 0; i < benchFrames.length; i++) {
          const gap = benchFrames[i];
          const f = 1 / gap;
          sum += f;
          if (f < min) min = f;
          if (gap > 0.033) slow += 1;
        }
        const avg = sum / benchFrames.length;
        const slowPct = (slow / benchFrames.length) * 100;
        const sw = (window.screen && window.screen.width) || canvas.width;
        const sh = (window.screen && window.screen.height) || canvas.height;
        const dpr = window.devicePixelRatio || 1;
        const causes = { spawn: 0, draw: 0, '?gc': 0, update: 0 };
        for (let i = 0; i < slowLog.length; i++) {
          const key = slowLog[i].cause;
          causes[key] = (causes[key] || 0) + 1;
        }
        const slowLine = 'slow: ' + slow + ' — spawn ' + (causes.spawn || 0) + ', draw ' + (causes.draw || 0) + ', update ' + (causes.update || 0) + ', ?gc ' + (causes['?gc'] || 0);
        window.__fps = {
          avg, min, slow, slowPct,
          enemies: enemies.length, frames: benchFrames.length,
          screen: sw + 'x' + sh, dpr,
          slowLog: slowLog.slice(),
          slowLine: slowLine,
          allocPerFrame: allocN ? Math.round(allocSum / allocN) : 0,
          allocPosPerFrame: allocPosN ? Math.round(allocPos / allocPosN) : 0,
          canvas: canvas.width + 'x' + canvas.height,
        };
        const out = $('sv-bench');
        if (out) {
          out.classList.remove('hidden');
          out.textContent = 'Bench ' + enemies.length + ' foes\navg ' + avg.toFixed(1) + ' fps · min ' + min.toFixed(1) + ' fps\n'
            + slow + ' frames over 33ms (' + slowPct.toFixed(1) + '%)\n'
            + sw + '×' + sh + ' · ' + dpr + ' dpr\n'
            + slowLine;
        }
      }
    }
    hud();
    if (bench && state === 'playing' && !benchDone && benchStart && (now - benchStart) > 2000 && heapAt && typeof performance !== 'undefined' && performance.memory) {
      const endHeap = performance.memory.usedJSHeapSize;
      const delta = endHeap - heapAt;
      allocSum += delta;
      allocN += 1;
      if (delta > 0) {
        allocPos += delta;
        allocPosN += 1;
      }
    }
    requestAnimationFrame(frame);
  }

  function liveBoss() {
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.boss && en.life > 0 && !(en.dying > 0)) return en;
    }
    return null;
  }

  function snapRun() {
    const boss = liveBoss();
    let chest = false;
    let bigGems = 0;
    for (let i = 0; i < gems.length; i++) {
      if (gems[i].kind === 'chest') chest = true;
      if (gems[i].big) bigGems += 1;
    }
    return {
      state: state,
      time: time,
      life: player.life,
      maxLife: player.maxLife,
      x: player.x,
      y: player.y,
      level: player.level,
      levelUps: levelUps,
      kills: kills,
      gold: runGold,
      vowSeen: vowSeen,
      vow: vowPayout,
      vowCount: vowCount,
      vowsSurvived: vowsSurvived,
      vowBadge: curse > 0 && state !== 'dead' && state !== 'won' && state !== 'title',
      warnOn: warnOn,
      doubled: doubled,
      doubleOffered: doubleOffered(),
      secondChanceFx: secondChanceFx,
      curse: curse,
      hermit: hermit.on,
      boss: boss ? boss.name : '',
      bossLife: boss ? boss.life : 0,
      bossMax: boss ? boss.maxLife : 0,
      chest: chest,
      enemies: enemies.length,
      gems: gems.length,
      bigGems: bigGems,
      evolved: Object.keys(evolved),
      secondChance: secondChance,
      banner: banner,
      novas: shots.filter((s) => s.kind === 'nova').length,
      owned: Object.assign({}, owned),
    };
  }

  bind();
  try { window.__svGemPitch = gemChainPitch; } catch (e) {}
  if (headless) {
    window.__svStart = () => { startRun(); return snapRun(); };
    window.__svNextLine = () => nextOfferLine;
    window.__svBuy = (id) => buyUpgrade(id);
    window.__svSpeed = () => moveSpeed();
    window.__svDouble = () => applyDoubleGold();
    window.__svOfferDouble = () => doubleOffered();
    window.__svAddGold = (n) => { grantGold(n || 0); return snapRun(); };
    window.__svSpawn = (id, x, y) => {
      spawnEnemy(id || 'skel', x || player.x + 2, y || player.y);
      return snapRun();
    };
    window.__svCount = (id) => {
      let n = 0;
      for (let i = 0; i < enemies.length; i++) {
        const en = enemies[i];
        if (en.life > 0 && en.dying <= 0 && (!id || en.eid === id)) n += 1;
      }
      return n;
    };
    window.__svChestAt = () => {
      for (let i = 0; i < gems.length; i++) {
        if (gems[i].kind === 'chest') return { x: gems[i].x, y: gems[i].y };
      }
      return null;
    };
    window.__svChestArrow = () => chestArrowOn();
    window.__svEvoHints = () => {
      const out = [];
      for (let i = 0; i < offers.length; i++) out.push(evoHint(offers[i]));
      return out;
    };
    window.__svOpenLevel = () => { openLevel(); return snapRun(); };
    window.__svGive = (id, rank) => { owned[id] = rank; return snapRun(); };
    window.__svBank = (n) => SurvivorSave.bankGold(n);
    window.__svNextUpgrade = () => { try { return SurvivorSave.nextUpgrade(); } catch (e) { return null; } };
    window.__svShop = () => { try { return SurvivorSave.shopList(); } catch (e) { return []; } };
    window.__svBag = () => { try { return SurvivorSave.items(); } catch (e) { return []; } };
    window.__svGemPitch = gemChainPitch;
    window.__svGoldProbe = (n, exact) => {
      runGold = 0;
      goldMilli = 0;
      for (let i = 0; i < (n || 0); i++) grantGold(exact);
      return { gold: runGold, milli: goldMilli };
    };
    window.__svStep = (dt) => {
      if (state === 'playing') sim(Math.min(0.05, dt || 0.05));
      return snapRun();
    };
    window.__svIdleStep = (dt) => {
      if (state === 'hermit') declineHermit();
      if (state === 'levelup') {
        uiGuardUntil = 0;
        hide('sv-level');
        pickLeft = 0;
        state = 'playing';
      }
      if (state === 'playing') sim(Math.min(0.05, dt || 0.05));
      return snapRun();
    };
    window.__svMove = (x, y) => { scriptMove = { x: x, y: y }; };
    window.__svChoose = (i) => { uiGuardUntil = 0; choose(i); return snapRun(); };
    window.__svNova = (rank) => {
      owned.nova = rank;
      cds.nova = 0;
      novaQueue = 0;
      shots.length = 0;
      if (state !== 'playing') state = 'playing';
      sim(0.05);
      return snapRun();
    };
    window.__svSnap = () => snapRun();
    window.__svDecline = () => { if (state === 'hermit') declineHermit(); return snapRun(); };
    window.__svAccept = () => { if (state === 'hermit') acceptHermit(); return snapRun(); };
    window.__svHurt = (n) => { player.invuln = 0; hurt(n || 9999, true); return snapRun(); };
    window.__svRevive = () => { revivePlayer(); return snapRun(); };
    window.__svDismiss = () => {
      if (state === 'levelup') {
        uiGuardUntil = 0;
        hide('sv-level');
        pickLeft = 0;
        state = 'playing';
      }
      if (state === 'hermit') declineHermit();
      return snapRun();
    };
    window.__svForceEvos = () => {
      owned.orbit = 5;
      owned.nova = 5;
      owned.tempo = 1;
      owned.cinder = 1;
      checkEvolutions();
      return snapRun();
    };
    window.__svEvoLog = () => evoLog.map((row) => ({ id: row.id, t: row.t, tick: row.tick }));
    window.__svArmRevival = () => { revivalLeft = 1; player.life = player.maxLife; return snapRun(); };
    window.__svOwned = () => Object.assign({}, owned);
    window.__svPummel = () => {
      let boss = null;
      let trash = null;
      for (let i = 0; i < enemies.length; i++) {
        const en = enemies[i];
        if (en.life <= 0 || en.dying > 0) continue;
        if (en.boss && !boss) boss = en;
        else if (!en.boss && !en.elite && !trash) trash = en;
      }
      if (!boss || !trash) return { bossFlashes: -1, trashFlashes: -1 };
      let bossFlashes = 0;
      let trashFlashes = 0;
      for (let n = 0; n < 20; n++) {
        const mark = boss.flashAt || 0;
        damageEnemy(boss, 1);
        if ((boss.flashAt || 0) !== mark) bossFlashes += 1;
        trash.hitFlash = 0;
        damageEnemy(trash, 1);
        if (trash.hitFlash > 0) trashFlashes += 1;
        time += 0.05;
      }
      return { bossFlashes: bossFlashes, trashFlashes: trashFlashes };
    };
    window.__svSeedGems = (count, dist) => {
      const away = dist || 8;
      for (let i = 0; i < (count || 6); i++) {
        const g = gemPool.pop() || {};
        g.x = player.x + (i % 3) * 0.45;
        g.y = player.y + away;
        g.value = 2;
        g.kind = 'gem';
        g.item = null;
        g.age = 15;
        g.big = false;
        g.fly = 0;
        g.vx = 0;
        g.vy = 0;
        gems.push(g);
      }
      return snapRun();
    };
    window.__svOffers = () => offers.map((o) => o.id);
    window.__svThreats = () => {
      const list = [];
      for (let i = 0; i < enemies.length; i++) {
        const en = enemies[i];
        if (en.life > 0 && !(en.dying > 0)) list.push({ x: en.x - player.x, y: en.y - player.y });
      }
      for (let i = 0; i < foeShots.length; i++) {
        const s = foeShots[i];
        list.push({ x: s.x - player.x, y: s.y - player.y });
      }
      list.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y));
      return list.slice(0, 16);
    };
  } else {
    if (bench) {
      try { document.body.classList.add('sv-bench-run'); } catch (e) {}
    }
    SurvivorSprites.load('assets/0x72/dungeon-tileset-ii.png?v=6');
    if (bench || previewOnce) startRun();
    requestAnimationFrame(frame);
  }
})();
