/**
 * RPG items: 9 equipment slots with skill level requirements.
 *
 * Equipment.getStats() is the ONE call combat reads. It returns integer
 * totals of base stats + legendary signatures + rolled affixes.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./state.js') : root.RPGItems;
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var S = RPG.State, Db = RPG.ItemsDb, Gen = RPG.ItemGen, Core = RPG.Core;

  /** Missing skills count as level 1. */
  function unmetReqs(base, levels) {
    levels = levels || {};
    var out = [];
    for (var k in base.req) {
      var have = levels[k] != null ? levels[k] : 1;
      if (have < base.req[k]) out.push({ skill: k, need: base.req[k], have: have });
    }
    return out;
  }

  var reducers = {
    /** p: { uid, levels } — levels snapshot from stats.js so replays are deterministic. */
    'eq.equip': function (s, p, op, X) {
      var i = S.invIndex(s, p.uid);
      if (i < 0) S.fail('no_item');
      var it = s.inv[i];
      var base = Db.getBase(it.base);
      if (!base.slot || base.stackable) S.fail('not_equippable');
      var unmet = unmetReqs(base, p.levels);
      if (unmet.length) S.fail('level_too_low', unmet);
      var slot = base.slot;
      s.inv[i] = null;
      var back = [];
      if (s.equip[slot]) back.push(s.equip[slot]);
      if (slot === 'weapon' && base.twoHanded && s.equip.offhand) { back.push(s.equip.offhand); s.equip.offhand = null; }
      if (slot === 'offhand' && s.equip.weapon && Db.getBase(s.equip.weapon.base).twoHanded) { back.push(s.equip.weapon); s.equip.weapon = null; }
      s.equip[slot] = it;
      // First returned item takes the slot we just emptied; the rest need free slots.
      back.forEach(function (b, n) { S.invPut(s, b, n === 0 ? i : null); });
      X.emit('equipment', { slot: slot });
      X.emit('inventory', { reason: 'equip' });
      return { slot: slot, returned: back.map(function (b) { return b.uid; }) };
    },
    'eq.unequip': function (s, p, op, X) {
      if (Db.SLOTS.indexOf(p.slot) < 0) S.fail('bad_slot');
      var it = s.equip[p.slot];
      if (!it) S.fail('no_item');
      s.equip[p.slot] = null;
      var put = S.invPut(s, it);
      X.emit('equipment', { slot: p.slot });
      X.emit('inventory', { reason: 'unequip' });
      return { slot: put.slot };
    },
  };

  function totals(s) {
    var t = Gen.emptyStats();
    var specials = [];
    Db.SLOTS.forEach(function (k) {
      var it = s.equip[k];
      if (!it) return;
      var st = Gen.stats(it);
      for (var key in st) t[key] += st[key];
      var L = Db.LEGENDARIES[it.base];
      if (L) specials.push({ id: L.special.id, skill: L.special.skill || null, text: L.special.text, slot: k });
    });
    var w = s.equip.weapon ? Db.getBase(s.equip.weapon.base) : null;
    t.specials = specials;
    t.weapon = w ? { base: w.id, kind: w.kind, twoHanded: !!w.twoHanded, tier: w.tier } : null;
    // Best gathering tool tier available (equipped or in the backpack), for gather gates.
    t.tools = toolTiers(s);
    // Mapping for the OLD Entities.playerStats (dmg/armor/life/aspd) while both exist.
    t.legacy = { dmg: t.power, armor: t.armour, life: t.maxHp, aspd: t.attackSpeed / 100, lifesteal: t.lifesteal / 100 };
    return t;
  }

  function toolTiers(s) {
    var out = {};
    function see(it) {
      if (!it) return;
      var b = Db.getBase(it.base);
      if (b.tool) out[b.tool] = Math.max(out[b.tool] || 0, b.toolTier || 1);
    }
    s.inv.forEach(see);
    see(s.equip.weapon);
    return out;
  }

  RPG.Modules.equipment = {
    name: 'Equipment',
    reducers: reducers,
    unmetReqs: unmetReqs,
    toolTiers: toolTiers,
    api: function (w) {
      return {
        SLOTS: Db.SLOTS.slice(),
        /** equip(uid | inventory slot number) */
        equip: function (uidOrSlot) {
          var uid = typeof uidOrSlot === 'number' ? (w.state().inv[uidOrSlot] || {}).uid : uidOrSlot;
          return w.commit('eq.equip', { uid: uid, levels: w.levels() });
        },
        unequip: function (slot) { return w.commit('eq.unequip', { slot: slot }); },
        /** { ok, unmet:[{skill, need, have}] } for greying out tooltips. */
        canEquip: function (uid) {
          var f = S.findItem(w.state(), uid);
          if (!f) return { ok: false, reason: 'no_item', unmet: [] };
          var base = Db.getBase(f.item.base);
          if (!base.slot || base.stackable) return { ok: false, reason: 'not_equippable', unmet: [] };
          var unmet = unmetReqs(base, w.levels());
          return { ok: !unmet.length, reason: unmet.length ? 'level_too_low' : null, unmet: unmet };
        },
        get: function (slot) { var it = w.state().equip[slot]; return it ? Gen.describe(it) : null; },
        list: function () {
          var s = w.state(), out = {};
          Db.SLOTS.forEach(function (k) { out[k] = s.equip[k] ? RPG.Modules.inventory.view(s.equip[k], k) : null; });
          return out;
        },
        /**
         * Totals for combat: { aim, power, armour, maxHp, attackSpeed, crit, lifesteal,
         * cooldown, gather, specials:[{id, skill, text}], weapon, tools:{pickaxe:2,...}, legacy }
         */
        getStats: function () { return totals(w.state()); },
        toolTiers: function () { return toolTiers(w.state()); },
        item: function (slot) { return Core.clone(w.state().equip[slot]); },
      };
    },
  };
});
