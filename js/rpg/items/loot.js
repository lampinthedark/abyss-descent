/**
 * RPG items: monster drop tables + pure drop roller.
 *
 *   RPGItems.Loot.rollDrop(monsterId, rng, { pity, firstRare }) -> { gold, items[], best, pityUsed, firstRareUsed, firstRare }
 *
 * Pure: no state is touched. The world-bound Loot.rollDrop (ground.js) feeds
 * it the persisted pity counters, then turns the result into ground items
 * with provisional ids. NOTE: this is RPGItems.Loot, not the old global
 * `Loot` in js/loot.js (which GD's plan retires).
 *
 * Table shape per monster:
 *   gold:   { chance, min, max }
 *   always: [entry]                     every kill
 *   slots:  { common, uncommon, rare, very_rare } chances; ONE slot roll per kill
 *   table:  { common:[entry], uncommon:[entry], rare:[entry], very_rare:[entry] }
 *   rareTable: chance to ALSO roll the shared rare table
 *   chase:  [{ legendary|base|gear, chance }]  independent rolls (boss uniques)
 *   upgrade: chance a normal gear drop from common/uncommon is promoted to Rare
 * entry: { base, qty:[a,b], weight } | { gear:{ tiers:[..] }, weight } | { legendary, weight } | { gold:[a,b], weight }
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./item-gen.js') : root.RPGItems;
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var Core = RPG.Core, Db = RPG.ItemsDb, Gen = RPG.ItemGen;

  /** Kills without a Rare-or-better before the next kill is forced to give one. */
  var PITY_KILLS = 75;
  /** Promotion chance Rare -> Very Rare for rolled gear. */
  var VERY_RARE_PROMOTE = 0.08;

  var SHARED_RARE = [
    { gear: { tiers: ['verdite', 'tidesteel'] }, rarity: 'rare', weight: 30 },
    { gear: { tiers: ['tidesteel', 'sunforged'] }, rarity: 'very_rare', weight: 6 },
    { base: 'wyrm_scale', qty: [1, 1], weight: 6 },
    { base: 'sunforged_ore', qty: [3, 8], weight: 12 },
    { base: 'travellers_stew', qty: [2, 4], weight: 14 },
    { gold: [120, 360], weight: 20 },
    { legendary: 'emberheart_pendant', weight: 3 },
    { legendary: 'tinkers_oath', weight: 3 },
  ];

  // Week-1 monsters, keyed by the id core passes to Loot.rollDrop. Names follow
  // GD's plan (near-town rat and goblin packs; dungeon skeletons, imps, an
  // elite and a boss). `sprite` is the planned sheet key family.
  var MONSTERS = {
    rat: {
      name: 'Plague Rat', level: 2, zone: 'town_outskirts', nearTown: true, sprite: 'mob_rat',
      gold: { chance: 0.55, min: 1, max: 3 },
      always: [],
      slots: { common: 0.45, uncommon: 0.12, rare: 0.014, very_rare: 0.0012 },
      table: {
        common: [{ base: 'rat_tail', qty: [1, 2], weight: 10 }, { base: 'rustbound_ore', qty: [1, 1], weight: 3 }],
        uncommon: [{ gear: { tiers: ['rustbound'] }, weight: 6 }, { base: 'raw_mudminnow', qty: [1, 2], weight: 4 }],
        rare: [{ gear: { tiers: ['rustbound', 'cinderiron'] }, rarity: 'rare', weight: 1 }],
        very_rare: [{ gear: { tiers: ['cinderiron'] }, rarity: 'very_rare', weight: 1 }],
      },
      upgrade: 0.03, rareTable: 1 / 256,
    },
    goblin: {
      name: 'Ditch Goblin', level: 5, zone: 'town_outskirts', nearTown: true, sprite: 'mob_goblin',
      gold: { chance: 0.65, min: 2, max: 7 },
      always: [],
      slots: { common: 0.45, uncommon: 0.15, rare: 0.018, very_rare: 0.0015 },
      table: {
        common: [{ base: 'goblin_trinket', qty: [1, 1], weight: 6 }, { base: 'hearth_bread', qty: [1, 1], weight: 4 },
          { base: 'rustbound_ore', qty: [1, 3], weight: 4 }, { base: 'pine_logs', qty: [1, 2], weight: 3 }],
        uncommon: [{ gear: { tiers: ['rustbound', 'cinderiron'] }, weight: 8 }, { base: 'cinderiron_ore', qty: [1, 2], weight: 4 },
          { base: 'smithing_hammer', qty: [1, 1], weight: 1 }],
        rare: [{ gear: { tiers: ['rustbound', 'cinderiron'] }, rarity: 'rare', weight: 1 }],
        very_rare: [{ gear: { tiers: ['cinderiron', 'verdite'] }, rarity: 'very_rare', weight: 1 }],
      },
      upgrade: 0.035, rareTable: 1 / 200,
    },
    skeleton: {
      name: 'Rattlebone Skeleton', level: 12, zone: 'dungeon', sprite: 'mob_skeleton',
      gold: { chance: 0.6, min: 5, max: 15 },
      always: [{ base: 'bone_shard', qty: [1, 1] }],
      slots: { common: 0.4, uncommon: 0.18, rare: 0.028, very_rare: 0.003 },
      table: {
        common: [{ base: 'bone_shard', qty: [1, 3], weight: 5 }, { base: 'cinderiron_ore', qty: [1, 3], weight: 3 },
          { base: 'cinderiron_ore', qty: [1, 2], weight: 3 }],
        uncommon: [{ gear: { tiers: ['cinderiron', 'verdite'] }, weight: 8 }, { base: 'verdite_ore', qty: [1, 2], weight: 3 }],
        rare: [{ gear: { tiers: ['verdite'] }, rarity: 'rare', weight: 1 }],
        very_rare: [{ gear: { tiers: ['verdite', 'tidesteel'] }, rarity: 'very_rare', weight: 1 }],
      },
      upgrade: 0.04, rareTable: 1 / 128,
    },
    imp: {
      name: 'Cinder Imp', level: 14, zone: 'dungeon', sprite: 'mob_imp',
      gold: { chance: 0.6, min: 6, max: 18 },
      always: [],
      slots: { common: 0.42, uncommon: 0.16, rare: 0.03, very_rare: 0.0035 },
      table: {
        common: [{ base: 'imp_ember', qty: [1, 1], weight: 6 }, { base: 'verdite_ore', qty: [1, 2], weight: 4 }],
        uncommon: [{ gear: { tiers: ['verdite'] }, weight: 6 }, { base: 'garnet_band', qty: [1, 1], weight: 1 },
          { base: 'amber_pendant', qty: [1, 1], weight: 1 }, { base: 'raw_brookfin', qty: [1, 2], weight: 2 }],
        rare: [{ gear: { tiers: ['verdite'] }, rarity: 'rare', weight: 3 }, { base: 'garnet_band', rarity: 'rare', weight: 1 }],
        very_rare: [{ gear: { tiers: ['verdite', 'tidesteel'] }, rarity: 'very_rare', weight: 1 }],
      },
      upgrade: 0.045, rareTable: 1 / 100,
    },
    brute: {
      name: 'Grave Brute', level: 16, zone: 'dungeon', elite: true, sprite: 'mob_brute',
      gold: { chance: 1, min: 25, max: 50 },
      always: [{ base: 'bone_shard', qty: [2, 4] }],
      slots: { common: 0.5, uncommon: 0.3, rare: 0.12, very_rare: 0.015 },
      table: {
        common: [{ base: 'verdite_ore', qty: [1, 3], weight: 3 }, { base: 'travellers_stew', qty: [1, 1], weight: 2 }],
        uncommon: [{ gear: { tiers: ['verdite'] }, weight: 5 }, { base: 'tidesteel_ore', qty: [1, 2], weight: 2 }],
        rare: [{ gear: { tiers: ['verdite', 'tidesteel'] }, rarity: 'rare', weight: 1 }],
        very_rare: [{ gear: { tiers: ['tidesteel'] }, rarity: 'very_rare', weight: 1 }],
      },
      upgrade: 0.08, rareTable: 1 / 32,
    },
    ashmaw: {
      name: 'Ashmaw the Wyrmling', level: 20, zone: 'dungeon', boss: true, sprite: 'mob_boss',
      gold: { chance: 1, min: 80, max: 150 },
      always: [
        { base: 'travellers_stew', qty: [2, 3] },
        // Gate 4 show-off drop: one beamed Rare-or-better gear piece on every boss kill.
        { gear: { tiers: ['verdite', 'tidesteel'] }, rarity: 'rare', promote: 0.25 },
      ],
      slots: { common: 0.6, uncommon: 0.3, rare: 0.08, very_rare: 0.02 },
      table: {
        common: [{ base: 'verdite_ore', qty: [2, 5], weight: 3 }, { base: 'tidesteel_ore', qty: [1, 3], weight: 3 }],
        uncommon: [{ gear: { tiers: ['tidesteel'] }, weight: 4 }, { base: 'tidesteel_ore', qty: [2, 4], weight: 2 }],
        rare: [{ gear: { tiers: ['tidesteel'] }, rarity: 'rare', weight: 1 }],
        very_rare: [{ gear: { tiers: ['tidesteel', 'sunforged'] }, rarity: 'very_rare', weight: 1 }],
      },
      chase: [
        { legendary: 'wyrmfang', chance: 1 / 150 },           // the dragon-tier sword
        { legendary: 'gravewarden_crown', chance: 1 / 40 },
        { gear: { tiers: ['wyrm'] }, rarity: 'very_rare', chance: 1 / 60 },
        { base: 'wyrm_scale', qty: [1, 2], chance: 1 / 12 },
      ],
      upgrade: 0.06, rareTable: 1 / 8,
    },
  };

  /**
   * First-Rare pity (one-time per account). Counts EVERY kill until the
   * player's first Rare-or-better drop. The near-town rat and goblin packs are
   * where it fires in practice, and counting all kills keeps the promise when
   * a player heads into the dungeon early. From kill RAMP_START the chance of
   * a forced Rare escalates linearly up to RAMP_MAX. Kill GUARANTEE always
   * gives one. 40 kills is about 10 min at 4 kills/min, and still within
   * 20 min at 2 kills/min. The state lives in the item save now and on the
   * server account later (see docs/rpg-items.md, "Pity").
   */
  var FIRST_RARE = { RAMP_START: 10, RAMP_MAX: 0.12, GUARANTEE: 40, TIERS: ['rustbound'] };

  function firstRareChance(k) {
    if (k >= FIRST_RARE.GUARANTEE) return 1;
    if (k < FIRST_RARE.RAMP_START) return 0;
    return FIRST_RARE.RAMP_MAX * (k - FIRST_RARE.RAMP_START + 1) / (FIRST_RARE.GUARANTEE - FIRST_RARE.RAMP_START);
  }

  /** Pure state transition, shared by the roller, the world reducer and the sim. */
  function nextFirstRare(fr, monsterId, best) {
    fr = fr || { done: false, kills: 0 };
    if (fr.done) return { done: true, kills: fr.kills, at: fr.at || null };
    var kills = fr.kills + (MONSTERS[monsterId] ? 1 : 0);
    return { done: rarityRank(best) >= 1, kills: kills };
  }

  var gearPoolCache = {};
  function gearPool(tiers) {
    var key = tiers.join(',');
    if (gearPoolCache[key]) return gearPoolCache[key];
    var out = Db.ORDER.filter(function (id) {
      var b = Db.BASES[id];
      return Db.isGear(b) && !b.unique && tiers.indexOf(b.tier) >= 0;
    });
    gearPoolCache[key] = out;
    return out;
  }

  function asRng(rng) {
    if (rng && typeof rng.next === 'function' && typeof rng.u32 === 'function') return rng;
    if (typeof rng === 'function') return Core.makeRng(rng);
    if (typeof rng === 'number' || typeof rng === 'string') return Core.makeRng(rng);
    return Core.makeRng(Math.random);
  }

  function rarityRank(r) { return (Db.RARITIES[r] || { rank: -1 }).rank; }

  /** Materialise one table entry → { items[], gold }. */
  function rollEntry(entry, rng, monster, fromSlot, out) {
    var origin = { src: 'drop', ref: monster.id };
    if (entry.gold) { out.gold += rng.int(entry.gold[0], entry.gold[1]); return; }
    if (entry.legendary) {
      out.items.push(Gen.createInstance(entry.legendary, { rarity: 'legendary', seed: rng.u32(), origin: origin }));
      return;
    }
    var baseId = entry.base;
    if (entry.gear) {
      var pool = gearPool(entry.gear.tiers);
      baseId = pool[Math.floor(rng.next() * pool.length)];
    }
    var base = Db.getBase(baseId);
    var rarity = Db.defaultRarity(base);
    if (Db.canRollAffixes(base)) {
      rarity = entry.rarity || 'normal';
      if (rarity === 'normal' && (fromSlot === 'common' || fromSlot === 'uncommon') && rng.chance(monster.upgrade || 0)) rarity = 'rare';
      var promote = entry.promote != null ? entry.promote : VERY_RARE_PROMOTE;
      if (rarity === 'rare' && rng.chance(promote)) rarity = 'very_rare';
    }
    var qty = entry.qty ? rng.int(entry.qty[0], entry.qty[1]) : 1;
    if (base.stackable) {
      out.items.push(Gen.createInstance(baseId, { rarity: rarity, seed: rng.u32(), qty: qty, origin: origin }));
    } else {
      for (var i = 0; i < qty; i++) {
        out.items.push(Gen.createInstance(baseId, { rarity: rarity, seed: rng.u32(), origin: origin }));
      }
    }
  }

  /**
   * Roll one kill. rng: RPG.Core.makeRng(...) | () => float | seed. Defaults to Math.random.
   * opts.pity: kills since the last Rare+ (from the world); triggers a forced Rare at PITY_KILLS.
   * opts.firstRare: { done, kills } one-time new-player pity (near-town packs only).
   */
  function rollDrop(monsterId, rng, opts) {
    opts = opts || {};
    var m = MONSTERS[monsterId];
    if (!m) throw new Error('unknown monster ' + monsterId);
    m.id = monsterId;
    rng = asRng(rng);
    var out = { monsterId: monsterId, gold: 0, items: [], slot: null, rareTable: false, pityUsed: false, best: null };
    var i;
    if (m.gold && rng.chance(m.gold.chance)) out.gold += rng.int(m.gold.min, m.gold.max);
    for (i = 0; i < m.always.length; i++) rollEntry(m.always[i], rng, m, 'always', out);
    // One slot roll: very_rare, rare, uncommon, common, else nothing.
    var r = rng.next(), s = m.slots, acc = 0;
    var order = ['very_rare', 'rare', 'uncommon', 'common'];
    for (i = 0; i < order.length; i++) {
      acc += s[order[i]] || 0;
      if (r < acc) { out.slot = order[i]; break; }
    }
    if (out.slot) {
      var e = rng.weighted(m.table[out.slot]);
      if (e) rollEntry(e, rng, m, out.slot, out);
    }
    if (m.rareTable && rng.chance(m.rareTable)) {
      out.rareTable = true;
      rollEntry(rng.weighted(SHARED_RARE), rng, m, 'rare', out);
    }
    (m.chase || []).forEach(function (c) { if (rng.chance(c.chance)) rollEntry(c, rng, m, 'chase', out); });

    out.best = bestRarity(out.items);
    var fr = opts.firstRare;
    if (fr && !fr.done && rarityRank(out.best) < 1) {
      var p = firstRareChance(fr.kills + 1);
      if (p >= 1 || rng.chance(p)) {
        rollEntry({ gear: { tiers: m.nearTown ? FIRST_RARE.TIERS : pityTiers(m) }, rarity: 'rare', promote: 0 }, rng, m, 'first_rare', out);
        out.firstRareUsed = true;
        out.best = bestRarity(out.items);
      }
    }
    if (fr) out.firstRare = nextFirstRare(fr, monsterId, out.best);
    if (rarityRank(out.best) < 1 && opts.pity != null && opts.pity + 1 >= PITY_KILLS) {
      var tiers = pityTiers(m);
      rollEntry({ gear: { tiers: tiers }, rarity: 'rare', promote: 0 }, rng, m, 'pity', out);
      out.pityUsed = true;
      out.best = bestRarity(out.items);
    }
    return out;
  }

  function pityTiers(m) {
    var lists = m.table.rare || [];
    for (var i = 0; i < lists.length; i++) if (lists[i].gear) return lists[i].gear.tiers;
    return ['rustbound'];
  }

  function bestRarity(items) {
    var best = null;
    items.forEach(function (it) { if (rarityRank(it.rarity) > rarityRank(best)) best = it.rarity; });
    return best;
  }

  /** Static sanity checks used by tests. Returns [] or a list of problems. */
  function sanity() {
    var errs = [];
    function checkEntry(where, e) {
      if (e.base && !Db.hasBase(e.base)) errs.push(where + ': unknown base ' + e.base);
      if (e.legendary && !Db.LEGENDARIES[e.legendary]) errs.push(where + ': unknown legendary ' + e.legendary);
      if (e.gear && !gearPool(e.gear.tiers).length) errs.push(where + ': empty gear pool');
      if (e.qty && (e.qty[0] < 1 || e.qty[1] < e.qty[0])) errs.push(where + ': bad qty');
    }
    Object.keys(MONSTERS).forEach(function (id) {
      var m = MONSTERS[id];
      var tot = 0;
      for (var k in m.slots) { if (m.slots[k] < 0) errs.push(id + ': negative slot'); tot += m.slots[k]; }
      if (tot > 1 + 1e-9) errs.push(id + ': slot chances sum > 1');
      if (!(m.slots.common >= m.slots.uncommon && m.slots.uncommon >= m.slots.rare && m.slots.rare >= m.slots.very_rare)) {
        errs.push(id + ': slots not monotonic');
      }
      m.always.forEach(function (e) { checkEntry(id + '.always', e); });
      Object.keys(m.table).forEach(function (slot) {
        if (!m.table[slot].length) errs.push(id + '.' + slot + ': empty');
        m.table[slot].forEach(function (e) { checkEntry(id + '.' + slot, e); });
      });
      (m.chase || []).forEach(function (e) {
        checkEntry(id + '.chase', e);
        if (!(e.chance > 0 && e.chance <= 1)) errs.push(id + '.chase: bad chance');
      });
    });
    SHARED_RARE.forEach(function (e) { checkEntry('shared_rare', e); });
    return errs;
  }

  RPG.Loot = {
    MONSTERS: MONSTERS, SHARED_RARE: SHARED_RARE, PITY_KILLS: PITY_KILLS, FIRST_RARE: FIRST_RARE,
    firstRareChance: firstRareChance, nextFirstRare: nextFirstRare,
    rollDrop: rollDrop, bestRarity: bestRarity, rarityRank: rarityRank, sanity: sanity, gearPool: gearPool,
  };
});
