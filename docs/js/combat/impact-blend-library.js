// Impact blend-clip library — loads authored 4-directional ragdoll blend
// spaces exported by docs/tools/procedural-animation-editor/index.html
// (schema hobunji-impact-ragdoll-blend-space.v1) and hands clips to
// impact-ragdoll-playback.js by bank + hit direction. Shaped like
// docs/js/portrait-breathing.js's own load()/getAnimData() (fetch-once,
// cache, synchronous reads afterward) since that's this repo's existing
// precedent for fetched animation data.
//
// 'impact' bank = docs/config/animations/impact-blend-v3.json (ordinary
// staggering hit reaction — see game.js's damagePlayer/damageCreature).
// 'knockdown' bank = the authored zero-Footing knockdown supplied from the
// Procedural Animation editor. The historical 'breakThrow' bank remains an
// alias so existing game.js call sites automatically use the new default.
//
// Usage:
//   await ImpactBlendLibrary.load()
//   ImpactBlendLibrary.getClip('impact', 'front') -> { durationSeconds, frames } | null
(() => {
  "use strict";

  // Relative to the config/ directory (see resolveConfigBase) — mirrors
  // portrait-breathing.js's own 'animations/breathing-default.json' path.
  const BANK_ASSETS = {
    impact: { path: "animations/impact-blend-v3.json", gzip: false },
    knockdown: { path: "animations/knockdown-blend-v1.json.gz", gzip: true },
  };
  const BANK_ALIASES = {
    breakThrow: 'knockdown',
  };

  const banks = {}; // bankId -> { front, back, left, right } clip data
  let loadPromise = null;

  function resolveConfigBase() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.portrait?.configBase || "./config/";
  }

  async function readJsonResponse(resp, gzip) {
    if (!gzip) return resp.json();
    if (typeof DecompressionStream !== 'function' || !resp.body) {
      throw new Error('This browser cannot decompress the authored knockdown asset.');
    }
    const stream = resp.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json();
  }

  async function loadBank(bankId, asset) {
    const base = String(resolveConfigBase()).replace(/\/?$/, "/");
    const url = new URL(base + asset.path, window.location.href).toString();
    try {
      const resp = await fetch(url);
      if (!resp.ok) { console.warn(`[ImpactBlendLibrary] ${bankId} not found:`, url); return; }
      const data = await readJsonResponse(resp, asset.gzip);
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
      loadPromise = Promise.all(Object.entries(BANK_ASSETS).map(([bankId, asset]) => loadBank(bankId, asset)));
    }
    return loadPromise;
  }

  function canonicalBank(bankId) {
    return BANK_ALIASES[bankId] || bankId;
  }

  function getClip(bankId, direction) {
    return banks[canonicalBank(bankId)]?.[direction] || null;
  }

  function isLoaded(bankId = null) {
    if (bankId) return !!banks[canonicalBank(bankId)];
    return Object.keys(banks).length > 0;
  }

  window.ImpactBlendLibrary = { load, getClip, isLoaded, canonicalBank };

  // Auto-load on script evaluation, same convention as portrait-breathing.js's
  // own _autoInitBreathingComposer — callers (impact-ragdoll-playback.js) just
  // read getClip()/isLoaded() without needing to remember to kick off a fetch
  // from game.js's boot sequence.
  load();
})();
