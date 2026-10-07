'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function load(names, extra) {
  const context = {
    console,
    Math,
    Date,
    Number,
    String,
    parseInt,
    performance: { now: () => 0 },
    navigator: { doNotTrack: '1', sendBeacon: () => false },
    location: { search: '' },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      addEventListener() {},
      visibilityState: 'visible',
      getElementById: () => null,
      querySelectorAll: () => [],
    },
  };
  Object.assign(context, extra || {});
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const name of names) {
    vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
  }
  vm.runInContext(
    [
      'Utils', 'MapGen', 'Classes', 'Skills', 'Entities', 'Quests', 'Analytics', 'Ads',
    ].map(n => 'if (typeof ' + n + ' !== "undefined") this.' + n + ' = ' + n + ';').join('\n'),
    context
  );
  return context;
}

const game = load([
  'js/utils.js',
  'js/map.js',
  'js/classes.js',
  'js/skills.js',
  'js/entities.js',
  'js/quests.js',
  'js/analytics.js',
]);

const { Utils, MapGen, Entities, Quests, Analytics, Classes } = game;

if (Math.round(10.5) !== 11 || Math.floor(10.5) !== 10) {
  fail('tile-center rounding assumption changed');
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function tileAt(map, dx, dy, minR, maxR) {
  const sx = Math.floor(map.stairsX);
  const sy = Math.floor(map.stairsY);
  for (let r = minR; r <= maxR; r++) {
    const x = sx + dx * r;
    const y = sy + dy * r;
    const px = x + 0.5;
    const py = y + 0.5;
    if (map.grounded(px, py) && !map.isStairs(px, py)) return { x: px, y: py };
  }
  return null;
}

function walk(map, x, y, path, speed) {
  let px = x;
  let py = y;
  const pending = path.slice();
  let stepped = map.isStairs(px, py);
  const dt = 1 / 20;
  for (let i = 0; i < 900 && pending.length; i++) {
    const next = pending[0];
    const dx = next.x - px;
    const dy = next.y - py;
    const dist = Math.hypot(dx, dy);
    const step = speed * dt;
    if (dist <= step + 0.05) {
      px = next.x;
      py = next.y;
      pending.shift();
    } else {
      px += (dx / dist) * step;
      py += (dy / dist) * step;
    }
    if (map.isStairs(px, py)) stepped = true;
  }
  return { x: px, y: py, stepped, left: pending.length };
}

let approaches = 0;
let adjacent = 0;
for (let n = 0; n < 8; n++) {
  const map = MapGen.create(1);
  if (Math.round(map.stairsX) === Math.floor(map.stairsX)) {
    fail('stairs are not on a tile center');
  }
  const speeds = [Classes.get('warrior').base.move, Classes.get('sorcerer').base.move];
  for (const [dx, dy] of DIRS) {
    const far = tileAt(map, dx, dy, 2, 6);
    if (far) {
      const step = MapGen.approachPortal(map, far.x, far.y);
      if (step.snap) fail('a distant portal click snapped');
      const last = step.path[step.path.length - 1];
      if (!last || !map.isStairs(last.x, last.y)) {
        fail('portal path does not end on the stair tile');
      }
      if (last.x === Math.round(map.stairsX) + 0.5 || last.y === Math.round(map.stairsY) + 0.5) {
        if (Math.floor(last.x) !== Math.floor(map.stairsX) || Math.floor(last.y) !== Math.floor(map.stairsY)) {
          fail('portal path still uses the rounded tile past the stairs');
        }
      }
      for (const speed of speeds) {
        const arrived = walk(map, far.x, far.y, step.path, speed);
        if (!arrived.stepped || arrived.left) {
          fail('walk from ' + dx + ',' + dy + ' at speed ' + speed + ' missed the portal');
        }
        approaches++;
      }
    }
    const beside = tileAt(map, dx, dy, 1, 1);
    if (beside) {
      const step = MapGen.approachPortal(map, beside.x, beside.y);
      if (!step.snap || !map.isStairs(step.x, step.y)) {
        fail('adjacent portal click did not land on the stairs');
      }
      adjacent++;
    }
  }

  const spot = tileAt(map, 1, 0, 3, 8) || { x: map.startX, y: map.startY };
  const clickX = Math.floor(spot.x) + 0.8;
  const clickY = Math.floor(spot.y) + 0.2;
  const ground = MapGen.routeTo(map, map.startX, map.startY, clickX, clickY);
  const end = ground[ground.length - 1];
  if (!end || Math.floor(end.x) !== Math.floor(clickX) || Math.floor(end.y) !== Math.floor(clickY)) {
    fail('ground click path missed the clicked tile');
  }

  const npc = MapGen.placeBeside(map, map.stairsX, map.stairsY);
  const toNpc = MapGen.routeTo(map, map.startX, map.startY, npc.x, npc.y);
  const npcEnd = toNpc[toNpc.length - 1];
  if (!npcEnd || Math.floor(npcEnd.x) !== Math.floor(npc.x) || Math.floor(npcEnd.y) !== Math.floor(npc.y)) {
    fail('NPC path missed the NPC tile');
  }

  const wave = Entities.spawnWave(map, 1);
  if (wave.length !== 6) fail('Floor 1 spawned ' + wave.length + ' enemies, expected 6');
  const counts = {};
  for (const en of wave) counts[en.eid] = (counts[en.eid] || 0) + 1;
  if (counts.skel !== 4 || counts.imp !== 1 || counts.brute !== 1) {
    fail('Floor 1 mix changed: ' + JSON.stringify(counts));
  }
  for (const en of wave) {
    if (en.eid === 'skel' && en.maxLife !== 54) fail('skeleton HP changed');
    if (en.eid === 'imp' && en.maxLife !== 45) fail('imp HP changed');
    if (en.eid === 'brute' && en.maxLife !== 113) fail('brute HP changed');
  }
  let packed = false;
  for (let i = 0; i < wave.length && !packed; i++) {
    const group = wave.filter(e => Math.hypot(e.x - wave[i].x, e.y - wave[i].y) <= 4.6);
    if (group.length >= 3) packed = true;
  }
  if (!packed) fail('Floor 1 opening pack is not clustered');
}

if (approaches < 32) fail('too few portal approaches were checked: ' + approaches);
if (adjacent < 8) fail('too few adjacent portal clicks were checked: ' + adjacent);

const bare = {};
if (Quests.portalGate(bare, 1) !== null) fail('a clear floor with no vow should descend');
bare.quests = { active: { silence: { id: 'silence', have: 0, need: 3, step: 'hunt' } }, done: {} };
const gate = Quests.portalGate(bare, 1);
if (!gate || !gate.actions.some(a => a.id === 'portal-descend') || !gate.actions.some(a => a.id === 'portal-stay')) {
  fail('an open vow should prompt at the portal');
}

const names = [];
for (let f = 1; f <= 10; f++) names.push(Analytics.floorEventName(f));
names.push(Analytics.floorEventName(11));
names.push(Analytics.floorEventName(40));
const expect = [];
for (let f = 1; f <= 10; f++) expect.push('floor-' + f + '-entered');
expect.push('floor-10-plus-entered', 'floor-10-plus-entered');
if (names.join('|') !== expect.join('|')) fail('floor event names: ' + names.join('|'));
if (Analytics.floorEventName(0) !== '') fail('floor 0 should not emit');

const adsOff = load(['js/ads.js'], {
  location: { search: '' },
  document: fakeDocument(),
});
if (adsOff.Ads.offerRevive() !== 'unavailable') fail('ads should stay unavailable without ?adtest=1');

const doc = fakeDocument();
const adsOn = load(['js/ads.js'], {
  location: { search: '?adtest=1' },
  document: doc,
});
if (doc._nodes['adtest-panel'].classList.contains('hidden')) fail('?adtest=1 should show the panel');
if (adsOn.Ads.offerRevive() !== 'shown') fail('?adtest=1 should show a placeholder');
if (doc._nodes['adtest-prompt'].classList.contains('hidden')) fail('placeholder prompt stayed hidden');
adsOn.Ads.setCombat(() => true);
if (adsOn.Ads.offerReroll() !== 'held') fail('combat should hold the ad prompt');
if (!doc._nodes['adtest-held'].textContent.includes('held: in combat')) fail('held label missing');

const src = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
if (!src.includes('backButton') || !src.includes('appStateChange') || !src.includes('holdMute')) {
  fail('game.js is missing back-button or background pause wiring');
}
if (src.includes("addEventListener('popstate'")) fail('web back must not hook history');
const audio = fs.readFileSync(path.join(root, 'js/audio.js'), 'utf8');
if (!audio.includes('function holdMute') || audio.includes('localStorage.setItem(KEY, heldMute')) {
  fail('holdMute must not write the mute preference');
}

function fakeDocument() {
  const nodes = {};
  function make(id) {
    const el = {
      id,
      classList: {
        _hidden: id !== 'adtest-held' ? true : true,
        toggle(name, on) { if (name === 'hidden') this._hidden = !!on; },
        add(name) { if (name === 'hidden') this._hidden = true; },
        remove(name) { if (name === 'hidden') this._hidden = false; },
        contains(name) { return name === 'hidden' && this._hidden; },
      },
      textContent: '',
      querySelector() { return { textContent: '' }; },
      addEventListener() {},
    };
    return el;
  }
  return {
    _nodes: nodes,
    addEventListener() {},
    visibilityState: 'visible',
    getElementById(id) { return nodes[id] || (nodes[id] = make(id)); },
    querySelectorAll: () => [],
  };
}

console.log('routing ok: ' + approaches + ' portal walks, ' + adjacent + ' adjacent snaps');
