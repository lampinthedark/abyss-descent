/** Player, enemies, projectiles/effects */
const Entities = (() => {
  function createPlayer(x, y, classId = 'warrior') {
    const cls = Classes.get(classId);
    const p = {
      type: 'player',
      classId: cls.id,
      x, y,
      radius: 0.35,
      baseLife: cls.base.life,
      life: cls.base.life,
      maxLife: cls.base.life,
      baseDmg: cls.base.dmg,
      baseArmor: cls.base.armor,
      baseAspd: cls.base.aspd,
      baseMove: cls.base.move,
      classCleave: cls.combat.cleave,
      classRange: cls.combat.range,
      classStyle: cls.combat.style,
      dmgVar: cls.combat.dmgVar,
      useProjectile: !!cls.combat.projectile,
      level: 1,
      xp: 0,
      xpToLevel: 40,
      gold: 0,
      inventory: [],
      equipped: { weapon: null, armor: null, ring: null },
      skills: Skills.createState(),
      path: [],
      targetEnemy: null,
      attackCd: 0,
      hitFlash: 0,
      facing: 1,
      swingAnim: 0,
      swingDur: 0.32,
      swingAng: 0,
      windup: 0,
      windupMax: 0,
      invuln: 0,
      questTip: '',
      storyFlags: {},
      quests: { active: {}, done: {} },
    };
    // Class technique: a free rank, recorded separately so it is not an unspent point.
    if (cls.skillHint && p.skills.ranks[cls.skillHint] !== undefined) {
      p.skills.ranks[cls.skillHint] = 1;
      p.skills.gifted[cls.skillHint] = 1;
    }
    Skills.syncUnspent(p.skills, p.level);
    return p;
  }

  function playerStats(p) {
    const sk = Skills.computeBonuses(p.skills);
    let dmg = p.baseDmg;
    let armor = p.baseArmor;
    let life = p.baseLife;
    let aspd = p.baseAspd;
    let move = p.baseMove;
    for (const slot of ['weapon', 'armor', 'ring']) {
      const it = p.equipped[slot];
      if (!it) continue;
      dmg += it.dmg || 0;
      armor += it.armor || 0;
      life += it.life || 0;
      aspd += it.aspd || 0;
    }
    dmg *= sk.dmgMult;
    armor += sk.armorFlat;
    life += sk.lifeFlat;
    aspd *= sk.aspdMult;
    move *= sk.moveMult;
    return {
      dmg: Math.round(dmg * 10) / 10,
      armor,
      maxLife: Math.round(life),
      aspd,
      move,
      cleave: sk.cleave + (p.classCleave || 0),
      lifesteal: sk.lifesteal,
      xpMult: sk.xpMult,
      goldMult: sk.goldMult,
      range: p.classRange || 1.15,
    };
  }

  function syncLife(p) {
    const st = playerStats(p);
    const ratio = p.maxLife > 0 ? p.life / p.maxLife : 1;
    p.maxLife = st.maxLife;
    p.life = Utils.clamp(Math.round(ratio * p.maxLife), 1, p.maxLife);
  }

  function xpForLevel(lv) {
    return Math.floor(40 * Math.pow(1.35, lv - 1));
  }

  function gainXp(p, amount) {
    const st = playerStats(p);
    p.xp += Math.round(amount * st.xpMult);
    const beforePoints = p.skills.points || 0;
    let leveled = false;
    while (p.xp >= p.xpToLevel) {
      p.xp -= p.xpToLevel;
      p.level++;
      p.baseLife += p.classId === 'warrior' ? 10 : p.classId === 'rogue' ? 6 : 7;
      p.baseDmg += p.classId === 'sorcerer' ? 1.8 : 1.5;
      p.xpToLevel = xpForLevel(p.level);
      const st2 = playerStats(p);
      p.maxLife = st2.maxLife;
      p.life = p.maxLife;
      leveled = true;
    }
    if (leveled) Skills.syncUnspent(p.skills, p.level);
    return { leveled, pointsGained: (p.skills.points || 0) - beforePoints };
  }

  const ENEMY_TYPES = [
    { id: 'skel', name: 'Skeleton', color: '#c8c0a8', hp: 28, dmg: 6, speed: 1.6, xp: 12, radius: 0.32 },
    { id: 'imp', name: 'Imp', color: '#c04030', hp: 18, dmg: 5, speed: 2.4, xp: 10, radius: 0.28 },
    { id: 'brute', name: 'Brute', color: '#605048', hp: 55, dmg: 12, speed: 1.1, xp: 22, radius: 0.42 },
    { id: 'wraith', name: 'Wraith', color: '#6080a0', hp: 35, dmg: 9, speed: 1.9, xp: 18, radius: 0.3 },
  ];
  // Floor 1 light trash only. Brute HP stays on the 2.05 curve below.
  // A level-1 hit is 9, so 54/9 = 6 skeleton swings and 45/9 = 5 imp swings.
  const FLOOR1_HP = { skel: 54, imp: 45 };

  function pickType(floor) {
    if (floor > 2) return Utils.pick(ENEMY_TYPES);
    const bag = floor === 1
      ? ['skel', 'skel', 'skel', 'imp', 'imp', 'brute']
      : ['skel', 'skel', 'imp', 'imp', 'wraith', 'brute'];
    const id = Utils.pick(bag);
    return ENEMY_TYPES.find(t => t.id === id) || ENEMY_TYPES[0];
  }

  function createEnemy(x, y, floor, typeId) {
    floor = Number(floor);
    const picked = typeId ? ENEMY_TYPES.find(e => e.id === typeId) : null;
    const t = picked || pickType(floor);
    const scale = 1 + (floor - 1) * 0.22;
    // Floor 2 keeps the previous curve. Floor 1 brutes use 2.05; light trash uses FLOOR1_HP.
    const earlyHp = floor === 1 ? 1 : floor === 2 ? 1.55 : 1;
    const earlyDmg = floor === 1 ? 0.55 : floor === 2 ? 0.72 : 1;
    const earlySpd = floor === 1 ? 0.72 : floor === 2 ? 0.84 : 1;
    let hp = Math.round(t.hp * scale * earlyHp);
    if (floor === 1) {
      if (FLOOR1_HP[t.id]) hp = FLOOR1_HP[t.id];
      else hp = Math.round(t.hp * 2.05);
    }
    return {
      type: 'enemy',
      eid: t.id,
      name: t.name,
      color: t.color,
      x, y,
      radius: t.radius,
      life: hp,
      maxLife: hp,
      dmg: Math.round(t.dmg * scale * earlyDmg * 10) / 10,
      speed: t.speed * (1 + floor * 0.02) * earlySpd,
      xp: Math.round(t.xp * (1 + floor * 0.15)),
      attackCd: 0,
      hitFlash: 0,
      windup: 0,
      windupMax: 0,
      dissolve: 0,
      dead: false,
      facing: 1,
      aggro: false,
      pathTimer: 0,
      vx: 0, vy: 0,
    };
  }

  function restoreEnemy(data) {
    if (!data || data.life <= 0) return null;
    return {
      type: 'enemy',
      eid: data.eid,
      name: data.name,
      color: data.color,
      x: data.x,
      y: data.y,
      radius: data.radius || 0.32,
      life: data.life,
      maxLife: data.maxLife || data.life,
      dmg: data.dmg ?? 1,
      speed: data.speed ?? 1,
      xp: data.xp ?? 0,
      attackCd: data.attackCd || 0,
      hitFlash: 0,
      windup: 0,
      windupMax: 0,
      dissolve: 0,
      dead: false,
      facing: 1,
      aggro: !!data.aggro,
      pathTimer: 0,
      vx: 0, vy: 0,
    };
  }

  // Floor 1 is a fixed opening: an early pack, a mid skeleton, then a brute
  // and another skeleton deeper in. Hit points stay on the existing curve.
  function spawnFloor1(map) {
    const plan = [
      { id: 'skel', band: 'early' },
      { id: 'skel', band: 'early' },
      { id: 'imp', band: 'early' },
      { id: 'skel', band: 'mid' },
      { id: 'brute', band: 'deep' },
      { id: 'skel', band: 'deep' },
    ];
    const tiles = [];
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const px = x + 0.5, py = y + 0.5;
        if (!map.grounded(px, py) || map.isStairs(px, py)) continue;
        tiles.push({
          x: px,
          y: py,
          d: Math.hypot(px - map.startX, py - map.startY),
        });
      }
    }
    const used = [];
    const enemies = [];
    const minStart = 5.5;
    const free = (t, gap) => !used.some(u => Math.hypot(u.x - t.x, u.y - t.y) < gap);
    const nearest = (pred, gap) => {
      let best = null;
      for (const t of tiles) {
        if (!pred(t) || !free(t, gap)) continue;
        if (!best || t.d < best.d) best = t;
      }
      return best;
    };
    // The opening pack has to share one patch of floor, not ring the entrance.
    const pack = [];
    let bestGroup = [];
    let bestSeed = null;
    for (const radius of [3.2, 4.6]) {
      if (bestGroup.length >= 3) break;
      for (const seed of tiles) {
        if (seed.d < 5.6 || seed.d > 12) continue;
        const group = tiles.filter(t => t.d >= minStart && Math.hypot(t.x - seed.x, t.y - seed.y) <= radius);
        const closer = !bestSeed || seed.d < bestSeed.d;
        if (group.length > bestGroup.length || (group.length === bestGroup.length && closer && group.length >= 3)) {
          bestGroup = group;
          bestSeed = seed;
        }
      }
    }
    bestGroup = bestGroup.slice().sort((a, b) =>
      Math.hypot(a.x - bestSeed.x, a.y - bestSeed.y) - Math.hypot(b.x - bestSeed.x, b.y - bestSeed.y));
    for (const t of bestGroup) {
      if (pack.length >= 3) break;
      if (!free(t, 1.45)) continue;
      pack.push(t);
      used.push(t);
    }
    const earlyIds = ['skel', 'skel', 'imp'];
    for (let i = 0; i < pack.length; i++) {
      enemies.push(createEnemy(pack[i].x, pack[i].y, 1, earlyIds[i]));
    }
    const rest = plan.filter(s => s.band !== 'early');
    for (const slot of rest) {
      let spot = null;
      if (slot.band === 'mid') {
        spot = nearest(t => t.d >= 12 && t.d <= 26, 2.2)
          || nearest(t => t.d >= 10, 2);
      } else {
        spot = nearest(t => t.d > 16, 2.2)
          || nearest(t => t.d >= 12, 2);
      }
      if (!spot) spot = nearest(t => t.d >= minStart, 1.4);
      if (!spot) continue;
      used.push(spot);
      enemies.push(createEnemy(spot.x, spot.y, 1, slot.id));
    }
    return enemies;
  }

  function spawnWave(map, floor) {
    if (Number(floor) <= 1) return spawnFloor1(map);
    const enemies = [];
    let count = floor === 2 ? 5 + Utils.randInt(0, 1)
        : 4 + floor * 2 + Utils.randInt(0, 3);
    const pts = (map.spawnPoints || []).filter(p => map.grounded(p.x, p.y));
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Utils.randInt(0, i);
      const tmp = pts[i]; pts[i] = pts[j]; pts[j] = tmp;
    }
    const minD = floor <= 2 ? 3.2 : 2.2;
    const chosen = [];
    const take = (gap) => {
      for (const p of pts) {
        if (chosen.length >= count) return;
        if (Math.hypot(p.x - map.startX, p.y - map.startY) < 4.5) continue;
        if (chosen.some(c => Math.hypot(c.x - p.x, c.y - p.y) < gap)) continue;
        chosen.push(p);
      }
    };
    take(minD);
    if (chosen.length < Math.min(3, count)) take(1.8);
    for (const p of chosen) {
      const g = MapGen.nearestGrounded(map, p.x, p.y, 4) || p;
      enemies.push(createEnemy(g.x, g.y, floor));
    }
    return enemies;
  }

  return {
    createPlayer, playerStats, syncLife, gainXp, xpForLevel,
    createEnemy, restoreEnemy, spawnWave, ENEMY_TYPES, FLOOR1_HP,
  };
})();
