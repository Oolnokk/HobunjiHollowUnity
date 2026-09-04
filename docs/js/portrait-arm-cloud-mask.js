// Adds a second, higher portrait cutout to authored base-arm sprites only.
//
// Unlike the canonical full-portrait opacity mask, this path deliberately edits
// each temporary arm image BEFORE portrait composition. The cloud's soft alpha is
// converted into a deterministic hard/wobbly cut, then the newly exposed arm edge
// is capped in black. Torso/clothing pixels are never part of this operation.
(function (global) {
  'use strict';

  const previewApi = global.NpcAvatarPreview;
  const MASK_Y_SCALE_MULTIPLIER = 0.60; // Existing canonical full-portrait cloud scaling.
  const LOGICAL_W = 200;
  const LOGICAL_H = 200;
  const LAYER_SIZE = 80;
  const DEFAULTS = Object.freeze({
    maskYScaleMultiplier: 0.60,
    axOffset: 0.12,
    cutThreshold: 0.50,
    wobbleStrength: 0.16,
    wobbleScale: 1.00,
    outlineWidth: 2,
    seed: 28480,
  });

  // Authored from docs/tools/portrait-arm-mask. Rakako'an deliberately mirrors
  // Kenkari by gender, matching the repo's existing transform alias. Ghouls
  // deliberately mirror the authored Mao'ao male profile for both genders because
  // this authored set currently contains only one Mao'ao profile.
  const AUTHORED_PROFILES = Object.freeze({
    'mao-ao:male': {
      maskYScaleMultiplier: 0.99,
      axOffset: -0.02,
      cutThreshold: 0.65,
      wobbleStrength: 0.16,
      wobbleScale: 1.9,
      outlineWidth: 2,
      seed: 660632132,
    },
    'tletingan:male': {
      maskYScaleMultiplier: 0.6,
      axOffset: 0.45,
      cutThreshold: 0.28,
      wobbleStrength: 0.29,
      wobbleScale: 1,
      outlineWidth: 5,
      seed: 28480,
    },
    'tletingan:female': {
      maskYScaleMultiplier: 1.35,
      axOffset: 0.34,
      cutThreshold: 0.93,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 2,
      seed: 28480,
    },
    'kenkari:male': {
      maskYScaleMultiplier: 1.14,
      axOffset: 0.45,
      cutThreshold: 0.56,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 2,
      seed: 28480,
    },
    'kenkari:female': {
      maskYScaleMultiplier: 1.25,
      axOffset: 0.25,
      cutThreshold: 0.11,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 2,
      seed: 28480,
    },
    'rakakoan:male': {
      maskYScaleMultiplier: 1.14,
      axOffset: 0.45,
      cutThreshold: 0.56,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 2,
      seed: 28480,
    },
    'rakakoan:female': {
      maskYScaleMultiplier: 1.25,
      axOffset: 0.25,
      cutThreshold: 0.11,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 2,
      seed: 28480,
    },
    'engh-sho:male': {
      maskYScaleMultiplier: 1.04,
      axOffset: -0.07,
      cutThreshold: 0.18,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 4,
      seed: 28480,
    },
    'engh-sho:female': {
      maskYScaleMultiplier: 1.15,
      axOffset: 0.195,
      cutThreshold: 0.78,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 2,
      seed: 28480,
    },
    'mashtzarr:male': {
      maskYScaleMultiplier: 0.91,
      axOffset: 0.11,
      cutThreshold: 0.45,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 5,
      seed: 28480,
    },
    'mashtzarr:female': {
      maskYScaleMultiplier: 1.35,
      axOffset: -0.065,
      cutThreshold: 0.5,
      wobbleStrength: 0.16,
      wobbleScale: 1,
      outlineWidth: 2,
      seed: 28480,
    },
    'ghoul:male': {
      maskYScaleMultiplier: 0.99,
      axOffset: -0.02,
      cutThreshold: 0.65,
      wobbleStrength: 0.16,
      wobbleScale: 1.9,
      outlineWidth: 2,
      seed: 660632132,
    },
    'ghoul:female': {
      maskYScaleMultiplier: 0.99,
      axOffset: -0.02,
      cutThreshold: 0.65,
      wobbleStrength: 0.16,
      wobbleScale: 1.9,
      outlineWidth: 2,
      seed: 660632132,
    },
  });

  const imageCache = new Map();
  const activeArmClipsByCanvas = new WeakMap();
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);

  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = t => t * t * (3 - 2 * t);

  // Same deterministic value-noise family used by tool-metal-recolor.js's
  // growing verdigris edge. Keeping this local avoids coupling portrait startup
  // to the tool recolorer's load order while preserving the same line character.
  function hashUnit1D(i, seed) {
    let h = (i ^ (seed >>> 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  function hashUnit2D(x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed >>> 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  function valueNoise1D(x, seed) {
    const xi = Math.floor(x);
    const xf = x - xi;
    const v0 = hashUnit1D(xi, seed) * 2 - 1;
    const v1 = hashUnit1D(xi + 1, seed) * 2 - 1;
    return lerp(v0, v1, smoothstep(xf));
  }

  function valueNoise2D(x, y, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const v00 = hashUnit2D(xi, yi, seed) * 2 - 1;
    const v10 = hashUnit2D(xi + 1, yi, seed) * 2 - 1;
    const v01 = hashUnit2D(xi, yi + 1, seed) * 2 - 1;
    const v11 = hashUnit2D(xi + 1, yi + 1, seed) * 2 - 1;
    const sx = smoothstep(xf);
    const sy = smoothstep(yf);
    return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
  }

  function hashString(text) {
    let hash = 2166136261 >>> 0;
    const value = String(text || '');
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function normalizeKeyPart(value) {
    return String(value || 'unknown').trim().toLowerCase().replace(/\s+/g, '-');
  }

  function fighterProfileKey(fighter) {
    return `${normalizeKeyPart(fighter?.speciesId || fighter?.id)}:${normalizeKeyPart(fighter?.gender)}`;
  }

  function rawMaskConfig() {
    return global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask || {};
  }

  function resolveArmMaskSettings(profileOrFighter) {
    const fighter = profileOrFighter?.fighter || profileOrFighter || null;
    const root = rawMaskConfig();
    const profileKey = fighterProfileKey(fighter);
    const authoredSettings = AUTHORED_PROFILES[profileKey] || {};
    const profileSettings = root.profiles?.[profileKey]
      || root.bySpeciesGender?.[profileKey]
      || {};
    const merged = { ...root, ...authoredSettings, ...profileSettings };
    return {
      profileKey,
      maskYScaleMultiplier: clamp(finite(merged.maskYScaleMultiplier, DEFAULTS.maskYScaleMultiplier), 0.05, 2),
      axOffset: clamp(finite(merged.axOffset, DEFAULTS.axOffset), -2, 2),
      cutThreshold: clamp(finite(merged.cutThreshold, DEFAULTS.cutThreshold), 0.02, 0.98),
      wobbleStrength: clamp(finite(merged.wobbleStrength, DEFAULTS.wobbleStrength), 0, 0.75),
      wobbleScale: clamp(finite(merged.wobbleScale, DEFAULTS.wobbleScale), 0.15, 6),
      outlineWidth: clamp(Math.round(finite(merged.outlineWidth, DEFAULTS.outlineWidth)), 0, 12),
      seed: Math.max(1, Math.round(finite(merged.seed, DEFAULTS.seed))) >>> 0,
    };
  }

  function scaleMaskY(xform, multiplier = MASK_Y_SCALE_MULTIPLIER) {
    if (!xform || typeof xform !== 'object') return xform;
    const resolvedAx = finite(xform.ax, 0);
    const resolvedSy = finite(xform.sy, 1);
    const resolvedMultiplier = finite(multiplier, 1);
    const bottomAnchorCompensation = resolvedSy * (1 - resolvedMultiplier) / 2;
    return { ...xform, ax: resolvedAx - bottomAnchorCompensation, sy: resolvedSy * resolvedMultiplier };
  }

  // Preserve the existing canonical cloud-mask adjustment. Only the SECOND arm
  // cutout below is converted from a gentle fade to a hard outlined cap.
  const originalApplyPortraitOpacityMask = global.applyPortraitOpacityMask;
  if (typeof originalApplyPortraitOpacityMask === 'function' && !originalApplyPortraitOpacityMask.__hobunjiCloudMaskYScaled) {
    const scaledApplyPortraitOpacityMask = function portraitCloudMaskYScaled(ctx, image, xform) {
      return originalApplyPortraitOpacityMask(ctx, image, scaleMaskY(xform, MASK_Y_SCALE_MULTIPLIER));
    };
    scaledApplyPortraitOpacityMask.__hobunjiCloudMaskYScaled = true;
    global.applyPortraitOpacityMask = scaledApplyPortraitOpacityMask;
  }

  function resolveAssetPath(path) {
    const raw = String(path || '');
    if (!raw) return '';
    if (/^(?:https?:|data:|blob:|file:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    if (raw.startsWith('assets/')) return new URL(raw, docsBase).href;
    return new URL(`assets/${raw.replace(/^\.\//, '')}`, docsBase).href;
  }

  function loadImage(path) {
    const url = resolveAssetPath(path);
    if (!url) return Promise.resolve(null);
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    imageCache.set(url, promise);
    return promise;
  }

  function resolvedFighterFor(profile) {
    const fighter = profile?.fighter || null;
    if (!fighter) return null;
    const fighters = global.getPortraitFighters?.() || [];
    return fighters.find(candidate => candidate?.id === fighter.id)
      || (fighter.headUrl ? fighters.find(candidate => candidate?.headUrl === fighter.headUrl) : null)
      || fighter;
  }

  function xformFor(layer) {
    if (layer?.xformPreset && typeof global.getPortraitXformPreset === 'function') {
      return global.getPortraitXformPreset(layer.xformPreset);
    }
    const xf = layer?.xform && typeof layer.xform === 'object' ? layer.xform : {};
    return {
      ax: finite(layer?.ax ?? xf.ax, 0),
      ay: finite(layer?.ay ?? xf.ay, 0),
      sx: finite(layer?.sx ?? xf.sx ?? xf.scaleX ?? xf.scaleMulX, 1),
      sy: finite(layer?.sy ?? xf.sy ?? xf.scaleY ?? xf.scaleMulY, 1),
    };
  }

  function portraitRectFor(image, xform) {
    const naturalWidth = finite(image?.naturalWidth || image?.width, 1);
    const naturalHeight = finite(image?.naturalHeight || image?.height, 1);
    const h = LAYER_SIZE * finite(xform?.sy, 1);
    const w = (naturalWidth / Math.max(1, naturalHeight)) * LAYER_SIZE * Math.abs(finite(xform?.sx, 1));
    const cx = LOGICAL_W / 2 + finite(xform?.ay, 0) * LAYER_SIZE;
    const cy = LOGICAL_H / 2 - finite(xform?.ax, 0) * LAYER_SIZE;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function markCanvasAsImage(canvas) {
    if (!('naturalWidth' in canvas)) Object.defineProperty(canvas, 'naturalWidth', { value: canvas.width });
    if (!('naturalHeight' in canvas)) Object.defineProperty(canvas, 'naturalHeight', { value: canvas.height });
    return canvas;
  }

  function drawMappedMask(maskCtx, maskImage, armImage, armXform, maskXform, width, height) {
    const armRect = portraitRectFor(armImage, armXform);
    const maskRect = portraitRectFor(maskImage, maskXform);
    if (!armRect.w || !armRect.h || !maskRect.w || !maskRect.h) return false;
    const mappedX = (maskRect.x - armRect.x) / armRect.w * width;
    const mappedY = (maskRect.y - armRect.y) / armRect.h * height;
    const mappedW = maskRect.w / armRect.w * width;
    const mappedH = maskRect.h / armRect.h * height;
    maskCtx.save();
    if (finite(armXform?.sx, 1) < 0) {
      maskCtx.translate(width, 0);
      maskCtx.scale(-1, 1);
    }
    maskCtx.drawImage(maskImage, mappedX, mappedY, mappedW, mappedH);
    maskCtx.restore();
    return true;
  }

  // Adapted from the verdigris outline pass: identify the cut region's boundary,
  // then grow the black cap inward over pixels that still belong to the arm.
  function buildCutOutlineMask(cutMask, armMask, width, height, outlineWidth) {
    const outline = new Uint8Array(cutMask.length);
    if (!outlineWidth) return outline;
    const boundary = new Uint8Array(cutMask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!cutMask[p]) continue;
        let isEdge = false;
        for (let oy = -1; oy <= 1 && !isEdge; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const np = ny * width + nx;
            if (!cutMask[np] && armMask[np]) {
              isEdge = true;
              break;
            }
          }
        }
        if (isEdge) boundary[p] = 1;
      }
    }
    const radius = Math.max(1, outlineWidth | 0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!armMask[p] || cutMask[p]) continue;
        let nearBoundary = false;
        for (let oy = -radius; oy <= radius && !nearBoundary; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            if (Math.hypot(ox, oy) > radius + 0.01) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (boundary[ny * width + nx]) {
              nearBoundary = true;
              break;
            }
          }
        }
        if (nearBoundary) outline[p] = 1;
      }
    }
    return outline;
  }

  function buildClippedArmImage(armImage, armXform, maskImage, maskXform, settings, seedSalt) {
    const width = Math.max(1, Math.round(finite(armImage?.naturalWidth || armImage?.width, 1)));
    const height = Math.max(1, Math.round(finite(armImage?.naturalHeight || armImage?.height, 1)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    markCanvasAsImage(canvas);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(armImage, 0, 0, width, height);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!drawMappedMask(maskCtx, maskImage, armImage, armXform, maskXform, width, height)) return canvas;

    const armData = ctx.getImageData(0, 0, width, height);
    const maskData = maskCtx.getImageData(0, 0, width, height);
    const armMask = new Uint8Array(width * height);
    const cutMask = new Uint8Array(width * height);
    const seed = (settings.seed ^ hashString(seedSalt)) >>> 0;
    const wobbleScale = settings.wobbleScale;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const dataOffset = p * 4;
        const armAlpha = armData.data[dataOffset + 3];
        if (armAlpha <= 4) continue;
        armMask[p] = 1;
        const maskAlpha = maskData.data[dataOffset + 3] / 255;
        if (maskAlpha <= 0.001) continue;

        // Verdigris-style broad wobble + fine jitter + occasional kink/grain,
        // repurposed as a threshold displacement on the cloud's soft edge.
        const nx = x / Math.max(1, width);
        const ny = y / Math.max(1, height);
        const wideWobble = valueNoise1D((nx * 5.2 + ny * 1.7) * wobbleScale, seed + 101) * 0.36;
        const fineJitter = valueNoise1D((nx * 17.0 + ny * 4.1) * wobbleScale, seed + 202) * 0.14;
        const kinkNoise = Math.max(0, valueNoise1D((nx * 8.0 - ny * 2.6) * wobbleScale, seed + 303) - 0.62) * 0.22;
        const grain = valueNoise2D(x * 0.18 * wobbleScale, y * 0.18 * wobbleScale, seed + 404) * 0.08;
        const wobble = (wideWobble + fineJitter + kinkNoise + grain) * settings.wobbleStrength;
        const threshold = clamp(settings.cutThreshold + wobble, 0.02, 0.98);
        if (maskAlpha >= threshold) cutMask[p] = 1;
      }
    }

    const outlineMask = buildCutOutlineMask(cutMask, armMask, width, height, settings.outlineWidth);
    for (let p = 0; p < armMask.length; p++) {
      if (!armMask[p]) continue;
      const i = p * 4;
      if (cutMask[p]) {
        armData.data[i + 3] = 0;
      } else if (outlineMask[p]) {
        armData.data[i] = 0;
        armData.data[i + 1] = 0;
        armData.data[i + 2] = 0;
        armData.data[i + 3] = Math.max(armData.data[i + 3], 220);
      }
    }
    ctx.putImageData(armData, 0, 0);
    return canvas;
  }

  async function buildArmClipState(profile) {
    const fighter = resolvedFighterFor(profile);
    const maskLayer = fighter?.opacityMaskLayer || profile?.fighter?.opacityMaskLayer || null;
    const armLayers = (fighter?.bodyLayers || profile?.fighter?.bodyLayers || [])
      .filter(layer => /arm[lr]/i.test(String(layer?.id || '')) && layer?.url);
    if (!maskLayer?.url || !armLayers.length) return null;

    const [maskImage, ...armImages] = await Promise.all([
      loadImage(maskLayer.url),
      ...armLayers.map(layer => loadImage(layer.url)),
    ]);
    if (!maskImage) return null;

    const settings = resolveArmMaskSettings(fighter);
    const maskXform = scaleMaskY(xformFor(maskLayer), settings.maskYScaleMultiplier);
    maskXform.ax += settings.axOffset;

    const clips = new Map();
    for (let index = 0; index < armLayers.length; index++) {
      const armImage = armImages[index];
      const armLayer = armLayers[index];
      if (!armImage || !armLayer?.url) continue;
      clips.set(
        String(armLayer.url),
        buildClippedArmImage(armImage, xformFor(armLayer), maskImage, maskXform, settings, `${settings.profileKey}:${armLayer.id || index}`)
      );
    }
    if (!clips.size) return null;
    return {
      clips,
      settings,
      cacheSuffix: [
        'arm-hardcap', settings.profileKey,
        settings.maskYScaleMultiplier.toFixed(4), settings.axOffset.toFixed(4),
        settings.cutThreshold.toFixed(4), settings.wobbleStrength.toFixed(4),
        settings.wobbleScale.toFixed(4), settings.outlineWidth, settings.seed,
      ].join(':'),
    };
  }

  const originalDrawPortraitLayer = global.drawPortraitLayer;
  if (typeof originalDrawPortraitLayer === 'function' && !originalDrawPortraitLayer.__hobunjiArmCloudClip) {
    const clippedDrawPortraitLayer = function drawPortraitLayerWithArmCloudClip(ctx, image, xform, tint, sourceKey) {
      const state = activeArmClipsByCanvas.get(ctx?.canvas);
      const clipped = state?.clips?.get(String(sourceKey || ''));
      if (!clipped) return originalDrawPortraitLayer.call(this, ctx, image, xform, tint, sourceKey);
      return originalDrawPortraitLayer.call(this, ctx, clipped, xform, tint, `${sourceKey}#${state.cacheSuffix}`);
    };
    clippedDrawPortraitLayer.__hobunjiArmCloudClip = true;
    clippedDrawPortraitLayer.__hobunjiArmCloudOriginal = originalDrawPortraitLayer;
    global.drawPortraitLayer = clippedDrawPortraitLayer;
  }

  const originalDrawPortraitLayerWarped = global.drawPortraitLayerWarped;
  if (typeof originalDrawPortraitLayerWarped === 'function' && !originalDrawPortraitLayerWarped.__hobunjiArmCloudClip) {
    const clippedDrawPortraitLayerWarped = function drawPortraitLayerWarpedWithArmCloudClip(
      ctx, image, xform, tint, breathingComposer, speciesId, gender, nowMs,
      phaseOffsetMs, seatId, staticDeform, sourceKey
    ) {
      const state = activeArmClipsByCanvas.get(ctx?.canvas);
      const clipped = state?.clips?.get(String(sourceKey || ''));
      if (!clipped) {
        return originalDrawPortraitLayerWarped.call(
          this, ctx, image, xform, tint, breathingComposer, speciesId, gender, nowMs,
          phaseOffsetMs, seatId, staticDeform, sourceKey
        );
      }
      return originalDrawPortraitLayerWarped.call(
        this, ctx, clipped, xform, tint, breathingComposer, speciesId, gender, nowMs,
        phaseOffsetMs, seatId, staticDeform, `${sourceKey}#${state.cacheSuffix}`
      );
    };
    clippedDrawPortraitLayerWarped.__hobunjiArmCloudClip = true;
    clippedDrawPortraitLayerWarped.__hobunjiArmCloudOriginal = originalDrawPortraitLayerWarped;
    global.drawPortraitLayerWarped = clippedDrawPortraitLayerWarped;
  }

  if (!previewApi?.renderProfileToCanvas) return;
  if (previewApi.renderProfileToCanvas.__hobunjiArmCloudClipWrapped) return;

  const originalRenderToCanvas = previewApi.renderProfileToCanvas.bind(previewApi);
  const wrappedRenderToCanvas = async function armCloudClipRenderToCanvas(canvas, profile, renderOptions = {}) {
    const shouldClip = renderOptions?.onlyHeadSprite !== true
      && renderOptions?.portraitView !== 'behind'
      && renderOptions?.view !== 'behind';
    if (!shouldClip) return originalRenderToCanvas(canvas, profile, renderOptions);

    let state = null;
    try {
      state = await buildArmClipState(profile);
    } catch (error) {
      console.warn('[arm-cloud-mask] per-arm hard-cap preparation skipped:', error);
    }
    if (state) activeArmClipsByCanvas.set(canvas, state);
    try {
      return await originalRenderToCanvas(canvas, profile, renderOptions);
    } finally {
      activeArmClipsByCanvas.delete(canvas);
    }
  };
  wrappedRenderToCanvas.__hobunjiArmCloudClipWrapped = true;
  previewApi.renderProfileToCanvas = wrappedRenderToCanvas;

  global.PortraitArmCloudMask = {
    mode: 'per-arm-hard-cut-black-cap',
    defaults: DEFAULTS,
    authoredProfiles: AUTHORED_PROFILES,
    profileKeyFor: fighterProfileKey,
    resolveSettingsFor: resolveArmMaskSettings,
    get maskYScaleMultiplier() { return MASK_Y_SCALE_MULTIPLIER; },
    get configuredArmMaskYScaleMultiplier() { return resolveArmMaskSettings(null).maskYScaleMultiplier; },
    get configuredAxOffset() { return resolveArmMaskSettings(null).axOffset; },
  };
})(window);
