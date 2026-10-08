'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function load(names, extra) {
  const context = {
    console, Math, Date, Number, String, JSON, parseInt,
    navigator: { doNotTrack: '1', sendBeacon: () => false },
    location: { search: '' },
    localStorage: (() => {
      const bag = {};
      return {
        getItem: (k) => (k in bag ? bag[k] : null),
        setItem: (k, v) => { bag[k] = String(v); },
      };
    })(),
    document: extra && extra.document ? extra.document : {
      addEventListener() {},
      visibilityState: 'visible',
      getElementById: () => null,
      querySelectorAll: () => [],
    },
  };
  if (extra) {
    Object.keys(extra).forEach((k) => {
      if (k !== 'document') context[k] = extra[k];
    });
  }
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const name of names) {
    vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
  }
  vm.runInContext(
    ['SurvivorData', 'Ads'].map(n => 'if (typeof ' + n + ' !== "undefined") this.' + n + ' = ' + n + ';').join('\n'),
    context
  );
  return context;
}

const game = load(['js/survivor-data.js']);
const D = game.SurvivorData;
if (D.HERO !== 'sorcerer') fail('hero should be the sorcerer');
const ids = {};
D.CATALOG.forEach(item => {
  if (ids[item.id]) fail('duplicate upgrade ' + item.id);
  ids[item.id] = true;
  if (item.maxLevel < 2) fail(item.id + ' needs a level cap');
  if (!Object.prototype.hasOwnProperty.call(item, 'evolvesWith')) fail(item.id + ' missing evolvesWith');
});
if (D.CATALOG.length < 8 || D.CATALOG.length > 12) fail('upgrade pool should be about 8 to 10, got ' + D.CATALOG.length);
if (D.WEAPONS.length < 3) fail('need a starter bolt plus at least two more weapons');

const hitIn = D.TUNING.firstBolt + D.TUNING.spawnNear / D.TUNING.boltSpeed;
if (!(hitIn < 5)) fail('first bolt is later than 5s: ' + hitIn);
const killsForLevel = Math.ceil(D.xpToNext(1) / D.TUNING.gemXp);
if (killsForLevel > 12) fail('first level asks for too many kills: ' + killsForLevel);

const offers = D.pickOffers({ bolt: 1 }, () => 0);
if (offers.length !== 3) fail('level-up should offer 3 choices');
if (offers.some(o => o.id === 'bolt' && false)) fail('unexpected');
const maxed = {};
D.CATALOG.forEach(item => { maxed[item.id] = item.maxLevel; });
const filler = D.pickOffers(maxed, () => 0.5);
if (filler.length !== 3) fail('a full build should still offer 3 cards');

if (D.minuteReachedEvent(1) !== 'survivor-minute-1') fail('minute 1 name');
if (D.minuteReachedEvent(10) !== 'survivor-minute-10') fail('minute 10 name');
if (D.minuteReachedEvent(11) !== '') fail('minute 11 should not be its own event');
if (D.deathEvent(12) !== 'survivor-died-minute-0') fail('opening minute death');
if (D.deathEvent(90) !== 'survivor-died-minute-1') fail('minute 1 death');
if (D.deathEvent(700) !== 'survivor-died-minute-10') fail('late death caps at 10');
if (D.levelReachedEvent(1) !== 'survivor-level-1-5') fail('level 1 bucket');
if (D.levelReachedEvent(6) !== 'survivor-level-6-10') fail('level 6 bucket');
if (D.levelReachedEvent(11) !== 'survivor-level-11-20') fail('level 11 bucket');
if (D.levelReachedEvent(21) !== 'survivor-level-21-plus') fail('level 21 bucket');
if (D.levelUpCountEvent(0) !== 'survivor-levelups-0') fail('no level-ups');
if (D.levelUpCountEvent(8) !== 'survivor-levelups-8-plus') fail('many level-ups');

const meta = D.emptyMeta();
if (meta.version !== 1 || !meta.cosmetics || !('skin' in meta.cosmetics) || !('effect' in meta.cosmetics)) {
  fail('meta save is missing version or cosmetics');
}
if (!meta.upgrades || typeof meta.upgrades !== 'object') fail('meta save needs an upgrades slot');
const banked = D.bankGold(D.REWARDS.gold.win);
if (banked !== D.REWARDS.gold.win) fail('banked gold mismatch');
if (D.loadMeta().gold !== D.REWARDS.gold.win) fail('gold did not persist');

const html = fs.readFileSync(path.join(root, 'survivor.html'), 'utf8');
if (!html.includes('id="sv-play"') || !html.includes('id="sv-restart"')) fail('missing play or restart');
if (html.includes('click to move') || html.includes('Click / Tap')) fail('survivor should not teach click-to-move');
if (!html.includes('survivor.js?v=3')) fail('cache bust');
if (!html.includes('survivor-sprites.js?v=3')) fail('sprite module');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!index.includes('survivor.html?v=1')) fail('descent title is missing the survivor link');
if (!index.includes('Try: Survivor mode (beta)')) fail('link label');

const src = fs.readFileSync(path.join(root, 'js/survivor.js'), 'utf8');
if (src.includes('setPath') || src.includes('click-to-move')) fail('survivor grew a click path');
if (!src.includes('backButton') || !src.includes('holdMute')) fail('missing back button or background mute');
if (!src.includes("offerRevive") || !src.includes("offerReroll") || !src.includes("offerDoubleGold")) {
  fail('missing ad hooks');
}
if (!src.includes('setAllow')) fail('survivor should gate ad offers');
if (src.includes('setFlush(false)') || src.includes('clampArena')) fail('survivor still holds ads or walls the floor');
if (!src.includes('spawnOffscreen')) fail('enemies should spawn just off screen');
if (!src.includes('setPointerCapture')) fail('pointer drag should capture the mouse');
if (!src.includes('vowPayout')) fail('hermit cards should wait for the vow');
if (!src.includes('FLOAT_CAP = 40')) fail('floating numbers should cap near 40');
if (!src.includes('function pickupR')) fail('gem pickup radius missing');
if (html.includes('id="title-screen"') || html.includes('Choose Your Fate')) fail('survivor boots the descent menu');
if (!html.includes('sv-bench-boot')) fail('bench should skip the title flash');
if (!html.includes('id="sv-revive" class="big-btn secondary hidden"')) fail('revive should be hidden until an ad test');
if (src.includes('Utils.iso') || src.includes('screenToWorld')) fail('survivor camera should stay top-down');
if (!src.includes('prefers-reduced-motion')) fail('screen shake should honor reduced motion');
if (!src.includes('SurvivorSprites.drawHero')) fail('hero should draw through the sprite module');
if (!src.includes('dungeon-tileset-ii.png?v=3')) fail('tileset is not cache-busted');
if (src.includes('#ffe08a') || src.includes('#fff4e0')) fail('crowd damage numbers should stay white');
const sprites = fs.readFileSync(path.join(root, 'js/survivor-sprites.js'), 'utf8');
if (!sprites.includes('#5fd8ff')) fail('gems should be light cyan');
if (!sprites.includes('#7b4fd4')) fail('imps should be violet');
if (!sprites.includes('#e8ff6a')) fail('bolts should be lime');
if (!sprites.includes('#e07a28')) fail('hero robe should be warm');
if (!sprites.includes('#f4efe0')) fail('hero outline should be cream');

function fakeDocument() {
  const nodes = {};
  function make(id) {
    return {
      id,
      classList: {
        _hidden: true,
        toggle(name, on) { if (name === 'hidden') this._hidden = !!on; },
        add(name) { if (name === 'hidden') this._hidden = true; },
        remove(name) { if (name === 'hidden') this._hidden = false; },
        contains(name) { return name === 'hidden' && this._hidden; },
      },
      textContent: '',
      querySelector() { return { textContent: '' }; },
      addEventListener() {},
    };
  }
  return {
    _nodes: nodes,
    addEventListener() {},
    visibilityState: 'visible',
    getElementById(id) { return nodes[id] || (nodes[id] = make(id)); },
    querySelectorAll: () => [],
  };
}

const doc = fakeDocument();
const ads = load(['js/ads.js'], { document: doc, location: { search: '?adtest=1' } });
if (ads.Ads.offerRevive() !== 'shown') fail('direct revive should show when combat is clear');
if (doc._nodes['adtest-prompt'].classList.contains('hidden')) fail('placeholder stayed hidden');

function survivorAllow(mode) {
  return (kind) => {
    if (kind === 'reroll') return mode === 'levelup';
    if (kind === 'revive') return mode === 'dead';
    if (kind === 'gold') return mode === 'dead' || mode === 'won';
    return false;
  };
}

const dropLogs = [];
const lvlDoc = fakeDocument();
const lvlAds = load(['js/ads.js'], {
  document: lvlDoc,
  location: { search: '?adtest=1&debug=1' },
  console: { log: (...a) => dropLogs.push(a.join(' ')), error() {}, warn() {} },
});
lvlAds.Ads.setAllow(survivorAllow('levelup'));
if (lvlAds.Ads.offerDoubleGold() !== 'dropped') fail('double gold during level-up should drop');
if (!lvlDoc._nodes['adtest-prompt'].classList.contains('hidden')) fail('level-up gold opened a prompt');
if (!dropLogs.some((line) => line.indexOf('ad dropped: gold') >= 0)) fail('drop was not logged');
if (lvlAds.Ads.offerReroll() !== 'shown') fail('reroll from level-up should show');

const fightDoc = fakeDocument();
const fightAds = load(['js/ads.js'], { document: fightDoc, location: { search: '?adtest=1&debug=1' } });
fightAds.Ads.setAllow(survivorAllow('playing'));
const reviveMid = fightAds.Ads.offerRevive();
if (reviveMid !== 'dropped') fail('revive mid-fight should drop, got ' + reviveMid);
if (!fightDoc._nodes['adtest-prompt'].classList.contains('hidden')) fail('mid-fight revive opened a prompt');
if (!fightDoc._nodes['adtest-held'].classList.contains('hidden')) fail('mid-fight revive was held');

const deadDoc = fakeDocument();
const deadAds = load(['js/ads.js'], { document: deadDoc, location: { search: '?adtest=1' } });
deadAds.Ads.setAllow(survivorAllow('dead'));
if (deadAds.Ads.offerRevive() !== 'shown') fail('death screen revive should show');
const goldDoc = fakeDocument();
const goldAds = load(['js/ads.js'], { document: goldDoc, location: { search: '?adtest=1' } });
goldAds.Ads.setAllow(survivorAllow('dead'));
if (goldAds.Ads.offerDoubleGold() !== 'shown') fail('death screen double gold should show');

const plainDoc = fakeDocument();
const plainAds = load(['js/ads.js'], { document: plainDoc, location: { search: '' } });
plainAds.Ads.setAllow(survivorAllow('dead'));
if (plainAds.Ads.offerRevive() !== 'unavailable' || plainAds.Ads.offerDoubleGold() !== 'unavailable') {
  fail('plain url should show nothing');
}
const plainPrompt = plainDoc._nodes['adtest-prompt'];
const plainPanel = plainDoc._nodes['adtest-panel'];
if (plainPrompt && !plainPrompt.classList.contains('hidden')) fail('plain url opened a prompt');
if (!plainPanel || !plainPanel.classList.contains('hidden')) fail('plain url showed the ad panel');

console.log('survivor data ok, first hit ~' + hitIn.toFixed(2) + 's, first level ~' + killsForLevel + ' kills');
