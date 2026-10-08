/**
 * Skills & Quests: quest runtime over Senior Game Dev's RPGContent data
 * (js/rpg/content/quest-data.js; field names unchanged, Q1 + Q2 ship).
 *
 * State lives in Store slice 'quests' = { active: {questId, step, n} | null, done: {questId: true} }.
 * Bus in:  talk {npcId}, gather {itemId}, craft {recipeId}, equip {slot, itemId}, kill {monsterId}, enter {zone}
 *          plus area 'enter' steps (e.g. goblin_field) detected from the hero's position.
 * Bus out: questAccept {questId}, questStep {questId, step}, questDone {questId}.
 * UI: RPG.ui.dialog for offer / progress / hand-in / rumour, RPG.ui.tracker(text, {x,y}) for the next step.
 * Kill steps: the arrow points at the nearest live monster of the step's target (hero distance), refreshed
 * every 0.25 s; with none alive (or no world entity API) it falls back to the step's arrowTo marker.
 * Installing RPG.quests switches off core's stand-in quest and tracker.
 */
(function (root) {
  'use strict';
  var SQ = root.RPGSQ = root.RPGSQ || {};
  SQ.TRACKER_REFRESH_S = 0.5;
  SQ.KILL_ARROW_REFRESH_S = 0.25;   // kill steps: the target moves, so re-aim the arrow more often

  /** Monster id of a world entity: monsterId, else an object def/spec id. */
  SQ.mobIdOf = function (e) {
    if (!e) return null;
    if (e.monsterId) return e.monsterId;
    if (e.def && typeof e.def === 'object' && e.def.id) return e.def.id;
    if (e.spec && typeof e.spec === 'object' && e.spec.id) return e.spec.id;
    return null;
  };
  /** Alive: not flagged dead / corpse / alive:false, and hp (if numeric) above 0. */
  SQ.mobAlive = function (e) {
    return !!e && !e.dead && e.alive !== false && !e.corpse && e.state !== 'dead' && !(typeof e.hp === 'number' && e.hp <= 0);
  };
  /** World entities, via entities() / forEach / near(), whichever core has. Never throws. */
  SQ.worldEntities = function (RPG) {
    var W = RPG && RPG.world, h = (RPG && RPG.hero) || { x: 0, y: 0 }, out = [];
    if (!W) return out;
    try {
      if (typeof W.entities === 'function') return W.entities() || out;
      if (typeof W.forEach === 'function') { W.forEach(function (e) { out.push(e); }); return out; }
      if (typeof W.near === 'function') return W.near(h.x, h.y, 999, 'mob') || out;
    } catch (err) { /* fall back to the marker */ }
    return out;
  };
  /** Nearest live mob whose id is monsterId, measured from the hero; null if none. */
  SQ.nearestMob = function (RPG, monsterId) {
    if (!monsterId) return null;
    var h = (RPG && RPG.hero) || { x: 0, y: 0 }, list = SQ.worldEntities(RPG), best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || (e.kind && e.kind !== 'mob') || SQ.mobIdOf(e) !== monsterId || !SQ.mobAlive(e)) continue;
      if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
      var d = Math.hypot(e.x - h.x, e.y - h.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  SQ.questsReducer = function (s, a) {
    s = s || { active: null, done: {} };
    switch (a.type) {
      case 'quests/accept': return { active: { questId: a.questId, step: 0, n: 0 }, done: s.done };
      case 'quests/progress': return { active: a.progress, done: s.done };
      case 'quests/complete': { var d = {}; for (var k in s.done) d[k] = s.done[k]; d[a.questId] = true; return { active: null, done: d }; }
      default: return s;
    }
  };

  SQ.installQuests = function (RPG) {
    var S = RPG.skills || SQ.install(RPG);
    var Store = RPG.store || root.Store;
    var mirror = { active: null, done: {} };
    var talking = false, refreshT = 0, lastTracker = null;

    if (Store && Store.register) Store.register('quests', function (s, a) { mirror = SQ.questsReducer(s, a); return mirror; }, mirror);

    function C() { return S.content(); }
    function state() {
      var st = null;
      if (Store) {
        if (typeof Store.get === 'function') st = Store.get('quests');
        else if (typeof Store.getState === 'function') st = (Store.getState() || {}).quests;
        else if (Store.state) st = Store.state.quests;
      }
      return st || mirror;
    }
    function dispatch(a) { if (Store && Store.dispatch) Store.dispatch(a); else mirror = SQ.questsReducer(mirror, a); }
    function log() { var s = state(); return { done: s.done || {}, active: s.active || null }; }
    function activeQuest() { var a = state().active; return a ? C().quest(a.questId) : null; }
    function step() { var a = state().active, q = activeQuest(); return q && a.step < q.steps.length ? q.steps[a.step] : null; }
    function isGiver(id) { var qs = C().QUESTS || []; for (var i = 0; i < qs.length; i++) if (qs[i].giver === id) return true; return false; }
    function npcName(id) { var n = C().NPCS && C().NPCS[id]; return n ? n.name : id; }
    function hero() { return RPG.hero || { x: 0, y: 0 }; }
    function zoneId() { var z = RPG.world && RPG.world.zone; return z ? (z.id || z) : null; }
    function emit(e, d) { if (RPG.bus) RPG.bus.emit(e, d); }
    function ask(npcId, lines, choices, opts) {
      if (!(RPG.ui && RPG.ui.dialog)) return Promise.resolve(choices && choices[0] ? choices[0].id : null);
      return Promise.resolve(opts ? RPG.ui.dialog('npc_' + npcId, lines, choices, opts) : RPG.ui.dialog('npc_' + npcId, lines, choices)).then(function (c) { return c && c.id ? c.id : c; });
    }

    /** Feed one bus event through RPGContent.advance(). */
    function feed(ev) {
      var a = state().active;
      if (!a) return false;
      var r = C().advance(a, ev);
      if (!r.advanced) return false;
      dispatch({ type: 'quests/progress', progress: r.progress });
      if (r.stepDone) {
        emit('questStep', { questId: a.questId, step: r.progress.step });
        if (RPG.ui && RPG.ui.toast && !r.questDone) RPG.ui.toast('\u2713 ' + C().quest(a.questId).steps[a.step].text.replace(/ \(\{n\}\/\{count\}\)/, ''), '#b8e986');
        autoCheck();
      }
      refresh();
      return true;
    }
    /** Steps already satisfied when they become current (e.g. the sword is already wielded). */
    function autoCheck() {
      var st = step(); if (!st) return;
      if (st.done.type === 'equip') {
        var Eq = S.items().Equipment, l = Eq && Eq.list ? Eq.list() : [];
        var worn = (Array.isArray(l) ? l : Object.keys(l).map(function (k) { return l[k]; })).some(function (it) { return it && (it.base === st.done.target); });
        if (worn) feed({ type: 'equip', target: st.done.target });
      }
    }
    function checkArea() {
      var st = step(); if (!st || st.done.type !== 'enter') return;
      var z = C().ZONES[st.done.target];
      if (!z || !z.rect || z.map !== zoneId()) return;
      var h = hero(), r = z.rect;
      if (h.x >= r.x && h.x < r.x + r.w && h.y >= r.y && h.y < r.y + r.h) feed({ type: 'enter', target: z.id });
    }

    function grantItems(q, bundle, gold) {
      var Inv = S.items().Inventory, h = hero();
      if (!Inv) return { ok: false };
      return Inv.grant({ src: 'quest', ref: q.id, gold: gold || 0, items: bundle || [], overflow: 'ground', x: h.x, y: h.y });
    }
    function accept(q) {
      if (q.onAccept && q.onAccept.items && q.onAccept.items.length) grantItems(q, q.onAccept.items, 0);
      dispatch({ type: 'quests/accept', questId: q.id });
      emit('questAccept', { questId: q.id });
      autoCheck();
      refresh();
    }
    function complete(q) {
      var h = hero(), rw = q.rewards || {};
      grantItems(q, rw.items, rw.gold);
      Object.keys(rw.xp || {}).forEach(function (sk) { S.grant(sk, rw.xp[sk], h.x, h.y); });
      dispatch({ type: 'quests/complete', questId: q.id });
      emit('questDone', { questId: q.id });
      if (RPG.ui && RPG.ui.toast) RPG.ui.toast('Quest complete: ' + q.title, '#ffe08a');
      if (RPG.fx) RPG.fx('levelUp', h.x, h.y);
      refresh();
    }
    /** Rumour screen: 3 lines + the same Loot.preview list as the boss "Can drop" panel (order and colours). */
    function rumourOpts(r) {
      var L = S.items().Loot, drops = r.showDrops && L && L.preview ? L.preview(r.showDrops) : [];
      return { showDrops: r.showDrops || null, // no title: core uses it as the header, which must stay the NPC name
        drops: drops }; // raw Loot.preview entries, as RPG.ui.drawDropRows expects
    }
    function showRumour(id, r) { return ask(id, r.lines.slice(0, 4), [{ id: 'ok', label: 'Okay' }], rumourOpts(r)); }
    function lastRumour() {
      var d = log().done, qs = C().QUESTS || [], r = null;
      for (var i = 0; i < qs.length; i++) if (d[qs[i].id] && qs[i].dialogue && qs[i].dialogue.rumour) r = qs[i].dialogue.rumour;
      return r;
    }

    /** NPC talk. Only quest givers are handled here; core keeps shops and the bank. */
    function talk(npcId) {
      var id = SQ.npcKey(npcId);
      if (!isGiver(id) || talking) return Promise.resolve(null);
      talking = true;
      var done = function (v) { talking = false; refresh(); return v; };
      var q = activeQuest(), st = step();
      if (q && q.giver === id) {
        if (st && st.done.type === 'talk' && st.done.target === id) {
          return ask(id, q.dialogue.complete.lines, q.dialogue.complete.actions).then(function () {
            feed({ type: 'talk', target: id });
            complete(q);
            var r = q.dialogue.rumour;
            return r ? showRumour(id, r) : null;
          }).then(done, done);
        }
        return ask(id, q.dialogue.progress.lines.concat([C().tracker(state().active)]), [{ id: 'ok', label: 'Okay' }]).then(done, done);
      }
      if (q) return Promise.resolve(done(null));   // busy with another giver's quest
      var off = C().offerable(id, log());
      if (off) {
        return ask(id, off.dialogue.offer.lines, off.dialogue.offer.actions).then(function (c) {
          if (c === 'accept') accept(off);
        }).then(done, done);
      }
      var rum = lastRumour(), npc = C().NPCS[id] || { idle: ['...'] };
      return (rum ? showRumour(id, rum) : ask(id, [npc.idle[0]], [{ id: 'ok', label: 'Okay' }])).then(done, done);
    }

    /** Tracker text + arrow point for the next thing to do. */
    function current() {
      var a = state().active, st = step();
      if (a && st) return { text: C().tracker(a), arrowTo: st.arrowTo };
      var givers = Object.keys(C().NPCS || {}).filter(isGiver);
      for (var i = 0; i < givers.length; i++) {
        var off = C().offerable(givers[i], log());
        if (off) return { text: 'Talk to ' + npcName(givers[i]), arrowTo: givers[i], questId: off.id };
      }
      var rum = lastRumour();
      if (rum) return { text: 'Explore the Ash Stair', arrowTo: rum.arrowTo };
      return { text: '', arrowTo: null };
    }
    /** Arrow point for the tracker: kill steps aim at the nearest live target, else the arrowTo marker. */
    function arrowPoint(c) {
      c = c || current();
      var st = state().active ? step() : null;
      if (st && st.done && st.done.type === 'kill') {
        var m = SQ.nearestMob(RPG, st.done.target);
        if (m) return { x: m.x, y: m.y };
      }
      return c.arrowTo ? S.resolvePoint(c.arrowTo) : null;
    }
    function isKillStep() { var st = state().active ? step() : null; return !!(st && st.done && st.done.type === 'kill'); }
    function refresh() {
      var c = current(), p = arrowPoint(c);
      var key = c.text + '|' + (p ? p.x.toFixed(1) + ',' + p.y.toFixed(1) : '-');
      if (key === lastTracker) return c;
      lastTracker = key;
      if (RPG.ui && RPG.ui.tracker) RPG.ui.tracker(c.text, p);
      return c;
    }
    function marker(npcId) { return C().giverMarker(SQ.npcKey(npcId), log()); }
    function wantRecipe() { var st = step(); return st && st.done.type === 'craft' ? st.done.target : null; }
    /** Item base the current quest step wants worn (Q1: 'rustbound_sword'), else null. For core's Wield prompt. */
    function wantKill() { var st = step(); return st && st.done.type === 'kill' ? st.done.target : null; }
    function wantEquip() { var st = step(); return st && st.done.type === 'equip' ? st.done.target : null; }

    /**
     * Would this kill finish the active quest's kill step? Order-proof: the answer is taken
     * from the count *before* this kill, whether quests or drops hears the kill first.
     * Pass the bus payload as `ev` for an exact match (two kills in one frame); without it
     * we fall back to the last kill of that monster this frame.
     */
    var equipT = 0, frame = 0, killMemo = typeof WeakMap === 'function' ? new WeakMap() : null, lastKill = null;
    function finishesKill(id) {
      var a = state().active; if (!a || !id) return false;
      return !!C().advance(a, { type: 'kill', target: id }).stepDone;
    }
    function completesOnKill(id, ev) {
      if (ev && typeof ev === 'object' && killMemo && killMemo.has(ev)) return killMemo.get(ev);
      if (!ev && lastKill && lastKill.id === id && lastKill.frame === frame) return lastKill.v;
      return finishesKill(id);
    }
    function onKill(d) {
      if (!d || !d.monsterId) return;
      var v = finishesKill(d.monsterId);
      if (killMemo && typeof d === 'object') killMemo.set(d, v);
      lastKill = { id: d.monsterId, frame: frame, v: v };
      feed({ type: 'kill', target: d.monsterId });
    }
    /** isDone('q2') or isDone('q2_field'): short ids match the quest whose id starts with 'q2_'. */
    function questId(id) {
      var qs = C().QUESTS || [];
      for (var i = 0; i < qs.length; i++) if (qs[i].id === id) return id;
      for (var j = 0; j < qs.length; j++) if (qs[j].id.indexOf(id + '_') === 0) return qs[j].id;
      return id;
    }
    function isDone(id) { var d = state().done || {}; return !!(id && d[questId(id)]); }
    function update(dt) {
      frame++;
      checkArea();
      equipT -= dt;
      if (equipT <= 0) { equipT = 0.25; autoCheck(); } // equip steps need no bus event: poll what's worn
      refreshT -= dt;
      if (refreshT <= 0) { refreshT = isKillStep() ? SQ.KILL_ARROW_REFRESH_S : SQ.TRACKER_REFRESH_S; refresh(); }
    }

    if (RPG.bus) {
      RPG.bus.on('talk', function (d) { talk(d && d.npcId); });
      RPG.bus.on('gather', function (d) { if (d && d.itemId) feed({ type: 'gather', target: d.itemId }); });
      RPG.bus.on('craft', function (d) { if (d && d.recipeId) feed({ type: 'craft', target: d.recipeId }); });
      RPG.bus.on('kill', onKill);
      RPG.bus.on('enter', function (d) { if (d && d.zone) { feed({ type: 'enter', target: d.zone }); lastTracker = null; } });
      RPG.bus.on('equip', function (d) {
        if (!d) return;
        var base = d.base;
        if (!base) { var Eq = S.items().Equipment, l = Eq && Eq.list ? Eq.list() : null, it = l && d.slot ? l[d.slot] : null; base = it && it.base; }
        feed({ type: 'equip', target: base || d.itemId });
      });
    }
    RPG.registerSystem({ id: 'sq-quests', update: update, draw: function () {} });

    RPG.quests = { state: state, active: function () { return state().active; }, current: current, refresh: refresh, arrowPoint: function () { return arrowPoint(); },
      marker: marker, wantRecipe: wantRecipe, wantEquip: wantEquip, wantKill: wantKill, talk: talk, feed: feed, update: update, completesOnKill: completesOnKill, isDone: isDone, _accept: accept };
    refresh();
    return RPG.quests;
  };

  if (root.RPG && !root.RPG.__sqNoAuto) SQ.installQuests(root.RPG);
  if (typeof module === 'object' && module.exports) module.exports = SQ;
})(typeof window !== 'undefined' ? window : globalThis);
