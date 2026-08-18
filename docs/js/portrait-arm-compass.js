// Separates the raw front arm sprites from the baked portrait so direct 3D hands
// can aim those arms as rigid 2D compass needles without reintroducing arm bones.
// Each arm canvas retains the portrait renderer's normal tint/xform. The shoulder
// is detected from the raw arm coverage: scan down to the first opaque row, then
// move 10% of portrait height downward and use that row's alpha centroid.
(function (global) {
  'use strict';

  if (typeof global.renderPortraitProfile !== 'function' || global.renderPortraitProfile.__hobunjiArmCompassWrapped) return;

  const SHOULDER_DROP_FRAC = 0.10;
  const ARM_ID_RE = /^arm([lr])$/i;

  function resolvedFighterFor(profile) {
    const fighter = profile?.fighter || null;
    if (!fighter) return null;
    const fighters = global.getPortraitFighters?.() || [];
    return fighters.find(candidate => candidate?.id === fighter.id)
      || (fighter.headUrl ? fighters.find(candidate => candidate?.headUrl === fighter.headUrl) : null)
      || fighter;
  }

  function resolveXform(layer) {
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

  async function loadPortraitImage(path) {
    if (typeof global.loadImg === 'function') {
      try { return await global.loadImg(path); } catch (_) { /* fall through */ }
    }
    const raw = String(path || '');
    if (!raw) return null;
    const candidates = [];
    if (/^(?:https?:|data:|blob:|file:|\/)/i.test(raw)) candidates.push(raw);
    else {
      const configured = String(global.SCRATCHBONES_CONFIG?.game?.assets?.portrait?.assetBase || './assets/').replace(/\/?$/, '/');
      candidates.push(configured + raw);
      candidates.push(new URL(`../assets/${raw}`, document.baseURI).href);
      candidates.push(new URL(`../../assets/${raw}`, document.baseURI).href);
    }
    for (const src of [...new Set(candidates)]) {
      const image = await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
      if (image) return image;
    }
    return null;
  }

  function drawLayer(ctx, image, layer, tint) {
    if (typeof global.drawPortraitLayer === 'function') {
      global.drawPortraitLayer(ctx, image, resolveXform(layer), tint, layer.url);
      return;
    }
    // Emergency fallback matches portrait-utils' 200x200 logical coordinate basis.
    const xf = resolveXform(layer);
    const logicalW = 200, logicalH = 200, layerSize = 80;
    const h = layerSize * xf.sy;
    const w = (image.naturalWidth / Math.max(1, image.naturalHeight)) * layerSize * xf.sx;
    const cx = logicalW / 2 + xf.ay * layerSize;
    const cy = logicalH / 2 - xf.ax * layerSize;
    ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
  }

  function rowAlphaCentroid(data, width, height, row, threshold = 8) {
    const y = Math.max(0, Math.min(height - 1, Math.round(row)));
    let weightedX = 0, total = 0;
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= threshold) continue;
      weightedX += x * alpha;
      total += alpha;
    }
    return total > 0 ? { x: weightedX / total, y } : null;
  }

  function nearestOpaqueRowCentroid(data, width, height, requestedRow, threshold = 8) {
    const start = Math.max(0, Math.min(height - 1, Math.round(requestedRow)));
    for (let radius = 0; radius < height; radius++) {
      for (const row of radius ? [start - radius, start + radius] : [start]) {
        if (row < 0 || row >= height) continue;
        const point = rowAlphaCentroid(data, width, height, row, threshold);
        if (point) return point;
      }
    }
    return null;
  }

  function scanArmAnchors(canvas) {
    const width = canvas?.width || 0, height = canvas?.height || 0;
    if (!width || !height) return null;
    let data;
    try { data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data; }
    catch (_) { return null; }
    const threshold = 8;
    let top = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      let rowOpaque = false;
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > threshold) { rowOpaque = true; break; }
      }
      if (!rowOpaque) continue;
      if (top < 0) top = y;
      bottom = y;
    }
    if (top < 0) return null;
    const shoulderRow = Math.min(bottom, top + height * SHOULDER_DROP_FRAC);
    const shoulder = nearestOpaqueRowCentroid(data, width, height, shoulderRow, threshold)
      || nearestOpaqueRowCentroid(data, width, height, top, threshold);
    const wrist = nearestOpaqueRowCentroid(data, width, height, bottom, threshold);
    return shoulder && wrist ? { shoulder, wrist, top, bottom } : null;
  }

  async function applyArmCloudCutout(canvas, fighter) {
    const maskLayer = fighter?.opacityMaskLayer;
    if (!maskLayer?.url || !canvas) return;
    const maskImage = await loadPortraitImage(maskLayer.url);
    if (!maskImage) return;
    const ctx = canvas.getContext('2d');
    const layer = { ...maskLayer, ...resolveXform(maskLayer) };
    const configuredOffset = Number(global.SCRATCHBONES_CONFIG?.game?.portrait?.armOnlyOpacityMask?.axOffset);
    layer.ax = (Number(layer.ax) || 0) + (Number.isFinite(configuredOffset) ? configuredOffset : 0.12);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    drawLayer(ctx, maskImage, layer, null);
    ctx.restore();
  }

  async function buildArmCanvas(width, height, profile, fighter, layer) {
    const image = await loadPortraitImage(layer.url);
    if (!image) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tint = layer.tintSlot ? profile?.bodyColors?.[layer.tintSlot] : null;
    drawLayer(ctx, image, layer, tint);
    const anchors = scanArmAnchors(canvas); // Scan BEFORE the higher cloud cutout removes pixels.
    await applyArmCloudCutout(canvas, fighter);
    return anchors ? { canvas, ...anchors, layerId: layer.id, layerUrl: layer.url } : null;
  }

  const originalRender = global.renderPortraitProfile.bind(global);
  const wrappedRender = async function armCompassRender(canvas, profile, renderOptions = {}) {
    const auxiliary = renderOptions?.onlyHeadSprite === true
      || renderOptions?.portraitView === 'behind'
      || renderOptions?.view === 'behind';
    if (auxiliary || !canvas?.width || !canvas?.height) return originalRender(canvas, profile, renderOptions);

    const fighter = resolvedFighterFor(profile);
    const bodyLayers = Array.isArray(fighter?.bodyLayers) ? fighter.bodyLayers : [];
    const armLayers = bodyLayers.filter(layer => ARM_ID_RE.test(String(layer?.id || '')) && layer?.url);
    if (!fighter || !armLayers.length) {
      canvas.hobunjiArmCompass = null;
      return originalRender(canvas, profile, renderOptions);
    }

    // Render the normal portrait with the raw arms removed so rotated arm planes do
    // not sit on top of a baked neutral ghost. All torso/head/cosmetic drawing stays
    // owned by the canonical renderer. Hooking renderPortraitProfile itself covers
    // live player/NPC rendering as well as NpcAvatarPreview and the Attack Editor.
    const baseFighter = { ...fighter, bodyLayers: bodyLayers.filter(layer => !ARM_ID_RE.test(String(layer?.id || ''))) };
    const baseProfile = { ...profile, fighter: baseFighter };
    const rendered = await originalRender(canvas, baseProfile, renderOptions);
    if (!rendered) return rendered;

    const entries = await Promise.all(armLayers.map(async layer => {
      const match = String(layer.id).match(ARM_ID_RE);
      const side = match?.[1]?.toLowerCase() === 'l' ? 'left' : 'right';
      return [side, await buildArmCanvas(canvas.width, canvas.height, profile, fighter, layer)];
    }));
    const sides = {};
    for (const [side, armData] of entries) if (armData) sides[side] = armData;
    canvas.hobunjiArmCompass = Object.keys(sides).length ? {
      mode: '2d-compass-arms',
      shoulderDropFraction: SHOULDER_DROP_FRAC,
      width: canvas.width,
      height: canvas.height,
      sides,
    } : null;
    return rendered;
  };

  wrappedRender.__hobunjiArmCompassWrapped = true;
  global.renderPortraitProfile = wrappedRender;
  global.PortraitArmCompass = Object.freeze({ mode: '2d-compass-arms', shoulderDropFraction: SHOULDER_DROP_FRAC });
})(window);
