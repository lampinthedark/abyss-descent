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

function boot(seed0) {
  let seed = (seed0 == null ? 1 : seed0) >>> 0;
  const math = Object.create(Math);
  math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const context = {
    console, Math: math, Date, Number, String, JSON, parseInt, Array, Object, isNaN,
    navigator: { doNotTrack: '1', sendBeacon: () => false },
    location: { search: '?headless=1' },
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
    if (seen > 60) fail('vow late in run ' + (n + 1) + ': ' + seen);
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

idleDeath();
vows();
novas();
const canon = levelTimeline(7);
console.log('survivor sim ok', canon.join(', '));
