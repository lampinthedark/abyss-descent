#!/usr/bin/env node
/**
 * Generates docs/rpg-item-icons.json from the item database so the icon
 * list can't drift from the items. Run: node dev/rpg/gen-icons.js
 * (dev/rpg/run-tests.js checks the committed file is up to date.)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../../js/rpg/items/index.js');
const Db = R.ItemsDb;

const SIZE = { art_px: 32, module_px: 16, modules: '2x2', note: '32x32 art px on the 16 px module (2x2 modules); drawn 3x on DPR-3 phones' };

// Tints for non-tier tinted shapes.
const TINT = {
  pine_logs: '#b08a5a', ashwood_logs: '#cfc2a0',
  raw_mudminnow: '#8a8c70', raw_brookfin: '#8fb0c8', mudminnow: '#b07a48', brookfin: '#c89a5e',
  plain_band: '#b8a888', garnet_band: '#a8323a', moonstone_band: '#c8d8f0',
  bone_charm: '#e0d6bc', amber_pendant: '#e09a30', starglass_pendant: '#a8c8ff',
};

// Shared (tinted) shapes: shape key -> which bases use it and how.
const SHAPES = [
  { key: 'icon_shape_sword', name: 'Sword', kinds: ['sword'], priority: 'D3' },
  { key: 'icon_shape_pickaxe', name: 'Pickaxe', kinds: ['pickaxe'], priority: 'D4' },
  { key: 'icon_shape_hatchet', name: 'Hatchet', kinds: ['hatchet'], priority: 'D4' },
  { key: 'icon_shape_ore', name: 'Ore chunk', cats: ['ore'], priority: 'D4' },
  { key: 'icon_shape_logs', name: 'Logs', cats: ['log'], priority: 'D4' },
  { key: 'icon_shape_fish_raw', name: 'Raw fish', cats: ['fish_raw'], priority: 'D4' },
  { key: 'icon_shape_bar', name: 'Bar', cats: ['bar'], priority: 'D5' },
  { key: 'icon_shape_fish_cooked', name: 'Cooked fish', ids: ['mudminnow', 'brookfin'], priority: 'D5' },
  { key: 'icon_shape_helm', name: 'Helm', kinds: ['helm'], priority: 'D5' },
  { key: 'icon_shape_shield', name: 'Shield', kinds: ['shield'], priority: 'D6' },
  { key: 'icon_shape_cuirass', name: 'Cuirass', kinds: ['cuirass'], priority: 'D6' },
  { key: 'icon_shape_greaves', name: 'Greaves', kinds: ['greaves'], priority: 'D6' },
  { key: 'icon_shape_gauntlets', name: 'Gauntlets', kinds: ['gauntlets'], priority: 'D6' },
  { key: 'icon_shape_sabatons', name: 'Sabatons', kinds: ['sabatons'], priority: 'D6' },
  { key: 'icon_shape_dirk', name: 'Dirk', kinds: ['dirk'], priority: 'D6' },
  { key: 'icon_shape_greataxe', name: 'Greataxe', kinds: ['greataxe'], priority: 'D6' },
  { key: 'icon_shape_ring', name: 'Ring', ids: ['plain_band', 'garnet_band', 'moonstone_band'], priority: 'D6' },
  { key: 'icon_shape_amulet', name: 'Amulet', ids: ['bone_charm', 'amber_pendant', 'starglass_pendant'], priority: 'D6' },
];
// Unique (hand-drawn, untinted) icons.
const UNIQUE_PRIORITY = {
  hearth_bread: 'D3', fishing_rod: 'D4', smithing_hammer: 'D5', flint_striker: 'D5', charred_fish: 'D5',
  rat_tail: 'D6', goblin_trinket: 'D6', bone_shard: 'D6', imp_ember: 'D6', wyrm_scale: 'D6', travellers_stew: 'D6',
  wyrmfang: 'D6', gravewarden_crown: 'D6', emberheart_pendant: 'D6', tinkers_oath: 'D6',
  cracked_sigil: 'D6', wardens_ledger: 'D6', old_survey_map: 'D6',
};
const NOTES = {
  wyrmfang: 'Dragon-tier legendary sword (Gate 4/6 show-off). Most detailed icon in the set; red-black blade, fang-shaped.',
  gravewarden_crown: 'Legendary helm (boss chase).', emberheart_pendant: 'Legendary amulet.', tinkers_oath: 'Legendary ring.',
  cracked_sigil: 'Quest item; names follow GD quests, may change.', wardens_ledger: 'Quest item; may change.',
  old_survey_map: 'Quest item; may change.', charred_fish: 'Shared burnt result for every fish.',
};

function rarityOf(b) { return Db.defaultRarity(b); }
function tierTint(b) { return b.tier ? Db.TIER_BY_ID[b.tier].color : null; }

const used = new Set();
const icons = [];
for (const sh of SHAPES) {
  const items = Db.ORDER.map((id) => Db.BASES[id]).filter((b) => !b.unique && (
    (sh.kinds && sh.kinds.includes(b.kind) && b.slot) || (sh.cats && sh.cats.includes(b.cat)) || (sh.ids && sh.ids.includes(b.id))));
  items.forEach((b) => used.add(b.id));
  icons.push({
    key: sh.key, name: sh.name, type: 'tinted', priority: sh.priority, top: ['D3', 'D4', 'D5'].includes(sh.priority),
    size: SIZE.art_px,
    items: items.map((b) => ({ id: b.id, key: 'icon_' + b.id, name: b.name, tier: b.tier || null,
      rarity: rarityOf(b), tint: TINT[b.id] || tierTint(b) })),
  });
}
const extra = [{ id: 'gold', name: 'Gold coins', cat: 'currency', note: 'Gold is a balance, not an item; icon for HUD, ground piles and shop prices. One coin-pile drawing.' }];
for (const id of Object.keys(UNIQUE_PRIORITY)) {
  const b = Db.getBase(id);
  used.add(id);
  icons.push({ key: 'icon_' + id, name: b.name, type: 'unique', priority: UNIQUE_PRIORITY[id],
    top: ['D3', 'D4', 'D5'].includes(UNIQUE_PRIORITY[id]), size: SIZE.art_px, tier: b.tier || null,
    rarity: rarityOf(b), note: NOTES[id] || undefined });
}
for (const e of extra) icons.push({ key: 'icon_' + e.id, name: e.name, type: 'unique', priority: 'D3', top: true, size: SIZE.art_px, tier: null, rarity: null, note: e.note });

const missing = Db.ORDER.filter((id) => !used.has(id));
const order = { D3: 0, D4: 1, D5: 2, D6: 3 };
icons.sort((a, b) => order[a.priority] - order[b.priority] || (a.type === b.type ? 0 : a.type === 'tinted' ? -1 : 1));

const out = {
  generated_by: 'dev/rpg/gen-icons.js (do not hand-edit; rerun after item changes)',
  size: SIZE,
  rules: [
    'Rarity is NOT baked into icons: the UI draws the rarity border/beam colour (RPGItems.ItemsDb.RARITIES).',
    'Tinted icons: draw ONE greyscale/value shape, the game multiplies it by `tint` per item. Tier tints come from ItemsDb.TIERS[].color.',
    'Per-item sheet key is icon_<itemId>; until a dedicated frame exists, draw the shape key with the tint.',
    'Ore/log/fish ids line up with the town sheet nodes node_ore_<tier>, node_tree_pine/ash, node_fish_0.',
  ],
  tiers: Db.TIERS.map((t) => ({ id: t.id, name: t.name, tint: t.color, level: t.level })),
  counts: { distinct_icons: icons.length, tinted_shapes: icons.filter((i) => i.type === 'tinted').length,
    unique: icons.filter((i) => i.type === 'unique').length, top_priority_D3_D5: icons.filter((i) => i.top).length,
    item_bases_covered: used.size },
  icons,
  uncovered_bases: missing,
};
const file = path.join(__dirname, '../../docs/rpg-item-icons.json');
const json = JSON.stringify(out, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur !== json) { console.error('docs/rpg-item-icons.json is stale: run node dev/rpg/gen-icons.js'); process.exit(1); }
  if (missing.length) { console.error('bases without icon:', missing.join(', ')); process.exit(1); }
  console.log('icons manifest up to date (' + icons.length + ' icons)');
} else {
  fs.writeFileSync(file, json);
  console.log('wrote', file, out.counts, missing.length ? 'UNCOVERED: ' + missing.join(',') : '');
}
