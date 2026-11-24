// Pinned silhouette for the clothing species-fit editor.
//
// The author paints parts of an item's outline that must not move (e.g. a
// hood's front point that would otherwise poke out past the face). After the
// 6×6 fit and the hood-hole deform have run, every pinned pixel is pulled
// back to exactly where it was in the source art, and the cloth around it
// follows with a Gaussian falloff (sigma, in sprite px), so nothing tears.
//
// pins: [{x, y, ex, ey}] where (x, y) is where the fitted art put a pinned
// pixel and (ex, ey) is the move that returns it to its source position.
// Pure functions only (RGBA arrays in, RGBA arrays out) so tests run in Node.
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.ClothingSilhouettePins) return;

  const DEFAULT_SIGMA = 8;

  function normalizeSigma(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(2, Math.min(40, n)) : DEFAULT_SIGMA;
  }

  // Large corrections need a wider falloff or the field folds: the Gaussian's
  // steepest slope is |e|·0.61/σ, so keep σ ≥ 0.9·|e| (slope ≤ ~0.7) and the
  // fixed-point inverse below always converges.
  function effectiveSigma(pins, sigma) {
    let maxE = 0;
    for (const p of pins) maxE = Math.max(maxE, Math.hypot(p.ex, p.ey));
    return Math.max(normalizeSigma(sigma), maxE * 0.9);
  }

  // Forward correction at a point: the direction is the weighted mean of
  // nearby pin moves, the strength falls off with distance to the NEAREST pin
  // (exp(-d²/2σ²)), so it is exact on the stroke and independent of how
  // densely the stroke was painted.
  function correctionAt(pins, sigma, x, y) {
    const inv = 1 / (2 * sigma * sigma), reach = 9 * sigma * sigma;
    let sw = 0, sx = 0, sy = 0, nearest = 0;
    for (const p of pins) {
      const dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
      if (d2 > reach) continue;
      const w = Math.exp(-d2 * inv);
      sw += w; sx += w * p.ex; sy += w * p.ey;
      if (w > nearest) nearest = w;
    }
    if (!sw) return { x: 0, y: 0 };
    const k = nearest / sw;
    return { x: sx * k, y: sy * k };
  }

  // Warps RGBA pixels by the correction field (inverse by fixed-point
  // iteration, nearest-neighbour sampling so pixel art stays crisp). Only the
  // region the pins can reach is touched.
  function warp(rgba, width, height, pins, sigmaInput) {
    const list = (pins || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.ex) && Number.isFinite(p.ey));
    if (!list.length || list.every(p => Math.abs(p.ex) < 1e-3 && Math.abs(p.ey) < 1e-3)) return rgba;
    const sigma = effectiveSigma(list, sigmaInput), pad = 3 * sigma + 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of list) {
      x0 = Math.min(x0, p.x, p.x + p.ex); x1 = Math.max(x1, p.x, p.x + p.ex);
      y0 = Math.min(y0, p.y, p.y + p.ey); y1 = Math.max(y1, p.y, p.y + p.ey);
    }
    const bx0 = Math.max(0, Math.floor(x0 - pad)), bx1 = Math.min(width - 1, Math.ceil(x1 + pad));
    const by0 = Math.max(0, Math.floor(y0 - pad)), by1 = Math.min(height - 1, Math.ceil(y1 + pad));
    const out = new Uint8ClampedArray(rgba);
    for (let qy = by0; qy <= by1; qy++) for (let qx = bx0; qx <= bx1; qx++) {
      const cx = qx + 0.5, cy = qy + 0.5;
      let sx = cx, sy = cy;
      for (let k = 0; k < 8; k++) {
        const d = correctionAt(list, sigma, sx, sy);
        sx = cx - d.x; sy = cy - d.y;
      }
      const ix = Math.floor(sx), iy = Math.floor(sy), oi = (qy * width + qx) * 4;
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) { out[oi] = out[oi + 1] = out[oi + 2] = out[oi + 3] = 0; continue; }
      const si = (iy * width + ix) * 4;
      out[oi] = rgba[si]; out[oi + 1] = rgba[si + 1]; out[oi + 2] = rgba[si + 2]; out[oi + 3] = rgba[si + 3];
    }
    return out;
  }

  // Outline pixels of an alpha mask (opaque with a transparent 4-neighbour)
  // within radius of (cx, cy): what a brush stroke along the silhouette pins.
  function outlinePixelsNear(rgba, width, height, cx, cy, radius, alphaLimit = 64) {
    const found = [], r2 = radius * radius;
    const opaque = (x, y) => x >= 0 && y >= 0 && x < width && y < height && rgba[(y * width + x) * 4 + 3] >= alphaLimit;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r2 || !opaque(x, y)) continue;
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) found.push({ x: x + 0.5, y: y + 0.5 });
    }
    return found;
  }

  root.ClothingSilhouettePins = Object.freeze({
    DEFAULT_SIGMA, normalizeSigma, effectiveSigma, correctionAt, warp, outlinePixelsNear,
  });
})();
