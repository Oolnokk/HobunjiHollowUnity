// 2D beard-to-hood cutout. Portrait-space masks preserve main's normal beard/hood draw order.
(() => {
  'use strict';
  if (window.PortraitBeardHoodCutout) return;

  const SIZE = 200; // The authored portrait and mask canvas share exactly 200 logical pixels.
  const PIXELS = SIZE * SIZE;
  const matteCache = new WeakMap(); // Reuses a stable cosmetic mask's stencil across dialogue/world portrait redraws.

  function normalizeMask(input) {
    if (!input || input.size !== SIZE || !Array.isArray(input.runs)) return null;
    const sorted = input.runs.filter(pair => Array.isArray(pair) && pair.length === 2
      && Number.isInteger(pair[0]) && Number.isInteger(pair[1])
      && pair[0] >= 0 && pair[1] > 0 && pair[0] < PIXELS)
      .map(([start, length]) => [start, Math.min(length, PIXELS - start)])
      .sort((a, b) => a[0] - b[0]);
    const runs = [];
    for (const [start, length] of sorted) {
      const last = runs[runs.length - 1];
      if (last && start <= last[0] + last[1]) last[1] = Math.max(last[1], start + length - last[0]);
      else runs.push([start, length]);
    }
    return {size: SIZE, runs};
  }

  function decodeMask(input) {
    const pixels = new Uint8Array(PIXELS); // Editor brush uses this bitmap; saved JSON remains compact RLE.
    for (const [start, length] of normalizeMask(input)?.runs || []) pixels.fill(1, start, start + length);
    return pixels;
  }

  function encodeMask(pixels) {
    if (!pixels || pixels.length !== PIXELS) return {size: SIZE, runs: []};
    const runs = [];
    for (let i = 0; i < PIXELS;) {
      if (!pixels[i]) { i++; continue; }
      const start = i;
      while (i < PIXELS && pixels[i]) i++;
      runs.push([start, i - start]);
    }
    return {size: SIZE, runs};
  }

  function countMask(input) {
    return (normalizeMask(input)?.runs || []).reduce((total, [, length]) => total + length, 0);
  }

  function paintMask(input, beardPixels, x, y, radius, erase = false, previous = null) {
    const pixels = decodeMask(input);
    if (!beardPixels || beardPixels.length !== PIXELS * 4) return encodeMask(pixels);
    const toPoint = (px, py) => ({
      x: Math.max(0, Math.min(SIZE - 0.001, Number(px) || 0)),
      y: Math.max(0, Math.min(SIZE - 0.001, Number(py) || 0)),
    });
    const point = toPoint(x, y);
    const start = previous ? toPoint(previous.x, previous.y) : point;
    const dx = point.x - start.x, dy = point.y - start.y;
    const distance2 = dx * dx + dy * dy;
    const brush = Math.max(.5, Math.min(32, Number(radius) || 1));
    const minX = Math.max(0, Math.floor(Math.min(start.x, point.x) - brush));
    const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(start.x, point.x) + brush));
    const minY = Math.max(0, Math.floor(Math.min(start.y, point.y) - brush));
    const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(start.y, point.y) + brush));
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const vx = px + .5 - start.x, vy = py + .5 - start.y;
      const t = distance2 ? Math.max(0, Math.min(1, (vx * dx + vy * dy) / distance2)) : 0;
      if ((vx - t * dx) ** 2 + (vy - t * dy) ** 2 > brush * brush) continue;
      const i = py * SIZE + px;
      if (erase || beardPixels[i * 4 + 3] >= 8) pixels[i] = erase ? 0 : 1;
    }
    return encodeMask(pixels);
  }

  function stencilFor(mask) {
    if (matteCache.has(mask)) return matteCache.get(mask);
    const canonical = normalizeMask(mask);
    if (!canonical?.runs.length) return null;
    const canvas = document.createElement('canvas'); // An alpha-only matte, never a recolored/repositioned beard sprite.
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = ctx.createImageData(SIZE, SIZE);
    for (const [start, length] of canonical.runs) {
      for (let i = start; i < start + length; i++) image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    matteCache.set(mask, canvas);
    return canvas;
  }

  function applyToHood(hoodCanvas, mask) {
    if (!hoodCanvas || !mask) return {cutPixels: 0, applied: false};
    const stencil = stencilFor(mask);
    const ctx = hoodCanvas.getContext?.('2d');
    if (!stencil || !ctx) return {cutPixels: 0, applied: false};
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out'; // Remove hood alpha only; never move or repaint the beard.
    ctx.drawImage(stencil, 0, 0, hoodCanvas.width, hoodCanvas.height);
    ctx.restore();
    return {cutPixels: countMask(mask), applied: true};
  }

  window.PortraitBeardHoodCutout = Object.freeze({
    SIZE, normalizeMask, decodeMask, encodeMask, countMask, paintMask, applyToHood,
  });
})();
