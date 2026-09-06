// Tool metal/verdigris recolorer — turns a base tool sprite (the same
// #5A8480-keyed placeholder art TOOL_SHAPE_DEFS.baseSprite points at) into a
// specific metal's clean color, then grows a verdigris oxidation pattern
// over it proportional to that literal tool's own mastery XP (see
// toolVerdigrisFraction in game.js).
//
// The pixel-selection, recolor, seeded blotch growth, grain, and black-edge
// behavior intentionally mirror Hobunji Tool Sprite Recolorer V3.
(() => {
  'use strict';

  const SOURCE_HEX = '#5A8480';
  const DEFAULT_HUE_TOL_DEG = 22;
  const DEFAULT_SAT_TOL = 0.22;
  const DEFAULT_ALPHA_MIN = 4;
  const DEFAULT_OXIDATION_SEED = 28480;
  const DEFAULT_BLOTCH_COUNT = 14;
  const DEFAULT_OUTLINE_WIDTH = 2;

  function hexToRgb(hex) {
    const clean = String(hex).replace('#', '').trim();
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const value = Number.parseInt(full || '000000', 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * (((b - r) / delta) + 2);
      else h = 60 * (((r - g) / delta) + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : delta / max;
    return { h, s, v: max };
  }

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp01(s);
    v = clamp01(v);
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rp = 0, gp = 0, bp = 0;
    if (h < 60) [rp, gp, bp] = [c, x, 0];
    else if (h < 120) [rp, gp, bp] = [x, c, 0];
    else if (h < 180) [rp, gp, bp] = [0, c, x];
    else if (h < 240) [rp, gp, bp] = [0, x, c];
    else if (h < 300) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];
    return [
      Math.round((rp + m) * 255),
      Math.round((gp + m) * 255),
      Math.round((bp + m) * 255),
    ];
  }

  function hueDistance(a, b) {
    return Math.abs((((a - b) % 360) + 540) % 360 - 180);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function resolveOutputSaturation(originalS, sourceS, targetS, mode) {
    if (mode === 'original') return clamp01(originalS);
    if (mode === 'offset') return clamp01(targetS + (originalS - sourceS));
    return clamp01(targetS);
  }

  function debugEnabled(opts = {}) {
    try {
      return opts.debug === true
        || window.ToolMetalRecolorDebug === true
        || window.localStorage?.getItem('toolMetalRecolorDebug') === '1';
    } catch {
      return opts.debug === true || window.ToolMetalRecolorDebug === true;
    }
  }

  function debugEmit(level, opts, label, data) {
    if (!debugEnabled(opts)) return;
    const payload = data === undefined ? '' : ` ${JSON.stringify(data)}`;
    const message = `[ToolMetalRecolor] ${label}${payload}`;
    const consoleFn = console[level] || console.log;
    consoleFn.call(console, message);
    try { window.__farmLog?.(message); } catch {}
  }

  function debugLog(opts, label, data) { debugEmit('log', opts, label, data); }
  function debugWarn(opts, label, data) { debugEmit('warn', opts, label, data); }
  function debugError(opts, label, data) { debugEmit('error', opts, label, data); }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }

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

  function buildOxidationMask(metalMask, width, height, amount, opts) {
    const metalPixels = [];
    for (let p = 0; p < metalMask.length; p++) {
      if (metalMask[p]) metalPixels.push(p);
    }

    const targetCount = Math.round(metalPixels.length * clamp01(amount));
    const mask = new Uint8Array(metalMask.length);
    debugLog(opts, 'oxidation mask request', {
      matchedMetalPixels: metalPixels.length,
      targetCount,
      oxidationAmount: clamp01(amount),
      width,
      height,
      seed: opts.seed,
      blotchCount: opts.blotchCount,
    });
    if (!metalPixels.length) {
      debugWarn(opts, 'oxidation mask has no matched metal pixels');
      return mask;
    }
    if (!targetCount) return mask;
    if (targetCount >= metalPixels.length) {
      for (const p of metalPixels) mask[p] = 1;
      return mask;
    }

    const seed = (opts.seed >>> 0) || 1;
    const rng = mulberry32(seed);
    const requestedCount = Math.max(1, Math.min(opts.blotchCount | 0, metalPixels.length));
    const centers = [];
    const baseRadius = Math.max(1.2, Math.sqrt(metalPixels.length / Math.max(1, requestedCount) / Math.PI));

    for (let c = 0; c < requestedCount; c++) {
      const p = metalPixels[Math.floor(rng() * metalPixels.length)] || metalPixels[0];
      centers.push({
        x: p % width,
        y: Math.floor(p / width),
        radius: baseRadius * lerp(0.72, 1.72, rng()),
        phase: rng() * 19.37,
        kink: rng() < 0.5 ? -1 : 1,
      });
    }

    const scored = [];
    for (const p of metalPixels) {
      const x = p % width;
      const y = Math.floor(p / width);
      let best = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const center = centers[c];
        const dx = x - center.x;
        const dy = y - center.y;
        const distance = Math.hypot(dx, dy);
        const angle01 = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
        const wideWobble = valueNoise1D(angle01 * 5.2 + center.phase, seed + c * 977 + 101) * 0.36;
        const fineJitter = valueNoise1D(angle01 * 17.0 + center.phase, seed + c * 977 + 202) * 0.14;
        const kinkNoise = Math.max(0, valueNoise1D(angle01 * 8.0 + center.phase, seed + c * 977 + 303) - 0.62) * center.kink * 0.22;
        const radius = Math.max(0.35, center.radius * (1 + wideWobble + fineJitter + kinkNoise));
        const grain = valueNoise2D(x * 0.18, y * 0.18, seed + c * 977 + 404) * 0.08;
        best = Math.min(best, (distance / radius) + grain);
      }
      scored.push({ p, score: best });
    }

    scored.sort((a, b) => a.score - b.score);
    for (let i = 0; i < targetCount; i++) mask[scored[i].p] = 1;
    return mask;
  }

  function buildOxidationOutlineMask(oxidationMask, metalMask, width, height, outlineWidth) {
    const outline = new Uint8Array(oxidationMask.length);
    if (!outlineWidth) return outline;

    const boundary = new Uint8Array(oxidationMask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!oxidationMask[p]) continue;
        let isEdge = false;
        for (let oy = -1; oy <= 1 && !isEdge; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              isEdge = true;
              break;
            }
            const np = ny * width + nx;
            if (!oxidationMask[np] && metalMask[np]) {
              isEdge = true;
              break;
            }
          }
        }
        if (isEdge) boundary[p] = 1;
      }
    }

    const radius = Math.max(1, (outlineWidth | 0) * 5);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!metalMask[p] || oxidationMask[p]) continue;
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

  function recolorAndOxidize(imageData, opts) {
    const { data, width, height } = imageData;
    const src = new Uint8ClampedArray(data);
    const sourceHsv = rgbToHsv(...hexToRgb(opts.sourceHex || SOURCE_HEX));
    const targetHsv = rgbToHsv(...hexToRgb(opts.targetHex));
    const verdigrisHsv = opts.verdigrisHex ? rgbToHsv(...hexToRgb(opts.verdigrisHex)) : null;
    const hueTol = opts.hueToleranceDeg ?? DEFAULT_HUE_TOL_DEG;
    const satTol = opts.saturationTolerance ?? DEFAULT_SAT_TOL;
    const alphaMin = opts.alphaMin ?? DEFAULT_ALPHA_MIN;
    const saturationMode = opts.saturationMode || 'target';
    const metalMask = new Uint8Array(width * height);
    let matchedMetalPixels = 0;

    for (let i = 0; i < src.length; i += 4) {
      const alpha = src[i + 3];
      if (alpha < alphaMin) continue;
      const hsv = rgbToHsv(src[i], src[i + 1], src[i + 2]);
      const hueOk = hueDistance(hsv.h, sourceHsv.h) <= hueTol;
      const satOk = Math.abs(hsv.s - sourceHsv.s) <= satTol;
      if (!hueOk || !satOk) continue;

      const pixelIndex = i >> 2;
      metalMask[pixelIndex] = 1;
      matchedMetalPixels++;
      const newSat = resolveOutputSaturation(hsv.s, sourceHsv.s, targetHsv.s, saturationMode);
      const [r, g, b] = hsvToRgb(targetHsv.h, newSat, hsv.v);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = alpha;
    }

    debugLog(opts, 'source match', {
      sourceHex: opts.sourceHex || SOURCE_HEX,
      targetHex: opts.targetHex,
      verdigrisHex: opts.verdigrisHex || null,
      matchedMetalPixels,
      totalPixels: width * height,
      hueToleranceDeg: hueTol,
      saturationTolerance: satTol,
      alphaMin,
    });
    if (!matchedMetalPixels) {
      debugWarn(opts, 'no source-metal pixels matched', {
        sourceHex: opts.sourceHex || SOURCE_HEX,
        hueToleranceDeg: hueTol,
        saturationTolerance: satTol,
      });
    }

    const amount = clamp01(opts.oxidationAmount);
    if (!amount || !verdigrisHsv || !opts.verdigrisHex) {
      debugLog(opts, 'oxidation skipped', {
        oxidationAmount: amount,
        hasVerdigrisColor: !!opts.verdigrisHex,
      });
      return imageData;
    }

    const oxidationMask = buildOxidationMask(metalMask, width, height, amount, opts);
    const outlineMask = buildOxidationOutlineMask(
      oxidationMask,
      metalMask,
      width,
      height,
      Math.max(0, opts.outlineWidth | 0),
    );

    let oxidizedPixels = 0;
    for (let p = 0; p < oxidationMask.length; p++) {
      if (!oxidationMask[p]) continue;
      oxidizedPixels++;
      const i = p * 4;
      const original = rgbToHsv(src[i], src[i + 1], src[i + 2]);
      const [r, g, b] = hsvToRgb(verdigrisHsv.h, verdigrisHsv.s, original.v);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = src[i + 3];
    }

    let outlinePixels = 0;
    for (let p = 0; p < outlineMask.length; p++) {
      if (!outlineMask[p]) continue;
      const i = p * 4;
      const alpha = src[i + 3];
      if (alpha < alphaMin) continue;
      outlinePixels++;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = alpha;
    }

    debugLog(opts, 'recolor complete', {
      matchedMetalPixels,
      oxidizedPixels,
      outlinePixels,
      width,
      height,
    });
    return imageData;
  }

  const _imgCache = new Map();
  const _canvasCache = new Map();
  window.HobunjiCacheAudit?.register('ToolMetalRecolor.imgCache', () => _imgCache.size);
  window.HobunjiCacheAudit?.register('ToolMetalRecolor.canvasCache', () => _canvasCache.size);

  function loadImage(spritePath, opts = {}) {
    let promise = _imgCache.get(spritePath);
    if (promise) {
      debugLog(opts, 'image cache hit', { spritePath });
      return promise;
    }

    debugLog(opts, 'image load start', { spritePath });
    promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        debugLog(opts, 'image load complete', {
          spritePath,
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0,
        });
        resolve(img);
      };
      img.onerror = () => {
        _imgCache.delete(spritePath);
        const error = new Error(`Failed to load tool sprite: ${spritePath}`);
        debugError(opts, 'image load failed', { spritePath, message: error.message });
        reject(error);
      };
      img.src = spritePath;
    });
    _imgCache.set(spritePath, promise);
    return promise;
  }

  // Returns a cached canvas for all pixel-affecting options. Mastery only
  // supplies oxidationAmount; it does not alter the reference algorithm.
  function getRecoloredCanvas(spritePath, opts = {}) {
    const seed = opts.seed ?? DEFAULT_OXIDATION_SEED;
    const blotchCount = opts.blotchCount ?? DEFAULT_BLOTCH_COUNT;
    const outlineWidth = opts.outlineWidth ?? DEFAULT_OUTLINE_WIDTH;
    const hueToleranceDeg = opts.hueToleranceDeg ?? DEFAULT_HUE_TOL_DEG;
    const saturationTolerance = opts.saturationTolerance ?? DEFAULT_SAT_TOL;
    const alphaMin = opts.alphaMin ?? DEFAULT_ALPHA_MIN;
    const saturationMode = opts.saturationMode || 'target';
    const sourceHex = opts.sourceHex || SOURCE_HEX;
    const oxidationAmount = clamp01(opts.oxidationAmount);
    const requestInfo = {
      spritePath,
      sourceHex,
      targetHex: opts.targetHex || null,
      verdigrisHex: opts.verdigrisHex || null,
      oxidationAmount,
      seed,
      blotchCount,
      outlineWidth,
      hueToleranceDeg,
      saturationTolerance,
      alphaMin,
      saturationMode,
    };
    const cacheKey = [
      spritePath,
      sourceHex,
      opts.targetHex,
      opts.verdigrisHex || '',
      oxidationAmount.toFixed(3),
      seed,
      blotchCount,
      outlineWidth,
      hueToleranceDeg,
      saturationTolerance,
      alphaMin,
      saturationMode,
    ].join('|');

    debugLog(opts, 'recolor request', requestInfo);
    const cached = _canvasCache.get(cacheKey);
    if (cached) {
      debugLog(opts, 'canvas cache hit', { spritePath, oxidationAmount });
      return Promise.resolve(cached);
    }

    debugLog(opts, 'canvas cache miss', { spritePath, oxidationAmount });
    if (debugEnabled(opts)) console.trace('[ToolMetalRecolor] request caller');

    return loadImage(spritePath, opts).then(img => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 1;
      canvas.height = img.naturalHeight || img.height || 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Unable to get 2D canvas context for tool recolor.');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      recolorAndOxidize(imageData, {
        ...opts,
        sourceHex,
        seed,
        blotchCount,
        outlineWidth,
        hueToleranceDeg,
        saturationTolerance,
        alphaMin,
        saturationMode,
      });
      ctx.putImageData(imageData, 0, 0);
      _canvasCache.set(cacheKey, canvas);
      debugLog(opts, 'canvas ready', {
        spritePath,
        oxidationAmount,
        width: canvas.width,
        height: canvas.height,
      });
      return canvas;
    }).catch(error => {
      debugError(opts, 'recolor request failed', {
        spritePath,
        oxidationAmount,
        message: error?.message || String(error),
      });
      throw error;
    });
  }

  function clearCache() {
    _imgCache.clear();
    _canvasCache.clear();
    debugLog({}, 'cache cleared');
  }

  window.ToolMetalRecolor = {
    getRecoloredCanvas,
    clearCache,
    rgbToHsv,
    hsvToRgb,
    SOURCE_HEX,
  };

  debugLog({}, 'module loaded', {
    seed: DEFAULT_OXIDATION_SEED,
    blotchCount: DEFAULT_BLOTCH_COUNT,
    outlineWidth: DEFAULT_OUTLINE_WIDTH,
  });
})();
