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

  // Circular moving average / maximum over +-radius bins.
  function circularAverage(values, radius) {
    const n = values.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += values[(i + k + n) % n];
      out[i] = sum / (2 * radius + 1);
    }
    return out;
  }
  function circularMax(values, radius) {
    const n = values.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      let best = -Infinity;
      for (let k = -radius; k <= radius; k++) best = Math.max(best, values[(i + k + n) % n]);
      out[i] = best;
    }
    return out;
  }

  // Builds the polar profile of an opening from rim points (sprite pixels)
  // and the opening seed. The outer outline is the farthest opaque pixel on
  // each ray from the seed.
  // Centroid of the transparent opening around a seed: flood fill through
  // transparent pixels, bounded to the traced rim's box (grown by half) so a
  // leak through a gap in the hood cannot run off into empty space.
  function openingCentroid(rgba, width, height, seed, box, alphaLimit) {
    const gx = (box.x1 - box.x0) * 0.5, gy = (box.y1 - box.y0) * 0.5;
    const x0 = Math.max(0, Math.floor(box.x0 - gx)), x1 = Math.min(width - 1, Math.ceil(box.x1 + gx));
    const y0 = Math.max(0, Math.floor(box.y0 - gy)), y1 = Math.min(height - 1, Math.ceil(box.y1 + gy));
    const sx = Math.floor(seed.x), sy = Math.floor(seed.y);
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || rgba[(sy * width + sx) * 4 + 3] >= alphaLimit) return null;
    const seen = new Uint8Array(width * height), stack = [sy * width + sx];
    seen[stack[0]] = 1;
    let n = 0, cx = 0, cy = 0, touchesBound = false;
    while (stack.length) {
      const i = stack.pop(), x = i % width, y = (i - x) / width;
      n++; cx += x + 0.5; cy += y + 0.5;
      if (x === x0 || x === x1 || y === y0 || y === y1) touchesBound = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        const j = ny * width + nx;
        if (seen[j] || rgba[j * 4 + 3] >= alphaLimit) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (touchesBound || n < 16) return null; // Leaked (opening not closed) or a speck: keep the tracer's seed.
    return { x: cx / n, y: cy / n };
  }

  function buildProfile(rgba, width, height, ringPoints, seedInput, options = {}) {
    if (!seedInput || !Array.isArray(ringPoints) || ringPoints.length < 8) return null;
    const alphaLimit = Number.isFinite(options.alphaLimit) ? options.alphaLimit : 64;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of ringPoints) { bx0 = Math.min(bx0, p.x); by0 = Math.min(by0, p.y); bx1 = Math.max(bx1, p.x); by1 = Math.max(by1, p.y); }
    // The tracer's seed can sit right against one side of the opening, which
    // makes every bearing on the far side graze the rim. Re-centre on the
    // opening itself when it is a closed transparent region.
    const seed = openingCentroid(rgba, width, height, seedInput, {x0:bx0, y0:by0, x1:bx1, y1:by1}, alphaLimit) || seedInput;
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
    const traced = fillCircularGaps(rim);
    // The tracer's rim can be partial (gaps filled by interpolation, which on
    // one side lands inside the cloth). Measure the real opening edge on every
    // bearing instead: the first opaque pixel outward from the seed, kept when
    // it is plausibly the same edge as the traced rim.
    const rimFilled = traced.map((tracedR, b) => {
      const angle = (b / BINS) * 2 * Math.PI - Math.PI, sx = Math.cos(angle), sy = Math.sin(angle);
      for (let d = 0.5; d < tracedR * 1.6 + 4; d += 0.5) {
        const x = Math.floor(seed.x + sx * d), y = Math.floor(seed.y + sy * d);
        if (x < 0 || y < 0 || x >= width || y >= height) break;
        if (rgba[(y * width + x) * 4 + 3] >= alphaLimit) return d >= tracedR * 0.5 ? d : tracedR;
      }
      return tracedR;
    });
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
    // Partial or ragged rims (fur trims, a beard-tool rim that only closed on
    // one side) jump between neighbouring bearings; a displacement field built
    // on them shears the cloth into slivers. Smooth both curves: the rim by a
    // plain average, the outline by max-then-average so it never pulls inside
    // the cloth it has to enclose.
    const rimSmooth = circularAverage(rimFilled, 4);
    const outlineSmooth = circularAverage(circularMax(outline, 4), 4)
      .map((r, b) => Math.max(r, rimSmooth[b] + 2));
    return {
      seed:{x:seed.x,y:seed.y}, rim:rimSmooth, outline:outlineSmooth, edgeBand: Number.isFinite(options.edgeBand) ? options.edgeBand : 6, rimRaw:rimFilled, outlineRaw:outline, covered,
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
  // Width of the opening's own ink/edge band on the cloth side of the rim:
  // it moves rigidly with the rim (never stretched into a smear), capped to a
  // third of the band so thin hoods still have room to absorb the move.
  function edgeBandAt(profile, rimR, outR) {
    const want = Number.isFinite(profile.edgeBand) ? profile.edgeBand : 0;
    return Math.max(0, Math.min(want, (outR - rimR) / 3));
  }
  function rimDisplacement(profile, corners, rate, angle) {
    const rimR = sampleBins(profile.rim, angle), outR = sampleBins(profile.outline, angle);
    const edgeR = rimR + edgeBandAt(profile, rimR, outR);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const edge = holeDelta(profile, corners, profile.seed.x + ux * rimR, profile.seed.y + uy * rimR);
    const free = {x:edge.x, y:edge.y}; // Unlimited rim motion, for layers that ride along rigidly (trim).
    const radial = edge.x * ux + edge.y * uy, limit = 0.9 * (outR - edgeR) / falloffMaxSlope(rate);
    if (radial > limit) { edge.x -= (radial - limit) * ux; edge.y -= (radial - limit) * uy; }
    return {edge, free, rimR, outR, edgeR};
  }

  // Forward displacement of a source pixel position.
  // follow (0..1): how closely this layer rides along with the opening. 0 is
  // the cloth falloff (base layers); 1 moves the whole layer with the rim on
  // each bearing, keeping its own width, so a trim follows the hole and can
  // uncover the base underneath it.
  function displacementAt(profile, corners, rate, x, y, follow = 0) {
    const dx = x - profile.seed.x, dy = y - profile.seed.y, r = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const {edge: limited, free, rimR, outR, edgeR} = rimDisplacement(profile, corners, rate, angle);
    const f = Math.max(0, Math.min(1, Number(follow) || 0));
    const edge = f ? {x:limited.x + (free.x - limited.x) * f, y:limited.y + (free.y - limited.y) * f} : limited;
    if (r <= rimR) {
      // Inside the opening: the quad, blended toward the (possibly limited)
      // rim displacement so the opening edge and the cloth stay continuous.
      const inner = holeDelta(profile, corners, x, y), s = rimR > 1e-6 ? r / rimR : 0;
      return {x:inner.x + (edge.x - inner.x) * s * s, y:inner.y + (edge.y - inner.y) * s * s};
    }
    let base;
    if (r >= outR) base = {x:0, y:0};
    else if (r <= edgeR) base = {x:limited.x, y:limited.y}; // The opening's ink edge travels intact.
    else {
      const w = falloffWeight((r - edgeR) / Math.max(1e-6, outR - edgeR), rate);
      base = {x:limited.x * w, y:limited.y * w};
    }
    if (!f) return base;
    return {x:base.x + (free.x - base.x) * f, y:base.y + (free.y - base.y) * f};
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

  // Forward mesh for drawing layers: rings of vertices around the seed, each
  // with its source position (s) and displaced position (d). Ring 0 is the
  // seed, then points inside the opening, the rim, the cloth band out to the
  // outline, and one pad ring past it (d === s there, so drawing the mesh over
  // the untouched image is seamless). Every layer drawn through the same mesh
  // moves identically, and nothing is lost to a failed inverse.
  function mesh(profile, cornersInput, rateInput, options = {}) {
    const corners = normalizeCorners(cornersInput), rate = normalizeRate(rateInput);
    if (!profile) return null;
    const follow = Math.max(0, Math.min(1, Number(options.follow) || 0));
    const angles = Math.max(16, Math.round(options.angles || 96));
    const bandRings = Math.max(2, Math.round(options.bandRings || 8));
    const pad = Number.isFinite(options.pad) ? options.pad : 3;
    const rings = [];
    const rimBand = Number.isFinite(options.rimBand) ? options.rimBand : 8; // Px just inside the rim that move rigidly with it.
    const point = (x, y, still, lockTo) => {
      if (still) return { s: { x, y }, d: { x, y } };
      const v = displacementAt(profile, corners, rate, lockTo ? lockTo.x : x, lockTo ? lockTo.y : y, follow);
      return { s: { x, y }, d: { x: x + v.x, y: y + v.y } };
    };
    const seed = profile.seed;
    rings.push(new Array(angles).fill(0).map(() => point(seed.x, seed.y, false)));
    const radiiFor = angle => {
      const rimR = sampleBins(profile.rim, angle), outR = sampleBins(profile.outline, angle);
      // The opening's own ink edge sits just inside the detected rim: carry
      // that band rigidly with the rim so it travels intact instead of
      // being smeared across the opening when the hole grows.
      const lockR = Math.max(rimR * 0.6, rimR - rimBand);
      const edgeR = rimR + edgeBandAt(profile, rimR, outR);
      const list = [{ r: lockR * 0.5 }, { r: lockR, lockRim: true }, { r: rimR }, { r: edgeR }];
      for (let k = 1; k < bandRings; k++) {
        const t = k / bandRings;
        list.push({ r: edgeR + (outR - edgeR) * t });
      }
      // A following layer keeps moving past the outline (nothing of it is left
      // behind to tear from); a falloff layer is pinned there.
      list.push({ r: outR, still: !follow }, { r: outR + pad, still: !follow });
      return list;
    };
    const perAngle = [];
    for (let j = 0; j < angles; j++) perAngle.push(radiiFor((j / angles) * 2 * Math.PI - Math.PI));
    const ringCount = perAngle[0].length;
    for (let i = 0; i < ringCount; i++) {
      rings.push(perAngle.map((radii, j) => {
        const angle = (j / angles) * 2 * Math.PI - Math.PI, entry = radii[i];
        const ux = Math.cos(angle), uy = Math.sin(angle);
        const lock = entry.lockRim ? { x: seed.x + ux * sampleBins(profile.rim, angle), y: seed.y + uy * sampleBins(profile.rim, angle) } : null;
        return point(seed.x + ux * entry.r, seed.y + uy * entry.r, !!entry.still, lock);
      }));
    }
    return { rings, angles };
  }

  // Calls emit(s0, s1, s2, d0, d1, d2) for every triangle of a mesh.
  function forEachTriangle(meshData, emit) {
    const { rings, angles } = meshData;
    for (let i = 0; i + 1 < rings.length; i++) {
      const inner = rings[i], outer = rings[i + 1];
      for (let j = 0; j < angles; j++) {
        const k = (j + 1) % angles;
        if (i === 0) { emit(inner[j].s, outer[j].s, outer[k].s, inner[j].d, outer[j].d, outer[k].d); continue; }
        emit(inner[j].s, outer[j].s, outer[k].s, inner[j].d, outer[j].d, outer[k].d);
        emit(inner[j].s, outer[k].s, inner[k].s, inner[j].d, outer[k].d, inner[k].d);
      }
    }
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
    buildProfile, displacementAt, warp, mesh, forEachTriangle, ringFromPortrait,
  });
})();
