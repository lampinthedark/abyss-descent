/** Local save / load for run progress (localStorage) */
const Save = (() => {
  const KEY = 'abyss-descent-save-v1';

  function serializeItem(it) {
    if (!it) return null;
    return {
      id: it.id,
      slot: it.slot,
      name: it.name,
      icon: it.icon,
      rarity: it.rarity,
      dmg: it.dmg || 0,
      armor: it.armor || 0,
      life: it.life || 0,
      aspd: it.aspd || 0,
    };
  }

  function serializePlayer(p) {
    return {
      classId: p.classId,
      x: p.x,
      y: p.y,
      baseLife: p.baseLife,
      life: p.life,
      maxLife: p.maxLife,
      baseDmg: p.baseDmg,
      baseArmor: p.baseArmor,
      baseAspd: p.baseAspd,
      baseMove: p.baseMove,
      classCleave: p.classCleave,
      classRange: p.classRange,
      classStyle: p.classStyle,
      dmgVar: p.dmgVar,
      useProjectile: !!p.useProjectile,
      level: p.level,
      xp: p.xp,
      xpToLevel: p.xpToLevel,
      gold: p.gold,
      inventory: (p.inventory || []).map(serializeItem),
      equipped: {
        weapon: serializeItem(p.equipped.weapon),
        armor: serializeItem(p.equipped.armor),
        ring: serializeItem(p.equipped.ring),
      },
      skills: {
        ranks: { ...p.skills.ranks },
        points: p.skills.points,
      },
      storyFlags: { ...(p.storyFlags || {}) },
      questTip: p.questTip || '',
    };
  }

  function hydratePlayer(data) {
    const p = Entities.createPlayer(data.x || 0, data.y || 0, data.classId || 'warrior');
    Object.assign(p, {
      baseLife: data.baseLife,
      life: data.life,
      maxLife: data.maxLife,
      baseDmg: data.baseDmg,
      baseArmor: data.baseArmor,
      baseAspd: data.baseAspd,
      baseMove: data.baseMove,
      classCleave: data.classCleave,
      classRange: data.classRange,
      classStyle: data.classStyle,
      dmgVar: data.dmgVar,
      useProjectile: !!data.useProjectile,
      level: data.level,
      xp: data.xp,
      xpToLevel: data.xpToLevel,
      gold: data.gold,
      inventory: data.inventory || [],
      equipped: data.equipped || { weapon: null, armor: null, ring: null },
      skills: data.skills || Skills.createState(),
      storyFlags: data.storyFlags || {},
      questTip: data.questTip || '',
    });
    // ensure ranks object has all nodes
    const fresh = Skills.createState();
    p.skills.ranks = { ...fresh.ranks, ...(p.skills.ranks || {}) };
    p.skills.points = p.skills.points || 0;
    Entities.syncLife(p);
    return p;
  }

  function capture(game) {
    if (!game.player) return null;
    const tipEl = document.getElementById('quest-tip');
    if (tipEl && !tipEl.classList.contains('hidden') && tipEl.textContent) {
      game.player.questTip = tipEl.textContent.replace(/^Quest:\s*/, '');
    }
    return {
      version: 1,
      savedAt: Date.now(),
      floor: game.floor,
      selectedClass: game.selectedClass || game.player.classId,
      player: serializePlayer(game.player),
    };
  }

  function write(game) {
    const data = capture(game);
    if (!data) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('Save failed', e);
      return false;
    }
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.player || !data.floor) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function has() {
    return !!read();
  }

  function summary() {
    const d = read();
    if (!d) return null;
    const cls = Classes.get(d.selectedClass || d.player.classId);
    return {
      className: cls ? cls.name : 'Hero',
      level: d.player.level,
      floor: d.floor,
      gold: d.player.gold,
      savedAt: d.savedAt,
    };
  }

  return { write, read, clear, has, summary, hydratePlayer, KEY };
})();
