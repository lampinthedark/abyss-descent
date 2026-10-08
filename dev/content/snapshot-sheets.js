#!/usr/bin/env node
/**
 * Refresh dev/content/sheet-keys.json from the live art sheets (run when the
 * UI specialist re-exports). Tests use the live sheets when present, else
 * this snapshot, so CI without /workspace/rsc-look still checks keys.
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SRC = {
  town: '/workspace/rsc-look/town/sheet.json',
  phaseb: '/workspace/rsc-look/phaseb/sheet.json',
  icons32: '/workspace/rsc-look/icons/rpg32/sheet.json',
  icons32_tinted: '/workspace/rsc-look/icons/rpg32/sheet_tinted.json',
};
const out = {};
for (const [k, p] of Object.entries(SRC)) {
  const buf = fs.readFileSync(p);
  out[k] = { path: p, sha256: crypto.createHash('sha256').update(buf).digest('hex'), keys: Object.keys(JSON.parse(buf).frames).sort() };
}
fs.writeFileSync(path.join(__dirname, 'sheet-keys.json'), JSON.stringify(out, null, 1) + '\n');
console.log(Object.entries(out).map(([k, v]) => k + ' ' + v.keys.length + ' keys ' + v.sha256.slice(0, 8)).join('\n'));
