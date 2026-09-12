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

  // ── Triangle-tessellation repeat geometry ──────────────────────────────
  // Ported from the Hobunji Weaving Pattern Editor prototype
  // (fitGuaranteedTriangle/buildTranslationTessellation): fits the
  // minimum-area triangle that encloses the motif's opaque envelope (plus a
  // small padding), then pairs it with its own 180°-rotation around the
  // midpoint of its longest edge. That triangle + partner always forms a
  // parallelogram — any triangle tiles the plane this way — so translating
  // it by integer combinations of the two edge vectors from the shared
  // edge's endpoints to the apex (basisU/basisV) tiles seamlessly with no
  // gaps and no need for a separate "spacing" between copies.
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

  function convexHull(points) {
    if (points.length <= 1) return points.map(p => ({ ...p }));
    const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // Hull of the opaque raster's own envelope (each row's filled span as
  // pixel-edge corners, not pixel centers) so the fitted triangle encloses
  // whole opaque pixels, not just their centers.
  function opaqueEnvelopeHull(mask, w, h, bbox) {
    const pts = [];
    for (let y = bbox.y0; y <= bbox.y1; y++) {
      let left = Infinity, right = -Infinity;
      for (let x = bbox.x0; x <= bbox.x1; x++) {
        if (!mask[y * w + x]) continue;
        if (x < left) left = x;
        if (x > right) right = x;
      }
      if (!Number.isFinite(left)) continue;
      const ly = y - bbox.y0, lx = left - bbox.x0, rx = right - bbox.x0 + 1;
      pts.push({ x: lx, y: ly }, { x: rx, y: ly }, { x: lx, y: ly + 1 }, { x: rx, y: ly + 1 });
    }
    return convexHull(pts);
  }

  function vecDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function lineIntersection(n1, c1, n2, c2) {
    const det = n1.x * n2.y - n1.y * n2.x;
    if (Math.abs(det) < 1e-8) return null;
    return { x: (c1 * n2.y - n1.y * c2) / det, y: (n1.x * c2 - c1 * n2.x) / det };
  }
  function polygonArea(points) {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) * 0.5;
  }
  function rotate180(p, m) { return { x: 2 * m.x - p.x, y: 2 * m.y - p.y }; }

  function fitGuaranteedTriangle(mask, w, h, padding) {
    const bbox = findOpaqueBounds(mask, w, h);
    if (!bbox) return null;
    const hull = opaqueEnvelopeHull(mask, w, h, bbox);
    if (hull.length < 3) {
      const bw = Math.max(1, bbox.w), bh = Math.max(1, bbox.h);
      hull.push({ x: bw, y: 0 }, { x: 0, y: bh });
    }
    const pad = Math.max(0, Number(padding) || 0);
    const samples = 48, twopi = Math.PI * 2, normals = [];
    for (let i = 0; i < samples; i++) {
      const a = twopi * i / samples;
      const n = { x: Math.cos(a), y: Math.sin(a) };
      let support = -Infinity;
      for (const p of hull) { const v = n.x * p.x + n.y * p.y; if (v > support) support = v; }
      normals.push({ a, n, c: support + pad });
    }
    // Dense (48-angle) search for the minimum-area triangle whose three
    // support lines all enclose the hull — cheap enough to run per render
    // (O(samples^3) candidate triples, ~18k, each an O(1) check).
    let best = null;
    for (let i = 0; i < samples - 2; i++) {
      for (let j = i + 1; j < samples - 1; j++) {
        for (let k = j + 1; k < samples; k++) {
          const gaps = [normals[j].a - normals[i].a, normals[k].a - normals[j].a, normals[i].a + twopi - normals[k].a];
          if (Math.max(gaps[0], gaps[1], gaps[2]) >= Math.PI - 1e-6) continue;
          const a = lineIntersection(normals[i].n, normals[i].c, normals[j].n, normals[j].c);
          const b = lineIntersection(normals[j].n, normals[j].c, normals[k].n, normals[k].c);
          const c = lineIntersection(normals[k].n, normals[k].c, normals[i].n, normals[i].c);
          if (!a || !b || !c) continue;
          const verts = [a, b, c];
          const inside = verts.every(v => [normals[i], normals[j], normals[k]].every(s => s.n.x * v.x + s.n.y * v.y <= s.c + 1e-5));
          if (!inside) continue;
          const area = polygonArea(verts);
          if (!Number.isFinite(area) || area <= 1e-6) continue;
          if (!best || area < best.area) best = { verts, area };
        }
      }
    }
    if (!best) {
      const bw = bbox.w + pad * 2, bh = bbox.h + pad * 2;
      best = { verts: [{ x: 0, y: 0 }, { x: bw * 2, y: 0 }, { x: 0, y: bh * 2 }], area: bw * bh * 2 };
    }
    const verts = best.verts;
    // The longest edge becomes the shared edge with the 180° partner —
    // generally gives the most readable repeat.
    const edges = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]
      .map(([ai, bi, ci]) => ({ ai, bi, ci, d: vecDist(verts[ai], verts[bi]) }))
      .sort((x, y) => y.d - x.d)[0];
    let A = verts[edges.ai], B = verts[edges.bi], C = verts[edges.ci];
    const minX = Math.min(A.x, B.x, C.x, 0), minY = Math.min(A.y, B.y, C.y, 0);
    const shift = { x: -minX + 1, y: -minY + 1 };
    A = { x: A.x + shift.x, y: A.y + shift.y };
    B = { x: B.x + shift.x, y: B.y + shift.y };
    C = { x: C.x + shift.x, y: C.y + shift.y };
    const midpoint = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const partnerC = rotate180(C, midpoint);
    const basisU = { x: A.x - C.x, y: A.y - C.y };
    const basisV = { x: B.x - C.x, y: B.y - C.y };
    const motifPlacement = { x: shift.x, y: shift.y, w: bbox.w, h: bbox.h };
    return { bbox, A, B, C, partnerC, midpoint, basisU, basisV, motifPlacement };
  }

  // Renders a caller-authored removal pattern (see pattern-authoring.js) into
  // a same-size binary mask: 1 where the pattern's motif paints, i.e. where
  // verdigris should be stripped back to bare metal. Purely geometric — it
  // knows nothing about metal/verdigris, just stamps a black motif image
  // (tiled via the triangle-tessellation lattice above, when enabled)
  // across a transparent raster per the placement fields the editor wrote.
  function buildAuthoredClearedMask(width, height, patternDef, motifImg) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // motifScale sizes the motif itself; patternScale (applied via
    // ctx.scale further down) zooms the whole tiled field afterward — same
    // distinction as motifRotationDeg vs patternRotationDeg. `patternDef.scale`
    // is a fallback for patterns saved before motifScale/patternScale
    // existed as separate fields.
    const motifScale = Math.max(0.05, Number(patternDef.motifScale ?? patternDef.scale) || 1);
    const fieldScale = Math.max(0.05, Number(patternDef.patternScale) || 1);
    const motifRad = ((Number(patternDef.motifRotationDeg) || 0) * Math.PI) / 180;
    const fieldRad = ((Number(patternDef.patternRotationDeg) || 0) * Math.PI) / 180;
    const repeatMode = patternDef.repeatMode === 'grid' ? 'grid' : 'triangle';
    const naturalW = motifImg.naturalWidth || motifImg.width || 1;
    const naturalH = motifImg.naturalHeight || motifImg.height || 1;

    // Renders the motif (rotated, at the given scale) into a square canvas
    // just big enough to hold it without clipping, with the motif's own
    // center always at the canvas center — so two renders at different
    // scales still share the same conceptual anchor point.
    function prepareMotif(scale) {
      const mw = Math.max(1, naturalW * scale);
      const mh = Math.max(1, naturalH * scale);
      const size = Math.max(2, Math.ceil(Math.hypot(mw, mh)) + 2);
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const cctx = c.getContext('2d');
      cctx.imageSmoothingEnabled = false;
      cctx.translate(size / 2, size / 2);
      cctx.rotate(motifRad);
      cctx.drawImage(motifImg, -mw / 2, -mh / 2, mw, mh);
      return { canvas: c, ctx: cctx, size };
    }

    // The repeat geometry (triangle lattice or grid pitch) is always
    // derived from a fixed 1x reference render, clipped tightly to the
    // motif's own opaque ink — never the full working canvas, and never
    // motifScale. The *actual* stamped artwork is prepared separately at
    // the real motifScale and centered on that same geometry, so scale
    // above 1x deliberately overflows into neighboring copies instead of
    // growing the repeat geometry to match; below 1x it leaves gaps.
    const prepDraw = prepareMotif(motifScale);

    ctx.save();
    ctx.translate(width / 2 + (Number(patternDef.translateX) || 0), height / 2 + (Number(patternDef.translateY) || 0));
    ctx.rotate(fieldRad);
    ctx.scale(fieldScale, fieldScale);

    if (patternDef.tiling) {
      const prepRef = prepareMotif(1);
      const refData = prepRef.ctx.getImageData(0, 0, prepRef.size, prepRef.size).data;
      const refMask = new Uint8Array(prepRef.size * prepRef.size);
      for (let p = 0, i = 0; i < refData.length; i += 4, p++) if (refData[i + 3] > 16) refMask[p] = 1;
      const bbox = findOpaqueBounds(refMask, prepRef.size, prepRef.size);

      if (bbox) {
        if (repeatMode === 'grid') {
          // Grid pitch is the motif's own tight ink bounds at 1x scale,
          // plus a configurable gap — not the full (possibly much larger,
          // transparent-padded) prepared-canvas size.
          const centerX = bbox.x0 + bbox.w / 2, centerY = bbox.y0 + bbox.h / 2;
          const drawX = centerX - prepDraw.size / 2, drawY = centerY - prepDraw.size / 2;
          const gap = Math.max(0, Number(patternDef.gridSpacing) ?? 6);
          const stepX = bbox.w + gap, stepY = bbox.h + gap;
          const reach = Math.hypot(width, height) / fieldScale;
          const cols = Math.ceil(reach / stepX) + 2;
          const rows = Math.ceil(reach / stepY) + 2;
          for (let ry = -rows; ry <= rows; ry++) {
            for (let rx = -cols; rx <= cols; rx++) {
              ctx.save();
              ctx.translate(rx * stepX, ry * stepY);
              ctx.drawImage(prepDraw.canvas, drawX, drawY);
              ctx.restore();
            }
          }
        } else {
          const padding = Math.max(0, Number(patternDef.trianglePadding ?? patternDef.spacing) ?? 0.5);
          const fit = fitGuaranteedTriangle(refMask, prepRef.size, prepRef.size, padding);
          if (fit) {
            // fit.motifPlacement/fit.bbox are in the fit's own
            // (shifted-positive) coordinate system derived from the 1x
            // reference — this is that bbox's own center in that system,
            // which is where the actual (possibly differently-scaled)
            // drawn motif gets centered.
            const outputCenterX = fit.motifPlacement.x + fit.bbox.w / 2;
            const outputCenterY = fit.motifPlacement.y + fit.bbox.h / 2;
            const drawX = outputCenterX - prepDraw.size / 2;
            const drawY = outputCenterY - prepDraw.size / 2;

            function stampCell(ox, oy) {
              ctx.save();
              ctx.translate(ox, oy);
              ctx.drawImage(prepDraw.canvas, drawX, drawY);
              ctx.restore();
              ctx.save();
              ctx.translate(ox, oy);
              ctx.translate(fit.midpoint.x, fit.midpoint.y);
              ctx.rotate(Math.PI);
              ctx.translate(-fit.midpoint.x, -fit.midpoint.y);
              ctx.drawImage(prepDraw.canvas, drawX, drawY);
              ctx.restore();
            }

            // How far the lattice needs to extend (in basisU/basisV step
            // counts) to cover the whole canvas — inverting the
            // (generally skewed, non-axis-aligned) basis matrix rather
            // than assuming a square grid, since the fitted triangle's
            // edges can point in any direction.
            const reach = Math.hypot(width, height) / fieldScale / 2 + prepDraw.size;
            const det = fit.basisU.x * fit.basisV.y - fit.basisU.y * fit.basisV.x;
            let maxI = 8, maxJ = 8;
            if (Math.abs(det) > 1e-6) {
              const invA = fit.basisV.y / det, invB = -fit.basisV.x / det;
              const invC = -fit.basisU.y / det, invD = fit.basisU.x / det;
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
                stampCell(i * fit.basisU.x + j * fit.basisV.x, i * fit.basisU.y + j * fit.basisV.y);
              }
            }
          }
        }
      }
    } else {
      ctx.drawImage(prepDraw.canvas, -prepDraw.size / 2, -prepDraw.size / 2);
    }
    ctx.restore();

    const pixels = ctx.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let p = 0, i = 0; i < pixels.length; i += 4, p++) {
      if (pixels[i + 3] > 16) mask[p] = 1;
    }
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

    const authoredPattern = opts.authoredPattern;
    const motifImg = opts.motifImage;

    if (!verdigrisHsv || !opts.verdigrisHex || (!authoredPattern && !clamp01(opts.oxidationAmount))) {
      debugLog(opts, 'oxidation skipped', {
        oxidationAmount: clamp01(opts.oxidationAmount),
        hasVerdigrisColor: !!opts.verdigrisHex,
        hasAuthoredPattern: !!authoredPattern,
      });
      return imageData;
    }

    let oxidationMask;
    if (authoredPattern && motifImg) {
      // Authored mode is the inverse of the procedural growth above: the
      // player has painted where verdigris is stripped back to bare metal,
      // not where it grows, so everything else on the metal mask stays
      // oxidized (this only ever runs on an already mastery-5/fully-grown
      // tool — see toolVerdigrisPatternEligible in game.js).
      const clearedMask = buildAuthoredClearedMask(width, height, authoredPattern, motifImg);
      // invert swaps which side of the motif keeps verdigris: normally the
      // motif itself is the cleared shape and everything else stays
      // oxidized; inverted, the motif shape stays oxidized and everything
      // else clears instead.
      const invert = !!authoredPattern.invert;
      oxidationMask = new Uint8Array(metalMask.length);
      for (let p = 0; p < metalMask.length; p++) {
        const cleared = invert ? !clearedMask[p] : !!clearedMask[p];
        oxidationMask[p] = metalMask[p] && !cleared ? 1 : 0;
      }
      debugLog(opts, 'authored pattern mask applied', { clearedPixels: clearedMask.reduce((a, v) => a + v, 0), invert });
    } else {
      oxidationMask = buildOxidationMask(metalMask, width, height, clamp01(opts.oxidationAmount), opts);
    }
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
    // A caller-authored removal pattern (see pattern-authoring.js) replaces
    // the procedural growth entirely — its full definition (motif image
    // included) has to be part of the cache key since it isn't reducible to
    // a single scalar the way oxidationAmount is.
    const authoredPattern = opts.authoredPattern || null;
    const authoredPatternKey = authoredPattern ? JSON.stringify(authoredPattern) : '';
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

    const motifLoad = authoredPattern?.motifDataUrl
      ? loadImage(authoredPattern.motifDataUrl, opts)
      : Promise.resolve(null);

    return Promise.all([loadImage(spritePath, opts), motifLoad]).then(([img, motifImg]) => {
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
        motifImage: motifImg,
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
