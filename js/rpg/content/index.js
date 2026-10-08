/**
 * Node entry: loads every content module and returns the RPGContent
 * namespace. Browsers load the same files as <script> tags in this order:
 *   content-core.js, monsters.js, quest-data.js, dungeon.js
 */
'use strict';
const FILES = ['content-core', 'monsters', 'quest-data', 'dungeon'];
let C;
for (const f of FILES) C = require('./' + f + '.js');
C.FILES = FILES;
module.exports = C;
