/**
 * GD's week-1 combat formula, exactly as posted (D3 steering), plus the few
 * behaviours the formula does not pin down (marked ASSUMED). Pure, seeded.
 *
 *   swing        0.6 s at base weapon speed, / (1 + attackSpeed%/100); tap lands after a 0.12 s windup
 *   hit chance   clamp(0.75 + 0.015*(Attack + gear.aim - target.def), 0.40, 0.97)
 *   damage       max = 2 + floor(Strength/4) + gear.power, uniform int ceil(max/2)..max
 *   taken        mob.dmg * 50 / (50 + armour)
 *   player HP    40 + 6*(Hitpoints-10)
 *   skills       Cleave 1.3x 120deg arc 6 s cd | Sigil Bolt 1.2x range 6, 4 s cd |
 *                Dodge 0.35 s invulnerable, 2 s cd
 *                (Ground Slam is cut to week 2 and is NOT simulated; SKILLS.slam is kept
 *                 only so week-2 tuning can switch it on with opts.skillSet)
 *   mob hit      clamp(0.75 + 0.015*(mob.atk - Defence - gear.def), 0.40, 0.97) per attack that lands
 *                (a dodge / side-step cancels the hit outright; armour still reduces a landed hit)
 *   regen        out of combat: 2 HP/s once 4 s have passed without taking damage (also mid-fight)
 *   combat XP    1/damage to the style stat + 0.33/damage to Hitpoints
 *   XP curve     floor(sum_{l<L} floor(l + 300*2^(l/7)) / 4), cap 99 (PLAN stats.js)
 */
'use strict';

const SWING_S = 0.6, TAP_WINDUP_S = 0.12;
const SKILLS = {
  cleave: { mult: 1.3, cd: 6, maxTargets: 3 },      // ASSUMED: a 120deg arc catches up to 3 of a clumped pack
  slam: { mult: 1.8, cd: 10, maxTargets: 99, week: 2 }, // CUT to week 2; 1.5-tile ring would catch a clumped pack
  bolt: { mult: 1.2, cd: 4, maxTargets: 1 },
};
const DODGE = { invuln: 0.35, cd: 2 };
const REGEN = { hpPerS: 2, delayS: 4 };          // approved: 2 HP/s after 4 s without taking damage
const XP_RATE = { style: 1, hitpoints: 0.33 };   // approved: per damage dealt (was 4 / 1.33)
const WEEK1_SKILLS = ['cleave', 'bolt'];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hitChance(attack, aim, def) { return clamp(0.75 + 0.015 * (attack + aim - def), 0.40, 0.97); }
function maxHit(strength, power) { return 2 + Math.floor(strength / 4) + power; }
function minHit(max) { return Math.ceil(max / 2); }
function mobHitChance(atk, defence, gearDef) { return clamp(0.75 + 0.015 * ((atk || 0) - (defence || 0) - (gearDef || 0)), 0.40, 0.97); }
function combatXp(damage) { return { style: damage * XP_RATE.style, hitpoints: damage * XP_RATE.hitpoints }; }
function regenAfter(hp, maxHp, sinceHitS, idleS) {
  // HP after idleS more seconds with no damage, given sinceHitS already elapsed since the last hit
  const live = Math.max(0, idleS - Math.max(0, REGEN.delayS - sinceHitS));
  return Math.min(maxHp, hp + REGEN.hpPerS * live);
}
function taken(dmg, armour) { return dmg * 50 / (50 + armour); }
function playerHp(hitpoints, gearMaxHp) { return 40 + 6 * (hitpoints - 10) + (gearMaxHp || 0); }
function swingSeconds(attackSpeed) { return SWING_S / (1 + (attackSpeed || 0) / 100); }

const XP_TABLE = (function () {
  const t = [0, 0]; let pts = 0;
  for (let l = 1; l < 99; l++) { pts += Math.floor(l + 300 * Math.pow(2, l / 7)); t[l + 1] = Math.floor(pts / 4); }
  return t;
})();
function levelFor(xp) { let L = 1; while (L < 99 && XP_TABLE[L + 1] <= xp) L++; return L; }

function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fight one player against a group of mobs (all engaged at once: worst case).
 * player: { attack, strength, defence, hitpoints, gear:{aim,power,armour,def,maxHp,attackSpeed,crit,lifesteal} }
 * opts:   { policy:'never'|'telegraphs'|'good', skills:true, skillSet:['cleave','bolt'], rng, maxS, startHp,
 *           sinceHit (s since the player last took damage, default: long ago), food:{heal,count}, regen:true }
 * Returns { t, won, dead, swings, landed, dmgDealt, dmgTaken, regenHp, hpLeft, sinceHit, mobAttacks, mobLanded, perMob:[...] }.
 */
function fight(player, mobDefs, opts) {
  opts = opts || {};
  const rnd = opts.rng || Math.random;
  const policy = opts.policy || 'never';
  const useSkills = opts.skills !== false;
  const g = player.gear;
  const swing = swingSeconds(g.attackSpeed);
  const maxHpP = playerHp(player.hitpoints, g.maxHp);
  let hp = opts.startHp != null ? opts.startHp : maxHpP;
  const mx = maxHit(player.strength, g.power), mn = minHit(mx);
  const dt = 0.01, maxS = opts.maxS || 600;
  const REST = (opts.restMs != null ? opts.restMs : 500) / 1000;

  const mobs = mobDefs.map((d, i) => ({
    d, hp: d.hp, alive: true, i, landed: 0, swings: 0, diedAt: null,
    busy: 0.3 + i * 0.25 + rnd() * 0.3,     // ASSUMED: pack members engage staggered by ~0.25 s
    cds: d.attacks.map(a => (a.kind === 'melee' ? 0 : (a.kind === 'ranged' ? 0.5 : 1.5 + rnd() * 2))),
    pending: null,
  }));
  let t = 0, nextAct = TAP_WINDUP_S, dodgeCd = 0, invulnUntil = -1;
  const cds = { cleave: 0, slam: 0, bolt: 0 };
  const skillSet = opts.skillSet || WEEK1_SKILLS;
  let swings = 0, landed = 0, dealt = 0, takenSum = 0, eaten = 0, regenSum = 0, mobAttacks = 0, mobLanded = 0;
  const useRegen = opts.regen !== false;
  let lastHitAt = -(opts.sinceHit != null ? opts.sinceHit : 99);
  const pDef = player.defence || 0;
  const food = opts.food || null;          // { heal, count }
  let foodLeft = food ? food.count : 0;
  let target = mobs[0];

  function rollHit(mob, mult) {
    if (rnd() >= hitChance(player.attack, g.aim, mob.d.def)) { mob.swings++; return 0; }
    let dmg = mn + Math.floor(rnd() * (mx - mn + 1));
    if (g.crit && rnd() < g.crit / 100) dmg = Math.floor(dmg * 1.5);   // ASSUMED crit x1.5 (Normal gear has 0)
    dmg = Math.max(1, Math.round(dmg * mult));
    mob.swings++; mob.landed++;
    const d = Math.min(dmg, mob.hp);
    mob.hp -= dmg; dealt += d; landed++;
    if (g.lifesteal) hp = Math.min(maxHpP, hp + d * g.lifesteal / 100);
    if (mob.hp <= 0) { mob.alive = false; mob.diedAt = t; }
    return d;
  }

  while (t < maxS) {
    const alive = mobs.filter(m => m.alive);
    if (!alive.length) break;
    if (hp <= 0) break;
    if (!target.alive) target = alive.slice().sort((a, b) => a.hp - b.hp)[0];

    // eat: ASSUMED one food per 0.6 s (one swing), when below 35% HP
    if (food && foodLeft > 0 && t >= nextAct && hp < 0.35 * maxHpP) {
      hp = Math.min(maxHpP, hp + food.heal); foodLeft--; eaten++; nextAct = t + 0.6;
    }
    // player action
    if (t >= nextAct) {
      let used = null;
      if (useSkills) {
        if (skillSet.indexOf('slam') >= 0 && cds.slam <= 0 && (alive.length >= 2 || alive[0].d.boss || alive[0].d.elite)) used = 'slam';
        else if (skillSet.indexOf('cleave') >= 0 && cds.cleave <= 0 && (alive.length >= 2 || alive[0].d.boss || alive[0].d.elite)) used = 'cleave';
        else if (skillSet.indexOf('bolt') >= 0 && cds.bolt <= 0 && (alive.length === 1 && target.hp > mx)) used = 'bolt';
      }
      swings++;
      if (used) {
        const S = SKILLS[used];
        cds[used] = S.cd;
        const hits = used === 'bolt' ? [target] : [target].concat(alive.filter(m => m !== target)).slice(0, S.maxTargets);
        hits.forEach(m => rollHit(m, S.mult));
      } else rollHit(target, 1);
      nextAct = t + swing;
    }

    // mobs
    for (const m of alive) {
      if (!m.alive) continue;
      for (let k = 0; k < m.cds.length; k++) m.cds[k] -= dt;
      if (m.pending) {
        m.pending.left -= dt;
        // dodge decision: when the hit is about to land and dodge is ready
        if (!m.pending.decided && m.pending.left <= 0.2) {
          m.pending.decided = true;
          const k = m.pending.a.kind;
          const tele = k === 'slam' || k === 'charge';
          // 'good' spends a roll on a plain hit only when no telegraph is winding up (keeps the roll for the big one)
          const teleUp = alive.some(o => o !== m && o.pending && (o.pending.a.kind === 'slam' || o.pending.a.kind === 'charge'));
          const want = policy === 'never' ? false : policy === 'telegraphs' ? tele : (tele || (!teleUp && rnd() < 0.5));
          if (want && dodgeCd <= 0) {
            dodgeCd = DODGE.cd; invulnUntil = t + DODGE.invuln;
            nextAct = Math.max(nextAct, t + DODGE.invuln);   // a roll costs swing time
          } else if (policy !== 'never' && tele && m.pending.a.windupMs >= 800 && rnd() < 0.7) {
            m.pending.sidestep = true;                       // ASSUMED: roll on cooldown -> walk out of a >=0.8 s telegraph 70% of the time
            nextAct = Math.max(nextAct, t + 0.6);            // walking out costs a swing
          } else if (policy !== 'never' && k === 'ranged' && rnd() < 0.5) m.pending.sidestep = true; // ASSUMED: moving dodges half the projectiles
        }
        if (m.pending.left <= 0) {
          // a roll / side-step cancels the hit outright; otherwise the mob rolls GD's mirrored hit chance
          if (t > invulnUntil && !m.pending.sidestep) {
            mobAttacks++;
            if (rnd() < mobHitChance(m.d.atk, pDef, g.def)) {
              const x = taken(m.pending.a.dmg, g.armour); hp -= x; takenSum += x; mobLanded++; lastHitAt = t;
            }
          }
          m.cds[m.pending.k] = m.pending.a.cooldownMs / 1000 * (m.d.enrage && m.hp < m.d.hp * m.d.enrage.belowHpPct / 100 ? m.d.enrage.cooldownMult : 1);
          m.busy = REST; m.pending = null;
        }
        continue;
      }
      m.busy -= dt;
      if (m.busy > 0) continue;
      // priority: listed order (specials first in our data), first ready wins
      for (let k = 0; k < m.d.attacks.length; k++) {
        const a = m.d.attacks[k];
        if (m.cds[k] > 0) continue;
        if (a.minRange && alive.length === 1) continue;        // ASSUMED: ranged-with-minRange only used while others hold melee
        m.pending = { a, k, left: a.windupMs / 1000, decided: false };
        break;
      }
    }

    if (useRegen && hp > 0 && hp < maxHpP && t - lastHitAt >= REGEN.delayS) {
      const r = Math.min(maxHpP - hp, REGEN.hpPerS * dt); hp += r; regenSum += r;
    }
    for (const k in cds) cds[k] -= dt;
    dodgeCd -= dt;
    t += dt;
  }
  const won = mobs.every(m => !m.alive);
  return { t, won, dead: hp <= 0, eaten, swings, landed, dmgDealt: dealt, dmgTaken: takenSum, regenHp: regenSum, hpLeft: hp, maxHp: maxHpP,
    sinceHit: t - lastHitAt, mobAttacks, mobLanded,
    perMob: mobs.map(m => ({ id: m.d.id, landed: m.landed, swings: m.swings, diedAt: m.diedAt })) };
}

/** Monte-Carlo summary of fight(). */
function simulate(player, mobDefs, opts, n, seed) {
  n = n || 400;
  const rnd = rng32(seed || 1234);
  const rs = [];
  for (let i = 0; i < n; i++) rs.push(fight(player, mobDefs, Object.assign({}, opts, { rng: rnd })));
  const mean = f => rs.reduce((s, r) => s + f(r), 0) / n;
  const pct = (f, p) => { const a = rs.map(f).sort((x, y) => x - y); return a[Math.min(n - 1, Math.floor(p * n))]; };
  return {
    n,
    ttk: mean(r => r.t), ttkP10: pct(r => r.t, 0.1), ttkP90: pct(r => r.t, 0.9),
    landedFirst: mean(r => r.perMob[0].landed), landedP10: pct(r => r.perMob[0].landed, 0.1), landedP90: pct(r => r.perMob[0].landed, 0.9),
    dmgTaken: mean(r => r.dmgTaken), pctHp: mean(r => r.dmgTaken) / rs[0].maxHp * 100,
    pDeath: mean(r => (r.dead ? 1 : 0)), dmgDealt: mean(r => r.dmgDealt), maxHp: rs[0].maxHp,
    winRate: mean(r => (r.won ? 1 : 0)), eaten: mean(r => r.eaten), regenHp: mean(r => r.regenHp),
    netPctHp: mean(r => (r.maxHp - Math.max(0, r.hpLeft)) / r.maxHp * 100),
    mobHitRate: (function () { const a = rs.reduce((s, r) => s + r.mobAttacks, 0); return a ? rs.reduce((s, r) => s + r.mobLanded, 0) / a : 0; })(),
    ttkWon: (function () { const w = rs.filter(r => r.won); return w.length ? w.reduce((a, r) => a + r.t, 0) / w.length : null; })(),
  };
}

module.exports = { SWING_S, TAP_WINDUP_S, SKILLS, WEEK1_SKILLS, DODGE, REGEN, XP_RATE, hitChance, mobHitChance, combatXp, regenAfter,
  maxHit, minHit, taken, playerHp, swingSeconds,
  XP_TABLE, levelFor, rng32, fight, simulate };
