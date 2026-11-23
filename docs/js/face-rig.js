// Experimental pixel-space face rig shared by portrait renderer and Face Rig author.
// Non-destructive and opt-in: an absent/neutral/mismatched rig returns the original image.
(function (global) {
  'use strict';
  const MAX_CANVASES = 8; // Caps decoded warped layers kept by the shared portrait cache.
  const NODE_INFLUENCE = [1, 0.43, 0.16, 0.045]; // One dragged line node softly carries its three closest neighbors.
  const ids = new WeakMap(); // Assigns each source Image/Canvas a stable cache identity.
  const cache = new Map(); // Stores recently used deformation canvases; also shared by open/blink images.
  const stats = { builds: 0, hits: 0, processedPixels: 0, failures: 0, lastError: '' }; // Mobile diagnostics and performance audit.
  let nextImageId = 1; // Provides cache IDs without retaining discarded image objects.

  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(n)) ? Number(n) : min));
  const speciesKey = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  function familyForSpecies(species) {
    const key = speciesKey(species);
    if (['mao-ao', 'tletingan', 'engh-sho'].includes(key)) return 'line';
    if (['kenkari', 'porakaneki', 'mashtzarr', 'mammakhbuur', 'mammakh'].includes(key)) return 'round';
    return null;
  }
  function eyeTemplate(family, side) {
    const cx = side === 0 ? 0.425 : 0.575; // Initial guide only; author must place eyes over their actual PNG pixels.
    if (family === 'line') return {
      box: { x: cx - 0.06, y: 0.39, w: 0.12, h: 0.075 },
      nodes: Array.from({ length: 7 }, () => [0, 0]),
    };
    return {
      circle: { x: cx, y: 0.43, r: 0.043 }, // Radius measured against image HEIGHT, not normalized canvas width.
      upper: { inset: 0, curve: 0, depth: 0 },
      lower: { inset: 0, curve: 0, depth: 0 },
    };
  }
  function make(speciesId, gender = 'male') {
    const family = familyForSpecies(speciesId);
    if (!family) return null;
    return { version: 1, enabled: true, speciesId: speciesKey(speciesId),
      gender: String(gender || 'male').toLowerCase(), family,
      eyes: [eyeTemplate(family, 0), eyeTemplate(family, 1)] };
  }
  function normalize(value, speciesId = value?.speciesId, gender = value?.gender) {
    const family = familyForSpecies(speciesId);
    if (!family || !value || value.enabled === false || value.version !== 1
      || speciesKey(value.speciesId) !== speciesKey(speciesId)
      || String(value.gender || '').toLowerCase() !== String(gender || '').toLowerCase()
      || value.family !== family || !Array.isArray(value.eyes) || value.eyes.length !== 2) return null;
    const next = make(speciesId, gender);
    next.eyes = next.eyes.map((fallback, index) => {
      const original = value.eyes[index] || {};
      if (family === 'line') {
        const b = original.box || {};
        return {
          box: { x: clamp(b.x, 0, 0.99), y: clamp(b.y, 0, 0.99),
            w: clamp(b.w, 0.01, 0.5), h: clamp(b.h, 0.01, 0.5) },
          nodes: Array.from({ length: 7 }, (_, n) => [
            clamp(original.nodes?.[n]?.[0], -0.07, 0.07),
            clamp(original.nodes?.[n]?.[1], -0.3, 0.3),
          ]),
        };
      }
      const c = original.circle || {};
      const eyelid = data => ({ inset: clamp(data?.inset, 0, 1), curve: clamp(data?.curve, -1, 1),
        depth: clamp(data?.depth, 0, 1) });
      return { circle: { x: clamp(c.x, 0, 1), y: clamp(c.y, 0, 1), r: clamp(c.r, 0.005, 0.2) },
        upper: eyelid(original.upper), lower: eyelid(original.lower) };
    });
    return next;
  }
  function moveNode(rig, side, node, dx, dy) {
    const eye = rig?.family === 'line' ? rig.eyes?.[side] : null;
    if (!eye || !Number.isInteger(node) || node < 0 || node > 6) return false;
    for (let i = 0; i < 7; i++) {
      const weight = NODE_INFLUENCE[Math.abs(i - node)] || 0;
      eye.nodes[i][0] = clamp(eye.nodes[i][0] + clamp(dx, -1, 1) * weight, -0.07, 0.07);
      eye.nodes[i][1] = clamp(eye.nodes[i][1] + clamp(dy, -1, 1) * weight, -0.3, 0.3);
    }
    return true;
  }
  function active(rig) {
    return rig.eyes.some(eye => rig.family === 'line'
      ? eye.nodes.some(node => Math.abs(node[0]) + Math.abs(node[1]) > 0.00001)
      : ['upper', 'lower'].some(part => eye[part].inset > 0.00001 || eye[part].depth > 0.00001));
  }
  function allowedLayer(rig, role) {
    if (speciesKey(rig.speciesId) === 'engh-sho') return role === 'goggles';
    return role === 'head' || role === 'ur' || role === 'eyes';
  }
  function cubic(nodes, t, axis) {
    const p = clamp(t, 0, 1) * 6, i = Math.min(5, Math.floor(p)), f = p - i;
    const a = nodes[Math.max(0, i - 1)][axis], b = nodes[i][axis];
    const c = nodes[i + 1][axis], d = nodes[Math.min(6, i + 2)][axis];
    return 0.5 * ((2 * b) + (-a + c) * f + (2*a - 5*b + 4*c - d)*f*f
      + (-a + 3*b - 3*c + d)*f*f*f);
  }
  function lidPositions(eye, x, imageHeight) {
    const r = eye.circle.r * imageHeight;
    const relative = (x - eye.circle.x * imageHeight /* corrected below with x coordinate */);
    return { r, relative };
  }
  function roundContour(lid, q) {
    const power = 1.35 + lid.curve * 0.95; // Controls how rapidly eyelid influence tapers toward the corners.
    const inward = lid.inset * Math.pow(q, power) + lid.depth * 0.27 * q * (1 - q);
    return Math.min(q, Math.max(0, inward)); // Never cross the original circular edge or the eye center.
  }
  function sampleNearest(data, width, height, x, y, target, outputIndex) {
    const sx = Math.min(width - 1, Math.max(0, Math.round(x)));
    const sy = Math.min(height - 1, Math.max(0, Math.round(y)));
    const sourceIndex = (sy * width + sx) * 4;
    for (let channel = 0; channel < 4; channel++) target[outputIndex + channel] = data[sourceIndex + channel];
  }
  function processEye(context, sourceWidth, sourceHeight, eye, family) {
    const rect = family === 'line'
      ? { x: eye.box.x * sourceWidth, y: eye.box.y * sourceHeight,
          w: eye.box.w * sourceWidth, h: eye.box.h * sourceHeight }
      : { x: eye.circle.x * sourceWidth - eye.circle.r * sourceHeight,
          y: eye.circle.y * sourceHeight - eye.circle.r * sourceHeight,
          w: eye.circle.r * sourceHeight * 2, h: eye.circle.r * sourceHeight * 2 };
    const extraX = family === 'line' ? rect.w * 0.08 + 3 : 3;
    const extraY = family === 'line' ? rect.h * 0.45 + 3 : rect.h * 0.55 + 3;
    const left = Math.max(0, Math.floor(rect.x - extraX));
    const top = Math.max(0, Math.floor(rect.y - extraY));
    const right = Math.min(sourceWidth, Math.ceil(rect.x + rect.w + extraX));
    const bottom = Math.min(sourceHeight, Math.ceil(rect.y + rect.h + extraY));
    const width = right - left, height = bottom - top;
    if (width <= 0 || height <= 0) return;
    const original = context.getImageData(left, top, width, height);
    const result = context.createImageData(width, height);
    result.data.set(original.data);
    let updated = false;
    for (let y = 0; y < height; y++) {
      const Y = top + y + 0.5;
      for (let x = 0; x < width; x++) {
        const X = left + x + 0.5;
        let fromX = X, fromY = Y;
        if (family === 'line') {
          const u = (X - rect.x) / rect.w, v = (Y - rect.y) / rect.h;
          if (u <= 0 || u >= 1 || v <= 0 || v >= 1) continue;
          const fadeX = Math.min(1, u * 12, (1-u) * 12);
          const fadeY = Math.sin(Math.PI * v) ** 2;
          const influence = fadeX * fadeY;
          const t = clamp((u - 0.1) / 0.8, 0, 1);
          fromX -= cubic(eye.nodes, t, 0) * rect.w * influence;
          fromY -= cubic(eye.nodes, t, 1) * rect.h * influence;
        } else {
          const radius = rect.w / 2, centerX = rect.x + radius, centerY = rect.y + radius;
          const u = (X - centerX) / radius;
          if (Math.abs(u) >= 1) continue;
          const q = Math.sqrt(1-u*u);
          const oldTop = centerY - radius*q, oldBottom = centerY + radius*q;
          if (Y < oldTop || Y > oldBottom) continue;
          const newTop = oldTop + roundContour(eye.upper, q)*radius;
          const newBottom = oldBottom - roundContour(eye.lower, q)*radius;
          if (Y < newTop) fromY = oldTop - (newTop-Y);
          else if (Y > newBottom) fromY = oldBottom + (Y-newBottom);
          else fromY = oldTop + (Y-newTop) / Math.max(0.0001, newBottom-newTop) * (oldBottom-oldTop);
        }
        if (Math.abs(fromX-X) < 0.00001 && Math.abs(fromY-Y) < 0.00001) continue;
        updated = true;
        sampleNearest(original.data, width, height, fromX - left - 0.5, fromY - top - 0.5, result.data, (y*width+x)*4);
      }
    }
    if (updated) context.putImageData(result, left, top);
    stats.processedPixels += width * height;
  }
  function applyImage(image, rawRig, role, speciesId, gender) {
    if (!image || !rawRig) return image;
    const rig = normalize(rawRig, speciesId, gender);
    if (!rig || !allowedLayer(rig, role) || !active(rig)) return image;
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    if (!(width > 0 && height > 0) || width > 4096 || height > 4096) return image;
    try {
      if (!ids.has(image)) ids.set(image, nextImageId++);
      const signature = JSON.stringify([ids.get(image), role, rig]);
      if (cache.has(signature)) {
        const hit = cache.get(signature); cache.delete(signature); cache.set(signature, hit);
        stats.hits++;
        return hit;
      }
      const canvas = global.document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      for (const eye of rig.eyes) processEye(context, width, height, eye, rig.family);
      cache.set(signature, canvas);
      while (cache.size > MAX_CANVASES) cache.delete(cache.keys().next().value);
      stats.builds++;
      return canvas;
    } catch (error) {
      stats.failures++;
      stats.lastError = String(error?.message || error);
      return image; // Missing or tainted art must not prevent a portrait from rendering.
    }
  }
  global.HobunjiFaceRig = Object.freeze({
    version: 1, familyForSpecies, make, normalize, moveNode, roundContour, applyImage,
    debugSnapshot: () => ({ ...stats, cacheEntries: cache.size, cacheLimit: MAX_CANVASES }),
    clearCache: () => cache.clear(),
  });
})(typeof window !== 'undefined' ? window : globalThis);
