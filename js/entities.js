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

  function pickType(floor) {
    if (floor > 2) return Utils.pick(ENEMY_TYPES);
    const bag = floor === 1
      ? ['skel', 'skel', 'skel', 'imp', 'imp', 'brute']
      : ['skel', 'skel', 'imp', 'imp', 'wraith', 'brute'];
    const id = Utils.pick(bag);
    return ENEMY_TYPES.find(t => t.id === id) || ENEMY_TYPES[0];
  }

  function createEnemy(x, y, floor) {
    const t = pickType(floor);
    const scale = 1 + (floor - 1) * 0.22;
    // Floors 1–2 last long enough to read a telegraph and a hit, then the curve resumes.
    const earlyHp = floor === 1 ? 2.05 : floor === 2 ? 1.55 : 1;
    const earlyDmg = floor === 1 ? 0.55 : floor === 2 ? 0.72 : 1;
    const earlySpd = floor === 1 ? 0.72 : floor === 2 ? 0.84 : 1;
    const hp = Math.round(t.hp * scale * earlyHp);
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

  function spawnWave(map, floor) {
    const enemies = [];
    let count = floor <= 1 ? 4 + Utils.randInt(0, 1)
      : floor === 2 ? 5 + Utils.randInt(0, 1)
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
    createEnemy, restoreEnemy, spawnWave, ENEMY_TYPES,
  };
})();
