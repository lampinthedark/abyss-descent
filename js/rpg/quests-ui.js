/**
 * Skills & Quests: in-world quest markers. Draws a bobbing '!' (offerable) or
 * '?' (ready to hand in) above quest-giver NPCs on the 'ui' layer.
 * Screen mapping: cam.toScreen(x, y) / cam.worldToScreen(x, y) if core has it,
 * else (x - cam.x) * TILE_W * scale, (y - cam.y) * TILE_H * scale.
 */
(function (root) {
  'use strict';
  var SQ = root.RPGSQ = root.RPGSQ || {};
  SQ.TILE_W = 32; SQ.TILE_H = 18;
  SQ.MARK_COLOR = { '!': '#ffd23f', '?': '#9fd8ff' };

  SQ.toScreen = function (cam, x, y) {
    if (cam && typeof cam.toScreen === 'function') return cam.toScreen(x, y);
    if (cam && typeof cam.worldToScreen === 'function') return cam.worldToScreen(x, y);
    var s = (cam && (cam.scale || cam.zoom)) || 1;
    return { x: (x - ((cam && cam.x) || 0)) * SQ.TILE_W * s, y: (y - ((cam && cam.y) || 0)) * SQ.TILE_H * s, scale: s };
  };

  SQ.installQuestsUi = function (RPG) {
    var t = 0;
    function npcs() {
      var h = RPG.hero || { x: 0, y: 0 };
      return (RPG.world && RPG.world.near ? RPG.world.near(h.x, h.y, 999, 'npc') : []) || [];
    }
    function idOf(e) { return SQ.npcKey(e.npcId || (e.sprite && String(e.sprite).indexOf('npc_') === 0 ? e.sprite : e.id)); }
    function draw(ctx, cam, layer) {
      if (layer !== 'ui' || !RPG.quests || !ctx) return;
      var list = npcs();
      for (var i = 0; i < list.length; i++) {
        var m = RPG.quests.marker(idOf(list[i]));
        if (!m) continue;
        var p = SQ.toScreen(cam, list[i].x, list[i].y), s = p.scale || (cam && (cam.scale || cam.zoom)) || 1;
        var y = p.y - (2.6 * SQ.TILE_H + Math.sin(t * 4) * 2) * s;
        ctx.save();
        ctx.font = 'bold ' + Math.round(16 * s) + 'px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = Math.max(2, 3 * s); ctx.strokeStyle = '#14120f';
        ctx.strokeText(m, p.x, y);
        ctx.fillStyle = SQ.MARK_COLOR[m] || '#fff';
        ctx.fillText(m, p.x, y);
        ctx.restore();
      }
    }
    RPG.registerSystem({ id: 'sq-quests-ui', update: function (dt) { t += dt; }, draw: draw });
    return { draw: draw };
  };

  if (root.RPG && !root.RPG.__sqNoAuto) SQ.installQuestsUi(root.RPG);
  if (typeof module === 'object' && module.exports) module.exports = SQ;
})(typeof window !== 'undefined' ? window : globalThis);
