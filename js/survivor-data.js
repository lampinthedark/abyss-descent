/** Survivor mode data. Weapons can evolve later; nothing here is a shop. */
const SurvivorData = (() => {
  // The sorcerer already fights with a ranged bolt, so auto-attack is that
  // same staff and the thumb only steers. Warrior and rogue are melee.
  const HERO = 'sorcerer';

  const WEAPON_CAP = 5;
  const PASSIVE_CAP = 5;

  const EVOLUTIONS = {
    orbit: { id: 'storm', name: 'Storm of Blades', needs: 'tempo' },
    nova: { id: 'halo', name: 'Cinder Halo', needs: 'cinder' },
  };

  const WEAPONS = [
    {
      id: 'bolt', name: 'Ash Bolt', kind: 'weapon', icon: 'bolt',
      blurb: 'Hurls ash at the nearest demon.',
      ranks: ['One bolt.', 'The bolt grows thicker.', 'A second bolt follows.', 'It punches through one more foe.', 'Three bolts in a spread.'],
      maxLevel: WEAPON_CAP, evolvesWith: null,
    },
    {
      id: 'orbit', name: 'Orbiting Blade', kind: 'weapon', icon: 'blade',
      blurb: 'Blades circle you and cut whatever they touch.',
      ranks: ['One blade.', 'The blade spins faster.', 'A second blade joins.', 'The ring widens.', 'Three blades. Ready to evolve.'],
      maxLevel: WEAPON_CAP, evolvesWith: 'tempo', evolveName: 'Storm of Blades',
    },
    {
      id: 'nova', name: 'Star Nova', kind: 'weapon', icon: 'nova',
      blurb: 'A ring of ash bursts outward.',
      ranks: ['A single ring.', 'The ring returns sooner.', 'The ring pulses twice.', 'The ring reaches farther.', 'A thick double ring that covers the crowd.'],
      maxLevel: WEAPON_CAP, evolvesWith: 'cinder', evolveName: 'Cinder Halo',
    },
    {
      id: 'pierce', name: 'Piercing Ash', kind: 'weapon', icon: 'pierce',
      blurb: 'A bolt that keeps going through a line of demons.',
      ranks: ['A line of ash.', 'The line grows wider.', 'It cuts through a thicker crowd.', 'It flies faster.', 'Two lines, side by side.'],
      maxLevel: WEAPON_CAP, evolvesWith: null,
    },
  ];

  const PASSIVES = [
    {
      id: 'might', name: 'Might', kind: 'passive', icon: 'might',
      blurb: 'Your blows get heavier.',
      ranks: ['Hits throw sparks.', 'Sparks fly farther.', 'Every third hit bursts a ring.', 'The ring reaches farther.', 'Kills burst a second ring.'],
      maxLevel: PASSIVE_CAP, evolvesWith: null,
    },
    {
      id: 'haste', name: 'Haste', kind: 'passive', icon: 'haste',
      blurb: 'Weapons cycle faster.',
      ranks: ['A quicker cast.', 'Less wait between bolts.', 'Battle rhythm. Weapons jump in speed.', 'The cycle tightens.', 'Unbroken tempo.'],
      maxLevel: PASSIVE_CAP, evolvesWith: null,
    },
    {
      id: 'magnet', name: 'Magnet', kind: 'passive', icon: 'magnet',
      blurb: 'XP gems pull in from farther away.',
      ranks: ['A short pull.', 'Gems notice you.', 'A wide grab.', 'The field thickens.', 'Gems cross the screen.'],
      maxLevel: PASSIVE_CAP, evolvesWith: null,
    },
    {
      id: 'vitality', name: 'Vitality', kind: 'passive', icon: 'heart',
      blurb: 'More life, and a heal when you take it.',
      ranks: ['+12 life.', '+12 life.', '+20 life and a full breath.', '+12 life.', '+28 life. The deep well.'],
      maxLevel: PASSIVE_CAP, evolvesWith: null,
    },
    {
      id: 'area', name: 'Area', kind: 'passive', icon: 'area',
      blurb: 'Novas, blades, and bolts cover more ground.',
      ranks: ['A wider spark.', 'More reach.', 'The ring opens up.', 'Broad strokes.', 'The whole crowd.'],
      maxLevel: PASSIVE_CAP, evolvesWith: null,
    },
    {
      id: 'armor', name: 'Armor', kind: 'passive', icon: 'armor',
      blurb: 'Each rank turns a hit aside.',
      ranks: ['Chip one point off a hit.', 'A thicker hide.', 'Hits lose 3.', 'Another point aside.', 'Hits lose 6.'],
      maxLevel: PASSIVE_CAP, evolvesWith: null,
    },
    {
      id: 'tempo', name: 'Battle Tempo', kind: 'passive', icon: 'tempo',
      blurb: 'The rhythm that wakes a storm of blades.',
      ranks: ['Your step finds the beat.', 'Blades drink the rhythm.', 'The beat locks in.', 'Faster hands.', 'Storm-ready.'],
      maxLevel: PASSIVE_CAP, evolvesWith: null, evolveName: 'Storm of Blades', evolveOf: 'orbit',
    },
    {
      id: 'cinder', name: 'Cinder Heart', kind: 'passive', icon: 'cinder',
      blurb: 'Ash that remembers how to crown you.',
      ranks: ['A warm coal. Not the hero\'s fire.', 'The ring lingers.', 'A second echo.', 'Ash stays in the air.', 'Halo-ready.'],
      maxLevel: PASSIVE_CAP, evolvesWith: null, evolveName: 'Cinder Halo', evolveOf: 'nova',
    },
  ];

  const CATALOG = WEAPONS.concat(PASSIVES);

  // Every gold amount for a run lives here.
  const REWARDS = {
    gold: { skel: 1, imp: 1, brute: 3, mini: 12, win: 30, purse: 15 },
    doubleMult: 2,
  };

  // The Hermit card reads these numbers. Combat, XP, and gold use the same table.
  // earliest is run seconds; the vow is never offered before that.
  // hit applies only during the cursed minute. xp and gold last the rest of the run
  // and are indexed by how many vows have been accepted (0 = none).
  const VOW = {
    earliest: 90,
    duration: 60,
    window: 25,
    hit: 1.5,
    xp: [1, 1.5, 2, 3],
    gold: [1, 1.5, 2, 3],
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

  function bankGold(amount) {
    return SurvivorSave.bankGold(amount);
  }

  function loadMeta() {
    const progress = SurvivorSave.loadProgress();
    const profile = SurvivorSave.loadProfile();
    return {
      version: progress.version,
      gold: progress.gold,
      upgrades: progress.upgrades,
      cosmetics: profile.cosmetics,
    };
  }

  function xpToNext(level) {
    const lv = Math.max(1, level | 0);
    // Five level-ups in the first minute, then a steeper climb.
    if (lv <= 1) return 8;
    if (lv === 2) return 10;
    if (lv === 3) return 12;
    if (lv === 4) return 16;
    if (lv === 5) return 20;
    if (lv === 6) return 36;
    if (lv === 7) return 56;
    if (lv === 8) return 84;
    if (lv === 9) return 120;
    if (lv === 10) return 160;
    if (lv === 11) return 200;
    if (lv === 12) return 240;
    return 280 + (lv - 12) * 28;
  }

  function rankText(item, nextLevel) {
    const ranks = item && item.ranks;
    const i = Math.max(1, nextLevel | 0) - 1;
    if (ranks && ranks[i]) return ranks[i];
    return (item && item.blurb) || '';
  }

  function evolutionFor(id) {
    if (EVOLUTIONS[id]) return EVOLUTIONS[id];
    const item = CATALOG.find((c) => c.id === id);
    if (item && item.evolveOf && EVOLUTIONS[item.evolveOf]) return EVOLUTIONS[item.evolveOf];
    return null;
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

  function healCard() {
    return {
      id: 'heal',
      name: 'Second Wind',
      kind: 'reward',
      icon: 'heart',
      blurb: 'Heal 30% now, and +6 life a second for a moment.',
      maxLevel: 99,
      evolvesWith: null,
    };
  }

  function catalogItem(id) {
    for (let i = 0; i < CATALOG.length; i++) {
      if (CATALOG[i].id === id) return CATALOG[i];
    }
    return null;
  }

  // Holding one half of an evolution pair pulls the other half forward.
  // Once that weapon is rank 4 or higher, the partner is forced into the
  // three cards on every other level-up (the caller sets forcePartner).
  function partnerPulls(owned) {
    const have = owned || {};
    const pairs = [
      { weapon: 'orbit', passive: 'tempo' },
      { weapon: 'nova', passive: 'cinder' },
    ];
    const heavy = [];
    const force = [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const w = have[pair.weapon] || 0;
      const p = have[pair.passive] || 0;
      const weapon = catalogItem(pair.weapon);
      const passive = catalogItem(pair.passive);
      if (w > 0 && passive && p < passive.maxLevel) {
        heavy.push(passive);
        if (w >= 3) force.push(passive);
      }
      if (p > 0 && weapon && w < weapon.maxLevel) {
        heavy.push(weapon);
        force.push(weapon);
      }
    }
    return { heavy: heavy, force: force };
  }

  function pickOffers(owned, rng, opts) {
    const random = rng || Math.random;
    const pulls = partnerPulls(owned);
    function retired(item) {
      const evolved = opts && opts.evolved;
      if (!item || !evolved) return false;
      const keys = Object.keys(evolved);
      for (let i = 0; i < keys.length; i++) {
        const weaponId = keys[i];
        if (!evolved[weaponId]) continue;
        if (item.id === weaponId || item.id === evolved[weaponId]) return true;
      }
      return false;
    }
    function stillRoom(item) {
      if (!item || item.kind === 'reward') return true;
      if (retired(item)) return false;
      const lv = owned && owned[item.id] ? owned[item.id] : 0;
      return lv < (item.maxLevel || 1);
    }
    function purseCard() {
      return {
        id: 'purse',
        name: 'Coin purse',
        kind: 'reward',
        blurb: 'Take 15 gold.',
        maxLevel: 99,
        evolvesWith: null,
      };
    }
    function fillerFor(out) {
      let heal = false;
      let purse = false;
      for (let i = 0; i < out.length; i++) {
        if (out[i].id === 'heal') heal = true;
        if (out[i].id === 'purse') purse = true;
      }
      if (!heal) return healCard();
      if (!purse) return purseCard();
      return healCard();
    }
    const bag = [];
    for (let i = 0; i < CATALOG.length; i++) {
      const item = CATALOG[i];
      if (!stillRoom(item)) continue;
      bag.push(item);
    }
    pulls.heavy.forEach((item) => {
      if (!stillRoom(item)) return;
      for (let n = 0; n < 16; n++) bag.push(item);
    });
    if (random() < 0.4) bag.push(healCard());
    const out = [];
    let guard = 0;
    while (out.length < 3 && bag.length && guard++ < 40) {
      const i = Math.floor(random() * bag.length);
      const item = bag.splice(i, 1)[0];
      if (out.some((o) => o.id === item.id)) continue;
      out.push(item);
    }
    while (out.length < 3) out.push(fillerFor(out));
    if (opts && opts.forcePartner) {
      let slot = out.length - 1;
      pulls.force.forEach((item) => {
        if (!stillRoom(item)) return;
        if (out.some((o) => o.id === item.id)) return;
        if (slot < 0) return;
        out[slot] = item;
        slot -= 1;
      });
    }
    for (let i = out.length - 1; i >= 0; i--) {
      if (!stillRoom(out[i])) out.splice(i, 1);
    }
    while (out.length < 3) out.push(fillerFor(out));
    const orbitItem = catalogItem('orbit');
    if (orbitItem && stillRoom(orbitItem)) {
      let seen = false;
      for (let i = 0; i < out.length; i++) {
        if (out[i].id === 'orbit') seen = true;
      }
      if (!seen) out[0] = orbitItem;
    }
    return out;
  }

  return {
    HERO, WEAPONS, PASSIVES, CATALOG, EVOLUTIONS, REWARDS, TUNING, VOW, WEAPON_CAP, PASSIVE_CAP,
    META_KEY, loadMeta, bankGold, xpToNext, rankText, evolutionFor,
    minuteReachedEvent, deathEvent, levelReachedEvent, levelUpCountEvent, pickOffers,
  };
})();
