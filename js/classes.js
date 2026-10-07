/** Character classes for selection & combat flavor */
const Classes = (() => {
  const LIST = [
    {
      id: 'warrior',
      name: 'Warrior',
      blurb: 'A battered crusader who meets the Abyss with steel and stubborn flesh. High vitality, crushing melee blows.',
      lore: 'Sworn to seal what others fled.',
      colors: { cape: '#4a1018', armor: '#6a7080', skin: '#d0a880', accent: '#c03028', weapon: '#c0c8d0' },
      base: { life: 130, dmg: 10, armor: 4, aspd: 0.85, move: 2.9 },
      combat: { range: 1.25, cleave: 0.25, style: 'melee', dmgVar: [0.92, 1.12], projectile: false },
      starterWeapon: { name: "Crusader's Blade", dmg: 8, rarity: 'common' },
      skillHint: 'might',
    },
    {
      id: 'rogue',
      name: 'Rogue',
      blurb: 'A shadow-born blade who dances between demons. Swift strikes, fragile frame, lethal openings.',
      lore: 'Stole a map of the first three floors.',
      colors: { cape: '#1a3020', armor: '#2a4038', skin: '#c8a878', accent: '#40a060', weapon: '#a8b0b8' },
      base: { life: 85, dmg: 7, armor: 1, aspd: 1.35, move: 3.8 },
      combat: { range: 1.05, cleave: 0, style: 'melee', dmgVar: [0.75, 1.45], projectile: false },
      starterWeapon: { name: 'Twin Daggers', dmg: 5, rarity: 'common' },
      skillHint: 'swift',
    },
    {
      id: 'sorcerer',
      name: 'Sorcerer',
      blurb: 'A scholar unbound by flesh. Hurls abyss-fire from afar; thin blood, fierce will.',
      lore: 'Heard the Abyss whisper in a dream.',
      colors: { cape: '#281848', armor: '#3a2860', skin: '#c0a090', accent: '#6080e0', weapon: '#80a0f0' },
      base: { life: 90, dmg: 9, armor: 0, aspd: 1.05, move: 3.0 },
      combat: { range: 3.6, cleave: 0, style: 'ranged', dmgVar: [0.9, 1.15], projectile: true },
      starterWeapon: { name: 'Ashwood Staff', dmg: 6, rarity: 'common' },
      skillHint: 'vitality',
    },
  ];

  function get(id) {
    return LIST.find(c => c.id === id) || LIST[0];
  }

  return { LIST, get };
})();
