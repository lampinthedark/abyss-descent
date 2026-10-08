'use strict';

/**
 * Headless checks for the dungeon / boss slice.
 *   node scripts/check-rpg-ai.js
 * Also runs at the end of npm test.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
  'js/rpg/ai-attacks.js',
  'js/rpg/ai-monsters.js',
  'js/rpg/drops.js',
  'js/rpg/death-recap.js',
  'js/rpg/boss-ashmaw.js',
  'js/rpg/dungeon.js',
];

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL: ' + msg);
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  assert(!/Math\.random/.test(text), rel + ' must not call Math.random');
  assert(!/runescape|jagex|osrs/i.test(text), rel + ' must not use those trademark names');
  assert(!/shield phase/i.test(text) || /do not add/i.test(text), rel + ' must not implement a boss shield');
}

const fxLog = [];
const pathCalls = [];
const zoneLoads = [];
const entities = [];
const bus = {};
let rngValue = 0.1;
let uiRecap = null;
const lootCalls = [];

const context = {
  console,
  Math,
  Date,
  Number,
  String,
  Object,
  Array,
  Error,
  JSON,
  parseInt,
  isNaN,
};
context.window = context;
context.globalThis = context;

const hero = {
  x: 0,
  y: 0,
  hp: 100,
  maxHp: 100,
  radius: 0.3,
  dead: false,
  inventory: [],
  takeHit(dmg) { this.hp -= dmg; },
};

context.RPG = {
  hero,
  sheet: null,
  fx(name) {
    const args = [];
    for (let i = 1; i < arguments.length; i++) args.push(arguments[i]);
    fxLog.push({ name, args });
  },
  rng() {
    return function () { return rngValue; };
  },
  registerSystem(name, fn) {
    context.RPG._system = { name, fn };
  },
  registerTappable(ent) {
    ent._tappable = true;
  },
  world: {
    entities,
    addEntity(e) { entities.push(e); return e; },
    removeEntity(e) {
      const i = entities.indexOf(e);
      if (i >= 0) entities.splice(i, 1);
    },
    get(id) { return entities.find((e) => e.id === id) || null; },
    near(x, y, r) {
      return entities.filter((e) => Math.hypot(e.x - x, e.y - y) <= r);
    },
    path(x0, y0, x1, y1) {
      pathCalls.push({ x0, y0, x1, y1 });
      return [{ x: x1, y: y1 }];
    },
    isBlocked() { return false; },
    loadZone(zone) { zoneLoads.push(zone); },
  },
  on(ev, fn) { (bus[ev] || (bus[ev] = [])).push(fn); },
  emit(ev, data) {
    const list = bus[ev] || [];
    for (const fn of list) fn(data);
  },
  ui: {
    showDeathRecap(recap) { uiRecap = recap; },
  },
};

context.Loot = {
  rollDrop(monsterId, rng, x, y) {
    lootCalls.push({ monsterId, x, y, sample: rng() });
    if (monsterId === 'ashmaw') return { name: 'Scrap', rarity: 'common', beam: false };
    return { name: 'Goblin Fang', rarity: 'rare', beam: true };
  },
};

vm.createContext(context);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), context, { filename: rel });
}

const RPG = context.RPG;
const IDS = ['rat', 'goblin', 'skeleton', 'imp', 'brute', 'ashmaw'];

assert(typeof RPG.ai.spawnPack === 'function', 'RPG.ai.spawnPack exists');
assert(RPG._system && RPG._system.name === 'ai', 'AI system registered');
assert(RPG.ai.spawnPack('nope', 0, 0, 1, 4).length === 0, 'unknown id spawns nothing');

// Sheet timing: a short clip is floored at 400; a long clip is kept.
RPG.sheet = { anims: { mob_rat_attack: { duration: 120 } } };
assert(RPG.ai.meleeWindupMs('rat') === 400, 'short rat clip floors at 400, got ' + RPG.ai.meleeWindupMs('rat'));
RPG.sheet = { anims: { mob_goblin_attack: { duration: 860 } } };
assert(RPG.ai.meleeWindupMs('goblin') === 860, 'long goblin clip is used');
RPG.sheet = {
  frames: {
    mob_imp_attack_0: { duration: 200 },
    mob_imp_attack_1: { duration: 220 },
  },
};
assert(RPG.ai.meleeWindupMs('imp') === 420, 'imp frame sum is used when it clears 400');
RPG.sheet = null;

for (const id of ['rat', 'goblin', 'skeleton', 'imp', 'brute']) {
  const ms = RPG.ai.meleeWindupMs(id);
  assert(ms >= 400, id + ' melee windup ' + ms + ' >= 400');
}
assert(RPG.ai.bossWindupMs('slam') >= 600, 'slam windup >= 600');
assert(RPG.ai.bossWindupMs('charge') >= 600, 'charge windup >= 600');

function resetHero(x, y) {
  hero.x = x;
  hero.y = y;
  hero.hp = 100;
  hero.dead = false;
}

// Every melee id winds up for its full tell before damage.
for (const id of ['rat', 'goblin', 'skeleton', 'imp', 'brute']) {
  fxLog.length = 0;
  resetHero(0, 0);
  const pack = RPG.ai.spawnPack(id, 0, 0, 1, 30);
  assert(pack.length === 1 && pack[0].kind === 'mob' && pack[0].monsterId === id, id + ' spawn');
  const mob = pack[0];
  const ms = RPG.ai.meleeWindupMs(id);
  hero.x = mob.x + 0.2;
  hero.y = mob.y;
  RPG.ai.tick(0.016);
  assert(mob.state === 'windup', id + ' enters windup, state=' + mob.state);
  assert(mob.windupMs >= 400, id + ' swing stores windupMs ' + mob.windupMs);
  const hp = hero.hp;
  RPG.ai.tick((ms - 50) / 1000);
  assert(hero.hp === hp, id + ' deals no damage before the windup ends');
  assert(mob.state === 'windup', id + ' still winding before the tell ends');
  RPG.ai.tick(0.08);
  assert(hero.hp < hp, id + ' damages after the windup');
  mob.takeHit(9999, { srcId: 'hero' });
}

// Pack aggros together when only one member can see the hero.
resetHero(0, 0);
const pack = RPG.ai.spawnPack('goblin', 10, 10, 3, 12);
assert(pack.length === 3, 'goblin pack size');
assert(pack.every((m) => m.packId === pack[0].packId), 'shared pack id');
const focus = pack[0];
const cx = pack.reduce((s, m) => s + m.x, 0) / pack.length;
const cy = pack.reduce((s, m) => s + m.y, 0) / pack.length;
let dx = focus.x - cx;
let dy = focus.y - cy;
const len = Math.hypot(dx, dy) || 1;
dx /= len;
dy /= len;
hero.x = focus.x + dx * (focus.sight - 0.25);
hero.y = focus.y + dy * (focus.sight - 0.25);
assert(dist(hero, focus) < focus.sight, 'hero is inside the focus sight');
assert(dist(hero, focus) > focus.melee + hero.radius, 'hero is outside melee');
const outsider = pack.find((m) => m !== focus && dist(hero, m) > m.sight);
assert(outsider, 'at least one packmate cannot see the hero');
const pathsBefore = pathCalls.length;
RPG.ai.tick(0.1);
assert(pack.every((m) => m.aggro && m.state === 'chase'), 'pack aggros together: ' + pack.map((m) => m.state + ':' + m.aggro).join(','));
assert(pathCalls.length > pathsBefore, 'chase asks world.path');
for (const m of pack) m.takeHit(9999, {});

// Leash: a pulled rat walks home and drops aggro.
resetHero(2.2, 0);
const [rat] = RPG.ai.spawnPack('rat', 0, 0, 1, 4);
RPG.ai.tick(0.1);
assert(rat.aggro === true, 'rat aggros inside sight');
hero.x = 80;
hero.y = 0;
let leashed = false;
for (let i = 0; i < 250; i++) {
  RPG.ai.tick(0.1);
  if (!rat.aggro && (rat.state === 'wander' || rat.state === 'return') && Math.hypot(rat.x, rat.y) <= 1.6) {
    leashed = true;
    break;
  }
}
assert(leashed, 'rat returns inside leash and drops aggro at ' + rat.x.toFixed(2) + ',' + rat.y.toFixed(2) + ' state=' + rat.state + ' aggro=' + rat.aggro);
rat.takeHit(9999, {});

// Ashmaw slam and charge each wait out a >=600ms tell.
resetHero(1.2, 0);
rngValue = 0;
fxLog.length = 0;
const boss = RPG.ai.boss.spawn(0, 0, { leash: 20 });
assert(boss && boss.monsterId === 'ashmaw' && boss.boss === true, 'ashmaw spawn');
const slamMs = RPG.ai.bossWindupMs('slam');
RPG.ai.tick(0.016);
assert(boss.state === 'slam', 'opens with slam when rng < 0.5, state=' + boss.state);
assert(boss.windupMs >= 600, 'slam stores windup ' + boss.windupMs);
assert(fxLog.some((e) => e.name === 'telegraph'), 'slam calls telegraph');
const hpSlam = hero.hp;
RPG.ai.tick((slamMs - 40) / 1000);
assert(hero.hp === hpSlam, 'slam does not hit before 600ms');
assert(boss.state === 'slam', 'slam still winding');
RPG.ai.tick(0.08);
assert(hero.hp < hpSlam, 'slam hits after the tell');
assert(fxLog.some((e) => e.name === 'telegraphOff'), 'slam clears with telegraphOff');

resetHero(1.2, 0);
rngValue = 0.9;
boss.cdMs = 0;
fxLog.length = 0;
const chargeMs = RPG.ai.bossWindupMs('charge');
RPG.ai.tick(0.016);
assert(boss.state === 'charge', 'second attack is charge, state=' + boss.state);
assert(boss.windupMs >= 600, 'charge stores windup ' + boss.windupMs);
assert(fxLog.some((e) => e.name === 'telegraphLine'), 'charge calls telegraphLine');
const hpCharge = hero.hp;
RPG.ai.tick((chargeMs - 40) / 1000);
assert(hero.hp === hpCharge, 'charge does not hit before 600ms');
RPG.ai.tick(0.08);
assert(hero.hp < hpCharge, 'charge hits after the tell');
assert(fxLog.some((e) => e.name === 'telegraphOff'), 'charge clears with telegraphOff');

// Loot, beam, single kill.
fxLog.length = 0;
lootCalls.length = 0;
const kills = [];
RPG.on('kill', (e) => kills.push(e));
resetHero(0, 0);
const [gob] = RPG.ai.spawnPack('goblin', 3, 3, 1, 8);
const dead = gob.takeHit(9999, { crit: true, srcId: 'hero', knock: 0.2 });
assert(dead && dead.dead === true, 'takeHit reports dead');
assert(kills.length === 1, 'one kill event');
assert(kills[0].monsterId === 'goblin' && kills[0].elite === false && kills[0].boss === false, 'kill payload');
assert(lootCalls.length === 1 && lootCalls[0].monsterId === 'goblin', 'Loot.rollDrop(goblin)');
assert(typeof lootCalls[0].sample === 'number', 'loot rng was invoked');
assert(fxLog.some((e) => e.name === 'beam'), 'beam when d.beam');
assert(entities.some((e) => e.kind === 'drop' && e._tappable), 'drop entity is tappable');
gob.takeHit(50, {});
assert(kills.length === 1, 'kill is not emitted twice');

// Ashmaw guarantee when the items table returns a common with no beam.
fxLog.length = 0;
const [maw] = RPG.ai.spawnPack('ashmaw', 30, 30, 1, 10);
maw.takeHit(99999, { srcId: 'hero' });
const cache = entities.find((e) => e.kind === 'drop' && e.item && e.item.placeholder && e.item.rarity === 'rare' && e.item.beam);
assert(cache, 'ashmaw still drops a beamed rare placeholder');
assert(fxLog.some((e) => e.name === 'beam'), 'placeholder beams');

// Death recap keeps the last three hero hurts.
uiRecap = null;
RPG.emit('hurt', { amount: 5, monsterId: 'rat', name: 'Rat' });
RPG.emit('death', { monsterId: 'goblin', kind: 'mob' });
assert(uiRecap == null, 'a mob death does not open the hero recap');
RPG.emit('hurt', { amount: 1, name: 'Rat', target: 'hero' });
RPG.emit('hurt', { amount: 2, name: 'Goblin', target: 'hero' });
RPG.emit('hurt', { amount: 4, name: 'Goblin', target: 'hero', crit: true });
RPG.emit('hurt', { amount: 9, name: 'Brute', target: 'mob' });
RPG.emit('hurt', { amount: 8, name: 'Skeleton', target: 'hero' });
RPG.emit('death', { target: 'hero' });
assert(uiRecap && uiRecap.hits.length === 3, 'recap shows 3 hits');
assert(uiRecap.hits.map((h) => h.name).join(',') === 'Goblin,Goblin,Skeleton', 'recap is the last three hero hits');
assert(uiRecap.hits[1].crit === true, 'crit is kept');
assert(uiRecap.lines[0] === 'Goblin 2', 'recap line');

// Revive cap: one accept per dungeon load.
let ads = 0;
context.Ads = { offerRevive() { ads += 1; return 'shown'; } };
assert(RPG.deathRecap.offerRevive() === 'shown', 'first revive offers');
assert(ads === 1, 'ads.offerRevive called');
assert(RPG.deathRecap.confirmRevive(true) === 'accepted', 'revive accepts');
assert(hero.hp === hero.maxHp, 'revive refills hp');
assert(RPG.deathRecap.offerRevive() === 'capped', 'second revive is capped');
assert(ads === 1, 'capped revive does not call ads');

const zone = RPG.dungeon.sample();
const loaded = RPG.dungeon.load(zone);
assert(zoneLoads[0] === zone, 'loadZone receives the zone');
assert(loaded.spawned.filter((m) => m.monsterId === 'skeleton').length === 6, 'skeleton packs');
assert(loaded.spawned.filter((m) => m.monsterId === 'imp').length === 4, 'imp pack');
const brute = loaded.spawned.find((m) => m.monsterId === 'brute');
assert(brute && brute.elite === true && brute.placeholder === true, 'brute is an elite labelled box');
assert(loaded.spawned.some((m) => m.monsterId === 'ashmaw' && m.boss), 'boss room spawns ashmaw');
let entered = null;
RPG.on('enter', (e) => { entered = e; });
// load already emitted; emit again through a fresh listener by re-reading bus.
// The listener above is late, so check the bus by loading a second time after subscribe.
const zone2 = RPG.dungeon.sample();
RPG.dungeon.load(zone2);
assert(entered && entered.zone && entered.zone.id === 'rustbound-crypt', 'enter { zone }');
assert(RPG.deathRecap.offerRevive() === 'shown', 'dungeon load resets the revive cap');

const field = RPG.ai.spawnField();
assert(field.length === 12, 'default goblin field count');
assert(field.some((m) => m.monsterId === 'rat') && field.some((m) => m.monsterId === 'goblin'), 'field is rats and goblins');
assert(IDS.every((id) => RPG.ai.specs[id] && RPG.ai.specs[id].id === id), 'monster ids are exactly the six names');

if (failed) {
  console.error(failed + ' rpg ai check(s) failed');
  process.exit(1);
}
console.log('rpg ai checks passed');
