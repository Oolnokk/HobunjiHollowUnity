// Calculates shoulder targets from the raw portrait arm sprites without changing
// or animating those sprites. The first opaque arm row is found, then the shoulder
// row is 10% of the full portrait height farther down. The alpha centroid on that
// row is stored on the rendered canvas for the direct 3D hand compass system.
(function (global) {
  'use strict';

  if (typeof global.renderPortraitProfile !== 'function' || global.renderPortraitProfile.__hobunjiHandShoulderScanWrapped) return;

  const SHOULDER_DROP_FRAC = 0.10;
  const ARM_RE = /arm[lr]/i;
  const LOGICAL_W = 200;
  const LOGICAL_H = 200;
  const LAYER_SIZE = 80;
  const imageCache = new Map();
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);

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

  function drawArmCoverage(canvas, image, layer) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const xf = xformFor(layer);
    const scaleX = canvas.width / LOGICAL_W;
    const scaleY = canvas.height / LOGICAL_H;
    const h = LAYER_SIZE * xf.sy;
    const w = (image.naturalWidth / Math.max(1, image.naturalHeight)) * LAYER_SIZE * xf.sx;
    const cx = LOGICAL_W / 2 + xf.ay * LAYER_SIZE;
    const cy = LOGICAL_H / 2 - xf.ax * LAYER_SIZE;
    ctx.drawImage(image,
      (cx - w / 2) * scaleX,
      (cy - h / 2) * scaleY,
      w * scaleX,
      h * scaleY,
    );
  }

  function centroidOnRow(data, width, height, row, threshold) {
    const y = Math.max(0, Math.min(height - 1, Math.round(row)));
    let weightedX = 0;
    let totalAlpha = 0;
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= threshold) continue;
      weightedX += x * alpha;
      totalAlpha += alpha;
    }
    return totalAlpha > 0 ? { x: weightedX / totalAlpha, y } : null;
  }

  function nearestOpaqueCentroid(data, width, height, row, threshold) {
    const start = Math.max(0, Math.min(height - 1, Math.round(row)));
    for (let radius = 0; radius < height; radius++) {
      const candidates = radius ? [start - radius, start + radius] : [start];
      for (const candidate of candidates) {
        if (candidate < 0 || candidate >= height) continue;
        const hit = centroidOnRow(data, width, height, candidate, threshold);
        if (hit) return hit;
      }
    }
    return null;
  }

  function scanShoulder(canvas) {
    const width = canvas?.width || 0;
    const height = canvas?.height || 0;
    if (!width || !height) return null;
    let data;
    try { data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data; }
    catch (_) { return null; }
    const threshold = 8;
    let firstOpaqueRow = -1;
    for (let y = 0; y < height && firstOpaqueRow < 0; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > threshold) {
          firstOpaqueRow = y;
          break;
        }
      }
    }
    if (firstOpaqueRow < 0) return null;
    const desiredRow = firstOpaqueRow + height * SHOULDER_DROP_FRAC;
    const shoulder = nearestOpaqueCentroid(data, width, height, desiredRow, threshold)
      || nearestOpaqueCentroid(data, width, height, firstOpaqueRow, threshold);
    return shoulder ? { ...shoulder, firstOpaqueRow } : null;
  }

  async function scanProfileShoulders(canvas, profile) {
    const fighter = resolvedFighterFor(profile);
    const armLayers = (fighter?.bodyLayers || profile?.fighter?.bodyLayers || [])
      .filter(layer => ARM_RE.test(String(layer?.id || '')) && layer?.url);
    if (!canvas?.width || !canvas?.height || !armLayers.length) return null;
    const sides = {};
    for (const layer of armLayers) {
      const lowerId = String(layer.id || '').toLowerCase();
      const side = lowerId.includes('arml') ? 'left' : lowerId.includes('armr') ? 'right' : null;
      if (!side) continue;
      const image = await loadImage(layer.url);
      if (!image) continue;
      const scratch = document.createElement('canvas');
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      drawArmCoverage(scratch, image, layer);
      const shoulder = scanShoulder(scratch);
      if (shoulder) sides[side] = { ...shoulder, layerId: layer.id, layerUrl: layer.url };
    }
    return Object.keys(sides).length ? {
      mode: 'raw-arm-shoulder-scan',
      shoulderDropFraction: SHOULDER_DROP_FRAC,
      width: canvas.width,
      height: canvas.height,
      sides,
    } : null;
  }

  const originalRenderPortrait = global.renderPortraitProfile;
  const wrappedRender = async function handShoulderScanRender(canvas, profile, renderOptions = {}) {
    const result = await originalRenderPortrait.call(this, canvas, profile, renderOptions);
    const auxiliary = renderOptions?.onlyHeadSprite === true
      || renderOptions?.portraitView === 'behind'
      || renderOptions?.view === 'behind';
    if (!auxiliary && canvas?.width && canvas?.height) {
      try { canvas.hobunjiHandShoulders = await scanProfileShoulders(canvas, profile); }
      catch (error) {
        canvas.hobunjiHandShoulders = null;
        console.warn('[hand-shoulder-scan] scan skipped:', error);
      }
    }
    return result;
  };
  wrappedRender.__hobunjiHandShoulderScanWrapped = true;
  global.renderPortraitProfile = wrappedRender;
  if (global.renderProfile === originalRenderPortrait) global.renderProfile = wrappedRender;

  global.PortraitHandShoulderScan = Object.freeze({
    mode: 'raw-arm-shoulder-scan',
    shoulderDropFraction: SHOULDER_DROP_FRAC,
  });
})(window);
