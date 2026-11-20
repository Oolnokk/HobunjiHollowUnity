// Pixel-space torso outline fitter. No dependency on game runtime or Three.js.
(function (global) {
  'use strict';
  const THRESHOLD = 48; // Nontransparent torso pixels used by each horizontal outline scan.
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function trace(data, width, height) {
    const left = new Float32Array(height), right = new Float32Array(height), valid = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
      let min = width, max = -1;
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < THRESHOLD) continue;
        min = Math.min(min, x); max = x;
      }
      if (max - min >= 3) { left[y] = min; right[y] = max; valid[y] = 1; }
    }
    // Three-row median suppresses isolated alpha-edge spikes without shifting the collar.
    const smoothL = left.slice(), smoothR = right.slice();
    for (let y = 1; y < height - 1; y++) {
      if (!valid[y]) continue;
      const ls = [], rs = [];
      for (let yy = y - 1; yy <= y + 1; yy++) {
        if (valid[yy]) { ls.push(left[yy]); rs.push(right[yy]); }
      }
      if (ls.length === 3) {
        ls.sort((a, b) => a - b); rs.sort((a, b) => a - b);
        smoothL[y] = ls[1]; smoothR[y] = rs[1];
      }
    }
    return { left: smoothL, right: smoothR, valid };
  }
  function distances(mask, width, height, radius) {
    const n = width * height, result = new Uint16Array(n);
    result.fill(radius);
    if (!mask || mask.length !== n) return result;
    // Bounded Manhattan distance transform: two linear passes, no per-pixel flood fill.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i]) { result[i] = 0; continue; }
      if (x) result[i] = Math.min(result[i], result[i - 1] + 1);
      if (y) result[i] = Math.min(result[i], result[i - width] + 1);
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x + 1 < width) result[i] = Math.min(result[i], result[i + 1] + 1);
      if (y + 1 < height) result[i] = Math.min(result[i], result[i + width] + 1);
    }
    return result;
  }
  function fitPixels(garment, sourceTorso, targetTorso, mask, width, height, options = {}) {
    const n = width * height;
    if (!(Number.isInteger(width) && Number.isInteger(height)) || width < 1 || height < 1 ||
        [garment, sourceTorso, targetTorso].some(data => !data || data.length !== n * 4) ||
        (mask && mask.length !== n)) throw new Error('Contour fit requires equal-sized garment, source torso, target torso, and mask images.');
    const strength = clamp(Number(options.strength ?? 1) || 0, 0, 1);
    const feather = clamp(Math.round(Number(options.feather ?? 12) || 12), 1, 64);
    const source = trace(sourceTorso, width, height), target = trace(targetTorso, width, height);
    const distance = distances(mask, width, height, feather);
    const output = new Uint8ClampedArray(n * 4);
    const mapped = new Float32Array(width);
    let rows = 0, limitedRows = 0;
    for (let y = 0; y < height; y++) {
      const offset = y * width, rgbaOffset = offset * 4;
      if (!source.valid[y] || !target.valid[y] || strength === 0) {
        output.set(garment.subarray(rgbaOffset, rgbaOffset + width * 4), rgbaOffset);
        continue;
      }
      const sLeft = source.left[y], sRight = source.right[y];
      const tLeft = target.left[y], tRight = target.right[y];
      const span = sRight - sLeft, targetSpan = tRight - tLeft;
      if (span < 4 || targetSpan < 4) {
        output.set(garment.subarray(rgbaOffset, rgbaOffset + width * 4), rgbaOffset);
        continue;
      }
      const ratio = clamp(targetSpan / span, 0.55, 1.8);
      const sCenter = (sLeft + sRight) * 0.5, tCenter = (tLeft + tRight) * 0.5;
      // Ease the correction to zero where torso coverage begins or ends.
      let above = 0, below = 0;
      for (let yy = y - 1; yy >= 0 && source.valid[yy] && target.valid[yy] && above < 6; yy--) above++;
      for (let yy = y + 1; yy < height && source.valid[yy] && target.valid[yy] && below < 6; yy++) below++;
      const rowStrength = strength * Math.min(1, (Math.min(above, below) + 1) / 5);
      // Back off automatically if an aggressively compressed edge would invert pixel order.
      let factor = rowStrength, monotonic = false;
      for (let retry = 0; retry < 7; retry++) {
        monotonic = true;
        for (let x = 0; x < width; x++) {
          const projected = tCenter + (x - sCenter) * ratio;
          const influence = distance[offset + x] / feather;
          mapped[x] = x + (projected - x) * factor * influence;
          if (x && mapped[x] <= mapped[x - 1] + 0.001) monotonic = false;
        }
        if (monotonic) break;
        factor *= 0.5;
      }
      if (!monotonic) {
        output.set(garment.subarray(rgbaOffset, rgbaOffset + width * 4), rgbaOffset);
        limitedRows++;
        continue;
      }
      if (factor < rowStrength) limitedRows++;
      rows++;
      let cursor = 0;
      for (let x = 0; x < width; x++) {
        const pixel = offset + x, destination = pixel * 4;
        // An immovable pixel is copied at its original address, including transparent holes.
        if (mask && mask[pixel]) {
          output[destination] = garment[destination];
          output[destination + 1] = garment[destination + 1];
          output[destination + 2] = garment[destination + 2];
          output[destination + 3] = garment[destination + 3];
          continue;
        }
        while (cursor + 1 < width && mapped[cursor + 1] <= x) cursor++;
        if (x < mapped[0] || x > mapped[width - 1]) continue;
        const next = Math.min(width - 1, cursor + 1);
        const t = next === cursor ? 0 : clamp((x - mapped[cursor]) / (mapped[next] - mapped[cursor]), 0, 1);
        const sourceX = clamp(Math.round(cursor + t), 0, width - 1);
        const from = (offset + sourceX) * 4;
        output[destination] = garment[from];
        output[destination + 1] = garment[from + 1];
        output[destination + 2] = garment[from + 2];
        output[destination + 3] = garment[from + 3];
      }
    }
    return { pixels: output, rows, limitedRows };
  }
  function paint(mask, width, height, x, y, radius, erase) {
    const r = clamp(Math.round(Number(radius) || 1), 1, 64), cx = Math.round(x), cy = Math.round(y);
    for (let yy = Math.max(0, cy - r); yy <= Math.min(height - 1, cy + r); yy++) {
      for (let xx = Math.max(0, cx - r); xx <= Math.min(width - 1, cx + r); xx++) {
        if ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) mask[yy * width + xx] = erase ? 0 : 1;
      }
    }
  }
  function pack(mask, width, height) {
    const runs = [];
    for (let i = 0; i < mask.length;) {
      if (!mask[i]) { i++; continue; }
      const start = i;
      while (i < mask.length && mask[i]) i++;
      runs.push(start, i - start);
    }
    return { width, height, runs };
  }
  function unpack(stored, width, height) {
    const mask = new Uint8Array(width * height);
    if (!stored || stored.width !== width || stored.height !== height || !Array.isArray(stored.runs)) return mask;
    for (let i = 0; i + 1 < stored.runs.length; i += 2) {
      const start = stored.runs[i], length = stored.runs[i + 1];
      if (!Number.isInteger(start) || !Number.isInteger(length) || length < 0 || start < 0 || start + length > mask.length) continue;
      mask.fill(1, start, start + length);
    }
    return mask;
  }
  global.ClothingContourFit = Object.freeze({ trace, fitPixels, paint, pack, unpack });
})(typeof window !== 'undefined' ? window : globalThis);
