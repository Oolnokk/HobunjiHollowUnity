// Baby-only pixel-art head enlargement. The authored chathead frame supplies the
// center/extent; its surroundings follow with a smooth distance falloff.
// Applied to FINAL genotype canvases, never to adult textures or head-rig data.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunji_baby_head_warp_scale_v1'; // Keeps the Nursery experiment's chosen scale across reloads without modifying saves.
  const DEFAULT_SCALE = 1.22; // Modest head enlargement applied only to baby sprite textures.
  const MAX_SCALE = 1.45; // Safety cap for the Nursery slider and public setter.
  const FALLOFF_RADIUS = 0.85; // In units of the larger head-frame half-extent; adjacent neck/body pixels move less with distance.
  const debug = { applied: 0, skipped: 0, lastKind: null, lastFrame: null, lastError: null }; // Exposed in Nursery Debug for mobile inspection.

  function clampScale(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(1, Math.min(MAX_SCALE, number)) : DEFAULT_SCALE;
  }

  let scale = (() => {
    try {
      const saved = window.localStorage?.getItem(STORAGE_KEY);
      return saved == null ? DEFAULT_SCALE : clampScale(saved);
    } catch (_) { return DEFAULT_SCALE; }
  })(); // Used by every new baby composition; independent of species, saved genotype and adult visuals.

  function setScale(value) {
    scale = clampScale(value);
    try { window.localStorage?.setItem(STORAGE_KEY, String(scale)); } catch (_) {}
    return scale;
  }

  const RIG_PREVIEW_STORAGE_KEY = 'hobunji_animal_head_rigs_v1'; // The head-rigger's same-origin Save Preview store; read only when composing new baby art.
  function scaleForKind(kind) {
    const normalized = String(kind || '').trim().toLowerCase().replace(/_/g, '-'); // Resolves the same species IDs used by the head-rigger export.
    const base = window.HobunjiAnimalHeadRigSpecies?.baseSpeciesFor?.(normalized) || normalized; // Variants inherit the underlying authored head setting.
    let previewRig = null; // A saved browser preview overrides the committed rig for this species, without changing game save data.
    try {
      const saved = JSON.parse(window.localStorage?.getItem(RIG_PREVIEW_STORAGE_KEY) || '{}');
      previewRig = saved?.[normalized] || saved?.[base] || null;
    } catch (_) {}
    const authoredRig = window.HobunjiAuthoredAnimalHeadRigs?.get?.(base)
      || window.CreatureGeneticsRender?.headRigForKind?.(base)
      || null; // Full exported head rigs can independently author baby proportions.
    const configured = previewRig?.babyHeadScale ?? authoredRig?.babyHeadScale;
    return typeof configured === 'number' && Number.isFinite(configured) ? clampScale(configured) : scale;
  }

  function frameForKind(kind) {
    const normalized = String(kind || '').trim().toLowerCase().replace(/_/g, '-'); // Canonical species key for attachment-rig head boxes.
    const base = window.HobunjiAnimalHeadRigSpecies?.baseSpeciesFor?.(normalized) || normalized; // Allows registered species variants to share their authored parent frame.
    const frame = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[base]?.chatheadFrame; // Authored chathead box, NOT the head-rig pivot/weight map.
    if (!frame || frame.coordinateSpace !== 'sprite-normalized-top-left') return null;
    const { x, y, width, height } = frame;
    if (![x, y, width, height].every(Number.isFinite)) return null;
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) return null;
    return { x, y, width, height };
  }

  function warpPixels(source, width, height, frame, requestedScale = scale) {
    const w = Math.floor(Number(width)), h = Math.floor(Number(height)); // Native texture dimensions; source and destination are always the same size.
    const magnification = clampScale(requestedScale); // Avoids inversion/foldovers from accidental extreme author values.
    if (!source || w < 1 || h < 1 || source.length !== w * h * 4) return null;
    const output = new Uint8ClampedArray(source); // Exact copy keeps every distant body pixel and its alpha unchanged.
    if (!frame || magnification <= 1) return output;
    const left = frame.x * w, top = frame.y * h; // Pixel-space limits of the existing authored normalized head frame.
    const halfW = frame.width * w / 2, halfH = frame.height * h / 2;
    const cx = left + halfW, cy = top + halfH;
    const fade = Math.max(1, Math.max(halfW, halfH) * FALLOFF_RADIUS); // Smooth transition extending beyond all four frame edges.
    const minX = Math.max(0, Math.floor(left - fade)), maxX = Math.min(w - 1, Math.ceil(left + halfW * 2 + fade));
    const minY = Math.max(0, Math.floor(top - fade)), maxY = Math.min(h - 1, Math.ceil(top + halfH * 2 + fade));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5, dy = py - cy;
      const outsideY = Math.max(0, Math.abs(dy) - halfH);
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, dx = px - cx;
        const outsideX = Math.max(0, Math.abs(dx) - halfW);
        const distance = Math.hypot(outsideX, outsideY);
        if (distance >= fade) continue;
        const t = distance / fade;
        const influence = 1 - t * t * (3 - 2 * t); // Smoothstep falloff: full strength in the head box, zero at the outer limit.
        const factor = 1 + (magnification - 1) * influence;
        // Inverse mapping never leaves empty holes: destination pixels fetch the closest original pixel.
        const sx = Math.max(0, Math.min(w - 1, Math.round(cx + dx / factor - 0.5)));
        const sy = Math.max(0, Math.min(h - 1, Math.round(cy + dy / factor - 0.5)));
        const from = (sy * w + sx) * 4, to = (y * w + x) * 4;
        output[to] = source[from]; output[to + 1] = source[from + 1];
        output[to + 2] = source[from + 2]; output[to + 3] = source[from + 3];
      }
    }
    return output;
  }

  function applyToCanvas(canvas, kind, previewScale = null) {
    const selectedScale = previewScale == null ? scaleForKind(kind) : clampScale(previewScale); // Editor may override the strength without mutating stored gameplay settings.
    if (!canvas || selectedScale <= 1) { debug.skipped++; return canvas; }
    const frame = frameForKind(kind);
    if (!frame) { debug.skipped++; debug.lastKind = kind; debug.lastFrame = 'no authored head frame'; return canvas; }
    try {
      const w = canvas.width, h = canvas.height; // Same native resolution for all genotypes and run poses.
      const src = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h);
      if (!src) return canvas;
      const warped = warpPixels(src.data, w, h, frame, selectedScale);
      if (!warped) return canvas;
      const output = document.createElement('canvas'); // Separate surface avoids changing any cached adult/shared genotype composite.
      output.width = w; output.height = h;
      const ctx = output.getContext('2d');
      const image = ctx.createImageData(w, h);
      image.data.set(warped);
      ctx.putImageData(image, 0, 0);
      debug.applied++; debug.lastKind = kind; debug.lastFrame = frame; debug.lastError = null;
      return output;
    } catch (error) {
      debug.lastError = String(error?.message || error); // Failure remains visible in the Nursery Debug button on mobile.
      return canvas;
    }
  }

  window.BabyAnimalHeadWarp = Object.freeze({
    DEFAULT_SCALE, MAX_SCALE, getScale: () => scale, setScale, scaleForKind,
    frameForKind, warpPixels, applyToCanvas,
    debugSnapshot: () => ({ ...debug, scale, defaultScale: DEFAULT_SCALE, falloffRadius: FALLOFF_RADIUS }),
  });
})();
