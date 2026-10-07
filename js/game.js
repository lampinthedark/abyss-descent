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

  function loadFloor(floor) {
    game.floor = floor;
    game.map = MapGen.create(floor);
    game.enemies = Entities.spawnWave(game.map, floor);
    game.npcs = Npc.createForFloor(game.map, floor);
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
    const tip = game.player.questTip || 'Continue the descent.';
    UI.setQuestTip(tip, game.player);
    UI.updateHud(game);
    UI.log(`Continued — Floor ${game.floor}, Lv ${game.player.level}.`, 'story');
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

    let nearest = null, nd = 1.35;
    for (const en of game.enemies) {
      const d = Utils.dist(world.x, world.y, en.x, en.y);
      if (d < nd) { nd = d; nearest = en; }
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

  function setPath(tx, ty) {
    const p = game.player;
    p.path = Utils.pathfind(p.x, p.y, tx, ty, (x, y) => game.map.walkable(x + 0.5, y + 0.5))
      .map(n => ({ x: n.x + 0.5, y: n.y + 0.5 }));
    if (!p.path.length && game.map.walkable(tx, ty)) {
      p.path = [{ x: tx, y: ty }];
    }
  }

  function update(dt) {
    if (game.state === 'dialogue') return;
    if (game.state !== 'playing') return;
    animT += dt;
    const p = game.player;
    const st = Entities.playerStats(p);
    p.maxLife = st.maxLife;
    if (p.life > p.maxLife) p.life = p.maxLife;

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
          return;
        }
      }
    }

    if (!p.targetEnemy || p.targetEnemy.life <= 0) {
      p.targetEnemy = null;
      if (!p.path.length && !p.useProjectile) {
        let best = null, bd = attackRange + 0.4;
        for (const en of game.enemies) {
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
      }
    } else if (p.targetEnemy) {
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

    if (p.targetEnemy && p.targetEnemy.life > 0) {
      const en = p.targetEnemy;
      const d = Utils.dist(p.x, p.y, en.x, en.y);
      if (d <= attackRange && p.attackCd <= 0) {
        doPlayerAttack(p, en, st);
        p.attackCd = 1 / st.aspd;
        p.swingAnim = 0.2;
        p.facing = en.x >= p.x ? 1 : -1;
      }
    }

    // projectiles
    for (let i = game.projectiles.length - 1; i >= 0; i--) {
      const pr = game.projectiles[i];
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      let hit = false;
      for (const en of game.enemies) {
        if (Utils.dist(pr.x, pr.y, en.x, en.y) < 0.45) {
          applyDamageToEnemy(p, en, pr.dmg, st, pr.color);
          hit = true;
          spawnMagicBurst(en.x, en.y, pr.color);
          break;
        }
      }
      if (hit || pr.life <= 0 || !game.map.walkable(pr.x, pr.y)) {
        game.projectiles.splice(i, 1);
      }
    }

    for (const en of game.enemies) updateEnemy(en, dt, p, st);
    game.enemies = game.enemies.filter(e => e.life > 0);

    for (let i = game.drops.length - 1; i >= 0; i--) {
      const d = game.drops[i];
      if (Utils.dist(p.x, p.y, d.x, d.y) < 0.7) {
        if (d.type === 'gold') {
          const amt = Math.round(d.amount * st.goldMult);
          p.gold += amt;
          UI.log(`+${amt} gold`, 'loot');
          spawnFloat(d.x, d.y, `+${amt}`, '#e0c060');
          spawnLootSparkles(d.x, d.y, '#e0c060');
        } else if (d.type === 'item') {
          p.inventory.push(d.item);
          UI.log(`${d.item.name}`, d.item.rarity);
          spawnFloat(d.x, d.y, d.item.name, Loot.RARITY[d.item.rarity].color);
          spawnLootSparkles(d.x, d.y, Loot.RARITY[d.item.rarity].color);
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
      f.y -= dt * 0.6;
      return f.life > 0;
    });

    if (!game.cleared && game.enemies.length === 0) {
      game.cleared = true;
      UI.log('Floor cleared! Find the portal.', 'level');
      UI.setQuestTip('Find the glowing portal and descend.', p);
    }
    if (game.cleared && game.map.isStairs(p.x, p.y)) {
      game.floor++;
      const heal = Math.round(p.maxLife * 0.35);
      p.life = Math.min(p.maxLife, p.life + heal);
      loadFloor(game.floor);
      UI.log(`Descending to Floor ${game.floor}...`, 'level');
      UI.setQuestTip('Seek survivors — then cleanse and descend.', p);
      UI.updateHud(game);
      persist('floor');
    }

    if (p.life <= 0) {
      p.life = 0;
      game.state = 'dead';
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
      const speed = 7.5;
      let dmg = st.dmg * Utils.rand(p.dmgVar[0], p.dmgVar[1]);
      dmg = Math.round(dmg);
      const col = Classes.get(p.classId).colors.accent;
      game.projectiles.push({
        x: p.x, y: p.y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 1.2,
        dmg,
        color: col,
      });
      spawnHitParticles(p.x, p.y, col);
      return;
    }
    const targets = [primary];
    if (st.cleave > 0) {
      for (const en of game.enemies) {
        if (en === primary) continue;
        if (Utils.dist(primary.x, primary.y, en.x, en.y) <= st.cleave + 0.3) targets.push(en);
      }
    }
    for (const en of targets) {
      let dmg = st.dmg * Utils.rand(p.dmgVar[0], p.dmgVar[1]);
      if (en !== primary) dmg *= 0.6;
      dmg = Math.round(dmg);
      applyDamageToEnemy(p, en, dmg, st, '#f0e0c0');
    }
  }

  function applyDamageToEnemy(p, en, dmg, st, floatColor) {
    en.life -= dmg;
    en.hitFlash = 0.15;
    spawnFloat(en.x, en.y - 0.2, '-' + dmg, floatColor || '#f0e0c0');
    spawnHitParticles(en.x, en.y, en.color);
    if (st.lifesteal > 0) {
      const heal = Math.max(1, Math.round(dmg * st.lifesteal));
      p.life = Math.min(p.maxLife, p.life + heal);
    }
    if (en.life <= 0) onEnemyKilled(en);
  }

  function onEnemyKilled(en) {
    const p = game.player;
    const leveled = Entities.gainXp(p, en.xp);
    spawnHitParticles(en.x, en.y, '#e06040');
    const drops = Loot.dropFromEnemy(en, game.floor);
    for (const d of drops) game.drops.push(d);
    if (leveled) {
      UI.log(`Level up! Now Lv ${p.level} — skill point gained.`, 'level');
      spawnFloat(p.x, p.y - 0.5, 'LEVEL UP!', '#60e080');
    }
  }

  function updateEnemy(en, dt, p, st) {
    if (en.hitFlash > 0) en.hitFlash -= dt;
    if (en.attackCd > 0) en.attackCd -= dt;
    const d = Utils.dist(en.x, en.y, p.x, p.y);
    if (d < 9) en.aggro = true;
    if (!en.aggro) return;
    if (d > 0.75) {
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
    } else if (en.attackCd <= 0 && p.invuln <= 0) {
      let dmg = Math.max(1, en.dmg - st.armor * 0.4);
      dmg = Math.round(dmg * Utils.rand(0.9, 1.1));
      p.life -= dmg;
      p.hitFlash = 0.2;
      p.invuln = 0.35;
      en.attackCd = 0.85;
      spawnFloat(p.x, p.y - 0.3, '-' + dmg, '#e04040');
    }
  }

  function spawnFloat(x, y, text, color) {
    game.floatTexts.push({ x, y, text, color, life: 0.9 });
  }
  function spawnHitParticles(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Utils.rand(1.2, 3.5);
      game.particles.push({
        x, y, vx: Math.cos(a) * sp * 0.45, vy: Math.sin(a) * sp * 0.45 - 0.6,
        g: 2.2, life: Utils.rand(0.2, 0.5), color, size: Utils.rand(2, 5),
      });
    }
  }
  function spawnMagicBurst(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      game.particles.push({
        x, y, vx: Math.cos(a) * Utils.rand(0.8, 2.5), vy: Math.sin(a) * Utils.rand(0.8, 2.5) - 0.3,
        g: 0.5, life: Utils.rand(0.25, 0.55), color, size: Utils.rand(2, 6), glow: true,
      });
    }
  }
  function spawnLootSparkles(x, y, color) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      game.particles.push({
        x, y, vx: Math.cos(a) * Utils.rand(0.3, 1.5), vy: Math.sin(a) * Utils.rand(0.3, 1.5) - 1,
        g: 1.5, life: Utils.rand(0.4, 0.8), color, size: Utils.rand(1.5, 3.5), glow: true,
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

    drawMap();
    const sprites = [];
    for (const n of game.npcs) sprites.push({ kind: 'npc', ref: n, depth: n.x + n.y });
    for (const d of game.drops) sprites.push({ kind: 'drop', ref: d, depth: d.x + d.y });
    for (const en of game.enemies) sprites.push({ kind: 'enemy', ref: en, depth: en.x + en.y });
    sprites.push({ kind: 'player', ref: game.player, depth: game.player.x + game.player.y });
    sprites.sort((a, b) => a.depth - b.depth);
    for (const s of sprites) {
      if (s.kind === 'drop') drawDrop(s.ref);
      else if (s.kind === 'enemy') drawEnemy(s.ref);
      else if (s.kind === 'npc') drawNpc(s.ref);
      else drawPlayer(s.ref);
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
      ctx.globalAlpha = Utils.clamp(pt.life * 3, 0, 1);
      if (pt.glow) {
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, pt.size * 2);
        g.addColorStop(0, pt.color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, pt.size * 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, pt.size, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const f of game.floatTexts) {
      const s = worldToScreen(f.x, f.y);
      ctx.globalAlpha = Utils.clamp(f.life * 2, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, s.x, s.y);
      ctx.globalAlpha = 1;
    }

    if (game.cleared) {
      const s = worldToScreen(game.map.stairsX, game.map.stairsY);
      const pulse = 0.45 + Math.sin(animT * 4) * 0.25;
      const rg = ctx.createRadialGradient(s.x, s.y - 8, 4, s.x, s.y - 8, 36);
      rg.addColorStop(0, `rgba(255,220,120,${pulse})`);
      rg.addColorStop(0.5, `rgba(200,120,40,${pulse * 0.5})`);
      rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(s.x, s.y - 8, 36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0e0a0';
      ctx.font = 'bold 11px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('PORTAL', s.x, s.y - 34);
    }

    drawMinimap();
    drawVignette(0.4);
  }

  function drawVignette(strength) {
    const g = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.25,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.72
    );
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawTitleBackdrop() {
    for (let i = 0; i < 48; i++) {
      const tx = (i % 8) + Math.sin(animT * 0.15 + i) * 0.08;
      const ty = Math.floor(i / 8) + 1.5;
      const s = {
        x: canvas.width / 2 + (tx - ty) * 32,
        y: canvas.height / 2 + (tx + ty) * 16 - 90,
      };
      const col = i % 5 === 0 ? '#2a1e1c' : '#1a1412';
      drawDiamond(s.x, s.y, 64, 32, col, '#0a0808');
      if (i % 7 === 0) {
        ctx.fillStyle = 'rgba(120,30,20,0.15)';
        ctx.beginPath(); ctx.ellipse(s.x, s.y + 4, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // floating ember particles
    for (let i = 0; i < 6; i++) {
      const x = canvas.width * (0.2 + (i * 0.12)) + Math.sin(animT + i) * 20;
      const y = canvas.height * 0.3 + Math.cos(animT * 0.7 + i) * 40;
      ctx.fillStyle = `rgba(220,80,40,${0.3 + Math.sin(animT * 3 + i) * 0.2})`;
      ctx.beginPath(); ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2); ctx.fill();
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
        const sx = top.x + game.camX;
        const sy = top.y + game.camY;
        const dist = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        const light = Utils.clamp(1.2 - dist / 10, 0.12, 1);
        const torch = 0.04 * Math.sin(animT * 3 + x * 0.7 + y);

        if (tile === map.TILE.WALL) {
          const base = shade('#1a1412', light * 0.7 + torch);
          drawDiamond(sx + TILE_W / 2, sy + TILE_H / 2, TILE_W, TILE_H, base, shade('#0a0808', light));
          ctx.fillStyle = shade('#2c2420', light + torch);
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
          drawDiamond(sx + TILE_W / 2, sy - 20 + TILE_H / 2, TILE_W, TILE_H, shade('#3e342c', light + torch), shade('#1a1410', light));
          // brick lines
          ctx.strokeStyle = shade('#1e1814', light);
          ctx.beginPath();
          ctx.moveTo(sx + 8, sy + TILE_H / 2 - 10);
          ctx.lineTo(sx + TILE_W - 8, sy + TILE_H / 2 - 10);
          ctx.stroke();
        } else {
          const isStairs = tile === map.TILE.STAIRS;
          let col = (x + y) % 2 === 0 ? '#322824' : '#2a221e';
          if (isStairs) col = game.cleared ? '#4a3a18' : '#3a3228';
          // blood / cracks
          const seed = (x * 17 + y * 31) % 11;
          if (seed === 0) col = '#3a2018';
          drawDiamond(sx + TILE_W / 2, sy + TILE_H / 2, TILE_W, TILE_H, shade(col, light + torch), shade('#12100e', light));
          if (seed === 2 || seed === 5) {
            ctx.strokeStyle = shade('#1a1210', light);
            ctx.beginPath();
            ctx.moveTo(sx + TILE_W * 0.28, sy + TILE_H * 0.35);
            ctx.lineTo(sx + TILE_W * 0.5, sy + TILE_H * 0.55);
            ctx.lineTo(sx + TILE_W * 0.62, sy + TILE_H * 0.42);
            ctx.stroke();
          }
          if (seed === 0) {
            ctx.fillStyle = shade('#4a1810', light * 0.8);
            ctx.beginPath();
            ctx.ellipse(sx + TILE_W * 0.45, sy + TILE_H * 0.5, 8, 4, 0.3, 0, Math.PI * 2);
            ctx.fill();
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

  function drawPlayer(p) {
    const s = worldToScreen(p.x, p.y);
    const cls = Classes.get(p.classId);
    const c = cls.colors;
    const flash = p.hitFlash > 0;
    const bob = Math.sin(animT * 8) * (p.path.length ? 1.5 : 0.3);

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 4, 15, 6, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(s.x, s.y - 10 + bob);
    ctx.scale(p.facing, 1);

    // cape layered
    ctx.fillStyle = flash ? '#fff' : c.cape;
    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.quadraticCurveTo(-14, 8, -6, 18);
    ctx.lineTo(6, 16);
    ctx.quadraticCurveTo(4, 6, 8, 0);
    ctx.closePath();
    ctx.fill();

    // legs
    ctx.fillStyle = flash ? '#fff' : shadeHex(c.armor, 0.75);
    ctx.fillRect(-6, 8, 4, 8);
    ctx.fillRect(2, 8, 4, 8);

    // torso + armor plates
    ctx.fillStyle = flash ? '#fff' : c.armor;
    ctx.fillRect(-8, -4, 16, 14);
    ctx.fillStyle = flash ? '#fff' : c.accent;
    ctx.fillRect(-11, -5, 5, 7);
    ctx.fillRect(6, -5, 5, 7);
    // belt
    ctx.fillStyle = flash ? '#fff' : '#3a2818';
    ctx.fillRect(-8, 6, 16, 3);

    // head + hair/helm
    ctx.fillStyle = flash ? '#fff' : c.skin;
    ctx.beginPath(); ctx.arc(0, -11, 7, 0, Math.PI * 2); ctx.fill();

    if (p.classId === 'warrior') {
      ctx.fillStyle = flash ? '#fff' : '#8890a0';
      ctx.beginPath();
      ctx.moveTo(-8, -12); ctx.lineTo(-6, -20); ctx.lineTo(6, -20); ctx.lineTo(8, -12);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = flash ? '#fff' : c.accent;
      ctx.fillRect(-2, -24, 4, 5);
    } else if (p.classId === 'rogue') {
      ctx.fillStyle = flash ? '#fff' : '#1a2820';
      ctx.beginPath(); ctx.arc(0, -11, 8, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
      ctx.fillRect(-8, -12, 16, 4);
    } else {
      ctx.fillStyle = flash ? '#fff' : '#2a1840';
      ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(0, -22); ctx.lineTo(6, -14); ctx.fill();
      ctx.fillStyle = flash ? '#fff' : c.accent;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(0, -18, 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // weapon
    const swing = p.swingAnim > 0 ? (0.2 - p.swingAnim) / 0.2 : 0;
    ctx.save();
    if (p.classId === 'rogue') {
      ctx.translate(9, 2); ctx.rotate(-0.5 + swing * 1.6);
      ctx.fillStyle = flash ? '#fff' : c.weapon;
      ctx.fillRect(0, -1.5, 14, 3);
      ctx.fillStyle = c.accent; ctx.fillRect(12, -2.5, 4, 5);
      ctx.restore();
      ctx.save();
      ctx.translate(-4, 4); ctx.rotate(0.8 - swing * 1.2);
      ctx.fillStyle = flash ? '#fff' : c.weapon;
      ctx.fillRect(0, -1.5, 12, 2.5);
    } else if (p.classId === 'sorcerer') {
      ctx.translate(6, 4); ctx.rotate(-0.3);
      ctx.fillStyle = flash ? '#fff' : c.weapon;
      ctx.fillRect(-1.5, -18, 3, 28);
      ctx.beginPath(); ctx.arc(0, -20, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(100,140,255,${0.4 + Math.sin(animT * 5) * 0.2})`;
      ctx.beginPath(); ctx.arc(0, -20, 9, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.translate(9, 2); ctx.rotate(-0.55 + swing * 1.9);
      ctx.fillStyle = flash ? '#fff' : c.weapon;
      ctx.fillRect(0, -2, 20, 4);
      ctx.fillStyle = '#a09040'; ctx.fillRect(18, -3.5, 6, 7);
      // shield
      ctx.restore();
      ctx.save();
      ctx.translate(-10, 2);
      ctx.fillStyle = flash ? '#fff' : '#505868';
      ctx.beginPath(); ctx.ellipse(0, 4, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    ctx.restore();

    if (p.life < p.maxLife) {
      const bw = 30;
      ctx.fillStyle = '#200808';
      ctx.fillRect(s.x - bw / 2, s.y - 38, bw, 4);
      ctx.fillStyle = '#c03030';
      ctx.fillRect(s.x - bw / 2, s.y - 38, bw * (p.life / p.maxLife), 4);
    }
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
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 4, 12, 5, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(s.x, s.y - 8 + bob);

    if (n.kind === 'hermit') {
      ctx.fillStyle = '#3a3028';
      ctx.beginPath(); ctx.moveTo(-10, 14); ctx.lineTo(10, 14); ctx.lineTo(6, -2); ctx.lineTo(-6, -2); ctx.fill();
      ctx.fillStyle = '#c0a880';
      ctx.beginPath(); ctx.arc(0, -8, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a2018';
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(0, -18); ctx.lineTo(8, -6); ctx.fill();
      ctx.fillStyle = '#806040';
      ctx.fillRect(6, -4, 2, 16);
    } else if (n.kind === 'knight') {
      ctx.fillStyle = '#505868';
      ctx.fillRect(-8, -2, 16, 14);
      ctx.fillStyle = '#c0a880';
      ctx.beginPath(); ctx.arc(0, -10, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#708090';
      ctx.fillRect(-7, -16, 14, 6);
      ctx.fillStyle = '#801818';
      ctx.fillRect(-10, 4, 8, 4); // wound
      ctx.fillStyle = '#a0a8b0';
      ctx.fillRect(8, -6, 3, 18);
    } else {
      // whispering demon
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#401828';
      ctx.beginPath();
      ctx.moveTo(0, -18); ctx.quadraticCurveTo(16, 0, 4, 14);
      ctx.quadraticCurveTo(0, 8, -4, 14); ctx.quadraticCurveTo(-16, 0, 0, -18);
      ctx.fill();
      // horns
      ctx.fillStyle = '#201010';
      ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-12, -22); ctx.lineTo(-2, -14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, -12); ctx.lineTo(12, -22); ctx.lineTo(2, -14); ctx.fill();
      // wings
      ctx.fillStyle = 'rgba(60,20,40,0.6)';
      ctx.beginPath(); ctx.ellipse(-14, 0, 10, 6, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(14, 0, 10, 6, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e04040';
      ctx.beginPath(); ctx.arc(-3, -6, 2, 0, Math.PI * 2); ctx.arc(3, -6, 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // talk indicator
    const pulse = 0.5 + Math.sin(animT * 3) * 0.3;
    ctx.fillStyle = `rgba(220,180,100,${pulse})`;
    ctx.font = 'bold 14px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('!', s.x, s.y - 36);
    ctx.fillStyle = '#c0a080';
    ctx.font = '10px Segoe UI';
    ctx.fillText(n.name, s.x, s.y + 16);
  }

  function drawEnemy(en) {
    const s = worldToScreen(en.x, en.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y + 3, 12 * (en.radius / 0.32), 5, 0, 0, Math.PI * 2); ctx.fill();
    const flash = en.hitFlash > 0;
    const bob = Math.sin(animT * 6 + en.x) * 1;
    ctx.save();
    ctx.translate(s.x, s.y - 8 + bob);

    if (en.eid === 'skel') {
      ctx.fillStyle = flash ? '#fff' : en.color;
      // ribcage
      ctx.fillRect(-6, -2, 12, 12);
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = flash ? '#fff' : '#1a1010';
        ctx.beginPath(); ctx.moveTo(-5, i * 3); ctx.lineTo(5, i * 3); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, -10, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1010';
      ctx.fillRect(-3, -11, 2, 2); ctx.fillRect(1, -11, 2, 2);
      // bone arms
      ctx.fillStyle = flash ? '#fff' : en.color;
      ctx.fillRect(-12, 0, 6, 2); ctx.fillRect(6, 0, 6, 2);
    } else if (en.eid === 'imp') {
      ctx.fillStyle = flash ? '#fff' : en.color;
      ctx.beginPath(); ctx.ellipse(0, 2, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
      // wings
      ctx.fillStyle = flash ? '#fff' : '#801818';
      ctx.beginPath(); ctx.ellipse(-12, -2, 8, 5, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(12, -2, 8, 5, 0.5, 0, Math.PI * 2); ctx.fill();
      // horns
      ctx.fillStyle = flash ? '#fff' : '#301010';
      ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(-9, -16); ctx.lineTo(-1, -8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(5, -6); ctx.lineTo(9, -16); ctx.lineTo(1, -8); ctx.fill();
      ctx.fillStyle = '#f0e060';
      ctx.beginPath(); ctx.arc(-3, -2, 2.2, 0, Math.PI * 2); ctx.arc(3, -2, 2.2, 0, Math.PI * 2); ctx.fill();
    } else if (en.eid === 'brute') {
      ctx.fillStyle = flash ? '#fff' : en.color;
      ctx.fillRect(-12, -4, 24, 18);
      ctx.beginPath(); ctx.arc(0, -12, 10, 0, Math.PI * 2); ctx.fill();
      // tusks
      ctx.fillStyle = flash ? '#fff' : '#d0c0a0';
      ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-8, 4); ctx.lineTo(-3, -2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, -4); ctx.lineTo(8, 4); ctx.lineTo(3, -2); ctx.fill();
      ctx.fillStyle = '#301808';
      ctx.fillRect(-5, -6, 10, 5);
    } else {
      ctx.globalAlpha = 0.7 + Math.sin(animT * 4) * 0.1;
      ctx.fillStyle = flash ? '#fff' : en.color;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.quadraticCurveTo(16, -2, 2, 14);
      ctx.quadraticCurveTo(0, 6, -2, 14);
      ctx.quadraticCurveTo(-16, -2, 0, -18);
      ctx.fill();
      ctx.fillStyle = '#e0f0ff';
      ctx.beginPath(); ctx.arc(-4, -4, 2.5, 0, Math.PI * 2); ctx.arc(4, -4, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    const bw = 26;
    ctx.fillStyle = '#200808';
    ctx.fillRect(s.x - bw / 2, s.y - 34, bw, 3);
    ctx.fillStyle = '#a02020';
    ctx.fillRect(s.x - bw / 2, s.y - 34, bw * Utils.clamp(en.life / en.maxLife, 0, 1), 3);
  }

  function drawDrop(d) {
    const s = worldToScreen(d.x, d.y);
    const bob = Math.sin(animT * 5 + d.x * 3) * 3;
    if (d.type === 'gold') {
      const g = ctx.createRadialGradient(s.x, s.y - 4 + bob, 1, s.x, s.y - 4 + bob, 8);
      g.addColorStop(0, '#fff0a0');
      g.addColorStop(0.5, '#e0c040');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y - 4 + bob, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e0c040';
      ctx.beginPath(); ctx.arc(s.x, s.y - 4 + bob, 5, 0, Math.PI * 2); ctx.fill();
    } else {
      const col = Loot.RARITY[d.item.rarity].color;
      const g = ctx.createRadialGradient(s.x, s.y - 6 + bob, 1, s.x, s.y - 6 + bob, 12);
      g.addColorStop(0, col);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y - 6 + bob, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1010';
      ctx.fillRect(s.x - 7, s.y - 12 + bob, 14, 14);
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.strokeRect(s.x - 7, s.y - 12 + bob, 14, 14);
      ctx.fillStyle = col;
      ctx.font = '11px serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.item.icon, s.x, s.y - 1 + bob);
    }
  }

  function drawMinimap() {
    const map = game.map;
    const scale = canvas.width < 500 ? 1.6 : 2.2;
    const mw = map.w * scale;
    const mh = map.h * scale;
    const ox = canvas.width - mw - 10;
    const oy = 10;
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
      ctx.fillStyle = '#c03030';
      ctx.fillRect(ox + en.x * scale - 1, oy + en.y * scale - 1, 3, 3);
    }
    ctx.fillStyle = '#40e080';
    ctx.fillRect(ox + game.player.x * scale - 1.5, oy + game.player.y * scale - 1.5, 4, 4);
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    update(dt);
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
      if (!UI.isDialogueOpen()) closeDialogue();
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
    const INNER_SCROLL = '.side-panel, .select-panel, #inv-grid';
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
      if (!UI.isDialogueOpen()) closeDialogue();
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
