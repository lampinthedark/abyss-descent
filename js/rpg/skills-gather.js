/**
 * Skills & Quests: gathering nodes (mining, woodcutting, fishing).
 * Spawns node entities from RPG.world.zone.markers on enter {zone:'town'},
 * auto-swings while the hero stands in range, calls Crafting.gather on each
 * successful swing, grants XP via RPG.skills.grant, emits bus 'gather'
 * {skill, nodeKey, itemId, qty}. Ore and trees deplete (_empty/_stump) and respawn.
 */
(function (root) {
  'use strict';
  var SQ = root.RPGSQ = root.RPGSQ || {};

  // Swing timing and base success per skill. ~3 s per Rustbound ore and ~4 s per
  // fish at level 1, matching Senior's quest-time assumptions (mineS 3, fishS 4).
  SQ.GATHER = {
    mining:      { swingS: 1.0, base: 0.38, perLevel: 0.02, toolWord: 'pickaxe' },
    woodcutting: { swingS: 1.2, base: 0.45, perLevel: 0.02, toolWord: 'hatchet' },
    fishing:     { swingS: 1.5, base: 0.38, perLevel: 0.02, toolWord: 'fishing rod' },
  };
  SQ.ORE_RESPAWN_S = { rustbound: 4, cinderiron: 8, verdite: 15, tidesteel: 25, sunforged: 40 };
  SQ.TREE = { pine: { depleteChance: 0.2, respawnS: 10 }, ash: { depleteChance: 0.15, respawnS: 15 } };
  SQ.GATHER_RANGE = 1.4;
  SQ.REASON_TEXT = {
    inventory_full: 'Your backpack is full.', backpack_full: 'Your backpack is full.', bag_full: 'Your backpack is full.',
  };

  function list(v) { return !v ? [] : Array.isArray(v) ? v : [v]; }

  SQ.installGather = function (RPG) {
    var S = RPG.skills || SQ.install(RPG);
    var nodes = [];          // live node entities we own
    var act = null;          // { node, skill, cfg, t, sx, sy }
    var clock = 0;

    function Crafting() { return S.items().Crafting; }
    function nodeDef(key) { var C = Crafting(); return C && C.NODES ? C.NODES[key] : null; }

    function spriteFor(n) {
      if (n.skill === 'fishing') return n.nodeKey;
      if (n.skill === 'woodcutting') return n.nodeKey + (n.depleted ? '_stump' : '_full');
      return n.nodeKey + (n.depleted ? '_empty' : '_full');
    }
    function add(nodeKey, x, y, extra) {
      var def = nodeDef(nodeKey);
      var e = { kind: 'node', nodeKey: nodeKey, skill: def ? def.skill : null, x: x, y: y, frame: 0, depleted: false, respawnAt: 0 };
      for (var k in (extra || {})) e[k] = extra[k];
      e.sprite = spriteFor(e);
      e.id = RPG.world.addEntity(e);
      if (e.id == null) e.id = e;   // tolerate addEntity returning nothing
      nodes.push(e);
      return e;
    }
    function clear() {
      stop();
      nodes.forEach(function (e) { if (RPG.world.removeEntity && e.id !== e) RPG.world.removeEntity(e.id); });
      nodes = [];
    }
    function spawn() {
      clear();
      var m = (RPG.world.zone && RPG.world.zone.markers) || {};
      list(m.ore).forEach(function (o) { add('node_ore_' + (o.tier || 'rustbound'), o.x, o.y, { tier: o.tier || 'rustbound' }); });
      list(m.tree).forEach(function (o) { add('node_tree_' + (o.kind || 'pine'), o.x, o.y, { treeKind: o.kind || 'pine' }); });
      list(m.fish).forEach(function (o) { add('node_fish_0', o.x, o.y); });
      return nodes.length;
    }

    function say(text) { if (RPG.ui && RPG.ui.toast) RPG.ui.toast(text); }
    function failText(r, def) {
      if (r.reason === 'missing_tool') return 'You need a ' + (SQ.GATHER[def.skill] || {}).toolWord + '.';
      if (r.reason === 'level_too_low') return 'You need ' + SQ.LABEL[def.skill] + ' level ' + def.level + '.';
      return SQ.REASON_TEXT[r.reason] || ('You can\'t do that (' + r.reason + ').');
    }
    function precheck(def) {
      if (S.level(def.skill) < def.level) return { ok: false, reason: 'level_too_low' };
      var Eq = S.items().Equipment, tools = Eq && Eq.getStats ? (Eq.getStats().tools || {}) : null;
      if (tools && (tools[def.tool] || 0) < (def.toolTier || 1)) return { ok: false, reason: 'missing_tool' };
      var Inv = S.items().Inventory, y = def.yields && def.yields[def.yields.length - 1];
      if (Inv && Inv.fits && y && !Inv.fits([{ base: y.base, qty: 1 }])) return { ok: false, reason: 'inventory_full' };
      return { ok: true };
    }

    function start(node) {
      var def = nodeDef(node.nodeKey);
      if (!def) return false;
      if (node.depleted) { say(node.skill === 'woodcutting' ? 'Only a stump is left.' : 'The rock is empty. It will come back soon.'); return false; }
      var pc = precheck(def);
      if (!pc.ok) { say(failText(pc, def)); return false; }
      var cfg = SQ.GATHER[def.skill];
      var h = RPG.hero || { x: node.x, y: node.y };
      act = { node: node, def: def, skill: def.skill, cfg: cfg, t: cfg.swingS, sx: h.x, sy: h.y };
      if (RPG.bus) RPG.bus.emit('skilling', { skill: def.skill, on: true, x: node.x, y: node.y });
      return true;
    }
    function stop() {
      if (!act) return;
      if (RPG.bus) RPG.bus.emit('skilling', { skill: act.skill, on: false });
      act = null;
    }

    function chance(def) {
      var cfg = SQ.GATHER[def.skill];
      return Math.max(0.2, Math.min(0.92, cfg.base + cfg.perLevel * (S.level(def.skill) - def.level)));
    }
    function deplete(node) {
      if (node.skill === 'fishing') return false;
      if (node.skill === 'woodcutting') {
        var tr = SQ.TREE[node.treeKind] || SQ.TREE.pine;
        if (S.rng() >= tr.depleteChance) return false;
        node.respawnAt = clock + tr.respawnS;
      } else {
        node.respawnAt = clock + (SQ.ORE_RESPAWN_S[node.tier] || 6);
      }
      node.depleted = true;
      node.sprite = spriteFor(node);
      return true;
    }

    function swing() {
      var node = act.node, def = act.def;
      if (S.rng() >= chance(def)) return;               // miss: keep swinging
      var r = Crafting().gather(node.nodeKey);
      if (!r || !r.ok) { say(failText(r || { reason: 'error' }, def)); stop(); return; }
      S.grant(r.skill || def.skill, r.xp, node.x, node.y);
      if (RPG.fx) RPG.fx('pickup', node.x, node.y);
      if (RPG.bus) RPG.bus.emit('gather', { skill: r.skill || def.skill, nodeKey: node.nodeKey, itemId: r.base, qty: r.qty || 1, x: node.x, y: node.y });
      if (deplete(node)) stop();
    }

    function update(dt) {
      clock += dt;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.depleted && clock >= n.respawnAt) { n.depleted = false; n.sprite = spriteFor(n); }
      }
      if (!act) return;
      var h = RPG.hero;
      if (h && (h.alive === false || Math.abs(h.x - act.sx) > 0.3 || Math.abs(h.y - act.sy) > 0.3)) { stop(); return; }
      act.t -= dt;
      while (act && act.t <= 0) { act.t += act.cfg.swingS; swing(); }
    }

    function hit(tx, ty) {
      var best = null, bd = 0.9;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i], dx = Math.abs(n.x - tx), dy = Math.abs(n.y - ty);
        var tall = n.skill === 'woodcutting' ? 1.6 : 0.8;   // tree tops stand above the foot tile
        if (dx <= 0.75 && ty <= n.y + 0.6 && ty >= n.y - tall) { var d = dx + dy * 0.5; if (d < bd) { bd = d; best = n; } }
      }
      return best;
    }

    /** Nearest live node for an arrow key like 'node_ore_rustbound' (falls back to a depleted one). */
    function pointFor(key) {
      var h = RPG.hero || { x: 0, y: 0 }, best = null, bd = Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i]; if (n.nodeKey !== key) continue;
        var d = SQ.dist(n, h) + (n.depleted ? 1000 : 0);
        if (d < bd) { bd = d; best = n; }
      }
      return best ? { x: best.x, y: best.y } : null;
    }

    RPG.registerSystem({ id: 'sq-gather', update: update, draw: function () {} });
    RPG.registerTappable({ id: 'sq-nodes', hit: hit, range: SQ.GATHER_RANGE, onArrive: function (n) { stop(); start(n); } });
    if (RPG.bus) {
      RPG.bus.on('enter', function (d) { if (d && d.zone === 'town') spawn(); else if (d && d.zone) clear(); });
      RPG.bus.on('hurt', stop);
      RPG.bus.on('death', stop);
      RPG.bus.on('questStep', stop);   // step done: stop so the tracker's next step gets attention
    }
    var z = RPG.world.zone; if (z && (z.id || z) === 'town') spawn();

    S._points = (S._points || []).concat([pointFor]);
    S.pointFor = function (key) { for (var i = 0; i < S._points.length; i++) { var p = S._points[i](key); if (p) return p; } return null; };
    S.gather = { nodes: function () { return nodes.slice(); }, active: function () { return act ? act.node : null; },
      start: start, stop: stop, spawn: spawn, update: update, hit: hit, chance: chance };
    return S.gather;
  };

  if (root.RPG && !root.RPG.__sqNoAuto) SQ.installGather(root.RPG);
  if (typeof module === 'object' && module.exports) module.exports = SQ;
})(typeof window !== 'undefined' ? window : globalThis);
