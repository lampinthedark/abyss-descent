// Original placeholder colours. Distances below were measured with CIEDE2000.
// Rustbound #8c3a26 vs sand path #f2e4c0 is about 52.
// Tidesteel #6e8caa vs bone #e6dcc8 is about 33, and vs #d0b4ff is about 22.
// Tidesteel relative luminance is about 0.25; Verdite #146b42 is about 0.11.
// Goblin skin #123e48 vs grass #4a542c is about 24 (contrast about 1.8).

export const HEX = {
  ink: '#050403',
  skin: '#e8b090',
  pants: '#3a4a78',
  boot: '#6b3020',
  metal: '#c6c6ce',
  metalDark: '#8a8a94',
  shine: '#f6f6f8',
  sand: '#f2e4c0',
  sandDeep: '#e7d4a4',
  grass: '#4a542c',
  grassDeep: '#3c4624',
  stone: '#8c8882',
  stoneDeep: '#6a6662',
  dungeon: '#7c868f',
  dungeonDeep: '#667078',
  rust: '#8c3a26',
  cinder: '#2c2a28',
  verdite: '#146b42',
  tide: '#6e8caa',
  sun: '#f2c43a',
  bone: '#e6dcc8',
  boneDeep: '#c4b49a',
  goblin: '#123e48',
  goblinDeep: '#0c2c34',
  rat: '#7a4e34',
  ratDeep: '#4e3022',
  ratPink: '#e0a090',
  spider: '#2a0a0e',
  spiderDeep: '#140406',
  eye: '#e8e0d0',
  eyeRed: '#d42828',
};

export const TIERS = [
  null,
  { id: 'Tier1', name: 'Rustbound', hex: HEX.rust, shine: 0.04 },
  { id: 'Tier2', name: 'Cinderiron', hex: HEX.cinder, shine: 0.1 },
  { id: 'Tier3', name: 'Verdite', hex: HEX.verdite, shine: 0.22 },
  { id: 'Tier4', name: 'Tidesteel', hex: HEX.tide, shine: 0.4 },
  { id: 'Tier5', name: 'Sunforged', hex: HEX.sun, shine: 0.92 },
];

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexUnit(hex) {
  const [r, g, b] = hexRgb(hex);
  return [r / 255, g / 255, b / 255];
}
