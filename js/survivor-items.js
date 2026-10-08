/**
 * Survivor items, split save, and the permanent gold shop.
 * This is the only survivor module that touches localStorage.
 * Items are local and tradeable:false so a later trade layer can reuse the shape.
 */
const SurvivorSave = (() => {
  const KEYS = {
    profile: 'abyss-survivor-profile',
    inventory: 'abyss-survivor-inventory',
    progress: 'abyss-survivor-progress',
    legacy: 'abyss-survivor-meta',
  };
  const SCHEMA = 1;

  const RARITY = {
    common: { name: 'Common', color: '#8a857d' },
    uncommon: { name: 'Uncommon', color: '#5ed37a' },
    rare: { name: 'Rare', color: '#4c7cff' },
    epic: { name: 'Epic', color: '#d0b4ff' },
    legendary: { name: 'Legendary', color: '#d7e4ff' },
  };
  const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  const BASES = {
    'iron-blade': { name: 'Iron Blade', stats: { might: 0.02 } },
    'bone-charm': { name: 'Bone Charm', stats: { life: 4 } },
    'ash-bead': { name: 'Ash Bead', stats: { greed: 0.02 } },
  };

  const SHOP = [
    { id: 'vitality', name: 'Vitality', blurb: '+12 max life', max: 8, cost: (n) => 40 + n * 35 },
    { id: 'might', name: 'Might', blurb: '+6% damage', max: 8, cost: (n) => 50 + n * 40 },
    { id: 'stride', name: 'Stride', blurb: '+4% move speed', max: 6, cost: (n) => 45 + n * 40 },
    { id: 'magnet', name: 'Magnet', blurb: 'Gems start farther out', max: 6, cost: (n) => 35 + n * 30 },
    { id: 'revival', name: 'Second Chance', blurb: 'Once a run, survive at 30% life', max: 1, cost: () => 180 },
    { id: 'greed', name: 'Greed', blurb: '+8% gold found', max: 6, cost: (n) => 40 + n * 45 },
  ];

  let migrated = false;

  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function write(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  function uuid() {
    const buf = new Array(16);
    for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
    buf[6] = (buf[6] & 15) | 64;
    buf[8] = (buf[8] & 63) | 128;
    const hex = buf.map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function emptyProfile() {
    return { version: SCHEMA, playerId: uuid(), cosmetics: { skin: null, effect: null } };
  }

  function emptyInventory() {
    return { version: SCHEMA, items: [] };
  }

  function emptyProgress() {
    return { version: SCHEMA, gold: 0, upgrades: {}, bestTime: 0, bestKills: 0 };
  }

  function migrate() {
    if (migrated) return;
    migrated = true;
    const progress = read(KEYS.progress);
    if (progress && progress.version === SCHEMA) return;
    const legacy = read(KEYS.legacy);
    if (!legacy) return;
    const profile = emptyProfile();
    const inventory = emptyInventory();
    const next = emptyProgress();
    next.gold = Math.max(0, Number(legacy.gold) || 0);
    next.upgrades = legacy.upgrades && typeof legacy.upgrades === 'object' ? legacy.upgrades : {};
    const skin = legacy.cosmetics && legacy.cosmetics.skin;
    const effect = legacy.cosmetics && legacy.cosmetics.effect;
    profile.cosmetics.skin = skin == null ? null : String(skin);
    profile.cosmetics.effect = effect == null ? null : String(effect);
    write(KEYS.profile, profile);
    write(KEYS.inventory, inventory);
    write(KEYS.progress, next);
  }

  function loadProfile() {
    migrate();
    const data = read(KEYS.profile);
    if (!data || data.version !== SCHEMA || !data.playerId) {
      const fresh = emptyProfile();
      write(KEYS.profile, fresh);
      return fresh;
    }
    if (!data.cosmetics) data.cosmetics = { skin: null, effect: null };
    return data;
  }

  function loadInventory() {
    migrate();
    const data = read(KEYS.inventory);
    if (!data || data.version !== SCHEMA || !Array.isArray(data.items)) {
      const fresh = emptyInventory();
      write(KEYS.inventory, fresh);
      return fresh;
    }
    return data;
  }

  function loadProgress() {
    migrate();
    const data = read(KEYS.progress);
    if (!data || data.version !== SCHEMA) {
      const fresh = emptyProgress();
      write(KEYS.progress, fresh);
      return fresh;
    }
    data.gold = Math.max(0, Number(data.gold) || 0);
    if (!data.upgrades || typeof data.upgrades !== 'object') data.upgrades = {};
    data.bestTime = Math.max(0, Number(data.bestTime) || 0);
    data.bestKills = Math.max(0, Number(data.bestKills) || 0);
    return data;
  }

  function saveProfile(data) { data.version = SCHEMA; write(KEYS.profile, data); }
  function saveInventory(data) { data.version = SCHEMA; write(KEYS.inventory, data); }
  function saveProgress(data) { data.version = SCHEMA; write(KEYS.progress, data); }

  // Derived stats stay in memory. Rank, gold, and item bonuses are read
  // every frame; they must not touch localStorage again until a purchase,
  // a drop, or a migration changes the save.
  let derived = null;

  function bonusFrom(list) {
    let might = 0;
    let life = 0;
    let greed = 0;
    (list || []).forEach((it) => {
      const stats = it && it.stats ? it.stats : {};
      might += Number(stats.might) || 0;
      life += Number(stats.life) || 0;
      greed += Number(stats.greed) || 0;
    });
    return {
      might: Math.min(0.2, might),
      life: Math.min(30, life),
      greed: Math.min(0.4, greed),
    };
  }

  function refreshDerived() {
    const progress = loadProgress();
    const bag = loadInventory();
    const bonus = bonusFrom(bag.items);
    derived = {
      gold: progress.gold,
      upgrades: Object.assign({}, progress.upgrades || {}),
      might: bonus.might,
      life: bonus.life,
      greed: bonus.greed,
    };
    return derived;
  }

  function view() {
    return derived || refreshDerived();
  }

  function rank(id) {
    return Math.max(0, Number(view().upgrades[id]) || 0);
  }

  function gold() {
    return view().gold;
  }

  function bankGold(amount) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    const p = loadProgress();
    p.gold += n;
    saveProgress(p);
    refreshDerived();
    return p.gold;
  }

  function roman(n) {
    const map = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    return map[n] || String(n);
  }

  function shopList() {
    const d = view();
    return SHOP.map((u) => {
      const have = Math.max(0, Number(d.upgrades[u.id]) || 0);
      const soldOut = have >= u.max;
      const cost = soldOut ? 0 : u.cost(have);
      return {
        id: u.id,
        name: u.name,
        blurb: u.blurb,
        rank: have,
        max: u.max,
        cost: cost,
        soldOut: soldOut,
        label: u.name + ' ' + roman(Math.min(u.max, have + 1)),
      };
    });
  }

  function nextUpgrade(haveGold) {
    const goldNow = haveGold == null ? gold() : haveGold;
    let best = null;
    shopList().forEach((u) => {
      if (u.soldOut) return;
      const away = Math.max(0, u.cost - goldNow);
      if (!best || away < best.away || (away === best.away && u.cost < best.cost)) {
        best = { id: u.id, name: u.name, label: u.label, cost: u.cost, away: away, rank: u.rank + 1 };
      }
    });
    return best;
  }

  function buy(id) {
    const spec = SHOP.find((u) => u.id === id);
    if (!spec) return { ok: false, reason: 'missing' };
    const p = loadProgress();
    const have = Math.max(0, Number(p.upgrades[id]) || 0);
    if (have >= spec.max) return { ok: false, reason: 'max' };
    const cost = spec.cost(have);
    if (p.gold < cost) return { ok: false, reason: 'gold', cost: cost };
    p.gold -= cost;
    p.upgrades[id] = have + 1;
    saveProgress(p);
    refreshDerived();
    return { ok: true, gold: p.gold, rank: have + 1 };
  }

  function createItem(baseId, rarity, rng) {
    const base = BASES[baseId] || BASES['iron-blade'];
    const rare = RARITY[rarity] ? rarity : 'common';
    const mult = { common: 1, uncommon: 1.5, rare: 2.2, epic: 3, legendary: 4 }[rare];
    const stats = {};
    Object.keys(base.stats).forEach((k) => {
      stats[k] = Math.round(base.stats[k] * mult * 1000) / 1000;
    });
    return {
      id: uuid(),
      base: BASES[baseId] ? baseId : 'iron-blade',
      name: base.name,
      rarity: rare,
      stats: stats,
      owner: loadProfile().playerId,
      tradeable: false,
      createdAt: Date.now(),
    };
  }

  function rollRarity(bonus, rng) {
    const random = rng || Math.random;
    const roll = random() + (bonus || 0);
    if (roll > 0.985) return 'legendary';
    if (roll > 0.94) return 'epic';
    if (roll > 0.82) return 'rare';
    if (roll > 0.58) return 'uncommon';
    return 'common';
  }

  function mintDrop(kind, rng) {
    const bases = Object.keys(BASES);
    const random = rng || Math.random;
    const base = bases[Math.floor(random() * bases.length)];
    const bonus = kind === 'boss' ? 0.12 : kind === 'elite' ? 0.06 : 0;
    return createItem(base, rollRarity(bonus, random), random);
  }

  function addItem(item) {
    if (!item || !item.id) return null;
    item.tradeable = false;
    item.owner = item.owner || loadProfile().playerId;
    const bag = loadInventory();
    bag.items.push(item);
    if (bag.items.length > 80) bag.items.splice(0, bag.items.length - 80);
    saveInventory(bag);
    refreshDerived();
    return item;
  }

  function items() {
    return loadInventory().items.slice();
  }

  function itemBonus() {
    const d = view();
    return { might: d.might, life: d.life, greed: d.greed };
  }

  function recordRun(stats) {
    const p = loadProgress();
    const previous = p.bestTime || 0;
    const time = Math.max(0, Number(stats && stats.time) || 0);
    const kills = Math.max(0, Number(stats && stats.kills) || 0);
    const isBest = time > previous;
    if (isBest) p.bestTime = time;
    if (kills > (p.bestKills || 0)) p.bestKills = kills;
    saveProgress(p);
    refreshDerived();
    return {
      isBest: isBest,
      previous: previous,
      best: p.bestTime,
      gold: p.gold,
      next: nextUpgrade(p.gold),
    };
  }

  function rarityName(id) {
    return (RARITY[id] && RARITY[id].name) || 'Common';
  }

  return {
    KEYS, SCHEMA, RARITY, RARITY_ORDER, SHOP, BASES,
    loadProfile, saveProfile, loadInventory, saveInventory, loadProgress, saveProgress,
    rank, gold, bankGold, shopList, nextUpgrade, buy, roman,
    createItem, rollRarity, mintDrop, addItem, items, itemBonus, recordRun, rarityName,
  };
})();
