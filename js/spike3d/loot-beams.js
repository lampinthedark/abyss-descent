// One table for ground-loot beams. Heights are CSS pixels.
// 1 art px is 0.875 CSS px at a 60 CSS px hero, and scales with the hero
// size. A 1 px core, edge, gap, or material ring is 1 CSS px.

export const LOOT_BEAMS = {
  artPxAtHero60: 0.875,
  minBodyAlpha: 0.85,
  edge: { css: 1, color: '#14120f', alpha: 0.7 },
  kinds: {
    normal: {
      beam: null,
      name: '#b9b4aa',
      plate: '#12100e',
      border: '#6e6a64',
    },
    rare: {
      beam: 'single',
      heightCss: 72,
      bodyArt: 2,
      body: '#4c7cff',
      bodyAlpha: 0.9,
      core: { css: 1, color: '#ffffff', alpha: 1 },
      name: '#4c7cff',
      plate: '#12100e',
      border: '#4c7cff',
    },
    veryrare: {
      beam: 'single',
      heightCss: 96,
      bodyArt: 3,
      body: '#b48cff',
      bodyAlpha: 0.9,
      core: { css: 1, color: '#ffffff', alpha: 1 },
      name: '#b48cff',
      plate: '#12100e',
      border: '#b48cff',
    },
    material: {
      beam: null,
      name: '#5ed37a',
      plate: '#12100e',
      border: '#5ed37a',
      ring: { css: 1, color: '#5ed37a', diameter: 22 },
      badge: 12,
    },
    legendary: {
      beam: 'double',
      heightCss: 144,
      bodyArt: 2,
      body: '#ffb43c',
      bodyAlpha: 1,
      inner: { css: 1, color: '#ffd27a', alpha: 1 },
      name: '#ffb43c',
      plate: '#12100e',
      plateBands: ['#ffd27a', '#ffb43c', '#fff4d6'],
    },
    chase: {
      beam: 'single',
      offTop: true,
      bodyArt: 6,
      body: '#ffb43c',
      bodyAlpha: 1,
      inner: { css: 1, color: '#ffd27a', alpha: 1 },
      name: '#ffb43c',
      plate: '#12100e',
      plateBands: ['#ffd27a', '#ffb43c', '#fff4d6'],
      flash: { alpha: 0.6, reduced: 'ring' },
    },
  },
};

export function cssPerArtPx(heroCss) {
  return LOOT_BEAMS.artPxAtHero60 * (heroCss / 60);
}

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function artStrip(art, color, alpha, heroCss) {
  return {
    css: art * cssPerArtPx(heroCss),
    color: color,
    alpha: alpha,
    background: rgba(color, alpha),
  };
}

function cssStrip(spec) {
  return {
    css: spec.css,
    color: spec.color,
    alpha: spec.alpha,
    background: rgba(spec.color, spec.alpha),
  };
}

export function beamSpec(kind) {
  return LOOT_BEAMS.kinds[kind] || null;
}

// Left-to-right strips. Legendary is the only double beam: two bodyArt
// columns whose 1 px dark edges touch, leaving a 2 px dark gap.
export function beamStrips(kind, heroCss) {
  const spec = beamSpec(kind);
  if (!spec || !spec.beam) return [];
  const edge = cssStrip(LOOT_BEAMS.edge);
  const alpha = Math.max(LOOT_BEAMS.minBodyAlpha, spec.bodyAlpha || 1);
  const body = artStrip(spec.bodyArt, spec.body, alpha, heroCss);
  if (spec.beam === 'double') {
    const inner = cssStrip(spec.inner);
    return [edge, body, inner, edge, edge, inner, body, edge];
  }
  if (spec.core) {
    const half = artStrip(spec.bodyArt / 2, spec.body, alpha, heroCss);
    return [edge, half, cssStrip(spec.core), half, edge];
  }
  const inner = cssStrip(spec.inner);
  return [edge, inner, body, inner, edge];
}

export function beamHeightCss(kind, anchorY) {
  const spec = beamSpec(kind);
  if (!spec || !spec.beam) return 0;
  if (spec.offTop) return Math.max(0, anchorY + 24);
  return spec.heightCss;
}

export function plateShadow(kind) {
  const spec = beamSpec(kind);
  if (!spec || !spec.plateBands) return '';
  const bands = spec.plateBands;
  const n = bands.length;
  const parts = [];
  for (let i = 0; i < n; i++) parts.push('0 0 0 ' + (n - i) + 'px ' + bands[i]);
  return parts.join(', ');
}
