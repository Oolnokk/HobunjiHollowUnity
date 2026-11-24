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
      baseShadeReferenceHex: '#99BF99', // Mint highlight is the authored peak: genotype tint retains the darker green shadows.
      preferSourceKeyRecolor: true, // Paint only the mint coat; the white mantle, pink muzzle, claws and outlines remain native colors.
      baseRecolorKeyHex: '#99BF99', // Selects both mint highlight and its dark-green shading by hue instead of the old gray mask.
      baseRecolorHueTolerance: 15,
      baseRecolorMinSaturationRatio: 0.60,
      baseRecolorMinValue: 0.12,
      patternRecolorKeys: { beard: { hex: '#99BF99', hueTolerance: 15, minSaturationRatio: 0.60, minValue: 0.12 } }, // Retint only green fur; preserve the beard's black ink.
      baseColorPatterns: ['beard'], // Expression is inherited, but its fur hue (and Color Pools base-coat paint) always follows the body.
      base: { idle: 'assets/creaturesprites/grehlr_idle.png', run1: 'assets/creaturesprites/grehlr_run1.png', run2: 'assets/creaturesprites/grehlr_run2.png' },
      patterns: ['mitts', 'coloredstripe', 'beard', 'spectacles'], // Beard overlays the other fur patterns; spectacles alone sit above it.
      eyes: { open: 'assets/creaturesprites/grehlr_eye.png', blink: 'assets/creaturesprites/grehlr_blink.png' },
    },
    drenkirra: {
      prefix: 'drnk',
      baseShadeReferenceHex: '#68D127', // Authored full-strength Drenkirra base-coat color; species without this field retain automatic peak fallback.
      base: { idle: 'assets/creaturesprites/drenkirra_idle.png', run1: 'assets/creaturesprites/drenkirra_run1.png', run2: 'assets/creaturesprites/drenkirra_run2.png' },
      patterns: ['bodystripes', 'spectacles'],
      primaryColorPatterns: ['bodystripes'], // Uses body color A without swapping the base.
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
      patterns: ['cape', 'brushtail', 'spectacles'], // Tail overlays cape; the cape-aware brushtail source still resolves normally.
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
      eyes: { open: 'assets/creaturesprites/honeyfuzzle_eyes.png', blink: 'assets/creaturesprites/honeyfuzzle_eyes.png' }, // Reuse the authored eyes for all portrait frames without inventing a blink asset.
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
    if (kind === 'moot' && genotype?.coloredneck) {
      const { coloredneck, ...rest } = genotype; // Renderer-only compatibility for older Moot saves and standalone authoring tools.
      genotype = rest.overcoat ? rest : { ...rest, overcoat: { ...coloredneck } }; // Old colored neck renders as the new overcoat; never draw both.
    }
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
  function visibleDefaultCoatPatterns(kind, spec, genotype) {
    return (spec.defaultCoatPatterns || []).filter(defaultPattern => {
      const replacement = spec.patterns.some(id => {
        if (id === defaultPattern.id || !id.startsWith(defaultPattern.family)) return false;
        const allele = genotype?.[id]; // A carrier or unexpressed beard must not hide the ordinary beard.
        return allele?.enabled !== false && allele?.copies > 0 && !!patternTintColor(kind, id, genotype);
      });
      return !replacement;
    });
  }

  // While other animals occupy the one-at-a-time pixel compositor, start only
  // this pet's REQUIRED source PNG downloads (not every frame/pattern of its species).
  // All loads reuse loadImage's CORS-safe promise cache; any failed asset retries
  // normally when composeFrameNow actually needs it, never as missing coat art.
  let petSpritePrefetches = 0; // Diagnostic count of real pet frame prefetch requests.
  function prefetchPlayerPetFrameAssets(kind, frame, genotype, blinkShut) {
    const spec = SPECIES[kind]; // Unknown species have no source-art manifest.
    if (!spec) return;
    genotype = effectiveGenotype(kind, genotype); // Legacy fur/plates saved genes select the same artwork as composition.
    const urls = new Set([spec.base[frame] || spec.base.idle]); // One sprite per active frame; no eager run1/run2 downloads.
    for (const id of spec.underlayPatterns || []) urls.add(patternUrl(kind, id, frame, genotype)); // Permanently visible anatomical tails.
    for (const entry of visibleDefaultCoatPatterns(kind, spec, genotype)) urls.add(patternUrl(kind, entry.id, frame, genotype)); // Default beards survive beneath genetic patterns.
    for (const id of spec.patterns || []) {
      if (spec.underlayPatterns?.includes(id)) continue;
      const layer = genotype?.[id]; // Unexpressed or disabled inherited overlays have no art to fetch.
      if (layer?.enabled !== false && layer?.copies > 0 && patternTintColor(kind, id, genotype)) urls.add(patternUrl(kind, id, frame, genotype));
    }
    if (spec.eyes) {
      const eye = spec.eyes.mode === 'cycle'
        ? spec.eyes.variants[Math.max(0, Math.min(3, 'ABCD'.indexOf(typeof blinkShut === 'string' ? blinkShut : 'A')))]
        : (blinkShut ? spec.eyes.blink : spec.eyes.open); // Exact selected state; no unnecessary closed-eye upload.
      urls.add(eye);
    }
    for (const url of urls) if (url) loadImage(url).catch(() => null); // Network I/O overlaps older queued pixel work; no unhandled preload failure.
    if (!spec.fullBaseRecolor && !spec.preferSourceKeyRecolor) loadBaseMasks().catch(() => null); // Mask JSON overlaps source PNG downloads.
    petSpritePrefetches++;
  }

  function eyeSkinTintColor(kind, genotype, baseColor) {
    const patternId = SPECIES[kind]?.eyes?.skinColorPattern; // Optional pattern whose visible pigmentation covers the skin surrounding an eye.
    const layer = patternId ? genotype?.[patternId] : null; // Reads the same expressed allele used by pattern-layer compositing.
    const tint = patternTintColor(kind, patternId, genotype); // Shared pigment for the eye surround.
    return layer?.enabled !== false && layer?.copies > 0 && tint
      ? tint : baseColor; // Disabled, unexpressed, missing-color, and carrier-only patterns retain the base coat tint.
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
    p.then(null, () => { // A temporary image/CDN failure must not poison every later animal frame.
      if (_imageCache.get(resolvedUrl) === p) _imageCache.delete(resolvedUrl);
    });
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
    const flags = predicate?.mask || null; // Typed-array form of the same selection: skips a closure call per pixel in the fill loops.
    shared(px, targetRgb, {
      applyPredicate: predicate || null,
      samplePredicate: predicate || null,
      applyMask: flags,
      sampleMask: flags,
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
      const keyH = keyHsv.h, hueDistance = colorFill.hueDistance;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        // Inlined rgbToHsv (identical arithmetic, no per-pixel object) — this loop runs over every pixel of a 1M+ pixel sprite.
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
        if (max < minValue || (max === 0 ? 0 : delta / max) < minSaturation) continue; // v and s gates first: they reject most pixels before any hue math.
        let h = 0;
        if (delta !== 0) {
          if (max === r) h = ((g - b) / delta) % 6;
          else if (max === g) h = (b - r) / delta + 2;
          else h = (r - g) / delta + 4;
          h *= 60;
          if (h < 0) h += 360;
        }
        if (hueDistance(h, keyH) <= tolerance) matches[i >> 2] = 1;
      }
    }
    const predicate = i => matches[i >> 2] === 1;
    predicate.mask = matches; // Lets recolorPixels hand the flags to ColorFill without per-pixel closure calls.
    return predicate;
  }

  const _sourceKeyPaintMasks = new WeakMap(); // Original sprite -> keyed coat masks, reused by Color Pools without scanning each repainted frame.
  async function sourceKeyPaintMask(url, sourceKey) {
    const image = await loadImage(url); // The original authored colors identify the coat; the recolored pixels cannot reliably do so.
    let masks = _sourceKeyPaintMasks.get(image);
    if (!masks) _sourceKeyPaintMasks.set(image, masks = new Map());
    const key = [sourceKey.hex, sourceKey.hueTolerance, sourceKey.minSaturationRatio, sourceKey.minValue].join('|'); // Distinguishes source-key rules for cached sprites.
    if (masks.has(key)) return masks.get(key);
    await window.PixelWorkYield?.maybeYield();
    const width = image.naturalWidth, height = image.naturalHeight;
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const flags = sourceKeyPredicate(ctx.getImageData(0, 0, width, height).data, sourceKey).mask;
    const mask = { width, height, data: flags }; // Shared by all Color Pools base patterns; dark hooves and other non-coat details stay excluded.
    masks.set(key, mask);
    return mask;
  }

  const _artworkAlphaMasks = new WeakMap(); // Original overlay image -> opacity stencil, shared across all inherited coat colors and paint jobs.
  async function artworkAlphaMask(url) {
    const image = await loadImage(url);
    if (_artworkAlphaMasks.has(image)) return _artworkAlphaMasks.get(image);
    await window.PixelWorkYield?.maybeYield();
    const width = image.naturalWidth, height = image.naturalHeight;
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let p = 0; p < data.length; p++) data[p] = pixels[p * 4 + 3]; // Preserve real alpha, not just a binary silhouette, for the beard's foreground restoration.
    const mask = { width, height, data }; // Keeps the original beard silhouette available for the final foreground pass.
    _artworkAlphaMasks.set(image, mask);
    return mask;
  }

  // Shared keyed shade-fill for animal coats and matching attached PNG surfaces.
  function recolorKeyedPixels(px, targetRgb, sourceKey, sourceReferenceHex = null, debugLabel = null) {
    recolorPixels(px, targetRgb, sourceKeyPredicate(px, sourceKey), sourceReferenceHex, debugLabel);
  }

  // Sprite PNGs and the mask JSON are cached independently, so a returning player can briefly hold
  // a sprite and mask authored at different resolutions (oversized sprites were downscaled). When the
  // aspect ratio matches, nearest-neighbour resample the mask instead of dropping the recolor.
  const _fittedMasks = new WeakMap(); // mask -> Map("WxH" -> resampled mask)
  function fitMaskToImage(mask, width, height) {
    if (!mask || !(width > 0) || !(height > 0)) return mask;
    if (mask.width === width && mask.height === height) return mask;
    if (Math.abs(mask.width / mask.height - width / height) > 0.01) return mask; // Different art, not a different resolution.
    let bySize = _fittedMasks.get(mask);
    if (!bySize) _fittedMasks.set(mask, bySize = new Map());
    const key = width + 'x' + height;
    if (bySize.has(key)) return bySize.get(key);
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const sy = Math.min(mask.height - 1, Math.floor((y + 0.5) * mask.height / height)) * mask.width;
      for (let x = 0; x < width; x++) data[y * width + x] = mask.data[sy + Math.min(mask.width - 1, Math.floor((x + 0.5) * mask.width / width))];
    }
    const fitted = { width, height, data };
    bySize.set(key, fitted);
    return fitted;
  }

  function maskPredicate(mask) {
    const predicate = i => mask.data[i / 4];
    predicate.mask = mask.data; // Uint8Array of 0/1 flags; same selection, no closure call per pixel.
    return predicate;
  }

  async function recoloredBase(url, color, mask, allowUnmasked = false, sourceReferenceHex = null, kind = '', sourceKey = null) {
    const key = `base|${url}|${color}|ref:${sourceReferenceHex || 'auto'}|full:${allowUnmasked}|key:${sourceKey?.hex || ''}`;
    if (_recolorCache.has(key)) return cachedRecolor(key);
    const promise = (async () => {
      const img = await loadImage(url);
      await window.PixelWorkYield?.maybeYield(); // Lets a frame present between queued recolor passes (see pixel-work-yield.js).
      mask = fitMaskToImage(mask, img.naturalWidth, img.naturalHeight);
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
        maskMatches ? maskPredicate(mask) : null,
        sourceReferenceHex,
        debugLabel,
      );
      ctx.putImageData(data, 0, 0);
      return c;
    })().catch(err => { if (_recolorCache.get(key) === promise) forgetRecolor(key); throw err; });
    rememberRecolor(key, promise);
    return promise;
  }
  async function recoloredPattern(url, color, sourceKey = null, sourceReferenceHex = null) {
    const key = `pattern|${url}|${color}|source:${sourceKey?.hex || 'all'}|ref:${sourceReferenceHex || 'auto'}`; // Separate keyed coat artwork from ordinary fully tintable masks.
    if (_recolorCache.has(key)) return cachedRecolor(key);
    const promise = (async () => {
      const img = await loadImage(url);
      await window.PixelWorkYield?.maybeYield();
      const c = makeCanvas(img.naturalWidth, img.naturalHeight), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data;
      if (sourceKey) recolorKeyedPixels(px, hexToRgb(color), sourceKey, sourceReferenceHex, `animal-pattern:${url}`); // Preserve non-coat detail present in Moot's overcoat PNG.
      else recolorPixels(px, hexToRgb(color), null);
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

  let _maskPromise = null; // Successful mask JSON is shared; failed requests must be retried instead of caching an empty recolor map.
  function loadBaseMasks() {
    if (_maskPromise) return _maskPromise;
    const pending = fetch(docsUrl('config/creature-base-masks.json')).then(r => {
      if (r?.ok === false) throw new Error('Creature base masks HTTP ' + r.status);
      return r.json();
    }).then(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid creature base-mask data');
      const out = {};
      for (const [kind, frames] of Object.entries(raw)) {
        out[kind] = {};
        for (const [frame, encoded] of Object.entries(frames)) out[kind][frame] = decodeMaskRle(encoded);
      }
      return out;
    });
    _maskPromise = pending;
    pending.then(null, error => {
      if (_maskPromise === pending) _maskPromise = null;
      window.__farmLog?.('[genotype-render] base masks unavailable; next composition will retry: ' + (error?.message || error), 'warn');
    });
    return pending;
  }

  function patternTintColor(kind, patternId, genotype) {
    if (SPECIES[kind]?.baseColorPatterns?.includes(patternId) || SPECIES[kind]?.primaryColorPatterns?.includes(patternId)) return genotype?.base?.color || null;
    if (genotype?.secondary?.color) return genotype.secondary.color;
    if (window.CreatureGenetics?.secondaryColor) return window.CreatureGenetics.secondaryColor(kind, genotype);
    const ids = SPECIES[kind]?.patterns || []; // Standalone tools use the same first-pattern B fallback.
    const first = ids[0];
    if (genotype?.[first]?.color) return genotype[first].color;
    const fallback = ids.find(id => !SPECIES[kind]?.baseColorPatterns?.includes(id) && !SPECIES[kind]?.primaryColorPatterns?.includes(id) && genotype?.[id]?.color);
    return genotype?.[first]?.color || genotype?.[fallback]?.color || genotype?.base?.color || null;
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
        compactHashText(JSON.stringify([Array.isArray(paint.patterns) ? paint.patterns.slice(0, 2) : (paint.pattern || null), Array.isArray(paint.mergedPatterns) ? paint.mergedPatterns.slice(0, 5) : []])), // Cache accounts for every fused motif placement and the separate overpass.
      ].join(':');
    }).join('|');
    return compactHashText(compact);
  }

  function maskedRegionCanvas(imageOrCanvas, mask, preserveMaskAlpha = false) {
    if (!imageOrCanvas || !mask) return imageOrCanvas;
    const width = imageOrCanvas.naturalWidth || imageOrCanvas.width || 0;
    const height = imageOrCanvas.naturalHeight || imageOrCanvas.height || 0;
    if (!width || !height) return imageOrCanvas;
    mask = fitMaskToImage(mask, width, height); // Cached sprite and mask may have been authored at different resolutions.
    if (mask.width !== width || mask.height !== height) throw new Error('Animal surface-paint mask dimensions differ from sprite'); // Never fall back to unmasked paint that could mark protected hoof pixels.
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imageOrCanvas, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    for (let p = 0, i = 0; p < mask.data.length; p++, i += 4) {
      if (!mask.data[p]) image.data[i + 3] = 0;
      else if (preserveMaskAlpha) image.data[i + 3] = Math.min(image.data[i + 3], mask.data[p]); // Restoring beard above belly must retain the original partially transparent fur edges.
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

  async function applyColorPoolPaint(imageOrCanvas, genotype, regionId, regionMask, cachePrefix, compositorOptions = null) {
    const paint = colorPoolPaintFor(genotype, regionId);
    if (!paint) return null;
    const dyeHex = paint.dyeHex || window.DyeSystem?.getById?.(paint.dyeId)?.hex || null;
    const primary = paint.pattern || paint.patterns?.[0]
      || (paint.patternLibraryId ? window.PatternLibrary?.getById?.(paint.patternLibraryId) : null)
      || (paint.repoPatternId ? { repoPatternId: paint.repoPatternId } : null); // Backward-compatible single-pattern reads.
    const merged = (Array.isArray(paint.mergedPatterns) ? paint.mergedPatterns : [])
      .filter(pattern => pattern && typeof pattern === 'object').slice(0, 5); // Up to five independent shapes sharing the primary dye and outline.
    const overpass = paint.patterns?.[1]
      || (paint.overpassPatternId ? { repoPatternId: paint.overpassPatternId } : null)
      || (paint.overpassPatternLibraryId ? window.PatternLibrary?.getById?.(paint.overpassPatternLibraryId) : null);
    const rawPatterns = primary ? [primary, ...merged, ...(overpass ? [overpass] : [])] : [];
    const fusedPrimaryCount = primary ? 1 + merged.length : 1; // Tells the shared compositor which motifs must unite BEFORE any overpass is processed.
    const animalPatternScale = Math.max(7, Math.min(14, Number(paint.patternScale) || 7)); // Per-animal scale applies to every fused and overpass motif.
    const debugBase = { patternCount: rawPatterns.length, fusedPatternCount: merged.length, patternScale: animalPatternScale, dyeHex, status: 'pending' };
    try {
      const patterns = [];
      for (const raw of rawPatterns) {
        if (!raw) continue;
        let pattern = { ...raw };
        const repoPatternId = pattern.repoPatternId || (patterns.length === 0 ? paint.repoPatternId : null) || null;
        if (repoPatternId && !(pattern.motifDataUrl || pattern.motifUrl || pattern.customMotifId)) {
          pattern = { ...(await window.RepoPatternLibrary?.getById?.(repoPatternId) || {}), ...pattern }; // Preserve animal-specific placements on resolved repo motifs.
        }
        const isOverpass = patterns.length >= fusedPrimaryCount;
        if (!isOverpass) delete pattern.inkColorHex; // The primary and all fused shapes use exactly the region's primary dye.
        const secondaryInk = paint.overpassDyeHex || window.DyeSystem?.getById?.(paint.overpassDyeId)?.hex;
        patterns.push({ ...pattern, usageScaleMultiplier: animalPatternScale,
          ...(isOverpass && /^#[0-9a-f]{6}$/i.test(secondaryInk || '') ? { inkColorHex: secondaryInk } : {}) });
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
      const rendered = await compositor(clippedSource, patterns, dyeHex, cachePrefix, null, 'animal-surface-pattern', { ...(compositorOptions || {}), fusedPrimaryCount }); // Same-layer masks are unioned; a distinct overpass still retains its clearance and secondary ink.
      const applied = !!rendered && rendered !== clippedSource;
      setPatternPaintDebug(regionId, {
        ...debugBase,
        patternCount: patterns.length,
        status: applied ? 'applied' : 'failed',
        reason: applied ? null : 'compositor returned the unpatterned source',
        motifRefs,
        overpass: overpass ? { clearanceMultiplier: Math.max(3, Math.min(12, Number(patterns[fusedPrimaryCount]?.overpassClearanceMultiplier) || 3)) } : null, // Fused primary motifs are not mistaken for a second-color overpass in mobile diagnostics.
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
  function safePrefetchPlayerPetFrameAssets(kind, frame, genotype, blinkShut) {
    try { prefetchPlayerPetFrameAssets(kind, frame, genotype, blinkShut); }
    catch (error) {
      // Optional source downloads must never strand a pet's actual color/pattern composition.
      window.__farmLog?.('[genotype-render] pet prefetch deferred: ' + String(error?.message || error), 'warn');
    }
  }

  // One native-resolution animal composite at a time, prioritizing pets without raising peak canvas memory.
  const composeQueue = []; // Pending whole-appearance jobs (fur, inherited patterns, Color Pools motifs and eyes).
  const COMPOSE_PET_BURST = 4; // One lower-priority job after four pet jobs prevents indefinite starvation.
  let composePending = 0, composeActive = 0; // Existing mobile cache counters include queued and active jobs.
  let composeFailures = 0, lastComposeFailure = null; // Incomplete frames reject and retry, never become cached plain sprites.
  let composeDrainScheduled = false, composePetStreak = 0; // At most one active queue drain.
  let composePetStarts = 0, composePromotions = 0; // Visible performance counters, no per-frame inspection.

  function composePriority(options) {
    const value = typeof options === 'string' ? options : options?.priority; // Role passed by farm/game/shoulder render callers.
    return value === 'pet' ? 2 : value === 'farm' ? 1 : 0;
  }
  function composeRequestKey(kind, frame, signature, blinkShut) {
    return kind + '|' + frame + '|' + signature + '|' + eyeStateKey(blinkShut); // Same texture identity across wild and companion consumers.
  }
  function promoteFrame(kind, frame, signature, blinkShut = false, options = 'pet') {
    const key = composeRequestKey(kind, frame, signature, blinkShut); // Existing wild request may become a player-pet request.
    const priority = composePriority(options);
    let promoted = false; // Whether queued work was reordered, for the shared texture owner and debug snapshot.
    for (const job of composeQueue) {
      if (job.key !== key || job.priority >= priority) continue;
      job.priority = priority;
      if (priority === 2) safePrefetchPlayerPetFrameAssets(job.kind, job.frame, job.genotype, job.blinkShut); // A failed optional image prefetch must never cancel promotion.
      composePromotions++;
      promoted = true;
    }
    return promoted;
  }
  function scheduleComposeDrain() {
    if (composeActive || composeDrainScheduled) return;
    composeDrainScheduled = true;
    Promise.resolve().then(drainComposeQueue); // Gather synchronous spawn-wave requests before selecting the first job.
  }
  async function drainComposeQueue() {
    composeDrainScheduled = false;
    if (composeActive) return;
    let completed = 0; // Browser may present between completed native-resolution pixel jobs.
    while (composeQueue.length) {
      let pick = 0, best = -1; // Highest priority first, FIFO within that priority.
      for (let i = 0; i < composeQueue.length; i++) {
        if (composeQueue[i].priority > best) { best = composeQueue[i].priority; pick = i; }
      }
      if (best === 2 && composePetStreak >= COMPOSE_PET_BURST) {
        let lower = -1; // Prefer farm animals to wildlife when giving the other queues a fairness turn.
        for (let i = 0; i < composeQueue.length; i++) {
          if (composeQueue[i].priority < 2 && composeQueue[i].priority > lower) { lower = composeQueue[i].priority; pick = i; }
        }
        if (lower < 0) pick = 0; // No lower-priority work is waiting.
      }
      const job = composeQueue.splice(pick, 1)[0]; // No mutation of an active genotype composition.
      composeActive++;
      if (job.priority === 2) { composePetStreak++; composePetStarts++; }
      else composePetStreak = 0;
      try {
        if (completed && typeof setTimeout === 'function') await new Promise(resolve => setTimeout(resolve, 0)); // Avoid a long unbroken main-thread burst.
        job.resolve(await composeFrameNow(job.kind, job.frame, job.genotype, job.blinkShut));
      } catch (error) {
        composeFailures++;
        lastComposeFailure = { kind: job.kind, frame: job.frame, message: String(error?.message || error), at: Date.now() }; // Mobile report shows real incomplete-art failures.
        job.reject(error); // Never publish a partially colored/patterned frame.
      } finally {
        composeActive--;
        composePending--;
        completed++;
      }
    }
  }
  function composeFrame(kind, frame, genotype, blinkShut = false, options = null) {
    const priority = composePriority(options); // Default preserves historical FIFO for preview and wildlife callers.
    const key = composeRequestKey(kind, frame, genotypeSignature(kind, genotype), blinkShut);
    if (priority === 2) safePrefetchPlayerPetFrameAssets(kind, frame, genotype, blinkShut); // Prefetch failures fall back to composeFrameNow rather than permanently leaving plain sprites.
    return new Promise((resolve, reject) => {
      composeQueue.push({ kind, frame, genotype, blinkShut, priority, key, resolve, reject }); // One shared canonical compositor, not a second fast/patternless renderer.
      composePending++;
      scheduleComposeDrain();
    });
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
    const masks = spec.fullBaseRecolor || spec.preferSourceKeyRecolor ? null : await loadBaseMasks(); // Mint Grehlr and full-recolor species bypass legacy gray masks; hue-selected coats must not tint unrelated anatomy.
    const tMasks = performance.now();
    const mask = masks?.[kind]?.[frame];
    const baseColor = genotype?.base?.color; // Primary body pigment always colors the base.
    const fullBaseRecolor = spec.fullBaseRecolor === true; // Used by species whose base sprite itself is the recolorable coat instead of requiring a separate region mask.
    const sourceKey = !mask && !fullBaseRecolor && spec.baseRecolorKeyHex // Mask-less species whose coat is identified by its authored source color.
      ? { hex: spec.baseRecolorKeyHex, hueTolerance: spec.baseRecolorHueTolerance, minSaturationRatio: spec.baseRecolorMinSaturationRatio, minValue: spec.baseRecolorMinValue }
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
    const incompleteLayers = []; // Required artwork/paint failures make this frame retryable rather than silently caching missing details.
    for (const patternId of spec.underlayPatterns || []) {
      const layer = genotype?.[patternId]; // Expressed tail genes use their second tint; otherwise this permanent anatomical region uses the primary coat.
      const tint = patternTintColor(kind, patternId, genotype);
      const expressed = layer?.enabled !== false && Number(layer?.copies) > 0 && !!tint;
      const underlayColor = expressed ? tint : (baseColor || spec.baseShadeReferenceHex || null);
      const url = patternUrl(kind, patternId, frame, genotype);
      try {
        const underlay = underlayColor ? await recoloredPattern(url, underlayColor) : await loadImage(url);
        const painted = await applyColorPoolPaint(underlay, genotype, patternId, null,
          `animal:${kind}:${frame}:${patternId}:${underlayColor || 'native'}`).catch(error => {
          window.__farmLog?.(`[genotype-render] underlay paint for "${patternId}" failed: ${error.message}`, 'warn');
          incompleteLayers.push('paint:' + patternId);
          return null;
        });
        if (colorPoolPaintFor(genotype, patternId) && !painted) incompleteLayers.push('paint:' + patternId);
        ctx.drawImage(painted || underlay, 0, 0, c.width, c.height);
        drawnPatterns.push(patternId + (expressed ? '' : '(default)'));
      } catch (error) {
        window.__farmLog?.(`[genotype-render] underlay "${patternId}" failed to load (${url}): ${error.message}`, 'warn');
        incompleteLayers.push('underlay:' + patternId);
      }
    }
    const defaultCoatOverlays = []; // Anatomical (non-genetic) coat additions are prepared now so a single Color Pools motif spans body and beard.
    for (const defaultPattern of visibleDefaultCoatPatterns(kind, spec, genotype)) {
      const url = patternUrl(kind, defaultPattern.id, frame, genotype);
      try {
        const coatColor = baseColor || spec.baseShadeReferenceHex || '#99BF99';
        defaultCoatOverlays.push({ id: defaultPattern.id, url, image: await recoloredPattern(url, coatColor) });
      } catch (error) {
        window.__farmLog?.(`[genotype-render] default coat pattern "${defaultPattern.id}" missing (${url}): ${error.message}`, 'warn');
        incompleteLayers.push('default:' + defaultPattern.id);
      }
    }
    const paintedDefaultCoats = new Map(); // Retains the one patterned body+beard surface and source beard alpha for selective foreground restoration.
    ctx.drawImage(baseSource, 0, 0);
    try {
      const coatPaint = colorPoolPaintFor(genotype, 'base'); // Avoid extra mask/overlay work on ordinary non-painted animals.
      let basePaintMask = coatPaint && sourceKey && !mask
        ? await sourceKeyPaintMask(baseUrl, sourceKey) : mask; // Excludes dark Voorg-Ass hooves and unrelated authored sprite details.
      let basePaintSource = baseSource;
      const defaultCoatMasks = []; // Alpha masks isolate the beard when it is restored above inherited belly patterns.
      if (coatPaint && defaultCoatOverlays.length) {
        const combined = makeCanvas(bw, bh);
        const combinedContext = combined.getContext('2d');
        combinedContext.drawImage(baseSource, 0, 0);
        for (const overlay of defaultCoatOverlays) {
          combinedContext.drawImage(overlay.image, 0, 0);
          defaultCoatMasks.push({ id: overlay.id, mask: await artworkAlphaMask(overlay.url) });
        }
        if (basePaintMask) {
          const fitted = fitMaskToImage(basePaintMask, bw, bh);
          if (fitted.width === bw && fitted.height === bh) {
            const data = new Uint8Array(fitted.data);
            for (const overlay of defaultCoatMasks) {
              const alpha = fitMaskToImage(overlay.mask, bw, bh);
              if (alpha.width !== bw || alpha.height !== bh) continue;
              for (let p = 0; p < data.length; p++) if (alpha.data[p]) data[p] = 1;
            }
            basePaintMask = { width: bw, height: bh, data }; // One coat selection spans the beard and body; excluded hooves remain unpatterned.
          }
        }
        basePaintSource = combined;
      }
      const paintedBase = await applyColorPoolPaint(basePaintSource, genotype, 'base', fullBaseRecolor ? null : basePaintMask, `animal:${kind}:${frame}:base:${baseColor || 'native'}:coat:${defaultCoatOverlays.map(overlay => overlay.id).join('+') || 'body'}`,
        defaultCoatOverlays.length ? { continuousSurface: true } : null); // Only anatomical coat extensions require matching motif phase across separate silhouette islands.
      if (coatPaint && !paintedBase) incompleteLayers.push('paint:base');
      if (paintedBase) {
        ctx.drawImage(paintedBase, 0, 0, c.width, c.height);
        for (const overlay of defaultCoatMasks) paintedDefaultCoats.set(overlay.id, { image: paintedBase, mask: overlay.mask }); // One patterned coat source; do not double-blend its translucent beard edge now.
      }
    } catch (error) {
      window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): Color Pools base paint failed — retryable: ${error.message}`, 'warn');
      incompleteLayers.push('paint:base');
    }
    const inheritedOverlayCoverage = paintedDefaultCoats.size ? new Uint8Array(bw * bh) : null; // Combined post-coat alpha determines where the beard needs to be restored above genetic patterns.
    for (const patternId of spec.patterns) {
      if (spec.underlayPatterns?.includes(patternId)) continue; // The always-visible tail is already beneath the base, never drawn twice.
      const layer = genotype?.[patternId];
      const renderColor = patternTintColor(kind, patternId, genotype); // Central tint resolution keeps independent beard visibility separate from inherited body pigment.
      const patternUsesBaseCoat = spec.baseColorPatterns?.includes(patternId) === true; // Reuses the body's surface paint instead of an independent beard-only dye.
      // A layer with no `enabled` field at all (uumkaoii's permanent
      // fur/plates regions — see makeDefaultGenotype) is always on; only an
      // EXPLICIT `enabled: false` (gar-wolf/dabinggi-hound's optional
      // pattern roll) turns a layer off.
      if (layer?.enabled === false || !(layer?.copies > 0) || !renderColor) continue;
      const url = patternUrl(kind, patternId, frame, genotype);
      try {
        // The centralized tint resolver selects the shared A/B pigment without changing sprite masks or drawing order.
        const patternSourceKey = spec.patternRecolorKeys?.[patternId] || null; // Only anatomically keyed overlay regions opt into selective pigment tinting.
        const recolored = await recoloredPattern(url, renderColor, patternSourceKey, patternSourceKey ? spec.baseShadeReferenceHex : null);
        let renderedLayer = recolored;
        try {
          const paintRegionId = patternUsesBaseCoat ? 'base' : patternId; // Base-coat surface motifs carry onto the beard without an independent beard dye.
          const patternPaintMask = patternSourceKey && colorPoolPaintFor(genotype, paintRegionId)
            ? await sourceKeyPaintMask(url, patternSourceKey) : null; // Color Pools motifs avoid black ink and neighboring anatomy.
          const painted = await applyColorPoolPaint(recolored, genotype, paintRegionId, patternPaintMask, `animal:${kind}:${frame}:${patternId}:${renderColor || 'native'}`);
          if (colorPoolPaintFor(genotype, paintRegionId) && !painted) incompleteLayers.push('paint:' + patternId);
          renderedLayer = painted || recolored;
        } catch (paintError) {
          window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): Color Pools paint for "${patternId}" failed — retryable: ${paintError.message}`, 'warn');
          incompleteLayers.push('paint:' + patternId);
        }
        if (spec.clipPatternsToBase?.includes(patternId)) {
          const previousCompositeOperation = ctx.globalCompositeOperation; // Restored immediately so later independent patterns and eyes still render normally.
          ctx.globalCompositeOperation = 'source-atop'; // Clip overcoat to the already-drawn base silhouette without a second pixel pass.
          try { ctx.drawImage(renderedLayer, 0, 0, c.width, c.height); }
          finally { ctx.globalCompositeOperation = previousCompositeOperation; }
        } else ctx.drawImage(renderedLayer, 0, 0, c.width, c.height);
        if (inheritedOverlayCoverage) {
          const originalAlpha = fitMaskToImage(await artworkAlphaMask(url), bw, bh); // Use authored overlay opacity; Color Pools does not change its silhouette.
          if (originalAlpha.width !== bw || originalAlpha.height !== bh) throw new Error('Inherited coat overlay alpha dimensions differ from sprite');
          for (let p = 0; p < inheritedOverlayCoverage.length; p++) {
            const prior = inheritedOverlayCoverage[p];
            inheritedOverlayCoverage[p] = prior + Math.round((255 - prior) * originalAlpha.data[p] / 255); // Source-over union of subsequent genetic layers.
          }
        }
        drawnPatterns.push(patternId);
      } catch (e) {
        window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): pattern "${patternId}" failed to load/recolor (${url}) — retryable: ${e.message}`, 'warn');
        incompleteLayers.push('pattern:' + patternId);
      }
    }
    for (const overlay of defaultCoatOverlays) {
      const painted = paintedDefaultCoats.get(overlay.id);
      if (painted && inheritedOverlayCoverage) {
        const originalAlpha = fitMaskToImage(painted.mask, bw, bh); // Existing authored beard edge opacity survives the final foreground pass.
        if (originalAlpha.width !== bw || originalAlpha.height !== bh) throw new Error('Default beard alpha dimensions differ from sprite');
        const coverage = new Uint8Array(bw * bh); // Restoration is needed only where a later inherited overlay covered the beard.
        for (let p = 0; p < coverage.length; p++) coverage[p] = Math.round(originalAlpha.data[p] * inheritedOverlayCoverage[p] / 255);
        ctx.drawImage(maskedRegionCanvas(painted.image, { width: bw, height: bh, data: coverage }, true), 0, 0, c.width, c.height);
      } else if (!painted) ctx.drawImage(overlay.image, 0, 0, c.width, c.height); // Ordinary unpainted creatures draw their authored beard once, after the belly.
      drawnPatterns.push(overlay.id + '(default)'); // Anatomical overlay remains non-genetic and unselectable in Color Pools.
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
        window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): eye overlay failed to load (${eyeUrl}) — retryable: ${e.message}`, 'warn');
        incompleteLayers.push('eyes');
      }
    }
    if (incompleteLayers.length) {
      throw new Error(`Incomplete ${kind}/${frame} genotype artwork (${[...new Set(incompleteLayers)].join(', ')}); retry rather than cache missing colors, patterns or eyes`);
    }
    const tEnd = performance.now();
    // Broken down so a slow compose (the "ran around plain for ages" symptom)
    // shows WHERE the time went — masksMs covers the one-time mask JSON
    // fetch+decode (only nonzero the very first call all session), baseMs
    // covers the base sprite's network load + recolor pixel pass, patternMs
    // covers every enabled pattern layer's load+recolor combined.
    const baseFillMode = !baseColor ? 'none' : fullBaseRecolor ? 'full-sprite' : mask ? 'mask' : sourceKey ? 'source-key' : 'missing-mask'; // Included in the in-game farm log so mobile builds can verify which recolor path actually ran.
    window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): base=${baseColor || '(none)'} baseFill=${baseFillMode} sourceRef=${spec.baseShadeReferenceHex || 'auto'} patterns=[${drawnPatterns.join(',') || 'none'}] eyeSkinTint=${!!(spec.eyes?.skinRecolorKey && eyeSkinColor)} eyeSkinColor=${eyeSkinColor || '(none)'} timing: masksMs=${(tMasks - t0).toFixed(0)} baseMs=${(tBase - tMasks).toFixed(0)} patternMs=${(tEnd - tBase).toFixed(0)} totalMs=${(tEnd - t0).toFixed(0)}`, 'wildlife');
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
    try { if (targets.some(kind => SPECIES[kind] && !SPECIES[kind].fullBaseRecolor && !SPECIES[kind].preferSourceKeyRecolor)) await loadBaseMasks(); }
    catch (error) {
      // Prewarm is opportunistic: a transient mask failure must not cancel the
      // rest of the sprite prefetch or become an unhandled rejection at startup.
      // composeFrame itself still rejects incomplete art and retries the masks.
      window.__farmLog?.('[genotype-render] prewarm masks deferred: ' + String(error?.message || error), 'warn');
    }
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
      const tintColor = l?.enabled !== false && l?.copies > 0 ? patternTintColor(kind, id, genotype) : null; // Resolve only visible patterns; cache tracks shared pigments, not inactive or obsolete mirrors.
      parts.push(tintColor ? `${id}:${tintColor}` : '');
    }
    const paintSig = colorPoolPaintSignature(genotype);
    if (paintSig) parts.push(`paint:${paintSig}`);
    return parts.join('|');
  }

  window.CreatureGeneticsRender = { composeFrame, genotypeSignature, colorPoolPaintSignature, getLastPatternPaintDebug, prewarm, promoteFrame, patternUrl, eyeStateKey, eyeStatesForKind, eyeSkinTintColor, SPECIES, recolorPixels, recolorKeyedPixels, patternTintColor, fitMaskToImage, hexToRgb, memorySnapshot: () => ({ recolorEntries: _recolorCache.size, recolorEstimatedBytes: recolorBytes, recolorBudgetBytes: RECOLOR_CACHE_BYTES, composePending, composeActive, composeFailures, lastComposeFailure, queuedPets: composeQueue.filter(job => job.priority === 2).length, queuedFarm: composeQueue.filter(job => job.priority === 1).length, composePetStarts, composePromotions, petSpritePrefetches }) };

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
  const ANIMAL_HEAD_RIGS = Object.freeze({"dabinggi-hound":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.2578125,"y":0.4107142857142857},"weightMap":{"width":128,"height":56,"encoding":"rle-u9","unsetValue":256,"data":[665,256,3,255,10,256,1,0,108,256,11,255,5,256,7,0,102,256,15,255,3,256,9,0,99,256,18,255,1,256,11,0,97,256,19,255,1,256,11,0,96,256,20,255,12,0,94,256,22,255,12,0,93,256,23,255,12,0,91,256,25,255,12,0,90,256,26,255,12,0,90,256,26,255,12,0,89,256,28,255,12,0,88,256,28,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,12,0,87,256,29,255,14,0,84,256,29,255,15,0,84,256,29,255,16,0,83,256,26,255,1,256,18,0,83,256,25,255,20,0,82,256,25,255,21,0,82,256,24,255,22,0,82,256,23,255,23,0,82,256,22,255,23,0,83,256,22,255,22,0,84,256,21,255,22,0,85,256,21,255,21,0,86,256,21,255,21,0,86,256,20,255,22,0,86,256,18,255,2,256,21,0,88,256,16,255,3,256,21,0,89,256,7,255,2,256,4,255,5,256,21,0,107,256,21,0,107,256,21,0,107,256,21,0,107,256,21,0,108,256,20,0,108,256,21,0,107,256,21,0,107,256,21,0,108,256,20,0,108,256,20,0,108,256,21,0,107,256,21,0,108,256,19,0,109,256,19,0,110,256,18,0,84,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48},"gar-wolf":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.328125,"y":0.4375},"weightMap":{"width":128,"height":56,"encoding":"rle-u9","unsetValue":256,"data":[657,256,4,255,122,256,9,255,118,256,13,255,114,256,15,255,112,256,17,255,108,256,24,255,102,256,28,255,95,256,35,255,91,256,39,255,89,256,40,255,88,256,41,255,87,256,41,255,87,256,42,255,86,256,42,255,86,256,42,255,86,256,42,255,86,256,42,255,86,256,42,255,86,256,42,255,86,256,41,255,87,256,40,255,88,256,40,255,88,256,40,255,88,256,40,255,88,256,40,255,88,256,39,255,89,256,38,255,90,256,36,255,92,256,35,255,93,256,34,255,94,256,33,255,95,256,31,255,102,256,15,255,1,256,7,255,108,256,12,255,3,256,2,255,111,256,12,255,117,256,11,255,118,256,9,255,120,256,7,255,123,256,3,255,1648,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48},"drenkirra":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.4375,"y":0.5123456790123457},"weightMap":{"width":128,"height":81,"encoding":"rle-u9","unsetValue":256,"data":[2976,256,6,255,120,256,11,255,116,256,19,255,108,256,22,255,105,256,24,255,103,256,25,255,103,256,26,255,101,256,29,255,99,256,29,255,98,256,31,255,97,256,31,255,96,256,33,255,94,256,34,255,93,256,35,255,92,256,36,255,91,256,36,255,92,256,36,255,91,256,37,255,91,256,37,255,91,256,37,255,91,256,37,255,90,256,38,255,90,256,37,255,91,256,37,255,92,256,36,255,92,256,36,255,92,256,33,255,2,0,93,256,33,255,3,0,93,256,32,255,4,0,92,256,32,255,5,0,92,256,25,255,1,0,3,255,8,0,92,256,25,255,11,0,92,256,25,255,12,0,92,256,15,255,1,0,7,255,13,0,93,256,12,255,3,0,6,255,15,0,94,256,8,255,6,0,5,255,15,0,97,256,3,255,9,0,3,255,16,0,99,256,29,0,98,256,31,0,96,256,32,0,95,256,33,0,94,256,35,0,93,256,35,0,92,256,37,0,91,256,37,0,91,256,37,0,91,256,37,0,90,256,38,0,91,256,37,0,91,256,37,0,91,256,36,0,92,256,35,0,93,256,25,0,1,256,8,0,95,256,23,0,105,256,23,0,105,256,24,0,105,256,23,0,105,256,23,0,78,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48},"grehlr":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.421875,"y":0.6510416666666666},"weightMap":{"width":128,"height":96,"encoding":"rle-u9","unsetValue":256,"data":[21,256,107,0,20,256,108,0,18,256,110,0,17,256,111,0,16,256,112,0,15,256,113,0,15,256,113,0,14,256,114,0,13,256,115,0,12,256,116,0,11,256,117,0,10,256,118,0,9,256,119,0,8,256,120,0,7,256,121,0,6,256,122,0,6,256,122,0,5,256,123,0,4,256,124,0,4,256,124,0,3,256,125,0,2,256,126,0,1,256,283,0,20,64,106,0,3,64,18,128,8,64,98,0,2,64,3,128,16,191,8,128,3,64,95,0,2,64,2,128,3,191,14,128,8,191,3,128,2,64,93,0,2,64,2,128,2,191,3,128,12,191,8,128,3,191,2,128,2,64,91,0,2,64,2,128,2,191,2,128,3,191,10,255,8,191,3,128,2,191,2,128,1,64,91,0,1,64,2,128,2,191,2,128,2,191,19,255,3,191,2,128,2,191,1,128,1,64,88,0,4,64,1,128,2,191,2,128,2,191,22,255,2,191,2,128,1,191,1,128,1,64,86,0,3,64,4,128,1,191,2,128,2,191,24,255,2,191,1,128,1,191,1,128,1,64,85,0,2,64,3,128,4,191,1,128,2,191,26,255,1,191,1,128,1,191,1,128,1,64,84,0,2,64,2,128,3,191,4,128,1,191,27,255,1,191,1,128,1,191,1,128,1,64,84,0,1,64,2,128,2,191,3,128,4,191,27,255,1,191,1,128,1,191,1,128,1,64,83,0,2,64,1,128,2,191,2,128,3,191,30,255,1,191,1,128,1,191,1,128,1,64,83,0,1,64,2,128,1,191,2,128,2,191,32,255,1,191,1,128,1,191,1,128,1,64,83,0,1,64,1,128,2,191,1,128,2,191,33,255,1,191,1,128,1,191,1,128,1,64,83,0,1,64,1,128,1,191,2,128,1,191,34,255,1,191,1,128,1,191,1,128,1,64,82,0,2,64,1,128,1,191,1,128,2,191,34,255,1,191,1,128,1,191,1,128,1,64,82,0,1,64,2,128,1,191,1,128,1,191,34,255,2,191,1,128,1,191,1,128,1,64,82,0,1,64,1,128,2,191,1,128,1,191,34,255,1,191,2,128,1,191,1,128,1,64,81,0,2,64,1,128,1,191,2,128,1,191,34,255,1,191,1,128,2,191,1,128,1,64,78,0,4,64,2,128,1,191,1,128,2,191,34,255,1,191,1,128,1,191,2,128,1,64,75,0,4,64,4,128,2,191,1,128,1,191,35,255,1,191,1,128,1,191,1,128,2,64,74,0,2,64,4,128,4,191,2,128,1,191,35,255,1,191,1,128,1,191,1,128,1,64,74,0,2,64,2,128,4,191,4,128,2,191,34,255,2,191,1,128,1,191,1,128,1,64,73,0,2,64,2,128,2,191,4,128,4,191,35,255,1,191,2,128,1,191,1,128,1,64,72,0,2,64,2,128,2,191,2,128,4,191,37,255,2,191,1,128,2,191,1,128,1,64,72,0,1,64,2,128,2,191,2,128,2,191,39,255,2,191,2,128,1,191,2,128,1,64,71,0,2,64,1,128,2,191,2,128,2,191,39,255,2,191,2,128,2,191,1,128,2,64,70,0,2,64,2,128,1,191,2,128,2,191,40,255,1,191,2,128,2,191,2,128,1,64,71,0,1,64,2,128,2,191,1,128,2,191,41,255,1,191,1,128,2,191,2,128,2,64,71,0,1,64,1,128,2,191,2,128,1,191,41,255,2,191,1,128,1,191,2,128,2,64,72,0,2,128,1,191,2,128,2,191,41,255,1,191,2,128,1,191,1,128,2,64,73,0,1,128,2,191,1,128,2,191,41,255,2,191,1,128,2,191,1,128,1,64,74,0,1,128,1,191,2,128,1,191,41,255,2,191,2,128,1,191,2,128,1,64,74,0,2,191,1,128,2,191,38,255,4,191,2,128,2,191,1,128,2,64,74,0,1,191,2,128,1,191,38,255,2,191,4,128,2,191,2,128,1,64,75,0,1,191,1,128,2,191,39,255,1,191,1,128,4,191,2,128,2,64,75,0,2,128,1,191,40,255,1,191,1,128,1,191,4,128,2,64,76,0,1,128,2,191,40,255,1,191,1,128,3,191,3,128,4,64,73,0,1,128,1,191,45,255,3,191,4,128,2,64,72,0,1,128,1,191,47,255,4,191,2,128,4,64,69,0,1,128,1,191,50,255,2,191,4,128,3,64,67,0,2,191,51,255,4,191,3,128,3,64,65,0,1,191,55,255,3,191,3,128,2,64,64,0,1,191,57,255,3,191,2,128,2,64,63,0,1,191,59,255,2,191,3,128,63,0,1,191,60,255,3,191,64,0,1,191,62,255,1,191,64,0,1,191,62,255,2,191,63,0,1,191,63,255,2,191,62,0,1,191,64,255,2,191,61,0,1,191,65,255,1,191,61,0,1,191,65,255,2,191,60,0,1,191,66,255,1,191,2,128,58,0,1,191,66,255,2,191,59,0,1,191,67,255,1,191,1,128,58,0,2,191,66,255,1,191,2,128,57,0,1,128,1,191,66,255,2,191,1,128,1,64,56,0,1,128,1,191,67,255,1,191,1,128,1,64,56,0,1,128,2,191,66,255,1,191,1,128,1,64,56,0,2,128,1,191,66,255,1,191,1,128,1,64,56,0,1,191,1,128,1,191,29,255,1,191,36,255,1,191,1,128,1,64,56,0,1,191,1,128,2,191,27,255,2,191,1,128,35,255,1,191,1,128,1,64,56,0,1,191,2,128,1,191,27,255,1,191,2,128,1,191,34,255,1,191,1,128,1,64,56,0,2,191,1,128,2,191,26,255,1,191,1,128,3,191,32,255,2,191,1,128,1,64,56,0,1,128,1,191,2,128,2,191,25,255,1,191,1,128,1,191,1,128,3,191,30,255,1,191,2,128,1,64,56,0,1,128,2,191,2,128,2,191,24,255,1,191,1,128,1,191,3,128,5,191,26,255,1,191,1,128,2,64,56,0,2,128,2,191,2,128,2,191,23,255,1,191,1,128,1,191,1,128,1,64,5,128,2,191,24,255,2,191,1,128,1,64,57,0,1,64,2,128,2,191,2,128,5,191,1,255,1,191,17,255,1,191,1,128,1,191,1,128,5,64,2,128,2,191,22,255,2,191,2,128,1,64,57,0,2,64,2,128,2,191,5,128,3,191,16,255,2,191,1,128,1,191,1,128,1,64,3,0,2,64,2,128,2,191,20,255,2,191,2,128,2,64,58,0,2,64,2,128,5,191,3,128,2,191,15,255,1,191,2,128,1,191,1,128,1,64,4,0,2,64,2,128,2,191,17,255,3,191,2,128,2,64,60,0,2,64,5,128,3,191,2,128,2,191,13,255,2,191,1,128,2,191,1,128,1,64,5,0,2,64,2,128,2,191,15,255,2,191,3,128,2,64,59,0]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48},"nazgraku":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.421875,"y":0.42592592592592593},"weightMap":{"width":128,"height":54,"encoding":"rle-u9","unsetValue":256,"data":[34,256,33,255,94,256,35,255,92,256,36,255,91,256,37,255,90,256,39,255,88,256,40,255,87,256,41,255,87,256,41,255,86,256,42,255,86,256,42,255,85,256,43,255,85,256,42,255,86,256,42,255,86,256,42,255,86,256,41,255,86,256,42,255,86,256,41,255,87,256,40,255,88,256,39,255,88,256,39,255,89,256,39,255,89,256,38,255,90,256,36,255,92,256,35,255,93,256,34,255,94,256,33,255,95,256,32,255,97,256,30,255,98,256,30,255,98,256,29,255,100,256,27,255,102,256,25,255,103,256,24,255,105,256,22,255,107,256,20,255,110,256,17,255,113,256,13,255,117,256,8,255,2133,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48,"compressibilityMap":{"width":128,"height":54,"encoding":"rle-u9","unsetValue":256,"data":[1476,256,10,0,109,256,22,0,103,256,27,0,100,256,30,0,96,256,33,0,94,256,35,0,92,256,3,0,4,256,30,0,90,256,2,0,5,256,32,0,89,256,1,0,5,256,34,0,93,256,35,0,93,256,36,0,91,256,37,0,91,256,38,0,89,256,39,0,89,256,40,0,88,256,40,0,88,256,40,0,87,256,41,0,87,256,41,0,87,256,42,0,78,256,1,0,7,256,42,0,86,256,42,0,86,256,42,0,86,256,41,0,66,256,3,0,18,256,41,0,65,256,8,0,15,256,40,0,63,256,12,0,13,256,40,0,62,256,13,0,13,256,39,0,62,256,15,0,13,256,38,0,61,256,16,0,13,256,38,0,61,256,16,0,14,256,36,0,61,256,17,0,14,256,36,0,61,256,17,0,14,256,35,0,61,256,19,0,11,256,36,0,62,256,20,0,7,256,38,0,63,256,64,0,64,256,63,0,65,256,62,0,66,256,61,0,67,256,59,0,69,256,56,0,72,256,31,0,3,256,9,0,5,256,4,0,76,256,31,0,74,256]},"stretchabilityMap":{"width":128,"height":54,"encoding":"rle-u9","unsetValue":256,"data":[4002,256,2,0,123,256,5,0,122,256,7,0,120,256,9,0,118,256,12,0,115,256,14,0,113,256,17,0,110,256,21,0,107,256,21,0,107,256,22,0,105,256,24,0,104,256,24,0,104,256,25,0,103,256,26,0,102,256,27,0,101,256,29,0,99,256,30,0,98,256,31,0,97,256,31,0,97,256,30,0,99,256,29,0,99,256,28,0,101,256,27,0,75,256]}},"nelk":{"enabled":true,"coordinateSpace":"sprite-normalized-top-left","pivot":{"x":0.3137449623414376,"y":0.4315545387068126},"weightMap":{"width":128,"height":84,"encoding":"rle-u9","unsetValue":256,"data":[160,256,1,255,126,256,2,255,125,256,3,255,124,256,4,255,124,256,5,255,116,256,13,255,113,256,16,255,110,256,20,255,107,256,20,255,10,256,2,69,95,256,20,255,12,256,2,69,94,256,19,255,109,256,19,255,108,256,20,255,108,256,20,255,107,256,21,255,107,256,20,255,1,252,1,254,105,256,21,255,2,254,105,256,20,255,4,254,104,256,20,255,5,254,103,256,20,255,7,254,101,256,20,255,8,254,100,256,20,255,8,254,100,256,21,255,7,254,100,256,21,255,1,252,6,254,100,256,22,255,2,253,1,251,2,249,1,247,99,256,25,255,1,249,1,247,2,244,99,256,30,255,97,256,32,255,95,256,34,255,94,256,35,255,93,256,34,255,93,256,32,255,96,256,31,255,97,256,29,255,98,256,29,255,98,256,29,255,98,256,29,255,99,256,29,255,99,256,28,255,99,256,29,255,99,256,28,255,99,256,28,255,100,256,27,255,101,256,27,255,101,256,27,255,102,256,27,255,101,256,27,255,101,256,28,255,101,256,27,255,101,256,27,255,102,256,26,255,102,256,25,255,103,256,25,255,103,256,24,255,104,256,23,255,105,256,11,255,1,256,11,255,105,256,11,255,2,256,9,255,106,256,11,255,2,256,9,255,106,256,11,255,1,256,11,255,105,256,10,255,2,256,11,255,106,256,9,255,1,256,13,255,105,256,9,255,1,256,13,255,107,256,6,255,2,256,13,255,115,256,13,255,115,256,12,255,116,256,13,255,115,256,13,255,115,256,12,255,116,256,12,255,117,256,11,255,117,256,10,255,120,256,7,255,123,256,2,255,1383,256]},"minDeg":-30,"maxDeg":30,"restDeg":0,"turnSpeedDeg":120,"meshResolution":48,"compressibilityMap":{"width":128,"height":84,"encoding":"rle-u9","unsetValue":256,"data":[4289,256,1,0,99,256,1,136,3,0,24,256,1,0,98,256,1,136,6,0,22,256,1,0,97,256,1,136,8,0,117,256,1,186,1,136,10,0,116,256,1,136,1,99,10,0,115,256,1,186,1,53,12,0,112,256,1,186,1,53,1,39,1,20,12,0,8,256,2,0,101,256,1,136,1,53,1,28,1,20,13,0,8,256,1,0,101,256,1,219,1,108,1,39,1,15,15,0,6,256,1,0,102,256,1,183,1,140,1,20,16,0,104,256,2,245,1,237,1,221,1,210,1,191,1,163,1,125,16,0,2,256,2,0,99,256,2,250,3,242,1,213,1,186,1,183,1,156,19,0,99,256,2,250,2,246,1,237,1,232,1,229,1,203,2,183,1,1,16,0,101,256,2,251,1,246,1,242,1,238,1,231,1,229,2,202,1,183,1,1,16,0,1,256,2,0,4,256,2,0,91,256,2,252,1,248,1,246,1,240,2,237,1,229,1,216,1,202,1,183,2,1,23,0,92,256,2,252,2,248,1,242,2,237,1,229,1,227,1,202,1,183,2,1,24,0,91,256,1,252,1,250,1,248,2,246,1,242,1,236,1,227,1,216,1,202,1,156,2,1,24,0,91,256,1,251,1,250,1,248,2,246,1,245,1,235,1,227,1,202,1,156,1,120,2,1,24,0,92,256,1,246,1,248,2,246,1,245,1,235,1,216,2,156,1,70,1,1,25,0,92,256,2,242,1,237,1,236,1,235,1,202,1,156,2,120,2,1,24,0,92,256,1,245,1,242,1,232,1,231,1,236,1,235,3,120,1,37,1,1,25,0,91,256,1,229,1,245,1,237,1,224,2,229,1,183,1,120,2,70,1,1,25,0,92,256,1,229,1,208,1,202,1,194,1,191,1,163,1,124,2,70,2,1,25,0,93,256,1,191,1,148,1,140,1,134,1,83,1,6,3,1,26,0,93,256,1,172,1,148,1,140,1,97,1,89,1,11,3,1,27,0,91,256,1,168,1,141,2,97,1,39,1,28,1,20,1,2,3,1,26,0,92,256,1,141,3,39,1,20,1,15,1,3,3,1,25,0,93,256,1,99,1,53,1,39,1,28,1,20,1,11,1,4,4,1,24,0,93,256,1,136,1,72,1,53,1,28,1,20,1,15,1,8,4,1,24,0,93,256,1,186,1,136,1,53,1,39,1,20,1,15,1,8,4,1,24,0,94,256,1,186,1,72,2,39,1,28,1,15,1,4,3,1,24,0,95,256,1,136,1,72,2,39,1,15,1,11,1,2,1,1,24,0,96,256,1,136,2,99,1,72,1,53,1,20,1,15,1,3,1,1,23,0,96,256,3,136,2,99,1,72,1,53,1,20,1,6,22,0,97,256,1,186,2,136,1,99,3,72,1,53,22,0,98,256,2,186,1,136,1,99,4,72,22,0,98,256,3,186,1,136,4,72,21,0,99,256,4,186,1,99,2,72,22,0,100,256,4,186,1,99,10,0,1,256,12,0,100,256,2,186,12,0,3,256,13,0,100,256,11,0,6,256,12,0,106,256,2,0,8,256,13,0,99,256,3,0,14,256,12,0,100,256,3,0,13,256,13,0,100,256,1,0,14,256,13,0,115,256,13,0,115,256,13,0,115,256,12,0,117,256,11,0,118,256,9,0,74,256]},"stretchabilityMap":{"width":128,"height":84,"encoding":"rle-u9","unsetValue":256,"data":[3753,256,1,53,1,72,1,99,124,256,1,28,3,39,1,53,122,256,3,11,2,15,4,0,117,256,1,20,1,6,1,8,1,6,8,0,116,256,1,6,1,2,1,8,9,0,104,256,1,186,11,256,1,1,12,0,103,256,1,186,1,136,9,256,1,1,14,0,102,256,2,186,1,136,7,256,1,1,16,0,101,256,2,186,2,136,2,99,1,39,1,8,1,6,1,1,18,0,100,256,4,186,1,99,1,72,1,39,1,8,1,4,1,1,18,0,100,256,4,186,2,99,1,28,1,6,1,3,20,0,99,256,3,186,1,136,2,99,1,20,1,8,1,4,21,0,99,256,2,186,2,136,1,28,1,20,1,8,21,0,101,256,1,186,1,136,1,72,1,20,1,8,22,0,101,256,1,186,1,136,1,53,1,20,21,0,101,256,1,186,1,99,1,72,1,53,1,20,1,6,18,0,102,256,1,136,1,99,1,53,2,39,1,20,1,4,1,1,18,0,101,256,2,136,1,53,1,39,1,20,1,11,4,1,17,0,100,256,2,136,1,53,1,28,2,8,1,2,4,1,16,0,100,256,3,136,1,15,1,4,1,3,7,1,14,0,101,256,2,136,1,11,2,3,8,1,13,0,96,256,1,0,5,256,1,136,1,39,1,6,1,2,9,1,13,0,96,256,1,0,5,256,1,53,1,15,1,3,10,1,13,0,95,256,2,0,5,256,1,28,1,11,1,2,9,1,15,0,94,256,2,0,4,256,1,136,1,28,1,6,10,1,15,0,94,256,2,0,4,256,1,72,1,15,1,4,9,1,16,0,94,256,3,0,3,256,1,39,1,15,1,8,8,1,16,0,95,256,3,0,2,256,1,0,1,28,1,8,1,6,1,3,7,1,16,0,96,256,3,0,1,256,2,0,1,15,1,6,1,3,6,1,16,0,97,256,6,0,1,15,1,8,7,1,16,0,98,256,4,0,1,20,1,15,1,6,8,1,16,0,98,256,3,0,1,39,1,15,1,8,8,1,16,0,99,256,1,0,1,99,1,28,1,15,1,11,9,1,15,0,99,256,1,0,1,136,1,39,1,20,1,11,1,4,8,1,15,0,99,256,1,0,2,136,1,20,1,15,1,11,1,3,2,2,5,1,14,0,99,256,2,0,2,136,1,72,1,20,1,15,1,8,1,4,1,3,5,1,14,0,99,256,2,0,3,136,3,39,1,15,2,6,1,2,1,1,1,2,14,0,100,256,2,0,3,136,1,99,1,72,1,53,1,39,1,15,1,11,1,4,1,3,1,6,1,4,12,0,101,256,2,0,4,136,1,99,2,72,1,28,1,20,1,11,1,8,2,11,11,0,103,256,1,0,4,136,3,99,1,28,2,20,2,28,12,0,103,256,1,0,5,136,2,99,1,39,1,28,2,39,1,20,12,0,104,256,1,0,1,186,5,136,1,53,1,39,2,53,1,72,12,0,105,256,6,186,1,136,1,99,2,72,13,0,111,256,1,186,2,99,15,0,111,256,18,0,111,256,18,0,111,256,17,0,111,256,17,0,111,256,17,0,111,256,18,0,110,256,18,0,110,256,19,0,110,256,18,0,111,256,17,0,111,256,17,0,81,256]}}}); // Runtime head-rig data, including Nelk's committed paint maps.
  const HEAD_RIG_VARIANT_ALIASES = Object.freeze({
    'gar-wolf-alpha': 'gar-wolf',
    'gar-wolf-den-mother': 'gar-wolf',
    'grehlr-den-mother': 'grehlr',
    'drenkirra-den-mother': 'drenkirra',
    'dabinggi-hound-den-mother': 'dabinggi-hound',
    'moot-herd-mother': 'moot', // Standalone head-rig previews resolve the mother to Moot even before genetics initializes.
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
