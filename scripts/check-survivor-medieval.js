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


// Medieval demo (?mode=medieval): the kite bot must get the first evolution by
// 1:30, meet Malgrath at 5:00, and kill him into a victory screen.
function medievalRun(seed) {
  const g = boot(seed, '?headless=1&debug=1&walk=kite&mode=medieval');
  g.__svStart();
  let s = g.__svSnap();
  let evoAt = null;
  let bossAt = null;
  for (let i = 0; i < 12000; i++) {
    s = g.__svStep(0.05);
    if (s.state === 'levelup' || s.state === 'hermit') s = g.__svDismiss();
    if (evoAt == null && s.evolved && s.evolved.length) evoAt = s.time;
    if (bossAt == null && s.boss) bossAt = s.time;
    if (s.state === 'dead' || s.state === 'won') break;
  }
  return { state: s.state, time: s.time, evoAt, bossAt, gold: s.gold, kills: s.kills, boss: s.boss };
}

const results = [];
for (let seed = 1; seed <= 4; seed++) {
  const r = medievalRun(seed);
  results.push(r);
  if (r.evoAt == null || r.evoAt > 90) fail('medieval seed ' + seed + ' evolution at ' + r.evoAt);
  if (r.bossAt == null || r.bossAt < 299.9 || r.bossAt > 300.5) fail('medieval seed ' + seed + ' boss at ' + r.bossAt);
}
const wins = results.filter((r) => r.state === 'won');
if (wins.length < 3) fail('medieval bot won ' + wins.length + '/4: ' + JSON.stringify(results));
console.log('medieval ok: evo ' + results.map((r) => r.evoAt.toFixed(1)).join(', ') + '; boss 5:00; wins ' + wins.length + '/4 at ' + wins.map((r) => r.time.toFixed(0) + 's/' + r.gold + 'g').join(', '));
