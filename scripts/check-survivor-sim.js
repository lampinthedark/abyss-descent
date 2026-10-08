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

function boot(seed0, search) {
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
    localStorage: memoryStorage(),
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
  if (typeof context.__svStart !== 'function') fail('headless survivor did not boot');
  return context;
}

function idleDeath() {
  const game = boot();
  game.__svStart();
  let deadAt = null;
  for (let t = 0; t < 190; t += 0.05) {
    const snap = game.__svIdleStep(0.05);
    if (snap.state === 'dead') {
      deadAt = snap.time;
      break;
    }
  }
  if (deadAt == null) fail('idle hero was still alive at 3:00');
  if (deadAt < 105) fail('idle hero died too early at ' + deadAt.toFixed(1) + 's');
  if (deadAt > 180) fail('idle hero died after 3:00 at ' + deadAt.toFixed(1) + 's');
  console.log('idle death ' + deadAt.toFixed(1) + 's');
  return deadAt;
}

function vows() {
  for (let n = 0; n < 3; n++) {
    const game = boot(20 + n * 17);
    game.__svStart();
    let seen = false;
    for (let i = 0; i < 1400; i++) {
      let snap = game.__svStep(0.05);
      if (snap.state === 'levelup') snap = game.__svChoose(0);
      if (snap.vowSeen || snap.state === 'hermit') {
        seen = snap.time;
        break;
      }
      if (snap.time > 60 || snap.state === 'dead') break;
    }
    if (!seen) fail('vow missing in run ' + (n + 1));
    if (seen < 20 || seen > 45) fail('vow outside 0:20-0:45 in run ' + (n + 1) + ': ' + seen);
  }
  console.log('vow offered within 60s in 3 runs');
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
  if (early.length < 5 || early.length > 7) fail('expected 5 to 7 level-ups in 2 minutes, got ' + early.length);
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= 120) continue;
    const gap = times[i] - times[i - 1];
    if (gap < 18 || gap > 40) fail('late level gap ' + gap.toFixed(1) + 's at ' + times[i]);
  }
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
  if (times[0] < 20 || times[0] > 45) fail('first hermit at ' + times[0]);
  const gap = times[1] - times[0];
  if (gap < 70 || gap > 85) fail('second hermit gap ' + gap.toFixed(1));
  console.log('hermit offers', times.join(', '));
}

function vowRevive() {
  const game = boot(5);
  game.__svStart();
  let snap = game.__svSnap();
  for (let i = 0; i < 2000; i++) {
    snap = game.__svStep(0.05);
    if (snap.state === 'levelup') snap = game.__svChoose(0);
    if (snap.state === 'hermit') break;
    if (snap.time > 50) fail('vow revive never saw the hermit');
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
  for (let i = 0; i < 16; i++) game.__svStep(0.05);
  const log = game.__svEvoLog();
  const ids = log.map((row) => row.id).sort();
  if (ids.join(',') !== 'halo,storm') fail('evolution log ' + JSON.stringify(log));
  if (log.length < 2 || log[0].tick === log[1].tick) fail('evolutions landed on the same step ' + JSON.stringify(log));
  console.log('evolutions', JSON.stringify(log));
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
    if (snap.state === 'dead') fail(label + ' hero died at ' + snap.time.toFixed(1) + ' boss ' + snap.bossLife);
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
    game.__svPan(at.x, at.y);
    let got = false;
    for (let n = 0; n < 20; n++) {
      const picked = game.__svStep(0.05);
      if (!picked.chest) { got = true; break; }
    }
    if (!got) fail('hero could not collect the chest');
    const bag = game.__svBag();
    if (!bag.some((item) => item.rarity === 'rare')) fail('chest did not grant a rare: ' + bag.map((item) => item.rarity).join(','));
    console.log('chest arrow and pickup, ' + bag.map((item) => item.rarity).join(','));
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
  for (let i = 0; i < 2000; i++) {
    snap = dead.__svStep(0.05);
    if (snap.state === 'levelup') snap = dead.__svChoose(0);
    if (snap.state === 'hermit') break;
    if (snap.time > 50) fail('vow-death run missed the hermit');
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
  for (let i = 0; i < 2000; i++) {
    snap = lived.__svStep(0.05);
    if (snap.state === 'levelup') snap = lived.__svChoose(0);
    if (snap.state === 'hermit') break;
    if (snap.time > 50) fail('vow-clear run missed the hermit');
  }
  snap = lived.__svAccept();
  if (!snap.vowBadge) fail('badge missing during the vow');
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
  if (snap.vowBadge) fail('badge stayed after the vow ended');
  console.log('completed vow counted ' + snap.vowsSurvived);
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

idleDeath();
vows();
hermitTwice();
vowRevive();
twoEvos();
secondChance();
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
