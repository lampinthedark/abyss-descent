'use strict';

/**
 * Names lint for the RPG (UAT gate 6: no Jagex / RuneScape names).
 * Scans js/rpg/ (recursively), rpg.html and the RPG data in assets/rpg/*.json.
 * Whole-word, case-insensitive, after splitting camelCase / snake_case.
 * Our words are fine: "sigil" (never "rune"), Rustbound, Cinderiron, Verdite,
 * Tidesteel, Sunforged.
 *
 * JS comments are checked too, except that design notes may say "dragon"
 * (e.g. "the dragon-tier sword"): that word is only enforced in code/strings.
 * Exempt one line with a trailing `names-ok` comment (use sparingly).
 * The UAT banned list itself (dev/rpg/vendor/banned-names.js) is never scanned.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const TARGETS = ['js/rpg', 'rpg.html', 'assets/rpg'];
const SKIP = new Set(['dev/rpg/vendor/banned-names.js']);
const EXT = new Set(['.js', '.html', '.json']);

// Words (whole word after normalising). Kept here, in scripts/, which is not scanned.
const WORDS = [
  'rune', 'runes', 'runite', 'runecraft', 'runecrafting', 'runescape', 'rs2', 'osrs', 'rsc', 'jagex',
  'gielinor', 'lumbridge', 'varrock', 'falador', 'draynor', 'edgeville', 'karamja', 'ardougne',
  'catherby', 'camelot', 'taverley', 'burthorpe', 'misthalin', 'asgarnia', 'kandarin', 'morytania',
  'zamorak', 'saradomin', 'guthix', 'zaros', 'mithril', 'mithrel', 'adamant', 'adamantite', 'addy',
  'dragon', 'dragons', 'dragonstone', 'dragonhide', 'scimitar', 'scimmy', 'runeite', 'tzhaar',
];
// Phrases (space separated, matched on the normalised text).
const PHRASES = [
  'rune scape', 'al kharid', 'port sarim', 'wise old man', 'duke horacio', 'cooks assistant',
  'cook s assistant', 'dragon slayer', 'abyssal whip', 'black knight', 'blue moon inn',
  'bob s brilliant axes', 'grand exchange', 'king black',
];

function normalise(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./\\]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

const wordRe = new RegExp('(?:^| )(' + WORDS.join('|') + ')(?= |$)');
const phraseRe = new RegExp('(?:^| )(' + PHRASES.map((p) => p.replace(/ /g, ' +')).join('|') + ')(?= |$)');

const COMMENT_OK = new Set(['dragon', 'dragons']);

function checkText(text, inComment) {
  const n = ' ' + normalise(text) + ' ';
  const re = new RegExp(wordRe.source, 'g');
  let m;
  while ((m = re.exec(n))) {
    if (!(inComment && COMMENT_OK.has(m[1]))) return m[1];
    re.lastIndex = m.index + m[0].length;
  }
  const p = phraseRe.exec(n);
  return p ? p[1] : null;
}

/**
 * Split JS source into per-line { code, comment } text with a small scanner
 * (strings, template literals, regex-free heuristics are enough here).
 */
function splitJs(src) {
  const lines = [{ code: '', comment: '' }];
  let i = 0;
  let mode = 'code'; // code | line | block | ' | " | `
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    const cur = lines[lines.length - 1];
    if (c === '\n') {
      if (mode === 'line') mode = 'code';
      lines.push({ code: '', comment: '' });
      i++;
      continue;
    }
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') mode = c;
      cur.code += c;
    } else if (mode === 'line') {
      cur.comment += c;
    } else if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; i += 2; continue; }
      cur.comment += c;
    } else {
      if (c === '\\') { cur.code += c + (d || ''); i += 2; continue; }
      if (c === mode) mode = 'code';
      cur.code += c;
    }
    i++;
  }
  return lines;
}

function walk(rel, out) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    fs.readdirSync(abs).sort().forEach((n) => walk(path.join(rel, n), out));
  } else if (EXT.has(path.extname(rel)) && !SKIP.has(rel.split(path.sep).join('/'))) {
    out.push(rel);
  }
}

// Self-test so a broken regex can never pass silently.
const MUST_FAIL = ['Rune scimitar', 'runeScimitar', 'mithril_bar', 'Adamant platebody', 'dragon longsword',
  'Welcome to Lumbridge', 'VARROCK', 'jagex', 'RuneScape', 'Al Kharid gate', 'wise old man'];
const MUST_PASS = ['sigil', 'Sigil Bolt', 'Rustbound sword', 'prune', 'brunette', 'Abyss Descent', 'Tidesteel',
  'Sunforged', 'Verdite', 'Cinderiron', 'tribune', 'fortune', 'drag one'];
const selfBad = [];
if (!checkText('the dragon tier', false)) selfBad.push('dragon in code should fail');
if (checkText('the dragon-tier sword', true)) selfBad.push('dragon in a comment should pass');
if (!checkText('rune ring', true)) selfBad.push('rune in a comment should fail');
const sj = splitJs("const a = 'x // y'; // dragon tier\n/* rune */ b();");
if (sj[0].comment.indexOf('dragon') < 0 || sj[0].code.indexOf('x // y') < 0 || sj[1].comment.indexOf('rune') < 0) {
  selfBad.push('splitJs');
}
MUST_FAIL.forEach((s) => { if (!checkText(s)) selfBad.push('should fail: ' + s); });
MUST_PASS.forEach((s) => { const h = checkText(s); if (h) selfBad.push('should pass: ' + s + ' (' + h + ')'); });
if (selfBad.length) {
  console.error('check-names self-test failed:\n  ' + selfBad.join('\n  '));
  process.exit(1);
}

const files = [];
TARGETS.forEach((t) => walk(t, files));
const hits = [];
files.forEach((rel) => {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const raw = src.split('\n');
  const parts = rel.endsWith('.js') ? splitJs(src) : raw.map((l) => ({ code: l, comment: '' }));
  parts.forEach((part, i) => {
    if (/names-ok/.test(raw[i] || '')) return;
    const h = checkText(part.code, false) || checkText(part.comment, true);
    if (h) hits.push(rel + ':' + (i + 1) + ': banned name "' + h + '"');
  });
});

if (hits.length) {
  console.error(hits.join('\n'));
  console.error('names: ' + hits.length + ' banned name(s). Use our own names (e.g. "sigil", Rustbound...).');
  process.exit(1);
}
console.log('names ok: ' + files.length + ' RPG files clean.');
