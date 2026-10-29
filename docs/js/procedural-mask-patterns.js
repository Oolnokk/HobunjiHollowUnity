// Procedural patterns for masks. A mask whose cosmetic config declares `proceduralPatterns` (the Hachutu Binding Mask) gets a woven
// pattern stack generated per wearer instead of a plain wooden face:
//
//   layer 1 (primary)  one of the existing Hachutu glyph patterns, with its FRAME randomized: a random rotation, a random downward
//                      scale (down to 25% of the authored frame) and a slight translation of the crop window;
//   layer 2 (overpass) another glyph pattern randomized by exactly the same method, drawn over the first;
//   each layer is painted in its own random iridescent (oil-slick) colour, different from the other layer and from the eyes.
//
// The result is the ordinary `weaving` shape the garment compositor (ClothingWeavingSystem) already renders, so masks take the same
// primary + overpass patterns clothing does. Generation is deterministic per seed (a wearer keeps its mask), random across wearers.
(function (global) {
  'use strict';

  const ROOT = (() => {
    try {
      const src = document.currentScript?.src;
      if (src) return new URL('../', src).href; // docs/ — this file lives in docs/js/.
    } catch (_) { /* fall through */ }
    return new URL('./', document.baseURI).href;
  })();
  const MASK_CONFIG_PATH = 'config/cosmetics/clothes/masks/hachutu_binding_mask_ii.json';
  const MASK_ID = 'hachutu_binding_mask_ii';
  const PATTERN_INDEX_PATH = 'config/patterns/index.json';
  const FALLBACK_MOTIF_SIZE = 230; // Hachutu glyph motifs are 230x230; used for the translation scale before an image reports its own.

  let config = null; // mask.proceduralPatterns once loaded
  let maskPixelDye = null; // the mask's pixelDye block (for the eye colour, so patterns never share it)
  let library = []; // pattern defs loaded from config/patterns
  const motifSizes = new Map();

  const url = relative => new URL(relative, ROOT).href;
  const getJson = async relative => {
    const response = await fetch(url(relative));
    if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`);
    return response.json();
  };

  function loadMotifSize(motifUrl) {
    if (motifSizes.has(motifUrl)) return motifSizes.get(motifUrl);
    const fallback = { w: FALLBACK_MOTIF_SIZE, h: FALLBACK_MOTIF_SIZE };
    motifSizes.set(motifUrl, fallback);
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => { const size = { w: image.naturalWidth || fallback.w, h: image.naturalHeight || fallback.h }; motifSizes.set(motifUrl, size); resolve(size); };
      image.onerror = () => resolve(fallback);
      image.src = motifUrl;
    });
  }

  // pattern JSON ("hobunji_pattern.v1") -> the pattern definition object the compositor consumes.
  function definitionFromPatternFile(file) {
    if (!file?.motifPng || !file.settings) return null;
    return { id: file.id, name: file.name, motifUrl: file.motifPng, ...file.settings };
  }

  const ready = (async () => {
    try {
      const mask = await getJson(MASK_CONFIG_PATH);
      config = mask.proceduralPatterns?.enabled === false ? null : (mask.proceduralPatterns || null);
      const findPixelDye = node => {
        if (!node || typeof node !== 'object') return null;
        if (node.pixelDye) return node.pixelDye;
        for (const value of Object.values(node)) { const found = findPixelDye(value); if (found) return found; }
        return null;
      };
      maskPixelDye = findPixelDye(mask);
      if (!config) return false;
      const index = await getJson(PATTERN_INDEX_PATH);
      const entries = (index.patterns || []).filter(entry => String(entry.id).startsWith(config.patternIdPrefix || 'hachutu_glyph'));
      const files = await Promise.all(entries.map(entry => getJson(entry.file).catch(() => null)));
      library = files.map(definitionFromPatternFile).filter(Boolean);
      await Promise.all(library.map(def => loadMotifSize(def.motifUrl.startsWith('http') ? def.motifUrl : url(def.motifUrl))));
      return library.length > 0;
    } catch (error) {
      console.warn('[ProceduralMaskPatterns] could not load the mask pattern config; masks stay plain:', error);
      config = null;
      return false;
    }
  })();

  function hashSeed(seed) {
    let h = 2166136261;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const lerp = (a, b, t) => a + (b - a) * t;

  // One randomized layer: a glyph pattern with a randomly rotated, downscaled, slightly translated frame and its own ink colour.
  function randomizedLayer(rng, settings, taken) {
    const base = library[Math.floor(rng() * library.length)];
    const size = motifSizes.get(base.motifUrl.startsWith('http') ? base.motifUrl : url(base.motifUrl)) || { w: FALLBACK_MOTIF_SIZE, h: FALLBACK_MOTIF_SIZE };
    const frameScaleMin = Math.max(0.05, Number(settings.frameScaleMin) || 0.25);
    const frameScaleMax = Math.max(frameScaleMin, Number(settings.frameScaleMax) || 1);
    const translate = Math.max(0, Number(settings.frameTranslateFraction) || 0.08);
    const authoredScale = Math.max(0.05, Number(base.frameScale) || 1);
    const pool = (Array.isArray(settings.inkColors) ? settings.inkColors : []).filter(hex => /^#[0-9a-f]{6}$/i.test(hex));
    const free = pool.filter(hex => !taken.some(other => other && other.toLowerCase() === hex.toLowerCase()));
    const inkPool = free.length ? free : pool;
    const layer = {
      ...base,
      motifUrl: base.motifUrl,
      frameRotationDeg: Math.round(rng() * 3600) / 10, // 0..360
      frameScale: Number((authoredScale * lerp(frameScaleMin, frameScaleMax, rng())).toFixed(4)), // Only ever scaled DOWN from the authored frame, to as little as the minimum.
      frameX: Math.round((rng() * 2 - 1) * translate * size.w),
      frameY: Math.round((rng() * 2 - 1) * translate * size.h),
      inkColorHex: inkPool.length ? inkPool[Math.floor(rng() * inkPool.length)] : undefined,
    };
    delete layer.id; delete layer.name;
    layer.sourcePatternId = base.id; // Provenance only; the compositor ignores it.
    return layer;
  }

  // Deterministic per seed. Returns the weaving object ({ patterns: [primary, overpass] }) or null when disabled / not loaded yet.
  // eyeHex (optional) is kept out of the ink palette so the patterns never match the glowing eyes.
  function weavingFor(seed, { eyeHex = null } = {}) {
    if (!config || !library.length) return null;
    const rng = mulberry32(hashSeed(String(seed) + '|mask-pattern'));
    const layers = Math.max(1, Math.min(2, Math.round(Number(config.layers) || 2)));
    const taken = [eyeHex];
    const patterns = [];
    for (let i = 0; i < layers; i++) {
      const layer = randomizedLayer(rng, config, taken);
      taken.push(layer.inkColorHex);
      patterns.push(layer);
    }
    return { patterns };
  }

  // The worn-item descriptor the portrait compositor reads from bodyColors.__hobunjiWovenClothing.
  function descriptorFor(maskId, seed, options = {}) {
    if (maskId !== MASK_ID) return null;
    const eyeHex = options.eyeHex ?? (maskPixelDye && global.pixelDyeDefaultHex ? global.pixelDyeDefaultHex(maskPixelDye, seed, 'MASK_C') : null);
    const weaving = weavingFor(seed, { eyeHex });
    if (!weaving) return null;
    return { uid: 'procedural_mask_' + hashSeed(seed).toString(36), slot: 'mask', baseCosmeticId: maskId, weaving, colorA: null, colorB: null, colorC: null };
  }

  global.ProceduralMaskPatterns = {
    maskId: MASK_ID,
    ready,
    get enabled() { return !!config && library.length > 0; },
    get library() { return library.map(def => def.id); },
    weavingFor,
    descriptorFor,
  };
})(window);
