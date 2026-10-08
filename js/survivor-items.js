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
    'iron-blade': { name: 'Iron Blade', slot: 'charm', stats: { might: 0.02 } },
    'bone-charm': { name: 'Bone Charm', slot: 'armour', stats: { life: 4 } },
    'ash-bead': { name: 'Ash Bead', slot: 'ring', stats: { greed: 0.02 } },
    'shard-edge': { name: 'Shard Edge', slot: 'charm', effect: 'shards', stats: { might: 0.04 } },
    'cinder-chain': { name: 'Cinder Chain', slot: 'ring', effect: 'chain', stats: { might: 0.03 } },
    'grave-magnet': { name: 'Grave Magnet', slot: 'ring', effect: 'magnet', stats: { greed: 0.04 } },
    'twin-ring': { name: 'Twin Ring', slot: 'charm', effect: 'twin', stats: { might: 0.03 } },
    'ember-tread': { name: 'Ember Tread', slot: 'armour', effect: 'ember', stats: { life: 8 } },
  };
  const LEGENDARY_IDS = ['shard-edge', 'cinder-chain', 'grave-magnet', 'twin-ring', 'ember-tread'];
  const SLOTS = ['charm', 'armour', 'ring'];

  const SHOP = [
    { id: 'vitality', name: 'Vitality', blurb: '+12 max life', max: 8, cost: (n) => 40 + n * 35 },
    { id: 'might', name: 'Might', blurb: '+6% damage', max: 8, cost: (n) => 50 + n * 40 },
    { id: 'stride', name: 'Stride', blurb: '+4% move speed', max: 6, cost: (n) => 45 + n * 40 },
    { id: 'magnet', name: 'Magnet', blurb: 'Gems start farther out', max: 6, cost: (n) => 35 + n * 30 },
    { id: 'revival', name: 'Second Chance', blurb: 'Once a run, survive at 30% life', max: 1, cost: () => 180 },
    { id: 'greed', name: 'Greed', blurb: '+8% gold found', max: 6, cost: (n) => 40 + n * 45 },
  ];

  let migrated = false;
  const freshSave = /(?:^|[?&])fresh=1(?:&|$)/.test((typeof location !== 'undefined' && location.search) || '');
  const memorySave = Object.create(null);

  function read(key) {
    try {
      if (freshSave) {
        if (!Object.prototype.hasOwnProperty.call(memorySave, key)) return null;
        return JSON.parse(memorySave[key]);
      }
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function write(key, data) {
    const raw = JSON.stringify(data);
    if (freshSave) {
      memorySave[key] = raw;
      derived = null;
      return;
    }
    try { localStorage.setItem(key, raw); } catch (e) {}
    // Every save (purchase, refund, vow reward, double gold, reset) drops
    // the derived cache. The next read rebuilds it from localStorage.
    derived = null;
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
    return { version: SCHEMA, items: [], equipped: { charm: null, armour: null, ring: null } };
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
    if (!data.equipped) data.equipped = { charm: null, armour: null, ring: null };
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
    const worn = equippedItems(bag);
    const bonus = bonusFrom(worn);
    effectFlags.shards = 0;
    effectFlags.chain = 0;
    effectFlags.magnet = 0;
    effectFlags.twin = 0;
    effectFlags.ember = 0;
    for (let i = 0; i < worn.length; i++) {
      const e = worn[i].effect;
      if (e && effectFlags[e] != null) effectFlags[e] = 1;
    }
    derived = {
      gold: progress.gold,
      upgrades: Object.assign({}, progress.upgrades || {}),
      might: bonus.might,
      life: bonus.life,
      greed: bonus.greed,
      effects: effectFlags,
    };
    return derived;
  }

  function view() {
    return derived || refreshDerived();
  }

  function reload() {
    derived = null;
    return refreshDerived();
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

  function slotOf(item) {
    const base = item && BASES[item.base];
    return (base && base.slot) || 'charm';
  }

  function scoreItem(item) {
    if (!item) return -1;
    const r = RARITY_ORDER.indexOf(item.rarity);
    return (r < 0 ? 0 : r) * 100 + (item.effect ? 40 : 0);
  }

  function findItem(bag, id) {
    if (!id || !bag) return null;
    for (let i = 0; i < bag.items.length; i++) {
      if (bag.items[i].id === id) return bag.items[i];
    }
    return null;
  }

  function equippedItems(bag) {
    const out = [];
    if (!bag || !bag.equipped) return out;
    for (let i = 0; i < SLOTS.length; i++) {
      const it = findItem(bag, bag.equipped[SLOTS[i]]);
      if (it) out.push(it);
    }
    return out;
  }

  function tryAutoEquip(bag, item) {
    if (!bag.equipped) bag.equipped = { charm: null, armour: null, ring: null };
    const slot = slotOf(item);
    const cur = findItem(bag, bag.equipped[slot]);
    if (!cur || scoreItem(item) > scoreItem(cur)) bag.equipped[slot] = item.id;
  }

  function createItem(baseId, rarity, rng) {
    const random = rng || Math.random;
    let rare = RARITY[rarity] ? rarity : 'common';
    let id = BASES[baseId] ? baseId : 'iron-blade';
    if (rare === 'legendary' && LEGENDARY_IDS.indexOf(id) < 0) {
      id = LEGENDARY_IDS[Math.floor(random() * LEGENDARY_IDS.length)];
    }
    const base = BASES[id];
    const mult = { common: 1, uncommon: 1.5, rare: 2.2, epic: 3, legendary: 4 }[rare];
    const stats = {};
    Object.keys(base.stats).forEach((k) => {
      stats[k] = Math.round(base.stats[k] * mult * 1000) / 1000;
    });
    return {
      id: uuid(),
      base: id,
      name: base.name,
      rarity: rare,
      stats: stats,
      slot: base.slot,
      effect: base.effect || '',
      owner: loadProfile().playerId,
      tradeable: false,
      createdAt: Date.now(),
    };
  }

  function rollRarity(bonus, rng) {
    const random = rng || Math.random;
    const luck = Math.max(0, Number(bonus) || 0);
    const roll = random();
    const leg = 0.01 + luck * 0.04;
    const epic = leg + 0.04 + luck * 0.05;
    const rare = epic + 0.10 + luck * 0.05;
    const unc = rare + 0.25;
    if (roll < leg) return 'legendary';
    if (roll < epic) return 'epic';
    if (roll < rare) return 'rare';
    if (roll < unc) return 'uncommon';
    return 'common';
  }

  function plainBase(rng) {
    const random = rng || Math.random;
    const gear = ['iron-blade', 'bone-charm', 'ash-bead'];
    return gear[Math.floor(random() * gear.length)];
  }

  function mintDrop(kind, rng) {
    const random = rng || Math.random;
    if (kind === 'demon') {
      const id = LEGENDARY_IDS[Math.floor(random() * LEGENDARY_IDS.length)];
      return createItem(id, 'legendary', random);
    }
    if (kind === 'boss') {
      const rarity = random() < 0.18 ? 'legendary' : 'epic';
      return createItem(plainBase(random), rarity, random);
    }
    let rarity = 'common';
    if (kind === 'rare') rarity = 'rare';
    else {
      const bonus = kind === 'elite' ? 0.08 : 0;
      rarity = rollRarity(bonus, random);
    }
    return createItem(plainBase(random), rarity, random);
  }

  function addItem(item) {
    if (!item || !item.id) return null;
    item.tradeable = false;
    item.owner = item.owner || loadProfile().playerId;
    const bag = loadInventory();
    bag.items.push(item);
    tryAutoEquip(bag, item);
    if (bag.items.length > 80) {
      const dropped = bag.items.splice(0, bag.items.length - 80);
      for (let i = 0; i < dropped.length; i++) {
        for (let s = 0; s < SLOTS.length; s++) {
          if (bag.equipped[SLOTS[s]] === dropped[i].id) bag.equipped[SLOTS[s]] = null;
        }
      }
    }
    saveInventory(bag);
    refreshDerived();
    return item;
  }

  function equipped() {
    return equippedItems(loadInventory());
  }

  function effects() {
    return view().effects || effectFlags;
  }

  function items() {
    return loadInventory().items.slice();
  }

  const bonusView = { might: 0, life: 0, greed: 0 };
  const effectFlags = { shards: 0, chain: 0, magnet: 0, twin: 0, ember: 0 };

  function itemBonus() {
    const d = view();
    bonusView.might = d.might;
    bonusView.life = d.life;
    bonusView.greed = d.greed;
    return bonusView;
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
    rank, gold, bankGold, shopList, nextUpgrade, buy, roman, reload,
    createItem, rollRarity, mintDrop, addItem, items, equipped, effects, itemBonus, recordRun, rarityName,
  };
})();
