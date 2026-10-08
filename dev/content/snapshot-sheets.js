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
  mobs: '/workspace/rsc-look/mobs/sheet.json',      // rat + goblin
  mobs2: '/workspace/rsc-look/mobs2/sheet.json',    // skeleton, imp, brute, ashmaw
};
const out = {};
for (const [k, p] of Object.entries(SRC)) {
  const buf = fs.readFileSync(p);
  const frames = JSON.parse(buf).frames;
  out[k] = { path: p, sha256: crypto.createHash('sha256').update(buf).digest('hex'), keys: Object.keys(frames).sort() };
  // mob sheets: the tell-pose floor ms[0] of every attack-type anim (content windups must be >= it)
  if (/^mobs/.test(k)) { out[k].tellMs = {}; for (const f of out[k].keys) if (frames[f].hit_frame != null) out[k].tellMs[f] = frames[f].ms[0]; }
}
fs.writeFileSync(path.join(__dirname, 'sheet-keys.json'), JSON.stringify(out, null, 1) + '\n');
console.log(Object.entries(out).map(([k, v]) => k + ' ' + v.keys.length + ' keys ' + v.sha256.slice(0, 8)).join('\n'));
