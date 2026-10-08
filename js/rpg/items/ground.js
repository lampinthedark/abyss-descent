/**
 * RPG items: loot on the ground (spawn from kills, pickup, despawn).
 *
 *   world.Loot.rollDrop(monsterId, rng, x, y)  roll + spawn; returns ground entries to render
 *   world.Ground.pickup(gid)             walk-over pickup; refuses cleanly when full
 *
 * Kill rolls use a deterministic per-kill seed (lootSeed, kills) and the
 * rolled result is stored in the op, so replays never re-roll.
 */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module.exports;
  var RPG = isNode ? require('./loot.js') : root.RPGItems;
  if (isNode) { require('./state.js'); require('./item-ids.js'); }
  factory(RPG);
  if (isNode) module.exports = RPG;
})(typeof window !== 'undefined' ? window : globalThis, function (RPG) {
  'use strict';
  var S = RPG.State, Db = RPG.ItemsDb, Gen = RPG.ItemGen, Core = RPG.Core;
  var MAX_GOLD_MULT = 3;   // cap on skill gold multipliers the client may claim

  function entryView(g) {
    if (g.gold != null) return { gid: g.gid, kind: 'gold', amount: g.gold, x: g.x, y: g.y, color: Db.CURRENCY.color, beam: null };
    return { gid: g.gid, kind: 'item', name: Gen.displayName(g.item), base: g.item.base, qty: g.item.qty,
      rarity: g.item.rarity, color: Db.colorFor(g.item.rarity), beam: Db.beamFor(g.item.rarity), x: g.x, y: g.y,
      bound: g.item.bound };
  }

  var reducers = {
    /** p: { monster, x, y, gold, items:[inst], best } (result of Loot.rollDrop) */
    'loot.spawn': function (s, p, op, X) {
      if (!RPG.Loot.MONSTERS[p.monster]) S.fail('unknown_monster');
      s.kills += 1;
      var best = RPG.Loot.bestRarity(p.items);
      s.pity = RPG.Loot.rarityRank(best) >= 1 ? 0 : s.pity + 1;
      var wasDone = s.firstRare.done;
      s.firstRare = RPG.Loot.nextFirstRare(s.firstRare, p.monster, best);
      if (s.firstRare.done && !wasDone) { s.firstRare.at = op.at; s.firstRare.kill = s.kills; }
      var added = [];
      var spread = 0;
      function pos() { var a = spread++ * 2.399; var r = spread > 1 ? 0.35 : 0; return { x: (p.x || 0) + Math.cos(a) * r, y: (p.y || 0) + Math.sin(a) * r }; }
      if (p.gold > 0) {
        var q = pos();
        var g = { gid: RPG.ItemIds.next(s, 'goldpile'), gold: p.gold, x: q.x, y: q.y, until: op.at + S.GROUND_MS, src: 'drop', monster: p.monster };
        s.ground.push(g); added.push(g);
      }
      p.items.forEach(function (raw) {
        var inst = Core.clone(raw);
        inst.uid = null;
        S.mint(s, inst, 'drop');
        var q2 = pos();
        var e = { gid: inst.uid, item: inst, x: q2.x, y: q2.y, until: op.at + S.GROUND_MS, src: 'drop', monster: p.monster };
        s.ground.push(e); added.push(e);
      });
      var views = added.map(entryView);
      X.emit('ground', { added: views.map(function (v) { return v.gid; }) });
      views.forEach(function (v) { if (v.beam) X.emit('beam', v); });
      if (s.firstRare.done && !wasDone) X.emit('first_rare', { kill: s.kills });
      return { drops: views, pity: s.pity, firstRare: Core.clone(s.firstRare) };
    },
    /** p: { gid, goldMult } */
    'ground.pickup': function (s, p, op, X) {
      var idx = -1;
      for (var i = 0; i < s.ground.length; i++) if (s.ground[i].gid === p.gid) { idx = i; break; }
      if (idx < 0) S.fail('gone');
      var g = s.ground[idx];
      if (g.item && g.item.boundTo && g.item.boundTo !== s.playerId) S.fail('bound_to_other');
      if (g.gold != null) {
        var mult = Math.min(MAX_GOLD_MULT, Math.max(1, Number(p.goldMult) || 1));
        var amt = Math.round(g.gold * mult);
        s.ground.splice(idx, 1);
        S.credit(s, amt, 'drop', g.monster || null, op);
        X.emit('gold', { balance: s.gold, delta: amt, src: 'drop' });
        X.emit('ground', { removed: [p.gid] });
        X.emit('pickup', { gid: p.gid, kind: 'gold', amount: amt, color: Db.CURRENCY.color });
        return { kind: 'gold', amount: amt };
      }
      var put = S.invPut(s, g.item);   // throws inventory_full -> nothing changes
      s.ground.splice(idx, 1);
      var it = s.inv[put.slot];
      X.emit('inventory', { reason: 'pickup' });
      X.emit('ground', { removed: [p.gid] });
      X.emit('pickup', { gid: p.gid, kind: 'item', uid: put.uid, name: Gen.displayName(it), rarity: it.rarity,
        color: Db.colorFor(it.rarity), qty: g.item.qty });
      return { kind: 'item', slot: put.slot, uid: put.uid, rarity: it.rarity };
    },
    /** p: { at } remove expired ground entries. */
    'ground.despawn': function (s, p, op, X) {
      var removed = [];
      s.ground = s.ground.filter(function (g) {
        if (g.until > p.at) return true;
        if (g.item) S.burn(s, g.item.base, g.item.qty, 'despawn');
        removed.push(g.gid);
        return false;
      });
      if (!removed.length) S.fail('nothing_expired');
      X.emit('ground', { removed: removed });
      return { removed: removed };
    },
  };

  RPG.Modules.ground = {
    name: 'Ground',
    reducers: reducers,
    api: function (w) {
      return {
        pickup: function (gid, opts) {
          var r = w.commit('ground.pickup', { gid: gid, goldMult: opts && opts.goldMult });
          if (!r.ok && r.reason === 'inventory_full') w.emit('inventory_full', { gid: gid });
          return r;
        },
        /** Call every few seconds; removes expired drops. */
        tick: function () {
          var now = w.now();
          var any = w.state().ground.some(function (g) { return g.until <= now; });
          return any ? w.commit('ground.despawn', { at: now }) : { ok: true, removed: [] };
        },
        list: function () { return w.state().ground.map(entryView); },
        get: function (gid) {
          var g = w.state().ground.filter(function (e) { return e.gid === gid; })[0];
          return g ? entryView(g) : null;
        },
        describe: function (gid) {
          var g = w.state().ground.filter(function (e) { return e.gid === gid; })[0];
          return g && g.item ? Gen.describe(g.item) : null;
        },
      };
    },
    extra: function (w) {
      // world.Loot: kill → ground entries. (Pure tables stay on RPG.Loot.)
      return {
        Loot: {
          MONSTERS: RPG.Loot.MONSTERS,
          /**
           * THE kill hook core calls: Loot.rollDrop(monsterId, rng?, x?, y?).
           * Rolls with the persisted pity counters, spawns the result on the
           * ground with provisional ids and returns { ok, drops:[...], best }.
           * rng is optional (pass a seeded one for UAT seeded runs); default is
           * a deterministic per-kill seed from the save.
           */
          rollDrop: function (monsterId, rng, x, y) {
            if (!RPG.Loot.MONSTERS[monsterId]) return { ok: false, reason: 'unknown_monster', drops: [] };
            var s = w.state();
            var r0 = rng || Core.makeRng(Core.mixSeed(s.lootSeed, 'kill', s.kills));
            var d = RPG.Loot.rollDrop(monsterId, r0, { pity: s.pity, firstRare: s.firstRare });
            var r = w.commit('loot.spawn', { monster: monsterId, x: x, y: y, gold: d.gold, items: d.items });
            if (r.ok) { r.best = d.best; r.pityUsed = d.pityUsed; r.firstRareUsed = !!d.firstRareUsed; }
            return r;
          },
          /** Notable drops for UI copy ("Can drop: Wyrmfang"); see RPGItems.Loot.preview. */
          preview: function (monsterId) { return RPG.Loot.preview(monsterId); },
          firstRare: function () { return Core.clone(w.state().firstRare); },
        },
      };
    },
  };
});
