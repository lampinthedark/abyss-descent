/** Skill tree definitions and player skill state */
const Skills = (() => {
  const NODES = [
    { id: 'might', name: 'Might', icon: '💪', max: 5, desc: '+8% damage per rank',
      effect: (r) => ({ dmgMult: 1 + r * 0.08 }), prereq: null },
    { id: 'swift', name: 'Swift Strikes', icon: '⚡', max: 5, desc: '+7% attack speed per rank',
      effect: (r) => ({ aspdMult: 1 + r * 0.07 }), prereq: null },
    { id: 'vitality', name: 'Vitality', icon: '❤️', max: 5, desc: '+12 max life per rank',
      effect: (r) => ({ lifeFlat: r * 12 }), prereq: null },
    { id: 'fleet', name: 'Fleet Foot', icon: '👟', max: 3, desc: '+8% move speed per rank',
      effect: (r) => ({ moveMult: 1 + r * 0.08 }), prereq: 'swift' },
    { id: 'cleave', name: 'Cleave', icon: '🌀', max: 3, desc: 'AoE radius +0.35 per rank (hit nearby foes)',
      effect: (r) => ({ cleave: r * 0.35 }), prereq: 'might' },
    { id: 'lifesteal', name: 'Blood Drinker', icon: '🩸', max: 3, desc: 'Heal 4% of damage dealt per rank',
      effect: (r) => ({ lifesteal: r * 0.04 }), prereq: 'vitality' },
    { id: 'iron', name: 'Iron Skin', icon: '🧱', max: 3, desc: '+3 armor per rank',
      effect: (r) => ({ armorFlat: r * 3 }), prereq: 'vitality' },
    { id: 'frenzy', name: 'Frenzy', icon: '🔥', max: 3, desc: '+5% dmg & +4% aspd per rank',
      effect: (r) => ({ dmgMult: 1 + r * 0.05, aspdMult: 1 + r * 0.04 }), prereq: 'cleave' },
    { id: 'soul', name: 'Soul Harvest', icon: '👻', max: 2, desc: '+10% XP & +6% gold per rank',
      effect: (r) => ({ xpMult: 1 + r * 0.1, goldMult: 1 + r * 0.06 }), prereq: 'lifesteal' },
  ];

  function createState() {
    const ranks = {};
    NODES.forEach(n => { ranks[n.id] = 0; });
    return { ranks, points: 0 };
  }

  function canUnlock(state, id) {
    const node = NODES.find(n => n.id === id);
    if (!node) return false;
    if (state.ranks[id] >= node.max) return false;
    if (state.points < 1) return false;
    if (node.prereq && state.ranks[node.prereq] < 1) return false;
    return true;
  }

  function spend(state, id) {
    if (!canUnlock(state, id)) return false;
    state.ranks[id]++;
    state.points--;
    return true;
  }

  function computeBonuses(state) {
    const b = {
      dmgMult: 1, aspdMult: 1, moveMult: 1,
      lifeFlat: 0, armorFlat: 0, cleave: 0, lifesteal: 0,
      xpMult: 1, goldMult: 1,
    };
    for (const node of NODES) {
      const r = state.ranks[node.id];
      if (!r) continue;
      const e = node.effect(r);
      if (e.dmgMult) b.dmgMult *= e.dmgMult;
      if (e.aspdMult) b.aspdMult *= e.aspdMult;
      if (e.moveMult) b.moveMult *= e.moveMult;
      if (e.lifeFlat) b.lifeFlat += e.lifeFlat;
      if (e.armorFlat) b.armorFlat += e.armorFlat;
      if (e.cleave) b.cleave += e.cleave;
      if (e.lifesteal) b.lifesteal += e.lifesteal;
      if (e.xpMult) b.xpMult *= e.xpMult;
      if (e.goldMult) b.goldMult *= e.goldMult;
    }
    return b;
  }

  return { NODES, createState, canUnlock, spend, computeBonuses };
})();
