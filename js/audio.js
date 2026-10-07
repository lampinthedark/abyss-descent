/** Procedural audio. No binary assets. Safe if Web Audio is missing or blocked. */
const GameAudio = (() => {
  const KEY = 'abyss-descent-muted';
  const MASTER = 0.62;
  const MUSIC_BUS = 0.4;
  const SFX_BUS = 0.72;

  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let muted = false;
  let heldMute = false;
  let failed = false;
  let musicOn = false;
  let noiseBuf = null;

  function loadMute() {
    try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { muted = false; }
  }

  function storeMute() {
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function syncButtons() {
    const label = muted ? 'Muted' : 'Sound On';
    document.querySelectorAll('.js-mute').forEach(btn => {
      if (btn.dataset.compact === '1') btn.textContent = muted ? '🔇' : '🔊';
      else btn.textContent = (muted ? '🔇 ' : '🔊 ') + label;
      btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
      btn.title = muted ? 'Unmute (M)' : 'Mute (M)';
    });
  }

  function ensure() {
    if (failed) return false;
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { failed = true; return false; }
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = (muted || heldMute) ? 0 : MASTER;
      musicGain = ctx.createGain();
      musicGain.gain.value = MUSIC_BUS;
      sfxGain = ctx.createGain();
      sfxGain.gain.value = SFX_BUS;
      musicGain.connect(master);
      sfxGain.connect(master);
      try {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 18;
        comp.ratio.value = 3.2;
        comp.attack.value = 0.004;
        comp.release.value = 0.14;
        master.connect(comp);
        comp.connect(ctx.destination);
      } catch (e) {
        master.connect(ctx.destination);
      }
      return true;
    } catch (e) {
      failed = true;
      ctx = null;
      return false;
    }
  }

  function getNoise() {
    if (noiseBuf || !ctx) return noiseBuf;
    const len = Math.floor(ctx.sampleRate);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function startMusic() {
    if (!ctx || musicOn || !musicGain) return;
    try {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.65;
      filter.connect(musicGain);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 140;
      lfo.connect(lfoDepth);
      lfoDepth.connect(filter.frequency);
      lfo.start();

      // Dark fifths: A1, E2, A2, C3 — slow detuned pads.
      const layers = [
        { f: 55, type: 'sawtooth', g: 0.16 },
        { f: 82.41, type: 'triangle', g: 0.14 },
        { f: 110, type: 'triangle', g: 0.1 },
        { f: 130.81, type: 'sine', g: 0.08 },
      ];
      layers.forEach((layer, i) => {
        const o = ctx.createOscillator();
        o.type = layer.type;
        o.frequency.value = layer.f;
        o.detune.value = (i - 1.5) * 7;
        const g = ctx.createGain();
        g.gain.value = layer.g;
        o.connect(g);
        g.connect(filter);
        o.start();
      });

      const src = ctx.createBufferSource();
      src.buffer = getNoise();
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 140;
      bp.Q.value = 0.55;
      const ng = ctx.createGain();
      ng.gain.value = 0.045;
      src.connect(bp);
      bp.connect(ng);
      ng.connect(musicGain);
      src.start();

      const amp = ctx.createOscillator();
      amp.frequency.value = 0.05;
      const ampDepth = ctx.createGain();
      ampDepth.gain.value = 0.06;
      amp.connect(ampDepth);
      ampDepth.connect(musicGain.gain);
      amp.start();

      musicOn = true;
    } catch (e) {
      musicOn = false;
    }
  }

  function resume() {
    if (!ensure()) return;
    try {
      const pending = ctx.resume();
      if (pending && pending.catch) pending.catch(() => {});
    } catch (e) { /* ignore */ }
    if (!muted && !heldMute) startMusic();
  }

  function applyMaster() {
    if (!ctx || !master) return;
    const level = (muted || heldMute) ? 0 : MASTER;
    try {
      master.gain.setTargetAtTime(level, ctx.currentTime, 0.03);
    } catch (e) {
      master.gain.value = level;
    }
  }

  function setMuted(next) {
    muted = !!next;
    storeMute();
    syncButtons();
    applyMaster();
    if (!muted && !heldMute) resume();
  }

  /** Silence output without writing the saved mute preference. */
  function holdMute(on) {
    heldMute = !!on;
    applyMaster();
    if (!heldMute && !muted) resume();
  }

  function toggle() {
    setMuted(!muted);
  }

  function blip(freq, dur, type, peak, slideTo, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(40, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, peak), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, dur));
    o.connect(g);
    g.connect(sfxGain);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function noise(dur, peak, filterType, freq, q, delay) {
    const t = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const f = ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(Math.max(60, freq || 800), t);
    f.Q.value = q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, peak), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.03, dur));
    src.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  function sfx(name) {
    try {
      if (muted || heldMute || failed) return;
      if (!ensure()) return;
      if (ctx.state === 'suspended') {
        const pending = ctx.resume();
        if (pending && pending.catch) pending.catch(() => {});
      }
      switch (name) {
        case 'swing':
          noise(0.09, 0.16, 'highpass', 900, 0.4);
          blip(210, 0.11, 'sawtooth', 0.07, 70);
          break;
        case 'cast':
          blip(320, 0.16, 'sine', 0.08, 640);
          blip(480, 0.18, 'triangle', 0.05, 860, 0.02);
          noise(0.12, 0.06, 'bandpass', 1400, 0.8);
          break;
        case 'hit':
          noise(0.07, 0.22, 'lowpass', 900, 0.6);
          blip(160, 0.09, 'square', 0.08, 55);
          break;
        case 'crit':
          noise(0.09, 0.26, 'lowpass', 1400, 0.5);
          blip(220, 0.1, 'square', 0.1, 70);
          blip(880, 0.12, 'sine', 0.07, 1320, 0.01);
          break;
        case 'hurt':
          noise(0.14, 0.24, 'lowpass', 500, 0.5);
          blip(110, 0.18, 'sawtooth', 0.12, 42);
          break;
        case 'death':
          noise(0.28, 0.2, 'lowpass', 700, 0.4);
          blip(240, 0.32, 'triangle', 0.1, 48);
          break;
        case 'defeat':
          blip(196, 0.4, 'sawtooth', 0.1, 49);
          blip(155, 0.5, 'triangle', 0.08, 40, 0.08);
          noise(0.45, 0.12, 'lowpass', 400, 0.4);
          break;
        case 'loot':
          blip(660, 0.08, 'sine', 0.07, 880);
          blip(990, 0.12, 'sine', 0.06, 1320, 0.06);
          break;
        case 'lootRare':
          blip(523, 0.1, 'triangle', 0.07);
          blip(659, 0.12, 'sine', 0.07, 784, 0.07);
          blip(1046, 0.16, 'sine', 0.06, 1318, 0.14);
          break;
        case 'level':
          blip(392, 0.1, 'triangle', 0.08);
          blip(523, 0.1, 'triangle', 0.08, 523, 0.09);
          blip(659, 0.12, 'sine', 0.08, 659, 0.18);
          blip(784, 0.2, 'sine', 0.09, 988, 0.28);
          break;
        case 'clear':
          blip(349, 0.14, 'sine', 0.06);
          blip(440, 0.18, 'sine', 0.06, 523, 0.1);
          break;
        case 'portal':
          noise(0.4, 0.1, 'bandpass', 500, 0.6);
          blip(180, 0.42, 'sine', 0.08, 620);
          blip(270, 0.42, 'triangle', 0.05, 900, 0.05);
          break;
        case 'talk':
          blip(210, 0.1, 'sine', 0.05, 170);
          blip(320, 0.12, 'sine', 0.04, 260, 0.07);
          break;
        case 'ui':
        default:
          blip(720, 0.04, 'square', 0.045);
          noise(0.025, 0.04, 'highpass', 1600, 0.4);
          break;
      }
    } catch (e) {
      /* Audio must never block combat. */
    }
  }

  function install() {
    loadMute();
    syncButtons();
    const prime = () => resume();
    window.addEventListener('pointerdown', prime, { passive: true });
    window.addEventListener('touchstart', prime, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if ((e.key || '').toLowerCase() === 'm') {
        e.preventDefault();
        const wasMuted = muted;
        setMuted(!muted);
        resume();
        if (wasMuted) sfx('ui');
        return;
      }
      prime();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.js-mute')) return;
      if (t.closest('button, .class-card, .item-row, .skill-node, .equip-slot')) sfx('ui');
    }, true);
    document.querySelectorAll('.js-mute').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wasMuted = muted;
        setMuted(!muted);
        resume();
        if (wasMuted) sfx('ui');
      });
    });
  }

  try { install(); } catch (e) { failed = true; }

  return {
    sfx,
    resume,
    toggle,
    setMuted,
    isMuted: () => muted,
    holdMute,
    isHeld: () => heldMute,
    syncButtons,
  };
})();
