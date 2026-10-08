/**
 * Node entry: loads every items module in dependency order and returns
 * the RPGItems namespace. Browsers load the same files as <script> tags in
 * the order listed in docs/rpg-items-integration.md.
 */
'use strict';
const FILES = ['core', 'item-ids', 'items-db', 'item-gen', 'loot', 'state', 'gold', 'inventory', 'ground',
  'equipment', 'bank', 'shop', 'crafting', 'item-save', 'world'];
let RPG;
for (const f of FILES) {
  RPG = require('./' + f + '.js');
}
RPG.FILES = FILES;
module.exports = RPG;
