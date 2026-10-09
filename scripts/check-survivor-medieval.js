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
      parentElement: { clientWidth: 390, clientHeight: 844 }, // phone portrait, like the testers
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
    innerWidth: 390,
    innerHeight: 844,
    devicePixelRatio: 2,
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


// Medieval demo (?mode=medieval), stepped at 60 fps like the browser. Bots
// take their own picks (no skipped level-ups):
// - walk=kite: kites and dodges Malgrath's telegraphs. Must win every seed.
// - walk=circle: a fixed circle with sensible picks. Must win at least half.
// Both: first evolution by 1:30, no second evolution before Malgrath, boss
// at 5:00, his fight at least 45 s, and no level-up gap over 25 s before 5:00.
function medievalRun(seed, walk) {
  const g = boot(seed, '?headless=1&debug=1&walk=' + walk + '&mode=medieval&autopick=1');
  g.__svStart();
  let s = g.__svSnap();
  let evoAt = null;
  let evo2At = null;
  let bossAt = null;
  let bossEnd = null;
  let lv = s.level;
  let lastUp = 0;
  let gap = 0;
  let minHp = 1;
  const step = 1 / 60;
  for (let i = 0; i < 700 * 60; i++) {
    s = g.__svStep(step);
    if (s.state === 'hermit') s = g.__svDismiss();
    if (s.level > lv) {
      lv = s.level;
      if (s.time < 300) { gap = Math.max(gap, s.time - lastUp); lastUp = s.time; }
    }
    minHp = Math.min(minHp, s.life / s.maxLife);
    if (evoAt == null && s.evolved && s.evolved.length) evoAt = s.time;
    if (evo2At == null && s.evolved && s.evolved.length > 1) evo2At = s.time;
    if (bossAt == null && s.boss) bossAt = s.time;
    if (bossAt != null && bossEnd == null && !s.boss) bossEnd = s.time;
    if (s.state === 'dead' || s.state === 'won') break;
  }
  if (bossAt != null && bossEnd == null) bossEnd = s.time;
  if (s.time >= 300) gap = Math.max(gap, 300 - lastUp);
  return { walk, seed, state: s.state, time: s.time, evoAt, evo2At, bossAt, fight: bossAt != null ? bossEnd - bossAt : null, gap, minHp, gold: s.gold };
}

const results = [];
for (const walk of ['kite', 'circle']) {
  for (let seed = 1; seed <= 4; seed++) {
    const r = medievalRun(seed, walk);
    results.push(r);
    const tag = 'medieval ' + walk + ' seed ' + seed;
    if (r.evoAt == null || r.evoAt > 90) fail(tag + ' evolution at ' + r.evoAt);
    if (r.evo2At != null && r.bossAt != null && r.evo2At < r.bossAt) fail(tag + ' second evolution before Malgrath at ' + r.evo2At);
    if (r.bossAt == null || r.bossAt < 299.9 || r.bossAt > 300.5) fail(tag + ' boss at ' + r.bossAt);
    if (r.state === 'won' && r.fight < 45) fail(tag + ' Malgrath died in ' + r.fight.toFixed(1) + 's');
    if (r.gap > 25) fail(tag + ' level-up gap ' + r.gap.toFixed(1) + 's');
  }
}
const kiteWins = results.filter((r) => r.walk === 'kite' && r.state === 'won').length;
const circleWins = results.filter((r) => r.walk === 'circle' && r.state === 'won').length;
if (kiteWins < 4) fail('medieval kite bot won ' + kiteWins + '/4: ' + JSON.stringify(results));
if (circleWins < 2) fail('medieval circle walker won ' + circleWins + '/4: ' + JSON.stringify(results));
console.log('medieval ok: kite ' + kiteWins + '/4, circle ' + circleWins + '/4; ' + results.map((r) => r.walk[0] + r.seed + ' ' + r.state[0] + ' ' + r.time.toFixed(0) + 's min' + Math.round(r.minHp * 100) + '% fight ' + (r.fight == null ? '-' : r.fight.toFixed(0)) + 's gap ' + r.gap.toFixed(0) + 's ' + r.gold + 'g').join('; '));
