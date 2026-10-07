/** Item generation, rarity, equipping */
const Loot = (() => {
  const RARITY = {
    common: { name: 'Common', color: '#c8c0b8', weight: 60, affixes: 0 },
    magic:  { name: 'Magic',  color: '#6080e0', weight: 30, affixes: 1 },
    rare:   { name: 'Rare',   color: '#d0c040', weight: 10, affixes: 2 },
  };

  const BASES = {
    weapon: [
      { name: 'Rusty Blade', dmg: 4, icon: '⚔' },
      { name: 'Short Sword', dmg: 6, icon: '⚔' },
      { name: 'War Axe', dmg: 8, icon: '🪓' },
      { name: 'Greatsword', dmg: 11, icon: '⚔' },
      { name: 'Demon Cleaver', dmg: 14, icon: '🗡' },
    ],
    armor: [
      { name: 'Rags', armor: 2, life: 5, icon: '🛡' },
      { name: 'Leather Vest', armor: 4, life: 10, icon: '🛡' },
      { name: 'Chain Mail', armor: 7, life: 15, icon: '🛡' },
      { name: 'Plate Armor', armor: 11, life: 25, icon: '🛡' },
      { name: 'Abyssal Plate', armor: 15, life: 40, icon: '🛡' },
    ],
    ring: [
      { name: 'Copper Ring', life: 8, icon: '💍' },
      { name: 'Silver Band', dmg: 2, life: 5, icon: '💍' },
      { name: 'Ruby Ring', dmg: 3, life: 12, icon: '💍' },
      { name: 'Shadow Seal', dmg: 5, armor: 2, life: 10, icon: '💍' },
    ],
  };

  const AFFIXES = [
    { key: 'dmg', label: 'Damage', min: 1, max: 5 },
    { key: 'armor', label: 'Armor', min: 1, max: 4 },
    { key: 'life', label: 'Life', min: 5, max: 25 },
    { key: 'aspd', label: 'Atk Speed', min: 0.05, max: 0.15 },
  ];

  function rollRarity(floor) {
    const boost = Math.min(floor * 2, 20);
    const roll = Math.random() * 100;
    if (roll < RARITY.rare.weight + boost * 0.3) return 'rare';
    if (roll < RARITY.rare.weight + RARITY.magic.weight + boost) return 'magic';
    return 'common';
  }

  function createItem(slot, floor = 1) {
    const pool = BASES[slot];
    const idx = Utils.clamp(Math.floor(Math.random() * pool.length * (0.4 + floor * 0.12)), 0, pool.length - 1);
    const base = pool[idx];
    const rarity = rollRarity(floor);
    const item = {
      id: 'i' + Date.now() + Math.random().toString(36).slice(2, 7),
      slot,
      name: base.name,
      icon: base.icon,
      rarity,
      dmg: base.dmg || 0,
      armor: base.armor || 0,
      life: base.life || 0,
      aspd: 0,
    };
    // scale base a bit with floor
    if (item.dmg) item.dmg += Math.floor(floor * 0.6);
    if (item.armor) item.armor += Math.floor(floor * 0.4);
    if (item.life) item.life += Math.floor(floor * 1.5);

    const affixCount = RARITY[rarity].affixes;
    const used = new Set();
    for (let i = 0; i < affixCount; i++) {
      let aff;
      do { aff = Utils.pick(AFFIXES); } while (used.has(aff.key));
      used.add(aff.key);
      const val = Utils.rand(aff.min, aff.max) * (1 + floor * 0.08);
      if (aff.key === 'aspd') item.aspd += Math.round(val * 100) / 100;
      else item[aff.key] = (item[aff.key] || 0) + Math.round(val);
    }
    if (rarity === 'magic') item.name = 'Enchanted ' + item.name;
    if (rarity === 'rare') item.name = Utils.pick(['Vicious', 'Ancient', 'Bloodforged', 'Doom']) + ' ' + item.name;
    return item;
  }

  function itemStatsText(item) {
    const parts = [];
    if (item.dmg) parts.push(`+${item.dmg} dmg`);
    if (item.armor) parts.push(`+${item.armor} armor`);
    if (item.life) parts.push(`+${item.life} life`);
    if (item.aspd) parts.push(`+${Math.round(item.aspd * 100)}% aspd`);
    return parts.join(', ');
  }

  function dropFromEnemy(enemy, floor) {
    const drops = [];
    const gold = Utils.randInt(3 + floor * 2, 8 + floor * 5);
    drops.push({ type: 'gold', amount: gold, x: enemy.x, y: enemy.y });
    if (Utils.chance(0.55 + Math.min(floor * 0.03, 0.25))) {
      const slot = Utils.pick(['weapon', 'armor', 'ring']);
      const item = createItem(slot, floor);
      drops.push({ type: 'item', item, x: enemy.x + Utils.rand(-0.3, 0.3), y: enemy.y + Utils.rand(-0.3, 0.3) });
    }
    return drops;
  }

  return { RARITY, createItem, itemStatsText, dropFromEnemy };
})();
