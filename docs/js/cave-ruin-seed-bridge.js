// Adapter between CaveSiteSystem's descriptive cave-history seeds and the
// existing DevRandomRuin generator, which intentionally accepts uint32 seeds.
// Keeping this at the boundary avoids teaching either reusable generator about
// the other's internal identity format.
(() => {
  'use strict';

  if (window.CaveRuinSeedBridge) return;

  const WRAP_MARKER = '__caveRuinSeedBridgeWrapped'; // Used on DevRandomRuin so hot reloads / alternate parser order never double-normalize a seed.

  function hashSeed(text) {
    let h = 2166136261 >>> 0; // Stable FNV-1a style uint32 used only to translate descriptive cave seeds into DevRandomRuin's numeric contract.
    for (const ch of String(text || '')) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
  }

  function normalizeSeed(seed) {
    if (typeof seed !== 'string' || !seed.endsWith(':ruin')) return seed;
    return hashSeed(seed);
  }

  function patch(api) {
    if (!api?.generate || api[WRAP_MARKER]) return false;
    const originalGenerate = api.generate.bind(api); // Existing random-ruin generator retained as the sole owner of generation, retries, transitions, and return anchors.
    api.generate = function caveRuinSeedAwareGenerate(seed, ...args) {
      return originalGenerate(normalizeSeed(seed), ...args);
    };
    Object.defineProperty(api, WRAP_MARKER, { configurable: true, value: true });
    return true;
  }

  function installFutureHook() {
    if (window.DevRandomRuin) return patch(window.DevRandomRuin);
    if (Object.prototype.hasOwnProperty.call(window, 'DevRandomRuin')) return false;
    let pendingApi = null; // Holds the future DevRandomRuin export until its normal script assigns the global later in parser order.
    Object.defineProperty(window, 'DevRandomRuin', {
      configurable: true,
      enumerable: true,
      get() { return pendingApi; },
      set(next) {
        pendingApi = next;
        patch(next);
      },
    });
    return true;
  }

  window.CaveRuinSeedBridge = Object.freeze({ hashSeed, normalizeSeed, patch });
  installFutureHook();
})();
