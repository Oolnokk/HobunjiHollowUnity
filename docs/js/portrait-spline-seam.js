// Generate an editable hood-passage mask from the exterior silhouette of a species head.
// The input is the already-positioned 200x200 head-only portrait canvas, not the hairstyle or hood.
(() => {
  'use strict';
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const NEIGHBORS_4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const NEIGHBORS_8 = [...NEIGHBORS_4, [-1,-1], [-1,1], [1,-1], [1,1]];

  function generate(headCanvas, anchor, options = {}) {
    if (!headCanvas?.getContext || !Number.isFinite(anchor?.u) || !Number.isFinite(anchor?.v))
      throw new Error('A loaded species head and a valid root knot are required.');
    const width = headCanvas.width | 0, height = headCanvas.height | 0;
    if (width < 2 || height < 2 || width * height > 1048576)
      throw new Error('Head reference must be a reasonably sized portrait canvas.');
    const ctx = headCanvas.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const length = width * height, opaque = new Uint8Array(length); // Alpha-only head occupancy; color/tint never affects silhouette.
    const exterior = new Uint8Array(length); // Flood-filled transparent exterior excludes internal holes (eyes, nostrils).
    const queue = new Int32Array(length); // One bounded flood-fill queue reused for exterior and contour traversal.
    const alphaThreshold = clamp(Number(options.alphaThreshold) || 32, 1, 255);
    for (let i = 0; i < length; i++) opaque[i] = pixels[i * 4 + 3] >= alphaThreshold ? 1 : 0;
    let head = 0, tail = 0;
    function enqueueExterior(i) {
      if (opaque[i] || exterior[i]) return;
      exterior[i] = 1;
      queue[tail++] = i;
    }
    for (let x = 0; x < width; x++) { enqueueExterior(x); enqueueExterior((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { enqueueExterior(y * width); enqueueExterior(y * width + width - 1); }
    while (head < tail) {
      const at = queue[head++], x = at % width, y = (at / width) | 0;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) enqueueExterior(ny * width + nx);
      }
    }
    const border = new Uint8Array(length); // Only head pixels bordering transparent *exterior* receive a seam candidate.
    let count = 0;
    const ax = clamp(anchor.u, 0, 1) * width, ay = clamp(anchor.v, 0, 1) * height;
    let closest = -1, nearestD2 = Infinity;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!opaque[i]) continue;
      const edge = NEIGHBORS_4.some(([dx,dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx < 0 || nx >= width || ny < 0 || ny >= height || exterior[ny * width + nx];
      });
      if (!edge) continue;
      border[i] = 1; count++;
      const d2 = (x + .5 - ax) ** 2 + (y + .5 - ay) ** 2;
      if (d2 < nearestD2) { closest = i; nearestD2 = d2; }
    }
    if (closest < 0) return { seam: [], closestPx: null, borderPixels: 0 };
    const reachPx = clamp(Number(options.reachPx) || 54, 2, width / 2);
    if (nearestD2 > reachPx * reachPx)
      return { seam: [], closestPx: Math.sqrt(nearestD2), borderPixels: count };
    const maxArc = clamp(Number(options.arcPx) || 26, 2, width / 2);
    const spacing = clamp(Number(options.spacingPx) || 2.5, 1, 12);
    const radiusPx = clamp(Number(options.radiusPx) || 3, .5, 15);
    const distance = new Int16Array(length); // -1 means not visited; paths cannot jump across disconnected silhouette contours.
    distance.fill(-1);
    head = 0;tail = 0;
    queue[tail++] = closest;distance[closest] = 0;
    const samples = []; // Author-editable mask circles in logical portrait UVs; no implicit runtime silhouette scanning.
    while (head < tail) {
      const i = queue[head++], x = i % width, y = (i / width) | 0;
      if (!samples.some(p => (p.u * width - x - .5) ** 2 + (p.v * height - y - .5) ** 2 < spacing * spacing)) {
        samples.push({ u: (x + .5) / width, v: (y + .5) / height, radiusPx });
      }
      if (distance[i] >= maxArc) continue;
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!border[next] || distance[next] >= 0) continue;
        distance[next] = distance[i] + 1; queue[tail++] = next;
      }
    }
    // Runtime normalization caps all masks at 128 dabs; preserve the nearest attachment pixels first.
    return { seam: samples.slice(0, 128), closestPx: Math.sqrt(nearestD2), borderPixels: count };
  }
  window.PortraitSplineSeam = { generate };
})();
