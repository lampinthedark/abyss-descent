/* Capacitor only. Loaded after the game scripts in the www/ copy.
   Unlocks the existing Web Audio graph on the first tap, and applies
   safe-area insets pushed by the native shell (window.__abyssApplyInsets). */
(function () {
  function primeAudio() {
    try {
      // audio.js binds GameAudio with const, so it is in the page scope and not on window.
      if (typeof GameAudio !== 'undefined' && GameAudio && typeof GameAudio.resume === 'function') {
        GameAudio.resume();
      }
    } catch (e) { /* sound must never block play */ }
  }

  window.addEventListener('pointerdown', primeAudio, { capture: true, passive: true });
  window.addEventListener('touchstart', primeAudio, { capture: true, passive: true });
  window.addEventListener('touchend', primeAudio, { capture: true, passive: true });

  document.addEventListener('resume', primeAudio, false);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') primeAudio();
  });

  window.__abyssApplyInsets = function (insets) {
    if (!insets) return;
    var root = document.documentElement;
    ['top', 'right', 'bottom', 'left'].forEach(function (side) {
      var value = insets[side];
      if (typeof value === 'number' && value >= 0 && value < 200) {
        root.style.setProperty('--safe-' + side, value + 'px');
      }
    });
  };

  function lockPageScroll() {
    var root = document.documentElement;
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    if (document.body) {
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
    }
  }

  lockPageScroll();
  document.addEventListener('DOMContentLoaded', lockPageScroll);
})();
