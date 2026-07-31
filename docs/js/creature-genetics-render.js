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
    grehlr: {
      prefix: 'grehlr',
      base: { idle: 'assets/creaturesprites/grehlr_idle.png', run1: 'assets/creaturesprites/grehlr_run1.png', run2: 'assets/creaturesprites/grehlr_run2.png' },
      patterns: ['mitts', 'spectacles'],
    },
    drenkirra: {
      prefix: 'drnk',
      base: { idle: 'assets/creaturesprites/drenkirra_idle.png', run1: 'assets/creaturesprites/drenkirra_run1.png', run2: 'assets/creaturesprites/drenkirra_run2.png' },
      patterns: ['bodystripes', 'spectacles'],
    },
    // Uumkao'ii has one static sprite (no run1/run2 art — see CREATURE_DB's
    // sprites.run reusing the idle frame), and its two regions are always
    // both present (see makeDefaultGenotype's uumkaoii branch: fur/plates
    // are permanent copies:2 layers with no `enabled` roll at all, unlike
    // gar-wolf/dabinggi-hound's optional pattern layers) — composeFrame's
    // enabled-gate below treats a layer with no `enabled` field as always-on
    // for exactly this reason. singleFrame tells patternUrl to skip the
    // _idle/_run1/_run2 suffix these two overlay files don't have.
    uumkaoii: {
      prefix: 'uum',
      singleFrame: true,
      base: {
        idle: "assets/creaturesprites/uumkao'ii.png",
        run1: "assets/creaturesprites/uumkao'ii.png",
        run2: "assets/creaturesprites/uumkao'ii.png",
      },
      patterns: ['fur', 'plates'],
    },
  };

  function patternUrl(kind, patternId, frame) {
    const spec = SPECIES[kind];
    if (!spec) return null;
    if (spec.singleFrame) return `assets/creaturesprites/patterns/${spec.prefix}_${patternId}.png`;
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
      img.onerror = () => reject(new Error('Failed to load ' + url));
      img.src = url;
    });
    _imageCache.set(url, p);
    return p;
  }

  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }
  function relativeLuminance(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

  // Same config surface (and same defaults) as portrait-utils.js's
  // getPortraitTintingConfig — reads window.SCRATCHBONES_CONFIG.game.
  // portrait.tinting so tuning that dial once affects NPCs and creatures
  // alike, instead of duplicating a second set of hand-picked constants.
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

  // "Hex shade-fill": the target color's own RGB channels are scaled by a
  // per-pixel shade factor derived from that pixel's ORIGINAL relative
  // luminance (normalized against neutralLuminance, gamma-curved, clamped
  // to [shadowFloor, highlightBoost]) — a multiplicative tint, not an HSV
  // hue/saturation replace. Near-black outline ink (luminance at/below
  // outlineThreshold) is left untouched entirely, same as the NPC
  // pipeline's automatic ink protection. This reads correctly on the
  // creature art's fairly dark cel-shaded fur (unlike a raw HSV value
  // replace, which measured ~0.25 average value there and crushed every
  // target hue toward the same dark, muddy tone).
  function recolorPixels(px, targetRgb, predicate) {
    const cfg = shadeFillConfig();
    const neutral = Math.max(0.0001, cfg.neutralLuminance);
    const [tr, tg, tb] = targetRgb;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      if (predicate && !predicate(i)) continue;
      const lum = relativeLuminance(px[i], px[i + 1], px[i + 2]);
      if (cfg.preserveNearBlackOutlines && lum <= cfg.outlineThreshold) continue;
      const normalized = Math.pow(Math.max(0, lum) / neutral, cfg.gamma);
      const shade = Math.max(cfg.shadowFloor, Math.min(cfg.highlightBoost, normalized));
      px[i] = clampByte(tr * shade);
      px[i + 1] = clampByte(tg * shade);
      px[i + 2] = clampByte(tb * shade);
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
      recolorPixels(px, hexToRgb(color), (i) => mask.data[i / 4]);
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
      recolorPixels(px, hexToRgb(color), null);
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
    const t0 = performance.now();
    const spec = SPECIES[kind];
    if (!spec) {
      window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): no SPECIES config for "${kind}" — returning null (creature falls back to its plain sprite)`, 'wildlife');
      return null;
    }
    const baseUrl = spec.base[frame] || spec.base.idle;
    const masks = await loadBaseMasks();
    const tMasks = performance.now();
    const mask = masks?.[kind]?.[frame];
    const baseColor = genotype?.base?.color;
    // Only worth a warning if there was actually a base color to apply —
    // uumkaoii's genotype has no `base` layer at all (its two regions are
    // the fur/plates overlays below, not a recolored base), so baseColor is
    // always undefined for it and this would otherwise fire every call for
    // no reason.
    if (baseColor && !mask) window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): no base mask found — base fur will render unrecolored`, 'wildlife');
    const baseSource = (baseColor && mask) ? await recoloredBase(baseUrl, baseColor, mask) : await loadImage(baseUrl);
    const tBase = performance.now();
    const bw = baseSource.naturalWidth || baseSource.width, bh = baseSource.naturalHeight || baseSource.height;
    const c = makeCanvas(bw, bh), ctx = c.getContext('2d');
    ctx.drawImage(baseSource, 0, 0);
    const drawnPatterns = [];
    for (const patternId of spec.patterns) {
      const layer = genotype?.[patternId];
      // A layer with no `enabled` field at all (uumkaoii's permanent
      // fur/plates regions — see makeDefaultGenotype) is always on; only an
      // EXPLICIT `enabled: false` (gar-wolf/dabinggi-hound's optional
      // pattern roll) turns a layer off.
      if (layer?.enabled === false || !(layer?.copies > 0) || !layer?.color) continue;
      const url = patternUrl(kind, patternId, frame);
      try {
        const recolored = await recoloredPattern(url, layer.color);
        ctx.drawImage(recolored, 0, 0, c.width, c.height);
        drawnPatterns.push(patternId);
      } catch (e) {
        window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): pattern "${patternId}" failed to load/recolor (${url}) — skipped: ${e.message}`, 'warn');
      }
    }
    const tEnd = performance.now();
    // Broken down so a slow compose (the "ran around plain for ages" symptom)
    // shows WHERE the time went — masksMs covers the one-time mask JSON
    // fetch+decode (only nonzero the very first call all session), baseMs
    // covers the base sprite's network load + recolor pixel pass, patternMs
    // covers every enabled pattern layer's load+recolor combined.
    window.__farmLog?.(`[genotype-render] composeFrame(${kind},${frame}): base=${baseColor || '(none)'} patterns=[${drawnPatterns.join(',') || 'none'}] timing: masksMs=${(tMasks - t0).toFixed(0)} baseMs=${(tBase - tMasks).toFixed(0)} patternMs=${(tEnd - tBase).toFixed(0)} totalMs=${(tEnd - t0).toFixed(0)}`, 'wildlife');
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
      for (const patternId of spec.patterns) {
        urls.push(patternUrl(kind, patternId, 'idle'), patternUrl(kind, patternId, 'run1'), patternUrl(kind, patternId, 'run2'));
      }
    }
    await Promise.all(urls.filter(Boolean).map(u => loadImage(u).catch(() => null)));
    window.__farmLog?.(`[genotype-render] prewarm(${targets.join(',')}): masks + ${urls.length} sprite URLs cached in ${(performance.now() - t0).toFixed(0)}ms`, 'wildlife');
  }

  function genotypeSignature(kind, genotype) {
    const spec = SPECIES[kind];
    if (!spec) return 'none';
    const parts = [genotype?.base?.color || ''];
    for (const id of spec.patterns) {
      const l = genotype?.[id];
      parts.push((l?.enabled !== false && l?.copies > 0 && l?.color) ? `${id}:${l.color}` : '');
    }
    return parts.join('|');
  }

  window.CreatureGeneticsRender = { composeFrame, genotypeSignature, prewarm, SPECIES, recolorPixels, hexToRgb };
})();
