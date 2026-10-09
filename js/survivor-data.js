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
    if (MEDIEVAL) {
      const curve = MEDIEVAL_CFG.xpCurve;
      if (lv < curve.length) return curve[lv];
      return curve[curve.length - 1] + (lv - curve.length + 1) * MEDIEVAL_CFG.xpStep;
    }
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
    const bag = [];
    for (let i = 0; i < CATALOG.length; i++) {
      const item = CATALOG[i];
      const lv = owned && owned[item.id] ? owned[item.id] : 0;
      if (lv < item.maxLevel) bag.push(item);
    }
    pulls.heavy.forEach((item) => {
      for (let n = 0; n < 16; n++) bag.push(item);
    });
    if (random() < 0.4) {
      const heal = healCard();
      if (MEDIEVAL) heal.name = MEDIEVAL_CFG.names.heal[0];
      bag.push(heal);
    }
    const out = [];
    let guard = 0;
    while (out.length < 3 && bag.length && guard++ < 40) {
      const i = Math.floor(random() * bag.length);
      const item = bag.splice(i, 1)[0];
      if (out.some((o) => o.id === item.id)) continue;
      out.push(item);
    }
    while (out.length < 3) {
      out.push({
        id: out.length % 2 === 0 ? 'purse' : 'heal',
        name: out.length % 2 === 0 ? 'Coin purse' : 'Second wind',
        kind: 'reward',
        blurb: out.length % 2 === 0 ? 'Take 15 gold.' : 'Heal 30% now, and +6 life a second for a moment.',
        maxLevel: 99,
        evolvesWith: null,
      });
    }
    if (opts && opts.forcePartner) {
      let slot = out.length - 1;
      pulls.force.forEach((item) => {
        if (out.some((o) => o.id === item.id)) return;
        if (slot < 0) return;
        out[slot] = item;
        slot -= 1;
      });
    }
    const orbitItem = catalogItem('orbit');
    if (orbitItem && (!owned || (owned.orbit || 0) < orbitItem.maxLevel)) {
      let seen = false;
      for (let i = 0; i < out.length; i++) {
        if (out[i].id === 'orbit') seen = true;
      }
      if (!seen) out[0] = orbitItem;
    }
    return out;
  }

  // =====================================================================
  // MEDIEVAL DEMO CONFIG (?mode=medieval). Every designer tunable for the
  // dark medieval demo lives in this one table. Swap numbers here; no code
  // changes needed. Times are run seconds; money is the shared gold purse.
  // =====================================================================
  const MEDIEVAL_CFG = {
    // Source: /workspace/design/medieval-survivor.md (v1).
    // ---- 1. Wave timeline (run seconds). A row holds until the next row's
    // `at`. kinds: spawn kind -> weight. cap: foes on screen. rate: spawns/s.
    // xpMul (optional) scales soul-gem XP for foes spawned in that row.
    // Kinds: skel (Bone Rattler), goblin (Gutter Goblin), armored (Armoured
    // Rattler, 3x HP), imp (Cinder Imp, ranged), fiend (Horned Fiend, charges).
    densityMul: 1.4,          // multiplies every cap (phone screens read fuller)
    waves: [
      { at: 0, kinds: { skel: 1 }, cap: 15, rate: 3 },
      { at: 30, kinds: { skel: 2, goblin: 1 }, cap: 25, rate: 5 },
      { at: 60, kinds: { goblin: 2, skel: 1 }, cap: 40, rate: 8 },
      { at: 90, kinds: { skel: 1 }, cap: 60, rate: 16 },
      { at: 120, kinds: { imp: 1, skel: 2 }, cap: 55, rate: 12, xpMul: 2.4 },
      { at: 150, kinds: { imp: 1, armored: 1, skel: 1 }, cap: 55, rate: 12, xpMul: 1.8 },
      { at: 180, kinds: { fiend: 1, skel: 1, goblin: 1 }, cap: 50, rate: 12, xpMul: 1.8 },
      { at: 210, kinds: { skel: 2, goblin: 2, imp: 1, fiend: 1, armored: 1 }, cap: 80, rate: 22, xpMul: 1.3 },
      { at: 240, kinds: { fiend: 1, imp: 1, skel: 2 }, cap: 55, rate: 16, walls: true, xpMul: 1.8 },
      { at: 270, kinds: { skel: 1 }, cap: 30, rate: 1.5, breather: true, xpMul: 3 },
      { at: 300, kinds: {}, cap: 0, rate: 0 },               // boss: spawns stop
    ],
    // How each kind maps onto the engine (eid = stat/AI template, sprite = 0x72 art).
    kinds: {
      skel: { eid: 'skel', sprite: 'skel', name: 'Bone Rattler', speedMul: 1, hpMul: 1 },
      goblin: { eid: 'skel', sprite: 'goblin', name: 'Gutter Goblin', speedMul: 1.36, hpMul: 1 },
      armored: { eid: 'skel', sprite: 'armored', name: 'Armoured Rattler', speedMul: 0.82, hpMul: 3 },
      imp: { eid: 'shooter', sprite: 'imp', name: 'Cinder Imp', speedMul: 1, hpMul: 1 },
      fiend: { eid: 'charger', sprite: 'chort', name: 'Horned Fiend', speedMul: 1, hpMul: 1.5 },
    },
    // One-shot beats.
    events: [
      { at: 60, type: 'ring', kind: 'goblin', count: 18 },     // goblin ring around the hero
      { at: 60, type: 'elite', kind: 'goblin', name: 'Goblin Chief', hp: 260, chest: true, evolve: true },
      { at: 135, type: 'elite', kind: 'armored', name: 'Bone Warden', hp: 340, chest: true }, // 2:15 lull breaker
      { at: 180, type: 'elite', kind: 'fiend', name: 'Elite Fiend', hp: 420, chest: true },
      { at: 270, type: 'banner', text: 'The Pit stirs\u2026' },
      { at: 285, type: 'heal', pct: 0.4, text: 'The saints mend your wounds' }, // breather heal before the boss
    ],

    // ---- 3. Evolution: Oathblade (orbit) + Iron Gauntlet (tempo) = Dawnbreaker.
    // The Goblin Chief's chest grants it (never before evoAt); evoForce is the
    // safety net if the chief is not dead yet.
    evolution: { evoAt: 75, evoForce: 82, chiefGrants: true },
    // After Dawnbreaker the horde speeds up and thickens so it still reaches the hero.
    postEvo: { speedMul: 1.25, capMul: 1.3, rateMul: 1.3, until: 210 },

    // XP to the next level, indexed by current level (1-based). Past the end
    // each level adds xpStep. Tuned for a level-up every ~10-20 s after Lv10.
    xpCurve: [0, 8, 10, 12, 16, 20, 28, 34, 40, 44, 48, 52, 56, 60, 64],
    xpStep: 4,
    startWeapons: { knight: { bolt: 1, orbit: 1 }, ysolde: { bolt: 1, nova: 1 } },

    // ---- 5. Malgrath, the Pit Sovereign.
    boss: {
      at: 300, name: 'Malgrath, the Pit Sovereign', plate: 'MALGRATH', hp: 750, scale: 1.45, speedMul: 0.7, touchDmg: 10, // scale 1.45: ~3x a 16px mob
      adds: 10, winDelay: 2.0, winGold: 40, cycle: 2.0,
      // Telegraph style: bright edge + a fill that grows over the windup.
      tell: { edge: '#ffd040', edgeWidth: 5, fill: 'rgba(230, 40, 25, A)', fillFrom: 0.2, fillTo: 0.5, grow: 'rgba(255, 150, 60, 0.45)' },
      cleave: { tell: 1.0, range: 3.4, arc: Math.PI / 2, dmg: 14 },
      rain: { tell: 1.5, circles: 7, radius: 0.85, spread: 3.6, dmg: 10 },
      charge: { tell: 0.8, belowHp: 0.5, speed: 11, time: 0.6, dmg: 12, imps: 4 },
    },

    // ---- 6. Meta shop, paid from the SurvivorSave purse. prices[rank].
    shop: {
      might: { name: 'Tempered Steel', label: '+5% damage', per: 0.05, prices: [120, 200, 300, 450, 650] },
      vitality: { name: 'Stout Heart', label: '+10 max HP', per: 10, prices: [100, 180, 280, 400, 600] },
      stride: { name: 'Swift Stride', label: '+4% move speed', per: 0.04, prices: [150, 300, 500] },
      greed: { name: 'Gilded Tithe', label: '+10% gold', per: 0.1, prices: [200, 400, 700] },
      revival: { name: 'Second Wind', label: '1 free revive per run', per: 1, prices: [900] },
    },
    hiddenShop: ['magnet'],
    unlockHero: {
      id: 'ysolde', name: 'Sister Ysolde, Ember Nun', sprite: 'elf_f', cost: 600,
      lifeMul: 0.8, areaMul: 1.15, moveMul: 1,
      blurb: 'Hero: starts with the Ward Bell, +15% area, -20% HP',
    },
    // Gold per run target 150-250 (100 or less on an early death).
    gold: { mul: 0.25, keepOnDeath: 0.5 },

    // ---- 7. Oath of Ruin, sworn on the title screen before the run.
    vow: { name: 'Oath of Ruin', lifeMul: 0.7, keepOnDeath: 0, winGoldMul: 2, extraChest: true, noAdRevive: true },

    // ---- Art readability. The hero must be the brightest actor on the dark floor.
    // Multipliers apply to sprite pixels; rims are the 1px outlines.
    art: { heroBright: 1.12, heroRim: [255, 255, 255], skelDim: 0.8, foeBright: 1.12, foeRim: [216, 74, 58] },

    // ---- Level-up names. [name, blurb, optional rank lines]. Ids stay the same.
    names: {
      orbit: ['Oathblade', 'Sworn steel circles you and cuts whatever it touches.', ['One blade.', 'The blade swings faster.', 'A second blade joins.', 'The arc widens.', 'Three blades. Ready for the Gauntlet.']],
      bolt: ['Holy Bolts', 'A fast bolt seeks the nearest foe.', ['One bolt.', 'A heavier bolt.', 'A second bolt follows.', 'It pierces one more foe.', 'Three bolts in a spread.']],
      nova: ['Ward Bell', 'A shockwave rings out around you.', ['A single toll.', 'The bell rings sooner.', 'It tolls twice.', 'The toll reaches farther.', 'A double toll that covers the crowd.']],
      pierce: ['Hurled Axe', 'A spinning axe that cleaves through a line of foes.', ['One axe.', 'A broader head.', 'It cleaves a thicker crowd.', 'It flies faster.', 'Two axes, side by side.']],
      tempo: ['Iron Gauntlet', 'A heavier grip. The key to Dawnbreaker.', ['A firm grip.', 'Heavier blows.', 'The grip locks in.', 'Iron knuckles.', 'Dawn-ready.']],
      cinder: ['Reliquary', 'A saint\'s relic that wakes the Cathedral of Embers.'],
      might: ['Bloodstone Ring', 'Your blows get heavier.'],
      haste: ['Hourglass Charm', 'Weapons cycle faster.'],
      magnet: ['Lodestone', 'Soul gems pull in from farther away.'],
      vitality: ['Mead Horn', 'More life, and a heal when you take it.'],
      area: ['Pilgrim Censer', 'Blades, bells and bolts cover more ground.'],
      armor: ['Squire\'s Mail', 'Each rank turns a hit aside.'],
      heal: ['Pilgrim\'s Bread'],
    },
    evolutionNames: { orbit: 'Dawnbreaker', nova: 'Cathedral of Embers' },
  };

  const MEDIEVAL = /(?:^|[?&])mode=medieval(?:&|$)/.test((typeof location !== 'undefined' && location.search) || '');
  if (MEDIEVAL) {
    CATALOG.forEach((item) => {
      const r = MEDIEVAL_CFG.names[item.id];
      if (!r) return;
      item.name = r[0];
      if (r[1]) item.blurb = r[1];
      if (r[2]) item.ranks = r[2];
    });
    Object.keys(MEDIEVAL_CFG.evolutionNames).forEach((w) => {
      const name = MEDIEVAL_CFG.evolutionNames[w];
      if (EVOLUTIONS[w]) EVOLUTIONS[w].name = name;
      CATALOG.forEach((item) => {
        if (item.id === w || item.evolveOf === w) item.evolveName = name;
      });
    });
  }

  return {
    MEDIEVAL, MEDIEVAL_CFG, HERO, WEAPONS, PASSIVES, CATALOG, EVOLUTIONS, REWARDS, TUNING, VOW, WEAPON_CAP, PASSIVE_CAP,
    META_KEY, loadMeta, bankGold, xpToNext, rankText, evolutionFor,
    minuteReachedEvent, deathEvent, levelReachedEvent, levelUpCountEvent, pickOffers,
  };
})();
