// Base-color recolor + pattern-overlay compositing for genotype-bearing
// livestock (gar-wolf, dabinggi-hound). Layer compositing (base + ordered
// pattern overlays) follows the uploaded "Creature Pattern, Base Recolor &
// Breeding Lab" HTML tool; the actual per-pixel recolor math instead
// mimics this game's own established body-cosmetics pipeline — the same
// "hex shade-fill" tint portrait-utils.js's getTintedShadeFillCanvas uses
// for NPC skin/hair/clothing layers, which then feed into
// PNGPlaneAvatar.buildSinglePlaneAvatarModel the same way this module's
// output feeds into the animal plane avatars. That's a multiplicative
// luminance-based tint (target color scaled by each pixel's own relative
// luminance, clamped to a shadow/highlight range), not an HSV hue/
// saturation replace — see recolorPixels below. Near-black outline ink is
// protected automatically by luminance, same as the NPC pipeline; the
// creature base sprites still need an explicit region mask on top of that
// (see loadBaseMasks) since they're one flat multi-region image rather
// than separate per-part layers the way NPC art is authored.
//
// Public API: window.CreatureGeneticsRender = {
//   composeFrame(kind, frame, genotype) -> Promise<canvas|null>,
//   genotypeSignature(kind, genotype) -> string,
//   prewarm(kinds?) -> Promise<void>,
//   SPECIES,
//   recolorPixels(px, targetRgb, predicate?) -> void (in-place ImageData shade-fill tint),
//   hexToRgb(hex) -> [r,g,b],
// }
(function () {
  'use strict';

  const MODULE_SCRIPT_URL = typeof document !== 'undefined' ? (document.currentScript?.src || '') : ''; // Lets the exact runtime compositor run from nested docs/tools pages without changing asset semantics in-game.
  // creature-genetics-render.js lives in docs/js/, so ../ is the docs root. Tool
  // loaders that fetch this file and run it from a blob: URL (Animation Author,
  // the docs/references previews) have no hierarchical base, and
  // new URL('../', 'blob:...') throws; they rewrite asset paths themselves, so
  // fall back to leaving paths unchanged.
  const DOCS_BASE_URL = (() => {
    if (!MODULE_SCRIPT_URL || /^(?:blob|data):/i.test(MODULE_SCRIPT_URL)) return '';
    try { return new URL('../', MODULE_SCRIPT_URL).href; } catch { return ''; }
  })();
  function docsUrl(path) {
    const value = String(path || '');
    if (!value || /^(?:data:|blob:|https?:)/i.test(value) || !DOCS_BASE_URL) return value;
    return new URL(value.replace(/^\.\//, ''), DOCS_BASE_URL).href;
  }

  const SPECIES = {
    'gar-wolf': {
      prefix: 'gw',
      baseShadeReferenceHex: '#565047', // Authored full-strength Gar-wolf coat color; fixed anchor prevents unrelated highlights from changing coat tint.
      base: {
        idle: 'assets/creaturesprites/gar-wolf_idle.png',
        run1: 'assets/creaturesprites/gar-wolf_run1.png',
        run2: 'assets/creaturesprites/gar-wolf_run2.png',
      },
      patterns: ['colorpoint', 'foxtail', 'mitts'],
      eyes: { open: 'assets/creaturesprites/gar-wolf_eye.png', blink: 'assets/creaturesprites/gar-wolf_blink.png' },
    },
    'dabinggi-hound': {
      prefix: 'dh',
      baseShadeReferenceHex: '#585E5D', // Authored full-strength Dabingi-hound coat color; fixed anchor prevents unrelated highlights from changing coat tint.
      base: {
        idle: 'assets/creaturesprites/dabinggi-hound_idle.png',
        run1: 'assets/creaturesprites/dabinggi-hound_run1.png',
        run2: 'assets/creaturesprites/dabinggi-hound_run2.png',
      },
      patterns: ['mitts', 'spectacles', 'stripes'],
      eyes: { open: 'assets/creaturesprites/dabinggi-hound_eye.png', blink: 'assets/creaturesprites/dabinggi-hound_blink.png' },
    },
    grehlr: {
      prefix: 'grehlr',
      baseShadeReferenceHex: '#424242', // Authored full-strength Grehlr coat color; exact source anchor for genotype recoloring.
      base: { idle: 'assets/creaturesprites/grehlr_idle.png', run1: 'assets/creaturesprites/grehlr_run1.png', run2: 'assets/creaturesprites/grehlr_run2.png' },
      patterns: ['mitts', 'spectacles'],
      eyes: { open: 'assets/creaturesprites/grehlr_eye.png', blink: 'assets/creaturesprites/grehlr_blink.png' },
    },
    drenkirra: {
      prefix: 'drnk',
      baseShadeReferenceHex: '#68D127', // Authored full-strength Drenkirra base-coat color; species without this field retain automatic peak fallback.
      base: { idle: 'assets/creaturesprites/drenkirra_idle.png', run1: 'assets/creaturesprites/drenkirra_run1.png', run2: 'assets/creaturesprites/drenkirra_run2.png' },
      patterns: ['bodystripes', 'spectacles'],
      eyes: { open: 'assets/creaturesprites/drenkirra_eye.png', blink: 'assets/creaturesprites/drenkirra_blink.png' },
    },
    // Uumkao'ii now owns three locomotion frames and a permanent shell over a recolorable base.
    // Old saved fur/plates genotypes are adapted without rewriting their save files.
    uumkaoii: {
      prefix: 'uum',
      fullBaseRecolor: true,
      base: {
        idle: "assets/creaturesprites/uumkao'ii_idle.png",
        run1: "assets/creaturesprites/uumkao'ii_run1.png",
        run2: "assets/creaturesprites/uumkao'ii_run2.png",
      },
      patterns: ['shell'],
      eyes: { open: "assets/creaturesprites/uumkao'ii_eye.png", blink: "assets/creaturesprites/uumkao'ii_blink.png" },
    },
    nelk: {
      prefix: 'nelk',
      fullBaseRecolor: true,
      patternAssetRoot: 'assets/creaturesprites',
      comboPatterns: { brushtail: { when: 'cape', sprite: 'brushtail-caped' } }, // The uploaded file's exact spelling is -caped, not -cape.
      base: {
        idle: 'assets/creaturesprites/nelk_idle.png',
        run1: 'assets/creaturesprites/nelk_run1.png',
        run2: 'assets/creaturesprites/nelk_run2.png',
      },
      patterns: ['brushtail', 'cape', 'spectacles'],
      eyes: { mode: 'cycle', variants: ['A','B','C','D'].map(id => `assets/creaturesprites/nelk_eye-${id}.png`),
        skinRecolorKey: { hex: '#A3C89F', hueTolerance: 20, minSaturationRatio: 0.45, minValue: 0.12 },
        skinColorPattern: 'spectacles' }, // Mint skin follows expressed spectacles, falling back to the base coat; iris and outlines remain untouched.
    },
    honeyfuzzle: {
      prefix: 'honeyfuzzle',
      singleFrame: true, // Tail/spectacles PNGs have no idle/run suffix and align with each 478x399 fly pose.
      fullBaseRecolor: true, // Chatheads use the same primary coat gene as the shader-driven in-world swarm.
      baseShadeReferenceHex: '#9FB28E', // Measured native honeyfuzzle body pixel (159,178,142); static previews use this tint reference.
      base: {
        idle: 'assets/creaturesprites/honeyfuzzle_fly1.png',
        run1: 'assets/creaturesprites/honeyfuzzle_fly2.png',
        run2: 'assets/creaturesprites/honeyfuzzle_fly3.png',
      },
      patterns: ['tailfeathers', 'spectacles'],
      underlayPatterns: ['tailfeathers'], // The anatomical tail is always visible BELOW the body, even with no expressed allele.
    },
    nazgraku: {
      prefix: 'nzg',
      fullBaseRecolor: true,
      base: {
        idle: 'assets/creaturesprites/nazgraku_idle.png',
        run1: 'assets/creaturesprites/nazgraku_run1.png',
        run2: 'assets/creaturesprites/nazgraku_run2.png',
      },
      patterns: ['spectacles'],
      eyes: { open: 'assets/creaturesprites/nazgraku_eye.png', blink: 'assets/creaturesprites/nazgraku_blink.png' },
      // Future rider-hand rein attachment: nazgraku-mounted_reinwhisker-grippable.png
      // and ...-stable.png. For now use the NORMAL whiskered idle/run portraits on mounts.
    },
  };

  function patternUrl(kind, patternId, frame, genotype = null) {
    const spec = SPECIES[kind];
    if (!spec) return null;
    const combo = spec.comboPatterns?.[patternId]; // Selects the visual asset only; breeding still inherits two independent patterns.
    const other = genotype?.[combo?.when]; // An expressed cape substitutes Nelk's tail art, without replacing the cape itself.
    const assetId = combo && other?.enabled !== false && other?.copies > 0
      ? combo.sprite : patternId;
    const root = spec.patternAssetRoot || 'assets/creaturesprites/patterns';
    if (spec.singleFrame) return `${root}/${spec.prefix}_${assetId}.png`;
    return `${root}/${spec.prefix}_${assetId}_${frame}.png`;
  }

  function effectiveGenotype(kind, genotype) {
    if (kind !== 'uumkaoii' || !genotype || (genotype.base && genotype.shell)) return genotype;
    // Old saves stored permanent fur/plates. Translate their colors into base/shell at read time.
    return { ...genotype,
      base: genotype.base || genotype.fur,
      shell: genotype.shell || (genotype.plates && { ...genotype.plates, copies: 2, enabled: true }),
    };
  }
  function eyeStateKey(state) {
    return typeof state === 'string' && /^[A-D]$/.test(state) ? 'eye-' + state : (state ? 'b' : 'o');
  }
  function eyeStatesForKind(kind) {
    return SPECIES[kind]?.eyes?.mode === 'cycle' ? ['A','B','C','D'] : [false, true];
  }
  // These are renderer-only anatomical defaults, not extra allele slots. A later
  // authored beard2/beard3 (registered in spec.patterns and inherited genetics)
  // suppresses beard1 only when its allele is actually expressed and drawable.
  function visibleDefaultCoatPatterns(spec, genotype) {
    return (spec.defaultCoatPatterns || []).filter(defaultPattern => {
      const replacement = spec.patterns.some(id => {
        if (id === defaultPattern.id || !id.startsWith(defaultPattern.family)) return false;
        const allele = genotype?.[id]; // A carrier or unexpressed beard must not hide the ordinary beard.
        return allele?.enabled !== false && allele?.copies > 0 && !!allele?.color;
      });
      return !replacement;
    });
  }

  function eyeSkinTintColor(kind, genotype, baseColor) {
    const patternId = SPECIES[kind]?.eyes?.skinColorPattern; // Optional pattern whose visible pigmentation covers the skin surrounding an eye.
    const layer = patternId ? genotype?.[patternId] : null; // Reads the same expressed allele used by pattern-layer compositing.
    return layer?.enabled !== false && layer?.copies > 0 && layer?.color
      ? layer.color : baseColor; // Disabled, unexpressed, missing-color, and carrier-only patterns retain the base coat tint.
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  const _imageCache = new Map(); // url -> Promise<HTMLImageElement>
  function loadImage(url) {
    const resolvedUrl = docsUrl(url); // Nested Character Studio and ordinary game pages now share one authoritative creature compositor.
    if (_imageCache.has(resolvedUrl)) return _imageCache.get(resolvedUrl);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      // Without this, an image served from a different origin than the page
      // (a CDN mirror like raw.githack.com, or any future asset CDN in front
      // of the real deployment) loads fine but permanently taints every
      // canvas it's ever drawn onto — getImageData/toDataURL then throw
      // SecurityError the instant recolorPixels tries to read pixels back
      // out (see recoloredBase/recoloredPattern below). Requesting it in
      // CORS mode is a no-op for a same-origin load and only requires the
      // server send back Access-Control-Allow-Origin, which raw file CDNs
      // already do for exactly this reason.
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load ' + resolvedUrl));
      img.src = resolvedUrl;
    });
    _imageCache.set(resolvedUrl, p);
    return p;
  }

  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }
  function recolorPixels(px, targetRgb, predicate, sourceReferenceHex = null, debugLabel = null) {
    const shared = window.ColorFill?.shadeFillPixels;
    if (typeof shared !== 'function') throw new Error('ColorFill unavailable during creature recolor');
    let shadeReference = null; // Base coats may supply an exact authored source color instead of inferring a peak from unrelated sprite details.
    if (sourceReferenceHex) {
      const sourceRgb = hexToRgb(sourceReferenceHex);
      const luminanceOf = typeof shared.relativeLuminance === 'function'
        ? shared.relativeLuminance
        : ((r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
      const referenceValue = Math.max(1 / 255, luminanceOf(...sourceRgb));
      shadeReference = {
        baseValue: referenceValue,
        peakLuminance: referenceValue,
        count: 0,
        referenceHex: sourceReferenceHex.toUpperCase(),
      };
      if (typeof shared.shadeFillConfig === 'function') shadeReference.config = shared.shadeFillConfig();
    }
    shared(px, targetRgb, {
      applyPredicate: predicate || null,
      samplePredicate: predicate || null,
      shadeReference,
      debugLabel,
    });
  }

  const _recolorCache = new Map(); // key -> Promise<canvas>
  const RECOLOR_CACHE_LIMIT = 96; // Also bounds tiny images/keys and unresolved recolor promises.
  const RECOLOR_CACHE_BYTES = 24 * 1024 * 1024; // Resolved canvas estimates are byte-bounded, not only entry-count bounded.
  const recolorBytesByKey = new Map(); // Accounts only images still retained by the authoritative recolor cache.
  let recolorBytes = 0; // Updated on resolution/eviction, never by per-frame scene scans.
  function forgetRecolor(key) {
    _recolorCache.delete(key);
    recolorBytes -= recolorBytesByKey.get(key) || 0;
    recolorBytesByKey.delete(key);
  }
  function trimRecolors() {
    while (_recolorCache.size > RECOLOR_CACHE_LIMIT || recolorBytes > RECOLOR_CACHE_BYTES) forgetRecolor(_recolorCache.keys().next().value);
  }
  function cachedRecolor(key) {
    const cached = _recolorCache.get(key); // Refreshes LRU order for frequently reused colors.
    if (cached) { _recolorCache.delete(key); _recolorCache.set(key, cached); }
    return cached;
  }
  function rememberRecolor(key, promise) {
    if (_recolorCache.has(key)) forgetRecolor(key);
    _recolorCache.set(key, promise);
    trimRecolors();
    Promise.resolve(promise).then(image => {
      if (_recolorCache.get(key) !== promise) return; // Evicted pending work must not resurrect its cache entry on completion.
      const bytes = Math.max(0, Number(image?.width || image?.naturalWidth) || 0) * Math.max(0, Number(image?.height || image?.naturalHeight) || 0) * 4; // RGBA surface estimate; live callers can retain evicted canvases safely.
      recolorBytesByKey.set(key, bytes);
      recolorBytes += bytes;
      trimRecolors();
    }, () => { if (_recolorCache.get(key) === promise) forgetRecolor(key); });
  }
  // Species without a region mask can name the authored coat color instead
  // (SPECIES[kind].baseRecolorKeyHex): only source pixels in that hue family,
  // with enough saturation to not be outline/highlight detail, are recolored.
  // Classified once from the untouched base sprite, before belly/eye layers.
  function sourceKeyPredicate(px, sourceKey) {
    const keyRgb = hexToRgb(sourceKey.hex);
    const colorFill = window.ColorFill; // Same HSV conventions as the shared shade-fill.
    const matches = new Uint8Array(px.length >> 2); // One flag per pixel; shade sampling and application both read it.
    if (typeof colorFill?.rgbToHsv !== 'function' || typeof colorFill?.hueDistance !== 'function') {
      for (let i = 0; i < px.length; i += 4) matches[i >> 2] = px[i + 3] > 0 && px[i] === keyRgb[0] && px[i + 1] === keyRgb[1] && px[i + 2] === keyRgb[2] ? 1 : 0;
    } else {
      const keyHsv = colorFill.rgbToHsv(...keyRgb);
      const tolerance = Number.isFinite(sourceKey.hueTolerance) ? sourceKey.hueTolerance : 20;
      const minSaturation = Math.max(0.04, keyHsv.s * (Number.isFinite(sourceKey.minSaturationRatio) ? sourceKey.minSaturationRatio : 0.45));
      const minValue = Number.isFinite(sourceKey.minValue) ? Math.max(0, Math.min(1, sourceKey.minValue)) : 0; // Species-specific outline protection for dark pixels whose noisy hue resembles the coat.
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const hsv = colorFill.rgbToHsv(px[i], px[i + 1], px[i + 2]);
        matches[i >> 2] = hsv.v >= minValue && hsv.s >= minSaturation && colorFill.hueDistance(hsv.h, keyHsv.h) <= tolerance ? 1 : 0;
      }
    }
    return i => matches[i >> 2] === 1;
  }

  // Shared keyed shade-fill for animal coats and matching attached PNG surfaces.
  function recolorKeyedPixels(px, targetRgb, sourceKey, sourceReferenceHex = null, debugLabel = null) {
    recolorPixels(px, targetRgb, sourceKeyPredicate(px, sourceKey), sourceReferenceHex, debugLabel);
  }

  async function recoloredBase(url, color, mask, allowUnmasked = false, sourceReferenceHex = null, kind = '', sourceKey = null) {
    const key = `base|${url}|${color}|ref:${sourceReferenceHex || 'auto'}|full:${allowUnmasked}|key:${sourceKey?.hex || ''}`;
    if (_recolorCache.has(key)) return cachedRecolor(key);
    const promise = (async () => {
      const img = await loadImage(url);
      await window.PixelWorkYield?.maybeYield(); // Lets a frame present between queued recolor passes (see pixel-work-yield.js).
      const maskMatches = !!mask && mask.width === img.naturalWidth && mask.height === img.naturalHeight; // Used to choose authored-region recolor versus an explicitly allowed full-sprite recolor.
      if (!maskMatches && !allowUnmasked && !sourceKey) return img;
      const c = makeCanvas(img.naturalWidth, img.naturalHeight), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
      const debugLabel = kind ? `animal-base:${kind}${!maskMatches && sourceKey ? ':hex-target' : ''}` : 'animal-base'; // Shared diagnostics identify both keyed and masked fills.
      if (!maskMatches && sourceKey) recolorKeyedPixels(px, hexToRgb(color), sourceKey, sourceReferenceHex, debugLabel);
      else recolorPixels(
        px,
        hexToRgb(color),
        maskMatches ? (i) => mask.data[i / 4] : null,
        sourceReferenceHex,
        debugLabel,
      );
      ctx.putImageData(data, 0, 0);
      return c;
    })().catch(err => { if (_recolorCache.get(key) === promise) forgetRecolor(key); throw err; });
    rememberRecolor(key, promise);
    return promise;
  }
  async function recoloredPattern(url, color) {
    const key = `pattern|${url}|${color}`;
    if (_recolorCache.has(key)) return cachedRecolor(key);
    const promise = (async () => {
      const img = await loadImage(url);
      await window.PixelWorkYield?.maybeYield();
      const c = makeCanvas(img.naturalWidth, img.naturalHeight), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
      recolorPixels(px, hexToRgb(color), null);
      ctx.putImageData(data, 0, 0);
      return c;
    })().catch(err => { if (_recolorCache.get(key) === promise) forgetRecolor(key); throw err; });
    rememberRecolor(key, promise);
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
    _maskPromise = fetch(docsUrl('config/creature-base-masks.json')).then(r => r.json()).then(raw => {
      const out = {};
      for (const [kind, frames] of Object.entries(raw || {})) {
        out[kind] = {};
        for (const [frame, encoded] of Object.entries(frames)) out[kind][frame] = decodeMaskRle(encoded);
      }
      return out;
    }).catch(() => ({}));
    return _maskPromise;
  }

  function usesDrenkirraBodyStripesColorSwap(kind, genotype) {
    const stripes = genotype?.bodystripes; // Supplies the inverted base/stripe colors for this one Drenkirra pattern.
    return kind === 'drenkirra'
      && !!genotype?.base?.color
      && stripes?.enabled !== false
      && stripes?.copies > 0
      && !!stripes?.color;
  }

  function compactHashText(value) {
    const text = String(value || ''); // Compact deterministic cache/signature token without leaking large embedded motif data into keys.
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function colorPoolPaintSignature(genotype) {
    const layers = genotype?.colorPoolPaint?.layers;
    if (!layers || typeof layers !== 'object') return '';
    const compact = Object.keys(layers).sort().map(regionId => {
      const paint = layers[regionId] || {};
      return [
        regionId,
        paint.dyeId || '',
        paint.dyeHex || '',
        paint.overpassDyeId || '',
        paint.overpassDyeHex || '',
        paint.patternLibraryId || '',
        paint.repoPatternId || paint.pattern?.repoPatternId || '',
        Math.max(7, Math.min(14, Number(paint.patternScale) || 7)).toFixed(3),
        compactHashText(JSON.stringify(Array.isArray(paint.patterns) ? paint.patterns.slice(0, 2) : (paint.pattern || null))), // Includes future second-slot paint data in the creature-frame cache key.
      ].join(':');
    }).join('|');
    return compactHashText(compact);
  }

  function maskedRegionCanvas(imageOrCanvas, mask) {
    if (!imageOrCanvas || !mask) return imageOrCanvas;
    const width = imageOrCanvas.naturalWidth || imageOrCanvas.width || 0;
    const height = imageOrCanvas.naturalHeight || imageOrCanvas.height || 0;
    if (!width || !height || mask.width !== width || mask.height !== height) return imageOrCanvas;
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imageOrCanvas, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    for (let p = 0, i = 0; p < mask.data.length; p++, i += 4) {
      if (!mask.data[p]) image.data[i + 3] = 0;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  function colorPoolPaintFor(genotype, regionId) {
    return genotype?.colorPoolPaint?.layers?.[regionId] || null;
  }

  let lastPatternPaintDebug = { kind: null, frame: null, layers: {} }; // Latest composeFrame surface-paint resolution; Character Studio exposes this so missing motifs are visible instead of silently looking plain.
  function setPatternPaintDebug(regionId, detail) {
    lastPatternPaintDebug.layers[regionId] = { regionId, ...detail };
  }
  function getLastPatternPaintDebug() {
    return JSON.parse(JSON.stringify(lastPatternPaintDebug));
  }

  async function applyColorPoolPaint(imageOrCanvas, genotype, regionId, regionMask, cachePrefix) {
    const paint = colorPoolPaintFor(genotype, regionId);
    if (!paint) return null;
    const dyeHex = paint.dyeHex || window.DyeSystem?.getById?.(paint.dyeId)?.hex || null;
    const rawPatterns = Array.isArray(paint.patterns) ? paint.patterns.slice(0, 2) : [
      paint.pattern || (paint.patternLibraryId ? window.PatternLibrary?.getById?.(paint.patternLibraryId) : null),
    ]; // Current Color Pools UI writes only the legacy primary slot; a future unlock can populate patterns[1] without changing rendering.
    const animalPatternScale = Math.max(7, Math.min(14, Number(paint.patternScale) || 7)); // Both slots share a usage scale but may have separate ink dyes.
    const debugBase = { patternCount: rawPatterns.filter(Boolean).length, patternScale: animalPatternScale, dyeHex, status: 'pending' };
    try {
      const patterns = [];
      for (const raw of rawPatterns) {
        if (!raw) continue;
        let pattern = { ...raw };
        const repoPatternId = pattern.repoPatternId || (patterns.length === 0 ? paint.repoPatternId : null) || null;
        if (repoPatternId && !(pattern.motifDataUrl || pattern.motifUrl || pattern.customMotifId)) {
          pattern = await window.RepoPatternLibrary?.getById?.(repoPatternId) || pattern;
        }
        if (pattern) {
          const secondaryInk = paint.overpassDyeHex || window.DyeSystem?.getById?.(paint.overpassDyeId)?.hex;
          patterns.push({ ...pattern, usageScaleMultiplier: animalPatternScale,
            ...(patterns.length === 1 && /^#[0-9a-f]{6}$/i.test(secondaryInk || '') ? { inkColorHex: secondaryInk } : {}) }); // Only slot 2 receives the independent dye.
        }
        if (patterns.length >= 2) break;
      }
      const compositor = window.ClothingWeavingSystem?.applyPatternStackToTintedImage
        || window.ClothingWeavingSystem?.__test?.applyPatternStackToTintedImage;
      const motifRefs = patterns.map(pattern => pattern?.motifDataUrl || pattern?.motifUrl || pattern?.customMotifId || null).filter(Boolean);
      if (!dyeHex) {
        setPatternPaintDebug(regionId, { ...debugBase, status: 'failed', reason: 'missing pattern ink color' });
        return null;
      }
      if (!motifRefs.length) {
        setPatternPaintDebug(regionId, { ...debugBase, status: 'failed', reason: 'surface paint has no resolvable motif image' });
        return null;
      }
      if (!compositor) {
        setPatternPaintDebug(regionId, { ...debugBase, status: 'failed', reason: 'weaving stack compositor unavailable', motifRefs });
        return null;
      }
      if (regionMask) await window.PixelWorkYield?.maybeYield();
      const clippedSource = regionMask ? maskedRegionCanvas(imageOrCanvas, regionMask) : imageOrCanvas;
      const rendered = await compositor(clippedSource, patterns, dyeHex, cachePrefix, null, 'animal-surface-pattern');
      const applied = !!rendered && rendered !== clippedSource;
      setPatternPaintDebug(regionId, {
        ...debugBase,
        patternCount: patterns.length,
        status: applied ? 'applied' : 'failed',
        reason: applied ? null : 'compositor returned the unpatterned source',
        motifRefs,
        overpass: patterns.length > 1 ? { clearanceMultiplier: Math.max(3, Math.min(12, Number(patterns[1]?.overpassClearanceMultiplier) || 3)) } : null, // Mirrors the shared compositor's player/dev-authored slot-2 clamp for mobile diagnostics.
      });
      return applied ? rendered : null;
    } catch (error) {
      setPatternPaintDebug(regionId, { ...debugBase, status: 'failed', reason: String(error?.message || error) });
      throw error;
    }
  }

  // Draw order matches SPECIES[kind].patterns — the same fixed layer order
  // the HTML lab uses (each species' patterns object insertion order).
  // blinkShut swaps in the species' eye-shut art for one frame's compose;
  // it's drawn unconditionally AFTER every pattern layer (regardless of
  // where in spec.patterns a given species happens to draw "spectacles" —
  // dabinggi-hound's stripes layer draws after its own spectacles, for
  // instance) so the eyes always render above any spectacles pattern,
  // never the other way around. Eyes are normally untinted like NPC
  // untinted_regions; Nelk's eye sprite has mint skin and therefore opts
  // into keyed skin-only recoloring while retaining its painted iris.
  let composeTail = Promise.resolve(); // One native-resolution compositor at a time bounds overlapping pixel arrays and temporary canvases.
  let composePending = 0, composeActive = 0; // Mobile checkpoint diagnostics distinguish queued requests from actual allocation work.
  async function composeFrame(kind, frame, genotype, blinkShut = false) {
    const previous = composeTail; // Serial shared farm/wild/companion composition, without changing any frame's pixels.
    let unlock; // Always releases the queue after errors as well as successful renders.
    composeTail = new Promise(resolve => { unlock = resolve; });
    composePending++;
    try {
      await previous;
      if (composePending > 1 && typeof setTimeout === 'function') await new Promise(resolve => setTimeout(resolve, 0)); // Yield between queued native pixel jobs so gameplay can present a frame.
      composeActive++;
      try { return await composeFrameNow(kind, frame, genotype, blinkShut); }
      finally { composeActive--; }
    } finally { composePending--; unlock(); }
  }

  async function composeFrameNow(kind, frame, genotype, blinkShut = false) {
    const t0 = performance.now();
    lastPatternPaintDebug = { kind, frame, layers: {} }; // Reset per composite so Character Studio status reflects this exact preview frame.
    const spec = SPECIES[kind];
    genotype = effectiveGenotype(kind, genotype); // Supports permanent-shell rendering on old saves.
    if (!spec) {
      window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): no SPECIES config for "${kind}" — returning null (creature falls back to its plain sprite)`, 'wildlife');
      return null;
    }
    const baseUrl = spec.base[frame] || spec.base.idle;
    const masks = await loadBaseMasks();
    const tMasks = performance.now();
    const mask = masks?.[kind]?.[frame];
    const storedBaseColor = genotype?.base?.color; // Retained for the bodystripes overlay when its Drenkirra color roles swap.
    const bodyStripesColorSwap = usesDrenkirraBodyStripesColorSwap(kind, genotype); // Changes rendering only; the inherited genotype stays untouched.
    const baseColor = bodyStripesColorSwap ? genotype.bodystripes.color : storedBaseColor; // Effective body fill color for this frame.
    const fullBaseRecolor = spec.fullBaseRecolor === true; // Used by species whose base sprite itself is the recolorable coat instead of requiring a separate region mask.
    const sourceKey = !mask && !fullBaseRecolor && spec.baseRecolorKeyHex // Mask-less species whose coat is identified by its authored source color.
      ? { hex: spec.baseRecolorKeyHex, hueTolerance: spec.baseRecolorHueTolerance, minSaturationRatio: spec.baseRecolorMinSaturationRatio }
      : null;
    // Only worth a warning if there was actually a base color to apply —
    // uumkaoii's genotype has no `base` layer at all (its two regions are
    // the fur/plates overlays below, not a recolored base), so baseColor is
    // always undefined for it and this would otherwise fire every call for
    // no reason.
    if (baseColor && !mask && !fullBaseRecolor && !sourceKey) window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): no base mask found — base fur will render unrecolored`, 'wildlife');
    const baseSource = (baseColor && (mask || fullBaseRecolor || sourceKey))
      ? await recoloredBase(baseUrl, baseColor, mask, fullBaseRecolor, spec.baseShadeReferenceHex || null, kind, sourceKey)
      : await loadImage(baseUrl);
    const tBase = performance.now();
    const bw = baseSource.naturalWidth || baseSource.width, bh = baseSource.naturalHeight || baseSource.height;
    const c = makeCanvas(bw, bh), ctx = c.getContext('2d');
    const drawnPatterns = []; // Shared diagnostics include anatomical underlays as well as ordinary optional overlays.
    for (const patternId of spec.underlayPatterns || []) {
      const layer = genotype?.[patternId]; // Expressed tail genes use their second tint; otherwise this permanent anatomical region uses the primary coat.
      const expressed = layer?.enabled !== false && Number(layer?.copies) > 0 && !!layer?.color;
      const underlayColor = expressed ? layer.color : (baseColor || spec.baseShadeReferenceHex || null);
      const url = patternUrl(kind, patternId, frame, genotype);
      try {
        const underlay = underlayColor ? await recoloredPattern(url, underlayColor) : await loadImage(url);
        const painted = await applyColorPoolPaint(underlay, genotype, patternId, null,
          `animal:${kind}:${frame}:${patternId}:${underlayColor || 'native'}`).catch(error => {
          window.__farmLog?.(`[genotype-render] underlay paint for "${patternId}" failed: ${error.message}`, 'warn');
          return null;
        });
        ctx.drawImage(painted || underlay, 0, 0, c.width, c.height);
        drawnPatterns.push(patternId + (expressed ? '' : '(default)'));
      } catch (error) {
        window.__farmLog?.(`[genotype-render] underlay "${patternId}" failed to load (${url}): ${error.message}`, 'warn');
      }
    }
    ctx.drawImage(baseSource, 0, 0);
    try {
      const paintedBase = await applyColorPoolPaint(baseSource, genotype, 'base', fullBaseRecolor ? null : mask, `animal:${kind}:${frame}:base:${baseColor || 'native'}`);
      if (paintedBase) ctx.drawImage(paintedBase, 0, 0, c.width, c.height);
    } catch (error) {
      window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): Color Pools base paint failed — skipped: ${error.message}`, 'warn');
    }
    for (const patternId of spec.patterns) {
      if (spec.underlayPatterns?.includes(patternId)) continue; // The always-visible tail is already beneath the base, never drawn twice.
      const layer = genotype?.[patternId];
      // A layer with no `enabled` field at all (uumkaoii's permanent
      // fur/plates regions — see makeDefaultGenotype) is always on; only an
      // EXPLICIT `enabled: false` (gar-wolf/dabinggi-hound's optional
      // pattern roll) turns a layer off.
      if (layer?.enabled === false || !(layer?.copies > 0) || !layer?.color) continue;
      const url = patternUrl(kind, patternId, frame, genotype);
      try {
        // Drenkirra bodystripes invert only their own two color roles: the
        // body uses their pattern color above and these stripes use the
        // stored base color. Any other simultaneous pattern keeps its own
        // ordinary layer.color.
        const renderColor = bodyStripesColorSwap && patternId === 'bodystripes' ? storedBaseColor : layer.color; // Effective color for this overlay only.
        const recolored = await recoloredPattern(url, renderColor);
        let renderedLayer = recolored;
        try {
          renderedLayer = await applyColorPoolPaint(recolored, genotype, patternId, null, `animal:${kind}:${frame}:${patternId}:${renderColor || 'native'}`) || recolored;
        } catch (paintError) {
          window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): Color Pools paint for "${patternId}" failed — genetic layer kept: ${paintError.message}`, 'warn');
        }
        ctx.drawImage(renderedLayer, 0, 0, c.width, c.height);
        drawnPatterns.push(patternId);
      } catch (e) {
        window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): pattern "${patternId}" failed to load/recolor (${url}) — skipped: ${e.message}`, 'warn');
      }
    }
    for (const defaultPattern of visibleDefaultCoatPatterns(spec, genotype)) {
      const url = patternUrl(kind, defaultPattern.id, frame, genotype); // Uses the already-uploaded idle/run1/run2 beard sprites.
      try {
        const coatColor = baseColor || spec.baseShadeReferenceHex || '#99BF99'; // Reuses the base-coat allele; never invents a secondary beard color.
        const recolored = await recoloredPattern(url, coatColor);
        ctx.drawImage(recolored, 0, 0, c.width, c.height);
        drawnPatterns.push(defaultPattern.id + '(default)'); // Debug only; it is not added to genotype traits or breeding.
      } catch (error) {
        window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): default coat pattern "${defaultPattern.id}" missing (${url}): ${error.message}`, 'warn');
      }
    }
    const eyeSkinColor = eyeSkinTintColor(kind, genotype, baseColor); // Nelk spectacles color overrides its base coat only when the pattern is expressed.
    if (spec.eyes) {
      const eyeUrl = spec.eyes.mode === 'cycle'
        ? spec.eyes.variants[Math.max(0, Math.min(3, 'ABCD'.indexOf(typeof blinkShut === 'string' ? blinkShut : 'A')))]
        : (blinkShut ? spec.eyes.blink : spec.eyes.open); // Shared boolean blinks and four-way chameleon eyes use one compositing pipeline.
      try {
        const eyeSkinKey = spec.eyes.skinRecolorKey; // Recolors only mint skin pixels, not iris or black linework.
        const eyeImg = eyeSkinKey && eyeSkinColor
          ? await recoloredBase(eyeUrl, eyeSkinColor, null, false, null, `${kind}-eye`, eyeSkinKey)
          : await loadImage(eyeUrl);
        ctx.drawImage(eyeImg, 0, 0, c.width, c.height);
      } catch (e) {
        window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): eye overlay failed to load (${eyeUrl}) — skipped: ${e.message}`, 'warn');
      }
    }
    const tEnd = performance.now();
    // Broken down so a slow compose (the "ran around plain for ages" symptom)
    // shows WHERE the time went — masksMs covers the one-time mask JSON
    // fetch+decode (only nonzero the very first call all session), baseMs
    // covers the base sprite's network load + recolor pixel pass, patternMs
    // covers every enabled pattern layer's load+recolor combined.
    const baseFillMode = !baseColor ? 'none' : fullBaseRecolor ? 'full-sprite' : mask ? 'mask' : sourceKey ? 'source-key' : 'missing-mask'; // Included in the in-game farm log so mobile builds can verify which recolor path actually ran.
    window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): base=${baseColor || '(none)'} baseFill=${baseFillMode} sourceRef=${spec.baseShadeReferenceHex || 'auto'} patterns=[${drawnPatterns.join(',') || 'none'}] bodystripesSwap=${bodyStripesColorSwap} eyeSkinTint=${!!(spec.eyes?.skinRecolorKey && eyeSkinColor)} eyeSkinColor=${eyeSkinColor || '(none)'} timing: masksMs=${(tMasks - t0).toFixed(0)} baseMs=${(tBase - tMasks).toFixed(0)} patternMs=${(tEnd - tBase).toFixed(0)} totalMs=${(tEnd - t0).toFixed(0)}`, 'wildlife');
    return c;
  }

  // Pays the network-fetch cost for a species' base/pattern sprites and the
  // shared mask JSON ahead of time (loadImage/loadBaseMasks both cache by
  // URL), so the FIRST real composeFrame call for that species — typically
  // triggered the instant a creature is visibly on screen — only has to pay
  // for the per-pixel recolor pass, not a cold network round-trip on top of
  // it. Call this as soon as the player enters a context that's about to
  // spawn genotype creatures (see teleportToDevArena), not lazily on first
  // spawn, which is exactly the "ran around plain for ages" cost this exists
  // to hide.
  async function prewarm(kinds) {
    const t0 = performance.now();
    const targets = kinds && kinds.length ? kinds : Object.keys(SPECIES);
    await loadBaseMasks();
    const urls = [];
    for (const kind of targets) {
      const spec = SPECIES[kind];
      if (!spec) continue;
      urls.push(spec.base.idle, spec.base.run1, spec.base.run2);
      const prewarmIds = [...spec.patterns, ...(spec.defaultCoatPatterns || []).map(p => p.id)]; // The default beard is prefetched for all three frames without becoming genetic.
      for (const patternId of prewarmIds) {
        urls.push(patternUrl(kind, patternId, 'idle'), patternUrl(kind, patternId, 'run1'), patternUrl(kind, patternId, 'run2'));
        if (spec.comboPatterns?.[patternId]) for (const frame of ['idle', 'run1', 'run2']) {
          urls.push(`${spec.patternAssetRoot || 'assets/creaturesprites/patterns'}/${spec.prefix}_${spec.comboPatterns[patternId].sprite}_${frame}.png`);
        }
      }
      if (spec.eyes) urls.push(...(spec.eyes.variants || [spec.eyes.open, spec.eyes.blink]));
    }
    await Promise.all(urls.filter(Boolean).map(u => loadImage(u).catch(() => null)));
    window.__farmLog?.(`[genotype-render] prewarm(${targets.join(',')}): masks + ${urls.length} sprite URLs cached in ${(performance.now() - t0).toFixed(0)}ms`, 'wildlife');
  }

  function genotypeSignature(kind, genotype) {
    genotype = effectiveGenotype(kind, genotype); // Legacy Uumkao'ii genes still get a correct stable cache signature.
    const spec = SPECIES[kind];
    if (!spec) return 'none';
    const parts = [genotype?.base?.color || ''];
    for (const id of spec.patterns) {
      const l = genotype?.[id];
      parts.push((l?.enabled !== false && l?.copies > 0 && l?.color) ? `${id}:${l.color}` : '');
    }
    const paintSig = colorPoolPaintSignature(genotype);
    if (paintSig) parts.push(`paint:${paintSig}`);
    return parts.join('|');
  }

  window.CreatureGeneticsRender = { composeFrame, genotypeSignature, colorPoolPaintSignature, getLastPatternPaintDebug, prewarm, patternUrl, eyeStateKey, eyeStatesForKind, eyeSkinTintColor, SPECIES, recolorPixels, recolorKeyedPixels, hexToRgb, memorySnapshot: () => ({ recolorEntries: _recolorCache.size, recolorEstimatedBytes: recolorBytes, recolorBudgetBytes: RECOLOR_CACHE_BYTES, composePending, composeActive }) };

  window.HobunjiCacheAudit?.register('CreatureGeneticsRender.imageCache', () => _imageCache.size);
  window.HobunjiCacheAudit?.register('CreatureGeneticsRender.recolorCache', () => _recolorCache.size);
})();

// Species-authored animal head weights. The weight map lives in normalized UV
// space, so the same rig follows every genotype composite, every animation
// frame, and any size-only variant such as a Den-Mother without duplicating
// pattern/frame-specific weights.
(function installSpeciesAnimalHeadRigs() {
  'use strict';

  const STORAGE_KEY = window.AnimalHeadRigRuntime?.STORAGE_KEY || 'hobunji_animal_head_rigs_v1'; // Shared with the rig painter so a browser preview can override the committed species rig.
  const ANIMAL_HEAD_RIGS = Object.freeze({"dabinggi-hound":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.2578125,"y":0.4107142857142857},"weightMap":{"width":128,"height":56,"encoding":"rle-u9","unsetValue":256,"data":[665,256,3,255,10,256,1,0,108,256,11,255,5,256,7,0,102,256,15,255,3,256,9,0,99,256,18,255,1,256,11,0,97,256,19,255,1,256,11,0,96,256,20,255,12,0,94,256,22,255,12,0,93,256,23,255,12,0,91,256,25,255,12,0,90,256,26,255,12,0,90,256,26,255,12,0,89,256,28,255,12,0,88,256,28,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,14,0,84,256,29,255,15,0,84,256,29,255,16,0,83,256,26,255,1,256,18,0,83,256,25,255,20,0,82,256,25,255,21,0,82,256,24,255,22,0,82,256,23,255,23,0,82,256,22,255,23,0,83,256,22,255,22,0,84,256,21,255,22,0,85,256,21,255,21,0,86,256,21,255,21,0,86,256,20,255,22,0,86,256,18,255,2,256,21,0,88,256,16,255,3,256,21,0,89,256,7,255,2,256,4,255,5,256,21,0,107,256,21,0,107,256,21,0,107,256,21,0,107,256,21,0,108,256,20,0,108,256,21,0,107,256,21,0,107,256,21,0,108,256,20,0,108,256,20,0,108,256,21,0,107,256,21,0,108,256,19,0,109,256,19,0,110,256,18,0,84,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48},"gar-wolf":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.328125,"y":0.4375},"weightMap":{"width":128,"height":56,"encoding":"rle-u9","unsetValue":256,"data":[657,256,4,255,122,256,9,255,118,256,13,255,114,256,15,255,112,256,17,255,108,256,24,255,102,256,28,255,95,256,35,255,91,256,39,255,89,256,40,255,88,256,41,255,87,256,41,255,87,256,42,255,86,256,42,255,86,256,42,255,86,256,42,255,86,256,42,255,86,256,42,255,86,256,42,255,86,256,41,255,87,256,40,255,88,256,40,255,88,256,40,255,88,256,40,255,88,256,40,255,88,256,39,255,89,256,38,255,90,256,36,255,92,256,35,255,93,256,34,255,94,256,33,255,95,256,31,255,102,256,15,255,1,256,7,255,108,256,12,255,3,256,2,255,111,256,12,255,117,256,11,255,118,256,9,255,120,256,7,255,123,256,3,255,1648,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48},"drenkirra":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.4375,"y":0.5123456790123457},"weightMap":{"width":128,"height":81,"encoding":"rle-u9","unsetValue":256,"data":[2976,256,6,255,120,256,11,255,116,256,19,255,108,256,22,255,105,256,24,255,103,256,25,255,103,256,26,255,101,256,29,255,99,256,29,255,98,256,31,255,97,256,31,255,96,256,33,255,94,256,34,255,93,256,35,255,92,256,36,255,91,256,36,255,92,256,36,255,91,256,37,255,91,256,37,255,91,256,37,255,91,256,37,255,90,256,38,255,90,256,37,255,91,256,37,255,92,256,36,255,92,256,36,255,92,256,33,255,2,0,93,256,33,255,3,0,93,256,32,255,4,0,92,256,32,255,5,0,92,256,25,255,1,0,3,255,8,0,92,256,25,255,11,0,92,256,25,255,12,0,92,256,15,255,1,0,7,255,13,0,93,256,12,255,3,0,6,255,15,0,94,256,8,255,6,0,5,255,15,0,97,256,3,255,9,0,3,255,16,0,99,256,29,0,98,256,31,0,96,256,32,0,95,256,33,0,94,256,35,0,93,256,35,0,92,256,37,0,91,256,37,0,91,256,37,0,91,256,37,0,90,256,38,0,91,256,37,0,91,256,37,0,91,256,36,0,92,256,35,0,93,256,25,0,1,256,8,0,95,256,23,0,105,256,23,0,105,256,24,0,105,256,23,0,105,256,23,0,78,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48},"grehlr":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.421875,"y":0.6510416666666666},"weightMap":{"width":128,"height":96,"encoding":"rle-u9","unsetValue":256,"data":[21,256,107,0,20,256,108,0,18,256,110,0,17,256,111,0,16,256,112,0,15,256,113,0,15,256,113,0,14,256,114,0,13,256,115,0,12,256,116,0,11,256,117,0,10,256,118,0,9,256,119,0,8,256,120,0,7,256,121,0,6,256,122,0,6,256,122,0,5,256,123,0,4,256,124,0,4,256,124,0,3,256,125,0,2,256,126,0,1,256,283,0,20,64,106,0,3,64,18,128,8,64,98,0,2,64,3,128,16,191,8,128,3,64,95,0,2,64,2,128,3,191,14,128,8,191,3,128,2,64,93,0,2,64,2,128,2,191,3,128,12,191,8,128,3,191,2,128,2,64,91,0,2,64,2,128,2,191,2,128,3,191,10,255,8,191,3,128,2,191,2,128,1,64,91,0,1,64,2,128,2,191,2,128,2,191,19,255,3,191,2,128,2,191,1,128,1,64,88,0,4,64,1,128,2,191,2,128,2,191,22,255,2,191,2,128,1,191,1,128,1,64,86,0,3,64,4,128,1,191,2,128,2,191,24,255,2,191,1,128,1,191,1,128,1,64,85,0,2,64,3,128,4,191,1,128,2,191,26,255,1,191,1,128,1,191,1,128,1,64,84,0,2,64,2,128,3,191,4,128,1,191,27,255,1,191,1,128,1,191,1,128,1,64,84,0,1,64,2,128,2,191,3,128,4,191,27,255,1,191,1,128,1,191,1,128,1,64,83,0,2,64,1,128,2,191,2,128,3,191,30,255,1,191,1,128,1,191,1,128,1,64,83,0,1,64,2,128,1,191,2,128,2,191,32,255,1,191,1,128,1,191,1,128,1,64,83,0,1,64,1,128,2,191,1,128,2,191,33,255,1,191,1,128,1,191,1,128,1,64,83,0,1,64,1,128,1,191,2,128,1,191,34,255,1,191,1,128,1,191,1,128,1,64,82,0,2,64,1,128,1,191,1,128,2,191,34,255,1,191,1,128,1,191,1,128,1,64,82,0,1,64,2,128,1,191,1,128,1,191,34,255,2,191,1,128,1,191,1,128,1,64,82,0,1,64,1,128,2,191,1,128,1,191,34,255,1,191,2,128,1,191,1,128,1,64,81,0,2,64,1,128,1,191,2,128,1,191,34,255,1,191,1,128,2,191,1,128,1,64,78,0,4,64,2,128,1,191,1,128,2,191,34,255,1,191,1,128,1,191,2,128,1,64,75,0,4,64,4,128,2,191,1,128,1,191,35,255,1,191,1,128,1,191,1,128,2,64,74,0,2,64,4,128,4,191,2,128,1,191,35,255,1,191,1,128,1,191,1,128,1,64,74,0,2,64,2,128,4,191,4,128,2,191,34,255,2,191,1,128,1,191,1,128,1,64,73,0,2,64,2,128,2,191,4,128,4,191,35,255,1,191,2,128,1,191,1,128,1,64,72,0,2,64,2,128,2,191,2,128,4,191,37,255,2,191,1,128,2,191,1,128,1,64,72,0,1,64,2,128,2,191,2,128,2,191,39,255,2,191,2,128,1,191,2,128,1,64,71,0,2,64,1,128,2,191,2,128,2,191,39,255,2,191,2,128,2,191,1,128,2,64,70,0,2,64,2,128,1,191,2,128,2,191,40,255,1,191,2,128,2,191,2,128,1,64,71,0,1,64,2,128,2,191,1,128,2,191,41,255,1,191,1,128,2,191,2,128,2,64,71,0,1,64,1,128,2,191,2,128,1,191,41,255,2,191,1,128,1,191,2,128,2,64,72,0,2,128,1,191,2,128,2,191,41,255,1,191,2,128,1,191,1,128,2,64,73,0,1,128,2,191,1,128,2,191,41,255,2,191,1,128,2,191,1,128,1,64,74,0,1,128,1,191,2,128,1,191,41,255,2,191,2,128,1,191,2,128,1,64,74,0,2,191,1,128,2,191,38,255,4,191,2,128,2,191,1,128,2,64,74,0,1,191,2,128,1,191,38,255,2,191,4,128,2,191,2,128,1,64,75,0,1,191,1,128,2,191,39,255,1,191,1,128,4,191,2,128,2,64,75,0,2,128,1,191,40,255,1,191,1,128,1,191,4,128,2,64,76,0,1,128,2,191,40,255,1,191,1,128,3,191,3,128,4,64,73,0,1,128,1,191,45,255,3,191,4,128,2,64,72,0,1,128,1,191,47,255,4,191,2,128,4,64,69,0,1,128,1,191,50,255,2,191,4,128,3,64,67,0,2,191,51,255,4,191,3,128,3,64,65,0,1,191,55,255,3,191,3,128,2,64,64,0,1,191,57,255,3,191,2,128,2,64,63,0,1,191,59,255,2,191,3,128,63,0,1,191,60,255,3,191,64,0,1,191,62,255,1,191,64,0,1,191,62,255,2,191,63,0,1,191,63,255,2,191,62,0,1,191,64,255,2,191,61,0,1,191,65,255,1,191,61,0,1,191,65,255,2,191,60,0,1,191,66,255,1,191,2,128,58,0,1,191,66,255,2,191,59,0,1,191,67,255,1,191,1,128,58,0,2,191,66,255,1,191,2,128,57,0,1,128,1,191,66,255,2,191,1,128,1,64,56,0,1,128,1,191,67,255,1,191,1,128,1,64,56,0,1,128,2,191,66,255,1,191,1,128,1,64,56,0,2,128,1,191,66,255,1,191,1,128,1,64,56,0,1,191,1,128,1,191,29,255,1,191,36,255,1,191,1,128,1,64,56,0,1,191,1,128,2,191,27,255,2,191,1,128,35,255,1,191,1,128,1,64,56,0,1,191,2,128,1,191,27,255,1,191,2,128,1,191,34,255,1,191,1,128,1,64,56,0,2,191,1,128,2,191,26,255,1,191,1,128,3,191,32,255,2,191,1,128,1,64,56,0,1,128,1,191,2,128,2,191,25,255,1,191,1,128,1,191,1,128,3,191,30,255,1,191,2,128,1,64,56,0,1,128,2,191,2,128,2,191,24,255,1,191,1,128,1,191,3,128,5,191,26,255,1,191,1,128,2,64,56,0,2,128,2,191,2,128,2,191,23,255,1,191,1,128,1,191,1,128,1,64,5,128,2,191,24,255,2,191,1,128,1,64,57,0,1,64,2,128,2,191,2,128,5,191,1,255,1,191,17,255,1,191,1,128,1,191,1,128,5,64,2,128,2,191,22,255,2,191,2,128,1,64,57,0,2,64,2,128,2,191,5,128,3,191,16,255,2,191,1,128,1,191,1,128,1,64,3,0,2,64,2,128,2,191,20,255,2,191,2,128,2,64,58,0,2,64,2,128,5,191,3,128,2,191,15,255,1,191,2,128,1,191,1,128,1,64,4,0,2,64,2,128,2,191,17,255,3,191,2,128,2,64,60,0,2,64,5,128,3,191,2,128,2,191,13,255,2,191,1,128,2,191,1,128,1,64,5,0,2,64,2,128,2,191,15,255,2,191,3,128,2,64,59,0]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48},"nazgraku":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.421875,"y":0.42592592592592593},"weightMap":{"width":128,"height":54,"encoding":"rle-u9","unsetValue":256,"data":[34,256,33,255,94,256,35,255,92,256,36,255,91,256,37,255,90,256,39,255,88,256,40,255,87,256,41,255,87,256,41,255,86,256,42,255,86,256,42,255,85,256,43,255,85,256,42,255,86,256,42,255,86,256,42,255,86,256,41,255,86,256,42,255,86,256,41,255,87,256,40,255,88,256,39,255,88,256,39,255,89,256,39,255,89,256,38,255,90,256,36,255,92,256,35,255,93,256,34,255,94,256,33,255,95,256,32,255,97,256,30,255,98,256,30,255,98,256,29,255,100,256,27,255,102,256,25,255,103,256,24,255,105,256,22,255,107,256,20,255,110,256,17,255,113,256,13,255,117,256,8,255,2133,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48,"compressibilityMap":{"width":128,"height":54,"encoding":"rle-u9","unsetValue":256,"data":[1476,256,10,0,109,256,22,0,103,256,27,0,100,256,30,0,96,256,33,0,94,256,35,0,92,256,3,0,4,256,30,0,90,256,2,0,5,256,32,0,89,256,1,0,5,256,34,0,93,256,35,0,93,256,36,0,91,256,37,0,91,256,38,0,89,256,39,0,89,256,40,0,88,256,40,0,88,256,40,0,87,256,41,0,87,256,41,0,87,256,42,0,78,256,1,0,7,256,42,0,86,256,42,0,86,256,42,0,86,256,41,0,66,256,3,0,18,256,41,0,65,256,8,0,15,256,40,0,63,256,12,0,13,256,40,0,62,256,13,0,13,256,39,0,62,256,15,0,13,256,38,0,61,256,16,0,13,256,38,0,61,256,16,0,14,256,36,0,61,256,17,0,14,256,36,0,61,256,17,0,14,256,35,0,61,256,19,0,11,256,36,0,62,256,20,0,7,256,38,0,63,256,64,0,64,256,63,0,65,256,62,0,66,256,61,0,67,256,59,0,69,256,56,0,72,256,31,0,3,256,9,0,5,256,4,0,76,256,31,0,74,256]},"stretchabilityMap":{"width":128,"height":54,"encoding":"rle-u9","unsetValue":256,"data":[4002,256,2,0,123,256,5,0,122,256,7,0,120,256,9,0,118,256,12,0,115,256,14,0,113,256,17,0,110,256,21,0,107,256,21,0,107,256,22,0,105,256,24,0,104,256,24,0,104,256,25,0,103,256,26,0,102,256,27,0,101,256,29,0,99,256,30,0,98,256,31,0,97,256,31,0,97,256,30,0,99,256,29,0,99,256,28,0,101,256,27,0,75,256]}}}); // Exact painter exports supplied for the four authored species.
  const HEAD_RIG_VARIANT_ALIASES = Object.freeze({
    'gar-wolf-alpha': 'gar-wolf',
    'gar-wolf-den-mother': 'gar-wolf',
    'grehlr-den-mother': 'grehlr',
    'drenkirra-den-mother': 'drenkirra',
    'dabinggi-hound-den-mother': 'dabinggi-hound',
  }); // Scaled/art-identical variants deliberately share their base species' normalized UV weights.

  // Extend the existing genotype alias table with the future-safe Dabinggi
  // Den-Mother mapping; the other current Den-Mother/alpha aliases already
  // live there and are intentionally repeated above so head-rig resolution
  // stays correct even if genetics has not initialized for a standalone tool.
  if (window.CreatureGenetics?.SPECIES_ALIAS) Object.assign(window.CreatureGenetics.SPECIES_ALIAS, HEAD_RIG_VARIANT_ALIASES);

  function normalizeKind(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-'); // Converts farm names like gar_wolf_12_3 to the same key space as CREATURE_DB.
  }

  function knownHeadRigKeys() {
    const geneticsAliases = window.CreatureGenetics?.SPECIES_ALIAS || {};
    return [...new Set([
      ...Object.keys(ANIMAL_HEAD_RIGS),
      ...Object.keys(HEAD_RIG_VARIANT_ALIASES),
      ...Object.keys(geneticsAliases),
      ...Object.values(geneticsAliases),
    ])].sort((a, b) => b.length - a.length); // Longest-first prevents gar-wolf from stealing gar-wolf-den-mother names.
  }

  function creatureKindFromOptions(options) {
    const explicit = normalizeKind(options?.creatureId || options?.animalId); // Preferred stable kind supplied by callers that know it.
    if (explicit) return explicit;
    const name = normalizeKind(options?.name); // Legacy/farm callers encode the kind at the front of a unique object name.
    if (!name) return '';
    return knownHeadRigKeys().find(key => name === key || name.startsWith(key + '-')) || ''; // Avoids the old split('_')[0] bug for hyphenated species.
  }

  function baseHeadRigSpecies(kind) {
    const aliases = window.CreatureGenetics?.SPECIES_ALIAS || {};
    return aliases[kind] || HEAD_RIG_VARIANT_ALIASES[kind] || kind; // Den-Mothers and alpha resolve to the art-identical base species.
  }

  function readPainterPreviewRigs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); // Browser-local authoring overrides must beat committed defaults while testing.
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function headRigForOptions(options) {
    if (options?.headRig) return options.headRig; // Explicit animation/editor callers always win.
    const kind = creatureKindFromOptions(options);
    if (!kind) return null;
    const baseKind = baseHeadRigSpecies(kind);
    const preview = readPainterPreviewRigs();
    return preview[kind] || preview[baseKind] || ANIMAL_HEAD_RIGS[baseKind] || null; // One base UV map drives both normal and scaled variant geometry.
  }

  function installHeadRigBridge() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel || api.__speciesAnimalHeadRigBridgeInstalled) return false;
    const priorBuild = api.buildAnimalPlaneAvatarModel.bind(api); // Wraps the painted-skin runtime already installed by png-plane-avatar.js.
    api.buildAnimalPlaneAvatarModel = function buildSpeciesRiggedAnimal(THREE, spriteUrl, options = {}) {
      const kind = creatureKindFromOptions(options);
      const rig = headRigForOptions(options);
      if (!kind && !rig) return priorBuild(THREE, spriteUrl, options);
      return priorBuild(THREE, spriteUrl, {
        ...options,
        ...(kind ? { creatureId: kind } : {}), // Fixes farm hyphenated species even before a rig is consulted downstream.
        ...(rig ? { headRig: rig } : {}), // Direct injection makes painter previews override any future config-level default.
      });
    };
    api.__speciesAnimalHeadRigBridgeInstalled = true;
    return true;
  }

  if (window.CreatureGeneticsRender) {
    window.CreatureGeneticsRender.ANIMAL_HEAD_RIGS = ANIMAL_HEAD_RIGS; // Mobile/debug tooling can inspect the committed species rig without DevTools-only closure access.
    window.CreatureGeneticsRender.HEAD_RIG_VARIANT_ALIASES = HEAD_RIG_VARIANT_ALIASES;
    window.CreatureGeneticsRender.headRigForKind = kind => ANIMAL_HEAD_RIGS[baseHeadRigSpecies(normalizeKind(kind))] || null;
  }
  window.HobunjiAnimalHeadRigSpecies = { ANIMAL_HEAD_RIGS, HEAD_RIG_VARIANT_ALIASES, baseSpeciesFor: baseHeadRigSpecies, resolveForOptions: headRigForOptions, install: installHeadRigBridge }; // Small public diagnostic bridge shared by gameplay and authoring tools.
  installHeadRigBridge();
})();
