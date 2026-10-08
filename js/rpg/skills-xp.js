/**
 * Skills & Quests: shared helpers + XP for the 5 gathering/crafting skills.
 * Owner: Gameplay Dev - Skills & Quests. Plugs into core only via window.RPG
 * (docs/rpg-core-hooks.md). Load order: core, RPGItems, RPGContent, then
 * skills-xp, skills-gather, skills-craft, quests-runtime, quests-ui, main.
 *
 * Installs RPG.skills = { SKILLS, grant, levels, level, rng, items, content, resolvePoint }.
 * Core grants NO XP for Crafting/gather results: these files call RPG.stats.addXp.
 */
(function (root) {
  'use strict';
  var SQ = root.RPGSQ = root.RPGSQ || {};

  SQ.SKILLS = ['mining', 'smithing', 'woodcutting', 'fishing', 'cooking'];
  SQ.ALL_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'mining', 'smithing', 'woodcutting', 'fishing', 'cooking'];
  SQ.LABEL = { mining: 'Mining', smithing: 'Smithing', woodcutting: 'Woodcutting', fishing: 'Fishing', cooking: 'Cooking',
    attack: 'Attack', strength: 'Strength', defence: 'Defence', hitpoints: 'Hitpoints' };
  SQ.XP_COLOR = '#9fd8ff';
  SQ.LEVEL_COLOR = '#ffe08a';

  /** PLAN.md curve: total XP to reach level L = floor(sum_{l<L} floor(l + 300*2^(l/7)) / 4), cap 99. */
  var TABLE = [0, 0];
  (function () { var pts = 0; for (var l = 1; l < 99; l++) { pts += Math.floor(l + 300 * Math.pow(2, l / 7)); TABLE[l + 1] = Math.floor(pts / 4); } })();
  SQ.xpForLevel = function (L) { return TABLE[Math.max(1, Math.min(99, L | 0))]; };
  SQ.levelForXp = function (xp) { var L = 1; while (L < 99 && xp >= TABLE[L + 1]) L++; return L; };

  SQ.install = function (RPG) {
    var items = function () { return RPG.items || root; };                 // Crafting, Inventory, Equipment globals
    var content = function () { return RPG.content || root.RPGContent; };

    function rng() {
      var r = RPG.rng ? RPG.rng('skill') : null;
      if (typeof r === 'function') return r();
      if (r && typeof r.next === 'function') return r.next();
      if (r && typeof r.float === 'function') return r.float();
      return 0.5; // deterministic fallback; never Math.random
    }
    function level(skill) { return (RPG.stats && RPG.stats.level) ? (RPG.stats.level(skill) || 1) : 1; }
    function levels() { var o = {}; SQ.ALL_SKILLS.forEach(function (s) { o[s] = level(s); }); return o; }

    /** Grant XP through core stats; float "+N Skill" at (x,y) and toast on level-up. */
    function grant(skill, xp, x, y) {
      if (!skill || !(xp > 0) || !RPG.stats || !RPG.stats.addXp) return { levelled: false };
      var before = level(skill);
      RPG.stats.addXp(skill, xp);
      var after = level(skill);
      var ui = RPG.ui || {};
      if (ui.float && x != null) ui.float(x, y - 0.6, '+' + Math.round(xp) + ' ' + SQ.LABEL[skill], SQ.XP_COLOR);
      if (after > before) {
        if (ui.toast) ui.toast(SQ.LABEL[skill] + ' level ' + after + '!', SQ.LEVEL_COLOR);
        if (RPG.fx) RPG.fx('levelUp', RPG.hero ? RPG.hero.x : x, RPG.hero ? RPG.hero.y : y);
        if (RPG.bus) RPG.bus.emit('levelUp', { skill: skill, level: after });
      }
      return { levelled: after > before, level: after };
    }

    /** arrowTo (npc id | node key | prop key | zone id) -> {x, y} in the current zone, or null. */
    function resolvePoint(key) {
      if (!key) return null;
      var C = content() || {};
      var zone = RPG.world && RPG.world.zone, zid = zone && (zone.id || zone);
      if (RPG.skills && RPG.skills.pointFor) { var p = RPG.skills.pointFor(key); if (p) return p; }
      if (C.NPCS && C.NPCS[key] && RPG.world && RPG.world.near) {
        var hero = RPG.hero || { x: 0, y: 0 };
        var npcs = RPG.world.near(hero.x, hero.y, 999, 'npc') || [];
        for (var i = 0; i < npcs.length; i++) if (npcs[i].npcId === key || npcs[i].npcId === 'npc_' + key || npcs[i].sprite === C.NPCS[key].key) return { x: npcs[i].x, y: npcs[i].y };
      }
      if (C.ZONES && C.ZONES[key]) {
        var z = C.ZONES[key];
        if (z.anchor && (!zid || z.map === zid)) return { x: z.anchor.x, y: z.anchor.y };
        if (z.kind === 'map' && zid === 'town' && C.ZONES[key + '_gate']) return C.ZONES[key + '_gate'].anchor;
      }
      if (C.TOWN_POINTS && C.TOWN_POINTS[key] && (!zid || zid === 'town')) return { x: C.TOWN_POINTS[key].x, y: C.TOWN_POINTS[key].y };
      return null;
    }

    RPG.skills = RPG.skills || {};
    RPG.skills.SKILLS = SQ.SKILLS;
    RPG.skills.grant = grant;
    RPG.skills.level = level;
    // Works whether core passes RPG.skills.levels or RPG.skills.levels(): the function also
    // carries live getters (levels.mining === level('mining')) for createWorld's getLevels.
    SQ.ALL_SKILLS.forEach(function (sk) { Object.defineProperty(levels, sk, { get: function () { return level(sk); }, enumerable: true, configurable: true }); });
    RPG.skills.levels = levels;
    RPG.skills.rng = rng;
    RPG.skills.items = items;
    RPG.skills.content = content;
    RPG.skills.resolvePoint = resolvePoint;
    return RPG.skills;
  };

  /** Helpers shared by the other S&Q files. */
  SQ.dist = function (a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); };
  SQ.npcKey = function (id) { return id && String(id).indexOf('npc_') === 0 ? String(id).slice(4) : id; };

  if (root.RPG && !root.RPG.__sqNoAuto) SQ.install(root.RPG);
  if (typeof module === 'object' && module.exports) module.exports = SQ;
})(typeof window !== 'undefined' ? window : globalThis);
