/** Survivor mode. Top-down arena. One thumb steers; the staff fires on its own. */
(() => {
  let TILE = 48;
  let zoom = 2;
  let viewDpr = 1;
  let viewDprLock = 0;
  const CELL = 3;
  const LIVE_CAP = 400;
  const ART = 16;
  const PHONE_CSS_PER_ART = 1.5;
  const BOSS_SCALE = 1.5;
  const RUN_SECONDS = 600;
  const MINI_AT = 300;
  // BALANCE 6.1.1 — one table. Revert this block to undo the tuning pass.
  // Evolutions wait for the clock. After the Demon, pressure ramps so a
  // circle dies between 6:00 and 8:00 while the screen stays full.
  const BALANCE = {
    chip: 3,
    idleGrace: 8,
    idleBiteEvery: 1.5,
    heavyAt: 150,
    eliteFirst: 120,
    eliteEvery: 45,
    hpScaleAt: 150,
    hpScale: 48,
    edgeAt: 45,
    wardenHp: 1400,
    demonHp: 3100,
    evoSlow: 0.5,
    evoScale: 0.3,
    evoRank: 5,
    evoPartner: 1,
    evoAt: 95,
    lateAt: 300,
    lateRamp: 150,
    lateRate: 64,
    lateCap: 400,
    lateEliteEvery: 14,
    lateHpScale: 16,
    lateShooter: 6,
    lateShot: 9,
    demonShield: 4,
    foodChance: 0.3,
    foodLife: 30,
    wardenReach: 3.05,
    minSpawn: 3,
  };
  const PARTICLE_CAP = 40;
  const FLOAT_CAP = 40;
  const FLOAT_LIFE = 0.55;
  const GEM_CAP = 180;

  const search = (typeof location !== 'undefined' && location.search) || '';
  const debug = /(?:^|[?&])debug=1(?:&|$)/.test(search);
  const bench = /(?:^|[?&])bench=1(?:&|$)/.test(search);
  const foesMatch = /(?:^|[?&])foes=(\d+)(?:&|$)/.exec(search);
  const benchFoes = foesMatch ? Math.max(1, Math.min(LIVE_CAP, Number(foesMatch[1]) || 300)) : 300;
  const headless = /(?:^|[?&])headless=1(?:&|$)/.test(search);
  const adsOn = /(?:^|[?&])adtest=1(?:&|$)/.test(search);
  const previewMatch = /(?:^|[?&])preview=([a-z0-9]+)/.exec(search);
  let previewOnce = previewMatch ? previewMatch[1] : '';
  const debugClockMatch = /(?:^|[?&])t=(\d+(?:\.\d+)?)(?:&|$)/.exec(search);
  const freshSave = /(?:^|[?&])fresh=1(?:&|$)/.test(search);
  const skelTest = /(?:^|[?&])skel=1(?:&|$)/.test(search);
  const seedMatch = /(?:^|[?&])seed=(\d+)(?:&|$)/.exec(search);
  const toolDebug = debug || freshSave || skelTest;
  const debugClock = toolDebug && debugClockMatch ? Number(debugClockMatch[1]) : 0;
  const walkMatch = toolDebug && /(?:^|[?&])walk=(circle|kite)(?:&|$)/.exec(search);
  const walkCircle = !!(walkMatch && walkMatch[1] === 'circle');
  const walkKite = !!(walkMatch && walkMatch[1] === 'kite');
  const fpsMatch = /(?:^|[?&])fps=(\d+)(?:&|$)/.exec(search);
  const lockFps = fpsMatch ? Math.max(1, Math.min(120, Number(fpsMatch[1]) || 0)) : 0;
  const demonHpMatch = toolDebug && /(?:^|[?&])demonhp=(\d*\.?\d+)(?:&|$)/.exec(search);
  const demonHpFrac = demonHpMatch ? Math.max(0, Math.min(1, Number(demonHpMatch[1]))) : -1;
  const forceVow = toolDebug && /(?:^|[?&])vow=1(?:&|$)/.test(search);
  if (seedMatch) {
    let seedState = Number(seedMatch[1]) >>> 0;
    Math.random = () => {
      seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0;
      return seedState / 4294967296;
    };
  }

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
  const drawOrder = new Array(512);
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
  const visScratch = { frame: null, scale: 1, flip: false, boss: false, elite: false, fid: 0, crit: false };
  const sweepInfo = { x: 0, y: 0, radius: 0 };
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
  const beamScratch = { id: 0 };

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
  let ringAcc = 0;
  let ringAngle = 0;
  let nextEliteAt = 45;
  let stillT = 0;
  let velX = 0;
  let velY = 0;
  let headX = 1;
  let headY = 0;
  let frameDt = 1 / 60;
  let nextDropAt = 18;
  let foodEaten = 0;
  let shieldEarly = 0;
  let shieldSeen = 0;
  let lastPrevious = 0;
  let lastBest = 0;
  let hpBar = -1;
  let hpFrom = 0;
  let hpTo = 0;
  let hpTween = 1;
  let kiteSide = 1;
  let kiteSideAt = 2.6;
  let forwardAcc = 0;
  const chatLog = [];
  let stillBite = 0;
  let itemDrops = 0;
  let rareAt = -1;
  let epicAt = -1;
  let legendAt = -1;
  let legendDrops = 0;
  let demonLegend = false;
  let eliteN = 0;
  let lastHit = '';
  let rareSeen = false;
  let epicSeen = false;
  let hitPause = 0;
  let hitPauseAt = -10;
  let slowLeft = 0;
  let sweepOn = false;
  let sweepT = 0;
  let sweepPrev = 0;
  let sweepMax = 0;
  let sweepGen = 1;
  let sweepKills = 0;
  let showerLeft = 0;
  let pendingLevels = 0;
  let toastT = 0;
  let shardCd = 0;
  let emberCd = 0;
  let mightPulse = 0;
  let evoWindow = false;
  const SLOW = 0.35;
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
  let evoSlow = 0;
  let evoHold = false;
  let evoIgnoreClock = false;
  let evoPollAt = 1;
  let evolvePending = '';
  const evolveQueue = [];
  let spawnedThisFrame = 0;
  let uiGuardUntil = 0;
  let regen = 0;
  let revivalLeft = 0;
  let secondChance = 0;
  let toastText = '';
  let casterPlant = 0;
  let castersCleared = 0;
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

  function vowSpec() {
    const spec = (typeof SurvivorData !== 'undefined' && SurvivorData.VOW) ? SurvivorData.VOW : null;
    if (spec && spec.hit > 0 && spec.gold && spec.xp) return spec;
    return { earliest: 90, duration: 60, window: 25, hit: 1.5, xp: [1, 1.5, 2, 3], gold: [1, 1.5, 2, 3] };
  }

  function vowFrom(table, count) {
    const n = count < 0 ? 0 : count;
    const i = n >= table.length ? table.length - 1 : n;
    return table[i];
  }

  function vowMult() {
    return vowFrom(vowSpec().gold, vowCount);
  }

  function vowXpMul() {
    return vowFrom(vowSpec().xp, vowCount);
  }

  function vowNum(n) {
    return String(Math.round(n * 100) / 100);
  }

  function vowLines() {
    const spec = vowSpec();
    const gold = vowFrom(spec.gold, vowCount + 1);
    const xp = vowFrom(spec.xp, vowCount + 1);
    const goldPct = Math.round((gold - 1) * 100);
    const xpPct = Math.round((xp - 1) * 100);
    const reward = xpPct === goldPct
      ? ('Reward: +' + goldPct + '% XP and gold')
      : ('Reward: +' + xpPct + '% XP and +' + goldPct + '% gold');
    return {
      risk: 'Risk: enemies hit ' + vowNum(spec.hit) + '\u00d7 harder',
      reward: reward,
    };
  }

  function paintHermitCard() {
    const lines = vowLines();
    const risk = $('sv-hermit-risk');
    const reward = $('sv-hermit-reward');
    if (risk) risk.textContent = lines.risk;
    if (reward) reward.textContent = lines.reward;
  }

  function scheduleFirstVow() {
    const spec = vowSpec();
    const span = spec.window == null ? 25 : spec.window;
    if (forceVow) return spec.earliest;
    return spec.earliest + Math.random() * span;
  }

  function grantXp(amount) {
    const n = amount || 0;
    if (!(n > 0)) return;
    player.xp += n * vowXpMul();
  }

  let clockMs = -1;

  function nowMs() {
    if (clockMs >= 0) return clockMs;
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function tapBlocked() {
    return nowMs() < uiGuardUntil;
  }

  let uiGesture = 0;

  function acceptPress(e) {
    if (tapBlocked()) {
      uiGesture = 0;
      return false;
    }
    if (e && e.type === 'click' && uiGesture) {
      uiGesture = 0;
      return false;
    }
    if (e && e.type !== 'click') uiGesture = e.pointerId || 1;
    return true;
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
    const cssW = wrap.clientWidth || window.innerWidth || 1100;
    const cssH = wrap.clientHeight || window.innerHeight || 800;
    const dpr = viewDprLock > 0 ? viewDprLock : ((typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const phone = cssW < 760;
    const cssPerArt = phone ? PHONE_CSS_PER_ART : 2;
    const deviceScale = Math.max(1, Math.round(cssPerArt * dpr));
    zoom = deviceScale;
    viewDpr = dpr;
    TILE = (SurvivorSprites.FRAME || ART) * deviceScale;
    try { SurvivorSprites.setZoom(deviceScale); } catch (e) {}
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    if (canvas.style) {
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
    }
    ctx.imageSmoothingEnabled = false;
  }

  function sxOf(x) { return x * TILE + camX; }
  function syOf(y) { return y * TILE + camY; }

  function addShake(amount) {
    if (reduceMotion || bench || !(amount > 0)) return;
    shakeMag = Math.min(5.5, shakeMag + amount);
  }

  function hpFor(id, bossKind) {
    let hp = 8;
    if (id === 'imp') hp = 8;
    else if (id === 'charger') hp = 10;
    else if (id === 'shooter') hp = 8;
    else if (id === 'brute') hp = 12;
    if (bossKind === 'warden') return BALANCE.wardenHp;
    if (bossKind === 'demon') return BALANCE.demonHp;
    if (time > BALANCE.hpScaleAt) {
      let div = BALANCE.hpScale;
      const u = lateT();
      if (u > 0) div = BALANCE.hpScale + (BALANCE.lateHpScale - BALANCE.hpScale) * u;
      hp = Math.round(hp * (1 + (time - BALANCE.hpScaleAt) / div));
    }
    return Math.max(1, hp);
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
    en.dmg = bossFlag ? 18 : (type.id === 'charger' ? 6 : BALANCE.chip);
    if (bossKind === 'warden') en.dmg = Math.max(1, Math.round(en.dmg * 0.7));
    en.maxLife = bench ? 99999 : hpFor(type.id, bossKind || (bossFlag ? 'demon' : ''));
    en.life = en.maxLife;
    en.boss = bossFlag;
    en.bossKind = bossKind || (bossFlag ? 'demon' : '');
    en.sprite = bossKind === 'warden' ? 'warden' : (bossFlag ? 'boss' : '');
    en.elite = !!(opts && opts.elite);
    if (bossFlag) en.scale = BOSS_SCALE;
    else if (en.elite) en.scale = 1.65;
    else if (type.id === 'brute') en.scale = 0.625;
    else en.scale = 1;
    if (en.elite) {
      en.maxLife = Math.max(1, Math.round(hpFor(type.id, '') * 8));
      en.life = en.maxLife;
      en.speed *= 1.2;
      en.dmg = 12;
      en.xp = 8;
      en.gold = 6;
    }
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
    en.id = en.fid;
    en.sweepGen = 0;
    if (bossFlag) {
      const tuned = bossKind === 'warden' ? (0.78 / 0.9) : 0.9;
      en.radius = tuned * BOSS_SCALE;
    } else if (en.elite) en.radius = 0.48;
    en.flashAt = 0;
    const greed = (1 + shopRank('greed') * 0.08) * (1 + (itemStats().greed || 0)) * vowMult();
    const baseGold = bossFlag ? SurvivorData.REWARDS.gold.mini : (en.elite ? 6 : (SurvivorData.REWARDS.gold[type.id] || 1));
    if (!(en.elite && en.gold > baseGold)) en.gold = baseGold * greed;
    else en.gold *= greed;
    if (!en.elite) en.xp = bossFlag ? 14 : type.id === 'brute' ? 5 : T.gemXp;
    enemies.push(en);
    biteIfStill(en);
    return en;
  }

  function stillRing() {
    return stillT > BALANCE.idleGrace;
  }

  function biteIfStill(en) {
    if (!stillRing() || !en || en.boss || en.elite) return;
    if (en.behaviour === 'shooter' || en.behaviour === 'boss') return;
    const dist = len2(player.x - en.x, player.y - en.y);
    if (dist >= (en.radius || 0.32) + 0.48) return;
    if (stillBite > 0) return;
    stillBite = BALANCE.idleBiteEvery;
    en.touchCd = 0.7;
    lastHit = 'idle';
    hurt(BALANCE.chip, false);
  }

  function tickIdleChip() {
    if (state !== 'playing' || !stillRing() || stillBite > 0) return;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (!en || en.boss || en.elite || en.life <= 0 || en.dying > 0) continue;
      if (en.behaviour === 'shooter' || en.behaviour === 'boss') continue;
      const dist = len2(player.x - en.x, player.y - en.y);
      if (dist >= (en.radius || 0.32) + 0.48) continue;
      stillBite = BALANCE.idleBiteEvery;
      lastHit = 'idle';
      hurt(BALANCE.chip, false);
      return;
    }
  }

  function releaseEnemy(i) {
    const en = enemies[i];
    telegraphOff(en, i);
    const last = enemies.pop();
    if (i < enemies.length) enemies[i] = last;
    enemyPool.push(en);
  }

  function gemCount() {
    let n = 0;
    for (let i = 0; i < gems.length; i++) {
      if ((gems[i].kind || 'gem') === 'gem') n += 1;
    }
    return n;
  }

  function evictOldestGem() {
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if ((g.kind || 'gem') !== 'gem') continue;
      grantXp(g.value || 0);
      releaseGemAt(i);
      return true;
    }
    return false;
  }

  function dropGem(en) {
    if (gemCount() >= GEM_CAP) evictOldestGem();
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
    g.shower = 0;
    gems.push(g);
    if (sweepOn) markShowerGem(g);
    if (en.boss) {
      const chest = dropPickup(en, 'chest', null);
      if (chest && en.bossKind === 'warden') chest.withFood = 1;
    } else if (en.elite && (en.fid % 4 === 0)) dropPickup(en, 'heart', null);
    if (en.elite && !en.boss && Math.random() < BALANCE.foodChance) {
      placePickup(en.x + 0.45, en.y - 0.15, 'food', null);
    }
    try { maybeDropItem(en); } catch (e) {}
  }

  function maybeDropItem(en) {
    let kind = '';
    if (en.bossKind === 'demon') kind = 'demon';
    else if (en.boss) kind = 'boss';
    else if (en.elite) kind = (!rareSeen && time >= 40) ? 'rare' : 'elite';
    else {
      const chance = time < 90 ? 0.004 : time < 240 ? 0.002 : 0.0012;
      if (Math.random() >= chance) return;
      kind = 'mob';
    }
    const item = SurvivorSave.mintDrop(kind);
    if (!item) return;
    if (item.rarity === 'rare' || item.rarity === 'epic' || item.rarity === 'legendary') rareSeen = true;
    if (item.rarity === 'epic' || item.rarity === 'legendary') epicSeen = true;
    itemDrops += 1;
    if ((item.rarity === 'rare' || item.rarity === 'epic' || item.rarity === 'legendary') && rareAt < 0) rareAt = time;
    if ((item.rarity === 'epic' || item.rarity === 'legendary') && epicAt < 0) epicAt = time;
    if (item.rarity === 'legendary') {
      if (en.bossKind === 'demon') demonLegend = true;
      else {
        legendDrops += 1;
        if (legendAt < 0) legendAt = time;
      }
    }
    dropPickup(en, 'item', item);
  }

  function placePickup(x, y, kind, item) {
    const g = gemPool.pop() || {};
    g.x = x;
    g.y = y;
    g.kind = kind;
    g.value = 0;
    g.item = item || null;
    g.vx = 0;
    g.vy = 0;
    g.fly = 0;
    g.age = 0;
    g.big = false;
    g.shower = 0;
    gems.push(g);
    if (kind === 'item' && item) {
      if (item.rarity === 'rare' || item.rarity === 'epic' || item.rarity === 'legendary') rareSeen = true;
      announceItem(item, g.x, g.y);
    }
    return g;
  }

  function dropPickup(en, kind, item) {
    if (kind === 'chest') return placePickup(en.x, en.y, kind, item);
    if (kind === 'heart') return placePickup(en.x - 0.35, en.y, kind, item);
    if (kind === 'item') return placePickup(en.x + 0.45, en.y, kind, item);
    return placePickup(en.x, en.y, kind, item);
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
    s.r = kind === 'nova' ? 0.2 : kind === 'ember' ? 0.55 : 0.28;
    s.seq = kind === 'nova' ? ++novaSeq : kind === 'pierce' ? ++pierceSeq : 0;
    s.pierce = 0;
    s.hitFid = 0;
    s.chained = 0;
    shots.push(s);
    return s;
  }

  function floatText(x, y, text, color, big, fid, amount, crit) {
    if (fid) {
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        if (f.fid === fid && time - f.stamp < 0.25) {
          f.amount += amount || 0;
          f.text = ntext(f.amount);
          f.x = x;
          f.y = y;
          f.stamp = time;
          f.life = FLOAT_LIFE;
          f.max = FLOAT_LIFE;
          f.big = !!big || f.amount >= 18;
          if (crit) f.crit = 1;
          if (f.crit) f.color = '#ffffff';
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
    f.color = crit ? '#ffffff' : color;
    f.life = FLOAT_LIFE;
    f.max = FLOAT_LIFE;
    f.big = !!big;
    f.crit = crit ? 1 : 0;
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
    visScratch.color = en.color || '#d7dbe3';
    visScratch.crit = false;
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

  function pulseAround(x, y, rad, dmg) {
    nearbyFill(x, y, rad);
    for (let n = 0; n < nearCount; n++) {
      const en = nearList[n];
      const dx = en.x - x;
      const dy = en.y - y;
      if (dx * dx + dy * dy <= rad * rad) damageEnemy(en, dmg, true);
    }
  }

  function power() {
    const steps = [0, 0.06, 0.1, 0.24, 0.3, 0.48];
    const rank = Math.min(5, owned.might || 0);
    let itemMight = 0;
    try { itemMight = itemStats().might; } catch (e) {}
    const scale = (1 + steps[rank]) * (1 + shopRank('might') * 0.06 + itemMight);
    return scale;
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
    return (px * viewDpr) / Math.max(1, TILE);
  }
  function effectOn(name) {
    try {
      const flags = SurvivorSave.effects();
      return !!(flags && flags[name]);
    } catch (e) { return false; }
  }
  function critChance() {
    return Math.min(0.35, 0.1 + Math.min(5, owned.might || 0) * 0.02);
  }
  function beamFx(id, x, y, rarity) {
    if (!rareBeam(rarity)) return;
    if (typeof FX === 'undefined' || typeof FX.beam !== 'function') return;
    FX.beam(id, x, y, rarity);
  }
  function showToast(item) {
    const el = $('sv-toast');
    if (!el || !item) return;
    let rarity = 'Common';
    try { rarity = SurvivorSave.rarityName(item.rarity); } catch (e) {
      const raw = item.rarity || 'common';
      rarity = raw.charAt(0).toUpperCase() + raw.slice(1);
    }
    toastText = rarity + ': ' + (item.name || 'Item');
    el.textContent = toastText;
    el.style.color = RARITY_FILL[item.rarity] || '#f4efe0';
    el.classList.remove('hidden');
    toastT = 1.6;
  }
  function countGround(rarity) {
    let n = 0;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.kind !== 'item') continue;
      if (!rarity) n += 1;
      else if (g.item && g.item.rarity === rarity) n += 1;
    }
    return n;
  }
  function convertOldest(rarity) {
    let at = -1;
    let age = -1;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.kind !== 'item' || !g.item || g.item.rarity !== rarity) continue;
      if ((g.age || 0) >= age) { age = g.age || 0; at = i; }
    }
    if (at < 0) return false;
    const g = gems[at];
    const gold = rarity === 'uncommon' ? 2 : 1;
    grantGold(gold);
    floatText(g.x, g.y, '+' + gold, '#e0c080', false);
    releaseGemAt(at);
    return true;
  }
  function maintainGround(dt) {
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      if (!g || g.kind !== 'item') continue;
      g.age = (g.age || 0) + dt;
      const rarity = (g.item && g.item.rarity) || 'common';
      if ((rarity === 'common' || rarity === 'uncommon') && g.age > 30) {
        const gold = rarity === 'uncommon' ? 2 : 1;
        grantGold(gold);
        floatText(g.x, g.y, '+' + gold, '#e0c080', false);
        releaseGemAt(i);
        continue;
      }
      if (rareBeam(rarity) && g.item) beamFx(g.item.id, g.x, g.y, rarity);
    }
    let guard = 0;
    while (guard++ < 12 && countGround() > 60) {
      if (convertOldest('common')) continue;
      if (convertOldest('uncommon')) continue;
      break;
    }
  }
  function beamOff(id) {
    if (id == null || id === '') return;
    if (typeof FX !== 'undefined' && typeof FX.beamOff === 'function') FX.beamOff(id);
  }
  function rareBeam(rarity) {
    return rarity === 'rare' || rarity === 'epic' || rarity === 'legendary';
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
    const incoming = curse > 0 ? amount * vowSpec().hit : amount;
    const dmg = Math.max(1, incoming - armorCut());
    player.life -= dmg;
    player.hitFlash = 0.16;
    player.invuln = 0.45;
    addShake(heavy ? 4.2 : 2.6);
      floatText(player.x, player.y - 0.4, ntext(dmg), '#ff8060', true);
    sfx('hurt');
    if (player.life <= 0) {
      if (revivalLeft <= 0 && secondChance <= 0 && shopRank('revival') > 0) revivalLeft = 1;
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
    if (en.bossKind === 'demon' && en.shieldT > 0) {
      const box = fxBox();
      if (box && typeof box.shieldHit === 'function' && time - (en.shieldHitAt || -1) >= 0.1) {
        en.shieldHitAt = time;
        box.shieldHit(en.fid, en.x, en.y);
      }
      return;
    }
    let crit = false;
    if (!tick && Math.random() < critChance()) {
      crit = true;
      amount *= 2;
    }
    en.life -= amount;
    if (en.bossKind === 'demon' && !en.shieldUsed && en.life > 0 && en.life <= en.maxLife * 0.5) {
      startDemonShield(en);
    }
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
      floatText(en.x, en.y - 0.15, ntext(shown), '#ffffff', big, en.fid, shown, crit);
      const sparkN = (owned.might || 0) >= 2 ? 5 : 3;
      const sparkSp = (owned.might || 0) >= 2 ? 3.4 : 2.2;
      spark(en.x, en.y, en.color || '#ffffff', sparkN, sparkSp);
      mightPulse += 1;
      if ((owned.might || 0) >= 3 && mightPulse % 3 === 0) pulseAround(en.x, en.y, (owned.might || 0) >= 4 ? 1.8 : 1.15, 4);
      const vis = foeVisual(en);
      vis.crit = crit;
      vis.color = en.color || '#d7dbe3';
      fxCall('hit', en.x, en.y, vis);
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
      telegraphOff(en);
      if (en.bossKind === 'demon' && (en.shieldT > 0 || en.shieldLive)) {
        en.shieldT = 0;
        en.shieldLive = false;
        const box = fxBox();
        if (box && typeof box.shieldOff === 'function') box.shieldOff(en.fid);
      }
      if (en.shieldAdd) onShieldAddDead(en.shieldAdd);
      if (en.bossKind === 'warden') wardenCleared = true;
      else if (en.boss) demonCleared = true;
      if (!(en.boss || en.elite) || time >= (en.flashAt || 0)) {
        en.hitFlash = 0.08;
        if (en.boss || en.elite) en.flashAt = time + 0.35;
      }
      kills += 1;
      if (sweepOn && en.sweepGen === sweepGen) sweepKills += 1;
      grantGold(en.gold);
      dropGem(en);
      if ((owned.might || 0) >= 5) pulseAround(en.x, en.y, 1.6, 6);
      burst(en.x, en.y, en.color || '#ffffff');
      const deadVis = foeVisual(en);
      deadVis.color = en.color || '#d7dbe3';
      deadVis.crit = false;
      if (typeof FX !== 'undefined' && typeof FX.kill === 'function') FX.kill(en.x, en.y, en.eid, deadVis);
      else fxCall('death', en.x, en.y, en.eid, foeVisual(en));
      if ((en.elite || en.boss) && !reduceMotion && slowLeft <= 0 && !sweepOn && time - hitPauseAt >= 0.5) {
        hitPause = 0.04;
        hitPauseAt = time;
      }
      if (en.boss) addShake(4.5);
      else if (en.elite) addShake(2.6);
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
          for (let n = 0; n < count; n++) {
            if (nearCount < nearList.length) nearList[nearCount++] = bucket[n];
          }
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

  function viewHalfW() { return canvas.width / (TILE * 2); }
  function viewHalfH() { return canvas.height / (TILE * 2); }

  function edgePoint(ang, pad) {
    const inside = time >= BALANCE.edgeAt && !stillRing();
    const extra = inside ? 0 : (pad == null ? 0.85 : pad);
    const span = inside ? 0.72 : 1;
    const halfW = viewHalfW() * span + extra;
    const halfH = viewHalfH() * span + extra;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const fit = 1 / Math.max(Math.abs(c) / Math.max(0.8, halfW), Math.abs(s) / Math.max(0.8, halfH));
    spotScratch.x = player.x + c * fit;
    spotScratch.y = player.y + s * fit;
    return spotScratch;
  }

  function spawnRing(pad) {
    spawnSerial += 1;
    const ang = ringAngle + spawnSerial * 2.399963;
    const half = Math.max(viewHalfW(), viewHalfH());
    if (stillRing()) {
      spotScratch.x = player.x + Math.cos(ang) * 0.58;
      spotScratch.y = player.y + Math.sin(ang) * 0.58;
      return spotScratch;
    }
    const moving = player.moving && (headX * headX + headY * headY) > 0.01;
    if (time >= MINI_AT && moving && spawnSerial % 3 === 0) {
      return viewEdge(aheadAngle(true), true, Math.max(3, BALANCE.minSpawn));
    }
    if (time >= BALANCE.edgeAt) return edgePoint(ang, 0.85 + (pad || 0));
    let ring = half + 0.9 + (pad || 0);
    if (time < 3) ring = Math.max(2.3, half * 0.7);
    spotScratch.x = player.x + Math.cos(ang) * ring;
    spotScratch.y = player.y + Math.sin(ang) * ring;
    return spotScratch;
  }

  function spawnForwardPack() {
    const cap = Math.min(LIVE_CAP, spawnCap());
    const count = 5;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < count && enemies.length < cap; i++) {
      const ang = aheadAngle(true);
      const spot = viewEdge(ang, true, BALANCE.minSpawn);
      const x = spot.x;
      const y = spot.y;
      spawnEnemy(spawnKind(), x, y);
      sx += x;
      sy += y;
      n += 1;
      spawnedThisFrame += 1;
    }
    if (n) fxSpawn(sx / n, sy / n);
  }

  function dropWorldItem(forced) {
    let kind = forced || 'mob';
    if (!forced && rareAt < 0 && time >= 78) kind = 'rare';
    let item = null;
    try { item = SurvivorSave.mintDrop(kind); } catch (e) { item = null; }
    if (!item) return;
    const ang = player.moving ? aheadAngle(false) : Math.random() * Math.PI * 2;
    const dist = Math.max(BALANCE.minSpawn, 3.4);
    const x = player.x + Math.cos(ang) * dist;
    const y = player.y + Math.sin(ang) * dist;
    if (item.rarity === 'rare' || item.rarity === 'epic' || item.rarity === 'legendary') {
      if (rareAt < 0) rareAt = time;
      rareSeen = true;
    }
    if ((item.rarity === 'epic' || item.rarity === 'legendary') && epicAt < 0) epicAt = time;
    itemDrops += 1;
    placePickup(x, y, 'item', item);
  }

  function wardenAlive() {
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.bossKind === 'warden' && en.life > 0 && en.dying <= 0) return true;
    }
    return false;
  }

  function burstCasters() {
    let n = 0;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (en.eid === 'shooter' && en.life > 0 && en.dying <= 0) {
        n += 1;
        damageEnemy(en, en.life + 1);
      }
    }
    castersCleared += n;
    return n;
  }

  function spawnWarden() {
    burstCasters();
    const spot = spawnBossEdge();
    return spawnEnemy('brute', spot.x, spot.y, { bossKind: 'warden', name: 'Grave Warden' });
  }

  function lateT() {
    if (!demonCleared || time < BALANCE.lateAt) return 0;
    const span = BALANCE.lateRamp > 0 ? BALANCE.lateRamp : 1;
    return Math.max(0, Math.min(1, (time - BALANCE.lateAt) / span));
  }

  function eliteInterval() {
    const u = lateT();
    if (u <= 0) return BALANCE.eliteEvery;
    return Math.max(6, BALANCE.eliteEvery + (BALANCE.lateEliteEvery - BALANCE.eliteEvery) * u);
  }

  function spawnKind() {
    const n = spawnSerial;
    const u = lateT();
    if (time >= MINI_AT && !wardenAlive()) {
      const every = u > 0.2 ? BALANCE.lateShooter : 18;
      if (every > 0 && n % every === 0) return 'shooter';
    }
    if (time >= BALANCE.heavyAt && n % 18 === 0) return 'charger';
    if (time >= BALANCE.heavyAt && n % 14 === 0) return 'brute';
    if (n % 4 === 0) return 'imp';
    return 'skel';
  }

  function spawnRate() {
    const swarm = time > 18 && (Math.floor(time / 15) % 2 === 1);
    let rate = 2.2;
    if (time < 12) rate = 4;
    else if (time < 40) rate = 2.6;
    else if (time < 70) rate = 3.4;
    else if (time < 120) rate = 12;
    else if (time < 180) rate = 26;
    else if (time < 360) rate = 34;
    else rate = 40;
    const u = lateT();
    if (u > 0) rate = rate + (BALANCE.lateRate - rate) * u;
    if (swarm) rate *= 1.35;
    if (stillT > 0.7) rate *= 1.45;
    return rate;
  }

  function spawnCap() {
    let cap = 340;
    if (time < 12) cap = 14;
    else if (time < 35) cap = 32;
    else if (time < 70) cap = 72;
    else if (time < 120) cap = 140;
    else if (time < 200) cap = 220;
    else if (time < 360) cap = 320;
    const u = lateT();
    if (u > 0) cap = Math.round(cap + (BALANCE.lateCap - cap) * u);
    return Math.min(LIVE_CAP, cap);
  }

  function spawnWave() {
    const half = Math.max(viewHalfW(), viewHalfH());
    const count = (Math.floor(time / 15) % 2 === 1) ? 16 : 10;
    const cap = Math.min(LIVE_CAP, spawnCap());
    const moving = player.moving && (headX * headX + headY * headY) > 0.01;
    for (let i = 0; i < count && enemies.length < cap; i++) {
      const a = ringAngle + (i / count) * Math.PI * 2;
      let x;
      let y;
      if (stillRing()) {
        x = player.x + Math.cos(a) * 0.58;
        y = player.y + Math.sin(a) * 0.58;
      } else if (time >= MINI_AT && moving && i % 3 === 0) {
        const spot = viewEdge(aheadAngle(true), true, Math.max(3, BALANCE.minSpawn));
        x = spot.x;
        y = spot.y;
      } else if (time >= BALANCE.edgeAt) {
        const spot = edgePoint(a, 0.7);
        x = spot.x;
        y = spot.y;
      } else {
        const rad = half + 0.75;
        x = player.x + Math.cos(a) * rad;
        y = player.y + Math.sin(a) * rad;
      }
      spawnEnemy(spawnKind(), x, y);
      spawnedThisFrame += 1;
    }
    ringAngle += 0.37;
  }

  function makeRoom() {
    if (enemies.length < LIVE_CAP) return true;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (!en || en.boss || en.elite || en.dying > 0) continue;
      releaseEnemy(i);
      return true;
    }
    return enemies.length < LIVE_CAP;
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
      spawnWarden();
    }
    if (!demonWarned && time >= MINI_AT - 2) {
      demonWarned = true;
      raiseBanner('Risen Demon approaches', true);
    }
    if (time >= MINI_AT && !boss5) {
      boss5 = true;
      const spot = spawnBossEdge();
      const demon = spawnEnemy('brute', spot.x, spot.y, { bossKind: 'demon', name: 'Risen Demon' });
      applyDemonFrac(demon);
    }
    if (state === 'playing' && !hermit.on && curse <= 0 && !vowPayout && time >= nextVowAt && time >= vowSpec().earliest) {
      hermit.x = player.x + 2.4;
      hermit.y = player.y + 1.2;
      vowSeen = true;
      fxCall('vow', vowCount);
      if (forceVow) {
        hermit.used = true;
        acceptHermit();
        return;
      }
      openHermit();
      return;
    }
    if (time >= nextDropAt && state === 'playing') {
      nextDropAt = time + 15 + Math.random() * 10;
      dropWorldItem(rareAt < 0 && time >= 78 ? 'rare' : '');
    }
    if (time >= MINI_AT && player.moving) {
      forwardAcc += dt;
      if (forwardAcc >= 3.4) {
        forwardAcc = 0;
        spawnForwardPack();
      }
    }
    if (time >= RUN_SECONDS) {
      runGold += SurvivorData.REWARDS.gold.win;
      finish('won');
      return;
    }
    if (time >= nextEliteAt && makeRoom()) {
      nextEliteAt += eliteInterval();
      eliteN += 1;
      const spot = spawnRing(0.2);
      spawnEnemy('brute', spot.x, spot.y, { elite: true });
    }
    const cap = Math.min(LIVE_CAP, spawnCap());
    const pressure = bossFightOn() ? 0.45 : 1;
    const swarm = time > 18 && (Math.floor(time / 15) % 2 === 1);
    ringAcc += dt;
    const ringEvery = swarm ? 2.2 : 4.4;
    if (ringAcc >= ringEvery && enemies.length < cap) {
      ringAcc = 0;
      spawnWave();
    }
    spawnAcc += spawnRate() * pressure * dt;
    let guard = 0;
    const burst = swarm ? 16 : 12;
    while (spawnAcc >= 1 && enemies.length < cap && guard++ < burst) {
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
    let reach = Math.max(5.5, Math.min(halfW, halfH) * 0.7);
    if (en.bossKind === 'warden') reach = Math.min(reach, BALANCE.wardenReach);
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

  function chainNova(en, s) {
    s.chained = 1;
    const child = spawnShot('nova', en.x, en.y, 0, 0, s.dmg * 0.55, 0.32);
    child.chained = 1;
    child.r = 0.15;
  }

  function tickWeapons(dt) {
    if (shardCd > 0) shardCd -= dt;
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
        const bolt = spawnShot('bolt', player.x, player.y, Math.cos(ang) * sp, Math.sin(ang) * sp, base * (i === 0 ? 1 : 0.65), 1.4);
        bolt.pierce = boltRank >= 4 ? 1 : 0;
        bolt.r = boltRank >= 2 ? 0.46 : 0.28;
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
          if (dx * dx + dy * dy < reach * reach) {
            damageEnemy(en, dmg, true);
            if (effectOn('shards') && shardCd <= 0) {
              shardCd = 0.24;
              spawnShot('bolt', bx, by, Math.cos(a) * 9, Math.sin(a) * 9, 9 * power(), 0.32);
            }
          }
        }
      }
      if (effectOn('twin') && count <= 6) {
        const ir = rad * 0.62;
        for (let i = 0; i < 2; i++) {
          const a = -orbitAngle * 1.3 + i * Math.PI;
          const bx = player.x + Math.cos(a) * ir;
          const by = player.y + Math.sin(a) * ir;
          const slot = bladePos[count + i];
          slot.x = bx;
          slot.y = by;
          slot.angle = a;
          bladeView[count + i] = slot;
          nearbyFill(bx, by, 1.3);
          for (let n = 0; n < nearCount; n++) {
            const en = nearList[n];
            const reach = 0.62 + bodyReach(en);
            const dx = en.x - bx;
            const dy = en.y - by;
            if (dx * dx + dy * dy < reach * reach) damageEnemy(en, dmg * 0.8, true);
          }
        }
        bladeView.length = count + 2;
      } else bladeView.length = count;
      bladeInfo.radius = rad;
      bladeInfo.positions = bladeView;
      fxCall('cast', 'blade', player.x, player.y, bladeInfo);
    }
    if (effectOn('ember') && player.moving) {
      emberCd -= dt;
      if (emberCd <= 0) {
        emberCd = 0.2;
        const ember = spawnShot('ember', player.x, player.y, 0, 0, 8 * power(), 0.45);
        ember.hitFid = ++foeSeq;
      }
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
              if (effectOn('chain') && en.life <= 0 && !s.chained) chainNova(en, s);
            }
          }
        }
      } else {
        const x0 = s.x;
        const y0 = s.y;
        if (s.kind !== 'ember') {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
        }
        const hitR = s.kind === 'ember' ? 0.7 : s.kind === 'pierce' ? (0.55 + ((owned.pierce || 0) >= 2 ? 0.18 : 0)) * area() : (s.r > 0.36 ? 0.56 : 0.42);
        nearbyFill(s.x, s.y, hitR + 1.2);
        for (let n = 0; n < nearCount; n++) {
          const en = nearList[n];
          const reach = hitR + bodyReach(en);
          const hit2 = reach * reach;
          const sdx = en.x - s.x;
          const sdy = en.y - s.y;
          const sd2 = sdx * sdx + sdy * sdy;
          if (s.kind === 'ember') {
            if (sd2 > hit2 || en._ember === s.hitFid) continue;
            en._ember = s.hitFid;
            damageEnemy(en, s.dmg, true);
            continue;
          }
          if (s.kind === 'pierce') {
            if (en._pierce === s.seq || !sweptHit(x0, y0, s.x, s.y, en.x, en.y, reach)) continue;
            en._pierce = s.seq;
            damageEnemy(en, s.dmg);
            continue;
          }
          const boltHit = s.kind === 'ember' ? sd2 <= hit2 : sweptHit(x0, y0, s.x, s.y, en.x, en.y, reach);
          if (boltHit) {
            if (s.pierce > 0 && s.hitFid === en.fid) continue;
            damageEnemy(en, s.dmg);
            if (effectOn('chain') && s.kind === 'nova' && en.life <= 0 && !s.chained) chainNova(en, s);
            if (s.pierce > 0 && s.hitFid !== en.fid) {
              s.hitFid = en.fid;
              s.pierce -= 1;
            } else s.life = 0;
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
      const x0 = s.x;
      const y0 = s.y;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const shotR = player.moving ? 0.22 : 0.46;
      if (sweptHit(x0, y0, s.x, s.y, player.x, player.y, shotR)) {
        lastHit = 'shot';
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
    if (player.moving && !en.boss && !en.elite) return;
    if (stillRing() && !en.boss && !en.elite) return;
    if (dist < en.radius + 0.48 && en.touchCd <= 0) {
      en.touchCd = (player.moving && en.elite) ? 2.4 : 0.7;
      lastHit = en.boss ? 'boss' : (en.elite ? 'elite' : en.eid);
      hurt(dmg == null ? en.dmg : dmg, en.boss);
    }
  }

  function fxBox() {
    return (typeof window !== 'undefined' && window.FX) || (typeof FX !== 'undefined' ? FX : null);
  }

  function telegraph(en, index, tellMs) {
    const box = fxBox();
    if (box && typeof box.telegraph === 'function') box.telegraph(en.id || index, en.x, en.y, tellMs);
  }

  function telegraphOff(en, index) {
    if (!en) return;
    const box = fxBox();
    if (box && typeof box.telegraphOff === 'function') box.telegraphOff(en.id || index);
  }

  function fxSpawn(x, y) {
    const box = fxBox();
    if (box && typeof box.spawn === 'function') box.spawn(x, y);
  }

  function pushChat(text, color) {
    if (!text) return;
    chatLog.push({ text: text, color: color || '#f4efe0', t: time });
    if (chatLog.length > 6) chatLog.shift();
    const host = $('sv-chat');
    if (!host) return;
    const line = document.createElement('p');
    line.textContent = text;
    line.style.color = color || '#f4efe0';
    host.appendChild(line);
    while (host.childNodes && host.childNodes.length > 6) host.removeChild(host.firstChild);
  }

  function announceItem(item, x, y) {
    if (!item) return;
    let rarity = 'Common';
    try { rarity = SurvivorSave.rarityName(item.rarity); } catch (e) {
      const raw = item.rarity || 'common';
      rarity = raw.charAt(0).toUpperCase() + raw.slice(1);
    }
    showToast(item);
    pushChat('You find: ' + rarity + ' ' + (item.name || 'Item'), RARITY_FILL[item.rarity] || '#f4efe0');
    if (item.id != null && rareBeam(item.rarity)) beamFx(item.id, x, y, item.rarity);
  }

  function sweptHit(x0, y0, x1, y1, tx, ty, rad) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const fx = tx - x0;
    const fy = ty - y0;
    const span = dx * dx + dy * dy;
    let t = 0;
    if (span > 1e-8) t = Math.max(0, Math.min(1, (fx * dx + fy * dy) / span));
    const px = x0 + dx * t - tx;
    const py = y0 + dy * t - ty;
    return px * px + py * py <= rad * rad;
  }

  function viewEdge(ang, outside, minDist) {
    const pad = outside ? 0.55 : -0.2;
    const halfW = Math.max(BALANCE.minSpawn, viewHalfW() + pad);
    const halfH = Math.max(BALANCE.minSpawn, viewHalfH() + pad);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const fit = 1 / Math.max(Math.abs(c) / halfW, Math.abs(s) / halfH);
    let x = player.x + c * fit;
    let y = player.y + s * fit;
    const dx = x - player.x;
    const dy = y - player.y;
    const dist = len2(dx, dy);
    const need = minDist == null ? BALANCE.minSpawn : minDist;
    if (dist < need) {
      const k = need / (dist || 1);
      x = player.x + dx * k;
      y = player.y + dy * k;
    }
    spotScratch.x = x;
    spotScratch.y = y;
    return spotScratch;
  }

  function aheadAngle(wide) {
    const head = Math.atan2(headY, headX);
    const arcDeg = wide ? (90 + Math.random() * 50) : (100 + Math.random() * 40);
    const arc = arcDeg * Math.PI / 180;
    return head + (Math.random() - 0.5) * arc;
  }

  function breakDemonShield(en) {
    if (!en) return;
    const early = en.shieldT > 0.05;
    en.shieldT = 0;
    en.shieldLive = false;
    if (early) shieldEarly += 1;
    const box = fxBox();
    if (box && typeof box.shieldBreak === 'function') box.shieldBreak(en.fid);
  }

  function onShieldAddDead(demonFid) {
    let demon = null;
    let alive = 0;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (en.bossKind === 'demon' && en.fid === demonFid) demon = en;
      if (en.shieldAdd === demonFid && en.life > 0 && !(en.dying > 0)) alive += 1;
    }
    if (demon && demon.shieldT > 0 && alive === 0) breakDemonShield(demon);
  }

  function spawnAddRing(en) {
    const count = 8;
    const dist = Math.max(BALANCE.minSpawn, 3.2);
    let sx = 0;
    let sy = 0;
    en.shieldAdds = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const x = player.x + Math.cos(ang) * dist;
      const y = player.y + Math.sin(ang) * dist;
      const add = spawnEnemy(i % 2 ? 'imp' : 'skel', x, y);
      if (!add) continue;
      add.shieldAdd = en.fid;
      add.maxLife = Math.max(add.maxLife, 90);
      add.life = add.maxLife;
      en.shieldAdds.push(add.fid);
      sx += x;
      sy += y;
    }
    fxSpawn(sx / count, sy / count);
  }

  function startDemonShield(en) {
    if (!en || en.shieldUsed) return;
    en.shieldUsed = true;
    en.shieldLive = true;
    en.shieldT = BALANCE.demonShield;
    shieldSeen += 1;
    const box = fxBox();
    const rad = (en.radius || 0.8) + 0.9;
    if (box && typeof box.shield === 'function') box.shield(en.fid, en.x, en.y, rad, en.shieldT * 1000);
    spawnAddRing(en);
  }

  function tickDemonShield(en, dt) {
    if (!en || !(en.shieldT > 0)) return;
    en.shieldT -= dt;
    let alive = 0;
    for (let i = 0; i < enemies.length; i++) {
      const other = enemies[i];
      if (other.shieldAdd === en.fid && other.life > 0 && !(other.dying > 0)) alive += 1;
    }
    if (en.shieldAdds && en.shieldAdds.length && alive === 0) {
      breakDemonShield(en);
      return;
    }
    if (en.shieldT <= 0) breakDemonShield(en);
  }

  function applyDemonFrac(en) {
    if (!en || en.bossKind !== 'demon' || !(demonHpFrac >= 0)) return;
    en.life = Math.max(1, Math.round(en.maxLife * demonHpFrac));
    if (en.life <= en.maxLife * 0.5) startDemonShield(en);
  }

  function tickCharger(en, dt) {
    const ai = en.ai;
    const dx = player.x - en.x;
    const dy = player.y - en.y;
    const dist = len2(dx, dy) || 1;
    if (ai.mode === 'seek') {
      if (player.moving && dist < 2.3) {
        en.x -= (dx / dist) * en.speed * dt;
        en.y -= (dy / dist) * en.speed * dt;
        en.facing = dx >= 0 ? 1 : -1;
      } else {
        steer(en, dt, en.speed);
        if (dist < 4.6 && dist > 2.2) {
          ai.mode = 'tell';
          ai.t = 0.6;
          ai.vx = dx / dist;
          ai.vy = dy / dist;
        }
      }
    } else if (ai.mode === 'tell') {
      ai.t -= dt;
      en.facing = dx >= 0 ? 1 : -1;
      if (ai.t <= 0) {
        const look = 0.28;
        const px = player.x + velX * look;
        const py = player.y + velY * look;
        const lx = px - en.x;
        const ly = py - en.y;
        const ld = len2(lx, ly) || 1;
        ai.vx = lx / ld;
        ai.vy = ly / ld;
        ai.mode = 'dash';
        ai.t = 0.38;
      }
    } else if (ai.mode === 'dash') {
      ai.t -= dt;
      const x0 = en.x;
      const y0 = en.y;
      en.x += ai.vx * 8.2 * dt;
      en.y += ai.vy * 8.2 * dt;
      en.facing = ai.vx >= 0 ? 1 : -1;
      const hitR = player.moving ? en.radius + 0.12 : en.radius + 0.5;
      const hit = sweptHit(x0, y0, en.x, en.y, player.x, player.y, hitR);
      if (hit && en.touchCd <= 0) {
        en.touchCd = 0.8;
        lastHit = 'dash';
        hurt(player.moving ? 4 : en.dmg + 3, false);
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

  function tickShooter(en, dt, index) {
    const ai = en.ai;
    const dx = player.x - en.x;
    const dy = player.y - en.y;
    const dist = len2(dx, dy) || 1;
    en.facing = dx >= 0 ? 1 : -1;
    if (ai.mode === 'tell') {
      ai.t -= dt;
      if (ai.t <= 0) {
        const sp = 2.7;
        const shot = 5 + lateT() * (BALANCE.lateShot - 5);
        spawnFoeShot(en.x, en.y, (dx / dist) * sp, (dy / dist) * sp, shot);
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
      telegraph(en, index, 700);
    }
  }

  function steerAway(en, dt, dx, dy, dist) {
    en.x -= (dx / dist) * en.speed * dt;
    en.y -= (dy / dist) * en.speed * dt;
  }

  function tickBoss(en, dt, index) {
    const ai = en.ai;
    const dx = player.x - en.x;
    const dy = player.y - en.y;
    const dist = len2(dx, dy) || 1;
    en.facing = dx >= 0 ? 1 : -1;
    if (en.bossKind === 'demon') tickDemonShield(en, dt);
    if (ai.mode === 'tell') {
      ai.t -= dt;
      if (ai.t <= 0) {
        if (ai.kind === 'slam') {
          if (dist < 2.15) {
            lastHit = 'boss';
            hurt(en.dmg + 6, true);
          }
          ai.mode = 'recover';
          ai.t = 1.1;
        } else {
          const base = Math.atan2(dy, dx);
          const volley = en.bossKind === 'warden' ? 5 : 7;
          for (let i = -1; i <= 1; i++) {
            const ang = base + i * 0.32;
            spawnFoeShot(en.x, en.y, Math.cos(ang) * 3.1, Math.sin(ang) * 3.1, volley);
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
      if (ai.kind === 'volley') telegraph(en, index, 550);
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
      else if (en.behaviour === 'shooter') tickShooter(en, dt, i);
      else if (en.behaviour === 'boss') {
        tickBoss(en, dt, i);
        leashBoss(en, dt);
      }
      else {
        const dx = player.x - en.x;
        const dy = player.y - en.y;
        const dist = len2(dx, dy) || 1;
        let sp = en.speed;
        if (en.elite) {
          en.ai.t = (en.ai.t || 0) + dt;
          if (en.ai.t > 2.2) en.ai.t = 0;
          if (en.ai.t < 0.45) sp *= 1.85;
        } else if (time > 75 && enemies.length > 70 && dist < Math.max(viewHalfW(), viewHalfH())) {
          sp *= 0.2;
        }
        const stand = (en.radius || 0.32) + (en.elite ? 0.2 : 0.72);
        if (player.moving && !en.elite && dist < stand) {
          const push = Math.min(stand - dist, sp * dt * 4);
          en.x -= (dx / dist) * push;
          en.y -= (dy / dist) * push;
        } else {
          en.x += (dx / dist) * sp * dt;
          en.y += (dy / dist) * sp * dt;
        }
        en.facing = dx >= 0 ? 1 : -1;
        touchPlayer(en, len2(player.x - en.x, player.y - en.y), en.dmg, dt);
      }
    }
  }

  function releaseGemAt(i) {
    const g = gems[i];
    if (g && g.kind === 'item' && g.item) beamOff(g.item.id);
    if (g && g.shower) {
      g.shower = 0;
      showerLeft = Math.max(0, showerLeft - 1);
    }
    const last = gems.pop();
    if (i < gems.length) gems[i] = last;
    g.fly = 0;
    g.vx = 0;
    g.vy = 0;
    g.item = null;
    g.kind = 'gem';
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
    maintainGround(dt);
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if ((g.kind || 'gem') === 'gem' && !g.fly) g.age = (g.age || 0) + dt;
    }
    mergeOldGems();
    const pull = magnetR();
    const grab = pickupR();
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const kind = g.kind || 'gem';
      if (kind === 'food') {
        g.age = (g.age || 0) + dt;
        if ((g.age || 0) >= BALANCE.foodLife) {
          releaseGemAt(i);
          continue;
        }
      }
      const walked = kind === 'chest' || kind === 'item' || kind === 'heart' || kind === 'food';
      const dx = player.x - g.x;
      const dy = player.y - g.y;
      const dist = len2(dx, dy);
      if (!walked) {
        if (g.shower && time < (g.showerAt || 0)) {
          /* stagger the vacuum */
        } else if (dist < pull || g.shower) g.fly = 1;
        if (g.fly && dist > 0) {
          const rush = g.shower ? Math.max(18, dist / 0.55) : (14 + (owned.magnet || 0) * 4);
          const step = Math.min(dist, rush * dt);
          g.x += (dx / dist) * step;
          g.y += (dy / dist) * step;
        }
      }
      const left = len2(player.x - g.x, player.y - g.y);
      const taken = walked ? left <= grab : (left <= grab || (g.fly && left < 0.08));
      if (taken) {
        if (kind === 'heart') {
          player.life = Math.min(player.maxLife, player.life + 16);
        } else if (kind === 'chest') {
          openChest(g.x, g.y, chestItem(), g.withFood);
        } else if (kind === 'food') {
          const gain = player.maxLife * 0.25;
          player.life = Math.min(player.maxLife, player.life + gain);
          foodEaten += 1;
          pushChat('You eat the roast meat.', '#e6c15a');
          const box = fxBox();
          if (box && typeof box.pickup === 'function') box.pickup(player.x, player.y, 'gem', { chain: 0 });
        } else if (kind === 'item' && g.item) {
          try { SurvivorSave.addItem(g.item); } catch (e) {}
          showToast(g.item);
          requestEvolution();
          const info = chainInfo;
          info.rarity = g.item.rarity;
          fxCall('pickup', g.x, g.y, 'item', info);
        } else {
          grantXp(g.value || 0);
        }
        if (kind !== 'chest' && kind !== 'food') spark(player.x, player.y, '#ffffff', 3, 2.6);
        if (kind === 'gem') {
          chainInfo.chain = bumpGemChain();
          fxCall('pickup', g.x, g.y, 'gem', chainInfo);
        } else if (kind !== 'item' && kind !== 'chest') {
          fxCall('pickup', g.x, g.y, kind);
        }
        releaseGemAt(i);
        if (time - lootSnd > 0.07) {
          lootSnd = time;
          sfx('loot');
        }
      }
    }
  }

  function levelRadius() {
    const box = typeof FX !== 'undefined' ? FX : null;
    const art = (box && box.LEVELUP_RADIUS) || 48;
    return art / ART;
  }

  function levelBlast() {
    const rad = levelRadius();
    const rad2 = rad * rad;
    const gate = boltDamage();
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (!en || en.life <= 0 || en.dying > 0) continue;
      const dx = en.x - player.x;
      const dy = en.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > rad2) continue;
      if (!en.boss && !en.elite && en.life <= gate) damageEnemy(en, en.life + 1, true);
      else {
        const d = Math.sqrt(d2) || 1;
        en.kx += (dx / d) * 7;
        en.ky += (dy / d) * 7;
      }
    }
    const art = (typeof FX !== 'undefined' && FX.LEVELUP_RADIUS) || 48;
    if (typeof FX !== 'undefined' && typeof FX.levelUp === 'function') FX.levelUp(player.x, player.y, { radius: art });
    else fxCall('levelUp');
    if (effectOn('magnet')) {
      for (let i = 0; i < gems.length; i++) if ((gems[i].kind || 'gem') === 'gem') gems[i].fly = 1;
    }
  }

  function bankLevels() {
    if (bench || state === 'dead' || state === 'won') return;
    let guard = 0;
    while (guard++ < 8 && player.xp >= SurvivorData.xpToNext(player.level)) {
      player.xp -= SurvivorData.xpToNext(player.level);
      player.level += 1;
      levelUps += 1;
      pendingLevels += 1;
    }
  }

  function holdCards() {
    return sweepOn || showerLeft > 0;
  }

  function tryShowLevel() {
    if (bench || state !== 'playing') return;
    if (holdCards()) return;
    if (evoSlow > 0 || evolvePending) return;
    if (hasQueuedEvo()) {
      applyQueuedEvolutions();
      return;
    }
    if (pendingLevels <= 0) return;
    levelBlast();
    bankLevels();
    openLevel();
  }

  function hasQueuedEvo() {
    const weapons = SurvivorData.WEAPONS;
    for (let i = 0; i < weapons.length; i++) {
      if (evoQueued[weapons[i].id]) return true;
    }
    return false;
  }

  function screenEdgeArt() {
    const halfW = canvas.width / (2 * Math.max(1, zoom));
    const halfH = canvas.height / (2 * Math.max(1, zoom));
    return len2(halfW, halfH);
  }

  function beginSweep(id) {
    sweepGen += 1;
    sweepOn = true;
    sweepT = 0;
    sweepPrev = 0;
    sweepMax = screenEdgeArt();
    sweepKills = 0;
    if (!reduceMotion) slowLeft = Math.max(slowLeft, 0.5);
    evoWindow = true;
    sweepInfo.x = player.x;
    sweepInfo.y = player.y;
    sweepInfo.radius = sweepMax;
    if (typeof FX !== 'undefined' && typeof FX.evolve === 'function') FX.evolve(id || 'storm', sweepInfo);
    else fxCall('evolve', id || 'storm');
  }

  function damageSweep(cx, cy, prevArt, nowArt) {
    const prev = prevArt / ART;
    const now = nowArt / ART;
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (!en || en.life <= 0 || en.dying > 0 || en.sweepGen === sweepGen) continue;
      const dx = en.x - cx;
      const dy = en.y - cy;
      const d = len2(dx, dy);
      if (d > now) continue;
      if (prev > 0 && d <= prev) continue;
      en.sweepGen = sweepGen;
      if (en.boss) damageEnemy(en, en.maxLife * 0.08);
      else if (en.elite) damageEnemy(en, en.maxLife * 0.3);
      else damageEnemy(en, en.life + 1);
    }
  }

  function markShowerGem(g) {
    if (!g || g.shower || (g.kind && g.kind !== 'gem')) return;
    g.shower = 1;
    g.showerAt = time + (showerLeft % 6) * 0.03;
    g.fly = 0;
    showerLeft += 1;
  }

  function startShower() {
    const maxT = sweepMax / ART + 0.4;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if ((g.kind || 'gem') !== 'gem') continue;
      const dx = g.x - player.x;
      const dy = g.y - player.y;
      if (dx * dx + dy * dy > maxT * maxT) continue;
      markShowerGem(g);
    }
  }

  function tickSweep(dt) {
    if (!sweepOn) return;
    const fx = typeof FX !== 'undefined' ? FX : null;
    let radius = -1;
    let cx = player.x;
    let cy = player.y;
    if (fx && typeof fx.sweepRadius === 'function' && typeof fx.sweepCenter === 'function') {
      radius = fx.sweepRadius();
      if (radius >= 0) {
        const c = fx.sweepCenter();
        if (c) { cx = c.x; cy = c.y; }
        damageSweep(cx, cy, sweepPrev, radius);
        sweepPrev = radius;
        sweepT += dt;
        return;
      }
      if (sweepT > 0) {
        finishSweep();
        return;
      }
    }
    sweepT += dt;
    radius = sweepMax * Math.min(1, sweepT / 0.4);
    damageSweep(player.x, player.y, sweepPrev, radius);
    sweepPrev = radius;
    if (sweepT >= 0.4) finishSweep();
  }

  function finishSweep() {
    sweepOn = false;
    startShower();
  }

  function checkLevel() {
    bankLevels();
    tryShowLevel();
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
    evoWindow = slowLeft > 0 || sweepOn || showerLeft > 0;
    if (hitPause > 0) {
      hitPause = Math.max(0, hitPause - dt);
      animT += dt;
      fxCall('update', dt);
      evoWindow = false;
      return;
    }
    if (state === 'playing' && (evoHold || time >= evoPollAt)) {
      if (time >= evoPollAt) evoPollAt = time + 1;
      evoHold = false;
      checkEvolutions();
    }
    let step = dt;
    if (evoSlow > 0 && state === 'playing' && !reduceMotion) {
      evoWindow = true;
      step = dt * BALANCE.evoScale;
      evoSlow = Math.max(0, evoSlow - dt);
    }
    dt = step;
    time += dt;
    if (stillBite > 0) stillBite = Math.max(0, stillBite - dt);
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
    tickIdleChip();
    if (state !== 'playing') return;
    rebuildGrid();
    tickWeapons(dt);
    tickShots(dt);
    tickEnemies(dt);
    tickFoeShots(dt);
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
      if (f.life <= 0) {
        floatPool.push(f);
        const last = floats.pop();
        if (last !== f) floats[i] = last;
      } else f.y -= dt * 0.95;
    }
    if (hermit.on && !hermit.used && len2(player.x - hermit.x, player.y - hermit.y) < 1.25) {
      openHermit();
      return;
    }
    if (evolvePending && evoSlow <= 0 && state === 'playing') {
      const evolvedId = evolvePending;
      evolvePending = '';
      commitEvolve(evolvedId);
    }
    tickSweep(dt);
    if (toastT > 0) {
      toastT = Math.max(0, toastT - dt);
      if (toastT <= 0) {
        const toast = $('sv-toast');
        if (toast) toast.classList.add('hidden');
      }
    }
    evoWindow = slowLeft > 0 || sweepOn || showerLeft > 0;
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
    if (!steered && walkKite) {
      const aim = kiteVector();
      sx = aim.x;
      sy = aim.y;
      steered = true;
    }
    if (!steered && walkCircle) {
      const radius = pxToWorld(120);
      let omega = Math.PI * 2 / 8;
      const need = radius * omega;
      const cap = moveSpeed() * 0.82;
      if (need > cap && radius > 0) omega = cap / radius;
      const ang = time * omega;
      sx = Math.cos(ang) * radius - player.x;
      sy = Math.sin(ang) * radius - player.y;
      if (len2(sx, sy) < 0.08) {
        player.moving = true;
        stillT = 0;
        return;
      }
    }
    if (sx === 0 && sy === 0) {
      player.moving = false;
      stillT += dt;
      return;
    }
    player.moving = true;
    stillT = 0;
    const len = len2(sx, sy) || 1;
    const sp = moveSpeed();
    player.x += (sx / len) * sp * dt;
    player.y += (sy / len) * sp * dt;
    if (sx !== 0) player.facing = sx > 0 ? 1 : -1;
  }

  function clearPools() {
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g && g.kind === 'item' && g.item) beamOff(g.item.id);
    }
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
    nextVowAt = scheduleFirstVow();
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
    evoSlow = 0;
    evoHold = false;
    evoIgnoreClock = false;
    evoPollAt = 1;
    evolvePending = '';
    evolveQueue.length = 0;
    slowLeft = 0;
    sweepOn = false;
    sweepT = 0;
    showerLeft = 0;
    pendingLevels = 0;
    hitPause = 0;
    stillT = 0;
    stillBite = 0;
    ringAcc = 0;
    nextEliteAt = BALANCE.eliteFirst;
    itemDrops = 0;
    rareAt = -1;
    epicAt = -1;
    legendAt = -1;
    legendDrops = 0;
    demonLegend = false;
    eliteN = 0;
    rareSeen = false;
    epicSeen = false;
    evoWindow = false;
    toastT = 0;
    toastText = '';
    castersCleared = 0;
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
      for (let i = 0; i < benchFoes; i++) {
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
    nextVowAt = forceVow ? vowSpec().earliest : Math.max(vowSpec().earliest, time + 80);
    nextEliteAt = time + BALANCE.eliteEvery;
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
    plantPendingCasters();
    if (time >= 295) {
      eliteWarned = true;
      eliteSpawned = true;
      wardenCleared = true;
      demonWarned = true;
      boss5 = true;
      raiseBanner('Risen Demon approaches', true);
      bannerT = 2.4;
      const spot = spawnBossEdge();
      const demon = spawnEnemy('brute', spot.x, spot.y, { bossKind: 'demon', name: 'Risen Demon' });
      applyDemonFrac(demon);
    } else if (time >= 148) {
      eliteWarned = true;
      eliteSpawned = true;
      raiseBanner('Grave Warden approaches', true);
      bannerT = 2.4;
      spawnWarden();
    }
  }

  function plantPendingCasters() {
    const n = casterPlant;
    casterPlant = 0;
    for (let i = 0; i < n; i++) {
      const ang = (i / Math.max(1, n)) * Math.PI * 2;
      spawnEnemy('shooter', player.x + Math.cos(ang) * 3.2, player.y + Math.sin(ang) * 3.2);
    }
    return n;
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
    uiGesture = 0;
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
    if (res.ok) {
      paintNextOffer();
      requestEvolution();
    }
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
    state = 'levelup';
    joy.on = false;
    uiGuardUntil = nowMs() + 300;
    uiGesture = 0;
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
      const pendingN = Math.max(pendingLevels, 1);
      box.setAttribute('data-pending', String(pendingN));
      if (typeof FX !== 'undefined' && typeof FX.pending === 'function') FX.pending(pendingN);
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

  function evoTitle(id) {
    const table = SurvivorData.EVOLUTIONS || {};
    const keys = Object.keys(table);
    for (let i = 0; i < keys.length; i++) {
      const row = table[keys[i]];
      if (row && row.id === id && row.name) return row.name;
    }
    return 'Evolved';
  }

  function commitEvolve(id) {
    player.invuln = Math.max(player.invuln, 0.5);
    evoLog.push({ id: id, t: time, tick: simTick });
    raiseBanner(evoTitle(id), true);
    if (!sweepOn) beginSweep(id);
    else if (typeof FX !== 'undefined' && typeof FX.evolve === 'function') {
      sweepInfo.x = player.x;
      sweepInfo.y = player.y;
      sweepInfo.radius = sweepMax;
      FX.evolve(id, sweepInfo);
    }
    if (evolveQueue.length) beginEvolve();
  }

  function beginEvolve() {
    if (evolvePending || evoSlow > 0) return;
    const id = evolveQueue.shift();
    if (!id) return;
    if (state !== 'playing') {
      evolveQueue.unshift(id);
      evoHold = true;
      return;
    }
    if (reduceMotion) {
      commitEvolve(id);
      return;
    }
    evolvePending = id;
    evoSlow = BALANCE.evoSlow;
    evoWindow = true;
    raiseBanner(evoTitle(id), true);
  }

  function grantEvolve(id) {
    evolveQueue.push(id);
    beginEvolve();
  }

  function releaseEvolution() {
    if (state !== 'playing') return;
    if (!evoHold) return;
    evoHold = false;
    checkEvolutions();
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
    requestEvolution();
  }

  function evoWeaponId(item) {
    if (!item) return '';
    if (item.evolvesWith) return item.id;
    return item.evolveOf || '';
  }

  function catalogItem(id) {
    const list = SurvivorData.CATALOG;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function evoHint(item) {
    const evo = SurvivorData.evolutionFor(item.id);
    if (!evo || !(item.evolveName || item.evolveOf || item.evolvesWith)) return '';
    const weaponId = evoWeaponId(item);
    if (!weaponId || evolved[weaponId]) return '';
    const weapon = catalogItem(weaponId);
    const partnerId = weapon && weapon.evolvesWith;
    const partner = partnerId ? catalogItem(partnerId) : null;
    const weaponReady = (owned[weaponId] || 0) >= (weapon ? weapon.maxLevel : 5);
    const partnerReady = !!(partnerId && (owned[partnerId] || 0) > 0);
    if (weaponReady && partnerReady) return 'Ready';
    if (!partnerReady && partner) return 'Needs: ' + partner.name;
    if (!weaponReady && weapon) return 'Needs: ' + weapon.name;
    return 'Ready';
  }

  function chestItem() {
    const bases = ['iron-blade', 'bone-charm', 'ash-bead'];
    const base = bases[spawnSerial % bases.length];
    try { return SurvivorSave.createItem(base, 'rare'); } catch (e) {}
    return { id: 'chest-' + spawnSerial, base: base, name: 'Iron Blade', rarity: 'rare' };
  }

  // Single open hook. A later FX.chestOpen(x, y, rarity, onLand) roll can wrap this.
  function openChest(x, y, item, withFood) {
    const rarity = (item && item.rarity) || 'rare';
    const color = RARITY_FILL[rarity] || '#4c7cff';
    const box = (typeof window !== 'undefined' && window.FX) || (typeof FX !== 'undefined' ? FX : null);
    if (box && typeof box.kill === 'function') box.kill(x, y, 'chest', { elite: true, color: color });
    grantGold(40 * vowMult());
    if (item) placePickup(x + 0.62, y, 'item', item);
    if (withFood) placePickup(x - 0.75, y, 'food', null);
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

  function requestEvolution() {
    if (state !== 'playing') {
      evoHold = true;
      return;
    }
    checkEvolutions();
  }

  function evoRanksReady(w) {
    if (!w || !w.evolvesWith || evolved[w.id]) return false;
    const needRank = BALANCE.evoRank || w.maxLevel;
    const needPartner = BALANCE.evoPartner || 1;
    return (owned[w.id] || 0) >= needRank && (owned[w.evolvesWith] || 0) >= needPartner;
  }

  function checkEvolutions() {
    if (state !== 'playing') {
      evoHold = true;
      return;
    }
    const weapons = SurvivorData.WEAPONS;
    let waitingClock = false;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      if (!evoRanksReady(w)) continue;
      if (!evoIgnoreClock && time < BALANCE.evoAt) {
        waitingClock = true;
        continue;
      }
      evolved[w.id] = w.evolvesWith;
      evoQueued[w.id] = false;
      const evo = SurvivorData.evolutionFor(w.id);
      grantEvolve(evo ? evo.id : w.id);
    }
    if (waitingClock) evoHold = true;
  }

  function kitePickIndex() {
    const ids = offers.map((item) => item.id);
    const order = [];
    if ((owned.orbit || 0) < 5) order.push('orbit');
    if ((owned.orbit || 0) >= 3 && (owned.tempo || 0) < (BALANCE.evoPartner || 1)) order.push('tempo');
    if ((owned.tempo || 0) > 0 && (owned.orbit || 0) < 5) order.push('orbit');
    order.push('bolt', 'might', 'vitality', 'pierce', 'haste', 'armor', 'nova', 'area');
    if ((owned.nova || 0) >= 5 && !(owned.cinder > 0)) order.push('cinder');
    if ((owned.cinder || 0) > 0 && (owned.nova || 0) < 5) order.push('nova');
    if (player.life < player.maxLife * 0.28) order.unshift('heal');
    let pick = 0;
    for (let p = 0; p < order.length; p++) {
      const at = ids.indexOf(order[p]);
      if (at >= 0) { pick = at; break; }
    }
    return pick;
  }

  function kiteResolve() {
    if (!walkKite) return;
    if (state === 'hermit') {
      declineHermit();
      return;
    }
    if (state === 'levelup') {
      uiGuardUntil = 0;
      choose(kitePickIndex());
    }
  }

  function kiteDanger(en) {
    return !!(en && (en.boss || en.elite || en.eid === 'shooter' || en.eid === 'charger'));
  }

  function kiteVector() {
    nearbyFill(player.x, player.y, 9);
    let cx = 0;
    let cy = 0;
    let wsum = 0;
    let nearest = 99;
    for (let n = 0; n < nearCount; n++) {
      const en = nearList[n];
      if (!kiteDanger(en) || en.life <= 0 || en.dying > 0) continue;
      const dx = en.x - player.x;
      const dy = en.y - player.y;
      const dist = len2(dx, dy) || 0.01;
      if (dist < nearest) nearest = dist;
      const weight = en.boss ? 8 : (en.eid === 'shooter' ? 5 : (en.elite ? 4 : 2));
      cx += en.x * weight;
      cy += en.y * weight;
      wsum += weight;
    }
    let sx = 1;
    let sy = 0;
    if (wsum > 0) {
      const ax = player.x - cx / wsum;
      const ay = player.y - cy / wsum;
      const ad = len2(ax, ay) || 1;
      const prefer = 6.2;
      sx = (ax / ad) * (prefer - ad) * 0.85;
      sy = (ay / ad) * (prefer - ad) * 0.85;
      sx += (-ay / ad) * 1.35;
      sy += (ax / ad) * 1.35;
    }
    for (let i = 0; i < foeShots.length; i++) {
      const shot = foeShots[i];
      const dx = shot.x - player.x;
      const dy = shot.y - player.y;
      if (len2(dx, dy) > 3.2) continue;
      const sp = len2(shot.vx, shot.vy) || 1;
      sx += (-shot.vy / sp) * 2.4;
      sy += (shot.vx / sp) * 2.4;
    }
    if (nearest > 4.2) {
      let best = 5.5;
      let gx = 0;
      let gy = 0;
      for (let i = 0; i < gems.length; i++) {
        const gem = gems[i];
        if (!gem || gem.kind === 'chest') continue;
        const dx = gem.x - player.x;
        const dy = gem.y - player.y;
        const dist = len2(dx, dy);
        if (dist < best && dist > 0.35) {
          best = dist;
          gx = dx;
          gy = dy;
        }
      }
      if (best < 5.5) {
        sx += gx;
        sy += gy;
      }
    }
    return { x: sx, y: sy };
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
    if (pendingLevels > 0) pendingLevels -= 1;
    if (pendingLevels > 0) {
      openLevel();
      return;
    }
    state = 'playing';
    sfx('ui');
    releaseEvolution();
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
    uiGesture = 0;
    paintHermitCard();
    show('sv-hermit');
    sfx('talk');
  }

  function acceptHermit() {
    hide('sv-hermit');
    curse = vowSpec().duration;
    vowPayout = true;
    state = 'playing';
    releaseEvolution();
    vowCount += 1;
    vowActive = true;
    nextVowAt = time + 150;
    try { SurvivorSprites.setFloorVow(vowCount); } catch (e) {}
    fxCall('vow', vowCount);
    syncVowChrome();
  }

  let vowSecShown = -1;
  let vowMarkReady = false;

  function drawVowMark(canvas) {
    const g = canvas.getContext('2d');
    if (!g) return;
    canvas.width = 36;
    canvas.height = 36;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#24222a';
    g.fillRect(0, 0, 36, 36);
    g.fillStyle = '#9fb4c8';
    const cells = [
      1, 1, 2, 1, 3, 1,
      1, 2, 3, 2,
      1, 3, 3, 3,
      1, 4, 2, 4, 3, 4,
      7, 6, 8, 6, 9, 6,
      7, 7, 9, 7,
      7, 8, 9, 8,
      7, 9, 8, 9, 9, 9,
    ];
    for (let i = 0; i < cells.length; i += 2) {
      g.fillRect(cells[i] * 3, cells[i + 1] * 3, 3, 3);
    }
  }

  function mountVowBadge() {
    if (vowMarkReady) return;
    const badge = $('sv-vow-badge');
    if (!badge || !document.createElement) return;
    vowMarkReady = true;
    badge.textContent = '';
    if (badge.setAttribute) badge.setAttribute('aria-label', 'Vow');
    const canvas = document.createElement('canvas');
    drawVowMark(canvas);
    if (badge.appendChild) badge.appendChild(canvas);
    const img = document.createElement('img');
    img.alt = '';
    img.width = 12;
    img.height = 12;
    img.draggable = false;
    const showImage = () => {
      if (!(img.naturalWidth > 0)) return;
      if (canvas.parentNode && canvas.parentNode.removeChild) canvas.parentNode.removeChild(canvas);
      if (badge.appendChild) badge.appendChild(img);
    };
    if (img.addEventListener) img.addEventListener('load', showImage);
    img.src = 'assets/ui/vow_badge.png';
    if (img.complete && img.naturalWidth > 0) showImage();
  }

  function syncVowChrome() {
    const alive = state !== 'dead' && state !== 'won' && state !== 'title';
    const active = curse > 0 && alive;
    const marked = vowCount > 0 && alive;
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
      badge.classList.toggle('hidden', !marked);
      if (marked) mountVowBadge();
    }
  }

  function declineHermit() {
    hide('sv-hermit');
    hermitDeclines += 1;
    if (hermitDeclines >= 2) nextVowAt = 1e9;
    else nextVowAt = time + 75;
    state = 'playing';
    releaseEvolution();
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
    releaseEvolution();
  }

  function onHardwareBack() {
    if (state === 'paused') { resumePlay(); return; }
    if (state === 'playing') openPause();
  }

  function abandonToTitle() {
    state = 'title';
    joy.on = false;
    clearBossUi();
    syncVowChrome();
    hide('sv-pause');
    hide('sv-hud');
    hide('sv-end');
    show('sv-title');
  }

  function quitToTitle() {
    let ok = false;
    try { ok = window.confirm('Quit this run?'); } catch (e) { ok = false; }
    if (!ok) return;
    const app = capacitorApp();
    if (app && typeof app.exitApp === 'function') {
      try { app.exitApp(); return; } catch (e) {}
    }
    abandonToTitle();
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
      const text = bench
        ? (Math.round(fpsSmooth) + ' fps · ' + enemies.length + ' foes')
        : debugHudText();
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
    drawTypeLabel(en, x, y);
  }

  function foeTypeTag(en) {
    if (!en) return 'SKEL';
    if (en.bossKind === 'warden') return 'WARDEN';
    if (en.bossKind === 'demon' || en.boss) return 'DEMON';
    if (en.eid === 'shooter') return 'CASTER';
    if (en.eid === 'charger') return 'CHARGER';
    if (en.eid === 'brute') return 'BRUTE';
    if (en.eid === 'imp') return 'IMP';
    return 'SKEL';
  }

  function drawTypeLabel(en, x, y) {
    if (!debug || bench || !en || en.life <= 0 || en.dying > 0) return;
    const text = foeTypeTag(en);
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#140e0c';
    ctx.strokeText(text, x, y - 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y - 20);
    ctx.textBaseline = 'alphabetic';
  }

  function liveTypeCounts() {
    const c = { skel: 0, imp: 0, charger: 0, caster: 0, brute: 0, warden: 0, demon: 0 };
    for (let i = 0; i < enemies.length; i++) {
      const en = enemies[i];
      if (!en || en.life <= 0 || en.dying > 0) continue;
      if (en.bossKind === 'warden') c.warden += 1;
      else if (en.bossKind === 'demon' || en.boss) c.demon += 1;
      else if (en.eid === 'shooter') c.caster += 1;
      else if (en.eid === 'charger') c.charger += 1;
      else if (en.eid === 'brute') c.brute += 1;
      else if (en.eid === 'imp') c.imp += 1;
      else c.skel += 1;
    }
    return c;
  }

  function debugHudText() {
    const c = liveTypeCounts();
    return Math.round(fpsSmooth) + ' fps'
      + ' skel ' + c.skel
      + ' imp ' + c.imp
      + ' charger ' + c.charger
      + ' caster ' + c.caster
      + ' brute ' + c.brute
      + ' warden ' + c.warden
      + ' demon ' + c.demon
      + ' revival ' + revivalLeft;
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
    const rare = rarity === 'rare';
    const size = big ? 19 : rare ? 16 : 14;
    const left = Math.round(x - size / 2);
    const top = Math.round(y - size / 2);
    const fxBeam = typeof FX !== 'undefined' && typeof FX.beam === 'function';
    if (!fxBeam && (big || rare)) {
      const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(animT * Math.PI * 2 * 1.6));
      const column = rarity === 'legendary' ? '#f2f6ff' : rare ? '#4c7cff' : '#d0b4ff';
      const tall = big ? 46 : 28;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = column;
      ctx.shadowColor = rarity === 'legendary' ? '#7fb2ff88' : '#d0b4ff66';
      ctx.shadowBlur = 3;
      ctx.fillRect(x - 1, top - tall, rare ? 1 : 2, tall);
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
      const max = f.max || FLOAT_LIFE;
      const age = max - f.life;
      let scale = 1;
      if (age < 0.12) scale = 1.4 - 0.4 * (age / 0.12);
      if (f.crit) scale *= 1.5;
      const size = Math.round((f.big ? 28 : 15) * scale);
      let alpha = 1;
      if (f.life < 0.15) alpha = f.life > 0 ? f.life / 0.15 : 0;
      ctx.globalAlpha = alpha;
      ctx.font = floatFont(!!f.big, size);
      ctx.lineWidth = 1;
      ctx.strokeStyle = f.crit ? '#14120f' : '#140e0c';
      ctx.strokeText(f.text, fx, fy);
      ctx.fillStyle = f.crit ? '#ffffff' : f.color;
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
    let ox = canvas.width / 2 - player.x * TILE;
    let oy = canvas.height / 2 - player.y * TILE;
    if (typeof FX !== 'undefined' && typeof FX.shakeOffset === 'function') {
      const off = FX.shakeOffset();
      const sx = off.x;
      const sy = off.y;
      ox += sx * zoom;
      oy += sy * zoom;
    }
    camX = Math.round(ox);
    camY = Math.round(oy);
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
    for (let i = 0; i < gems.length; i++) drawGem(gems[i]);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    camInfo.x = camX;
    camInfo.y = camY;
    camInfo.zoom = zoom;
    if (typeof FX !== 'undefined' && FX && typeof FX.drawUnder === 'function') FX.drawUnder(ctx, camInfo);
    ctx.restore();
    drawFoes();
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

  function restoreDouble() {
    if (doubled) return;
    doubleLocked = false;
    const btn = $('sv-double');
    if (!btn) return;
    const offer = !!(adsOn && (state === 'dead' || state === 'won'));
    btn.disabled = !offer;
    btn.classList.toggle('hidden', !offer);
  }

  function handleAd(kind, reason) {
    if (kind === 'gold' && reason !== 'accept') {
      restoreDouble();
      return;
    }
    if (reason !== 'accept') return;
    if (kind === 'reroll' && state === 'levelup') rerollOffers();
    if (kind === 'revive' && state === 'dead' && !revived) revivePlayer();
    if (kind === 'gold' && (state === 'dead' || state === 'won')) applyDoubleGold();
  }

  function pressDouble() {
    if (doubleLocked || doubled) return 'locked';
    if (state !== 'dead' && state !== 'won') return 'closed';
    doubleLocked = true;
    const btn = $('sv-double');
    if (btn) btn.disabled = true;
    let offered = 'unavailable';
    try { offered = Ads.offerDoubleGold(); } catch (e) { offered = 'error'; }
    if (offered !== 'shown' && offered !== 'held' && offered !== 'queued') restoreDouble();
    return offered;
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
    function pressRestart(e) {
      if (!acceptPress(e)) return;
      track('survivor-restart');
      startRun();
    }
    $('sv-restart').addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      pressRestart(e);
    });
    $('sv-restart').addEventListener('click', (e) => pressRestart(e));
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
      if (tapBlocked()) return;
      pressDouble();
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
    function pressCard(e) {
      const btn = e.target && e.target.closest ? e.target.closest('[data-choice]') : null;
      if (!btn) return;
      if (!acceptPress(e)) return;
      choose(Number(btn.dataset.choice));
    }
    $('sv-cards').addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      pressCard(e);
    });
    $('sv-cards').addEventListener('click', (e) => pressCard(e));
    function pressHermit(e, yes) {
      if (!acceptPress(e)) return;
      if (yes) acceptHermit();
      else declineHermit();
    }
    $('sv-hermit-yes').addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      pressHermit(e, true);
    });
    $('sv-hermit-yes').addEventListener('click', (e) => pressHermit(e, true));
    $('sv-hermit-no').addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      pressHermit(e, false);
    });
    $('sv-hermit-no').addEventListener('click', (e) => pressHermit(e, false));

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
      Ads.onResult((kind, reason) => handleAd(kind, reason));
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
      window.__svOffers = () => offers.map((o) => o.id);
      window.__svChoose = (i) => { uiGuardUntil = 0; choose(i); return snapRun(); };
      window.__svDecline = () => { if (state === 'hermit') declineHermit(); return snapRun(); };
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
  function presentDt(wall) {
    if (reduceMotion || slowLeft <= 0) return wall;
    const scaled = wall * SLOW;
    slowLeft = Math.max(0, slowLeft - scaled);
    return scaled;
  }

  function frame(now) {
    const raw = last ? (now - last) / 1000 : 0.016;
    const wall = Math.min(0.05, raw);
    const dt = presentDt(wall);
    last = now;
    if (dt > 0) {
      const inst = 1 / dt;
      fpsSmooth = fpsSmooth ? fpsSmooth * 0.9 + inst * 0.1 : inst;
    }
    fxUpdateMs = 0;
    fxDrawMs = 0;
    if (bench && typeof performance !== 'undefined' && performance.memory) heapAt = performance.memory.usedJSHeapSize;
    const updateStart = nowMs();
    if (walkKite && (state === 'levelup' || state === 'hermit')) kiteResolve();
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
          if (evoWindow) cause = 'evo';
          else if (hitPause > 0) cause = 'pause';
          else if (work < gapMs * 0.45) cause = '?gc';
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
        const sw = (window.screen && window.screen.width) || canvas.width;
        const sh = (window.screen && window.screen.height) || canvas.height;
        const dpr = window.devicePixelRatio || 1;
        const causes = { spawn: 0, draw: 0, '?gc': 0, update: 0, evo: 0, pause: 0 };
        for (let i = 0; i < slowLog.length; i++) {
          const key = slowLog[i].cause;
          causes[key] = (causes[key] || 0) + 1;
        }
        const playSlow = Math.max(0, slow - (causes.evo || 0) - (causes.pause || 0));
        const slowPct = (playSlow / benchFrames.length) * 100;
        const slowLine = 'slow: ' + playSlow + ' — spawn ' + (causes.spawn || 0) + ', draw ' + (causes.draw || 0) + ', update ' + (causes.update || 0) + ', ?gc ' + (causes['?gc'] || 0) + ', evo ' + (causes.evo || 0) + ', pause ' + (causes.pause || 0);
        window.__fps = {
          avg, min, slow: playSlow, slowPct, evo: causes.evo || 0, pause: causes.pause || 0,
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
      vowBadge: vowCount > 0 && state !== 'dead' && state !== 'won' && state !== 'title',
      vowRisk: vowLines().risk,
      vowReward: vowLines().reward,
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
      sweepKills: sweepKills,
      pending: pendingLevels,
      drops: itemDrops,
      rareAt: rareAt,
      epicAt: epicAt,
      legendAt: legendAt,
      legendDrops: legendDrops,
      demonLegend: demonLegend,
      elites: eliteN,
      lastHit: lastHit,
      secondChance: secondChance,
      revivalLeft: revivalLeft,
      toast: toastText,
      doubleLocked: doubleLocked,
      evoHold: evoHold,
      evoSlow: evoSlow,
      evolving: evolvePending || '',
      castersCleared: castersCleared,
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
    window.__svSpawn = (id, x, y, kind) => {
      const opts = kind ? { bossKind: kind, name: kind === 'warden' ? 'Grave Warden' : 'Risen Demon' } : null;
      spawnEnemy(id || 'skel', x || player.x + 2, y || player.y, opts);
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
      if (walkKite && (state === 'levelup' || state === 'hermit')) kiteResolve();
      if (state === 'playing') sim(presentDt(Math.min(0.05, dt || 0.05)));
      return snapRun();
    };
    window.__svView = (w, h, dpr) => {
      if (canvas.parentElement) {
        canvas.parentElement.clientWidth = w;
        canvas.parentElement.clientHeight = h;
      }
      viewDprLock = dpr || 1;
      resize();
      return { w: canvas.width, h: canvas.height, zoom: zoom, tile: TILE };
    };
    window.__svOnScreen = () => {
      let n = 0;
      for (let i = 0; i < enemies.length; i++) {
        const en = enemies[i];
        if (en.life > 0 && en.dying <= 0 && onScreen(en)) n += 1;
      }
      return n;
    };
    window.__svBands = () => {
      const bands = [0, 0, 0, 0];
      for (let i = 0; i < enemies.length; i++) {
        const en = enemies[i];
        if (en.life <= 0 || en.dying > 0) continue;
        const d = len2(en.x - player.x, en.y - player.y);
        if (d < 3) bands[0] += 1;
        else if (d < 8) bands[1] += 1;
        else if (d < 16) bands[2] += 1;
        else bands[3] += 1;
      }
      return bands;
    };
    window.__svSeedItem = (rarity) => {
      let item = null;
      try { item = SurvivorSave.createItem('iron-blade', rarity || 'common'); } catch (e) { item = null; }
      if (!item) item = { id: 'item-' + gems.length, rarity: rarity || 'common', name: rarity || 'common' };
      const g = gemPool.pop() || {};
      g.x = player.x;
      g.y = player.y;
      g.kind = 'item';
      g.item = item;
      g.value = 0;
      g.vx = 0;
      g.vy = 0;
      g.fly = 0;
      g.age = 0;
      g.big = false;
      g.shower = 0;
      gems.push(g);
      if (rareBeam(item.rarity)) beamFx(item.id, g.x, g.y, item.rarity);
      return item.id;
    };
    window.__svGround = () => {
      const out = [];
      for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        if (g.kind !== 'item' || !g.item) continue;
        out.push({ id: g.item.id, rarity: g.item.rarity, name: g.item.name || '', age: g.age || 0, x: g.x, y: g.y });
      }
      return out;
    };
    window.__svMaintain = (dt) => {
      maintainGround(dt || 0);
      return window.__svGround();
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
    window.__svClock = (t) => { clockMs = t; return t; };
    window.__svPress = (which, type) => {
      const e = { type: type || 'click', button: 0, pointerId: 1 };
      if (!acceptPress(e)) return snapRun();
      if (which === 'card') choose(0);
      else if (which === 'restart') startRun();
      else if (which === 'hermit-yes') acceptHermit();
      else if (which === 'hermit-no') declineHermit();
      return snapRun();
    };
    window.__svHint = (id) => {
      const item = catalogItem(id);
      return item ? evoHint(item) : '';
    };
    window.__svOpenHermit = () => { openHermit(); return snapRun(); };
    window.__svPurse = () => {
      try { return SurvivorSave.gold(); } catch (e) { return -1; }
    };
    window.__svScales = () => {
      const out = [];
      for (let i = 0; i < enemies.length; i++) {
        const en = enemies[i];
        out.push({ name: en.name, boss: !!en.boss, scale: en.scale, radius: en.radius, kind: en.bossKind || '' });
      }
      return out;
    };
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
        pendingLevels = 0;
        state = 'playing';
        releaseEvolution();
      }
      if (state === 'hermit') declineHermit();
      return snapRun();
    };
    window.__svPause = () => { openPause(); return snapRun(); };
    window.__svResume = () => { resumePlay(); return snapRun(); };
    window.__svReduce = (on) => { reduceMotion = !!on; syncReducedMotion(!!on); return snapRun(); };
    window.__svAd = (kind, reason) => { handleAd(kind, reason || 'dismiss'); return snapRun(); };
    window.__svPressDouble = () => pressDouble();
    window.__svRestart = () => { startRun(); return snapRun(); };
    window.__svMenu = () => { abandonToTitle(); return snapRun(); };
    window.__svPlantCasters = (n) => { casterPlant = Math.max(0, n | 0); return casterPlant; };
    window.__svSetTime = (t) => { time = t; return snapRun(); };
    window.__svDebugLine = () => debugHudText();
    window.__svTags = () => {
      const out = [];
      for (let i = 0; i < enemies.length; i++) {
        const en = enemies[i];
        if (!en || en.life <= 0 || en.dying > 0) continue;
        out.push(foeTypeTag(en));
      }
      return out;
    };
    window.__svSlay = (kind) => {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const en = enemies[i];
        if (kind && en.bossKind !== kind && en.eid !== kind) continue;
        damageEnemy(en, (en.life || 1) + 8, true);
      }
      return snapRun();
    };
    window.__svForceEvos = () => {
      owned.orbit = 5;
      owned.nova = 5;
      owned.tempo = 1;
      owned.cinder = 1;
      evoIgnoreClock = true;
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
      if (trash.life < 30) {
        trash.maxLife = 40;
        trash.life = 40;
      }
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
    SurvivorSprites.load('assets/0x72/dungeon-tileset-ii.png?v=6.1');
    mountVowBadge();
    if (bench || previewOnce) startRun();
    requestAnimationFrame(frame);
  }
})();
