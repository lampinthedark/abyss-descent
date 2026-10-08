/**
 * RPG items: skilling recipes and gathering.
 *
 *   furnace: ore -> bar (1-3 ore by tier)            Smithing
 *   anvil:   bars -> gear (needs Smithing Hammer)     Smithing
 *   fire/range: raw fish -> cooked (burn chance)     Cooking
 *   fire:    logs (+ Flint Striker) -> a cooking fire (no skill, no item out)
 *   gather:  mining / woodcutting / fishing nodes -> ore / logs / raw fish
 *
 * Every make is ATOMIC: inside one op the inputs are removed and outputs
 * added; if anything fails (missing input, level, tool, full backpack after
 * consuming inputs) the whole op is discarded and nothing changes.
 * Randomness (burns, lucky double) comes from the op seed, so replays match.
 * XP is RETURNED for core's stats.js to grant; items never write XP.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./state.js') : root.RPGItems;
  if (isNode) require('./equipment.js');
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var S = RPG.State, Db = RPG.ItemsDb, Gen = RPG.ItemGen, Core = RPG.Core;

  var RECIPES = {};
  function rec(r) { RECIPES[r.id] = r; }

  // Furnace: ore + fuel -> bar.
  Db.TIERS.forEach(function (t) {
    if (!t.smith) return;
    var bar = Db.getBase(t.id + '_bar');
    var inputs = [{ base: bar.ore, qty: bar.ores }];
    rec({ id: 'smelt_' + t.id, name: 'Smelt ' + bar.name, station: 'furnace', skill: 'smithing', level: bar.req.smithing,
      inputs: inputs, outputs: [{ base: bar.id, qty: 1 }], xp: Math.round(6 + t.level * 1.5) });
  });

  // Anvil: bars -> normal-rarity gear. Bars per kind and level offset within the tier.
  var SMITH = {
    dirk: [1, 0], hatchet: [1, 0], helm: [1, 1], sword: [2, 1], pickaxe: [2, 1], gauntlets: [1, 2],
    sabatons: [1, 2], shield: [2, 3], greaves: [3, 3], greataxe: [3, 4], cuirass: [5, 4],
  };
  Db.ORDER.forEach(function (id) {
    var b = Db.BASES[id];
    var t = b.tier && Db.TIER_BY_ID[b.tier];
    if (!t || !t.smith || !SMITH[b.kind] || b.unique) return;
    var spec = SMITH[b.kind];
    rec({ id: 'smith_' + id, name: b.name, station: 'anvil', skill: 'smithing', tool: 'hammer',
      level: Math.min(99, t.level + spec[1]),
      inputs: [{ base: t.id + '_bar', qty: spec[0] }], outputs: [{ base: id, qty: 1 }],
      xp: Math.round((10 + t.level * 2) * spec[0]) });
  });

  // Cooking: raw -> cooked or charred. Burn chance falls linearly from 55% at the
  // required level to 0% at the fish's stopBurn level.
  Db.ORDER.forEach(function (id) {
    var b = Db.BASES[id];
    if (b.cat !== 'fish_raw') return;
    var cooked = Db.getBase(b.cooks);
    rec({ id: 'cook_' + cooked.id, name: 'Cook ' + cooked.name, station: 'fire', stations: ['fire', 'range'],
      skill: 'cooking', level: cooked.req.cooking, inputs: [{ base: id, qty: 1 }], outputs: [{ base: cooked.id, qty: 1 }],
      burn: { into: 'charred_fish', at: cooked.req.cooking, stop: cooked.stopBurn, max: 0.55 },
      xp: Math.round(10 + cooked.req.cooking * 1.8) });
  });

  // Lighting a cooking fire from logs (no Firemaking skill in week 1).
  ['pine_logs', 'ashwood_logs'].forEach(function (id) {
    rec({ id: 'fire_' + id, name: 'Light a fire (' + Db.getBase(id).name + ')', station: null, skill: null, level: 1,
      tool: 'firestarter', inputs: [{ base: id, qty: 1 }], outputs: [], xp: 0, effect: 'fire' });
  });

  function burnChance(r, levels) {
    if (!r.burn) return 0;
    var lvl = levels[r.skill] != null ? levels[r.skill] : 1;
    if (lvl >= r.burn.stop) return 0;
    var span = Math.max(1, r.burn.stop - r.burn.at);
    return Math.max(0, Math.min(r.burn.max, r.burn.max * (r.burn.stop - lvl) / span));
  }

  // Gathering nodes, keyed by the town sheet node family (state suffix dropped):
  // node_ore_<tier>, node_tree_pine / node_tree_ash, node_fish_0.
  // Core owns depletion/respawn (_full/_empty, _stump) and swing timers.
  var NODES = {
    node_tree_pine: { skill: 'woodcutting', level: 1,  tool: 'hatchet', toolTier: 1, yields: [{ base: 'pine_logs', level: 1 }], xp: 25 },
    node_tree_ash:  { skill: 'woodcutting', level: 12, tool: 'hatchet', toolTier: 2, yields: [{ base: 'ashwood_logs', level: 12 }], xp: 45 },
    // One spot: Brookfin becomes possible from Fishing 10 (40% of catches).
    node_fish_0:    { skill: 'fishing', level: 1, tool: 'rod', toolTier: 1,
      yields: [{ base: 'raw_brookfin', level: 10, chance: 0.4 }, { base: 'raw_mudminnow', level: 1 }], xp: 10 },
  };
  var ORE_XP = { rustbound: 17, cinderiron: 26, verdite: 40, tidesteel: 65, sunforged: 95 };
  Db.TIERS.forEach(function (t) {
    if (!t.smith) return;
    var ore = Db.getBase(t.id + '_ore');
    NODES['node_ore_' + t.id] = { skill: 'mining', level: ore.req.mining, tool: 'pickaxe', toolTier: Math.max(1, t.idx),
      yields: [{ base: ore.id, level: ore.req.mining }], xp: ORE_XP[t.id] };
  });

  function hasTool(s, tool, tier) {
    var t = RPG.Modules.equipment.toolTiers(s);
    return (t[tool] || 0) >= (tier || 1);
  }
  function lvl(levels, k) { return levels && levels[k] != null ? levels[k] : 1; }

  var reducers = {
    /** p: { recipe, levels, station, seed } */
    'craft.make': function (s, p, op, X) {
      var r = RECIPES[p.recipe];
      if (!r) S.fail('unknown_recipe');
      if (p.station && r.station && (r.stations || [r.station]).indexOf(p.station) < 0) S.fail('wrong_station');
      if (r.skill && lvl(p.levels, r.skill) < r.level) S.fail('level_too_low', [{ skill: r.skill, need: r.level, have: lvl(p.levels, r.skill) }]);
      if (r.tool && !hasTool(s, r.tool, 1)) S.fail('missing_tool', r.tool);
      r.inputs.forEach(function (inp) {
        S.invTakeBase(s, inp.base, inp.qty).forEach(function (t) { S.burn(s, t.base, t.qty, 'craft'); });
      });
      var rng = Core.makeRng(Core.mixSeed(p.seed, r.id));
      var burnt = r.burn ? rng.next() < burnChance(r, p.levels || {}) : false;
      var made = [];
      r.outputs.forEach(function (out, i) {
        var baseId = burnt ? r.burn.into : out.base;
        var inst = Gen.createInstance(baseId, { qty: out.qty, seed: Core.mixSeed(p.seed, 'out', i),
          origin: { src: 'craft', ref: r.id, at: op.at } });
        S.mint(s, inst, 'craft');
        made.push(S.invPut(s, inst).uid);   // full after consuming -> whole op rolls back
      });
      var xp = burnt ? 0 : r.xp;
      X.emit('inventory', { reason: 'craft' });
      X.emit('craft', { recipe: r.id, burnt: burnt, skill: r.skill, xp: xp, effect: r.effect || null });
      return { recipe: r.id, burnt: burnt, made: made, skill: r.skill, xp: xp, effect: r.effect || null };
    },
    /** p: { node, levels, seed } — one successful gather tick. */
    'craft.gather': function (s, p, op, X) {
      var n = NODES[p.node];
      if (!n) S.fail('unknown_node');
      if (lvl(p.levels, n.skill) < n.level) S.fail('level_too_low', [{ skill: n.skill, need: n.level, have: lvl(p.levels, n.skill) }]);
      if (!hasTool(s, n.tool, n.toolTier)) S.fail('missing_tool', n.tool);
      var rng = Core.makeRng(Core.mixSeed(p.seed, 'gather'));
      var have = lvl(p.levels, n.skill);
      var yieldBase = null;
      for (var yi = 0; yi < n.yields.length && !yieldBase; yi++) {
        var y = n.yields[yi];
        if (have >= y.level && (y.chance == null || rng.next() < y.chance)) yieldBase = y.base;
      }
      if (!yieldBase) yieldBase = n.yields[n.yields.length - 1].base;
      var lucky = false;
      var hasOath = Db.SLOTS.some(function (k) { return s.equip[k] && s.equip[k].base === 'tinkers_oath'; });
      if (hasOath) lucky = Core.makeRng(Core.mixSeed(p.seed, 'lucky')).next() < 0.10;
      var inst = Gen.createInstance(yieldBase, { qty: lucky ? 2 : 1, origin: { src: 'gather', ref: p.node, at: op.at } });
      S.mint(s, inst, 'gather');
      var put = S.invPut(s, inst);
      X.emit('inventory', { reason: 'gather' });
      X.emit('gather', { node: p.node, base: yieldBase, qty: inst.qty, skill: n.skill, xp: n.xp });
      return { base: yieldBase, qty: inst.qty, uid: put.uid, skill: n.skill, xp: n.xp, lucky: lucky };
    },
  };

  RPG.Modules.crafting = {
    name: 'Crafting',
    reducers: reducers,
    RECIPES: RECIPES, NODES: NODES, burnChance: burnChance,
    api: function (w) {
      var api = {
        RECIPES: RECIPES, NODES: NODES,
        /** make(recipeId, { station }) -> { ok, burnt, made:[uid], skill, xp } or { ok:false, reason } */
        make: function (recipeId, opts) {
          var s = w.state();
          return w.commit('craft.make', { recipe: recipeId, levels: w.levels(), station: opts && opts.station || null,
            seed: Core.mixSeed(s.lootSeed, 'craft', s.seq + 1) });
        },
        /** Repeat make until n done or the first failure. Returns { done, results, stop }. */
        makeMany: function (recipeId, n, opts) {
          var results = [], stop = null;
          for (var i = 0; i < n; i++) {
            var r = api.make(recipeId, opts);
            if (!r.ok) { stop = r.reason; break; }
            results.push(r);
          }
          return { done: results.length, results: results, stop: stop };
        },
        /** gather(nodeType) on each successful swing; core owns timers and node depletion. */
        gather: function (nodeType) {
          var s = w.state();
          var r = w.commit('craft.gather', { node: nodeType, levels: w.levels(), seed: Core.mixSeed(s.lootSeed, 'gather', s.seq + 1) });
          if (!r.ok && r.reason === 'inventory_full') w.emit('inventory_full', { node: nodeType });
          return r;
        },
        /** { ok, reason, missing:[{base, need, have}] } without changing anything. */
        canMake: function (recipeId) {
          var r = RECIPES[recipeId];
          if (!r) return { ok: false, reason: 'unknown_recipe', missing: [] };
          var s = w.state(), lv = w.levels();
          var missing = r.inputs.filter(function (i) { return S.invCount(s, i.base) < i.qty; })
            .map(function (i) { return { base: i.base, need: i.qty, have: S.invCount(s, i.base) }; });
          var reason = null;
          if (r.skill && lvl(lv, r.skill) < r.level) reason = 'level_too_low';
          else if (r.tool && !hasTool(s, r.tool, 1)) reason = 'missing_tool';
          else if (missing.length) reason = 'missing_input';
          return { ok: !reason, reason: reason, missing: missing, burnChance: burnChance(r, lv) };
        },
        /** Recipes for a station ('furnace' | 'anvil' | 'fire' | 'range'). */
        list: function (station) {
          return Object.keys(RECIPES).map(function (k) { return RECIPES[k]; })
            .filter(function (r) { return !station || (r.stations || [r.station]).indexOf(station) >= 0; });
        },
      };
      return api;
    },
  };
});
