#!/usr/bin/env node
/**
 * Skills & Quests tests (node, no deps).  npm run test:sq
 * Fake core per docs/rpg-core-hooks.md + a real RPGItems world + Senior's RPGContent.
 * Plays Q1 and Q2 cold through the S&Q systems with walk time, swing timers and
 * respawns, and checks Q1 < 10 min (UAT gate 2), XP, rewards, markers, tracker.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '../..');
const C = require('../../js/rpg/content/index.js');
const R = require('../../js/rpg/items/index.js');
const LIVE_BANNED = '/workspace/uat-names/banned-names.js';
const Banned = require(fs.existsSync(LIVE_BANNED) ? LIVE_BANNED : '../rpg/vendor/banned-names.js');
globalThis.RPG = undefined;
const SQ = require('../../js/rpg/skills-xp.js');
require('../../js/rpg/skills-gather.js'); require('../../js/rpg/skills-craft.js');
require('../../js/rpg/quests-runtime.js'); require('../../js/rpg/quests-ui.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n       ')); }
}
function eq(a, b, m) { if (a !== b) throw new Error((m || 'eq') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(v, m) { if (!v) throw new Error(m || 'expected truthy'); }
const flush = () => new Promise(r => setImmediate(r));

/** Fake core. Walk speed matches Senior's quest-times (80 px/s, 32x18 px tiles, x1.25 detour). */
function makeCore(seed) {
  const handlers = {}, systems = [], taps = [], ents = new Map(), log = { toast: [], float: [], tracker: [], dialog: [], fx: [] };
  let nextId = 1, s = seed >>> 0 || 1;
  const xp = {}; SQ.ALL_SKILLS.forEach(k => xp[k] = 0);
  const slices = {}, reducers = {};
  const P = C.TOWN_POINTS;
  const RPG = {
    __sqNoAuto: true,
    bus: { on(e, f) { (handlers[e] = handlers[e] || []).push(f); }, emit(e, d) { (handlers[e] || []).forEach(f => f(d)); } },
    registerSystem(sys) { systems.push(sys); },
    registerTappable(t) { taps.push(t); },
    world: {
      zone: { id: 'town', markers: {
        ore: [{ x: P.node_ore_rustbound.x, y: P.node_ore_rustbound.y, tier: 'rustbound' }, { x: P.node_ore_rustbound.x + 1, y: P.node_ore_rustbound.y + 1, tier: 'rustbound' },
              { x: P.node_ore_cinderiron.x, y: P.node_ore_cinderiron.y, tier: 'cinderiron' }],
        tree: [{ x: P.node_tree_pine.x, y: P.node_tree_pine.y, kind: 'pine' }, { x: P.node_tree_ash.x, y: P.node_tree_ash.y, kind: 'ash' }],
        fish: [{ x: P.node_fish_0.x, y: P.node_fish_0.y }],
        furnace: { x: P.prop_furnace_0.x, y: P.prop_furnace_0.y }, anvil: { x: P.prop_anvil_0.x, y: P.prop_anvil_0.y },
        range: { x: P.prop_range_0.x, y: P.prop_range_0.y }, fire: [] } },
      addEntity(e) { const id = nextId++; ents.set(id, e); return id; },
      removeEntity(id) { ents.delete(id); },
      near(x, y, r, kind) { return [...ents.values()].filter(e => (!kind || e.kind === kind) && Math.hypot(e.x - x, e.y - y) <= r); },
    },
    hero: { x: P.spawn.x, y: P.spawn.y, alive: true },
    stats: { level: k => SQ.levelForXp(xp[k] || 0), addXp: (k, n) => { xp[k] = (xp[k] || 0) + n; } },
    ui: {
      choose: null,
      toast: t => log.toast.push(t), float: (x, y, t) => log.float.push(t), tracker: (t, p) => log.tracker.push({ t, p }),
      dialog(npc, lines, choices, opts) { log.dialog.push({ npc, lines, choices, opts }); const c = RPG.ui.choose ? RPG.ui.choose(npc, lines, choices) : choices[0]; return Promise.resolve(c); },
    },
    fx: (n) => log.fx.push(n),
    rng: () => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; },
    store: {
      register(name, red, init) { reducers[name] = red; slices[name] = init; },
      dispatch(a) { const n = a.type.split('/')[0]; slices[n] = reducers[n](slices[n], a); },
      get(n) { return slices[n]; },
    },
  };
  const w = R.createWorld({ deviceId: 'sq' + seed, lootSeed: seed, storage: null, getLevels: () => RPG.skills.levels() });
  RPG.items = w; RPG.content = C;
  // NPC entities like core's town.
  for (const id of ['questgiver', 'banker', 'shopkeep', 'smith']) RPG.world.addEntity({ kind: 'npc', npcId: 'npc_' + id, sprite: 'npc_' + id, x: P[id].x, y: P[id].y });
  SQ.install(RPG); SQ.installGather(RPG); SQ.installCraft(RPG); SQ.installQuests(RPG); SQ.installQuestsUi(RPG);

  const sim = { RPG, w, log, xp, t: 0, walkS: 0, ents,
    tick(sec) { const dt = 0.05; for (let i = 0; i < Math.round(sec / dt); i++) { sim.t += dt; systems.forEach(sy => sy.update && sy.update(dt)); } },
    walkTo(x, y) { const d = Math.hypot((x - RPG.hero.x) * 32, (y - RPG.hero.y) * 18) / 80 * 1.25; sim.walkS += d; sim.tick(d); RPG.hero.x = x; RPG.hero.y = y; },
    /** Tap a tile: first tappable that hits gets the hero walked next to it, then onArrive. */
    tap(x, y) {
      for (const t of taps) { const e = t.hit(x, y); if (e) { sim.walkTo(e.x, e.y + 0.9); t.onArrive(e); return e; } }
      return null;
    },
    busy() { return !!(RPG.skills.gather.active() || RPG.skills.craft.active()); },
    waitIdle(max) { let n = 0; while (sim.busy() && n < (max || 600)) { sim.tick(0.25); n += 0.25; } },
    async talk(id) { const p = C.TOWN_POINTS[id]; sim.walkTo(p.x, p.y + 1); RPG.bus.emit('talk', { npcId: 'npc_' + id }); for (let i = 0; i < 6; i++) await flush(); sim.tick(3); },
    gatherUntil(nodeKey, base, n) {
      let guard = 0;
      while (w.Inventory.count(base) < n && guard++ < 60) {
        const p = RPG.skills.pointFor(nodeKey); ok(p, 'node ' + nodeKey);
        const node = RPG.skills.gather.nodes().find(e => e.x === p.x && e.y === p.y);
        if (node.depleted) { sim.tick(0.5); continue; }
        sim.tap(p.x, p.y); sim.waitIdle();
      }
    },
  };
  return sim;
}

async function playQ1(seed) {
  const s = makeCore(seed), { RPG, w } = s;
  await s.talk('questgiver');
  eq(RPG.quests.active().questId, 'q1_blade', 'accepted');
  const tr = s.log.tracker[s.log.tracker.length - 1];
  eq(tr.t, 'Mine Rustbound ore', 'tracker right after Accept');
  ok(tr.p && tr.p.x === C.TOWN_POINTS.node_ore_rustbound.x, 'arrow on the Rustbound rock');
  s.gatherUntil('node_ore_rustbound', 'rustbound_ore', 2);
  eq(RPG.quests.active().step, 1, 'mined 2');
  const f = RPG.skills.pointFor('prop_furnace_0'); s.tap(f.x, f.y); s.waitIdle();
  eq(w.Inventory.count('rustbound_bar'), 2, 'smelted both bars in one tap');
  eq(RPG.quests.active().step, 2);
  const a = RPG.skills.pointFor('prop_anvil_0'); s.tap(a.x, a.y); s.waitIdle();
  const sword = w.Inventory.list().find(it => it && it.base === 'rustbound_sword');
  ok(sword, 'sword made (quest recipe picked without a menu)');
  eq(RPG.quests.active().step, 3);
  s.tick(4);                                                  // player opens the bag
  ok(w.Equipment.equip(sword.uid).ok); RPG.bus.emit('equip', { slot: 'weapon', itemId: sword.uid });
  eq(RPG.quests.active().step, 4, 'wield step');
  eq(RPG.quests.marker('npc_questgiver'), '?');
  await s.talk('questgiver');
  ok(RPG.quests.state().done.q1_blade, 'Q1 done');
  return s;
}

(async () => {
  console.log('Skills & Quests tests');
  test('XP curve matches PLAN.md (L2 = 83, L10 = 1154, L99 = 13034431)', () => {
    eq(SQ.xpForLevel(2), 83); eq(SQ.xpForLevel(10), 1154); eq(SQ.xpForLevel(99), 13034431); eq(SQ.levelForXp(82), 1); eq(SQ.levelForXp(83), 2);
  });
  test('nodes and stations spawn from zone markers with town sheet keys', () => {
    const s = makeCore(1), n = s.RPG.skills.gather.nodes(), st = s.RPG.skills.craft.stations();
    eq(n.length, 6); eq(st.length, 3);
    const keys = JSON.parse(fs.readFileSync('/workspace/rsc-look/town/sheet.json', 'utf8'));
    const all = new Set(Object.keys(keys.frames || keys));
    n.concat(st).forEach(e => ok(all.has(e.sprite), 'sheet key ' + e.sprite));
    ['node_ore_rustbound_empty', 'node_tree_pine_stump', 'node_tree_ash_stump'].forEach(k => ok(all.has(k), k));
  });
  test('no pickaxe: tapping ore says so and does not swing', () => {
    const s = makeCore(2), p = s.RPG.skills.pointFor('node_ore_rustbound');
    s.tap(p.x, p.y); ok(!s.busy()); ok(s.log.toast.includes('You need a pickaxe.'), s.log.toast.join('|'));
  });
  test('level gate: Cinderiron ore needs Mining 10', () => {
    const s = makeCore(3); s.w.Inventory.grant({ src: 'quest', ref: 't', items: [{ base: 'rustbound_pickaxe', qty: 1 }] });
    const p = s.RPG.skills.pointFor('node_ore_cinderiron'); s.tap(p.x, p.y);
    ok(!s.busy()); ok(s.log.toast.some(t => /Mining level/.test(t)), s.log.toast.join('|'));
  });
  test('moving away cancels gathering', () => {
    const s = makeCore(4); s.w.Inventory.grant({ src: 'quest', ref: 't', items: [{ base: 'rustbound_pickaxe', qty: 1 }] });
    const p = s.RPG.skills.pointFor('node_ore_rustbound'); s.tap(p.x, p.y); ok(s.busy());
    s.RPG.hero.x += 2; s.tick(0.1); ok(!s.busy());
  });

  let q1;
  await (async () => { try { q1 = await playQ1(7); pass++; console.log('  ok  Q1 plays end-to-end through the S&Q systems'); } catch (e) { fail++; console.log('  FAIL Q1 end-to-end\n       ' + String(e.stack).split('\n').slice(0, 5).join('\n       ')); } })();
  if (q1) {
    test('Q1 rewards: 25 gold, 3 Hearth Bread, Mining and Smithing XP; tools kept', () => {
      eq(q1.w.Gold.balance(), 25); eq(q1.w.Inventory.count('hearth_bread'), 3); ok(q1.w.Inventory.has('rustbound_pickaxe'));
      ok(q1.xp.mining >= 40 + 2 * 1, 'mining xp ' + q1.xp.mining); ok(q1.xp.smithing >= 60 + 16 + 24, 'smithing xp ' + q1.xp.smithing);
    });
    test('UAT gate 2: Q1 in game time well under 10 min (x2.5 new-player slack)', () => {
      console.log('       Q1 game time ' + q1.t.toFixed(1) + ' s (walk ' + q1.walkS.toFixed(1) + ' s), x2.5 = ' + (q1.t * 2.5 / 60).toFixed(1) + ' min');
      ok(q1.t * 2.5 < 600, 'too slow');
    });
    test('after Q1 the giver offers Q2 and the tracker points at her', () => {
      eq(q1.RPG.quests.marker('npc_questgiver'), '!');
      eq(q1.RPG.quests.current().text, 'Talk to Warden Ilse');
    });
    await (async () => {
      const s = q1, { RPG, w } = s, t0 = s.t;
      try {
        await s.talk('questgiver'); eq(RPG.quests.active().questId, 'q2_field');
        ok(w.Inventory.has('fishing_rod'));
        s.gatherUntil('node_fish_0', 'raw_mudminnow', 2); eq(RPG.quests.active().step, 1, 'fished 2');
        const r = RPG.skills.pointFor('prop_range_0'); s.tap(r.x, r.y); s.waitIdle();
        eq(RPG.quests.active().step, 2, 'cooked 2 (burnt counts)');
        const z = C.ZONES.goblin_field.anchor; s.walkTo(z.x, z.y); s.tick(0.6);
        eq(RPG.quests.active().step, 3, 'area enter detected');
        for (let i = 0; i < 4; i++) RPG.bus.emit('kill', { monsterId: i % 2 ? 'goblin' : 'rat' });
        eq(RPG.quests.active().n, 2, 'only goblins count');
        ok(!RPG.quests.completesOnKill('goblin'), '3rd goblin does not finish');
        ok(!RPG.quests.completesOnKill('rat'), 'rat never finishes');
        RPG.bus.emit('kill', { monsterId: 'goblin' });
        s.tick(0.05); ok(RPG.quests.completesOnKill('goblin'), 'drops-first: 4th goblin finishes');
        const ev = { monsterId: 'goblin' };
        RPG.bus.emit('kill', ev);
        eq(RPG.quests.active().step, 4);
        ok(RPG.quests.completesOnKill('goblin', ev), 'quests-first: same kill still reads true via payload');
        ok(RPG.quests.completesOnKill('goblin'), 'quests-first: same frame, no payload, still true');
        s.tick(0.05); ok(!RPG.quests.completesOnKill('goblin'), 'later kills read false');
        s.log.dialog.length = 0;
        ok(!RPG.quests.isDone('q2'), 'Q2 not done before hand-in (gate stays shut)');
        const def0 = s.xp.defence;
        await s.talk('questgiver');
        ok(RPG.quests.state().done.q2_field, 'Q2 done');
        ok(RPG.quests.isDone('q2') && RPG.quests.isDone('q2_field') && RPG.quests.isDone('q1'), 'isDone short and full ids');
        ok(!RPG.quests.isDone('q3') && !RPG.quests.isDone(''), 'isDone false for unfinished/blank');
        eq(s.xp.defence - def0, C.quest('q2_field').rewards.xp.defence, 'Q2 Defence XP from data');
        eq(s.xp.defence - def0, 55, 'Q2 pays +55 Defence');
        ok(s.log.float.some(f => /\+55 Defence/.test(f)), 'floats +55 Defence');
        eq(w.Gold.balance(), 85); ok(w.Inventory.has('rustbound_shield'));
        const rum = s.log.dialog.find(d => d.lines.some(l => /Ashmaw/.test(l)));
        ok(rum && rum.opts && rum.opts.drops.length, 'rumour carries the drop list');
        ok(!('title' in rum.opts), 'no title: header stays the NPC name');
        const pv = w.Loot.preview('ashmaw');
        eq(rum.opts.drops.map(d => d.name).join('|'), pv.map(d => d.name).join('|'), 'same list and order as Loot.preview');
        eq(rum.opts.drops[0].name, 'Wyrmfang'); eq(rum.opts.drops[0].beamColor, '#ff9a2e'); eq(rum.opts.drops[0].icon, 'icon_wyrmfang');
        eq(RPG.quests.marker('npc_questgiver'), '', 'stub Q3 not offered');
        eq(RPG.quests.current().text, 'Explore the Ash Stair');
        console.log('       Q2 game time (no combat) ' + (s.t - t0).toFixed(1) + ' s');
        pass++; console.log('  ok  Q2 plays end-to-end (fish, cook, field, 4 goblins, rumour)');
      } catch (e) { fail++; console.log('  FAIL Q2 end-to-end\n       ' + String(e.stack).split('\n').slice(0, 5).join('\n       ')); }
    })();
  }
  await (async () => {
    const s = makeCore(9); s.RPG.ui.choose = (n, l, c) => c.find(x => x.id === 'decline') || c[0];
    await s.talk('questgiver');
    try { eq(s.RPG.quests.active(), null); eq(s.RPG.quests.marker('npc_questgiver'), '!'); pass++; console.log('  ok  decline keeps the offer'); }
    catch (e) { fail++; console.log('  FAIL decline\n       ' + e.message); }
  })();
  await (async () => {
    const a = await playQ1(11), b = await playQ1(11);
    try { eq(a.t, b.t, 'same game time'); eq(JSON.stringify(a.xp), JSON.stringify(b.xp)); pass++; console.log('  ok  seeded replay is deterministic'); }
    catch (e) { fail++; console.log('  FAIL determinism\n       ' + e.message); }
  })();
  test('banned names: 0 FAIL / 0 WARN in S&Q files', () => {
    const files = fs.readdirSync(path.join(ROOT, 'js/rpg')).filter(f => /^(skills|quests)-.*\.js$/.test(f)).map(f => path.join(ROOT, 'js/rpg', f)).concat([__filename]);
    eq(files.length, 6);
    for (const f of files) { const r = Banned.scanFile(f, fs); ok(r.fails === 0 && r.warns === 0, f + '\n' + r.lines.join('\n')); }
  });
  test('getLevels works with RPG.skills.levels uncalled (GD D1 wiring) and called', () => {
    const s = makeCore(5); s.xp.mining = SQ.xpForLevel(10);
    eq(s.RPG.skills.levels.mining, 10); eq(s.RPG.skills.levels().mining, 10);
    const w = R.createWorld({ deviceId: 'lv', lootSeed: 1, storage: null, getLevels: () => s.RPG.skills ? s.RPG.skills.levels : {} });
    w.Inventory.grant({ src: 'quest', ref: 't', items: [{ base: 'rustbound_pickaxe', qty: 1 }] });
    const r = w.Crafting.gather('node_ore_cinderiron'); ok(r.reason !== 'level_too_low', JSON.stringify(r));
  });
  test('markers use RPG.camera.toScreen when core has it', () => {
    const prev = globalThis.RPG; globalThis.RPG = { camera: { toScreen: (x, y) => ({ x: x * 10, y: y * 10 }) } };
    const p = SQ.toScreen({}, 2, 3); globalThis.RPG = prev; eq(p.x, 20); eq(p.y, 30);
  });
  test('no Math.random in S&Q files', () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'js/rpg')).filter(f => /^(skills|quests)-.*\.js$/.test(f)))
      ok(!/Math\.random\(/.test(fs.readFileSync(path.join(ROOT, 'js/rpg', f), 'utf8')), f);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
