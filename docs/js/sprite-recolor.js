// Sprite recolor utility — recolors an item/object PNG with the same
// luminance-based shade-fill used by creature-genetics-render.js for animal
// colors. Each matching source pixel's luminance scales the target RGB while
// its ALPHA remains untouched, preserving painted shadows and transparency.
// Two modes:
//   - "keyed": only pixels near a source reference color (or the segment
//     between two reference colors, for a shaded two-tone placeholder fill)
//     get recolored; everything else (glass, cork, outline...) is untouched.
//     Used by jar_liquid.png / bottle_potion.png / bottle_wine.png, whose
//     placeholder liquid fill uses exactly #9ED775 (highlight) and #698F4E
//     (shadow) plus antialiased blends between them.
//   - "direct": every non-transparent pixel is recolored. Used by
//     pile_dew.png / cheese.png, whose entire sprite is the "thing" being
//     recolored — no separate container/outline region to preserve.
(() => {
  "use strict";

  // The exact two placeholder-green tones authored into jar_liquid.png,
  // bottle_potion.png, and bottle_wine.png's liquid-fill region (verified
  // against the actual PNG pixel data: (158,215,117)=#9ED775 highlight,
  // (105,143,78)=#698F4E shadow). "Near" means within KEY_TOLERANCE of the
  // line segment between them, which catches every antialiased blend pixel
  // while staying well clear of the grayish glass/cork detailing (~48-90
  // units away) in all three sprites.
  const DEFAULT_KEY_A = [0x9E, 0xD7, 0x75];
  const DEFAULT_KEY_B = [0x69, 0x8F, 0x4E];
  const KEY_TOLERANCE = 40;

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function relativeLuminance(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  // Keep these defaults in lockstep with CreatureGeneticsRender's animal
  // shade-fill so both systems respond to the same portrait tinting config.
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

  function segmentDistSq(px, py, pz, ax, ay, az, bx, by, bz) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const ab2 = abx * abx + aby * aby + abz * abz;
    let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (ax + t * abx), dy = py - (ay + t * aby), dz = pz - (az + t * abz);
    return dx * dx + dy * dy + dz * dz;
  }

  function recolorImageData(data, targetHex, mode, opts) {
    const tr = (targetHex >> 16) & 255, tg = (targetHex >> 8) & 255, tb = targetHex & 255;
    const keyA = opts?.keyColors?.[0] || DEFAULT_KEY_A;
    const keyB = opts?.keyColors?.[1] || DEFAULT_KEY_A;
    const tol2 = (opts?.tolerance ?? KEY_TOLERANCE) ** 2;
    const predicate = mode === 'keyed'
      ? (i) => segmentDistSq(data[i], data[i + 1], data[i + 2], keyA[0], keyA[1], keyA[2], keyB[0], keyB[1], keyB[2]) <= tol2
      : null;

    // The main game loads CreatureGeneticsRender first, so bottles directly
    // share the animal recolorer. The local fallback keeps this small utility
    // usable by standalone tools that do not load the creature renderer.
    if (window.CreatureGeneticsRender?.recolorPixels) {
      window.CreatureGeneticsRender.recolorPixels(data, [tr, tg, tb], predicate);
      return;
    }

    const cfg = shadeFillConfig();
    const neutral = Math.max(0.0001, cfg.neutralLuminance);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (predicate && !predicate(i)) continue;
      const lum = relativeLuminance(r, g, b);
      if (cfg.preserveNearBlackOutlines && lum <= cfg.outlineThreshold) continue;
      const normalized = Math.pow(Math.max(0, lum) / neutral, cfg.gamma);
      const shade = Math.max(cfg.shadowFloor, Math.min(cfg.highlightBoost, normalized));
      data[i] = clampByte(tr * shade);
      data[i + 1] = clampByte(tg * shade);
      data[i + 2] = clampByte(tb * shade);
    }
  }

  const _imgCache = new Map();   // spritePath -> HTMLImageElement (loaded)
  const _canvasCache = new Map(); // "spritePath|mode|hex" -> canvas

  function loadImage(spritePath) {
    let img = _imgCache.get(spritePath);
    if (img) return img.__loadPromise || Promise.resolve(img);
    img = new Image();
    const p = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
    });
    img.__loadPromise = p;
    img.src = spritePath;
    _imgCache.set(spritePath, img);
    return p;
  }

  // Returns a Promise<HTMLCanvasElement> for the recolored sprite, cached by
  // (spritePath, mode, targetHex) so repeated calls (e.g. every uumkao'ii
  // rendering the same dew color, or the same jar item appearing in several
  // inventory slots) reuse one canvas instead of re-decoding/re-walking pixels.
  // opts: { tolerance, keyColors: [[r,g,b],[r,g,b]] } — only relevant to 'keyed'.
  function getRecoloredCanvas(spritePath, targetHex, mode, opts) {
    const cacheKey = 'animal-shade-fill-v1|' + spritePath + '|' + mode + '|' + targetHex;
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
      window.__farmLog?.(`[sprite-recolor] animal shade-fill ${spritePath} -> #${targetHex.toString(16).padStart(6, '0')}`, 'items');
      _canvasCache.set(cacheKey, canvas);
      return canvas;
    });
  }

  window.SpriteRecolor = {
    getRecoloredCanvas,
    recolorImageData, relativeLuminance, shadeFillConfig,
    DEFAULT_KEY_A, DEFAULT_KEY_B, KEY_TOLERANCE,
  };
})();
