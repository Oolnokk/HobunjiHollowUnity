// Bridge brush fill: hollows a painted mask and regrows the surrounding metal into it; no DOM dependency.
(function (global) {
  'use strict';

  function luma(px, o) { return 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]; }
  function hueSat(r, g, b) { // HSV hue (degrees) and saturation, matching tool-metal-recolor.js's metal detection.
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0;
    if (d) hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return [(hue + 360) % 360, max ? d / max : 0];
  }
  function hexRgb(hex) { const v = parseInt(String(hex).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function mulberry32(seed) {
    let a = seed >>> 0; // Deterministic jitter so the same stroke always regrows the same way.
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function otsu(values) {
    const hist = new Uint32Array(256); // Brightness histogram of sampled metal pixels.
    let total = 0, sum = 0;
    for (const v of values) { const b = Math.max(0, Math.min(255, Math.round(v))); hist[b]++; total++; sum += b; }
    let sumB = 0, weightB = 0, best = -1, threshold = 128;
    for (let t = 0; t < 256; t++) {
      weightB += hist[t]; if (!weightB) continue;
      const weightF = total - weightB; if (!weightF) break;
      sumB += t * hist[t];
      const between = weightB * weightF * ((sumB / weightB) - ((sum - sumB) / weightF)) ** 2;
      if (between > best) { best = between; threshold = t + 0.5; }
    }
    return threshold; // Values below are "shaded", above are "unshaded".
  }
  function medianColor(px, offsets) {
    if (!offsets.length) return null;
    const color = [0, 0, 0, 255];
    for (let c = 0; c < 3; c++) {
      const channel = offsets.map(o => px[o + c]).sort((a, b) => a - b);
      color[c] = channel[channel.length >> 1];
    }
    return color;
  }
  // Pixel classifier shared by the bridge fill and the smudge brush. Every weapon's metal is authored in one base
  // color (the same SOURCE_HEX the game's metal recolor keys on); shading only changes its brightness.
  const EMPTY = 0, INK = 1, METAL = 2, OTHER = 3;
  function makeClassifier(options = {}) {
    const minAlpha = Math.max(1, Math.min(255, Math.round(options.minAlpha ?? 32))); // Fainter pixels count as empty.
    const darkLuma = options.darkLuma ?? 48; // Darker opaque pixels are outline ink, never metal.
    const [metalHue, metalSat] = hueSat(...hexRgb(options.metalHex || '#5A8480'));
    const hueTol = options.metalHueTolerance ?? 22, satTol = options.metalSaturationTolerance ?? 0.22;
    return (px, o) => {
      if (px[o + 3] < minAlpha) return EMPTY;
      if (luma(px, o) < darkLuma) return INK;
      const [hue, sat] = hueSat(px[o], px[o + 1], px[o + 2]);
      const hueGap = Math.min(Math.abs(hue - metalHue), 360 - Math.abs(hue - metalHue));
      return hueGap <= hueTol && Math.abs(sat - metalSat) <= satTol ? METAL : OTHER;
    };
  }

  // Minimal binary min-heap of (cost, pixel, tone) used by the competing-seed growth.
  function Heap() { this.cost = []; this.pixel = []; this.tone = []; }
  Heap.prototype.push = function (cost, pixel, tone) {
    let i = this.cost.length;
    this.cost.push(cost); this.pixel.push(pixel); this.tone.push(tone);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.cost[parent] <= cost) break;
      this.cost[i] = this.cost[parent]; this.pixel[i] = this.pixel[parent]; this.tone[i] = this.tone[parent];
      i = parent;
    }
    this.cost[i] = cost; this.pixel[i] = pixel; this.tone[i] = tone;
  };
  Heap.prototype.pop = function (out) {
    out.cost = this.cost[0]; out.pixel = this.pixel[0]; out.tone = this.tone[0];
    const cost = this.cost.pop(), pixel = this.pixel.pop(), tone = this.tone.pop();
    const n = this.cost.length;
    if (!n) return out;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= n) break;
      if (child + 1 < n && this.cost[child + 1] < this.cost[child]) child++;
      if (this.cost[child] >= cost) break;
      this.cost[i] = this.cost[child]; this.pixel[i] = this.pixel[child]; this.tone[i] = this.tone[child];
      i = child;
    }
    this.cost[i] = cost; this.pixel[i] = pixel; this.tone[i] = tone;
    return out;
  };

  // source: RGBA frame; mask: one byte per pixel (nonzero = painted by the bridge brush). Only the stroke's bounding
  // box plus a margin (room for seeds, sampling, and the parts' unshaded pools) is processed, then pasted back, so
  // cost follows the stroke size rather than the frame size.
  function fillBridge(source, mask, width, height, options = {}) {
    const w = Number(width), h = Number(height), n = w * h;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
        !source || source.length !== n * 4 || !mask || mask.length !== n)
      throw new Error('Bridge fill needs a valid RGBA frame and matching brush mask.');
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0, row = y * w; x < w; x++) if (mask[row + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) throw new Error('Paint over the gap with the bridge brush first.');
    const margin = 48;
    const cx = Math.max(0, x0 - margin), cy = Math.max(0, y0 - margin);
    const cw = Math.min(w - 1, x1 + margin) - cx + 1, ch = Math.min(h - 1, y1 + margin) - cy + 1;
    const cropSource = new Uint8ClampedArray(cw * ch * 4), cropMask = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const from = (cy + y) * w + cx;
      cropSource.set(source.subarray(from * 4, (from + cw) * 4), y * cw * 4);
      cropMask.set(mask.subarray(from, from + cw), y * cw);
    }
    const result = fillRegion(cropSource, cropMask, cw, ch, options); // Crop edges never touch the stroke except at real frame edges.
    const pixels = new Uint8ClampedArray(source);
    for (let y = 0; y < ch; y++) pixels.set(result.pixels.subarray(y * cw * 4, (y + 1) * cw * 4), ((cy + y) * w + cx) * 4);
    return { ...result, pixels };
  }

  function fillRegion(source, mask, w, h, options) {
    const n = w * h;
    const thickness = Math.max(0, Math.min(32, Math.round(options.outlineThickness ?? 10))); // Black rim kept where the bridge meets empty space.
    const jitter = options.jitter ?? 0.9; // Random step cost so competing seeds scramble instead of forming straight Voronoi borders.
    const random = mulberry32(options.seed ?? 1);

    // Pixels of other hues than the base metal (grip wraps, wood) are kept but never spread.
    const classify = makeClassifier(options);
    const kind = new Uint8Array(n); // Classification of the original source pixels.
    let painted = 0;
    for (let p = 0; p < n; p++) {
      kind[p] = classify(source, p * 4);
      if (mask[p]) painted++;
    }
    if (!painted) throw new Error('Paint over the gap with the bridge brush first.');

    // Outline ink belongs to whichever material it is closest to. Ink under the stroke that outlines another
    // material (a wooden haft, a grip wrap) stays black; only ink outlining metal opens up for the bridge to join.
    const inkOwner = new Int8Array(n).fill(-1);
    {
      const q0 = new Int32Array(n); let qh = 0, qt = 0;
      for (let p = 0; p < n; p++) {
        if (kind[p] !== INK) continue;
        const x = p % w, y = (p / w) | 0;
        let owner = -1;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && kind[q] === OTHER) { owner = OTHER; break; }
          if (q >= 0 && kind[q] === METAL) owner = METAL;
        }
        if (owner >= 0) { inkOwner[p] = owner; q0[qt++] = p; }
      }
      while (qh < qt) {
        const p = q0[qh++], x = p % w, y = (p / w) | 0;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && kind[q] === INK && inkOwner[q] < 0) { inkOwner[q] = inkOwner[p]; q0[qt++] = q; }
        }
      }
    }
    const keptInk = p => kind[p] === INK && inkOwner[p] === OTHER;

    // 1. Black rim: painted pixels within `thickness` (straight-line distance, so diagonal strokes get the same rim as
    //    straight ones) of empty space outside the stroke or the frame edge.
    const rimSource = new Int32Array(n).fill(-1); // Nearest stroke pixel touching empty space, for rim pixels only.
    let queue = new Int32Array(n), head = 0, tail = 0;
    for (let p = 0; p < n && thickness; p++) {
      if (!mask[p]) continue;
      const x = p % w, y = (p / w) | 0;
      let touchesEmpty = false;
      for (let dy = -1; dy <= 1 && !touchesEmpty; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { touchesEmpty = true; break; }
        const q = ny * w + nx;
        if (!mask[q] && kind[q] === EMPTY) { touchesEmpty = true; break; }
      }
      if (touchesEmpty) { rimSource[p] = p; queue[tail++] = p; }
    }
    while (head < tail) {
      const p = queue[head++], e = rimSource[p], ex = e % w, ey = (e / w) | 0;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && rimSource[q] < 0 && Math.hypot(nx - ex, ny - ey) < thickness) { rimSource[q] = e; queue[tail++] = q; }
      }
    }
    // Metal (and other-colored material) the stroke painted over is never overwritten; painted metal joins the seeds.
    const isRim = p => kind[p] <= INK && !keptInk(p) && rimSource[p] >= 0;
    const fillable = new Uint8Array(n); // The hollowed interior (empty space and outline ink) that metal regrows into.
    let fillCount = 0, preserved = 0;
    for (let p = 0; p < n; p++) {
      if (!mask[p]) continue;
      if (kind[p] >= METAL || keptInk(p)) preserved++;
      else if (!isRim(p)) { fillable[p] = 1; fillCount++; }
    }

    // 2. Sample the metal the stroke overlapped and the parts just around it (skipping the anti-aliased fringe
    //    that touches outline ink), split brightness into shaded/unshaded, and seed from metal bordering the hollow.
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let p = 0; p < n; p++) if (mask[p]) {
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const margin = 24; // Nearby parts only, not the whole sprite.
    const seeds = [], samples = [];
    for (let y = Math.max(0, y0 - margin); y <= Math.min(h - 1, y1 + margin); y++) {
      for (let x = Math.max(0, x0 - margin); x <= Math.min(w - 1, x1 + margin); x++) {
        const p = y * w + x;
        if (kind[p] !== METAL) continue;
        let fringe = false;
        for (let dy = -1; dy <= 1 && !fringe; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || kind[ny * w + nx] !== METAL) { fringe = true; break; }
        }
        if (!fringe) samples.push(p);
        if (((x > 0 && fillable[p - 1]) || (x < w - 1 && fillable[p + 1]) ||
            (y > 0 && fillable[p - w]) || (y < h - 1 && fillable[p + w]))) seeds.push(p);
      }
    }
    if (!seeds.length) throw new Error('The stroke must touch metal pixels at both ends so they can grow into it.');
    if (!samples.length) for (const p of seeds) samples.push(p);
    const lumas = samples.map(p => luma(source, p * 4));
    let low = Infinity, high = -Infinity; // No Math.max(...array): huge strokes would exceed engine argument limits.
    for (const v of lumas) { if (v < low) low = v; if (v > high) high = v; }
    const spread = high - low;
    const threshold = spread < 12 ? -1 : otsu(lumas); // Near-uniform metal has a single tone.
    const SHADED = 0, LIT = 1;
    const toneOf = p => luma(source, p * 4) < threshold ? SHADED : LIT;
    // Each tone's color is the median of samples near that tone's most common brightness, so the blurry
    // outline fringe (many slightly-darker pixels) doesn't drag the shaded color toward black.
    const palette = [SHADED, LIT].map(t => {
      const own = samples.filter(p => toneOf(p) === t);
      if (!own.length) return null;
      const hist = new Uint32Array(256);
      for (const p of own) hist[Math.round(luma(source, p * 4))]++;
      let mode = 0, best = -1;
      for (let b = 0; b < 256; b++) {
        let sum = 0;
        for (let k = Math.max(0, b - 3); k <= Math.min(255, b + 3); k++) sum += hist[k];
        if (sum > best) { best = sum; mode = b; }
      }
      const core = own.filter(p => Math.abs(luma(source, p * 4) - mode) <= 6);
      return medianColor(source, (core.length ? core : own).map(p => p * 4));
    });
    if (!palette[SHADED]) palette[SHADED] = palette[LIT];
    if (!palette[LIT]) palette[LIT] = palette[SHADED];

    // 3. Every bordering metal pixel is a simultaneous seed racing into the hollow; each hollow pixel takes the
    //    tone of whichever seed claims it first. This continues the parts' own shading bands into the bridge.
    const tone = new Int8Array(n).fill(-1);
    const heap = new Heap();
    for (const p of seeds) heap.push(random() * jitter, p, toneOf(p));
    const item = {};
    let grown = 0;
    while (heap.cost.length) {
      heap.pop(item);
      const p = item.pixel;
      if (fillable[p]) { if (tone[p] >= 0) continue; tone[p] = item.tone; grown++; }
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && fillable[q] && tone[q] < 0) heap.push(item.cost + 1 + random() * jitter, q, item.tone);
      }
    }

    // 4. Unshaded pools: every connected pool of unshaded metal touching the stroke is joined to the others by an
    //    unshaded channel through the stroke (hollow or painted-over metal). All pools grow at once; where two
    //    pools' fronts meet is a candidate link, the cheapest links joining every pool are kept (minimum spanning
    //    tree), and each is traced back to both pools and widened with the stroke's local width. Steps near the
    //    stroke's outer edges cost more, so channels run down its middle. Painted-over shaded metal on a channel is
    //    the only painted-over metal that changes (it becomes unshaded).
    const neighbors4 = p => { const x = p % w, y = (p / w) | 0; return [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]; };
    const lane = p => fillable[p] === 1 || (mask[p] && kind[p] === METAL); // Where channels may run.
    const isLit = p => kind[p] === METAL && toneOf(p) === LIT;
    const pool = new Int32Array(n).fill(-1);
    let pools = 0, poolsLinked = 0, channelled = 0;
    const relit = new Uint8Array(n); // Painted-over shaded metal turned unshaded by a channel.
    for (let s0 = 0; s0 < n; s0++) {
      if (pool[s0] >= 0 || !isLit(s0) || !(mask[s0] || neighbors4(s0).some(q => q >= 0 && lane(q)))) continue;
      const stack = [s0];
      pool[s0] = pools;
      while (stack.length) {
        const p = stack.pop();
        for (const q of neighbors4(p)) if (q >= 0 && pool[q] < 0 && isLit(q)) { pool[q] = pools; stack.push(q); }
      }
      pools++;
    }
    if (pools > 1) {
      const inset = new Int32Array(n).fill(-1); // Steps from the stroke's non-metal boundary (rim or empty space).
      queue = new Int32Array(n); head = tail = 0;
      for (let p = 0; p < n; p++) {
        if (lane(p) && neighbors4(p).some(q => q < 0 || (!lane(q) && kind[q] <= INK))) { inset[p] = 0; queue[tail++] = p; }
      }
      while (head < tail) {
        const p = queue[head++];
        for (const q of neighbors4(p)) if (q >= 0 && lane(q) && inset[q] < 0) { inset[q] = inset[p] + 1; queue[tail++] = q; }
      }
      for (let p = 0; p < n; p++) if (lane(p) && inset[p] < 0) inset[p] = 64; // Lane fully enclosed by metal.
      const owner = new Int32Array(n).fill(-1), dist = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
      const reach = new Heap();
      for (let p = 0; p < n; p++) if (pool[p] >= 0 && (lane(p) || neighbors4(p).some(q => q >= 0 && lane(q)))) {
        dist[p] = 0; owner[p] = pool[p]; reach.push(0, p, 0);
      }
      const it = {};
      while (reach.cost.length) {
        reach.pop(it);
        const p = it.pixel;
        if (it.cost > dist[p]) continue;
        for (const q of neighbors4(p)) {
          if (q < 0 || !lane(q) || pool[q] >= 0) continue;
          const c = it.cost + 1 + 4 / (1 + inset[q]);
          if (c < dist[q]) { dist[q] = c; owner[q] = owner[p]; from[q] = p; reach.push(c, q, 0); }
        }
      }
      const links = new Map(); // "a,b" → cheapest meeting [cost, p, q, a, b].
      for (let p = 0; p < n; p++) {
        if (owner[p] < 0) continue;
        for (const q of neighbors4(p)) {
          if (q < 0 || owner[q] < 0 || owner[q] === owner[p]) continue;
          const a = Math.min(owner[p], owner[q]), b = Math.max(owner[p], owner[q]), key = a + ',' + b;
          const cost = dist[p] + dist[q] + 1;
          if (!links.has(key) || links.get(key)[0] > cost) links.set(key, [cost, p, q, a, b]);
        }
      }
      const root = Array.from({ length: pools }, (_, i) => i);
      const find = i => root[i] === i ? i : (root[i] = find(root[i]));
      const path = new Uint8Array(n);
      for (const [, p, q, a, b] of [...links.values()].sort((u, v) => u[0] - v[0])) {
        if (find(a) === find(b)) continue;
        root[find(a)] = find(b); poolsLinked++;
        for (let t of [p, q]) while (t >= 0 && pool[t] < 0) { path[t] = 1; t = from[t]; }
      }
      // Widen each channel to about a third of the stroke's local half-width (1–6 pixels either side).
      for (let p = 0; p < n; p++) {
        if (!path[p]) continue;
        const r = Math.max(1, Math.min(6, Math.round(inset[p] * 0.35))), px = p % w, py = (p / w) | 0;
        for (let y = Math.max(0, py - r); y <= Math.min(h - 1, py + r); y++) for (let x = Math.max(0, px - r); x <= Math.min(w - 1, px + r); x++) {
          const q = y * w + x;
          if ((x - px) ** 2 + (y - py) ** 2 > r * r) continue;
          if (fillable[q] && tone[q] !== LIT) { tone[q] = LIT; channelled++; }
          else if (mask[q] && kind[q] === METAL && !isLit(q) && !relit[q]) { relit[q] = 1; channelled++; }
        }
      }
      queue = null;
    }

    // 5. Outline shading: a shaded band runs alongside every black outline the hollow touches (its rim, the parts'
    //    outlines, or empty space). Its width is a share of the room the bridge has there (its local width): the full
    //    `shadeWidth` share on the side facing away from the light, tapering to a thin line (never under 1 pixel)
    //    on the side facing it, so every outline keeps at least a sliver of shade.
    const shadeShare = Math.max(0, Math.min(1, options.shadeWidth ?? 0.3));
    const litSideShare = Math.max(0, Math.min(1, options.litSideShare ?? 0.15)); // Fraction of the full band kept on the lit side.
    const light = options.lightDirection; // [x, y] screen-space vector toward the light, or null for even shading.
    const ll = light ? Math.hypot(light[0], light[1]) || 1 : 1, lx = light ? light[0] / ll : 0, ly = light ? light[1] / ll : 0;
    const region = p => fillable[p] === 1 || (mask[p] && kind[p] === METAL); // Room is measured across the whole stroke.
    const nearest = new Int32Array(n).fill(-1); // Closest outline-touching pixel, propagated through the stroke.
    const normX = new Float32Array(n), normY = new Float32Array(n);
    const order = [];
    queue = new Int32Array(n); head = tail = 0;
    for (let p = 0; p < n; p++) {
      if (!region(p)) continue;
      const x = p % w, y = (p / w) | 0;
      let ox = 0, oy = 0, edge = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { edge = true; ox += dx; oy += dy; continue; }
        const q = ny * w + nx;
        if (!region(q) && kind[q] <= INK) { edge = true; ox += dx; oy += dy; }
      }
      if (!edge) continue;
      const len = Math.hypot(ox, oy) || 1;
      normX[p] = ox / len; normY[p] = oy / len; nearest[p] = p; queue[tail++] = p;
    }
    while (head < tail) {
      const p = queue[head++], x = p % w, y = (p / w) | 0;
      order.push(p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (region(q) && nearest[q] < 0) { nearest[q] = nearest[p]; queue[tail++] = q; }
      }
    }
    queue = null;
    const depth = new Float32Array(n), ridge = new Float32Array(n); // Distance to the outline, and the deepest point inward of it.
    for (const p of order) { const e = nearest[p]; depth[p] = ridge[p] = Math.hypot(e % w - p % w, ((e / w) | 0) - ((p / w) | 0)); }
    order.sort((u, v) => depth[v] - depth[u]);
    for (const p of order) { // Carry each ridge depth outward so every pixel knows the half-width of the bridge it sits in.
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (nearest[q] >= 0 && depth[q] < depth[p] && ridge[q] < ridge[p]) ridge[q] = ridge[p];
      }
    }
    let edgeShaded = 0;
    for (let p = 0; p < n; p++) {
      if (!fillable[p] || nearest[p] < 0) continue;
      const e = nearest[p];
      const away = light ? (1 - (normX[e] * lx + normY[e] * ly)) / 2 : 0.5; // 0 facing the light, 1 facing away.
      const band = Math.max(1, 2 * ridge[p] * shadeShare * (litSideShare + (1 - litSideShare) * away));
      if (depth[p] < band && tone[p] !== SHADED) { tone[p] = SHADED; edgeShaded++; }
    }

    // 6. Write the result: rim → opaque black, hollow → sampled metal tones (unreached islands take the shaded tone),
    //    painted-over metal → unchanged.
    const pixels = new Uint8ClampedArray(source);
    let rimCount = 0, shadedCount = 0, litCount = 0;
    for (let p = 0; p < n; p++) {
      if (relit[p]) { pixels.set(palette[LIT], p * 4); continue; }
      if (!mask[p] || kind[p] >= METAL || keptInk(p)) continue;
      const o = p * 4;
      if (!fillable[p]) { pixels[o] = pixels[o + 1] = pixels[o + 2] = 0; pixels[o + 3] = 255; rimCount++; continue; }
      const t = tone[p] >= 0 ? tone[p] : SHADED;
      pixels.set(palette[t], o);
      if (t === SHADED) shadedCount++; else litCount++;
    }
    return { pixels, painted, rim: rimCount, filled: fillCount, grown, shaded: shadedCount, unshaded: litCount,
      seeds: seeds.length, sampled: samples.length, threshold, palette,
      edgeShaded, preserved, pools, poolsLinked, channelled };
  }

  // Stamps a filled disc into a brush mask, interpolating from the previous point so fast strokes stay solid.
  function stampLine(mask, width, height, from, to, radius, value = 1) {
    const r = Math.max(0.5, radius), r2 = r * r;
    const dist = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, r / 3)));
    for (let s = from ? 1 : 0; s <= steps; s++) {
      const t = from ? s / steps : 1;
      const cx = from ? from.x + (to.x - from.x) * t : to.x, cy = from ? from.y + (to.y - from.y) * t : to.y;
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(height - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - cy, span = r2 - dy * dy;
        if (span < 0) continue;
        const half = Math.sqrt(span);
        const x0 = Math.max(0, Math.ceil(cx - half - 0.5)), x1 = Math.min(width - 1, Math.floor(cx + half - 0.5));
        if (x1 >= x0) mask.fill(value, y * width + x0, y * width + x1 + 1);
      }
    }
  }

  function convexHull(points) { // Monotone chain; points as [x, y].
    const pts = points.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  // Stamps one saved stroke: an open polyline of discs, or (closed) a filled polygon with a disc-wide border.
  // `toPixel` maps stored coordinates into the mask and `scale` converts the radius the same way.
  function stampStroke(mask, width, height, stroke, toPixel = (x, y) => ({ x, y }), scale = 1) {
    const pts = stroke.points.map(([x, y]) => toPixel(x, y)), r = stroke.r * scale;
    if (stroke.closed && pts.length >= 3) {
      const top = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)))), bottom = Math.min(height - 1, Math.ceil(Math.max(...pts.map(p => p.y))));
      for (let y = top; y <= bottom; y++) { // Even-odd scanline fill at pixel centres.
        const cy = y + 0.5, xs = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a.y <= cy) !== (b.y <= cy)) xs.push(a.x + (cy - a.y) * (b.x - a.x) / (b.y - a.y));
        }
        xs.sort((u, v) => u - v);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const x0 = Math.max(0, Math.ceil(xs[i] - 0.5)), x1 = Math.min(width - 1, Math.floor(xs[i + 1] - 0.5));
          if (x1 >= x0) mask.fill(1, y * width + x0, y * width + x1 + 1);
        }
      }
      for (let i = 0; i < pts.length; i++) stampLine(mask, width, height, pts[i], pts[(i + 1) % pts.length], r);
      return;
    }
    let previous = null;
    for (const point of pts) { stampLine(mask, width, height, previous, point, r); previous = point; }
  }

  // Finds visible pieces of the sprite that don't touch (a head floating off its haft) and proposes one straight
  // bridge stroke per gap: the shortest set of links joining every piece (minimum spanning tree over where the
  // pieces' distance fronts meet). Each bridge is a closed polygon around the edges facing each other across the
  // gap, widened so it is at least 2 × `radius` across.
  function autoBridgeStrokes(pixels, width, height, options = {}) {
    const w = width, h = height, n = w * h;
    const radius = Math.max(1, options.radius ?? 16);
    const minAlpha = options.minAlpha ?? 32, minPiece = options.minPiece ?? 64, maxGap = options.maxGap ?? 240;
    const piece = new Int32Array(n).fill(-1), sizes = [];
    const stack = [];
    for (let s0 = 0; s0 < n; s0++) {
      if (piece[s0] >= 0 || pixels[s0 * 4 + 3] < minAlpha) continue;
      const id = sizes.length; let size = 0;
      piece[s0] = id; stack.push(s0);
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p / w) | 0; size++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (piece[q] < 0 && pixels[q * 4 + 3] >= minAlpha) { piece[q] = id; stack.push(q); }
        }
      }
      sizes.push(size);
    }
    const big = sizes.map(size => size >= minPiece); // Specks and stray pixels are never bridged to.
    if (big.filter(Boolean).length < 2) return [];
    // Grow every piece across empty space at once, remembering each empty pixel's nearest piece pixel.
    const origin = new Int32Array(n).fill(-1), owner = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n); let head = 0, tail = 0;
    for (let p = 0; p < n; p++) if (piece[p] >= 0 && big[piece[p]]) { origin[p] = p; owner[p] = piece[p]; queue[tail++] = p; }
    const gapOf = (p, o) => Math.hypot(p % w - o % w, ((p / w) | 0) - ((o / w) | 0));
    while (head < tail) {
      const p = queue[head++], x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (owner[q] >= 0 || piece[q] >= 0 || gapOf(q, origin[p]) > maxGap / 2 + 1) continue;
        origin[q] = origin[p]; owner[q] = owner[p]; queue[tail++] = q;
      }
    }
    const links = new Map(); // "a,b" → [[gap length, origin in a, origin in b], ...] for every meeting point.
    for (let p = 0; p < n; p++) {
      if (owner[p] < 0) continue;
      const x = p % w, y = (p / w) | 0;
      for (const q of [x < w - 1 ? p + 1 : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || owner[q] < 0 || owner[q] === owner[p]) continue;
        const [a, b, oa, ob] = owner[p] < owner[q] ? [owner[p], owner[q], origin[p], origin[q]] : [owner[q], owner[p], origin[q], origin[p]];
        const gap = gapOf(oa, ob), key = a + ',' + b;
        if (gap > maxGap) continue;
        if (!links.has(key)) links.set(key, { a, b, best: Infinity, meets: [] });
        const link = links.get(key);
        link.best = Math.min(link.best, gap); link.meets.push([gap, oa, ob]);
      }
    }
    const root = sizes.map((_, i) => i);
    const find = i => root[i] === i ? i : (root[i] = find(root[i]));
    const strokes = [];
    for (const { a, b, best, meets } of [...links.values()].sort((u, v) => u.best - v.best)) {
      if (find(a) === find(b)) continue;
      root[find(a)] = find(b);
      const near = meets.filter(([gap]) => gap <= best + Math.max(2, best * 0.15)); // The facing stretch of the gap.
      // Each distinct edge pixel counts once: empty space beside the parts traces back to the same corner pixels
      // many times and would otherwise drag the stroke off-centre.
      const edgeA = [...new Set(near.map(m => m[1]))], edgeB = [...new Set(near.map(m => m[2]))];
      const mean = list => list.reduce((acc, p) => [acc[0] + p % w + 0.5, acc[1] + ((p / w) | 0) + 0.5], [0, 0]).map(v => v / list.length);
      const [ax, ay] = mean(edgeA), [bx, by] = mean(edgeB);
      const length = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / length, uy = (by - ay) / length;
      const span = list => { let lo = Infinity, hi = -Infinity; for (const p of list) { const c = (p % w) * -uy + ((p / w) | 0) * ux; lo = Math.min(lo, c); hi = Math.max(hi, c); } return hi - lo + 1; };
      // The bridge is the outline around both facing edges (a closed polygon), widened only as far as needed to
      // reach the minimum width, so a straight cut is rebuilt at exactly its own width.
      const facing = Math.min(span(edgeA), span(edgeB));
      const r = Math.max(2, radius - facing / 2);
      const hull = convexHull(edgeA.concat(edgeB).map(p => [p % w + 0.5, ((p / w) | 0) + 0.5]));
      strokes.push(hull.length >= 3 ? { r, closed: true, points: hull } : { r: Math.max(radius, 2), points: [[ax, ay], [bx, by]] });
    }
    return strokes;
  }

  // Smudge brush, metal only. One step pushes the metal under a disc along the pointer's movement (full strength at
  // the centre, fading to nothing at the rim). Metal that moves covers empty space and outline ink; where it leaves
  // becomes empty. Other materials never move and are never covered. Colors move as whole pixels, so shading bands
  // travel with the metal instead of blurring. `options.region` (one byte per pixel) marks every changed pixel.
  function smudgeStep(pixels, width, height, from, to, radius, options = {}) {
    const w = width, h = height, classify = options.classify || makeClassifier(options), region = options.region;
    const r = Math.max(1, radius), dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
    if (!len) return 0;
    const steps = Math.max(1, Math.ceil(len / Math.max(1, r / 4))), sx = dx / steps, sy = dy / steps;
    let changed = 0;
    for (let i = 1; i <= steps; i++) {
      const cx = from.x + sx * i, cy = from.y + sy * i;
      const pad = Math.ceil(Math.hypot(sx, sy)) + 1; // Sources lie at most one substep behind.
      const bx0 = Math.max(0, Math.floor(cx - r) - pad), by0 = Math.max(0, Math.floor(cy - r) - pad);
      const bx1 = Math.min(w - 1, Math.ceil(cx + r) + pad), by1 = Math.min(h - 1, Math.ceil(cy + r) + pad);
      if (bx1 < bx0 || by1 < by0) continue;
      const bw = bx1 - bx0 + 1, old = new Uint8ClampedArray(bw * (by1 - by0 + 1) * 4); // Pre-step copy to read from.
      for (let y = by0; y <= by1; y++) old.set(pixels.subarray((y * w + bx0) * 4, (y * w + bx1 + 1) * 4), (y - by0) * bw * 4);
      const at = (x, y) => ((y - by0) * bw + (x - bx0)) * 4;
      for (let y = Math.max(by0, Math.floor(cy - r)); y <= Math.min(by1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(bx0, Math.floor(cx - r)); x <= Math.min(bx1, Math.ceil(cx + r)); x++) {
          const d2 = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (r * r);
          if (d2 >= 1) continue;
          const weight = (1 - d2) * (1 - d2);
          const fx = Math.round(x - sx * weight), fy = Math.round(y - sy * weight);
          if (fx === x && fy === y) continue;
          const o = at(x, y), dst = classify(old, o);
          if (dst === OTHER) continue;
          const inside = fx >= bx0 && fy >= by0 && fx <= bx1 && fy <= by1;
          const src = inside ? classify(old, at(fx, fy)) : EMPTY;
          const out = (y * w + x) * 4;
          if (src === METAL) { const so = at(fx, fy); pixels[out] = old[so]; pixels[out + 1] = old[so + 1]; pixels[out + 2] = old[so + 2]; pixels[out + 3] = old[so + 3]; }
          else if (dst === METAL) pixels[out] = pixels[out + 1] = pixels[out + 2] = pixels[out + 3] = 0;
          else continue;
          changed++;
          if (region) region[y * w + x] = 1;
        }
      }
    }
    return changed;
  }

  // Measures the sprite's outline in a window (before any change): its typical thickness, how deep to erase it,
  // and (unless `uniform` or an explicit thickness) a smoothly blended local width. Returns
  // { thickness, eraseDepth, widthFor(frameX, frameY) }.
  function measureOutline(before, w, h, win, classify, options = {}) {
    // 1. Outline widths, measured on the sprite before the change: for every outline pixel touching metal, the
    //    straight-line distance to the nearest empty pixel. The most common width is the outline's thickness
    //    (interior detail joined to the outline, like a blade's groove, only adds a long thin tail of large widths).
    let thickness = options.outlineThickness, eraseDepth = 0;
    let widthFor = () => thickness; // Local outline width near a frame pixel (filled in below when measurable).
    {
      const { wx, wy, ww, wh } = win, m = ww * wh;
      const kinds = new Uint8Array(m), nearestEmpty = new Int32Array(m).fill(-1), queue = []; // Grows: pixels may improve.
      let head = 0;
      for (let i = 0; i < m; i++) kinds[i] = classify(before, (((i / ww) | 0) + wy) * w * 4 + ((i % ww) + wx) * 4);
      for (let i = 0; i < m; i++) if (kinds[i] === EMPTY) { nearestEmpty[i] = i; queue.push(i); }
      while (head < queue.length) {
        const i = queue[head++], x = i % ww, y = (i / ww) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, j = ny * ww + nx;
          if (nx < 0 || ny < 0 || nx >= ww || ny >= wh || kinds[j] !== INK) continue;
          // Keep the closer of the two candidate empty pixels (plain first-come propagation skews diagonally).
          const e = nearestEmpty[i], c = nearestEmpty[j];
          if (c >= 0 && (c % ww - nx) ** 2 + (((c / ww) | 0) - ny) ** 2 <= (e % ww - nx) ** 2 + (((e / ww) | 0) - ny) ** 2) continue;
          nearestEmpty[j] = e; queue.push(j);
        }
      }
      const counts = new Uint32Array(130), sample = new Float32Array(m).fill(-1);
      for (let i = 0; i < m; i++) {
        if (kinds[i] !== INK || nearestEmpty[i] < 0) continue;
        const x = i % ww, y = (i / ww) | 0;
        if (!((x > 0 && kinds[i - 1] === METAL) || (x < ww - 1 && kinds[i + 1] === METAL) ||
            (y > 0 && kinds[i - ww] === METAL) || (y < wh - 1 && kinds[i + ww] === METAL))) continue;
        const e = nearestEmpty[i];
        sample[i] = Math.hypot(e % ww - x, ((e / ww) | 0) - y);
        counts[Math.min(129, Math.round(sample[i]))]++;
      }
      let mode = 0, best = 0, total = 0;
      for (let d = 1; d < 129; d++) {
        const smoothed = counts[d - 1] + 2 * counts[d] + counts[d + 1];
        if (smoothed > best) { best = smoothed; mode = d; }
      }
      for (let d = 1; d <= 2 * mode + 2 && d < 130; d++) total += counts[d];
      if (mode && !thickness) thickness = mode;
      for (let d = 1, seen = 0; mode && d <= 2 * mode + 2 && d < 130; d++) { // 90th percentile of the main body.
        seen += counts[d];
        if (seen >= total * 0.9) { eraseDepth = d; break; }
      }
      if (!thickness) thickness = 3;
      // Local width: the upper-quartile width in each 24 px cell (so cut-off outline ends and stray samples are
      // outvoted), blended smoothly between cells, so new outline matches the original outline nearest to it
      // (a guard's thin outline next to a blade's thick one) without steps. Outliers (interior detail) are left out.
      if (mode && !options.outlineThickness && !options.uniform) { // `uniform`: one even thickness everywhere.
        const C = 24, gx = Math.ceil(ww / C), gy = Math.ceil(wh / C), buckets = Array.from({ length: gx * gy }, () => []);
        for (let i = 0; i < m; i++) if (sample[i] > 0 && sample[i] <= 2 * mode + 2) buckets[((i / ww / C) | 0) * gx + ((i % ww) / C | 0)].push(sample[i]);
        const cell = new Float32Array(gx * gy).fill(-1), fillOrder = [];
        buckets.forEach((list, c) => { if (list.length >= 3) { list.sort((u, v) => u - v); cell[c] = list[Math.floor((list.length - 1) * 0.75)]; fillOrder.push(c); } });
        for (let k = 0; k < fillOrder.length; k++) { // Cells without outline borrow from the nearest that has some.
          const c = fillOrder[k], cx = c % gx, cy = (c / gx) | 0;
          for (const d of [cx > 0 ? c - 1 : -1, cx < gx - 1 ? c + 1 : -1, cy > 0 ? c - gx : -1, cy < gy - 1 ? c + gx : -1]) {
            if (d >= 0 && cell[d] < 0) { cell[d] = cell[c]; fillOrder.push(d); }
          }
        }
        if (fillOrder.length) widthFor = (fx, fy) => {
          const u = Math.max(0, Math.min(gx - 1, (fx - wx) / C - 0.5)), v = Math.max(0, Math.min(gy - 1, (fy - wy) / C - 0.5));
          const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(gx - 1, x0 + 1), y1 = Math.min(gy - 1, y0 + 1), tx = u - x0, ty = v - y0;
          const at = (x, y) => cell[y * gx + x];
          const value = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
          return Math.max(1, Math.min(32, value));
        };
      }
    }
    thickness = Math.max(1, Math.min(32, Math.round(thickness)));
    eraseDepth = Math.max(thickness, Math.min(48, eraseDepth)) + 1;
    return { thickness, eraseDepth, widthFor };
  }

  // Removes the black outline around the metal in the changed area and regenerates it. The sprite's own outline
  // near the change (before it) is measured: its typical width becomes the new thickness, and its widest common
  // width sets how deep the old outline is erased, so none of it is left behind. New outline is drawn around metal
  // that borders empty space. Outline belonging to other materials (wood, grip wraps) and interior detail far from
  // empty space (a blade's groove) are kept. Pass a region of all ones to regenerate the whole sprite's outline.
  function rebuildOutline(before, pixels, width, height, region, options = {}) {
    const w = width, h = height, classify = options.classify || makeClassifier(options);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0, row = y * w; x < w; x++) if (region[row + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return { thickness: 0, erased: 0, drawn: 0 };
    const windowOf = margin => {
      const wx = Math.max(0, x0 - margin), wy = Math.max(0, y0 - margin);
      return { wx, wy, ww: Math.min(w - 1, x1 + margin) - wx + 1, wh: Math.min(h - 1, y1 + margin) - wy + 1 };
    };
    // 1. Outline widths, measured on the sprite before the change (see measureOutline).
    const measured = measureOutline(before, w, h, windowOf(48), classify, options);
    const { thickness, eraseDepth, widthFor } = measured;
    // 2. Work zone: the changed pixels grown by the outline thickness, inside a window around them.
    const { wx, wy, ww, wh } = windowOf(eraseDepth + 2), m = ww * wh;
    const idx = i => (((i / ww) | 0) + wy) * w + (i % ww) + wx; // Window index → frame pixel.
    const kinds = new Uint8Array(m);
    for (let i = 0; i < m; i++) kinds[i] = classify(pixels, idx(i) * 4);
    const near4 = (i, x, y) => [x > 0 ? i - 1 : -1, x < ww - 1 ? i + 1 : -1, y > 0 ? i - ww : -1, y < wh - 1 ? i + ww : -1];
    // Zone = every pixel within reach of a changed one (round, not square, so the regenerated outline has no
    // straight cut-offs where it meets the untouched outline).
    const zone = new Int32Array(m).fill(-1), queue = new Int32Array(m), reach = eraseDepth + 1;
    let head = 0, tail = 0;
    for (let i = 0; i < m; i++) if (region[idx(i)]) { zone[i] = i; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], x = i % ww, y = (i / ww) | 0, e = zone[i], ex = e % ww, ey = (e / ww) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * ww + nx;
        if (nx >= 0 && ny >= 0 && nx < ww && ny < wh && zone[j] < 0 && Math.hypot(nx - ex, ny - ey) <= reach) { zone[j] = e; queue[tail++] = j; }
      }
    }
    // Which material each outline pixel outlines (other materials win ties), and how far it is from empty space.
    const owner = new Int8Array(m).fill(-1); head = tail = 0;
    for (let i = 0; i < m; i++) {
      if (kinds[i] !== INK) continue;
      const x = i % ww, y = (i / ww) | 0;
      for (const j of near4(i, x, y)) {
        if (j >= 0 && kinds[j] === OTHER) { owner[i] = OTHER; break; }
        if (j >= 0 && kinds[j] === METAL) owner[i] = METAL;
      }
      if (owner[i] >= 0) queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++], x = i % ww, y = (i / ww) | 0;
      for (const j of near4(i, x, y)) if (j >= 0 && kinds[j] === INK && owner[j] < 0) { owner[j] = owner[i]; queue[tail++] = j; }
    }
    const fromEmpty = new Int32Array(m).fill(-1); head = tail = 0;
    for (let i = 0; i < m; i++) if (kinds[i] === EMPTY) { fromEmpty[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], x = i % ww, y = (i / ww) | 0;
      if (fromEmpty[i] >= eraseDepth) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * ww + nx;
        if (nx >= 0 && ny >= 0 && nx < ww && ny < wh && kinds[j] === INK && fromEmpty[j] < 0) { fromEmpty[j] = fromEmpty[i] + 1; queue[tail++] = j; }
      }
    }
    // 3. Erase outer outline in the zone (not other materials' outline, and not interior detail far from empty space).
    let erased = 0, drawn = 0;
    for (let i = 0; i < m; i++) {
      if (zone[i] < 0 || kinds[i] !== INK || owner[i] === OTHER || fromEmpty[i] < 0) continue;
      const o = idx(i) * 4; pixels[o] = pixels[o + 1] = pixels[o + 2] = pixels[o + 3] = 0; kinds[i] = EMPTY; erased++;
    }
    // Seams: hairline outline or empty cracks (up to 3 px) between two masses of metal, left where smudges meet,
    // become metal, taking a neighbouring metal pixel's color. Anything wider is real detail and stays.
    const maxSeam = 3;
    const metalWithin = (i, x, y, dx, dy) => {
      for (let k = 1; k <= maxSeam; k++) {
        const nx = x + dx * k, ny = y + dy * k;
        if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) return -1;
        const j = ny * ww + nx;
        if (kinds[j] === METAL) return j;
        if (kinds[j] !== kinds[i]) return -1; // Seams are all outline or all empty, never a mix.
      }
      return -1;
    };
    for (let i = 0; i < m; i++) {
      if (zone[i] < 0 || (kinds[i] !== INK && kinds[i] !== EMPTY) || owner[i] === OTHER) continue;
      const x = i % ww, y = (i / ww) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const a = metalWithin(i, x, y, dx, dy), b = metalWithin(i, x, y, -dx, -dy);
        if (a < 0 || b < 0) continue;
        const o = idx(i) * 4, so = idx(a) * 4;
        pixels[o] = pixels[so]; pixels[o + 1] = pixels[so + 1]; pixels[o + 2] = pixels[so + 2]; pixels[o + 3] = pixels[so + 3];
        erased++; break;
      }
    }
    for (let i = 0; i < m; i++) if (zone[i] >= 0 && kinds[i] <= INK) kinds[i] = classify(pixels, idx(i) * 4);
    // Smoothing (clean-up): with the old outline gone, the metal's edge in the zone is evened out by a square
    // closing (fills dents and pinholes, taking the nearest metal's color) then a square opening (shaves bumps and
    // whiskers thinner than the smoothing size), so the outline drawn next runs smooth.
    const smoothing = Math.max(0, Math.min(12, Math.round(options.smoothing || 0)));
    if (smoothing) {
      const k = smoothing, nearMetal = chessNearest(m, ww, wh, i => kinds[i] === METAL);
      const grown = new Uint8Array(m);
      for (let i = 0; i < m; i++) grown[i] = kinds[i] !== OTHER && chessDist(ww, i, nearMetal[i]) <= k ? 1 : 0;
      const nearOutside = chessNearest(m, ww, wh, i => !grown[i]);
      for (let i = 0; i < m; i++) {
        if (zone[i] < 0 || kinds[i] === METAL || kinds[i] === OTHER || !grown[i] || chessDist(ww, i, nearOutside[i]) <= k) continue;
        const e = nearMetal[i], o = idx(i) * 4, so = idx(e) * 4;
        pixels[o] = pixels[so]; pixels[o + 1] = pixels[so + 1]; pixels[o + 2] = pixels[so + 2]; pixels[o + 3] = pixels[so + 3];
        kinds[i] = METAL; drawn++;
      }
      // Only the outer silhouette is shaved (distance to empty space): metal beside interior detail stays whole.
      const nearEmpty = chessNearest(m, ww, wh, i => kinds[i] === EMPTY);
      const core = new Uint8Array(m);
      for (let i = 0; i < m; i++) core[i] = kinds[i] === METAL && chessDist(ww, i, nearEmpty[i]) > k ? 1 : 0;
      const nearCore = chessNearest(m, ww, wh, i => core[i] === 1);
      for (let i = 0; i < m; i++) {
        if (zone[i] < 0 || kinds[i] !== METAL || chessDist(ww, i, nearCore[i]) <= k) continue;
        const o = idx(i) * 4; pixels[o] = pixels[o + 1] = pixels[o + 2] = pixels[o + 3] = 0; kinds[i] = EMPTY; erased++;
      }
    }
    // Wobble: broad averaging of the metal's edge (see prepareEdge/edgeFlips). With the outline stripped, the shape
    // is everything not empty; the averaging size is picked automatically, as the smallest that brings the edge's
    // wobble (how far it wanders from its own broad average) under a target set by `amount` (0–1, default 0.6),
    // unless `sigma` is given. Flips stay within 0.8× the outline thickness of the original edge.
    let wobble = null;
    if (options.wobble) {
      const spec = options.wobble, amount = Math.max(0, Math.min(1, spec.amount ?? 0.6));
      const solid0 = new Uint8Array(m), only = new Uint8Array(m);
      for (let i = 0; i < m; i++) { solid0[i] = kinds[i] !== EMPTY ? 1 : 0; only[i] = zone[i] >= 0 ? 1 : 0; }
      const refSigma = Math.max(6, 2 * thickness), maxShift = Math.max(3, Math.round(thickness * 0.8));
      const wobbleBefore = maskWobble(solid0, ww, wh, refSigma, only);
      if (amount > 0 || spec.sigma) {
        // Only truly empty space counts as outside here: the outline is already stripped, so any black left is
        // interior detail (a groove) or another material's outline, and must never be filled.
        const ctx = prepareEdge(kinds, { wx, wy, ww, wh }, { outerBand: 0 });
        const reach = eraseDepth + 1; // The edge averaging fades to nothing toward the cleaned area's border.
        const fade = i => {
          const e = zone[i];
          if (e < 0) return 0;
          const t = Math.min(1, Math.hypot(e % ww - i % ww, ((e / ww) | 0) - ((i / ww) | 0)) / reach), u = 1 - t;
          return u * u * (3 - 2 * u);
        };
        const flipOptions = { maxShift, bias: 0, solidKind: k => k !== EMPTY, only, weight: fade };
        // The wobble is measured for every averaging size; the best calm-down any size achieves counts as 100%
        // (part of the "wobble" is the weapon's own shape, which no size removes), and `amount` says how much of it
        // to take: the smallest size reaching that share is used. Flips are bounded by maxShift, so thin parts
        // cannot be eaten however large the size.
        const candidates = spec.sigma ? [spec.sigma] : [2, 3, 5, 8, 12, 16, 24];
        const trials = [];
        for (const sigma of candidates) {
          const flips = edgeFlips(ctx, sigma, flipOptions), trial = Uint8Array.from(solid0);
          for (const i of flips.on) trial[i] = 1;
          for (const i of flips.off) trial[i] = 0;
          trials.push({ sigma, flips, wob: maskWobble(trial, ww, wh, refSigma, only) });
        }
        const best = Math.min(wobbleBefore, ...trials.map(t => t.wob)), room = wobbleBefore - best;
        const pick = trials.find(t => room <= 1e-6 || (wobbleBefore - t.wob) >= amount * room - 1e-9) || trials[trials.length - 1];
        const chosen = pick.flips, chosenSigma = pick.sigma;
        applyEdgeFlips(pixels, w, ctx, chosen, region);
        const solid1 = new Uint8Array(m);
        for (let i = 0; i < m; i++) solid1[i] = kinds[i] !== EMPTY ? 1 : 0;
        wobble = { before: wobbleBefore, after: maskWobble(solid1, ww, wh, refSigma, only), sigma: chosenSigma, moved: chosen.on.length + chosen.off.length };
      } else wobble = { before: wobbleBefore, after: wobbleBefore, sigma: 0, moved: 0 };
    }
    // 4. Draw new outline: empty pixels in the zone within `thickness` of metal.
    const source = new Int32Array(m).fill(-1); head = tail = 0;
    for (let i = 0; i < m; i++) {
      if (kinds[i] !== METAL) continue;
      const x = i % ww, y = (i / ww) | 0;
      if (near4(i, x, y).some(j => j >= 0 && kinds[j] === EMPTY)) { source[i] = i; queue[tail++] = i; }
    }
    while (head < tail) {
      const i = queue[head++], x = i % ww, y = (i / ww) | 0, e = source[i], ex = e % ww, ey = (e / ww) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * ww + nx;
        if (nx < 0 || ny < 0 || nx >= ww || ny >= wh || source[j] >= 0 || kinds[j] !== EMPTY) continue;
        if (Math.hypot(nx - ex, ny - ey) > widthFor(ex + wx, ey + wy) + 0.5) continue; // Local width; half-pixel slack.
        source[j] = e; queue[tail++] = j;
        if (zone[j] < 0) continue;
        const o = idx(j) * 4; pixels[o] = pixels[o + 1] = pixels[o + 2] = 0; pixels[o + 3] = 255; drawn++;
      }
    }
    return { thickness, erased, drawn, wobble };
  }

  // Weighted revert: within the brush, each pass flips a weighted random share of pixels back to `reference` (the
  // image before smudging): strongest at the centre, scaled by strength. Whole pixels, so no new in-between colors;
  // repeated passes converge on the reference.
  function revertStep(pixels, reference, width, height, from, to, radius, options = {}) {
    const w = width, h = height, r = Math.max(1, radius), strength = Math.max(0, Math.min(1, options.strength ?? 0.35));
    const random = options.random || Math.random, region = options.region;
    const len = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(1, Math.ceil(len / Math.max(1, r / 2)));
    let changed = 0;
    for (let i = 1; i <= steps; i++) {
      const cx = from.x + (to.x - from.x) * i / steps, cy = from.y + (to.y - from.y) * i / steps;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
          const d2 = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (r * r);
          if (d2 >= 1) continue;
          const roll = random(), o = (y * w + x) * 4;
          if (roll >= strength * (1 - d2) * (1 - d2)) continue;
          if (pixels[o] === reference[o] && pixels[o + 1] === reference[o + 1] && pixels[o + 2] === reference[o + 2] && pixels[o + 3] === reference[o + 3]) continue;
          pixels[o] = reference[o]; pixels[o + 1] = reference[o + 1]; pixels[o + 2] = reference[o + 2]; pixels[o + 3] = reference[o + 3];
          changed++; if (region) region[y * w + x] = 1;
        }
      }
    }
    return changed;
  }

  // Pixel plow: a rectangular blade (2 × radius long, across the drag direction) moved from `from` to `to`. In each
  // lane across the blade, metal it sweeps over piles up flat against its front edge and shoves the metal already
  // in front of it along as one, like a bulldozer; the blade leaves empty space behind. Other materials block a
  // lane (nothing in it moves). Returns the blade's direction so the next step can keep it.
  function plowStep(pixels, width, height, from, to, radius, options = {}) {
    const w = width, h = height, classify = options.classify || makeClassifier(options), region = options.region;
    const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
    if (len < 0.5) return 0;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux; // Drag direction and the blade's long axis.
    const half = Math.max(1, radius), depth = Math.max(2, Math.round(radius / 4)), front = depth / 2;
    const reach = Math.ceil(half * 2 + len + 8); // How far ahead a pushed chain may extend.
    const claimed = new Uint8Array(w * h); // Each pixel belongs to one lane per step.
    const pix = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? -1 : y * w + x;
    let changed = 0;
    for (let v = -half; v <= half; v += 0.5) {
      const lane = [], seen = new Set();
      for (let u = -front - len - 1; u <= front + reach; u += 0.5) {
        const p = pix(Math.round(to.x + ux * u + nx * v - 0.5), Math.round(to.y + uy * u + ny * v - 0.5));
        if (p < 0) { lane.push({ p: -1, u }); break; }
        if (seen.has(p) || claimed[p]) continue;
        seen.add(p); lane.push({ p, u });
      }
      const swept = lane.filter(c => c.p >= 0 && c.u <= front), ahead = lane.filter(c => c.u > front);
      const load = swept.filter(c => classify(pixels, c.p * 4) === METAL);
      if (!load.length) { for (const c of lane) if (c.p >= 0) claimed[c.p] = 1; continue; }
      let chain = 0; // Metal already against the blade's front, which gets shoved along.
      while (chain < ahead.length && ahead[chain].p >= 0 && classify(pixels, ahead[chain].p * 4) === METAL) chain++;
      const need = load.length + chain;
      let room = need <= ahead.length;
      for (let k = chain; room && k < need; k++) { const c = ahead[k]; room = c.p >= 0 && classify(pixels, c.p * 4) <= INK; }
      if (!room) continue; // Blocked by another material or the frame edge.
      const colors = load.concat(ahead.slice(0, chain)).map(c => pixels.slice(c.p * 4, c.p * 4 + 4));
      for (const c of load) { const o = c.p * 4; pixels[o] = pixels[o + 1] = pixels[o + 2] = pixels[o + 3] = 0; if (region) region[c.p] = 1; }
      for (let k = 0; k < need; k++) { pixels.set(colors[k], ahead[k].p * 4); if (region) region[ahead[k].p] = 1; }
      for (const c of lane) if (c.p >= 0) claimed[c.p] = 1;
      changed += load.length;
    }
    return changed;
  }

  // Nearest-source propagation with improvement, in square (chessboard) distance over a ww×wh window: a square
  // closing fills square dents completely and leaves flat and diagonal edges exactly where they are, so repeated
  // smoothing never grows or shrinks a clean shape.
  function chessNearest(m, ww, wh, isSource) { // Plain multi-source BFS: 8-connected steps are exact chessboard distance.
    const near = new Int32Array(m).fill(-1), queue = new Int32Array(m);
    let head = 0, tail = 0;
    for (let i = 0; i < m; i++) if (isSource(i)) { near[i] = i; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], x = i % ww, y = (i / ww) | 0, e = near[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= ww || qy >= wh) continue;
        const j = qy * ww + qx;
        if (near[j] < 0) { near[j] = e; queue[tail++] = j; }
      }
    }
    return near;
  }
  const chessDist = (ww, i, e) => e < 0 ? Infinity : Math.max(Math.abs(e % ww - i % ww), Math.abs(((e / ww) | 0) - ((i / ww) | 0)));

  // Broad averaging: a Gaussian blur (three box passes per axis) of a float field over a ww×wh window.
  function gaussBlur(field, ww, wh, sigma) {
    if (sigma < 0.5) return Float32Array.from(field);
    const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2)), win = 2 * r + 1;
    let a = Float32Array.from(field), b = new Float32Array(field.length);
    const line = (src, dst, n, stride, offset) => {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[offset + Math.max(0, Math.min(n - 1, k)) * stride];
      for (let k = 0; k < n; k++) {
        dst[offset + k * stride] = sum / win;
        sum += src[offset + Math.min(n - 1, k + r + 1) * stride] - src[offset + Math.max(0, k - r) * stride];
      }
    };
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < wh; y++) line(a, b, ww, 1, y * ww);
      for (let x = 0; x < ww; x++) line(b, a, wh, ww, x);
    }
    return a;
  }
  // Edge roughness: how much longer the shape's edge is than a broadly smoothed version of the same shape (0 =
  // as smooth as its own average; 0.2 = 20% extra edge from wobble). Comparing against the shape's own smoothed
  // outline makes the measure independent of the weapon's overall shape. `solid` is 1 inside the shape; only edge
  // cells inside `only` (when given) are counted.
  function maskWobble(solid, ww, wh, refSigma, only) {
    const field = gaussBlur(solid, ww, wh, refSigma);
    let own = 0, ref = 0;
    for (let y = 1; y < wh - 1; y++) for (let x = 1; x < ww - 1; x++) {
      const i = y * ww + x;
      if (only && !only[i]) continue;
      const s = solid[i], r = field[i] >= 0.5 ? 1 : 0;
      for (const j of [i + 1, i + ww]) {
        if (s !== solid[j]) own++;
        if (r !== (field[j] >= 0.5 ? 1 : 0)) ref++;
      }
    }
    return ref ? Math.max(0, own / ref - 1) : 0;
  }
  // Edge averaging in a window of the frame (win = {wx, wy, ww, wh}; kinds holds each pixel's class). The shape
  // (pixels whose kind passes `solidKind`) is blurred broadly; metal pixels near the edge whose blurred value says
  // "outside" are removed (bumps shaved) and outline/empty pixels near the metal whose blurred value says "inside"
  // are filled with the nearest metal's color (dents filled), so both are pulled toward the local mean line.
  // Changes are bounded by `maxShift`, never reach interior detail (fills only happen in the outer outline band),
  // and can be weighted per pixel. prepareEdge does the distance work once; edgeFlips can run for several sigmas.
  function prepareEdge(kinds, win, options = {}) {
    const { ww, wh } = win, m = ww * wh, outerBand = options.outerBand ?? Infinity;
    const nearEmpty = chessNearest(m, ww, wh, i => kinds[i] === EMPTY);
    const isOuter = i => kinds[i] === EMPTY || (kinds[i] === INK && chessDist(ww, i, nearEmpty[i]) <= outerBand);
    const outer = new Uint8Array(m);
    for (let i = 0; i < m; i++) outer[i] = isOuter(i) ? 1 : 0;
    return { kinds, win, m, outer, nearOuter: chessNearest(m, ww, wh, i => outer[i] === 1),
      nearMetal: chessNearest(m, ww, wh, i => kinds[i] === METAL) };
  }
  function edgeFlips(ctx, sigma, options = {}) {
    const { kinds, win, m, outer, nearOuter, nearMetal } = ctx, { ww, wh } = win;
    const maxShift = Math.max(1, Math.round(options.maxShift ?? sigma)), bias = options.bias ?? 0;
    const solidKind = options.solidKind || (k => k !== EMPTY), weight = options.weight, only = options.only;
    const shave = options.shave !== false; // false: only fill dents, never remove metal (keeps sharp corners).
    const solid = new Float32Array(m);
    for (let i = 0; i < m; i++) solid[i] = solidKind(kinds[i]) ? 1 : 0;
    const field = gaussBlur(solid, ww, wh, sigma), off = [], on = [];
    for (let i = 0; i < m; i++) {
      if (only && !only[i]) continue;
      const wgt = weight ? weight(i) : 1;
      if (wgt <= 0) continue;
      if (kinds[i] === METAL) {
        if (shave && field[i] < wgt * (0.5 - bias) && chessDist(ww, i, nearOuter[i]) <= maxShift) off.push(i);
      } else if (outer[i] && nearMetal[i] >= 0) {
        if (field[i] > 1 - wgt * (0.5 + bias) && chessDist(ww, i, nearMetal[i]) <= maxShift) on.push(i);
      }
    }
    return { off, on, solid };
  }
  // Applies flips from edgeFlips to the frame's pixels and the window's kinds.
  function applyEdgeFlips(pixels, w, ctx, flips, region) {
    const { kinds, win, nearMetal } = ctx, { wx, wy, ww } = win;
    const at = i => (((i / ww) | 0) + wy) * w + (i % ww) + wx;
    for (const i of flips.on) pixels.copyWithin(at(i) * 4, at(nearMetal[i]) * 4, at(nearMetal[i]) * 4 + 4);
    for (const i of flips.off) { const o = at(i) * 4; pixels[o] = pixels[o + 1] = pixels[o + 2] = pixels[o + 3] = 0; }
    for (const i of flips.on) { kinds[i] = METAL; if (region) region[at(i)] = 1; }
    for (const i of flips.off) { kinds[i] = EMPTY; if (region) region[at(i)] = 1; }
  }

  // Puff out: inside the brush, dents in the metal's edge are filled by a closing at a size that scales with the
  // brush (strength × 80% of the radius, up to 24 px, so dents up to twice that wide fill), the way a wrinkly bag
  // smooths when packed with air: dents fill out, bumps and sharp corners stay and a straight edge never grows.
  // Fills happen only where the black can reach open space through black alone within the outline's width
  // (`outlineWidth`) plus the closing size (a dent of depth d is black outline + d deep and opens straight to the
  // outside), so interior detail such as a blade's groove, which only reaches open space by running its whole
  // length, is not filled however close its sides are. Returns how many pixels were filled.
  function puffStep(pixels, width, height, at, radius, options = {}) {
    const w = width, h = height, classify = options.classify || makeClassifier(options), region = options.region;
    const r = Math.max(1, radius), strength = Math.max(0.05, Math.min(1, options.strength ?? 0.5));
    const k = Math.max(1, Math.min(24, Math.round(r * strength * 0.8)));
    const band = Math.max(3, Math.round(options.outlineWidth ?? 12)) + k;
    const margin = k + band + 3;
    // The window may extend past the frame: beyond it is open space, which a closing must see to leave edges alone.
    const wx = Math.floor(at.x - r - margin), wy = Math.floor(at.y - r - margin);
    const ww = Math.ceil(at.x + r + margin) - wx + 1, wh = Math.ceil(at.y + r + margin) - wy + 1;
    if (ww < 3 || wh < 3) return 0;
    const m = ww * wh, kinds = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      const fx = (i % ww) + wx, fy = ((i / ww) | 0) + wy;
      kinds[i] = fx < 0 || fy < 0 || fx >= w || fy >= h ? EMPTY : classify(pixels, (fy * w + fx) * 4);
    }
    const nearMetal = chessNearest(m, ww, wh, i => kinds[i] === METAL);
    const geo = new Int32Array(m).fill(-1), geoQueue = new Int32Array(m); // Steps to open space through black only.
    let gh = 0, gt = 0;
    for (let i = 0; i < m; i++) if (kinds[i] === EMPTY) { geo[i] = 0; geoQueue[gt++] = i; }
    while (gh < gt) {
      const i = geoQueue[gh++], x = i % ww, y = (i / ww) | 0;
      if (geo[i] >= band) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= ww || qy >= wh) continue;
        const j = qy * ww + qx;
        if (geo[j] < 0 && kinds[j] === INK) { geo[j] = geo[i] + 1; geoQueue[gt++] = j; }
      }
    }
    const dilated = new Uint8Array(m);
    for (let i = 0; i < m; i++) dilated[i] = kinds[i] !== OTHER && chessDist(ww, i, nearMetal[i]) <= k ? 1 : 0;
    const nearOutside = chessNearest(m, ww, wh, i => !dilated[i]);
    let changed = 0;
    for (let i = 0; i < m; i++) {
      const kind = kinds[i];
      if (!dilated[i] || (kind !== EMPTY && !(kind === INK && geo[i] >= 0))) continue; // Black that opens to the outside only.
      if (chessDist(ww, i, nearOutside[i]) <= k) continue; // Still within k of open space: not inside a dent.
      const fx = (i % ww) + wx, fy = ((i / ww) | 0) + wy;
      if (fx < 0 || fy < 0 || fx >= w || fy >= h || (fx + 0.5 - at.x) ** 2 + (fy + 0.5 - at.y) ** 2 >= r * r) continue;
      const e = nearMetal[i], so = (((e / ww) | 0) + wy) * w * 4 + ((e % ww) + wx) * 4, o = (fy * w + fx) * 4;
      pixels[o] = pixels[so]; pixels[o + 1] = pixels[so + 1]; pixels[o + 2] = pixels[so + 2]; pixels[o + 3] = pixels[so + 3];
      changed++; if (region) region[fy * w + fx] = 1;
    }
    return changed;
  }

  // Pulls outline black out of the metal, inside `region`:
  //  - grime: metal pixels darker than the metal's own shaded tone (the hand-drawn outline's dark, blurry fringe,
  //    spread through the metal by smudging) take the color of the nearest clean metal;
  //  - specks: blobs of outline-black up to `speck` pixels that touch no empty space and no other material take the
  //    color of the nearest metal. Interior detail (a blade's groove) is larger or joined to the outline, so it stays.
  function removeSpecks(pixels, width, height, region, options = {}) {
    const w = width, h = height, n = w * h, classify = options.classify || makeClassifier(options);
    const speck = Math.max(0, Math.round(options.speck ?? 40));
    const kinds = new Uint8Array(n), lumas = [];
    for (let p = 0; p < n; p++) { kinds[p] = classify(pixels, p * 4); if (kinds[p] === METAL) lumas.push(luma(pixels, p * 4)); }
    let removed = 0;
    if (lumas.length > 16) {
      // The shaded tone is the most common brightness below the shaded/unshaded split; grime is clearly darker.
      const split = otsu(lumas), hist = new Uint32Array(256);
      for (const v of lumas) if (v < split) hist[Math.round(v)]++;
      let mode = 0, best = -1;
      for (let b = 2; b < 254; b++) { const sum = hist[b - 2] + hist[b - 1] + hist[b] + hist[b + 1] + hist[b + 2]; if (sum > best) { best = sum; mode = b; } }
      const grime = mode - Math.max(8, (options.grimeTolerance ?? 0.15) * mode);
      const dirty = p => kinds[p] === METAL && luma(pixels, p * 4) < grime;
      const nearClean = chessNearest(n, w, h, p => kinds[p] === METAL && !dirty(p));
      for (let p = 0; p < n; p++) {
        if (!region[p] || !dirty(p) || nearClean[p] < 0) continue;
        pixels.copyWithin(p * 4, nearClean[p] * 4, nearClean[p] * 4 + 4); removed++;
      }
    }
    if (!speck) return removed;
    const seen = new Uint8Array(n), nearMetal = chessNearest(n, w, h, p => kinds[p] === METAL);
    for (let s0 = 0; s0 < n; s0++) {
      if (kinds[s0] !== INK || seen[s0]) continue;
      const blob = [s0]; let open = false, touched = !!region[s0];
      seen[s0] = 1;
      for (let k = 0; k < blob.length; k++) {
        const p = blob[k], x = p % w, y = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx, qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) { open = true; continue; }
          const q = qy * w + qx;
          if (kinds[q] === EMPTY || kinds[q] === OTHER) open = true;
          else if (kinds[q] === INK && !seen[q]) { seen[q] = 1; blob.push(q); if (region[q]) touched = true; }
        }
        if (blob.length > speck) open = true; // Too big to be a speck; keep walking only to mark it seen.
      }
      if (open || !touched) continue;
      for (const p of blob) {
        const e = nearMetal[p]; if (e < 0) continue;
        pixels.copyWithin(p * 4, e * 4, e * 4 + 4); removed++;
      }
    }
    return removed;
  }
  // Marks every pixel that differs from `base`: the brush-worked areas, so a clean-up only touches generated
  // outline and leaves the original artwork (tapered outline tips, thin authored lines) exactly as drawn.
  function changedRegion(pixels, base) {
    const region = new Uint8Array(pixels.length / 4);
    let any = 0;
    for (let p = 0, o = 0; p < region.length; p++, o += 4) {
      if (pixels[o] !== base[o] || pixels[o + 1] !== base[o + 1] || pixels[o + 2] !== base[o + 2] || pixels[o + 3] !== base[o + 3]) { region[p] = 1; any++; }
    }
    return any ? region : null;
  }
  // Clean up outline: pull stray black out of the metal, then strip, smooth and regenerate the outline around the
  // metal in `region`, at one even thickness unless `uniform` is false.
  function cleanOutline(pixels, width, height, region, options = {}) {
    const before = new Uint8ClampedArray(pixels), classify = options.classify || makeClassifier(options);
    const specks = removeSpecks(pixels, width, height, region, { ...options, classify });
    return { specks, ...rebuildOutline(before, pixels, width, height, region, { uniform: true, smoothing: 2, ...options, classify }) };
  }

  // Reads the art's own style from `pixels` outside `region` (the untouched art; all the art when too little is
  // left): the metal's flat tones (the shaded and unshaded colors, each the median of its most common brightness),
  // the brightness that separates them, and the smallest tone pool the art ever uses (10th percentile of tone
  // patch sizes, bounded to 8–80 px). Outline thickness is measured separately, by measureOutline.
  const DEFAULT_TONES = [[57, 82, 80, 255], [81, 116, 112, 255]]; // Stock weapon metal: shaded, unshaded.
  function learnStyle(pixels, width, height, region, options = {}) {
    const w = width, h = height, n = w * h, classify = options.classify || makeClassifier(options);
    const kinds = new Uint8Array(n);
    for (let p = 0; p < n; p++) kinds[p] = classify(pixels, p * 4);
    const interior = p => { // Metal with only metal around it: not the blurry fringe.
      const x = p % w, y = (p / w) | 0;
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (kinds[p + dy * w + dx] !== METAL) return false;
      return true;
    };
    let samples = [];
    for (let p = 0; p < n; p++) if (kinds[p] === METAL && !region[p] && interior(p)) samples.push(p);
    const fromUntouched = samples.length >= 200;
    if (!fromUntouched) { samples = []; for (let p = 0; p < n; p++) if (kinds[p] === METAL && interior(p)) samples.push(p); }
    if (samples.length < 20) return { tones: DEFAULT_TONES, threshold: luma(DEFAULT_TONES[1], 0) * 0.5 + luma(DEFAULT_TONES[0], 0) * 0.5, minPool: 30, single: false, fromUntouched: false, learned: false };
    const lumas = samples.map(p => luma(pixels, p * 4));
    let low = Infinity, high = -Infinity;
    for (const v of lumas) { if (v < low) low = v; if (v > high) high = v; }
    const single = high - low < 12, threshold = single ? -1 : otsu(lumas);
    const toneOf = p => luma(pixels, p * 4) < threshold ? 0 : 1;
    const tones = [0, 1].map(t => {
      const own = samples.filter(p => toneOf(p) === t);
      if (!own.length) return null;
      const hist = new Uint32Array(256);
      for (const p of own) hist[Math.round(luma(pixels, p * 4))]++;
      let mode = 0, best = -1;
      for (let b = 0; b < 256; b++) {
        let sum = 0;
        for (let k = Math.max(0, b - 3); k <= Math.min(255, b + 3); k++) sum += hist[k];
        if (sum > best) { best = sum; mode = b; }
      }
      const core = own.filter(p => Math.abs(luma(pixels, p * 4) - mode) <= 6);
      return medianColor(pixels, (core.length ? core : own).map(p => p * 4));
    });
    if (!tones[0]) tones[0] = tones[1]; if (!tones[1]) tones[1] = tones[0];
    // Smallest tone pool: sizes of connected same-tone patches among the sampled metal.
    const label = new Int32Array(n).fill(-1), tone = new Int8Array(n).fill(-1);
    for (const p of samples) tone[p] = single ? 0 : toneOf(p);
    const sizes = [];
    for (const s0 of samples) {
      if (label[s0] >= 0) continue;
      const stack = [s0]; label[s0] = sizes.length; let size = 0;
      while (stack.length) {
        const p = stack.pop(); size++;
        const x = p % w, y = (p / w) | 0;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && label[q] < 0 && tone[q] === tone[s0]) { label[q] = label[s0]; stack.push(q); }
        }
      }
      sizes.push(size);
    }
    sizes.sort((a, b) => a - b);
    const minPool = sizes.length >= 5 ? Math.max(8, Math.min(80, sizes[Math.floor((sizes.length - 1) * 0.1)])) : 30;
    return { tones, threshold, minPool, single, fromUntouched, learned: true };
  }
  // Merges tone patches smaller than `minPool` (touching the worked region) into the tone around them, so flat
  // shading stays in a few broad pools instead of speckle.
  function mergePools(pixels, width, height, region, style, minPool, classify) {
    const w = width, h = height, n = w * h;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0, row = y * w; x < w; x++) if (region[row + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return 0;
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
    const toneAt = p => classify(pixels, p * 4) !== METAL ? -1 : (style.single || luma(pixels, p * 4) >= style.threshold ? (style.single ? 0 : 1) : 0);
    let merged = 0;
    for (let pass = 0; pass < 5; pass++) {
      const label = new Int32Array(n).fill(-1), tone = new Int8Array(n).fill(-1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tone[y * w + x] = toneAt(y * w + x);
      let changed = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const s0 = y * w + x;
        if (tone[s0] < 0 || label[s0] >= 0) continue;
        const patch = [s0]; label[s0] = s0; let touched = !!region[s0];
        for (let k = 0; k < patch.length; k++) {
          const p = patch[k], px = p % w, py = (p / w) | 0;
          for (const q of [px > x0 ? p - 1 : -1, px < x1 ? p + 1 : -1, py > y0 ? p - w : -1, py < y1 ? p + w : -1]) {
            if (q >= 0 && label[q] < 0 && tone[q] === tone[s0]) { label[q] = s0; patch.push(q); if (region[q]) touched = true; }
          }
        }
        if (patch.length >= minPool || !touched) continue;
        const votes = [0, 0];
        for (const p of patch) {
          const px = p % w, py = (p / w) | 0;
          for (const q of [px > x0 ? p - 1 : -1, px < x1 ? p + 1 : -1, py > y0 ? p - w : -1, py < y1 ? p + w : -1]) {
            if (q >= 0 && tone[q] >= 0 && tone[q] !== tone[s0]) votes[tone[q]]++;
          }
        }
        const other = tone[s0] === 0 ? 1 : 0;
        if (!votes[other]) continue; // Not touching the other tone: nothing to merge into.
        for (const p of patch) pixels.set(style.tones[other], p * 4);
        changed++; merged += patch.length;
      }
      if (!changed) break;
    }
    return merged;
  }
  // Even out outline wobble: inside `region`, strips the outline, averages the metal's edge broadly (bumps pulled
  // in, dents pulled out toward the local mean line; the averaging size is picked automatically from how much the
  // edge wobbles, `amount` 0–1 sets how calm it must get) and redraws the outline at one even thickness. Reports
  // the wobble before and after (px).
  function evenOutline(pixels, width, height, region, options = {}) {
    const before = new Uint8ClampedArray(pixels), classify = options.classify || makeClassifier(options);
    return rebuildOutline(before, pixels, width, height, region, { uniform: true, smoothing: 1, ...options, classify,
      wobble: { amount: options.amount ?? 0.6, sigma: options.sigma } });
  }
  // Clean up to the art's style: inside `region`, pulls black out of the metal, flattens the metal to the art's own
  // tones (every metal pixel becomes exactly the shaded or unshaded color, black outline pure black, no
  // half-transparent pixels), merges tone patches smaller than the art's smallest pool into the tone around them,
  // then evens out the outline as above. Style (tones, smallest pool) is read from the untouched art.
  function styleCleanup(pixels, width, height, region, options = {}) {
    const w = width, h = height, n = w * h, before = new Uint8ClampedArray(pixels), classify = options.classify || makeClassifier(options);
    const style = learnStyle(pixels, w, h, region, { classify });
    const specks = removeSpecks(pixels, w, h, region, { classify, speck: options.speck ?? 40 });
    let snapped = 0;
    for (let p = 0; p < n; p++) {
      if (!region[p]) continue;
      const o = p * 4, kind = classify(pixels, o);
      if (kind === METAL) {
        const tone = style.single || luma(pixels, o) >= style.threshold ? (style.single ? 0 : 1) : 0, c = style.tones[tone];
        if (pixels[o] !== c[0] || pixels[o + 1] !== c[1] || pixels[o + 2] !== c[2] || pixels[o + 3] !== 255) { pixels.set(c, o); snapped++; }
      } else if (kind === INK) pixels.set([0, 0, 0, 255], o);
      else if (kind === EMPTY && pixels[o + 3]) pixels[o] = pixels[o + 1] = pixels[o + 2] = pixels[o + 3] = 0;
    }
    const minPool = options.pool > 0 ? options.pool : style.minPool;
    const merged = mergePools(pixels, w, h, region, style, minPool, classify);
    const rebuilt = rebuildOutline(before, pixels, w, h, region, { uniform: true, smoothing: 1, classify, wobble: { amount: options.amount ?? 0.6 } });
    return { specks, snapped, merged, minPool, style, ...rebuilt };
  }

  // One brush stroke of the smudge-family tools (smudge, revert, plow, puff), stepped point by point so the editor's
  // live preview and the saved replay run the exact same steps. finish() rebuilds the outline around what changed.
  function toolStepper(pixels, width, height, op, options = {}) {
    const tool = op.tool || (op.smudge ? 'smudge' : '');
    const classify = options.classify || makeClassifier(options), region = new Uint8Array(width * height);
    const before = new Uint8ClampedArray(pixels), random = mulberry32(op.seed ?? 1), scale = options.scale ?? 1;
    const r = op.r * scale, strength = op.strength;
    let changed = 0, outlineWidth = null;
    return {
      region,
      step(from, to) {
        if (tool === 'smudge') changed += smudgeStep(pixels, width, height, from, to, r, { classify, region });
        else if (tool === 'revert' && options.reference) changed += revertStep(pixels, options.reference, width, height, from, to, r, { strength, random, region });
        else if (tool === 'plow') changed += plowStep(pixels, width, height, from, to, r, { classify, region });
        else if (tool === 'clean') { stampLine(region, width, height, from, to, r); changed++; } // Applied on finish.
        else if (tool === 'puff') {
          if (outlineWidth === null) { // Measured once per stroke, near where it starts, on the image before the stroke.
            const margin = Math.ceil(r) + 60, wx = Math.max(0, Math.floor(from.x - margin)), wy = Math.max(0, Math.floor(from.y - margin));
            const win = { wx, wy, ww: Math.min(width - 1, Math.ceil(from.x + margin)) - wx + 1, wh: Math.min(height - 1, Math.ceil(from.y + margin)) - wy + 1 };
            outlineWidth = win.ww > 2 && win.wh > 2 ? measureOutline(before, width, height, win, classify, { uniform: true }).eraseDepth : 12;
          }
          const len = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(1, Math.ceil(len / Math.max(1, r / 3)));
          for (let i = 1; i <= steps; i++) changed += puffStep(pixels, width, height,
            { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }, r, { classify, region, strength, outlineWidth });
        }
        return changed;
      },
      finish() {
        if (tool === 'clean') return { changed, ...cleanOutline(pixels, width, height, region, { ...options, classify,
          smoothing: (op.smoothing ?? 2) * scale, speck: (op.speck ?? 40) * scale * scale }) };
        return { changed, ...rebuildOutline(before, pixels, width, height, region, { ...options, classify }) };
      }
    };
  }
  // Replays one saved smudge-family stroke (points in stored coordinates) and rebuilds the outline, in place.
  function toolStroke(pixels, width, height, op, toPixel = (x, y) => ({ x, y }), scale = 1, options = {}) {
    const stepper = toolStepper(pixels, width, height, op, { ...options, scale });
    const pts = op.points.map(([x, y]) => toPixel(x, y));
    if (pts.length === 1) stepper.step(pts[0], pts[0]);
    for (let i = 1; i < pts.length; i++) stepper.step(pts[i - 1], pts[i]);
    return stepper.finish();
  }
  const smudgeStroke = (pixels, width, height, stroke, toPixel, scale, options) =>
    toolStroke(pixels, width, height, { ...stroke, tool: 'smudge' }, toPixel, scale, options);

  // Separate shading: where shaded and unshaded metal are mixed together (a pixel's 5×5 neighbourhood is more than
  // `tolerance` the other tone), the pixels swap colors so each tone gathers into larger pools: within each mixed
  // patch, the pixels with the most unshaded metal around them (within `pool` pixels) become the unshaded ones.
  // Each patch keeps its count of each tone and its exact colors, so nothing new is painted.
  function separateShading(pixels, width, height, options = {}) {
    const w = width, h = height, n = w * h, classify = options.classify || makeClassifier(options);
    const tolerance = Math.max(0, Math.min(0.5, options.tolerance ?? 0.2)), pool = Math.max(1, Math.round(options.pool ?? 5));
    const metal = new Uint8Array(n), lumas = [];
    for (let p = 0; p < n; p++) if (classify(pixels, p * 4) === METAL) { metal[p] = 1; lumas.push(luma(pixels, p * 4)); }
    if (lumas.length < 4) return { swapped: 0, patches: 0 };
    const threshold = otsu(lumas), lit = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (metal[p] && luma(pixels, p * 4) >= threshold) lit[p] = 1;
    const stride = w + 1, sumM = new Float64Array(stride * (h + 1)), sumL = new Float64Array(stride * (h + 1));
    for (let y = 0; y < h; y++) {
      let rm = 0, rl = 0;
      for (let x = 0; x < w; x++) {
        rm += metal[y * w + x]; rl += lit[y * w + x];
        sumM[(y + 1) * stride + x + 1] = sumM[y * stride + x + 1] + rm; sumL[(y + 1) * stride + x + 1] = sumL[y * stride + x + 1] + rl;
      }
    }
    const litShare = (x, y, rad) => {
      const l = Math.max(0, x - rad), t = Math.max(0, y - rad), r = Math.min(w, x + rad + 1), b = Math.min(h, y + rad + 1);
      const mm = sumM[b * stride + r] - sumM[t * stride + r] - sumM[b * stride + l] + sumM[t * stride + l];
      const ll = sumL[b * stride + r] - sumL[t * stride + r] - sumL[b * stride + l] + sumL[t * stride + l];
      return mm ? ll / mm : 0;
    };
    const mixed = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (metal[p]) {
      const share = litShare(p % w, (p / w) | 0, 2);
      if ((lit[p] ? 1 - share : share) > tolerance) mixed[p] = 1;
    }
    const seen = new Uint8Array(n);
    let swapped = 0, patches = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (!mixed[s0] || seen[s0]) continue;
      const patch = [s0]; seen[s0] = 1;
      for (let k = 0; k < patch.length; k++) {
        const p = patch[k], x = p % w, y = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const qx = x + dx, qy = y + dy, q = qy * w + qx;
          if (qx >= 0 && qy >= 0 && qx < w && qy < h && mixed[q] && !seen[q]) { seen[q] = 1; patch.push(q); }
        }
      }
      patches++;
      const want = patch.reduce((count, p) => count + lit[p], 0);
      const ranked = patch.map(p => [litShare(p % w, (p / w) | 0, pool), p]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const toLit = [], toShade = [];
      ranked.forEach(([, p], i) => { const becomesLit = i < want; if (becomesLit && !lit[p]) toLit.push(p); if (!becomesLit && lit[p]) toShade.push(p); });
      for (let i = 0; i < toLit.length; i++) { // Equal lengths: each swap trades one pixel's color for the other's.
        const a = toLit[i] * 4, b = toShade[i] * 4;
        for (let c = 0; c < 4; c++) { const t = pixels[a + c]; pixels[a + c] = pixels[b + c]; pixels[b + c] = t; }
        swapped += 2;
      }
    }
    return { swapped, patches };
  }

  global.ModularWeaponBridgeFill = Object.freeze({ fillBridge, stampLine, stampStroke, autoBridgeStrokes,
    smudgeStep, rebuildOutline, smudgeStroke, makeClassifier, revertStep, plowStep, puffStep, toolStepper, toolStroke,
    separateShading, removeSpecks, cleanOutline, changedRegion, gaussBlur, maskWobble, measureOutline,
    learnStyle, evenOutline, styleCleanup });
})(typeof window === 'object' ? window : globalThis);
