/**
 * Last three hero hits, shown when core emits `death`.
 * Corpse revive is one optional ad per dungeon run (RPG.dungeon.load resets it).
 */
(function (root) {
  'use strict';

  const RPG = root.RPG || (root.RPG = {});
  const hits = [];
  let reviveUsed = 0;
  let bound = false;

  function installBus() {
    if (typeof RPG.on === 'function' && typeof RPG.emit === 'function') return;
    const ls = {};
    if (typeof RPG.on !== 'function') {
      RPG.on = function (ev, fn) { (ls[ev] || (ls[ev] = [])).push(fn); };
    }
    if (typeof RPG.emit !== 'function') {
      RPG.emit = function (ev, data) {
        const list = ls[ev] || [];
        for (let i = 0; i < list.length; i++) {
          try { list[i](data); } catch (err) {}
        }
      };
    }
  }

  function on(name, fn) {
    if (RPG.bus && typeof RPG.bus.on === 'function') {
      RPG.bus.on(name, fn);
      return;
    }
    installBus();
    RPG.on(name, fn);
  }

  function num() {
    for (let i = 0; i < arguments.length; i++) {
      const n = arguments[i];
      if (typeof n === 'number' && n === n) return n;
    }
    return 0;
  }

  function aimedAtMob(e) {
    if (!e || typeof e !== 'object') return false;
    if (e.kind === 'mob' || e.targetKind === 'mob') return true;
    const hero = RPG.hero;
    if (e.target && e.target !== 'hero' && e.target !== hero) return true;
    if (e.victim && e.victim !== 'hero' && e.victim !== hero) return true;
    return false;
  }

  function isHeroHurt(e) {
    if (!e || typeof e !== 'object') return false;
    const hero = RPG.hero;
    if (e.target === 'hero' || e.victim === 'hero' || e.who === 'hero' || e.hero === true) return true;
    if (hero && (e.target === hero || e.victim === hero)) return true;
    if (aimedAtMob(e)) return false;
    return true;
  }

  function noteHurt(e) {
    if (!isHeroHurt(e)) return;
    const amount = num(e.amount, e.dmg, e.damage, e.hit);
    if (!(amount > 0)) return;
    const srcName = e.srcName || e.name || e.source || e.monsterId || 'Something';
    hits.push({
      // Unrounded armour lands in 0.1 steps; players only see whole numbers (same rule as the HP bar).
      amount: Math.ceil(Math.round(amount * 10) / 10),
      crit: !!(e.crit || e.isCrit),
      srcId: e.srcId || e.monsterId || '',
      srcName: srcName,
      name: srcName,
    });
    while (hits.length > 3) hits.shift();
  }

  function snapshot() {
    const copy = [];
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      copy.push({ amount: h.amount, crit: h.crit, srcId: h.srcId, srcName: h.srcName, name: h.name });
    }
    return copy;
  }

  function linesOf(list) {
    const lines = [];
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      lines.push(h.name + ' ' + h.amount + (h.crit ? ' crit' : ''));
    }
    return lines;
  }

  function confirmRevive(accepted) {
    if (!accepted) return 'dismissed';
    if (reviveUsed >= 1) return 'capped';
    reviveUsed += 1;
    const hero = RPG.hero;
    if (hero) {
      if (typeof hero.revive === 'function') {
        try { hero.revive(); } catch (err) {}
      } else {
        hero.dead = false;
        if (typeof hero.maxHp === 'number') hero.hp = hero.maxHp;
        else if (typeof hero.maxLife === 'number') hero.life = hero.maxLife;
      }
    }
    hits.length = 0;
    return 'accepted';
  }

  function offerRevive() {
    if (reviveUsed >= 1) return 'capped';
    const ads = root.Ads || RPG.ads;
    if (!ads || typeof ads.offerRevive !== 'function') return 'unavailable';
    let result = 'unavailable';
    try { result = ads.offerRevive(); } catch (err) { return 'unavailable'; }
    if (result === 'accept' || result === 'accepted') return confirmRevive(true);
    return result;
  }

  function present() {
    const list = snapshot();
    const recap = {
      title: 'You died',
      hits: list,
      lastHits: list,
      lines: linesOf(list),
      revive: {
        used: reviveUsed >= 1,
        offer: offerRevive,
        confirm: confirmRevive,
      },
    };
    RPG.deathRecap.last = recap;
    const ui = RPG.ui;
    if (!ui) return recap;
    try {
      if (typeof ui.showDeathRecap === 'function') ui.showDeathRecap(recap);
      else if (typeof ui.showDeath === 'function') ui.showDeath(recap);
      else if (typeof ui.death === 'function') ui.death(recap);
    } catch (err) {}
    return recap;
  }

  function onDeath(e) {
    if (e && aimedAtMob(e)) return;
    if (e && e.monsterId && e.target !== 'hero' && e.hero !== true && e.victim !== 'hero') return;
    present();
  }

  function bind() {
    if (bound) return;
    bound = true;
    on('hurt', noteHurt);
    on('death', onDeath);
  }

  function resetRun() {
    reviveUsed = 0;
    hits.length = 0;
    RPG.deathRecap.last = null;
  }

  RPG.deathRecap = {
    noteHurt: noteHurt,
    present: present,
    offerRevive: offerRevive,
    confirmRevive: confirmRevive,
    resetRun: resetRun,
    bind: bind,
    last: null,
    get hits() { return snapshot(); },
  };

  bind();
})(typeof window !== 'undefined' ? window : globalThis);
