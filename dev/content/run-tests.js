#!/usr/bin/env node
/**
 * Content tests (node, no deps).  npm run test:content
 *
 * - monster shape (GD's), def + atk present (atk required: core reads mob.atk), windups >= 400 ms (boss >= 600), boss has
 *   a warned ring slam + charge, charge/slam telegraph kinds
 * - every quest step target exists (npc / node / item / recipe / monster / zone)
 *   and every arrowTo resolves; Q1 starts "Mine Rustbound ore" -> node_ore_rustbound
 *   with an Accept action on the offer; rewards/onAccept items exist
 * - quest progress helper (advance / tracker / giverMarker)
 * - every dungeon key (tiles, edges, props) exists in a sheet (live sheets, else snapshot)
 * - BFS: entry -> boss room -> exit, every exit reachable; spawns on walkable tiles;
 *   walk entry -> boss < 60 s; room count (3-4 pack rooms + elite + boss)
 * - approved rule changes: mirrored mob hit chance (atk), out-of-combat regen
 *   (2 HP/s after 4 s), combat XP 1/dmg + 0.33/dmg to Hitpoints
 * - balance targets (GD formula): rat 2-3 hits, goblin 4-6 hits at Rustbound,
 *   20-35% HP per goblin pack, brute needs dodging, ashmaw ~90 s Cinderiron / ~60 s Verdite
 *   and lethal without dodging; mob danger ordering
 * - Q1 estimate < 10 min, Q1+Q2 < 10 min with new-player slack; dungeon first clear
 *   ~15 min at Cinderiron with a handful of stews; Attack 15-20 after the first clear
 *   and Attack 40 multi-hour
 * - icon keys in docs/rpg-item-icons.json exist in the drawn rpg32 set
 * - banned names over every new content file and every display string
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const C = require('../../js/rpg/content/index.js');
const R = require('../../js/rpg/items/index.js');
const M = require('./combat-model.js');
const LIVE_BANNED = '/workspace/uat-names/banned-names.js';
const Banned = require(fs.existsSync(LIVE_BANNED) ? LIVE_BANNED : '../rpg/vendor/banned-names.js');
const SNAP = require('./sheet-keys.json');
const QUICK = process.argv.includes('--quick');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function deq(a, b, msg) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((msg || 'deep eq') + '\n' + x.slice(0, 400) + '\n' + y.slice(0, 400)); }

function sheetKeys(name) {
  const p = SNAP[name].path;
  if (fs.existsSync(p)) return new Set(Object.keys(JSON.parse(fs.readFileSync(p, 'utf8')).frames));
  return new Set(SNAP[name].keys);
}
const TOWN = sheetKeys('town'), PHASEB = sheetKeys('phaseb');
const ICONS = new Set([...sheetKeys('icons32'), ...sheetKeys('icons32_tinted')]);
const Db = R.ItemsDb, CR = R.Modules.crafting;

// ---------------------------------------------------------------- monsters
console.log('# monsters');
test('GD shape + def + atk on every monster', () => {
  const KINDS = ['melee', 'ranged', 'charge', 'slam'];
  for (const id of C.MONSTER_IDS) {
    const m = C.MONSTERS[id];
    eq(m.id, id);
    for (const k of ['hp', 'def', 'atk', 'speed', 'aggro', 'leash', 'xp']) ok(typeof m[k] === 'number' && m[k] >= 0, id + '.' + k);
    ok(Number.isInteger(m.atk) && Number.isInteger(m.def), id + ' atk/def integers');
    ok(Array.isArray(m.pack) && m.pack.length === 2 && m.pack[0] >= 1 && m.pack[1] >= m.pack[0], id + '.pack');
    ok(m.attacks.length >= 1, id + ' attacks');
    for (const a of m.attacks) {
      ok(KINDS.includes(a.kind), id + ' kind ' + a.kind);
      for (const k of ['dmg', 'range', 'windupMs', 'cooldownMs']) ok(typeof a[k] === 'number' && a[k] > 0, id + ' ' + a.kind + '.' + k);
      if (a.kind === 'charge') eq(a.telegraph, 'line', id + ' charge -> telegraphLine');
      if (a.kind === 'slam') eq(a.telegraph, 'ring', id + ' slam -> telegraph');
    }
  }
});
test('windups: every attack >= 400 ms, boss attacks >= 600 ms', () => {
  for (const id of C.MONSTER_IDS) for (const a of C.MONSTERS[id].attacks) {
    ok(a.windupMs >= C.MIN_WINDUP_MS, id + ' ' + a.kind + ' ' + a.windupMs);
    if (C.MONSTERS[id].boss) ok(a.windupMs >= C.MIN_BOSS_WINDUP_MS, 'boss ' + a.kind + ' ' + a.windupMs);
  }
});
test('lastHits recap: every attack carries the monster display name as srcName (brute + Ashmaw included)', () => {
  for (const id of C.MONSTER_IDS) for (const a of C.MONSTERS[id].attacks) eq(a.srcName, C.MONSTERS[id].name, id + ' ' + a.kind);
  eq(C.MONSTERS.brute.attacks.length, 3); eq(C.MONSTERS.ashmaw.attacks.length, 3);
  ok(C.MONSTERS.brute.attacks.every(a => a.srcName === 'Grave Brute'));
  ok(C.MONSTERS.ashmaw.attacks.every(a => a.srcName === 'Ashmaw the Wyrmling'));
});
test('brute telegraphs (charge + slam) wind up >= 600 ms; charge is 700 ms', () => {
  const b = C.MONSTERS.brute;
  eq(C.MIN_ELITE_TELEGRAPH_MS, 600);
  for (const a of b.attacks) if (a.kind === 'charge' || a.kind === 'slam') ok(a.windupMs >= C.MIN_ELITE_TELEGRAPH_MS, a.kind + ' ' + a.windupMs);
  eq(b.attacks.find(a => a.kind === 'charge').windupMs, 700);
});
test('ids rat goblin skeleton imp brute ashmaw; ashmaw has a ring slam and a charge', () => {
  deq(C.MONSTER_IDS.slice().sort(), ['ashmaw', 'brute', 'goblin', 'imp', 'rat', 'skeleton']);
  const k = C.MONSTERS.ashmaw.attacks.map(a => a.kind);
  ok(k.includes('slam') && k.includes('charge'), k.join());
  ok(C.MONSTERS.ashmaw.boss && C.MONSTERS.brute.elite);
});
test('every content monster has an RPGItems drop table (Loot ids match)', () => {
  for (const id of C.MONSTER_IDS) { ok(R.Loot.MONSTERS[id], id); eq(C.MONSTERS[id].name, R.Loot.MONSTERS[id].name, id + ' display name'); }
});
test('xp = 1 x hp (approved per-damage style rate)', () => { for (const id of C.MONSTER_IDS) eq(C.MONSTERS[id].xp, C.MONSTERS[id].hp * 1); });
test('atk field: required on every monster, danger rises rat < goblin < skeleton < imp <= brute <= ashmaw', () => {
  const cin = require('./loadouts.js').byId('cinderiron');
  const h = id => M.mobHitChance(C.MONSTERS[id].atk, cin.defence, cin.gear.def);
  ok(h('rat') < h('goblin') && h('goblin') < h('skeleton') && h('skeleton') < h('imp') && h('imp') <= h('brute') && h('brute') <= h('ashmaw'),
    C.MONSTER_IDS.map(id => id + ' ' + h(id).toFixed(2)).join(', '));
  ok(C.MONSTERS.ashmaw.atk > C.MONSTERS.brute.atk && C.MONSTERS.brute.atk > C.MONSTERS.skeleton.atk);
});
test('COMBAT_RULES in content match the sim (regen, XP rate, mob hit)', () => {
  const R0 = C.COMBAT_RULES;
  eq(R0.xpPerDamage, M.XP_RATE.style); eq(R0.hpXpPerDamage, M.XP_RATE.hitpoints);
  eq(R0.regenHpPerS, M.REGEN.hpPerS); eq(R0.regenDelayMs, M.REGEN.delayS * 1000);
  deq(R0.mobHit, { base: 0.75, perPoint: 0.015, min: 0.40, max: 0.97 });
});

// ---------------------------------------------------------------- quests
console.log('# quests');
const NODE_KEYS = new Set(Object.keys(CR.NODES));
function targetExists(type, t) {
  switch (type) {
    case 'talk': return !!C.NPCS[t];
    case 'gather': return Db.hasBase(t) && Object.values(CR.NODES).some(n => n.yields.some(y => y.base === t));
    case 'craft': return !!CR.RECIPES[t];
    case 'equip': return Db.hasBase(t) && !!Db.getBase(t).slot;
    case 'kill': return !!C.MONSTERS[t];
    case 'enter': return !!C.ZONES[t];
    default: return false;
  }
}
function arrowExists(a) {
  if (C.NPCS[a] || C.ZONES[a]) return true;
  if (NODE_KEYS.has(a)) return TOWN.has(a + '_full') || TOWN.has(a + '_0') || TOWN.has(a);   // node_ore_rustbound -> node_ore_rustbound_full
  return TOWN.has(a) || PHASEB.has(a);
}
test('every step: shape, target exists, arrowTo resolves', () => {
  const TYPES = ['talk', 'gather', 'craft', 'equip', 'kill', 'enter'];
  for (const q of C.QUESTS) {
    ok(q.steps.length >= 1, q.id);
    for (const s of q.steps) {
      ok(typeof s.text === 'string' && s.text.length > 0 && s.text.length <= 48, q.id + ' text len: ' + s.text);
      ok(TYPES.includes(s.done.type), q.id + ' type ' + s.done.type);
      ok(Number.isInteger(s.done.count) && s.done.count >= 1, q.id + ' count');
      ok(targetExists(s.done.type, s.done.target), q.id + ': ' + s.done.type + ' ' + s.done.target);
      ok(arrowExists(s.arrowTo), q.id + ': arrowTo ' + s.arrowTo);
    }
  }
});
test('arrow node keys match town sheet keys (ore / tree / fish nodes)', () => {
  for (const q of C.QUESTS) for (const s of q.steps) if (/^node_/.test(s.arrowTo)) {
    ok(TOWN.has(s.arrowTo + '_full') || TOWN.has(s.arrowTo), s.arrowTo);
  }
  for (const k of Object.keys(C.TOWN_POINTS)) if (/^(node_|prop_)/.test(k)) ok(TOWN.has(k) || TOWN.has(k + '_full'), k);
});
test('Q1 (GD build): first step after Accept is exactly "Mine Rustbound ore" -> node_ore_rustbound; offer has Accept', () => {
  const q = C.quest('q1_blade');
  eq(q.steps[0].text, 'Mine Rustbound ore');
  eq(q.steps[0].arrowTo, 'node_ore_rustbound');
  deq(q.steps[0].done, { type: 'gather', target: 'rustbound_ore', count: 2 });
  ok(q.dialogue.offer.actions.some(a => a.id === 'accept' && a.label === 'Accept'));
  eq(C.tracker({ questId: 'q1_blade', step: 0, n: 1 }), 'Mine Rustbound ore');
  deq(C.trackerCount({ questId: 'q1_blade', step: 0, n: 1 }), { n: 1, count: 2 });
});
test('Q1 covers gate 2: gather ore, smelt, smith sword, equip, talk; Smithing 1 is enough', () => {
  const q = C.quest('q1_blade');
  deq(q.steps.map(s => s.done.type), ['gather', 'craft', 'craft', 'equip', 'talk']);
  eq(CR.RECIPES.smith_rustbound_sword.level, 1);
  eq(CR.RECIPES.smelt_rustbound.level, 1);
  const ores = q.steps[0].done.count, bars = q.steps[1].done.count;
  eq(ores, bars * CR.RECIPES.smelt_rustbound.inputs[0].qty, 'ore count feeds the bar count');
  eq(bars, CR.RECIPES.smith_rustbound_sword.inputs[0].qty, 'bar count feeds the sword');
  deq(q.onAccept.items.map(i => i.base).sort(), ['rustbound_pickaxe', 'smithing_hammer']);
});
test('Q1 is playable end-to-end in an RPGItems world (pickaxe+hammer -> ore -> bars -> sword -> equip)', () => {
  const w = R.createWorld({ deviceId: 'qtest', lootSeed: 1, getLevels: () => ({ mining: 1, smithing: 1, attack: 1, defence: 1 }), storage: null });
  const q = C.quest('q1_blade');
  const g = w.Inventory.grant({ src: 'quest', ref: q.id, items: q.onAccept.items });
  ok(g.ok !== false, JSON.stringify(g));
  let prog = { questId: q.id, step: 0, n: 0 };
  for (let i = 0; i < 2; i++) { const r = w.Crafting.gather('node_ore_rustbound'); ok(r.ok, JSON.stringify(r)); prog = C.advance(prog, { type: 'gather', target: 'rustbound_ore' }).progress; }
  for (let i = 0; i < 2; i++) { const r = w.Crafting.make('smelt_rustbound'); ok(r.ok, JSON.stringify(r)); prog = C.advance(prog, { type: 'craft', target: 'smelt_rustbound' }).progress; }
  const s = w.Crafting.make('smith_rustbound_sword'); ok(s.ok, JSON.stringify(s));
  prog = C.advance(prog, { type: 'craft', target: 'smith_rustbound_sword' }).progress;
  const sword = w.Inventory.list().find(it => it && it.base === 'rustbound_sword');
  ok(sword, 'sword in bag');
  const e = w.Equipment.equip(sword.uid); ok(e.ok, JSON.stringify(e));
  prog = C.advance(prog, { type: 'equip', target: 'rustbound_sword' }).progress;
  const last = C.advance(prog, { type: 'talk', target: 'questgiver' });
  ok(last.questDone, 'quest done');
  const rw = w.Inventory.grant({ src: 'quest', ref: q.id, gold: q.rewards.gold, items: q.rewards.items });
  ok(rw.ok !== false, JSON.stringify(rw));
  eq(w.Gold.balance(), q.rewards.gold);
});
test('reward / onAccept items exist; gold > 0 for week-1 quests', () => {
  for (const q of C.QUESTS) {
    for (const it of (q.onAccept.items || []).concat(q.rewards.items || [])) ok(Db.hasBase(it.base), q.id + ' item ' + it.base);
    for (const sk in (q.rewards.xp || {})) ok(Db.SKILLS.includes(sk), q.id + ' xp skill ' + sk);
    if (q.ship === 'week1') ok(q.rewards.gold > 0);
    ok(!q.requires || C.quest(q.requires), q.id + ' requires');
    ok(!q.next || C.quest(q.next), q.id + ' next');
  }
});
test('scope: Q1 + Q2 ship, Q3 is a stub; rumour mentions Wyrmfang and points at the stair', () => {
  deq(C.WEEK1_QUESTS, ['q1_blade', 'q2_field']);
  eq(C.quest('q3_ashmaw').ship, 'stub');
  const r = C.quest('q2_field').dialogue.rumour;
  ok(r.lines.join(' ').includes('Wyrmfang'));
  eq(r.showDrops, 'ashmaw');
  ok(R.Loot.preview('ashmaw').some(p => p.base === 'wyrmfang'));
  ok(C.ZONES[r.arrowTo]);
});
test('dialogue is mobile-readable: <= 64 chars per line, <= 4 lines per screen', () => {
  for (const q of C.QUESTS) for (const k of Object.keys(q.dialogue)) {
    const d = q.dialogue[k];
    ok(d.lines.length <= 4, q.id + ' ' + k);
    for (const l of d.lines) ok(l.length <= 64, q.id + ' ' + k + ': ' + l);
  }
  for (const n of Object.values(C.NPCS)) for (const l of n.idle) ok(l.length <= 72, n.id + ': ' + l);
});
test('advance / tracker / giverMarker', () => {
  let p = { questId: 'q2_field', step: 0, n: 0 };
  eq(C.tracker(p), 'Catch fish at the pond (0/2)');
  let r = C.advance(p, { type: 'kill', target: 'goblin' }); ok(!r.advanced, 'wrong event ignored');
  r = C.advance(p, { type: 'gather', target: 'raw_mudminnow' }); ok(r.advanced && !r.stepDone); p = r.progress;
  eq(C.tracker(p), 'Catch fish at the pond (1/2)');
  r = C.advance(p, { type: 'gather', target: 'raw_mudminnow' }); ok(r.stepDone); eq(r.progress.step, 1);
  eq(C.giverMarker('questgiver', { done: {}, active: null }), '!');
  eq(C.giverMarker('questgiver', { done: { q1_blade: true, q2_field: true }, active: null }), '', 'stub Q3 not offered');
  eq(C.giverMarker('questgiver', { done: {}, active: { questId: 'q1_blade', step: 4, n: 0 } }), '?');
  eq(C.giverMarker('smith', { done: {}, active: null }), '');
  eq(C.offerable('questgiver', { done: { q1_blade: true } }).id, 'q2_field');
});
test('NPC ids match the town sheet (npc_<id>) and GD ids', () => {
  deq(Object.keys(C.NPCS).sort(), ['banker', 'questgiver', 'shopkeep', 'smith']);
  for (const n of Object.values(C.NPCS)) ok(TOWN.has(n.key), n.key);
  ok(R.Modules.shop.SHOPS[C.NPCS.smith.shop] && R.Modules.shop.SHOPS[C.NPCS.shopkeep.shop]);
});

// ---------------------------------------------------------------- dungeon
console.log('# dungeon');
const D = C.Dungeon;
test('grid is rectangular and uses only legend chars', () => {
  for (const r of D.rows) { eq(r.length, D.width); for (const ch of r) ok(D.legend[ch], 'char ' + ch); }
  eq(D.rows.length, D.height);
});
test('every dungeon key exists in a sheet (tiles + edges + props)', () => {
  const miss = D.keysUsed().filter(k => !TOWN.has(k) && !PHASEB.has(k));
  deq(miss, []);
  for (const L of Object.values(D.legend)) for (const k of L.base) ok(TOWN.has(k) || PHASEB.has(k), k);
});
test('BFS: entry -> boss room -> every exit; boss reachable', () => {
  const fromEntry = D.bfs(D.entry);
  const br = D.bossRoom;
  let bossCell = null;
  for (let y = br.y; y < br.y + br.h && !bossCell; y++) for (let x = br.x; x < br.x + br.w; x++) if (fromEntry[y * D.width + x] < Infinity) { bossCell = { x, y }; break; }
  ok(bossCell, 'boss room reachable from entry');
  const boss = D.spawns.find(s => s.monsterId === 'ashmaw');
  ok(fromEntry[boss.y * D.width + boss.x] < Infinity, 'ashmaw reachable');
  const fromBoss = D.bfs(boss);
  for (const e of D.exits) ok(fromBoss[e.y * D.width + e.x] < Infinity, 'exit ' + e.x + ',' + e.y);
  ok(D.walkable(D.entry.x, D.entry.y));
  eq(D.exits[0].to.map, 'town');
});
test('spawns on walkable tiles; every room spawn inside its room; ids exist', () => {
  for (const s of D.spawns) {
    ok(D.walkable(s.x, s.y), s.monsterId + '@' + s.x + ',' + s.y);
    ok(C.MONSTERS[s.monsterId], s.monsterId);
    const r = D.rooms.find(q => q.id === s.room);
    ok(r && s.x >= r.x && s.x < r.x + r.w && s.y >= r.y && s.y < r.y + r.h, s.monsterId + ' in ' + s.room);
  }
});
test('rooms: 3-4 pack rooms, one brute room, one boss room', () => {
  const k = D.rooms.map(r => r.kind);
  const packs = k.filter(x => x === 'pack').length;
  ok(packs >= 3 && packs <= 4, 'pack rooms ' + packs);
  eq(k.filter(x => x === 'elite').length, 1);
  eq(k.filter(x => x === 'boss').length, 1);
  eq(D.spawns.filter(s => s.monsterId === 'brute').length, 1);
  eq(D.spawns.filter(s => s.monsterId === 'ashmaw').length, 1);
});
test('walk entry -> boss without fighting < 60 s (GD metric)', () => {
  const boss = D.spawns.find(s => s.monsterId === 'ashmaw');
  const t = D.walkSeconds(D.entry, boss);
  ok(t < 60, t);
});
test('town gate zone + field spawns sit on GD town walkable ground (snapshot of D1 GROUND rows)', () => {
  // GD's world.js GROUND rows 26-37 (w = water). Gate path end + field anchors must be grass/path.
  const ROWS = {
    26: '...........ddd..............', 27: '............dd...wwwwww.....', 33: '..............wwwwwwwwwwww..',
    34: '...............wwwwwwwwww...', 35: '................wwwwwwww....', 37: '............................',
  };
  const chk = (x, y) => !ROWS[y] || ROWS[y][x] !== 'w';
  ok(chk(C.ZONES.ash_stair_gate.anchor.x, C.ZONES.ash_stair_gate.anchor.y));
  ok(chk(C.ZONES.goblin_field.anchor.x, C.ZONES.goblin_field.anchor.y));
  for (const s of C.FIELD_SPAWNS) ok(chk(s.x, s.y), s.monsterId + '@' + s.x + ',' + s.y);
});

// ---------------------------------------------------------------- balance
console.log('# balance (GD formula)');
const B = require('./balance-sim.js');
const N = QUICK ? 120 : 250;
const L = require('./loadouts.js');
// a target that never attacks: a lone mob only uses a minRange ranged attack while others hold melee
const DUMMY = { id: 'dummy', hp: 1e6, def: 0, atk: 0, pack: [1, 1], attacks: [{ kind: 'ranged', dmg: 1, range: 4, minRange: 2, windupMs: 400, cooldownMs: 1000 }] };
const P_RUST = { attack: 3, strength: 3, defence: 3, hitpoints: 10, gear: L.byId('rustbound').gear };
test('formula pieces match GD exactly', () => {
  eq(M.hitChance(1, 4, 0), 0.75 + 0.015 * 5);
  eq(M.hitChance(99, 99, 0), 0.97); eq(M.hitChance(1, 0, 99), 0.40);
  eq(M.maxHit(4, 4), 2 + 1 + 4); eq(M.minHit(7), 4);
  eq(M.taken(10, 50), 5);
  eq(M.playerHp(10, 0), 40); eq(M.playerHp(12, 0), 52);
  eq(M.swingSeconds(0), 0.6);
  deq(M.WEEK1_SKILLS, ['cleave', 'bolt'], 'Ground Slam cut to week 2');
  eq(M.XP_TABLE[40], 37224);
});
test('mob hit formula: clamp(0.75 + 0.015*(atk - Defence - gear.def), 0.40, 0.97)', () => {
  eq(M.mobHitChance(10, 10, 0), 0.75);
  ok(Math.abs(M.mobHitChance(8, 3, 0) - (0.75 + 0.015 * 5)) < 1e-12);
  ok(Math.abs(M.mobHitChance(20, 5, 5) - (0.75 + 0.015 * 10)) < 1e-12, 'gear.def subtracts');
  eq(M.mobHitChance(99, 1, 0), 0.97); eq(M.mobHitChance(0, 99, 0), 0.40);
});
test('mob hit roll in the sim lands at the formula rate; dodged hits never land', () => {
  const g = C.MONSTERS.goblin;
  const r = M.simulate(P_RUST, [g, g, g], { policy: 'never' }, 300, 5);
  const want = M.mobHitChance(g.atk, 3, 0);
  ok(Math.abs(r.mobHitRate - want) < 0.03, r.mobHitRate.toFixed(3) + ' vs ' + want);
  // a perfect dodger against a single slam: roll covers the hit, nothing lands even at 97%
  const slam = { id: 'slammer', hp: 1e6, def: 0, atk: 99, pack: [1, 1], attacks: [{ kind: 'slam', dmg: 30, range: 1.5, radius: 1.5, windupMs: 800, cooldownMs: 1e6, telegraph: 'ring' }] };
  for (let i = 0; i < 20; i++) { const f = M.fight(P_RUST, [slam], { policy: 'telegraphs', maxS: 6, rng: M.rng32(100 + i) }); eq(f.dmgTaken, 0, 'dodged slam landed'); }
  // armour still reduces a landed hit
  const f2 = M.fight(P_RUST, [slam], { policy: 'never', maxS: 6, rng: M.rng32(3) });
  ok(f2.dmgTaken === 0 || Math.abs(f2.dmgTaken - M.taken(30, P_RUST.gear.armour)) < 1e-9, 'landed slam = dmg*50/(50+armour): ' + f2.dmgTaken);
});
test('regen: 2 HP/s once 4 s pass without taking damage (in and out of a fight)', () => {
  eq(M.REGEN.hpPerS, 2); eq(M.REGEN.delayS, 4);
  eq(M.regenAfter(10, 40, 0, 4), 10, 'nothing inside the 4 s delay');
  eq(M.regenAfter(10, 40, 0, 6), 14);
  eq(M.regenAfter(10, 40, 10, 5), 20, 'delay already served');
  eq(M.regenAfter(35, 40, 10, 30), 40, 'capped at max HP');
  const fresh = M.fight(P_RUST, [DUMMY], { skills: false, startHp: 20, sinceHit: 99, maxS: 5, rng: M.rng32(1) });
  ok(Math.abs(fresh.hpLeft - 30) < 0.1, 'fresh: ' + fresh.hpLeft);
  const justHit = M.fight(P_RUST, [DUMMY], { skills: false, startHp: 20, sinceHit: 0, maxS: 5, rng: M.rng32(1) });
  ok(Math.abs(justHit.hpLeft - 22) < 0.1, 'just hit: ' + justHit.hpLeft);
  const off = M.fight(P_RUST, [DUMMY], { skills: false, startHp: 20, sinceHit: 99, maxS: 5, regen: false, rng: M.rng32(1) });
  eq(off.hpLeft, 20);
});
test('combat XP: 1 per damage to the style stat + 0.33 per damage to Hitpoints', () => {
  deq(M.XP_RATE, { style: 1, hitpoints: 0.33 });
  const x = M.combatXp(100);
  eq(x.style, 100); ok(Math.abs(x.hitpoints - 33) < 1e-9);
  // one goblin kill pays 22 style XP; Attack 2 (83 XP) takes ~4 goblins all on Attack
  eq(M.combatXp(C.MONSTERS.goblin.hp).style, 22);
  eq(M.levelFor(4 * 22), 2);
});
test('XP pace: Attack 15-20 after the first clear (typical), Attack 40 is multi-hour (>= 2.5 h of clears)', () => {
  const e = B.dungeonEstimate('cinderiron', QUICK ? 40 : 80, 'good');
  const rep = B.dungeonEstimate('verdite', QUICK ? 40 : 80, 'good', { repeat: true });
  const xp = B.xpModel(e.xpDamage, { first: e.totalS, repeat: rep.totalS });
  const T = xp.styles.typical, end = T.stages[T.stages.length - 1];
  ok(end.attack >= 15 && end.attack <= 20, 'typical Attack after first clear ' + end.attack);
  ok(T.stages[2].attack >= B.GEAR_LEVEL && T.stages[2].defence >= B.GEAR_LEVEL, 'grind reaches Cinderiron reqs');
  ok(T.toA40.hours.repeat >= 2.5, 'typical hours to Attack 40 ' + T.toA40.hours.repeat.toFixed(2));
  ok(xp.styles.even.toA40.hours.repeat > T.toA40.hours.repeat);
});
test('Rustbound player: rat in 2-3 hits, goblin in 4-6 hits', () => {
  const rat = B.row('rat', 'starter', N), gob = B.row('goblin', 'rustbound', N), gob0 = B.row('goblin', 'starter', N);
  ok(rat.hits >= 2 && rat.hits <= 3 && rat.hitsP10 >= 2 && rat.hitsP90 <= 3, 'rat ' + rat.hits);
  ok(gob.hits >= 4 && gob.hits <= 6 && gob.hitsP10 >= 4 && gob.hitsP90 <= 6, 'goblin ' + gob.hits);
  ok(gob0.hits >= 4 && gob0.hits <= 6, 'goblin (sword only) ' + gob0.hits);
});
test('goblin pack costs 20-35% HP to a never-dodging Rustbound player (sword-only Q2 player <= 37%)', () => {
  const r = B.row('goblin', 'rustbound', N), r0 = B.row('goblin', 'starter', N);
  ok(r.never.pctHp >= 20 && r.never.pctHp <= 35, r.never.pctHp);
  ok(r0.never.pctHp >= 20 && r0.never.pctHp <= 37, 'starter ' + r0.never.pctHp);
  eq(r.never.dieNoFood < 0.02, true);
});
test('brute needs dodging at Cinderiron (never-dodger dies without food; dodger survives)', () => {
  const r = B.row('brute', 'cinderiron', N);
  ok(r.never.dieNoFood >= 0.9, 'never ' + r.never.dieNoFood);
  ok(r.good.dieFood <= 0.05 && r.good.pctHp < 90, 'good ' + r.good.pctHp);
});
test('ashmaw: ~90 s at Cinderiron, ~60 s at Verdite (+-10%), lethal to a never-dodger even with 6 stews', () => {
  const c = B.row('ashmaw', 'cinderiron', N), v = B.row('ashmaw', 'verdite', N);
  ok(c.packTtk >= 81 && c.packTtk <= 99, 'cinderiron ' + c.packTtk);
  ok(v.packTtk >= 54 && v.packTtk <= 66, 'verdite ' + v.packTtk);
  ok(c.never.dieFood >= 0.95 && v.never.dieFood >= 0.95, 'never-dodger survives: ' + c.never.dieFood + ' ' + v.never.dieFood);
  ok(v.good.dieFood <= 0.05, 'verdite dodger ' + v.good.dieFood);
});
test('dungeon first clear ~15 min at Cinderiron (good dodger 13.5-18), a handful of stews with regen', () => {
  const e = B.dungeonEstimate('cinderiron', QUICK ? 60 : 120, 'good');
  ok(e.totalS / 60 >= 13.5 && e.totalS / 60 <= 18, (e.totalS / 60).toFixed(1));
  ok(e.foodStews <= 5, 'stews ' + e.foodStews.toFixed(2));
  ok(e.regenHp > 0 && e.expDeaths < 0.1, 'regen ' + e.regenHp + ' deaths ' + e.expDeaths);
  const t = B.dungeonEstimate('cinderiron', QUICK ? 60 : 120, 'telegraphs');
  ok(t.foodStews <= 8 && t.totalS / 60 <= 20, 'telegraph-only roller: ' + t.foodStews.toFixed(1) + ' stews, ' + (t.totalS / 60).toFixed(1) + ' min');
});
test('Q1 estimate < 10 min (gate 2)', () => {
  const Q = require('./quest-times.js').estimates();
  ok(Q[0].totalS < 600, Q[0].totalS);
  ok(Q[0].totalS * 2.5 < 600, 'even at 2.5x new-player slack');
});
test('first-Rare pity: Q2 + the Cinderiron grind put a typical player past the ramp; >= 80% get the first Rare on the field', () => {
  const FR = R.Loot.FIRST_RARE;
  ok(R.Loot.MONSTERS.goblin.nearTown && R.Loot.MONSTERS.rat.nearTown);
  for (const s of C.FIELD_SPAWNS) ok(R.Loot.MONSTERS[s.monsterId].nearTown, s.monsterId);
  const kills = Math.round(5 + 2.5 + B.grindDamage(B.STYLES.typical) / C.MONSTERS.goblin.hp);   // Q2 (~5 goblins + a rat pack) + grind
  ok(kills >= FR.RAMP_START + 10, 'field kills ' + kills);
  let got = 0; const N = 600;
  for (let i = 0; i < N; i++) {
    const rng = M.rng32(9000 + i); let fr = { done: false, kills: 0 };
    for (let k = 0; k < kills && !fr.done; k++) fr = R.Loot.rollDrop(k % 4 === 3 ? 'rat' : 'goblin', rng, { firstRare: fr }).firstRare;
    if (fr.done) got++;
  }
  ok(got / N >= 0.8, 'P(first Rare on the field) ' + (got / N).toFixed(2));
});
test('Cinderiron wear requirement is Attack 3 / Defence 3 (PM-approved); grind after Q2 is short; Wyrmfang stays Attack 40', () => {
  deq(B.GEAR_REQ, { attack: 3, defence: 3 });
  eq(Db.getBase('wyrmfang').req.attack, 40);
  const st = B.STYLES.typical, g = B.grindDamage(st);
  const mins = B.fieldGrindMinutes(g, 'rustbound');
  ok(mins < 5, 'typical grind ' + mins.toFixed(2) + ' min');
  ok(mins * require('./quest-times.js').NEW_PLAYER_SLACK < 10, 'cold player (x slack) ' + (mins * 2.5).toFixed(2));
  const x = B.styleXp(st, B.q2Damage() + g);
  ok(M.levelFor(x.a) >= 3 && M.levelFor(x.d) >= 3, 'reqs met after the grind');
});
test('Ashmaw at the typical player\'s real boss-time levels in Cinderiron stays <= 100 s and still needs dodging', () => {
  const e = B.dungeonEstimate('cinderiron', 40, 'good');
  const r = B.ashmawAtRealLevels(e.xpDamage, QUICK ? 120 : 200);
  const boss = r.find(x => x.at === 'boss');
  ok(boss.ttk >= 70 && boss.ttk <= 100, 'boss-time ttk ' + boss.ttk.toFixed(1));
  ok(boss.neverDies >= 0.95 && boss.dieFood <= 0.05);
});
test('first clear at real levels (enter at the req, levels grow): ~15 min, a handful of stews', () => {
  const st = B.STYLES.typical;
  const e = B.dungeonEstimate('cinderiron', QUICK ? 50 : 100, 'good', { progress: { style: st, startDmg: B.q2Damage() + B.grindDamage(st) } });
  ok(e.totalS / 60 >= 13.5 && e.totalS / 60 <= 18, (e.totalS / 60).toFixed(1));
  ok(e.foodStews <= 5 && e.expDeaths < 0.1, e.foodStews.toFixed(2) + ' stews, ' + e.expDeaths + ' deaths');
});
test('Q1 ~2-3 min and Q1+Q2 ~7 min (< 10) with new-player slack; Q1 text unchanged', () => {
  const QT = require('./quest-times.js'), Q = QT.estimates(), k = QT.NEW_PLAYER_SLACK;
  const q1 = Q[0].totalS * k / 60, both = (Q[0].totalS + Q[1].totalS) * k / 60;
  ok(q1 >= 2 && q1 <= 3, 'Q1 ' + q1.toFixed(2));
  ok(both >= 5.5 && both < 10, 'Q1+Q2 ' + both.toFixed(2));
  eq(C.quest('q1_blade').steps[0].text, 'Mine Rustbound ore');
});

// ---------------------------------------------------------------- icons
console.log('# icons');
test('every key in docs/rpg-item-icons.json exists in the drawn rpg32 set', () => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/rpg-item-icons.json'), 'utf8'));
  const miss = [];
  for (const ic of man.icons) {
    if (!ICONS.has(ic.key)) miss.push(ic.key);
    for (const it of ic.items || []) if (!ICONS.has(it.key)) miss.push(it.key);
  }
  deq(miss, []);
});
test('every item in quests (onAccept/rewards/targets) has a drawn icon', () => {
  const ids = new Set();
  for (const q of C.QUESTS) {
    (q.onAccept.items || []).concat(q.rewards.items || []).forEach(i => ids.add(i.base));
    q.steps.forEach(s => { if (s.done.type === 'gather' || s.done.type === 'equip') ids.add(s.done.target); });
  }
  deq([...ids].filter(id => !ICONS.has('icon_' + id)), []);
});

// ---------------------------------------------------------------- banned names
console.log('# banned names');
function contentFiles() {
  const out = [];
  const add = (d, re) => fs.readdirSync(path.join(ROOT, d)).filter(f => re.test(f)).forEach(f => out.push(path.join(ROOT, d, f)));
  add('js/rpg/content', /\.js$/);
  add('dev/content', /\.(js|py)$/);
  add('docs', /^rpg-content/);
  return out;
}
test('scanFile: 0 FAIL / 0 WARN in every content file', () => {
  for (const f of contentFiles()) {
    const r = Banned.scanFile(f, fs);
    ok(r.fails === 0 && r.warns === 0, path.relative(ROOT, f) + ':\n' + r.lines.join('\n'));
  }
});
test('every display string passes check(): names, titles, dialogue, step text, zones, rooms', () => {
  const s = [];
  Object.values(C.MONSTERS).forEach(m => { s.push(m.name); m.attacks.forEach(a => a.name && s.push(a.name)); });
  Object.values(C.NPCS).forEach(n => { s.push(n.name); s.push(...n.idle); });
  Object.values(C.ZONES).forEach(z => s.push(z.name));
  s.push(D.name);
  C.QUESTS.forEach(q => {
    s.push(q.title, q.summary);
    q.steps.forEach(st => s.push(st.text));
    Object.values(q.dialogue).forEach(d => { s.push(...d.lines); (d.actions || []).forEach(a => s.push(a.label)); });
  });
  const bad = s.map(x => [x, Banned.check(x)]).filter(x => x[1][0] !== 'OK');
  deq(bad, []);
});
test('every capitalised string literal in content code passes check()', () => {
  for (const f of contentFiles().filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /'((?:[^'\\\n]|\\.){3,})'/g;
    let m;
    while ((m = re.exec(src))) {
      if (!/[A-Z ]/.test(m[1])) continue;
      const v = Banned.check(m[1]);
      ok(v[0] === 'OK', path.relative(ROOT, f) + ': "' + m[1] + '" ' + v.join(' '));
    }
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1); }
