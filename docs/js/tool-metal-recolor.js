// Tool metal/verdigris recolorer — turns a base tool sprite (the same
// #5A8480-keyed placeholder art TOOL_SHAPE_DEFS.baseSprite points at) into a
// specific metal's clean color, then grows a verdigris oxidation pattern
// over it proportional to that literal tool's own mastery XP (see
// toolVerdigrisFraction in game.js). Ported near-verbatim from the
// "Hobunji Tool Sprite Recolorer V3" dev tool (hue/sat-tolerance pixel
// matching + seeded wobbly-blotch oxidation growth) so crafted tools render
// with the exact look that dev tool previews — see docs/tools/ for it once
// it's added there.
//
// Recolor rule (same as the dev tool): a pixel is edited only when its hue/
// saturation sit within tolerance of the source key color; matched pixels
// take the target hue/saturation but keep their own value/alpha, so the
// sprite's existing shading survives untouched.
(() => {
  "use strict";

  const SOURCE_HEX = '#5A8480';
  const DEFAULT_HUE_TOL_DEG = 22;
  const DEFAULT_SAT_TOL = 0.22;

  function hexToRgb(hex) {
    const clean = String(hex).replace('#', '').trim();
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const value = Number.parseInt(full || '000000', 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
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
    s = Math.max(0, Math.min(1, s));
    v = Math.max(0, Math.min(1, v));
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
    return [Math.round((rp + m) * 255), Math.round((gp + m) * 255), Math.round((bp + m) * 255)];
  }

  function hueDistance(a, b) {
    return Math.abs((((a - b) % 360) + 540) % 360 - 180);
  }

  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
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
  function valueNoise1D(x, seed) {
    const xi = Math.floor(x), xf = x - xi;
    const v0 = hashUnit1D(xi, seed) * 2 - 1;
    const v1 = hashUnit1D(xi + 1, seed) * 2 - 1;
    return lerp(v0, v1, smoothstep(xf));
  }

  // Picks which matched ("metal") pixels are oxidized, given a target
  // coverage fraction — grows outward from a handful of seeded blotch
  // centers with wobbly (noisy) edges rather than a uniform threshold.
  function buildOxidationMask(metalPixels, width, amount, opts) {
    const mask = new Set();
    const targetCount = Math.round(metalPixels.length * clamp01(amount));
    if (!targetCount || !metalPixels.length) return mask;
    if (targetCount >= metalPixels.length) { metalPixels.forEach(p => mask.add(p)); return mask; }

    const seed = (opts.seed >>> 0) || 1;
    const rng = mulberry32(seed);
    const blotchCount = Math.max(1, Math.min(opts.blotchCount | 0 || 10, metalPixels.length));
    const baseRadius = Math.max(1.2, Math.sqrt(metalPixels.length / blotchCount / Math.PI));
    const centers = [];
    for (let c = 0; c < blotchCount; c++) {
      const p = metalPixels[Math.floor(rng() * metalPixels.length)];
      centers.push({
        x: p % width, y: Math.floor(p / width),
        radius: baseRadius * lerp(0.72, 1.72, rng()),
        phase: rng() * 19.37,
        kink: rng() < 0.5 ? -1 : 1,
      });
    }
    const scored = [];
    for (const p of metalPixels) {
      const x = p % width, y = Math.floor(p / width);
      let best = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const center = centers[c];
        const dx = x - center.x, dy = y - center.y;
        const distance = Math.hypot(dx, dy);
        const angle01 = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
        const wideWobble = valueNoise1D(angle01 * 5.2 + center.phase, seed + c * 977 + 101) * 0.36;
        const fineJitter = valueNoise1D(angle01 * 17.0 + center.phase, seed + c * 977 + 202) * 0.14;
        const kinkNoise = Math.max(0, valueNoise1D(angle01 * 8.0 + center.phase, seed + c * 977 + 303) - 0.62) * center.kink * 0.22;
        const radius = Math.max(0.35, center.radius * (1 + wideWobble + fineJitter + kinkNoise));
        best = Math.min(best, distance / radius);
      }
      scored.push({ p, score: best });
    }
    scored.sort((a, b) => a.score - b.score);
    for (let i = 0; i < targetCount; i++) mask.add(scored[i].p);
    return mask;
  }

  function recolorAndOxidize(imageData, opts) {
    const { data, width, height } = imageData;
    const sourceHsv = rgbToHsv(...hexToRgb(opts.sourceHex || SOURCE_HEX));
    const targetHsv = rgbToHsv(...hexToRgb(opts.targetHex));
    const verdigrisHsv = opts.verdigrisHex ? rgbToHsv(...hexToRgb(opts.verdigrisHex)) : null;
    const hueTol = opts.hueToleranceDeg ?? DEFAULT_HUE_TOL_DEG;
    const satTol = opts.saturationTolerance ?? DEFAULT_SAT_TOL;

    const metalPixels = [];
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha <= 4) continue;
      const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (hueDistance(hsv.h, sourceHsv.h) > hueTol) continue;
      if (Math.abs(hsv.s - sourceHsv.s) > satTol) continue;
      const [r, g, b] = hsvToRgb(targetHsv.h, targetHsv.s, hsv.v);
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
      metalPixels.push(i >> 2);
    }

    const amount = clamp01(opts.oxidationAmount);
    if (amount > 0 && verdigrisHsv) {
      const oxidized = buildOxidationMask(metalPixels, width, amount, opts);
      oxidized.forEach(p => {
        const i = p * 4;
        const v = rgbToHsv(data[i], data[i + 1], data[i + 2]).v;
        const [r, g, b] = hsvToRgb(verdigrisHsv.h, verdigrisHsv.s, v);
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      });
    }
    return imageData;
  }

  const _imgCache = new Map();    // spritePath -> Promise<HTMLImageElement>
  const _canvasCache = new Map(); // cacheKey -> canvas

  function loadImage(spritePath) {
    let p = _imgCache.get(spritePath);
    if (p) return p;
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = spritePath;
    });
    _imgCache.set(spritePath, p);
    return p;
  }

  // opts: { targetHex, verdigrisHex, oxidationAmount(0..1), sourceHex,
  //   hueToleranceDeg, saturationTolerance, seed, blotchCount }
  // Returns Promise<HTMLCanvasElement>, cached by (spritePath + every opt
  // that affects the pixels) so re-requesting the same tool at the same
  // verdigris fraction (e.g. every HUD refresh) reuses one canvas.
  function getRecoloredCanvas(spritePath, opts) {
    const seed = opts.seed ?? 28480;
    const blotchCount = opts.blotchCount ?? 14;
    const cacheKey = [spritePath, opts.targetHex, opts.verdigrisHex || '', (opts.oxidationAmount || 0).toFixed(3), seed, blotchCount].join('|');
    const cached = _canvasCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    return loadImage(spritePath).then(img => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      recolorAndOxidize(imageData, { ...opts, seed, blotchCount });
      ctx.putImageData(imageData, 0, 0);
      _canvasCache.set(cacheKey, canvas);
      return canvas;
    });
  }

  window.ToolMetalRecolor = { getRecoloredCanvas, rgbToHsv, hsvToRgb, SOURCE_HEX };
})();
