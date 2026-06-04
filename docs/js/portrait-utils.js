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
    'https://raw.githubusercontent.com/Oolnokk/SoKEmpirePrologue/main/docs/assets/' + relPath,
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

  const promise = (async () => {
    const attemptedUrls = [];
    for (const url of uniqueCandidates) {
      attemptedUrls.push(url);
      try {
        return await tryLoadUrl(url);
      } catch (_) {
        // Try next candidate URL.
      }
    }
    const error = new Error(`Failed to load portrait asset "${relPath}"`);
    error.name = 'PortraitImageLoadError';
    error.relPath = relPath;
    error.attemptedUrls = attemptedUrls;
    throw error;
  })();

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

// ── Canvas helpers ─────────────────────────────────────────

function drawPortraitLayer(ctx, img, xform, cssFilter) {
  const { ax, ay, sx, sy } = xform;
  const h  = PORTRAIT_L * sy;
  const w  = (img.naturalWidth / img.naturalHeight) * PORTRAIT_L * sx;
  const cx = PORTRAIT_CW / 2 + ay * PORTRAIT_L;
  const cy = PORTRAIT_CH / 2 - ax * PORTRAIT_L;
  ctx.save();
  ctx.filter = cssFilter || 'none';
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
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
function drawPortraitLayerWarped(ctx, img, xform, cssFilter, breathingComposer, speciesId, gender, nowMs, phaseOffsetMs, seatId, staticDeform) {
  const { ax, ay, sx, sy } = xform;
  const h  = PORTRAIT_L * sy;
  const w  = (img.naturalWidth / img.naturalHeight) * PORTRAIT_L * sx;
  const cx = PORTRAIT_CW / 2 + ay * PORTRAIT_L;
  const cy = PORTRAIT_CH / 2 - ax * PORTRAIT_L;
  const layerX = cx - w / 2;
  const layerY = cy - h / 2;

  const breathingPts = breathingComposer?.getInterpolatedPoints(speciesId, gender, nowMs, phaseOffsetMs, seatId);
  if (!breathingPts && !staticDeform) {
    ctx.save();
    ctx.filter = cssFilter || 'none';
    ctx.drawImage(img, layerX, layerY, w, h);
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
  ctx.filter = cssFilter || 'none';
  _drawPortraitLayerWarped(ctx, img, layerX, layerY, w, h, neutralPts, finalPts, gridCols, gridRows);
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
  'kenkari':  { sprite: 'kenkari',  gendered: false,  masked: true  },
  'rakakoan': { sprite: 'kenkari',  gendered: false,  masked: true  },
};

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

// ── Rendering ──────────────────────────────────────────────

async function renderProfile(canvas, profile, renderOptions = {}) {
  const { fighter, hair, hairFront, hairBack, hairSide, hairSideL, hood, eyes, upperFace, facialHair, pauldron, hat, torsoCosmetic, armCosmetic, bodyColors } = profile;
  const omitHeadSpriteAndCosmetics = renderOptions?.omitHeadSpriteAndCosmetics === true;
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
  const headUrl = renderHeadSprite ? (resolvedFighter?.headUrl || fighter?.headUrl) : null;
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

  const filterFor = (slot) => slot ? makeCSSFilter(bodyColors[slot]) : 'none';
  const filterA   = makeCSSFilter(bodyColors.A);

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
    target.push({ layer, filter: filterFor(layer.tintSlot || 'A') });
  }
  for (const group of [torsoCosmetic, armCosmetic]) {
    if (!group) continue;
    const groupLayers = resolveOptionLayers(group, resolvedFighter);
    if (!groupLayers.length) continue;
    for (const layer of groupLayers) {
      const target = group?.slot === 'torso' ? torsoClothingLayers : overwearLayers;
      const key = layer.paletteColorKey;
      const layerTintSlot = (!key || key === 'A') ? group.tintSlot
        : (group.tintSlot ? `${group.tintSlot}_${key}` : null);
      target.push({ layer, filter: filterFor(layerTintSlot || 'A') });
    }
  }

  // Support both three-slot (hairBack/hairSide/hairFront) and legacy single-slot (hair).
  const hatIsUnderHood = hatLayersUnderHood(hat);
  const eyesLayerAboveUnderHoodHat = eyeAccessoryLayersAboveUnderHoodHat(eyes, hat);
  const hoodHideFrontAndSideHair = Boolean(resolveOptionLayers(hood, resolvedFighter).length);
  const hiddenCosmeticGroups = hoodHideFrontAndSideHair ? new Set([hairFront, hairSide, hairSideL]) : null;

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
      const layerTintSlot = (!key || key === 'A') ? group.tintSlot
        : (group.tintSlot ? `${group.tintSlot}_${key}` : null);
      target.push({ layer, filter: filterFor(layerTintSlot), group });
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
          const layerTintSlot = (!key || key === 'A') ? group.tintSlot
            : (group.tintSlot ? `${group.tintSlot}_${key}` : null);
          preBackLayers.push({ layer, filter: filterFor(layerTintSlot), group });
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
          const layerTintSlot = (!key || key === 'A') ? hat.tintSlot
            : (hat.tintSlot ? `${hat.tintSlot}_${key}` : null);
          (hatIsUnderHood ? hatUnderLayers : hatOverLayers).push({ layer, filter: filterFor(layerTintSlot), group: hat });
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
        const layerTintSlot = (!key || key === 'A') ? group.tintSlot
          : (group.tintSlot ? `${group.tintSlot}_${key}` : null);
        (layer.pos === 'back' ? preBackLayers : frontHairLayers).push({ layer, filter: filterFor(layerTintSlot), group });
      }
    }
  }

  // Resolve species/gender and mouth expression before building neededUrls so the
  // mouth sprite URL is included in the prefetch batch.
  const speciesId = resolvedFighter?.speciesId || fighter?.speciesId || '';
  const gender    = resolvedFighter?.gender    || fighter?.gender    || '';
  const _preloadNowMs   = Date.now();
  const mouthExpression = breathingComposer?.getExpression(seatId, _preloadNowMs) ?? 'neutral';
  const mouthSpriteUrl  = _getMouthSpriteUrl(mouthExpression, speciesId, gender);
  const mouthOpacity    = _getMouthExpressionOpacity(mouthExpression, speciesId);

  const neededUrls = new Set([
    ...(headUrl ? [headUrl] : []),
    ...urLayerSource.map(m => m.url),
    ...preBackLayers.map(({ layer }) => layer.url),
    ...baseLeftArmLayers.map(({ layer }) => layer.url),
    ...baseTorsoLayers.map(({ layer }) => layer.url),
    ...baseRightArmLayers.map(({ layer }) => layer.url),
    ...torsoClothingLayers.map(({ layer }) => layer.url),
    ...overwearLayers.map(({ layer }) => layer.url),
    ...sideLeftLayers.map(({ layer }) => layer.url),
    ...rightSideHairLayers.map(({ layer }) => layer.url),
    ...facialHairLayers.map(({ layer }) => layer.url),
    ...eyesLayers.map(({ layer }) => layer.url),
    ...upperFaceLayers.map(({ layer }) => layer.url),
    ...frontHairLayers.map(({ layer }) => layer.url),
    ...hatUnderLayers.map(({ layer }) => layer.url),
    ...elevatedEyeAccessoryLayers.map(({ layer }) => layer.url),
    ...hoodLayers.map(({ layer }) => layer.url),
    ...pauldronLayers.map(({ layer }) => layer.url),
    ...hatOverLayers.map(({ layer }) => layer.url),
    ...(opacityMaskLayer?.url ? [opacityMaskLayer.url] : []),
    ...blinkOverlayUrlsByBase.values(),
  ].filter(Boolean));

  let imgMap;
  // Fast synchronous path: all images already resolved in cache — avoid async overhead.
  const _allUrls = [...neededUrls];
  const _allResolved = _allUrls.every(url => IMG_CACHE.get(url) instanceof Image);
  if (_allResolved) {
    imgMap = new Map(_allUrls.map(url => [url, IMG_CACHE.get(url)]));
  } else {
    try {
      const entries = await Promise.all(
        _allUrls.map(async (url) => [url, await loadImg(url)])
      );
      imgMap = new Map(entries);
    } catch (err) {
      console.warn('[portrait] image load error', {
        message: err?.message || String(err),
        name: err?.name || 'Error',
        relPath: err?.relPath || null,
        attemptedUrls: Array.isArray(err?.attemptedUrls) ? err.attemptedUrls : [],
      });
      ctx.fillStyle = '#220000'; ctx.fillRect(0, 0, PORTRAIT_CW, PORTRAIT_CH);
      ctx.fillStyle = '#ff4444'; ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.strokeText('Load error', PORTRAIT_CW / 2, PORTRAIT_CH / 2);
      ctx.fillText('Load error', PORTRAIT_CW / 2, PORTRAIT_CH / 2);
      if (_needsScale) ctx.restore();
      return;
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
  const isBlinkFrame = shouldRenderBlink(headUrl, nowMs);
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
  const drawLayerWithEmote = (img, xform, filter, alpha = 1) => {
    const numericAlpha = Number(alpha);
    const opacity = Number.isFinite(numericAlpha) ? Math.max(0, Math.min(1, numericAlpha)) : 1;
    if (opacity <= 0) return;
    if (emoteDeformedPts) {
      const { ax, ay, sx, sy } = xform;
      const h = PORTRAIT_L * sy;
      const w = (img.naturalWidth / img.naturalHeight) * PORTRAIT_L * sx;
      const cx = PORTRAIT_CW / 2 + ay * PORTRAIT_L;
      const cy = PORTRAIT_CH / 2 - ax * PORTRAIT_L;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.filter = filter || 'none';
      _drawPortraitLayerWarped(ctx, img, cx - w / 2, cy - h / 2, w, h, emoteNeutralPts, emoteDeformedPts, 4, 6);
      ctx.restore();
    } else if (opacity < 1) {
      ctx.save();
      ctx.globalAlpha = opacity;
      drawPortraitLayer(ctx, img, xform, filter);
      ctx.restore();
    } else {
      drawPortraitLayer(ctx, img, xform, filter);
    }
  };

  // Draws a list of layers with emote deformation applied to each (head, hair, eyes, hat, etc.).
  const drawEmoteLayers = (layerList) => {
    for (const { layer, filter } of layerList) {
      const img = imgMap.get(layer.url);
      if (img) drawLayerWithEmote(img, resolveXform(layer), filter);
    }
  };

  // Draws body/cosmetic/hood layers with full breathing + emote deformation.
  const drawBreathingLayers = (layerList) => {
    for (const { layer, filter } of layerList) {
      const img = imgMap.get(layer.url);
      if (!img) continue;
      if (breathingComposer || staticDeform) {
        drawPortraitLayerWarped(ctx, img, resolveXform(layer), filter, breathingComposer, speciesId, gender, nowMs, breathingPhaseOffset, seatId, staticDeform);
      } else {
        drawPortraitLayer(ctx, img, resolveXform(layer), filter);
      }
    }
  };

  drawEmoteLayers(preBackLayers);
  drawBreathingLayers(baseLeftArmLayers);
  drawBreathingLayers(baseTorsoLayers);
  drawBreathingLayers(baseRightArmLayers);
  drawBreathingLayers(torsoClothingLayers);
  drawBreathingLayers(overwearLayers);
  drawEmoteLayers(sideLeftLayers);
  if (headUrl) { const img = imgMap.get(headUrl); if (img) drawLayerWithEmote(img, getPortraitXformPreset('B'), filterA); }
  const _isMaskSpecies = mouthImg && _isMouthMask(speciesId);
  drawEmoteLayers(rightSideHairLayers);
  drawEmoteLayers(facialHairLayers);
  drawEmoteLayers(frontHairLayers);
  drawEmoteLayers(eyesLayers);
  // Kenkari mask species: draw ur-head layers onto an offscreen canvas then punch out the
  // mouth shape (destination-out) before compositing the result onto the main canvas.
  // All other species draw ur-head directly.
  if (_isMaskSpecies && urLayerSource.length) {
    const { canvas: urOff, ctx: urCtx } = _getUrMaskCanvas(PORTRAIT_CW, PORTRAIT_CH);
    urCtx.clearRect(0, 0, PORTRAIT_CW, PORTRAIT_CH);
    const urXform = getPortraitXformPreset('B');
    for (const mid of urLayerSource) {
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
    for (const mid of urLayerSource) {
      const activeUrl = isBlinkFrame ? (blinkOverlayUrlsByBase.get(mid.url) || mid.url) : mid.url;
      const img = imgMap.get(activeUrl) || imgMap.get(mid.url);
      if (img) drawLayerWithEmote(img, getPortraitXformPreset('B'), 'none');
    }
  }
  // Non-mask species: mouth sprite overlays ur-head (drawn here so it sits above ur-head).
  if (mouthImg && !_isMaskSpecies) drawLayerWithEmote(mouthImg, getPortraitXformPreset('B'), 'none', mouthOpacity);
  drawEmoteLayers(upperFaceLayers);
  drawEmoteLayers(hatUnderLayers);
  drawEmoteLayers(elevatedEyeAccessoryLayers);
  drawBreathingLayers(hoodLayers);
  drawEmoteLayers(pauldronLayers);
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
function portraitVariantKeysForFighter(fighter) {
  const speciesId = String(fighter?.speciesId || '').trim();
  const gender = String(fighter?.gender || '').trim();
  if (!speciesId || !gender) return [];
  const keys = [
    `${speciesId}_${gender}`,
    `${speciesId.replace(/_/g, '-')}_${gender}`,
    `${speciesId.replace(/-/g, '_')}_${gender}`,
  ];
  const parentSpeciesId = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species?.[speciesId]?.parentSpecies;
  if (parentSpeciesId) {
    keys.push(
      `${parentSpeciesId}_${gender}`,
      `${parentSpeciesId.replace(/_/g, '-')}_${gender}`,
      `${parentSpeciesId.replace(/-/g, '_')}_${gender}`,
    );
  }
  return [...new Set(keys)];
}

function resolveOptionLayers(option, fighter) {
  if (!option) return [];
  const vl = option.variantLayers;
  if (vl && fighter) {
    for (const key of portraitVariantKeysForFighter(fighter)) {
      const resolved = vl[key];
      if (resolved && resolved.length) return resolved;
    }
  }
  return option.layers || [];
}

function portraitOptionFromJson(entry, json) {
  const label    = (json.meta && json.meta.name) || entry.id.split('::').pop().replace(/^mao-ao_/i, '').replace(/_/g, ' ');
  const tintSlot = (json.appearance && json.appearance.bodyColors && json.appearance.bodyColors[0]) || null;
  const shortId  = entry.id.split('::').pop().replace(/^mao-ao_/i, '');

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
  const materialTag = (typeof json.material === 'string' && json.material.trim())
    ? json.material.trim().toLowerCase()
    : (tags.find(tag => typeof tag === 'string' && tag.toLowerCase().startsWith('material:')) || '')
      .split(':')[1]
      ?.trim()
      ?.toLowerCase()
      || null;
  const resolvedTintSlot = json.slot === 'hat' && colorRange ? 'HAT'
                         : json.slot === 'hood' && colorRange ? 'HOOD'
                         : !json.appearance && colorRange ? 'CLOTH'
                         : json.slot === 'hood' && !json.appearance ? (json.tintSlot ?? 'HOOD')
                         : !json.appearance && json.tintSlot != null ? json.tintSlot
                         : json.slot === 'torso' && !json.appearance ? 'TORSO'
                         : tintSlot;
  const hairSlot = json.hairSlot || null; // 'front' | 'back' | 'side' | 'side-L'
  const portraitSlot = json.portraitSlot || null; // 'eyes' | 'upperFace' | 'facialHair' | 'hairFront' | 'hairBack' | 'hairSide' | 'hairSideL'
  const hoodLayering = json.hoodLayering || null; // 'under' means hat renders under hood; default is over
  return { id: shortId, label, tintSlot: resolvedTintSlot, layers, variantLayers, slot: json.slot || null, portraitSlot, colorRange, hairSlot, tags, materialTag, hoodLayering };
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
    const rawUrl = 'https://raw.githubusercontent.com/Oolnokk/SoKEmpirePrologue/main/docs/config/cosmetics/index.json';
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
  try {
    const speciesIdxUrl = new URL(configBase + 'species/index.json', window.location.href).toString();
    const speciesIdxResp = await fetch(speciesIdxUrl);
    if (speciesIdxResp.ok) {
      const speciesIdx = await speciesIdxResp.json();
      await Promise.all((speciesIdx.entries || []).map(async entry => {
        const sUrl = new URL(entry.path, speciesIdxUrl).toString();
        const sResp = await fetch(sUrl);
        if (!sResp.ok) return;
        const sData = await sResp.json();
        for (const [genderKey, genderData] of Object.entries(sData)) {
          if (!genderData || typeof genderData !== 'object' || !genderData.bodyColorRanges) continue;
          if (!_isRandomizableSpeciesGender(sData.speciesId, genderKey)) continue;
          let fighter = FIGHTERS.find(f => genderData.headSprite && f.headUrl === genderData.headSprite && _normalizeSpeciesKey(f.speciesId) === _normalizeSpeciesKey(sData.speciesId));
          if (!fighter && genderData.headSprite && Array.isArray(genderData.portraitBodyLayers)) {
            fighter = normalizedFighterPortrait({
              id: `${sData.speciesId}_${genderKey}`,
              speciesId: sData.speciesId,
              gender: genderKey,
              label: `${sData.label || entry.label} (${genderKey === 'male' ? 'M' : 'F'})`,
              headUrl: genderData.headSprite,
              bodyLayers: genderData.portraitBodyLayers.map(l => ({ ...normalizePortraitLayerXform(l), xformPreset: 'B' })),
              urLayers: (genderData.headUrLayers || []).map(l => ({ url: l.url, renderOrder: l.renderOrder })),
              headXform: genderData.headXform ? normalizePortraitLayerXform(genderData.headXform) : null,
              opacityMaskLayer: genderData.portraitOpacityMaskLayer ? normalizePortraitMaskLayer(genderData.portraitOpacityMaskLayer) : null,
            });
            FIGHTERS.push(fighter);
          }
          if (fighter) {
            bodyColorRangesByGender[fighter.id] = genderData.bodyColorRanges;
            fighterPortraitOverrides[fighter.id] = {
              ...(fighterPortraitOverrides[fighter.id] || {}),
              gender: genderKey,
              speciesId: sData.speciesId,
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
                  genderData.allowedCosmetics.map(id => id.split('::').pop().replace(/^mao-ao_/i, ''))
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
          }
        }
      }));
    }
  } catch (e) {
    console.warn('[portrait] Could not load species data', e);
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

  return { hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions, eyesOptions, upperFaceOptions, facialHairOptions, hatOptions, hoodOptions, torsoPortraitOptions, armPortraitOptions, indexEntries, optionCache, bodyColorRangesByGender, allowedCosmeticsByFighter, cosmeticWeightsByFighter, forcedCosmeticsByFighter, conditionalCosmeticsByFighter, randomizationRulesByFighter };
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
function randomProfileSeeded(rng, fighters, hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions, eyesOptions, upperFaceOptions, facialHairOptions, bodyColorRangesByGender, allowedCosmeticsByFighter, hatOptions, hoodOptions, cosmeticWeightsByFighter, torsoPortraitOptions, armPortraitOptions, forcedCosmeticsByFighter, conditionalCosmeticsByFighter, randomizationRulesByFighter) {
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

  const filteredHairFront  = filterArr(hairFrontOptions)  ?? [];
  const filteredHairBack   = filterArr(hairBackOptions)   ?? [];
  const filteredHairSide   = filterArr(hairSideOptions)   ?? [];
  const filteredHairSideL  = filterArr(hairSideLOptions)  ?? [];
  const filteredEyes       = filterArr(eyesOptions)       ?? [];
  const filteredUpperFace  = filterArr(upperFaceOptions)  ?? [];
  const filteredFacialHair = filterArr(facialHairOptions) ?? [];
  const filteredHat        = filterArr(hatOptions) ?? [{ id: 'none', label: 'No Hat', tintSlot: null, layers: [] }];
  const filteredHood       = filterArr(hoodOptions) ?? [{ id: 'none', label: 'No Hood', tintSlot: null, layers: [] }];

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
  const usedPaletteKeys = (layers) => new Set((layers || [])
    .map(layer => layer?.paletteColorKey)
    .filter(key => typeof key === 'string' && key && key !== 'A'));

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

window.loadPortraitCosmetics = loadPortraitCosmetics;
window.renderPortraitProfile = renderProfile;
// renderProfile is also exported as window.renderProfile for consumers that check that name
// (bootstrap.js, scratchbones-lobby.js).
window.renderProfile = renderProfile;
window.randomPortraitProfileSeeded = randomProfileSeeded;
window.randomColorFromRangeSeeded = randomColorFromRangeSeeded;
window.ensurePortraitClothingPaletteColors = ensurePortraitClothingPaletteColors;
window.drawPortraitLayerWarped = drawPortraitLayerWarped;
