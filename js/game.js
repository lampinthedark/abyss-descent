/** Main game: input, combat, isometric render, NPCs, mobile */
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const TILE_W = 64;
  const TILE_H = 32;

  const game = {
    state: 'title', // title | select | playing | paused | dead | dialogue
    floor: 1,
    map: null,
    player: null,
    enemies: [],
    npcs: [],
    drops: [],
    particles: [],
    projectiles: [],
    floatTexts: [],
    camX: 0,
    camY: 0,
    cleared: false,
    selectedClass: null,
    shake: 0,
    shakePhase: 0,
    hitStop: 0,
    hurtFlash: 0,
    impactFlash: 0,
    deathStinger: false,
  };

  let lastT = 0;
  let animT = 0;
  let talkingNpc = null;

  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer filling phone screens while keeping ~3:2 playfield
    const aspect = 960 / 640;
    let w = Math.min(vw, 1100);
    let h = w / aspect;
    if (h > vh) { h = vh; w = h * aspect; }
    // On very narrow phones, use full width and allow slightly taller crop
    if (vw <= 430) {
      w = vw;
      h = Math.min(vh, w / aspect);
      if (h < vh * 0.55) h = Math.min(vh * 0.72, w / 1.2);
    }
    canvas.width = Math.max(280, Math.floor(w));
    canvas.height = Math.max(200, Math.floor(h));
    canvas.style.width = canvas.width + 'px';
    canvas.style.height = canvas.height + 'px';
  }

  function startRun(keepProgress = false) {
    const classId = game.selectedClass || UI.getSelectedClass() || 'warrior';
    game.selectedClass = classId;
    if (!keepProgress || !game.player) {
      game.floor = 1;
      game.player = Entities.createPlayer(0, 0, classId);
      const cls = Classes.get(classId);
      const w = Loot.createItem('weapon', 1);
      w.rarity = cls.starterWeapon.rarity;
      w.name = cls.starterWeapon.name;
      w.dmg = cls.starterWeapon.dmg;
      game.player.equipped.weapon = w;
      Entities.syncLife(game.player);
      game.player.life = game.player.maxLife;
    }
    loadFloor(game.floor);
    game.state = 'playing';
    UI.hide('title-screen');
    UI.hide('select-screen');
    UI.hide('pause-screen');
    UI.hide('death-screen');
    UI.hide('inv-panel');
    UI.hide('skill-panel');
    UI.hide('dialogue-box');
    UI.show('hud');
    UI.setQuestTip('Speak to the figure near the entrance.', game.player);
    UI.updateHud(game);
    UI.log(`Floor ${game.floor} — ${Classes.get(classId).name} descends.`, 'story');
    persist('start');
    UI.refreshContinue();
  }

  function applyFloorState(state) {
    const map = state && MapGen.restore(state.map);
    if (!map) return false;
    game.map = map;
    game.enemies = (state.enemies || []).map(Entities.restoreEnemy).filter(Boolean);
    game.npcs = (state.npcs || []).map(Npc.restore).filter(Boolean);
    game.drops = (state.drops || []).map(d => {
      if (!d) return null;
      if (d.type === 'gold') return { type: 'gold', amount: d.amount, x: d.x, y: d.y };
      if (d.type === 'item' && d.item) return { type: 'item', item: { ...d.item }, x: d.x, y: d.y };
      return null;
    }).filter(Boolean);
    game.particles = [];
    game.projectiles = [];
    game.floatTexts = [];
    game.cleared = !!state.cleared;
    for (const en of game.enemies) plantOnFloor(en);
    for (const n of game.npcs) plantOnFloor(n);
    for (const d of game.drops) plantOnFloor(d);
    const p = game.player;
    if (typeof state.playerX === 'number') p.x = state.playerX;
    if (typeof state.playerY === 'number') p.y = state.playerY;
    p.path = [];
    p.targetEnemy = null;
    p._pendingNpc = null;
    p.attackCd = 0;
    p.invuln = 0.35;
    plantOnFloor(p);
    centerCam();
    return true;
  }

  function plantOnFloor(obj) {
    if (!obj || !game.map) return;
    if (game.map.walkable(obj.x, obj.y)) return;
    const s = MapGen.nearestWalkable(game.map, obj.x, obj.y);
    obj.x = s.x;
    obj.y = s.y;
  }

  function loadFloor(floor) {
    game.floor = floor;
    game.map = MapGen.create(floor);
    game.enemies = Entities.spawnWave(game.map, floor);
    game.npcs = Npc.createForFloor(game.map, floor);
    for (const en of game.enemies) plantOnFloor(en);
    for (const n of game.npcs) plantOnFloor(n);
    game.drops = [];
    game.particles = [];
    game.projectiles = [];
    game.floatTexts = [];
    game.cleared = false;
    const p = game.player;
    p.x = game.map.startX;
    p.y = game.map.startY;
    p.path = [];
    p.targetEnemy = null;
    p.attackCd = 0;
    p.invuln = 0.5;
    centerCam();
  }

  function centerCam() {
    const iso = Utils.iso(game.player.x, game.player.y, TILE_W, TILE_H);
    game.camX = canvas.width / 2 - iso.x;
    game.camY = canvas.height / 2 - iso.y - 20;
  }

  let saveAcc = 0;
  function persist(reason) {
    if (!game.player) return;
    if (Save.write(game)) {
      if (reason === 'manual') UI.log('Progress saved.', 'level');
    } else if (reason === 'manual') {
      UI.log('Could not save (storage blocked).', 'danger');
    }
  }

  function continueRun() {
    const data = Save.read();
    if (!data) {
      UI.log('No save found.', 'danger');
      return;
    }
    game.selectedClass = data.selectedClass || data.player.classId;
    game.player = Save.hydratePlayer(data.player);
    game.floor = data.floor || 1;
    const restored = !!(data.floorState && applyFloorState(data.floorState));
    if (!restored) loadFloor(game.floor);
    const dead = game.player.life <= 0;
    game.deathStinger = dead;
    game.state = dead ? 'dead' : 'playing';
    UI.hide('title-screen');
    UI.hide('select-screen');
    UI.hide('pause-screen');
    UI.hide('death-screen');
    UI.hide('inv-panel');
    UI.hide('skill-panel');
    UI.hide('dialogue-box');
    UI.show('hud');
    const tip = game.player.questTip || 'Continue the descent.';
    UI.setQuestTip(tip, game.player);
    UI.updateHud(game);
    if (dead) {
      UI.els['death-msg'].textContent =
        `Slain on Floor ${game.floor} as ${Classes.get(game.player.classId).name} Lv ${game.player.level}. Gold: ${game.player.gold}.`;
      UI.show('death-screen');
    } else {
      UI.log(`Continued — Floor ${game.floor}, Lv ${game.player.level}.`, 'story');
    }
  }

  function abandonRun() {
    Save.clear();
    game.player = null;
    UI.refreshContinue();
  }

  function worldToScreen(wx, wy) {
    const iso = Utils.iso(wx, wy, TILE_W, TILE_H);
    return { x: iso.x + game.camX, y: iso.y + game.camY };
  }

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX, clientY;
    if (e.touches && e.touches.length) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function handlePointer(e) {
    if (game.state !== 'playing') return;
    if (UI.isVisible('inv-panel') || UI.isVisible('skill-panel')) return;
    if (UI.isDialogueOpen()) return;
    e.preventDefault();
    const pos = canvasPos(e);
    const world = Utils.screenToWorld(pos.x, pos.y, game.camX, game.camY, TILE_W, TILE_H);

    // NPC talk (generous tap radius for mobile)
    let nearestNpc = null, ndNpc = 1.6;
    for (const n of game.npcs) {
      const d = Utils.dist(world.x, world.y, n.x, n.y);
      if (d < ndNpc) { ndNpc = d; nearestNpc = n; }
    }
    // also allow tap if player is near NPC and tapped near self
    if (!nearestNpc) {
      for (const n of game.npcs) {
        if (Utils.dist(game.player.x, game.player.y, n.x, n.y) < 1.4 &&
            Utils.dist(world.x, world.y, game.player.x, game.player.y) < 1.2) {
          nearestNpc = n;
          break;
        }
      }
    }
    if (nearestNpc && Utils.dist(game.player.x, game.player.y, nearestNpc.x, nearestNpc.y) < 2.2) {
      talkingNpc = nearestNpc;
      // reset dialogue if finished
      if (nearestNpc.lineIndex >= nearestNpc.lines.length) nearestNpc.lineIndex = 0;
      if (UI.openDialogue(nearestNpc)) {
        game.state = 'dialogue';
        game.player.path = [];
        game.player.targetEnemy = null;
        GameAudio.sfx('talk');
        UI.log(nearestNpc.name + ' speaks...', 'story');
      }
      return;
    }
    if (nearestNpc) {
      // walk toward NPC first
      setPath(nearestNpc.x, nearestNpc.y);
      game.player._pendingNpc = nearestNpc;
      return;
    }

    // Screen-space pick so clicks land on the sprite, with a small bias toward the focused foe.
    let nearest = null, best = Infinity;
    const focus = game.player.targetEnemy;
    for (const en of game.enemies) {
      if (en.life <= 0) continue;
      const d = spriteClickDist(pos, en.x, en.y, en.eid === 'brute' ? 22 : 16);
      const limit = (en.eid === 'brute' ? 48 : 38) + (en === focus ? 16 : 0);
      if (d > limit) continue;
      const score = d - (en === focus ? 12 : 0);
      if (score < best) { best = score; nearest = en; }
    }
    if (nearest) {
      game.player.targetEnemy = nearest;
      game.player._pendingNpc = null;
      const st = Entities.playerStats(game.player);
      if (game.player.useProjectile) {
        // ranged: stand and shoot if in range, else approach
        const d = Utils.dist(game.player.x, game.player.y, nearest.x, nearest.y);
        if (d > st.range * 0.9) {
          const ang = Math.atan2(game.player.y - nearest.y, game.player.x - nearest.x);
          setPath(nearest.x + Math.cos(ang) * (st.range * 0.7), nearest.y + Math.sin(ang) * (st.range * 0.7));
        } else {
          game.player.path = [];
        }
      } else {
        const ang = Math.atan2(game.player.y - nearest.y, game.player.x - nearest.x);
        setPath(nearest.x + Math.cos(ang) * 0.9, nearest.y + Math.sin(ang) * 0.9);
      }
      return;
    }

    game.player.targetEnemy = null;
    game.player._pendingNpc = null;
    setPath(world.x, world.y);
  }

  function spriteClickDist(pos, wx, wy, lift) {
    const s = worldToScreen(wx, wy);
    return Math.hypot(pos.x - s.x, pos.y - (s.y - lift));
  }

  function setPath(tx, ty) {
    const p = game.player;
    p.path = Utils.pathfind(p.x, p.y, tx, ty, (x, y) => game.map.walkable(x + 0.5, y + 0.5))
      .map(n => ({ x: n.x + 0.5, y: n.y + 0.5 }));
    if (!p.path.length && game.map.walkable(tx, ty)) {
      p.path = [{ x: tx, y: ty }];
    }
  }

  function panelsOpen() {
    return UI.isVisible('inv-panel') || UI.isVisible('skill-panel');
  }

  function update(dt) {
    if (game.state === 'dialogue') return;
    if (game.state !== 'playing') return;
    if (panelsOpen()) return;
    const p = game.player;
    const st = Entities.playerStats(p);
    p.maxLife = st.maxLife;
    if (p.life > p.maxLife) p.life = p.maxLife;
    plantOnFloor(p);

    if (p.hitFlash > 0) p.hitFlash -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.swingAnim > 0) p.swingAnim -= dt;
    if (p.attackCd > 0) p.attackCd -= dt;

    const attackRange = st.range;

    // arrive near pending NPC → talk
    if (p._pendingNpc) {
      const n = p._pendingNpc;
      if (Utils.dist(p.x, p.y, n.x, n.y) < 1.3) {
        p.path = [];
        p._pendingNpc = null;
        if (n.lineIndex >= n.lines.length) n.lineIndex = 0;
        talkingNpc = n;
        if (UI.openDialogue(n)) {
          game.state = 'dialogue';
          GameAudio.sfx('talk');
          return;
        }
      }
    }

    if (!p.targetEnemy || p.targetEnemy.life <= 0) {
      p.targetEnemy = null;
      if (!p.path.length && !p.useProjectile) {
        let best = null, bd = attackRange + 0.4;
        for (const en of game.enemies) {
          if (en.life <= 0) continue;
          const d = Utils.dist(p.x, p.y, en.x, en.y);
          if (d < bd) { bd = d; best = en; }
        }
        if (best) p.targetEnemy = best;
      }
    }

    if (p.path.length) {
      const next = p.path[0];
      const dx = next.x - p.x, dy = next.y - p.y;
      const dist = Math.hypot(dx, dy);
      const speed = st.move * dt;
      if (dist <= speed + 0.05) {
        p.x = next.x; p.y = next.y;
        p.path.shift();
      } else {
        p.x += (dx / dist) * speed;
        p.y += (dy / dist) * speed;
        p.facing = dx >= 0 ? 1 : -1;
        p._dust = (p._dust || 0) + dt;
        if (p._dust > 0.22) {
          p._dust = 0;
          pushFx({
            x: p.x, y: p.y, vx: Utils.rand(-0.25, 0.25), vy: Utils.rand(-0.15, 0.15),
            g: 0.5, life: 0.28, color: 'rgba(90,70,50,0.85)', size: 2,
          });
        }
      }
    } else if (p.targetEnemy && p.targetEnemy.life > 0) {
      const en = p.targetEnemy;
      const d = Utils.dist(p.x, p.y, en.x, en.y);
      if (d > attackRange * 0.92) {
        const ang = Math.atan2(en.y - p.y, en.x - p.x);
        const nx = p.x + Math.cos(ang) * st.move * dt;
        const ny = p.y + Math.sin(ang) * st.move * dt;
        if (game.map.walkable(nx, ny)) { p.x = nx; p.y = ny; }
        p.facing = en.x >= p.x ? 1 : -1;
      }
    }

    if (p.windup > 0) {
      p.windup -= dt;
      if (p.windup <= 0) {
        p.windup = 0;
        const en = p.targetEnemy;
        if (en && en.life > 0) {
          const d = Utils.dist(p.x, p.y, en.x, en.y);
          const reach = attackRange * (p.useProjectile ? 1.25 : 1.15);
          if (d <= reach) doPlayerAttack(p, en, st);
        }
      }
    } else if (p.targetEnemy && p.targetEnemy.life > 0 && p.attackCd <= 0) {
      const en = p.targetEnemy;
      const d = Utils.dist(p.x, p.y, en.x, en.y);
      if (d <= attackRange) {
        p.windupMax = p.useProjectile ? 0.1 : 0.06;
        p.windup = p.windupMax;
        p.swingDur = p.useProjectile ? 0.2 : 0.16;
        p.swingAnim = p.swingDur;
        p.swingAng = Math.atan2(en.y - p.y, en.x - p.x);
        p.facing = en.x >= p.x ? 1 : -1;
        p.attackCd = Math.max(p.windupMax + 0.1, (1 / st.aspd) * 0.8);
        GameAudio.sfx(p.useProjectile ? 'cast' : 'swing');
      }
    }

    // projectiles
    for (let i = game.projectiles.length - 1; i >= 0; i--) {
      const pr = game.projectiles[i];
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.trail = (pr.trail || 0) - dt;
      if (pr.trail <= 0 && game.particles.length < 140) {
        pr.trail = 0.03;
        pushFx({
          x: pr.x, y: pr.y, vx: 0, vy: 0, g: 0, life: 0.16,
          color: pr.color, size: 3, glow: true,
        });
      }
      let hit = false;
      for (const en of game.enemies) {
        if (en.life <= 0) continue;
        if (Utils.dist(pr.x, pr.y, en.x, en.y) < 0.45) {
          applyDamageToEnemy(p, en, pr.dmg, st, pr.color);
          hit = true;
          break;
        }
      }
      if (hit || pr.life <= 0 || !game.map.walkable(pr.x, pr.y)) {
        game.projectiles.splice(i, 1);
      }
    }

    for (const en of game.enemies) updateEnemy(en, dt, p, st);
    game.enemies = game.enemies.filter(e => e.life > 0 || (e.dissolve || 0) > 0);

    for (let i = game.drops.length - 1; i >= 0; i--) {
      const d = game.drops[i];
      if (Utils.dist(p.x, p.y, d.x, d.y) < 0.7) {
        if (d.type === 'gold') {
          const amt = Math.round(d.amount * st.goldMult);
          p.gold += amt;
          UI.log(`+${amt} gold`, 'loot');
          spawnFloat(d.x, d.y, `+${amt}`, '#ffe08a', { scale: 1.15, life: 0.9 });
          spawnLootSparkles(d.x, d.y, '#e0c060');
          GameAudio.sfx('loot');
        } else if (d.type === 'item') {
          p.inventory.push(d.item);
          UI.log(`${d.item.name}`, d.item.rarity);
          spawnFloat(d.x, d.y, d.item.name, Loot.RARITY[d.item.rarity].color, { scale: d.item.rarity === 'rare' ? 1.2 : 1 });
          spawnLootSparkles(d.x, d.y, Loot.RARITY[d.item.rarity].color);
          GameAudio.sfx(d.item.rarity === 'rare' ? 'lootRare' : 'loot');
        }
        game.drops.splice(i, 1);
      }
    }

    game.particles = game.particles.filter(pt => {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += (pt.g || 0) * dt;
      return pt.life > 0;
    });
    game.floatTexts = game.floatTexts.filter(f => {
      f.life -= dt;
      f.y -= dt * (f.vy || 0.6);
      return f.life > 0;
    });

    const living = game.enemies.some(e => e.life > 0);
    if (!game.cleared && !living) {
      game.cleared = true;
      UI.log('Floor cleared! Find the portal.', 'level');
      UI.setQuestTip('Find the glowing portal and descend.', p);
      GameAudio.sfx('clear');
    }
    if (game.cleared && game.map) {
      game._portalAcc = (game._portalAcc || 0) + dt;
      if (game._portalAcc > 0.12 && game.particles.length < 150) {
        game._portalAcc = 0;
        pushFx({
          x: game.map.stairsX + Utils.rand(-0.35, 0.35),
          y: game.map.stairsY + Utils.rand(-0.15, 0.15),
          vx: Utils.rand(-0.25, 0.25),
          vy: Utils.rand(-1.5, -0.45),
          g: -0.15,
          life: 0.75,
          color: Math.random() < 0.5 ? '#ffd080' : '#fff4c8',
          size: Utils.rand(1.4, 2.6),
          glow: true,
        });
      }
    }
    if (game.cleared && game.map.isStairs(p.x, p.y)) {
      game.floor++;
      const heal = Math.round(p.maxLife * 0.35);
      p.life = Math.min(p.maxLife, p.life + heal);
      GameAudio.sfx('portal');
      addShake(4);
      loadFloor(game.floor);
      UI.log(`Descending to Floor ${game.floor}...`, 'level');
      UI.setQuestTip('Seek survivors — then cleanse and descend.', p);
      UI.updateHud(game);
      persist('floor');
    }

    game.ambientAcc = (game.ambientAcc || 0) + dt;
    if (game.ambientAcc > 0.45 && game.particles.length < 90) {
      game.ambientAcc = 0;
      pushFx({
        x: p.x + Utils.rand(-4.5, 4.5),
        y: p.y + Utils.rand(-3.5, 3.5),
        vx: Utils.rand(-0.12, 0.12),
        vy: Utils.rand(-0.35, -0.08),
        g: -0.05,
        life: Utils.rand(0.8, 1.5),
        color: 'rgba(190,150,110,0.55)',
        size: 1.3,
        glow: true,
      });
    }

    if (p.life <= 0) {
      p.life = 0;
      game.state = 'dead';
      if (!game.deathStinger) {
        game.deathStinger = true;
        GameAudio.sfx('defeat');
        addShake(9);
      }
      UI.els['death-msg'].textContent =
        `Slain on Floor ${game.floor} as ${Classes.get(p.classId).name} Lv ${p.level}. Gold: ${p.gold}.`;
      UI.show('death-screen');
      persist('death');
    }

    const iso = Utils.iso(p.x, p.y, TILE_W, TILE_H);
    const tx = canvas.width / 2 - iso.x;
    const ty = canvas.height / 2 - iso.y - 20;
    game.camX = Utils.lerp(game.camX, tx, 1 - Math.pow(0.001, dt));
    game.camY = Utils.lerp(game.camY, ty, 1 - Math.pow(0.001, dt));

    saveAcc += dt;
    if (saveAcc >= 20) {
      saveAcc = 0;
      persist('auto');
    }
    UI.updateHud(game);
  }

  function doPlayerAttack(p, primary, st) {
    if (p.useProjectile) {
      const ang = Math.atan2(primary.y - p.y, primary.x - p.x);
      const speed = 8.2;
      let dmg = st.dmg * Utils.rand(p.dmgVar[0], p.dmgVar[1]);
      dmg = paceDamage(Math.round(dmg));
      const col = Classes.get(p.classId).colors.accent;
      game.projectiles.push({
        x: p.x, y: p.y - 0.15,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 1.2,
        dmg,
        color: col,
        trail: 0,
      });
      spawnSparks(p.x, p.y, col, false);
      return;
    }
    spawnSlash(p);
    const targets = [primary];
    if (st.cleave > 0) {
      for (const en of game.enemies) {
        if (en === primary || en.life <= 0) continue;
        if (Utils.dist(primary.x, primary.y, en.x, en.y) <= st.cleave + 0.3) targets.push(en);
      }
    }
    for (const en of targets) {
      let dmg = st.dmg * Utils.rand(p.dmgVar[0], p.dmgVar[1]);
      const mult = en === primary ? 1 : 0.6;
      if (en !== primary) dmg *= 0.6;
      dmg = paceDamage(Math.round(dmg));
      applyDamageToEnemy(p, en, dmg, st, '#f4efe4', mult);
    }
  }

  function applyDamageToEnemy(p, en, dmg, st, floatColor, mult) {
    if (!en || en.life <= 0) return;
    const expected = Math.max(1, st.dmg * (mult || 1));
    const ratio = dmg / expected;
    const crit = ratio >= 1.18;
    const weak = ratio < 0.92;
    en.life -= dmg;
    en.hitFlash = crit ? 0.42 : 0.3;
    const col = crit ? '#ffe566' : (weak ? '#f0e2d0' : (floatColor || '#fff6e8'));
    spawnFloat(en.x, en.y - 0.35, crit ? (dmg + '!') : String(dmg), col, {
      scale: crit ? 2.15 : (weak ? 1.25 : 1.6),
      crit,
      life: crit ? 1.15 : 0.95,
      jitter: true,
    });
    if (p.useProjectile) spawnSparks(en.x, en.y, floatColor || '#9bb6ff', crit);
    else spawnBlood(en.x, en.y, crit);
    addShake(crit ? 16 : 9);
    game.impactFlash = Math.max(game.impactFlash || 0, crit ? 0.5 : 0.32);
    if (crit || dmg >= 18) hitStop(crit ? 0.06 : 0.04);
    const ang = Math.atan2(en.y - p.y, en.x - p.x);
    const kb = (crit ? 0.16 : 0.07) * (en.eid === 'brute' ? 0.4 : 1);
    const nx = en.x + Math.cos(ang) * kb;
    const ny = en.y + Math.sin(ang) * kb;
    if (game.map.walkable(nx, ny)) { en.x = nx; en.y = ny; }
    if (st.lifesteal > 0) {
      const heal = Math.max(1, Math.round(dmg * st.lifesteal));
      p.life = Math.min(p.maxLife, p.life + heal);
    }
    if (en.life <= 0) onEnemyKilled(en);
    else GameAudio.sfx(crit ? 'crit' : 'hit');
  }

  function onEnemyKilled(en) {
    if (en.dead) return;
    en.dead = true;
    en.life = 0;
    en.dissolve = en.eid === 'brute' ? 0.95 : 0.78;
    en.dissolveMax = en.dissolve;
    const p = game.player;
    const prog = Entities.gainXp(p, en.xp);
    spawnDeathBurst(en);
    addShake(en.eid === 'brute' ? 24 : 16);
    hitStop(en.eid === 'brute' ? 0.09 : 0.07);
    game.impactFlash = Math.max(game.impactFlash || 0, 0.62);
    GameAudio.sfx('death');
    const drops = Loot.dropFromEnemy(en, game.floor);
    for (const d of drops) {
      plantOnFloor(d);
      game.drops.push(d);
    }
    if (prog.leveled) {
      const pts = prog.pointsGained > 0
        ? ` — ${prog.pointsGained} skill point${prog.pointsGained === 1 ? '' : 's'} gained.`
        : '.';
      UI.log(`Level up! Now Lv ${p.level}${pts}`, 'level');
      spawnFloat(p.x, p.y - 0.55, 'LEVEL UP', '#7dffa8', { scale: 1.45, crit: true, life: 1.15 });
      spawnLevelBurst(p.x, p.y);
      GameAudio.sfx('level');
    }
    persist('kill');
  }

  function updateEnemy(en, dt, p, st) {
    if (en.life <= 0) {
      en.dissolve = (en.dissolve || 0) - dt;
      return;
    }
    if (en.hitFlash > 0) en.hitFlash -= dt;
    if (en.attackCd > 0) en.attackCd -= dt;
    if (!game.map.walkable(en.x, en.y)) plantOnFloor(en);
    const d = Utils.dist(en.x, en.y, p.x, p.y);
    const aggroR = game.floor <= 1 ? 5.4 : game.floor === 2 ? 6.6 : 9;
    if (d < aggroR) en.aggro = true;
    if (!en.aggro) return;
    en.facing = p.x >= en.x ? 1 : -1;
    const reach = 0.7 + (en.radius || 0.3);
    if (en.windup > 0) {
      en.windup -= dt;
      if (en.windup <= 0) {
        en.windup = 0;
        enemyStrike(en, p, st);
      }
      return;
    }
    if (d > reach) {
      const ang = Math.atan2(p.y - en.y, p.x - en.x);
      let nx = en.x + Math.cos(ang) * en.speed * dt;
      let ny = en.y + Math.sin(ang) * en.speed * dt;
      if (game.map.walkable(nx, en.y)) en.x = nx;
      else {
        nx = en.x + Math.cos(ang + 0.6) * en.speed * dt;
        if (game.map.walkable(nx, en.y)) en.x = nx;
      }
      if (game.map.walkable(en.x, ny)) en.y = ny;
      else {
        ny = en.y + Math.sin(ang + 0.6) * en.speed * dt;
        if (game.map.walkable(en.x, ny)) en.y = ny;
      }
    } else if (en.attackCd <= 0) {
      en.windupMax = en.eid === 'brute' ? 0.5 : en.eid === 'wraith' ? 0.42 : en.eid === 'imp' ? 0.34 : 0.38;
      en.windup = en.windupMax;
    }
  }

  function enemyStrike(en, p, st) {
    en.attackCd = en.eid === 'brute' ? 1.15 : en.eid === 'imp' ? 0.7 : en.eid === 'wraith' ? 0.95 : 0.88;
    if (game.floor <= 2) en.attackCd *= game.floor === 1 ? 1.35 : 1.18;
    const reach = 0.7 + (en.radius || 0.3);
    if (Utils.dist(en.x, en.y, p.x, p.y) > reach + 0.4) return;
    if (p.invuln > 0) return;
    let dmg = Math.max(1, en.dmg - st.armor * 0.4);
    dmg = Math.round(dmg * Utils.rand(0.9, 1.1));
    p.life -= dmg;
    p.hitFlash = 0.4;
    p.invuln = 0.38;
    const heavy = dmg >= 10 || en.eid === 'brute';
    addShake(Math.min(26, 12 + dmg * 0.7));
    hitStop(heavy ? 0.08 : 0.055);
    game.hurtFlash = Math.min(0.7, 0.38 + dmg * 0.02);
    game.impactFlash = Math.max(game.impactFlash || 0, heavy ? 0.48 : 0.3);
    spawnBlood(p.x, p.y, heavy);
    spawnFloat(p.x, p.y - 0.4, '-' + dmg, '#ff4a3a', {
      scale: heavy ? 1.9 : 1.5,
      crit: heavy,
      life: 1.0,
      jitter: true,
    });
    const ang = Math.atan2(p.y - en.y, p.x - en.x);
    const nx = p.x + Math.cos(ang) * (heavy ? 0.2 : 0.1);
    const ny = p.y + Math.sin(ang) * (heavy ? 0.2 : 0.1);
    if (game.map.walkable(nx, ny)) { p.x = nx; p.y = ny; }
    GameAudio.sfx('hurt');
  }

  function pushFx(pt) {
    if (!pt.maxL) pt.maxL = pt.life;
    if (game.particles.length > 180) game.particles.splice(0, game.particles.length - 150);
    game.particles.push(pt);
  }
  function addShake(n) {
    game.shake = Math.min(30, (game.shake || 0) + n);
  }
  function paceDamage(dmg) {
    if (game.floor === 1) return Math.max(1, Math.round(dmg * 0.58));
    if (game.floor === 2) return Math.max(1, Math.round(dmg * 0.7));
    return dmg;
  }
  function hitStop(n) {
    game.hitStop = Math.max(game.hitStop || 0, n);
  }
  function spawnFloat(x, y, text, color, opt) {
    opt = opt || {};
    const life = opt.life || 0.85;
    game.floatTexts.push({
      x: x + (opt.jitter ? Utils.rand(-0.14, 0.14) : 0),
      y, text, color,
      life, max: life,
      scale: opt.scale || 1,
      crit: !!opt.crit,
      vy: opt.crit ? 0.95 : 0.58,
    });
    if (game.floatTexts.length > 28) game.floatTexts.splice(0, game.floatTexts.length - 28);
  }
  function spawnBlood(x, y, crit) {
    const n = crit ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Utils.rand(1.1, crit ? 4.6 : 3.1);
      pushFx({
        x, y,
        vx: Math.cos(a) * sp * 0.5,
        vy: Math.sin(a) * sp * 0.5 - Utils.rand(0.4, 1.6),
        g: 4.2,
        life: Utils.rand(0.18, 0.45),
        color: i % 3 === 0 ? '#ff5840' : (i % 3 === 1 ? '#7a1010' : '#f0c8a8'),
        size: Utils.rand(1.6, crit ? 4.6 : 3.3),
      });
    }
    for (let i = 0; i < (crit ? 6 : 3); i++) {
      const a = Math.random() * Math.PI * 2;
      pushFx({
        x, y,
        vx: Math.cos(a) * Utils.rand(2, 5.2),
        vy: Math.sin(a) * Utils.rand(2, 5.2),
        g: 0.4,
        life: 0.12,
        color: '#fff4cc',
        size: 1.6,
        glow: true,
      });
    }
  }
  function spawnSparks(x, y, color, crit) {
    const n = crit ? 16 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      pushFx({
        x, y,
        vx: Math.cos(a) * Utils.rand(1.2, 4.2),
        vy: Math.sin(a) * Utils.rand(1.2, 4.2),
        g: 0.25,
        life: Utils.rand(0.16, 0.4),
        color: i % 2 ? '#ffffff' : (color || '#80a0ff'),
        size: Utils.rand(2, crit ? 5 : 4),
        glow: true,
      });
    }
  }
  function spawnSlash(p) {
    const ang = p.swingAng || 0;
    for (let i = 0; i < 7; i++) {
      const a = ang + Utils.rand(-0.7, 0.7);
      const dist = Utils.rand(0.15, 0.85);
      pushFx({
        x: p.x + Math.cos(a) * dist,
        y: p.y + Math.sin(a) * dist,
        vx: Math.cos(a) * Utils.rand(0.5, 1.8),
        vy: Math.sin(a) * Utils.rand(0.5, 1.8),
        g: 0.15,
        life: 0.16,
        color: p.classId === 'rogue' ? '#d8ffe4' : '#fff6e4',
        size: Utils.rand(2, 3.5),
        glow: true,
      });
    }
  }
  function spawnDeathBurst(en) {
    const n = en.eid === 'brute' ? 34 : 22;
    const colors = en.eid === 'wraith'
      ? ['#b7d8f0', '#f4fbff', '#406888']
      : en.eid === 'skel'
        ? ['#f2eadc', '#b4a48c', '#ffffff']
        : ['#d02018', '#ff6840', '#4a0808', '#ffd0a0'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Utils.rand(1.6, 5.8);
      pushFx({
        x: en.x, y: en.y,
        vx: Math.cos(a) * sp * 0.55,
        vy: Math.sin(a) * sp * 0.55 - Utils.rand(0.6, 2.4),
        g: 3.4,
        life: Utils.rand(0.4, 0.85),
        color: colors[i % colors.length],
        size: Utils.rand(3, en.eid === 'brute' ? 8 : 5.5),
        glow: en.eid === 'wraith' || i % 4 === 0,
      });
    }
  }
  function spawnLevelBurst(x, y) {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      pushFx({
        x, y,
        vx: Math.cos(a) * 2.3,
        vy: Math.sin(a) * 2.3 - 0.4,
        g: 1.1,
        life: 0.7,
        color: i % 2 ? '#7dffb2' : '#ffe090',
        size: 3,
        glow: true,
      });
    }
  }
  function spawnLootSparkles(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      pushFx({
        x, y,
        vx: Math.cos(a) * Utils.rand(0.4, 2.2),
        vy: Math.sin(a) * Utils.rand(0.4, 2.2) - 1.3,
        g: 1.3,
        life: Utils.rand(0.35, 0.8),
        color,
        size: Utils.rand(1.6, 3.6),
        glow: true,
      });
    }
  }

  // ——— Rendering ———
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#08060a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!game.map || game.state === 'title' || game.state === 'select') {
      drawTitleBackdrop();
      drawVignette(0.55);
      return;
    }

    ctx.save();
    if (game.shake > 0.35) {
      const ox = Math.sin(game.shakePhase) * game.shake;
      const oy = Math.cos(game.shakePhase * 1.17) * game.shake * 0.62;
      ctx.translate(ox, oy);
    }

    drawMap();
    const sprites = [];
    for (const n of game.npcs) sprites.push({ kind: 'npc', ref: n, depth: n.x + n.y });
    for (const d of game.drops) sprites.push({ kind: 'drop', ref: d, depth: d.x + d.y });
    for (const en of game.enemies) sprites.push({ kind: 'enemy', ref: en, depth: en.x + en.y });
    sprites.push({ kind: 'player', ref: game.player, depth: game.player.x + game.player.y });
    sprites.sort((a, b) => a.depth - b.depth);
    for (const s of sprites) {
      if (s.kind === 'drop') drawDrop(s.ref);
      else if (s.kind === 'enemy') { drawTelegraph(s.ref); drawEnemy(s.ref); }
      else if (s.kind === 'npc') drawNpc(s.ref);
      else { drawPlayer(s.ref); drawSwingArc(s.ref); drawCastCharge(s.ref); }
    }

    for (const pr of game.projectiles) {
      const s = worldToScreen(pr.x, pr.y);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 12);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.35, pr.color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8f0ff';
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
    }

    for (const pt of game.particles) {
      const s = worldToScreen(pt.x, pt.y);
      const a = Utils.clamp(pt.life / (pt.maxL || 0.4), 0, 1);
      ctx.fillStyle = pt.color;
      if (pt.glow) {
        ctx.globalAlpha = a * 0.35;
        ctx.beginPath(); ctx.arc(s.x, s.y, pt.size * 2.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(s.x, s.y, pt.size, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const f of game.floatTexts) {
      const s = worldToScreen(f.x, f.y);
      const age = 1 - f.life / (f.max || 0.85);
      const pop = (f.scale || 1) * (f.crit ? (1 + Math.exp(-age * 6) * 0.55) : 1);
      const fs = Math.round((canvas.width < 520 ? 26 : 22) * pop);
      ctx.globalAlpha = Utils.clamp(f.life * 1.8, 0, 1);
      ctx.font = `bold ${fs}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.82)';
      ctx.strokeText(f.text, s.x, s.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, s.x, s.y);
      ctx.globalAlpha = 1;
    }

    drawPortalOverlay();
    ctx.restore();

    if (game.hurtFlash > 0) {
      ctx.fillStyle = `rgba(160, 8, 8, ${Math.min(0.62, game.hurtFlash)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (game.impactFlash > 0) {
      ctx.fillStyle = `rgba(255, 244, 214, ${Math.min(0.55, game.impactFlash)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    drawMinimap();
    drawVignette(0.14);
  }

  function drawVignette(strength) {
    const g = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.48,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.78
    );
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawTitleBackdrop() {
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 9; x++) {
        const px = canvas.width / 2 + (x - y) * 36 - 70;
        const py = canvas.height * 0.38 + (x + y) * 18;
        const col = (x + y) % 2 === 0 ? '#2a1c18' : '#1a1210';
        drawDiamond(px, py, 72, 36, col, '#0c0908');
      }
    }
    for (let i = 0; i < 4; i++) {
      const px = canvas.width * (0.16 + i * 0.22);
      const py = canvas.height * 0.16;
      const ph = canvas.height * 0.26;
      ctx.fillStyle = '#241814';
      ctx.fillRect(px, py, 16, ph);
      ctx.fillStyle = '#3a2a22';
      ctx.fillRect(px - 5, py - 8, 26, 10);
      ctx.fillRect(px - 5, py + ph - 4, 26, 8);
    }
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.3;
    const pulse = 0.35 + Math.sin(animT * 2.2) * 0.15;
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, 80);
    g.addColorStop(0, `rgba(255,170,60,${pulse})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 80, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,210,120,${0.35 + pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, 18, 32, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, 28, 44, animT * 0.4, 0, Math.PI * 1.4); ctx.stroke();
    for (let i = 0; i < 18; i++) {
      const x = canvas.width * (0.08 + (i * 0.053) % 0.84) + Math.sin(animT * 0.7 + i) * 14;
      const y = canvas.height * 0.82 - ((animT * 26 + i * 41) % (canvas.height * 0.7));
      ctx.fillStyle = `rgba(255,${80 + (i % 4) * 28},36,${0.25 + (i % 5) * 0.08})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  function drawMap() {
    const map = game.map;
    const px = game.player.x, py = game.player.y;
    const margin = 2;
    const topLeft = Utils.screenToWorld(0, 0, game.camX, game.camY, TILE_W, TILE_H);
    const botRight = Utils.screenToWorld(canvas.width, canvas.height, game.camX, game.camY, TILE_W, TILE_H);
    const minX = Utils.clamp(Math.floor(Math.min(topLeft.x, botRight.x)) - margin, 0, map.w - 1);
    const maxX = Utils.clamp(Math.ceil(Math.max(topLeft.x, botRight.x)) + margin, 0, map.w - 1);
    const minY = Utils.clamp(Math.floor(Math.min(topLeft.y, botRight.y)) - margin, 0, map.h - 1);
    const maxY = Utils.clamp(Math.ceil(Math.max(topLeft.y, botRight.y)) + margin, 0, map.h - 1);

    for (let sum = minX + minY; sum <= maxX + maxY; sum++) {
      for (let x = minX; x <= maxX; x++) {
        const y = sum - x;
        if (y < minY || y > maxY) continue;
        const tile = map.grid[y][x];
        const top = Utils.iso(x, y, TILE_W, TILE_H);
        // Diamond center matches world (x+0.5, y+0.5), so feet sit on the lit tile.
        const sx = top.x + game.camX - TILE_W / 2;
        const sy = top.y + game.camY;
        const dist = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        let light = tileLight(dist);
        if (tile !== map.TILE.WALL) light = Math.max(light, footLight(x + 0.5, y + 0.5));
        const torch = 0.04 * Math.sin(animT * 3 + x * 0.7 + y);

        if (tile === map.TILE.WALL) {
          const base = shade('#3a3028', light * 0.85 + torch);
          drawDiamond(sx + TILE_W / 2, sy + TILE_H / 2, TILE_W, TILE_H, base, shade('#241c18', light));
          ctx.fillStyle = shade('#5a4a40', light * 0.9 + torch);
          ctx.beginPath();
          ctx.moveTo(sx + TILE_W / 2, sy - 20);
          ctx.lineTo(sx + TILE_W, sy + TILE_H / 2 - 20);
          ctx.lineTo(sx + TILE_W, sy + TILE_H / 2);
          ctx.lineTo(sx + TILE_W / 2, sy + TILE_H);
          ctx.lineTo(sx, sy + TILE_H / 2);
          ctx.lineTo(sx, sy + TILE_H / 2 - 20);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = shade('#0c0a0a', light);
          ctx.lineWidth = 1; ctx.stroke();
          // darker left face so the block reads
          ctx.fillStyle = shade('#2e261f', light * 0.95);
          ctx.beginPath();
          ctx.moveTo(sx, sy + TILE_H / 2 - 20);
          ctx.lineTo(sx, sy + TILE_H / 2);
          ctx.lineTo(sx + TILE_W / 2, sy + TILE_H);
          ctx.lineTo(sx + TILE_W / 2, sy + TILE_H - 20);
          ctx.closePath();
          ctx.fill();
          const wseed = (x * 13 + y * 7) % 5;
          const topCol = wseed === 0 ? '#8d7564' : '#6e5c4e';
          drawDiamond(sx + TILE_W / 2, sy - 20 + TILE_H / 2, TILE_W, TILE_H, shade(topCol, light + torch), shade('#1a1410', light));
          ctx.strokeStyle = shade('#6a5a4c', light * 0.9);
          ctx.beginPath();
          ctx.moveTo(sx + 6, sy + TILE_H / 2 - 20);
          ctx.lineTo(sx + TILE_W / 2, sy - 18);
          ctx.lineTo(sx + TILE_W - 6, sy + TILE_H / 2 - 20);
          ctx.stroke();
          ctx.strokeStyle = shade('#1e1814', light);
          ctx.beginPath();
          ctx.moveTo(sx + 8, sy + TILE_H / 2 - 12);
          ctx.lineTo(sx + TILE_W - 8, sy + TILE_H / 2 - 12);
          ctx.moveTo(sx + 10, sy + TILE_H / 2 - 4);
          ctx.lineTo(sx + TILE_W - 12, sy + TILE_H / 2 - 4);
          ctx.stroke();
        } else {
          const isStairs = tile === map.TILE.STAIRS;
          const seed = (x * 17 + y * 31) % 17;
          let col = (x + y) % 2 === 0 ? '#b09078' : '#9a7c68';
          if (seed === 1) col = '#a88870';
          if (seed === 0 || seed === 8) col = '#8a5848';
          if (isStairs) col = game.cleared ? '#c4a050' : '#8a7860';
          drawDiamond(sx + TILE_W / 2, sy + TILE_H / 2, TILE_W, TILE_H, shade(col, light + torch * 0.5), shade('#6a5344', light));
          ctx.strokeStyle = shade((x + y) % 2 === 0 ? '#6a584c' : '#57483e', light * 0.85);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + 2, sy + TILE_H / 2);
          ctx.lineTo(sx + TILE_W / 2, sy + 2);
          ctx.lineTo(sx + TILE_W - 2, sy + TILE_H / 2);
          ctx.stroke();
          if (seed === 2 || seed === 5 || seed === 11) {
            ctx.strokeStyle = shade('#1a1210', light);
            ctx.beginPath();
            ctx.moveTo(sx + TILE_W * 0.28, sy + TILE_H * 0.35);
            ctx.lineTo(sx + TILE_W * 0.5, sy + TILE_H * 0.55);
            ctx.lineTo(sx + TILE_W * 0.62, sy + TILE_H * 0.42);
            ctx.stroke();
          }
          if (seed === 0 || seed === 8) {
            ctx.fillStyle = shade('#5a1810', light * 0.75);
            ctx.beginPath();
            ctx.ellipse(sx + TILE_W * 0.48, sy + TILE_H * 0.52, 8, 4, 0.3, 0, Math.PI * 2);
            ctx.fill();
          }
          if (seed === 4 || seed === 13) {
            ctx.fillStyle = shade('#241c18', light);
            ctx.fillRect(sx + 20, sy + 14, 3, 2);
            ctx.fillRect(sx + 34, sy + 18, 2, 2);
          }
          if (isStairs) {
            const glow = game.cleared ? 0.5 + Math.sin(animT * 4) * 0.3 : 0.2;
            const rg = ctx.createRadialGradient(sx + TILE_W / 2, sy + TILE_H / 2, 2, sx + TILE_W / 2, sy + TILE_H / 2, 18);
            rg.addColorStop(0, `rgba(220,180,60,${glow})`);
            rg.addColorStop(1, 'transparent');
            ctx.fillStyle = rg;
            ctx.beginPath(); ctx.arc(sx + TILE_W / 2, sy + TILE_H / 2, 18, 0, Math.PI * 2); ctx.fill();
            // rune ring
            ctx.strokeStyle = shade(game.cleared ? '#e0c060' : '#806040', light);
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(sx + TILE_W / 2, sy + TILE_H / 2, 8, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(sx + TILE_W / 2, sy + TILE_H / 2, 4, 0, Math.PI * 2); ctx.stroke();
          }
        }
      }
    }
  }

  function tileLight(dist) {
    if (dist < 6.2) return 1.02;
    return Utils.clamp(1.02 - (dist - 6.2) / 16, 0.58, 1.02);
  }

  function footLight(tx, ty) {
    const near = (x, y) => Utils.dist(tx, ty, x, y) < 1.35;
    if (game.player && near(game.player.x, game.player.y)) return 0.98;
    for (const n of game.npcs) if (near(n.x, n.y)) return 0.94;
    for (const en of game.enemies) {
      if (en.life <= 0) continue;
      if (near(en.x, en.y)) return 0.94;
    }
    return 0;
  }

  function shade(hex, light) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const f = Utils.clamp(light, 0, 1.4);
    return `rgb(${Math.round(Utils.clamp(r * f, 0, 255))},${Math.round(Utils.clamp(g * f, 0, 255))},${Math.round(Utils.clamp(b * f, 0, 255))})`;
  }

  function drawDiamond(cx, cy, w, h, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function swingPose(p) {
    if (!(p.swingAnim > 0)) return 0;
    const dur = p.swingDur || 0.32;
    const t = Utils.clamp(1 - p.swingAnim / dur, 0, 1);
    if (t < 0.42) return -(t / 0.42);
    return -1 + ((t - 0.42) / 0.58) * 2;
  }

  function drawSwingArc(p) {
    if (p.useProjectile || !(p.swingAnim > 0)) return;
    const dur = p.swingDur || 0.32;
    const t = Utils.clamp(1 - p.swingAnim / dur, 0, 1);
    if (t < 0.4 || t > 0.98) return;
    const u = (t - 0.4) / 0.58;
    const s = worldToScreen(p.x, p.y);
    ctx.save();
    ctx.translate(s.x + p.facing * 8, s.y - 16);
    ctx.scale(p.facing, 1);
    ctx.globalAlpha = 0.35 + (1 - u) * 0.5;
    ctx.strokeStyle = p.classId === 'rogue' ? '#d8ffe6' : '#fff3d4';
    ctx.lineWidth = p.classId === 'rogue' ? 3 : 6;
    ctx.lineCap = 'round';
    const a0 = -1.15;
    const a1 = a0 + u * 2.15;
    ctx.beginPath();
    ctx.arc(0, 0, 28, a0, a1, false);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha *= 0.75;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 20, a0 + 0.15, a1, false);
    ctx.stroke();
    ctx.restore();
  }

  function drawCastCharge(p) {
    if (!p.useProjectile || !(p.windup > 0)) return;
    const s = worldToScreen(p.x, p.y);
    const max = p.windupMax || 0.18;
    const u = Utils.clamp(1 - p.windup / max, 0, 1);
    ctx.save();
    ctx.translate(s.x + p.facing * 12, s.y - 28);
    ctx.strokeStyle = `rgba(170,198,255,${0.35 + u * 0.65})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 5 + u * 16, -Math.PI * 0.2, Math.PI * 2 * u);
    ctx.stroke();
    ctx.fillStyle = `rgba(236,242,255,${0.4 + u * 0.6})`;
    ctx.beginPath(); ctx.arc(0, 0, 3 + u * 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawTelegraph(en) {
    if (!(en.windup > 0) || en.life <= 0) return;
    const s = worldToScreen(en.x, en.y);
    const max = en.windupMax || 0.4;
    const u = Utils.clamp(1 - en.windup / max, 0, 1);
    const reach = en.eid === 'brute' ? 40 : 30;
    ctx.save();
    ctx.translate(s.x, s.y + 6);
    ctx.globalAlpha = 0.75 + u * 0.25;
    ctx.strokeStyle = u > 0.66 ? '#ff2a22' : '#ffb020';
    ctx.lineWidth = 5 + u * 5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16 + u * reach, 8 + u * 10, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.22 + u * 0.38;
    ctx.fillStyle = u > 0.66 ? '#ff2018' : '#ff8a00';
    ctx.beginPath();
    ctx.ellipse(0, 0, 14 + u * reach * 0.85, 7 + u * 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = u > 0.66 ? '#ffe14a' : '#ffd080';
    ctx.strokeStyle = '#1a0c08';
    ctx.lineWidth = 4;
    ctx.font = 'bold 22px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeText('!', s.x, s.y - 36);
    ctx.fillText('!', s.x, s.y - 36);
    ctx.restore();
  }

  function drawPortalOverlay() {
    if (!game.map) return;
    const s = worldToScreen(game.map.stairsX, game.map.stairsY);
    const active = !!game.cleared;
    ctx.save();
    ctx.translate(s.x, s.y - 4);
    if (!active) {
      ctx.strokeStyle = 'rgba(120,100,80,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 6, 16, 8, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    const pulse = 0.45 + Math.sin(animT * 4) * 0.25;
    const rg = ctx.createRadialGradient(0, -6, 4, 0, -6, 42);
    rg.addColorStop(0, `rgba(255,220,120,${pulse})`);
    rg.addColorStop(0.45, `rgba(200,90,30,${pulse * 0.45})`);
    rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(0, -6, 42, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(0, -8);
      ctx.rotate(animT * (0.9 + i * 0.35) * (i % 2 ? -1 : 1));
      ctx.strokeStyle = i === 0 ? '#ffe090' : '#e07028';
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 8 + i * 6, 4 + i * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < 6; i++) {
      const a = animT * 2.2 + i * (Math.PI * 2 / 6);
      ctx.fillStyle = '#fff1c0';
      ctx.fillRect(Math.cos(a) * 18, -10 + Math.sin(a) * 8, 2, 2);
    }
    ctx.globalAlpha = 0.75 + pulse * 0.25;
    ctx.fillStyle = '#f0e0a0';
    ctx.font = 'bold 11px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('PORTAL', 0, -36);
    ctx.restore();
  }

  function drawPlayer(p) {
    const s = worldToScreen(p.x, p.y);
    const cls = Classes.get(p.classId);
    const c = cls.colors;
    const flash = p.hitFlash > 0.08;
    const moving = p.path && p.path.length > 0;
    const step = Math.sin(animT * (moving ? 11 : 2.2));
    const bob = moving ? Math.abs(step) * -1.6 : Math.sin(animT * 2.1) * 0.7;
    const pose = swingPose(p);

    const glow = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, 22);
    glow.addColorStop(0, 'rgba(0,0,0,0.28)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, 18, 7, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 4, 14, 5, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(s.x + pose * 2 * p.facing, s.y - 14 + bob);
    ctx.scale(p.facing * 1.2, 1.2);
    paintOutlined((outline) => {
      const ink = (hex) => (outline ? '#120c0a' : (flash ? '#fff' : hex));
      ink.outline = outline;
      if (p.classId === 'warrior') drawWarriorBody(c, ink, step, pose);
      else if (p.classId === 'rogue') drawRogueBody(c, ink, step, pose);
      else drawSorcererBody(c, ink, step, pose, p);
    });
    ctx.restore();

    if (p.hitFlash > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, p.hitFlash * 3.2)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - 16, 20, 26, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (p.life < p.maxLife) {
      const bw = 32;
      ctx.fillStyle = '#200808';
      ctx.fillRect(s.x - bw / 2, s.y - 48, bw, 4);
      ctx.fillStyle = '#c03030';
      ctx.fillRect(s.x - bw / 2, s.y - 48, bw * (p.life / p.maxLife), 4);
    }
  }

  function drawWarriorBody(c, ink, step, pose) {
    ctx.fillStyle = ink(c.cape);
    ctx.beginPath();
    ctx.moveTo(-14, -6);
    ctx.quadraticCurveTo(-20, 10, -8, 20);
    ctx.lineTo(8, 18);
    ctx.quadraticCurveTo(6, 6, 10, -4);
    ctx.fill();
    ctx.fillStyle = ink('#2a2018');
    ctx.fillRect(-7, 8, 5, 9 + step);
    ctx.fillRect(2, 8, 5, 9 - step);
    ctx.fillStyle = ink('#101218');
    ctx.fillRect(-12, -8, 24, 18);
    ctx.fillStyle = ink(c.armor);
    ctx.fillRect(-10, -6, 20, 16);
    ctx.fillStyle = ink(c.accent);
    ctx.beginPath(); ctx.arc(-12, -4, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(12, -4, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#3a2818');
    ctx.fillRect(-10, 6, 20, 3);
    ctx.fillStyle = ink(c.skin);
    ctx.beginPath(); ctx.arc(0, -14, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#9aa3b0');
    ctx.beginPath();
    ctx.moveTo(-8, -14); ctx.lineTo(-6, -24); ctx.lineTo(6, -24); ctx.lineTo(8, -14);
    ctx.fill();
    ctx.fillStyle = ink(c.accent);
    ctx.fillRect(-2, -29, 4, 6);
    ctx.fillStyle = ink('#1c2430');
    ctx.fillRect(-3, -16, 6, 2);
    ctx.fillStyle = ink('#5c6672');
    ctx.beginPath();
    ctx.moveTo(-14, 0); ctx.lineTo(-20, 12); ctx.lineTo(-10, 16); ctx.lineTo(-8, 2);
    ctx.fill();
    ctx.strokeStyle = ink(c.accent);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.save();
    ctx.translate(12, 0);
    ctx.rotate(-0.9 + pose * 1.35);
    ctx.fillStyle = ink(c.weapon);
    ctx.fillRect(0, -2.2, 22, 4.4);
    ctx.fillStyle = ink('#d0b050');
    ctx.fillRect(20, -3.4, 6, 7);
    ctx.restore();
  }

  function drawRogueBody(c, ink, step, pose) {
    ctx.fillStyle = ink('#071410');
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(11, -4);
    ctx.quadraticCurveTo(14, 12, 7, 20);
    ctx.lineTo(-7, 20);
    ctx.quadraticCurveTo(-16, 10, -11, -4);
    ctx.fill();
    ctx.fillStyle = ink(c.armor);
    ctx.fillRect(-5, -2, 10, 14);
    ctx.fillStyle = ink(c.accent);
    ctx.fillRect(-5, 6, 10, 2);
    ctx.fillStyle = ink('#1a1814');
    ctx.fillRect(-3, 10, 2.5, 8 + step * 2);
    ctx.fillRect(1, 10, 2.5, 8 - step * 2);
    ctx.fillStyle = ink(c.skin);
    ctx.beginPath(); ctx.arc(0, -10, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#0c1c16');
    ctx.beginPath(); ctx.arc(0, -12, 7.5, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    ctx.fillRect(-8, -12, 16, 3);
    ctx.fillStyle = ink('#e8d0b0');
    ctx.fillRect(-4, -8, 2, 1.4);
    ctx.save();
    ctx.translate(8, 2);
    ctx.rotate(-0.2 + pose * 1.5);
    ctx.fillStyle = ink(c.weapon);
    ctx.fillRect(0, -1.3, 15, 2.6);
    ctx.fillStyle = ink(c.accent);
    ctx.fillRect(13, -2.2, 3, 4.4);
    ctx.restore();
    ctx.save();
    ctx.translate(-6, 4);
    ctx.rotate(0.9 - pose * 1.2);
    ctx.fillStyle = ink(c.weapon);
    ctx.fillRect(0, -1.2, 13, 2.4);
    ctx.restore();
  }

  function drawSorcererBody(c, ink, step, pose, p) {
    const hem = Math.sin(animT * 2.4) * 2;
    ctx.fillStyle = ink(c.cape);
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(15, 18 + hem);
    ctx.lineTo(-15, 18 - hem);
    ctx.fill();
    ctx.fillStyle = ink(c.armor);
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(11, 16);
    ctx.lineTo(-11, 16);
    ctx.fill();
    ctx.strokeStyle = ink(c.accent);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, 4); ctx.lineTo(7, 4);
    ctx.stroke();
    ctx.fillStyle = ink(c.skin);
    ctx.beginPath(); ctx.arc(0, -16, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#140c28');
    ctx.beginPath();
    ctx.moveTo(-7, -16); ctx.lineTo(0, -32); ctx.lineTo(7, -16);
    ctx.fill();
    ctx.fillStyle = ink(c.accent);
    if (!ink.outline) {
      ctx.beginPath(); ctx.arc(0, -20, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    const charge = p.windup > 0 ? (1 - p.windup / (p.windupMax || 0.1)) : (0.45 + Math.sin(animT * 5) * 0.2);
    ctx.save();
    ctx.translate(8, 2);
    ctx.rotate(-0.35 + pose * 0.7);
    ctx.fillStyle = ink('#c8b090');
    ctx.fillRect(-1.4, -20, 2.8, 30);
    ctx.fillStyle = ink(c.weapon);
    ctx.beginPath(); ctx.arc(0, -22, 4.5 + charge * 2, 0, Math.PI * 2); ctx.fill();
    if (!ink.outline) {
      ctx.fillStyle = `rgba(190,210,255,${0.35 + charge * 0.45})`;
      ctx.beginPath(); ctx.arc(0, -22, 8 + charge * 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function paintOutlined(drawFn) {
    const o = 2.6;
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o]]) {
      ctx.save();
      ctx.translate(dx, dy);
      drawFn(true);
      ctx.restore();
    }
    drawFn(false);
  }

  function shadeHex(hex, f) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  }

  function drawNpc(n) {
    const s = worldToScreen(n.x, n.y);
    const bob = Math.sin(animT * 2 + n.bob) * 1.2;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 4, 14, 5, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(s.x, s.y - 10 + bob);
    ctx.scale(1.15, 1.15);
    paintOutlined((outline) => {
      const ink = (hex) => (outline ? '#120c0a' : hex);
      if (n.kind === 'hermit') drawHermitBody(ink);
      else if (n.kind === 'knight') drawKnightBody(ink);
      else drawWhisperBody(ink);
    });
    ctx.restore();

    ctx.textAlign = 'center';
    if (!n.talkedThrough) {
      const pulse = 0.5 + Math.sin(animT * 3) * 0.3;
      ctx.fillStyle = `rgba(220,180,100,${pulse})`;
      ctx.font = 'bold 14px Segoe UI';
      ctx.fillText('!', s.x, s.y - 36);
    }
    ctx.fillStyle = '#c0a080';
    ctx.font = '10px Segoe UI';
    ctx.fillText(n.name, s.x, s.y + 18);
  }

  function drawHermitBody(ink) {
    ctx.fillStyle = ink('#6a5344');
    ctx.beginPath();
    ctx.moveTo(-12, 16); ctx.lineTo(12, 16); ctx.lineTo(8, -4); ctx.lineTo(-8, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ink('#f0d2a8');
    ctx.beginPath(); ctx.arc(0, -10, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#3a2c22');
    ctx.beginPath(); ctx.moveTo(-9, -8); ctx.lineTo(0, -22); ctx.lineTo(9, -8); ctx.fill();
    ctx.fillStyle = ink('#c4a06a');
    ctx.fillRect(8, -6, 3, 18);
    ctx.fillStyle = ink('#1a100c');
    ctx.fillRect(-3, -11, 2, 2);
    ctx.fillRect(2, -11, 2, 2);
  }

  function drawKnightBody(ink) {
    ctx.fillStyle = ink('#8a94a4');
    ctx.fillRect(-9, -2, 18, 16);
    ctx.fillStyle = ink('#f0d2a8');
    ctx.beginPath(); ctx.arc(0, -12, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#b0bac6');
    ctx.fillRect(-8, -18, 16, 7);
    ctx.fillStyle = ink('#c02020');
    ctx.fillRect(-11, 4, 9, 5);
    ctx.fillStyle = ink('#d0d6de');
    ctx.fillRect(9, -8, 4, 20);
  }

  function drawWhisperBody(ink) {
    ctx.fillStyle = ink('#6a2848');
    ctx.beginPath();
    ctx.moveTo(0, -20); ctx.lineTo(12, 16); ctx.lineTo(0, 8); ctx.lineTo(-12, 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ink('#2a1018');
    ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(-12, -24); ctx.lineTo(-2, -14); ctx.fill();
    ctx.beginPath(); ctx.moveTo(6, -14); ctx.lineTo(12, -24); ctx.lineTo(2, -14); ctx.fill();
    ctx.fillStyle = ink('#ff5050');
    ctx.beginPath(); ctx.arc(-3, -6, 2.2, 0, Math.PI * 2); ctx.arc(3, -6, 2.2, 0, Math.PI * 2); ctx.fill();
  }

  function drawEnemy(en) {
    const s = worldToScreen(en.x, en.y);
    const flash = en.hitFlash > 0.06;
    const wind = en.windup > 0 && en.life > 0;
    const dead = en.life <= 0;
    const amp = en.eid === 'wraith' ? 4.2 : en.eid === 'imp' ? 2.6 : en.eid === 'brute' ? 1.1 : 1.5;
    const rate = en.eid === 'imp' ? 10 : en.eid === 'brute' ? 3.2 : 5;
    let bob = Math.sin(animT * rate + en.x * 2) * amp;
    if (wind) bob += Math.sin(animT * 28) * 0.7;
    const step = Math.sin(animT * rate + en.y);
    let alpha = 1;
    let sc = en.eid === 'brute' ? 1.28 : en.eid === 'imp' ? 1.05 : 1.12;
    if (dead) {
      const max = en.dissolveMax || 0.78;
      const u = Utils.clamp((en.dissolve || 0) / max, 0, 1);
      alpha = Math.max(0.15, u);
      sc *= 1 + (1 - u) * 1.15;
      ctx.save();
      ctx.globalAlpha = u;
      ctx.strokeStyle = u > 0.45 ? '#fff1c8' : '#ff8040';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y + 4, 12 + (1 - u) * 36, 6 + (1 - u) * 16, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (en.hitFlash > 0) {
      sc *= 1 + en.hitFlash * 0.7;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 4, 14 * (en.eid === 'brute' ? 1.3 : 1), 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(s.x, s.y + bob);
    ctx.scale((en.facing || 1) * sc, sc);
    ctx.translate(wind ? -2 : 0, en.eid === 'wraith' ? -18 : -12);
    paintOutlined((outline) => {
      const ink = (hex) => (outline ? '#120c0a' : (flash ? '#fff' : hex));
      if (en.eid === 'skel') drawSkeleton(ink, step, wind);
      else if (en.eid === 'imp') drawImp(ink, step, wind);
      else if (en.eid === 'brute') drawBrute(ink, step, wind);
      else drawWraith(ink, step, wind);
    });
    ctx.restore();

    if (!dead) {
      const barY = s.y - (en.eid === 'wraith' ? 54 : en.eid === 'brute' ? 48 : 40);
      const bw = en.eid === 'brute' ? 34 : 26;
      ctx.fillStyle = '#200808';
      ctx.fillRect(s.x - bw / 2, barY, bw, 3);
      ctx.fillStyle = '#c02828';
      ctx.fillRect(s.x - bw / 2, barY, bw * Utils.clamp(en.life / en.maxLife, 0, 1), 3);
    }
  }

  function drawSkeleton(ink, step, wind) {
    const bone = ink('#efe6d4');
    const dark = ink('#1a1210');
    ctx.strokeStyle = bone;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, 6); ctx.lineTo(-6 + step * 3, 16);
    ctx.moveTo(4, 6); ctx.lineTo(6 - step * 3, 16);
    ctx.moveTo(0, 6); ctx.lineTo(0, -10);
    ctx.stroke();
    ctx.fillStyle = bone;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0 + i * 3.2, 7 - i * 0.4, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.stroke();
    }
    ctx.fillStyle = bone;
    ctx.beginPath(); ctx.ellipse(0, -16, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-4, -18, 2.4, 3);
    ctx.fillRect(1.6, -18, 2.4, 3);
    ctx.fillStyle = bone;
    ctx.fillRect(-4, -10, 8, wind ? 4 : 2);
    const arm = wind ? -12 : step * 3;
    ctx.strokeStyle = bone;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, -4); ctx.lineTo(-14, 4);
    ctx.moveTo(7, -4); ctx.lineTo(16, wind ? -14 : 2 - arm * 0.2);
    ctx.stroke();
    ctx.save();
    ctx.translate(16, wind ? -14 : 2);
    ctx.rotate(wind ? -1.15 : -0.35 + step * 0.15);
    ctx.fillStyle = ink('#8d949c');
    ctx.fillRect(0, -1.3, wind ? 16 : 13, 2.6);
    ctx.restore();
  }

  function drawImp(ink, step, wind) {
    const wing = Math.sin(animT * 14) * 0.55;
    ctx.fillStyle = ink('#6a1418');
    ctx.save();
    ctx.translate(-8, -6);
    ctx.rotate(-0.7 + wing);
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(8, -6);
    ctx.rotate(0.7 - wing);
    ctx.beginPath(); ctx.ellipse(0, 0, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = ink('#d03828');
    ctx.beginPath(); ctx.ellipse(0, 2, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#e87848');
    ctx.beginPath(); ctx.ellipse(0, 4, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#2a1010');
    ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(-11, -18); ctx.lineTo(-1, -8); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(11, -18); ctx.lineTo(1, -8); ctx.fill();
    ctx.fillStyle = ink('#ffe060');
    ctx.beginPath(); ctx.arc(-3, -1, 2.2, 0, Math.PI * 2); ctx.arc(3, -1, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#201008');
    ctx.beginPath(); ctx.arc(-3, -1, 1, 0, Math.PI * 2); ctx.arc(3, -1, 1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ink('#d03828');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, 10);
    ctx.quadraticCurveTo(-14, 14 + step * 2, -16, 4);
    ctx.stroke();
    ctx.strokeStyle = ink('#ffd0a0');
    ctx.beginPath();
    if (wind) {
      ctx.moveTo(-6, 0); ctx.lineTo(-13, -10);
      ctx.moveTo(6, 0); ctx.lineTo(13, -10);
    } else {
      ctx.moveTo(-6, 4); ctx.lineTo(-11, 8);
      ctx.moveTo(6, 4); ctx.lineTo(11, 8);
    }
    ctx.stroke();
  }

  function drawBrute(ink, step, wind) {
    ctx.fillStyle = ink('#3a2a22');
    ctx.fillRect(-9, 10, 7, 8 + step * 2);
    ctx.fillRect(3, 10, 7, 8 - step * 2);
    ctx.fillStyle = ink('#5c4638');
    ctx.beginPath();
    ctx.moveTo(-16, 12);
    ctx.lineTo(-18, -8);
    ctx.lineTo(-8, -16);
    ctx.lineTo(12, -18);
    ctx.lineTo(18, -2);
    ctx.lineTo(16, 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ink('#2a2018');
    ctx.beginPath(); ctx.moveTo(-10, -14); ctx.lineTo(-14, -26); ctx.lineTo(-2, -14); ctx.fill();
    ctx.beginPath(); ctx.moveTo(2, -16); ctx.lineTo(6, -28); ctx.lineTo(12, -14); ctx.fill();
    ctx.fillStyle = ink('#6a5040');
    ctx.beginPath(); ctx.arc(6, -8, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#e8dcc0');
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(-2, 6); ctx.lineTo(4, -2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(12, 6); ctx.lineTo(6, -2); ctx.fill();
    ctx.fillStyle = ink('#ff5030');
    ctx.beginPath(); ctx.arc(8, -10, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(16, wind ? -10 : 2);
    ctx.rotate(wind ? -1.15 : 0.45);
    ctx.fillStyle = ink('#6a5030');
    ctx.fillRect(0, -3, 20, 6);
    ctx.fillStyle = ink('#4a3828');
    ctx.beginPath(); ctx.arc(20, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawWraith(ink, step, wind) {
    ctx.globalAlpha *= 0.78 + Math.sin(animT * 3) * 0.1;
    const hem = (i) => Math.sin(animT * 3 + i) * 3;
    ctx.fillStyle = ink('#7ea6c4');
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.quadraticCurveTo(16, -6, 10, 10 + hem(1));
    ctx.lineTo(4, 16 + hem(2));
    ctx.lineTo(0, 8);
    ctx.lineTo(-4, 16 + hem(3));
    ctx.lineTo(-10, 10 + hem(4));
    ctx.quadraticCurveTo(-16, -6, 0, -28);
    ctx.fill();
    ctx.fillStyle = ink('#0c1820');
    ctx.beginPath(); ctx.ellipse(0, -12, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink('#e8ffff');
    const eye = wind ? 1.8 : 1.3;
    ctx.beginPath();
    ctx.arc(-3, -12, eye, 0, Math.PI * 2);
    ctx.arc(3, -12, eye, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink('#e4f4ff');
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (wind) {
      ctx.moveTo(-6, -2); ctx.lineTo(-2, 12);
      ctx.moveTo(6, -2); ctx.lineTo(2, 12);
    } else {
      ctx.moveTo(-8, 0); ctx.lineTo(-16, 8 + hem(0));
      ctx.moveTo(8, 0); ctx.lineTo(16, 8 + hem(2));
    }
    ctx.stroke();
  }

  function drawDrop(d) {
    const s = worldToScreen(d.x, d.y);
    const bob = Math.sin(animT * 5 + d.x * 3) * 3;
    if (d.type === 'gold') {
      ctx.fillStyle = 'rgba(255,220,80,0.28)';
      ctx.beginPath(); ctx.arc(s.x, s.y - 4 + bob, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0d050';
      ctx.beginPath(); ctx.ellipse(s.x, s.y - 4 + bob, 5.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff6c0';
      ctx.fillRect(s.x - 1, s.y - 8 + bob, 2, 7);
      ctx.fillRect(s.x - 3, s.y - 5 + bob, 6, 2);
      for (let i = 0; i < 3; i++) {
        const a = animT * 4 + i * 2.1 + d.x;
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = '#fff8d0';
        ctx.fillRect(s.x + Math.cos(a) * 10, s.y - 6 + bob + Math.sin(a) * 5, 2, 2);
      }
      ctx.globalAlpha = 1;
    } else {
      const col = Loot.RARITY[d.item.rarity].color;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.arc(s.x, s.y - 6 + bob, 14, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#1a1010';
      ctx.fillRect(s.x - 7, s.y - 13 + bob, 14, 14);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x - 7, s.y - 13 + bob, 14, 14);
      ctx.fillStyle = col;
      ctx.font = '11px serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.item.icon, s.x, s.y - 2 + bob);
      const bits = d.item.rarity === 'rare' ? 4 : 3;
      for (let i = 0; i < bits; i++) {
        const a = animT * 3 + i * (Math.PI * 2 / bits) + d.y;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = col;
        ctx.fillRect(s.x + Math.cos(a) * 12, s.y - 8 + bob + Math.sin(a) * 7, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawMinimap() {
    const map = game.map;
    const scale = canvas.width < 500 ? 1.6 : 2.2;
    const mw = map.w * scale;
    const mh = map.h * scale;
    const ox = canvas.width - mw - 10;
    const oy = 10;
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(10,8,8,0.75)';
    ctx.fillRect(ox - 4, oy - 4, mw + 8, mh + 8);
    ctx.strokeStyle = '#5a4030';
    ctx.strokeRect(ox - 4, oy - 4, mw + 8, mh + 8);
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (map.grid[y][x] === map.TILE.WALL) continue;
        ctx.fillStyle = map.grid[y][x] === map.TILE.STAIRS ? '#c0a040' : '#3a3028';
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
    for (const n of game.npcs) {
      ctx.fillStyle = '#e0c060';
      ctx.fillRect(ox + n.x * scale - 1, oy + n.y * scale - 1, 3, 3);
    }
    for (const en of game.enemies) {
      if (en.life <= 0) continue;
      ctx.fillStyle = '#c03030';
      ctx.fillRect(ox + en.x * scale - 1, oy + en.y * scale - 1, 3, 3);
    }
    ctx.fillStyle = '#40e080';
    ctx.fillRect(ox + game.player.x * scale - 1.5, oy + game.player.y * scale - 1.5, 4, 4);
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    game.shakePhase = (game.shakePhase || 0) + dt * 48;
    const hold = game.hitStop > 0 && game.state === 'playing' && !panelsOpen();
    if (hold) {
      game.hitStop -= dt;
      if (game.hitStop < 0) game.hitStop = 0;
    } else {
      // A menu or pause should not bank a freeze-frame for later.
      if (panelsOpen() || game.state !== 'playing') game.hitStop = 0;
      if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 18);
      if (game.hurtFlash > 0) game.hurtFlash = Math.max(0, game.hurtFlash - dt * 1.35);
      if (game.impactFlash > 0) game.impactFlash = Math.max(0, game.impactFlash - dt * 1.6);
      animT += dt;
      update(dt);
    }
    draw();
    requestAnimationFrame(frame);
  }

  function closeDialogue() {
    UI.hide('dialogue-box');
    if (game.state === 'dialogue') game.state = 'playing';
    talkingNpc = null;
  }

  function onKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      e.preventDefault();
      if (game.state === 'dialogue') { closeDialogue(); return; }
      if (game.state === 'playing') {
        if (UI.isVisible('inv-panel') || UI.isVisible('skill-panel')) {
          UI.hide('inv-panel'); UI.hide('skill-panel');
        } else {
          game.state = 'paused';
          UI.show('pause-screen');
        }
      } else if (game.state === 'paused') {
        game.state = 'playing';
        UI.hide('pause-screen');
      }
      return;
    }
    if (game.state === 'dialogue' && (k === 'enter' || k === ' ')) {
      e.preventDefault();
      UI.advanceDialogue();
      if (!UI.isDialogueOpen()) {
        closeDialogue();
        persist('talk');
      }
      return;
    }
    if (game.state !== 'playing') return;
    if (k === 'i') { e.preventDefault(); UI.togglePanel(game, 'inv-panel'); }
    if (k === 'k') { e.preventDefault(); UI.togglePanel(game, 'skill-panel'); }
  }

  function bind() {
    UI.init();
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 100));

    // Lock page scroll on mobile. iOS Safari rubber-bands the document unless
    // touchmove is cancelled on a non-passive document listener. Overflow
    // inside inventory, the skill tree, and class select may still scroll,
    // including from a nested scroller into its parent panel, but not into the page.
    const INNER_SCROLL = '.side-panel, .select-panel, .panel, #inv-grid';
    let touchStartY = 0;
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length) touchStartY = e.touches[0].clientY;
    }, { passive: true, capture: true });

    function scrollableInDirection(el, dy) {
      let node = el && el.nodeType === 1 ? el : el && el.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.matches && node.matches(INNER_SCROLL)) {
          const oy = getComputedStyle(node).overflowY;
          const canScroll = (oy === 'auto' || oy === 'scroll' || oy === 'overlay')
            && node.scrollHeight > node.clientHeight + 2;
          if (canScroll) {
            const atTop = node.scrollTop <= 0;
            const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
            if (dy > 0 && !atTop) return true;
            if (dy < 0 && !atBottom) return true;
            if (dy === 0 && (!atTop || !atBottom)) return true;
          }
        }
        node = node.parentElement;
      }
      return false;
    }

    document.addEventListener('touchmove', (e) => {
      const y = e.touches && e.touches.length ? e.touches[0].clientY : touchStartY;
      if (!scrollableInDirection(e.target, y - touchStartY)) e.preventDefault();
    }, { passive: false, capture: true });
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });

    UI.refreshContinue();

    UI.els['btn-continue']?.addEventListener('click', () => {
      continueRun();
    });
    UI.els['btn-choose'].addEventListener('click', () => {
      UI.hide('title-screen');
      UI.show('select-screen');
      game.state = 'select';
    });
    UI.els['btn-back-title'].addEventListener('click', () => {
      UI.hide('select-screen');
      UI.show('title-screen');
      game.state = 'title';
    });
    UI.els['btn-start'].addEventListener('click', () => {
      game.selectedClass = UI.getSelectedClass();
      if (!game.selectedClass) return;
      startRun(false);
    });
    UI.els['btn-resume'].addEventListener('click', () => {
      game.state = 'playing';
      UI.hide('pause-screen');
      persist('pause');
    });
    UI.els['btn-save']?.addEventListener('click', () => {
      persist('manual');
      UI.refreshContinue();
    });
    UI.els['btn-restart'].addEventListener('click', () => {
      UI.hide('pause-screen');
      UI.hide('hud');
      abandonRun();
      UI.show('select-screen');
      game.state = 'select';
    });
    UI.els['btn-retry-floor'].addEventListener('click', () => {
      const p = game.player;
      p.life = p.maxLife;
      game.deathStinger = false;
      loadFloor(game.floor);
      game.state = 'playing';
      UI.hide('death-screen');
      UI.log('Rising again on this floor...', 'danger');
      persist('retry');
    });
    UI.els['btn-full-restart'].addEventListener('click', () => {
      UI.hide('death-screen');
      UI.hide('hud');
      abandonRun();
      UI.show('select-screen');
      game.state = 'select';
    });
    UI.els['btn-inv'].addEventListener('click', () => {
      if (game.state === 'playing' || game.state === 'dialogue') {
        if (game.state === 'dialogue') closeDialogue();
        UI.togglePanel(game, 'inv-panel');
      }
    });
    UI.els['btn-skills'].addEventListener('click', () => {
      if (game.state === 'playing' || game.state === 'dialogue') {
        if (game.state === 'dialogue') closeDialogue();
        UI.togglePanel(game, 'skill-panel');
      }
    });
    UI.els['btn-pause'].addEventListener('click', () => {
      if (game.state === 'dialogue') closeDialogue();
      if (game.state === 'playing') {
        game.state = 'paused';
        UI.show('pause-screen');
        persist('pause');
      }
    });
    UI.els['dlg-next'].addEventListener('click', () => {
      UI.advanceDialogue();
      if (!UI.isDialogueOpen()) {
        closeDialogue();
        persist('talk');
      }
    });

    // Prefer Pointer Events; fall back to touch/mouse. Guard against double-fire.
    let lastPtr = 0;
    function guardedPointer(e) {
      const now = performance.now();
      if (now - lastPtr < 80) { e.preventDefault(); return; }
      lastPtr = now;
      handlePointer(e);
    }
    if (window.PointerEvent) {
      canvas.addEventListener('pointerdown', guardedPointer);
    } else {
      canvas.addEventListener('touchstart', guardedPointer, { passive: false });
      canvas.addEventListener('mousedown', guardedPointer);
    }
    // Still block default touch gestures on canvas
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener('gesturestart', (e) => e.preventDefault());
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', () => {
      if (game.player && (game.state === 'playing' || game.state === 'paused' || game.state === 'dialogue' || game.state === 'dead')) {
        Save.write(game);
      }
    });
  }

  bind();
  requestAnimationFrame(frame);
})();
