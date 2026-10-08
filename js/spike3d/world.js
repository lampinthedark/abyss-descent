import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  ShaderMaterial,
} from 'three';

const CELLS = 64;
const ORIGIN = -32;
const STEP = 64 / CELLS;
const VERTE = CELLS + 1;

function rawHeight(x, z) {
  let h = Math.sin(x * 0.15) * Math.cos(z * 0.13) * 0.32;
  h += Math.sin((x + z * 0.6) * 0.41) * 0.1;
  if (x > 9 && x < 24 && z > -7 && z < 7) return 0.06;
  return h;
}

const heights = new Float32Array(VERTE * VERTE);
for (let iz = 0; iz < VERTE; iz++) {
  for (let ix = 0; ix < VERTE; ix++) {
    heights[iz * VERTE + ix] = rawHeight(ORIGIN + ix * STEP, ORIGIN + iz * STEP);
  }
}

export function groundKind(x, z) {
  if (dungeon(x, z)) return 'dungeon';
  if (sand(x, z)) return 'sand';
  return 'grass';
}

export function heightAt(x, z) {
  let fx = (x - ORIGIN) / STEP;
  let fz = (z - ORIGIN) / STEP;
  if (fx < 0) fx = 0;
  if (fz < 0) fz = 0;
  if (fx > CELLS - 0.001) fx = CELLS - 0.001;
  if (fz > CELLS - 0.001) fz = CELLS - 0.001;
  const ix = fx | 0;
  const iz = fz | 0;
  const tx = fx - ix;
  const tz = fz - iz;
  const i00 = iz * VERTE + ix;
  const h00 = heights[i00];
  const h10 = heights[i00 + 1];
  const h01 = heights[i00 + VERTE];
  const h11 = heights[i00 + VERTE + 1];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

function sand(x, z) {
  const pz = Math.sin(x * 0.16) * 5;
  return Math.abs(z - pz) < 1.85;
}

function dungeon(x, z) {
  return x > 9 && x < 24 && z > -7 && z < 7;
}

function grassColor(ix, iz) {
  return ((ix * 3 + iz * 5) & 3) === 0 ? [0.235, 0.275, 0.141] : [0.290, 0.329, 0.173];
}

function sandColor(ix, iz) {
  return ((ix + iz) & 1) === 0 ? [0.949, 0.894, 0.753] : [0.906, 0.831, 0.643];
}

export const OBSTACLES = [];

function addBox(pos, nrm, col, cx, cy, cz, sx, sy, sz, r, g, b) {
  const x0 = cx - sx, x1 = cx + sx, y0 = cy - sy, y1 = cy + sy, z0 = cz - sz, z1 = cz + sz;
  const faces = [
    [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
    [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0],
    [x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0],
    [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1],
    [x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1],
    [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0],
  ];
  for (let f = 0; f < faces.length; f++) {
    const p = faces[f];
    tri(pos, nrm, col, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], r, g, b);
    tri(pos, nrm, col, p[0], p[1], p[2], p[6], p[7], p[8], p[9], p[10], p[11], r, g, b);
  }
}

function tri(pos, nrm, col, ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b) {
  let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  if (ny < 0) {
    nx = -nx; ny = -ny; nz = -nz;
    pos.push(ax, ay, az, cx, cy, cz, bx, by, bz);
  } else {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  }
  nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  col.push(r, g, b, r, g, b, r, g, b);
}

export function buildWorld() {
  const pos = [];
  const nrm = [];
  const col = [];
  for (let iz = 0; iz < CELLS; iz++) {
    for (let ix = 0; ix < CELLS; ix++) {
      const x0 = ORIGIN + ix * STEP;
      const z0 = ORIGIN + iz * STEP;
      const x1 = x0 + STEP;
      const z1 = z0 + STEP;
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      let rgb;
      if (dungeon(mx, mz)) rgb = ((ix + iz) & 1) === 0 ? [0.486, 0.525, 0.561] : [0.400, 0.439, 0.471];
      else if (sand(mx, mz)) rgb = sandColor(ix, iz);
      else rgb = grassColor(ix, iz);
      const y00 = heights[iz * VERTE + ix];
      const y10 = heights[iz * VERTE + ix + 1];
      const y01 = heights[(iz + 1) * VERTE + ix];
      const y11 = heights[(iz + 1) * VERTE + ix + 1];
      tri(pos, nrm, col, x0, y00, z0, x1, y10, z0, x1, y11, z1, rgb[0], rgb[1], rgb[2]);
      tri(pos, nrm, col, x0, y00, z0, x1, y11, z1, x0, y01, z1, rgb[0], rgb[1], rgb[2]);
    }
  }

  const wallH = 1.15;
  const segs = [
    [9.4, 0.6, -7, 0.35, wallH, 0.35],
    [9.4, 0.6, -4.2, 0.35, wallH, 2.2],
    [9.4, 0.6, 4.2, 0.35, wallH, 2.2],
    [9.4, 0.6, 7, 0.35, wallH, 0.35],
    [24, 0.6, 0, 0.35, wallH, 7.2],
    [16.5, 0.6, -7, 7, wallH, 0.35],
    [16.5, 0.6, 7, 7, wallH, 0.35],
  ];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    addBox(pos, nrm, col, s[0], s[1], s[2], s[3], s[4], s[5], 0.42, 0.40, 0.38);
    OBSTACLES.push({ minx: s[0] - s[3], maxx: s[0] + s[3], minz: s[2] - s[5], maxz: s[2] + s[5] });
  }
  const rocks = [
    [-6, 0.28, -5, 0.55, 0.28, 0.4],
    [-8, 0.22, 3, 0.4, 0.22, 0.35],
    [4, 0.35, -8, 0.7, 0.35, 0.45],
    [-3, 0.2, 8, 0.45, 0.2, 0.3],
    [6, 0.3, 10, 0.5, 0.3, 0.4],
  ];
  for (let i = 0; i < rocks.length; i++) {
    const s = rocks[i];
    const y = heightAt(s[0], s[2]) + s[4];
    addBox(pos, nrm, col, s[0], y, s[2], s[3], s[4], s[5], 0.45, 0.43, 0.40);
    OBSTACLES.push({ minx: s[0] - s[3], maxx: s[0] + s[3], minz: s[2] - s[5], maxz: s[2] + s[5] });
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  const torchValue = { x: 0, y: 3.2, z: 0 };
  const mat = new ShaderMaterial({
    uniforms: { uTorch: { value: torchValue } },
    vertexShader: `
      attribute vec3 color;
      varying vec3 vColor;
      varying vec3 vWorld;
      void main() {
        vColor = color;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform vec3 uTorch;
      varying vec3 vColor;
      varying vec3 vWorld;
      void main() {
        vec3 to = uTorch - vWorld;
        float d2 = dot(to, to);
        float lamp = 1.0 / (1.0 + d2 * 0.045);
        vec3 col = vColor * (0.92 + lamp * 0.22) + vec3(1.0, 0.62, 0.28) * lamp * 0.05;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  const torch = {
    position: {
      set(x, y, z) {
        torchValue.x = x;
        torchValue.y = y;
        torchValue.z = z;
      },
    },
  };
  return { mesh, torch };
}
