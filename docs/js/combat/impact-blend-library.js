// Impact blend-clip library — loads the two authored 4-directional ragdoll
// blend spaces exported by docs/tools/procedural-animation-editor/index.html
// (schema hobunji-impact-ragdoll-blend-space.v1) and hands clips to
// impact-ragdoll-playback.js by bank + hit direction. Shaped like
// docs/js/portrait-breathing.js's own load()/getAnimData() (fetch-once,
// cache, synchronous reads afterward) since that's this repo's existing
// precedent for a fetched animation-data asset.
//
// 'impact' bank = docs/config/animations/impact-blend-v3.json (ordinary
// staggering hit reaction — see game.js's damagePlayer/damageCreature).
// 'breakThrow' bank = docs/config/animations/spinthrow-blend-v1.json (the
// zero-Footing full-knockdown throw; its authored tail is already a settled
// prone pose, which impact-ragdoll-playback.js's update() holds on
// (playback.holding) as the 'stun' phase instead of needing a fifth
// authored clip).
//
// Usage:
//   await ImpactBlendLibrary.load()
//   ImpactBlendLibrary.getClip('impact', 'front') -> { durationSeconds, frames } | null
(() => {
  "use strict";

  // Relative to the config/ directory (see resolveConfigBase) — mirrors
  // portrait-breathing.js's own 'animations/breathing-default.json' path.
  const BANK_ASSETS = {
    impact: "animations/impact-blend-v3.json",
    breakThrow: "animations/spinthrow-blend-v1.json",
  };

  const banks = {}; // bankId -> { front, back, left, right } clip data
  let loadPromise = null;

  function resolveConfigBase() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.portrait?.configBase || "./config/";
  }

  async function loadBank(bankId, relativePath) {
    const base = String(resolveConfigBase()).replace(/\/?$/, "/");
    const url = new URL(base + relativePath, window.location.href).toString();
    try {
      const resp = await fetch(url);
      if (!resp.ok) { console.warn(`[ImpactBlendLibrary] ${bankId} not found:`, url); return; }
      const data = await resp.json();
      const clips = {};
      for (const direction of ["front", "back", "left", "right"]) {
        const clip = data?.clips?.[direction]?.clip;
        if (clip && Array.isArray(clip.frames) && clip.frames.length) {
          clips[direction] = { durationSeconds: Number(clip.durationSeconds) || 0, frames: clip.frames };
        }
      }
      banks[bankId] = clips;
    } catch (e) {
      console.warn(`[ImpactBlendLibrary] failed to load ${bankId}`, e);
    }
  }

  function load() {
    if (!loadPromise) {
      loadPromise = Promise.all(Object.entries(BANK_ASSETS).map(([bankId, path]) => loadBank(bankId, path)));
    }
    return loadPromise;
  }

  function getClip(bankId, direction) {
    return banks[bankId]?.[direction] || null;
  }

  function isLoaded() {
    return Object.keys(banks).length > 0;
  }

  window.ImpactBlendLibrary = { load, getClip, isLoaded };

  // Auto-load on script evaluation, same convention as portrait-breathing.js's
  // own _autoInitBreathingComposer — callers (impact-ragdoll-playback.js) just
  // read getClip()/isLoaded() without needing to remember to kick off a fetch
  // from game.js's boot sequence.
  load();
})();
