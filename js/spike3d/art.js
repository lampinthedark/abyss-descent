import { atlasConfig } from './atlas-config.js';
import { HEX, hexRgb } from './palette.js';

const LW = 24;
const LH = 32;
const SCALE = 2;

const RGB = {
  1: hexRgb(HEX.ink),
  2: hexRgb(HEX.skin),
  3: hexRgb(HEX.pants),
  4: hexRgb(HEX.boot),
  5: hexRgb(HEX.metal),
  6: hexRgb(HEX.metalDark),
  7: hexRgb(HEX.shine),
  8: hexRgb(HEX.goblin),
  9: hexRgb(HEX.goblinDeep),
  10: hexRgb(HEX.rat),
  11: hexRgb(HEX.ratDeep),
  12: hexRgb(HEX.ratPink),
  19: hexRgb(HEX.wolf),
  20: hexRgb(HEX.wolfDeep),
  21: hexRgb(HEX.robe),
  22: hexRgb(HEX.robeDeep),
  23: hexRgb(HEX.violet),
  13: hexRgb(HEX.bone),
  14: hexRgb(HEX.boneDeep),
  15: hexRgb(HEX.spider),
  16: hexRgb(HEX.spiderDeep),
  24: hexRgb(HEX.slime),
  25: hexRgb(HEX.slimeDeep),
  26: hexRgb(HEX.slimeLight),
  17: hexRgb(HEX.eye),
  18: hexRgb(HEX.eyeRed),
};

const INK = 1;
const SKIN = 2;
const PANTS = 3;
const BOOT = 4;
const METAL = 5;
const METALD = 6;
const SHINE = 7;
const GOB = 8;
const GOBD = 9;
const RAT = 10;
const RATD = 11;
const PINK = 12;
const WOLF = 19;
const WOLFD = 20;
const ROBE = 21;
const ROBED = 22;
const VIOLET = 23;
const BONE = 13;
const BONED = 14;
const SPD = 15;
const SPDD = 16;
const SLIME = 24;
const SLIMED = 25;
const SLIMEL = 26;
const EYE = 17;
const EYER = 18;

function empty() {
  return new Uint8Array(LW * LH);
}

function put(buf, x, y, c) {
  if (c === 0 || x < 0 || y < 0 || x >= LW || y >= LH) return;
  buf[y * LW + x] = c;
}

function fill(buf, x, y, w, h, c) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) put(buf, x + xx, y + yy, c);
  }
}

function box(buf, x, y, w, h, fillC) {
  fill(buf, x, y, w, h, fillC);
}

function mirror(buf) {
  const out = empty();
  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) out[y * LW + (LW - 1 - x)] = buf[y * LW + x];
  }
  return out;
}

function squash(buf, keep) {
  if (keep >= 0.99) return buf;
  const out = empty();
  for (let y = 0; y < LH; y++) {
    const fromBottom = LH - 1 - y;
    const sy = Math.round(LH - 1 - fromBottom / keep);
    if (sy < 0 || sy >= LH) continue;
    for (let x = 0; x < LW; x++) out[y * LW + x] = buf[sy * LW + x];
  }
  return out;
}

function shift(buf, dx, dy) {
  if (dx === 0 && dy === 0) return buf;
  const out = empty();
  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) {
      const c = buf[y * LW + x];
      if (c) put(out, x + dx, y + dy, c);
    }
  }
  return out;
}

function poseFor(dir) {
  const canon = [0, 1, 2, 3, 4, 3, 2, 1][dir];
  return { d: canon, mirror: dir >= 5, lean: [0, 1, 3, 2, 0][canon] };
}

function walkOf(anim, frame) {
  if (anim === 'walk') {
    return { step: [1, 0, -1, 0][frame], bob: frame === 1 || frame === 3 ? -1 : 0, thrust: 0, recoil: 0 };
  }
  if (anim === 'attack') {
    return { step: 0, bob: 0, thrust: frame + 1, recoil: 0 };
  }
  if (anim === 'hit') {
    return { step: 0, bob: 0, thrust: 0, recoil: frame === 0 ? -1 : -2 };
  }
  return { step: 0, bob: 0, thrust: 0, recoil: 0 };
}

function drawLegs(buf, d, lean, step, bob) {
  const y = 20 + bob;
  const liftL = step > 0 ? 0 : 1;
  const liftR = step < 0 ? 0 : 1;
  if (d === 2 || d === 3) {
    fill(buf, 11 + lean, y + liftL, 3, 8, PANTS);
    fill(buf, 13 + lean, y + 3, 2, 5, PANTS);
    put(buf, 12 + lean, y + 4, INK);
    fill(buf, 11 + lean, 29, 4, 2, BOOT);
    return;
  }
  const gap = d === 4 ? 1 : 2;
  fill(buf, 7 + lean, y + liftL, 3, 8, PANTS);
  fill(buf, 7 + gap + 7 + lean, y + liftR, 3, 8, PANTS);
  put(buf, 8 + lean, y + 4, INK);
  put(buf, 8 + gap + 7 + lean, y + 4, INK);
  fill(buf, 6 + lean, 29, 4, 2, BOOT);
  fill(buf, 6 + gap + 7 + lean, 29, 4, 2, BOOT);
}

function drawBody(buf, d, lean, bob) {
  const y = 14 + bob;
  const wide = d === 0 || d === 1 || d === 4;
  const w = wide ? 8 : 5;
  const x = (wide ? 8 : 10) + lean;
  box(buf, x, y, w, 8, METAL, INK);
  fill(buf, x + 1, y + 1, 1, 6, METALD);
  if (d < 2) put(buf, x + w - 2, y + 2, SHINE);
}

function drawPauldrons(buf, d, lean, bob, big) {
  const y = 13 + bob;
  if (big) {
    if (d === 2 || d === 3) {
      box(buf, 6 + lean, y, 5, 4, METAL, INK);
      box(buf, 14 + lean, y, 5, 4, METAL, INK);
      put(buf, 8 + lean, y + 1, SHINE);
      return;
    }
    box(buf, 2 + lean, y, 6, 5, METAL, INK);
    box(buf, 16 + lean, y, 6, 5, METAL, INK);
    put(buf, 4 + lean, y + 1, SHINE);
    put(buf, 19 + lean, y + 1, SHINE);
    return;
  }
  const x = (d === 2 ? 9 : 7) + lean;
  const w = d === 2 ? 6 : 10;
  box(buf, x, y + 1, w, 3, METAL, INK);
}

function drawHead(buf, d, lean, bob) {
  const y = 4 + bob;
  if (d === 4) {
    fill(buf, 9 + lean, y, 6, 2, METALD);
    fill(buf, 8 + lean, y + 2, 8, 5, METAL);
    fill(buf, 7 + lean, y + 7, 10, 2, METAL);
    return;
  }
  if (d === 2 || d === 3) {
    fill(buf, 11 + lean, y, 4, 2, METALD);
    fill(buf, 10 + lean, y + 2, 6, 5, METAL);
    fill(buf, 13 + lean, y + 4, 2, 2, SKIN);
    put(buf, 14 + lean, y + 4, INK);
    fill(buf, 9 + lean, y + 7, 8, 2, METAL);
    return;
  }
  fill(buf, 9 + lean, y, 6, 2, METAL);
  put(buf, 11 + lean, y, SHINE);
  fill(buf, 8 + lean, y + 2, 8, 5, METAL);
  fill(buf, 10 + lean, y + 4, 4, 3, SKIN);
  put(buf, 11 + lean, y + 5, INK);
  put(buf, 13 + lean, y + 5, INK);
  fill(buf, 7 + lean, y + 7, 10, 2, METAL);
  fill(buf, 8 + lean, y + 8, 8, 1, METALD);
}

function drawCrest(buf, d, lean, bob, tall) {
  const top = (tall ? 0 : 3) + bob;
  const h = tall ? 7 : 4;
  const x = (d === 2 ? 12 : 10) + lean;
  box(buf, x, top, tall ? 3 : 4, h, METAL, INK);
  if (tall) {
    put(buf, x + 1, top + 1, SHINE);
    fill(buf, x, top + h - 1, 3, 1, METALD);
  }
}

function drawCape(buf, d, lean, bob, long) {
  const y = 12 + bob;
  // Tidesteel (long === false) is the wide cape. Sunforged hangs longer.
  const h = long ? 18 : 14;
  if (d === 2 || d === 3) {
    box(buf, (long ? 5 : 3) + lean, y, long ? 5 : 7, h, METAL);
    return;
  }
  const w = long ? 14 : 18;
  const x = (long ? 5 : 3) + lean;
  box(buf, x, y, w, h, METAL);
  if (!long) fill(buf, x + 1, y + 2, 2, h - 4, METALD);
}

function drawShield(buf, d, lean, bob) {
  const y = 14 + bob;
  if (d === 4) {
    box(buf, 15 + lean, y, 4, 7, METAL, INK);
    return;
  }
  if (d === 2 || d === 3) {
    box(buf, 8 + lean, y, 3, 7, METAL, INK);
    put(buf, 9 + lean, y + 2, SHINE);
    return;
  }
  box(buf, 2 + lean, y, 5, 8, METAL, INK);
  put(buf, 4 + lean, y + 2, SHINE);
  fill(buf, 3 + lean, y + 6, 3, 2, METALD);
}

function drawWeapon(buf, d, lean, bob, thrust, axe) {
  const y = 6 + bob;
  const reach = thrust;
  if (axe) {
    const x = (d === 4 ? 3 : d >= 2 ? 14 : 16) + lean + (d === 4 ? -reach : reach);
    fill(buf, x + 1, y + 8, 2, 12, METALD);
    fill(buf, x - 1, y + 1, 6, 4, METAL);
    fill(buf, x, y + 5, 4, 2, METALD);
    put(buf, x + 1, y + 2, SHINE);
    return;
  }
  if (d === 2 || d === 3) {
    fill(buf, 15 + lean, y + 10, 2, 8, METALD);
    fill(buf, 14 + lean, y + 8, 4, 2, METAL);
    fill(buf, 16 + lean + reach, y + 1, 2, 8, METAL);
    put(buf, 16 + lean + reach, y + 2, SHINE);
    return;
  }
  const x = (d === 4 ? 4 : 17) + lean;
  const tip = d === 4 ? -1 : 1;
  fill(buf, x, y + 12, 2, 7, METALD);
  fill(buf, x - 2, y + 11, 6, 2, METAL);
  fill(buf, x + (tip < 0 ? -1 : 0), y + 1 - reach, 2, 11, METAL);
  put(buf, x + (tip < 0 ? -1 : 0), y + 2, SHINE);
}

function drawGoblin(buf, d, lean, step, bob) {
  const y = 8 + bob;
  box(buf, 6 + lean, y, 12, 10, GOB, INK);
  put(buf, 5 + lean, y + 3, GOBD);
  put(buf, 18 + lean, y + 3, GOBD);
  if (d < 2) {
    fill(buf, 9 + lean, y + 4, 2, 2, EYE);
    fill(buf, 13 + lean, y + 4, 2, 2, EYE);
    put(buf, 10 + lean, y + 5, INK);
    put(buf, 14 + lean, y + 5, INK);
  } else if (d === 2 || d === 3) {
    fill(buf, 14 + lean, y + 4, 2, 2, EYE);
    put(buf, 15 + lean, y + 5, INK);
  }
  box(buf, 8 + lean, y + 10, 8, 6, GOB, INK);
  const ly = 24 + (step > 0 ? 0 : 1);
  box(buf, 8 + lean, ly, 3, 6, GOBD, INK);
  box(buf, 13 + lean, ly + (step !== 0 ? 1 : 0), 3, 6, GOBD, INK);
}

function drawRat(buf, d, lean, step, bob) {
  const y = 12 + bob;
  const foot = step > 0 ? 0 : 1;
  fill(buf, 8 + lean, y, 3, 4, PINK);
  fill(buf, 14 + lean, y, 3, 4, PINK);
  fill(buf, 9 + lean, y + 2, 7, 6, RAT);
  fill(buf, 10 + lean, y + 5, 3, 2, PINK);
  if (d < 2) {
    put(buf, 10 + lean, y + 4, INK);
    put(buf, 13 + lean, y + 4, INK);
  } else if (d !== 4) {
    put(buf, 13 + lean, y + 4, INK);
  }
  fill(buf, 9 + lean, y + 8, 6, 5, RAT);
  fill(buf, 4 + lean, y + 9, 4, 2, RATD);
  fill(buf, 8 + lean, y + 13 + foot, 2, 5, RATD);
  fill(buf, 14 + lean, y + 13 + (1 - foot), 2, 5, RATD);
  if (d !== 4) fill(buf, 16 + lean, y + 10, 4, 1, RATD);
}

function drawSkeleton(buf, d, lean, step, bob, trim, horns) {
  const y = 4 + bob;
  if (horns) {
    fill(buf, 7 + lean, y - 1, 2, 3, BONE);
    fill(buf, 15 + lean, y - 1, 2, 3, BONE);
    put(buf, 6 + lean, y - 2, BONE);
    put(buf, 17 + lean, y - 2, BONE);
  }
  fill(buf, 9 + lean, y + 1, 6, 2, BONE);
  fill(buf, 8 + lean, y + 3, 8, 5, BONE);
  if (d < 2) {
    put(buf, 10 + lean, y + 4, INK);
    put(buf, 13 + lean, y + 4, INK);
    fill(buf, 11 + lean, y + 6, 2, 1, INK);
  } else if (d === 4) {
    fill(buf, 10 + lean, y + 4, 4, 2, BONED);
  } else {
    put(buf, 13 + lean, y + 4, INK);
  }
  fill(buf, 11 + lean, y + 8, 2, 2, BONE);
  fill(buf, 9 + lean, y + 10, 6, 1, BONE);
  fill(buf, 10 + lean, y + 12, 4, 1, BONE);
  fill(buf, 11 + lean, y + 14, 2, 1, BONE);
  const ly = 18 + (step > 0 ? 0 : 1);
  fill(buf, 9 + lean, ly, 1, 12, BONE);
  fill(buf, 14 + lean, ly + (step !== 0 ? 1 : 0), 1, 12, BONE);
  if (d !== 4) {
    fill(buf, 17 + lean, y + 10, 1, 8, BONED);
    put(buf, 18 + lean, y + 9, BONE);
  } else {
    fill(buf, 6 + lean, y + 10, 1, 8, BONED);
  }
  if (trim) {
    fill(buf, 8 + lean, y + 8, 2, 1, ROBE);
    fill(buf, 14 + lean, y + 8, 2, 1, ROBE);
    fill(buf, 11 + lean, y + 11, 2, 1, ROBE);
  }
}

function drawWolf(buf, d, lean, step, bob) {
  const y = 16 + bob;
  const s = step > 0 ? 1 : 0;
  if (d === 4) {
    fill(buf, 6 + lean, y + 2, 10, 5, WOLF);
    fill(buf, 4 + lean, y + 3, 4, 4, WOLFD);
    fill(buf, 14 + lean, y + 4, 4, 2, WOLFD);
  } else if (d >= 2) {
    fill(buf, 4 + lean, y + 3, 12, 5, WOLF);
    fill(buf, 14 + lean, y, 6, 5, WOLF);
    fill(buf, 18 + lean, y + 2, 3, 2, WOLFD);
    put(buf, 17 + lean, y + 2, EYE);
    put(buf, 15 + lean, y - 1, WOLF);
  } else {
    fill(buf, 3 + lean, y + 4, 18, 5, WOLF);
    fill(buf, 8 + lean, y + 1, 8, 5, WOLF);
    fill(buf, 10 + lean, y + 5, 4, 2, WOLFD);
    put(buf, 10 + lean, y + 3, EYE);
    put(buf, 13 + lean, y + 3, EYE);
    put(buf, 7 + lean, y, WOLF);
    put(buf, 16 + lean, y, WOLF);
  }
  fill(buf, 4 + lean, y + 9, 2, 4 + s, WOLFD);
  fill(buf, 8 + lean, y + 9, 2, 5 - s, WOLFD);
  fill(buf, 13 + lean, y + 9, 2, 4 + s, WOLFD);
  fill(buf, 17 + lean, y + 9, 2, 5 - s, WOLFD);
}

function drawCaster(buf, d, lean, step, bob) {
  const y = 3 + bob;
  const foot = step > 0 ? 0 : 1;
  fill(buf, 11 + lean, y, 2, 2, ROBED);
  fill(buf, 8 + lean, y + 2, 8, 5, ROBED);
  if (d < 2) fill(buf, 10 + lean, y + 4, 4, 2, INK);
  else if (d !== 4) put(buf, 13 + lean, y + 4, INK);
  fill(buf, 8 + lean, y + 7, 8, 3, ROBE);
  fill(buf, 6 + lean, y + 10, 12, 8, ROBE);
  fill(buf, 5 + lean, y + 18, 14, 6, ROBE);
  fill(buf, 9 + lean, y + 12, 2, 8, ROBED);
  const sx = d === 4 ? 3 : 18;
  fill(buf, sx + lean, y + 4, 2, 18, ROBED);
  fill(buf, sx + lean, y + 1, 2, 3, SHINE);
  put(buf, sx + lean, y, SHINE);
  fill(buf, 8 + lean, 28, 3, 3, ROBED);
  fill(buf, 13 + lean, 28 + foot, 3, 3, ROBED);
}

function drawSlime(buf, d, lean, step, bob) {
  const y = 16 + bob;
  const hop = step > 0 ? 1 : 0;
  fill(buf, 7 + lean, y + 2, 10, 8, SLIME);
  fill(buf, 5 + lean, y + 4, 14, 6, SLIME);
  fill(buf, 6 + lean, y + 3, 12, 8, SLIME);
  fill(buf, 8 + lean, y + 1 - hop, 8, 3, SLIME);
  fill(buf, 9 + lean, y + 3, 3, 2, SLIMEL);
  if (d < 2) {
    put(buf, 9 + lean, y + 6, INK);
    put(buf, 13 + lean, y + 6, INK);
  } else if (d !== 4) {
    put(buf, 13 + lean, y + 6, INK);
  }
  fill(buf, 4 + lean, y + 10, 16, 2, SLIMED);
  fill(buf, 6 + lean, y + 12, 12, 1, SLIMED);
}

function drawSpider(buf, d, lean, step, bob) {
  const y = 12 + bob;
  const swing = step > 0 ? 1 : -1;
  fill(buf, 9 + lean, y, 6, 5, SPD);
  fill(buf, 8 + lean, y + 1, 8, 3, SPD);
  fill(buf, 10 + lean, y + 5, 4, 4, SPDD);
  if (d !== 4) {
    put(buf, 10 + lean, y + 2, EYER);
    put(buf, 13 + lean, y + 2, EYER);
  }
  for (let i = 0; i < 4; i++) {
    const yy = y + 1 + i * 2;
    put(buf, 4 + lean + (i % 2 === 0 ? swing : 0), yy, SPDD);
    put(buf, 3 + lean, yy + 1, INK);
    put(buf, 18 + lean - (i % 2 === 0 ? swing : 0), yy, SPDD);
    put(buf, 19 + lean, yy + 1, INK);
  }
}

function renderLogical(sheetId, dir, anim, frame) {
  const pose = poseFor(dir);
  const mot = walkOf(anim, frame);
  const buf = empty();
  const lean = pose.lean + mot.recoil;
  const d = pose.d;
  const bob = mot.bob;
  const step = mot.step;
  if (sheetId === 'hero/legs/base') drawLegs(buf, d, lean, step, bob);
  else if (sheetId === 'hero/body/base') drawBody(buf, d, lean, bob);
  else if (sheetId === 'hero/pauldrons/small') drawPauldrons(buf, d, lean, bob, false);
  else if (sheetId === 'hero/pauldrons/big') drawPauldrons(buf, d, lean, bob, true);
  else if (sheetId === 'hero/head/base') drawHead(buf, d, lean, bob);
  else if (sheetId === 'hero/crest/short') drawCrest(buf, d, lean, bob, false);
  else if (sheetId === 'hero/crest/tall') drawCrest(buf, d, lean, bob, true);
  else if (sheetId === 'hero/cape/short') drawCape(buf, d, lean, bob, false);
  else if (sheetId === 'hero/cape/long') drawCape(buf, d, lean, bob, true);
  else if (sheetId === 'hero/shield/base') drawShield(buf, d, lean, bob);
  else if (sheetId === 'hero/weapon/sword') drawWeapon(buf, d, lean, bob, mot.thrust, false);
  else if (sheetId === 'hero/weapon/axe') drawWeapon(buf, d, lean, bob, mot.thrust, true);
  else if (sheetId === 'caster/body/base') drawCaster(buf, d, lean, step, bob);
  else if (sheetId === 'rat/body/base') drawRat(buf, d, lean, step, bob);
  else if (sheetId === 'skeleton/body/base') drawSkeleton(buf, d, lean, step, bob, false);
  else if (sheetId === 'skeleton/body/elite') drawSkeleton(buf, d, lean, step, bob, true);
  else if (sheetId === 'skeleton/body/boss') drawSkeleton(buf, d, lean, step, bob, false, true);
  else if (sheetId === 'wolf/body/base') drawWolf(buf, d, lean, step, bob);
  else if (sheetId === 'slime/body/base') drawSlime(buf, d, lean, step, bob);
  else if (sheetId === 'spider/body/base') drawSpider(buf, d, lean, step, bob);
  else if (sheetId === 'goblin/body/base') drawGoblin(buf, d, lean, step, bob);
  let out = pose.mirror ? mirror(buf) : buf;
  if (anim === 'death') {
    const keep = [1, 0.75, 0.48, 0.26][frame];
    out = squash(out, keep);
  }
  return out;
}

function blit(img, buf, ox, oy, cellW, cellH, outline) {
  const data = img.data;
  const width = img.width;
  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) {
      const c = buf[y * LW + x];
      if (!c) continue;
      const rgb = RGB[c];
      const px = ox + x * SCALE;
      const py = oy + y * SCALE;
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const i = ((py + sy) * width + (px + sx)) * 4;
          data[i] = rgb[0];
          data[i + 1] = rgb[1];
          data[i + 2] = rgb[2];
          data[i + 3] = 255;
        }
      }
    }
  }
  if (!outline) return;
  // One source pixel of near-black rim so the figure reads on olive grass.
  const edge = hexRgb(HEX.ink);
  const mark = [];
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const i = ((oy + y) * width + (ox + x)) * 4;
      if (data[i + 3] !== 0) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= cellW || yy >= cellH) continue;
          const j = ((oy + yy) * width + (ox + xx)) * 4;
          if (data[j + 3] !== 0) hit = true;
        }
      }
      if (hit) mark.push(i);
    }
  }
  for (let m = 0; m < mark.length; m++) {
    const i = mark[m];
    data[i] = edge[0];
    data[i + 1] = edge[1];
    data[i + 2] = edge[2];
    data[i + 3] = 255;
  }
}

function animLayout(spec) {
  const offsets = {};
  let cursor = 0;
  for (let i = 0; i < spec.anims.length; i++) {
    offsets[spec.anims[i].id] = cursor;
    cursor += spec.anims[i].frames;
  }
  return { offsets, perDir: cursor };
}

export async function loadAtlas(pageUrl) {
  const params = new URLSearchParams(pageUrl.search);
  const mapUrl = params.get('atlasMap') || atlasConfig.mapUrl || new URL('assets/3d/atlas/placeholders.json', pageUrl).href;
  const mapRes = await fetch(mapUrl);
  if (!mapRes.ok) throw new Error('atlas map ' + mapRes.status);
  const spec = await mapRes.json();
  const imageUrl = params.get('atlasImage') || atlasConfig.imageUrl || spec.image || null;
  if (imageUrl && spec.frames) return buildFromImage(spec, imageUrl);
  if (imageUrl) return buildFromImageGrid(spec, imageUrl);
  return paintPlaceholders(spec);
}

function buildFromImage(spec, imageUrl) {
  return loadImage(imageUrl).then((image) => {
    const ids = Object.keys(spec.frames);
    const table = new Float32Array(ids.length * 8);
    const indexOf = {};
    for (let i = 0; i < ids.length; i++) {
      const f = spec.frames[ids[i]];
      indexOf[ids[i]] = i;
      const o = i * 8;
      table[o] = (f.x + 0.5) / image.width;
      table[o + 1] = (f.y + 0.5) / image.height;
      table[o + 2] = (f.w - 1) / image.width;
      table[o + 3] = (f.h - 1) / image.height;
      table[o + 4] = f.w;
      table[o + 5] = f.h;
      table[o + 6] = f.footX;
      table[o + 7] = f.footY;
    }
    return finish(image, table, spec, indexOf, image.width, image.height);
  });
}

function buildFromImageGrid(spec, imageUrl) {
  return loadImage(imageUrl).then((image) => packGrid(spec, image, image.width, image.height));
}

function paintPlaceholders(spec) {
  const grid = spec.grid;
  const canvas = document.createElement('canvas');
  canvas.width = grid.atlasW;
  canvas.height = grid.atlasH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(canvas.width, canvas.height);
  const layout = animLayout(spec);
  const perSheet = spec.directions * layout.perDir;
  for (let s = 0; s < spec.sheets.length; s++) {
    const sheet = spec.sheets[s];
    for (let dir = 0; dir < spec.directions; dir++) {
      for (let a = 0; a < spec.anims.length; a++) {
        const anim = spec.anims[a];
        for (let f = 0; f < anim.frames; f++) {
          const index = s * perSheet + dir * layout.perDir + layout.offsets[anim.id] + f;
          const col = index % grid.columns;
          const row = (index / grid.columns) | 0;
          const buf = renderLogical(sheet.id, dir, anim.id, f);
          blit(img, buf, col * grid.cellW, row * grid.cellH, grid.cellW, grid.cellH, sheet.outline !== false);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return packGrid(spec, canvas, canvas.width, canvas.height);
}

function packGrid(spec, source, width, height) {
  const grid = spec.grid;
  const layout = animLayout(spec);
  const perSheet = spec.directions * layout.perDir;
  const total = spec.sheets.length * perSheet;
  const table = new Float32Array(total * 8);
  const sheetBase = {};
  const sheetTint = {};
  for (let s = 0; s < spec.sheets.length; s++) {
    sheetBase[spec.sheets[s].id] = s * perSheet;
    sheetTint[spec.sheets[s].id] = spec.sheets[s].tint;
    for (let i = 0; i < perSheet; i++) {
      const index = s * perSheet + i;
      const col = index % grid.columns;
      const row = (index / grid.columns) | 0;
      const x = col * grid.cellW;
      const y = row * grid.cellH;
      const o = index * 8;
      table[o] = (x + 0.5) / width;
      table[o + 1] = (y + 0.5) / height;
      table[o + 2] = (grid.cellW - 1) / width;
      table[o + 3] = (grid.cellH - 1) / height;
      table[o + 4] = grid.cellW;
      table[o + 5] = grid.cellH;
      table[o + 6] = spec.foot.x;
      table[o + 7] = spec.foot.y;
    }
  }
  const animOffset = layout.offsets;
  return finish(source, table, spec, null, width, height, {
    sheetBase,
    sheetTint,
    animOffset,
    perDir: layout.perDir,
    placeholder: !!spec.placeholder,
  });
}

function finish(source, table, spec, indexOf, width, height, extra) {
  return {
    source,
    table,
    spec,
    indexOf,
    width,
    height,
    sheetBase: extra ? extra.sheetBase : {},
    sheetTint: extra ? extra.sheetTint : {},
    animOffset: extra ? extra.animOffset : {},
    perDir: extra ? extra.perDir : 0,
    placeholder: extra ? extra.placeholder : false,
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('atlas image'));
    image.src = url;
  });
}
