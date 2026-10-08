#!/usr/bin/env node
'use strict';

/**
 * Abyss Descent — banned-names check.
 *
 * House rule: RSC-inspired look is fine; Jagex / RuneScape names are not.
 * Our words: sigil (not rune); materials Rustbound, Cinderiron, Verdite,
 * Tidesteel, Sunforged; chase drop Wyrmfang.
 *
 *   const { check } = require('./banned-names');
 *   check(name) -> ['FAIL'|'WARN'|'OK', reason]
 *
 * CLI: node banned-names.js file...
 *   Scans name/label/title/id/icon/evolveName string literals, prints FAIL and
 *   WARN lines, also FAILs when two weapon lines share a final noun (base +
 *   evolution = one line). Exits 1 on any FAIL.
 */

// --- helpers ---------------------------------------------------------------

function normalize(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordList(name) {
  const n = normalize(name);
  return n ? n.split(' ') : [];
}

function finalNoun(name) {
  const w = wordList(name);
  return w.length ? w[w.length - 1] : '';
}

/** True if `phrase` (space-separated words) appears as a contiguous whole-word run. */
function hasPhrase(words, phrase) {
  const p = phrase.split(' ');
  if (p.length === 0 || p.length > words.length) return false;
  for (let i = 0; i <= words.length - p.length; i++) {
    let ok = true;
    for (let j = 0; j < p.length; j++) {
      if (words[i + j] !== p[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function hasWord(words, w) {
  return words.indexOf(w) !== -1;
}

// --- FAIL data -------------------------------------------------------------

const FAIL_WORDS = [
  'rune', 'runes', 'runite', 'runescape', 'jagex', 'gielinor',
  'mithril', 'adamant', 'adamantite',
  'godsword', 'abyssal', 'barrows',
  'dharok', 'ahrim', 'karil', 'guthan', 'torag', 'verac',
  'saradomin', 'zamorak', 'guthix', 'armadyl', 'bandos', 'zaros', 'seren',
  'lumbridge', 'varrock', 'falador', 'draynor', 'ardougne', 'karamja',
  'wilderness', 'misthalin', 'asgarnia', 'kandarin', 'morytania',
  'blowpipe', 'partyhat',
  'r2h', 'dds', 'dfs', 'ags', 'sgs', 'zgs', 'bgs',
  'teleblock', 'vengeance',
];

const FAIL_PHRASES = [
  'crumble undead',
  'teleblock',
  'vengeance',
  'wind strike', 'wind bolt', 'wind blast', 'wind wave', 'wind surge',
  'water strike', 'water bolt', 'water blast', 'water wave', 'water surge',
  'earth strike', 'earth bolt', 'earth blast', 'earth wave', 'earth surge',
  'fire strike', 'fire bolt', 'fire blast', 'fire wave', 'fire surge',
  'ice rush', 'ice burst', 'ice blitz', 'ice barrage',
  'blood rush', 'blood burst', 'blood blitz', 'blood barrage',
  'smoke rush', 'smoke burst', 'smoke blitz', 'smoke barrage',
  'shadow rush', 'shadow burst', 'shadow blitz', 'shadow barrage',
  'dragonfire shield',
  'fire cape',
  'party hat',
  'amulet of glory',
  'amulet of fury',
  'amulet of torture',
  'berserker ring',
  'ring of wealth',
  'dragon bones',
  'd scim',
  'd long',
];

const METALS = [
  'bronze', 'iron', 'steel', 'black', 'mithril', 'adamant',
  'rune', 'dragon', 'granite', 'obsidian',
];

const EQUIP_1 = [
  'dagger', 'sword', 'longsword', 'scimitar', 'mace', 'warhammer', 'battleaxe',
  '2h', 'hatchet', 'axe', 'pickaxe', 'spear', 'halberd', 'claws', 'whip',
  'maul', 'javelin', 'dart', 'knife', 'thrownaxe', 'arrows', 'bolts',
  'crossbow', 'shortbow', 'longbow', 'platebody', 'platelegs', 'plateskirt',
  'kiteshield', 'chainbody', 'boots', 'gloves', 'bar', 'ore',
];
const EQUIP_2 = [
  ['med', 'helm'],
  ['full', 'helm'],
  ['sq', 'shield'],
];

// --- WARN data -------------------------------------------------------------

const WARN_WORDS = ['crumble', 'barrow'];
const WARN_PHRASES = ['dragon scale', 'dragonhide'];
const WARN_FIRST = [
  'chaos', 'soul', 'law', 'nature', 'cosmic', 'astral',
  'wrath', 'blood', 'death', 'mind', 'body',
];

// --- check() ---------------------------------------------------------------

/**
 * @param {string} name
 * @returns {[('FAIL'|'WARN'|'OK'), string]}
 */
function check(name) {
  const words = wordList(name);
  if (words.length === 0) return ['OK', 'empty'];

  for (const ph of FAIL_PHRASES) {
    if (hasPhrase(words, ph)) {
      return ['FAIL', 'banned phrase "' + ph + '"'];
    }
  }

  for (const w of FAIL_WORDS) {
    if (hasWord(words, w)) {
      return ['FAIL', 'banned word "' + w + '"'];
    }
  }

  for (let i = 0; i < words.length; i++) {
    if (METALS.indexOf(words[i]) === -1) continue;
    const metal = words[i];
    if (i + 1 < words.length && EQUIP_1.indexOf(words[i + 1]) !== -1) {
      return ['FAIL', 'RS metal+gear "' + metal + ' ' + words[i + 1] + '"'];
    }
    if (i + 2 < words.length) {
      for (const eq of EQUIP_2) {
        if (words[i + 1] === eq[0] && words[i + 2] === eq[1]) {
          return ['FAIL', 'RS metal+gear "' + metal + ' ' + eq[0] + ' ' + eq[1] + '"'];
        }
      }
    }
  }

  for (const ph of WARN_PHRASES) {
    if (hasPhrase(words, ph)) {
      return ['WARN', 'review phrase "' + ph + '"'];
    }
  }

  for (const w of WARN_WORDS) {
    if (hasWord(words, w)) {
      return ['WARN', 'review word "' + w + '"'];
    }
  }

  if (WARN_FIRST.indexOf(words[0]) !== -1) {
    return ['WARN', 'RS rune-type as first word "' + words[0] + '"'];
  }

  return ['OK', 'clean'];
}

// --- weapon-line final-noun clash ------------------------------------------

/**
 * Pull weapon lines from a survivor-style data file.
 * A line is a kind:'weapon' display name plus its evolveName (if any).
 * Passives and bare evolution entries are not separate lines.
 *
 * @returns {{ names: string[] }[]}
 */
function extractWeaponLines(source) {
  const result = [];
  const re = /kind:\s*'weapon'/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const before = source.slice(Math.max(0, m.index - 500), m.index);
    // Bound the object: stop at the closing `},` so we do not read the next entry.
    const afterRaw = source.slice(m.index, Math.min(source.length, m.index + 2500));
    const endM = afterRaw.match(/\n\s*\},/);
    const after = endM ? afterRaw.slice(0, endM.index) : afterRaw;
    const namesBefore = [];
    const nameRe = /name:\s*'([^']+)'/g;
    let nm;
    while ((nm = nameRe.exec(before)) !== null) namesBefore.push(nm[1]);
    if (!namesBefore.length) continue;
    const base = namesBefore[namesBefore.length - 1];
    const names = [base];
    // Only pair when evolvesInto is a real id (not null).
    const evoM = after.match(/evolveName:\s*'([^']+)'\s*,\s*evolvesInto:\s*'([^']+)'/);
    if (evoM) names.push(evoM[1]);
    result.push({ names: names });
  }
  return result;
}

/**
 * FAIL when two separate weapon lines share the same final noun
 * (e.g. Arc Sigil line and Gale Sigil line both end in "Sigil").
 * Sharing a noun inside one line (base + evolution) is allowed.
 *
 * @param {{ names: string[] }[]} weaponLines
 * @returns {{ noun: string, names: string[] }[]}
 */
function checkNounClashes(weaponLines) {
  const byNoun = new Map();
  weaponLines.forEach((line, index) => {
    const seenNouns = new Set();
    for (let i = 0; i < line.names.length; i++) {
      const noun = finalNoun(line.names[i]);
      if (!noun || seenNouns.has(noun)) continue;
      seenNouns.add(noun);
      if (!byNoun.has(noun)) byNoun.set(noun, []);
      byNoun.get(noun).push({ index: index, names: line.names.slice() });
    }
  });

  const clashes = [];
  for (const [noun, groups] of byNoun.entries()) {
    const uniq = [];
    const seen = new Set();
    for (let i = 0; i < groups.length; i++) {
      if (seen.has(groups[i].index)) continue;
      seen.add(groups[i].index);
      uniq.push(groups[i]);
    }
    if (uniq.length < 2) continue;
    const names = [];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = 0; j < uniq[i].names.length; j++) names.push(uniq[i].names[j]);
    }
    clashes.push({ noun: noun, names: names });
  }
  return clashes;
}

// --- file scan -------------------------------------------------------------

const FIELD_RE = /(?:^|[,{\s;])(name|label|title|id|icon|evolveName)\s*:\s*(['"])(.*?)\2/g;

function extractNames(source) {
  const out = [];
  let m;
  FIELD_RE.lastIndex = 0;
  while ((m = FIELD_RE.exec(source)) !== null) {
    out.push({ field: m[1], value: m[3] });
  }
  return out;
}

function scanFile(filePath, fs) {
  const src = fs.readFileSync(filePath, 'utf8');
  const entries = extractNames(src);
  const lines = [];
  let fails = 0;
  let warns = 0;
  const seen = new Set();
  for (let i = 0; i < entries.length; i++) {
    const field = entries[i].field;
    const value = entries[i].value;
    const key = field + '\0' + value;
    if (seen.has(key)) continue;
    seen.add(key);
    const pair = check(value);
    const verdict = pair[0];
    const reason = pair[1];
    if (verdict === 'FAIL' || verdict === 'WARN') {
      lines.push(verdict + '\t' + value + '\t' + reason + '\t[' + field + ']');
      if (verdict === 'FAIL') fails += 1;
      else warns += 1;
    }
  }

  const weaponLines = extractWeaponLines(src);
  const clashes = checkNounClashes(weaponLines);
  for (let i = 0; i < clashes.length; i++) {
    const c = clashes[i];
    const reason = 'shared final noun "' + c.noun + '" across weapon lines: ' + c.names.join(' / ');
    lines.push('FAIL\t(noun-clash)\t' + reason + '\t[weapon-line]');
    fails += 1;
  }

  return {
    lines: lines,
    fails: fails,
    warns: warns,
    total: seen.size,
    entries: entries,
    weaponLines: weaponLines,
    clashes: clashes,
  };
}

// --- self-test -------------------------------------------------------------

const MUST_FAIL = [
  'Chaos Rune', 'Blood Rune', 'Rune Battleaxe', 'Rune Javelin', 'Gale Rune',
  'Iron Hatchet', 'Dragon Scimitar', 'Abyssal Whip', 'Granite Maul',
  'Crumble Undead', 'Barrows Gloves', 'Mithril Platebody', 'Fire Blast', 'Ice Barrage',
];

const MUST_PASS = [
  'Ash Bolt', 'Wyrmfang', 'Sunforged Plate', 'Tidesteel Edge', 'Cinderiron Maul',
  'Verdite Sigil', 'Storm of Blades', 'Rustbound Hatchet', 'Wyrmbane Lance',
];

function selfTest() {
  const errors = [];
  for (let i = 0; i < MUST_FAIL.length; i++) {
    const n = MUST_FAIL[i];
    const pair = check(n);
    if (pair[0] !== 'FAIL') errors.push('expected FAIL for "' + n + '", got ' + pair[0] + ' (' + pair[1] + ')');
  }
  for (let i = 0; i < MUST_PASS.length; i++) {
    const n = MUST_PASS[i];
    const pair = check(n);
    if (pair[0] !== 'OK' && pair[0] !== 'WARN') {
      errors.push('expected OK/WARN for "' + n + '", got ' + pair[0] + ' (' + pair[1] + ')');
    }
  }
  const materials = ['Cinderiron Hatchet', 'Tidesteel Sword', 'Sunforged Maul', 'Rustbound Axe', 'Verdite Dagger'];
  for (let i = 0; i < materials.length; i++) {
    const n = materials[i];
    const pair = check(n);
    if (pair[0] === 'FAIL') errors.push('material tier falsely FAILed "' + n + '": ' + pair[1]);
  }

  // final-noun clash: two Sigil lines must FAIL; one Sigil line must pass
  const clash = checkNounClashes([
    { names: ['Arc Sigil', 'Crimson Sigil'] },
    { names: ['Gale Sigil', 'Tempest Sigil'] },
  ]);
  if (clash.length !== 1 || clash[0].noun !== 'sigil') {
    errors.push('expected one sigil noun-clash, got ' + JSON.stringify(clash));
  }
  const okLines = checkNounClashes([
    { names: ['Arc Sigil', 'Crimson Sigil'] },
    { names: ['Gale Burst', 'Tempest Ring'] },
    { names: ['Wailing Skull', 'Gravelight Lantern'] },
  ]);
  if (okLines.length !== 0) {
    errors.push('expected no noun-clash for distinct finals, got ' + JSON.stringify(okLines));
  }
  // same noun inside one line is fine
  const sameLine = checkNounClashes([{ names: ['Arc Sigil', 'Crimson Sigil'] }]);
  if (sameLine.length !== 0) {
    errors.push('same-line Sigil pair should not clash, got ' + JSON.stringify(sameLine));
  }

  return errors;
}

// --- CLI -------------------------------------------------------------------

function main(argv) {
  const fs = require('fs');
  const path = require('path');

  const testErrors = selfTest();
  if (testErrors.length) {
    console.error('SELF-TEST FAILED:');
    for (let i = 0; i < testErrors.length; i++) console.error('  ' + testErrors[i]);
    process.exit(1);
  }

  const files = argv.slice(2).filter(function (a) { return a && a.charAt(0) !== '-'; });
  if (files.length === 0) {
    console.log('self-test: OK (' + MUST_FAIL.length + ' fail cases, ' + MUST_PASS.length + ' pass cases, noun-clash rules)');
    console.log('usage: node banned-names.js <file>...');
    process.exit(0);
  }

  let anyFail = false;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) {
      console.error('FAIL\t(missing file)\t' + f);
      anyFail = true;
      continue;
    }
    const result = scanFile(abs, fs);
    for (let j = 0; j < result.lines.length; j++) {
      console.log(result.lines[j] + '\t(' + f + ')');
    }
    if (result.fails > 0) anyFail = true;
  }

  process.exit(anyFail ? 1 : 0);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  check: check,
  extractNames: extractNames,
  extractWeaponLines: extractWeaponLines,
  checkNounClashes: checkNounClashes,
  scanFile: scanFile,
  selfTest: selfTest,
  normalize: normalize,
  finalNoun: finalNoun,
};
