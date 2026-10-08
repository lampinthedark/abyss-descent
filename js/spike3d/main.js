import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ColorManagement,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  NoToneMapping,
  NormalBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { TIERS, hexUnit } from './palette.js';
import { loadAtlas } from './art.js';
import { buildWorld, groundKind, heightAt, OBSTACLES, pathX } from './world.js';
import { ANIM, createSim } from './sim.js';
import { beamHeightCss, beamSpec, beamStrips, plateShadow } from './loot-beams.js';

const PITCH = 66 * Math.PI / 180;
const YAW = 0;
const CAM_DIST = 40;
const CELL_W = 48;
const CELL_H = 64;
const FOOT_X = 24;
const FOOT_Y = 2;
const SRC_H = CELL_H - FOOT_Y;
const ANIM_IDS = ['walk', 'attack', 'hit', 'death'];
const ANIM_FRAMES = [4, 4, 2, 4];
const KIND_SHEET = ['skeleton/body/base', 'rat/body/base', 'wolf/body/base', 'caster/body/base'];
const FWD_X = Math.sin(YAW);
const FWD_Z = Math.cos(YAW);
const RIGHT_X = Math.cos(YAW);
const RIGHT_Z = -Math.sin(YAW);
const GRASS = { x: -12, z: 8 };
const WHITE = [1, 1, 1];

const params = new URLSearchParams(location.search);
const heroPx = params.get('hero') === '45' ? 45 : 60;
const count = clampInt(params.get('n'), 300, 1, 1000);
const dprCap = params.get('dpr');
const dpr = Math.max(0.5, Math.min(dprCap ? Number(dprCap) : (window.devicePixelRatio || 1), 3));
const bossOn = params.get('boss') !== '0';
const focusBoss = params.get('focus') === 'boss';
const arrowTest = params.get('arrow') === '1';
const lootPair = params.get('loot') === '1';
const lineup = params.get('tiers') === '1';
const mock = params.get('mock') === '1';
const BOSS_SCALE = 2.2;
const ringOn = params.get('ring') !== '0';
const glance = params.get('glance') === '1';
const stand = params.get('stand');
const compareStart = params.get('compare') === '1';
const showChat = params.get('chat') !== '0';
const soakMin = params.get('soak') ? Number(params.get('soak')) : 0;
const bigBench = params.get('bench') === '1' || soakMin > 0;
const bare = params.get('hud') === '0';

const tierRgb = [null];
const tierShine = [0];
for (let i = 1; i <= 5; i++) {
  tierRgb[i] = hexUnit(TIERS[i].hex);
  tierShine[i] = TIERS[i].shine;
}

const VERT = `
attribute vec3 iPos;
attribute vec4 iUv;
attribute vec4 iBox;
attribute vec3 iTint;
attribute vec4 iFx;
attribute float iSheen;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vUv;
varying vec3 vTint;
varying vec2 vFade;
varying float vSheen;
void main() {
  float ox = (uv.x * iBox.x - iBox.z) * iFx.y * iFx.x;
  float oy = (uv.y * iBox.y - iBox.w) * iFx.y;
  vec3 world = iPos + uRight * ox + uUp * oy;
  vUv = vec2(iUv.x + uv.x * iUv.z, 1.0 - iUv.y - iUv.w + uv.y * iUv.w);
  vTint = iTint;
  vFade = iFx.zw;
  vSheen = iSheen;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform sampler2D uMap;
uniform float uCut;
varying vec2 vUv;
varying vec3 vTint;
varying vec2 vFade;
varying float vSheen;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  float luma = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 col = tex.rgb * vTint;
  col = mix(col, vec3(1.0), smoothstep(0.84, 0.98, luma) * vSheen);
  float g = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(g), vFade.y);
  gl_FragColor = vec4(col, uCut > 0.5 ? 1.0 : vFade.x);
}
`;

const view = document.getElementById('view');
const benchEl = document.getElementById('bench');
const tierEl = document.getElementById('tier');
const chatEls = [document.getElementById('chat0'), document.getElementById('chat1')];
const chatUntil = [0, 0];
const failEl = document.getElementById('fail');
const keys = Object.create(null);
let compare = compareStart;
let desiredTier = 1;
let viewW = 390;
let viewH = 844;
let joyX = 0;
let joyY = 0;
let joyOn = false;

const api = {
  ready: false,
  visible: 0,
  total: count,
  heroPx: heroPx,
  heroPxMeasured: 0,
  fps: 0,
  minFps: 0,
  slow20: 0,
  slow33: 0,
  calls: 0,
  tris: 0,
  dpr: dpr,
  kind: '',
  tier: 1,
  bob: 0,
  moving: false,
  corpseFade: 1,
  soakDone: false,
  renderer: '',
  error: '',
};
window.__spike = api;

if (bare) document.body.classList.add('bare');
if (bigBench) document.body.classList.add('bench');
if (mock) document.body.classList.add('mock');

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function fail(msg) {
  api.error = msg;
  failEl.hidden = false;
  failEl.textContent = msg;
}

function say(text, now) {
  if (mock) return;
  chatEls[0].textContent = chatEls[1].textContent;
  chatEls[1].textContent = text;
  chatUntil[0] = chatUntil[1];
  chatUntil[1] = now + 3000;
}

function setTier(n) {
  desiredTier = n;
  api.tier = n;
  tierEl.textContent = compare ? 'Rustbound  |  Sunforged' : TIERS[n].name;
  if (showChat) say(TIERS[n].name, performance.now());
}

function boot() {
  ColorManagement.enabled = false;
  const renderer = new WebGLRenderer({
    canvas: view,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: params.get('read') === '1',
  });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x14120e, 1);
  const gl = renderer.getContext();
  api.renderer = gl.getParameter(gl.RENDERER) || '';

  const camera = new OrthographicCamera(-5, 5, 5, -5, 0.05, 140);
  let frustumW = 10;
  let frustumH = 10;
  let lookShift = 0;
  const right = new Vector3(1, 0, 0);
  const up = new Vector3(0, 1, 0);
  const tmp = new Vector3();

  const world = buildWorld();
  const worldScene = new Scene();
  worldScene.add(world.mesh);

  const sim = createSim(1000, OBSTACLES);
  sim.hero.tier = 1;
  sim.hero.weapon = 0;
  sim.hero.shield = 1;
  if (glance || stand || mock) sim.setFrozen(true);
  if (stand || mock) sim.setHold(true);

  const ringTex = ringTexture();
  const ring = new Mesh(new PlaneGeometry(1, 1), ringMaterial(ringTex));
  ring.rotation.x = -Math.PI / 2;
  ring.frustumCulled = false;
  const ringScene = new Scene();
  ringScene.add(ring);

  let atlas;
  let sheetBase;
  let animOffset;
  let perDir;
  let table;
  let drops;

  const stats = {
    frames: 0,
    slow20: 0,
    slow33: 0,
    sumDt: 0,
    maxDt: 0,
    start: performance.now(),
  };
  api.reset = function () {
    stats.frames = 0;
    stats.slow20 = 0;
    stats.slow33 = 0;
    stats.sumDt = 0;
    stats.maxDt = 0;
    stats.start = performance.now();
  };
  let last = performance.now();
  let spawned = false;
  let heroWorld = 1;
  let worldPerPx = 1;
  const corpseSlot = 6;
  let bossHp = 1;
  let lastBossState = -1;

  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(viewW, viewH, false);
    frustumW = 10 * (viewW / 390);
    frustumH = frustumW * (viewH / Math.max(1, viewW));
    camera.left = -frustumW / 2;
    camera.right = frustumW / 2;
    camera.top = frustumH / 2;
    camera.bottom = -frustumH / 2;
    camera.updateProjectionMatrix();
    if (mock) placeMockJoy();
  }

  function spriteHeight() {
    return (heroPx / Math.max(1, viewH)) * frustumH / Math.cos(PITCH);
  }

  function makeMat(texture, cut, depthTest, depthWrite, blending) {
    const mat = new ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uRight: { value: right },
        uUp: { value: up },
        uCut: { value: cut ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: !cut,
      depthTest: depthTest,
      depthWrite: depthWrite,
      blending: blending || NormalBlending,
    });
    mat.toneMapped = false;
    return mat;
  }

  function makeBatch(max, material) {
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0,
      0, 0, 0, 1, 1, 0, 0, 1, 0,
    ]), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 1,
      0, 0, 1, 1, 0, 1,
    ]), 2));
    const pos = new Float32Array(max * 3);
    const iuv = new Float32Array(max * 4);
    const box = new Float32Array(max * 4);
    const tint = new Float32Array(max * 3);
    const fx = new Float32Array(max * 4);
    const sheen = new Float32Array(max);
    function bind(name, arr, size) {
      const attr = new InstancedBufferAttribute(arr, size);
      attr.setUsage(DynamicDrawUsage);
      geo.setAttribute(name, attr);
      return attr;
    }
    const aPos = bind('iPos', pos, 3);
    const aUv = bind('iUv', iuv, 4);
    const aBox = bind('iBox', box, 4);
    const aTint = bind('iTint', tint, 3);
    const aFx = bind('iFx', fx, 4);
    const aSheen = bind('iSheen', sheen, 1);
    geo.instanceCount = 0;
    const mesh = new Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    let n = 0;
    return {
      mesh,
      begin() { n = 0; },
      push(x, y, z, u, v, du, dv, bw, bh, footX, footY, tr, tg, tb, flip, scale, alpha, desat, shine) {
        if (n >= max) return;
        const i3 = n * 3;
        const i4 = n * 4;
        pos[i3] = x;
        pos[i3 + 1] = y;
        pos[i3 + 2] = z;
        iuv[i4] = u;
        iuv[i4 + 1] = v;
        iuv[i4 + 2] = du;
        iuv[i4 + 3] = dv;
        box[i4] = bw;
        box[i4 + 1] = bh;
        box[i4 + 2] = footX;
        box[i4 + 3] = footY;
        tint[i3] = tr;
        tint[i3 + 1] = tg;
        tint[i3 + 2] = tb;
        fx[i4] = flip;
        fx[i4 + 1] = scale;
        fx[i4 + 2] = alpha;
        fx[i4 + 3] = desat;
        sheen[n] = shine;
        n += 1;
      },
      end() {
        geo.instanceCount = n;
        mesh.visible = n > 0;
        aPos.needsUpdate = true;
        aUv.needsUpdate = true;
        aBox.needsUpdate = true;
        aTint.needsUpdate = true;
        aFx.needsUpdate = true;
        aSheen.needsUpdate = true;
      },
    };
  }

  function pushFrame(batch, sheet, dir, anim, frame, x, y, z, tint, scale, alpha, desat, shine) {
    const frames = ANIM_FRAMES[anim];
    let f = frame;
    if (f >= frames) f = frames - 1;
    if (f < 0) f = 0;
    const index = sheetBase[sheet] + (dir & 7) * perDir + animOffset[ANIM_IDS[anim]] + f;
    const o = index * 8;
    batch.push(
      x, y, z,
      table[o], table[o + 1], table[o + 2], table[o + 3],
      CELL_W, CELL_H, FOOT_X, FOOT_Y,
      tint[0], tint[1], tint[2],
      1, scale, alpha, desat, shine,
    );
  }

  function pushHero(batch, x, y, z, dir, anim, frame, tier, scale, bob) {
    const tint = tierRgb[tier];
    const shine = tierShine[tier];
    const yy = y + bob;
    if (tier >= 5) pushFrame(batch, 'hero/cape/long', dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
    else if (tier >= 4) pushFrame(batch, 'hero/cape/short', dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
    pushFrame(batch, 'hero/legs/base', dir, anim, frame, x, yy, z, WHITE, scale, 1, 0, 0);
    pushFrame(batch, 'hero/body/base', dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
    pushFrame(batch, tier >= 2 ? 'hero/pauldrons/big' : 'hero/pauldrons/small', dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
    if (sim.hero.shield) pushFrame(batch, 'hero/shield/base', dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
    pushFrame(batch, 'hero/head/base', dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
    if (tier >= 5) pushFrame(batch, 'hero/crest/tall', dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
    else if (tier >= 3) pushFrame(batch, 'hero/crest/short', dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
    const weapon = tier >= 5 ? 'hero/weapon/axe' : 'hero/weapon/sword';
    pushFrame(batch, weapon, dir, anim, frame, x, yy, z, tint, scale, 1, 0, shine);
  }

  function layoutActors() {
    heroWorld = spriteHeight();
    const h = sim.hero;
    if (glance || stand === 'grass') {
      h.x = GRASS.x;
      h.z = GRASS.z;
    } else {
      h.orbit = 0;
      h.z = 0;
      h.x = pathX(h.z);
    }
    const spanX = Math.max(4, frustumW * 0.92);
    const spanZ = Math.max(6, (frustumH / Math.sin(PITCH)) * 0.86);
    const cols = glance ? 11 : Math.max(6, Math.round(Math.sqrt(count * (spanX / spanZ))));
    const rows = Math.ceil(count / Math.max(1, cols));
    const gap = heroWorld * (glance ? 0.48 : 0.78);
    for (let i = 0; i < count; i++) {
      let px;
      let pz;
      let kind = i % 4;
      if (stand) {
        const ang = (i / Math.max(1, count)) * Math.PI * 2;
        const rad = i === 0 ? heroWorld * 1.35 : heroWorld * (2.6 + (i % 5) * 0.35);
        px = h.x + RIGHT_X * Math.cos(ang) * rad + FWD_X * Math.sin(ang) * rad * 0.35;
        pz = h.z + RIGHT_Z * Math.cos(ang) * rad + FWD_Z * Math.sin(ang) * rad * 0.35;
        if (i === 0) kind = 3;
      } else if (glance) {
        const c = i % cols;
        const r = (i / cols) | 0;
        const side = (c - (cols - 1) / 2) * gap;
        const along = ((rows - 1) / 2 - r) * gap * 0.92;
        px = h.x + FWD_X * along + RIGHT_X * side;
        pz = h.z + FWD_Z * along + RIGHT_Z * side;
      } else {
        const c = i % cols;
        const r = (i / cols) | 0;
        const u = cols <= 1 ? 0.5 : c / (cols - 1);
        const v = rows <= 1 ? 0.5 : r / (rows - 1);
        px = h.x + (u - 0.5) * spanX;
        pz = h.z + (v - 0.42) * spanZ;
        if (Math.hypot(px - h.x, pz - h.z) < heroWorld * 0.9) px += spanX * 0.12;
      }
      const isBoss = bossOn && i === count - 1;
      if (isBoss && arrowTest) {
        px = h.x + 28;
        pz = h.z - 28;
      } else if (isBoss && (focusBoss || mock)) {
        px = h.x + RIGHT_X * heroWorld * 1.15 + FWD_X * heroWorld * 1.55;
        pz = h.z + RIGHT_Z * heroWorld * 1.15 + FWD_Z * heroWorld * 1.55;
      }
      sim.place(i, px, pz, isBoss ? 2 : kind, isBoss);
    }
    if (glance) {
      sim.beginCorpse(
        corpseSlot,
        h.x + RIGHT_X * heroWorld * 0.95,
        h.z + RIGHT_Z * heroWorld * 0.2 + FWD_Z * heroWorld * 0.15,
      );
    }
    placeDrops();
  }

  function placeDrops() {
    const h = sim.hero;
    const hide = glance && !lootPair && !mock;
    const row = lootPair || mock;
    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      if (hide) {
        drop.x = h.x - FWD_X * 40;
        drop.z = h.z - FWD_Z * 40;
        continue;
      }
      const spot = row ? drop.showcase : drop.scatter;
      drop.x = h.x + RIGHT_X * spot[0] + FWD_X * spot[1];
      drop.z = h.z + RIGHT_Z * spot[0] + FWD_Z * spot[1];
    }
  }

  function projectCss(x, y, z) {
    tmp.set(x, y, z).project(camera);
    return {
      x: (tmp.x * 0.5 + 0.5) * viewW,
      y: (-tmp.y * 0.5 + 0.5) * viewH,
      z: tmp.z,
    };
  }

  function visibleCount() {
    let n = 0;
    for (let i = 0; i < sim.count; i++) {
      if (sim.state[i] === ANIM.DEAD && sim.fade[i] < 0.05) continue;
      const p = projectCss(sim.x[i], heightAt(sim.x[i], sim.z[i]) + 0.2, sim.z[i]);
      if (p.z < 1 && p.x >= 0 && p.x <= viewW && p.y >= 0 && p.y <= viewH) n += 1;
    }
    return n;
  }

  function paintBench(now) {
    const avg = stats.sumDt > 0 ? stats.frames / stats.sumDt : 0;
    const minFps = stats.maxDt > 0 ? 1 / stats.maxDt : 0;
    const slow20 = stats.frames ? (100 * stats.slow20 / stats.frames) : 0;
    const slow33 = stats.frames ? (100 * stats.slow33 / stats.frames) : 0;
    const minutes = (now - stats.start) / 60000;
    api.fps = avg;
    api.minFps = minFps;
    api.slow20 = slow20;
    api.slow33 = slow33;
    api.soakDone = soakMin > 0 && minutes >= soakMin;
    const calls = renderer.info.render.calls;
    const tris = renderer.info.render.triangles;
    api.calls = calls;
    api.tris = tris;
    benchEl.innerHTML =
      '<b>' + avg.toFixed(0) + ' fps</b>  min ' + minFps.toFixed(0) +
      '<br>slow ' + slow20.toFixed(0) + '% &gt;20ms  ' + slow33.toFixed(0) + '% &gt;33ms' +
      '<br>draws ' + calls + '  tris ' + tris +
      '<br>' + api.renderer +
      '<br>dpr ' + dpr.toFixed(2) + '  ' + viewW + '×' + viewH +
      '<br>' + minutes.toFixed(2) + ' min  visible ' + api.visible + '/' + sim.count +
      '<br>' + api.kind + '  hero ' + api.heroPxMeasured.toFixed(0) + 'px' +
      (api.soakDone ? '<br><b>soak done</b>' : '') +
      '<div class="row">' +
      '<button type="button" data-n="300">300</button>' +
      '<button type="button" data-n="500">500</button>' +
      '<button type="button" data-n="1000">1000</button>' +
      '<button type="button" data-hero="45">45</button>' +
      '<button type="button" data-hero="60">60</button>' +
      '</div>';
  }

  function frame(now) {
    const raw = Math.max(0.001, (now - last) / 1000);
    last = now;
    const dt = Math.min(0.05, raw);
    if (raw < 0.5) {
      stats.frames += 1;
      stats.sumDt += raw;
      if (raw > stats.maxDt) stats.maxDt = raw;
      if (raw > 0.02) stats.slow20 += 1;
      if (raw > 0.033) stats.slow33 += 1;
    }
    heroWorld = spriteHeight();
    worldPerPx = heroWorld / heroPx;
    let ppm = heroWorld / SRC_H;

    let ix = 0;
    let iz = 0;
    if (keys.w || keys.arrowup) { ix += FWD_X; iz += FWD_Z; }
    if (keys.s || keys.arrowdown) { ix -= FWD_X; iz -= FWD_Z; }
    if (keys.d || keys.arrowright) { ix += RIGHT_X; iz += RIGHT_Z; }
    if (keys.a || keys.arrowleft) { ix -= RIGHT_X; iz -= RIGHT_Z; }
    if (joyOn) {
      ix += joyX * RIGHT_X - joyY * FWD_X;
      iz += joyX * RIGHT_Z - joyY * FWD_Z;
    }
    const manual = ix !== 0 || iz !== 0;
    if (!spawned) {
      layoutActors();
      spawned = true;
    }
    sim.hero.tier = desiredTier;
    sim.update(dt, ix, iz, manual, FWD_X, FWD_Z, RIGHT_X, RIGHT_Z, heroWorld, compare || !!stand);
    if (glance && sim.state[corpseSlot] !== ANIM.DEAD) {
      sim.beginCorpse(
        corpseSlot,
        sim.hero.x + RIGHT_X * heroWorld * 0.95,
        sim.hero.z + RIGHT_Z * heroWorld * 0.2 + FWD_Z * heroWorld * 0.15,
      );
    }

    const hx = sim.hero.x;
    const hz = sim.hero.z;
    const hy = heightAt(hx, hz);
    const run = !!sim.hero.moving;
    api.moving = run;
    api.kind = groundKind(hx, hz);
    api.tier = sim.hero.tier;
    api.corpseFade = sim.fade[corpseSlot];

    const cp = Math.cos(PITCH);
    const sp = Math.sin(PITCH);
    const depthPerPx = (frustumH / Math.sin(PITCH)) / Math.max(1, viewH);
    for (let pass = 0; pass < 2; pass++) {
      const lookX = hx + FWD_X * lookShift;
      const lookZ = hz + FWD_Z * lookShift;
      const lookY = hy + heroWorld * 0.2;
      camera.position.set(lookX - FWD_X * cp * CAM_DIST, lookY + sp * CAM_DIST, lookZ - FWD_Z * cp * CAM_DIST);
      camera.lookAt(lookX, lookY, lookZ);
      camera.updateMatrixWorld();
      const chest = projectCss(hx, hy + heroWorld * 0.55, hz);
      const err = chest.y / Math.max(1, viewH) - 0.55;
      lookShift -= err * viewH * depthPerPx;
    }
    const e = camera.matrixWorld.elements;
    right.set(e[0], 0, e[2]);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    else right.normalize();
    up.set(0, 1, 0);

    world.torch.position.set(hx, hy + 1.5, hz);
    const origin = projectCss(hx, hy, hz);
    const lifted = projectCss(hx, hy + 1, hz);
    const pxPerWorld = Math.max(0.001, Math.abs(origin.y - lifted.y));
    worldPerPx = 1 / pxPerWorld;
    const drawH = heroPx * worldPerPx;
    ppm = drawH / SRC_H;
    const freq = run ? 2.6 : 1.5;
    const ampPx = run ? 3.2 : 1;
    const bob = Math.sin(now * 0.001 * freq * Math.PI * 2) * ampPx * worldPerPx;
    api.bob = bob;
    if (ringOn) {
      ring.position.set(hx, hy + 0.035, hz);
      ring.scale.set(drawH * 1.15, drawH * 1.15, 1);
      ring.visible = true;
    }

    const feet = projectCss(hx, hy, hz);
    const head = projectCss(hx, hy + drawH, hz);
    api.heroPxMeasured = Math.abs(feet.y - head.y);
    api.fx = feet.x;
    api.fy = feet.y;
    api.chest = projectCss(hx, hy + drawH * 0.5, hz).y / Math.max(1, viewH);
    api.heroScreen = feet.y / Math.max(1, viewH);
    heroWorld = drawH;
    api.visible = visibleCount();

    enemies.begin();
    corpses.begin();
    const boss = sim.boss;
    for (let i = 0; i < sim.count; i++) {
      const y = heightAt(sim.x[i], sim.z[i]);
      let mul = 0.72;
      let sheet = KIND_SHEET[sim.kind[i]] || KIND_SHEET[0];
      if (i === boss) {
        mul = BOSS_SCALE;
        sheet = 'skeleton/body/boss';
      } else if (sim.elite[i]) {
        mul = 1.3;
        sheet = 'skeleton/body/elite';
      } else if (sim.kind[i] === 2 || sim.kind[i] === 3) {
        mul = 1;
      }
      const scale = mul * ppm;
      if (sim.state[i] === ANIM.DEAD) {
        const fade = sim.fade[i];
        if (fade < 0.02) continue;
        pushFrame(corpses, sheet, sim.dir[i], ANIM.DEAD, sim.frame[i], sim.x[i], y, sim.z[i], WHITE, scale, fade, 1, 0);
      } else {
        pushFrame(enemies, sheet, sim.dir[i], sim.anim[i], sim.frame[i], sim.x[i], y, sim.z[i], WHITE, scale, 1, 0, 0);
      }
    }
    enemies.end();
    corpses.end();

    heroBatch.begin();
    const anim = sim.hero.anim;
    const fr = sim.hero.frame;
    const dir = sim.hero.dir;
    if (lineup) {
      for (let t = 1; t <= 5; t++) {
        const ox = hx + RIGHT_X * drawH * (t - 3) * 1.05;
        const oz = hz + RIGHT_Z * drawH * (t - 3) * 1.05;
        pushHero(heroBatch, ox, heightAt(ox, oz), oz, dir, anim, fr, t, ppm, bob);
      }
    } else if (compare) {
      pushHero(heroBatch, hx, hy, hz, dir, anim, fr, 1, ppm, bob);
      const ox = hx + RIGHT_X * heroWorld * 1.55;
      const oz = hz + RIGHT_Z * heroWorld * 1.55;
      pushHero(heroBatch, ox, heightAt(ox, oz), oz, dir, anim, fr, 5, ppm, bob);
      tierEl.textContent = 'Rustbound  |  Sunforged';
    } else {
      pushHero(heroBatch, hx, hy, hz, dir, anim, fr, sim.hero.tier, ppm, bob);
    }
    heroBatch.end();

    paintDrops();
    paintBoss(boss, drawH);
    paintLevel(head);
    paintHud(now);

    if (!mock) {
      for (let i = 0; i < 2; i++) {
        const left = chatUntil[i] - now;
        chatEls[i].style.opacity = left <= 0 ? '0' : (left < 500 ? String(left / 500) : '1');
      }
    }

    renderer.info.reset();
    renderer.clear(true, true, true);
    renderer.render(worldScene, camera);
    if (ringOn) renderer.render(ringScene, camera);
    renderer.render(enemyScene, camera);
    renderer.render(corpseScene, camera);
    renderer.render(heroScene, camera);

    if ((stats.frames & 7) === 0) paintBench(now);
    api.ready = true;
    requestAnimationFrame(frame);
  }

  const bossPlate = document.getElementById('bossplate');
  const bossFill = document.getElementById('bosshpfill');
  const bossArrow = document.getElementById('bossarrow');
  const bossArr = bossArrow.querySelector('.arr');
  const levelEl = document.getElementById('levelup');
  const wasDead = new Uint8Array(1000);
  let kills = 0;

  function showEl(el, on) {
    if (!el) return;
    el.style.display = on ? '' : 'none';
  }

  function placePlate(el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    const r = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (r.left < 4) dx = 4 - r.left;
    if (r.right > viewW - 4) dx = (viewW - 4) - r.right;
    if (r.top < 4) dy = 4 - r.top;
    if (r.bottom > viewH - 4) dy = (viewH - 4) - r.bottom;
    if (dx || dy) {
      el.style.left = (x + dx) + 'px';
      el.style.top = (y + dy) + 'px';
    }
  }

  function paintDrops() {
    const info = [];
    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      const y = heightAt(drop.x, drop.z);
      const p = projectCss(drop.x, y, drop.z);
      const on = p.z < 1 && p.x >= -4 && p.x <= viewW + 4 && p.y >= -4 && p.y <= viewH + 4;
      showEl(drop.beam, on);
      showEl(drop.plate, on);
      showEl(drop.ring, on);
      showEl(drop.badge, on);
      showEl(drop.gem, on);
      showEl(drop.flash, on);
      if (!on) {
        info.push({ rarity: drop.rarity, on: false });
        continue;
      }
      const h = beamHeightCss(drop.rarity, p.y);
      if (drop.beam) {
        const w = Number(drop.beam.dataset.width) || 0;
        drop.beam.style.height = h + 'px';
        drop.beam.style.left = (p.x - w / 2) + 'px';
        drop.beam.style.top = (p.y - h) + 'px';
      }
      if (drop.gem) {
        drop.gem.style.left = p.x + 'px';
        drop.gem.style.top = (p.y - 2) + 'px';
      }
      if (drop.ring) {
        drop.ring.style.left = p.x + 'px';
        drop.ring.style.top = p.y + 'px';
      }
      if (drop.badge) {
        drop.badge.style.left = p.x + 'px';
        drop.badge.style.top = (p.y - 6) + 'px';
      }
      if (drop.flash) {
        drop.flash.style.left = p.x + 'px';
        drop.flash.style.top = p.y + 'px';
      }
      placePlate(drop.plate, p.x, drop.badge ? p.y - 20 : p.y - 12);
      info.push({
        rarity: drop.rarity,
        on: true,
        height: h,
        width: drop.beam ? Number(drop.beam.dataset.width) : 0,
        x: p.x,
        y: p.y,
        name: drop.plate.style.color,
      });
    }
    api.loot = info;
  }

  function paintBoss(boss, drawH) {
    if (!bossOn || boss < 0 || boss >= sim.count) {
      bossPlate.hidden = true;
      bossArrow.classList.remove('on');
      api.bossArrow = false;
      return;
    }
    const st = sim.state[boss];
    if (st === ANIM.HIT && lastBossState !== ANIM.HIT) bossHp = Math.max(0, bossHp - 0.18);
    if (st === ANIM.WALK && lastBossState === ANIM.DEAD) bossHp = 1;
    lastBossState = st;
    const by = heightAt(sim.x[boss], sim.z[boss]) + drawH * (BOSS_SCALE + 0.22);
    const p = projectCss(sim.x[boss], by, sim.z[boss]);
    const inside = p.z < 1 && p.x >= 16 && p.x <= viewW - 16 && p.y >= 16 && p.y <= viewH - 16;
    bossFill.style.width = Math.round(bossHp * 100) + '%';
    if (inside) {
      bossPlate.hidden = false;
      bossArrow.classList.remove('on');
      bossPlate.style.left = p.x + 'px';
      bossPlate.style.top = p.y + 'px';
      api.bossArrow = false;
      return;
    }
    bossPlate.hidden = true;
    const pad = 36;
    let x = p.x;
    let y = p.y;
    if (p.z > 1) {
      x = viewW - x;
      y = viewH - y;
    }
    x = Math.max(pad, Math.min(viewW - pad, x));
    y = Math.max(pad, Math.min(viewH - pad, y));
    const ang = Math.atan2((p.z > 1 ? viewH - p.y : p.y) - y, (p.z > 1 ? viewW - p.x : p.x) - x);
    bossArrow.classList.add('on');
    bossArrow.style.left = x + 'px';
    bossArrow.style.top = y + 'px';
    bossArr.style.transform = 'rotate(' + ang + 'rad)';
    api.bossArrow = true;
  }

  function paintLevel(head) {
    if (!mock) return;
    levelEl.style.left = head.x + 'px';
    levelEl.style.top = (head.y - 6) + 'px';
  }

  function paintHud(now) {
    for (let i = 0; i < sim.count; i++) {
      const dead = sim.state[i] === ANIM.DEAD ? 1 : 0;
      if (dead && !wasDead[i]) kills += 1;
      wasDead[i] = dead;
    }
    if (bare || mock) return;
    const sec = Math.max(0, (now - stats.start) / 1000);
    const m = (sec / 60) | 0;
    const s = sec % 60 | 0;
    document.getElementById('tm').textContent = m + ':' + (s < 10 ? '0' : '') + s;
    document.getElementById('kk').textContent = String(kills);
    document.getElementById('gd').textContent = String(128 + kills * 3);
  }

  const pauseBtn = document.getElementById('pause');
  let userPause = false;
  pauseBtn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  pauseBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    userPause = !userPause;
    sim.setFrozen(userPause || glance || !!stand || mock);
    pauseBtn.classList.toggle('paused', userPause);
  });

  resize();
  window.addEventListener('resize', resize);

  loadAtlas(location).then(async (loaded) => {
    atlas = loaded;
    sheetBase = atlas.sheetBase;
    animOffset = atlas.animOffset;
    perDir = atlas.perDir;
    table = atlas.table;
    await Promise.race([
      document.fonts.load('8px Silkscreen'),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    const tex = new CanvasTexture(atlas.source);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = LinearSRGBColorSpace;
    tex.needsUpdate = true;

    drops = createDrops();

    const enemyMat = makeMat(tex, true, true, true);
    const corpseMat = makeMat(tex, false, true, false);
    const heroMat = makeMat(tex, true, false, false);

    enemies = makeBatch(1000, enemyMat);
    corpses = makeBatch(1000, corpseMat);
    heroBatch = makeBatch(48, heroMat);

    enemyScene.add(enemies.mesh);
    corpseScene.add(corpses.mesh);
    heroScene.add(heroBatch.mesh);

    const now = performance.now();
    if (mock) {
      chatEls[0].textContent = 'You pick up a Tidesteel helm.';
      chatEls[1].textContent = 'You gain a level!';
      chatEls[0].style.opacity = '1';
      chatEls[1].style.opacity = '1';
    } else if (showChat) {
      say('The sand path is pale.', now);
      say('Corpses fade grey. The hero bobs.', now);
      chatUntil[0] = now + 3000;
      chatUntil[1] = now + 3000;
    }
    tierEl.textContent = 'Rustbound';
    requestAnimationFrame(frame);
  }).catch((err) => {
    fail(err && err.message ? err.message : 'atlas failed');
  });

  let enemies;
  let corpses;
  let heroBatch;
  const enemyScene = new Scene();
  const corpseScene = new Scene();
  const heroScene = new Scene();
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 10, 32, 32, 30);
  grd.addColorStop(0, 'rgba(231,195,106,0)');
  grd.addColorStop(0.62, 'rgba(231,195,106,0.08)');
  grd.addColorStop(0.78, 'rgba(231,195,106,0.9)');
  grd.addColorStop(0.9, 'rgba(231,195,106,0.15)');
  grd.addColorStop(1, 'rgba(231,195,106,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(c);
  tex.colorSpace = LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function ringMaterial(tex) {
  const mat = new ShaderMaterial({
    uniforms: { uMap: { value: tex } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      varying vec2 vUv;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.05) discard;
        gl_FragColor = tex;
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  mat.toneMapped = false;
  return mat;
}

function wireUi() {
  window.addEventListener('keydown', (ev) => {
    const k = ev.key.toLowerCase();
    keys[k] = true;
    if (k >= '1' && k <= '5') setTier(Number(k));
    if (k === 'c') {
      compare = !compare;
      tierEl.textContent = compare ? 'Rustbound  |  Sunforged' : TIERS[simTier()].name;
    }
  });
  window.addEventListener('keyup', (ev) => {
    keys[ev.key.toLowerCase()] = false;
  });
  document.getElementById('tiers').addEventListener('click', (ev) => {
    const t = ev.target.getAttribute('data-tier');
    if (t) setTier(Number(t));
  });
  benchEl.addEventListener('click', (ev) => {
    const n = ev.target.getAttribute('data-n');
    const h = ev.target.getAttribute('data-hero');
    if (!n && !h) return;
    const next = new URLSearchParams(location.search);
    if (n) next.set('n', n);
    if (h) next.set('hero', h);
    location.search = next.toString();
  });
  const joy = document.getElementById('joy');
  const knob = document.getElementById('knob');
  let joyPointer = null;
  let joyOriginX = 0;
  let joyOriginY = 0;
  function showJoy(clientX, clientY) {
    mockStick = false;
    joy.classList.add('on');
    joy.style.left = clientX + 'px';
    joy.style.top = clientY + 'px';
    joyOriginX = clientX;
    joyOriginY = clientY;
  }
  function joyAt(clientX, clientY) {
    let dx = (clientX - joyOriginX) / 30;
    let dy = (clientY - joyOriginY) / 30;
    const m = Math.hypot(dx, dy) || 1;
    if (m > 1) { dx /= m; dy /= m; }
    joyX = dx;
    joyY = dy;
    joyOn = true;
    knob.style.transform = 'translate(' + (dx * 22) + 'px,' + (dy * 22) + 'px)';
  }
  function joyEnd() {
    joyPointer = null;
    joyOn = false;
    joyX = 0;
    joyY = 0;
    mockStick = false;
    joy.classList.remove('on');
    knob.style.transform = 'none';
  }
  window.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('button, a, input, #bench')) return;
    joyPointer = ev.pointerId;
    showJoy(ev.clientX, ev.clientY);
    joyAt(ev.clientX, ev.clientY);
  });
  window.addEventListener('pointermove', (ev) => {
    if (joyPointer !== ev.pointerId) return;
    joyAt(ev.clientX, ev.clientY);
  });
  window.addEventListener('pointerup', (ev) => {
    if (joyPointer !== ev.pointerId) return;
    joyEnd();
  });
  window.addEventListener('pointercancel', (ev) => {
    if (joyPointer !== ev.pointerId) return;
    joyEnd();
  });
  if (mock) placeMockJoy();
}

let mockStick = mock;

const DROP_LIST = [
  { rarity: 'material', name: 'Flax', showcase: [2.9, 1.5], scatter: [2.6, 1.1] },
  { rarity: 'normal', name: 'Bones', showcase: [1.4, 1.9], scatter: [-2.2, 0.9] },
  { rarity: 'rare', name: 'River Nail', showcase: [0.1, 2.5], scatter: [1.1, 3.1] },
  { rarity: 'veryrare', name: 'Night Opal', showcase: [-1.4, 2.3], scatter: [-2.6, 2.8] },
  { rarity: 'legendary', name: 'Pale Crown', showcase: [-0.2, 4.5], scatter: [0.4, 4.4] },
  { rarity: 'chase', name: 'Star Salt', showcase: [-2.9, 5.6], scatter: [-2.8, 5.2] },
];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function createDrops() {
  const fx = document.getElementById('fx');
  const out = [];
  for (let i = 0; i < DROP_LIST.length; i++) {
    const def = DROP_LIST[i];
    const spec = beamSpec(def.rarity);
    const strips = beamStrips(def.rarity, heroPx);
    let beam = null;
    if (strips.length) {
      beam = document.createElement('div');
      beam.className = 'beam';
      let width = 0;
      for (let s = 0; s < strips.length; s++) {
        const bar = document.createElement('i');
        bar.style.width = strips[s].css + 'px';
        bar.style.background = strips[s].background;
        beam.appendChild(bar);
        width += strips[s].css;
      }
      beam.dataset.width = String(width);
      beam.style.width = width + 'px';
      fx.appendChild(beam);
    }
    let ring = null;
    let badge = null;
    if (spec.ring) {
      ring = document.createElement('div');
      ring.className = 'mat-ring';
      ring.style.width = spec.ring.diameter + 'px';
      ring.style.height = Math.max(8, Math.round(spec.ring.diameter * 0.42)) + 'px';
      ring.style.borderWidth = spec.ring.css + 'px';
      ring.style.borderColor = spec.ring.color;
      fx.appendChild(ring);
      badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = String(spec.badge);
      fx.appendChild(badge);
    }
    let gem = null;
    if (spec.beam) {
      gem = document.createElement('div');
      gem.className = 'gem';
      gem.style.background = spec.body;
      fx.appendChild(gem);
    }
    const plate = document.createElement('div');
    plate.className = 'plate';
    plate.textContent = def.name;
    plate.style.color = spec.name;
    plate.style.background = spec.plate;
    const shadow = plateShadow(def.rarity);
    if (shadow) {
      plate.style.boxShadow = shadow;
      plate.style.border = 'none';
    } else plate.style.borderColor = spec.border;
    fx.appendChild(plate);
    let flash = null;
    if (spec.flash) {
      flash = document.createElement('div');
      flash.className = reduceMotion ? 'flash ring' : 'flash';
      if (reduceMotion) flash.style.borderColor = 'rgba(255,255,255,' + spec.flash.alpha + ')';
      else flash.style.background = 'rgba(255,255,255,' + spec.flash.alpha + ')';
      fx.appendChild(flash);
    }
    out.push({
      rarity: def.rarity,
      showcase: def.showcase,
      scatter: def.scatter,
      x: 0,
      z: 0,
      beam: beam,
      plate: plate,
      ring: ring,
      badge: badge,
      gem: gem,
      flash: flash,
    });
  }
  return out;
}

function placeMockJoy() {
  if (!mockStick) return;
  const joy = document.getElementById('joy');
  const knob = document.getElementById('knob');
  joy.classList.add('on');
  joy.style.left = '78px';
  joy.style.top = Math.max(140, viewH - 110) + 'px';
  knob.style.transform = 'translate(16px, -18px)';
  joyX = 16 / 22;
  joyY = -18 / 22;
  joyOn = true;
}

function simTier() {
  return api.tier || 1;
}

wireUi();
boot();
