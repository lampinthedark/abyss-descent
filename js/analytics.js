/** Anonymous counts. Sends nothing until GOATCOUNTER_ENDPOINT is set. */
const Analytics = (() => {
  // GoatCounter count URL, for example https://yoursite.goatcounter.com/count
  // Leave this empty and the game never makes an analytics request.
  const GOATCOUNTER_ENDPOINT = '';
  const LAST_PLAYED_KEY = 'abyss-descent-last-played';

  let debug = false;
  try {
    debug = /(?:^|[?&])debug=1(?:&|$)/.test(location.search || '');
  } catch (e) { debug = false; }

  let sessionMs = 0;
  let lastTick = 0;
  let visible = true;
  let sessionSent = false;

  function privacyBlocked() {
    try {
      const dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      if (dnt === '1' || dnt === 'yes') return true;
      if (navigator.globalPrivacyControl === true) return true;
    } catch (e) {
      return true;
    }
    return false;
  }

  function event(name) {
    try {
      if (!name) return;
      if (debug) console.info('[analytics]', name);
      if (!GOATCOUNTER_ENDPOINT || privacyBlocked()) return;
      const base = String(GOATCOUNTER_ENDPOINT).replace(/\/$/, '');
      const q = 'p=' + encodeURIComponent(name)
        + '&t=' + encodeURIComponent(name)
        + '&e=true&rnd=' + Math.random();
      const url = base + (base.indexOf('?') >= 0 ? '&' : '?') + q;
      let sent = false;
      if (navigator.sendBeacon) {
        try { sent = navigator.sendBeacon(url); } catch (e) { sent = false; }
      }
      if (!sent) {
        const img = new Image();
        img.src = url;
      }
    } catch (e) { /* a failed count must not break the game */ }
  }

  function sessionBucket(ms) {
    const s = ms / 1000;
    if (s < 60) return 'session-under-1-min';
    if (s < 180) return 'session-1-3-min';
    if (s < 300) return 'session-3-5-min';
    if (s < 600) return 'session-5-10-min';
    if (s < 1200) return 'session-10-20-min';
    return 'session-20-plus-min';
  }

  function pump() {
    try {
      const now = Date.now();
      if (lastTick && visible) sessionMs += Math.max(0, now - lastTick);
      lastTick = now;
    } catch (e) {}
  }

  function endSession() {
    try {
      if (sessionSent) return;
      sessionSent = true;
      event(sessionBucket(sessionMs));
    } catch (e) {}
  }

  function onVisibility() {
    try {
      pump();
      visible = document.visibilityState !== 'hidden';
      lastTick = Date.now();
      if (!visible) endSession();
    } catch (e) {}
  }

  function onPageHide() {
    try {
      pump();
      visible = false;
      endSession();
    } catch (e) {}
  }

  function todayStamp() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function checkReturn() {
    try {
      const today = todayStamp();
      let prev = null;
      try { prev = localStorage.getItem(LAST_PLAYED_KEY); } catch (e) { prev = null; }
      if (prev && /^\d{4}-\d{2}-\d{2}$/.test(prev) && prev < today) event('returned');
      try { localStorage.setItem(LAST_PLAYED_KEY, today); } catch (e) {}
    } catch (e) {}
  }

  try {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
  } catch (e) {}
  checkReturn();

  function floorEventName(floor) {
    const n = Math.floor(Number(floor));
    if (!(n >= 1)) return '';
    if (n > 10) return 'floor-10-plus-entered';
    return 'floor-' + n + '-entered';
  }

  function floorEntered(floor) {
    const name = floorEventName(floor);
    if (name) event(name);
  }

  return { event, pump, floorEntered, floorEventName };
})();
