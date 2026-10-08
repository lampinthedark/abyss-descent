/**
 * Ad hooks. Without ?adtest=1 each offer returns "unavailable" and shows nothing.
 * The test switch shows a labelled placeholder and never plays an ad or contacts a network.
 */
const Ads = (() => {
  let adtest = false;
  try {
    adtest = /(?:^|[?&])adtest=1(?:&|$)/.test(location.search || '');
  } catch (e) { adtest = false; }

  const LABELS = {
    revive: 'TEST AD: Revive',
    reroll: 'TEST AD: Reroll',
    gold: 'TEST AD: Double gold',
  };

  let combatFn = function () { return false; };
  const queue = [];
  let showing = null;
  let flushQueue = true;
  let resultFn = null;

  function inCombat() {
    try { return !!combatFn(); } catch (e) { return false; }
  }

  function setCombat(fn) {
    if (typeof fn === 'function') combatFn = fn;
  }

  function heldEl() {
    return document.getElementById('adtest-held');
  }

  function promptEl() {
    return document.getElementById('adtest-prompt');
  }

  function setHeld(on) {
    const el = heldEl();
    if (!el) return;
    el.textContent = 'held: in combat';
    el.classList.toggle('hidden', !on);
  }

  function hidePrompt() {
    const el = promptEl();
    if (!el) return;
    el.classList.add('hidden');
  }

  function showPrompt(kind) {
    const el = promptEl();
    if (!el) return;
    const label = el.querySelector('[data-ad-label]');
    if (label) label.textContent = LABELS[kind] || 'TEST AD';
    el.classList.remove('hidden');
  }

  function offer(kind) {
    if (!adtest) return 'unavailable';
    if (inCombat()) {
      queue.push(kind);
      setHeld(true);
      return 'held';
    }
    if (showing) {
      queue.push(kind);
      return 'queued';
    }
    showing = kind;
    setHeld(false);
    showPrompt(kind);
    return 'shown';
  }

  function closePrompt(reason) {
    const kind = showing;
    showing = null;
    hidePrompt();
    try { if (resultFn && kind) resultFn(kind, reason || 'dismiss'); } catch (e) {}
    if (inCombat() || !flushQueue) {
      setHeld(queue.length > 0);
      return;
    }
    if (queue.length) {
      showing = queue.shift();
      setHeld(false);
      showPrompt(showing);
      return;
    }
    setHeld(false);
  }

  function tick() {
    if (!adtest) return;
    if (showing && inCombat()) {
      queue.unshift(showing);
      showing = null;
      hidePrompt();
      setHeld(true);
      return;
    }
    if (showing) return;
    if (!queue.length) {
      setHeld(false);
      return;
    }
    if (inCombat()) {
      setHeld(true);
      return;
    }
    showing = queue.shift();
    setHeld(false);
    showPrompt(showing);
  }

  function bind() {
    const panel = document.getElementById('adtest-panel');
    if (panel) panel.classList.toggle('hidden', !adtest);
    if (!adtest) return;
    if (panel) {
      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ad-offer]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        offer(btn.getAttribute('data-ad-offer'));
      });
    }
    const prompt = promptEl();
    if (!prompt) return;
    prompt.addEventListener('click', (e) => {
      const accepted = e.target.closest('[data-ad-accept]');
      if (accepted || e.target.closest('[data-ad-dismiss]')) {
        e.preventDefault();
        e.stopPropagation();
        closePrompt(accepted ? 'accept' : 'dismiss');
      }
    });
  }

  try { bind(); } catch (e) {}

  return {
    offerRevive() { try { return offer('revive'); } catch (e) { return 'unavailable'; } },
    offerReroll() { try { return offer('reroll'); } catch (e) { return 'unavailable'; } },
    offerDoubleGold() { try { return offer('gold'); } catch (e) { return 'unavailable'; } },
    setCombat,
    setFlush(on) { flushQueue = on !== false; },
    onResult(fn) { resultFn = typeof fn === 'function' ? fn : null; },
    tick() { try { tick(); } catch (e) {} },
  };
})();
