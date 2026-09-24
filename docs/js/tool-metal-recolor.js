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
  const OVERPASS_CLEARANCE_MIN = 3; // Legacy/current knot-gap multiplier, and the authored minimum.
  const OVERPASS_CLEARANCE_MAX = 12; // Player/dev-authored maximum: four times the previous fixed 3× gap.

  function hexToRgb(hex) {
    const clean = String(hex).replace('#', '').trim();
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const value = Number.parseInt(full || '000000', 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function colorFillApi() {
    const api = window.ColorFill;
    if (!api) throw new Error('ColorFill must load before tool-metal-recolor.js');
    return api;
  }

  function rgbToHsv(r, g, b) { return colorFillApi().rgbToHsv(r, g, b); }
  function hsvToRgb(h, s, v) { return colorFillApi().hsvToRgb(h, s, v); }
  function hueDistance(a, b) { return colorFillApi().hueDistance(a, b); }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function overpassClearanceMultiplier(pattern) {
    return Math.max(OVERPASS_CLEARANCE_MIN, Math.min(OVERPASS_CLEARANCE_MAX, Number(pattern?.overpassClearanceMultiplier) || OVERPASS_CLEARANCE_MIN)); // Shared pattern-2 setting; old patterns preserve the prior fixed 3× behavior.
  }

  function normalizeAuthoredPatterns(opts = {}) {
    const raw = Array.isArray(opts.authoredPatterns) ? opts.authoredPatterns : (opts.authoredPattern ? [opts.authoredPattern] : []); // Used by verdigris rendering so old single-pattern callers and future unlocked two-slot callers share one path.
    return raw.filter(pattern => !!pattern && typeof pattern === 'object').slice(0, 2);
  }

  function patternMotifPromise(pattern, opts = {}) {
    if (pattern?.motifDataUrl) return loadImage(pattern.motifDataUrl, opts);
    if (pattern?.motifUrl) return loadImage(pattern.motifUrl, opts);
    if (pattern?.customMotifId) return Promise.resolve(window.MotifStore?.loadMotif?.(pattern.customMotifId)).then(url => url ? loadImage(url, opts) : null);
    return Promise.resolve(null);
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

  // ── Frame-based repeat geometry ─────────────────────────────────────────
  // Mirrors docs/js/clothing-weaving-system.js's own FRAME_SHAPES/
  // legacyFrameFields/findOpaqueBounds — see that file's comments for the
  // full rationale. Duplicated locally per this codebase's convention of
  // not cross-importing between independent IIFE modules.
  function findOpaqueBounds(mask, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (!count) return null;
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area: count };
  }

  // Mirrors clothing-weaving-system.js's own FRAME_SHAPES — see that file's
  // comments for the full rationale (polygon clipping, why pairing two
  // clipped copies tiles seamlessly for any shape, why diamond needs no
  // pairing).
  const FRAME_SHAPES = Object.freeze({
    // Every shape (including these two) clips to its own rectangle — the
    // frame is a hard crop boundary, not just a tiling-pitch guide — see
    // buildAuthoredClearedMask's drawCell polygon clip below.
    square: { label: 'Square', paired: false, basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }), polygon: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] },
    brick: { label: 'Brick', paired: false, basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: w / 2, y: h } }), polygon: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] },
    diamond: {
      label: 'Diamond', paired: false,
      basis: (w, h) => ({ u: { x: w / 2, y: h / 2 }, v: { x: w / 2, y: -h / 2 } }),
      polygon: (w, h) => [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }],
    },
    triangle: {
      label: 'Triangle', paired: true,
      basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }),
      polygon: (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }],
    },
    trapezoid: {
      label: 'Trapezoid', paired: true,
      basis: (w, h) => ({ u: { x: w, y: 0 }, v: { x: 0, y: h } }),
      polygon: (w, h) => { const cutFrac = 0.25, cut = h * cutFrac; return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h - cut }, { x: 0, y: cut }]; },
    },
  });
  function frameShapeFor(id) {
    return FRAME_SHAPES[id] || FRAME_SHAPES.square;
  }

  // Patterns saved before the frame tool existed have no frameShape — just
  // the old repeatMode/patternScale/patternRotationDeg/translateX/Y fields.
  // Remapped onto the equivalent new frame fields (repeatMode 'grid' ->
  // 'square', anything else -> 'triangle', same overall scale/rotation/
  // position) rather than keeping the old tight-fit-hull algorithm alive
  // just for these — see clothing-weaving-system.js's legacyFrameFields.
  function legacyFrameFields(patternDef) {
    if (patternDef?.frameShape) return patternDef;
    return {
      ...patternDef,
      frameShape: patternDef?.repeatMode === 'grid' ? 'square' : 'triangle',
      frameScale: patternDef?.patternScale,
      frameRotationDeg: patternDef?.patternRotationDeg,
      frameX: patternDef?.translateX,
      frameY: patternDef?.translateY,
    };
  }

  // Renders a caller-authored removal pattern (see pattern-authoring.js) into
  // a same-size binary mask: 1 where the pattern's motif paints, i.e. where
  // verdigris should be stripped back to bare metal. Purely geometric — it
  // knows nothing about metal/verdigris, just stamps a black motif image
  // (tiled via the triangle-tessellation lattice above, when enabled)
  // across a transparent raster per the placement fields the editor wrote.
  function buildMotifClusterSeparatorMask(mask, width, height) {
    const labels = new Int32Array(mask.length).fill(-1);
    const stack = [];
    let clusterCount = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start] !== -1) continue;
      const label = clusterCount++;
      labels[start] = label;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop();
        const x = p % width, y = (p / width) | 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const np = ny * width + nx;
            if (mask[np] && labels[np] === -1) { labels[np] = label; stack.push(np); }
          }
        }
      }
    }
    if (clusterCount < 2) return null;

    const owners = new Int32Array(mask.length).fill(-1);
    const queue = new Int32Array(mask.length);
    let head = 0, tail = 0;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      owners[p] = labels[p];
      queue[tail++] = p;
    }
    while (head < tail) {
      const p = queue[head++];
      const x = p % width, y = (p / width) | 0, owner = owners[p];
      const neighbors = [p - 1, p + 1, p - width, p + width];
      const valid = [x > 0, x < width - 1, y > 0, y < height - 1];
      for (let n = 0; n < 4; n++) {
        if (!valid[n]) continue;
        const np = neighbors[n];
        if (owners[np] !== -1) continue;
        owners[np] = owner;
        queue[tail++] = np;
      }
    }

    const separator = new Uint8Array(mask.length);
    for (let p = 0; p < mask.length; p++) {
      if (mask[p]) continue;
      const x = p % width, y = (p / width) | 0, owner = owners[p];
      for (let oy = -1; oy <= 1 && !separator[p]; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const other = owners[ny * width + nx];
          if (other !== -1 && other !== owner) { separator[p] = 1; break; }
        }
      }
    }
    return separator;
  }

  function maskCanvas(mask, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (!mask[p]) continue;
      image.data[i] = 255; image.data[i + 1] = 255; image.data[i + 2] = 255; image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  function buildAuthoredClearedMask(width, height, rawPatternDef, motifImg) {
    const patternDef = legacyFrameFields(rawPatternDef);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // motifScale zooms the motif ink within its frame's own fixed crop;
    // frameScale/frameRotationDeg/frameX/frameY define that crop window
    // itself (position/rotation/size) over the source ink; meshScale/
    // meshRotationDeg separately zoom/rotate the WHOLE resulting mesh of
    // tiles, after cropping — three independent controls, applied
    // separately further down. `patternDef.scale` is a fallback for
    // patterns saved before motifScale existed as its own field.
    const motifScale = Math.max(0.05, Number(patternDef.motifScale ?? patternDef.scale) || 1);
    const frameScale = Math.max(0.05, Number(patternDef.frameScale) || 1);
    const meshScale = Math.max(0.05, Number(patternDef.meshScale) || 1); // Verdigris intentionally keeps its legacy physical mesh scale; weaving alone applies the normalized 1.00 -> old 0.25 mapping.
    const motifRad = ((Number(patternDef.motifRotationDeg) || 0) * Math.PI) / 180;
    const frameRad = ((Number(patternDef.frameRotationDeg) || 0) * Math.PI) / 180;
    const meshRad = ((Number(patternDef.meshRotationDeg) || 0) * Math.PI) / 180;
    const shape = frameShapeFor(patternDef.frameShape);
    const naturalW = motifImg.naturalWidth || motifImg.width || 1;
    const naturalH = motifImg.naturalHeight || motifImg.height || 1;

    // The sole source everything crops from: the authored ink, rotated by
    // motifRotationDeg, at its natural 1x size — motifScale is applied
    // later, per cell, as part of the frame's own crop sampling below, so
    // the frame's own fixed size never has to know about it.
    const srcSize = Math.max(2, Math.ceil(Math.hypot(naturalW, naturalH)) + 2);
    const src = document.createElement('canvas');
    src.width = srcSize;
    src.height = srcSize;
    const srcCtx = src.getContext('2d');
    srcCtx.imageSmoothingEnabled = false;
    srcCtx.translate(srcSize / 2, srcSize / 2);
    srcCtx.rotate(motifRad);
    srcCtx.drawImage(motifImg, -naturalW / 2, -naturalH / 2, naturalW, naturalH);
    const srcData = srcCtx.getImageData(0, 0, srcSize, srcSize).data;
    const srcMask = new Uint8Array(srcSize * srcSize);
    for (let p = 0, i = 0; i < srcData.length; i += 4, p++) if (srcData[i + 3] > 16) srcMask[p] = 1;
    const bbox = findOpaqueBounds(srcMask, srcSize, srcSize); // Keep authored frame geometry stable while only the source ink's contour changes.
    const sourceClusterSeparatorMask = patternDef.invert ? null : buildMotifClusterSeparatorMask(srcMask, srcSize, srcSize);
    const sourceAllowedMask = new Uint8Array(srcMask.length); sourceAllowedMask.fill(1); // Allows motif-space thickening before the fixed frame clip is applied.
    const adjustedSrcMask = adjustMaskThickness(srcMask, sourceAllowedMask, srcSize, srcSize, patternDef.motifThinPx, sourceClusterSeparatorMask);
    const adjustedSrc = maskCanvas(adjustedSrcMask, srcSize, srcSize);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(meshRad);
    ctx.scale(meshScale, meshScale);

    if (bbox) {
      // The frame is a crop window laid over the source ink: frameX/frameY
      // offset it from the ink's own natural center, frameRotationDeg
      // tilts it, frameScale grows/shrinks it relative to the ink's own
      // tight bounds (frameScale<1 crops in, >1 adds space around the
      // ink) — "make it smaller than the drawn motif to crop, make it
      // larger to create space." Whatever falls inside becomes the single
      // repeating unit; the chosen shape then tessellates copies of
      // exactly that crop.
      const cellW = bbox.w * frameScale, cellH = bbox.h * frameScale;
      const winCenterX = bbox.x0 + bbox.w / 2 + (Number(patternDef.frameX) || 0);
      const winCenterY = bbox.y0 + bbox.h / 2 + (Number(patternDef.frameY) || 0);
      const polygon = shape.polygon(cellW, cellH);
      const midpoint = { x: cellW / 2, y: cellH / 2 };

      // Draws one cell at the CURRENT origin (the caller has already
      // translated to that cell's own top-left corner). The frame polygon
      // is clipped FIRST and remains active while motifScale zooms the
      // source ink inside it. Pixels transformed outside that polygon are
      // discarded, so motifScale changes what fits inside a fixed cell but
      // never enlarges the crop boundary or the lattice spacing.
      function drawCell() {
        ctx.save();
        ctx.beginPath();
        polygon.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.clip();
        ctx.translate(cellW / 2, cellH / 2);
        ctx.rotate(frameRad);
        ctx.scale(motifScale, motifScale);
        ctx.translate(-winCenterX, -winCenterY);
        ctx.drawImage(adjustedSrc, 0, 0);
        ctx.restore();
      }

      if (patternDef.tiling) {
        const { u: basisU, v: basisV } = shape.basis(cellW, cellH);

        function stampCell(ox, oy) {
          ctx.save();
          ctx.translate(ox, oy);
          drawCell();
          ctx.restore();
          if (!shape.paired) return;
          ctx.save();
          ctx.translate(ox + midpoint.x, oy + midpoint.y);
          ctx.rotate(Math.PI);
          ctx.translate(-midpoint.x, -midpoint.y);
          drawCell();
          ctx.restore();
        }

        // How far the lattice needs to extend (in basisU/basisV step
        // counts) to cover the whole canvas — inverting the (generally
        // skewed, non-axis-aligned) basis matrix rather than assuming a
        // square grid, since the frame's own rotation can point either
        // basis vector in any direction. Measured in the mesh's own
        // (pre-meshScale) units, since meshScale is applied once via
        // ctx.scale above instead of being multiplied into every offset by
        // hand — dividing the device-pixel canvas half-diagonal by
        // meshScale converts it into those same local units. Lattice
        // placement no longer depends on frameX/frameY at all — those only
        // steer what a cell's own crop samples now, never where cells sit.
        const reach = Math.hypot(width, height) / 2 / meshScale + Math.hypot(cellW, cellH);
        const det = basisU.x * basisV.y - basisU.y * basisV.x;
        let maxI = 8, maxJ = 8;
        if (Math.abs(det) > 1e-6) {
          const invA = basisV.y / det, invB = -basisV.x / det;
          const invC = -basisU.y / det, invD = basisU.x / det;
          maxI = 0; maxJ = 0;
          for (const [cx, cy] of [[reach, reach], [reach, -reach], [-reach, reach], [-reach, -reach]]) {
            maxI = Math.max(maxI, Math.abs(invA * cx + invB * cy));
            maxJ = Math.max(maxJ, Math.abs(invC * cx + invD * cy));
          }
          maxI = Math.min(300, Math.ceil(maxI) + 2);
          maxJ = Math.min(300, Math.ceil(maxJ) + 2);
        }
        for (let j = -maxJ; j <= maxJ; j++) {
          for (let i = -maxI; i <= maxI; i++) {
            const ox = i * basisU.x + j * basisV.x, oy = i * basisU.y + j * basisV.y;
            if (Math.hypot(ox, oy) <= reach) stampCell(ox, oy);
          }
        }
      } else {
        ctx.save();
        ctx.translate(-cellW / 2, -cellH / 2);
        drawCell();
        ctx.restore();
      }
    }
    ctx.restore();

    const pixels = ctx.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let p = 0, i = 0; i < pixels.length; i += 4, p++) {
      if (pixels[i + 3] > 16) mask[p] = 1;
    }
    return mask;
  }

  function buildOxidationOutlineMask(oxidationMask, metalMask, width, height, outlineWidth, centered = false) {
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

    const totalRadius = Math.max(1, (outlineWidth | 0) * 5);
    const inwardRadius = centered ? Math.floor(totalRadius / 2) : 0; // Authored patterns move half of the old outward-only border onto the filled side.
    const outwardRadius = centered ? totalRadius - inwardRadius : totalRadius; // Procedural verdigris keeps its legacy outward-only border.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!metalMask[p]) continue;
        const radius = oxidationMask[p] ? inwardRadius : outwardRadius;
        if (radius <= 0) continue;
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

  // Applies the signed "Motif thinning / thickening" contour offset to the
  // authored cleared-mask shape. Positive values erode inward; negative
  // values dilate outward but stay clipped to the valid metal surface.
  function adjustMaskThickness(mask, allowedMask, width, height, signedPx) {
    const amount = Math.round(Number(signedPx) || 0);
    if (!amount) return mask;

    const boundary = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!mask[p]) continue;
        let isEdge = false;
        for (let oy = -1; oy <= 1 && !isEdge; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) { isEdge = true; break; }
          }
        }
        if (isEdge) boundary[p] = 1;
      }
    }

    if (amount > 0) {
      const thinned = new Uint8Array(mask.length); // Used when the signed authoring slider is positive: removes exactly the requested nearest edge layers.
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = y * width + x;
          if (!mask[p]) continue;
          let nearBoundary = false;
          for (let oy = -amount; oy <= amount && !nearBoundary; oy++) {
            for (let ox = -amount; ox <= amount; ox++) {
              if (Math.hypot(ox, oy) >= amount - 0.01) continue;
              const nx = x + ox, ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              if (boundary[ny * width + nx]) { nearBoundary = true; break; }
            }
          }
          if (!nearBoundary) thinned[p] = 1;
        }
      }
      return thinned;
    }

    const radius = Math.abs(amount);
    const thickened = new Uint8Array(mask); // Used when the signed authoring slider is negative: grows into nearby valid surface pixels without crossing the garment/metal silhouette.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (mask[p] || !allowedMask[p]) continue;
        let nearBoundary = false;
        for (let oy = -radius; oy <= radius && !nearBoundary; oy++) {
          for (let ox = -radius; ox <= radius; ox++) {
            if (Math.hypot(ox, oy) > radius + 0.01) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (boundary[ny * width + nx]) { nearBoundary = true; break; }
          }
        }
        if (nearBoundary) thickened[p] = 1;
      }
    }
    return thickened;
  }

  // Pattern transforms move/scale the motif geometry only. Keep the authored
  // outline at the caller's raster-space width so changing motif/frame/mesh
  // scale never changes line weight. The legacy helper name remains exported
  // through __test for compatibility with existing diagnostics.
  function scaledOutlineWidthForPattern(defaultWidth, _rawPatternDef) {
    return Math.max(1, Math.round(Number(defaultWidth) || 0));
  }

  function recolorAndOxidize(imageData, opts) {
    const { data, width, height } = imageData;
    const src = new Uint8ClampedArray(data);
    const sourceHsv = rgbToHsv(...hexToRgb(opts.sourceHex || SOURCE_HEX));
    const targetRgb = hexToRgb(opts.targetHex);
    const hueTol = opts.hueToleranceDeg ?? DEFAULT_HUE_TOL_DEG;
    const satTol = opts.saturationTolerance ?? DEFAULT_SAT_TOL;
    const alphaMin = opts.alphaMin ?? DEFAULT_ALPHA_MIN;
    const saturationMode = opts.saturationMode || 'target';
    const metalMask = new Uint8Array(width * height);
    let matchedMetalPixels = 0;

    // Detection remains source-keyed, but actual recoloring is delegated to
    // ColorFill so tools do not maintain a private fill implementation.
    for (let i = 0; i < src.length; i += 4) {
      const alpha = src[i + 3];
      if (alpha < alphaMin) continue;
      const hsv = rgbToHsv(src[i], src[i + 1], src[i + 2]);
      const hueOk = hueDistance(hsv.h, sourceHsv.h) <= hueTol;
      const satOk = Math.abs(hsv.s - sourceHsv.s) <= satTol;
      if (!hueOk || !satOk) continue;
      metalMask[i >> 2] = 1;
      matchedMetalPixels++;
    }
    colorFillApi().hsvValueFillPixels(data, targetRgb, {
      sourceData: src,
      applyPredicate: i => !!metalMask[i >> 2],
      saturationMode,
      sourceReferenceSaturation: sourceHsv.s,
    });


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

    const authoredPatterns = normalizeAuthoredPatterns(opts); // Primary + optional overpass; player-facing smith UI still supplies only authoredPattern until its future unlock exists.
    const motifImages = Array.isArray(opts.motifImages) ? opts.motifImages : (opts.motifImage ? [opts.motifImage] : []);
    const authoredPattern = authoredPatterns[0] || null; // Legacy name retained for single-pattern behavior/debug wording.

    if (!opts.verdigrisHex || (!authoredPatterns.length && !clamp01(opts.oxidationAmount))) {
      debugLog(opts, 'oxidation skipped', {
        oxidationAmount: clamp01(opts.oxidationAmount),
        hasVerdigrisColor: !!opts.verdigrisHex,
        hasAuthoredPattern: authoredPatterns.length > 0,
        authoredPatternCount: authoredPatterns.length,
      });
      return imageData;
    }

    let oxidationMask;
    const activeAuthored = authoredPatterns.map((pattern, index) => ({ pattern, motif: motifImages[index] })).filter(entry => !!entry.motif).slice(0, 2);
    if (activeAuthored.length) {
      // Authored mode is the inverse of procedural growth: motif ink marks
      // where verdigris is stripped back to bare metal. Each slot first
      // resolves to that literal cleared-metal mask so single-pattern saves
      // preserve their exact old invert semantics.
      const clearedMasks = activeAuthored.map(({ pattern, motif }) => {
        const rawMask = buildAuthoredClearedMask(width, height, pattern, motif);
        const resolved = new Uint8Array(rawMask.length); // Used below so invert is applied independently per slot before the shared overpass rule.
        for (let p = 0; p < rawMask.length; p++) {
          const cleared = pattern.invert ? !rawMask[p] : !!rawMask[p];
          resolved[p] = metalMask[p] && cleared ? 1 : 0;
        }
        return resolved;
      });
      const combinedCleared = new Uint8Array(clearedMasks[0]);
      if (clearedMasks[1]) {
        const overpassMask = clearedMasks[1]; // Slot 2 is the visually-over strand.
        const overpassOutlineWidth = scaledOutlineWidthForPattern(Math.max(0, opts.outlineWidth | 0), activeAuthored[1].pattern);
        const clearanceMultiplier = overpassClearanceMultiplier(activeAuthored[1].pattern); // Same 3×..12× authored gap used by weaving/animal paint.
        const clearanceMask = buildOxidationOutlineMask(
          overpassMask,
          metalMask,
          width,
          height,
          overpassOutlineWidth * clearanceMultiplier, // Invisible clearance uses the exact same raster outline math at the authored 3×..12× multiple.
          true,
        );
        for (let p = 0; p < combinedCleared.length; p++) {
          if (clearanceMask[p] || overpassMask[p]) combinedCleared[p] = 0; // Punch the primary stripped-metal strand before black outline generation.
        }
        for (let p = 0; p < combinedCleared.length; p++) if (overpassMask[p]) combinedCleared[p] = 1;
      }
      oxidationMask = new Uint8Array(metalMask.length);
      for (let p = 0; p < metalMask.length; p++) oxidationMask[p] = metalMask[p] && !combinedCleared[p] ? 1 : 0;
      debugLog(opts, 'authored pattern mask applied', {
        patternCount: activeAuthored.length,
        clearedPixels: combinedCleared.reduce((a, v) => a + v, 0),
        overpassClearanceMultiplier: activeAuthored.length > 1 ? overpassClearanceMultiplier(activeAuthored[1].pattern) : null,
      });
    } else {
      oxidationMask = buildOxidationMask(metalMask, width, height, clamp01(opts.oxidationAmount), opts);
    }
    const outlineWidth = activeAuthored.length
      ? scaledOutlineWidthForPattern(Math.max(0, opts.outlineWidth | 0), activeAuthored[0].pattern)
      : Math.max(0, opts.outlineWidth | 0);
    const outlineMask = buildOxidationOutlineMask(
      oxidationMask,
      metalMask,
      width,
      height,
      outlineWidth,
      activeAuthored.length > 0, // Authored motif stacks use the same centered black border; procedural verdigris intentionally keeps its legacy outward-only border.
    );

    let oxidizedPixels = 0;
    for (let p = 0; p < oxidationMask.length; p++) if (oxidationMask[p]) oxidizedPixels++;
    colorFillApi().hsvValueFillPixels(data, hexToRgb(opts.verdigrisHex), {
      sourceData: src,
      applyPredicate: i => !!oxidationMask[i >> 2],
      saturationMode: 'target',
    });

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

  const MAX_CANVAS_CACHE_ENTRIES = 32; // Pattern-authoring live-editing settles one new cache key per slider tweak (translate/rotate/scale); without a cap this grows unbounded for the life of the tab.
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
    // A caller-authored removal pattern (see pattern-authoring.js) replaces
    // the procedural growth entirely — its full definition (motif image
    // included) has to be part of the cache key since it isn't reducible to
    // a single scalar the way oxidationAmount is.
    const authoredPatterns = normalizeAuthoredPatterns(opts); // Cache identity includes both optional slots while legacy callers still pass authoredPattern.
    const authoredPattern = authoredPatterns[0] || null;
    const authoredPatternKey = authoredPatterns.length ? JSON.stringify(authoredPatterns) : '';
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
      authoredPatternKey,
    ].join('|');

    debugLog(opts, 'recolor request', requestInfo);
    const cached = _canvasCache.get(cacheKey);
    if (cached) {
      debugLog(opts, 'canvas cache hit', { spritePath, oxidationAmount });
      return Promise.resolve(cached);
    }

    debugLog(opts, 'canvas cache miss', { spritePath, oxidationAmount });
    if (debugEnabled(opts)) console.trace('[ToolMetalRecolor] request caller');

    // A per-tool "Custom" pattern's motif may live in MotifStore instead of
    // being embedded directly; resolve each optional slot independently.
    const motifLoads = authoredPatterns.map(pattern => patternMotifPromise(pattern, opts));

    return Promise.all([loadImage(spritePath, opts), Promise.all(motifLoads)]).then(([img, motifImages]) => {
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
        authoredPattern,
        authoredPatterns,
        motifImage: motifImages[0] || null,
        motifImages,
      });
      ctx.putImageData(imageData, 0, 0);
      _canvasCache.set(cacheKey, canvas);
      while (_canvasCache.size > MAX_CANVAS_CACHE_ENTRIES) _canvasCache.delete(_canvasCache.keys().next().value); // Evict oldest (Map preserves insertion order) instead of growing forever.
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
    __test: Object.freeze({ adjustMaskThickness, scaledOutlineWidthForPattern, buildAuthoredClearedMask, buildOxidationOutlineMask, normalizeAuthoredPatterns, overpassClearanceMultiplier }),
  };

  debugLog({}, 'module loaded', {
    seed: DEFAULT_OXIDATION_SEED,
    blotchCount: DEFAULT_BLOTCH_COUNT,
    outlineWidth: DEFAULT_OUTLINE_WIDTH,
  });
})();
