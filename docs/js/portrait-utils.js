// ============================================================
// PORTRAIT UTILS
// Shared portrait generation and rendering logic.
// Used by: character-tools.html, ScratchbonesBluffGame.html
//
// Setup (call before rendering):
//   setPortraitAssetBase('./assets/');          // character-tools (default)
//   setPortraitAssetBase('./docs/assets/');     // ScratchbonesBluffGame
// ============================================================

// ── Constants / Config ─────────────────────────────────────

// ── Xform Presets ──────────────────────────────────────────
// B: used for all portrait layers (head, ur-head overlays, body, and cosmetics)
// C/D: placeholder presets (identity)
const _XFORM_PRESET_DEFAULTS = {
  A: { ax: -0.2,    ay: 0,       sx: 2.55, sy: 2.55 },
  B: { ax: -0.0983, ay: -0.0809, sx: 2.49, sy: 2.49 },
  C: { ax: 0,       ay: 0,       sx: 1,    sy: 1    },
  D: { ax: 0,       ay: 0,       sx: 1,    sy: 1    },
};

/**
 * Returns the current normalized xform for a named preset (A/B/C/D).
 * Values are read live from SCRATCHBONES_CONFIG so the lobby panel can
 * update them and have all sprites re-render with the new values.
 */
function getPortraitXformPreset(name) {
  const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.xformPresets;
  const preset = (cfg && cfg[name]) || _XFORM_PRESET_DEFAULTS[name] || _XFORM_PRESET_DEFAULTS.C;
  return {
    ax: preset.ax ?? 0,
    ay: preset.ay ?? 0,
    sx: preset.scaleX ?? preset.sx ?? 1,
    sy: preset.scaleY ?? preset.sy ?? 1,
  };
}

const _PORTRAIT_DEFAULTS = {
  canvas: { width: 200, height: 200, layerSize: 80 },
  headXform: { ax: 0, ay: -0.1, sx: 0.95, sy: 1.14 },
  fighters: [
    {
      id:      'M',
      speciesId: 'mao_ao',
      gender:  'male',
      label:   'Mao-ao (M)',
      headUrl: 'fightersprites/mao-ao-m/head_mint.png',
      bodyLayers: [
        { id: 'armL', url: 'portraitsprites/arm-L_mao-ao_m.png', tintSlot: 'A', pos: 'back' },
        { id: 'torso', url: 'portraitsprites/torso_mao-ao_m.png', tintSlot: 'A', pos: 'back' },
        { id: 'armR', url: 'portraitsprites/arm-R_mao-ao_m.png', tintSlot: 'A', pos: 'back' },
      ],
      urLayers: [
        { url: 'fightersprites/mao-ao-m/untinted_regions/ur-head.png' },
      ],
    },
    {
      id:      'F',
      speciesId: 'mao_ao',
      gender:  'female',
      label:   'Mao-ao (F)',
      headUrl: 'fightersprites/mao-ao-f/head.png',
      bodyLayers: [
        { id: 'armL', url: 'portraitsprites/arm-L_mao-ao_f.png', tintSlot: 'A', pos: 'back' },
        { id: 'torso', url: 'portraitsprites/torso_mao-ao_f.png', tintSlot: 'A', pos: 'back' },
        { id: 'armR', url: 'portraitsprites/arm-R_mao-ao_f.png', tintSlot: 'A', pos: 'back' },
      ],
      urLayers: [
        { url: 'fightersprites/mao-ao-f/untinted_regions/ur-head.png' },
      ],
    },
  ],
  bodyColorLimits: {
    A: { hMin: -100, hMax:  -30, sMin: 0.05, sMax: 0.75, vMin: -0.50, vMax: 0.20 },
    B: { hMin: -100, hMax:  -30, sMin: -0.20, sMax: 0.90, vMin: -0.85, vMax: 0.10 },
    C: { hMin: -100, hMax:  -30, sMin: -0.65, sMax: 0.65, vMin: -0.25, vMax: 0.55 },
  }
};

let _portraitConfig = {
  ..._PORTRAIT_DEFAULTS,
  ...(window.PORTRAIT_CONFIG || {})
};

function normalizePortraitLayerXform(layer) {
  if (!layer || typeof layer !== 'object') return layer;
  const next = { ...layer };
  const xf = (layer.xform && typeof layer.xform === 'object') ? layer.xform : null;
  if (next.ax == null) next.ax = xf?.ax ?? 0;
  if (next.ay == null) next.ay = xf?.ay ?? 0;
  if (next.sx == null) next.sx = xf?.sx ?? xf?.scaleX ?? xf?.scaleMulX ?? 1;
  if (next.sy == null) next.sy = xf?.sy ?? xf?.scaleY ?? xf?.scaleMulY ?? 1;
  return next;
}

function normalizePortraitMaskLayer(maskLayer) {
  if (!maskLayer || typeof maskLayer !== 'object') return null;
  return normalizePortraitLayerXform(maskLayer);
}

function normalizedFighterPortrait(fighter) {
  if (!fighter || typeof fighter !== 'object') return fighter;
  return {
    ...fighter,
    bodyLayers: Array.isArray(fighter.bodyLayers)
      ? fighter.bodyLayers.map(normalizePortraitLayerXform)
      : fighter.bodyLayers,
    opacityMaskLayer: normalizePortraitMaskLayer(fighter.opacityMaskLayer),
  };
}

function setPortraitConfig(overrides) {
  _portraitConfig = {
    ..._PORTRAIT_DEFAULTS,
    ..._portraitConfig,
    ...(overrides || {})
  };
  PORTRAIT_CW = _portraitConfig.canvas?.width ?? 200;
  PORTRAIT_CH = _portraitConfig.canvas?.height ?? 200;
  PORTRAIT_L = _portraitConfig.canvas?.layerSize ?? 80;
  HEAD_XFORM = _portraitConfig.headXform || _PORTRAIT_DEFAULTS.headXform;
  FIGHTERS = (_portraitConfig.fighters || _PORTRAIT_DEFAULTS.fighters).map(normalizedFighterPortrait);
  BODYCOLOR_LIMITS = _portraitConfig.bodyColorLimits || _PORTRAIT_DEFAULTS.bodyColorLimits;
}

let PORTRAIT_CW = _portraitConfig.canvas?.width ?? 200;
let PORTRAIT_CH = _portraitConfig.canvas?.height ?? 200;
let PORTRAIT_L  = _portraitConfig.canvas?.layerSize ?? 80;
let HEAD_XFORM = _portraitConfig.headXform || _PORTRAIT_DEFAULTS.headXform;
let FIGHTERS = (_portraitConfig.fighters || _PORTRAIT_DEFAULTS.fighters).map(normalizedFighterPortrait);
let BODYCOLOR_LIMITS = _portraitConfig.bodyColorLimits || _PORTRAIT_DEFAULTS.bodyColorLimits;
let LAST_RANDOMIZATION_RULES_BY_FIGHTER = {};
let LAST_SPECIES_DATA_BY_ID = {};
let LAST_COSMETIC_FALLBACK_GROUPS = null;

// Persistent offscreen canvas reused for ur-head masking — avoids allocating a
// new canvas element on every renderProfile call (was creating ~240/second).
let _urMaskOffCanvas = null;
let _urMaskOffCtx = null;
function _getUrMaskCanvas(w, h) {
  if (!_urMaskOffCanvas || _urMaskOffCanvas.width !== w || _urMaskOffCanvas.height !== h) {
    _urMaskOffCanvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    _urMaskOffCtx = _urMaskOffCanvas.getContext('2d');
  }
  return { canvas: _urMaskOffCanvas, ctx: _urMaskOffCtx };
}

function _normalizeSpeciesKey(speciesId) {
  return String(speciesId || '').trim().toLowerCase().replace(/_/g, '-');
}
// Legacy Mao-ao cosmetics were authored with a `mao-ao_` short-id prefix; strip
// it so species-neutral ids line up with optionCache/allowedCosmetics ids.
const MAO_AO_SHORT_ID_PREFIX_RE = /^mao-ao_/i;

function _configuredRandomizableGenders(speciesId) {
  const availability = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.availability || {};
  const key = _normalizeSpeciesKey(speciesId);
  const entry = availability[key] || availability[String(speciesId || '').trim()] || null;
  const genders = entry?.randomizableGenders || entry?.genders;
  return Array.isArray(genders) && genders.length
    ? genders.map(gender => String(gender).toLowerCase()).filter(Boolean)
    : null;
}

function _isRandomizableSpeciesGender(speciesId, gender) {
  const genders = _configuredRandomizableGenders(speciesId);
  return !genders || genders.includes(String(gender || '').toLowerCase());
}

const BLINK_STATE_BY_HEAD_URL = new Map();

function getBlinkConfig() {
  const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.blink || {};
  return {
    enabled: cfg.enabled !== false,
    minIntervalMs: Number(cfg.minIntervalMs) || 2500,
    maxIntervalMs: Number(cfg.maxIntervalMs) || 6000,
    durationMs: Number(cfg.durationMs) || 140,
    flurryChance: Number.isFinite(Number(cfg.flurryChance)) ? Number(cfg.flurryChance) : 0.18,
    flurryCountMin: Math.max(1, Number(cfg.flurryCountMin) || 1),
    flurryCountMax: Math.max(1, Number(cfg.flurryCountMax) || 2),
    flurryIntervalMs: Number(cfg.flurryIntervalMs) || 280,
  };
}

function blinkUrlFor(headOverlayUrl) {
  if (typeof headOverlayUrl !== 'string' || !headOverlayUrl.endsWith('.png')) return null;
  return headOverlayUrl.replace(/\.png$/i, '_blink.png');
}

function getBlinkState(headUrl) {
  if (!headUrl) return null;
  let state = BLINK_STATE_BY_HEAD_URL.get(headUrl);
  if (!state) {
    state = { supported: null, nextBlinkAtMs: 0, closeUntilMs: 0, flurryBlinksLeft: 0 };
    BLINK_STATE_BY_HEAD_URL.set(headUrl, state);
  }
  return state;
}

function shouldRenderBlink(headUrl, nowMs) {
  const cfg = getBlinkConfig();
  if (!cfg.enabled || !headUrl) return false;
  const state = getBlinkState(headUrl);
  if (!state || state.supported !== true) return false;
  const minGap = Math.min(cfg.minIntervalMs, cfg.maxIntervalMs);
  const maxGap = Math.max(cfg.minIntervalMs, cfg.maxIntervalMs);
  if (!state.nextBlinkAtMs) {
    state.nextBlinkAtMs = nowMs + minGap + Math.random() * (maxGap - minGap);
    return false;
  }
  if (nowMs >= state.closeUntilMs && nowMs >= state.nextBlinkAtMs) {
    state.closeUntilMs = nowMs + cfg.durationMs;
    if (state.flurryBlinksLeft > 0) {
      state.flurryBlinksLeft--;
      state.nextBlinkAtMs = state.closeUntilMs + cfg.flurryIntervalMs;
    } else if (Math.random() < cfg.flurryChance) {
      const flurryCount = cfg.flurryCountMin + Math.floor(Math.random() * (cfg.flurryCountMax - cfg.flurryCountMin + 1));
      state.flurryBlinksLeft = flurryCount;
      state.nextBlinkAtMs = state.closeUntilMs + cfg.flurryIntervalMs;
    } else {
      state.nextBlinkAtMs = state.closeUntilMs + minGap + Math.random() * (maxGap - minGap);
    }
  }
  return nowMs < state.closeUntilMs;
}

// ── Image loading ──────────────────────────────────────────

let _puAssetBase = './assets/';
const IMG_CACHE  = new Map();

/** Set the asset base URL used by loadImg(). Call before rendering. */
function setPortraitAssetBase(base) {
  _puAssetBase = base;
  IMG_CACHE.clear();
}

function loadImg(relPath) {
  const cached = IMG_CACHE.get(relPath);
  // Fast path: image already resolved — return a pre-resolved promise so callers
  // can still await it uniformly, but the microtask queue is not involved.
  if (cached instanceof Image) return Promise.resolve(cached);
  if (cached !== undefined) return cached;  // pending or failed promise

  const ensureTrailingSlash = (base) => String(base || './assets/').replace(/\/?$/, '/');
  const localBase = ensureTrailingSlash(_puAssetBase);
  const fallbackBase = localBase.includes('/docs/assets/')
    ? localBase.replace('/docs/assets/', '/assets/')
    : localBase.replace('/assets/', '/docs/assets/');

  const candidateUrls = [
    localBase + relPath,
    fallbackBase + relPath,
  ];

  const seen = new Set();
  const uniqueCandidates = candidateUrls.filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  const tryLoadUrl = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(url);
    img.src = url;
  });

  // Race every candidate at once rather than awaiting them one at a time —
  // for a genuinely missing asset (no art authored for this species/
  // expression yet), sequential awaits cost the sum of every candidate's
  // own failed-request round-trip; racing them costs only the slowest one.
  const promise = Promise.any(uniqueCandidates.map(tryLoadUrl)).catch(() => {
    const error = new Error(`Failed to load portrait asset "${relPath}"`);
    error.name = 'PortraitImageLoadError';
    error.relPath = relPath;
    error.attemptedUrls = uniqueCandidates;
    throw error;
  });

  // Once the image resolves, upgrade the cache entry from Promise → Image so
  // subsequent calls get a synchronous hit and renderProfile can skip await.
  promise.then(img => IMG_CACHE.set(relPath, img), () => { /* leave failed promise as-is */ });

  IMG_CACHE.set(relPath, promise);
  return promise;
}

// ── CSS filter helpers ─────────────────────────────────────

function buildCSSFilter(h, s, v) {
  const hueOffset  = (window.SCRATCHBONES_CONFIG?.clothingHueOffset)   ?? 0;
  const satOffset  = (window.SCRATCHBONES_CONFIG?.clothingSatOffset)   ?? 0;
  const lightOffset = (window.SCRATCHBONES_CONFIG?.clothingLightOffset) ?? 0;
  const sat = Math.max(0, 1 + (Number(s) || 0) + satOffset);
  const bri = Math.max(0, 1 + (Number(v) || 0) + lightOffset);
  const finalH = (Number(h) || 0) + hueOffset;
  if (finalH === 0 && sat === 1 && bri === 1) return 'none';
  return `hue-rotate(${finalH.toFixed(1)}deg) saturate(${sat.toFixed(3)}) brightness(${bri.toFixed(3)})`;
}

function makeCSSFilter(color) {
  if (!color) return 'none';
  return buildCSSFilter(color.h, color.s, color.v ?? color.l);
}


// ── Tint descriptor / hue+saturation-fill helpers ─────────────────────────
//
// Every clothing/body layer is recolored by ONE algorithm: each opaque
// source pixel's HUE and SATURATION are replaced by the target dye's hue
// and saturation while that pixel's own VALUE (brightness) is left exactly
// as painted. This used to be two different implementations — an approximate
// CSS hue-rotate()/saturate()/brightness() filter chain (a linear color-
// matrix transform, not a true hue rotation, so its visual result drifted
// depending on each sprite's own base pixel colors) for "legacy" delta-style
// colors, and a separate luminance-multiply flat-hex flood fill (which
// discarded the source's own hue/saturation AND derived brightness from a
// multiplier rather than the pixel's real value) for dye-catalog colors that
// happened to carry a `.hex`. That split is exactly why some clothing/body
// sprites matched their swatch exactly while others were visibly off: which
// path a given color took depended on incidental object shape, not on any
// real difference in how "exact" the two produced. See sprite-recolor.js for
// the original version of this per-pixel approach (used for item icons).

const _HUESAT_FILL_CACHE = new Map();
const _TARGET_HUESAT_CACHE = new Map();

function parseHexColor(hex) {
  if (typeof hex !== 'string') return null;
  const raw = hex.trim().replace(/^#/, '');
  const expanded = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
    hex: '#' + expanded.toUpperCase(),
  };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function relativeLuminance(r, g, b) {
  return (0.2126 * (Number(r) || 0) + 0.7152 * (Number(g) || 0) + 0.0722 * (Number(b) || 0)) / 255;
}

// Pure HSV math, kept local (rather than shared with sprite-recolor.js's
// copy) since portrait-utils.js is loaded standalone in several contexts
// (character-tools, cutscene director, npc preview) with no guaranteed load
// order against sprite-recolor.js.
function _rgbToHsvPU(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s };
}

function _hsvToRgbPU(h, s, v) {
  const hNorm = ((Number(h) % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hNorm < 60)       { r = c; g = x; b = 0; }
  else if (hNorm < 120) { r = x; g = c; b = 0; }
  else if (hNorm < 180) { r = 0; g = c; b = x; }
  else if (hNorm < 240) { r = 0; g = x; b = c; }
  else if (hNorm < 300) { r = x; g = 0; b = c; }
  else                  { r = c; g = 0; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function getPortraitTintingConfig() {
  const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting || {};
  return {
    preserveNearBlackOutlines: cfg.preserveNearBlackOutlines !== false,
    outlineThreshold: Number.isFinite(Number(cfg.outlineThreshold)) ? Number(cfg.outlineThreshold) : 0.08,
    cacheEnabled: cfg.cacheEnabled !== false,
    // shadeFill-only knobs -- same config surface (and same defaults) as
    // creature-genetics-render.js's shadeFillConfig(), so a mashtzarr set to
    // bodyTintMode: "shadeFill" paints with literally the same math as
    // animal fur/pattern layers, not just a visually-similar approximation.
    shadowFloor: Number.isFinite(Number(cfg.shadowFloor)) ? Number(cfg.shadowFloor) : 0.18,
    highlightBoost: Number.isFinite(Number(cfg.highlightBoost)) ? Number(cfg.highlightBoost) : 1.18,
    neutralLuminance: Number.isFinite(Number(cfg.neutralLuminance)) ? Number(cfg.neutralLuminance) : 0.55,
    gamma: Number.isFinite(Number(cfg.gamma)) && Number(cfg.gamma) > 0 ? Number(cfg.gamma) : 1,
  };
}

// 1×1 canvas reused to resolve a legacy delta-style color ({h,s,v} tuned for
// the CSS filter chain, no absolute `.hex`) to an absolute target hue/sat:
// the same swatch-preview filter (see swatchStyle() in onboarding.js /
// character-studio) is run against the same reference swatch base color the
// picker itself shows, and the resulting pixel is read back. This makes the
// actual sprite fill match what the swatch preview promises, consistently,
// instead of re-running the filter against each sprite's own (unrelated)
// base pixel colors, which is what produced inconsistent results before.
let _filterSimCanvas = null;
function _resolveTargetHueSat(color, referenceHex) {
  if (!color) return null;
  if (color.hex) {
    const parsed = parseHexColor(color.hex);
    if (parsed) return _rgbToHsvPU(parsed.r, parsed.g, parsed.b);
  }
  if (color.h == null && color.s == null && color.v == null) return null;
  const ref = parseHexColor(referenceHex) || { r: 125, g: 200, b: 154 };
  const filter = makeCSSFilter(color);
  const cacheKey = ref.hex + '|' + filter;
  if (_TARGET_HUESAT_CACHE.has(cacheKey)) return _TARGET_HUESAT_CACHE.get(cacheKey);
  if (!_filterSimCanvas) _filterSimCanvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
  const ctx = _filterSimCanvas.getContext('2d');
  ctx.clearRect(0, 0, 1, 1);
  ctx.filter = filter;
  ctx.fillStyle = `rgb(${ref.r},${ref.g},${ref.b})`;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const result = _rgbToHsvPU(r, g, b);
  _TARGET_HUESAT_CACHE.set(cacheKey, result);
  return result;
}

function tintForBodyColor(color, referenceHex) {
  const targetHS = _resolveTargetHueSat(color, referenceHex);
  if (!targetHS) return { mode: 'none' };
  return { mode: 'hueSatFill', hue: targetHS.h, sat: targetHS.s, options: getPortraitTintingConfig() };
}

// Same reference-swatch CSS-filter simulation as _resolveTargetHueSat above,
// but returns the raw absolute RGB instead of converting it to hue/sat --
// shadeFill scales that absolute color by each pixel's own luminance rather
// than replacing hue/sat while keeping the pixel's own value, so it needs the
// literal target color, not a hue/sat pair. Kept as its own cache/function
// (rather than reusing _TARGET_HUESAT_CACHE) to avoid touching the existing
// hueSatFill path at all.
const _TARGET_RGB_CACHE = new Map();
function _resolveTargetRgbColor(color, referenceHex) {
  if (!color) return null;
  if (color.hex) {
    const parsed = parseHexColor(color.hex);
    if (parsed) return [parsed.r, parsed.g, parsed.b];
  }
  if (color.h == null && color.s == null && color.v == null) return null;
  const ref = parseHexColor(referenceHex) || { r: 125, g: 200, b: 154 };
  const filter = makeCSSFilter(color);
  const cacheKey = ref.hex + '|' + filter;
  if (_TARGET_RGB_CACHE.has(cacheKey)) return _TARGET_RGB_CACHE.get(cacheKey);
  if (!_filterSimCanvas) _filterSimCanvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
  const ctx = _filterSimCanvas.getContext('2d');
  ctx.clearRect(0, 0, 1, 1);
  ctx.filter = filter;
  ctx.fillStyle = `rgb(${ref.r},${ref.g},${ref.b})`;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const result = [r, g, b];
  _TARGET_RGB_CACHE.set(cacheKey, result);
  return result;
}

// Multiplicative luminance-based tint -- literally the same algorithm as
// creature-genetics-render.js's recolorPixels (see that file's comment for
// why: it reads correctly on dark, cel-shaded art where a hue/sat value-
// replace crushes everything toward one muddy tone). Used for species whose
// body art needs to look like animal fur/pattern layers rather than the
// standard NPC hueSatFill skin.
function shadeFillTintForBodyColor(color, referenceHex) {
  const rgb = _resolveTargetRgbColor(color, referenceHex);
  if (!rgb) return { mode: 'none' };
  return { mode: 'shadeFill', rgb, options: getPortraitTintingConfig() };
}

// shadeFill is the default tint algorithm everywhere now (body colors AND
// clothing dyes) -- the hue/sat value-replace crushes dark, cel-shaded art
// toward one muddy tone regardless of whether that art is skin, fur, or
// cloth, which is exactly why animals never used it. A species (bodyTintMode)
// or the whole game (tinting.clothingTintMode) can still opt back into the
// old hueSatFill behavior explicitly if some particular art needs it.
function bodyTintModeForSpecies(speciesId) {
  const key = _normalizeSpeciesKey(speciesId);
  const speciesCfg = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {};
  const entry = speciesCfg[key] || speciesCfg[String(speciesId || '')];
  return entry?.bodyTintMode === 'hueSatFill' ? 'hueSatFill' : 'shadeFill';
}

function clothingTintMode() {
  const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting || {};
  return cfg.clothingTintMode === 'hueSatFill' ? 'hueSatFill' : 'shadeFill';
}

// Body/fur tint slots are the bare letters A/B/C (see BODYCOLOR_LIMITS);
// clothing dye tint slots are named keys (TORSO, HAT, HOOD, CLOTH, optionally
// with a _B/_C suffix — see applyGearClothingToPlayerData/appliedDyes in
// game.js). Body slots simulate against the character's own species swatch
// base (what the Appearance tab's color picker itself previews against);
// clothing slots simulate against the shared cloth dye swatch base.
function _dyeReferenceHexForSlot(slot, speciesId) {
  const isBodySlot = slot === 'A' || slot === 'B' || slot === 'C';
  const dyesCfg = window.SCRATCHBONES_CONFIG?.game?.dyes || {};
  if (isBodySlot) {
    const cfgSpecies = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {};
    const key = _normalizeSpeciesKey(speciesId);
    return cfgSpecies[key]?.swatchBase || cfgSpecies[String(speciesId || '')]?.swatchBase || dyesCfg.swatchBase || '#7dc89a';
  }
  return dyesCfg.swatchBase || '#7dc89a';
}

function getHueSatFillCanvas(img, sourceKey, tint) {
  if (!img || tint?.mode !== 'hueSatFill') return img;
  const options = tint.options || getPortraitTintingConfig();
  const cacheKey = [
    sourceKey || img.currentSrc || img.src || 'inline', tint.hue.toFixed(2), tint.sat.toFixed(4),
    options.preserveNearBlackOutlines, options.outlineThreshold
  ].join('|');
  if (options.cacheEnabled && _HUESAT_FILL_CACHE.has(cacheKey)) return _HUESAT_FILL_CACHE.get(cacheKey);

  const canvas = Object.assign(document.createElement('canvas'), {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
  });
  const offCtx = canvas.getContext('2d');
  offCtx.drawImage(img, 0, 0);
  const imageData = offCtx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (options.preserveNearBlackOutlines && relativeLuminance(r, g, b) <= options.outlineThreshold) continue;
    const v = Math.max(r, g, b) / 255;
    const [nr, ng, nb] = _hsvToRgbPU(tint.hue, tint.sat, v);
    data[i] = clampByte(nr);
    data[i + 1] = clampByte(ng);
    data[i + 2] = clampByte(nb);
  }
  offCtx.putImageData(imageData, 0, 0);
  if (options.cacheEnabled) _HUESAT_FILL_CACHE.set(cacheKey, canvas);
  return canvas;
}

const _SHADE_FILL_CACHE = new Map();
function getShadeFillCanvas(img, sourceKey, tint) {
  if (!img || tint?.mode !== 'shadeFill') return img;
  const options = tint.options || getPortraitTintingConfig();
  const [tr, tg, tb] = tint.rgb;
  const cacheKey = [
    sourceKey || img.currentSrc || img.src || 'inline', tr, tg, tb,
    options.shadowFloor, options.highlightBoost, options.neutralLuminance, options.gamma,
    options.preserveNearBlackOutlines, options.outlineThreshold,
  ].join('|');
  if (options.cacheEnabled && _SHADE_FILL_CACHE.has(cacheKey)) return _SHADE_FILL_CACHE.get(cacheKey);

  const canvas = Object.assign(document.createElement('canvas'), {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
  });
  const offCtx = canvas.getContext('2d');
  offCtx.drawImage(img, 0, 0);
  const imageData = offCtx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const neutral = Math.max(0.0001, options.neutralLuminance);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = relativeLuminance(r, g, b);
    if (options.preserveNearBlackOutlines && lum <= options.outlineThreshold) continue;
    const normalized = Math.pow(Math.max(0, lum) / neutral, options.gamma);
    const shade = Math.max(options.shadowFloor, Math.min(options.highlightBoost, normalized));
    data[i] = clampByte(tr * shade);
    data[i + 1] = clampByte(tg * shade);
    data[i + 2] = clampByte(tb * shade);
  }
  offCtx.putImageData(imageData, 0, 0);
  if (options.cacheEnabled) _SHADE_FILL_CACHE.set(cacheKey, canvas);
  return canvas;
}

function _imageForTint(img, sourceKey, tint) {
  if (tint?.mode === 'hueSatFill') return getHueSatFillCanvas(img, sourceKey, tint);
  if (tint?.mode === 'shadeFill') return getShadeFillCanvas(img, sourceKey, tint);
  return img;
}

// Behind-view layers that need to cancel the later whole-canvas mirror (see
// _cloneBehindLayer) carry a negative sx. Doing that via a canvas transform
// (translate+scale) at the call site breaks as soon as the draw goes through
// _drawPortraitLayerTriangle, which calls ctx.setTransform() -- an ABSOLUTE
// assignment that silently discards whatever transform was active, so the
// flip vanished and the layer's already-off-center "flipped" position (meant
// to be interpreted post-translate) got used as an absolute canvas position
// instead, sending it halfway off the portrait. Pre-flipping the pixel
// content itself sidesteps that entirely: everything downstream keeps using
// plain, always-positive positioning math.
const _flippedImageCache = new WeakMap();
function _getFlippedImage(img) {
  let flipped = _flippedImageCache.get(img);
  if (flipped) return flipped;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const fctx = canvas.getContext('2d');
  fctx.translate(w, 0);
  fctx.scale(-1, 1);
  fctx.drawImage(img, 0, 0, w, h);
  _flippedImageCache.set(img, canvas);
  return canvas;
}

// Canonical body-sprite tint path. renderProfile, procedural hands, rocks, and
// cliffs all call this same helper so species tint-mode selection and per-pixel
// recoloring cannot diverge between 2D character art and 3D surface textures.
function bodySpriteTintForColor(color, speciesId, slot = 'A') {
  const referenceHex = _dyeReferenceHexForSlot(slot, speciesId);
  return bodyTintModeForSpecies(speciesId) === 'shadeFill'
    ? shadeFillTintForBodyColor(color, referenceHex)
    : tintForBodyColor(color, referenceHex);
}

function getBodyTintedCanvas(img, sourceKey, color, speciesId = '', slot = 'A') {
  return _imageForTint(img, sourceKey, bodySpriteTintForColor(color, speciesId, slot));
}

// Same-style texture PNGs (wavy_surface/carved_smooth) are authored as complete
// opaque swatches rather than cutout body sprites. Their luminance histogram is
// much narrower: wavy_surface is roughly 0.55..0.73, while a real body sprite
// reaches from black outlines through ~0.71 highlights. Feeding the swatches
// directly into shadeFill therefore makes the texture almost flat, and makes
// carved_smooth much darker than its requested target color. Normalize only
// these surface PNGs into the body's tonal envelope BEFORE the exact same body
// tint stage. The body sprites themselves are untouched.
const _AUTHORED_SURFACE_TONE_CACHE = new Map();
function _surfaceToneConfig() {
  const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting || {};
  return {
    sourceLowPercentile: Number.isFinite(Number(cfg.surfaceSourceLowPercentile)) ? Number(cfg.surfaceSourceLowPercentile) : 0.10,
    sourceHighPercentile: Number.isFinite(Number(cfg.surfaceSourceHighPercentile)) ? Number(cfg.surfaceSourceHighPercentile) : 0.90,
    targetLow: Number.isFinite(Number(cfg.surfaceToneLow)) ? Number(cfg.surfaceToneLow) : 0.22,
    targetHigh: Number.isFinite(Number(cfg.surfaceToneHigh)) ? Number(cfg.surfaceToneHigh) : 0.88,
  };
}

function normalizeAuthoredSurfacePngTone(img, sourceKey) {
  if (!img) return img;
  const tintOptions = getPortraitTintingConfig();
  const tone = _surfaceToneConfig();
  const cacheKey = [
    sourceKey || img.currentSrc || img.src || 'inline-surface',
    tone.sourceLowPercentile, tone.sourceHighPercentile,
    tone.targetLow, tone.targetHigh,
    tintOptions.outlineThreshold,
  ].join('|');
  if (_AUTHORED_SURFACE_TONE_CACHE.has(cacheKey)) return _AUTHORED_SURFACE_TONE_CACHE.get(cacheKey);

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return img;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const luminances = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 8) continue;
    const lum = relativeLuminance(data[i], data[i + 1], data[i + 2]);
    if (lum > tintOptions.outlineThreshold) luminances.push(lum);
  }
  if (luminances.length < 8) return img;
  luminances.sort((a, b) => a - b);
  const percentile = q => luminances[Math.max(0, Math.min(luminances.length - 1, Math.round((luminances.length - 1) * q)))];
  const sourceLow = percentile(Math.max(0, Math.min(1, tone.sourceLowPercentile)));
  const sourceHigh = percentile(Math.max(0, Math.min(1, tone.sourceHighPercentile)));
  const sourceSpan = sourceHigh - sourceLow;
  if (!(sourceSpan > 0.015)) return img;

  const targetLow = Math.max(tintOptions.outlineThreshold + 0.01, Math.min(0.95, tone.targetLow));
  const targetHigh = Math.max(targetLow + 0.02, Math.min(1, tone.targetHigh));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = relativeLuminance(r, g, b);
    // Preserve authored near-black outlines exactly, matching the body tint
    // pipeline's own outline-preservation rule.
    if (tintOptions.preserveNearBlackOutlines && lum <= tintOptions.outlineThreshold) continue;
    const t = Math.max(0, Math.min(1, (lum - sourceLow) / sourceSpan));
    const targetLum = targetLow + (targetHigh - targetLow) * t;
    const scale = targetLum / Math.max(0.0001, lum);
    data[i] = clampByte(r * scale);
    data[i + 1] = clampByte(g * scale);
    data[i + 2] = clampByte(b * scale);
  }
  ctx.putImageData(imageData, 0, 0);
  _AUTHORED_SURFACE_TONE_CACHE.set(cacheKey, canvas);
  return canvas;
}

function getSurfaceTintedCanvas(img, sourceKey, color, speciesId = '', slot = 'A') {
  // Use the authored PNG's own luminance directly, exactly like ordinary body
  // sprite art. The previous 0.22->0.88 surface remap was a workaround for a
  // problem that turned out to be the CORS-tainted flat fallback instead.
  return _imageForTint(img, sourceKey, bodySpriteTintForColor(color, speciesId, slot));
}

// Canonical authored-PNG appearance path. Character body sprites, the final
// avatar plane, and same-style 3D surface PNGs all go through this one API:
// source PNG -> body-style recolor canvas -> CanvasTexture -> MeshBasicMaterial.
function configureSpritePngTexture(THREE, texture, debugName) {
  if (!texture) return texture;
  if (debugName) texture.name = debugName;
  // Keep the exact color-management behavior used by the assembled character
  // sprite texture. Do not give same-style surface PNGs a separate encoding path.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeSpritePngCanvasTexture(THREE, imageOrCanvas, debugName) {
  return configureSpritePngTexture(THREE, new THREE.CanvasTexture(imageOrCanvas), debugName);
}

function spritePngAlphaTest() {
  return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.alphaTest ?? 0.001;
}

function spritePngMaterialOptions(THREE, texture, debugName, overrides = {}) {
  return Object.assign({
    name: debugName,
    map: texture || null,
    transparent: true,
    alphaTest: spritePngAlphaTest(),
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true,
    opacity: 1,
  }, overrides);
}

function makeSpritePngUnlitMaterial(THREE, texture, debugName, overrides = {}) {
  return new THREE.MeshBasicMaterial(spritePngMaterialOptions(THREE, texture, debugName, overrides));
}

window.HobunjiSpritePngSurface = {
  tintForBodyColor: bodySpriteTintForColor,
  tintBodyCanvas: getBodyTintedCanvas,
  normalizeSurfaceTone: normalizeAuthoredSurfacePngTone,
  tintSurfaceCanvas: getSurfaceTintedCanvas,
  configureTexture: configureSpritePngTexture,
  makeCanvasTexture: makeSpritePngCanvasTexture,
  materialOptions: spritePngMaterialOptions,
  makeMaterial: makeSpritePngUnlitMaterial,
  alphaTest: spritePngAlphaTest,
};

// Legacy direct exports remain for editors and older consumers.
window.bodySpriteTintForColor = bodySpriteTintForColor;
window.getBodyTintedCanvas = getBodyTintedCanvas;

// ── Canvas helpers ─────────────────────────────────────────

function drawPortraitLayer(ctx, img, xform, tint, sourceKey) {
  const { ax, ay, sx, sy } = xform;
  const h  = PORTRAIT_L * sy;
  const w  = (img.naturalWidth / img.naturalHeight) * PORTRAIT_L * Math.abs(sx);
  const cx = PORTRAIT_CW / 2 + ay * PORTRAIT_L;
  const cy = PORTRAIT_CH / 2 - ax * PORTRAIT_L;
  ctx.save();
  // A negative sx (a behind-view layer pre-flipped to cancel the later
  // whole-canvas mirror; see _cloneBehindLayer) is handled by pre-flipping the
  // pixel content via _getFlippedImage, not a canvas transform -- see its
  // comment for why a translate+scale here breaks as soon as a caller further
  // down (e.g. the mesh-warp path) calls ctx.setTransform.
  let drawImg = _imageForTint(img, sourceKey, tint);
  if (sx < 0) drawImg = _getFlippedImage(drawImg);
  ctx.filter = 'none';
  ctx.drawImage(drawImg, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}

// ── Mesh-deformation warp helpers ─────────────────────────
// Adapted from docs/tools/mesh-deformation-author/index.html.
// Renders one triangle of a mesh-deformed image using an affine
// transform that maps the source (neutral) triangle → destination
// (deformed) triangle. cssFilter must be applied by the caller
// before this function via ctx.save / ctx.filter.

function _drawPortraitLayerTriangle(ctx, img, imgX, imgY, imgW, imgH, s0, s1, s2, d0, d1, d2) {
  const [sx0, sy0] = s0, [sx1, sy1] = s1, [sx2, sy2] = s2;
  const [dx0, dy0] = d0, [dx1, dy1] = d1, [dx2, dy2] = d2;
  const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(det) < 1e-10) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0); ctx.lineTo(dx1, dy1); ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();
  const m_a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / det;
  const m_b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / det;
  const m_c = (sx0 * (dx1 - dx2) + sx1 * (dx2 - dx0) + sx2 * (dx0 - dx1)) / det;
  const m_d = (sx0 * (dy1 - dy2) + sx1 * (dy2 - dy0) + sx2 * (dy0 - dy1)) / det;
  const m_e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / det;
  const m_f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / det;
  ctx.setTransform(m_a, m_b, m_c, m_d, m_e, m_f);
  ctx.drawImage(img, imgX, imgY, imgW, imgH);
  ctx.restore();
}

/**
 * Draw a portrait layer warped by a mesh.
 * neutralPts / deformedPts: normalized [0..1] control point arrays (same format
 * as BreathingComposer / mesh-deformation-author JSON).
 * The outer ctx.save() / ctx.filter setup is the caller's responsibility so that
 * CSS filters compose correctly with existing canvas state.
 */
function _drawPortraitLayerWarped(ctx, img, layerX, layerY, layerW, layerH, neutralPts, deformedPts, gridCols, gridRows) {
  const toCanvas = (pt) => [layerX + pt[0] * layerW, layerY + pt[1] * layerH];
  for (let r = 0; r < gridRows - 1; r++) {
    for (let c = 0; c < gridCols - 1; c++) {
      const i00 = r * gridCols + c,      i10 = r * gridCols + c + 1;
      const i01 = (r + 1) * gridCols + c, i11 = (r + 1) * gridCols + c + 1;
      const s00 = toCanvas(neutralPts[i00]), s10 = toCanvas(neutralPts[i10]);
      const s01 = toCanvas(neutralPts[i01]), s11 = toCanvas(neutralPts[i11]);
      const d00 = toCanvas(deformedPts[i00]), d10 = toCanvas(deformedPts[i10]);
      const d01 = toCanvas(deformedPts[i01]), d11 = toCanvas(deformedPts[i11]);
      _drawPortraitLayerTriangle(ctx, img, layerX, layerY, layerW, layerH, s00, s10, s01, d00, d10, d01);
      _drawPortraitLayerTriangle(ctx, img, layerX, layerY, layerW, layerH, s10, s11, s01, d10, d11, d01);
    }
  }
}

// Memoised neutral grid cache — avoids rebuilding the same array on every frame.
const _neutralGridCache = new Map();
function _buildNeutralGrid(cols, rows) {
  const key = `${cols}x${rows}`;
  let pts = _neutralGridCache.get(key);
  if (pts) return pts;
  pts = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      pts.push([cols > 1 ? c / (cols - 1) : 0.5, rows > 1 ? r / (rows - 1) : 0.5]);
  _neutralGridCache.set(key, pts);
  return pts;
}

/**
 * Draw a portrait layer with optional mesh-deformation breathing warp.
 * seatId: identifies which seat this portrait belongs to, used to scope emote overlays.
 * Falls back to a plain drawImage when the composer has no data for this portrait.
 */
/**
 * staticDeform (optional): array of 24 [dx, dy] offset pairs (one per 4×6 grid point,
 * in normalised body-layer space). Applied additively on top of the breathing animation
 * (or on top of the neutral grid when no breathing composer is present).
 */
function drawPortraitLayerWarped(ctx, img, xform, tint, breathingComposer, speciesId, gender, nowMs, phaseOffsetMs, seatId, staticDeform, sourceKey) {
  const { ax, ay, sx, sy } = xform;
  const h  = PORTRAIT_L * sy;
  const w  = (img.naturalWidth / img.naturalHeight) * PORTRAIT_L * Math.abs(sx);
  const cx = PORTRAIT_CW / 2 + ay * PORTRAIT_L;
  const cy = PORTRAIT_CH / 2 - ax * PORTRAIT_L;
  const layerX = cx - w / 2;
  const layerY = cy - h / 2;
  // See drawPortraitLayer's identical pre-flip: a negative sx (a behind-view
  // layer pre-flipped in _cloneBehindLayer) is handled by flipping the pixel
  // content itself via _getFlippedImage, not a canvas transform -- a transform
  // here would get silently discarded by _drawPortraitLayerWarped's use of
  // ctx.setTransform below. This path is the one hood/overwear/torso layers
  // actually take (they're drawn via drawBreathingLayers, not drawEmoteLayers),
  // so it needs the same fix.
  let drawImg = _imageForTint(img, sourceKey, tint);
  if (sx < 0) drawImg = _getFlippedImage(drawImg);

  const breathingPts = breathingComposer?.getInterpolatedPoints(speciesId, gender, nowMs, phaseOffsetMs, seatId);
  if (!breathingPts && !staticDeform) {
    ctx.save();
    ctx.filter = 'none';
    ctx.drawImage(drawImg, layerX, layerY, w, h);
    ctx.restore();
    return;
  }

  const anim = breathingPts ? breathingComposer.getAnimData(speciesId, gender) : null;
  const gridCols = anim?.gridCols ?? 4;
  const gridRows = anim?.gridRows ?? 6;
  const neutralPts = _buildNeutralGrid(gridCols, gridRows);

  // Apply static permanent deform additively on top of breathing (or neutral).
  // staticDeform is always a 24-element (4×6) array matching the breathing grid.
  // The length check guards against stale data from a differently-sized grid.
  let finalPts = breathingPts || neutralPts;
  if (staticDeform && staticDeform.length === finalPts.length) {
    finalPts = finalPts.map((p, i) => [
      p[0] + (staticDeform[i]?.[0] ?? 0),
      p[1] + (staticDeform[i]?.[1] ?? 0),
    ]);
  }

  ctx.save();
  ctx.filter = 'none';
  _drawPortraitLayerWarped(ctx, drawImg, layerX, layerY, w, h, neutralPts, finalPts, gridCols, gridRows);
  ctx.restore();
}

function applyPortraitOpacityMask(ctx, img, xform) {
  const { ax, ay, sx, sy } = xform;
  const h  = PORTRAIT_L * sy;
  const w  = (img.naturalWidth / img.naturalHeight) * PORTRAIT_L * sx;
  const cx = PORTRAIT_CW / 2 + ay * PORTRAIT_L;
  const cy = PORTRAIT_CH / 2 - ax * PORTRAIT_L;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}


function getPortraitLayeringConfig() {
  const layering = window.SCRATCHBONES_CONFIG?.game?.portrait?.layering || {};
  return {
    hatUnderHoodTag: layering.hatUnderHoodTag || null,
    eyeAccessoryAboveUnderHoodHatTag: layering.eyeAccessoryAboveUnderHoodHatTag || null,
    hoodHidesFacialHairTag: layering.hoodHidesFacialHairTag || null,
    hoodShowsFrontHairTag: layering.hoodShowsFrontHairTag || null,
  };
}

function hasPortraitTag(option, tag) {
  if (!option || !tag) return false;
  return Array.isArray(option.tags) && option.tags.includes(tag);
}

function hatLayersUnderHood(hat) {
  const { hatUnderHoodTag } = getPortraitLayeringConfig();
  return hat?.hoodLayering === 'under' || hasPortraitTag(hat, hatUnderHoodTag);
}

// Face-covering hoods (e.g. a facewrap) hide facial hair entirely rather than
// just layering over it, since the beard sprite would otherwise poke out past
// the wrap's edges. Fine hoods leave facial hair visible, so this is opt-in
// per cosmetic via a tag rather than tied to "any hood equipped" like the
// existing hairFront/hairSide hiding below.
function hoodHidesFacialHair(hood) {
  const { hoodHidesFacialHairTag } = getPortraitLayeringConfig();
  return hasPortraitTag(hood, hoodHidesFacialHairTag);
}

function eyeAccessoryLayersAboveUnderHoodHat(eyes, hat) {
  if (!hatLayersUnderHood(hat)) return false;
  const { eyeAccessoryAboveUnderHoodHatTag } = getPortraitLayeringConfig();
  return hasPortraitTag(eyes, eyeAccessoryAboveUnderHoodHatTag);
}

function getProfileSpriteXforms(profile) {
  if (!profile) return [];
  const { fighter, hair, hairFront, hairBack, hairSide, hairSideL, hood, eyes, facialHair, pauldron, hat, torsoCosmetic, armCosmetic } = profile;
  const resolvedFighter = resolvePortraitFighter(fighter) || fighter;
  const opacityMaskLayer = resolvedFighter?.opacityMaskLayer || fighter?.opacityMaskLayer || null;
  const headUrl = resolvedFighter?.headUrl || fighter?.headUrl;
  const bodyLayerSource = resolvedFighter?.bodyLayers || fighter?.bodyLayers || [];
  const urLayerSource = resolvedFighter?.urLayers || fighter?.urLayers || [];
  const resolveLayerXform = (layer) => layer?.xformPreset
    ? getPortraitXformPreset(layer.xformPreset)
    : {
      ax: layer?.ax ?? 0,
      ay: layer?.ay ?? 0,
      sx: layer?.sx ?? 1,
      sy: layer?.sy ?? 1,
    };
  const toRecord = (part, layer, extra = {}) => ({
    part,
    url: layer?.url || null,
    xform: resolveLayerXform(layer),
    ...extra,
  });
  const records = [];
  const hatIsUnderHood = hatLayersUnderHood(hat);
  const eyesLayerAboveUnderHoodHat = eyeAccessoryLayersAboveUnderHoodHat(eyes, hat);
  const pushGroupRecords = (group) => {
    if (!group) return;
    const groupLayers = resolveOptionLayers(group, resolvedFighter);
    for (const layer of groupLayers) {
      records.push(toRecord('cosmetic', layer, { group: group.id || null, hairSlot: group.hairSlot || null, pos: layer.pos || 'front' }));
    }
  };
  if (hairFront !== undefined) {
    // Pre-arm back layers: back hairstyle then hat back sprite
    for (const group of [hairBack, hat]) {
      if (!group) continue;
      for (const layer of resolveOptionLayers(group, resolvedFighter)) {
        if (layer.pos === 'back') records.push(toRecord('cosmetic', layer, { group: group.id || null, hairSlot: group.hairSlot || null, pos: 'back' }));
      }
    }
  }
  // Body layers (arms, torso)
  for (const layer of bodyLayerSource) records.push(toRecord('body', layer, { pos: layer.pos || 'back', id: layer.id || null }));
  // Clothing and overwear
  for (const group of [torsoCosmetic, armCosmetic]) {
    if (!group) continue;
    const groupLayers = resolveOptionLayers(group, resolvedFighter);
    if (!groupLayers.length) continue;
    for (const layer of groupLayers) {
      records.push(toRecord('bodyCosmetic', layer, { group: group.id || null, pos: layer.pos || 'front' }));
    }
  }
  if (hairFront !== undefined) {
    // Left side hairstyle before head
    pushGroupRecords(hairSideL);
    // Head
    if (headUrl) records.push({ part: 'head', url: headUrl, xform: getPortraitXformPreset('B') });
    // Facial hair and standard eyes after head, before ur-head. Tagged eye accessories
    // can be promoted later so under-hood hats do not cover goggles.
    pushGroupRecords(facialHair);
    if (!eyesLayerAboveUnderHoodHat) pushGroupRecords(eyes);
    // Ur-head overlays
    for (const layer of urLayerSource) {
      records.push({ part: 'headOverlay', url: layer.url || null, renderOrder: layer.renderOrder || 'normal', xform: getPortraitXformPreset('B') });
    }
    // Front hairstyle, right side hairstyle
    pushGroupRecords(hairFront);
    pushGroupRecords(hairSide);
    // Hat (under hood), hood, pauldron, hat (over hood)
    if (hatIsUnderHood) pushGroupRecords(hat);
    if (eyesLayerAboveUnderHoodHat) pushGroupRecords(eyes);
    pushGroupRecords(hood);
    pushGroupRecords(pauldron);
    if (!hatIsUnderHood) pushGroupRecords(hat);
  } else {
    const legacyGroups = [hair, eyes, facialHair, hat];
    for (const group of legacyGroups) {
      if (!group) continue;
      const groupLayers = resolveOptionLayers(group, resolvedFighter);
      if (!groupLayers.length) continue;
      for (const layer of groupLayers) {
        records.push(toRecord('cosmetic', layer, { group: group.id || null, hairSlot: group.hairSlot || null, pos: layer.pos || 'front' }));
      }
    }
    if (headUrl) records.push({ part: 'head', url: headUrl, xform: getPortraitXformPreset('B') });
    for (const layer of urLayerSource) {
      records.push({ part: 'headOverlay', url: layer.url || null, renderOrder: layer.renderOrder || 'normal', xform: getPortraitXformPreset('B') });
    }
  }
  if (opacityMaskLayer?.url) records.push(toRecord('opacityMask', opacityMaskLayer));
  return records;
}

// ── Mouth expression helpers ───────────────────────────────

const _MOUTH_SPECIES_MAP = {
  'mao-ao':   { sprite: 'mao-ao',   gendered: true,  masked: false },
  'mao_ao':   { sprite: 'mao-ao',   gendered: true,  masked: false },
  'engh-sho': { sprite: 'engh',     gendered: true,  masked: false },
  'engh_sho': { sprite: 'engh',     gendered: true,  masked: false },
  'tletingan':{ sprite: 'tletingan',gendered: true,   masked: false },
  'kenkari':   { sprite: 'kenkari',   gendered: false, masked: true  },
  'rakakoan':  { sprite: 'kenkari',   gendered: false, masked: true  },
  'mashtzarr': { sprite: 'mashtz',    gendered: true,  masked: true  },
};

const _BEARD_BELOW_HEAD_SPECIES = new Set(['mashtzarr']);

/**
 * Returns the relative path to the mouth expression sprite, or null.
 * All known species have a neutral sprite and it is always returned so the
 * default resting mouth renders consistently for every portrait.
 * Kenkari (masked) additionally uses the neutral sprite as a punch-out mask.
 */
function _getMouthSpriteUrl(expression, speciesId, gender) {
  const sid = String(speciesId || '').toLowerCase().replace(/_/g, '-');
  const mapping = _MOUTH_SPECIES_MAP[sid] || _MOUTH_SPECIES_MAP[String(speciesId || '').toLowerCase()];
  if (!mapping) return null;
  const expr = String(expression || 'neutral');
  const suffix = mapping.gendered
    ? '_' + (String(gender || '').toLowerCase() === 'female' ? 'f' : 'm')
    : '';
  return `portraitsprites/expressions/mouth/${expr}_${mapping.sprite}${suffix}.png`;
}

function _isMouthMask(speciesId) {
  const sid = String(speciesId || '').toLowerCase().replace(/_/g, '-');
  return !!(_MOUTH_SPECIES_MAP[sid] || _MOUTH_SPECIES_MAP[String(speciesId || '').toLowerCase()])?.masked;
}

function _getMouthExpressionOpacity(expression, speciesId) {
  const opacityByExpression = window.SCRATCHBONES_CONFIG?.game?.portrait?.mouthExpressions?.opacityByExpressionAndSpecies;
  const bySpecies = opacityByExpression?.[String(expression || 'neutral').toLowerCase()];
  if (!bySpecies || typeof bySpecies !== 'object') return 1;
  const rawSpeciesId = String(speciesId || '').toLowerCase();
  const normalizedSpeciesId = rawSpeciesId.replace(/_/g, '-');
  const opacity = bySpecies[normalizedSpeciesId] ?? bySpecies[rawSpeciesId];
  const numericOpacity = Number(opacity);
  return Number.isFinite(numericOpacity) ? Math.max(0, Math.min(1, numericOpacity)) : 1;
}


function _pngPlaneBehindViewConfig() {
  return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.behindView || {};
}

function _portraitGenderKey(gender) {
  const raw = String(gender || '').toLowerCase();
  if (raw === 'm') return 'male';
  if (raw === 'f') return 'female';
  return raw;
}

function _getBehindHeadUrl(speciesId, gender) {
  const headUrls = _pngPlaneBehindViewConfig().headUrls || {};
  const normalizedSpeciesId = String(speciesId || '').toLowerCase().replace(/_/g, '-');
  const speciesMap = headUrls[normalizedSpeciesId] || headUrls[String(speciesId || '').toLowerCase()];
  if (!speciesMap) return null;
  const genderKey = _portraitGenderKey(gender);
  return speciesMap[genderKey] || speciesMap[genderKey?.[0]] || null;
}

function _textMatchesAny(text, needles) {
  const value = String(text || '').toLowerCase().replace(/_/g, '-');
  return (needles || []).some(needle => value.includes(String(needle || '').toLowerCase().replace(/_/g, '-')));
}

function _getBehindLayerUrl(layer, group, gender) {
  const rules = _pngPlaneBehindViewConfig().layerReplacements || [];
  if (!layer || !Array.isArray(rules)) return layer?.url || null;
  const idText = [group?.id, group?.originalId].filter(Boolean).join(' ');
  for (const rule of rules) {
    if (rule.hairSlot && group?.hairSlot !== rule.hairSlot) continue;
    if (rule.idIncludes && !_textMatchesAny(idText, rule.idIncludes)) continue;
    if (rule.urlIncludes && !_textMatchesAny(layer.url, rule.urlIncludes)) continue;
    // A matched rule with no replacement URL (hide: true) means this layer has
    // no behind-view equivalent at all (e.g. a hood's face-opening trim, or a
    // facial-feature overlay that isn't visible from the back of the head) and
    // should simply not be drawn, rather than falling back to its front-view art.
    if (rule.hide) return null;
    if (rule.genderUrls) {
      const genderKey = _portraitGenderKey(gender);
      return rule.genderUrls[genderKey] || rule.genderUrls[genderKey?.[0]] || layer.url;
    }
    return rule.url || layer.url;
  }
  return layer.url;
}

function _cloneBehindLayer(layer, group, gender) {
  if (!layer) return layer;
  const url = _getBehindLayerUrl(layer, group, gender);
  if (!url) return { ...layer, url };
  // Every layer drawn into the behind canvas gets mirrored a second time when
  // the whole canvas is flipped afterwards (buildTextureSet's flipX in
  // png-plane-avatar.js) to build the back-facing plane texture. Left
  // uncompensated that flip mirrors each cosmetic's own silhouette relative to
  // how it looks on the front -- an asymmetric hair tuft curls the wrong way,
  // a knot points the wrong way -- whether or not the layer got dedicated
  // back-view art above. Negating sx here pre-flips just the sprite content so
  // the two flips cancel out and front/back silhouettes match (this is what
  // made the splayed-knot fix look right; the same compensation belongs on
  // every layer, not just that one).
  // Every cosmetic layer carries a fixed xformPreset:'B' (see
  // _extractLayersFromParts) that resolveXform reads *instead of* the layer's
  // own ax/ay/sx/sy whenever it's set, so the negated sx has to be baked into
  // explicit ax/ay/sx/sy fields with xformPreset cleared, or it's ignored.
  const preset = layer.xformPreset ? getPortraitXformPreset(layer.xformPreset) : {
    ax: layer.ax ?? 0, ay: layer.ay ?? 0, sx: layer.sx ?? 1, sy: layer.sy ?? 1,
  };
  return { ...layer, url, xformPreset: null, ax: preset.ax, ay: preset.ay, sx: -preset.sx, sy: preset.sy };
}

// A layer's paletteColorKey normally selects a sub-slot of its OWN group's
// dye (e.g. a hood's "trim" role -> `${group.tintSlot}_B`). Two reserved keys
// opt out of that entirely instead of naming a sub-slot:
//  - "BODY" routes to the character's own literal body/skin tint slot 'A' --
//    used by exposed-skin overlays (a hood's cutout showing bare ear/trunk)
//    that must always match the wearer's skin regardless of the hood's dye.
//  - "NONE" routes to no tint slot at all (always mode:'none', raw art) --
//    used by overlays that must NEVER be recolored (a tusk poking through a
//    hood's cutout keeps its own painted color). This has to be a real
//    bypass rather than just "leave paletteColorKey unset": randomProfileSeeded's
//    usedPaletteKeys() (further down this file) generates a random color for
//    every distinct non-'A' paletteColorKey it finds across a hood's layers,
//    so an ordinary/undeclared key would still pick up a random dye.
function resolveLayerTintSlot(key, baseTintSlot) {
  if (key === 'BODY') return 'A';
  if (key === 'NONE') return null;
  return (!key || key === 'A') ? baseTintSlot : (baseTintSlot ? `${baseTintSlot}_${key}` : null);
}

// ── Rendering ──────────────────────────────────────────────

async function renderProfile(canvas, profile, renderOptions = {}) {
  const { fighter, hair, hairFront, hairBack, hairSide, hairSideL, hood, eyes, upperFace, facialHair, pauldron, hat, torsoCosmetic, armCosmetic } = profile;
  const bodyColors = profile.bodyColors || {};
  const omitHeadSpriteAndCosmetics = renderOptions?.omitHeadSpriteAndCosmetics === true;
  const onlyHeadSprite = renderOptions?.onlyHeadSprite === true; // Used below to render an alpha mask from the fighter's undecorated base head only.
  const renderBehindView = renderOptions?.portraitView === 'behind' || renderOptions?.view === 'behind';
  const breathingComposer   = renderOptions?.breathingComposer ?? window.portraitBreathingComposer ?? null;
  const breathingPhaseOffset = Number(renderOptions?.breathingPhaseOffsetMs) || 0;
  const seatId = renderOptions?.seatId ?? null;
  // Permanent quad deform: array of 24 [dx,dy] offsets, applied additively with breathing.
  const staticDeform = (Array.isArray(profile.bodyDeform) && profile.bodyDeform.length > 0)
    ? profile.bodyDeform
    : (renderOptions?.staticDeform ?? null);
  const renderHeadSprite = !omitHeadSpriteAndCosmetics;
  const renderHeadCosmetics = !omitHeadSpriteAndCosmetics;
  const resolvedFighter = resolvePortraitFighter(fighter) || fighter;
  const opacityMaskLayer = resolvedFighter?.opacityMaskLayer || fighter?.opacityMaskLayer || null;
  let headUrl = renderHeadSprite ? (resolvedFighter?.headUrl || fighter?.headUrl) : null;
  const bodyLayerSource = resolvedFighter?.bodyLayers || fighter?.bodyLayers || [];
  const urLayerSource = renderHeadSprite ? (resolvedFighter?.urLayers || fighter?.urLayers || []) : [];
  const blinkOverlayUrlsByBase = new Map();
  for (const layer of urLayerSource) {
    const blinkUrl = blinkUrlFor(layer?.url);
    if (blinkUrl) blinkOverlayUrlsByBase.set(layer.url, blinkUrl);
  }
  const ctx = canvas.getContext('2d');
  // Scale the context when the canvas pixel dimensions differ from the logical render
  // size (e.g. 220×220 cinematic canvases vs the 200×200 logical coordinate space).
  // This keeps all drawing helpers working in the same PORTRAIT_CW×PORTRAIT_CH space
  // while the portrait fills and is centered within any canvas size.
  const _scaleX = canvas.width / PORTRAIT_CW;
  const _scaleY = canvas.height / PORTRAIT_CH;
  const _needsScale = (_scaleX !== 1 || _scaleY !== 1);
  if (_needsScale) { ctx.save(); ctx.scale(_scaleX, _scaleY); }
  ctx.clearRect(0, 0, PORTRAIT_CW, PORTRAIT_CH);

  const _tintSpeciesId = resolvedFighter?.speciesId || fighter?.speciesId || '';
  const _clothingTintMode = clothingTintMode();
  const tintFor = (slot) => {
    if (!slot) return { mode: 'none' };
    const isBodySlot = slot === 'A' || slot === 'B' || slot === 'C';
    if (isBodySlot) return bodySpriteTintForColor(bodyColors[slot], _tintSpeciesId, slot);
    const referenceHex = _dyeReferenceHexForSlot(slot, _tintSpeciesId);
    return _clothingTintMode === 'shadeFill'
      ? shadeFillTintForBodyColor(bodyColors[slot], referenceHex)
      : tintForBodyColor(bodyColors[slot], referenceHex);
  };
  const tintA = tintFor('A');

  const baseLeftArmLayers = [];
  const baseTorsoLayers = [];
  const baseRightArmLayers = [];
  const torsoClothingLayers = [];
  const overwearLayers = [];
  for (const layer of bodyLayerSource) {
    const normalizedId = String(layer.id || '').toLowerCase();
    const target = normalizedId.includes('arml') ? baseLeftArmLayers
      : normalizedId.includes('armr') ? baseRightArmLayers
      : normalizedId.includes('torso') ? baseTorsoLayers
      : baseTorsoLayers;
    target.push({ layer, tint: tintFor(layer.tintSlot || 'A') });
  }
  for (const group of [torsoCosmetic, armCosmetic]) {
    if (!group) continue;
    const groupLayers = resolveOptionLayers(group, resolvedFighter);
    if (!groupLayers.length) continue;
    for (const layer of groupLayers) {
      const target = group?.slot === 'torso' ? torsoClothingLayers : overwearLayers;
      const key = layer.paletteColorKey;
      const layerTintSlot = resolveLayerTintSlot(key, group.tintSlot);
      target.push({ layer, tint: tintFor(layerTintSlot || 'A') });
    }
  }

  // Support both three-slot (hairBack/hairSide/hairFront) and legacy single-slot (hair).
  const hatIsUnderHood = hatLayersUnderHood(hat);
  const eyesLayerAboveUnderHoodHat = eyeAccessoryLayersAboveUnderHoodHat(eyes, hat);
  const hoodHideFrontAndSideHair = Boolean(resolveOptionLayers(hood, resolvedFighter).length);
  const { hoodShowsFrontHairTag } = getPortraitLayeringConfig();
  const hoodShowsFrontHair = hasPortraitTag(hood, hoodShowsFrontHairTag);
  const hiddenCosmeticGroups = new Set([
    ...(hoodHideFrontAndSideHair ? [...(hoodShowsFrontHair ? [] : [hairFront]), hairSide, hairSideL] : []),
    ...(hoodHidesFacialHair(hood) ? [facialHair] : []),
  ].filter(Boolean));

  const preBackLayers    = [];  // back hairstyle + hat-back, drawn before arms
  const sideLeftLayers   = [];  // left side hairstyle, drawn before head
  const facialHairLayers = [];  // facial hair, drawn after head
  const eyesLayers       = [];  // eyes, drawn after facial hair
  const upperFaceLayers  = [];  // upper-face accessories, drawn above expression layers
  const frontHairLayers   = [];  // front fringe hair, drawn after facial hair and ur-head overlays
  const rightSideHairLayers = [];  // right-side hairstyle, drawn between head and facial hair
  const hatUnderLayers   = [];  // hat front when configured to render under hoods
  const elevatedEyeAccessoryLayers = []; // tagged eye accessories that render above under-hood hats
  const hoodLayers    = [];  // hood — receives breathing warp
  const pauldronLayers = []; // pauldron — static
  const hatOverLayers    = [];  // hat front when hoodLayering=over (default)

  const pushToTarget = (group, target) => {
    if (!group || hiddenCosmeticGroups?.has(group)) return;
    const groupLayers = resolveOptionLayers(group, resolvedFighter);
    if (!groupLayers.length) return;
    for (const layer of groupLayers) {
      const key = layer.paletteColorKey;
      const layerTintSlot = resolveLayerTintSlot(key, group.tintSlot);
      target.push({ layer, tint: tintFor(layerTintSlot), group });
    }
  };

  if (renderHeadCosmetics && hairFront !== undefined) {
    // Pre-arm back layers: back hairstyle then hat back sprite
    for (const group of [hairBack, hat]) {
      if (!group) continue;
      const groupLayers = resolveOptionLayers(group, resolvedFighter);
      for (const layer of groupLayers) {
        if (layer.pos === 'back') {
          const key = layer.paletteColorKey;
          const layerTintSlot = resolveLayerTintSlot(key, group.tintSlot);
          preBackLayers.push({ layer, tint: tintFor(layerTintSlot), group });
        }
      }
    }
    pushToTarget(hairSideL, sideLeftLayers);
    pushToTarget(facialHair, facialHairLayers);
    pushToTarget(eyes, eyesLayerAboveUnderHoodHat ? elevatedEyeAccessoryLayers : eyesLayers);
    pushToTarget(upperFace, upperFaceLayers);
    pushToTarget(hairFront, frontHairLayers);
    pushToTarget(hairSide, rightSideHairLayers);
    if (hat) {
      const groupLayers = resolveOptionLayers(hat, resolvedFighter);
      for (const layer of groupLayers) {
        if (layer.pos !== 'back') {
          const key = layer.paletteColorKey;
          const layerTintSlot = resolveLayerTintSlot(key, hat.tintSlot);
          (hatIsUnderHood ? hatUnderLayers : hatOverLayers).push({ layer, tint: tintFor(layerTintSlot), group: hat });
        }
      }
    }
    pushToTarget(hood, hoodLayers);
    pushToTarget(pauldron, pauldronLayers);
  } else if (renderHeadCosmetics) {
    // Legacy single-slot hair
    const legacyGroups = [hair, eyes, facialHair, hat];
    for (const group of legacyGroups) {
      if (!group) continue;
      const groupLayers = resolveOptionLayers(group, resolvedFighter);
      if (!groupLayers.length) continue;
      for (const layer of groupLayers) {
        const key = layer.paletteColorKey;
        const layerTintSlot = resolveLayerTintSlot(key, group.tintSlot);
        (layer.pos === 'back' ? preBackLayers : frontHairLayers).push({ layer, tint: tintFor(layerTintSlot), group });
      }
    }
  }

  // Resolve species/gender and mouth expression before building neededUrls so the
  // mouth sprite URL is included in the prefetch batch.
  const speciesId = resolvedFighter?.speciesId || fighter?.speciesId || '';
  const gender    = resolvedFighter?.gender    || fighter?.gender    || '';
  const _preloadNowMs   = Date.now();
  const mouthExpression = breathingComposer?.getExpression(seatId, _preloadNowMs) ?? 'neutral';
  const mouthSpriteUrl  = renderBehindView ? null : _getMouthSpriteUrl(mouthExpression, speciesId, gender);
  const mouthOpacity    = renderBehindView ? 0 : _getMouthExpressionOpacity(mouthExpression, speciesId);

  if (renderBehindView) {
    headUrl = _getBehindHeadUrl(speciesId, gender) || headUrl;
    const useBehindLayers = (layerList) => {
      for (const entry of layerList) {
        entry.layer = _cloneBehindLayer(entry.layer, entry.group, gender);
      }
    };
    [
      preBackLayers, torsoClothingLayers, overwearLayers, sideLeftLayers,
      rightSideHairLayers, facialHairLayers, frontHairLayers, eyesLayers,
      elevatedEyeAccessoryLayers, hoodLayers, pauldronLayers, hatUnderLayers,
      hatOverLayers,
    ].forEach(useBehindLayers);
  }
  const isSnowgogglesLayer = ({ group }) => _textMatchesAny([group?.id, group?.originalId].filter(Boolean).join(' '), ['snowgoggles']);
  const behindSnowgogglesLayers = renderBehindView
    ? [...eyesLayers, ...elevatedEyeAccessoryLayers].filter(isSnowgogglesLayer)
    : [];

  const neededUrls = new Set([
    ...(headUrl ? [headUrl] : []),
    ...(renderBehindView ? [] : urLayerSource.map(m => m.url)),
    ...preBackLayers.map(({ layer }) => layer.url),
    ...baseLeftArmLayers.map(({ layer }) => layer.url),
    ...baseTorsoLayers.map(({ layer }) => layer.url),
    ...baseRightArmLayers.map(({ layer }) => layer.url),
    ...torsoClothingLayers.map(({ layer }) => layer.url),
    ...overwearLayers.map(({ layer }) => layer.url),
    ...sideLeftLayers.map(({ layer }) => layer.url),
    ...rightSideHairLayers.map(({ layer }) => layer.url),
    ...facialHairLayers.map(({ layer }) => layer.url),
    ...(renderBehindView ? behindSnowgogglesLayers : eyesLayers).map(({ layer }) => layer.url),
    ...(renderBehindView ? [] : upperFaceLayers.map(({ layer }) => layer.url)),
    ...frontHairLayers.map(({ layer }) => layer.url),
    ...hatUnderLayers.map(({ layer }) => layer.url),
    ...(renderBehindView ? [] : elevatedEyeAccessoryLayers.map(({ layer }) => layer.url)),
    ...hoodLayers.map(({ layer }) => layer.url),
    ...pauldronLayers.map(({ layer }) => layer.url),
    ...hatOverLayers.map(({ layer }) => layer.url),
    ...(opacityMaskLayer?.url ? [opacityMaskLayer.url] : []),
    ...(renderBehindView ? [] : blinkOverlayUrlsByBase.values()),
  ].filter(Boolean));

  let imgMap;
  // Fast synchronous path: all images already resolved in cache — avoid async overhead.
  const _allUrls = [...neededUrls];
  const _allResolved = _allUrls.every(url => IMG_CACHE.get(url) instanceof Image);
  if (_allResolved) {
    imgMap = new Map(_allUrls.map(url => [url, IMG_CACHE.get(url)]));
  } else {
    // Load every layer independently — a missing/404ing sprite (e.g. a
    // species/gender combo whose art isn't drawn yet) should just omit that
    // one layer, not blank the whole portrait. Once the file shows up at its
    // expected path, this starts drawing it with no further code changes.
    const settled = await Promise.allSettled(
      _allUrls.map(async (url) => [url, await loadImg(url)])
    );
    imgMap = new Map();
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        imgMap.set(result.value[0], result.value[1]);
      } else {
        const err = result.reason;
        console.warn('[portrait] image load error — omitting layer', {
          message: err?.message || String(err),
          name: err?.name || 'Error',
          relPath: err?.relPath || null,
          attemptedUrls: Array.isArray(err?.attemptedUrls) ? err.attemptedUrls : [],
        });
      }
    }
  }
  // Load mouth expression sprite separately — it may not exist for all species/gender combos.
  let mouthImg = null;
  if (mouthSpriteUrl && renderHeadSprite) {
    const _mouthCached = IMG_CACHE.get(mouthSpriteUrl);
    if (_mouthCached instanceof Image) {
      mouthImg = _mouthCached;
    } else {
      try { mouthImg = await loadImg(mouthSpriteUrl); } catch (_) { /* sprite absent — skip */ }
    }
  }

  // Capture current time after image loading so blink-state timing is accurate.
  const nowMs = Date.now();
  const headBlinkState = getBlinkState(headUrl);
  if (headBlinkState) {
    headBlinkState.supported = false;
    for (const blinkUrl of blinkOverlayUrlsByBase.values()) {
      if (imgMap.get(blinkUrl)) {
        headBlinkState.supported = true;
        break;
      }
    }
  }
  // A one-shot bake (a world avatar's static front/back canvas, built once at
  // spawn/gear-change and never re-rendered) has no chance to ever move past
  // whatever frame it's given — advancing shouldRenderBlink's timing state
  // for it risks permanently baking in a closed-eye frame (see
  // forceEyesOpen callers: makeNpcWalker/refreshPlayerAvatar's world avatar
  // builds). A continuously-refreshed canvas (dialogue portraits, cutscenes)
  // doesn't set this and blinks normally.
  const forceEyesOpen = renderOptions?.forceEyesOpen === true;
  const isBlinkFrame = !forceEyesOpen && shouldRenderBlink(headUrl, nowMs);
  const resolveXform = (layer) => layer.xformPreset
    ? getPortraitXformPreset(layer.xformPreset)
    : {
      ax: layer?.ax ?? 0,
      ay: layer?.ay ?? 0,
      sx: layer?.sx ?? 1,
      sy: layer?.sy ?? 1,
    };

  // Pre-compute emote overlay deformation for this portrait (null when no emote is active).
  const emoteDeformedPts = breathingComposer?.getOverlayOnlyPoints(nowMs, seatId) ?? null;
  const emoteNeutralPts  = emoteDeformedPts ? _buildNeutralGrid(4, 6) : null;

  // Draws a single image with emote deformation if active, else plain.
  const drawLayerWithEmote = (img, xform, tint, alpha = 1, sourceKey) => {
    const numericAlpha = Number(alpha);
    const opacity = Number.isFinite(numericAlpha) ? Math.max(0, Math.min(1, numericAlpha)) : 1;
    if (opacity <= 0) return;
    if (emoteDeformedPts) {
      const { ax, ay, sx, sy } = xform;
      const h = PORTRAIT_L * sy;
      const w = (img.naturalWidth / img.naturalHeight) * PORTRAIT_L * Math.abs(sx);
      const cx = PORTRAIT_CW / 2 + ay * PORTRAIT_L;
      const cy = PORTRAIT_CH / 2 - ax * PORTRAIT_L;
      // See drawPortraitLayer's identical pre-flip via _getFlippedImage.
      ctx.save();
      ctx.globalAlpha = opacity;
      let drawImg = _imageForTint(img, sourceKey, tint);
      if (sx < 0) drawImg = _getFlippedImage(drawImg);
      ctx.filter = 'none';
      _drawPortraitLayerWarped(ctx, drawImg, cx - w / 2, cy - h / 2, w, h, emoteNeutralPts, emoteDeformedPts, 4, 6);
      ctx.restore();
    } else if (opacity < 1) {
      ctx.save();
      ctx.globalAlpha = opacity;
      drawPortraitLayer(ctx, img, xform, tint, sourceKey);
      ctx.restore();
    } else {
      drawPortraitLayer(ctx, img, xform, tint, sourceKey);
    }
  };

  // Draws a list of layers with emote deformation applied to each (head, hair, eyes, hat, etc.).
  const drawEmoteLayers = (layerList) => {
    for (const { layer, tint, filter } of layerList) {
      const img = imgMap.get(layer.url);
      if (img) drawLayerWithEmote(img, resolveXform(layer), tint || filter, 1, layer.url);
    }
  };

  // Draws body/cosmetic/hood layers with full breathing + emote deformation.
  const drawBreathingLayers = (layerList) => {
    for (const { layer, tint, filter } of layerList) {
      const img = imgMap.get(layer.url);
      if (!img) continue;
      if (breathingComposer || staticDeform) {
        drawPortraitLayerWarped(ctx, img, resolveXform(layer), tint || filter, breathingComposer, speciesId, gender, nowMs, breathingPhaseOffset, seatId, staticDeform, layer.url);
      } else {
        drawPortraitLayer(ctx, img, resolveXform(layer), tint || filter, layer.url);
      }
    }
  };

  // Neck-rig construction needs the base head's real opaque-pixel centroid,
  // uncontaminated by torso, hair, hats, or other cosmetics. Keep this inside
  // the canonical renderer so it uses the exact same tint and portrait preset
  // as the composite world-avatar canvas.
  if (onlyHeadSprite) {
    if (headUrl) {
      const image = imgMap.get(headUrl);
      if (image) drawLayerWithEmote(image, getPortraitXformPreset('B'), tintA, 1, headUrl);
    }
    if (_needsScale) ctx.restore();
    return;
  }

  if (renderBehindView) {
    const _behindDraw = {
      sideLeft:      () => drawEmoteLayers(sideLeftLayers),
      rightSideHair: () => drawEmoteLayers(rightSideHairLayers),
      baseLeftArm:   () => drawBreathingLayers(baseLeftArmLayers),
      baseTorso:     () => drawBreathingLayers(baseTorsoLayers),
      baseRightArm:  () => drawBreathingLayers(baseRightArmLayers),
      head:          () => { if (headUrl) { const img = imgMap.get(headUrl); if (img) drawLayerWithEmote(img, getPortraitXformPreset('B'), tintA, 1, headUrl); } },
      torsoClothing: () => drawBreathingLayers(torsoClothingLayers),
      overwear:      () => drawBreathingLayers(overwearLayers),
      hatUnder:      () => drawEmoteLayers(hatUnderLayers),
      hood:          () => drawBreathingLayers(hoodLayers),
      pauldron:      () => drawEmoteLayers(pauldronLayers),
      hatOver:       () => drawEmoteLayers(hatOverLayers),
      snowgoggles:   () => drawEmoteLayers(behindSnowgogglesLayers),
      hairBack:      () => drawEmoteLayers(preBackLayers),
      // Front-fringe hairstyles with no authored `pos:'back'` layer (e.g. Long
      // Tufted Hair) have no dedicated back art, so — same fallback as any other
      // undecorated layer — draw the front sprite here and let the behind
      // canvas's whole-image mirror (buildTextureSet's flipX) turn it into a
      // plausible rear silhouette instead of leaving the back of the head bald.
      frontHair:     () => drawEmoteLayers(frontHairLayers),
    };
    for (const key of (renderOptions?.behindLayerOrder || renderProfile.defaultBehindLayerOrder)) {
      _behindDraw[key]?.();
    }
    if (opacityMaskLayer?.url) {
      const maskImg = imgMap.get(opacityMaskLayer.url);
      if (maskImg) applyPortraitOpacityMask(ctx, maskImg, resolveXform(opacityMaskLayer));
    }
    if (_needsScale) ctx.restore();
    return;
  }

  drawEmoteLayers(preBackLayers);
  drawBreathingLayers(baseLeftArmLayers);
  drawBreathingLayers(baseTorsoLayers);
  drawBreathingLayers(baseRightArmLayers);
  drawBreathingLayers(torsoClothingLayers);
  drawBreathingLayers(overwearLayers);
  const _beardBelowHead = _BEARD_BELOW_HEAD_SPECIES.has(String(speciesId || '').toLowerCase().replace(/_/g, '-'));
  drawEmoteLayers(sideLeftLayers);
  if (_beardBelowHead) drawEmoteLayers(facialHairLayers);
  if (headUrl) { const img = imgMap.get(headUrl); if (img) drawLayerWithEmote(img, getPortraitXformPreset('B'), tintA, 1, headUrl); }
  const _isMaskSpecies = mouthImg && _isMouthMask(speciesId);
  drawEmoteLayers(rightSideHairLayers);
  if (!_beardBelowHead) drawEmoteLayers(facialHairLayers);
  drawEmoteLayers(frontHairLayers);
  drawEmoteLayers(eyesLayers);
  // Species anatomy is universally below hoods. Mashtzarr tusks are the sole
  // authored exception: above a hood, but still below an over-hood hat.
  const aboveHoodBelowHatUrLayers = urLayerSource.filter(l => l?.renderOrder === 'aboveHoodBelowHat');
  const normalUrLayers = urLayerSource.filter(l => l?.renderOrder !== 'aboveHoodBelowHat');
  // Kenkari mask species: draw ur-head layers onto an offscreen canvas then punch out the
  // mouth shape (destination-out) before compositing the result onto the main canvas.
  // All other species draw ur-head directly.
  if (_isMaskSpecies && normalUrLayers.length) {
    const { canvas: urOff, ctx: urCtx } = _getUrMaskCanvas(PORTRAIT_CW, PORTRAIT_CH);
    urCtx.clearRect(0, 0, PORTRAIT_CW, PORTRAIT_CH);
    const urXform = getPortraitXformPreset('B');
    for (const mid of normalUrLayers) {
      const activeUrl = isBlinkFrame ? (blinkOverlayUrlsByBase.get(mid.url) || mid.url) : mid.url;
      const img = imgMap.get(activeUrl) || imgMap.get(mid.url);
      if (!img) continue;
      if (emoteDeformedPts) {
        const { ax, ay, sx, sy } = urXform;
        const h = PORTRAIT_L * sy;
        const w = (img.naturalWidth / img.naturalHeight) * PORTRAIT_L * sx;
        const cx = PORTRAIT_CW / 2 + ay * PORTRAIT_L;
        const cy = PORTRAIT_CH / 2 - ax * PORTRAIT_L;
        _drawPortraitLayerWarped(urCtx, img, cx - w / 2, cy - h / 2, w, h, emoteNeutralPts, emoteDeformedPts, 4, 6);
      } else {
        drawPortraitLayer(urCtx, img, urXform, 'none');
      }
    }
    // Punch mouth shape out of the ur-head layer using destination-out.
    const { ax: _mx, ay: _my, sx: _msx, sy: _msy } = urXform;
    const _mh = PORTRAIT_L * _msy;
    const _mw = (mouthImg.naturalWidth / mouthImg.naturalHeight) * PORTRAIT_L * _msx;
    const _mcx = PORTRAIT_CW / 2 + _my * PORTRAIT_L;
    const _mcy = PORTRAIT_CH / 2 - _mx * PORTRAIT_L;
    urCtx.save();
    urCtx.globalCompositeOperation = 'destination-out';
    if (emoteDeformedPts) {
      _drawPortraitLayerWarped(urCtx, mouthImg, _mcx - _mw / 2, _mcy - _mh / 2, _mw, _mh, emoteNeutralPts, emoteDeformedPts, 4, 6);
    } else {
      urCtx.drawImage(mouthImg, _mcx - _mw / 2, _mcy - _mh / 2, _mw, _mh);
    }
    urCtx.restore();
    ctx.save();
    ctx.drawImage(urOff, 0, 0, PORTRAIT_CW, PORTRAIT_CH);
    ctx.restore();
  } else {
    for (const mid of normalUrLayers) {
      const activeUrl = isBlinkFrame ? (blinkOverlayUrlsByBase.get(mid.url) || mid.url) : mid.url;
      const img = imgMap.get(activeUrl) || imgMap.get(mid.url);
      if (img) drawLayerWithEmote(img, getPortraitXformPreset('B'), 'none', 1, activeUrl);
    }
  }
  // Non-mask species: mouth sprite overlays ur-head (drawn here so it sits above ur-head).
  if (mouthImg && !_isMaskSpecies) drawLayerWithEmote(mouthImg, getPortraitXformPreset('B'), 'none', mouthOpacity, mouthSpriteUrl);
  drawEmoteLayers(upperFaceLayers);
  drawEmoteLayers(hatUnderLayers);
  drawEmoteLayers(elevatedEyeAccessoryLayers);
  drawBreathingLayers(hoodLayers);
  drawEmoteLayers(pauldronLayers);
  for (const mid of aboveHoodBelowHatUrLayers) {
    const activeUrl = isBlinkFrame ? (blinkOverlayUrlsByBase.get(mid.url) || mid.url) : mid.url;
    const img = imgMap.get(activeUrl) || imgMap.get(mid.url);
    if (img) drawLayerWithEmote(img, getPortraitXformPreset('B'), 'none', 1, activeUrl);
  }
  drawEmoteLayers(hatOverLayers);
  if (opacityMaskLayer?.url) {
    const maskImg = imgMap.get(opacityMaskLayer.url);
    if (maskImg) applyPortraitOpacityMask(ctx, maskImg, resolveXform(opacityMaskLayer));
  }
  if (_needsScale) ctx.restore();
}

// ── Cosmetic config parsing ────────────────────────────────

function portraitRelPath(url) {
  if (!url) return url;
  if (url.startsWith('./assets/')) return url.slice('./assets/'.length);
  return url;
}

function portraitCategoryForEntry(entry) {
  const path = (entry.path || '').toLowerCase();
  const name = (entry.id.split('::').pop() || '').toLowerCase();
  if (path.includes('/headhair/') || path.includes('headhair/')) return 'hair';
  if (path.includes('/eyes/')     || path.includes('eyes/'))     return 'eyes';
  if (path.includes('/facialhair/') || path.includes('facialhair/')) return 'facialhair';
  if (name.includes('eye')) return 'eyes';
  if (name.includes('beard') || name.includes('stache') || name.includes('whisker') || name.includes('facial')) return 'facialhair';
  return 'hair';
}

/**
 * Extract portrait layer descriptors from a cosmetic JSON `parts` block.
 * paletteLayerMap (optional): maps layerRole names to palette color keys.
 */
function _extractLayersFromParts(partsJson, paletteLayerMap) {
  if (!partsJson || typeof partsJson !== 'object') return [];
  const layers = [];
  const head = partsJson.head;
  if (head) {
    if (head.layers) {
      for (const [layerName, layer] of Object.entries(head.layers)) {
        const xf =
          (layer.spriteStyle && layer.spriteStyle.base && layer.spriteStyle.base.xform && layer.spriteStyle.base.xform.head) ||
          (layer.spriteStyle && layer.spriteStyle.xform && layer.spriteStyle.xform.head) || {};
        const imgUrl = layer.image && layer.image.url;
        if (imgUrl) {
          const layerRole = layer.layerRole || null;
          const paletteColorKey = (layerRole && paletteLayerMap) ? (paletteLayerMap[layerRole] || null) : null;
          layers.push({
            url: portraitRelPath(imgUrl),
            ax:  xf.ax     ?? 0,
            ay:  xf.ay     ?? 0,
            sx:  xf.scaleX ?? 1,
            sy:  xf.scaleY ?? 1,
            pos: layerName === 'back' ? 'back' : 'front',
            paletteColorKey,
            xformPreset: 'B',
          });
        }
      }
    } else if (head.image) {
      const xf = (head.spriteStyle && head.spriteStyle.xform && head.spriteStyle.xform.head) || {};
      const imgUrl = head.image.url;
      if (imgUrl) {
        layers.push({
          url: portraitRelPath(imgUrl),
          ax:  xf.ax     ?? 0,
          ay:  xf.ay     ?? 0,
          sx:  xf.scaleX ?? 1,
          sy:  xf.scaleY ?? 1,
          pos: 'front',
          xformPreset: 'B',
        });
      }
    }
  }
  // Portrait torso/arm clothing layers are identified by their '/portrait/' asset paths.
  if (!layers.length) {
    for (const [partName, partDef] of Object.entries(partsJson)) {
      const partLayers = partDef && partDef.layers ? partDef.layers : null;
      if (!partLayers || typeof partLayers !== 'object') continue;
      for (const [layerName, layer] of Object.entries(partLayers)) {
        const imgUrl = layer?.image?.url;
        if (!imgUrl || !String(imgUrl).toLowerCase().includes('/portrait/')) continue;
        const xf =
          layer?.spriteStyle?.base?.xform?.[partName] ||
          layer?.spriteStyle?.base?.xform?.head ||
          layer?.spriteStyle?.xform?.[partName] ||
          layer?.spriteStyle?.xform?.head ||
          {};
        const layerRole = layer.layerRole || null;
        const paletteColorKey = (layerRole && paletteLayerMap) ? (paletteLayerMap[layerRole] || null) : null;
        layers.push({
          url: portraitRelPath(imgUrl),
          ax:  xf.ax     ?? 0,
          ay:  xf.ay     ?? 0,
          sx:  xf.scaleX ?? xf.scaleMulX ?? 1,
          sy:  xf.scaleY ?? xf.scaleMulY ?? 1,
          pos: layerName === 'back' ? 'back' : 'front',
          paletteColorKey,
          xformPreset: 'B',
        });
      }
    }
  }
  return layers;
}

/**
 * Return the correct layer list for an option given the current fighter.
 * Falls back to option.layers when no matching variant exists.
 */
function _speciesIdForms(speciesId) {
  const raw = String(speciesId || '').trim();
  if (!raw) return [];
  const hyphen = raw.replace(/_/g, '-');
  const under = hyphen.replace(/-/g, '_');
  return [...new Set([raw, hyphen, under])];
}

function _speciesParentChain(speciesId) {
  const out = [];
  const seen = new Set();
  let cur = String(speciesId || '').trim();
  while (cur) {
    const key = _normalizeSpeciesKey(cur);
    if (seen.has(key)) break;
    seen.add(key);
    const parent = LAST_SPECIES_DATA_BY_ID[key]?.parentSpecies || LAST_SPECIES_DATA_BY_ID[cur]?.parentSpecies;
    if (!parent) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

function _fallbackNeighborSpecies(speciesId, gender, kind) {
  const groups = LAST_COSMETIC_FALLBACK_GROUPS;
  if (!groups || typeof groups !== 'object') return [];
  const normalizedSpecies = _normalizeSpeciesKey(speciesId);
  const normalizedGender = String(gender || '').toLowerCase();
  if (kind === 'body') {
    for (const group of (groups.bodyGroups || [])) {
      const members = Array.isArray(group?.members) ? group.members : [];
      const self = members.find(member =>
        _normalizeSpeciesKey(member?.species) === normalizedSpecies &&
        String(member?.gender || '').toLowerCase() === normalizedGender &&
        Number.isFinite(Number(member?.position))
      );
      if (!self) continue;
      const selfPos = Number(self.position);
      return members
        .filter(member => Number.isFinite(Number(member?.position)))
        .sort((a, b) => Math.abs(Number(a.position) - selfPos) - Math.abs(Number(b.position) - selfPos))
        .filter(member => !(
          _normalizeSpeciesKey(member?.species) === normalizedSpecies &&
          String(member?.gender || '').toLowerCase() === normalizedGender
        ))
        .map(member => ({ speciesId: member.species, gender: member.gender }))
        .filter(member => member.speciesId && member.gender);
    }
    return [];
  }

  for (const group of (groups.headGroups || [])) {
    const members = Array.isArray(group?.members) ? group.members : [];
    const self = members.find(member =>
      _normalizeSpeciesKey(member?.species) === normalizedSpecies &&
      Number.isFinite(Number(member?.position))
    );
    if (!self) continue;
    const selfPos = Number(self.position);
    return members
      .filter(member => Number.isFinite(Number(member?.position)))
      .sort((a, b) => Math.abs(Number(a.position) - selfPos) - Math.abs(Number(b.position) - selfPos))
      .filter(member => _normalizeSpeciesKey(member?.species) !== normalizedSpecies)
      .map(member => ({ speciesId: member.species, gender: normalizedGender }))
      .filter(member => member.speciesId && member.gender);
  }
  return [];
}

function portraitVariantKeysForFighter(fighter, option) {
  const speciesId = _normalizeSpeciesKey(fighter?.speciesId);
  const gender = String(fighter?.gender || '').trim().toLowerCase();
  if (!speciesId || !gender) return [];
  const otherGender = gender === 'male' ? 'female' : 'male';
  const kind = (option?.slot === 'torso' || option?.slot === 'overwear') ? 'body' : 'head';
  const candidates = [];
  const seenSpeciesGender = new Set();
  const pushCandidate = (candidateSpecies, candidateGender) => {
    const speciesForms = _speciesIdForms(candidateSpecies);
    if (!speciesForms.length || !candidateGender) return;
    const speciesKey = _normalizeSpeciesKey(speciesForms[0]);
    const genderKey = String(candidateGender || '').toLowerCase();
    const dedupeKey = `${speciesKey}::${genderKey}`;
    if (seenSpeciesGender.has(dedupeKey)) return;
    seenSpeciesGender.add(dedupeKey);
    candidates.push({ speciesForms, gender: genderKey });
  };

  pushCandidate(speciesId, gender);
  if (kind === 'head') pushCandidate(speciesId, otherGender);
  for (const parentSpeciesId of _speciesParentChain(speciesId)) {
    pushCandidate(parentSpeciesId, gender);
    if (kind === 'head') pushCandidate(parentSpeciesId, otherGender);
  }
  for (const neighbor of _fallbackNeighborSpecies(speciesId, gender, kind)) {
    pushCandidate(neighbor.speciesId, neighbor.gender);
    if (kind === 'head') pushCandidate(neighbor.speciesId, otherGender);
  }

  const keys = [];
  for (const candidate of candidates) {
    for (const speciesForm of candidate.speciesForms) keys.push(`${speciesForm}_${candidate.gender}`);
  }
  return [...new Set(keys)];
}

function resolveOptionLayers(option, fighter) {
  if (!option) return [];
  const vl = option.variantLayers;
  if (vl && fighter) {
    for (const key of portraitVariantKeysForFighter(fighter, option)) {
      const resolved = vl[key];
      if (resolved && resolved.length) return resolved;
    }
  }
  return option.layers || [];
}

function portraitOptionFromJson(entry, json) {
  const label    = (json.meta && json.meta.name) || entry.id.split('::').pop().replace(MAO_AO_SHORT_ID_PREFIX_RE, '').replace(/_/g, ' ');
  const tintSlot = (json.appearance && json.appearance.bodyColors && json.appearance.bodyColors[0]) || null;
  const shortId  = entry.id.split('::').pop().replace(MAO_AO_SHORT_ID_PREFIX_RE, '');

  const paletteLayerMap = (json.palette && json.palette.layers) ? json.palette.layers : null;

  // Extract default layers from the top-level parts block.
  const layers = _extractLayersFromParts(json.parts, paletteLayerMap);

  // Extract per-species-gender variant layers from the speciesVariants block.
  // Keys are "{speciesId}_{genderKey}" (e.g. "mao-ao_male", "kenkari_female").
  const variantLayers = {};
  if (json.speciesVariants && typeof json.speciesVariants === 'object') {
    for (const [variantKey, variantData] of Object.entries(json.speciesVariants)) {
      const vLayers = _extractLayersFromParts(variantData && variantData.parts, paletteLayerMap);
      if (vLayers.length) variantLayers[variantKey] = vLayers;
    }
  }

  const colorRange = json.colorRange || null;
  const tags = Array.isArray(json.tags) ? json.tags : [];
  const dyeableTintTags = window.SCRATCHBONES_CONFIG?.game?.portrait?.dyeableTintTags || {};
  const taggedTintSlot = Object.entries(dyeableTintTags)
    .find(([, tag]) => typeof tag === 'string' && tags.includes(tag))?.[0] || null;
  const materialTag = (typeof json.material === 'string' && json.material.trim())
    ? json.material.trim().toLowerCase()
    : (tags.find(tag => typeof tag === 'string' && tag.toLowerCase().startsWith('material:')) || '')
      .split(':')[1]
      ?.trim()
      ?.toLowerCase()
      || null;
  const resolvedTintSlot = taggedTintSlot || (
                           json.slot === 'hat' && colorRange ? 'HAT'
                         : json.slot === 'hood' && colorRange ? 'HOOD'
                         : json.slot === 'torso' && colorRange ? 'TORSO'
                         : !json.appearance && colorRange ? 'CLOTH'
                         : json.slot === 'hood' && !json.appearance ? (json.tintSlot ?? 'HOOD')
                         : !json.appearance && json.tintSlot != null ? json.tintSlot
                         : json.slot === 'torso' && !json.appearance ? 'TORSO'
                         : tintSlot);
  const hairSlot = json.hairSlot || null; // 'front' | 'back' | 'side' | 'side-L'
  const portraitSlot = json.portraitSlot || null; // 'eyes' | 'upperFace' | 'facialHair' | 'hairFront' | 'hairBack' | 'hairSide' | 'hairSideL'
  const hoodLayering = json.hoodLayering || null; // 'under' means hat renders under hood; default is over
  const originalId = (json.appearance && json.appearance.originalId) || null;
  return { id: shortId, label, tintSlot: resolvedTintSlot, layers, variantLayers, slot: json.slot || null, portraitSlot, colorRange, hairSlot, tags, materialTag, hoodLayering, originalId };
}

/**
 * Fetch cosmetics index and all appearance entries.
 * Returns { hairOptions, eyesOptions, facialHairOptions, indexEntries, optionCache }.
 * Throws on unrecoverable failure.
 */
async function loadPortraitCosmetics(configBase) {
  let indexBaseUrl = new URL(configBase + 'cosmetics/index.json', window.location.href).toString();
  let data;
  try {
    const resp = await fetch(indexBaseUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    data = await resp.json();
  } catch (e) {
    console.warn('[portrait] Primary index fetch failed, falling back to raw GitHub URL', e);
    const rawUrl = 'https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/main/docs/config/cosmetics/index.json';
    const resp2 = await fetch(rawUrl);
    if (!resp2.ok) throw new Error('HTTP ' + resp2.status);
    data = await resp2.json();
    indexBaseUrl = rawUrl;
  }

  const allEntries = (data.entries || []).filter(e => e.id && (e.id.startsWith('appearance::') || !e.id.includes('::')));
  const pathToEntries = new Map();
  for (const entry of allEntries) {
    if (!pathToEntries.has(entry.path)) pathToEntries.set(entry.path, []);
    pathToEntries.get(entry.path).push(entry);
  }

  const optionCache  = new Map();
  const indexEntries = [];

  await Promise.all([...pathToEntries.entries()].map(async ([path, entries]) => {
    const jsonUrl = new URL(path, indexBaseUrl).toString();
    let json;
    try {
      const resp = await fetch(jsonUrl);
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + path);
      json = await resp.json();
    } catch (e) {
      console.warn('[portrait] Could not load cosmetic JSON:', path, e);
      return;
    }
    for (const entry of entries) {
      const opt = portraitOptionFromJson(entry, json);
      if (opt.layers.length || Object.keys(opt.variantLayers).length) {
        optionCache.set(entry.id, opt);
        indexEntries.push(entry);
      }
    }
  }));

  // Build categorised option arrays (unfiltered — callers may apply species filtering)
  const hairFrontOptions  = [{ id: 'none', label: 'No Front Hair',  tintSlot: null, layers: [] }];
  const hairBackOptions   = [{ id: 'none', label: 'No Back Hair',   tintSlot: null, layers: [] }];
  const hairSideOptions   = [{ id: 'none', label: 'No Side Hair (R)',  tintSlot: null, layers: [] }];
  const hairSideLOptions  = [{ id: 'none', label: 'No Side Hair (L)',  tintSlot: null, layers: [] }];
  const eyesOptions       = [{ id: 'none', label: 'No Eye Mark',    tintSlot: null, layers: [] }];
  const facialHairOptions = [{ id: 'none', label: 'No Facial Hair', tintSlot: null, layers: [] }];
  const upperFaceOptions = [{ id: 'none', label: 'No Upper Face', tintSlot: null, layers: [] }];
  const hatOptions        = [{ id: 'none', label: 'No Hat',         tintSlot: null, layers: [] }];
  const hoodOptions       = [{ id: 'none', label: 'No Hood',        tintSlot: null, layers: [] }];
  const torsoPortraitOptions = [{ id: 'none', label: 'No Torso Clothing', tintSlot: null, layers: [] }];
  const armPortraitOptions = [{ id: 'none', label: 'No Arm Clothing', tintSlot: null, layers: [] }];
  const seenIds = new Set();

  for (const entry of indexEntries) {
    const opt = optionCache.get(entry.id);
    const optHasLayers = opt && (opt.layers.length > 0 || Object.keys(opt.variantLayers || {}).length > 0);
    if (!optHasLayers) continue;
    if (seenIds.has(opt.id)) continue;
    seenIds.add(opt.id);
    const cat = opt.portraitSlot === 'eyes'       ? 'eyes'
              : opt.portraitSlot === 'facialHair' ? 'facialhair'
              : opt.portraitSlot === 'hairFront'  ? 'hairFront'
              : opt.portraitSlot === 'hairBack'   ? 'hairBack'
              : opt.portraitSlot === 'hairSide'   ? 'hairSide'
              : opt.portraitSlot === 'hairSideL'  ? 'hairSideL'
              : opt.portraitSlot === 'upperFace'  ? 'upperFace'
              : opt.slot === 'hat'        ? 'hat'
              : opt.slot === 'hood'       ? 'hood'
              : opt.hairSlot === 'front'  ? 'hairFront'
              : opt.hairSlot === 'back'   ? 'hairBack'
              : opt.hairSlot === 'side'   ? 'hairSide'
              : opt.hairSlot === 'side-L' ? 'hairSideL'
              : portraitCategoryForEntry(entry);
    if      (cat === 'hat')        hatOptions.push(opt);
    else if (cat === 'hood')       hoodOptions.push(opt);
    else if (cat === 'hairFront')  hairFrontOptions.push(opt);
    else if (cat === 'hairBack')   hairBackOptions.push(opt);
    else if (cat === 'hairSide')   hairSideOptions.push(opt);
    else if (cat === 'hairSideL')  hairSideLOptions.push(opt);
    else if (cat === 'eyes')       eyesOptions.push(opt);
    else if (cat === 'upperFace')  upperFaceOptions.push(opt);
    else if (cat === 'facialhair') facialHairOptions.push(opt);

    if (!entry.id.startsWith('appearance::')) {
      const allOptLayers = [...opt.layers, ...Object.values(opt.variantLayers || {}).flat()];
      const lowerLayers = allOptLayers.map(l => (l.url || '').toLowerCase());
      if (lowerLayers.some(u => u.includes('/torso/portrait/'))) torsoPortraitOptions.push(opt);
      if (lowerLayers.some(u => u.includes('/arms/portrait/') || u.includes('/overwear/portrait/'))) armPortraitOptions.push(opt);
    }
  }

  // Load species body color ranges, allowed cosmetics, and cosmetic weights, keyed by fighter ID
  const bodyColorRangesByGender = {};
  const allowedCosmeticsByFighter = {};
  const cosmeticWeightsByFighter = {};
  const fighterPortraitOverrides = {};
  const forcedCosmeticsByFighter = {};
  const conditionalCosmeticsByFighter = {};
  const randomizationRulesByFighter = {};
  const mandatoryCosmeticSlotsByFighter = {};
  const exclusiveCosmeticsByFighter = {};
  try {
    const speciesIdxUrl = new URL(configBase + 'species/index.json', window.location.href).toString();
    const speciesIdxResp = await fetch(speciesIdxUrl);
    if (speciesIdxResp.ok) {
      const speciesIdx = await speciesIdxResp.json();
      const speciesEntries = speciesIdx.entries || [];
      const speciesDataById = {};
      await Promise.all(speciesEntries.map(async entry => {
        const sUrl = new URL(entry.path, speciesIdxUrl).toString();
        const sResp = await fetch(sUrl);
        if (!sResp.ok) return;
        const sData = await sResp.json();
        if (sData?.speciesId) speciesDataById[_normalizeSpeciesKey(sData.speciesId)] = sData;
      }));
      LAST_SPECIES_DATA_BY_ID = speciesDataById;
      try {
        const fallbackRes = await fetch(new URL('./cosmetic-fallback-groups.json', speciesIdxUrl).toString());
        LAST_COSMETIC_FALLBACK_GROUPS = fallbackRes.ok ? await fallbackRes.json() : null;
      } catch (e) {
        LAST_COSMETIC_FALLBACK_GROUPS = null;
      }

      const mergeUnique = (baseArr, extraArr) => {
        const out = [];
        for (const value of [...(baseArr || []), ...(extraArr || [])]) {
          if (value == null) continue;
          if (!out.includes(value)) out.push(value);
        }
        return out;
      };
      const mergeWeightMap = (baseMap, extraMap) => {
        const out = { ...(baseMap || {}) };
        for (const [slot, slotMap] of Object.entries(extraMap || {})) {
          out[slot] = { ...(out[slot] || {}), ...(slotMap || {}) };
        }
        return out;
      };
      const mergeExclusiveMap = (baseMap, extraMap) => {
        const out = { ...(baseMap || {}) };
        for (const [slot, ids] of Object.entries(extraMap || {})) {
          out[slot] = mergeUnique(out[slot], ids);
        }
        return out;
      };
      const resolveSpeciesGenderData = (speciesId, genderKey, stack = new Set()) => {
        const normalizedSpeciesId = _normalizeSpeciesKey(speciesId);
        const speciesData = speciesDataById[normalizedSpeciesId];
        if (!speciesData) return null;
        const cycleKey = `${normalizedSpeciesId}:${genderKey}`;
        if (stack.has(cycleKey)) return null;
        stack.add(cycleKey);
        const parentSpeciesId = speciesData.parentSpecies || null;
        const parentData = parentSpeciesId ? resolveSpeciesGenderData(parentSpeciesId, genderKey, stack) : null;
        const ownGenderData = speciesData?.[genderKey];
        const mergedGenderData = {
          ...(parentData || {}),
          ...(ownGenderData || {}),
          allowedCosmetics: mergeUnique(parentData?.allowedCosmetics, ownGenderData?.allowedCosmetics),
          disallowedCosmeticCombos: [...(parentData?.disallowedCosmeticCombos || []), ...(ownGenderData?.disallowedCosmeticCombos || [])],
          cosmeticWeights: mergeWeightMap(parentData?.cosmeticWeights, ownGenderData?.cosmeticWeights),
          forcedCosmetics: { ...(parentData?.forcedCosmetics || {}), ...(ownGenderData?.forcedCosmetics || {}) },
          conditionalCosmetics: [...(parentData?.conditionalCosmetics || []), ...(ownGenderData?.conditionalCosmetics || [])],
          randomizationRules: { ...(parentData?.randomizationRules || {}), ...(ownGenderData?.randomizationRules || {}) },
          mandatorySlots: mergeUnique(
            mergeUnique(parentData?.mandatorySlots, ownGenderData?.mandatorySlots),
            speciesData?.subspeciesDelta?.mandatorySlots
          ),
          exclusiveSlotCosmetics: mergeExclusiveMap(
            mergeExclusiveMap(parentData?.exclusiveSlotCosmetics, ownGenderData?.exclusiveSlotCosmetics),
            speciesData?.subspeciesDelta?.exclusiveSlotCosmetics
          ),
        };
        return mergedGenderData;
      };

      for (const entry of speciesEntries) {
        const speciesId = entry?.speciesId;
        if (!speciesId) continue;
        const sourceData = speciesDataById[_normalizeSpeciesKey(speciesId)];
        if (!sourceData) continue;
        const configuredGenders = Array.isArray(sourceData?.genders)
          ? sourceData.genders
          : ['male', 'female'];
        for (const genderKeyRaw of configuredGenders) {
          const genderKey = String(genderKeyRaw || '').toLowerCase();
          const genderData = resolveSpeciesGenderData(speciesId, genderKey);
          if (!genderData || typeof genderData !== 'object' || !genderData.bodyColorRanges) continue;
          if (!_isRandomizableSpeciesGender(speciesId, genderKey)) continue;
          let fighter = FIGHTERS.find(f => genderData.headSprite && f.headUrl === genderData.headSprite && _normalizeSpeciesKey(f.speciesId) === _normalizeSpeciesKey(speciesId));
          if (!fighter && genderData.headSprite && Array.isArray(genderData.portraitBodyLayers)) {
            fighter = normalizedFighterPortrait({
              id: `${speciesId}_${genderKey}`,
              speciesId,
              gender: genderKey,
              label: `${sourceData.label || entry.label} (${genderKey === 'male' ? 'M' : 'F'})`,
              headUrl: genderData.headSprite,
              bodyLayers: genderData.portraitBodyLayers.map(l => ({ ...normalizePortraitLayerXform(l), xformPreset: 'B' })),
              urLayers: (genderData.headUrLayers || []).map(l => ({ url: l.url, renderOrder: l.renderOrder })),
              headXform: genderData.headXform ? normalizePortraitLayerXform(genderData.headXform) : null,
              opacityMaskLayer: genderData.portraitOpacityMaskLayer ? normalizePortraitMaskLayer(genderData.portraitOpacityMaskLayer) : null,
            });
            FIGHTERS.push(fighter);
          }
          if (fighter) {
            // Keep full NPC ranges so wild-animal body and pattern layers
            // retain their intended natural variation. Player palettes are
            // representative choices derived from these authored ranges.
            bodyColorRangesByGender[fighter.id] = genderData.bodyColorRanges;
            fighterPortraitOverrides[fighter.id] = {
              ...(fighterPortraitOverrides[fighter.id] || {}),
              gender: genderKey,
              speciesId,
              ...(genderData.headXform ? { headXform: genderData.headXform } : {}),
              ...(Array.isArray(genderData.portraitBodyLayers) ? {
                bodyLayers: genderData.portraitBodyLayers.map(l => ({ ...normalizePortraitLayerXform(l), xformPreset: 'B' }))
              } : {}),
              ...(genderData.portraitOpacityMaskLayer ? {
                opacityMaskLayer: normalizePortraitMaskLayer(genderData.portraitOpacityMaskLayer)
              } : {})
            };
            if (genderData.allowedCosmetics) {
              allowedCosmeticsByFighter[fighter.id] = {
                set: new Set(
                  genderData.allowedCosmetics.map(id => id.split('::').pop().replace(MAO_AO_SHORT_ID_PREFIX_RE, ''))
                ),
                disallowedCombos: (genderData.disallowedCosmeticCombos || []).map(rule => ({
                  conditions: rule.conditions || {},
                  repairSlots: rule.repairSlots || []
                }))
              };
            }
            if (genderData.cosmeticWeights) {
              cosmeticWeightsByFighter[fighter.id] = genderData.cosmeticWeights;
            }
            if (genderData.forcedCosmetics && typeof genderData.forcedCosmetics === 'object') {
              forcedCosmeticsByFighter[fighter.id] = genderData.forcedCosmetics;
            }
            if (Array.isArray(genderData.conditionalCosmetics)) {
              conditionalCosmeticsByFighter[fighter.id] = genderData.conditionalCosmetics;
            }
            if (genderData.randomizationRules && typeof genderData.randomizationRules === 'object') {
              randomizationRulesByFighter[fighter.id] = genderData.randomizationRules;
            }
            if (Array.isArray(genderData.mandatorySlots) && genderData.mandatorySlots.length) {
              mandatoryCosmeticSlotsByFighter[fighter.id] = [...new Set(genderData.mandatorySlots)];
            }
            if (genderData.exclusiveSlotCosmetics && typeof genderData.exclusiveSlotCosmetics === 'object') {
              const exclusiveBySlot = {};
              for (const [slot, ids] of Object.entries(genderData.exclusiveSlotCosmetics)) {
                // Cosmetic ids are normalized to the same short-id shape used by
                // optionCache and allowedCosmetics filtering.
                const normalizedIds = mergeUnique([], ids).map(id => String(id).split('::').pop().replace(MAO_AO_SHORT_ID_PREFIX_RE, ''));
                if (normalizedIds.length) exclusiveBySlot[slot] = normalizedIds;
              }
              if (Object.keys(exclusiveBySlot).length) exclusiveCosmeticsByFighter[fighter.id] = exclusiveBySlot;
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[portrait] Could not load species data', e);
    LAST_SPECIES_DATA_BY_ID = {};
    LAST_COSMETIC_FALLBACK_GROUPS = null;
  }

  if (Object.keys(fighterPortraitOverrides).length) {
    FIGHTERS = FIGHTERS.map(fighter => {
      const override = fighterPortraitOverrides[fighter.id];
      if (!override) return fighter;
      return normalizedFighterPortrait({
        ...fighter,
        ...(override.gender    != null ? { gender:    override.gender    } : {}),
        ...(override.speciesId != null ? { speciesId: override.speciesId } : {}),
        ...(override.headXform ? { headXform: override.headXform } : {}),
        ...(override.bodyLayers ? { bodyLayers: override.bodyLayers } : {}),
        ...(override.opacityMaskLayer ? { opacityMaskLayer: override.opacityMaskLayer } : {})
      });
    });
  }

  LAST_RANDOMIZATION_RULES_BY_FIGHTER = randomizationRulesByFighter;

  return { hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions, eyesOptions, upperFaceOptions, facialHairOptions, hatOptions, hoodOptions, torsoPortraitOptions, armPortraitOptions, indexEntries, optionCache, bodyColorRangesByGender, allowedCosmeticsByFighter, cosmeticWeightsByFighter, forcedCosmeticsByFighter, conditionalCosmeticsByFighter, randomizationRulesByFighter, mandatoryCosmeticSlotsByFighter, exclusiveCosmeticsByFighter };
}

// ── Seeded randomisation ───────────────────────────────────

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * Random color from a bodyColorRange stop table, driven by a provided rng().
 */
function randomColorFromRangeSeeded(range, rng) {
  if (!range) return { h: 0, s: 0, v: 0 };
  if (Array.isArray(range.choices) && range.choices.length) {
    const choices = range.choices
      .map((choice) => ({ range: choice?.range || choice, weight: Math.max(0, Number(choice?.weight ?? 1) || 0) }))
      .filter((choice) => choice.range && choice.weight > 0);
    const totalWeight = choices.reduce((sum, choice) => sum + choice.weight, 0);
    if (totalWeight > 0) {
      let roll = rng() * totalWeight;
      for (const choice of choices) {
        roll -= choice.weight;
        if (roll <= 0) return randomColorFromRangeSeeded(choice.range, rng);
      }
      return randomColorFromRangeSeeded(choices[choices.length - 1].range, rng);
    }
  }
  if (!range.stops || range.stops.length < 2) return { h: 0, s: 0, v: 0 };
  const h = range.minH + rng() * (range.maxH - range.minH);
  const stops = range.stops;
  let i = 0;
  while (i < stops.length - 2 && stops[i + 1].h <= h) i++;
  const s0 = stops[i], s1 = stops[i + 1];
  const t = s1.h === s0.h ? 0 : clamp((h - s0.h) / (s1.h - s0.h), 0, 1);
  const sMin = s0.sMin + t * (s1.sMin - s0.sMin);
  const sMax = s0.sMax + t * (s1.sMax - s0.sMax);
  const vMin = s0.vMin + t * (s1.vMin - s0.vMin);
  const vMax = s0.vMax + t * (s1.vMax - s0.vMax);
  return { h, s: sMin + rng() * (sMax - sMin), v: vMin + rng() * (vMax - vMin) };
}

/**
 * Generate random body colors driven by a provided rng().
 * bodyColorRanges is optional (from species data); falls back to BODYCOLOR_LIMITS.
 */
function randomBodyColorsSeeded(rng, bodyColorRanges) {
  const rh = (lo, hi) => lo + rng() * (hi - lo);
  function fallback(slot) {
    const lim = BODYCOLOR_LIMITS[slot];
    return { h: rh(lim.hMin, lim.hMax), s: rh(lim.sMin, lim.sMax), v: rh(lim.vMin, lim.vMax) };
  }
  const colorA = bodyColorRanges?.A ? randomColorFromRangeSeeded(bodyColorRanges.A, rng) : fallback('A');
  const colorB = bodyColorRanges?.deriveBFromA
    ? { h: colorA.h, s: colorA.s, v: colorA.v }
    : (bodyColorRanges?.B ? randomColorFromRangeSeeded(bodyColorRanges.B, rng) : fallback('B'));
  const colorC = bodyColorRanges?.deriveCFromA
    ? { h: colorA.h, s: Math.max(-1, Math.min(1, colorA.s + 0.05)), v: Math.max(-1, Math.min(1, colorA.v + 0.18)) }
    : (bodyColorRanges?.C ? randomColorFromRangeSeeded(bodyColorRanges.C, rng) : fallback('C'));
  return { A: colorA, B: colorB, C: colorC };
}

function randomInRange(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

function materialColorRangeFor(option) {
  const materialTag = option?.materialTag;
  if (!materialTag) return null;
  const materialPalettes = window.SCRATCHBONES_CONFIG?.cosmeticMaterialPalettes
    || window.CONFIG?.cosmeticMaterialPalettes;
  if (!materialPalettes || typeof materialPalettes !== 'object') return null;
  return materialPalettes[materialTag] || null;
}

function isMaterialTag(option, expectedTag) {
  if (!expectedTag || typeof expectedTag !== 'string') return false;
  return String(option?.materialTag || '').trim().toLowerCase() === expectedTag.trim().toLowerCase();
}

function portraitRandomizationConfig() {
  return window.SCRATCHBONES_CONFIG?.game?.portrait?.randomization
    || window.CONFIG?.portraitRandomization
    || {};
}

function portraitRandomizationMaterialTags() {
  return portraitRandomizationConfig().materialTags || {};
}

function configuredMaterialTag(name, fallback) {
  const configured = portraitRandomizationMaterialTags()?.[name];
  return (typeof configured === 'string' && configured.trim()) ? configured.trim().toLowerCase() : fallback;
}

function isClothPortraitOption(option, clothMaterialTag) {
  if (!option || option.id === 'none') return false;
  if (isMaterialTag(option, clothMaterialTag)) return true;
  // Older cloth cosmetics predate explicit material tags. Treat untyped
  // portrait clothing as cloth while preserving tagged non-cloth items such as
  // leather bandoliers and rigid-fiber hats.
  return !option.materialTag && (option.slot === 'hood' || option.slot === 'torso' || option.slot === 'overwear');
}


function requiredNpcClothingPaletteKeys() {
  return Array.isArray(portraitRandomizationConfig().npcRequiredClothingPaletteKeys)
    ? portraitRandomizationConfig().npcRequiredClothingPaletteKeys
        .map(key => String(key || '').trim())
        .filter(key => key && key !== 'A')
    : [];
}

function clothingFallbackTintSlotsBySlot() {
  const fallbackSlots = portraitRandomizationConfig().clothingFallbackTintSlotsBySlot;
  return fallbackSlots && typeof fallbackSlots === 'object' ? fallbackSlots : {};
}

function cloneColor(color) {
  return color && typeof color === 'object' ? { ...color } : null;
}

function colorForMissingClothingPaletteSlot({ baseColor, sourceRange, paletteRange, rng }) {
  const range = paletteRange || sourceRange;
  if (range && typeof rng === 'function') return randomColorFromRangeSeeded(range, rng);
  return cloneColor(baseColor) || { h: 0, s: 0, v: 0 };
}

function ensurePortraitClothingPaletteColors(profile, rng, options = {}) {
  if (!profile) return profile;
  const randomizationConfig = portraitRandomizationConfig();
  const clothingSlots = Array.isArray(randomizationConfig.clothingSlots) ? randomizationConfig.clothingSlots : [];
  const requiredKeys = requiredNpcClothingPaletteKeys();
  if (!clothingSlots.length || !requiredKeys.length) return profile;

  const bodyColors = { ...(profile.bodyColors || {}) };
  const fallbackTintSlots = clothingFallbackTintSlotsBySlot();
  const clothingRule = options.clothingRule || null;
  const ruleRange = clothingRule?.range || null;
  const paletteRanges = clothingRule?.paletteRanges && typeof clothingRule.paletteRanges === 'object'
    ? clothingRule.paletteRanges
    : null;
  const clothingRangeForPalette = (paletteKey) => paletteRanges?.[paletteKey] || ruleRange;

  for (const slot of clothingSlots) {
    const option = profile[slot];
    if (!option || option.id === 'none') continue;
    const layers = resolveOptionLayers(option, profile.fighter);
    if (!layers.length) continue;

    const baseTintSlot = option.tintSlot || fallbackTintSlots[slot] || null;
    if (!baseTintSlot) continue;

    const sourceRange = ruleRange || materialColorRangeFor(option) || option.colorRange || null;
    if (!bodyColors[baseTintSlot]) {
      bodyColors[baseTintSlot] = colorForMissingClothingPaletteSlot({
        baseColor: bodyColors.CLOTH || bodyColors.HOOD || bodyColors.HAT || bodyColors.A,
        sourceRange,
        paletteRange: clothingRangeForPalette('A'),
        rng,
      });
    }

    for (const paletteKey of requiredKeys) {
      const tintKey = `${baseTintSlot}_${paletteKey}`;
      if (bodyColors[tintKey]) continue;
      bodyColors[tintKey] = colorForMissingClothingPaletteSlot({
        baseColor: bodyColors[baseTintSlot],
        sourceRange,
        paletteRange: clothingRangeForPalette(paletteKey),
        rng,
      });
    }
  }

  profile.bodyColors = bodyColors;
  return profile;
}

function applyBodyColorRulesSeeded(bodyColors, rules, rng) {
  if (!bodyColors || !rules || typeof rules !== 'object') return bodyColors;
  const result = {
    ...bodyColors,
    A: bodyColors.A ? { ...bodyColors.A } : bodyColors.A,
    B: bodyColors.B ? { ...bodyColors.B } : bodyColors.B,
    C: bodyColors.C ? { ...bodyColors.C } : bodyColors.C
  };
  const brightnessRule = rules.brightnessContrastAB;
  if (!brightnessRule || !result.A || !result.B) return result;
  const medium = brightnessRule.medium;
  const bright = brightnessRule.bright;
  if (!medium || !bright) return result;
  const flip = rng() < 0.5;
  const slotA = flip ? 'A' : 'B';
  const slotB = flip ? 'B' : 'A';
  result[slotA].v = randomInRange(rng, medium.min, medium.max);
  result[slotB].v = randomInRange(rng, bright.min, bright.max);
  return result;
}

/**
 * Weighted random pick from an array, driven by rng().
 * weights: object mapping item.id to a numeric weight (items absent from the map default to 1).
 * Falls back to uniform pick when weights is null/undefined.
 *
 * To tune cosmetic odds, add a "cosmeticWeights" block to the species JSON (e.g. mao-ao.json)
 * under the gender section:
 *   "cosmeticWeights": {
 *     "hat":       { "none": 65, "basic_headband": 28, "riverlandskasa_low": 3.5, ... },
 *     "hairFront": { "none": 5, "smooth_striped": 5, "tuft": 30, ... },
 *     "hairBack":  { "none": 50, "long_ponytail": 25, "splayedknot_medium": 25 },
 *     "hairSide":  { "none": 90, "shoulder_length_drape": 10 }
 *   }
 * Optional per-hat occlusion can be configured under "randomizationRules.hatHideRules":
 *   "hatHideRules": {
 *     "riverlandskasa_low": { "hideSlots": ["hairFront", "hairBack"] },
 *     "basic_headband": { "hideSlots": [] }
 *   }
 * Unspecified categories use uniform random. Cosmetics missing from a weight map default to weight 1.
 * Weight 0 excludes an item from selection entirely.
 */
function weightedPickRng(arr, weights, rng) {
  if (!arr || arr.length === 0) return undefined;
  if (!weights) return arr[Math.floor(rng() * arr.length)];
  const hasWeightKey = (key) => Object.prototype.hasOwnProperty.call(weights, key);
  const resolveWeight = (optionId) => {
    if (hasWeightKey(optionId)) return weights[optionId];
    const underscoreIndex = typeof optionId === 'string' ? optionId.indexOf('_') : -1;
    if (underscoreIndex > 0) {
      const suffixId = optionId.slice(underscoreIndex + 1);
      if (hasWeightKey(suffixId)) return weights[suffixId];
    }
    return 1;
  };
  const w = arr.map(o => resolveWeight(o.id));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return arr[Math.floor(rng() * arr.length)];
  let r = rng() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= w[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

function resolvePortraitFighter(fighter) {
  if (!fighter) return fighter;
  const byId = FIGHTERS.find((candidate) => candidate?.id === fighter.id);
  if (byId) return byId;
  const byHead = fighter.headUrl
    ? FIGHTERS.find((candidate) => candidate?.headUrl === fighter.headUrl)
    : null;
  return byHead || fighter;
}

function noneOptionForSlot(options, fallbackLabel) {
  return options.find((option) => option?.id === 'none')
    ?? options[0]
    ?? { id: 'none', label: fallbackLabel, tintSlot: null, layers: [] };
}

function toHiddenSlotSet(rule) {
  if (!rule) return null;
  if (Array.isArray(rule.hideSlots)) {
    return new Set(rule.hideSlots.filter((slot) => typeof slot === 'string'));
  }
  if (Array.isArray(rule)) {
    return new Set(rule.filter((slot) => typeof slot === 'string'));
  }
  return null;
}

function hatHideRuleFor(hatId, randomizationRules) {
  if (!hatId || hatId === 'none') return null;
  const map = randomizationRules?.hatHideRules;
  if (!map || typeof map !== 'object') return null;
  return map[hatId] || null;
}

/**
 * Generate a fully deterministic random profile using a provided rng() function.
 * All option arrays must be supplied by the caller.
 * cosmeticWeightsByFighter (optional): object keyed by fighter.id, each value being a
 *   per-category weights map (see weightedPickRng docs above). When omitted the selection
 *   falls back to the original uniform-random behaviour.
 */
function randomProfileSeeded(rng, fighters, hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions, eyesOptions, upperFaceOptions, facialHairOptions, bodyColorRangesByGender, allowedCosmeticsByFighter, hatOptions, hoodOptions, cosmeticWeightsByFighter, torsoPortraitOptions, armPortraitOptions, forcedCosmeticsByFighter, conditionalCosmeticsByFighter, randomizationRulesByFighter, mandatoryCosmeticSlotsByFighter, exclusiveCosmeticsByFighter) {
  const pickRng   = (arr) => arr[Math.floor(rng() * arr.length)];
  const fighterInput = pickRng(fighters);
  const fighter = resolvePortraitFighter(fighterInput);
  if (Array.isArray(upperFaceOptions) && !Array.isArray(facialHairOptions)) {
    randomizationRulesByFighter = conditionalCosmeticsByFighter;
    conditionalCosmeticsByFighter = forcedCosmeticsByFighter;
    forcedCosmeticsByFighter = armPortraitOptions;
    armPortraitOptions = torsoPortraitOptions;
    torsoPortraitOptions = cosmeticWeightsByFighter;
    cosmeticWeightsByFighter = hoodOptions;
    hoodOptions = hatOptions;
    hatOptions = allowedCosmeticsByFighter;
    allowedCosmeticsByFighter = bodyColorRangesByGender;
    bodyColorRangesByGender = facialHairOptions;
    facialHairOptions = upperFaceOptions;
    upperFaceOptions = [{ id: 'none', label: 'No Upper Face', tintSlot: null, layers: [] }];
  }
  const fighterEntry = allowedCosmeticsByFighter?.[fighter.id] ?? allowedCosmeticsByFighter?.[fighterInput?.id];
  const allowed   = fighterEntry instanceof Set ? fighterEntry : (fighterEntry?.set ?? null);
  const disallowedCombos = (fighterEntry instanceof Set ? [] : (fighterEntry?.disallowedCombos ?? []));
  const allowedPrefixes = allowed
    ? new Set(
      Array.from(allowed)
        .filter(id => typeof id === 'string' && id.includes('_'))
        .map(id => id.slice(0, id.indexOf('_')))
    )
    : null;
  const isAllowedId = (optionId) => {
    if (!allowed) return true;
    if (allowed.has(optionId)) return true;
    const underscoreIndex = typeof optionId === 'string' ? optionId.indexOf('_') : -1;
    if (underscoreIndex > 0) {
      const prefixId = optionId.slice(0, underscoreIndex);
      if (!allowedPrefixes?.has(prefixId)) return false;
      const suffixId = optionId.slice(underscoreIndex + 1);
      if (allowed.has(suffixId)) return true;
    }
    return false;
  };
  const filterArr = (arr) => arr && allowed ? arr.filter(o => o.id === 'none' || isAllowedId(o.id)) : arr;
  const weights   = cosmeticWeightsByFighter?.[fighter.id] ?? cosmeticWeightsByFighter?.[fighterInput?.id] ?? null;
  const mandatorySlots = new Set(
    (mandatoryCosmeticSlotsByFighter?.[fighter.id] ?? mandatoryCosmeticSlotsByFighter?.[fighterInput?.id] ?? [])
      .map(slot => String(slot || ''))
      .filter(Boolean)
  );
  const exclusiveBySlot = exclusiveCosmeticsByFighter?.[fighter.id] ?? exclusiveCosmeticsByFighter?.[fighterInput?.id] ?? {};
  const applySlotRules = (arr, slot) => {
    if (!Array.isArray(arr)) return arr;
    let out = arr;
    const exclusiveIds = new Set((exclusiveBySlot?.[slot] || []).map(id => String(id || '')));
    if (exclusiveIds.size) out = out.filter(option => option.id === 'none' || exclusiveIds.has(option.id));
    if (mandatorySlots.has(slot)) out = out.filter(option => option.id !== 'none');
    return out;
  };

  const filteredHairFront  = applySlotRules(filterArr(hairFrontOptions), 'hairFront')  ?? [];
  const filteredHairBack   = applySlotRules(filterArr(hairBackOptions), 'hairBack')   ?? [];
  const filteredHairSide   = applySlotRules(filterArr(hairSideOptions), 'hairSide')   ?? [];
  const filteredHairSideL  = applySlotRules(filterArr(hairSideLOptions), 'hairSideL')  ?? [];
  const filteredEyes       = applySlotRules(filterArr(eyesOptions), 'eyes')       ?? [];
  const filteredUpperFace  = applySlotRules(filterArr(upperFaceOptions), 'upperFace')  ?? [];
  const filteredFacialHair = applySlotRules(filterArr(facialHairOptions), 'facialHair') ?? [];
  const filteredHat        = applySlotRules(filterArr(hatOptions), 'hat') ?? [{ id: 'none', label: 'No Hat', tintSlot: null, layers: [] }];
  const filteredHood       = applySlotRules(filterArr(hoodOptions), 'hood') ?? [{ id: 'none', label: 'No Hood', tintSlot: null, layers: [] }];

  let hairFront  = weightedPickRng(filteredHairFront.length  ? filteredHairFront  : [{ id: 'none', label: 'No Front Hair', tintSlot: null, layers: [] }], weights?.hairFront,  rng);
  let hairBack   = weightedPickRng(filteredHairBack.length   ? filteredHairBack   : [{ id: 'none', label: 'No Back Hair',  tintSlot: null, layers: [] }], weights?.hairBack,   rng);
  let hairSide   = weightedPickRng(filteredHairSide.length   ? filteredHairSide   : [{ id: 'none', label: 'No Side Hair (R)',  tintSlot: null, layers: [] }], weights?.hairSide,   rng);
  let hairSideL  = weightedPickRng(filteredHairSideL.length  ? filteredHairSideL  : [{ id: 'none', label: 'No Side Hair (L)',  tintSlot: null, layers: [] }], weights?.hairSideL,  rng);
  let eyes         = weightedPickRng(filteredEyes.length       ? filteredEyes       : [{ id: 'none', label: 'No Eye Mark',   tintSlot: null, layers: [] }], weights?.eyes,       rng);
  let upperFace    = weightedPickRng(filteredUpperFace.length  ? filteredUpperFace  : [{ id: 'none', label: 'No Upper Face', tintSlot: null, layers: [] }], weights?.upperFace, rng);
  const noFacialHair = filteredFacialHair.find(o => o.id === 'none') ?? filteredFacialHair[0] ?? { id: 'none', label: 'No Facial Hair', tintSlot: null, layers: [] };
  let facialHair = weights?.facialHair
    ? weightedPickRng(filteredFacialHair.length ? filteredFacialHair : [noFacialHair], weights.facialHair, rng)
    : (rng() < 0.35 ? pickRng(filteredFacialHair.length ? filteredFacialHair : [noFacialHair]) : noFacialHair);
  const noHat      = filteredHat.find(o => o.id === 'none') ?? filteredHat[0];
  // When hat weights are configured, use a single weighted pick (weights include 'none').
  // Otherwise fall back to the original 50%-skip + uniform-pick behaviour.
  let hat = weights?.hat
    ? weightedPickRng(filteredHat.length ? filteredHat : [noHat], weights.hat, rng)
    : (rng() < 0.5 ? pickRng(filteredHat) : noHat);
  const noHood     = filteredHood.find(o => o.id === 'none') ?? filteredHood[0];
  let hood = weights?.hood
    ? weightedPickRng(filteredHood.length ? filteredHood : [noHood], weights.hood, rng)
    : noHood;

  // Enforce disallowed cosmetic combination rules.
  // Each rule specifies conditions (slot-value pairs that must all match) and
  // repairSlots (slots to try forcing to a non-none option, tried in random order).
  if (disallowedCombos.length) {
    const filteredBySlot = { hairFront: filteredHairFront, hairBack: filteredHairBack, hairSide: filteredHairSide, hairSideL: filteredHairSideL };
    let maxIter = disallowedCombos.length * 2 + 1;
    let violated = true;
    while (violated && maxIter-- > 0) {
      violated = false;
      for (const rule of disallowedCombos) {
        const cur = { hairFront, hairBack, hairSide, hairSideL };
        const matches = Object.entries(rule.conditions).every(([slot, val]) => cur[slot]?.id === val);
        if (!matches || !rule.repairSlots.length) continue;
        violated = true;
        const slots = rule.repairSlots.slice();
        if (slots.length >= 2 && rng() < 0.5) slots.reverse();
        for (const slot of slots) {
          const nonNone = (filteredBySlot[slot] || []).filter(o => o.id !== 'none');
          if (nonNone.length) {
            if      (slot === 'hairFront')  hairFront  = pickRng(nonNone);
            else if (slot === 'hairBack')   hairBack   = pickRng(nonNone);
            else if (slot === 'hairSide')   hairSide   = pickRng(nonNone);
            else if (slot === 'hairSideL')  hairSideL  = pickRng(nonNone);
            break;
          }
        }
        break; // restart rule checking after each repair
      }
    }
  }

  const hasAllowedClothingVariant = (o) => (o.id === 'none' || isAllowedId(o.id))
    && (o.id === 'none' || resolveOptionLayers(o, fighter).length > 0);
  const filteredTorso = (torsoPortraitOptions ?? []).filter(hasAllowedClothingVariant);
  const filteredArm   = (armPortraitOptions   ?? []).filter(hasAllowedClothingVariant);
  const torsoCosmetic = weightedPickRng(filteredTorso.length ? filteredTorso : [{ id: 'none', label: 'No Torso Clothing', tintSlot: null, layers: [] }], weights?.torso, rng);
  const armCosmetic   = weightedPickRng(filteredArm.length   ? filteredArm   : [{ id: 'none', label: 'No Arm Clothing',   tintSlot: null, layers: [] }], weights?.overwear, rng);

  // Apply forced cosmetics — species-level slots that always override random selection.
  const forced = forcedCosmeticsByFighter?.[fighter.id] ?? forcedCosmeticsByFighter?.[fighterInput?.id];
  if (forced) {
    const filteredBySlot = { eyes: filteredEyes, upperFace: filteredUpperFace, facialHair: filteredFacialHair, hairFront: filteredHairFront, hairBack: filteredHairBack, hairSide: filteredHairSide, hairSideL: filteredHairSideL, hat: filteredHat, hood: filteredHood };
    for (const [slot, id] of Object.entries(forced)) {
      const opt = filteredBySlot[slot]?.find(o => o.id === id);
      if (!opt) continue;
      if      (slot === 'eyes')       eyes      = opt;
      else if (slot === 'upperFace')  upperFace = opt;
      else if (slot === 'facialHair') facialHair = opt;
      else if (slot === 'hairFront')  hairFront  = opt;
      else if (slot === 'hairBack')   hairBack   = opt;
      else if (slot === 'hairSide')   hairSide   = opt;
      else if (slot === 'hairSideL')  hairSideL  = opt;
      else if (slot === 'hat')        hat        = opt;
      else if (slot === 'hood')       hood       = opt;
    }
  }

  // Apply conditional cosmetics — rules that fire based on current slot state and clothing tags.
  const conditionals = conditionalCosmeticsByFighter?.[fighter.id] ?? conditionalCosmeticsByFighter?.[fighterInput?.id];
  if (conditionals) {
    const curSlots = { hairFront, hairBack, hairSide, hairSideL, eyes, upperFace, facialHair, hat, hood };
    const filteredBySlot = { eyes: filteredEyes, upperFace: filteredUpperFace, facialHair: filteredFacialHair, hairFront: filteredHairFront, hairBack: filteredHairBack, hairSide: filteredHairSide, hairSideL: filteredHairSideL, hat: filteredHat, hood: filteredHood };
    for (const rule of conditionals) {
      const met = Object.entries(rule.conditions).every(([key, val]) => {
        if (key === 'anyClothingTag') return [torsoCosmetic, armCosmetic].some(c => c?.tags?.includes(val));
        return curSlots[key]?.id === val;
      });
      if (!met) continue;
      const opt = (filteredBySlot[rule.slot] || []).find(o => o.id === rule.cosmeticId);
      if (!opt) continue;
      if      (rule.slot === 'eyes')       eyes      = opt;
      else if (rule.slot === 'facialHair') facialHair = opt;
      else if (rule.slot === 'hairFront')  hairFront  = opt;
      else if (rule.slot === 'hairBack')   hairBack   = opt;
      else if (rule.slot === 'hairSide')   hairSide   = opt;
      else if (rule.slot === 'hairSideL')  hairSideL  = opt;
      else if (rule.slot === 'hat')        hat        = opt;
      else if (rule.slot === 'hood')       hood       = opt;
    }
  }

  const ruleMap = randomizationRulesByFighter || LAST_RANDOMIZATION_RULES_BY_FIGHTER || null;
  const randomizationRules = ruleMap?.[fighter.id] ?? ruleMap?.[fighterInput?.id] ?? null;
  const hatHideSlots = toHiddenSlotSet(hatHideRuleFor(hat?.id, randomizationRules));
  if (hatHideSlots?.size) {
    if (hatHideSlots.has('hairFront')) {
      hairFront = noneOptionForSlot(filteredHairFront, 'No Front Hair');
    }
    if (hatHideSlots.has('hairBack')) {
      hairBack = noneOptionForSlot(filteredHairBack, 'No Back Hair');
    }
    if (hatHideSlots.has('hairSide')) {
      hairSide = noneOptionForSlot(filteredHairSide, 'No Side Hair (R)');
    }
    if (hatHideSlots.has('hairSideL')) {
      hairSideL = noneOptionForSlot(filteredHairSideL, 'No Side Hair (L)');
    }
    if (hatHideSlots.has('facialHair')) {
      facialHair = noneOptionForSlot(filteredFacialHair, 'No Facial Hair');
    }
  }

  let bodyColors = randomBodyColorsSeeded(rng, bodyColorRangesByGender?.[fighter.id] ?? bodyColorRangesByGender?.[fighterInput?.id]);
  bodyColors = applyBodyColorRulesSeeded(bodyColors, randomizationRules, rng);

  const randomizationConfig = portraitRandomizationConfig();
  const clothingRule = randomizationRules?.clothingColors;
  const torsoLayers = resolveOptionLayers(torsoCosmetic, fighter);
  const armLayers = resolveOptionLayers(armCosmetic, fighter);
  const hoodLayers = resolveOptionLayers(hood, fighter);
  const hasClothPiece = Boolean(torsoLayers.length || armLayers.length);
  const hasHoodPiece = Boolean(hoodLayers.length);
  const syncAcrossPieces = clothingRule?.syncAcrossPieces === true;
  const ruleRange = clothingRule?.range || null;
  const paletteRanges = clothingRule?.paletteRanges && typeof clothingRule.paletteRanges === 'object'
    ? clothingRule.paletteRanges
    : null;
  const clothingRangeForPalette = (paletteKey) => paletteRanges?.[paletteKey] || ruleRange;
  const useSharedClothingRuleRange = syncAcrossPieces && Boolean(ruleRange || paletteRanges);
  const clothMaterialTag = configuredMaterialTag('cloth', 'cloth');
  const clothHoodColorSourceSlots = Array.isArray(randomizationConfig.clothHoodColorSourceSlots)
    ? randomizationConfig.clothHoodColorSourceSlots
    : [];
  const clothingBySlot = { armCosmetic, torsoCosmetic };
  const clothHoodColorSource = clothHoodColorSourceSlots
    .map(slot => clothingBySlot[slot])
    .find(option => isClothPortraitOption(option, clothMaterialTag) && resolveOptionLayers(option, fighter).length)
    || null;
  const clothSourceOption = clothHoodColorSource
    || (isClothPortraitOption(armCosmetic, clothMaterialTag) ? armCosmetic : null)
    || (isClothPortraitOption(torsoCosmetic, clothMaterialTag) ? torsoCosmetic : null);
  const clothSourceRange = ruleRange || clothSourceOption?.colorRange || null;
  const hoodMaterialRange = materialColorRangeFor(hood);
  const hoodSourceRange = ruleRange || hoodMaterialRange || hood?.colorRange || null;
  const hoodUsesClothMaterial = isClothPortraitOption(hood, clothMaterialTag);
  const hatUsesClothMaterial = isMaterialTag(hat, clothMaterialTag);
  const hatMaterialRange = materialColorRangeFor(hat);
  const hatSourceRange = hatMaterialRange
    || (hatUsesClothMaterial ? (ruleRange || hat?.colorRange || null) : (hat?.colorRange || null));
  // 'BODY' and 'NONE' are resolveLayerTintSlot's reserved bypass keys (see
  // that function) -- neither is ever actually read as a `${group.tintSlot}_*`
  // color, so generating a random one for them here would be pure clutter
  // (and, before this exclusion existed, was exactly why an "always
  // untinted" overlay like a tusk still ended up with a random dye color).
  const usedPaletteKeys = (layers) => new Set((layers || [])
    .map(layer => layer?.paletteColorKey)
    .filter(key => typeof key === 'string' && key && key !== 'A' && key !== 'BODY' && key !== 'NONE'));

  if ((hasClothPiece || (useSharedClothingRuleRange && hasHoodPiece)) && clothSourceRange) {
    bodyColors.CLOTH = randomColorFromRangeSeeded(clothingRangeForPalette('A') || clothSourceRange, rng);
    const clothPaletteKeys = usedPaletteKeys([...torsoLayers, ...armLayers]);
    if (useSharedClothingRuleRange) {
      for (const paletteKey of Object.keys(paletteRanges || {})) {
        if (paletteKey === 'A') continue;
        bodyColors[`CLOTH_${paletteKey}`] = randomColorFromRangeSeeded(clothingRangeForPalette(paletteKey) || clothSourceRange, rng);
      }
    }
    for (const paletteKey of clothPaletteKeys) {
      bodyColors[`CLOTH_${paletteKey}`] = randomColorFromRangeSeeded(clothingRangeForPalette(paletteKey) || clothSourceRange, rng);
    }
  }
  if (hasHoodPiece && hoodSourceRange) {
    if (useSharedClothingRuleRange && bodyColors.CLOTH) {
      bodyColors.HOOD = bodyColors.CLOTH;
      for (const paletteKey of usedPaletteKeys(hoodLayers)) {
        bodyColors[`HOOD_${paletteKey}`] = bodyColors[`CLOTH_${paletteKey}`] || bodyColors.CLOTH;
      }
    } else {
      bodyColors.HOOD = randomColorFromRangeSeeded(clothingRangeForPalette('A') || hoodSourceRange, rng);
      for (const paletteKey of usedPaletteKeys(hoodLayers)) {
        bodyColors[`HOOD_${paletteKey}`] = randomColorFromRangeSeeded(clothingRangeForPalette(paletteKey) || hoodSourceRange, rng);
      }
    }
  }
  if (!useSharedClothingRuleRange && hasHoodPiece && hoodUsesClothMaterial && clothHoodColorSource && bodyColors.CLOTH) {
    bodyColors.HOOD = bodyColors.CLOTH;
    for (const paletteKey of usedPaletteKeys(hoodLayers)) {
      bodyColors[`HOOD_${paletteKey}`] = bodyColors[`CLOTH_${paletteKey}`] || bodyColors.CLOTH;
    }
  }
  if (hatSourceRange) {
    bodyColors.HAT = (syncAcrossPieces && hatUsesClothMaterial && bodyColors.CLOTH)
      ? bodyColors.CLOTH
      : randomColorFromRangeSeeded(hatSourceRange, rng);
  }
  return ensurePortraitClothingPaletteColors(
    { fighter, hairFront, hairBack, hairSide, hairSideL, hood, eyes, upperFace, facialHair, hat, torsoCosmetic, armCosmetic, bodyColors },
    rng,
    { clothingRule }
  );
}


async function preloadAllPortraitSprites(cosmeticsData) {
  const relPaths = new Set();
  const EXPRESSIONS = ['neutral', 'smile', 'frown', 'laugh'];
  const seenFighters = new Set();
  for (const fighter of FIGHTERS) {
    if (fighter.headUrl) relPaths.add(fighter.headUrl);
    for (const layer of fighter.bodyLayers || []) { if (layer.url) relPaths.add(layer.url); }
    for (const layer of fighter.urLayers || []) {
      if (layer.url) {
        relPaths.add(layer.url);
        relPaths.add(layer.url.replace(/\.png$/i, '_blink.png'));
      }
    }
    // Mouth expression sprites are dynamically computed, not in optionCache
    const fKey = `${fighter.speciesId}_${fighter.gender}`;
    if (!seenFighters.has(fKey)) {
      seenFighters.add(fKey);
      for (const expr of EXPRESSIONS) {
        const url = _getMouthSpriteUrl(expr, fighter.speciesId, fighter.gender);
        if (url) relPaths.add(url);
      }
    }
  }
  if (cosmeticsData?.optionCache) {
    for (const opt of cosmeticsData.optionCache.values()) {
      for (const layer of opt.layers || []) { if (layer.url) relPaths.add(layer.url); }
      for (const layers of Object.values(opt.variantLayers || {})) {
        for (const layer of layers || []) { if (layer.url) relPaths.add(layer.url); }
      }
    }
  }
  await Promise.all([...relPaths].map(url => loadImg(url).catch(() => null)));
}

window.setPortraitConfig = setPortraitConfig;
window.getPortraitFighters = () => FIGHTERS;
window.preloadAllPortraitSprites = preloadAllPortraitSprites;
window.getPortraitXformPreset = getPortraitXformPreset;

renderProfile.defaultBehindLayerOrder = [
  'sideLeft', 'rightSideHair',
  'baseLeftArm', 'baseTorso', 'baseRightArm',
  'head', 'frontHair',
  'torsoClothing', 'overwear', 'hatUnder', 'hood', 'pauldron', 'hatOver',
  'snowgoggles',
  'hairBack',
];

window.loadPortraitCosmetics = loadPortraitCosmetics;
window.renderPortraitProfile = renderProfile;
// renderProfile is also exported as window.renderProfile for consumers that check that name
// (bootstrap.js, scratchbones-lobby.js).
window.renderProfile = renderProfile;
window.randomPortraitProfileSeeded = randomProfileSeeded;
window.randomColorFromRangeSeeded = randomColorFromRangeSeeded;
window.ensurePortraitClothingPaletteColors = ensurePortraitClothingPaletteColors;
window.drawPortraitLayerWarped = drawPortraitLayerWarped;
