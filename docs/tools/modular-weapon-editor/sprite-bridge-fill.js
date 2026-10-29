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

  // source: RGBA frame; mask: one byte per pixel (nonzero = painted by the bridge brush).
  function fillBridge(source, mask, width, height, options = {}) {
    const w = Number(width), h = Number(height), n = w * h;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
        !source || source.length !== n * 4 || !mask || mask.length !== n)
      throw new Error('Bridge fill needs a valid RGBA frame and matching brush mask.');
    const thickness = Math.max(0, Math.min(32, Math.round(options.outlineThickness ?? 10))); // Black rim kept where the bridge meets empty space.
    const minAlpha = Math.max(1, Math.min(255, Math.round(options.minAlpha ?? 32))); // Fainter pixels count as empty.
    const darkLuma = options.darkLuma ?? 48; // Darker opaque pixels are outline ink, never metal.
    const jitter = options.jitter ?? 0.9; // Random step cost so competing seeds scramble instead of forming straight Voronoi borders.
    const random = mulberry32(options.seed ?? 1);

    // Every weapon's metal is authored in one base color (the same SOURCE_HEX the game's metal recolor keys on);
    // shading only changes its brightness. Pixels of other hues (grip wraps, wood) are kept but never spread.
    const [metalHue, metalSat] = hueSat(...hexRgb(options.metalHex || '#5A8480'));
    const hueTol = options.metalHueTolerance ?? 22, satTol = options.metalSaturationTolerance ?? 0.22;
    const EMPTY = 0, INK = 1, METAL = 2, OTHER = 3;
    const kind = new Uint8Array(n); // Classification of the original source pixels.
    let painted = 0;
    for (let p = 0; p < n; p++) {
      const o = p * 4;
      if (source[o + 3] < minAlpha) kind[p] = EMPTY;
      else if (luma(source, o) < darkLuma) kind[p] = INK;
      else {
        const [hue, sat] = hueSat(source[o], source[o + 1], source[o + 2]);
        const hueGap = Math.min(Math.abs(hue - metalHue), 360 - Math.abs(hue - metalHue));
        kind[p] = hueGap <= hueTol && Math.abs(sat - metalSat) <= satTol ? METAL : OTHER;
      }
      if (mask[p]) painted++;
    }
    if (!painted) throw new Error('Paint over the gap with the bridge brush first.');

    // 1. Black rim: painted pixels within `thickness` (8-connected) of empty space outside the stroke or the frame edge.
    const rimDist = new Int32Array(n).fill(-1);
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
      if (touchesEmpty) { rimDist[p] = 1; queue[tail++] = p; }
    }
    while (head < tail) {
      const p = queue[head++], d = rimDist[p];
      if (d >= thickness) continue;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && rimDist[q] < 0) { rimDist[q] = d + 1; queue[tail++] = q; }
      }
    }
    // Metal (and other-colored material) the stroke painted over is never overwritten; painted metal joins the seeds.
    const isRim = p => kind[p] <= INK && rimDist[p] > 0 && rimDist[p] <= thickness;
    const fillable = new Uint8Array(n); // The hollowed interior (empty space and outline ink) that metal regrows into.
    let fillCount = 0, preserved = 0;
    for (let p = 0; p < n; p++) {
      if (!mask[p]) continue;
      if (kind[p] >= METAL) preserved++;
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
    if (!samples.length) samples.push(...seeds);
    const lumas = samples.map(p => luma(source, p * 4));
    const spread = Math.max(...lumas) - Math.min(...lumas);
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
      if (!mask[p] || kind[p] >= METAL) continue;
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

  global.ModularWeaponBridgeFill = Object.freeze({ fillBridge, stampLine });
})(typeof window === 'object' ? window : globalThis);
