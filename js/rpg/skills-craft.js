/**
 * Skills & Quests: furnace (ore -> bar), anvil (bar -> gear), range/fire (raw -> cooked).
 * Spawns station entities from zone markers on enter {zone:'town'}. Tapping a
 * station makes the recipe the active quest step wants, else the only makeable
 * one, else offers a short RPG.ui.dialog menu. Smelting and cooking repeat while
 * inputs last; the anvil makes one item per tap. Each Crafting.make ok grants XP
 * (RPG.skills.grant) and emits bus 'craft' {recipeId, itemId, burnt} (burnt too).
 */
(function (root) {
  'use strict';
  var SQ = root.RPGSQ = root.RPGSQ || {};

  SQ.STATION = {
    furnace: { sprite: 'prop_furnace_0', makeS: 1.8, repeat: true,  verb: 'smelt', name: 'Furnace' },
    anvil:   { sprite: 'prop_anvil_0',   makeS: 2.4, repeat: false, verb: 'smith', name: 'Anvil' },
    range:   { sprite: 'prop_range_0',   makeS: 1.8, repeat: true,  verb: 'cook',  name: 'Range' },
    fire:    { sprite: 'prop_fire_0',    makeS: 1.8, repeat: true,  verb: 'cook',  name: 'Fire' },
  };
  SQ.CRAFT_RANGE = 1.3;
  SQ.PLAYER_FIRE_S = 60;
  SQ.MENU_MAX = 4;

  function list(v) { return !v ? [] : Array.isArray(v) ? v : [v]; }

  SQ.installCraft = function (RPG) {
    var S = RPG.skills || SQ.install(RPG);
    var stations = [], act = null, clock = 0, busy = false;

    function Crafting() { return S.items().Crafting; }
    function say(t, c) { if (RPG.ui && RPG.ui.toast) RPG.ui.toast(t, c); }

    function add(kind, x, y, extra) {
      var cfg = SQ.STATION[kind];
      var e = { kind: 'station', station: kind, sprite: cfg.sprite, frame: 0, x: x, y: y };
      for (var k in (extra || {})) e[k] = extra[k];
      e.id = RPG.world.addEntity(e); if (e.id == null) e.id = e;
      stations.push(e); return e;
    }
    function remove(e) {
      if (RPG.world.removeEntity && e.id !== e) RPG.world.removeEntity(e.id);
      stations = stations.filter(function (s) { return s !== e; });
    }
    function clear() { stop(); stations.slice().forEach(remove); }
    function spawn() {
      clear();
      var m = (RPG.world.zone && RPG.world.zone.markers) || {};
      Object.keys(SQ.STATION).forEach(function (k) { list(m[k]).forEach(function (p) { add(k, p.x, p.y); }); });
      return stations.length;
    }

    function recipes(kind) { var C = Crafting(); return C ? C.list(kind) : []; }
    function makeable(kind) {
      var C = Crafting();
      return recipes(kind).filter(function (r) { return C.canMake(r.id).ok; })
        .sort(function (a, b) { return (a.level - b.level) || (a.id < b.id ? -1 : 1); });
    }
    function whyNot(kind) {
      var C = Crafting(), rs = recipes(kind), lvl = null;
      for (var i = 0; i < rs.length; i++) {
        var c = C.canMake(rs[i].id);
        if (c.reason === 'level_too_low') lvl = lvl && lvl.level <= rs[i].level ? lvl : rs[i];
        if (c.reason === 'missing_tool') return 'You need a hammer to use the anvil.';
      }
      if (lvl) return 'You need ' + SQ.LABEL[lvl.skill] + ' level ' + lvl.level + ' for ' + lvl.name + '.';
      return { furnace: 'You need ore to smelt.', anvil: 'You need bars to smith.', range: 'You have nothing to cook.', fire: 'You have nothing to cook.' }[kind];
    }
    function label(r) {
      var inp = (r.inputs || []).map(function (i) { return i.qty + ' ' + (i.base.indexOf('_bar') > 0 ? 'bar' + (i.qty > 1 ? 's' : '') : i.base.replace(/_/g, ' ')); }).join(', ');
      return r.name + (inp ? ' (' + inp + ')' : '');
    }

    function begin(station, recipeId) {
      var cfg = SQ.STATION[station.station], h = RPG.hero || station;
      act = { station: station, recipeId: recipeId, cfg: cfg, t: cfg.makeS, sx: h.x, sy: h.y, made: 0 };
      if (RPG.bus) RPG.bus.emit('skilling', { skill: Crafting().RECIPES[recipeId].skill, on: true, x: station.x, y: station.y });
    }
    function stop() {
      if (!act) return;
      if (RPG.bus) RPG.bus.emit('skilling', { skill: (Crafting().RECIPES[act.recipeId] || {}).skill, on: false });
      act = null;
    }
    function makeOne() {
      var st = act.station, id = act.recipeId, R = Crafting().RECIPES[id];
      var r = Crafting().make(id, { station: st.station });
      if (!r || !r.ok) { if (act.made === 0) say(whyNot(st.station)); stop(); return; }
      act.made++;
      if (r.burnt) { if (RPG.ui && RPG.ui.float) RPG.ui.float(st.x, st.y - 0.6, 'Burnt!', '#c9a27a'); }
      S.grant(r.skill || R.skill, r.xp, st.x, st.y);
      if (r.effect === 'fire' && RPG.hero) add('fire', RPG.hero.x, RPG.hero.y, { expiresAt: clock + SQ.PLAYER_FIRE_S, player: true });
      var out = R.outputs && R.outputs[0];
      if (RPG.bus) RPG.bus.emit('craft', { recipeId: id, itemId: out ? out.base : null, burnt: !!r.burnt, station: st.station, x: st.x, y: st.y });
      if (!act) return;
      if (!act.cfg.repeat || !Crafting().canMake(id).ok) stop();
    }

    function choose(station) {
      var kind = station.station, ok = makeable(kind);
      if (!ok.length) { say(whyNot(kind)); return; }
      var want = RPG.quests && RPG.quests.wantRecipe ? RPG.quests.wantRecipe() : null;
      for (var i = 0; i < ok.length; i++) if (ok[i].id === want) return begin(station, want);
      if (ok.length === 1 || !(RPG.ui && RPG.ui.dialog)) return begin(station, ok[0].id);
      var pick = ok.slice(0, SQ.MENU_MAX);
      var choices = pick.map(function (r) { return { id: r.id, label: label(r) }; }).concat([{ id: 'cancel', label: 'Cancel' }]);
      busy = true;
      Promise.resolve(RPG.ui.dialog(null, ['What do you want to ' + SQ.STATION[kind].verb + '?'], choices)).then(function (c) {
        busy = false;
        var id = c && (c.id || c);
        if (id && id !== 'cancel' && Crafting().RECIPES[id]) begin(station, id);
      }, function () { busy = false; });
    }

    function update(dt) {
      clock += dt;
      for (var i = stations.length - 1; i >= 0; i--) if (stations[i].expiresAt && clock >= stations[i].expiresAt) remove(stations[i]);
      if (!act) return;
      var h = RPG.hero;
      if (h && (h.alive === false || Math.abs(h.x - act.sx) > 0.3 || Math.abs(h.y - act.sy) > 0.3)) { stop(); return; }
      act.t -= dt;
      while (act && act.t <= 0) { act.t += act.cfg.makeS; makeOne(); }
    }
    function hit(tx, ty) {
      for (var i = 0; i < stations.length; i++) {
        var s = stations[i];
        if (Math.abs(s.x - tx) <= 0.75 && ty <= s.y + 0.6 && ty >= s.y - 1.4) return s;
      }
      return null;
    }
    function pointFor(key) {
      for (var i = 0; i < stations.length; i++) if (!stations[i].player && stations[i].sprite === key) return { x: stations[i].x, y: stations[i].y };
      return null;
    }

    RPG.registerSystem({ id: 'sq-craft', update: update, draw: function () {} });
    RPG.registerTappable({ id: 'sq-stations', hit: hit, range: SQ.CRAFT_RANGE, onArrive: function (s) { if (busy) return; stop(); choose(s); } });
    if (RPG.bus) {
      RPG.bus.on('enter', function (d) { if (d && d.zone === 'town') spawn(); else if (d && d.zone) clear(); });
      RPG.bus.on('hurt', stop);
      RPG.bus.on('death', stop);
      RPG.bus.on('questStep', stop);   // step done: stop so the tracker's next step gets attention
    }
    var z = RPG.world.zone; if (z && (z.id || z) === 'town') spawn();

    S._points = (S._points || []).concat([pointFor]);
    S.pointFor = function (key) { for (var i = 0; i < S._points.length; i++) { var p = S._points[i](key); if (p) return p; } return null; };
    S.craft = { stations: function () { return stations.slice(); }, active: function () { return act; },
      choose: choose, begin: begin, stop: stop, spawn: spawn, update: update, hit: hit, makeable: makeable };
    return S.craft;
  };

  if (root.RPG && !root.RPG.__sqNoAuto) SQ.installCraft(root.RPG);
  if (typeof module === 'object' && module.exports) module.exports = SQ;
})(typeof window !== 'undefined' ? window : globalThis);
