// Bridge brush fill: hollows a painted mask and regrows the surrounding metal into it; no DOM dependency.
(function (global) {
  'use strict';

  function luma(px, o) { return 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]; }
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
    const thickness = Math.max(0, Math.min(32, Math.round(options.outlineThickness ?? 2))); // Black rim kept where the bridge meets empty space.
    const minAlpha = Math.max(1, Math.min(255, Math.round(options.minAlpha ?? 32))); // Fainter pixels count as empty.
    const darkLuma = options.darkLuma ?? 48; // Darker opaque pixels are outline ink, never metal.
    const edgeBias = options.edgeBias ?? 3; // How much faster growth races along the bridge's outer edges than into its middle.
    const jitter = options.jitter ?? 0.9; // Random step cost so competing seeds scramble instead of forming straight Voronoi borders.
    const random = mulberry32(options.seed ?? 1);

    const EMPTY = 0, INK = 1, METAL = 2;
    const kind = new Uint8Array(n); // Classification of the original source pixels.
    let painted = 0;
    for (let p = 0; p < n; p++) {
      const o = p * 4;
      kind[p] = source[o + 3] < minAlpha ? EMPTY : luma(source, o) < darkLuma ? INK : METAL;
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
    const isRim = p => rimDist[p] > 0 && rimDist[p] <= thickness;
    const fillable = new Uint8Array(n); // The hollowed interior that metal regrows into.
    let fillCount = 0;
    for (let p = 0; p < n; p++) if (mask[p] && !isRim(p)) { fillable[p] = 1; fillCount++; }

    // 2. Sample brightness: metal under the stroke, plus the metal seeds bordering it.
    const seeds = [];
    const overlapped = [];
    for (let p = 0; p < n; p++) {
      if (kind[p] !== METAL) continue;
      if (mask[p]) { overlapped.push(p * 4); continue; }
      const x = p % w, y = (p / w) | 0;
      if ((x > 0 && fillable[p - 1]) || (x < w - 1 && fillable[p + 1]) ||
          (y > 0 && fillable[p - w]) || (y < h - 1 && fillable[p + w])) seeds.push(p);
    }
    if (!seeds.length) throw new Error('The stroke must touch metal pixels at both ends so they can grow into it.');
    const samples = overlapped.length ? overlapped.concat(seeds.map(p => p * 4)) : seeds.map(p => p * 4);
    const lumas = samples.map(o => luma(source, o));
    const spread = Math.max(...lumas) - Math.min(...lumas);
    const threshold = spread < 12 ? -1 : otsu(lumas); // Near-uniform metal has a single tone.
    const SHADED = 0, LIT = 1;
    const toneOf = o => luma(source, o) < threshold ? SHADED : LIT;
    const shadedSamples = samples.filter(o => toneOf(o) === SHADED);
    const litSamples = samples.filter(o => toneOf(o) === LIT);
    const palette = [medianColor(source, shadedSamples), medianColor(source, litSamples)];
    if (!palette[SHADED]) palette[SHADED] = palette[LIT];
    if (!palette[LIT]) palette[LIT] = palette[SHADED];

    // 3. Distance from the bridge's outer edges (rim/empty side), so growth races along the edges first.
    const edgeDist = new Int32Array(n).fill(-1);
    head = tail = 0;
    for (let p = 0; p < n; p++) {
      if (!fillable[p]) continue;
      const x = p % w, y = (p / w) | 0;
      const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      if (neighbors.some(q => q < 0 || isRim(q) || (!mask[q] && kind[q] !== METAL))) { edgeDist[p] = 0; queue[tail++] = p; }
    }
    let maxEdge = 0;
    while (head < tail) {
      const p = queue[head++], x = p % w, y = (p / w) | 0;
      maxEdge = Math.max(maxEdge, edgeDist[p]);
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && fillable[q] && edgeDist[q] < 0) { edgeDist[q] = edgeDist[p] + 1; queue[tail++] = q; }
      }
    }
    queue = null;

    // 4. Every bordering metal pixel is a simultaneous seed; cheapest path claims each empty pixel first,
    //    and the claimed pixel inherits the tone (shaded/unshaded) of whichever seed reached it.
    const tone = new Int8Array(n).fill(-1);
    const heap = new Heap();
    for (const p of seeds) heap.push(random() * jitter, p, toneOf(p * 4));
    const item = {};
    const edgeScale = maxEdge > 0 ? edgeBias / maxEdge : 0;
    let grown = 0;
    while (heap.cost.length) {
      heap.pop(item);
      const p = item.pixel;
      if (fillable[p]) { if (tone[p] >= 0) continue; tone[p] = item.tone; grown++; }
      const x = p % w, y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || !fillable[q] || tone[q] >= 0) continue;
        const step = 1 + edgeDist[q] * edgeScale + random() * jitter;
        heap.push(item.cost + step, q, item.tone);
      }
    }

    // 5. Write the result: rim → opaque black, hollow → sampled metal tones (unreached islands take the shaded tone).
    const pixels = new Uint8ClampedArray(source);
    let rimCount = 0, shadedCount = 0, litCount = 0;
    for (let p = 0; p < n; p++) {
      if (!mask[p]) continue;
      const o = p * 4;
      if (!fillable[p]) { pixels[o] = pixels[o + 1] = pixels[o + 2] = 0; pixels[o + 3] = 255; rimCount++; continue; }
      const t = tone[p] >= 0 ? tone[p] : SHADED;
      pixels.set(palette[t], o);
      if (t === SHADED) shadedCount++; else litCount++;
    }
    return { pixels, painted, rim: rimCount, filled: fillCount, grown, shaded: shadedCount, unshaded: litCount,
      seeds: seeds.length, sampled: samples.length, threshold, palette };
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
