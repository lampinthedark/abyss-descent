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
  if (rel === 'js/rpg/boss-ashmaw.js') {
    assert(text.indexOf("RPG.ui.drawDropRows(ctx, x, y, Loot.preview('ashmaw'))") !== -1, 'can-drop uses drawDropRows on the raw preview');
    assert(!/dropColor|showCanDrop|RARITY_COLOR/.test(text), 'can-drop does not map preview rows');
  }
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
  takeHit(dmg, info) {
    this.hp -= dmg;
    heroHits.push(info || {});
  },
  damage(amount, info) {
    this.hp -= amount;
    heroHits.push(info || {});
  },
};
const heroHits = [];

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
  rollDrop(monsterId, rng, x, y, opts) {
    lootCalls.push({ monsterId, x, y, sample: rng(), opts: opts || null });
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

// Live windup is content. A short or long sheet clip does not replace it.
// sheet ms[0] can only raise the windup, and content is authored to be >= that frame.
assert(RPG.ai.attacks.animKeyFor('rat', 'melee') === 'mob_rat_attack', 'rat attack key');
assert(RPG.ai.attacks.animKeyFor('goblin', 'melee') === 'mob_goblin_attack', 'goblin attack key');
assert(RPG.ai.attacks.animKeyFor('brute', 'melee') === 'mob_brute_attack', 'brute jab key');
assert(RPG.ai.attacks.animKeyFor('brute', 'slam') === 'mob_brute_slam', 'brute slam key');
assert(RPG.ai.attacks.animKeyFor('ashmaw', 'claw') === 'mob_ashmaw_attack', 'ashmaw claw key');
assert(RPG.ai.attacks.animKeyFor('ashmaw', 'slam') === 'mob_ashmaw_slam', 'ashmaw slam key');
assert(RPG.ai.attacks.animKeyFor('ashmaw', 'charge') === 'mob_ashmaw_charge', 'ashmaw charge key');
assert(RPG.ai.meleeWindupMs('rat') === 400, 'rat windup stays on content');
RPG.sheet = { anims: { mob_rat_attack: { duration: 120, ms: [120, 80] } } };
assert(RPG.ai.meleeWindupMs('rat') === 400, 'sheet ms[0] below content does not shorten the tell');
RPG.sheet = { anims: { mob_goblin_attack: { duration: 860, ms: [200, 660] } } };
assert(RPG.ai.meleeWindupMs('goblin') === 500, 'full clip length is not the windup');
RPG.sheet = { mobs2: { anims: { mob_imp_attack: { ms: [500, 80] } } } };
assert(RPG.ai.meleeWindupMs('imp') === 600, 'sheet ms[0] below content does not shorten imp');
RPG.sheet = { mobs2: { anims: { mob_imp_attack: { ms: [800, 80] } } } };
assert(RPG.ai.meleeWindupMs('imp') === 800, 'ms[0] raises imp windup when it beats content');
RPG.content = { monsters: { brute: { attacks: { slam: { windupMs: 710 } } } } };
assert(RPG.ai.attacks.windupFor('brute', 'slam') === 710, 'content slam windup is live');
RPG.content = null;
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
  const packName = id === 'rat' || id === 'goblin' ? 'mobs' : 'mobs2';
  assert(mob.sheetPack === packName, id + ' sheet pack ' + mob.sheetPack);
  assert(mob.animKey === 'mob_' + id + '_attack' || mob.sheet.attack === 'mob_' + id + '_attack', id + ' attack clip');
  RPG.ai.tick(0.016);
  assert(mob.state === 'windup', id + ' enters windup, state=' + mob.state);
  assert(mob.windupMs >= 400, id + ' swing stores windupMs ' + mob.windupMs);
  assert(mob.animKey === 'mob_' + id + '_attack', id + ' melee uses _attack, got ' + mob.animKey);
  assert(mob.animFrame === 0, id + ' holds frame 0 at windup start');
  const hp = hero.hp;
  RPG.ai.tick((ms - 50) / 1000);
  assert(hero.hp === hp, id + ' deals no damage before the windup ends');
  assert(mob.state === 'windup', id + ' still winding before the tell ends');
  assert(mob.animFrame === 0 && mob.animKey === 'mob_' + id + '_attack', id + ' still holds frame 0');
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
assert(pack.every((m) => m.aggro), 'pack aggros together: ' + pack.map((m) => m.state + ':' + m.aggro).join(','));
assert(focus.state === 'windup' && focus.animKey === 'mob_goblin_attack', 'goblin inside bow range winds up, state=' + focus.state);
assert(outsider.state === 'chase', 'unseen packmate chases, state=' + outsider.state);
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
// Stand outside claw range so rng picks slam or charge, not the jab.
resetHero(2, 0);
rngValue = 0;
fxLog.length = 0;
const boss = RPG.ai.boss.spawn(0, 0, { leash: 20 });
assert(boss && boss.monsterId === 'ashmaw' && boss.boss === true, 'ashmaw spawn');
const slamMs = RPG.ai.bossWindupMs('slam');
RPG.ai.tick(0.016);
assert(boss.state === 'slam', 'opens with slam when rng < 0.5, state=' + boss.state);
assert(boss.windupMs >= 600, 'slam stores windup ' + boss.windupMs);
assert(boss.animKey === 'mob_ashmaw_slam' && boss.animFrame === 0, 'slam holds mob_ashmaw_slam frame 0');
assert(fxLog.some((e) => e.name === 'telegraph'), 'slam calls telegraph');
const hpSlam = hero.hp;
RPG.ai.tick((slamMs - 40) / 1000);
assert(hero.hp === hpSlam, 'slam does not hit before 600ms');
assert(boss.state === 'slam', 'slam still winding');
assert(boss.animFrame === 0, 'slam frame stays 0 for the whole tell');
RPG.ai.tick(0.08);
assert(hero.hp < hpSlam, 'slam hits after the tell');
assert(heroHits[heroHits.length - 1].srcName === 'Ashmaw the Wyrmling', 'ashmaw slam passes srcName');
assert(fxLog.some((e) => e.name === 'telegraphOff'), 'slam clears with telegraphOff');

resetHero(1.2, 0);
rngValue = 0.9;
boss.cdMs = 0;
fxLog.length = 0;
const chargeMs = RPG.ai.bossWindupMs('charge');
RPG.ai.tick(0.016);
assert(boss.state === 'charge', 'second attack is charge, state=' + boss.state);
assert(boss.windupMs >= 600, 'charge stores windup ' + boss.windupMs);
assert(boss.animKey === 'mob_ashmaw_charge' && boss.animFrame === 0, 'charge tell holds frame 0');
assert(fxLog.some((e) => e.name === 'telegraphLine'), 'charge calls telegraphLine');
const hpCharge = hero.hp;
RPG.ai.tick((chargeMs - 40) / 1000);
assert(hero.hp === hpCharge, 'charge does not hit before 600ms');
RPG.ai.tick(0.08);
assert(hero.hp < hpCharge, 'charge hits after the tell');
assert(fxLog.some((e) => e.name === 'telegraphOff'), 'charge clears with telegraphOff');
assert(boss.state === 'dash' && boss.animFrame === 1 && boss.animKey === 'mob_ashmaw_charge', 'charge holds frame 1 for the dash');

// Ashmaw claw is the melee clip, still frame 0 for the whole windup.
rngValue = 0;
fxLog.length = 0;
const claw = RPG.ai.boss.spawn(50, 50, { leash: 20 });
hero.x = claw.x + 0.4;
hero.y = claw.y;
hero.hp = 100;
const clawMs = RPG.ai.attacks.windupFor('ashmaw', 'melee');
assert(clawMs >= 600, 'claw windup >= 600');
RPG.ai.tick(0.016);
assert(claw.state === 'claw', 'close Ashmaw opens with claw, state=' + claw.state);
assert(claw.animKey === 'mob_ashmaw_attack' && claw.animFrame === 0, 'claw uses _attack frame 0');
const hpClaw = hero.hp;
RPG.ai.tick((clawMs - 50) / 1000);
assert(hero.hp === hpClaw && claw.animFrame === 0, 'claw holds frame 0 and does not hit early');
RPG.ai.tick(0.08);
assert(hero.hp < hpClaw, 'claw hits after the windup');
claw.takeHit(99999, {});

// Brute jab was _attack above. Ring slam is _slam outside jab range.
fxLog.length = 0;
resetHero(0, 0);
const [slamBrute] = RPG.ai.spawnPack('brute', 80, 0, 1, 20);
hero.x = slamBrute.x + 1.4;
hero.y = slamBrute.y;
const bruteSlam = RPG.ai.attacks.windupFor('brute', 'slam');
assert(bruteSlam >= 600, 'brute slam windup >= 600');
RPG.ai.tick(0.016);
assert(slamBrute.state === 'slam', 'brute ring slam, state=' + slamBrute.state);
assert(slamBrute.animKey === 'mob_brute_slam' && slamBrute.animFrame === 0, 'brute slam clip frame 0');
assert(fxLog.some((e) => e.name === 'telegraph'), 'brute slam telegraphs');
const hpBrute = hero.hp;
RPG.ai.tick((bruteSlam - 50) / 1000);
assert(hero.hp === hpBrute && slamBrute.animFrame === 0 && slamBrute.animKey === 'mob_brute_slam', 'brute slam holds frame 0');
RPG.ai.tick(0.08);
assert(hero.hp < hpBrute, 'brute slam hits after the tell');
slamBrute.takeHit(99999, {});

// Brute charge is the line tell, then frame 1 for the dash.
fxLog.length = 0;
resetHero(0, 0);
const [chargeBrute] = RPG.ai.spawnPack('brute', 90, 0, 1, 20);
hero.x = chargeBrute.x + 3;
hero.y = chargeBrute.y;
const bruteCharge = RPG.ai.attacks.windupFor('brute', 'charge');
assert(bruteCharge === 700, 'brute charge windup is the content 700ms, got ' + bruteCharge);
RPG.ai.tick(0.016);
assert(chargeBrute.state === 'charge', 'brute charge, state=' + chargeBrute.state);
assert(chargeBrute.animKey === 'mob_brute_charge' && chargeBrute.animFrame === 0, 'brute charge clip frame 0');
assert(fxLog.some((e) => e.name === 'telegraphLine'), 'brute charge telegraphs a line');
const hpBruteCharge = hero.hp;
RPG.ai.tick((bruteCharge - 50) / 1000);
assert(hero.hp === hpBruteCharge && chargeBrute.animFrame === 0, 'brute charge holds frame 0');
RPG.ai.tick(0.08);
assert(hero.hp < hpBruteCharge, 'brute charge hits after the tell');
assert(heroHits[heroHits.length - 1].srcName === 'Grave Brute', 'brute charge passes srcName Grave Brute');
assert(chargeBrute.state === 'dash' && chargeBrute.animFrame === 1 && chargeBrute.animKey === 'mob_brute_charge', 'brute charge holds frame 1 for the dash');
chargeBrute.takeHit(99999, {});

// Field stays on mobs/. Dungeon ids use mobs2 when that key exists, else a labelled box.
RPG.sheet = {
  mobs: { anims: { mob_rat_attack: { ms: [200, 80] }, mob_goblin_attack: { ms: [180, 90] } } },
  mobs2: {
    anims: {
      mob_skeleton_attack: { ms: [200, 80] },
      mob_brute_attack: { ms: [220, 80] },
      mob_brute_slam: { ms: [400, 120] },
      mob_ashmaw_attack: { ms: [300, 100] },
      mob_ashmaw_slam: { ms: [500, 120] },
      mob_ashmaw_charge: { ms: [500, 160] },
    },
  },
};
const [fieldRat] = RPG.ai.spawnPack('rat', 0, 40, 1, 4);
const [boxImp] = RPG.ai.spawnPack('imp', 4, 40, 1, 4);
const [sheetSkel] = RPG.ai.spawnPack('skeleton', 8, 40, 1, 4);
assert(fieldRat.sheetPack === 'mobs' && fieldRat.placeholder === false, 'rat uses the mobs atlas');
assert(boxImp.sheetPack === 'mobs2' && boxImp.placeholder === true && boxImp.render.mode === 'box', 'imp without a mobs2 key stays a box');
assert(sheetSkel.sheetPack === 'mobs2' && sheetSkel.placeholder === false && sheetSkel.render.sheet === 'mobs2', 'skeleton uses mobs2');
RPG.sheet = { mobs2: { anims: { mob_rat_attack: { ms: [100] } } } };
const [boxedRat] = RPG.ai.spawnPack('rat', 12, 40, 1, 4);
assert(boxedRat.sheetPack === 'mobs' && boxedRat.placeholder === true, 'field rat does not borrow mobs2');
fieldRat.takeHit(9999, {});
boxImp.takeHit(9999, {});
sheetSkel.takeHit(9999, {});
boxedRat.takeHit(9999, {});
RPG.sheet = null;

// attack.anim wins over the derived suffix. jab/claw become _attack. mob_boss is mob_ashmaw.
RPG.content = {
  monsters: {
    brute: {
      attacks: {
        melee: { anim: 'jab' },
        slam: { anim: 'mob_brute_slam' },
        charge: { anim: 'charge' },
      },
    },
    ashmaw: {
      sprite: 'mob_boss',
      attacks: {
        melee: { anim: 'claw' },
        slam: { anim: 'mob_boss_slam' },
        charge: { anim: 'mob_boss_claw' },
      },
    },
  },
};
assert(RPG.ai.attacks.animKeyFor('brute', 'melee') === 'mob_brute_attack', 'jab anim maps to mob_brute_attack');
assert(RPG.ai.attacks.animKeyFor('brute', 'slam') === 'mob_brute_slam', 'full slam anim key is kept');
assert(RPG.ai.attacks.animKeyFor('brute', 'charge') === 'mob_brute_charge', 'charge anim suffix maps to _charge');
assert(RPG.ai.attacks.animKeyFor('ashmaw', 'melee') === 'mob_ashmaw_attack', 'claw anim maps to mob_ashmaw_attack');
assert(RPG.ai.attacks.animKeyFor('ashmaw', 'slam') === 'mob_ashmaw_slam', 'mob_boss slam key rewrites to mob_ashmaw');
assert(RPG.ai.attacks.animKeyFor('ashmaw', 'charge') === 'mob_ashmaw_attack', 'mob_boss claw key rewrites off mob_boss');
RPG.content.monsters.brute.attacks.melee.anim = 'poke';
resetHero(0, 0);
const [animBrute] = RPG.ai.spawnPack('brute', 20, 70, 1, 12);
hero.x = animBrute.x + 0.2;
hero.y = animBrute.y;
RPG.ai.tick(0.016);
assert(animBrute.state === 'windup' && animBrute.animKey === 'mob_brute_poke', 'live swing uses attack.anim, got ' + animBrute.animKey);
animBrute.takeHit(99999, {});
const [namedMaw] = RPG.ai.spawnPack('ashmaw', 24, 70, 1, 12);
assert(namedMaw.spriteBase === 'mob_ashmaw', 'ashmaw sprite stays mob_ashmaw when content says mob_boss');
assert(namedMaw.sheet.attack === 'mob_ashmaw_attack' && namedMaw.sheet.slam === 'mob_ashmaw_slam', 'ashmaw sheet keys drop mob_boss');
assert(JSON.stringify(namedMaw.sheet).indexOf('mob_boss') === -1, 'no mob_boss key on the ashmaw sheet');
namedMaw.takeHit(99999, {});
RPG.content = null;

// Optional hurt/death/throw clips live on mobs2. Missing clips fall back to idle.
const [plainRat] = RPG.ai.spawnPack('rat', 0, 80, 1, 4);
const [plainGob] = RPG.ai.spawnPack('goblin', 3, 80, 1, 8);
assert(plainRat.sheetPack === 'mobs' && plainGob.sheetPack === 'mobs', 'field packs stay on the lighter mobs atlas');
assert(plainRat.sheet.hurt === 'mob_rat_idle' && plainRat.sheet.death === 'mob_rat_idle', 'rat hurt/death fall back to idle');
assert(plainRat.sheet.throw === undefined, 'rat has no throw clip');
assert(plainGob.sheet.hurt === 'mob_goblin_idle' && plainGob.sheet.death === 'mob_goblin_idle' && plainGob.sheet.throw === 'mob_goblin_idle', 'goblin optional clips fall back to idle');
assert(plainGob.sheet.attack === 'mob_goblin_attack' && RPG.ai.attacks.animKeyFor('goblin', 'ranged') === 'mob_goblin_attack', 'ranged stays on the club anim until the throw clip exists');
plainRat.takeHit(1, {});
assert(plainRat.pose === 'idle' && plainRat.animKey === 'mob_rat_idle' && plainRat.hp > 0, 'a graze without hurt art poses idle');
plainRat.takeHit(9999, {});
assert(plainRat.pose === 'idle' && plainRat.animKey === 'mob_rat_idle' && plainRat.render.mode === 'box', 'a kill without death art is an idle box');
plainGob.takeHit(9999, {});

RPG.sheet = {
  mobs: { anims: { mob_rat_attack: { ms: [200] }, mob_goblin_attack: { ms: [180] } } },
  mobs2: {
    anims: {
      mob_rat_hurt: { frames: 2, ms: [90, 110] },
      mob_rat_death: { frames: 4, ms: [90, 120, 140, 1000] },
      mob_goblin_hurt: { frames: 2, ms: [90, 110] },
      mob_goblin_death: { frames: 4, ms: [90, 120, 140, 1000] },
      mob_goblin_throw: { frames: 3, ms: [400, 90, 160], hit_frame: 1 },
      mob_imp_throw: { frames: 3, ms: [400, 90, 160], hit_frame: 1 },
    },
  },
};
const [clipRat] = RPG.ai.spawnPack('rat', 6, 80, 1, 4);
assert(clipRat.sheetPack === 'mobs' && clipRat.placeholder === false, 'hurt clips on mobs2 do not move the rat off mobs');
assert(clipRat.sheet.idle === 'mob_rat_idle' && clipRat.sheet.attack === 'mob_rat_attack', 'rat idle and attack keys stay the field set');
assert(clipRat.sheet.hurt === 'mob_rat_hurt' && clipRat.sheet.death === 'mob_rat_death', 'rat hurt and death use the mobs2 clips');
clipRat.takeHit(1, {});
assert(clipRat.pose === 'hurt' && clipRat.animKey === 'mob_rat_hurt' && clipRat.animFrame === 0, 'takeHit poses mob_rat_hurt');
clipRat.takeHit(9999, {});
assert(clipRat.pose === 'death' && clipRat.animKey === 'mob_rat_death' && clipRat.animFrame === 3 && clipRat.holdFrame === 3, 'rat death holds the last corpse frame');
assert(clipRat.corpse === true && entities.indexOf(clipRat) >= 0 && clipRat.render.mode !== 'box', 'the belly-up rat stays in the world');

// Content still names the goblin rock as the club clip. The throw clip wins.
RPG.content = { monsters: { goblin: { attacks: { ranged: { anim: 'mob_goblin_attack' } } } } };
assert(RPG.ai.attacks.animKeyFor('goblin', 'melee') === 'mob_goblin_attack', 'goblin club stays mob_goblin_attack');
assert(RPG.ai.attacks.animKeyFor('goblin', 'ranged') === 'mob_goblin_throw', 'ranged goblin plays mob_goblin_throw over the club anim');
assert(RPG.ai.attacks.animKeyFor('imp', 'ranged') === 'mob_imp_attack', 'imp ranged does not borrow a throw clip');
assert(RPG.ai.attacks.windupFor('goblin', 'ranged') === 700, 'throw tell stays the 700ms content windup');
const [throwGob] = RPG.ai.spawnPack('goblin', 10, 80, 1, 12);
assert(throwGob.sheetPack === 'mobs' && throwGob.sheet.attack === 'mob_goblin_attack', 'goblin attack stays on the field key');
assert(throwGob.sheet.throw === 'mob_goblin_throw' && throwGob.sheet.hurt === 'mob_goblin_hurt' && throwGob.sheet.death === 'mob_goblin_death', 'goblin hurt, death, and throw keys');
resetHero(0, 0);
hero.x = throwGob.x + 3;
hero.y = throwGob.y;
hero.hp = 100;
fxLog.length = 0;
heroHits.length = 0;
RPG.ai.tick(0.016);
assert(throwGob.state === 'windup' && throwGob.animKey === 'mob_goblin_throw' && throwGob.animFrame === 0, 'ranged goblin opens the throw clip on frame 0, state=' + throwGob.state + ' key=' + throwGob.animKey);
const hpThrow = hero.hp;
RPG.ai.tick(0.35);
assert(hero.hp === hpThrow && throwGob.animFrame === 0 && !fxLog.some((e) => e.name === 'rock'), 'rock stays in hand until hit_frame');
RPG.ai.tick(0.05);
assert(hero.hp < hpThrow && throwGob.animFrame === 1 && fxLog.filter((e) => e.name === 'rock').length === 1, 'rock spawns once on hit_frame 1');
assert(heroHits[heroHits.length - 1].srcName === 'Ditch Goblin', 'throw passes the goblin srcName');
const hitsAfterThrow = heroHits.length;
const hpAfterThrow = hero.hp;
RPG.ai.tick(0.4);
assert(hero.hp === hpAfterThrow && heroHits.length === hitsAfterThrow && fxLog.filter((e) => e.name === 'rock').length === 1, 'throw does not hit again when the windup ends');
throwGob.takeHit(1, {});
assert(throwGob.animKey === 'mob_goblin_hurt' && throwGob.animFrame === 0, 'goblin graze poses mob_goblin_hurt');
throwGob.takeHit(9999, {});
assert(throwGob.pose === 'death' && throwGob.animKey === 'mob_goblin_death' && throwGob.animFrame === 3 && throwGob.holdFrame === 3, 'goblin death holds the last corpse frame');
delete RPG.sheet.mobs2.anims.mob_goblin_throw;
assert(RPG.ai.attacks.animKeyFor('goblin', 'ranged') === 'mob_goblin_attack', 'without the throw clip, ranged falls back to the club anim');
RPG.content = null;
RPG.sheet = null;

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
assert(lootCalls[0].opts && lootCalls[0].opts.questFinish === false, 'missing quests passes questFinish false');
assert(typeof lootCalls[0].sample === 'number', 'loot rng was invoked');
assert(fxLog.some((e) => e.name === 'beam'), 'beam when d.beam');
assert(entities.some((e) => e.kind === 'drop' && e._tappable), 'drop entity is tappable');
gob.takeHit(50, {});
assert(kills.length === 1, 'kill is not emitted twice');

// Q2 Rare contract: one roll, questFinish from completesOnKill, no extra drop or beam.
fxLog.length = 0;
lootCalls.length = 0;
let questEv = null;
RPG.quests = {
  completesOnKill(id, ev) {
    questEv = ev;
    return id === 'rat';
  },
};
const dropsBefore = entities.filter((e) => e.kind === 'drop').length;
const [questRat] = RPG.ai.spawnPack('rat', 6, 6, 1, 4);
questRat.takeHit(9999, {});
assert(lootCalls.length === 1 && lootCalls[0].opts && lootCalls[0].opts.questFinish === true, 'completesOnKill true is passed as questFinish');
assert(questEv && questEv === kills[kills.length - 1] && questEv.monsterId === 'rat', 'completesOnKill receives the emitted kill payload');
assert(entities.filter((e) => e.kind === 'drop').length === dropsBefore + 1, 'quest finish does not spawn a second drop');
assert(fxLog.filter((e) => e.name === 'beam').length === 1, 'quest finish does not add a second beam');
RPG.quests = {};
lootCalls.length = 0;
const [noQuest] = RPG.ai.spawnPack('rat', 8, 6, 1, 4);
noQuest.takeHit(9999, {});
assert(lootCalls.length === 1 && lootCalls[0].opts && lootCalls[0].opts.questFinish === false, 'missing completesOnKill passes questFinish false');
RPG.quests = null;

const stairShut = 'Warden Ilse wants a word before you go down.';
let gate = RPG.dungeon.canEnter();
assert(gate && gate.ok === false && gate.line === stairShut, 'stairs stay shut when quests are not loaded');
RPG.quests = {};
gate = RPG.dungeon.canEnter();
assert(gate.ok === false && gate.line === stairShut, 'stairs stay shut when isDone is missing');
RPG.quests = { isDone() { return false; } };
gate = RPG.dungeon.canEnter();
assert(gate.ok === false && gate.line === stairShut, 'stairs stay shut until q2 is done');
let askedQuest = null;
RPG.quests = {
  isDone(id) {
    askedQuest = id;
    return id === 'q2';
  },
};
gate = RPG.dungeon.canEnter();
assert(gate && gate.ok === true && askedQuest === 'q2', 'stairs open when isDone(q2) is true');
RPG.quests = null;

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
RPG.deathRecap.resetRun();
uiRecap = null;
RPG.emit('hurt', { amount: 3, name: 'charge', srcName: 'Grave Brute', target: 'hero' });
RPG.emit('hurt', { amount: 5, name: 'Claw', srcName: 'Ashmaw the Wyrmling', target: 'hero' });
RPG.emit('hurt', { amount: 8, name: 'Cinder Ring', srcName: 'Ashmaw the Wyrmling', target: 'hero' });
RPG.emit('death', { target: 'hero' });
assert(uiRecap && uiRecap.lastHits.map((h) => h.name).join(',') === 'Grave Brute,Ashmaw the Wyrmling,Ashmaw the Wyrmling', 'recap shows attack srcName');
assert(uiRecap.lines[0] === 'Grave Brute 3', 'recap line uses the display name');
RPG.deathRecap.resetRun();
uiRecap = null;
RPG.emit('hurt', { amount: 1.7, name: 'Ditch Goblin', target: 'hero' });
RPG.emit('hurt', { amount: 2.0000001, name: 'Ditch Goblin', target: 'hero' });
RPG.emit('hurt', { amount: 0.3, name: 'Rat', target: 'hero' });
RPG.emit('death', { target: 'hero' });
assert(uiRecap.lines.join('|') === 'Ditch Goblin 2|Ditch Goblin 2|Rat 1', 'recap shows whole numbers (ceil), got ' + uiRecap.lines.join('|'));
assert(uiRecap.hits.every((h) => Number.isInteger(h.amount)), 'recap hit amounts are whole');

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

const ATK = { rat: 1, goblin: 8, skeleton: 14, imp: 18, brute: 24, ashmaw: 30 };
for (const id of IDS) {
  const [mob] = RPG.ai.spawnPack(id, 0, 70, 1, 4);
  assert(mob && mob.atk === ATK[id], id + ' atk ' + (mob && mob.atk));
  mob.takeHit(99999, {});
}

// Live RPGContent replaces the thin crypt and the fallback attack numbers.
rngValue = 0;
context.RPGContent = {
  REST_MS: 500,
  MONSTERS: {
    skeleton: {
      id: 'skeleton', name: 'Rattlebone Skeleton', hp: 123, def: 10, atk: 14, speed: 1.6, aggro: 5, leash: 9, pack: [2, 3], sprite: 'mob_skeleton',
      attacks: [{ kind: 'melee', dmg: 2, range: 1, windupMs: 640, cooldownMs: 2600, srcName: 'Rattlebone Skeleton' }],
    },
    brute: {
      id: 'brute', name: 'Grave Brute', hp: 300, def: 14, atk: 24, speed: 1.4, aggro: 6, leash: 12, pack: [1, 1], elite: true, sprite: 'mob_brute',
      attacks: [{ kind: 'charge', dmg: 18, range: 5, windupMs: 700, cooldownMs: 9000, telegraph: 'line' }],
    },
    ashmaw: {
      id: 'ashmaw', name: 'Ashmaw the Wyrmling', hp: 961, def: 8, atk: 30, speed: 1.6, aggro: 8, leash: 99, pack: [1, 1], boss: true, sprite: 'mob_ashmaw',
      attacks: [
        { kind: 'slam', dmg: 24, range: 2.5, radius: 2.5, windupMs: 1000, cooldownMs: 8000, telegraph: 'ring', name: 'Cinder Ring' },
        { kind: 'charge', dmg: 20, range: 7, windupMs: 900, cooldownMs: 11000, telegraph: 'line', name: 'Ash Rush' },
        { kind: 'melee', dmg: 5, range: 1.2, windupMs: 650, cooldownMs: 2000, name: 'Claw' },
      ],
    },
  },
  Dungeon: {
    id: 'ash_stair',
    name: 'The Ash Stair',
    rows: ['......', '.ssss.', '.ssss.', '......'],
    legend: { '.': { walk: false }, s: { walk: true } },
    props: [{ key: 'prop_rock_0', x: 2, y: 1, block: true }],
    rooms: [{ id: 'den', kind: 'boss', x: 1, y: 1, w: 4, h: 2 }],
    spawns: [
      { monsterId: 'skeleton', x: 2, y: 2, room: 'hall_1' },
      { monsterId: 'ashmaw', x: 3, y: 2, room: 'den' },
    ],
    entry: { x: 11, y: 3 },
    exits: [
      { x: 11, y: 1, to: { map: 'town', x: 12, y: 26 } },
      { x: 11, y: 74, to: { map: 'town', x: 12, y: 26 }, unlockedBy: 'ashmaw' },
    ],
    bossRoom: { x: 2, y: 62, w: 20, h: 12 },
    townGate: { map: 'town', x: 12, y: 27, zone: 'ash_stair_gate' },
  },
};
assert(RPG.ai.attacks.windupFor('skeleton', 'melee') === 640, 'live monster windup replaces the fallback');
assert(RPG.ai.attacks.windupFor('brute', 'charge') === 700, 'live brute charge windup stays 700');
assert(RPG.ai.attacks.attacksOf('brute').charge.srcName === 'Grave Brute', 'live brute srcName comes from the monster name');
const stair = RPG.dungeon.sample();
assert(stair.id === 'ash_stair' && stair.name === 'The Ash Stair', 'sample loads Ash Stair');
assert(stair.entry.x === 11 && stair.entry.y === 3, 'Ash Stair entry');
assert(stair.bossRoom && stair.bossRoom.w === 20 && stair.bossRoom.h === 12, 'boss room rect');
assert(stair.exits && stair.exits[1].unlockedBy === 'ashmaw', 'boss exit stays locked until ashmaw');
assert(stair.townGate && stair.townGate.x === 12 && stair.townGate.y === 27, 'town gate comes from the content dungeon');
assert(stair.grid[0][0] === 1 && stair.grid[1][1] === 0 && stair.grid[1][2] === 1, 'rows and blocking props become a grid');
const stairLoad = RPG.dungeon.load(stair);
assert(zoneLoads[zoneLoads.length - 1].id === 'ash_stair', 'loadZone receives Ash Stair');
assert(hero.x === 11.5 && hero.y === 3.5, 'hero stands in the middle of the stair entry tile');
const stairSkel = stairLoad.spawned.filter((m) => m.monsterId === 'skeleton');
const stairBoss = stairLoad.spawned.filter((m) => m.monsterId === 'ashmaw');
assert(stairSkel.length === 2 && stairSkel[0].hp === 123 && stairSkel[0].atk === 14 && stairSkel[0].room === 'hall_1', 'skeleton pack comes from the content record');
assert(stairBoss.length === 1 && stairBoss[0].boss && stairBoss[0].hp === 961 && stairBoss[0].atk === 30, 'ashmaw is not spawned twice from the boss rect');

const preview = [
  { name: 'Wyrmfang', rarity: 'legendary', beamColor: '#ff9a2e', icon: 'icon_wyrmfang', source: 'monster' },
  { name: "Gravewarden's Crown", rarity: 'very rare', beamColor: '#c070ff', icon: 'icon_gravewarden_crown', source: 'monster' },
  { name: 'Wyrmscale armour', rarity: 'rare', beamColor: '#5aa0ff', icon: 'icon_wyrmscale_armour', source: 'monster' },
  { name: 'Wyrm Scale', rarity: 'rare', beamColor: '#5aa0ff', icon: 'icon_wyrm_scale', source: 'shared' },
];
context.Loot.preview = function (id) {
  assert(id === 'ashmaw', 'preview asked for ashmaw');
  return preview;
};
const ctx = { kind: '2d' };
assert(RPG.boss.canDropPanel(ctx, 12, 40) === undefined, 'missing drawDropRows is a no-op');
const drawn = [];
RPG.ui.drawDropRows = function (drawCtx, x, y, rows) {
  drawn.push({ drawCtx, x, y, rows });
  return 'drawn';
};
assert(RPG.boss.canDropPanel(ctx, 12, 40) === 'drawn', 'can-drop panel draws through the shared helper');
assert(drawn.length === 1 && drawn[0].drawCtx === ctx && drawn[0].x === 12 && drawn[0].y === 40, 'drawDropRows gets ctx, x, y');
assert(drawn[0].rows === preview, 'preview array is passed through raw');
assert(drawn[0].rows.map((d) => d.name).join('|') === "Wyrmfang|Gravewarden's Crown|Wyrmscale armour|Wyrm Scale", 'preview order is kept');
assert(drawn[0].rows[0].beamColor === '#ff9a2e' && drawn[0].rows[0].icon === 'icon_wyrmfang', 'Wyrmfang row is untouched');
assert(!stairBoss[0].canDrop, 'spawn does not build a private drop panel');

// Town field: two goblin pairs, keepOut, respawn. Dungeon packs stay whole-room aggro.
let keepOut = [];
function keepClear(x, y) {
  for (let i = 0; i < keepOut.length; i++) {
    const k = keepOut[i];
    const dx = Math.max(k.x0 - x, 0, x - k.x1);
    const dy = Math.max(k.y0 - y, 0, y - k.y1);
    if (Math.hypot(dx, dy) < k.r) return false;
  }
  return true;
}
RPG.world.clearOfKeepOut = keepClear;
const town = {
  id: 'town',
  keepOut: [{ x0: 11, y0: 26, x1: 13, y1: 27, r: 5 }],
  spawns: [
    { monsterId: 'goblin', x: 5, y: 31, n: 2, leash: 4, respawn: 10, area: { x0: 4, y0: 30, x1: 10, y1: 33 } },
    { monsterId: 'goblin', x: 8, y: 32, n: 2, leash: 4, respawn: 10, area: { x0: 4, y0: 30, x1: 10, y1: 33 } },
  ],
};
resetHero(100, 100);
const townMobs = RPG.ai.spawnZone(town);
assert(townMobs.length === 4, 'town field spawns four goblins');
assert(townMobs.every((m) => m.leash === 4 && m.respawnSec === 10 && m.scope === 'pair'), 'entries keep leash, respawn, and pair scope');
assert(townMobs.every((m) => m.x >= 4 && m.x <= 10 && m.y >= 30 && m.y <= 33), 'spawns sit inside the field area');
const pairIds = [...new Set(townMobs.map((m) => m.packId))];
assert(pairIds.length === 2, 'each spawn entry is its own pair');
const pairA = townMobs.filter((m) => m.packId === pairIds[0]);
const pairB = townMobs.filter((m) => m.packId === pairIds[1]);
assert(townMobs.every((m) => m.sight === 4 && m.townAggro === 2), 'town aggro is a 2-tile override; content sight stays 4');
const near = pairA[0];
hero.x = near.x;
hero.y = near.y + 3;
RPG.ai.tick(0.05);
assert(townMobs.every((m) => !m.aggro), 'a goblin 3 tiles away does not aggro');
hero.y = near.y + 2;
RPG.ai.tick(0.05);
assert(pairA.every((m) => m.aggro), 'a goblin at 2 tiles pulls its pair');
assert(pairB.every((m) => !m.aggro), 'the other pair stays idle at 2 tiles from the first');
for (const m of townMobs) { m.aggro = false; m.state = 'wander'; }
hero.x = 80;
hero.y = 80;
RPG.ai.tick(0.05);
assert(townMobs.every((m) => !m.aggro), 'no proximity aggro from across town');
pairA[0].takeHit(1, { srcId: 'hero' });
assert(pairA.every((m) => m.aggro), 'a hit from range pulls that goblin and its partner');
assert(pairB.every((m) => !m.aggro), 'the other pair stays idle');
for (const m of townMobs) { m.aggro = false; m.state = 'wander'; }

const townRats = RPG.ai.spawnZone({
  id: 'town',
  spawns: [{ monsterId: 'rat', x: 20, y: 20, n: 2, leash: 4 }],
});
assert(townRats.every((m) => m.townAggro === 2 && m.sight === 3), 'town rats keep content sight and the 2-tile override');
hero.x = 20;
hero.y = 23;
RPG.ai.tick(0.05);
assert(townRats.every((m) => !m.aggro), 'a town rat 3 tiles away does not aggro');
hero.y = 22;
RPG.ai.tick(0.05);
assert(townRats.every((m) => m.aggro), 'a town rat at 2 tiles aggros its spawn entry');
for (const m of townRats) m.takeHit(99999, {});

resetHero(0, 3);
const [stairGob] = RPG.ai.spawnPack('goblin', 0, 0, 1, 8);
RPG.ai.tick(0.05);
assert(stairGob.townAggro == null && stairGob.aggro === true, 'dungeon goblin still uses content aggro past 2 tiles');
stairGob.takeHit(99999, {});

resetHero(1, 0);
const tight = RPG.ai.spawnZone({
  spawns: [
    { monsterId: 'goblin', x: 0, y: 0, n: 2, leash: 6, area: { x0: -1, y0: -1, x1: 3, y1: 2 } },
    { monsterId: 'goblin', x: 2, y: 0, n: 2, leash: 6, area: { x0: -1, y0: -1, x1: 3, y1: 2 } },
  ],
});
RPG.ai.tick(0.05);
const chasing = tight.filter((m) => m.aggro);
assert(chasing.length === 2, 'at most two town goblins chase at once, got ' + chasing.length);
assert(chasing.every((m) => m.packId === chasing[0].packId), 'the two chasers are one pair');
for (const m of tight) m.takeHit(99999, {});

keepOut = town.keepOut;
resetHero(10, 30);
const [edge] = RPG.ai.spawnPack('goblin', 8, 32, 1, 8, {
  area: town.spawns[0].area,
  scope: 'pair',
  respawn: 10,
});
assert(keepClear(edge.x, edge.y), 'field spawn is outside keepOut');
edge.aggro = true;
edge.state = 'chase';
RPG.ai.tick(0.2);
assert(keepClear(edge.x, edge.y), 'chase stops at the keepOut edge');
assert(edge.aggro === false, 'the goblin gives up instead of entering keepOut');
hero.x = 100;
hero.y = 100;
for (let i = 0; i < 20; i++) RPG.ai.tick(0.2);
assert(edge.x >= 4 && edge.x <= 10 && edge.y >= 30 && edge.y <= 33 && keepClear(edge.x, edge.y), 'wander stays in the area and out of keepOut');
const idsBefore = new Set(entities.filter((e) => e.kind === 'mob').map((e) => e.id));
edge.takeHit(99999, {});
assert(edge.dead === true, 'field goblin dies');
RPG.ai.tick(9.9);
const early = entities.filter((e) => e.kind === 'mob' && !e.dead && !idsBefore.has(e.id));
assert(early.length === 0, 'no respawn before 10s');
RPG.ai.tick(0.2);
const spawnedBack = entities.filter((e) => e.kind === 'mob' && !e.dead && !idsBefore.has(e.id));
assert(spawnedBack.length === 1, 'goblin respawns after 10s, got ' + spawnedBack.length);
assert(spawnedBack[0].packId === edge.packId && spawnedBack[0].respawnSec === 10, 'respawn keeps the pair and the timer');
assert(keepClear(spawnedBack[0].x, spawnedBack[0].y), 'respawn lands outside keepOut');
for (const m of spawnedBack) m.takeHit(99999, {});
keepOut = [];

// Fresh hero has no weapon. Core combat.maxHit still kills a field goblin.
{
  const mem = new Map();
  const bare = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Uint8Array,
    crypto: require('crypto').webcrypto,
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    },
    document: { visibilityState: 'visible', addEventListener() {} },
    addEventListener() {},
    performance: { now: () => Date.now() },
  };
  bare.window = bare;
  bare.globalThis = bare;
  vm.createContext(bare);
  for (const rel of ['js/rpg/store.js', 'js/rpg/items-stub.js', 'js/rpg/hero.js', 'js/rpg/combat.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), bare, { filename: rel });
  }
  const gear = bare.Equipment.getStats();
  assert(gear.power === 0 && gear.aim === 0 && gear.armour === 0, 'fresh hero has no weapon');
  assert(bare.RPG.bootItems().reason === 'no_items_module', 'boot does not grant a starter sword');
  const hit = bare.RPG.combat.maxHit();
  assert(hit >= 1, 'bare-handed maxHit is at least 1, got ' + hit);
  assert(bare.RPG.combat.hitChance(3) > 0, 'bare-handed swings can connect on a goblin');
  assert(bare.RPG.combat.attack({}).ok === false, 'core attack ignores a non-mob target');
  const [fist] = RPG.ai.spawnPack('goblin', 40, 40, 1, 4);
  const hp0 = fist.hp;
  let swings = 0;
  while (!fist.dead && swings < hp0 + 5) {
    fist.takeHit(hit, { srcId: 'hero' });
    swings += 1;
  }
  assert(fist.dead && swings === Math.ceil(hp0 / hit), 'field goblin dies to bare-handed core hits, swings ' + swings);
}

// Per-entry tuning: aggro:false = only when hit; pull:'self' = a hit wakes only that mob.
{
  hero.x = 120; hero.y = 120;
  const tuned = RPG.ai.spawnZone({
    id: 'town',
    spawns: [
      { monsterId: 'rat', x: 120, y: 121, n: 2, leash: 4, aggro: false },
      { monsterId: 'goblin', x: 126, y: 120, n: 2, leash: 4, area: { x0: 124, y0: 118, x1: 130, y1: 122 }, respawn: 10, pull: 'self' },
    ],
  });
  const calmRats = tuned.filter((m) => m.monsterId === 'rat');
  const soloGobs = tuned.filter((m) => m.monsterId === 'goblin');
  RPG.ai.tick(0.05);
  assert(calmRats.every((m) => !m.aggro), 'aggro:false rats ignore a hero on their tile');
  calmRats[0].takeHit(1, { srcId: 'hero' });
  assert(calmRats[0].aggro && !calmRats[1].aggro, 'a hit rat fights back; its packmate stays calm');
  hero.x = 200; hero.y = 200;
  for (const m of calmRats) { m.aggro = false; m.state = 'wander'; }
  soloGobs[0].takeHit(1, { srcId: 'hero' });
  assert(soloGobs[0].aggro && !soloGobs[1].aggro, "pull:'self' wakes only the hit goblin");
  soloGobs[0].takeHit(9999, { srcId: 'hero' });
  RPG.ai.tick(10.1);
  const back = entities.filter((m) => m.monsterId === 'goblin' && !m.dead && m.pullSelf && m.area && m.area.x0 === 124);
  assert(back.length === 2, "pull:'self' survives the 10 s respawn, got " + back.length);
  for (const m of tuned) { m.aggro = false; m.state = 'wander'; }
}

// Field fixes: pair-only proximity, area leash, corpse despawn, floored keepOut, hero.alive.
{
  for (const e of entities) { if (e.kind === 'mob') { e.aggro = false; e.state = 'wander'; } }
  hero.x = 500; hero.y = 500; hero.dead = false; hero.alive = true;
  const areaA = { x0: 300, y0: 300, x1: 306, y1: 303 };
  const areaB = { x0: 300, y0: 310, x1: 306, y1: 313 };
  const f = RPG.ai.spawnZone({ id: 'town', spawns: [
    { monsterId: 'goblin', x: 301, y: 301, n: 2, leash: 4, area: areaA, respawn: 10 },
    { monsterId: 'goblin', x: 301, y: 311, n: 2, leash: 4, area: areaB, respawn: 10 },
  ] });
  const A = f.filter((m) => m.area === areaA);
  const B = f.filter((m) => m.area === areaB);
  hero.x = A[0].x; hero.y = A[0].y;
  RPG.ai.tick(0.02);
  assert(A.every((m) => m.aggro) && B.every((m) => !m.aggro), 'proximity wakes pair A only');
  A[1].aggro = false; A[1].state = 'wander';
  hero.x = B[0].x; hero.y = B[0].y;
  RPG.ai.tick(0.02);
  assert(A[0].aggro && B.every((m) => !m.aggro), 'walking past pair B while A is engaged does not wake B');
  B[0].takeHit(1, { srcId: 'hero' });
  assert(B[0].aggro, 'a hit still wakes a goblin of the second pair');
  for (const m of f) { m.aggro = false; m.state = 'wander'; }

  // Leash is measured from the area, and the walk home has no snap.
  hero.x = 900; hero.y = 900;
  const g = A[0];
  g.x = areaA.x1 + 3; g.y = 301; g.aggro = true; g.state = 'chase';
  RPG.ai.tick(0.02);
  assert(g.state !== 'return', '3 tiles outside the area is inside leash 4, state ' + g.state);
  g.x = areaA.x1 + 4.6; g.y = 301; g.aggro = true; g.state = 'chase';
  let maxJump = 0;
  for (let i = 0; i < 400 && (g.state === 'return' || i === 0); i++) {
    const px = g.x, py = g.y;
    RPG.ai.tick(0.02);
    maxJump = Math.max(maxJump, Math.hypot(g.x - px, g.y - py));
  }
  assert(g.state === 'wander' && g.x <= areaA.x1 + 0.4 && g.x >= areaA.x0, 'leashed goblin walks back into its area, at ' + g.x.toFixed(2));
  assert(maxJump < 0.3, 'no snap or teleport on the way home, max step ' + maxJump.toFixed(3));
  assert(Math.abs(g.x - g.spawnX) > 0.5, 'area goblin stops at the area edge, not its spawn');

  // Corpses: untappable at once, fade, then leave the world at 3 s.
  const [c] = RPG.ai.spawnPack('rat', 700, 700, 1, 4);
  c.takeHit(9999, { srcId: 'hero' });
  assert(c.pickable === false && entities.includes(c), 'corpse stays drawn but is not tappable');
  RPG.ai.tick(2.7);
  assert(entities.includes(c) && c.alpha > 0 && c.alpha < 1, 'corpse fades in the last 0.5 s, alpha ' + c.alpha);
  RPG.ai.tick(0.4);
  assert(!entities.includes(c), 'corpse is removed after 3 s');

  // keepOut is checked on the floored tile too.
  RPG.world.clearOfKeepOut = (x, y) => !(x === 400 && y === 400);
  const [k] = RPG.ai.spawnPack('goblin', 400.5, 400.5, 1, 4, { area: { x0: 399, y0: 399, x1: 402, y1: 402 } });
  assert(!(Math.floor(k.x) === 400 && Math.floor(k.y) === 400), 'no spawn on a keepOut tile, got ' + k.x + ',' + k.y);
  delete RPG.world.clearOfKeepOut;
  k.takeHit(9999, {});

  // A downed hero (alive === false) draws no aggro.
  const [r] = RPG.ai.spawnPack('rat', 800, 800, 1, 4);
  hero.x = 800; hero.y = 800; hero.alive = false; hero.dead = false;
  RPG.ai.tick(0.02);
  assert(!r.aggro, 'hero.alive === false is treated as dead');
  hero.alive = true; hero.x = 900; hero.y = 900;
  r.takeHit(9999, {});
  for (const m of f) { m.aggro = false; m.state = 'wander'; }
  RPG.ai.tick(3.1);
}

// Core's renderer draws e.sprite (full sheet key) at e.frame or every e.anim ms,
// flipped by e.flip. Keys come from window.Sheet (assets/rpg/mobs_sheet.json).
{
  const mobsJson = JSON.parse(fs.readFileSync(path.join(root, 'assets/rpg/mobs_sheet.json'), 'utf8'));
  const realFrames = mobsJson.frames || mobsJson;
  const savedSheet = RPG.sheet;
  RPG.sheet = null;
  context.Sheet = {
    has: (k) => !!realFrames[k],
    get: (k) => (realFrames[k] ? { frames: realFrames[k].frames || 1, ms: realFrames[k].ms || null } : null),
  };
  const [drawGob] = RPG.ai.spawnPack('goblin', 60, 60, 1, 4);
  const [drawRat] = RPG.ai.spawnPack('rat', 64, 60, 1, 4);
  RPG.ai.tick(0.05);
  assert(/^mob_goblin_(idle|walk)$/.test(drawGob.sprite), 'goblin draws a real mobs key, got ' + drawGob.sprite);
  assert(/^mob_rat_(idle|walk)$/.test(drawRat.sprite), 'rat draws a real mobs key, got ' + drawRat.sprite);
  assert(typeof drawGob.anim === 'number' && drawGob.anim > 0, 'idle/walk loops on a numeric e.anim');
  assert(typeof drawGob.flip === 'boolean' && drawGob.render.mode === 'sheet' && drawGob.placeholder === false, 'goblin is not a box');
  drawGob.facing = 1; RPG.ai.syncRender(drawGob);
  assert(drawGob.flip === true, 'facing right mirrors the left-facing frames');
  drawGob.takeHit(9999, {});
  assert(context.Sheet.has(drawGob.sprite) && !drawGob.anim, 'a dead goblin holds a static real frame, got ' + drawGob.sprite);
  delete context.Sheet;
  RPG.sheet = savedSheet;
}

if (failed) {
  console.error(failed + ' rpg ai check(s) failed');
  process.exit(1);
}
console.log('rpg ai checks passed');
