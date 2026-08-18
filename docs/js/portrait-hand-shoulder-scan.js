// Calculates fallback shoulder targets from raw portrait arm sprites without changing
// the portrait renderer. Manual shoulder points are resolved separately by the hand
// runtime; this module is only used when a side is authored as 0,0.
//
// Fallback algorithm:
//  1. Find the largest connected mass of opaque pixels and crop to its bounds.
//  2. Keep the top third of that main mass and recalculate opaque bounds there.
//  3. Use the center of those recropped bounds as the shoulder target.
(function (global) {
  'use strict';

  const ARM_RE = /arm[lr]/i;
  const LOGICAL_W = 200;
  const LOGICAL_H = 200;
  const LAYER_SIZE = 80;
  const ALPHA_THRESHOLD = 8;
  const imageCache = new Map();
  const scanCache = new Map();
  const selfUrl = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const docsBase = selfUrl ? new URL('../', selfUrl) : new URL('./', location.href);

  function resolvedFighterFor(profile) {
    const explicitlyPreserved = profile?.__hobunjiShoulderSourceFighter;
    if (explicitlyPreserved) return explicitlyPreserved;
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

  function alphaAt(data, width, x, y) {
    return data[(y * width + x) * 4 + 3];
  }

  // Eight-neighbour connected components make isolated accessory flecks or tiny
  // anti-aliased islands unable to pull the detected shoulder away from the arm.
  function largestOpaqueComponent(data, width, height, threshold = ALPHA_THRESHOLD) {
    const visited = new Uint8Array(width * height);
    let best = null;
    const neighbors = [
      [-1,-1], [0,-1], [1,-1],
      [-1, 0],          [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const start = y * width + x;
        if (visited[start] || alphaAt(data, width, x, y) <= threshold) continue;
        visited[start] = 1;
        const queueX = [x];
        const queueY = [y];
        let head = 0;
        let count = 0;
        let alphaSum = 0;
        let minX = x, maxX = x, minY = y, maxY = y;
        const pixels = [];

        while (head < queueX.length) {
          const px = queueX[head];
          const py = queueY[head++];
          const alpha = alphaAt(data, width, px, py);
          count++;
          alphaSum += alpha;
          pixels.push(py * width + px);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;

          for (const [dx, dy] of neighbors) {
            const nx = px + dx, ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const index = ny * width + nx;
            if (visited[index] || alphaAt(data, width, nx, ny) <= threshold) continue;
            visited[index] = 1;
            queueX.push(nx);
            queueY.push(ny);
          }
        }

        const score = count * 256 + alphaSum / 255;
        if (!best || score > best.score) best = { score, count, alphaSum, minX, maxX, minY, maxY, pixels };
      }
    }
    return best;
  }

  function recropTopThird(component, width) {
    if (!component?.pixels?.length) return null;
    const massHeight = component.maxY - component.minY + 1;
    const topThirdBottom = component.minY + Math.max(1, Math.ceil(massHeight / 3)) - 1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
    for (const index of component.pixels) {
      const y = Math.floor(index / width);
      if (y < component.minY || y > topThirdBottom) continue;
      const x = index - y * width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      count++;
    }
    return count ? { minX, maxX, minY, maxY, count, topThirdBottom } : null;
  }

  function scanShoulder(canvas) {
    const width = canvas?.width || 0;
    const height = canvas?.height || 0;
    if (!width || !height) return null;
    let data;
    try { data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data; }
    catch (_) { return null; }

    const mainMass = largestOpaqueComponent(data, width, height);
    if (!mainMass) return null;
    const topThird = recropTopThird(mainMass, width);
    const bounds = topThird || mainMass;
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      detection: 'main-mass-top-third-center',
      mainMassBounds: { minX: mainMass.minX, maxX: mainMass.maxX, minY: mainMass.minY, maxY: mainMass.maxY },
      topThirdBounds: topThird ? { minX: topThird.minX, maxX: topThird.maxX, minY: topThird.minY, maxY: topThird.maxY } : null,
      mainMassPixels: mainMass.count,
      topThirdPixels: topThird?.count || 0,
    };
  }

  function cacheKey(profile, width, height) {
    const fighter = resolvedFighterFor(profile);
    const layers = (fighter?.bodyLayers || [])
      .filter(layer => ARM_RE.test(String(layer?.id || '')) && layer?.url)
      .map(layer => `${layer.id}:${layer.url}:${JSON.stringify(xformFor(layer))}`)
      .join('|');
    return `${width}x${height}|${layers}`;
  }

  async function scanProfile(profile, width = 256, height = 256) {
    const fighter = resolvedFighterFor(profile);
    const armLayers = (fighter?.bodyLayers || [])
      .filter(layer => ARM_RE.test(String(layer?.id || '')) && layer?.url);
    const w = Math.max(1, Math.round(Number(width) || 256));
    const h = Math.max(1, Math.round(Number(height) || 256));
    if (!fighter || !armLayers.length) return null;

    const key = cacheKey(profile, w, h);
    if (scanCache.has(key)) return scanCache.get(key);
    const promise = (async () => {
      const sides = {};
      for (const layer of armLayers) {
        const lowerId = String(layer.id || '').toLowerCase();
        const side = lowerId.includes('arml') ? 'left' : lowerId.includes('armr') ? 'right' : null;
        if (!side) continue;
        const image = await loadImage(layer.url);
        if (!image) continue;
        const scratch = document.createElement('canvas');
        scratch.width = w;
        scratch.height = h;
        drawArmCoverage(scratch, image, layer);
        const shoulder = scanShoulder(scratch);
        if (shoulder) sides[side] = { ...shoulder, layerId: layer.id, layerUrl: layer.url };
      }
      return Object.keys(sides).length ? {
        mode: 'raw-arm-main-mass-top-third',
        width: w,
        height: h,
        sides,
      } : null;
    })();
    scanCache.set(key, promise);
    return promise;
  }

  global.PortraitHandShoulderScan = Object.freeze({
    mode: 'raw-arm-main-mass-top-third',
    scanProfile,
    scanShoulderCanvas: scanShoulder,
  });
})(window);
