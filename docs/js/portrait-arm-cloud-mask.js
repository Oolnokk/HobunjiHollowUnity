// Adds a second, slightly higher cloud-shaped opacity cutout to base arm sprites only.
//
// The species' existing portraitOpacityMaskLayer is still applied by portrait-utils
// at the end of the full portrait and therefore continues to affect the whole avatar.
// This adapter reuses that same cloud image/xform, shifts it upward, and pre-masks
// each raw arm layer before that arm is composited. Torso and overwear never enter
// the temporary arm canvas, so this higher mask cannot punch holes through them.
(function (global) {
  'use strict';

  const originalRender = global.renderPortraitProfile || global.renderProfile;
  const originalDraw = global.drawPortraitLayer;
  const originalDrawWarped = global.drawPortraitLayerWarped;
  if (typeof originalRender !== 'function' || typeof originalDraw !== 'function' || typeof originalDrawWarped !== 'function') return;
  if (originalRender.__hobunjiArmCloudMaskWrapped) return;

  const contextConfig = new WeakMap();
  const scratchByContext = new WeakMap();
  const maskImageCache = new Map();
  const warnedWarpFallbacks = new Set();
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);

  function resolveAssetPath(path) {
    const raw = String(path || '');
    if (!raw) return '';
    if (/^(?:https?:|data:|blob:|file:)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    if (raw.startsWith('assets/')) return new URL(raw, docsBase).href;
    return new URL(`assets/${raw.replace(/^\.\//, '')}`, docsBase).href;
  }

  function loadMask(path) {
    const url = resolveAssetPath(path);
    if (!url) return Promise.resolve(null);
    if (maskImageCache.has(url)) return maskImageCache.get(url);
    const promise = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    maskImageCache.set(url, promise);
    return promise;
  }

  function normalizedXform(layer) {
    const xf = layer?.xform && typeof layer.xform === 'object' ? layer.xform : {};
    return {
      ax: Number(layer?.ax ?? xf.ax) || 0,
      ay: Number(layer?.ay ?? xf.ay) || 0,
      sx: Number(layer?.sx ?? xf.sx ?? xf.scaleX) || 1,
      sy: Number(layer?.sy ?? xf.sy ?? xf.scaleY) || 1,
    };
  }

  function resolvedFighterFor(profile) {
    const fighter = profile?.fighter || null;
    if (!fighter) return null;
    const fighters = global.getPortraitFighters?.() || [];
    return fighters.find(candidate => candidate?.id === fighter.id)
      || (fighter.headUrl ? fighters.find(candidate => candidate?.headUrl === fighter.headUrl) : null)
      || fighter;
  }

  function renderConfig(profile) {
    const fighter = resolvedFighterFor(profile);
    const maskLayer = fighter?.opacityMaskLayer || profile?.fighter?.opacityMaskLayer || null;
    if (!maskLayer?.url) return null;
    const armUrls = new Set((fighter?.bodyLayers || profile?.fighter?.bodyLayers || [])
      .filter(layer => /arm[lr]/i.test(String(layer?.id || '')))
      .map(layer => String(layer?.url || ''))
      .filter(Boolean));
    if (!armUrls.size) return null;
    const base = normalizedXform(maskLayer);
    const configuredOffset = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
    const axOffset = Number.isFinite(configuredOffset) ? configuredOffset : 0.12;
    return {
      armUrls,
      maskPath: maskLayer.url,
      maskXform: { ...base, ax: base.ax + axOffset },
    };
  }

  function scratchFor(ctx) {
    const width = ctx?.canvas?.width || 1;
    const height = ctx?.canvas?.height || 1;
    let record = scratchByContext.get(ctx);
    if (!record || record.canvas.width !== width || record.canvas.height !== height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      record = { canvas, ctx: canvas.getContext('2d') };
      scratchByContext.set(ctx, record);
    }
    return record;
  }

  function applyMask(ctx, image, xform) {
    const logicalW = 200, logicalH = 200, layerSize = 80;
    const h = layerSize * xform.sy;
    const w = (image.naturalWidth / Math.max(1, image.naturalHeight)) * layerSize * xform.sx;
    const cx = logicalW / 2 + xform.ay * layerSize;
    const cy = logicalH / 2 - xform.ax * layerSize;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
  }

  function shouldMaskArm(ctx, sourceKey) {
    const cfg = contextConfig.get(ctx);
    return !!(cfg && cfg.armUrls.has(String(sourceKey || '')) && cfg.maskImage);
  }

  function drawArmIsolated(ctx, drawFn) {
    const cfg = contextConfig.get(ctx);
    if (!cfg) return drawFn(ctx);
    const scratch = scratchFor(ctx);
    const sctx = scratch.ctx;
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, scratch.canvas.width, scratch.canvas.height);
    sctx.restore();

    const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (transform && typeof sctx.setTransform === 'function') sctx.setTransform(transform);
    else sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = ctx.globalAlpha;
    sctx.globalCompositeOperation = 'source-over';
    sctx.filter = 'none';
    drawFn(sctx);
    applyMask(sctx, cfg.maskImage, cfg.maskXform);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.drawImage(scratch.canvas, 0, 0);
    ctx.restore();
  }

  const wrappedDraw = function armCloudMaskedPortraitLayer(ctx, img, xform, tint, sourceKey) {
    if (!shouldMaskArm(ctx, sourceKey)) return originalDraw(ctx, img, xform, tint, sourceKey);
    return drawArmIsolated(ctx, offCtx => originalDraw(offCtx, img, xform, tint, sourceKey));
  };

  const wrappedDrawWarped = function armCloudMaskedWarpedLayer(ctx, img, xform, tint, breathingComposer, speciesId, gender, nowMs, phaseOffsetMs, seatId, staticDeform, sourceKey) {
    if (!shouldMaskArm(ctx, sourceKey)) {
      return originalDrawWarped(ctx, img, xform, tint, breathingComposer, speciesId, gender, nowMs, phaseOffsetMs, seatId, staticDeform, sourceKey);
    }
    try {
      return drawArmIsolated(ctx, offCtx => originalDrawWarped(
        offCtx, img, xform, tint, breathingComposer, speciesId, gender, nowMs, phaseOffsetMs, seatId, staticDeform, sourceKey,
      ));
    } catch (error) {
      // Portrait animation data can briefly expose an incomplete deformation grid
      // while a profile/animation is being rebuilt. The ordinary renderer used to
      // survive because the next frame replaced it; the isolated arm pass must not
      // turn that transient state into a rejected avatar build. Draw the exact same
      // tinted arm without warp for this one frame and still apply the arm-only mask.
      const warningKey = `${speciesId || 'unknown'}:${gender || 'unknown'}:${sourceKey || 'arm'}`;
      if (!warnedWarpFallbacks.has(warningKey)) {
        warnedWarpFallbacks.add(warningKey);
        console.warn('[arm-cloud-mask] incomplete portrait deformation grid; using unwarped arm fallback', {
          speciesId, gender, sourceKey, message: error?.message || String(error),
        });
      }
      return drawArmIsolated(ctx, offCtx => originalDraw(offCtx, img, xform, tint, sourceKey));
    }
  };

  global.drawPortraitLayer = wrappedDraw;
  global.drawPortraitLayerWarped = wrappedDrawWarped;

  const wrappedRender = async function armCloudMaskAwareRender(canvas, profile, renderOptions) {
    const cfg = renderConfig(profile);
    if (!cfg || !canvas?.getContext) return originalRender(canvas, profile, renderOptions);
    cfg.maskImage = await loadMask(cfg.maskPath);
    if (!cfg.maskImage) return originalRender(canvas, profile, renderOptions);
    const ctx = canvas.getContext('2d');
    contextConfig.set(ctx, cfg);
    try {
      return await originalRender(canvas, profile, renderOptions);
    } finally {
      contextConfig.delete(ctx);
    }
  };
  wrappedRender.__hobunjiArmCloudMaskWrapped = true;
  global.renderPortraitProfile = wrappedRender;
  global.renderProfile = wrappedRender;

  global.PortraitArmCloudMask = {
    get defaultAxOffset() { return 0.12; },
    get configuredAxOffset() {
      const value = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
      return Number.isFinite(value) ? value : 0.12;
    },
  };
})(window);
