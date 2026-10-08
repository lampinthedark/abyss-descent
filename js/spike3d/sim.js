const WALK = 0;
const ATTACK = 1;
const HIT = 2;
const DEAD = 3;
const GRID = 48;
const CELL = 1.5;
const ORIGIN = 36;
const CAP = 12;

export function createSim(max, obstacles) {
  const x = new Float32Array(max);
  const z = new Float32Array(max);
  const dir = new Uint8Array(max);
  const anim = new Uint8Array(max);
  const frame = new Uint8Array(max);
  const state = new Uint8Array(max);
  const kind = new Uint8Array(max);
  const animT = new Float32Array(max);
  const fade = new Float32Array(max);
  const px = new Float32Array(max);
  const pz = new Float32Array(max);
  const cellCount = new Int16Array(GRID * GRID);
  const cellIds = new Int16Array(GRID * GRID * CAP);
  const hero = {
    x: 0, z: 0, vx: 0, vz: 0, dir: 0, anim: WALK, frame: 0, animT: 0,
    tier: 1, weapon: 0, shield: 1, attack: 0, orbit: 0,
  };
  let frozen = false;
  let still = false;
  let count = 0;
  let boss = -1;
  let rng = 123456789;
  let pulse = 0;
  const sim = {
    x, z, dir, anim, frame, state, kind, fade, hero,
    get count() { return count; },
    get boss() { return boss; },
    place,
    update,
    setFrozen(v) { frozen = v; },
    setHold(v) { still = v; },
  };

  function rand() {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  }

  function place(i, px0, pz0, k, isBoss) {
    x[i] = px0;
    z[i] = pz0;
    kind[i] = k;
    state[i] = WALK;
    anim[i] = WALK;
    frame[i] = (i * 3) & 3;
    dir[i] = i & 7;
    animT[i] = rand();
    fade[i] = 1;
    if (i + 1 > count) count = i + 1;
    if (isBoss) boss = i;
  }

  function cellOf(px0, pz0) {
    let cx = ((px0 + ORIGIN) / CELL) | 0;
    let cz = ((pz0 + ORIGIN) / CELL) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= GRID) cx = GRID - 1;
    if (cz < 0) cz = 0;
    else if (cz >= GRID) cz = GRID - 1;
    return cz * GRID + cx;
  }

  function blocked(px0, pz0) {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (px0 > o.minx && px0 < o.maxx && pz0 > o.minz && pz0 < o.maxz) return o;
    }
    return null;
  }

  function shove(px0, pz0) {
    const o = blocked(px0, pz0);
    if (!o) return null;
    const dxL = px0 - o.minx;
    const dxR = o.maxx - px0;
    const dzL = pz0 - o.minz;
    const dzR = o.maxz - pz0;
    let best = dxL;
    let axis = 0;
    if (dxR < best) { best = dxR; axis = 1; }
    if (dzL < best) { best = dzL; axis = 2; }
    if (dzR < best) { axis = 3; }
    return axis;
  }

  function update(dt, ix, iz, manual, fwdX, fwdZ, rightX, rightZ, heroH, compare) {
    let hvx = 0;
    let hvz = 0;
    if (frozen) {
      hvx = 0;
      hvz = 0;
      hero.vx = 0;
      hero.vz = 0;
    } else if (manual) {
      const il = Math.hypot(ix, iz) || 1;
      hvx = (ix / il) * heroH * 4.2;
      hvz = (iz / il) * heroH * 4.2;
      hero.x += hvx * dt;
      hero.z += hvz * dt;
      hero.orbit = Math.atan2(hero.z, hero.x);
    } else {
      hero.orbit += dt * 0.62;
      const rad = heroH * 3.2;
      const nx = Math.cos(hero.orbit) * rad;
      const nz = Math.sin(hero.orbit) * rad;
      hvx = nx - hero.x;
      hvz = nz - hero.z;
      hero.x = nx;
      hero.z = nz;
    }
    const axis = shove(hero.x, hero.z);
    if (axis === 0) hero.x = blocked(hero.x, hero.z).minx - 0.05;
    else if (axis === 1) hero.x = blocked(hero.x, hero.z).maxx + 0.05;
    else if (axis === 2) hero.z = blocked(hero.x, hero.z).minz - 0.05;
    else if (axis === 3) hero.z = blocked(hero.x, hero.z).maxz + 0.05;
    hero.vx = hvx;
    hero.vz = hvz;
    const moving = hvx * hvx + hvz * hvz > 0.0001;
    hero.moving = moving && !frozen;
    if (moving) hero.dir = facing(hvx, hvz, rightX, rightZ, fwdX, fwdZ);
    hero.attack -= dt;
    if (hero.attack <= 0) hero.attack = 2.6;
    hero.anim = hero.attack > 2.15 ? ATTACK : WALK;
    stepAnim(hero, dt);

    cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      if (state[i] === DEAD) continue;
      const c = cellOf(x[i], z[i]);
      const n = cellCount[c];
      if (n < CAP) {
        cellIds[c * CAP + n] = i;
        cellCount[c] += 1;
      }
    }
    for (let i = 0; i < count; i++) {
      px[i] = 0;
      pz[i] = 0;
      if (state[i] === DEAD) continue;
      const c = cellOf(x[i], z[i]);
      const cx = c % GRID;
      const cz = (c / GRID) | 0;
      const rad = (i === boss ? heroH * 0.95 : heroH * 0.42);
      const rad2 = rad * rad;
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gz = cz + oz;
          if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) continue;
          const cc = gz * GRID + gx;
          const cn = cellCount[cc];
          const base = cc * CAP;
          for (let k = 0; k < cn; k++) {
            const j = cellIds[base + k];
            if (j === i) continue;
            let dx = x[i] - x[j];
            let dz = z[i] - z[j];
            const d2 = dx * dx + dz * dz;
            if (d2 > rad2 || d2 < 1e-8) continue;
            const d = Math.sqrt(d2);
            const push = (rad - d) / d;
            px[i] += dx * push;
            pz[i] += dz * push;
          }
        }
      }
    }

    pulse -= dt;
    const reach = heroH * 0.95;
    for (let i = 0; i < count; i++) {
      if (state[i] === DEAD) {
        animT[i] += dt;
        const u = animT[i] / 0.4;
        fade[i] = u >= 1 ? 0 : 1 - u;
        frame[i] = 3;
        anim[i] = DEAD;
        if (u >= 1) respawn(i, heroH);
        continue;
      }
      if (still) {
        stepEnemy(i, dt);
        continue;
      }
      if (state[i] === HIT) {
        animT[i] += dt;
        anim[i] = HIT;
        if (animT[i] > 0.16) {
          state[i] = DEAD;
          anim[i] = DEAD;
          frame[i] = 0;
          animT[i] = 0;
        }
        continue;
      }
      let dx = hero.x - x[i];
      let dz = hero.z - z[i];
      let dist = Math.hypot(dx, dz) || 1;
      const hold = i === boss ? heroH * 2.4 : reach;
      let speed = heroH * (kind[i] === 1 ? 2.3 : 1.7);
      if (i === boss) speed *= 0.75;
      if (dist < hold) {
        dx = 0; dz = 0;
      } else {
        dx /= dist; dz /= dist;
      }
      dx += px[i];
      dz += pz[i];
      const ml = Math.hypot(dx, dz) || 1;
      dx /= ml; dz /= ml;
      if (dist >= hold) {
        x[i] += dx * speed * dt;
        z[i] += dz * speed * dt;
      }
      const ax = shove(x[i], z[i]);
      if (ax === 0) x[i] = blocked(x[i], z[i]).minx - 0.05;
      else if (ax === 1) x[i] = blocked(x[i], z[i]).maxx + 0.05;
      else if (ax === 2) z[i] = blocked(x[i], z[i]).minz - 0.05;
      else if (ax === 3) z[i] = blocked(x[i], z[i]).maxz + 0.05;
      if (compare) {
        let hx = x[i] - hero.x;
        let hz = z[i] - hero.z;
        const hd = Math.hypot(hx, hz);
        const clear = heroH * 2.3;
        if (hd < clear && hd > 0.001) {
          x[i] = hero.x + (hx / hd) * clear;
          z[i] = hero.z + (hz / hd) * clear;
        }
      }
      const ndx = hero.x - x[i];
      const ndz = hero.z - z[i];
      const nd = Math.hypot(ndx, ndz);
      if (nd > 0.02) dir[i] = facing(ndx, ndz, rightX, rightZ, fwdX, fwdZ);
      if (i !== boss && nd < reach && pulse <= 0 && (i & 7) === ((pulseCycle) & 7)) {
        state[i] = HIT;
        anim[i] = HIT;
        frame[i] = 0;
        animT[i] = 0;
        continue;
      }
      if (nd < hold * 1.35) {
        state[i] = ATTACK;
        anim[i] = ATTACK;
      } else {
        state[i] = WALK;
        anim[i] = WALK;
      }
      stepEnemy(i, dt);
    }
    if (pulse <= 0) {
      pulse = 0.85;
      pulseCycle += 1;
    }
  }

  let pulseCycle = 0;

  function stepAnim(actor, dt) {
    actor.animT += dt;
    const rate = actor.anim === ATTACK ? 0.09 : 0.12;
    const last = actor.anim === ATTACK ? 3 : 3;
    if (actor.animT >= rate) {
      actor.animT = 0;
      actor.frame += 1;
      if (actor.frame > last) actor.frame = 0;
    }
  }

  function stepEnemy(i, dt) {
    animT[i] += dt;
    const rate = anim[i] === ATTACK ? 0.1 : 0.13;
    if (animT[i] >= rate) {
      animT[i] = 0;
      frame[i] += 1;
      if (frame[i] > 3) frame[i] = 0;
    }
  }

  function respawn(i, heroH) {
    const ang = rand() * Math.PI * 2;
    const rad = heroH * (8 + rand() * 6);
    x[i] = hero.x + Math.cos(ang) * rad;
    z[i] = hero.z + Math.sin(ang) * rad;
    state[i] = WALK;
    anim[i] = WALK;
    frame[i] = 0;
    animT[i] = 0;
    fade[i] = 1;
  }

  function beginCorpse(i, px0, pz0) {
    x[i] = px0;
    z[i] = pz0;
    kind[i] = 0;
    state[i] = DEAD;
    anim[i] = DEAD;
    frame[i] = 3;
    animT[i] = 0.02;
    fade[i] = 0.95;
    dir[i] = 0;
  }

  sim.beginCorpse = beginCorpse;

  return sim;
}

export function facing(mx, mz, rightX, rightZ, fwdX, fwdZ) {
  const side = mx * rightX + mz * rightZ;
  const fwd = mx * fwdX + mz * fwdZ;
  let ang = Math.atan2(side, -fwd);
  if (ang < 0) ang += Math.PI * 2;
  let d = Math.round(ang / (Math.PI / 4)) % 8;
  if (d < 0) d += 8;
  return d;
}

export const ANIM = { WALK: 0, ATTACK: 1, HIT: 2, DEAD: 3 };
