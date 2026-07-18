// Sprite recolor utility — recolors an item/object PNG by replacing each
// matching pixel's HUE and SATURATION with a target color's hue/saturation
// while leaving that pixel's own VALUE (brightness) and ALPHA untouched.
// This is the inverse of the luminance-multiply "shade fill" tint used by
// creature-genetics-render.js/portrait-utils.js (which floods a flat target
// RGB and only lets the source's luminance modulate its brightness,
// discarding the source's own hue/saturation *and* not tracking its exact
// per-pixel value) — here the source's shading/highlights survive exactly
// because V comes straight from the source pixel, not a derived multiplier.
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

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return [h, s, max];
  }

  function hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  // hex: 0xRRGGBB integer (matches ALCHEMY_REAGENT_DEFS/THREE.Color convention
  // used elsewhere in the codebase). Only hue+saturation are read from it —
  // its own value/brightness is discarded, since every recolored pixel's
  // value always comes from that pixel's own source value instead.
  function targetHueSat(hex) {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const [h, s] = rgbToHsv(r, g, b);
    return [h, s];
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
    const [th, ts] = targetHueSat(targetHex);
    const keyA = opts?.keyColors?.[0] || DEFAULT_KEY_A;
    const keyB = opts?.keyColors?.[1] || DEFAULT_KEY_A;
    const tol2 = (opts?.tolerance ?? KEY_TOLERANCE) ** 2;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (mode === 'keyed') {
        const d2 = segmentDistSq(r, g, b, keyA[0], keyA[1], keyA[2], keyB[0], keyB[1], keyB[2]);
        if (d2 > tol2) continue;
      }
      const v = Math.max(r, g, b) / 255;
      const [nr, ng, nb] = hsvToRgb(th, ts, v);
      data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
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
    const cacheKey = spritePath + '|' + mode + '|' + targetHex;
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
      _canvasCache.set(cacheKey, canvas);
      return canvas;
    });
  }

  window.SpriteRecolor = {
    getRecoloredCanvas,
    rgbToHsv, hsvToRgb, targetHueSat,
    DEFAULT_KEY_A, DEFAULT_KEY_B, KEY_TOLERANCE,
  };
})();
