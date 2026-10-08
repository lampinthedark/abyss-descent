/**
 * RPG items: instance creation, deterministic affix rolls, stat totals,
 * display names / tooltips and server-style re-verification.
 *
 * Instances store ONLY identity + roll inputs (base, tier, rarity, seed,
 * qty, flags). Stats and affixes are always DERIVED from
 * (base, tier, rarity, seed), so a save edit cannot forge stats and the
 * server can recompute them exactly.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./items-db.js') : root.RPGItems;
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var Core = RPG.Core, Db = RPG.ItemsDb;

  var INSTANCE_VERSION = 1;

  function allowedRarities(base) {
    if (base.quest) return ['quest'];
    if (base.legendary) return ['legendary'];
    if (Db.canRollAffixes(base)) return ['normal', 'rare', 'very_rare'];
    return ['material'];
  }

  /** Legendaries, chase items and quest items bind when they drop. Never unset. */
  function bindsOnDrop(base, rarity) {
    return rarity === 'legendary' || !!base.quest || !!(Db.LEGENDARIES[base.id] && Db.LEGENDARIES[base.id].chase);
  }

  /**
   * Build an (unowned, id-less) instance. The world assigns uid/owner when it
   * enters a container. opts: { rarity, seed, qty, origin, bound }
   */
  function createInstance(baseId, opts) {
    opts = opts || {};
    var base = Db.getBase(baseId);
    var rarity = opts.rarity || Db.defaultRarity(base);
    if (allowedRarities(base).indexOf(rarity) < 0) {
      throw new Error('rarity ' + rarity + ' not allowed for ' + baseId);
    }
    var qty = base.stackable ? Math.max(1, Math.floor(opts.qty || 1)) : 1;
    var seed = opts.seed == null ? 0 : (opts.seed >>> 0);
    var bound = !!opts.bound || bindsOnDrop(base, rarity);
    return {
      v: INSTANCE_VERSION,
      uid: null,          // provisional client id from ItemIds.next(): "item_<clientId>_<n>"
      sid: null,          // server-assigned id (bigint as string) once synced
      untrusted: true,    // flips to false only when the server confirms the item
      base: base.id,
      tier: base.tier || null,
      rarity: rarity,
      seed: seed,
      qty: qty,
      bound: bound,
      boundTo: null,      // set to the owner on first pickup when bound
      owner: null,
      origin: opts.origin || null,   // { src: 'drop'|'shop_buy'|'craft'|'quest'|'migration', ref, at }
    };
  }

  var memo = {};
  var memoSize = 0;

  /** Deterministic affix roll for (base, rarity, seed). Returns [{id, stat, v}]. */
  function rollAffixes(baseId, rarity, seed) {
    var base = Db.getBase(baseId);
    var r = Db.RARITIES[rarity];
    if (!r || !Db.canRollAffixes(base) || r.affixes[1] === 0) return [];
    var key = baseId + '|' + rarity + '|' + (seed >>> 0);
    if (memo[key]) return memo[key];
    var rng = Core.makeRng(Core.mixSeed('affix', baseId, rarity, seed >>> 0));
    var tierIdx = Db.tierOf(base).idx;
    var sig = Db.LEGENDARIES[base.id] ? Db.LEGENDARIES[base.id].signature : {};
    var pool = Db.AFFIXES.filter(function (a) {
      return a.groups.indexOf(base.group) >= 0 && !(a.stat in sig);
    });
    var n = rng.int(r.affixes[0], r.affixes[1]);
    var out = [];
    while (out.length < n && pool.length) {
      var pick = rng.weighted(pool);
      pool = pool.filter(function (a) { return a !== pick; });
      var range = Db.affixRange(pick, tierIdx);
      out.push({ id: pick.id, stat: pick.stat, v: rng.int(range[0], range[1]) });
    }
    if (memoSize > 5000) { memo = {}; memoSize = 0; }
    memo[key] = out; memoSize++;
    return out;
  }

  function emptyStats() {
    var s = {};
    Db.STAT_KEYS.forEach(function (k) { s[k] = 0; });
    return s;
  }

  /** Full stat block for one instance: base + legendary signature + affixes. */
  function stats(inst) {
    var base = Db.getBase(inst.base);
    var s = emptyStats();
    var k;
    for (k in base.stats) s[k] += base.stats[k];
    var L = Db.LEGENDARIES[base.id];
    if (L) for (k in L.signature) s[k] += L.signature[k];
    rollAffixes(inst.base, inst.rarity, inst.seed).forEach(function (a) { s[a.stat] += a.v; });
    return s;
  }

  function displayName(inst) {
    var base = Db.getBase(inst.base);
    if (inst.rarity !== 'rare' && inst.rarity !== 'very_rare') return base.name;
    var aff = rollAffixes(inst.base, inst.rarity, inst.seed);
    if (!aff.length) return base.name;
    var name = Db.AFFIX_BY_ID[aff[0].id].prefix + ' ' + base.name;
    if (inst.rarity === 'very_rare' && aff[1]) name += ' ' + Db.AFFIX_BY_ID[aff[1].id].suffix;
    return name;
  }

  /** Unit value (gold) before shop multipliers. */
  function value(inst) {
    var base = Db.getBase(inst.base);
    var r = Db.RARITIES[inst.rarity] || Db.RARITIES.normal;
    return Math.max(0, Math.round(base.value * (r.valueMult || 1)));
  }

  function levelReq(base) {
    var out = [];
    for (var k in base.req) out.push({ skill: k, level: base.req[k] });
    return out;
  }

  /** Tooltip model for the UI: name, colour, beam, ordered lines. */
  function describe(inst) {
    var base = Db.getBase(inst.base);
    var r = Db.RARITIES[inst.rarity] || Db.RARITIES.normal;
    var lines = [];
    var tier = base.tier ? Db.TIER_BY_ID[base.tier] : null;
    lines.push({ kind: 'type', text: (r.rank >= 0 ? r.name + ' ' : '') + (tier ? tier.name + ' ' : '') +
      (base.slot ? base.slot : base.cat) + (base.twoHanded ? ' (two-handed)' : '') });
    var k;
    for (k in base.stats) {
      if (base.stats[k]) lines.push({ kind: 'base', stat: k, text: fmtStat(k, base.stats[k]) });
    }
    var L = Db.LEGENDARIES[base.id];
    if (L) {
      for (k in L.signature) lines.push({ kind: 'signature', stat: k, text: fmtStat(k, L.signature[k]) });
      lines.push({ kind: 'special', text: L.special.text });
    }
    rollAffixes(inst.base, inst.rarity, inst.seed).forEach(function (a) {
      lines.push({ kind: 'affix', stat: a.stat, id: a.id, text: Db.AFFIX_BY_ID[a.id].label.replace('{v}', a.v) });
    });
    if (base.heal) lines.push({ kind: 'base', text: 'Heals ' + base.heal + ' HP' });
    if (base.tool) lines.push({ kind: 'base', text: 'Tool: ' + base.tool + (base.toolTier ? ' (tier ' + base.toolTier + ')' : '') });
    levelReq(base).forEach(function (q) { lines.push({ kind: 'req', skill: q.skill, level: q.level, text: 'Requires ' + q.skill + ' ' + q.level }); });
    if (inst.bound) lines.push({ kind: 'bound', text: 'Bound' + (inst.boundTo ? '' : ' on pickup') + ' - cannot be traded' });
    else if (!base.tradeable) lines.push({ kind: 'bound', text: 'Cannot be traded' });
    if (L && L.flavor) lines.push({ kind: 'flavor', text: L.flavor });
    return {
      name: displayName(inst), baseName: base.name, rarity: inst.rarity, rarityName: r.name,
      color: r.color, beam: r.beam, qty: inst.qty, stackable: base.stackable, value: value(inst),
      slot: base.slot || null, lines: lines, stats: stats(inst),
    };
  }

  function fmtStat(k, v) {
    var sign = v >= 0 ? '+' : '';
    switch (k) {
      case 'aim': return sign + v + ' Attack';
      case 'power': return sign + v + ' Strength';
      case 'armour': return sign + v + ' Defence';
      case 'maxHp': return sign + v + ' Max HP';
      case 'attackSpeed': return sign + v + '% Attack Speed';
      case 'crit': return sign + v + '% Critical Chance';
      case 'lifesteal': return sign + v + '% Life Steal';
      case 'cooldown': return '-' + v + '% Skill Cooldown';
      case 'gather': return sign + v + '% Gathering Speed';
      default: return sign + v + ' ' + k;
    }
  }

  /**
   * Structural validation, as the server would run it on an incoming item.
   * Returns [] when valid, else a list of error strings.
   */
  function validate(inst) {
    var errs = [];
    if (!inst || typeof inst !== 'object') return ['not an object'];
    if (!Db.hasBase(inst.base)) return ['unknown base ' + inst.base];
    var base = Db.getBase(inst.base);
    if ((base.tier || null) !== (inst.tier || null)) errs.push('tier mismatch');
    if (allowedRarities(base).indexOf(inst.rarity) < 0) errs.push('rarity not allowed');
    if (!(inst.seed >= 0 && inst.seed <= 0xffffffff && Math.floor(inst.seed) === inst.seed)) errs.push('bad seed');
    if (!(Number.isInteger(inst.qty) && inst.qty >= 1)) errs.push('bad qty');
    if (!base.stackable && inst.qty !== 1) errs.push('non-stackable qty != 1');
    if (bindsOnDrop(base, inst.rarity) && !inst.bound) errs.push('must be bound');
    if (inst.boundTo && !inst.bound) errs.push('boundTo without bound');
    return errs;
  }

  /** Server-style check: recompute stats from roll inputs and compare to claimed. */
  function verifyStats(inst, claimedStats) {
    var real = stats(inst);
    for (var k in real) if ((claimedStats[k] || 0) !== real[k]) return false;
    for (k in claimedStats) if (!(k in real) && claimedStats[k]) return false;
    return true;
  }

  /** Two instances can share a stack slot. */
  function canStack(a, b) {
    var base = Db.getBase(a.base);
    return base.stackable && a.base === b.base && a.rarity === b.rarity &&
      !!a.bound === !!b.bound && (a.boundTo || null) === (b.boundTo || null);
  }

  RPG.ItemGen = {
    INSTANCE_VERSION: INSTANCE_VERSION,
    createInstance: createInstance, rollAffixes: rollAffixes, stats: stats, emptyStats: emptyStats,
    displayName: displayName, describe: describe, value: value, validate: validate,
    verifyStats: verifyStats, canStack: canStack, bindsOnDrop: bindsOnDrop, allowedRarities: allowedRarities,
    levelReq: levelReq, fmtStat: fmtStat,
  };
});
