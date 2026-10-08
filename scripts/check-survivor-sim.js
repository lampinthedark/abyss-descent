'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function fakeCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      const fn = () => fakeCtx();
      target[prop] = fn;
      return fn;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function memoryStorage() {
  const bag = Object.create(null);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(bag, k) ? bag[k] : null; },
    setItem(k, v) { bag[k] = String(v); },
    removeItem(k) { delete bag[k]; },
  };
}

function fakeDocument() {
  const ctx = fakeCtx();
  function el() {
    return {
      classList: {
        add() {}, remove() {}, toggle() {}, contains() { return false; },
      },
      style: {},
      dataset: {},
      textContent: '',
      innerHTML: '',
      disabled: false,
      className: '',
      width: 1100,
      height: 800,
      appendChild() {},
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      getAttribute() { return ''; },
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getContext() { return ctx; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1100, height: 800 }; },
      parentElement: { clientWidth: 1100, clientHeight: 800 },
    };
  }
  return {
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
    documentElement: { classList: { add() {} } },
    body: { classList: { add() {}, remove() {} } },
    getElementById: () => el(),
    querySelectorAll: () => [],
    createElement: () => el(),
  };
}

function boot(seed0, search, storage) {
  let seed = (seed0 == null ? 1 : seed0) >>> 0;
  const math = Object.create(Math);
  math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const context = {
    console, Math: math, Date, Number, String, JSON, parseInt, Array, Object, isNaN,
    navigator: { doNotTrack: '1', sendBeacon: () => false },
    location: { search: search || '?headless=1' },
    localStorage: storage || memoryStorage(),
    document: fakeDocument(),
    performance: { now: () => 0 },
    requestAnimationFrame() {},
    setTimeout() { return 0; },
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1100,
    innerHeight: 800,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  const files = [
    'js/utils.js', 'js/classes.js', 'js/entities.js', 'js/audio.js', 'js/analytics.js', 'js/ads.js',
    'js/survivor-items.js', 'js/survivor-data.js', 'js/survivor-sprites.js', 'js/survivor-fx.js', 'js/survivor.js',
  ];
  files.forEach((name) => {
    vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
  });
  vm.runInContext('if (typeof SurvivorSprites !== "undefined") this.SurvivorSprites = SurvivorSprites; if (typeof SurvivorSave !== "undefined") this.SurvivorSave = SurvivorSave; if (typeof FX !== "undefined") this.FX = FX;', context);
  if (typeof context.__svStart !== 'function') fail('headless survivor did not boot');
  return context;
}

function saveOnQuit() {
  const bag = memoryStorage();
  const game = boot(3, '?headless=1&debug=1', bag);
  game.confirm = () => false;
  game.__svStart();
  game.__svAddGold(40);
  for (let i = 0; i < 40; i++) game.__svStep(0.05);
  const alive = game.__svSnap();
  if (alive.state !== 'playing') fail('save setup died ' + alive.state + ' at ' + alive.time);
  game.__svQuit();
  if (game.__svBest() !== 0) fail('declined quit saved a best ' + game.__svBest());
  if (game.__svPurse() !== 0) fail('declined quit banked gold ' + game.__svPurse());
  game.__svHide();
  const hiddenBest = game.__svBest();
  if (!(hiddenBest >= 1.5)) fail('hide missed the clock ' + hiddenBest);
  const banked = game.__svPurse();
  if (banked < 40) fail('hide missed gold ' + banked);
  game.__svPageHide();
  if (game.__svPurse() !== banked) fail('pagehide banked twice ' + game.__svPurse());
  game.__svAddGold(15);
  game.__svBack();
  if (game.__svPurse() !== banked + 15) fail('back banked ' + game.__svPurse() + ' wanted ' + (banked + 15));
  game.__svBack();
  if (game.__svPurse() !== banked + 15) fail('back banked twice ' + game.__svPurse());
  game.confirm = () => true;
  const quit = game.__svQuit();
  if (quit.state !== 'title') fail('quit stayed in ' + quit.state);
  if (game.__svPurse() !== banked + 15) fail('quit banked twice ' + game.__svPurse());
  if (game.__svBest() + 0.05 < hiddenBest) fail('quit dropped the best ' + game.__svBest());
  const next = boot(3, '?headless=1', bag);
  next.__svStart();
  const dead = next.__svHurt(9999);
  if (!dead.prev || dead.prev.indexOf('Previous best: none') >= 0) fail('previous best ' + dead.prev);
  if (dead.prev.indexOf('Previous best: 0:') !== 0) fail('previous best ' + dead.prev);
  if (next.__svBest() + 0.05 < hiddenBest) fail('next run lost the best ' + next.__svBest());
  console.log('save on quit keeps ' + dead.prev);
}

function wardenHitFloor() {
  const game = boot(1);
  game.__svStart();
  game.__svSpawn('brute', 8, 0, 'warden');
  const hit = game.__svWardenHit();
  if (!(hit.pct >= 0.15 - 1e-9)) fail('warden contact ' + (hit.pct * 100).toFixed(2) + '%');
  if (hit.dmg + 1e-9 < hit.base * 0.15) fail('warden contact damage ' + hit.dmg);
  if (hit.shot !== 5) fail('warden volley ' + hit.shot);
  console.log('warden contact ' + (hit.pct * 100).toFixed(1) + '% of base ' + hit.base + ' (' + hit.dmg + '), volley ' + hit.shot);
}

function earlyCrowd() {
  for (let seed = 1; seed <= 8; seed++) {
    const game = boot(seed);
    game.__svStart();
    const view = game.__svView(1100, 800, 1);
    const halfW = view.w / (view.tile * 2);
    const halfH = view.h / (view.tile * 2);
    const opened = game.__svThreats();
    if (!opened.length) fail('seed ' + seed + ' opening pack was empty');
    opened.forEach((f) => {
      const dist = Math.hypot(f.x, f.y);
      if (dist < 0.6) fail('seed ' + seed + ' spawned ' + dist.toFixed(2) + ' tiles from the hero');
      const outside = Math.abs(f.x) > halfW - 0.05 || Math.abs(f.y) > halfH - 0.05;
      if (!outside) fail('seed ' + seed + ' opening spawn inside the screen');
    });
    let on20 = 0;
    let snap = game.__svSnap();
    for (let i = 0; i < 500; i++) {
      snap = game.__svIdleStep(0.05);
      if (snap.time >= 20) {
        on20 = game.__svOnScreen();
        break;
      }
    }
    if (on20 < 15) fail('seed ' + seed + ' had ' + on20 + ' on screen at 0:20');
  }
  console.log('spawns walk in from the screen edge, 15 on screen by 0:20');
}

function lootCadence() {
  for (let seed = 1; seed <= 4; seed++) {
    const game = boot(seed, '?headless=1&debug=1&walk=circle');
    game.__svStart();
    let snap = game.__svSnap();
    let drops = 0;
    let last = 0;
    let worst = 0;
    let rareAt = -1;
    for (let i = 0; i < 2200; i++) {
      snap = game.__svStep(0.05);
      if (snap.state === 'levelup') snap = game.__svChoose(0);
      if (snap.state === 'hermit') snap = game.__svDecline();
      if (snap.drops > drops) {
        if (drops > 0) {
          const gap = snap.time - last;
          if (gap > worst) worst = gap;
        }
        last = snap.time;
        drops = snap.drops;
      }
      if (rareAt < 0 && snap.rareAt >= 0) rareAt = snap.rareAt;
      if (snap.time > 95 || snap.state === 'dead') break;
    }
    if (!(rareAt >= 0 && rareAt <= 90)) fail('seed ' + seed + ' first rare at ' + rareAt);
    if (worst > 25.2) fail('seed ' + seed + ' loot gap ' + worst.toFixed(1) + 's');
    if (drops < 3) fail('seed ' + seed + ' only ' + drops + ' drops by ' + snap.time.toFixed(1));
  }
  const pair = boot(2);
  pair.__svStart();
  const shown = pair.__svPairToast();
  if (shown.toast.indexOf('Rare:') !== 0) fail('first toast ' + shown.toast);
  if (shown.toastQueued !== 1) fail('queued toasts ' + shown.toastQueued);
  if (shown.chat.indexOf('You find: Rare Iron Blade') < 0) fail('chat rare ' + shown.chat);
  if (shown.chat.indexOf('You find: Common Bone Charm') < 0) fail('chat common ' + shown.chat);
  let next = shown;
  for (let i = 0; i < 40; i++) next = pair.__svStep(0.05);
  if (next.toast.indexOf('Common:') !== 0) fail('second toast ' + next.toast);
  if (next.toastQueued !== 0) fail('queue left ' + next.toastQueued);
  console.log('loot every 15–25s, first rare by 1:30, both toasts named');
}

function idleDeath() {
  const times = [];
  for (let seed = 1; seed <= 8; seed++) {
    const game = boot(seed);
    game.__svStart();
    let deadAt = null;
    for (let t = 0; t < 190; t += 0.05) {
      const snap = game.__svIdleStep(0.05);
      if (snap.state === 'dead') {
        deadAt = snap.time;
        break;
      }
    }
    if (deadAt == null) fail('seed ' + seed + ' idle hero was still alive at 3:00');
    if (deadAt < 45 || deadAt >= 60) fail('seed ' + seed + ' idle death ' + deadAt.toFixed(1) + 's (want 45–60)');
    times.push(deadAt.toFixed(1));
  }
  console.log('idle death ' + times.join(' '));
  return times;
}

function groundCap() {
  const game = boot(3);
  const fx = game.FX;
  const live = new Set();
  const beam = fx.beam.bind(fx);
  const off = fx.beamOff.bind(fx);
  const reset = fx.reset.bind(fx);
  fx.beam = (id, x, y, rarity) => { live.add(String(id)); beam(id, x, y, rarity); };
  fx.beamOff = (id) => { live.delete(String(id)); off(id); };
  fx.reset = () => { live.clear(); reset(); };
  game.__svStart();
  live.clear();
  const planted = { common: 50, uncommon: 15, rare: 8, epic: 3, legendary: 2 };
  Object.keys(planted).forEach((rarity) => {
    for (let i = 0; i < planted[rarity]; i++) game.__svSeedItem(rarity);
  });
  let ground = game.__svGround();
  if (ground.length !== 78) fail('planted ' + ground.length + ' items');
  let guard = 0;
  while (guard++ < 8 && ground.length > 60) ground = game.__svMaintain(0.05);
  const rares = ground.filter((g) => g.rarity === 'rare' || g.rarity === 'epic' || g.rarity === 'legendary');
  if (rares.length !== 13) fail('cap ate rare+ ' + rares.length);
  if (ground.length > 60) fail('ground cap left ' + ground.length);
  rares.forEach((g) => {
    if (!live.has(String(g.id))) fail('rare+ missing a beam ' + g.rarity);
  });
  if (live.size !== rares.length) fail('beams ' + live.size + ' vs rare+ ' + rares.length);
  ground = game.__svMaintain(31);
  const left = ground.filter((g) => g.rarity === 'common' || g.rarity === 'uncommon');
  const kept = ground.filter((g) => g.rarity === 'rare' || g.rarity === 'epic' || g.rarity === 'legendary');
  if (left.length) fail('common/uncommon still on the ground after 30s: ' + left.length);
  if (kept.length !== 13) fail('aged rare+ ' + kept.length);
  if (live.size !== kept.length) fail('beams after age ' + live.size);
  const pile = boot(4);
  pile.__svStart();
  for (let i = 0; i < 65; i++) pile.__svSeedItem('rare');
  const stuck = pile.__svMaintain(31);
  if (stuck.length !== 65) fail('rare+ vanished under the cap: ' + stuck.length);
  game.__svStart();
  if (live.size !== 0) fail('restart left ' + live.size + ' beams');
  if (game.__svGround().length !== 0) fail('restart left ground items');
  console.log('ground cap keeps rare+ and clears beams on restart');
}

function vows() {
  for (let n = 0; n < 3; n++) {
    const game = boot(20 + n * 17);
    game.__svStart();
    let seen = false;
    let snap = game.__svSnap();
    if (snap.vowRisk !== 'Risk: enemies hit 1.5\u00d7 harder') fail('risk line: ' + snap.vowRisk);
    if (snap.vowReward !== 'Reward: +50% XP and gold') fail('reward line: ' + snap.vowReward);
    for (let i = 0; i < 2800; i++) {
      game.__svMove(Math.cos(snap.time * 0.7), Math.sin(snap.time * 0.55));
      snap = game.__svStep(0.05);
      if (snap.state === 'levelup') snap = game.__svChoose(0);
      if (snap.time < 90 && (snap.vowSeen || snap.state === 'hermit')) {
        fail('vow before 1:30 in run ' + (n + 1) + ': ' + snap.time);
      }
      if (snap.vowSeen || snap.state === 'hermit') {
        seen = snap.time;
        break;
      }
      if (snap.time > 130 || snap.state === 'dead') break;
    }
    if (!seen) fail('vow missing in run ' + (n + 1));
    if (seen < 90 || seen > 116) fail('vow outside 1:30-1:55 in run ' + (n + 1) + ': ' + seen);
    if (snap.vowRisk !== 'Risk: enemies hit 1.5\u00d7 harder') fail('offer risk: ' + snap.vowRisk);
    if (snap.vowReward !== 'Reward: +50% XP and gold') fail('offer reward: ' + snap.vowReward);
  }
  console.log('vow offered at or after 1:30 in 3 runs');
}

function novas() {
  const game = boot();
  game.__svStart();
  for (let rank = 1; rank <= 5; rank++) {
    const snap = game.__svNova(rank);
    if (!snap.novas) fail('Star Nova rank ' + rank + ' did not fire');
  }
  console.log('star nova fired at ranks 1-5');
}

function levelTimeline(seed) {
  const game = boot(seed == null ? 7 : seed);
  game.__svStart();
  const times = [];
  let seenUps = 0;
  let end = null;
  for (let t = 0; t < 300; t += 0.05) {
    const threats = game.__svThreats();
    let x = 0;
    let y = 0;
    let near = 99;
    let nx = 1;
    let ny = 0;
    const reach = t < 75 ? 1.45 : 2.7;
    threats.forEach((f) => {
      const d = Math.hypot(f.x, f.y) || 1;
      if (d < near) {
        near = d;
        nx = f.x;
        ny = f.y;
      }
      if (d < reach) {
        const w = (reach - d) / reach;
        x -= (f.x / d) * w;
        y -= (f.y / d) * w;
      }
    });
    if (near < reach) {
      const d = Math.hypot(nx, ny) || 1;
      x += (-ny / d) * 0.85;
      y += (nx / d) * 0.85;
    } else if (t > 25) {
      x += Math.cos(t * 0.55) * 0.4;
      y += Math.sin(t * 0.4) * 0.4;
    }
    if (x === 0 && y === 0) x = 0.01;
    const len = Math.hypot(x, y) || 1;
    game.__svMove(x / len, y / len);
    let snap = game.__svStep(0.05);
    if (snap.state === 'hermit') snap = game.__svDecline();
    if (snap.state === 'levelup') {
      if (snap.levelUps > seenUps) {
        seenUps = snap.levelUps;
        times.push(Number(snap.time.toFixed(1)));
      }
      const ids = game.__svOffers();
      const prefer = ['nova', 'orbit', 'pierce', 'bolt', 'might', 'haste', 'area', 'vitality', 'heal'];
      let pick = 0;
      if (snap.life < 45 && ids.indexOf('heal') >= 0) pick = ids.indexOf('heal');
      else {
        for (let p = 0; p < prefer.length; p++) {
          const at = ids.indexOf(prefer[p]);
          if (at >= 0) { pick = at; break; }
        }
      }
      snap = game.__svChoose(pick);
    }
    if (snap.state === 'dead' || snap.state === 'won') {
      end = snap;
      break;
    }
  }
  const early = times.filter((stamp) => stamp <= 120);
  console.log('level-ups', times.join(', ') || 'none', end ? ('ended ' + end.state + ' ' + end.time.toFixed(1)) : 'still going');
  // 6.1 one-hit trash feeds XP faster than the old 5–7 curve. The band
  // still fails a starved run and a runaway one.
  if (early.length < 9 || early.length > 14) fail('expected 9 to 14 level-ups in 2 minutes, got ' + early.length);
  if (times[0] > 15) fail('first level-up at ' + times[0] + 's');
  let late = 0;
  let worst = 0;
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= 120) continue;
    late += 1;
    const gap = times[i] - times[i - 1];
    if (gap > worst) worst = gap;
  }
  if (late < 6) fail('expected the climb to keep going after 2:00, got ' + late);
  if (worst > 40) fail('level-ups stalled for ' + worst.toFixed(1) + 's');
  return times;
}

function hermitTwice() {
  const game = boot(11);
  game.__svStart();
  const times = [];
  let snap = game.__svSnap();
  for (let i = 0; i < 9000 && times.length < 3; i++) {
    const t = snap.time || 0;
    game.__svMove(Math.cos(t * 0.7), Math.sin(t * 0.55));
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup') snap = game.__svChoose(0);
    if (snap.state === 'hermit') {
      times.push(Number(snap.time.toFixed(1)));
      snap = game.__svDecline();
    }
    if (snap.state === 'dead' || snap.time > 320) break;
  }
  if (times.length !== 2) fail('hermit offers ' + times.join(', ') + ' (want exactly two)');
  if (times[0] < 90 || times[0] > 116) fail('first hermit at ' + times[0]);
  const gap = times[1] - times[0];
  if (gap < 70 || gap > 85) fail('second hermit gap ' + gap.toFixed(1));
  console.log('hermit offers', times.join(', '));
}

function vowRevive() {
  const game = boot(5);
  game.__svStart();
  let snap = game.__svSnap();
  for (let i = 0; i < 2800; i++) {
    game.__svMove(Math.cos(snap.time * 0.7), Math.sin(snap.time * 0.55));
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup') snap = game.__svChoose(0);
    if (snap.state === 'hermit') break;
    if (snap.time > 130) fail('vow revive never saw the hermit');
  }
  snap = game.__svAccept();
  if (!snap.vow || !(snap.curse > 0)) fail('accept did not start the vow');
  const curse = snap.curse;
  snap = game.__svHurt(9999);
  if (snap.state !== 'dead') fail('hurt did not kill, state ' + snap.state);
  snap = game.__svRevive();
  if (snap.state !== 'playing') fail('revive state ' + snap.state);
  if (!snap.vow || !(snap.curse > 0)) fail('revive dropped the vow');
  if (Math.abs(snap.curse - curse) > 1) fail('revive changed the curse clock');
  console.log('vow resumed after revive, curse ' + snap.curse.toFixed(1));
}

function twoEvos() {
  const game = boot(1);
  game.__svStart();
  const armed = game.__svForceEvos();
  if (armed.evolved.length < 2) fail('both evolutions should queue, got ' + armed.evolved.join(','));
  for (let i = 0; i < 70; i++) game.__svStep(0.05);
  const log = game.__svEvoLog();
  const ids = log.map((row) => row.id).sort();
  if (ids.join(',') !== 'halo,storm') fail('evolution log ' + JSON.stringify(log));
  if (log.length < 2 || log[0].tick === log[1].tick) fail('evolutions landed on the same step ' + JSON.stringify(log));
  console.log('evolutions', JSON.stringify(log));
}

function secondChanceThreeRuns() {
  const game = boot(4, '?headless=1&debug=1&adtest=1');
  game.__svBank(500);
  const buy = game.__svBuy('revival');
  if (!buy.ok) fail('revival buy ' + JSON.stringify(buy));
  function prove(label) {
    const armed = game.__svSnap();
    if (armed.state !== 'playing') fail(label + ' state ' + armed.state);
    if (armed.revivalLeft !== 1) fail(label + ' revivalLeft ' + armed.revivalLeft);
    if (armed.secondChance !== 0) fail(label + ' secondChance carried ' + armed.secondChance);
    const line = game.__svDebugLine();
    if (line.indexOf('revival 1') < 0) fail(label + ' overlay ' + line);
    const saved = game.__svHurt(9999);
    if (saved.state !== 'playing') fail(label + ' did not save ' + saved.state);
    if (saved.banner !== 'Second Chance!') fail(label + ' banner ' + saved.banner);
    if (saved.secondChance !== 1) fail(label + ' count ' + saved.secondChance);
    if (saved.secondChanceFx !== 1) fail(label + ' fx ' + saved.secondChanceFx);
    if (saved.revivalLeft !== 0) fail(label + ' stayed armed');
    const expect = Math.round(saved.maxLife * 0.3);
    if (Math.abs(saved.life - expect) > 1) fail(label + ' life ' + saved.life + ' want ~' + expect);
    const dead = game.__svHurt(9999);
    if (dead.state !== 'dead') fail(label + ' second hit ' + dead.state);
    if (dead.secondChanceFx !== 1) fail(label + ' fx fired twice');
    return dead;
  }
  game.__svStart();
  prove('run1');
  const restarted = game.__svRestart();
  if (restarted.state !== 'playing') fail('restart state ' + restarted.state);
  if (restarted.revivalLeft !== 1) fail('restart revivalLeft ' + restarted.revivalLeft);
  prove('restart');
  const revived = game.__svRevive();
  if (revived.state !== 'playing') fail('revive state ' + revived.state);
  if (revived.revivalLeft !== 0) fail('revive re-armed revivalLeft');
  if (revived.secondChance !== 1) fail('revive reset secondChance ' + revived.secondChance);
  const afterRevive = game.__svHurt(9999);
  if (afterRevive.state !== 'dead') fail('revive path lived through a lethal hit ' + afterRevive.state);
  if (afterRevive.secondChanceFx !== 1) fail('revive path fired Second Chance again');
  game.__svMenu();
  const third = game.__svStart();
  if (third.revivalLeft !== 1) fail('menu return revivalLeft ' + third.revivalLeft);
  prove('menu');
  console.log('second chance on three runs: restart, revive, menu');
}

function secondChance() {
  const game = boot(2);
  game.__svStart();
  game.__svArmRevival();
  const snap = game.__svHurt(9999);
  if (snap.state !== 'playing') fail('second chance did not save the run: ' + snap.state);
  if (snap.secondChance !== 1) fail('second chance count ' + snap.secondChance);
  const expect = Math.round(snap.maxLife * 0.3);
  if (Math.abs(snap.life - expect) > 1) fail('second chance life ' + snap.life + ' want ~' + expect);
  if (snap.banner !== 'Second Chance!') fail('second chance banner ' + snap.banner);
  const again = game.__svHurt(9999);
  if (again.state !== 'dead') fail('second chance fired twice');
  console.log('second chance at ' + snap.life + '/' + snap.maxLife);
}

function wholeHp() {
  const game = boot(2);
  game.__svStart();
  const snap = game.__svSnap();
  if (snap.maxLife !== Math.round(snap.maxLife)) fail('max life not whole: ' + snap.maxLife);
  if (snap.life > snap.maxLife) fail('life above max ' + snap.life + '/' + snap.maxLife);
  console.log('hp ' + snap.life + '/' + snap.maxLife);
}

function gemMerge() {
  const game = boot(2);
  game.__svStart();
  const before = game.__svSeedGems(6, 8);
  const snap = game.__svStep(0.05);
  if (snap.bigGems < 1) fail('old gems did not merge');
  if (snap.gems > before.gems - 4) fail('merge left too many gems: ' + snap.gems + ' from ' + before.gems);
  console.log('gem merge ' + before.gems + ' -> ' + snap.gems + ' big ' + snap.bigGems);
}

function flashCap() {
  const game = boot(3, '?headless=1&debug=1&t=150');
  game.__svStart();
  const hit = game.__svPummel();
  if (hit.bossFlashes < 2 || hit.bossFlashes > 3) fail('boss flash count ' + hit.bossFlashes);
  if (hit.trashFlashes < 18) fail('trash flashes were capped: ' + hit.trashFlashes);
  console.log('flash boss ' + hit.bossFlashes + ' trash ' + hit.trashFlashes);
}

function greedCarry() {
  const game = boot(1, '?headless=1&debug=1');
  game.__svStart();
  const one = game.__svGoldProbe(50, 1.02);
  if (one.gold !== 51) fail('1-gold greed carry ' + JSON.stringify(one));
  const three = game.__svGoldProbe(25, 3.24);
  if (three.gold !== 81) fail('3-gold greed carry ' + JSON.stringify(three));
  console.log('greed carry 50x1.02 -> ' + one.gold + ', 25x3.24 -> ' + three.gold);
}

function bossDuel(label, search, name, seed) {
  const game = boot(seed == null ? 7 : seed, search);
  game.__svStart();
  let snap = game.__svSnap();
  if (snap.boss !== name) fail(label + ' missing ' + name + ' got ' + snap.boss);
  const start = snap.time;
  const startHp = snap.bossLife;
  let lowest = startHp;
  let diedAt = null;
  for (let i = 0; i < 1100; i++) {
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup' || snap.state === 'hermit') snap = game.__svDismiss();
    if (snap.bossLife > 0 && snap.bossLife < lowest) lowest = snap.bossLife;
    if (snap.chest || (snap.boss === '' && lowest < startHp)) {
      diedAt = snap.time;
      break;
    }
    if (snap.state === 'dead') fail(label + ' hero died at ' + snap.time.toFixed(1) + ' boss ' + snap.bossLife + ' hit ' + snap.lastHit + ' hp ' + snap.life);
  }
  if (diedAt == null) fail(label + ' still up after 55s, hp ' + snap.bossLife + '/' + startHp);
  const fight = diedAt - start;
  if (!(lowest < startHp * 0.9)) fail(label + ' hp barely moved ' + lowest + '/' + startHp);
  const lo = label === 'warden' ? 25 : 20;
  const hi = label === 'warden' ? 30 : 45;
  if (fight < lo || fight > hi) fail(label + ' fight ' + fight.toFixed(1) + 's (want ' + lo + '-' + hi + ')');
  if (!snap.chest) fail(label + ' died without a chest');
  console.log(label + ' died in ' + fight.toFixed(1) + 's, chest dropped');
  if (label === 'warden') {
    const at = game.__svChestAt();
    if (!at) fail('chest has no position');
    game.__svPan(at.x + 40, at.y);
    if (!game.__svChestArrow()) fail('off-screen chest drew no edge arrow');
    const held = game.__svChestAt();
    game.__svMove(0, 0);
    game.__svPan(held.x, held.y);
    let opened = null;
    for (let n = 0; n < 20; n++) {
      const picked = game.__svStep(0.05);
      if (picked.state === 'levelup' || picked.state === 'hermit') game.__svDismiss();
      if (!picked.chest) { opened = picked; break; }
    }
    if (!opened) fail('hero could not open the chest');
    const rares = game.__svGround().filter((g) => g.rarity === 'rare');
    if (rares.length < 1) fail('chest did not drop a rare on the ground');
    console.log('chest stayed put, then dropped ' + rares.length + ' rare');
  }
  return fight;
}

function boughtSecondChance() {
  const game = boot(2);
  game.__svBank(500);
  const buy = game.__svBuy('revival');
  if (!buy.ok) fail('could not buy Second Chance: ' + JSON.stringify(buy));
  game.__svStart();
  const snap = game.__svHurt(9999);
  if (snap.state !== 'playing') fail('bought Second Chance did not save the run');
  if (snap.secondChance !== 1) fail('second chance count ' + snap.secondChance);
  if (snap.secondChanceFx !== 1) fail('FX.secondChance calls ' + snap.secondChanceFx);
  if (snap.banner !== 'Second Chance!') fail('banner ' + snap.banner);
  const expect = Math.round(snap.maxLife * 0.3);
  if (Math.abs(snap.life - expect) > 1) fail('life ' + snap.life + ' want ~' + expect);
  const again = game.__svHurt(9999);
  if (again.state !== 'dead') fail('second lethal hit should kill');
  if (again.secondChanceFx !== 1) fail('Second Chance FX fired twice');
  console.log('bought second chance at ' + snap.life + '/' + snap.maxLife);
}

function strideRefresh() {
  const game = boot(4);
  game.__svBank(5000);
  ['magnet', 'magnet', 'vitality', 'vitality', 'greed', 'greed', 'might', 'stride'].forEach((id) => {
    const res = game.__svBuy(id);
    if (!res.ok) fail('setup buy ' + id + ' ' + JSON.stringify(res));
  });
  const offer = game.__svNextUpgrade();
  if (!offer || offer.label !== 'Stride II') fail('expected Stride II before the buy, got ' + JSON.stringify(offer));
  game.__svStart();
  game.__svHurt(9999);
  const line = game.__svNextLine();
  if (line.indexOf('Stride II') < 0) fail('death screen offer: ' + line);
  const bought = game.__svBuy('stride');
  if (!bought.ok || bought.rank !== 2) fail('Stride II buy ' + JSON.stringify(bought));
  const line2 = game.__svNextLine();
  if (line2.indexOf('Stride II') >= 0) fail('death screen stayed on Stride II: ' + line2);
  const row = game.__svShop().filter((u) => u.id === 'stride')[0];
  if (!row || row.rank !== 2) fail('shop rank ' + JSON.stringify(row));
  game.__svStart();
  const speed = game.__svSpeed();
  const expect = 3 * 1.08;
  if (Math.abs(speed - expect) > 0.001) fail('move speed ' + speed + ' want ' + expect);
  console.log('stride II cleared, speed ' + speed.toFixed(3));
}

function doubleGoldOnce() {
  const game = boot(2, '?headless=1&adtest=1');
  game.__svStart();
  game.__svGoldProbe(356, 1);
  let snap = game.__svHurt(9999);
  if (snap.state !== 'dead') fail('double-gold setup did not die');
  if (!game.__svOfferDouble()) fail('double gold was not offered');
  if (!game.__svDouble()) fail('double gold did not apply');
  snap = game.__svSnap();
  if (snap.gold !== 712) fail('doubled gold ' + snap.gold);
  if (game.__svOfferDouble()) fail('double gold stayed offered after use');
  snap = game.__svRevive();
  if (snap.state !== 'playing') fail('revive after double gold: ' + snap.state);
  game.__svAddGold(41);
  snap = game.__svHurt(9999);
  if (snap.state !== 'dead') fail('second death ' + snap.state);
  if (snap.gold !== 753) fail('gold after revive death ' + snap.gold + ' (want 753, doubled once)');
  if (game.__svOfferDouble()) fail('double gold offered again after revive');
  console.log('double gold once, then revive, gold ' + snap.gold);
}

function vowsCompletedOnly() {
  const dead = boot(5);
  dead.__svStart();
  let snap = dead.__svSnap();
  for (let i = 0; i < 2800; i++) {
    dead.__svMove(Math.cos(snap.time * 0.7), Math.sin(snap.time * 0.55));
    snap = dead.__svStep(0.05);
    if (snap.state === 'levelup') snap = dead.__svChoose(0);
    if (snap.state === 'hermit') break;
    if (snap.time > 130) fail('vow-death run missed the hermit');
  }
  snap = dead.__svAccept();
  const started = snap.time;
  for (let i = 0; i < 800; i++) {
    snap = dead.__svStep(0.05);
    if (snap.state === 'levelup') snap = dead.__svDismiss();
    if (snap.time >= started + 37) break;
  }
  snap = dead.__svHurt(9999);
  if (snap.state !== 'dead') fail('vow death state ' + snap.state);
  if (snap.vowsSurvived !== 0) fail('unfinished vow counted ' + snap.vowsSurvived);
  if (snap.vowBadge) fail('vow badge stayed up after death');
  console.log('unfinished vow counted 0');

  const lived = boot(5);
  lived.__svStart();
  snap = lived.__svSnap();
  for (let i = 0; i < 2800; i++) {
    lived.__svMove(Math.cos(snap.time * 0.7), Math.sin(snap.time * 0.55));
    snap = lived.__svStep(0.05);
    if (snap.state === 'levelup') snap = lived.__svChoose(0);
    if (snap.state === 'hermit') break;
    if (snap.time > 130) fail('vow-clear run missed the hermit');
  }
  snap = lived.__svAccept();
  if (!snap.vowBadge) fail('badge missing during the vow');
  lived.__svMove(1, 0);
  let cleared = false;
  for (let i = 0; i < 1600; i++) {
    snap = lived.__svStep(0.05);
    if (snap.vowsSurvived >= 1) { cleared = true; break; }
    if (snap.state === 'levelup') {
      if (snap.vowsSurvived >= 1) { cleared = true; break; }
      snap = lived.__svDismiss();
    }
    if (snap.state === 'dead') fail('hero died during a completed-vow check');
  }
  if (!cleared) fail('completed vow did not count');
  snap = lived.__svSnap();
  if (!snap.vowBadge) fail('badge left before the run ended');
  console.log('completed vow counted ' + snap.vowsSurvived);
}

function forcedVow() {
  const game = boot(4, '?headless=1&debug=1&vow=1&walk=circle');
  game.__svStart();
  let snap = game.__svSnap();
  if (snap.vowCount) fail('forced vow was already on');
  for (let i = 0; i < 4000; i++) {
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup') snap = game.__svChoose(0);
    if (snap.time < 90 && (snap.vowCount > 0 || snap.state === 'hermit')) {
      fail('forced vow before 1:30 at ' + snap.time);
    }
    if (snap.time >= 90 && snap.vowCount >= 1) break;
    if (snap.state === 'dead') fail('forced vow died at ' + snap.time.toFixed(1));
  }
  if (snap.vowCount < 1) fail('forced vow did not accept');
  if (snap.state === 'hermit') fail('forced vow opened the card');
  if (!(snap.curse > 0)) fail('forced vow has no curse');
  if (snap.time < 90 || snap.time > 90.2) fail('forced vow time ' + snap.time);
  if (!snap.vowBadge) fail('forced vow badge missing');
  console.log('forced vow accepted at ' + snap.time.toFixed(2));
}

function bossWarning() {
  const game = boot(7, '?headless=1&debug=1&t=140&walk=circle');
  game.__svStart();
  let snap = game.__svSnap();
  if (snap.warnOn || snap.boss) fail('boss UI was up at ' + snap.time.toFixed(1));
  let warned = null;
  let spawned = null;
  for (let i = 0; i < 500; i++) {
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup' || snap.state === 'hermit') snap = game.__svDismiss();
    if (warned == null && snap.warnOn && !snap.boss) warned = snap.time;
    if (spawned == null && snap.boss === 'Grave Warden') spawned = snap.time;
    if (warned != null && spawned != null) break;
  }
  if (warned == null || spawned == null) fail('warning ' + warned + ' spawn ' + spawned);
  const lead = spawned - warned;
  if (lead < 1.5 || lead > 2.6) fail('boss warning lead ' + lead.toFixed(2) + 's');
  if (snap.bossLife <= 0) fail('health was not live at spawn');
  game.__svStart();
  snap = game.__svSnap();
  if (snap.warnOn) fail('GRAVE WARDEN banner carried into the next run');
  if (snap.boss) fail('boss ' + snap.boss + ' carried into the next run');
  console.log('boss warning ' + lead.toFixed(2) + 's before spawn, cleared on restart');
}

function casterBurst() {
  const game = boot(3, '?headless=1&debug=1&t=140&walk=circle');
  game.__svStart();
  game.__svSpawn('shooter', 1.2, 0.4);
  game.__svSpawn('shooter', -1.1, 0.5);
  if (game.__svCount('shooter') < 2) fail('could not place shooters');
  let snap = game.__svSnap();
  for (let i = 0; i < 500 && !(snap.boss === 'Grave Warden' && snap.time >= 150); i++) {
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup' || snap.state === 'hermit') snap = game.__svDismiss();
  }
  if (snap.boss !== 'Grave Warden') fail('warden did not spawn');
  if (game.__svCount('shooter') !== 0) fail('casters still alive at the warden spawn');
  for (let i = 0; i < 80; i++) {
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup' || snap.state === 'hermit') snap = game.__svDismiss();
    if (snap.boss !== 'Grave Warden') break;
  }
  if (snap.boss === 'Grave Warden' && game.__svCount('shooter') !== 0) fail('a caster spawned during the fight');
  console.log('casters die at the warden spawn and stay gone');
}

function evoTagHides() {
  const game = boot(1);
  game.__svStart();
  game.__svGive('orbit', 4);
  game.__svGive('tempo', 1);
  game.__svOpenLevel();
  const before = game.__svEvoHints().join('|');
  if (before.indexOf('→') >= 0 || before.indexOf('?') >= 0) fail('hint glyph ' + before);
  game.__svDismiss();
  game.__svForceEvos();
  game.__svOpenLevel();
  const after = game.__svEvoHints();
  after.forEach((hint) => {
    if (hint) fail('evolution tag still showing: ' + hint);
  });
  console.log('evolution tag hidden after it fires');
}

function evolveBefore215() {
  const times = [];
  for (let seed = 1; seed <= 8; seed++) {
    const game = boot(seed, '?headless=1&debug=1&walk=circle');
    game.__svStart();
    let snap = game.__svSnap();
    let evolvedAt = null;
    for (let t = 0; t < 3200; t++) {
      snap = game.__svStep(0.05);
      if (snap.state === 'hermit') snap = game.__svDecline();
      if (snap.state === 'levelup') {
        if (snap.evolved && snap.evolved.length) {
          evolvedAt = snap.time;
          break;
        }
        const ids = game.__svOffers();
        const owned = snap.owned || {};
        const order = [];
        if ((owned.orbit || 0) >= 5 && !(owned.tempo > 0)) order.push('tempo');
        else if ((owned.orbit || 0) >= 3 && !(owned.tempo > 0)) order.push('tempo');
        if ((owned.tempo || 0) > 0 && (owned.orbit || 0) < 5) order.push('orbit');
        if ((owned.nova || 0) >= 5 && !(owned.cinder > 0)) order.push('cinder');
        if ((owned.cinder || 0) > 0 && (owned.nova || 0) < 5) order.push('nova');
        order.push('orbit', 'tempo', 'nova', 'cinder', 'bolt', 'might');
        let pick = 0;
        for (let p = 0; p < order.length; p++) {
          const at = ids.indexOf(order[p]);
          if (at >= 0) { pick = at; break; }
        }
        snap = game.__svChoose(pick);
        if (snap.evolved && snap.evolved.length) {
          evolvedAt = snap.time;
          break;
        }
      }
      if (snap.evolved && snap.evolved.length) {
        evolvedAt = snap.time;
        break;
      }
      if (snap.state === 'dead' || snap.time > 140) break;
    }
    if (evolvedAt == null || evolvedAt > 135) {
      fail('seed ' + seed + ' evolution at ' + (evolvedAt == null ? 'none' : evolvedAt.toFixed(1))
        + ' t=' + snap.time.toFixed(1) + ' owned ' + JSON.stringify(snap.owned));
    }
    times.push(evolvedAt.toFixed(1));
  }
  console.log('evolution before 2:15 ' + times.join(', '));
}

function plainToolsIgnored() {
  const game = boot(1, '?headless=1&t=150&walk=circle');
  game.__svStart();
  let snap = game.__svSnap();
  if (snap.time > 1) fail('plain url honored &t= ' + snap.time);
  if (snap.boss) fail('plain url spawned ' + snap.boss);
  for (let i = 0; i < 80; i++) snap = game.__svStep(0.05);
  if (Math.hypot(snap.x, snap.y) > 0.2) fail('plain url walked the hero to ' + snap.x.toFixed(2) + ',' + snap.y.toFixed(2));
  console.log('plain url ignored t= and walk=circle');
}

function evolveByThree() {
  const game = boot(9, '?headless=1&debug=1&walk=circle');
  game.__svStart();
  let snap = game.__svSnap();
  let evolvedAt = null;
  for (let t = 0; t < 4200; t++) {
    snap = game.__svStep(0.05);
    if (snap.state === 'hermit') snap = game.__svDecline();
    if (snap.state === 'levelup') {
      const ids = game.__svOffers();
      const owned = snap.owned || {};
      const order = [];
      if ((owned.orbit || 0) >= 5 && !(owned.tempo > 0)) order.push('tempo');
      if ((owned.nova || 0) >= 5 && !(owned.cinder > 0)) order.push('cinder');
      if ((owned.tempo || 0) > 0 && (owned.orbit || 0) < 5) order.push('orbit');
      if ((owned.cinder || 0) > 0 && (owned.nova || 0) < 5) order.push('nova');
      order.push('orbit', 'tempo', 'nova', 'cinder', 'bolt', 'might', 'haste');
      let pick = 0;
      for (let p = 0; p < order.length; p++) {
        const at = ids.indexOf(order[p]);
        if (at >= 0) { pick = at; break; }
      }
      snap = game.__svChoose(pick);
    }
    if (snap.evolved && snap.evolved.length) {
      evolvedAt = snap.time;
      break;
    }
    if (snap.state === 'dead') break;
    if (snap.time > 185) break;
  }
  if (evolvedAt == null || evolvedAt > 180) {
    fail('no evolution by 3:00, at ' + (evolvedAt == null ? 'none' : evolvedAt.toFixed(1))
      + ' t=' + (snap.time || 0).toFixed(1)
      + ' state=' + snap.state
      + ' boss=' + snap.boss + ' hp=' + Math.round(snap.bossLife || 0)
      + ' chest=' + snap.chest
      + ' level=' + snap.level
      + ' owned ' + JSON.stringify(snap.owned));
  }
  console.log('evolution by ' + evolvedAt.toFixed(1) + 's ' + snap.evolved.join(','));
}

if (process.env.BOSS_SPREAD) {
  ['warden', 'demon'].forEach((kind) => {
    const search = kind === 'warden'
      ? '?headless=1&debug=1&t=150&walk=circle'
      : '?headless=1&debug=1&t=295&walk=circle';
    const name = kind === 'warden' ? 'Grave Warden' : 'Risen Demon';
    const times = [];
    for (let seed = 1; seed <= 8; seed++) {
      const game = boot(seed, search);
      game.__svStart();
      let snap = game.__svSnap();
      const start = snap.time;
      const startHp = snap.bossLife;
      let lowest = startHp;
      let row = 'no kill';
      for (let i = 0; i < 1400; i++) {
        snap = game.__svStep(0.05);
        if (snap.state === 'levelup' || snap.state === 'hermit') snap = game.__svDismiss();
        if (snap.bossLife > 0 && snap.bossLife < lowest) lowest = snap.bossLife;
        if (snap.chest || (snap.boss === '' && lowest < startHp)) {
          row = (snap.time - start).toFixed(1);
          break;
        }
        if (snap.state === 'dead') {
          row = 'hero ' + snap.time.toFixed(1) + ' boss ' + Math.round(snap.bossLife);
          break;
        }
      }
      times.push(row);
    }
    console.log(kind + ' x8 ' + times.join(', '));
  });
  process.exit(0);
}

function guardPress(setup, which, read) {
  ['pointerdown', 'click'].forEach((type) => {
    const game = setup();
    const before = read(game);
    game.__svClock(250);
    let snap = game.__svPress(which, type);
    if (read(game, snap) !== before) fail(which + ' ' + type + ' at 250ms counted');
    game.__svClock(320);
    snap = game.__svPress(which, type);
    if (read(game, snap) === before) fail(which + ' ' + type + ' at 320ms did not pick');
  });
  const game = setup();
  const before = read(game);
  game.__svClock(250);
  game.__svPress(which, 'pointerdown');
  if (read(game) !== before) fail(which + ' pointer at 250ms counted');
  game.__svClock(320);
  game.__svPress(which, 'click');
  if (read(game) === before) fail(which + ' blocked pointer swallowed the click at 320ms');
  console.log(which + ' guard drops 250ms and takes 320ms');
}

function tapGuards() {
  guardPress(() => {
    const game = boot(1);
    game.__svStart();
    game.__svClock(0);
    game.__svOpenLevel();
    return game;
  }, 'card', (game) => game.__svSnap().state);
  guardPress(() => {
    const game = boot(1);
    game.__svStart();
    game.__svClock(0);
    game.__svHurt(9999);
    return game;
  }, 'restart', (game) => game.__svSnap().state);
  guardPress(() => {
    const game = boot(1);
    game.__svStart();
    game.__svClock(0);
    game.__svOpenHermit();
    return game;
  }, 'hermit-yes', (game) => game.__svSnap().state + ':' + game.__svSnap().vowCount);
}

function evoNeeds() {
  const game = boot(1);
  game.__svStart();
  game.__svGive('orbit', 5);
  if (game.__svHint('orbit') !== 'Needs: Battle Tempo') fail('orbit hint ' + game.__svHint('orbit'));
  game.__svGive('nova', 3);
  if (game.__svHint('nova') !== 'Needs: Cinder Heart') fail('nova hint ' + game.__svHint('nova'));
  game.__svGive('cinder', 1);
  if (game.__svHint('nova') !== 'Needs: Star Nova') fail('nova rank hint ' + game.__svHint('nova'));
  game.__svGive('nova', 5);
  if (game.__svHint('nova') !== 'Ready') fail('nova ready ' + game.__svHint('nova'));
  if (game.__svHint('cinder') !== 'Ready') fail('cinder ready ' + game.__svHint('cinder'));
  console.log('evolution hints name the missing piece');
}

function freshAndFlags() {
  const bag = memoryStorage();
  const progress = JSON.stringify({ version: 1, gold: 1005, upgrades: { vitality: 2 }, bestTime: 0, bestKills: 0 });
  bag.setItem('abyss-survivor-progress', progress);
  bag.setItem('abyss-survivor-profile', JSON.stringify({ version: 1, playerId: 'tester', cosmetics: { skin: null, effect: null } }));
  bag.setItem('abyss-survivor-inventory', JSON.stringify({ version: 1, items: [], equipped: { charm: null, armour: null, ring: null } }));
  let writes = 0;
  const wrapped = {
    getItem: (k) => bag.getItem(k),
    setItem: (k, v) => {
      if (String(k).indexOf('abyss-survivor') === 0) writes += 1;
      bag.setItem(k, v);
    },
    removeItem: (k) => bag.removeItem(k),
  };
  const fresh = boot(1, '?headless=1&fresh=1&walk=circle&t=120&skel=1&seed=4', wrapped);
  fresh.__svStart();
  if (fresh.__svPurse() !== 0) fail('fresh kept stored gold ' + fresh.__svPurse());
  if (writes !== 0) fail('fresh wrote the stored save');
  if (bag.getItem('abyss-survivor-progress') !== progress) fail('fresh overwrote progress');
  if (fresh.__svSnap().time < 119) fail('fresh ignored t= ' + fresh.__svSnap().time);
  if (!fresh.SurvivorSprites.skelOn()) fail('skel flag did not reach the baker');
  let moved = fresh.__svSnap();
  for (let i = 0; i < 40; i++) {
    moved = fresh.__svStep(0.05);
    if (moved.state === 'levelup' || moved.state === 'hermit') moved = fresh.__svDismiss();
  }
  if (Math.hypot(moved.x, moved.y) < 0.2) fail('fresh+walk did not move');
  const plain = boot(1, '?headless=1', bag);
  plain.__svStart();
  if (plain.__svPurse() !== 1005) fail('normal load dropped stored gold ' + plain.__svPurse());
  if (plain.SurvivorSprites.skelOn()) fail('normal load enabled skel');
  if (plain.__svSnap().time > 1) fail('normal load honored t=');
  function pose(extra) {
    const game = boot(2, '?headless=1&debug=1&fresh=1&walk=circle&t=120&seed=9' + extra);
    game.__svStart();
    let snap = game.__svSnap();
    for (let i = 0; i < 20; i++) {
      snap = game.__svStep(0.05);
      if (snap.state === 'levelup' || snap.state === 'hermit') snap = game.__svDismiss();
    }
    return snap.x.toFixed(3) + ',' + snap.y.toFixed(3) + ',' + snap.enemies;
  }
  const withSkel = pose('&skel=1');
  const without = pose('');
  if (withSkel !== without) fail('skel changed the sim ' + withSkel + ' vs ' + without);
  console.log('fresh save stays in memory and combines with walk, t, seed, skel');
}

function bossLook() {
  const game = boot(1, '?headless=1&debug=1&t=147&skel=1');
  const S = game.SurvivorSprites;
  if (S.BOSS_OUTLINE_PX !== 2) fail('boss outline width ' + S.BOSS_OUTLINE_PX);
  if (String(S.BOSS_OUTLINE_COLOR).toLowerCase() !== '#ff5ad6') fail('boss outline color ' + S.BOSS_OUTLINE_COLOR);
  const rim = S.SKEL_RIM_RGB;
  if (!rim || rim[0] !== 200 || rim[1] !== 212 || rim[2] !== 232) fail('skel rim ' + rim);
  const w = 7;
  const h = 7;
  const src = new Uint8ClampedArray(w * h * 4);
  const body = (3 * w + 3) * 4;
  src[body] = 120;
  src[body + 1] = 120;
  src[body + 2] = 120;
  src[body + 3] = 255;
  function magenta(baked) {
    const d = baked.data;
    let n = 0;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] > 16 && d[p] === 255 && d[p + 1] === 90 && d[p + 2] === 214) n += 1;
    }
    return n;
  }
  const boss = S.bakePixels(src, w, h, { outline: true });
  const skel = S.bakePixels(src, w, h, { skel: true });
  const crowd = S.bakePixels(src, w, h, {});
  if (magenta(boss) < 8) fail('boss outline missing, magenta ' + magenta(boss));
  if (magenta(skel) !== 0 || magenta(crowd) !== 0) fail('magenta leaked onto a non-boss');
  const rimPx = [skel.data[body], skel.data[body + 1], skel.data[body + 2]];
  if (rimPx[0] === 255 && rimPx[1] === 90 && rimPx[2] === 214) fail('rim used the boss colour');
  if (rimPx[0] === 120 && rimPx[1] === 120 && rimPx[2] === 120) fail('skeleton recolour did not bake');
  if (!S.skelOn()) fail('skel=1 was off');
  const sized = boot(1);
  sized.__svStart();
  sized.__svSpawn('brute', 2, 0, 'warden');
  sized.__svSpawn('brute', -2, 0, 'demon');
  const scales = sized.__svScales();
  scales.forEach((en) => {
    if (!en.boss) return;
    if (en.scale < 1.5) fail(en.kind + ' scale ' + en.scale);
  });
  const warden = scales.filter((en) => en.kind === 'warden')[0];
  const demon = scales.filter((en) => en.kind === 'demon')[0];
  if (!warden || Math.abs(warden.radius - (0.78 / 0.9) * 1.5) > 0.001) fail('warden hitbox ' + (warden && warden.radius));
  if (!demon || Math.abs(demon.radius - 0.9 * 1.5) > 0.001) fail('demon hitbox ' + (demon && demon.radius));
  game.__svStart();
  let snap = game.__svSnap();
  for (let i = 0; i < 80 && snap.time < 148.2; i++) {
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup' || snap.state === 'hermit') snap = game.__svDismiss();
  }
  if (!snap.banner || snap.banner.indexOf('Grave Warden') < 0) fail('warden banner ' + snap.banner);
  if (snap.boss) fail('warden spawned inside the warning');
  const later = boot(1, '?headless=1&debug=1&t=297');
  later.__svStart();
  let demonSnap = later.__svSnap();
  for (let i = 0; i < 40 && demonSnap.time < 298.2; i++) {
    demonSnap = later.__svStep(0.05);
    if (demonSnap.state === 'levelup' || demonSnap.state === 'hermit') demonSnap = later.__svDismiss();
  }
  if (!demonSnap.banner || demonSnap.banner.indexOf('Risen Demon') < 0) fail('demon banner ' + demonSnap.banner);
  console.log('boss outline, scale, and warning');
}

function rexMetrics() {
  const rows = [];
  for (let seed = 1; seed <= 8; seed++) {
    const game = boot(seed, '?headless=1&debug=1&walk=circle&seed=' + seed);
    game.__svStart();
    const view = game.__svView(390, 844, 3);
    const marks = {};
    let snap = game.__svSnap();
    const want = [8, 60, 90, 180, 240, 300, 480];
    let wi = 0;
    for (let n = 0; n < 20000 && wi < want.length; n++) {
      snap = game.__svStep(0.05);
      if (snap.state === 'hermit') snap = game.__svDecline();
      if (snap.state === 'levelup') {
        const ids = game.__svOffers();
        const owned = snap.owned || {};
        const order = [];
        if ((owned.orbit || 0) >= 5 && !(owned.tempo > 0)) order.push('tempo');
        else if ((owned.orbit || 0) >= 3 && !(owned.tempo > 0)) order.push('tempo');
        if ((owned.tempo || 0) > 0 && (owned.orbit || 0) < 5) order.push('orbit');
        if ((owned.nova || 0) >= 5 && !(owned.cinder > 0)) order.push('cinder');
        if ((owned.cinder || 0) > 0 && (owned.nova || 0) < 5) order.push('nova');
        order.push('orbit', 'tempo', 'nova', 'cinder', 'bolt', 'vitality', 'might', 'pierce', 'haste', 'area');
        if (snap.life < snap.maxLife * 0.55) order.unshift('heal', 'vitality');
        else if (snap.life < snap.maxLife * 0.8) order.unshift('vitality');
        let pick = 0;
        for (let p = 0; p < order.length; p++) {
          const at = ids.indexOf(order[p]);
          if (at >= 0) { pick = at; break; }
        }
        snap = game.__svChoose(pick);
      }
      if (snap.state === 'dead' || snap.state === 'won') break;
      while (wi < want.length && snap.time >= want[wi]) {
        marks[want[wi]] = {
          t: Number(snap.time.toFixed(1)),
          ups: snap.levelUps,
          on: game.__svOnScreen(),
          n: snap.enemies,
          kills: snap.kills,
          drops: snap.drops,
          rareAt: snap.rareAt < 0 ? null : Number(snap.rareAt.toFixed(1)),
          epicAt: snap.epicAt < 0 ? null : Number(snap.epicAt.toFixed(1)),
          legendAt: snap.legendAt < 0 ? null : Number(snap.legendAt.toFixed(1)),
          legends: snap.legendDrops,
          elites: snap.elites,
          hp: Math.round(snap.life),
          max: snap.maxLife,
          state: snap.state,
          demon: snap.demonLegend,
          boss: snap.boss,
          bands: game.__svBands(),
        };
        wi += 1;
      }
    }
    let demonMint = '';
    try { demonMint = game.SurvivorSave.mintDrop('demon').rarity; } catch (e) { demonMint = 'err'; }
    rows.push({ seed: seed, view: view, end: snap.state, endT: Number(snap.time.toFixed(1)), demonMint: demonMint, marks: marks });
    console.log('seed', seed, snap.state, snap.time.toFixed(1), snap.lastHit, 'hp', Math.round(snap.life));
  }
  const line = (label, pick) => label + ' ' + rows.map(pick).join(' ');
  console.log(line('lv1', (r) => (r.marks[8] && r.marks[8].ups >= 1 ? 'Y' : 'N')));
  console.log(line('ups60', (r) => (r.marks[60] ? r.marks[60].ups : '-')));
  console.log(line('on60', (r) => (r.marks[60] ? r.marks[60].on : '-')));
  console.log(line('on180', (r) => (r.marks[180] ? r.marks[180].on : '-')));
  console.log(line('on480', (r) => (r.marks[480] ? r.marks[480].on : '-')));
  console.log(line('n180', (r) => (r.marks[180] ? r.marks[180].n : '-')));
  console.log(line('n480', (r) => (r.marks[480] ? r.marks[480].n : '-')));
  console.log(line('k180', (r) => (r.marks[180] ? r.marks[180].kills : '-')));
  console.log(line('drops', (r) => (r.marks[480] ? r.marks[480].drops : '-')));
  console.log(line('rare', (r) => (r.marks[480] ? r.marks[480].rareAt : '-')));
  console.log(line('epic', (r) => (r.marks[480] ? r.marks[480].epicAt : '-')));
  console.log(line('leg', (r) => (r.marks[480] ? r.marks[480].legends + '@' + r.marks[480].legendAt : '-')));
  console.log(line('elites', (r) => (r.marks[480] ? r.marks[480].elites : '-')));
  console.log(line('end', (r) => r.end + r.endT));
  console.log(line('mint', (r) => r.demonMint));
}

function chestAtCap() {
  const game = boot(3, '?headless=1&debug=1');
  const fx = game.FX;
  const live = new Set();
  const kills = [];
  const beam = fx.beam.bind(fx);
  const off = fx.beamOff.bind(fx);
  const kill = fx.kill.bind(fx);
  fx.beam = (id, x, y, rarity) => { live.add(String(id)); return beam(id, x, y, rarity); };
  fx.beamOff = (id) => { live.delete(String(id)); return off(id); };
  fx.kill = (x, y, type, opts) => { kills.push({ type: type, color: opts && opts.color, elite: opts && opts.elite }); return kill(x, y, type, opts); };
  game.__svStart();
  game.__svSeedGems(180, 12);
  game.__svSpawn('brute', 4, 0, 'warden');
  const slain = game.__svSlay('warden');
  if (!slain.chest) fail('chest missing at gem cap, gems ' + slain.gems);
  const at = game.__svChestAt();
  const gx = at.x;
  const gy = at.y;
  game.__svPan(gx + 2.4, gy);
  for (let n = 0; n < 60; n++) {
    const step = game.__svStep(0.05);
    if (step.state === 'levelup' || step.state === 'hermit') game.__svDismiss();
  }
  const held = game.__svChestAt();
  if (!held) fail('chest vacuumed inside magnet range');
  if (Math.abs(held.x - gx) > 0.05 || Math.abs(held.y - gy) > 0.05) fail('chest moved');
  game.__svPan(held.x, held.y);
  let opened = false;
  for (let n = 0; n < 8; n++) {
    const snap = game.__svStep(0.05);
    if (!snap.chest) { opened = true; break; }
  }
  if (!opened) fail('chest did not open on contact');
  const chestKills = kills.filter((k) => k.type === 'chest');
  if (chestKills.length !== 1 || chestKills[0].elite !== true || chestKills[0].color !== '#4c7cff') {
    fail('FX.kill chest ' + JSON.stringify(chestKills));
  }
  const rares = game.__svGround().filter((g) => g.rarity === 'rare');
  if (rares.length !== 1) fail('rare entities ' + rares.length);
  if (!live.has(String(rares[0].id))) fail('rare has no beam');
  game.__svPan(rares[0].x, rares[0].y);
  let toast = '';
  for (let n = 0; n < 8; n++) {
    const snap = game.__svStep(0.05);
    if (snap.toast) toast = snap.toast;
    if (!game.__svGround().some((g) => g.id === rares[0].id)) break;
  }
  if (live.has(String(rares[0].id))) fail('beamOff did not run on pickup');
  if (toast.indexOf('Rare:') !== 0) fail('toast ' + toast);
  const bag = game.__svBag();
  if (!bag.some((item) => item.rarity === 'rare')) fail('pickup did not enter the bag');
  console.log('chest at 180 gems, ' + toast);
}

function doubleGoldCancel() {
  const game = boot(2, '?headless=1&adtest=1');
  game.__svStart();
  game.__svGoldProbe(100, 1);
  let snap = game.__svHurt(9999);
  if (snap.state !== 'dead') fail('double-gold cancel setup ' + snap.state);
  const offered = game.__svPressDouble();
  if (offered !== 'shown') fail('double offer ' + offered);
  snap = game.__svAd('gold', 'dismiss');
  if (snap.doubleLocked) fail('cancel left doubleLocked set');
  if (!snap.doubleOffered) fail('cancel did not restore the button');
  if (snap.gold !== 100) fail('cancel paid gold ' + snap.gold);
  snap = game.__svAd('gold', 'accept');
  if (snap.gold !== 200) fail('completed ad paid ' + snap.gold);
  snap = game.__svAd('gold', 'accept');
  if (snap.gold !== 200) fail('second complete paid again ' + snap.gold);
  if (snap.doubleOffered) fail('button stayed up after paying');
  const again = boot(4, '?headless=1&adtest=1');
  again.__svStart();
  again.__svGoldProbe(80, 1);
  again.__svHurt(9999);
  again.__svPressDouble();
  let back = again.__svAd('gold', 'dismiss');
  if (back.doubleLocked || !back.doubleOffered) fail('dismiss before revive ' + JSON.stringify({ locked: back.doubleLocked, offered: back.doubleOffered }));
  back = again.__svRevive();
  if (back.state !== 'playing') fail('revive ' + back.state);
  back = again.__svHurt(9999);
  if (back.state !== 'dead') fail('death after revive ' + back.state);
  if (back.doubleLocked) fail('revive left the button locked');
  if (!back.doubleOffered) fail('revive hid double gold');
  const paid = again.__svAd('gold', 'accept');
  if (paid.gold !== 160) fail('revive-path pay ' + paid.gold);
  if (paid.doubleOffered) fail('revive-path paid twice');
  console.log('double gold cancel then pay once, revive keeps the button');
}

function evoModalGate() {
  const game = boot(6, '?headless=1&debug=1');
  game.__svStart();
  game.__svOpenLevel();
  game.__svGive('orbit', 5);
  game.__svGive('tempo', 1);
  let snap = game.__svForceEvos();
  if (snap.evolved.length || snap.evolving || snap.evoSlow > 0) fail('evolution fired on the card screen');
  snap = game.__svDismiss();
  if (!snap.evolving && snap.evolved.length === 0 && !(snap.evoSlow > 0)) fail('evolution did not start when cards closed');
  const hermit = boot(6, '?headless=1&debug=1');
  hermit.__svStart();
  hermit.__svOpenHermit();
  hermit.__svGive('nova', 5);
  hermit.__svGive('cinder', 1);
  snap = hermit.__svForceEvos();
  if (snap.evolved.length || snap.evolving) fail('evolution fired while the hermit was open');
  snap = hermit.__svDecline();
  if (!snap.evolving && snap.evolved.length === 0) fail('evolution did not start when the hermit closed');
  const paused = boot(6, '?headless=1&debug=1');
  paused.__svStart();
  paused.__svPause();
  paused.__svGive('orbit', 5);
  paused.__svGive('tempo', 1);
  snap = paused.__svForceEvos();
  if (snap.state !== 'paused') fail('pause state ' + snap.state);
  if (snap.evolved.length || snap.evolving) fail('evolution fired while paused');
  snap = paused.__svResume();
  if (!snap.evolving && snap.evolved.length === 0) fail('evolution did not start on resume');
  const dead = boot(6, '?headless=1&debug=1');
  dead.__svStart();
  dead.__svHurt(9999);
  dead.__svGive('orbit', 5);
  dead.__svGive('tempo', 1);
  snap = dead.__svForceEvos();
  if (snap.evolved.length || snap.evolving) fail('evolution fired on the death screen');
  const slow = boot(8, '?headless=1&debug=1');
  slow.__svStart();
  slow.__svGive('orbit', 5);
  slow.__svGive('tempo', 1);
  snap = slow.__svForceEvos();
  if (slow.__svEvoLog().length) fail('evolution committed before the slow-mo');
  if (!(snap.evoSlow > 0)) fail('slow-mo did not start');
  const t0 = snap.time;
  for (let n = 0; n < 4; n++) snap = slow.__svStep(0.05);
  const moved = snap.time - t0;
  if (moved > 0.07 || moved < 0.04) fail('slow-mo scale ' + moved.toFixed(3) + ' over 0.2s');
  for (let n = 0; n < 12 && !snap.evolved.length; n++) snap = slow.__svStep(0.05);
  if (!snap.evolved.length) fail('evolution did not commit after 0.5s');
  const quiet = boot(8, '?headless=1&debug=1');
  quiet.__svStart();
  quiet.__svReduce(true);
  quiet.__svGive('orbit', 5);
  quiet.__svGive('tempo', 1);
  snap = quiet.__svForceEvos();
  if (!snap.evolved.length) fail('reduced motion did not evolve immediately');
  if (snap.evoSlow > 0) fail('reduced motion slowed the clock');
  if (!snap.banner) fail('reduced motion had no banner');
  console.log('evolution waits for play, then 0.5s at 30%');
}

function casterClearPaths() {
  const clock = boot(1, '?headless=1&debug=1&t=140');
  clock.__svStart();
  if (clock.__svSnap().boss) fail('clock path spawned the warden early');
  for (let i = 0; i < 5; i++) clock.__svSpawn('shooter', 2.4, (i - 2) * 0.35);
  if (clock.__svCount('shooter') !== 5) fail('clock plant ' + clock.__svCount('shooter'));
  clock.__svSetTime(149.96);
  let snap = clock.__svSnap();
  for (let n = 0; n < 6 && snap.boss !== 'Grave Warden'; n++) {
    snap = clock.__svStep(0.05);
    if (snap.state === 'levelup' || snap.state === 'hermit') snap = clock.__svDismiss();
  }
  if (snap.boss !== 'Grave Warden') fail('clock warden ' + snap.boss);
  if (clock.__svCount('shooter') !== 0) fail('clock casters left ' + clock.__svCount('shooter'));
  clock.__svSetTime(320);
  for (let n = 0; n < 30; n++) {
    snap = clock.__svStep(0.05);
    if (snap.state !== 'playing') snap = clock.__svDismiss();
  }
  if (clock.__svCount('shooter') !== 0) fail('caster spawned during the warden');
  const jump = boot(2, '?headless=1&debug=1&t=148');
  jump.__svPlantCasters(5);
  jump.__svStart();
  if (jump.__svSnap().boss !== 'Grave Warden') fail('jump warden missing');
  if (jump.__svCount('shooter') !== 0) fail('jump casters left ' + jump.__svCount('shooter'));
  if (jump.__svSnap().castersCleared < 5) fail('jump cleared ' + jump.__svSnap().castersCleared);
  console.log('warden clears casters on the clock and the t=148 jump');
}

function bossOutlinePixels() {
  const game = boot(1, '?headless=1&debug=1');
  const sprites = game.SurvivorSprites;
  if (sprites.BOSS_OUTLINE_COLOR !== '#ff5ad6' || sprites.BOSS_OUTLINE_PX !== 2) {
    fail('outline spec ' + sprites.BOSS_OUTLINE_COLOR + ' ' + sprites.BOSS_OUTLINE_PX);
  }
  const src = new Uint8ClampedArray(4 * 4 * 4);
  src[0] = 20; src[1] = 20; src[2] = 20; src[3] = 255;
  const grown = sprites.bakePixels(src, 4, 4, { outline: true });
  if (grown.w !== 8 || grown.h !== 8) fail('outline grow ' + grown.w + 'x' + grown.h);
  const corner = grown.data;
  if (corner[0] !== 0xff || corner[1] !== 0x5a || corner[2] !== 0xd6 || corner[3] !== 255) {
    fail('outline color ' + corner[0] + ',' + corner[1] + ',' + corner[2]);
  }
  game.__svStart();
  game.__svSpawn('brute', 2, 0, 'warden');
  game.__svSpawn('brute', -2, 0, 'demon');
  const tags = game.__svTags();
  if (tags.indexOf('WARDEN') < 0 || tags.indexOf('DEMON') < 0) fail('debug tags ' + tags.join(','));
  const line = game.__svDebugLine();
  if (line.indexOf('warden 1') < 0 || line.indexOf('demon 1') < 0 || line.indexOf('revival ') < 0) {
    fail('debug line ' + line);
  }
  console.log('boss outline 2px #ff5ad6, labels ' + tags.join(' '));
}

function telegraphHook() {
  const game = boot(3, '?headless=1&debug=1&t=140');
  const calls = [];
  const offs = [];
  game.FX.telegraph = (id, x, y, ms) => { calls.push({ id: id, x: x, y: y, ms: ms }); };
  game.FX.telegraphOff = (id) => { offs.push(id); };
  game.__svStart();
  game.__svSpawn('shooter', 4, 0);
  let told = false;
  for (let n = 0; n < 40 && !told; n++) {
    game.__svStep(0.05);
    if (calls.some((c) => c.ms === 700)) told = true;
  }
  if (!told) fail('shooter tell did not telegraph');
  const id = calls[0].id;
  game.__svSlay('shooter');
  if (offs.indexOf(id) < 0) fail('telegraphOff missed ' + id + ' offs ' + offs.join(','));
  console.log('telegraph 700ms and telegraphOff on death');
}

function pickCard(game, snap) {
  const ids = game.__svOffers();
  const owned = snap.owned || {};
  const order = [];
  if ((owned.orbit || 0) < 5) order.push('orbit');
  if ((owned.orbit || 0) >= 3 && !(owned.tempo > 0)) order.push('tempo');
  if ((owned.tempo || 0) > 0 && (owned.orbit || 0) < 5) order.push('orbit');
  order.push('bolt', 'might', 'vitality', 'pierce', 'haste', 'armor', 'nova', 'area');
  if ((owned.nova || 0) >= 5 && !(owned.cinder > 0)) order.push('cinder');
  if ((owned.cinder || 0) > 0 && (owned.nova || 0) < 5) order.push('nova');
  if (snap.life < snap.maxLife * 0.28) order.unshift('heal');
  let pick = 0;
  for (let p = 0; p < order.length; p++) {
    const at = ids.indexOf(order[p]);
    if (at >= 0) { pick = at; break; }
  }
  return game.__svChoose(pick);
}

function watchRun(game, limit, kite) {
  game.__svStart();
  game.__svView(390, 844, 3);
  let snap = game.__svSnap();
  let evo = null;
  let wardenSpawn = null;
  let wardenKill = null;
  let demonSpawn = null;
  let demonKill = null;
  let sawWarden = false;
  let sawDemon = false;
  let onSum = 0;
  let onN = 0;
  let on60 = null;
  let on360 = null;
  let death = null;
  let lastHit = '';
  let minLate = 1;
  const steps = Math.ceil(limit / 0.05) + 40;
  for (let n = 0; n < steps; n++) {
    snap = game.__svStep(0.05);
    if (!kite && snap.state === 'hermit') snap = game.__svDecline();
    if (!kite && snap.state === 'levelup') {
      if (!evo && snap.evolved && snap.evolved.length) evo = snap.time;
      snap = pickCard(game, snap);
    }
    if (!evo && snap.evolved && snap.evolved.length) evo = snap.time;
    if (!sawWarden && snap.boss === 'Grave Warden') {
      sawWarden = true;
      wardenSpawn = snap.time;
    }
    if (sawWarden && wardenKill == null && snap.boss !== 'Grave Warden') wardenKill = snap.time;
    if (!sawDemon && snap.boss === 'Risen Demon') {
      sawDemon = true;
      demonSpawn = snap.time;
    }
    if (sawDemon && demonKill == null && snap.boss !== 'Risen Demon') demonKill = snap.time;
    if (snap.time >= 45 && snap.time <= 75) {
      onSum += game.__svOnScreen();
      onN += 1;
      if (on60 == null && snap.time >= 60) on60 = game.__svOnScreen();
    }
    if (on360 == null && snap.time >= 360) on360 = game.__svOnScreen();
    if (snap.time >= 420 && snap.maxLife > 0) {
      const ratio = snap.life / snap.maxLife;
      if (ratio < minLate) minLate = ratio;
    }
    if (snap.state === 'dead' || snap.state === 'won') {
      death = snap.time;
      lastHit = snap.lastHit;
      break;
    }
    if (snap.time > limit) break;
  }
  return {
    end: death == null ? ('alive@' + snap.time.toFixed(1)) : death.toFixed(1),
    state: snap.state,
    hit: lastHit,
    evo: evo == null ? null : evo,
    wardenSpawn: wardenSpawn,
    wardenKill: wardenKill,
    demonSpawn: demonSpawn,
    demonKill: demonKill,
    avgOn: onN ? onSum / onN : null,
    on60: on60,
    on360: on360,
    minLate: minLate,
    life: Math.round(snap.life),
    max: snap.maxLife,
  };
}

function balanceTable() {
  const want = (process.env.SEEDS || '1,2,3,4,5,6,7,8').split(',').map((n) => Number(n));
  const idle = {};
  want.forEach((seed) => {
    const game = boot(seed);
    game.__svStart();
    let deadAt = null;
    for (let i = 0; i < 1600; i++) {
      const snap = game.__svIdleStep(0.05);
      if (snap.state === 'dead') { deadAt = snap.time; break; }
    }
    idle[seed] = deadAt == null ? 'alive' : deadAt.toFixed(1);
  });
  const rows = [];
  want.forEach((seed) => {
    const circle = watchRun(boot(seed, '?headless=1&debug=1&walk=circle&seed=' + seed), 560, false);
    const kite = watchRun(boot(seed, '?headless=1&debug=1&walk=kite&seed=' + seed), 610, true);
    const ttk = (a, b) => (a != null && b != null) ? (b - a).toFixed(1) : '-';
    const row = {
      seed: seed,
      idle: idle[seed],
      circle: circle.end,
      circleHit: circle.hit,
      kite: kite.end,
      kiteState: kite.state,
      kiteHit: kite.hit,
      kiteHp: kite.life + '/' + kite.max,
      kiteMin: kite.minLate == null ? '-' : Math.round(kite.minLate * 100) + '%',
      evo: circle.evo == null ? '-' : circle.evo.toFixed(1),
      wardenTtk: ttk(circle.wardenSpawn, circle.wardenKill),
      demonTtk: ttk(circle.demonSpawn, circle.demonKill),
      avgOn: circle.avgOn == null ? '-' : circle.avgOn.toFixed(1),
      on60: circle.on60 == null ? '-' : String(circle.on60),
      on360: circle.on360 == null ? '-' : String(circle.on360),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  });
  console.log('seed idle circle hit kite kiteHit kiteMin kiteHp evo wardenTtk demonTtk avgOn on60 on360');
  rows.forEach((r) => {
    console.log([r.seed, r.idle, r.circle, r.circleHit, r.kite, r.kiteHit, r.kiteMin, r.kiteHp, r.evo, r.wardenTtk, r.demonTtk, r.avgOn, r.on60, r.on360].join(' '));
  });
}

if (process.env.METRICS === '1') {
  rexMetrics();
  process.exit(0);
}

if (process.env.BALANCE === '1') {
  balanceTable();
  process.exit(0);
}

tapGuards();
evoNeeds();
freshAndFlags();
bossLook();
saveOnQuit();
wardenHitFloor();
earlyCrowd();
lootCadence();
idleDeath();
groundCap();
chestAtCap();
doubleGoldCancel();
evoModalGate();
casterClearPaths();
bossOutlinePixels();
telegraphHook();
vows();
forcedVow();
hermitTwice();
vowRevive();
twoEvos();
secondChance();
secondChanceThreeRuns();
boughtSecondChance();
strideRefresh();
doubleGoldOnce();
vowsCompletedOnly();
bossWarning();
casterBurst();
evoTagHides();
wholeHp();
gemMerge();
greedCarry();
flashCap();
bossDuel('warden', '?headless=1&debug=1&t=150&walk=circle', 'Grave Warden');
bossDuel('demon', '?headless=1&debug=1&t=295&walk=circle', 'Risen Demon');
plainToolsIgnored();
evolveByThree();
evolveBefore215();
novas();
const canon = levelTimeline(7);
console.log('survivor sim ok', canon.join(', '));
