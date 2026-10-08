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
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
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

function bossDuel(label, search, name) {
  const game = boot(7, search);
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
  if (fight < 20 || fight > 45) fail(label + ' fight ' + fight.toFixed(1) + 's (want 20-45)');
  if (!snap.chest) fail(label + ' died without a chest');
  console.log(label + ' died in ' + fight.toFixed(1) + 's, chest dropped');
  return fight;
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

idleDeath();
vows();
hermitTwice();
vowRevive();
twoEvos();
secondChance();
wholeHp();
gemMerge();
flashCap();
bossDuel('warden', '?headless=1&debug=1&t=150&walk=circle', 'Grave Warden');
bossDuel('demon', '?headless=1&debug=1&t=295&walk=circle', 'Risen Demon');
plainToolsIgnored();
evolveByThree();
novas();
const canon = levelTimeline(7);
console.log('survivor sim ok', canon.join(', '));
