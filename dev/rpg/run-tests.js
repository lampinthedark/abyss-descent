#!/usr/bin/env node
/**
 * Items test runner (node, no browser, no deps).  npm run test:items
 *
 * Covers: item DB + deterministic rolls, drop tables + pity, banned names,
 * randomized op sequences with invariants (no dup, no negative stacks,
 * tagged gold only, <=28 slots, failed ops change nothing), shop no-profit,
 * full-inventory behaviour, atomic crafting, equipment, bank, save
 * round-trip / atomic swap / fallback / migration / triggers, replay +
 * idempotency, ItemIds, icon manifest freshness, sim smoke.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '../..');
const R = require('../../js/rpg/items/index.js');
const { ItemsDb: Db, ItemGen: Gen, Loot, Core, State: S } = R;

// Banned-names checker: prefer the live UAT copy, else the vendored snapshot
// (dev/rpg/vendor/banned-names.js = /workspace/uat-names/banned-names.js, sha256 9df59dea…).
const LIVE = '/workspace/uat-names/banned-names.js';
const Banned = require(fs.existsSync(LIVE) ? LIVE : './vendor/banned-names.js');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function deq(a, b, msg) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((msg || 'deep eq') + '\n' + x.slice(0, 300) + '\n' + y.slice(0, 300)); }
function noInv(w, msg) { const e = w.checkInvariants(); if (e.length) throw new Error((msg || 'invariants') + ': ' + e.slice(0, 5).join('; ')); }

const ALL = { attack: 99, strength: 99, defence: 99, hitpoints: 99, mining: 99, smithing: 99, woodcutting: 99, fishing: 99, cooking: 99 };
function mkWorld(o) {
  o = o || {};
  let t = o.t0 || 1000000;
  const clock = { get: () => t, add: (ms) => { t += ms; } };
  const levels = o.levels || ALL;
  const w = R.createWorld(Object.assign({ playerId: 'p1', deviceId: 'devA', lootSeed: 42, now: () => t, autosave: false,
    getLevels: () => levels, storage: o.storage || R.Modules.itemSave.memoryStorage() }, o.opts || {}));
  w.clock = clock;
  return w;
}
function give(w, base, qty, rarity) { const r = w.Inventory.add(base, qty || 1, { src: 'dev', rarity }); ok(r.ok, 'give ' + base + ' ' + r.reason); return r; }

console.log('# item database + rolls');
test('6 tiers ending in the dragon tier; plan tier names present', () => {
  eq(Db.TIERS.length, 6);
  deq(Db.TIERS.slice(0, 5).map((t) => t.name), ['Rustbound', 'Cinderiron', 'Verdite', 'Tidesteel', 'Sunforged']);
  eq(Db.TIERS[5].id, 'wyrm');
  const wf = Db.getBase('wyrmfang');
  eq(wf.tier, 'wyrm'); eq(wf.slot, 'weapon'); eq(wf.kind, 'sword');
});
test('every base is well formed; requirements use only GD skills', () => {
  Db.ORDER.forEach((id) => {
    const b = Db.BASES[id];
    ok(b.name && b.value >= 0, id);
    if (b.stackable) ok(!b.slot, id + ' stackable with slot');
    Object.keys(b.req).forEach((k) => ok(Db.SKILLS.includes(k), id + ' req ' + k));
    const inst = Gen.createInstance(id, { seed: 1 });
    deq(Gen.validate(inst), [], id);
  });
  ok(Db.ORDER.length > 80);
});
test('ore/log/fish line up with town sheet node keys', () => {
  const sheet = '/workspace/rsc-look/town/sheet.json';
  if (!fs.existsSync(sheet)) return;
  const keys = Object.keys(JSON.parse(fs.readFileSync(sheet, 'utf8')).frames);
  Object.keys(R.Modules.crafting.NODES).forEach((n) => ok(keys.some((k) => k.indexOf(n) === 0), 'node ' + n + ' not on sheet'));
});
test('affix rolls are deterministic and re-verifiable from (base, rarity, seed)', () => {
  for (let i = 0; i < 300; i++) {
    const pool = Loot.gearPool(['cinderiron', 'verdite', 'tidesteel']);
    const base = pool[i % pool.length];
    const rarity = i % 2 ? 'rare' : 'very_rare';
    const a = Gen.createInstance(base, { rarity, seed: i * 7919 });
    const b = Gen.createInstance(base, { rarity, seed: i * 7919 });
    deq(Gen.stats(a), Gen.stats(b));
    deq(Gen.rollAffixes(base, rarity, i * 7919), Gen.rollAffixes(base, rarity, i * 7919));
    const n = Gen.rollAffixes(base, rarity, i * 7919).length;
    ok(rarity === 'rare' ? n >= 1 && n <= 2 : n >= 3 && n <= 4, base + ' ' + rarity + ' affix count ' + n);
    ok(Gen.verifyStats(a, Gen.stats(a)));
    const forged = Gen.stats(a); forged.power += 1;
    ok(!Gen.verifyStats(a, forged), 'forged stats accepted');
  }
  eq(Gen.rollAffixes('rustbound_sword', 'normal', 5).length, 0);
});
test('every gear group can fill a Very Rare (>= 4 eligible affixes)', () => {
  const groups = new Set(Db.ORDER.map((id) => Db.BASES[id]).filter((b) => Db.isGear(b)).map((b) => b.group));
  groups.forEach((g) => ok(Db.AFFIXES.filter((a) => a.groups.includes(g)).length >= 4, g));
});
test('affix values scale with tier and stay in range', () => {
  const lo = Db.affixRange(Db.AFFIX_BY_ID.strength, 0), hi = Db.affixRange(Db.AFFIX_BY_ID.strength, 5);
  ok(hi[0] > lo[1], 'tier scaling');
  for (let s = 0; s < 500; s++) {
    const base = 'tidesteel_sword';
    Gen.rollAffixes(base, 'very_rare', s).forEach((a) => {
      const r = Db.affixRange(Db.AFFIX_BY_ID[a.id], 3);
      ok(a.v >= r[0] && a.v <= r[1] && Number.isInteger(a.v));
      ok(Db.AFFIX_BY_ID[a.id].groups.includes('weapon'));
    });
  }
});
test('legendaries: fixed signature, always bound, beams exposed', () => {
  const a = Gen.createInstance('wyrmfang', { seed: 1 }), b = Gen.createInstance('wyrmfang', { seed: 999 });
  eq(a.rarity, 'legendary'); ok(a.bound && b.bound);
  ok(Gen.stats(a).lifesteal >= 6 && Gen.stats(b).lifesteal >= 6);
  ok(Db.beamFor('rare') && Db.beamFor('very_rare') && Db.beamFor('legendary'));
  eq(Db.beamFor('normal'), null);
  const bad = Gen.createInstance('wyrmfang', { seed: 1 }); bad.bound = false;
  ok(Gen.validate(bad).includes('must be bound'));
  Object.values(Db.LEGENDARIES).forEach((L) => ok(L.special.skill === null || Db.COMBAT_SKILLS.includes(L.special.skill), L.id));
});

console.log('# drop tables + pity');
test('static drop-table sanity', () => { deq(Loot.sanity(), []); });
test('rollDrop: valid items, non-negative gold, boss always Rare+', () => {
  const rng = Core.makeRng(5);
  Object.keys(Loot.MONSTERS).forEach((m) => {
    for (let i = 0; i < 1500; i++) {
      const d = Loot.rollDrop(m, rng);
      ok(Number.isInteger(d.gold) && d.gold >= 0);
      d.items.forEach((it) => { deq(Gen.validate(it), [], m); ok(it.qty >= 1); });
      if (Loot.MONSTERS[m].boss) ok(Loot.rarityRank(d.best) >= 1, 'boss without Rare');
    }
  });
});
test("Loot.preview('ashmaw') lists Wyrmfang with its icon key; labels are flavour, not odds", () => {
  const icons = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/rpg-item-icons.json'), 'utf8'));
  const keys = new Set();
  icons.icons.forEach((i) => { keys.add(i.key); (i.items || []).forEach((x) => keys.add(x.key)); });
  const w = mkWorld();
  const p = w.Loot.preview('ashmaw');
  const wf = p.find((e) => e.base === 'wyrmfang');
  ok(wf, 'Wyrmfang missing');
  eq(wf.name, 'Wyrmfang'); eq(wf.rarity, 'legendary'); eq(wf.label, 'legendary');
  eq(wf.icon, 'icon_wyrmfang'); ok(keys.has(wf.icon), 'icon key not in rpg-item-icons.json');
  eq(wf.beamColor, Db.RARITIES.legendary.beam.color);
  eq(p[0].base, 'wyrmfang', 'boss legendary listed first');
  ok(p.some((e) => e.label === 'guaranteed' && e.rarity === 'rare'), 'guaranteed boss Rare tier');
  Object.keys(Loot.MONSTERS).forEach((m) => Loot.preview(m).forEach((e) => {
    ok(['legendary', 'very rare', 'guaranteed'].includes(e.label), m + ' label ' + e.label);
    ok(keys.has(e.icon), m + ' icon ' + e.icon);
    ok(e.rarity === 'legendary' || e.rarity === 'very_rare' || e.label === 'guaranteed', m + ' not notable');
    ok(!/\d|%|1\//.test(e.label), 'odds leaked');
    eq(Banned.check(e.name)[0], 'OK');
  }));
  ok(!Loot.preview('rat').some((e) => e.base === 'wyrmfang'));
  deq(Loot.preview('nope'), []);
});
test('rollDrop is deterministic for a seed', () => {
  deq(Loot.rollDrop('imp', Core.makeRng(77)), Loot.rollDrop('imp', Core.makeRng(77)));
});
test('first-Rare pity: guaranteed by kill 40 on rats/goblins for every seed; escalates; one-time', () => {
  let maxK = 0;
  for (let s = 0; s < 3000; s++) {
    const rng = Core.makeRng(Core.mixSeed('fr', s));
    let fr = { done: false, kills: 0 }, k = 0;
    while (!fr.done) {
      k++;
      const d = Loot.rollDrop(k % 2 ? 'rat' : 'goblin', rng, { firstRare: fr });
      fr = d.firstRare;
    }
    maxK = Math.max(maxK, k);
  }
  ok(maxK <= Loot.FIRST_RARE.GUARANTEE, 'first rare at kill ' + maxK);
  eq(Loot.firstRareChance(1), 0); ok(Loot.firstRareChance(20) > Loot.firstRareChance(11)); eq(Loot.firstRareChance(40), 1);
  const done = Loot.nextFirstRare({ done: true, kills: 9 }, 'rat', null);
  ok(done.done, 'never resets');
});
test('first-Rare pity persists in the world save and is not re-granted after load', () => {
  const st = R.Modules.itemSave.memoryStorage();
  const w = mkWorld({ storage: st });
  let forcedAt = null;
  for (let i = 0; i < 60 && !w.Loot.firstRare().done; i++) {
    const r = w.Loot.rollDrop('rat', null, 0, 0);
    if (r.firstRareUsed) forcedAt = i + 1;
  }
  ok(w.Loot.firstRare().done);
  ok(w.Loot.firstRare().kills <= 40);
  w.ItemSave.save();
  const w2 = mkWorld({ storage: st });
  ok(w2.ItemSave.load().ok);
  ok(w2.Loot.firstRare().done, 'pity state restored');
  void forcedAt;
});
test('drought pity: never more than PITY_KILLS kills without Rare+', () => {
  const rng = Core.makeRng(9);
  let pity = 0, worst = 0;
  for (let i = 0; i < 20000; i++) {
    const d = Loot.rollDrop('rat', rng, { pity });
    pity = Loot.rarityRank(d.best) >= 1 ? 0 : pity + 1;
    worst = Math.max(worst, pity);
  }
  ok(worst < Loot.PITY_KILLS, 'drought ' + worst);
});
test('sim (same rules): first Rare <= 20 min for all players at 4 and 2 kills/min', () => {
  const sim = require('./loot-sim.js');
  for (const kpm of [4, 2]) {
    const r = sim.run(Object.assign({}, sim.OPT, { players: 150, townKpm: kpm, horizonMin: 90 }));
    ok(r.scenarios.town_only_pity.rare.max <= 20, 'town ' + kpm + ': ' + r.scenarios.town_only_pity.rare.max);
    ok(r.scenarios.route_pity.rare.max <= 20, 'route ' + kpm + ': ' + r.scenarios.route_pity.rare.max);
  }
});

console.log('# banned names');
test('banned-names self-test', () => { deq(Banned.selfTest(), []); });
function myFiles() {
  const out = [];
  const add = (d, re) => fs.readdirSync(path.join(ROOT, d)).filter((f) => re.test(f)).forEach((f) => out.push(path.join(ROOT, d, f)));
  add('js/rpg/items', /\.js$/);
  add('dev/rpg', /\.js$/);
  add('docs', /^rpg-item/);
  return out;
}
test('scanFile: 0 FAIL / 0 WARN in every items file', () => {
  myFiles().forEach((f) => {
    const r = Banned.scanFile(f, fs);
    ok(r.fails === 0 && r.warns === 0, path.relative(ROOT, f) + ':\n' + r.lines.join('\n'));
  });
});
test('every string literal in items code passes check()', () => {
  myFiles().filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const re = /'((?:[^'\\\n]|\\.){3,})'/g;
    let m;
    while ((m = re.exec(src))) {
      if (!/[A-Z ]/.test(m[1])) continue;   // identifiers like 'body' / 'rare' are keys, not display text
      const v = Banned.check(m[1]);
      ok(v[0] === 'OK', path.relative(ROOT, f) + ': "' + m[1] + '" ' + v.join(' '));
    }
  });
});
test('every runtime name passes: bases, rolled names, monsters, shops, recipes, nodes, specials', () => {
  const names = Db.allNames().slice();
  Object.values(Loot.MONSTERS).forEach((m) => names.push(m.name));
  Object.values(R.Modules.shop.SHOPS).forEach((s) => names.push(s.name));
  Object.values(R.Modules.crafting.RECIPES).forEach((r) => names.push(r.name));
  const rng = Core.makeRng(3);
  Object.keys(Loot.MONSTERS).forEach((m) => { for (let i = 0; i < 800; i++) Loot.rollDrop(m, rng).items.forEach((it) => names.push(Gen.displayName(it))); });
  const bad = names.map((n) => [n, Banned.check(n)]).filter((x) => x[1][0] !== 'OK');
  deq(bad, []);
});

console.log('# random op sequences + invariants');
function randomOps(seed, steps) {
  const rng = Core.makeRng(seed);
  const w = mkWorld({ opts: { deviceId: 'dev' + seed, lootSeed: seed } });
  give(w, 'smithing_hammer'); give(w, 'rustbound_pickaxe'); give(w, 'rustbound_hatchet'); give(w, 'fishing_rod'); give(w, 'flint_striker');
  const recipes = Object.keys(R.Modules.crafting.RECIPES);
  const nodes = Object.keys(R.Modules.crafting.NODES);
  const shops = Object.keys(R.Modules.shop.SHOPS);
  const monsters = Object.keys(Loot.MONSTERS);
  const pickInv = () => { const xs = w.Inventory.list().filter(Boolean); return xs.length ? xs[rng.int(0, xs.length - 1)] : null; };
  for (let i = 0; i < steps; i++) {
    const before = w.snapshot();
    const gold0 = before.gold;
    const ledger0 = before.ledger.length;
    const outbox0 = w._w.outbox().length;
    const k = rng.int(0, 17);
    let r = { ok: true };
    const it = pickInv();
    switch (k) {
      case 0: case 1: { r = w.Loot.rollDrop(monsters[rng.int(0, monsters.length - 1)], null, 1, 1); break; }
      case 2: case 3: { const g = w.Ground.list(); if (g.length) r = w.Ground.pickup(g[rng.int(0, g.length - 1)].gid, { goldMult: rng.chance(0.3) ? 9 : 1 }); break; }
      case 4: if (it) r = w.Inventory.move(it.slot, rng.int(0, 27)); break;
      case 5: if (it) r = w.Equipment.equip(it.uid); break;
      case 6: r = w.Equipment.unequip(Db.SLOTS[rng.int(0, 8)]); break;
      case 7: if (it) r = w.Bank.deposit(it.uid, it.stackable && it.qty > 1 ? rng.int(1, it.qty) : undefined); break;
      case 8: r = w.Bank.depositAll(); break;
      case 9: { const b = w.Bank.list(); if (b.length) { const e = b[rng.int(0, b.length - 1)]; r = w.Bank.withdraw(e.uid, e.qty > 1 ? rng.int(1, e.qty) : undefined); } break; }
      case 10: { const sid = shops[rng.int(0, shops.length - 1)]; const st = w.Shop.open(sid).items; if (st.length) { const e = st[rng.int(0, st.length - 1)]; r = w.Shop.buy(sid, e.base, rng.int(1, 3)); } break; }
      case 11: if (it) r = w.Shop.sell(shops[rng.int(0, shops.length - 1)], it.uid, it.qty > 1 ? rng.int(1, it.qty) : undefined); break;
      case 12: r = w.Crafting.make(recipes[rng.int(0, recipes.length - 1)]); break;
      case 13: r = w.Crafting.gather(nodes[rng.int(0, nodes.length - 1)]); break;
      case 14: if (it) r = w.Inventory.use(it.slot); break;
      case 15: if (it) r = w.Inventory.drop(it.slot, undefined, 2, 2); break;
      case 16: w.clock.add(rng.int(1, 120) * 1000); r = w.Ground.tick(); break;
      case 17: r = w.Inventory.grant({ src: 'quest', ref: 'q1', gold: rng.int(0, 20), items: [{ base: 'hearth_bread', qty: 2 }], overflow: rng.chance(0.5) ? 'ground' : 'refuse', x: 0, y: 0 }); break;
    }
    const after = w.snapshot();
    if (!r.ok) {
      deq(after, before, 'failed op ' + k + ' (' + r.reason + ') changed state');
      eq(w._w.outbox().length, outbox0, 'failed op logged');
    }
    noInv(w, 'seed ' + seed + ' step ' + i + ' op ' + k);
    ok(after.inv.length === 28 && after.inv.filter(Boolean).length <= 28);
    // Gold: any change is fully explained by new ledger entries with allowed tags.
    const newEntries = after.ledger.slice(Math.max(0, ledger0 - (before.ledger.length + (after.ledger.length - before.ledger.length) > 200 ? 0 : 0)));
    const delta = after.gold - gold0;
    if (delta !== 0) {
      const entries = after.ledger.filter((e) => before.ledger.every((b) => b.op !== e.op || e.op === null));
      const sum = entries.reduce((a, e) => a + e.delta, 0);
      eq(sum, delta, 'gold change not explained by ledger');
      entries.forEach((e) => ok(e.delta > 0 ? S.GOLD_CREDIT.includes(e.src) : S.GOLD_DEBIT.includes(e.src), 'tag ' + e.src));
    }
    void newEntries;
  }
  return w;
}
test('300 random sequences x 150 ops keep every invariant', () => {
  for (let s = 1; s <= 300; s++) randomOps(s, 150);
});
test('items never duplicate: replaying the op log rebuilds the exact state', () => {
  const w = randomOps(4242, 400);
  const w2 = mkWorld({ opts: { deviceId: 'dev4242', lootSeed: 4242 } });
  const res = w2.replay(w._w.outbox());
  ok(res.every((x) => x.ok), 'replay rejected: ' + JSON.stringify(res.find((x) => !x.ok)));
  deq(w2.snapshot(), w.snapshot());
  const again = w2.replay(w._w.outbox());
  ok(again.every((x) => x.duplicate), 'second replay not idempotent');
  deq(w2.snapshot(), w.snapshot());
});

console.log('# shops');
test('shop defs obey sell<=0.6*value and buy>=value', () => { deq(R.Modules.shop.checkShopDefs(), []); });
test('for every shop item and stock level: unit sell < unit buy', () => {
  const M = R.Modules.shop;
  Object.values(M.SHOPS).forEach((def) => {
    Db.ORDER.forEach((id) => {
      const b = Db.BASES[id];
      if (!M.shopBuys(def, b) || b.unique) return;
      const inst = Gen.createInstance(id, { seed: 1 });
      for (let st = 0; st <= 60; st += 3) {
        const sell = M.unitSell(def, inst, st);
        for (let st2 = 0; st2 <= 60; st2 += 3) ok(sell < M.unitBuy(def, id, st2), id + ' sell ' + sell + ' >= buy at ' + st2);
      }
    });
  });
});
test('buy -> sell back cycles never profit (random, 2000 cycles)', () => {
  const w = mkWorld();
  w.Inventory.grant({ src: 'quest', gold: 5000 });
  const rng = Core.makeRng(11);
  const shops = Object.keys(R.Modules.shop.SHOPS);
  let prev = w.Gold.balance();
  for (let i = 0; i < 2000; i++) {
    const sid = shops[rng.int(0, shops.length - 1)];
    const items = w.Shop.open(sid).items.filter((e) => e.qty > 0);
    if (!items.length) { w.clock.add(60000); continue; }
    const e = items[rng.int(0, items.length - 1)];
    const q = rng.int(1, 3);
    const b = w.Shop.buy(sid, e.base, q);
    if (!b.ok) { w.clock.add(30000); continue; }
    const slot = w.Inventory.list().findIndex((x) => x && x.base === e.base);
    const sellTo = shops[rng.int(0, shops.length - 1)];
    const s = w.Shop.sell(sellTo, slot, w.Inventory.list()[slot].stackable ? Math.min(q, w.Inventory.list()[slot].qty) : undefined);
    if (!s.ok) w.Shop.sell('general_store', slot);
    ok(w.Gold.balance() < prev, 'cycle ' + i + ' did not lose gold');
    prev = w.Gold.balance();
    while (w.Inventory.free() < 10) { const it = w.Inventory.list().find(Boolean); w.Inventory.remove(it.uid, it.qty, 'destroy'); }
    if (rng.chance(0.2)) w.clock.add(rng.int(1, 300) * 1000);
  }
  noInv(w);
});
test('Rare+ / bound (non-legendary) items sold to a shop are destroyed, never restocked', () => {
  const w = mkWorld();
  give(w, 'cinderiron_sword', 1, 'rare');
  give(w, 'cracked_sigil');
  const a = w.Inventory.list().filter(Boolean)[0];
  const r1 = w.Shop.sell('general_store', a.uid); ok(r1.ok && !r1.restocked, JSON.stringify(r1));
  ok(!w.Shop.open('general_store').items.some((e) => e.base === 'cinderiron_sword'));
  noInv(w);
});
test('every shop refuses every Legendary / chase item with not_sellable and changes nothing', () => {
  const chase = Db.ORDER.filter((id) => Db.BASES[id].chase || Db.BASES[id].legendary);
  ok(chase.includes('wyrmfang') && chase.length === Object.keys(Db.LEGENDARIES).length);
  chase.forEach((id) => {
    Object.keys(R.Modules.shop.SHOPS).forEach((sid) => {
      const w = mkWorld();
      give(w, id, 1, 'legendary');
      const uid = w.Inventory.item(0).uid;
      const before = w.snapshot();
      const r = w.Shop.sell(sid, uid);
      eq(r.reason, 'not_sellable', id + ' @ ' + sid);
      deq(w.snapshot(), before, 'refused sell changed state');
      eq(w.ItemSave.pendingOps().length, 1, 'refused sell was logged');
      eq(w.Shop.sellQuote(sid, uid), null);
      eq(w.Shop.isSellable(uid), false);
      ok(w.Inventory.has(id));
    });
  });
  const w = mkWorld(); give(w, 'rustbound_sword');
  eq(w.Shop.isSellable(w.Inventory.item(0).uid), true);
});
test('chase flag alone (non-legendary rarity) is enough to refuse', () => {
  const M = R.Modules.shop;
  const fake = Gen.createInstance('rustbound_sword', { seed: 1 });
  ok(M.notSellable(fake, Object.assign({}, Db.getBase('rustbound_sword'), { chase: true })));
  ok(!M.notSellable(fake, Db.getBase('rustbound_sword')));
});
test('bulk sell path: none exists; selling a whole backpack slot-by-slot never takes a legendary', () => {
  const w = mkWorld();
  ok(!('sellAll' in w.Shop) && !Object.keys(R.Modules.shop.reducers).some((k) => /all/i.test(k)), 'a bulk sell path appeared: add it to this test');
  give(w, 'wyrmfang', 1, 'legendary'); give(w, 'rustbound_sword'); give(w, 'rat_tail', 5); give(w, 'tinkers_oath', 1, 'legendary');
  const results = w.Inventory.list().filter(Boolean).map((it) => w.Shop.sell('general_store', it.uid));
  eq(results.filter((r) => r.ok).length, 2);
  eq(results.filter((r) => r.reason === 'not_sellable').length, 2);
  ok(w.Inventory.has('wyrmfang') && w.Inventory.has('tinkers_oath'));
  noInv(w);
});
test('Wyrmfang stays Attack 40 at 1/150 from Ashmaw (documented design choice)', () => {
  eq(Db.getBase('wyrmfang').req.attack, 40);
  const c = Loot.MONSTERS.ashmaw.chase.find((e) => e.legendary === 'wyrmfang');
  eq(c.chance, 1 / 150);
  ok(fs.readFileSync(path.join(ROOT, 'docs/rpg-items.md'), 'utf8').includes('Why Wyrmfang stays at Attack 40'));
});
test('quest items cannot be sold or dropped', () => {
  const w = mkWorld();
  give(w, 'cracked_sigil');
  eq(w.Shop.sell('general_store', 0).reason, 'shop_wont_buy');
  eq(w.Inventory.drop(0).reason, 'cannot_drop_quest_item');
});
test('shop + craft loops cannot mint gold (bought inputs cost >= output sale)', () => {
  const M = R.Modules.shop;
  const minBuy = (base) => { let best = null; Object.values(M.SHOPS).forEach((d) => { if (d.stock.some((e) => e.base === base)) { const p = M.unitBuy(d, base, 1e9); best = best == null ? p : Math.min(best, p); } }); return best; };
  const maxSell = (base) => { const inst = Gen.createInstance(base, { seed: 1 }); let best = 0; Object.values(M.SHOPS).forEach((d) => { if (M.shopBuys(d, Db.getBase(base))) best = Math.max(best, M.unitSell(d, inst, 0)); }); return best; };
  Object.values(R.Modules.crafting.RECIPES).forEach((r) => {
    const costs = r.inputs.map((i) => { const p = minBuy(i.base); return p == null ? null : p * i.qty; });
    if (costs.some((c) => c == null)) return;
    const cost = costs.reduce((a, c) => a + c, 0);
    const gain = r.outputs.reduce((a, o) => a + maxSell(o.base) * o.qty, 0);
    ok(gain < cost, r.id + ': buy ' + cost + ' -> sell ' + gain);
  });
});
test('not enough gold / out of stock fail cleanly; restock over time', () => {
  const w = mkWorld();
  eq(w.Shop.buy('smithy', 'cinderiron_sword', 1).reason, 'not_enough_gold');
  w.Inventory.grant({ src: 'quest', gold: 1000 });
  ok(w.Shop.buy('smithy', 'cinderiron_sword', 1).ok);
  eq(w.Shop.buy('smithy', 'cinderiron_sword', 1).reason, 'out_of_stock');
  w.clock.add(121000);
  ok(w.Shop.buy('smithy', 'cinderiron_sword', 1).ok, 'restocked');
});

console.log('# inventory full + ground');
test('pickup into a full backpack refuses cleanly; stackable merge still works', () => {
  const w = mkWorld();
  for (let i = 0; i < 28; i++) give(w, 'rustbound_dirk');
  let r;
  do { r = w.Loot.rollDrop('skeleton', null, 0, 0); } while (!w.Ground.list().some((g) => g.kind === 'item' && g.base !== 'bone_shard'));
  const g = w.Ground.list().find((x) => x.kind === 'item' && x.base !== 'bone_shard' && !Db.getBase(x.base).stackable) ||
    w.Ground.list().find((x) => x.kind === 'item' && x.base !== 'bone_shard');
  const before = w.snapshot();
  let full = 0; w.on('inventory_full', () => full++);
  const p = w.Ground.pickup(g.gid);
  eq(p.reason, 'inventory_full'); eq(full, 1);
  deq(w.snapshot(), before);
  w.Inventory.remove(w.Inventory.list()[27].uid, 1);
  ok(w.Ground.pickup(g.gid).ok);
  const gold = w.Ground.list().find((x) => x.kind === 'gold');
  if (gold) ok(w.Ground.pickup(gold.gid).ok, 'gold needs no slot');
  noInv(w);
  void r;
});
test('grant with overflow:ground puts extras on the ground; refuse leaves nothing', () => {
  const w = mkWorld();
  for (let i = 0; i < 28; i++) give(w, 'rustbound_dirk');
  eq(w.Inventory.add('rustbound_sword', 1, { src: 'quest' }).reason, 'inventory_full');
  const r = w.Inventory.add('rustbound_sword', 1, { src: 'quest', overflow: 'ground', x: 3, y: 4 });
  ok(r.ok && r.grounded.length === 1);
  noInv(w);
});
test('ground items despawn after 3 min (sink tracked)', () => {
  const w = mkWorld();
  w.Loot.rollDrop('ashmaw', null, 0, 0);
  ok(w.Ground.list().length > 0);
  w.clock.add(181000);
  ok(w.Ground.tick().ok);
  eq(w.Ground.list().length, 0);
  noInv(w);
});
test('gold multiplier claims are capped', () => {
  const w = mkWorld();
  w.Loot.rollDrop('ashmaw', null, 0, 0);
  const g = w.Ground.list().find((x) => x.kind === 'gold');
  const r = w.Ground.pickup(g.gid, { goldMult: 1000 });
  ok(r.amount <= g.amount * 3);
  eq(w.Gold.ledger(1)[0].src, 'drop');
});
test('bound items get boundTo on pickup and keep it forever', () => {
  const w = mkWorld();
  give(w, 'wyrmfang', 1, 'legendary');
  const it = w.Inventory.item(0);
  ok(it.bound && it.boundTo === 'p1');
  w.Inventory.drop(0, undefined, 0, 0);
  const g = w.Ground.list()[0];
  ok(g.bound);
  ok(w.Ground.pickup(g.gid).ok);
  ok(w.Inventory.item(0).bound);
});

console.log('# crafting');
test('smelt + smith + cook loop works and returns XP for core', () => {
  const w = mkWorld();
  give(w, 'smithing_hammer'); give(w, 'rustbound_ore', 4); give(w, 'raw_mudminnow', 3);
  const s1 = w.Crafting.make('smelt_rustbound'); ok(s1.ok && s1.xp > 0 && s1.skill === 'smithing');
  ok(w.Crafting.make('smelt_rustbound').ok);
  const sw = w.Crafting.make('smith_rustbound_sword'); ok(sw.ok, sw.reason);
  ok(w.Inventory.has('rustbound_sword'));
  const c = w.Crafting.make('cook_mudminnow', { station: 'fire' }); ok(c.ok);
  ok(w.Inventory.has('mudminnow') || w.Inventory.has('charred_fish'));
  noInv(w);
});
test('crafting is atomic: missing input / tool / level changes nothing', () => {
  const w = mkWorld({ levels: { smithing: 1 } });
  give(w, 'cinderiron_ore', 1);
  let b = w.snapshot();
  eq(w.Crafting.make('smelt_verdite').reason, 'level_too_low'); deq(w.snapshot(), b);
  eq(w.Crafting.make('smith_rustbound_sword').reason, 'level_too_low');
  const w2 = mkWorld();
  give(w2, 'rustbound_bar', 1);
  b = w2.snapshot();
  eq(w2.Crafting.make('smith_rustbound_sword').reason, 'missing_tool'); deq(w2.snapshot(), b);
  give(w2, 'smithing_hammer');
  b = w2.snapshot();
  eq(w2.Crafting.make('smith_rustbound_sword').reason, 'missing_input'); deq(w2.snapshot(), b);
});
test('crafting is atomic: output that does not fit rolls back the consumed inputs', () => {
  const w = mkWorld();
  give(w, 'smithing_hammer');
  give(w, 'rustbound_bar', 5);   // stack stays non-empty after using 2
  for (let i = 0; i < 26; i++) give(w, 'rustbound_dirk');
  eq(w.Inventory.free(), 0);
  const b = w.snapshot();
  const r = w.Crafting.make('smith_rustbound_sword');
  eq(r.reason, 'inventory_full');
  deq(w.snapshot(), b);
  eq(w.Inventory.count('rustbound_bar'), 5);
});
test('burn chance: 55% at the required level, 0 at stop-burn, deterministic', () => {
  const r = R.Modules.crafting.RECIPES.cook_mudminnow;
  eq(R.Modules.crafting.burnChance(r, { cooking: 1 }), 0.55);
  eq(R.Modules.crafting.burnChance(r, { cooking: 20 }), 0);
  ok(R.Modules.crafting.burnChance(r, { cooking: 10 }) < 0.55);
  const w = mkWorld({ levels: { cooking: 1 } });
  give(w, 'raw_mudminnow', 200);
  let burnt = 0;
  for (let i = 0; i < 200; i++) { const c = w.Crafting.make('cook_mudminnow'); if (c.burnt) burnt++; ok(c.ok); }
  ok(burnt > 80 && burnt < 140, 'burnt ' + burnt);
});
test('gathering: tool + level gates; yields stack', () => {
  const w = mkWorld({ levels: { mining: 1, woodcutting: 1, fishing: 1 } });
  eq(w.Crafting.gather('node_ore_rustbound').reason, 'missing_tool');
  give(w, 'rustbound_pickaxe');
  ok(w.Crafting.gather('node_ore_rustbound').ok);
  ok(w.Crafting.gather('node_ore_rustbound').ok);
  eq(w.Inventory.count('rustbound_ore'), 2);
  eq(w.Crafting.gather('node_ore_verdite').reason, 'level_too_low');
});

console.log('# equipment');
test('level requirements, swap into the vacated slot, getStats totals', () => {
  const w = mkWorld({ levels: { attack: 5, defence: 1 } });
  give(w, 'verdite_sword'); give(w, 'cinderiron_sword', 1, 'rare'); give(w, 'rustbound_helm');
  eq(w.Equipment.equip(0).reason, 'level_too_low');
  ok(w.Equipment.equip(1).ok);
  ok(w.Equipment.equip(2).ok);
  const st = w.Equipment.getStats();
  const expect = Gen.stats(w.Equipment.item('weapon'));
  ok(st.aim >= expect.aim && st.power === expect.power, 'stats');
  eq(st.legacy.dmg, st.power);
  give(w, 'rustbound_sword');
  const slot = w.Inventory.slotOf(w.Inventory.list().find((x) => x && x.base === 'rustbound_sword').uid);
  ok(w.Equipment.equip(slot).ok);
  eq(w.Inventory.list()[slot].base, 'cinderiron_sword', 'old weapon took the vacated slot');
  noInv(w);
});
test('two-handed weapon unequips the offhand; full backpack refuses cleanly', () => {
  const w = mkWorld();
  give(w, 'rustbound_shield'); give(w, 'rustbound_sword'); give(w, 'rustbound_greataxe');
  w.Equipment.equip(0); w.Equipment.equip(1);
  for (let i = 0; w.Inventory.free() > 0; i++) give(w, 'rustbound_dirk');
  const b = w.snapshot();
  const ga = w.Inventory.list().findIndex((x) => x && x.base === 'rustbound_greataxe');
  eq(w.Equipment.equip(ga).reason, 'inventory_full');
  deq(w.snapshot(), b);
  w.Inventory.remove(w.Inventory.list().find((x) => x && x.base === 'rustbound_dirk').uid);
  ok(w.Equipment.equip(w.Inventory.list().findIndex((x) => x && x.base === 'rustbound_greataxe')).ok);
  eq(w.Equipment.item('offhand'), null);
  noInv(w);
});

console.log('# bank');
test('deposit / partial / merge / withdraw / tabs / search', () => {
  const w = mkWorld();
  give(w, 'rustbound_ore', 10); give(w, 'cinderiron_sword', 1, 'very_rare'); give(w, 'rustbound_ore', 5);
  const ore = w.Inventory.list()[0];
  ok(w.Bank.deposit(ore.uid, 4).ok);
  eq(w.Inventory.count('rustbound_ore'), 11);
  ok(w.Bank.depositAll().ok);
  eq(w.Bank.count('rustbound_ore'), 15);
  eq(w.Bank.list().length, 2, 'ore merged into one entry');
  const e = w.Bank.list().find((x) => x.base === 'rustbound_ore');
  ok(w.Bank.withdraw(e.uid, 6).ok);
  eq(w.Inventory.count('rustbound_ore'), 6); eq(w.Bank.count('rustbound_ore'), 9);
  const sw = w.Bank.list().find((x) => x.base === 'cinderiron_sword');
  ok(w.Bank.setTab(sw.uid, 2).ok);
  eq(w.Bank.list(2).length, 1);
  ok(w.Bank.search('cinderiron').length === 1);
  const aff = Gen.describe(w.Bank.item(sw.uid)).lines.find((l) => l.kind === 'affix').text.split(' ').pop();
  ok(w.Bank.search(aff).length >= 1, 'affix search');
  noInv(w);
});
test('bank full and backpack full fail cleanly', () => {
  const w = mkWorld();
  w.snapshot();
  w._w.state().bank.cap = 2;
  give(w, 'rustbound_dirk'); give(w, 'rustbound_sword'); give(w, 'rustbound_helm');
  const r = w.Bank.depositAll(); ok(r.ok && r.left === 1);
  noInv(w, 'deposit_all with a full bank');
  const b = w.snapshot();
  eq(w.Bank.deposit(w.Inventory.list().find(Boolean).uid).reason, 'bank_full'); deq(w.snapshot(), b);
  for (let i = 0; w.Inventory.free() > 0; i++) give(w, 'rustbound_dirk');
  const b2 = w.snapshot();
  eq(w.Bank.withdraw(w.Bank.list()[0].uid).reason, 'inventory_full'); deq(w.snapshot(), b2);
});

console.log('# save');
test('save -> load round-trip restores items, gold, bank, equipment, outbox', () => {
  const st = R.Modules.itemSave.memoryStorage();
  const w = randomOps(77, 200);
  w._w.opts.storage = st;
  const w1 = mkWorld({ storage: st, opts: { deviceId: 'dev77', lootSeed: 77 } });
  w1.replay(w._w.outbox());
  ok(w1.ItemSave.save().ok);
  const w2 = mkWorld({ storage: st, opts: { deviceId: 'dev77', lootSeed: 77 } });
  const r = w2.ItemSave.load(); ok(r.ok, r.reason);
  deq(w2.snapshot(), w1.snapshot());
  deq(w2.ItemSave.pendingOps().length, w1.ItemSave.pendingOps().length);
});
test('atomic swap: alternate slots; failed write keeps the previous save', () => {
  const st = R.Modules.itemSave.memoryStorage();
  const w = mkWorld({ storage: st });
  give(w, 'hearth_bread', 3);
  eq(w.ItemSave.save().slot, 'a');
  give(w, 'hearth_bread', 2);
  eq(w.ItemSave.save().slot, 'b');
  give(w, 'hearth_bread', 1);
  const orig = st.setItem;
  st.setItem = (k, v) => { if (k.endsWith(':a')) throw new Error('QuotaExceeded'); return orig(k, v); };
  ok(!w.ItemSave.save().ok);
  st.setItem = orig;
  const w2 = mkWorld({ storage: st }); ok(w2.ItemSave.load().ok);
  eq(w2.Inventory.count('hearth_bread'), 5, 'previous good save');
});
test('corrupt or tampered slot falls back to the other slot', () => {
  const st = R.Modules.itemSave.memoryStorage();
  const w = mkWorld({ storage: st });
  give(w, 'hearth_bread', 3); w.ItemSave.save();
  give(w, 'hearth_bread', 2); w.ItemSave.save();
  const k = w.ItemSave.keys.b;
  const p = JSON.parse(st.getItem(k)); p.state.gold = 999999; st.setItem(k, JSON.stringify(p));
  const w2 = mkWorld({ storage: st });
  const r = w2.ItemSave.load(); ok(r.ok && r.fallback && r.from === 'a');
  eq(w2.Gold.balance(), 0); eq(w2.Inventory.count('hearth_bread'), 3);
  st.setItem(w.ItemSave.keys.a, '{not json');
  eq(mkWorld({ storage: st }).ItemSave.load().reason, 'corrupt');
});
test('migration chain runs; future schema blocks overwriting', () => {
  const st = R.Modules.itemSave.memoryStorage();
  const w = mkWorld({ storage: st });
  give(w, 'hearth_bread', 1); w.ItemSave.save();
  const k = JSON.parse(st.getItem(w.ItemSave.keys.ptr)).slot;
  const p = JSON.parse(st.getItem(w.ItemSave.keys[k]));
  const reseal = () => { p.sum = Core.hash32(JSON.stringify(p.state) + '|' + JSON.stringify(p.outbox)); st.setItem(w.ItemSave.keys[k], JSON.stringify(p)); };
  p.schema = 0; delete p.state.firstRare;
  reseal();
  const w2 = mkWorld({ storage: st });
  eq(w2.ItemSave.load().reason, 'no_migration_from_0');
  w2.ItemSave.registerMigration(0, (x) => { x.state.firstRare = { done: false, kills: 0 }; x.schema = 1; return x; });
  const r = w2.ItemSave.load(); ok(r.ok); deq(r.steps, ['0->1']); ok(w2.Loot.firstRare());
  delete R.Modules.itemSave.MIGRATIONS[0];
  p.schema = 99; reseal();
  const w3 = mkWorld({ storage: st });
  eq(w3.ItemSave.load().reason, 'future_schema');
  eq(w3.ItemSave.save().reason, 'future_schema');
});
test('triggers: debounced save within 1 s, flush on hidden / pagehide / beforeunload / app pause', () => {
  const timers = [];
  const st = R.Modules.itemSave.memoryStorage();
  const w = mkWorld({ storage: st, opts: { autosave: true, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {} } });
  give(w, 'hearth_bread'); give(w, 'hearth_bread');
  eq(timers.length, 1, 'one timer, not pushed back'); ok(timers[0].ms <= 1000);
  timers[0].fn(); ok(w.ItemSave.has()); eq(w.ItemSave.isDirty(), false);
  const mk = () => { const l = {}; return { addEventListener: (e, f) => { (l[e] = l[e] || []).push(f); }, removeEventListener: () => {}, fire: (e, a) => (l[e] || []).forEach((f) => f(a)), visibilityState: 'visible' }; };
  const win = mk(), doc = mk(), app = mk();
  app.addListener = (e, f) => { app.addEventListener(e, f); return Promise.resolve({ remove() {} }); };
  w.ItemSave.installLifecycle({ window: win, document: doc, capacitorApp: app });
  let saves = w.ItemSave.stats().saves;
  const step = (fire) => { give(w, 'hearth_bread'); fire(); const n = w.ItemSave.stats().saves; ok(n === saves + 1, 'flushed'); saves = n; };
  step(() => { doc.visibilityState = 'hidden'; doc.fire('visibilitychange'); });
  step(() => win.fire('pagehide'));
  step(() => win.fire('beforeunload'));
  step(() => app.fire('appStateChange', { isActive: false }));
  step(() => app.fire('pause'));
  eq(w.ItemSave.flush().skipped, true, 'nothing to flush');
});
test('outbox: ops keyed deviceId:seq, ack trims, failed ops are not logged', () => {
  const w = mkWorld();
  give(w, 'hearth_bread'); w.Inventory.use(0); w.Inventory.use(0);
  const ops = w.ItemSave.pendingOps();
  deq(ops.map((o) => o.key), ['devA:1', 'devA:2']);
  w.ItemSave.ack(1);
  deq(w.ItemSave.pendingOps().map((o) => o.key), ['devA:2']);
});

console.log('# ids + globals');
test('ItemIds.next(): item_<clientId>_<n>, monotonic, survives reload, never reused', () => {
  const st = R.Modules.itemSave.memoryStorage();
  const w = mkWorld({ storage: st });
  const a = w.ItemIds.next(), b = w.ItemIds.next();
  ok(/^item_devA_\d+$/.test(a)); ok(R.ItemIds.parse(b).n === R.ItemIds.parse(a).n + 1);
  give(w, 'hearth_bread');
  ok(R.ItemIds.parse(w.Inventory.item(0).uid).n > R.ItemIds.parse(b).n);
  w.ItemSave.save();
  const w2 = mkWorld({ storage: st }); w2.ItemSave.load();
  ok(R.ItemIds.parse(w2.ItemIds.next()).n > R.ItemIds.parse(w.Inventory.item(0).uid).n);
});
test('ItemIds.adopt records the server id and clears untrusted', () => {
  const w = mkWorld();
  give(w, 'rustbound_sword');
  const it = w.Inventory.item(0);
  ok(it.untrusted && it.sid === null && R.ItemIds.isProvisional(it));
  ok(w.ItemIds.adopt(it.uid, '9007199254740993').ok);
  const it2 = w.Inventory.item(0);
  eq(it2.sid, '9007199254740993'); eq(it2.untrusted, false);
});
test('installGlobals exposes the plan names but never clobbers the old js/loot.js Loot', () => {
  const w = mkWorld();
  const target = { Loot: { dropFromEnemy() {} } };
  const r = R.installGlobals(w, target);
  ok(r.skipped.includes('Loot'));
  ok(typeof target.Equipment.getStats === 'function' && typeof target.Crafting.make === 'function');
  R.installGlobals(w, target, true);
  ok(typeof target.Loot.rollDrop === 'function');
});

console.log('# docs');
test('docs/rpg-item-icons.json is up to date and covers every base', () => {
  execFileSync(process.execPath, [path.join(__dirname, 'gen-icons.js'), '--check'], { stdio: 'pipe' });
});
test('integration doc lists every global API the plan calls', () => {
  const f = path.join(ROOT, 'docs/rpg-items-integration.md');
  const doc = fs.readFileSync(f, 'utf8');
  ['Loot.rollDrop(', 'Inventory.add(', 'Inventory.remove(', 'Inventory.has(', 'Equipment.getStats()', 'Bank.open()',
    'Shop.open(', 'Crafting.make(', 'ItemSave.load()', 'ItemSave.save()', 'ItemSave.flush()', 'ItemIds.next()'].forEach((s) => ok(doc.includes(s), s));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('failed: ' + failures.join(' | ')); process.exit(1); }
