import {
  AdditiveBlending,
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
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { TIERS, hexUnit } from './palette.js';
import { loadAtlas } from './art.js';
import { buildWorld, groundKind, heightAt, OBSTACLES } from './world.js';
import { ANIM, createSim } from './sim.js';

const PITCH = 32 * Math.PI / 180;
const YAW = 0.62;
const FOV = 40;
const DIST = 15;
const CELL_W = 48;
const CELL_H = 64;
const FOOT_X = 24;
const FOOT_Y = 2;
const SRC_H = CELL_H - FOOT_Y;
const ANIM_IDS = ['walk', 'attack', 'hit', 'death'];
const ANIM_FRAMES = [4, 4, 2, 4];
const KIND_SHEET = ['goblin/body/base', 'rat/body/base', 'skeleton/body/base', 'spider/body/base'];
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
const lootPair = params.get('loot') === '1';
const lineup = params.get('tiers') === '1';
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

const BILL_VERT = `
attribute vec3 iPos;
attribute vec2 iSize;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vUv;
void main() {
  float ox = (uv.x - 0.5) * iSize.x;
  float oy = uv.y * iSize.y;
  vec3 world = iPos + uRight * ox + uUp * oy;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const RAIN_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
vec3 hue(float h) {
  vec3 p = abs(fract(vec3(h) + vec3(1.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);
  return clamp(p - 1.0, 0.0, 1.0);
}
void main() {
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  if (edge > 0.18) discard;
  float h = fract(uTime * 0.33 + vUv.x * 0.15 + vUv.y * 0.05);
  gl_FragColor = vec4(hue(h), 1.0);
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

  const camera = new PerspectiveCamera(FOV, 1, 0.05, 80);
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
  if (glance || stand) sim.setFrozen(true);
  if (stand) sim.setHold(true);

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
  let lootRects;
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
    camera.aspect = viewW / Math.max(1, viewH);
    camera.updateProjectionMatrix();
  }

  function spriteHeight() {
    const visible = 2 * DIST * Math.tan((FOV * Math.PI / 180) / 2);
    return (heroPx / Math.max(1, viewH)) * visible / Math.cos(PITCH);
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

  function makeSizeBatch(max, material) {
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
    const size = new Float32Array(max * 2);
    const aPos = new InstancedBufferAttribute(pos, 3);
    const aSize = new InstancedBufferAttribute(size, 2);
    aPos.setUsage(DynamicDrawUsage);
    aSize.setUsage(DynamicDrawUsage);
    geo.setAttribute('iPos', aPos);
    geo.setAttribute('iSize', aSize);
    geo.instanceCount = 0;
    const mesh = new Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    let n = 0;
    return {
      mesh,
      begin() { n = 0; },
      push(x, y, z, w, h) {
        if (n >= max) return;
        const i3 = n * 3;
        pos[i3] = x;
        pos[i3 + 1] = y;
        pos[i3 + 2] = z;
        size[n * 2] = w;
        size[n * 2 + 1] = h;
        n += 1;
      },
      end() {
        geo.instanceCount = n;
        mesh.visible = n > 0;
        aPos.needsUpdate = true;
        aSize.needsUpdate = true;
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
    } else if (stand === 'path') {
      h.x = 0;
      h.z = 0;
    } else {
      h.orbit = 0;
      h.x = heroWorld * 3.2;
      h.z = 0;
    }
    const cols = glance ? 11 : 9;
    const gap = heroWorld * (glance ? 0.48 : 0.78);
    const rows = Math.ceil(count / cols);
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
      } else {
        const c = i % cols;
        const r = (i / cols) | 0;
        const side = (c - (cols - 1) / 2) * gap;
        const along = ((rows - 1) / 2 - r) * gap * (glance ? 0.92 : 0.86);
        px = h.x + FWD_X * along + RIGHT_X * side;
        pz = h.z + FWD_Z * along + RIGHT_Z * side;
      }
      const isBoss = bossOn && i === count - 1;
      if (isBoss && focusBoss) {
        px = h.x + FWD_X * heroWorld * 1.7;
        pz = h.z + FWD_Z * heroWorld * 1.7;
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
    const spots = [
      [-1.15, 0.35], [-1.15, 1.15], [-1.15, 1.95],
      [-2.05, 0.35], [-2.05, 1.15], [-2.05, 1.95],
      [-2.95, 0.55], [-2.95, 1.35], [-2.95, 2.15],
    ];
    for (let i = 0; i < drops.length; i++) {
      const s = spots[i];
      drops[i].x = h.x + RIGHT_X * s[0] * heroWorld + FWD_X * s[1] * heroWorld;
      drops[i].z = h.z + RIGHT_Z * s[0] * heroWorld + FWD_Z * s[1] * heroWorld;
    }
    if (lootPair && drops.length > 6) {
      drops[0].x = h.x + FWD_X * heroWorld * 1.15 - RIGHT_X * heroWorld * 0.7;
      drops[0].z = h.z + FWD_Z * heroWorld * 1.15 - RIGHT_Z * heroWorld * 0.7;
      drops[6].x = h.x + FWD_X * heroWorld * 1.15 + RIGHT_X * heroWorld * 0.7;
      drops[6].z = h.z + FWD_Z * heroWorld * 1.15 + RIGHT_Z * heroWorld * 0.7;
      for (let i = 0; i < drops.length; i++) {
        if (i === 0 || i === 6) continue;
        drops[i].x = h.x - FWD_X * heroWorld * 12;
        drops[i].z = h.z - FWD_Z * heroWorld * 12;
      }
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

    const lookAhead = glance ? heroWorld * 0.05 : heroWorld * 1.35;
    const lookX = hx + FWD_X * lookAhead;
    const lookZ = hz + FWD_Z * lookAhead;
    const lookY = hy + heroWorld * 0.42;
    const cp = Math.cos(PITCH);
    const sp = Math.sin(PITCH);
    camera.position.set(lookX - FWD_X * cp * DIST, lookY + sp * DIST, lookZ - FWD_Z * cp * DIST);
    camera.lookAt(lookX, lookY, lookZ);
    camera.updateMatrixWorld();
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
    api.visible = visibleCount();

    enemies.begin();
    corpses.begin();
    const boss = sim.boss;
    for (let i = 0; i < sim.count; i++) {
      const y = heightAt(sim.x[i], sim.z[i]);
      const scale = (i === boss ? BOSS_SCALE : 1) * ppm;
      const sheet = KIND_SHEET[sim.kind[i]] || KIND_SHEET[0];
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

    loot.begin();
    rainbow.begin();
    sparks.begin();
    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      const y = heightAt(drop.x, drop.z);
      const m = drop.metrics;
      const plate = drop.plate;
      const icon = drop.icon;
      const beamY = y;
      loot.push(drop.x, beamY, drop.z, lootRects.white.u, lootRects.white.v, lootRects.white.du, lootRects.white.dv, m.beamW, m.beamH, m.beamW * 0.5, 0, drop.color[0], drop.color[1], drop.color[2], 1, worldPerPx, 0.92, 0, 0);
      const plateY = y + m.beamH * worldPerPx;
      if (m.rainbow) rainbow.push(drop.x, plateY - 4 * worldPerPx, drop.z, (plate.w + 10) * worldPerPx, (plate.h + 8) * worldPerPx);
      loot.push(drop.x, plateY, drop.z, plate.u, plate.v, plate.du, plate.dv, plate.w, plate.h, plate.w * 0.5, 0, 1, 1, 1, 1, worldPerPx, 1, 0, 0);
      const iconY = plateY + plate.h * worldPerPx;
      loot.push(drop.x, iconY, drop.z, icon.u, icon.v, icon.du, icon.dv, icon.w, icon.h, icon.w * 0.5, 0, 1, 1, 1, 1, worldPerPx, 1, 0, 0);
      if (m.rainbow) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.001 * Math.PI * 4);
        const sparkPx = 12 + 16 * pulse;
        sparks.push(drop.x, iconY + icon.h * worldPerPx * 0.45, drop.z, lootRects.star.u, lootRects.star.v, lootRects.star.du, lootRects.star.dv, sparkPx, sparkPx, sparkPx * 0.5, sparkPx * 0.15, 1, 1, 1, 1, worldPerPx, 0.95, 0, 0);
      }
    }
    loot.end();
    rainbow.end();
    sparks.end();
    rainMat.uniforms.uTime.value = now * 0.001;

    ui.begin();
    if (bossOn && boss >= 0 && boss < sim.count) {
      const st = sim.state[boss];
      if (st === ANIM.HIT && lastBossState !== ANIM.HIT) bossHp = Math.max(0, bossHp - 0.18);
      if (st === ANIM.WALK && lastBossState === ANIM.DEAD) bossHp = 1;
      lastBossState = st;
      const by = heightAt(sim.x[boss], sim.z[boss]) + drawH * (BOSS_SCALE + 0.28);
      const name = lootRects.name;
      ui.push(sim.x[boss], by + 8 * worldPerPx, sim.z[boss], name.u, name.v, name.du, name.dv, name.w, name.h, name.w * 0.5, 0, 1, 1, 1, 1, worldPerPx, 1, 0, 0);
      ui.push(sim.x[boss], by, sim.z[boss], lootRects.white.u, lootRects.white.v, lootRects.white.du, lootRects.white.dv, 54, 6, 27, 0, 0.12, 0.08, 0.07, 1, worldPerPx, 1, 0, 0);
      const fill = Math.max(2, 50 * bossHp);
      ui.push(sim.x[boss] - (50 - fill) * 0.5 * worldPerPx, by + worldPerPx, sim.z[boss], lootRects.white.u, lootRects.white.v, lootRects.white.du, lootRects.white.dv, fill, 4, fill * 0.5, 0, 0.75, 0.16, 0.14, 1, worldPerPx, 1, 0, 0);
    }
    ui.end();

    for (let i = 0; i < 2; i++) {
      const left = chatUntil[i] - now;
      chatEls[i].style.opacity = left <= 0 ? '0' : (left < 500 ? String(left / 500) : '1');
    }

    renderer.info.reset();
    renderer.clear(true, true, true);
    renderer.render(worldScene, camera);
    if (ringOn) renderer.render(ringScene, camera);
    renderer.render(enemyScene, camera);
    renderer.render(corpseScene, camera);
    renderer.render(rainScene, camera);
    renderer.render(lootScene, camera);
    renderer.render(sparkScene, camera);
    renderer.render(heroScene, camera);
    renderer.render(uiScene, camera);

    if ((stats.frames & 7) === 0) paintBench(now);
    api.ready = true;
    requestAnimationFrame(frame);
  }

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

    const built = buildLootAtlas();
    lootRects = built.rects;
    drops = built.drops;
    const lootTex = built.texture;

    const enemyMat = makeMat(tex, true, true, true);
    const corpseMat = makeMat(tex, false, true, false);
    const heroMat = makeMat(tex, true, false, false);
    const lootMat = makeMat(lootTex, false, false, false);
    const sparkMat = makeMat(lootTex, false, false, false, AdditiveBlending);
    rainMat = new ShaderMaterial({
      uniforms: {
        uRight: { value: right },
        uUp: { value: up },
        uTime: { value: 0 },
      },
      vertexShader: BILL_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    rainMat.toneMapped = false;

    enemies = makeBatch(1000, enemyMat);
    corpses = makeBatch(1000, corpseMat);
    heroBatch = makeBatch(48, heroMat);
    loot = makeBatch(48, lootMat);
    sparks = makeBatch(8, sparkMat);
    rainbow = makeSizeBatch(8, rainMat);
    ui = makeBatch(8, lootMat);

    enemyScene.add(enemies.mesh);
    corpseScene.add(corpses.mesh);
    heroScene.add(heroBatch.mesh);
    lootScene.add(loot.mesh);
    sparkScene.add(sparks.mesh);
    rainScene.add(rainbow.mesh);
    uiScene.add(ui.mesh);

    const now = performance.now();
    if (showChat) {
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
  let loot;
  let sparks;
  let rainbow;
  let ui;
  let rainMat;
  const enemyScene = new Scene();
  const corpseScene = new Scene();
  const heroScene = new Scene();
  const lootScene = new Scene();
  const sparkScene = new Scene();
  const rainScene = new Scene();
  const uiScene = new Scene();
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

function buildLootAtlas() {
  const atlasW = 512;
  const atlasH = 256;
  const canvas = document.createElement('canvas');
  canvas.width = atlasW;
  canvas.height = atlasH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, atlasW, atlasH);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 4, 4);
  drawStar(ctx, 8, 0, 32);
  drawGem(ctx, 48, 0, '#7eb6ff');
  drawGem(ctx, 88, 0, '#d0b4ff');
  drawGem(ctx, 128, 0, '#f4f7ff');

  const names = [
    ['Ash Band', 'rare', '#7eb6ff'],
    ['Fern Clasp', 'rare', '#7eb6ff'],
    ['River Nail', 'rare', '#7eb6ff'],
    ['Moss Idol', 'epic', '#d0b4ff'],
    ['Dusk Thread', 'epic', '#d0b4ff'],
    ['Night Opal', 'epic', '#d0b4ff'],
    ['Pale Crown', 'legendary', '#f4f7ff'],
    ['Glass Heart', 'legendary', '#f4f7ff'],
    ['Star Salt', 'legendary', '#f4f7ff'],
  ];
  ctx.font = '8px Silkscreen';
  ctx.textBaseline = 'middle';
  const plates = [];
  let x = 4;
  let y = 40;
  for (let i = 0; i < names.length; i++) {
    const plateH = names[i][1] === 'legendary' ? 18 : 12;
    const tw = Math.ceil(ctx.measureText(names[i][0]).width);
    const plateW = Math.max(plateH, tw + 8);
    if (x + plateW > atlasW - 4) {
      x = 4;
      y += 24;
    }
    ctx.fillStyle = '#12100e';
    ctx.fillRect(x, y, plateW, plateH);
    ctx.fillStyle = names[i][2];
    ctx.fillText(names[i][0], x + 4, y + plateH * 0.55);
    plates.push(rect(x, y, plateW, plateH, atlasW, atlasH));
    x += plateW + 6;
  }
  const nameW = Math.ceil(ctx.measureText('Grave Warden').width) + 8;
  ctx.fillStyle = '#12100e';
  ctx.fillRect(4, 210, nameW, 16);
  ctx.fillStyle = '#e6dcc8';
  ctx.fillText('Grave Warden', 8, 218);
  const rects = {
    white: rect(0, 0, 4, 4, atlasW, atlasH),
    star: rect(8, 0, 32, 32, atlasW, atlasH),
    rare: rect(48, 0, 32, 32, atlasW, atlasH),
    epic: rect(88, 0, 32, 32, atlasW, atlasH),
    legendary: rect(128, 0, 32, 32, atlasW, atlasH),
    name: rect(4, 210, nameW, 16, atlasW, atlasH),
  };
  const iconFor = { rare: rects.rare, epic: rects.epic, legendary: rects.legendary };
  const colorFor = {
    rare: [0.494, 0.714, 1],
    epic: [0.816, 0.706, 1],
    legendary: [0.957, 0.969, 1],
  };
  const drops = [];
  for (let i = 0; i < names.length; i++) {
    const rarity = names[i][1];
    drops.push({
      x: 0,
      z: 0,
      plate: plates[i],
      icon: iconFor[rarity],
      color: colorFor[rarity],
      metrics: rarity === 'legendary'
        ? { beamW: 4, beamH: 80, plateH: 18, rainbow: 1 }
        : rarity === 'epic'
          ? { beamW: 3, beamH: 40, plateH: 12, rainbow: 0 }
          : { beamW: 2, beamH: 40, plateH: 12, rainbow: 0 },
    });
  }
  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return { rects, drops, texture };
}

function rect(x, y, w, h, atlasW, atlasH) {
  return {
    u: (x + 0.5) / atlasW,
    v: (y + 0.5) / atlasH,
    du: Math.max(1, w - 1) / atlasW,
    dv: Math.max(1, h - 1) / atlasH,
    w: w,
    h: h,
  };
}

function drawGem(ctx, x, y, color) {
  ctx.fillStyle = '#14120e';
  ctx.fillRect(x + 8, y + 4, 16, 24);
  ctx.fillStyle = color;
  ctx.fillRect(x + 12, y + 8, 8, 8);
  ctx.fillRect(x + 10, y + 16, 12, 6);
  ctx.fillStyle = '#f7f4ee';
  ctx.fillRect(x + 13, y + 9, 2, 2);
}

function drawStar(ctx, x, y, size) {
  ctx.fillStyle = '#ffffff';
  const m = size / 2;
  ctx.fillRect(x + m - 2, y + 2, 4, size - 4);
  ctx.fillRect(x + 2, y + m - 2, size - 4, 4);
  ctx.fillRect(x + 6, y + 6, 4, 4);
  ctx.fillRect(x + size - 10, y + 6, 4, 4);
  ctx.fillRect(x + 6, y + size - 10, 4, 4);
  ctx.fillRect(x + size - 10, y + size - 10, 4, 4);
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
  function joyAt(clientX, clientY) {
    const r = joy.getBoundingClientRect();
    let dx = (clientX - (r.left + r.width / 2)) / (r.width * 0.34);
    let dy = (clientY - (r.top + r.height / 2)) / (r.height * 0.34);
    const m = Math.hypot(dx, dy) || 1;
    if (m > 1) { dx /= m; dy /= m; }
    joyX = dx;
    joyY = dy;
    joyOn = true;
    knob.style.transform = 'translate(' + (dx * 22) + 'px,' + (dy * 22) + 'px)';
  }
  function joyEnd() {
    joyOn = false;
    joyX = 0;
    joyY = 0;
    knob.style.transform = 'none';
  }
  joy.addEventListener('pointerdown', (ev) => {
    joy.setPointerCapture(ev.pointerId);
    joyAt(ev.clientX, ev.clientY);
  });
  joy.addEventListener('pointermove', (ev) => {
    if (joyOn) joyAt(ev.clientX, ev.clientY);
  });
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);
}

function simTier() {
  return api.tier || 1;
}

wireUi();
boot();
