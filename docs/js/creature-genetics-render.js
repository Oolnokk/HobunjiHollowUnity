// Base-color recolor + pattern-overlay compositing for genotype-bearing
// livestock (gar-wolf, dabinggi-hound) — a runtime port of the "Same direct
// fill" recolor algorithm and layer compositing from the uploaded
// "Creature Pattern, Base Recolor & Breeding Lab" HTML tool. Masked base
// pixels and every non-transparent pattern-overlay pixel get their hue and
// saturation replaced by the target palette color while keeping their
// original value (shading) and alpha — see recolorPixels below.
//
// Public API: window.CreatureGeneticsRender = {
//   composeFrame(kind, frame, genotype) -> Promise<canvas|null>,
//   genotypeSignature(kind, genotype) -> string,
//   SPECIES,
// }
(function () {
  'use strict';

  const SPECIES = {
    'gar-wolf': {
      prefix: 'gw',
      base: {
        idle: 'assets/creaturesprites/gar-wolf_idle.png',
        run1: 'assets/creaturesprites/gar-wolf_run1.png',
        run2: 'assets/creaturesprites/gar-wolf_run2.png',
      },
      patterns: ['colorpoint', 'foxtail', 'mitts'],
    },
    'dabinggi-hound': {
      prefix: 'dh',
      base: {
        idle: 'assets/creaturesprites/dabinggi-hound_idle.png',
        run1: 'assets/creaturesprites/dabinggi-hound_run1.png',
        run2: 'assets/creaturesprites/dabinggi-hound_run2.png',
      },
      patterns: ['mitts', 'spectacles', 'stripes'],
    },
  };

  function patternUrl(kind, patternId, frame) {
    const spec = SPECIES[kind];
    if (!spec) return null;
    return `assets/creaturesprites/patterns/${spec.prefix}_${patternId}_${frame}.png`;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  const _imageCache = new Map(); // url -> Promise<HTMLImageElement>
  function loadImage(url) {
    if (_imageCache.has(url)) return _imageCache.get(url);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load ' + url));
      img.src = url;
    });
    _imageCache.set(url, p);
    return p;
  }

  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; }
    return [h, max === 0 ? 0 : d / max, max];
  }
  function hsvToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // The source art's recolorable fur/pattern pixels are drawn quite dark
  // (measured: ~90% of the base sprite's masked pixels fall between 0.2 and
  // 0.4 value, average ~0.25) — feeding that straight into hsvToRgb crushes
  // every target hue/saturation into a visually similar dark, muddy tone,
  // which is why different palette colors were reading as "everything looks
  // reddish" with no real variation between packs. Remapping into a
  // brighter working range keeps the original shading's relative contrast
  // (shadow vs highlight) while giving the target color enough brightness
  // to actually read as itself.
  function _remapValue(v) { return Math.min(1, 0.3 + v * 1.4); }

  // "Same direct fill": every affected pixel keeps its original value+alpha
  // (remapped — see _remapValue), only hue+saturation are replaced with the
  // target color's.
  function recolorPixels(px, targetH, targetS, predicate) {
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      if (predicate && !predicate(i)) continue;
      const value = _remapValue(Math.max(px[i], px[i + 1], px[i + 2]) / 255);
      const [r, g, b] = hsvToRgb(targetH, targetS, value);
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }

  const _recolorCache = new Map(); // key -> Promise<canvas>
  async function recoloredBase(url, color, mask) {
    const key = `base|${url}|${color}`;
    if (_recolorCache.has(key)) return _recolorCache.get(key);
    const promise = (async () => {
      const img = await loadImage(url);
      if (!mask || mask.width !== img.naturalWidth || mask.height !== img.naturalHeight) return img;
      const c = makeCanvas(img.naturalWidth, img.naturalHeight), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
      const [tr, tg, tb] = hexToRgb(color), [targetH, targetS] = rgbToHsv(tr, tg, tb);
      recolorPixels(px, targetH, targetS, (i) => mask.data[i / 4]);
      ctx.putImageData(data, 0, 0);
      return c;
    })().catch(err => { _recolorCache.delete(key); throw err; });
    _recolorCache.set(key, promise);
    return promise;
  }
  async function recoloredPattern(url, color) {
    const key = `pattern|${url}|${color}`;
    if (_recolorCache.has(key)) return _recolorCache.get(key);
    const promise = (async () => {
      const img = await loadImage(url);
      const c = makeCanvas(img.naturalWidth, img.naturalHeight), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
      const [tr, tg, tb] = hexToRgb(color), [targetH, targetS] = rgbToHsv(tr, tg, tb);
      recolorPixels(px, targetH, targetS, null);
      ctx.putImageData(data, 0, 0);
      return c;
    })().catch(err => { _recolorCache.delete(key); throw err; });
    _recolorCache.set(key, promise);
    return promise;
  }

  function decodeMaskRle(encoded) {
    if (!encoded || encoded.encoding !== 'selected-pixel-index-runs-v1' || !Number.isInteger(encoded.width) || !Number.isInteger(encoded.height) || !Array.isArray(encoded.runs)) return null;
    const data = new Uint8Array(encoded.width * encoded.height);
    for (let i = 0; i + 1 < encoded.runs.length; i += 2) {
      const start = Number(encoded.runs[i]), length = Number(encoded.runs[i + 1]);
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > data.length) continue;
      data.fill(1, start, start + length);
    }
    return { width: encoded.width, height: encoded.height, data };
  }

  let _maskPromise = null;
  function loadBaseMasks() {
    if (_maskPromise) return _maskPromise;
    _maskPromise = fetch('config/creature-base-masks.json').then(r => r.json()).then(raw => {
      const out = {};
      for (const [kind, frames] of Object.entries(raw || {})) {
        out[kind] = {};
        for (const [frame, encoded] of Object.entries(frames)) out[kind][frame] = decodeMaskRle(encoded);
      }
      return out;
    }).catch(() => ({}));
    return _maskPromise;
  }

  // Draw order matches SPECIES[kind].patterns — the same fixed layer order
  // the HTML lab uses (each species' patterns object insertion order).
  async function composeFrame(kind, frame, genotype) {
    const spec = SPECIES[kind];
    if (!spec) {
      window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): no SPECIES config for "${kind}" — returning null (creature falls back to its plain sprite)`, 'wildlife');
      return null;
    }
    const baseUrl = spec.base[frame] || spec.base.idle;
    const masks = await loadBaseMasks();
    const mask = masks?.[kind]?.[frame];
    if (!mask) window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): no base mask found — base fur will render unrecolored`, 'wildlife');
    const baseColor = genotype?.base?.color;
    const baseSource = (baseColor && mask) ? await recoloredBase(baseUrl, baseColor, mask) : await loadImage(baseUrl);
    const bw = baseSource.naturalWidth || baseSource.width, bh = baseSource.naturalHeight || baseSource.height;
    const c = makeCanvas(bw, bh), ctx = c.getContext('2d');
    ctx.drawImage(baseSource, 0, 0);
    const drawnPatterns = [];
    for (const patternId of spec.patterns) {
      const layer = genotype?.[patternId];
      if (!layer?.enabled || !(layer.copies > 0) || !layer.color) continue;
      const url = patternUrl(kind, patternId, frame);
      try {
        const recolored = await recoloredPattern(url, layer.color);
        ctx.drawImage(recolored, 0, 0, c.width, c.height);
        drawnPatterns.push(patternId);
      } catch (e) {
        window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): pattern "${patternId}" failed to load/recolor (${url}) — skipped: ${e.message}`, 'warn');
      }
    }
    window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): base=${baseColor || '(none)'} patterns=[${drawnPatterns.join(',') || 'none'}]`, 'wildlife');
    return c;
  }

  function genotypeSignature(kind, genotype) {
    const spec = SPECIES[kind];
    if (!spec) return 'none';
    const parts = [genotype?.base?.color || ''];
    for (const id of spec.patterns) {
      const l = genotype?.[id];
      parts.push((l?.enabled && l.copies > 0 && l.color) ? `${id}:${l.color}` : '');
    }
    return parts.join('|');
  }

  window.CreatureGeneticsRender = { composeFrame, genotypeSignature, SPECIES };
})();
