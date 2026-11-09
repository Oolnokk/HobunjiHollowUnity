// Opaque black outline for unmodified game-frame sprites; no browser/DOM dependency.
(function (global) {
  'use strict';

  function cullLowAlphaPixels(source, minimumAlpha = 32) {
    const threshold = Number(minimumAlpha); // Alpha level 1..255; 0 means only fully transparent already-hidden RGB is cleared.
    if (!source || source.length % 4 !== 0 || !Number.isInteger(threshold) || threshold < 0 || threshold > 255)
      throw new Error('Minimum alpha must be an integer from 0 to 255.');
    const pixels = new Uint8ClampedArray(source); // Never mutate editor Undo snapshots.
    let removed = 0, remaining = 0; // Diagnostics count nonzero-alpha pixels removed and retained.
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < threshold || pixels[i + 3] === 0) {
        if (pixels[i + 3]) removed++;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0; // Clear hidden RGB too.
      } else remaining++;
    }
    return { pixels, removed, remaining, threshold };
  }
  function outlinePixels(source, width, height, thickness, minimumAlpha = 32) {
    const w = Number(width), h = Number(height), radius = Number(thickness); // Caller frame/desired outward pixel radius.
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
        !Number.isInteger(radius) || radius < 1 || radius > 32 ||
        !source || source.length !== w * h * 4) throw new Error('Outline needs valid pixels, dimensions, and thickness from 1–32.');

    const cleaned = cullLowAlphaPixels(source, minimumAlpha); // Faint fringe pixels never count as solid content or survive the outline.
    const sourcePixels = cleaned.pixels; // Working alpha array after culling; original caller pixels stay unchanged.
    const dest = new Uint8ClampedArray(sourcePixels); // Preserves every retained interior pixel byte-for-byte.
    const stride = w + 1; // Extra column for inclusive-exclusive summed-area queries.
    const summed = new Uint32Array(stride * (h + 1)); // Presence prefix sum for constant-time square dilation.
    let occupied = 0; // Diagnostics count retained nontransparent pixels.

    for (let y = 0; y < h; y++) {
      let rowSum = 0; // Horizontal source alpha occupancy accumulated within this scanline.
      for (let x = 0; x < w; x++) {
        if (sourcePixels[(y * w + x) * 4 + 3] > 0) { rowSum++; occupied++; }
        summed[(y + 1) * stride + x + 1] = summed[y * stride + x + 1] + rowSum;
      }
    }

    let added = 0, edgeDarkened = 0; // Number of new black pixels and frame-edge colors forced black.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const offset = (y * w + x) * 4; // RGBA pixel start within the output.
      if (sourcePixels[offset + 3]) {
        // No extra pixels fit beyond the exported frame; blacken only colored pixels actually on its boundary.
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          if (dest[offset] || dest[offset + 1] || dest[offset + 2]) {
            dest[offset] = dest[offset + 1] = dest[offset + 2] = 0;
            edgeDarkened++;
          }
          dest[offset + 3] = 255; // Opaque border at the frame edge guarantees no colored silhouette cutoff.
        }
        continue;
      }
      const left = Math.max(0, x - radius), right = Math.min(w, x + radius + 1); // Inclusive square radius around pixel.
      const top = Math.max(0, y - radius), bottom = Math.min(h, y + radius + 1); // Square/8-connected outline seals diagonal gaps.
      const present = summed[bottom * stride + right] - summed[top * stride + right] -
        summed[bottom * stride + left] + summed[top * stride + left]; // Source pixels within the target radius.
      if (!present) continue;
      dest[offset] = dest[offset + 1] = dest[offset + 2] = 0;
      dest[offset + 3] = 255; // Fully opaque, pure black outline in formerly transparent regions.
      added++;
    }
    return { pixels: dest, added, edgeDarkened, sourcePixels: occupied, culled: cleaned.removed, thickness: radius, minimumAlpha: cleaned.threshold };
  }

  global.ModularWeaponOutline = Object.freeze({ outlinePixels, cullLowAlphaPixels });
})(typeof window === 'object' ? window : globalThis);
