// Baby/small-pet head size and brachycephaly on completed genotype textures.
// Default head selection is the idle chathead opacity mask; optional legacy selection
// restores the earlier painted-Head rectangle and its soft falloff.
(() => {
  'use strict';

  const STORAGE_KEY = 'hobunji_baby_head_warp_scale_v1'; // Keeps the Nursery experiment's chosen scale across reloads without modifying saves.
  const DEFAULT_SCALE = 1.23; // User-approved universal 123% for babies and qualifying genetically Small shoulder pets.
  const MAX_SCALE = 1.45; // Safety cap for the Nursery slider and public setter.
  const DEFAULT_SHORTENING = 0.08; // Universal inherited 8% front-to-back shortening for babies and eligible Small shoulder pets.
  const MAX_SHORTENING = 0.45; // Prevents an unnaturally flattened or inverted skull.
  const SHORTENING_STORAGE_KEY = 'hobunji_baby_head_shortening_v1'; // Saved global Nursery shortening, independent of head enlargement.
  const MAX_ABDOMEN_SCALE = 1.8; // Upper safety bound for the optional abdominal-growth region.
  const FALLOFF_RADIUS = 0.85; // In units of the larger head-frame half-extent; adjacent neck/body pixels move less with distance.
  const debug = { applied: 0, skipped: 0, lastKind: null, lastFrame: null, lastError: null }; // Exposed in Nursery Debug for mobile inspection.

  function clampScale(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(1, Math.min(MAX_SCALE, number)) : DEFAULT_SCALE;
  }

  function clampShortening(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(MAX_SHORTENING, number)) : DEFAULT_SHORTENING;
  }

  let shortening = (() => {
    try { const saved = window.localStorage?.getItem(SHORTENING_STORAGE_KEY); return saved == null || Number(saved) === 0.20
      ? DEFAULT_SHORTENING : clampShortening(saved); // Migrate the former 20% global default; keep other chosen amounts.
    catch (_) { return DEFAULT_SHORTENING; }
  })(); // Current shortening used by babies and genetically Small pets when a species has no override.
  function getShortening() { return shortening; }
  function setShortening(value) {
    shortening = clampShortening(value);
    try { window.localStorage?.setItem(SHORTENING_STORAGE_KEY, String(shortening)); } catch (_) {}
    return shortening;
  }

  let scale = (() => {
    try {
      const saved = window.localStorage?.getItem(STORAGE_KEY);
      return saved == null || Number(saved) === 1.22 || Number(saved) === 1.32 ? DEFAULT_SCALE : clampScale(saved); // Migrate earlier inherited defaults to 123%; preserve other custom choices.
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

  function babyHeadConfigForKind(kind) {
    const normalized = String(kind || '').trim().toLowerCase().replace(/_/g, '-'); // Shared per-species authored rig lookup.
    const base = window.HobunjiAnimalHeadRigSpecies?.baseSpeciesFor?.(normalized) || normalized;
    const preview = readPreviewRigs();
    const previewRig = preview?.[normalized] || preview?.[base] || null;
    const committed = window.HobunjiAuthoredAnimalHeadRigs?.get?.(base)
      || window.CreatureGeneticsRender?.headRigForKind?.(base) || null;
    return { previewRig, committed };
  }
  function shorteningForKind(kind) {
    const { previewRig, committed } = babyHeadConfigForKind(kind);
    const authored = previewRig?.babyHeadShortening ?? committed?.babyHeadShortening;
    return authored == null ? shortening : clampShortening(authored);
  }
  function usePaintedHeadForKind(kind) {
    const { previewRig, committed } = babyHeadConfigForKind(kind);
    return (previewRig?.babyHeadUsePaintedFrame ?? committed?.babyHeadUsePaintedFrame) === true;
  }
  function customHeadFrameForKind(kind) {
    const { previewRig, committed } = babyHeadConfigForKind(kind); // Use a specifically authored box instead of the dialogue portrait.
    if ((previewRig?.babyHeadUseCustomFrame ?? committed?.babyHeadUseCustomFrame) !== true) return null;
    return validateFrame(previewRig?.babyHeadCustomFrame ?? committed?.babyHeadCustomFrame);
  }
  function abdomenForKind(kind) {
    const { previewRig, committed } = babyHeadConfigForKind(kind);
    const enabled = (previewRig?.babyAbdomenEnabled ?? committed?.babyAbdomenEnabled) === true;
    const frame = validateFrame(previewRig?.babyAbdomenFrame ?? committed?.babyAbdomenFrame);
    const authoredScale = previewRig?.babyAbdomenScale ?? committed?.babyAbdomenScale;
    const scale = Number.isFinite(authoredScale) ? Math.max(1, Math.min(MAX_ABDOMEN_SCALE, authoredScale)) : 1.2;
    return { enabled: enabled && !!frame, frame, scale }; // Missing/invalid rectangles cannot accidentally deform whole torsos.
  }
  function maskModeForKind(kind) { return usePaintedHeadForKind(kind) ? 'legacy-frame' : 'idle-alpha'; }

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

  function frameFromRig(rig, paintedOnly = false) {
    if (!rig || typeof rig !== 'object') return null;
    const explicit = paintedOnly ? null : validateFrame(rig.babyHeadFrame); // Legacy mode selects the actual painted Head map.
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

  function frameForKind(kind, usePaintedHead = usePaintedHeadForKind(kind)) {
    const custom = customHeadFrameForKind(kind);
    if (custom) return custom; // Explicit head-growth box overrides both the chathead portrait and painted automatic bounds.
    const normalized = String(kind || '').trim().toLowerCase().replace(/_/g, '-'); // Canonical species key for head-rig and chathead profiles.
    const base = window.HobunjiAnimalHeadRigSpecies?.baseSpeciesFor?.(normalized) || normalized; // Species variants share the actual authored head paint.
    const previews = readPreviewRigs(); // Same cached object as scaleForKind to avoid duplicate JSON parses.
    const savedRig = previews?.[normalized] || previews?.[base];
    const committed = window.HobunjiAuthoredAnimalHeadRigs?.get?.(base)
      || window.CreatureGeneticsRender?.headRigForKind?.(base);
    const chathead = validateFrame(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[base]?.chatheadFrame);
    if (usePaintedHead) {
      const painted = frameFromRig(savedRig, true) || frameFromRig(committed, true);
      if (painted) return painted; // Original approach: use the strong painted Head bounds, rather than alpha in chathead crop.
    }
    if (chathead) return chathead; // The authored dialogue frame strictly bounds which IDLE opaque pixels belong to the source head mask.
    const explicitlyPainted = validateFrame(savedRig?.babyHeadFrame) || validateFrame(committed?.babyHeadFrame);
    if (explicitlyPainted) return explicitlyPainted; // Moot/custom species without a chathead profile keep their explicitly exported baby source box.
    const dialogue = validateFrame(window.AnimalChatheadFrame?.frameForKind?.(base));
    if (dialogue && (savedRig || committed || window.CreatureGeneticsRender?.SPECIES?.[base] || admittedIdleKinds.has(base))) return dialogue;
    // The dialogue solver has a generic fallback even for unknown species. Only registered creatures can inherit that frame.
    const painted = frameFromRig(savedRig) || frameFromRig(committed);
    if (painted) return painted; // Preserve custom species without any authored chathead frame.
    const knownSpecies = window.CreatureGeneticsRender?.SPECIES?.[base];
    return (knownSpecies || admittedIdleKinds.has(base)) ? { x: 0.32, y: 0.17, width: 0.36, height: 0.36,
      coordinateSpace: 'sprite-normalized-top-left' } : null; // Only known sprite species get a conservative fallback; unknown IDs still skip.
  }

  const admittedIdleKinds = new Set(); // The real idle PNG is proof of a species even if its genotype renderer has no entry (birds, Moot, etc.).
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
    const distance = new Float32Array(w * h); // Chamfer distance to the nearest opaque idle-head pixel for the soft transition.
    distance.fill(Infinity);
    let pixelsInside = 0, sumX = 0, sumY = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const i = y * w + x;
        if (pixels[i * 4 + 3] === 0) continue;
        distance[i] = 0; // Only alpha>0 idle pixels inside the chathead crop seed the distance field.
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

  const MAX_IDLE_MASK_PIXELS = 1024 * 1024; // Bounds the two floating-point distance/coverage maps even for 3000×2250 Grehlr art.
  function sourcePixels(image) {
    const w = Number(image?.naturalWidth || image?.width), h = Number(image?.naturalHeight || image?.height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 32_000_000) return null;
    const ratio = Math.min(1, Math.sqrt(MAX_IDLE_MASK_PIXELS / (w * h))); // Mask resolution only; final pose textures retain their native dimensions.
    const maskW = Math.max(1, Math.floor(w * ratio)), maskH = Math.max(1, Math.floor(h * ratio));
    if (image?.data?.length === w * h * 4) {
      if (maskW === w && maskH === h) return { data: image.data, width: w, height: h }; // Keep exact pixels for small ImageData fixtures.
      const data = new Uint8ClampedArray(maskW * maskH * 4); // Raw ImageData has no drawImage source; sample its alpha at mask resolution.
      for (let y = 0; y < maskH; y++) for (let x = 0; x < maskW; x++) {
        const sx = Math.min(w - 1, Math.floor((x + 0.5) * w / maskW));
        const sy = Math.min(h - 1, Math.floor((y + 0.5) * h / maskH));
        const from = (sy * w + sx) * 4, to = (y * maskW + x) * 4;
        for (let c = 0; c < 4; c++) data[to + c] = image.data[from + c];
      }
      return { data, width: maskW, height: maskH };
    }
    const canvas = typeof image?.getContext === 'function' && maskW === w && maskH === h
      ? image : document.createElement('canvas');
    if (canvas !== image) {
      canvas.width = maskW; canvas.height = maskH;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.imageSmoothingEnabled = false; // Nearest-neighbor opacity sampling preserves sharp authored sprite boundaries.
      context.drawImage(image, 0, 0, maskW, maskH);
    }
    const data = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, maskW, maskH)?.data;
    return data ? { data, width: maskW, height: maskH } : null;
  }

  function maskForKind(kind, frameOverride = null) {
    const key = baseKind(kind), cached = idleMasks.get(key);
    const frame = validateFrame(frameOverride) || frameForKind(key);
    return cached?.frameKey === frameKey(frame) ? cached.mask : null; // Never use a stale mask after an authored frame edit.
  }

  function primeIdleMask(kind, image, frameOverride = null, sourceLabel = 'caller-idle-pose') {
    const key = baseKind(kind);
    if (!key || !image) return null;
    if (!frameForKind(key)) admittedIdleKinds.add(key); // A real uploaded/decoded idle image enables the dialogue solver fallback.
    const frame = validateFrame(frameOverride) || frameForKind(key);
    if (!frame) return null;
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
      mask.sourceLabel = sourceLabel; // Mobile debugger distinguishes authoritative PNG masks from caller-provided idle fallback canvases.
      idleMasks.set(key, { id, frameKey: frameKey(frame), mask });
      debug.lastMaskKind = key;
      debug.lastMaskSource = sourceLabel;
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
    if (key && idleSource && !frameForKind(key)) admittedIdleKinds.add(key); // Never invent a species until a real idle sprite is supplied.
    const frame = validateFrame(frameOverride) || frameForKind(key); // One authored source crop shared across every genotype and pose.
    if (!key || !frame) return null;
    const current = maskForKind(key, frame);
    if (current) return current;
    const promiseKey = key + '|' + frameKey(frame); // Different revisions of an authored chathead box must not share a pending request.
    if (pendingIdleMasks.has(promiseKey)) return pendingIdleMasks.get(promiseKey);
    const promise = (async () => {
      try {
        const raw = window.CreatureGeneticsRender?.SPECIES?.[key]?.base?.idle; // Prefer the untouched species IDLE art, never an individual genotype's eye/pattern composite.
        if (raw) {
          try {
            const url = /^(?:https?:|blob:|data:)/i.test(raw) ? raw : new URL(raw, document.baseURI).href;
            const image = await new Promise((resolve, reject) => {
              const idle = new Image();
              idle.crossOrigin = 'anonymous'; // Needed before src so hosted raw idle pixels remain readable.
              idle.onload = () => resolve(idle);
              idle.onerror = () => reject(new Error('Idle sprite unavailable or not CORS-readable: ' + raw));
              idle.src = url;
            });
            const produced = primeIdleMask(key, image, frame, 'unmodified-base-idle-png');
            if (produced) return produced; // The unmodified idle silhouette is authoritative whenever available.
            return null; // A transparent authored head box must remain empty, not silently become a genotype-driven mask.
          } catch (error) {
            debug.lastMaskError = String(error?.message || error);
            // Unregistered/temporarily unavailable raw assets may still have a genuine idle canvas from the caller.
          }
        }
        if (idleSource) return primeIdleMask(key, idleSource, frame, 'provided-idle-fallback'); // Fallback ONLY to a caller explicitly supplying the IDLE pose.
        if (!raw) debug.lastMaskError = 'No registered idle sprite for ' + key;
        return null;
      } catch (error) {
        debug.lastMaskError = String(error?.message || error);
        return null;
      }
    })();
    pendingIdleMasks.set(promiseKey, promise);
    try { return await promise; }
    finally { if (pendingIdleMasks.get(promiseKey) === promise) pendingIdleMasks.delete(promiseKey); }
  }

  function warpPixels(source, width, height, frame, requestedScale = scale, idleMask = null, requestedShortening = 0, mode = 'idle-alpha') {
    const w = Math.floor(Number(width)), h = Math.floor(Number(height));
    const magnification = clampScale(requestedScale), shorten = clampShortening(requestedShortening);
    if (!source || w < 1 || h < 1 || source.length !== w * h * 4) return null;
    const output = new Uint8ClampedArray(source); // Final eyes, coats, patterns and non-head pixels are never mutated in the shared texture.
    const legacy = mode === 'legacy-frame';
    if (!frame || (magnification <= 1 && shorten <= 0) || (!legacy && !idleMask)) return output;
    const left = frame.x * w, top = frame.y * h, halfW = frame.width * w / 2, halfH = frame.height * h / 2;
    const cx = legacy ? left + halfW : idleMask.centerX * w / idleMask.width;
    const cy = legacy ? top + halfH : idleMask.centerY * h / idleMask.height;
    const fade = Math.max(1, Math.max(halfW, halfH) * FALLOFF_RADIUS); // Retains the older rectangular method's transition.
    const minX = legacy ? Math.max(0, Math.floor(left - fade)) : 0;
    const maxX = legacy ? Math.min(w - 1, Math.ceil(left + 2 * halfW + fade)) : w - 1;
    const minY = legacy ? Math.max(0, Math.floor(top - fade)) : 0;
    const maxY = legacy ? Math.min(h - 1, Math.ceil(top + 2 * halfH + fade)) : h - 1;
    for (let y = minY; y <= maxY; y++) {
      const dy = y + 0.5 - cy;
      const outsideY = legacy ? Math.max(0, Math.abs(dy) - halfH) : 0;
      const my = legacy ? 0 : Math.max(0, Math.min(idleMask.height - 1, Math.floor((y + 0.5) * idleMask.height / h)));
      for (let x = minX; x <= maxX; x++) {
        let influence;
        if (legacy) {
          const outsideX = Math.max(0, Math.abs(x + 0.5 - cx) - halfW);
          const distance = Math.hypot(outsideX, outsideY);
          if (distance >= fade) continue;
          const t = distance / fade;
          influence = 1 - t * t * (3 - 2 * t);
        } else {
          const mx = Math.max(0, Math.min(idleMask.width - 1, Math.floor((x + 0.5) * idleMask.width / w)));
          influence = idleMask.coverage[my * idleMask.width + mx];
        }
        if (!(influence > 0)) continue;
        // Horizontal compression shortens the muzzle/profile; vertical growth remains independent.
        const factorX = 1 + (magnification * (1 - shorten) - 1) * influence;
        const factorY = 1 + (magnification - 1) * influence;
        const sx = Math.max(0, Math.min(w - 1, Math.round(cx + (x + 0.5 - cx) / factorX - 0.5)));
        const sy = Math.max(0, Math.min(h - 1, Math.round(cy + dy / factorY - 0.5)));
        const from = (sy * w + sx) * 4, to = (y * w + x) * 4;
        output[to] = source[from]; output[to + 1] = source[from + 1];
        output[to + 2] = source[from + 2]; output[to + 3] = source[from + 3];
      }
    }
    return output;
  }

  function applyToCanvas(canvas, kind, previewScale = null, previewFrame = null,
                         previewShortening = null, previewPainted = null, previewAbdomen = null) {
    const selectedScale = previewScale == null ? scaleForKind(kind) : clampScale(previewScale);
    const selectedShortening = previewShortening == null ? shorteningForKind(kind) : clampShortening(previewShortening);
    const painted = previewPainted == null ? usePaintedHeadForKind(kind) : previewPainted === true;
    const abdomen = previewAbdomen == null ? abdomenForKind(kind) : previewAbdomen;
    const abdomenFrame = abdomen?.enabled ? validateFrame(abdomen.frame) : null;
    const abdomenScale = abdomenFrame && Number.isFinite(abdomen.scale)
      ? Math.max(1, Math.min(MAX_ABDOMEN_SCALE, abdomen.scale)) : 1;
    const growAbdomen = !!abdomenFrame && abdomenScale > 1;
    const growHead = selectedScale > 1 || selectedShortening > 0;
    if (!canvas || (!growHead && !growAbdomen)) { debug.skipped++; return canvas; }
    const frame = validateFrame(previewFrame) || frameForKind(kind, painted);
    const mask = growHead && !painted ? maskForKind(kind, frame) : null;
    const canGrowHead = growHead && !!frame && (painted || !!mask && mask.frameKey === frameKey(frame));
    if (growHead && !canGrowHead && !growAbdomen) {
      debug.skipped++; debug.lastKind = kind; debug.lastFrame = 'idle opacity mask unavailable';
      debug.lastError = 'Prepare the idle head opacity mask before enlarging ' + kind
        + (debug.lastMaskError ? ': ' + debug.lastMaskError : '');
      return canvas;
    }
    try {
      const w = canvas.width, h = canvas.height; // Final composited pose art, never a shared adult texture.
      const src = canvas.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h);
      if (!src) return canvas;
      let pixels = src.data;
      if (canGrowHead) pixels = warpPixels(pixels, w, h, frame, selectedScale, mask, selectedShortening,
        painted ? 'legacy-frame' : 'idle-alpha'); // Preserve the existing head mask and brachycephaly behavior.
      if (growAbdomen) pixels = warpPixels(pixels, w, h, abdomenFrame, abdomenScale, null, 0, 'legacy-frame');
      if (!pixels) return canvas;
      const output = document.createElement('canvas');
      output.width = w; output.height = h;
      const ctx = output.getContext('2d');
      const image = ctx.createImageData(w, h);
      image.data.set(pixels);
      ctx.putImageData(image, 0, 0);
      debug.applied++; debug.lastKind = kind;
      debug.lastFrame = { head: canGrowHead ? frame : null, abdomen: growAbdomen ? abdomenFrame : null };
      debug.lastError = growHead && !canGrowHead ? 'Head mask unavailable; abdomen was enlarged independently.' : null;
      return output;
    } catch (error) {
      debug.lastError = String(error?.message || error);
      return canvas;
    }
  }

  window.BabyAnimalHeadWarp = Object.freeze({
    DEFAULT_SCALE, MAX_SCALE, DEFAULT_SHORTENING, MAX_SHORTENING, MAX_ABDOMEN_SCALE, getScale: () => scale, setScale, scaleForKind,
    getShortening, setShortening, shorteningForKind, usePaintedHeadForKind, maskModeForKind,
    customHeadFrameForKind, abdomenForKind,
    frameForKind, frameFromRig, validateFrame, isSmallSizeVariantPet, buildIdleMask, maskForKind, primeIdleMask, ensureIdleMask, warpPixels, applyToCanvas,
    debugSnapshot: () => ({ ...debug, scale, shortening, defaultScale: DEFAULT_SCALE, defaultShortening: DEFAULT_SHORTENING, falloffRadius: FALLOFF_RADIUS, masksCached: idleMasks.size, masksPending: pendingIdleMasks.size, rawOnlyKinds: admittedIdleKinds.size }),
  });
})();
