/** Survivor mode data. Weapons can evolve later; nothing here is a shop. */
const SurvivorData = (() => {
  // The sorcerer already fights with a ranged bolt, so auto-attack is that
  // same staff and the thumb only steers. Warrior and rogue are melee.
  const HERO = 'sorcerer';

  const WEAPON_CAP = 5;
  const PASSIVE_CAP = 5;

  const WEAPONS = [
    { id: 'bolt', name: 'Ash Bolt', kind: 'weapon', blurb: 'Hurls ash-fire at the nearest demon.', maxLevel: WEAPON_CAP, evolvesWith: null },
    { id: 'orbit', name: 'Orbiting Blade', kind: 'weapon', blurb: 'Blades circle you and cut whatever they touch.', maxLevel: WEAPON_CAP, evolvesWith: null },
    { id: 'nova', name: 'Star Nova', kind: 'weapon', blurb: 'A ring of fire bursts outward.', maxLevel: WEAPON_CAP, evolvesWith: null },
    { id: 'pierce', name: 'Piercing Ash', kind: 'weapon', blurb: 'A bolt that keeps going through a line of demons.', maxLevel: WEAPON_CAP, evolvesWith: null },
  ];

  const PASSIVES = [
    { id: 'might', name: 'Might', kind: 'passive', blurb: '+12% damage each rank.', maxLevel: PASSIVE_CAP, evolvesWith: null },
    { id: 'haste', name: 'Haste', kind: 'passive', blurb: 'Weapons fire faster.', maxLevel: PASSIVE_CAP, evolvesWith: null },
    { id: 'magnet', name: 'Magnet', kind: 'passive', blurb: 'XP gems pull in from farther away.', maxLevel: PASSIVE_CAP, evolvesWith: null },
    { id: 'vitality', name: 'Vitality', kind: 'passive', blurb: '+15 max life each rank.', maxLevel: PASSIVE_CAP, evolvesWith: null },
    { id: 'area', name: 'Area', kind: 'passive', blurb: 'Novas, blades, and bolts cover more ground.', maxLevel: PASSIVE_CAP, evolvesWith: null },
    { id: 'armor', name: 'Armor', kind: 'passive', blurb: 'Each rank reduces a hit by 2.', maxLevel: PASSIVE_CAP, evolvesWith: null },
  ];

  const CATALOG = WEAPONS.concat(PASSIVES);

  // Every gold amount for a run lives here.
  const REWARDS = {
    gold: { skel: 1, imp: 1, brute: 3, mini: 12, win: 30, purse: 15 },
    doubleMult: 2,
  };

  // Opening pace: a bolt connects in the first few seconds, a level before a minute.
  const TUNING = {
    firstBolt: 0.35,
    spawnNear: 4.2,
    boltSpeed: 9,
    earlyHp: 18,
    boltDamage: 12,
    gemXp: 2,
  };

  const META_KEY = 'abyss-survivor-meta';

  function emptyMeta() {
    return {
      version: 1,
      gold: 0,
      upgrades: {},
      cosmetics: { skin: null, effect: null },
    };
  }

  function loadMeta() {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return emptyMeta();
      const data = JSON.parse(raw);
      const blank = emptyMeta();
      if (!data || data.version !== 1) return blank;
      blank.gold = Math.max(0, Number(data.gold) || 0);
      blank.upgrades = data.upgrades && typeof data.upgrades === 'object' ? data.upgrades : {};
      const skin = data.cosmetics && data.cosmetics.skin;
      const effect = data.cosmetics && data.cosmetics.effect;
      blank.cosmetics.skin = skin == null ? null : String(skin);
      blank.cosmetics.effect = effect == null ? null : String(effect);
      return blank;
    } catch (e) {
      return emptyMeta();
    }
  }

  function saveMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {}
  }

  function bankGold(amount) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    const meta = loadMeta();
    meta.gold += n;
    saveMeta(meta);
    return meta.gold;
  }

  function xpToNext(level) {
    return 16 + (Math.max(1, level) - 1) * 8;
  }

  function minuteReachedEvent(minute) {
    const n = Math.floor(Number(minute));
    if (n < 1 || n > 10) return '';
    return 'survivor-minute-' + n;
  }

  function deathEvent(seconds) {
    const m = Math.min(10, Math.max(0, Math.floor(Number(seconds) / 60)));
    return 'survivor-died-minute-' + m;
  }

  function levelReachedEvent(level) {
    const n = Math.max(1, Math.floor(Number(level) || 1));
    if (n <= 5) return 'survivor-level-1-5';
    if (n <= 10) return 'survivor-level-6-10';
    if (n <= 20) return 'survivor-level-11-20';
    return 'survivor-level-21-plus';
  }

  function levelUpCountEvent(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 0) return 'survivor-levelups-0';
    if (n <= 3) return 'survivor-levelups-1-3';
    if (n <= 7) return 'survivor-levelups-4-7';
    return 'survivor-levelups-8-plus';
  }

  function pickOffers(owned, rng) {
    const random = rng || Math.random;
    const bag = [];
    for (let i = 0; i < CATALOG.length; i++) {
      const item = CATALOG[i];
      const lv = owned && owned[item.id] ? owned[item.id] : 0;
      if (lv < item.maxLevel) bag.push(item);
    }
    const out = [];
    while (out.length < 3 && bag.length) {
      const i = Math.floor(random() * bag.length);
      out.push(bag.splice(i, 1)[0]);
    }
    while (out.length < 3) {
      out.push({
        id: out.length % 2 === 0 ? 'purse' : 'heal',
        name: out.length % 2 === 0 ? 'Coin purse' : 'Second wind',
        kind: 'reward',
        blurb: out.length % 2 === 0 ? 'Take 15 gold.' : 'Heal 30% of your life.',
        maxLevel: 99,
        evolvesWith: null,
      });
    }
    return out;
  }

  return {
    HERO, WEAPONS, PASSIVES, CATALOG, REWARDS, TUNING, WEAPON_CAP, PASSIVE_CAP,
    META_KEY, emptyMeta, loadMeta, saveMeta, bankGold, xpToNext,
    minuteReachedEvent, deathEvent, levelReachedEvent, levelUpCountEvent, pickOffers,
  };
})();
