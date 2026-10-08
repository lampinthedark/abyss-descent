/**
 * RPG.ui: DOM overlays + canvas floats / tracker arrow (core).
 *   toast(text, color?)                 short message at the top
 *   float(x, y, text, color)            rising text at a tile point
 *   dialog(npcId, lines, choices)       -> Promise<choiceId | null>
 *                                         choices: [{id, label}] (or strings); a line is a
 *                                         string or [segment | {text, color}] (coloured names)
 *   tracker(text, arrowTo)              always-on next step; arrowTo = {x, y}
 *                                         tiles, an entity, a list (nearest wins) or null
 *   panel(title, body)                  -> Promise (placeholder windows, e.g. bank)
 * Dialogs and panels sit at the bottom with big tap targets and push the
 * camera up (camera.biasY) so they never cover the hero on 390x844.
 * Arrow and glow colours are warm amber, never blue.
 */
(function (root) {
  'use strict';

  const RPG = (root.RPG = root.RPG || {});
  const doc = root.document;
  const AMBER = '#ffb43c';
  const INK = '#14120f';
  const floats = [];
  let tracker = { text: '', to: null };
  let modal = null; // { el, resolve }

  function el(tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  let layer = null;
  function host() {
    if (layer) return layer;
    layer = el('div', 'rpg-ui');
    doc.body.appendChild(layer);
    return layer;
  }

  function npcName(npcId) {
    const e = RPG.world && RPG.world.get(npcId);
    return (e && e.name) || npcId || '';
  }

  function setBias(px) {
    const cam = RPG.camera;
    if (!cam) return;
    const dpr = root.devicePixelRatio || 1;
    cam.biasY = px > 0 ? (px * dpr) / cam.s : 0;
  }

  function closeModal(value) {
    if (!modal) return;
    const m = modal;
    modal = null;
    m.el.remove();
    setBias(0);
    m.resolve(value === undefined ? null : value);
  }

  function openModal(node) {
    closeModal(null);
    host().appendChild(node);
    return new Promise(function (resolve) {
      modal = { el: node, resolve: resolve };
      // Shift the view up by half the sheet height once it has laid out.
      root.requestAnimationFrame(function () {
        if (!modal || modal.el !== node) return;
        node.classList.add('open');
        setBias(node.getBoundingClientRect().height / 2 + 6);
      });
    });
  }

  /**
   * A dialog line is a string, or an array of segments (strings or
   * {text, color}) so lines can colour item names (e.g. rarity colours).
   */
  function setLine(node, line) {
    node.textContent = '';
    if (!Array.isArray(line)) { node.textContent = line == null ? '' : String(line); return; }
    line.forEach(function (seg) {
      if (seg == null) return;
      if (typeof seg !== 'object') { node.appendChild(doc.createTextNode(String(seg))); return; }
      const sp = el('span', 'rpg-seg', seg.text == null ? '' : String(seg.text));
      if (seg.color) { sp.style.color = seg.color; sp.style.fontWeight = '700'; }
      node.appendChild(sp);
    });
  }

  // ---- drop rows (shared: core stand-in rumour, Skills & Quests, boss panel) ----
  const ROW_H = 38; // px per row at scale 1 (32 px icon + gap)
  const RARITY_COLOR = {
    legendary: '#ff9a2e',
    very_rare: '#c070ff',
    rare: '#5aa0ff',
  };
  const DEFAULT_NAME_COLOR = '#ffffff';
  function rarityKey(r) {
    return String(r || 'normal').toLowerCase().replace(/[\s-]+/g, '_');
  }
  function iconKeyFor(e) {
    const S = root.Sheet;
    const id = e.itemId || e.base || (typeof e.key === 'string' && e.key.indexOf(':') < 0 ? e.key : null);
    const tries = [e.icon, id ? 'icon_' + id : null];
    for (let i = 0; i < tries.length; i++) if (tries[i] && S && S.has(tries[i])) return tries[i];
    return tries[0] || tries[1] || 'icon_unknown';
  }

  const ui = {
    AMBER: AMBER,
    RARITY_COLOR: RARITY_COLOR,

    /**
     * drawDropRows(ctx, x, y, drops, opts?) -> height drawn (ctx px).
     * drops: Loot.preview entries as-is; reads itemId (or base), name, rarity,
     * icon, color. Each row: the 32 px icon (rpg32 sheets; icon, else
     * icon_<itemId>) then the name in entry.color if set, else its rarity
     * colour (legendary #ff9a2e, very rare #c070ff, rare #5aa0ff), else
     * white. Colour is never baked into the art.
     * opts: scale (ctx px per art px, default 1), rowH, maxW, font.
     */
    drawDropRows: function (ctx, x, y, drops, opts) {
      const o = opts || {};
      const s = o.scale || 1;
      const rowH = o.rowH || ROW_H * s;
      const icon = 32 * s;
      const fontPx = Math.round(15 * s);
      const S = root.Sheet;
      const list = (drops || []).filter(Boolean);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = o.font || 'bold ' + fontPx + 'px ui-sans-serif, system-ui, sans-serif';
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const ry = y + i * rowH;
        const iy = Math.round(ry + (rowH - icon) / 2);
        if (S && S.draw) S.draw(ctx, iconKeyFor(e), Math.round(x), iy, s, 0);
        const color = e.color || RARITY_COLOR[rarityKey(e.rarity)] || DEFAULT_NAME_COLOR;
        const tx = x + icon + 10 * s;
        const label = String(e.name || e.itemId || e.base || '?');
        ctx.lineWidth = Math.max(2, 3 * s);
        ctx.strokeStyle = INK;
        ctx.lineJoin = 'round';
        ctx.strokeText(label, tx, ry + rowH / 2, o.maxW ? o.maxW - (tx - x) : undefined);
        ctx.fillStyle = color;
        ctx.fillText(label, tx, ry + rowH / 2, o.maxW ? o.maxW - (tx - x) : undefined);
      }
      ctx.restore();
      return list.length * rowH;
    },

    toast: function (text, color) {
      const t = el('div', 'rpg-toast', text);
      if (color) t.style.color = color;
      host().appendChild(t);
      setTimeout(function () { t.classList.add('out'); }, 1600);
      setTimeout(function () { t.remove(); }, 2100);
      return t;
    },

    float: function (x, y, text, color) {
      floats.push({ x: x, y: y, text: String(text), color: color || '#f4efe0', t0: performance.now() });
      if (floats.length > 40) floats.shift();
    },

    /**
     * dialog(npcId, lines, choices, opts) -> Promise<choiceId | null>
     *   opts.title  header text (default: the NPC's name)
     *   opts.drops  Loot.preview-style entries drawn under the last line with
     *               drawDropRows (32 px icon + name in its rarity colour)
     */
    dialog: function (npcId, lines, choices, dialogOpts) {
      const o2 = dialogOpts || {};
      const list = (Array.isArray(lines) ? lines : [lines]).filter(function (l) { return l != null && l !== ''; });
      const opts = (choices || []).map(function (c) { return typeof c === 'string' ? { id: c, label: c } : c; });
      const box = el('div', 'rpg-sheet rpg-dialog');
      box.setAttribute('role', 'dialog');
      box.dataset.npc = npcId || '';
      const name = el('div', 'rpg-name', o2.title != null ? String(o2.title) : npcName(npcId));
      const text = el('div', 'rpg-text');
      const btns = el('div', 'rpg-btns');
      box.appendChild(name);
      box.appendChild(text);
      const drops = Array.isArray(o2.drops) ? o2.drops.filter(Boolean) : [];
      let dropCanvas = null;
      if (drops.length) {
        dropCanvas = el('canvas', 'rpg-drops');
        dropCanvas.style.width = '100%';
        dropCanvas.style.height = drops.length * ROW_H + 'px';
        dropCanvas.style.display = 'none';
        box.appendChild(dropCanvas);
      }
      box.appendChild(btns);
      function paintDrops() {
        if (!dropCanvas) return;
        const dpr = Math.max(1, Math.min(4, root.devicePixelRatio || 1));
        const cssW = dropCanvas.clientWidth || 300;
        const cssH = drops.length * ROW_H;
        dropCanvas.width = Math.round(cssW * dpr);
        dropCanvas.height = Math.round(cssH * dpr);
        const c = dropCanvas.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.imageSmoothingEnabled = false;
        c.clearRect(0, 0, cssW, cssH);
        ui.drawDropRows(c, 0, 0, drops, { scale: 1, rowH: ROW_H, maxW: cssW });
      }
      let i = 0;
      function render() {
        setLine(text, list[i]);
        btns.textContent = '';
        const last = i >= list.length - 1;
        if (dropCanvas) {
          dropCanvas.style.display = last ? 'block' : 'none';
          if (last) root.requestAnimationFrame(paintDrops);
        }
        if (!last) {
          const n = el('button', 'rpg-btn', 'Next');
          n.type = 'button';
          n.dataset.choice = 'next';
          n.addEventListener('click', function (e) { e.stopPropagation(); i++; render(); });
          btns.appendChild(n);
          return;
        }
        if (!opts.length) {
          const c = el('button', 'rpg-btn', 'Close');
          c.type = 'button';
          c.dataset.choice = 'close';
          c.addEventListener('click', function (e) { e.stopPropagation(); closeModal(null); });
          btns.appendChild(c);
          return;
        }
        opts.forEach(function (o, k) {
          const b = el('button', 'rpg-btn' + (k === 0 ? ' primary' : ''), o.label);
          b.type = 'button';
          b.dataset.choice = o.id;
          b.addEventListener('click', function (e) { e.stopPropagation(); closeModal(o.id); });
          btns.appendChild(b);
        });
      }
      text.addEventListener('click', function () { if (i < list.length - 1) { i++; render(); } });
      render();
      return openModal(box);
    },

    panel: function (title, body) {
      const box = el('div', 'rpg-sheet rpg-panel');
      box.setAttribute('role', 'dialog');
      box.appendChild(el('div', 'rpg-name', title));
      box.appendChild(el('div', 'rpg-text', body));
      const btns = el('div', 'rpg-btns');
      const c = el('button', 'rpg-btn primary', 'Close');
      c.type = 'button';
      c.dataset.choice = 'close';
      c.addEventListener('click', function (e) { e.stopPropagation(); closeModal(null); });
      btns.appendChild(c);
      box.appendChild(btns);
      return openModal(box);
    },

    /** True while a dialog / panel is open. */
    isOpen: function () {
      return !!modal;
    },

    /** Close any open dialog / panel (resolves it with null). */
    close: function () {
      closeModal(null);
    },

    tracker: function (text, arrowTo) {
      tracker = { text: text || '', to: arrowTo || null };
      let t = doc.getElementById('quest-tip');
      if (!t) {
        t = el('div', '');
        t.id = 'quest-tip';
        host().appendChild(t);
      }
      t.textContent = tracker.text;
      t.hidden = !tracker.text;
      return tracker;
    },

    trackerState: function () {
      return tracker;
    },
  };

  function arrowTarget() {
    const to = tracker.to;
    if (!to) return null;
    const list = Array.isArray(to) ? to : [to];
    const h = RPG.hero;
    let best = null;
    let bd = Infinity;
    list.forEach(function (p) {
      if (!p || typeof p.x !== 'number') return;
      const d = h ? Math.hypot(p.x - h.x, p.y - h.y) : 0;
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  }

  function drawArrow(ctx, x, y, ang, s, scale) {
    const k = s * scale;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-5 * k, -6 * k);
    ctx.lineTo(-2 * k, -6 * k);
    ctx.lineTo(-2 * k, -12 * k);
    ctx.lineTo(2 * k, -12 * k);
    ctx.lineTo(2 * k, -6 * k);
    ctx.lineTo(5 * k, -6 * k);
    ctx.closePath();
    ctx.fillStyle = AMBER;
    ctx.fill();
    ctx.lineWidth = Math.max(2, k);
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }

  // Canvas part of the UI: floats and the tracker arrow, on the 'ui' layer.
  RPG.registerSystem({
    id: 'core-ui',
    update: function () {},
    draw: function (ctx, cam, layerName) {
      if (layerName !== 'ui') return;
      const s = cam.zoom;
      const now = performance.now();
      // Floats.
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        const age = (now - f.t0) / 900;
        if (age >= 1) { floats.splice(i, 1); continue; }
        const p = cam.toScreen(f.x, f.y);
        ctx.globalAlpha = 1 - age * age;
        ctx.font = 'bold ' + Math.round(7 * s) + 'px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(2, Math.round(s * 0.9));
        ctx.strokeStyle = INK;
        ctx.fillStyle = f.color;
        const y = p.y - age * 14 * s - 30 * s;
        ctx.strokeText(f.text, p.x, y);
        ctx.fillText(f.text, p.x, y);
      }
      ctx.globalAlpha = 1;
      // Tracker arrow.
      const tgt = arrowTarget();
      if (!tgt) return;
      const p = cam.toScreen(tgt.x, tgt.y);
      const m = 28 * (root.devicePixelRatio || 1);
      const reduced = RPG.renderer && RPG.renderer.reduced;
      const bob = reduced ? 0 : Math.round((Math.sin(now / 220) * 0.5 + 0.5) * 3) * s;
      const topY = p.y - 30 * s;
      if (p.x > m && p.x < cam.w - m && topY > m && p.y < cam.h - m) {
        drawArrow(ctx, p.x, topY - bob, 0, s, 0.9);
      } else {
        const cx = cam.w / 2;
        const cy = cam.h / 2;
        const ang = Math.atan2(p.y - cy, p.x - cx);
        const ex = Math.max(m, Math.min(cam.w - m, p.x));
        const ey = Math.max(m * 2.5, Math.min(cam.h - m, p.y));
        drawArrow(ctx, ex, ey, ang - Math.PI / 2, s, 1);
      }
    },
  });

  RPG.ui = ui;
})(typeof window !== 'undefined' ? window : globalThis);
