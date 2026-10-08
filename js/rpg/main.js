/**
 * RPG boot + loop (core, loaded LAST, after core and owners' files).
 *
 * Boot: sheets manifest -> town zone -> core placeholders (only where the
 * owning module is absent) -> Store/Save boot -> hero -> first 'enter'.
 * Loop: systems update(dt) + 'tick' {dt}, hero.update, camera follow,
 * renderer.frame (layers in render.js), FX update.
 *
 * Core placeholders (each switches itself off when the real module exists):
 *   - quest slice 'coreQuestStub' + tracker + NPC talk lines: only if RPG.quests is absent
 *   - node / station sprites + taps from zone.markers: only while RPG.skills is absent
 *     (render.js 'core-marker-placeholders' + tappable 'core-markers')
 *   - field mobs from zone.spawns + wander: only if (!RPG.ai) (and no 'ai-monsters' system)
 *   - respawn after death: only if no 'death-recap' system (hero.js); no recap UI in core
 * Core never grants XP from crafting; skill files call RPG.stats.addXp.
 */
(function (root) {
  'use strict';

  const RPG = root.RPG;
  const Store = root.Store;
  const World = RPG.world;
  const TW = World.TILE_W;
  const TH = World.TILE_H;
  const params = new URLSearchParams(root.location ? root.location.search : '');
  const BENCH = params.get('bench') === '1';
  const GRADE = params.get('grade') !== '0'; // ?grade=0 turns the warm grade off
  const ALIVE = params.get('alive') !== '0'; // ?alive=0 turns the alive layer off (bench A/B)

  const canvas = document.getElementById('rpg');
  const camera = new root.RpgCamera.Camera();
  RPG.camera = camera;
  const renderer = new root.RpgRender.Renderer(canvas, World, camera);
  RPG.renderer = renderer;
  const input = new root.RpgInput.Input(canvas, camera);
  RPG.input = input;
  const hero = RPG.hero;

  // FX draws inside the 'fx' layer (before 'ui'), in our camera.
  RPG.fxDraw = function (ctx, ox, oy, s) { root.RpgFx.draw(ctx, ox, oy, s); };

  World.loadZone(World.TOWN);
  const debugEvents = [];
  ['enter', 'talk', 'hurt', 'death'].forEach(function (evt) {
    RPG.bus.on(evt, function (d) { debugEvents.push({ evt: evt, data: d }); if (debugEvents.length > 50) debugEvents.shift(); });
  });

  // ---- core tappables (placeholders; owners' tappables win ties) -------------
  RPG.registerTappable({
    id: 'core-entities',
    core: true,
    range: 1.5,
    hit: function (tx, ty) {
      const e = World.pick(tx, ty, ['npc', 'mob']);
      return e;
    },
    onArrive: function (e) {
      if (e.kind === 'npc') {
        e.flip = hero.x > e.x; // turn to the hero
        RPG.bus.emit('talk', { npcId: e.id });
      } else if (e.kind === 'mob' && e.corePlaceholder) {
        RPG.ui.toast(e.name + ': combat arrives in D3');
      }
    },
  });

  const NODE_WORDS = { ore: 'Mining', tree: 'Woodcutting', fish: 'Fishing' };
  const STATION_WORDS = { furnace: 'Smelting', anvil: 'Smithing', range: 'Cooking', fire: 'Cooking' };
  RPG.registerTappable({
    id: 'core-markers',
    core: true,
    range: 1.5,
    hit: function (tx, ty) {
      if (RPG.skills) return null;
      const ax = tx * TW;
      const ay = ty * TH;
      let best = null;
      renderer.markerObjs.forEach(function (o) {
        const onTile = Math.floor(o.x) === Math.floor(tx) && Math.floor(o.y) === Math.floor(ty);
        const inRect = o.w && ax >= o.ax && ax < o.ax + o.w && ay >= o.ay && ay < o.ay + o.h;
        if ((onTile || inRect) && (!best || o.foot > best.foot)) best = o;
      });
      return best;
    },
    onArrive: function (o) {
      if (RPG.skills) return;
      const word = o.kind === 'node' ? NODE_WORDS[o.node] : STATION_WORDS[o.station];
      RPG.ui.toast((word || 'This') + ' arrives in D4');
    },
  });

  // ---- placeholder field mobs (until ai-monsters) ---------------------------
  const MOB_SPEED = 0.9; // tiles per second
  let mobSeq = 0;
  // True if tile (cx,cy) is at least r from every keepOut rect (zone.keepOut).
  // Dungeon & Bosses' AI should honour the same list when it takes over.
  function clearOfKeepOut(cx, cy) {
    const ko = World.zone.keepOut || [];
    for (let i = 0; i < ko.length; i++) {
      const k = ko[i];
      const dx = Math.max(k.x0 - cx, 0, cx - k.x1);
      const dy = Math.max(k.y0 - cy, 0, cy - k.y1);
      if (Math.hypot(dx, dy) < k.r) return false;
    }
    return true;
  }
  function inArea(a, cx, cy) { return !a || (cx >= a.x0 && cx <= a.x1 && cy >= a.y0 && cy <= a.y1); }
  World.clearOfKeepOut = clearOfKeepOut;
  function coreMobs() {
    return !RPG.ai && !RPG.hasSystem('ai-monsters'); // Dungeon & Bosses (RPG.ai.spawnPack) takes over
  }
  RPG.bus.on('enter', function (ev) {
    if (!coreMobs()) return;
    const rng = RPG.rng('ai');
    (World.zone.spawns || []).forEach(function (sp) {
      const def = World.MOBS[sp.monsterId];
      if (!def) return;
      for (let k = 0; k < (sp.n || 1); k++) {
        let x = sp.x;
        let y = sp.y;
        for (let tries = 0; tries < 12; tries++) {
          const cx = sp.x + Math.floor(rng() * 5) - 2;
          const cy = sp.y + Math.floor(rng() * 3) - 1;
          if (World.walkable(cx, cy) && clearOfKeepOut(cx, cy) && inArea(sp.area, cx, cy)) { x = cx; y = cy; break; }
        }
        World.addEntity({
          id: 'mob_' + sp.monsterId + '_' + (++mobSeq),
          kind: 'mob', monsterId: sp.monsterId, name: def.name, corePlaceholder: true,
          x: x + 0.5, y: y + 0.5, homeX: sp.x + 0.5, homeY: sp.y + 0.5, leash: sp.leash || 4, area: sp.area || null,
          sprite: def.idle, anim: 360, frame: 0, flip: false, seed: 700 + mobSeq,
          hp: def.hp, maxHp: def.hp, wait: rng() * 2, path: [],
          takeHit: function () { return { dead: false }; }, // D3 (ai-monsters) replaces these
        });
      }
    });
  });

  RPG.registerSystem({
    id: 'core-mob-wander',
    update: function (dt) {
      if (!coreMobs()) return;
      const rng = RPG.rng('ai');
      World.forEach(function (e) {
        if (!e.corePlaceholder || e.kind !== 'mob') return;
        const def = World.MOBS[e.monsterId];
        if (!e.path.length) {
          e.wait -= dt;
          if (e.sprite !== def.idle) { e.sprite = def.idle; e.anim = 360; }
          if (e.wait > 0) return;
          e.wait = 1.5 + rng() * 3;
          const gx = Math.floor(e.homeX + (rng() * 2 - 1) * e.leash);
          const gy = Math.floor(e.homeY + (rng() * 2 - 1) * e.leash * 0.6);
          if (!World.walkable(gx, gy) || !clearOfKeepOut(gx, gy) || !inArea(e.area, gx, gy)) return;
          const cells = World.path({ x: e.x, y: e.y }, { x: gx, y: gy });
          const bad = cells.findIndex(function (c) { return !clearOfKeepOut(c.x, c.y) || !inArea(e.area, c.x, c.y); });
          e.path = (bad < 0 ? cells : cells.slice(0, bad)).slice(0, 6).map(function (c) { return { x: c.x + 0.5, y: c.y + 0.5 }; });
          return;
        }
        if (e.sprite !== def.walk) { e.sprite = def.walk; e.anim = 150; }
        const wp = e.path[0];
        const dx = wp.x - e.x;
        const dy = wp.y - e.y;
        const d = Math.hypot(dx, dy);
        const stepD = MOB_SPEED * dt;
        if (Math.abs(dx) > 0.02) e.flip = dx > 0; // frames face left
        if (d <= stepD) { e.x = wp.x; e.y = wp.y; e.path.shift(); } else { e.x += (dx / d) * stepD; e.y += (dy / d) * stepD; }
      });
    },
  });

  // ---- placeholder quest slice + tracker + talk (until RPG.quests) -----------
  const QUEST_STEPS = [
    { text: 'Talk to Warden Ilse', to: 'npc_questgiver' },
    { text: 'Visit Banker Maud', to: 'npc_banker' },
    { text: 'Take the south road to the stairs', to: 'exit' },
    { text: '', to: null },
  ];
  let questStub = false;
  function setupQuestStub() {
    if (RPG.quests) return;
    questStub = true;
    Store.register('coreQuestStub', function (st, a) {
      if (a.type !== 'coreQuestStub/advance') return st;
      return a.step > st.step ? { step: Math.min(a.step, QUEST_STEPS.length - 1) } : st;
    }, { step: 0 });
  }
  function questStep() {
    const st = Store.getState().coreQuestStub;
    return st ? st.step : 0;
  }
  function advance(to) {
    if (questStep() < to) Store.dispatch({ type: 'coreQuestStub/advance', step: to });
    refreshTracker();
  }
  function refreshTracker() {
    if (!questStub || RPG.quests) return;
    const s = QUEST_STEPS[questStep()];
    const ex = World.zone.exit;
    const to = s.to === 'exit' ? (ex ? { x: ex.x + 0.5, y: ex.y + 0.5 } : null) : s.to ? World.get(s.to) : null;
    RPG.ui.tracker(s.text, to);
  }
  // Locked stand-in colours: Wyrmfang #ff9a2e, Gravewarden's Crown #c070ff,
  // Wyrmscale armour #c070ff, Wyrm Scale #e8c84a (this order).
  // Ashmaw chase drops for core's stand-in rumour (only while RPG.quests is
  // missing; Skills & Quests owns the questgiver dialog otherwise). Same order
  // and rarity colours as the boss 'Can drop' panel. Uses the real
  // Loot.preview('ashmaw') entries as-is when Loot is loaded; the hard-coded
  // entries cover D1 (items stub) and anything the preview omits (Wyrm Scale
  // is a material, not a preview row). Drawn by RPG.ui.drawDropRows.
  const CHASE = [
    { entry: { itemId: 'wyrmfang', name: 'Wyrmfang', rarity: 'legendary', icon: 'icon_wyrmfang', color: '#ff9a2e' },
      match: function (e) { return e.base === 'wyrmfang' || e.itemId === 'wyrmfang'; } },
    { entry: { itemId: 'gravewarden_crown', name: "Gravewarden's Crown", rarity: 'legendary', icon: 'icon_gravewarden_crown', color: '#c070ff' },
      match: function (e) { return e.base === 'gravewarden_crown' || e.itemId === 'gravewarden_crown'; } },
    { entry: { itemId: 'wyrm_cuirass', name: 'Wyrmscale armour', rarity: 'very_rare', icon: 'icon_wyrm_cuirass', color: '#c070ff' },
      match: function (e) { return e.kind === 'gear' && /^gear:wyrm:/.test(e.key || ''); } },
    { entry: { itemId: 'wyrm_scale', name: 'Wyrm Scale', rarity: 'material', icon: 'icon_wyrm_scale', color: '#e8c84a' },
      match: function (e) { return e.base === 'wyrm_scale' || e.itemId === 'wyrm_scale'; } },
  ];
  function chaseDrops() {
    let preview = [];
    try {
      // eslint-disable-next-line no-undef
      const L = typeof Loot !== 'undefined' ? Loot : root.Loot;
      if (L && !L.__stub && typeof L.preview === 'function') preview = L.preview('ashmaw') || [];
    } catch (e) { preview = []; }
    return CHASE.map(function (c) {
      const hit = preview.find(function (e) { return e && e.source !== 'shared' && c.match(e); });
      return hit || Object.assign({ standIn: true }, c.entry);
    });
  }
  function openRumour(npcId) {
    return RPG.ui.dialog(npcId, ['They say Ashmaw, down the Ash Stair, can drop:'], [{ id: 'ok', label: 'Okay' }],
      { title: 'Rumours', drops: chaseDrops() });
  }
  RPG.debugChaseDrops = chaseDrops;

  const LINES = {
    npc_questgiver: ['Welcome, traveller. The stair south of town leads down into the deep.', 'Leave your valuables with Maud at the bank before you go.'],
    npc_banker: ['Your vault opens once the item ledgers arrive.', 'Come back soon.'],
    npc_shopkeep: ['Stock is still on the cart. Check back later.'],
    npc_smith: ['Bring me ore from the mine east of the square and I will show you the hammer.'],
  };
  RPG.bus.on('talk', function (ev) {
    if (RPG.quests || !questStub) return; // Skills & Quests owns dialogue
    const id = ev && ev.npcId;
    const step = questStep();
    const choices = id === 'npc_questgiver'
      ? [{ id: 'ok', label: 'Okay' }, { id: 'rumours', label: 'Ask about rumours' }]
      : [{ id: 'ok', label: 'Okay' }];
    RPG.ui.dialog(id, LINES[id] || ['...'], choices).then(function (choice) {
      if (id === 'npc_questgiver' && step === 0) advance(1);
      else if (id === 'npc_banker' && step === 1) advance(2);
      if (choice === 'rumours') openRumour(id);
    });
  });
  RPG.registerSystem({
    id: 'core-quest-stub',
    update: function () {
      if (!questStub || RPG.quests || questStep() !== 2) return;
      const ex = World.zone.exit;
      if (ex && Math.floor(hero.x) === ex.x && Math.floor(hero.y) === ex.y) {
        advance(3);
        RPG.ui.toast('The stair down opens with the dungeon (D5)');
      }
    },
  });

  // Save the live tile on hidden / pagehide / app pause even mid-walk.
  root.Save.onBeforeFlush = function () {
    const t = hero.tile();
    Store.dispatch({ type: 'hero/checkpoint', zone: World.zoneId(), x: t.x, y: t.y });
  };

  // ---- bench overlay ----------------------------------------------------------
  const benchEl = BENCH ? document.getElementById('bench') : null;
  if (benchEl) benchEl.hidden = false;
  const bench = { frames: 0, acc: 0, work: 0, worst: 0, alive: 0, sys: 0, fps: 0, ms: 0, workMs: 0, worstMs: 0, aliveMs: 0, systemsMs: 0 };

  function benchTick(dtMs, workMs) {
    bench.frames++;
    bench.acc += dtMs;
    bench.work += workMs;
    bench.worst = Math.max(bench.worst, dtMs);
    bench.alive += renderer.stats.aliveMs;
    bench.sys += renderer.stats.systemsMs;
    if (bench.acc < 500) return;
    bench.aliveMs = bench.alive / bench.frames;
    bench.systemsMs = bench.sys / bench.frames;
    bench.fps = (bench.frames * 1000) / bench.acc;
    bench.ms = bench.acc / bench.frames;
    bench.workMs = bench.work / bench.frames;
    bench.worstMs = bench.worst;
    if (benchEl) {
      benchEl.textContent = bench.fps.toFixed(0) + ' fps  ' + bench.ms.toFixed(1) + ' ms  work ' +
        bench.workMs.toFixed(2) + ' ms  worst ' + bench.worstMs.toFixed(0) + ' ms\n' +
        'alive ' + bench.aliveMs.toFixed(2) + ' ms  systems ' + bench.systemsMs.toFixed(2) + ' ms  parts ' + renderer.stats.parts +
        (renderer.reduced ? '  reduced-motion' : '') + (GRADE ? '' : '  grade off') + (ALIVE ? '' : '  alive off') + '\n' +
        canvas.width + 'x' + canvas.height + ' @' + renderer.dpr + '  s' + renderer.s + '  draws ' + renderer.stats.draws;
    }
    bench.frames = 0;
    bench.acc = 0;
    bench.work = 0;
    bench.worst = 0;
    bench.alive = 0;
    bench.sys = 0;
  }

  // ---- loop -------------------------------------------------------------------
  let last = 0;
  let running = false;
  function updateSystems(dt) {
    const list = RPG.systems;
    for (let i = 0; i < list.length; i++) {
      const sys = list[i];
      if (typeof sys.update !== 'function') continue;
      try { sys.update(dt); } catch (e) {
        if (!sys._uwarned) { sys._uwarned = true; if (root.console) console.error('[system ' + sys.id + ' update]', e); }
      }
    }
    RPG.bus.emit('tick', { dt: dt });
  }

  function syncHeroPx() {
    hero.ax = hero.x * TW;
    hero.ay = hero.y * TH + 5; // foot row
  }

  function frame(now) {
    if (!running) return;
    const dtMs = last ? Math.min(100, now - last) : 16.7;
    last = now;
    const w0 = performance.now();
    const dt = dtMs / 1000;
    hero.update(dt);
    updateSystems(dt);
    syncHeroPx();
    camera.follow(hero.ax, hero.ay - 10, World.pixelW, World.pixelH, dt, false);
    root.RpgFx.update(dt);
    renderer.frame(now, hero, input.marker);
    benchTick(dtMs, performance.now() - w0);
    root.requestAnimationFrame(frame);
  }

  function onResize() {
    renderer.resize();
    syncHeroPx();
    camera.follow(hero.ax, hero.ay - 10, World.pixelW, World.pixelH, 0, true);
  }

  function start(sheetInfo) {
    renderer.alive = ALIVE;
    setupQuestStub(); // before boot so the slice hydrates from the save
    Store.boot();
    RPG.bootItems(); // no-op until js/rpg/items/*.js is on the page
    hero.load();
    renderer.resize();
    renderer.build();
    RPG.bus.on('zone:loaded', function () { renderer.build(); });
    syncHeroPx();
    camera.follow(hero.ax, hero.ay - 10, World.pixelW, World.pixelH, 0, true);
    root.addEventListener('resize', onResize);
    root.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });
    if (root.visualViewport) root.visualViewport.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', function () { last = 0; }); // no giant dt after a hidden tab
    World.enterOnce(); // bus 'enter' {zone: 'town'}, once
    refreshTracker();
    running = true;
    root.requestAnimationFrame(frame);
    root.RpgDebug.sheet = sheetInfo;
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
  }

  // Test / debug surface (read-mostly).
  root.RpgDebug = {
    hero: function () {
      return { x: hero.x, y: hero.y, hp: hero.hp, maxHp: hero.maxHp, moving: hero.moving, facing: hero.facing, dist: hero.dist, path: hero.path.slice(), tile: hero.tile() };
    },
    renderer: renderer,
    camera: camera,
    input: input,
    events: function () { return debugEvents.slice(); },
    questStub: function () { return questStub ? questStep() : null; },
    screenOfTile: function (tx, ty) {
      const p = camera.toScreen(tx + 0.5, ty + 0.5);
      return { x: p.x / renderer.dpr, y: p.y / renderer.dpr }; // CSS px
    },
    bench: bench,
  };

  // Data-driven: assets/rpg/sheets.json lists the sheets (later sheets win key clashes).
  root.Sheet.loadManifest('assets/rpg/sheets.json?v=d1', { grade: GRADE }).then(start, function (err) {
    // A missing manifest keeps the game up with placeholder boxes.
    start({ keys: 0, errors: [String((err && err.message) || err)] });
  });
})(window);
