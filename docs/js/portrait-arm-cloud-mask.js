// Adds a second, slightly higher cloud opacity cutout to the base arm sprites only.
//
// The higher cutout is applied to each authored arm image BEFORE the portrait is
// composited. This is important: applying it as a final PNG-plane alpha map also
// punched holes through torso/clothing pixels that happened to occupy the same
// screen-space coordinates. Raw fighter/body-layer data remains untouched.
(function (global) {
  'use strict';

  const previewApi = global.NpcAvatarPreview;
  const MASK_Y_SCALE_MULTIPLIER = 0.60; // Preserves the established scale of the canonical full-portrait cloud mask.
  const DEFAULT_ARM_MASK_Y_SCALE_MULTIPLIER = 0.60; // Used by the second arm-only cloud when config does not override it.
  const LOGICAL_W = 200;
  const LOGICAL_H = 200;
  const LAYER_SIZE = 80;
  const DEFAULT_AX_OFFSET = 0.12;
  const imageCache = new Map();
  const activeArmClipsByCanvas = new WeakMap(); // Associates one in-flight portrait canvas with its pre-clipped arm images.
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);

  function configuredArmMaskYScaleMultiplier() {
    const value = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.maskYScaleMultiplier);
    return Number.isFinite(value) && value > 0
      ? Math.max(0.05, Math.min(2, value))
      : DEFAULT_ARM_MASK_Y_SCALE_MULTIPLIER;
  }

  function scaleMaskY(xform, multiplier = MASK_Y_SCALE_MULTIPLIER) {
    if (!xform || typeof xform !== 'object') return xform;
    const ax = Number(xform.ax);
    const sy = Number(xform.sy);
    const resolvedAx = Number.isFinite(ax) ? ax : 0;
    const resolvedSy = Number.isFinite(sy) ? sy : 1;
    const resolvedMultiplier = Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1;
    const bottomAnchorCompensation = resolvedSy * (1 - resolvedMultiplier) / 2; // Keeps the authored bottom edge fixed while Y scale changes.
    return {
      ...xform,
      ax: resolvedAx - bottomAnchorCompensation,
      sy: resolvedSy * resolvedMultiplier,
    };
  }

  // Keep the existing canonical cloud-mask adjustment. This is the original full
  // portrait mask; the extra arm-only mask is handled separately below.
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
      ax: Number(layer?.ax ?? xf.ax) || 0,
      ay: Number(layer?.ay ?? xf.ay) || 0,
      sx: Number(layer?.sx ?? xf.sx ?? xf.scaleX ?? xf.scaleMulX) || 1,
      sy: Number(layer?.sy ?? xf.sy ?? xf.scaleY ?? xf.scaleMulY) || 1,
    };
  }

  function portraitRectFor(image, xform) {
    const naturalWidth = Number(image?.naturalWidth || image?.width) || 1;
    const naturalHeight = Number(image?.naturalHeight || image?.height) || 1;
    const h = LAYER_SIZE * Number(xform?.sy || 1);
    const w = (naturalWidth / naturalHeight) * LAYER_SIZE * Math.abs(Number(xform?.sx || 1));
    const cx = LOGICAL_W / 2 + Number(xform?.ay || 0) * LAYER_SIZE;
    const cy = LOGICAL_H / 2 - Number(xform?.ax || 0) * LAYER_SIZE;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function markCanvasAsImage(canvas) {
    // portrait-utils accepts CanvasImageSource objects but also reads naturalWidth/
    // naturalHeight like an HTMLImageElement. Define those aliases for our clipped canvas.
    if (!('naturalWidth' in canvas)) Object.defineProperty(canvas, 'naturalWidth', { value: canvas.width });
    if (!('naturalHeight' in canvas)) Object.defineProperty(canvas, 'naturalHeight', { value: canvas.height });
    return canvas;
  }

  function buildClippedArmImage(armImage, armXform, maskImage, maskXform) {
    const width = Math.max(1, Number(armImage?.naturalWidth || armImage?.width) || 1);
    const height = Math.max(1, Number(armImage?.naturalHeight || armImage?.height) || 1);
    const canvas = markCanvasAsImage(document.createElement('canvas'));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(armImage, 0, 0, width, height);

    const armRect = portraitRectFor(armImage, armXform);
    const maskRect = portraitRectFor(maskImage, maskXform);
    if (!armRect.w || !armRect.h || !maskRect.w || !maskRect.h) return canvas;

    const mappedX = (maskRect.x - armRect.x) / armRect.w * width;
    const mappedY = (maskRect.y - armRect.y) / armRect.h * height;
    const mappedW = maskRect.w / armRect.w * width;
    const mappedH = maskRect.h / armRect.h * height;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    if (Number(armXform?.sx || 1) < 0) {
      // drawPortraitLayer mirrors negative-SX sprites before placement, so mirror
      // the portrait-space mask back into source space before cutting the raw arm.
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(maskImage, mappedX, mappedY, mappedW, mappedH);
    ctx.restore();
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

    const maskXform = scaleMaskY(xformFor(maskLayer), configuredArmMaskYScaleMultiplier());
    const configuredOffset = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
    maskXform.ax += Number.isFinite(configuredOffset) ? configuredOffset : DEFAULT_AX_OFFSET;

    const clips = new Map();
    for (let index = 0; index < armLayers.length; index++) {
      const armImage = armImages[index];
      const armLayer = armLayers[index];
      if (!armImage || !armLayer?.url) continue;
      clips.set(String(armLayer.url), buildClippedArmImage(armImage, xformFor(armLayer), maskImage, maskXform));
    }
    if (!clips.size) return null;
    return {
      clips,
      cacheSuffix: `arm-cloud:${configuredArmMaskYScaleMultiplier().toFixed(4)}:${maskXform.ax.toFixed(4)}`,
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
    // Behind/head-only canvases do not own the front arm-cloud cutout.
    const shouldClip = renderOptions?.onlyHeadSprite !== true
      && renderOptions?.portraitView !== 'behind'
      && renderOptions?.view !== 'behind';
    if (!shouldClip) return originalRenderToCanvas(canvas, profile, renderOptions);

    try {
      const state = await buildArmClipState(profile);
      if (state) activeArmClipsByCanvas.set(canvas, state);
      return await originalRenderToCanvas(canvas, profile, renderOptions);
    } catch (error) {
      console.warn('[arm-cloud-mask] per-arm clip skipped:', error);
      return originalRenderToCanvas(canvas, profile, renderOptions);
    } finally {
      activeArmClipsByCanvas.delete(canvas);
    }
  };
  wrappedRenderToCanvas.__hobunjiArmCloudClipWrapped = true;
  previewApi.renderProfileToCanvas = wrappedRenderToCanvas;

  global.PortraitArmCloudMask = {
    mode: 'per-arm-draw-clip',
    get maskYScaleMultiplier() { return MASK_Y_SCALE_MULTIPLIER; },
    get defaultArmMaskYScaleMultiplier() { return DEFAULT_ARM_MASK_Y_SCALE_MULTIPLIER; },
    get configuredArmMaskYScaleMultiplier() { return configuredArmMaskYScaleMultiplier(); },
    get defaultAxOffset() { return DEFAULT_AX_OFFSET; },
    get configuredAxOffset() {
      const value = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
      return Number.isFinite(value) ? value : DEFAULT_AX_OFFSET;
    },
  };
})(window);
