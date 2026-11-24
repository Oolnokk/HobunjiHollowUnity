// Hood-opening ("hole") quad deformation for the clothing species-fit editor.
//
// The face opening of a hood is detected with the beard/hood cutout tool's
// rim tracing (window.PortraitBeardHoodCutout, run in 200px portrait space by
// the editor). This module turns those rim points into a polar profile around
// the opening and warps sprite pixels:
//   * inside the opening, pixels follow a bilinear quad whose four corners
//     are the opening's bounding box plus the author's corner offsets;
//   * between the opening rim and the hood's outer outline, pixels take the
//     rim's displacement scaled by an exponential falloff w(t), where t runs 0
//     at the rim to 1 at the outline: w(t) = (e^(-k t) - e^(-k)) / (1 - e^(-k)),
//     k = the falloff rate (≈ linear for small k, tight around the hole for
//     large k). w(1) = 0, so the outer silhouette never moves;
//   * outward pushes are limited per bearing to what that band of cloth can
//     absorb without folding over (thin rims stretch, they never invert);
//   * outside the outline nothing moves.
// Pure functions only (RGBA arrays in, RGBA arrays out) so tests run in Node.
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.ClothingHoodHoleDeform) return;

  const BINS = 180; // Angular resolution of the rim/outline profile (2° per bin).
  const DEFAULT_RATE = 1.5;

  function normalizeRate(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(12, n)) : DEFAULT_RATE;
  }
  function zeroCorners() { return [{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}]; }
  function normalizeCorners(input) {
    const out = zeroCorners();
    if (Array.isArray(input)) for (let i = 0; i < 4; i++) {
      const x = Number(input[i]?.x), y = Number(input[i]?.y);
      out[i] = {x:Number.isFinite(x)?x:0, y:Number.isFinite(y)?y:0};
    }
    return out;
  }
  function isIdentity(corners) {
    return normalizeCorners(corners).every(c => Math.abs(c.x) < 1e-6 && Math.abs(c.y) < 1e-6);
  }
  function binOf(angle) {
    const t = (angle + Math.PI) / (2 * Math.PI);
    return ((Math.round(t * BINS) % BINS) + BINS) % BINS;
  }
  function sampleBins(bins, angle) {
    const f = ((angle + Math.PI) / (2 * Math.PI)) * BINS;
    const i0 = ((Math.floor(f) % BINS) + BINS) % BINS, i1 = (i0 + 1) % BINS, w = f - Math.floor(f);
    return bins[i0] * (1 - w) + bins[i1] * w;
  }
  function fillCircularGaps(values) {
    // Linear interpolation across empty bins, wrapping around the circle.
    const known = [];
    for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) known.push(i);
    if (!known.length) return null;
    const out = values.slice();
    for (let k = 0; k < known.length; k++) {
      const a = known[k], b = known[(k + 1) % known.length];
      const span = ((b - a + values.length) % values.length) || values.length;
      for (let s = 1; s < span; s++) {
        const i = (a + s) % values.length;
        out[i] = values[a] + (values[b] - values[a]) * (s / span);
      }
    }
    return out;
  }

  // Builds the polar profile of an opening from rim points (sprite pixels)
  // and the opening seed. The outer outline is the farthest opaque pixel on
  // each ray from the seed.
  function buildProfile(rgba, width, height, ringPoints, seed, options = {}) {
    if (!seed || !Array.isArray(ringPoints) || ringPoints.length < 8) return null;
    const alphaLimit = Number.isFinite(options.alphaLimit) ? options.alphaLimit : 64;
    const rim = new Array(BINS).fill(NaN);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of ringPoints) {
      const dx = p.x - seed.x, dy = p.y - seed.y, r = Math.hypot(dx, dy);
      if (r < 1) continue;
      const b = binOf(Math.atan2(dy, dx));
      if (!(rim[b] <= r)) rim[b] = r; // Nearest rim pixel on each bearing is the opening's inner edge.
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    const covered = rim.filter(Number.isFinite).length;
    if (covered < BINS * 0.25 || !(x1 - x0 >= 4) || !(y1 - y0 >= 4)) return null;
    const rimFilled = fillCircularGaps(rim);
    const outline = new Array(BINS);
    const maxR = Math.hypot(width, height);
    for (let b = 0; b < BINS; b++) {
      const angle = (b / BINS) * 2 * Math.PI - Math.PI, sx = Math.cos(angle), sy = Math.sin(angle);
      let far = rimFilled[b];
      for (let d = rimFilled[b]; d < maxR; d += 0.5) {
        const x = Math.floor(seed.x + sx * d), y = Math.floor(seed.y + sy * d);
        if (x < 0 || y < 0 || x >= width || y >= height) break;
        if (rgba[(y * width + x) * 4 + 3] >= alphaLimit) far = d;
      }
      outline[b] = Math.max(far, rimFilled[b] + 1);
    }
    return {
      seed:{x:seed.x,y:seed.y}, rim:rimFilled, outline, covered,
      box:{x0,y0,x1,y1},
      quad:[{x:x0,y:y0},{x:x1,y:y0},{x:x0,y:y1},{x:x1,y:y1}], // TL, TR, BL, BR of the opening.
    };
  }

  function holeDelta(profile, corners, x, y) {
    const {x0, y0, x1, y1} = profile.box;
    const u = Math.max(0, Math.min(1, (x - x0) / (x1 - x0))), v = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
    const c = corners;
    return {
      x:(1 - u) * (1 - v) * c[0].x + u * (1 - v) * c[1].x + (1 - u) * v * c[2].x + u * v * c[3].x,
      y:(1 - u) * (1 - v) * c[0].y + u * (1 - v) * c[1].y + (1 - u) * v * c[2].y + u * v * c[3].y,
    };
  }

  // Exponential falloff from the rim (t = 0) to the outline (t = 1).
  function falloffWeight(t, rate) {
    if (rate < 1e-3) return 1 - t;
    const tail = Math.exp(-rate);
    return (Math.exp(-rate * t) - tail) / (1 - tail);
  }
  function falloffMaxSlope(rate) { return rate < 1e-3 ? 1 : rate / (1 - Math.exp(-rate)); }

  // Rim displacement on one bearing, with its outward (radial) part limited so
  // the band between rim and outline compresses but never folds over.
  function rimDisplacement(profile, corners, rate, angle) {
    const rimR = sampleBins(profile.rim, angle), outR = sampleBins(profile.outline, angle);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const edge = holeDelta(profile, corners, profile.seed.x + ux * rimR, profile.seed.y + uy * rimR);
    const radial = edge.x * ux + edge.y * uy, limit = 0.9 * (outR - rimR) / falloffMaxSlope(rate);
    if (radial > limit) { edge.x -= (radial - limit) * ux; edge.y -= (radial - limit) * uy; }
    return {edge, rimR, outR};
  }

  // Forward displacement of a source pixel position.
  function displacementAt(profile, corners, rate, x, y) {
    const dx = x - profile.seed.x, dy = y - profile.seed.y, r = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const {edge, rimR, outR} = rimDisplacement(profile, corners, rate, angle);
    if (r <= rimR) {
      // Inside the opening: the quad, blended toward the (possibly limited)
      // rim displacement so the opening edge and the cloth stay continuous.
      const inner = holeDelta(profile, corners, x, y), s = rimR > 1e-6 ? r / rimR : 0;
      return {x:inner.x + (edge.x - inner.x) * s * s, y:inner.y + (edge.y - inner.y) * s * s};
    }
    if (r >= outR) return {x:0, y:0};
    const w = falloffWeight((r - rimR) / Math.max(1e-6, outR - rimR), rate);
    return {x:edge.x * w, y:edge.y * w};
  }

  // Warps RGBA pixels. Each output pixel inverts the forward field with a few
  // fixed-point steps, then samples the source with nearest-neighbour
  // filtering so pixel-art edges and authored ink stay crisp.
  function warp(rgba, width, height, profile, cornersInput, rateInput) {
    const corners = normalizeCorners(cornersInput), rate = normalizeRate(rateInput);
    if (!profile || isIdentity(corners)) return rgba;
    const out = new Uint8ClampedArray(rgba.length);
    for (let qy = 0; qy < height; qy++) for (let qx = 0; qx < width; qx++) {
      const cx = qx + 0.5, cy = qy + 0.5;
      let px = cx, py = cy;
      for (let k = 0; k < 8; k++) {
        const d = displacementAt(profile, corners, rate, px, py);
        px = cx - d.x; py = cy - d.y;
      }
      const sx = Math.floor(px), sy = Math.floor(py);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const si = (sy * width + sx) * 4, oi = (qy * width + qx) * 4;
      out[oi] = rgba[si]; out[oi + 1] = rgba[si + 1]; out[oi + 2] = rgba[si + 2]; out[oi + 3] = rgba[si + 3];
    }
    return out;
  }

  // Maps opening detection from 200px portrait space (beard tool) back into
  // raw sprite space. rect is the sprite's portrait draw rectangle.
  function ringFromPortrait(lower, upper, rect, width, height) {
    const toRaw = p => ({x:(p.x + 0.5 - rect.x) * width / rect.w, y:(p.y + 0.5 - rect.y) * height / rect.h});
    const seed = lower?.seed || upper?.seed;
    if (!seed) return null;
    const points = [...(lower?.points || []), ...(upper?.points || [])].map(toRaw);
    const rawSeed = {x:(seed.x - rect.x) * width / rect.w, y:(seed.y - rect.y) * height / rect.h};
    return {seed:rawSeed, points};
  }

  root.ClothingHoodHoleDeform = Object.freeze({
    BINS, DEFAULT_RATE, normalizeRate, normalizeCorners, zeroCorners, isIdentity, falloffWeight,
    buildProfile, displacementAt, warp, ringFromPortrait,
  });
})();
