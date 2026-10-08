'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');

function hash(rel, base) {
  const data = fs.readFileSync(path.join(base, rel));
  return crypto.createHash('sha256').update(data).digest('hex');
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const rootHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const wwwHtml = fs.readFileSync(path.join(www, 'index.html'), 'utf8');

if (rootHtml.includes('mobile/shell')) {
  fail('root index.html links the native shell');
}
const rootSurvivor = fs.readFileSync(path.join(root, 'survivor.html'), 'utf8');
const wwwSurvivor = fs.readFileSync(path.join(www, 'survivor.html'), 'utf8');
if (rootSurvivor.includes('mobile/shell')) fail('root survivor.html links the native shell');
if (!wwwSurvivor.includes('mobile/shell.css') || !wwwSurvivor.includes('mobile/shell.js')) {
  fail('www/survivor.html is missing the Capacitor shell');
}
if (!rootSurvivor.includes('survivor.js?v=6.1.1')) fail('survivor.html is missing its cache bust');
const assetTags = [];
const tagRe = /<(script|link)\b[^>]*>/gi;
let tagMatch;
while ((tagMatch = tagRe.exec(rootSurvivor))) {
  const tag = tagMatch[0];
  const script = /^<script/i.test(tag);
  if (script) {
    const src = /src\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!src || /^(https?:)?\/\//i.test(src[1])) continue;
    assetTags.push(src[1]);
  } else if (/rel\s*=\s*["']stylesheet["']/i.test(tag)) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!href || /^(https?:)?\/\//i.test(href[1])) continue;
    assetTags.push(href[1]);
  }
}
if (assetTags.length < 11) fail('survivor.html local assets ' + assetTags.length);
let cacheV = '';
assetTags.forEach((url) => {
  const q = /\?v=([^&]+)$/.exec(url);
  if (!q) fail('survivor.html asset is missing ?v=: ' + url);
  if (!cacheV) cacheV = q[1];
  else if (q[1] !== cacheV) fail('survivor.html ?v= mismatch ' + url + ' vs ' + cacheV);
});
const indexSurvivor = /href="survivor\.html\?v=([^"]+)"/.exec(rootHtml);
if (!indexSurvivor || indexSurvivor[1] !== cacheV) fail('index.html survivor link ?v= does not match survivor.html');
const survivorSrc = fs.readFileSync(path.join(root, 'js/survivor.js'), 'utf8');
if (!survivorSrc.includes('dungeon-tileset-ii.png?v=' + cacheV)) {
  fail('sprite sheet is missing ?v=' + cacheV);
}
if (!survivorSrc.includes('assets/ui/vow_badge.png?v=' + cacheV)) {
  fail('vow badge is missing ?v=' + cacheV);
}
if (!wwwHtml.includes('mobile/shell.css') || !wwwHtml.includes('mobile/shell.js')) {
  fail('www/index.html is missing the Capacitor shell');
}
if (!fs.existsSync(path.join(www, 'mobile', 'shell.css'))) fail('missing www/mobile/shell.css');
if (!fs.existsSync(path.join(www, 'mobile', 'shell.js'))) fail('missing www/mobile/shell.js');

const shared = [
  'css/style.css',
  'js/game.js',
  'js/audio.js',
  'js/map.js',
  'js/quests.js',
  'js/ui.js',
  'favicon.svg',
];
for (const rel of shared) {
  if (hash(rel, root) !== hash(rel, www)) {
    fail(rel + ' in www/ does not match the Pages source');
  }
}

const shellCss = fs.readFileSync(path.join(www, 'mobile', 'shell.css'), 'utf8');
if (!shellCss.includes('safe-area-inset-top') || !shellCss.includes('--safe-top')) {
  fail('shell.css is missing safe-area padding');
}
const shellJs = fs.readFileSync(path.join(www, 'mobile', 'shell.js'), 'utf8');
if (!shellJs.includes('GameAudio') || !shellJs.includes('touchstart')) {
  fail('shell.js is missing first-tap audio unlock');
}

console.log('www/ matches the Pages assets and includes the native shell.');
