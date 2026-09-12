// Reusable animal-NPC headwear compositor.
// Existing portrait hats are cropped to their opaque art, then attached to a
// species-authored (or head-rig-derived) normalized anchor on the creature sprite.
(() => {
  'use strict';

  const SCRIPT_URL = typeof document !== 'undefined' ? (document.currentScript?.src || '') : '';
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL).href : './';
  const ASSET_BASE = new URL('assets/', DOCS_BASE).href;
  const CONFIG_BASE = new URL('config/', DOCS_BASE).href;
  const BESTIARY_URL = new URL('config/creatures/hobunji-creature-bestiary.json', DOCS_BASE).href;
  const PREVIEW_STORAGE_KEY = 'hobunji_animal_head_rigs_v1'; // Same-origin authoring override written by the Animal Head Rig Painter.
  const DEFAULT_ATTACHMENT = Object.freeze({
    enabled: true,
    coordinateSpace: 'sprite-normalized-top-left',
    anchor: Object.freeze({ x: 0.5, y: 0.2 }),
    width: 0.34,
    rotationDeg: 0,
    flipX: false,
    artAnchor: Object.freeze({ x: 0.5, y: 0.86 }),
  });

  let cosmeticsPromise = null; // Reuses NpcAvatarPreview's already-cached portrait cosmetics when available.
  let bestiaryPromise = null; // Creature records provide optional authored hatAttachment data.
  const imageCache = new Map(); // Hat PNG image requests reused across NPC redraws.
  const cropCache = new Map(); // Opaque-bound crops reused across hat layers and NPCs.
  const debugState = { lastKind: null, lastHatId: null, lastAttachmentSource: null, lastError: null };

  const clamp = (value, min = 0, max = 1) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
  };
  const normalizeKind = kind => String(kind || '').trim().toLowerCase().replace(/_/g, '-');

  function headRigForKind(kind) {
    const normalized = normalizeKind(kind);
    return window.HobunjiAnimalHeadRigSpecies?.ANIMAL_HEAD_RIGS?.[normalized]
      || window.CreatureGeneticsRender?.headRigForKind?.(normalized)
      || window.CreatureGeneticsRender?.ANIMAL_HEAD_RIGS?.[normalized]
      || null;
  }

  function previewRigForKind(kind) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed[normalizeKind(kind)] || null : null;
    } catch (_) { return null; }
  }

  function decodeWeightMap(weightMap) {
    if (!weightMap?.width || !weightMap?.height || !Array.isArray(weightMap.data)) return null;
    const width = Math.max(1, Math.round(Number(weightMap.width) || 1));
    const height = Math.max(1, Math.round(Number(weightMap.height) || 1));
    const values = new Uint16Array(width * height);
    const unset = Number.isFinite(Number(weightMap.unsetValue)) ? Number(weightMap.unsetValue) : 256;
    values.fill(unset);
    if (weightMap.encoding === 'rle-u9') {
      let cursor = 0;
      for (let i = 0; i + 1 < weightMap.data.length && cursor < values.length; i += 2) {
        const run = Math.max(0, Math.round(Number(weightMap.data[i]) || 0));
        const value = Math.max(0, Math.min(256, Math.round(Number(weightMap.data[i + 1]) || 0)));
        const end = Math.min(values.length, cursor + run);
        values.fill(value, cursor, end);
        cursor = end;
      }
    } else {
      for (let i = 0; i < values.length && i < weightMap.data.length; i += 1) {
        values[i] = Math.max(0, Math.min(256, Math.round(Number(weightMap.data[i]) || 0)));
      }
    }
    return { width, height, values, unset };
  }

  function deriveAttachmentFromHeadRig(rig) {
    const decoded = decodeWeightMap(rig?.weightMap);
    if (decoded) {
      let minX = decoded.width, minY = decoded.height, maxX = -1, maxY = -1;
      for (let y = 0; y < decoded.height; y += 1) {
        for (let x = 0; x < decoded.width; x += 1) {
          const value = decoded.values[y * decoded.width + x];
          if (value === decoded.unset || value < 128) continue;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      if (maxX >= minX && maxY >= minY) {
        const headWidth = (maxX - minX + 1) / decoded.width;
        return {
          ...DEFAULT_ATTACHMENT,
          anchor: { x: (minX + maxX + 1) / (2 * decoded.width), y: minY / decoded.height },
          width: clamp(headWidth * 1.35, 0.14, 0.9),
          artAnchor: { ...DEFAULT_ATTACHMENT.artAnchor },
        };
      }
    }
    const pivot = rig?.pivot || {};
    return {
      ...DEFAULT_ATTACHMENT,
      anchor: {
        x: clamp(Number.isFinite(Number(pivot.x)) ? Number(pivot.x) : 0.5),
        y: clamp((Number.isFinite(Number(pivot.y)) ? Number(pivot.y) : 0.38) - 0.18),
      },
      artAnchor: { ...DEFAULT_ATTACHMENT.artAnchor },
    };
  }

  function normalizeAttachment(raw, fallbackRig = null) {
    const fallback = deriveAttachmentFromHeadRig(fallbackRig);
    if (!raw || raw.enabled === false) return raw?.enabled === false ? { ...fallback, enabled: false } : fallback;
    const anchor = raw.anchor || raw.point || {};
    const artAnchor = raw.artAnchor || raw.sourceAnchor || {};
    return {
      enabled: true,
      coordinateSpace: 'sprite-normalized-top-left',
      anchor: {
        x: clamp(anchor.x ?? raw.x ?? fallback.anchor.x),
        y: clamp(anchor.y ?? raw.y ?? fallback.anchor.y),
      },
      width: clamp(raw.width ?? raw.scale ?? fallback.width, 0.02, 2),
      rotationDeg: Math.max(-180, Math.min(180, Number(raw.rotationDeg ?? raw.rotDeg ?? fallback.rotationDeg) || 0)),
      flipX: raw.flipX === true || raw.mirrorX === true || fallback.flipX === true,
      artAnchor: {
        x: clamp(artAnchor.x ?? fallback.artAnchor.x),
        y: clamp(artAnchor.y ?? fallback.artAnchor.y),
      },
    };
  }

  async function loadBestiary() {
    if (bestiaryPromise) return bestiaryPromise;
    if (typeof fetch !== 'function') return {};
    bestiaryPromise = fetch(BESTIARY_URL, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        const map = {};
        for (const record of data?.creatures || []) if (record?.id) map[normalizeKind(record.id)] = record;
        return map;
      })
      .catch(error => { debugState.lastError = `bestiary: ${error.message}`; return {}; });
    return bestiaryPromise;
  }

  async function attachmentForKind(kind) {
    const normalized = normalizeKind(kind);
    const liveRig = headRigForKind(normalized);
    const previewRig = previewRigForKind(normalized); // Lets Save rig for game preview immediately test hat placement without committing the bestiary.
    if (previewRig?.hatAttachment) {
      debugState.lastAttachmentSource = 'browser-preview';
      return normalizeAttachment(previewRig.hatAttachment, previewRig);
    }
    const committed = await loadBestiary();
    const record = committed?.[normalized];
    const authored = record?.hatAttachment || record?.headRig?.hatAttachment || liveRig?.hatAttachment || null;
    debugState.lastAttachmentSource = authored ? 'authored' : 'derived-head-rig';
    return normalizeAttachment(authored, previewRig || liveRig);
  }

  function normalizeHatId(appearanceOrId) {
    if (typeof appearanceOrId === 'string') return appearanceOrId;
    return String(appearanceOrId?.animalHatId || appearanceOrId?.hatId || appearanceOrId?.animalHat?.id || 'none');
  }

  async function ensureCosmetics() {
    if (cosmeticsPromise) return cosmeticsPromise;
    if (!window.NpcAvatarPreview?.ensurePortraitCosmetics) return null;
    cosmeticsPromise = window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: ASSET_BASE, configBase: CONFIG_BASE })
      .catch(error => { debugState.lastError = `cosmetics: ${error.message}`; return null; });
    return cosmeticsPromise;
  }

  async function hatOptions() {
    const cosmetics = await ensureCosmetics();
    return Array.isArray(cosmetics?.hatOptions) ? cosmetics.hatOptions : [];
  }

  async function resolveHatOption(hatId) {
    if (!hatId || hatId === 'none') return null;
    const cosmetics = await ensureCosmetics();
    return cosmetics?.optionCache?.get(hatId)
      || cosmetics?.hatOptions?.find(option => option?.id === hatId || option?.originalId === hatId)
      || null;
  }

  function resolveLayers(option) {
    if (!option) return [];
    try {
      const layers = typeof window.resolveOptionLayers === 'function'
        ? window.resolveOptionLayers(option, null)
        : option.layers;
      return Array.isArray(layers) ? layers.filter(layer => layer?.url) : [];
    } catch (_) {
      return Array.isArray(option.layers) ? option.layers.filter(layer => layer?.url) : [];
    }
  }

  function assetUrl(path) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^(?:data:|blob:|https?:)/i.test(raw)) return raw;
    const clean = raw.replace(/^\.\/assets\//, '').replace(/^assets\//, '').replace(/^\.\//, '');
    return new URL(clean, ASSET_BASE).href;
  }

  function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    if (typeof Image === 'undefined') return Promise.resolve(null);
    const promise = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    imageCache.set(url, promise);
    return promise;
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  async function opaqueCrop(url) {
    if (cropCache.has(url)) return cropCache.get(url);
    const promise = (async () => {
      const image = await loadImage(url);
      if (!image || typeof document === 'undefined') return null;
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      const source = makeCanvas(width, height), ctx = source.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, width, height);
      let data;
      try { data = ctx.getImageData(0, 0, width, height).data; } catch (_) { return { canvas: source, width, height }; }
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (data[(y * width + x) * 4 + 3] < 8) continue;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      if (maxX < minX || maxY < minY) return null;
      const cropWidth = maxX - minX + 1, cropHeight = maxY - minY + 1;
      const crop = makeCanvas(cropWidth, cropHeight);
      crop.getContext('2d').drawImage(source, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return { canvas: crop, width: cropWidth, height: cropHeight };
    })();
    cropCache.set(url, promise);
    return promise;
  }

  function drawAttachedLayer(ctx, crop, attachment, targetWidth, targetHeight) {
    if (!crop?.canvas || !attachment?.enabled) return;
    const drawWidth = Math.max(1, attachment.width * targetWidth);
    const drawHeight = drawWidth * crop.height / Math.max(1, crop.width);
    const ax = attachment.anchor.x * targetWidth;
    const ay = attachment.anchor.y * targetHeight;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(attachment.rotationDeg * Math.PI / 180);
    if (attachment.flipX) ctx.scale(-1, 1); // Species-level mirror keeps the authored art anchor pinned while reversing asymmetric hat art.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(crop.canvas, -attachment.artAnchor.x * drawWidth, -attachment.artAnchor.y * drawHeight, drawWidth, drawHeight);
    ctx.restore();
  }

  async function composeWithHat(baseSource, kind, appearanceOrId = {}, options = {}) {
    if (!baseSource || typeof document === 'undefined') return baseSource;
    const hatId = normalizeHatId(appearanceOrId);
    if (!hatId || hatId === 'none') return baseSource;
    const option = await resolveHatOption(hatId);
    if (!option) return baseSource;
    const attachment = normalizeAttachment(options.attachment || await attachmentForKind(kind), headRigForKind(kind));
    if (!attachment.enabled) return baseSource;
    const layers = resolveLayers(option);
    if (!layers.length) return baseSource;
    const width = Number(baseSource.width || baseSource.naturalWidth) || 0;
    const height = Number(baseSource.height || baseSource.naturalHeight) || 0;
    if (!width || !height) return baseSource;
    const prepared = [];
    for (const layer of layers) {
      const url = assetUrl(layer.url);
      const crop = url ? await opaqueCrop(url) : null;
      if (crop) prepared.push({ crop, pos: layer.pos || 'front', url });
    }
    if (!prepared.length) return baseSource;
    const output = makeCanvas(width, height), ctx = output.getContext('2d');
    for (const layer of prepared) if (layer.pos === 'back') drawAttachedLayer(ctx, layer.crop, attachment, width, height);
    ctx.drawImage(baseSource, 0, 0, width, height);
    for (const layer of prepared) if (layer.pos !== 'back') drawAttachedLayer(ctx, layer.crop, attachment, width, height);
    debugState.lastKind = normalizeKind(kind);
    debugState.lastHatId = hatId;
    debugState.lastError = null;
    output.__hobunjiAnimalNpcHat = { kind: debugState.lastKind, hatId, attachment: { ...attachment, anchor: { ...attachment.anchor }, artAnchor: { ...attachment.artAnchor } } };
    return output;
  }

  window.AnimalNpcHeadwear = Object.freeze({
    DEFAULT_ATTACHMENT,
    normalizeAttachment,
    deriveAttachmentFromHeadRig,
    previewRigForKind,
    attachmentForKind,
    hatOptions,
    resolveHatOption,
    composeWithHat,
    getDebug: () => ({ ...debugState }),
  });
})();
