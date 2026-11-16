// Idle-pose alpha-masked head enlargement shared by babies and eligible small pets.
// Cache the opaque silhouette INSIDE the chathead frame once per species, then use
// that unchanged mask on final (eyes/patterns included) genotype artwork in every pose.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunji_baby_head_warp_scale_v1'; // Keeps the Nursery experiment's chosen scale across reloads without modifying saves.
  const DEFAULT_SCALE = 1.32; // User-approved universal 132% for babies and qualifying genetically Small shoulder pets.
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
      return saved == null || Number(saved) === 1.22 || Number(saved) === 1.23 ? DEFAULT_SCALE : clampScale(saved); // Move the two old inherited defaults to 132%; preserve other user choices.
    } catch (_) { return DEFAULT_SCALE; }
  })(); // Used by every new baby composition; independent of species, saved genotype and adult visuals.

  function setScale(value) {
    scale = clampScale(value);
    try { window.localStorage?.setItem(STORAGE_KEY, String(scale)); } catch (_) {}
    return scale;
  }

  const RIG_PREVIEW_STORAGE_KEY = 'hobunji_animal_head_rigs_v1'; // Same browser preview store used by the painted head-rig editor.
  let cachedPreviewRaw = null; // Avoid reparsing possibly large painted RLE maps every frame while a small pet is equipped.
  let cachedPreviewRigs = {}; // Parsed per-species preview map shared by scale and head-frame lookup.
  function readPreviewRigs() {
    try {
      const raw = window.localStorage?.getItem(RIG_PREVIEW_STORAGE_KEY) || '';
      if (raw === cachedPreviewRaw) return cachedPreviewRigs;
      const data = raw ? JSON.parse(raw) : {};
      cachedPreviewRaw = raw;
      cachedPreviewRigs = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      return cachedPreviewRigs;
    } catch (_) { cachedPreviewRaw = null; cachedPreviewRigs = {}; return cachedPreviewRigs; }
  }
  function scaleForKind(kind) {
    const normalized = String(kind || '').trim().toLowerCase().replace(/_/g, '-'); // Resolves the same species IDs used by the head-rigger export.
    const base = window.HobunjiAnimalHeadRigSpecies?.baseSpeciesFor?.(normalized) || normalized; // Variants inherit the underlying authored head setting.
    const saved = readPreviewRigs(); // Parsed only when storage actually changes; safe in repeated small-pet render frames.
    const previewRig = saved?.[normalized] || saved?.[base] || null;
    const authoredRig = window.HobunjiAuthoredAnimalHeadRigs?.get?.(base)
      || window.CreatureGeneticsRender?.headRigForKind?.(base)
      || null; // Full exported head rigs can independently author baby proportions.
    const configured = previewRig?.babyHeadScale ?? authoredRig?.babyHeadScale;
    return typeof configured === 'number' && Number.isFinite(configured) ? clampScale(configured) : scale;
  }

  function isSmallSizeVariantPet(kind, genotype, stableRole) {
    // Only the genetics-derived Small variant of a normally non-Small species gets a juvenile-looking head.
    // A species naturally Small as an adult never gets this effect; its actual babies use applyToCanvas independently.
    if (stableRole !== 'shoulderPet' || !kind || genotype?.sizeClass !== 'small') return false;
    const genetics = window.CreatureGenetics;
    if (typeof genetics?.creatureSizeClass !== 'function') return false; // Never guess a species baseline if genetics is not initialized.
    return genetics.creatureSizeClass(kind, genotype) === 'small'
      && genetics.creatureSizeClass(kind, {}) !== 'small';
  }

  function validateFrame(frame) {
    if (!frame || frame.coordinateSpace !== 'sprite-normalized-top-left') return null;
    const { x, y, width, height } = frame; // The baby's head area is expressed in normalized original-art coordinates.
    if (![x, y, width, height].every(Number.isFinite)) return null;
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) return null;
    return { x, y, width, height, coordinateSpace: 'sprite-normalized-top-left' };
  }

  function frameFromRig(rig) {
    if (!rig || typeof rig !== 'object') return null;
    const explicit = validateFrame(rig.babyHeadFrame); // A directly authored baby-only head box takes precedence over the inferred painted region.
    if (explicit) return explicit;
    const map = rig.weightMap; // Same Influence paint the animal head-rigger uses to bend the neck; never use Shoulder paint.
    const w = Number(map?.width), h = Number(map?.height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 65536) return null;
    const total = w * h;
    let minX = w, minY = h, maxX = -1, maxY = -1; // Bounds of strongly Head-owned pixels, ignoring unpainted/body/soft transition cells.
    function include(index, raw) {
      if (!Number.isFinite(raw) || raw < 128 || raw > 255) return;
      const x = index % w, y = Math.floor(index / w);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (map.encoding === 'rle-u9' && Array.isArray(map.data)) {
      let index = 0; // Walk the exact run-length encoding already used by the rigger; no decoded texture allocation.
      for (let i = 0; i + 1 < map.data.length && index < total; i += 2) {
        const count = Number(map.data[i]), raw = Number(map.data[i + 1]);
        if (!Number.isInteger(count) || count < 0) return null;
        const end = Math.min(total, index + count);
        if (raw >= 128 && raw <= 255) for (; index < end; index++) include(index, raw);
        else index = end;
      }
    } else if (Array.isArray(map.data)) {
      for (let index = 0; index < Math.min(total, map.data.length); index++) include(index, Number(map.data[index]));
    } else return null;
    if (maxX < minX || maxY < minY) return null;
    const padding = 0.035; // Matches the editor's normal padding around the painted head region for silhouettes/neck blending.
    const x0 = Math.max(0, minX / w - padding), y0 = Math.max(0, minY / h - padding);
    const x1 = Math.min(1, (maxX + 1) / w + padding), y1 = Math.min(1, (maxY + 1) / h + padding);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, coordinateSpace: 'sprite-normalized-top-left' };
  }

  function frameForKind(kind) {
    const normalized = String(kind || '').trim().toLowerCase().replace(/_/g, '-'); // Canonical species key for head-rig and chathead profiles.
    const base = window.HobunjiAnimalHeadRigSpecies?.baseSpeciesFor?.(normalized) || normalized; // Species variants share the actual authored head paint.
    const previews = readPreviewRigs(); // Same cached object as scaleForKind to avoid duplicate JSON parses.
    const savedRig = previews?.[normalized] || previews?.[base];
    const committed = window.HobunjiAuthoredAnimalHeadRigs?.get?.(base)
      || window.CreatureGeneticsRender?.headRigForKind?.(base);
    const chathead = validateFrame(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[base]?.chatheadFrame);
    if (chathead) return chathead; // The authored dialogue frame strictly bounds which IDLE opaque pixels belong to the source head mask.
    const dialogue = validateFrame(window.AnimalChatheadFrame?.frameForKind?.(base));
    if (dialogue) return dialogue; // Dynamic/solved chathead frames also outrank head deformation paint.
    const painted = frameFromRig(savedRig) || frameFromRig(committed);
    if (painted) return painted; // Preserve custom species without any authored chathead frame.
    const knownSpecies = window.CreatureGeneticsRender?.SPECIES?.[base];
    return knownSpecies ? { x: 0.32, y: 0.17, width: 0.36, height: 0.36,
      coordinateSpace: 'sprite-normalized-top-left' } : null; // Only known sprite species get a conservative fallback; unknown IDs still skip.
  }

  const idleMasks = new Map(); // One native-pixel idle silhouette per species; never regenerated from run/sleep/shoulder poses.
  const pendingIdleMasks = new Map(); // Deduplicates concurrent requests across nursery, nests, incubators and equipped pets.
  const maskSourceIds = new WeakMap(); // Editor replaces the mask when it imports a different idle PNG for the same species.
  let nextSourceId = 1; // Stable identity for source images used only in mask cache keys.

  function baseKind(kind) {
    const normalized = String(kind || '').trim().toLowerCase().replace(/_/g, '-');
    return window.HobunjiAnimalHeadRigSpecies?.baseSpeciesFor?.(normalized) || normalized;
  }

  function frameKey(frame) {
    return frame ? [frame.x, frame.y, frame.width, frame.height].map(value => Number(value).toFixed(6)).join(':') : '';
  }

  function buildIdleMask(pixels, width, height, rawFrame) {
    const w = Math.floor(Number(width)), h = Math.floor(Number(height)), frame = validateFrame(rawFrame);
    if (!frame || !pixels || w < 1 || h < 1 || pixels.length !== w * h * 4) return null;
    const left = Math.max(0, Math.floor(frame.x * w)), top = Math.max(0, Math.floor(frame.y * h));
    const right = Math.min(w, Math.ceil((frame.x + frame.width) * w)), bottom = Math.min(h, Math.ceil((frame.y + frame.height) * h));
    const occupied = new Uint8Array(w * h); // Alpha > 0 inside the chathead frame is the ONLY full-strength source domain.
    const distance = new Float32Array(w * h); // Chamfer distance to the nearest opaque idle-head pixel for the soft transition.
    distance.fill(Infinity);
    let pixelsInside = 0, sumX = 0, sumY = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const i = y * w + x;
        if (pixels[i * 4 + 3] === 0) continue;
        occupied[i] = 1;
        distance[i] = 0;
        pixelsInside++;
        sumX += x + 0.5;
        sumY += y + 0.5;
      }
    }
    if (!pixelsInside) return null; // Never enlarge an empty chathead frame, nor silently restore the rectangular behavior.
    const diagonal = Math.SQRT2; // Approximate Euclidean distance with two linear-time eight-neighbour passes.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
      if (y) {
        distance[i] = Math.min(distance[i], distance[i - w] + 1);
        if (x) distance[i] = Math.min(distance[i], distance[i - w - 1] + diagonal);
        if (x + 1 < w) distance[i] = Math.min(distance[i], distance[i - w + 1] + diagonal);
      }
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x + 1 < w) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
      if (y + 1 < h) {
        distance[i] = Math.min(distance[i], distance[i + w] + 1);
        if (x + 1 < w) distance[i] = Math.min(distance[i], distance[i + w + 1] + diagonal);
        if (x) distance[i] = Math.min(distance[i], distance[i + w - 1] + diagonal);
      }
    }
    const fade = Math.max(1, Math.max(frame.width * w, frame.height * h) / 2 * FALLOFF_RADIUS);
    const coverage = new Float32Array(w * h); // Sampled in normalized coordinates so run poses reuse the unchanged idle silhouette.
    for (let i = 0; i < coverage.length; i++) {
      const d = distance[i];
      if (d === 0) coverage[i] = 1;
      else if (d < fade) {
        const t = d / fade;
        coverage[i] = 1 - t * t * (3 - 2 * t);
      }
    }
    return { width: w, height: h, frame, frameKey: frameKey(frame),
      opaquePixels: pixelsInside, centerX: sumX / pixelsInside, centerY: sumY / pixelsInside, coverage };
  }

  function sourcePixels(image) {
    const w = Number(image?.naturalWidth || image?.width), h = Number(image?.naturalHeight || image?.height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 4_000_000) return null;
    if (image?.data?.length === w * h * 4) return { data: image.data, width: w, height: h }; // ImageData/fixture input.
    const canvas = typeof image?.getContext === 'function' ? image : document.createElement('canvas');
    if (canvas !== image) { canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(image, 0, 0, w, h); }
    const data = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h)?.data;
    return data ? { data, width: w, height: h } : null;
  }

  function maskForKind(kind, frameOverride = null) {
    const key = baseKind(kind), cached = idleMasks.get(key);
    const frame = validateFrame(frameOverride) || frameForKind(key);
    return cached?.frameKey === frameKey(frame) ? cached.mask : null; // Never use a stale mask after an authored frame edit.
  }

  function primeIdleMask(kind, image, frameOverride = null) {
    const key = baseKind(kind), frame = validateFrame(frameOverride) || frameForKind(key);
    if (!key || !frame || !image) return null;
    const sourceId = image && typeof image === 'object' ? (maskSourceIds.get(image) || nextSourceId++) : 0;
    if (sourceId && !maskSourceIds.has(image)) maskSourceIds.set(image, sourceId);
    const id = sourceId + '|' + frameKey(frame);
    const previous = idleMasks.get(key);
    if (previous?.id === id) return previous.mask;
    idleMasks.delete(key); // A newly imported transparent/invalid sprite must not inherit the previous image's mask.
    try {
      const source = sourcePixels(image);
      const mask = source && buildIdleMask(source.data, source.width, source.height, frame);
      if (!mask) throw new Error('The idle sprite has no opaque pixels inside its chathead frame.');
      idleMasks.set(key, { id, frameKey: frameKey(frame), mask });
      debug.lastMaskKind = key;
      debug.lastMaskPixels = mask.opaquePixels;
      debug.lastMaskError = null;
      return mask;
    } catch (error) {
      debug.lastMaskError = String(error?.message || error); // On mobile, report tainted/unreadable idle art instead of a fake enlargement.
      return null;
    }
  }

  async function ensureIdleMask(kind, idleSource = null, frameOverride = null) {
    const key = baseKind(kind);
    if (!key) return null;
    const current = maskForKind(key, frameOverride);
    if (current) return current;
    if (idleSource) return primeIdleMask(key, idleSource, frameOverride); // Caller guarantees this is an IDLE pose; never prime from run2.
    if (pendingIdleMasks.has(key)) return pendingIdleMasks.get(key);
    const promise = (async () => {
      try {
        const renderer = window.CreatureGeneticsRender;
        const raw = renderer?.SPECIES?.[key]?.base?.idle; // Source is the species' authored base IDLE sprite, independent of genotype.
        if (!raw) throw new Error('No registered idle base sprite: ' + key);
        const url = /^(?:https?:|blob:|data:)/i.test(raw) ? raw : new URL(raw, document.baseURI).href;
        const image = await new Promise((resolve, reject) => {
          const idle = new Image();
          idle.crossOrigin = 'anonymous'; // Raw hosted assets must not taint head-mask canvas pixel reads.
          idle.onload = () => resolve(idle);
          idle.onerror = () => reject(new Error('Idle source unavailable or not CORS-readable: ' + raw));
          idle.src = url;
        });
        return maskForKind(key) || primeIdleMask(key, image, frameOverride);
      } catch (error) {
        debug.lastMaskError = String(error?.message || error);
        return null;
      }
    })();
    pendingIdleMasks.set(key, promise);
    try { return await promise; }
    finally { if (pendingIdleMasks.get(key) === promise) pendingIdleMasks.delete(key); }
  }

  function warpPixels(source, width, height, frame, requestedScale = scale, idleMask = null) {
    const w = Math.floor(Number(width)), h = Math.floor(Number(height));
    const magnification = clampScale(requestedScale);
    if (!source || w < 1 || h < 1 || source.length !== w * h * 4) return null;
    const output = new Uint8ClampedArray(source); // Do not change adult/shared artwork, its alpha, or distant unmasked pixels.
    if (!idleMask || !frame || magnification <= 1) return output; // No idle alpha mask: NEVER fall back to stretching the entire frame.
    const mxScale = idleMask.width / w, myScale = idleMask.height / h;
    const cx = idleMask.centerX / mxScale, cy = idleMask.centerY / myScale; // Opaque-pixel centroid from IDLE, shared by all poses.
    for (let y = 0; y < h; y++) {
      const my = Math.max(0, Math.min(idleMask.height - 1, Math.floor((y + 0.5) * myScale)));
      for (let x = 0; x < w; x++) {
        const mx = Math.max(0, Math.min(idleMask.width - 1, Math.floor((x + 0.5) * mxScale)));
        const influence = idleMask.coverage[my * idleMask.width + mx];
        if (!(influence > 0)) continue;
        const factor = 1 + (magnification - 1) * influence;
        const sx = Math.max(0, Math.min(w - 1, Math.round(cx + (x + 0.5 - cx) / factor - 0.5)));
        const sy = Math.max(0, Math.min(h - 1, Math.round(cy + (y + 0.5 - cy) / factor - 0.5)));
        const from = (sy * w + sx) * 4, to = (y * w + x) * 4;
        output[to] = source[from]; output[to + 1] = source[from + 1];
        output[to + 2] = source[from + 2]; output[to + 3] = source[from + 3];
      }
    }
    return output;
  }

  function applyToCanvas(canvas, kind, previewScale = null, previewFrame = null) {
    const selectedScale = previewScale == null ? scaleForKind(kind) : clampScale(previewScale);
    if (!canvas || selectedScale <= 1) { debug.skipped++; return canvas; }
    const frame = validateFrame(previewFrame) || frameForKind(kind);
    const mask = maskForKind(kind, frame);
    if (!frame || !mask || mask.frameKey !== frameKey(frame)) {
      debug.skipped++; debug.lastKind = kind; debug.lastFrame = 'idle opacity mask unavailable';
      debug.lastError = 'Prepare the idle head opacity mask before enlarging ' + kind
        + (debug.lastMaskError ? ': ' + debug.lastMaskError : '');
      return canvas;
    }
    try {
      const w = canvas.width, h = canvas.height; // Original native pose resolution; no recropping or new mask generation.
      const src = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h);
      if (!src) return canvas;
      const warped = warpPixels(src.data, w, h, frame, selectedScale, mask);
      if (!warped) return canvas;
      const output = document.createElement('canvas');
      output.width = w; output.height = h;
      const ctx = output.getContext('2d');
      const image = ctx.createImageData(w, h);
      image.data.set(warped);
      ctx.putImageData(image, 0, 0);
      debug.applied++; debug.lastKind = kind; debug.lastFrame = frame; debug.lastError = null;
      return output;
    } catch (error) {
      debug.lastError = String(error?.message || error);
      return canvas;
    }
  }

  window.BabyAnimalHeadWarp = Object.freeze({
    DEFAULT_SCALE, MAX_SCALE, getScale: () => scale, setScale, scaleForKind,
    frameForKind, frameFromRig, validateFrame, isSmallSizeVariantPet, buildIdleMask, maskForKind, primeIdleMask, ensureIdleMask, warpPixels, applyToCanvas,
    debugSnapshot: () => ({ ...debug, scale, defaultScale: DEFAULT_SCALE, falloffRadius: FALLOFF_RADIUS, masksCached: idleMasks.size, masksPending: pendingIdleMasks.size }),
  });
})();
