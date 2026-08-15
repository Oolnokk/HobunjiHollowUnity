// Sprite recolor utility for authored item/object PNGs. Keyed liquid fills
// replace hue+saturation while retaining each pixel's painted HSV value and
// alpha; direct whole-sprite fills retain the animal shade-fill method.
// Two modes:
//   - "keyed": only pixels whose hue is near the placeholder green get
//     recolored, regardless of their saturation or value. Everything else
//     (glass, cork, outline...) is untouched.
//     Used by jar_liquid.png / bottle_potion.png / bottle_wine.png, whose
//     placeholder liquid fill uses exactly #9ED775 (highlight) and #698F4E
//     (shadow) plus antialiased blends between them.
//   - "direct": every non-transparent pixel is recolored. Used by
//     pile_dew.png / cheese.png, whose entire sprite is the "thing" being
//     recolored — no separate container/outline region to preserve.
(() => {
  "use strict";

  const DEFAULT_KEY_A = [0x9E, 0xD7, 0x75];
  const DEFAULT_KEY_B = [0x69, 0x8F, 0x4E];
  const KEY_HUE_TOLERANCE = 35;

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function relativeLuminance(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
  }

  function hsvToRgb(h, s, v) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const chroma = v * s;
    const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const offset = v - chroma;
    let r = 0, g = 0, b = 0;
    if (hue < 60) { r = chroma; g = secondary; }
    else if (hue < 120) { r = secondary; g = chroma; }
    else if (hue < 180) { g = chroma; b = secondary; }
    else if (hue < 240) { g = secondary; b = chroma; }
    else if (hue < 300) { r = secondary; b = chroma; }
    else { r = chroma; b = secondary; }
    return [clampByte((r + offset) * 255), clampByte((g + offset) * 255), clampByte((b + offset) * 255)];
  }

  function hueDistance(a, b) {
    const difference = Math.abs(a - b) % 360;
    return Math.min(difference, 360 - difference);
  }

  function shadeFillConfig() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting || {};
    return {
      shadowFloor: Number.isFinite(Number(cfg.shadowFloor)) ? Number(cfg.shadowFloor) : 0.18,
      highlightBoost: Number.isFinite(Number(cfg.highlightBoost)) ? Number(cfg.highlightBoost) : 1.18,
      neutralLuminance: Number.isFinite(Number(cfg.neutralLuminance)) ? Number(cfg.neutralLuminance) : 0.55,
      gamma: Number.isFinite(Number(cfg.gamma)) && Number(cfg.gamma) > 0 ? Number(cfg.gamma) : 1,
      preserveNearBlackOutlines: cfg.preserveNearBlackOutlines !== false,
      outlineThreshold: Number.isFinite(Number(cfg.outlineThreshold)) ? Number(cfg.outlineThreshold) : 0.08,
    };
  }

  function recolorImageData(data, targetHex, mode, opts) {
    const tr = (targetHex >> 16) & 255, tg = (targetHex >> 8) & 255, tb = targetHex & 255;
    if (mode === 'keyed') {
      const keyColor = opts?.keyColors?.[0] || DEFAULT_KEY_A;
      const keyHue = Number.isFinite(Number(opts?.keyHue)) ? Number(opts.keyHue) : rgbToHsv(...keyColor).h;
      const hueTolerance = Number.isFinite(Number(opts?.hueTolerance)) ? Number(opts.hueTolerance) : KEY_HUE_TOLERANCE;
      const target = rgbToHsv(tr, tg, tb);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const source = rgbToHsv(data[i], data[i + 1], data[i + 2]);
        if (hueDistance(source.h, keyHue) > hueTolerance) continue;
        const [r, g, b] = hsvToRgb(target.h, target.s, source.v);
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      }
      return;
    }

    if (window.CreatureGeneticsRender?.recolorPixels) {
      window.CreatureGeneticsRender.recolorPixels(data, [tr, tg, tb], null);
      return;
    }

    const cfg = shadeFillConfig();
    const neutral = Math.max(0.0001, cfg.neutralLuminance);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = relativeLuminance(r, g, b);
      if (cfg.preserveNearBlackOutlines && lum <= cfg.outlineThreshold) continue;
      const normalized = Math.pow(Math.max(0, lum) / neutral, cfg.gamma);
      const shade = Math.max(cfg.shadowFloor, Math.min(cfg.highlightBoost, normalized));
      data[i] = clampByte(tr * shade);
      data[i + 1] = clampByte(tg * shade);
      data[i + 2] = clampByte(tb * shade);
    }
  }

  const _imgCache = new Map();
  const _canvasCache = new Map();

  function loadImage(spritePath) {
    let img = _imgCache.get(spritePath);
    if (img) return img.__loadPromise || Promise.resolve(img);
    img = new Image();
    const p = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load recolorable sprite ' + spritePath));
    });
    img.crossOrigin = 'anonymous';
    img.__loadPromise = p;
    img.src = spritePath;
    _imgCache.set(spritePath, img);
    return p;
  }

  function getRecoloredCanvas(spritePath, targetHex, mode, opts) {
    if (typeof mode === 'string' && mode.startsWith('fish:') && window.FishCatalog?.getRecoloredCanvas) {
      return window.FishCatalog.getRecoloredCanvas(spritePath, mode.slice(5));
    }

    const cacheKey = 'hue-key-value-v2|' + spritePath + '|' + mode + '|' + targetHex;
    const cached = _canvasCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    return loadImage(spritePath).then(img => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      recolorImageData(imageData.data, targetHex, mode, opts);
      ctx.putImageData(imageData, 0, 0);
      window.__farmLog?.(`[sprite-recolor] ${mode === 'keyed' ? 'hue-key/value-fill' : 'animal shade-fill'} ${spritePath} -> #${targetHex.toString(16).padStart(6, '0')}`, 'items');
      _canvasCache.set(cacheKey, canvas);
      return canvas;
    });
  }

  // fish-catalog must run before fishing-minigame.js so it can wrap Fishing.init
  // before game.js injects the full dependency bag. Because this file itself is
  // parser-blocking in docs/index.html, document.write keeps the catalog in that
  // same parser-ordered sequence instead of racing it as an async dynamic script.
  function loadFishCatalogForGame() {
    if (!document.getElementById('fishingOverlay') || window.FishCatalog || document.querySelector('script[data-fish-catalog]')) return;
    const ownSrc = document.currentScript?.src;
    const src = ownSrc ? new URL('fish-catalog.js?v=20260814b', ownSrc).href : 'js/fish-catalog.js?v=20260814b';
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-fish-catalog="true"></script>`);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.fishCatalog = 'true';
    script.onerror = () => console.warn('[sprite-recolor] failed to load fish-catalog.js');
    document.head.appendChild(script);
  }

  window.SpriteRecolor = {
    getRecoloredCanvas,
    recolorImageData, relativeLuminance, shadeFillConfig,
    DEFAULT_KEY_A, DEFAULT_KEY_B, KEY_HUE_TOLERANCE,
  };

  loadFishCatalogForGame();
})();
