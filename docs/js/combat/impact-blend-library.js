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
// The knockdown asset is a losslessly-compressed runtime projection of the
// author's full editor export: it keeps every value sampled by
// impact-ragdoll-playback.js (time, body Y/quaternion, and both recorded leg
// chains) while omitting authoring-only diagnostics/events from game download.
(() => {
  "use strict";

  const BANK_ASSETS = {
    impact: {
      format: "editor-json",
      path: "animations/impact-blend-v3.json",
    },
    knockdown: {
      format: "runtime-gzip-base64-parts",
      parts: [
        "animations/knockdown-blend-v1.runtime.b64.0",
        "animations/knockdown-blend-v1.runtime.b64.1",
        "animations/knockdown-blend-v1.runtime.b64.2",
      ],
    },
  };
  const BANK_ALIASES = {
    breakThrow: "knockdown",
  };

  const banks = {}; // bankId -> { front, back, left, right } clip data
  let loadPromise = null;

  function resolveConfigBase() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.portrait?.configBase || "./config/";
  }

  function quaternionFromArray(values) {
    const q = Array.isArray(values) ? values : [];
    return {
      x: Number(q[0]) || 0,
      y: Number(q[1]) || 0,
      z: Number(q[2]) || 0,
      w: Number.isFinite(Number(q[3])) ? Number(q[3]) : 1,
    };
  }

  // Rebuild the minimum nested shape already consumed by
  // impact-ragdoll-playback.js. This is intentionally not a second animation
  // schema at runtime; once loaded, callers receive the same frame shape they
  // received from the full editor JSON.
  function expandRuntimeFrame(frame) {
    const leg = value => ({
      thighQuaternion: quaternionFromArray(value?.tq),
      calfLocalQuaternion: quaternionFromArray(value?.cq),
      upperLength: Number(value?.u) || 0,
      lowerLength: Number(value?.l) || 0,
    });
    return {
      t: Number(frame?.t) || 0,
      ragdoll: {
        body: {
          localPosition: { x: 0, y: Number(frame?.body?.y) || 0, z: 0 },
          localQuaternion: quaternionFromArray(frame?.body?.q),
        },
        ik: {
          left: leg(frame?.left),
          right: leg(frame?.right),
        },
      },
    };
  }

  async function fetchText(base, relativePath) {
    const url = new URL(base + relativePath, window.location.href).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${relativePath}`);
    return response.text();
  }

  async function readRuntimeParts(base, asset) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot decompress the authored knockdown asset.");
    }
    const encoded = (await Promise.all(asset.parts.map(path => fetchText(base, path)))).join("").replace(/\s+/g, "");
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json();
  }

  async function readAsset(base, asset) {
    if (asset.format === "runtime-gzip-base64-parts") return readRuntimeParts(base, asset);
    const url = new URL(base + asset.path, window.location.href).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${asset.path}`);
    return response.json();
  }

  function normalizedClip(data, direction, format) {
    if (format === "runtime-gzip-base64-parts") {
      const source = data?.clips?.[direction];
      if (!source || !Array.isArray(source.frames) || !source.frames.length) return null;
      return {
        durationSeconds: Number(source.durationSeconds) || 0,
        frames: source.frames.map(expandRuntimeFrame),
      };
    }
    const clip = data?.clips?.[direction]?.clip;
    if (!clip || !Array.isArray(clip.frames) || !clip.frames.length) return null;
    return {
      durationSeconds: Number(clip.durationSeconds) || 0,
      frames: clip.frames,
    };
  }

  async function loadBank(bankId, asset) {
    const base = String(resolveConfigBase()).replace(/\/?$/, "/");
    try {
      const data = await readAsset(base, asset);
      const clips = {};
      for (const direction of ["front", "back", "left", "right"]) {
        const clip = normalizedClip(data, direction, asset.format);
        if (clip) clips[direction] = clip;
      }
      banks[bankId] = clips;
    } catch (error) {
      console.warn(`[ImpactBlendLibrary] failed to load ${bankId}`, error);
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
