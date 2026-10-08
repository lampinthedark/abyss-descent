/**
 * RPG items: static item database (bases, tiers, rarities, affix pools,
 * legendaries). Pure data plus lookups; no state.
 *
 * Names are original to Abyss Descent and are checked by
 * dev/rpg/run-tests.js against the UAT banned-names list.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./core.js') : root.RPGItems;
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';

  /* ------------------------------------------------------------------ tiers */
  // 6-step metal ladder. `wyrm` is the dragon tier: drop-only, not smithable.
  var TIERS = [
    { id: 'rustbound',  idx: 0, name: 'Rustbound',  level: 1,  mult: 1.0, value: 8,    color: '#9b6a48', smith: true },
    { id: 'cinderiron', idx: 1, name: 'Cinderiron', level: 5,  mult: 1.6, value: 30,   color: '#7a5a5a', smith: true },
    { id: 'verdite',    idx: 2, name: 'Verdite',    level: 10, mult: 2.3, value: 90,   color: '#4f9a6a', smith: true },
    { id: 'tidesteel',  idx: 3, name: 'Tidesteel',  level: 20, mult: 3.2, value: 240,  color: '#4a86a8', smith: true },
    { id: 'sunforged',  idx: 4, name: 'Sunforged',  level: 30, mult: 4.4, value: 620,  color: '#d8a83a', smith: true },
    { id: 'wyrm',       idx: 5, name: 'Wyrmscale',  level: 40, mult: 6.0, value: 2400, color: '#b8323a', smith: false },
  ];
  var TIER_BY_ID = {};
  TIERS.forEach(function (t) { TIER_BY_ID[t.id] = t; });

  /* --------------------------------------------------------------- rarities */
  // `beam` is what the renderer draws over a ground drop (null = no beam).
  var RARITIES = {
    normal:    { id: 'normal',    name: 'Normal',    rank: 0, color: '#e8e2d0', affixes: [0, 0], valueMult: 1,
                 beam: null },
    rare:      { id: 'rare',      name: 'Rare',      rank: 1, color: '#5aa0ff', affixes: [1, 2], valueMult: 3,
                 beam: { color: '#5aa0ff', height: 2.5, pulse: false, sfx: 'lootRare' } },
    very_rare: { id: 'very_rare', name: 'Very Rare', rank: 2, color: '#c070ff', affixes: [3, 4], valueMult: 8,
                 beam: { color: '#c070ff', height: 3.5, pulse: true, sfx: 'lootRare' } },
    legendary: { id: 'legendary', name: 'Legendary', rank: 3, color: '#ff9a2e', affixes: [1, 2], valueMult: 20,
                 beam: { color: '#ff9a2e', height: 5, pulse: true, sfx: 'lootLegendary' } },
    // Stackables (ores, bars, logs, fish, food, junk) and tools never roll affixes.
    material:  { id: 'material',  name: 'Material',  rank: -1, color: '#b8b0a0', affixes: [0, 0], valueMult: 1,
                 beam: null },
    quest:     { id: 'quest',     name: 'Quest Item', rank: -1, color: '#e7c27a', affixes: [0, 0], valueMult: 0,
                 beam: { color: '#e7c27a', height: 2, pulse: true, sfx: 'loot' } },
  };
  var GEAR_RARITIES = ['normal', 'rare', 'very_rare', 'legendary'];

  /* ------------------------------------------------------------ equip slots */
  var SLOTS = ['weapon', 'offhand', 'head', 'body', 'legs', 'hands', 'feet', 'ring', 'amulet'];

  /* ------------------------------------------------------------------ bases */
  // Base stat block keys (all integers):
  //   aim (accuracy), power (melee strength), armour, maxHp,
  //   attackSpeed (%), crit (%), lifesteal (%), cooldown (% reduction), gather (%)
  var BASES = {};
  var ORDER = [];
  function def(b) {
    if (BASES[b.id]) throw new Error('duplicate base ' + b.id);
    b.stackable = !!b.stackable;
    b.tradeable = b.tradeable !== false;
    b.stats = b.stats || {};
    b.req = b.req || {};
    BASES[b.id] = b;
    ORDER.push(b.id);
    return b;
  }

  // Tiered weapon/armour/tool kinds. stats are per-tier-mult-1 values.
  var KINDS = [
    { kind: 'sword',     name: 'Sword',     slot: 'weapon',  group: 'weapon', skill: 'attack',  valueF: 1.0,
      stats: { aim: 4, power: 4 } },
    { kind: 'dirk',      name: 'Dirk',      slot: 'weapon',  group: 'weapon', skill: 'attack',  valueF: 0.8,
      stats: { aim: 5, power: 2, attackSpeed: 10 } },
    { kind: 'greataxe',  name: 'Greataxe',  slot: 'weapon',  group: 'weapon', skill: 'attack',  valueF: 1.5,
      stats: { aim: 2, power: 7, attackSpeed: -10 }, twoHanded: true },
    { kind: 'shield',    name: 'Shield',    slot: 'offhand', group: 'offhand', skill: 'defence', valueF: 1.0,
      stats: { armour: 3 } },
    { kind: 'helm',      name: 'Helm',      slot: 'head',    group: 'head',   skill: 'defence', valueF: 0.7,
      stats: { armour: 2 } },
    { kind: 'cuirass',   name: 'Cuirass',   slot: 'body',    group: 'body',   skill: 'defence', valueF: 1.6,
      stats: { armour: 5 } },
    { kind: 'greaves',   name: 'Greaves',   slot: 'legs',    group: 'legs',   skill: 'defence', valueF: 1.2,
      stats: { armour: 4 } },
    { kind: 'gauntlets', name: 'Gauntlets', slot: 'hands',   group: 'hands',  skill: 'defence', valueF: 0.5,
      stats: { armour: 1, aim: 1 } },
    { kind: 'sabatons',  name: 'Sabatons',  slot: 'feet',    group: 'feet',   skill: 'defence', valueF: 0.5,
      stats: { armour: 1 } },
    { kind: 'pickaxe',   name: 'Pickaxe',   slot: 'weapon',  group: 'tool',   skill: 'mining',      valueF: 0.9,
      stats: { aim: 1, power: 1 }, tool: 'pickaxe' },
    { kind: 'hatchet',   name: 'Hatchet',   slot: 'weapon',  group: 'tool',   skill: 'woodcutting', valueF: 0.8,
      stats: { aim: 1, power: 2 }, tool: 'hatchet' },
  ];

  TIERS.forEach(function (t) {
    KINDS.forEach(function (k) {
      if (t.id === 'wyrm' && k.group === 'tool') return;            // no dragon-tier tools
      if (t.id === 'wyrm' && k.group === 'weapon') return;          // the only wyrm weapon is Wyrmfang
      var stats = {};
      Object.keys(k.stats).forEach(function (s) {
        var v = k.stats[s];
        stats[s] = (s === 'attackSpeed') ? v : Math.max(1, Math.round(v * t.mult));
      });
      if (k.tool) stats.gather = 5 * t.idx;                         // better tools gather faster
      var req = {};
      req[k.skill] = t.level;
      def({
        id: t.id + '_' + k.kind, name: t.name + ' ' + k.name, cat: k.group === 'tool' ? 'tool' : 'gear',
        kind: k.kind, slot: k.slot, group: k.group, tier: t.id, req: req, stats: stats,
        twoHanded: !!k.twoHanded, tool: k.tool || null, toolTier: k.tool ? t.idx + 1 : 0,
        value: Math.max(1, Math.round(t.value * k.valueF)),
      });
    });
  });

  // Jewellery: untiered names, but mapped onto a tier for affix scaling.
  [
    { id: 'plain_band',      name: 'Plain Band',        slot: 'ring',   tier: 'rustbound',  stats: { aim: 1 },              value: 20 },
    { id: 'garnet_band',     name: 'Garnet Band',       slot: 'ring',   tier: 'verdite',    stats: { aim: 2, power: 2 },    value: 160 },
    { id: 'moonstone_band',  name: 'Moonstone Band',    slot: 'ring',   tier: 'sunforged',  stats: { aim: 4, power: 4 },    value: 900 },
    { id: 'bone_charm',      name: 'Bone Charm',        slot: 'amulet', tier: 'rustbound',  stats: { maxHp: 4 },            value: 20 },
    { id: 'amber_pendant',   name: 'Amber Pendant',     slot: 'amulet', tier: 'verdite',    stats: { maxHp: 10, armour: 2 }, value: 180 },
    { id: 'starglass_pendant', name: 'Starglass Pendant', slot: 'amulet', tier: 'sunforged', stats: { maxHp: 22, armour: 4 }, value: 1000 },
  ].forEach(function (j) {
    // Skills are GD's stats.js set; rings gate on Attack, amulets on Defence.
    var jreq = {};
    jreq[j.slot === 'ring' ? 'attack' : 'defence'] = TIER_BY_ID[j.tier].level;
    def({ id: j.id, name: j.name, cat: 'gear', kind: j.slot, slot: j.slot, group: j.slot, tier: j.tier,
      req: jreq, stats: j.stats, value: j.value });
  });

  // Untiered tools (kept in the inventory, not equipped).
  def({ id: 'smithing_hammer', name: 'Smithing Hammer', cat: 'tool', tool: 'hammer', value: 4 });
  def({ id: 'fishing_rod',     name: 'Fishing Rod',     cat: 'tool', tool: 'rod', toolTier: 1, value: 6 });
  def({ id: 'flint_striker',   name: 'Flint Striker',   cat: 'tool', tool: 'firestarter', value: 3 });

  // Ores → bars. Ore ids match the town sheet nodes node_ore_<tier>_{full,empty}.
  // No separate fuel ore in week 1: higher bars just need more ore.
  [
    { tier: 'rustbound',  lvl: 1,  ov: 3,   ores: 1 },
    { tier: 'cinderiron', lvl: 5,  ov: 10,  ores: 1 },
    { tier: 'verdite',    lvl: 10, ov: 24,  ores: 2 },
    { tier: 'tidesteel',  lvl: 20, ov: 55,  ores: 2 },
    { tier: 'sunforged',  lvl: 30, ov: 120, ores: 3 },
  ].forEach(function (o) {
    var t = TIER_BY_ID[o.tier];
    def({ id: o.tier + '_ore', name: t.name + ' Ore', cat: 'ore', stackable: true, tier: o.tier,
      req: { mining: o.lvl }, node: 'node_ore_' + o.tier, value: o.ov });
    def({ id: o.tier + '_bar', name: t.name + ' Bar', cat: 'bar', stackable: true, tier: o.tier,
      req: { smithing: o.lvl }, ore: o.tier + '_ore', ores: o.ores, value: o.ov * o.ores * 2 });
  });

  // Logs (Woodcutting). There is no Firemaking skill: logs fuel the cooking fire (crafting.js).
  [
    // Matches the town sheet trees node_tree_pine / node_tree_ash.
    { id: 'pine_logs',       name: 'Pine Logs',       lvl: 1,  value: 2, node: 'node_tree_pine' },
    { id: 'ashwood_logs',    name: 'Ashwood Logs',    lvl: 12, value: 8, node: 'node_tree_ash' },
  ].forEach(function (l) {
    def({ id: l.id, name: l.name, cat: 'log', stackable: true, req: { woodcutting: l.lvl }, node: l.node, value: l.value });
  });

  // Fish: raw → cooked (heals) with level-based burn chance (see crafting.js).
  [
    // Both come from the one fishing spot on the town sheet (node_fish_0).
    { id: 'mudminnow',   name: 'Mudminnow',   lvl: 1,  heal: 3,  value: 2,  stopBurn: 20 },
    { id: 'brookfin',    name: 'Brookfin',    lvl: 10, heal: 6,  value: 6,  stopBurn: 32 },
  ].forEach(function (f) {
    def({ id: 'raw_' + f.id, name: 'Raw ' + f.name, cat: 'fish_raw', stackable: true,
      req: { fishing: f.lvl }, cooks: f.id, value: f.value });
    def({ id: f.id, name: f.name, cat: 'food', stackable: true, heal: f.heal,
      req: { cooking: f.lvl }, stopBurn: f.stopBurn, value: Math.round(f.value * 1.5) });
  });
  def({ id: 'charred_fish', name: 'Charred Fish', cat: 'junk', stackable: true, value: 1 });

  // Bought / dropped food.
  def({ id: 'hearth_bread',     name: 'Hearth Bread',     cat: 'food', stackable: true, heal: 5,  value: 6 });
  def({ id: 'travellers_stew',  name: "Traveller's Stew", cat: 'food', stackable: true, heal: 12, value: 25 });

  // Monster materials / junk (sell to the general store).
  def({ id: 'rat_tail',        name: 'Rat Tail',        cat: 'junk', stackable: true, value: 3 });
  def({ id: 'goblin_trinket',  name: 'Goblin Trinket',  cat: 'junk', stackable: true, value: 6 });
  def({ id: 'bone_shard',      name: 'Bone Shard',      cat: 'junk', stackable: true, value: 3 });
  def({ id: 'imp_ember',       name: 'Imp Ember',       cat: 'junk', stackable: true, value: 12 });
  def({ id: 'wyrm_scale',      name: 'Wyrm Scale',      cat: 'material', stackable: true, value: 400 });

  // Quest items: bound, untradeable, cannot be sold or dropped (destroy only).
  def({ id: 'cracked_sigil',   name: 'Cracked Sigil',   cat: 'quest', quest: true, tradeable: false, value: 0 });
  def({ id: 'wardens_ledger',  name: "Warden's Ledger", cat: 'quest', quest: true, tradeable: false, value: 0 });
  def({ id: 'old_survey_map',  name: 'Old Survey Map',  cat: 'quest', quest: true, tradeable: false, value: 0 });

  /* ------------------------------------------------------------ legendaries */
  // Fixed signature stats + 1-2 rolled affixes. Always bound on drop.
  var LEGENDARIES = {
    wyrmfang: {
      id: 'wyrmfang', name: 'Wyrmfang', slot: 'weapon', kind: 'sword', tier: 'wyrm',
      req: { attack: 40 }, value: 12000, chase: true,
      stats: { aim: 26, power: 30, attackSpeed: 5 },
      signature: { lifesteal: 6, crit: 8 },
      special: { id: 'wyrmflame', skill: 'cleave', text: 'Cleave sears every foe it hits for 30% weapon damage over 3s' },
      flavor: 'Torn from the jaw of the thing beneath the sigil-stair.',
    },
    gravewarden_crown: {
      id: 'gravewarden_crown', name: "Gravewarden's Crown", slot: 'head', kind: 'helm', tier: 'verdite',
      req: { defence: 10 }, value: 3000, chase: true,
      stats: { armour: 7 },
      signature: { maxHp: 30, cooldown: 15 },
      special: { id: 'warden_ward', skill: 'ground_slam', text: 'Ground Slam grants a 3s ward that absorbs one hit' },
      flavor: 'Still warm. Still watching.',
    },
    emberheart_pendant: {
      id: 'emberheart_pendant', name: 'Emberheart Pendant', slot: 'amulet', kind: 'amulet', tier: 'cinderiron',
      req: { defence: 5 }, value: 2000, chase: true,
      stats: { maxHp: 12 },
      signature: { power: 6, lifesteal: 3 },
      special: { id: 'ember_pulse', skill: 'sigil_bolt', text: 'Sigil Bolt bursts into embers on impact (small area)' },
      flavor: 'It beats when you fight.',
    },
    tinkers_oath: {
      id: 'tinkers_oath', name: "Tinker's Oath", slot: 'ring', kind: 'ring', tier: 'cinderiron',
      req: { attack: 5 }, value: 1800, chase: true,
      stats: { aim: 2 },
      signature: { gather: 25 },
      special: { id: 'lucky_strike', skill: null, text: 'Mining, Woodcutting and Fishing have a 10% chance to yield double' },
      flavor: 'Signed in soot.',
    },
  };
  Object.keys(LEGENDARIES).forEach(function (k) {
    var L = LEGENDARIES[k];
    def({ id: L.id, name: L.name, cat: 'gear', kind: L.kind, slot: L.slot, group: L.slot === 'weapon' ? 'weapon' : L.slot,
      tier: L.tier, req: L.req, stats: L.stats, value: L.value, unique: true, legendary: L.id, chase: !!L.chase });
  });

  /* ------------------------------------------------------------- affix pool */
  // Ranges scale with the base tier index t (0..5): min = a + b*t, max = c + d*t.
  // groups: which item groups may roll it. All values are integers.
  var G_ARMOUR = ['offhand', 'head', 'body', 'legs', 'hands', 'feet'];
  var AFFIXES = [
    { id: 'attack',       stat: 'aim',         label: '+{v} Attack',            prefix: 'Keen',        suffix: 'of Precision',
      groups: ['weapon', 'hands', 'ring', 'amulet', 'tool'], weight: 10, range: [1, 2, 3, 3] },
    { id: 'strength',     stat: 'power',       label: '+{v} Strength',          prefix: 'Brutal',      suffix: 'of the Ox',
      groups: ['weapon', 'hands', 'ring', 'amulet', 'tool'], weight: 10, range: [1, 2, 3, 3] },
    { id: 'defence',      stat: 'armour',      label: '+{v} Defence',           prefix: 'Sturdy',      suffix: 'of Warding',
      groups: G_ARMOUR.concat(['ring', 'amulet']), weight: 10, range: [1, 2, 3, 3] },
    { id: 'max_hp',       stat: 'maxHp',       label: '+{v} Max HP',            prefix: 'Hale',        suffix: 'of the Bear',
      groups: G_ARMOUR.concat(['ring', 'amulet']), weight: 9, range: [3, 5, 8, 9] },
    { id: 'attack_speed', stat: 'attackSpeed', label: '+{v}% Attack Speed',     prefix: 'Swift',       suffix: 'of Haste',
      groups: ['weapon', 'hands', 'ring'], weight: 6, range: [2, 1, 4, 1.6] },
    { id: 'crit',         stat: 'crit',        label: '+{v}% Critical Chance',  prefix: 'Vicious',     suffix: 'of Ruin',
      groups: ['weapon', 'offhand', 'head', 'legs', 'hands', 'ring', 'amulet', 'tool'], weight: 6, range: [1, 0.6, 3, 1] },
    { id: 'lifesteal',    stat: 'lifesteal',   label: '+{v}% Life Steal',       prefix: 'Leeching',    suffix: 'of the Leech',
      groups: ['weapon', 'body', 'ring', 'amulet'], weight: 4, range: [1, 0.4, 2, 0.8] },
    // Applies to GD's three cooldown skills: Cleave, Ground Slam, Sigil Bolt.
    { id: 'cooldown',     stat: 'cooldown',    label: '-{v}% Skill Cooldown',   prefix: 'Focused',     suffix: 'of Clarity',
      groups: ['head', 'offhand', 'body', 'legs', 'feet', 'ring', 'amulet'], weight: 5, range: [2, 1, 4, 1.6] },
    { id: 'gather',       stat: 'gather',      label: '+{v}% Gathering Speed',  prefix: 'Industrious', suffix: 'of the Delver',
      groups: ['tool', 'hands', 'feet', 'ring', 'amulet'], weight: 6, range: [3, 2, 6, 3] },
  ];
  var AFFIX_BY_ID = {};
  AFFIXES.forEach(function (a) { AFFIX_BY_ID[a.id] = a; });

  function affixRange(affix, tierIdx) {
    var r = affix.range;
    var min = Math.max(1, Math.round(r[0] + r[1] * tierIdx));
    var max = Math.max(min, Math.round(r[2] + r[3] * tierIdx));
    return [min, max];
  }

  /** GD's stats.js skills (Week 1). Requirements only ever use these keys. */
  var SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'mining', 'smithing', 'woodcutting', 'fishing', 'cooking'];
  /** GD's cooldown skills; the cooldown affix and legendary specials reference them. */
  var COMBAT_SKILLS = ['cleave', 'ground_slam', 'sigil_bolt'];

  var STAT_KEYS = ['aim', 'power', 'armour', 'maxHp', 'attackSpeed', 'crit', 'lifesteal', 'cooldown', 'gather'];
  var STAT_LABELS = {
    aim: 'Attack', power: 'Strength', armour: 'Defence', maxHp: 'Max HP', attackSpeed: 'Attack Speed %',
    crit: 'Critical Chance %', lifesteal: 'Life Steal %', cooldown: 'Skill Cooldown -%', gather: 'Gathering Speed %',
  };

  /* ---------------------------------------------------------------- lookups */
  function getBase(id) {
    var b = BASES[id];
    if (!b) throw new Error('unknown item base: ' + id);
    return b;
  }
  function hasBase(id) { return !!BASES[id]; }
  function tierOf(base) { return base && base.tier ? TIER_BY_ID[base.tier] : TIERS[0]; }
  function isGear(base) { return !!base.slot && !base.stackable; }
  function canRollAffixes(base) { return isGear(base); }
  function defaultRarity(base) {
    if (base.quest) return 'quest';
    if (base.legendary) return 'legendary';
    if (base.stackable || base.cat === 'tool' && !base.slot) return 'material';
    return 'normal';
  }
  function allNames() {
    var out = [];
    ORDER.forEach(function (id) { out.push(BASES[id].name); });
    TIERS.forEach(function (t) { out.push(t.name); });
    Object.keys(RARITIES).forEach(function (r) { out.push(RARITIES[r].name); });
    AFFIXES.forEach(function (a) { out.push(a.prefix, a.suffix, a.label.replace('{v}', '1')); });
    Object.keys(LEGENDARIES).forEach(function (k) { out.push(LEGENDARIES[k].special.text, LEGENDARIES[k].flavor); });
    return out;
  }

  RPG.ItemsDb = {
    TIERS: TIERS, TIER_BY_ID: TIER_BY_ID, RARITIES: RARITIES, GEAR_RARITIES: GEAR_RARITIES,
    SLOTS: SLOTS, SKILLS: SKILLS, COMBAT_SKILLS: COMBAT_SKILLS, BASES: BASES, ORDER: ORDER, LEGENDARIES: LEGENDARIES,
    AFFIXES: AFFIXES, AFFIX_BY_ID: AFFIX_BY_ID, STAT_KEYS: STAT_KEYS, STAT_LABELS: STAT_LABELS,
    CURRENCY: { id: 'gold', name: 'Gold', color: '#ffe08a' },
    affixRange: affixRange, getBase: getBase, hasBase: hasBase, tierOf: tierOf,
    isGear: isGear, canRollAffixes: canRollAffixes, defaultRarity: defaultRarity, allNames: allNames,
    beamFor: function (rarity) { var r = RARITIES[rarity]; return r ? r.beam : null; },
    colorFor: function (rarity) { var r = RARITIES[rarity]; return r ? r.color : RARITIES.normal.color; },
  };
});
