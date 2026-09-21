(() => {
  'use strict';

  const SCHEMA = 'hobunji_neck_patch_deformations.v1';
  const CONFIG_URL = '../../config/cosmetics/neck-patch-deformations.json';
  const STORAGE_KEY = 'hobunji_neck_patch_deformer_draft_v1';
  const NPC_DB_URL = '../../config/npcs/hobunji-starter-npc-database.json';
  const ALLOWED_GRID_SIZES = Object.freeze([2, 3, 4]);
  const POINT_LIMIT = Object.freeze({ min: -0.5, max: 1.5 });

  const FAMILY_DEFS = Object.freeze({
    poncho: {
      label: 'Poncho (fine + rugged)',
      cosmeticIds: ['fine_poncho', 'rugged_poncho'],
      source: '../../assets/cosmetics/clothes/overwear/portrait/patchsprite_poncho-behind.png',
      exportSource: './assets/cosmetics/clothes/overwear/portrait/patchsprite_poncho-behind.png',
      targets: {
        'mao-ao_male': 'poncho1_mao_m.png',
        'mao-ao_female': 'poncho1_mao_f.png',
        'tletingan_male': 'poncho1_tl_m.png',
        'tletingan_female': 'poncho1_tl_f.png',
        'kenkari_male': 'poncho1_kenk_m.png',
        'kenkari_female': 'poncho1_kenk_f.png',
        'rakakoan_male': 'poncho1_kenk_m.png',
        'rakakoan_female': 'poncho1_kenk_f.png',
        'engh-sho_male': 'poncho1_engh_m.png',
        'engh-sho_female': 'poncho1_engh_f.png',
        'mashtzarr_male': 'poncho1_mashtz_m.png',
        'mashtzarr_female': 'poncho1_mashtz_f.png',
      },
      targetDir: '../../assets/cosmetics/clothes/overwear/portrait/',
      exportTargetDir: './assets/cosmetics/clothes/overwear/portrait/',
      exportStem: 'poncho1-behind',
      zipDir: 'docs/assets/cosmetics/clothes/overwear/portrait',
    },
    bodywrap: {
      label: 'Tankan Bodywrap',
      cosmeticIds: ['tankan_bodywrap'],
      source: '../../assets/cosmetics/clothes/overwear/portrait/patchsprite_bodywrap-behind.png',
      exportSource: './assets/cosmetics/clothes/overwear/portrait/patchsprite_bodywrap-behind.png',
      targets: {
        'mao-ao_male': 'tankanbodywrap_mao-ao.png',
        'mao-ao_female': 'tankanbodywrap_mao-ao_f.png',
        'tletingan_male': 'tankanbodywrap_tl_m.png',
        'tletingan_female': 'tankanbodywrap_tl_f.png',
        'kenkari_male': 'tankanbodywrap_kenk_m.png',
        'kenkari_female': 'tankanwrap_kenk_f.png',
        'rakakoan_male': 'tankanbodywrap_kenk_m.png',
        'rakakoan_female': 'tankanwrap_kenk_f.png',
        'engh-sho_male': 'tankanbodywrap_engh_m.png',
        'engh-sho_female': 'tankanbodywrap_engh_f.png',
        'mashtzarr_male': 'tankanbodywrap_mashtz_m.png',
        'mashtzarr_female': 'tankanbodywrap_mashtz_f.png',
      },
      targetDir: '../../assets/cosmetics/clothes/overwear/portrait/',
      exportTargetDir: './assets/cosmetics/clothes/overwear/portrait/',
      exportStem: 'tankanbodywrap-behind',
      zipDir: 'docs/assets/cosmetics/clothes/overwear/portrait',
    },
    tunic: {
      label: 'Tankan Tunic',
      cosmeticIds: ['tankan_tunic'],
      source: '../../assets/cosmetics/clothes/torso/portrait/patchsprite_tankantunic-behind.png',
      exportSource: './assets/cosmetics/clothes/torso/portrait/patchsprite_tankantunic-behind.png',
      targets: {
        'mao-ao_male': 'tankantunic_mao-ao_m.png',
        'mao-ao_female': 'tankantunic_mao-ao_f.png',
        'tletingan_male': 'tankantunic_tl_m.png',
        'tletingan_female': 'tankantunic_tl_f.png',
        'kenkari_male': 'tankantunic_kenk_m.png',
        'kenkari_female': 'tankantunic_kenk_f.png',
        'rakakoan_male': 'tankantunic_kenk_m.png',
        'rakakoan_female': 'tankantunic_kenk_f.png',
        'engh-sho_male': 'tankantunic_engh_m.png',
        'engh-sho_female': 'tankantunic_engh_f.png',
        'mashtzarr_female': 'tankantunic_mashtz_f.png',
      },
      targetDir: '../../assets/cosmetics/clothes/torso/portrait/',
      exportTargetDir: './assets/cosmetics/clothes/torso/portrait/',
      exportStem: 'tankantunic-behind',
      zipDir: 'docs/assets/cosmetics/clothes/torso/portrait',
    },
  });

  const SPECIES_FILE_CODES = Object.freeze({
    'mao-ao': 'mao',
    tletingan: 'tl',
    kenkari: 'kenk',
    rakakoan: 'rak',
    'engh-sho': 'engh',
    mashtzarr: 'mashtz',
  });

  const LABELS = Object.freeze({
    'mao-ao': 'Mao-ao',
    tletingan: 'Tletingan',
    kenkari: 'Kenkari',
    rakakoan: "Rakako'an",
    'engh-sho': 'Engh-sho',
    mashtzarr: 'Mashtzarr',
  });

  const $ = selector => document.querySelector(selector);
  const els = {
    family: $('#family'), variant: $('#variant'), gridSize: $('#gridSize'), stage: $('#stage'),
    pointMode: $('#pointMode'), transformMode: $('#transformMode'), undo: $('#undoBtn'), redo: $('#redoBtn'), reset: $('#resetBtn'),
    pointX: $('#pointX'), pointY: $('#pointY'), selectedBadge: $('#selectedBadge'), copyFrom: $('#copyFrom'), copyVariant: $('#copyVariantBtn'),
    npcReferenceOpacity: $('#npcReferenceOpacity'), garmentOpacity: $('#garmentOpacity'), patchOpacity: $('#patchOpacity'), xrayPatch: $('#xrayPatch'), showMesh: $('#showMesh'),
    debug: $('#debug'), assetNote: $('#assetNote'), npcReferenceNote: $('#npcReferenceNote'), saveStatus: $('#saveStatus'), importBtn: $('#importBtn'), importFile: $('#importFile'),
    npcReferenceSelect: $('#npcReferenceSelect'), loadNpcReferenceBtn: $('#loadNpcReferenceBtn'), clearNpcReferenceBtn: $('#clearNpcReferenceBtn'),
    showAboveTargetClothing: $('#showAboveTargetClothing'),
    copyBtn: $('#copyBtn'), downloadBtn: $('#downloadBtn'), downloadSpritesBtn: $('#downloadSpritesBtn'), clearDraft: $('#clearDraftBtn'),
  };
  const ctx = els.stage.getContext('2d');
  const objectUrlCache = new Map(); // Keeps fetch-backed Blob URLs alive for canvas-readable patch/garment images.

  window.addEventListener('beforeunload', () => {
    for (const objectUrl of objectUrlCache.values()) URL.revokeObjectURL(objectUrl);
    objectUrlCache.clear();
  });

  const state = {
    familyId: 'poncho',
    variantKey: 'mao-ao_male',
    mode: 'point',
    selectedPoint: null,
    config: makeEmptyConfig(),
    imageCache: new Map(),
    boundsCache: new Map(),
    patchImage: null,
    targetImage: null,
    repoNpcs: [], // Canonical checked-in NPC records available to the rear-portrait reference picker.
    npcReferenceId: '',
    npcReferenceGeneration: 0,
    npcReferenceBelow: null, // Runtime behind-portrait layers that render below the garment bucket currently being patched.
    npcReferenceAboveClothing: null, // Clothing/accessory layers above the target bucket; toggled without mutating the NPC record.
    npcReferenceAboveNonClothing: null, // Hair/non-clothing layers that remain above the target to preserve the real rear portrait stack.
    npcReferenceName: '',
    loadingToken: 0,
    pointer: null,
    undo: [],
    redo: [],
    dirty: false,
    loadWarnings: [],
  };

  function makeEmptyConfig() {
    const patches = {};
    for (const [familyId, def] of Object.entries(FAMILY_DEFS)) {
      patches[familyId] = { source: def.exportSource, sourceBounds: null, variants: {} };
    }
    return { schema: SCHEMA, patches };
  }

  function splitVariantKey(key) {
    const cut = key.lastIndexOf('_');
    return { speciesId: key.slice(0, cut), gender: key.slice(cut + 1) };
  }

  function variantLabel(key) {
    const { speciesId, gender } = splitVariantKey(key);
    return `${LABELS[speciesId] || speciesId} — ${gender[0].toUpperCase()}${gender.slice(1)}`;
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function round6(n) { return Math.round(n * 1e6) / 1e6; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function buildRegularPoints(size, sourceBounds) {
    const b = sourceBounds || [0, 0, 1, 1];
    const out = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const u = size === 1 ? 0.5 : col / (size - 1);
        const v = size === 1 ? 0.5 : row / (size - 1);
        out.push([round6(b[0] + b[2] * u), round6(b[1] + b[3] * v)]);
      }
    }
    return out;
  }

  function validRecord(record) {
    const size = Number(record?.grid?.cols);
    return ALLOWED_GRID_SIZES.includes(size) && record?.grid?.rows === size && Array.isArray(record?.points) && record.points.length === size * size;
  }

  function ensureFamilyRecord(familyId) {
    const def = FAMILY_DEFS[familyId];
    state.config.patches ||= {};
    state.config.patches[familyId] ||= { source: def.exportSource, sourceBounds: null, variants: {} };
    const family = state.config.patches[familyId];
    family.source = def.exportSource;
    family.variants ||= {};
    return family;
  }

  function ensureVariantRecord(familyId = state.familyId, variantKey = state.variantKey, preferredSize = Number(els.gridSize.value) || 3) {
    const def = FAMILY_DEFS[familyId];
    const family = ensureFamilyRecord(familyId);
    const targetName = def.targets[variantKey];
    const { speciesId, gender } = splitVariantKey(variantKey);
    let record = family.variants[variantKey];
    if (!validRecord(record)) {
      const size = ALLOWED_GRID_SIZES.includes(preferredSize) ? preferredSize : 3;
      record = {
        speciesId,
        gender,
        targetSprite: `${def.exportTargetDir}${targetName}`,
        grid: { cols: size, rows: size },
        points: buildRegularPoints(size, family.sourceBounds),
      };
      family.variants[variantKey] = record;
    } else {
      record.speciesId = speciesId;
      record.gender = gender;
      record.targetSprite = `${def.exportTargetDir}${targetName}`;
    }
    return record;
  }

  function currentRecord() { return ensureVariantRecord(); }

  async function loadImage(url) {
    if (state.imageCache.has(url)) return state.imageCache.get(url);
    const promise = (async () => {
      const response = await fetch(url, { cache: 'force-cache', mode: 'cors' });
      if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      objectUrlCache.set(url, objectUrl);
      try {
        const img = await new Promise((resolve, reject) => {
          const image = new Image();
          image.decoding = 'async';
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`Could not decode ${url}`));
          image.src = objectUrl;
        });
        state.imageCache.set(url, img);
        return img;
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        objectUrlCache.delete(url);
        throw error;
      }
    })();
    state.imageCache.set(url, promise);
    try { return await promise; }
    catch (error) { state.imageCache.delete(url); throw error; }
  }

  function alphaBoundsFor(img) {
    const key = img.currentSrc || img.src;
    if (state.boundsCache.has(key)) return state.boundsCache.get(key);
    const scratch = document.createElement('canvas');
    scratch.width = img.naturalWidth || img.width || 1;
    scratch.height = img.naturalHeight || img.height || 1;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    const fallback = [0, 0, 1, 1];
    try {
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.drawImage(img, 0, 0);
      const data = sctx.getImageData(0, 0, scratch.width, scratch.height).data;
      let minX = scratch.width, minY = scratch.height, maxX = -1, maxY = -1;
      for (let y = 0; y < scratch.height; y++) {
        for (let x = 0; x < scratch.width; x++) {
          if (data[(y * scratch.width + x) * 4 + 3] <= 8) continue;
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      const bounds = maxX < minX
        ? fallback
        : [minX / scratch.width, minY / scratch.height, (maxX - minX + 1) / scratch.width, (maxY - minY + 1) / scratch.height].map(round6);
      state.boundsCache.set(key, bounds);
      return bounds;
    } catch (error) {
      state.boundsCache.set(key, fallback);
      state.loadWarnings.push(`Alpha bounds fallback: ${error.message}`);
      return fallback;
    }
  }

  async function ensureFamilyBounds(familyId) {
    const family = ensureFamilyRecord(familyId);
    if (Array.isArray(family.sourceBounds) && family.sourceBounds.length === 4) return family.sourceBounds;
    const img = await loadImage(FAMILY_DEFS[familyId].source);
    family.sourceBounds = alphaBoundsFor(img);
    return family.sourceBounds;
  }

  async function refreshImages() {
    const token = ++state.loadingToken;
    const def = FAMILY_DEFS[state.familyId];
    const targetName = def.targets[state.variantKey];
    state.loadWarnings = [];
    const [patchResult, targetResult] = await Promise.allSettled([
      loadImage(def.source),
      loadImage(`${def.targetDir}${targetName}`),
    ]);
    if (token !== state.loadingToken) return;

    state.patchImage = patchResult.status === 'fulfilled' ? patchResult.value : null;
    state.targetImage = targetResult.status === 'fulfilled' ? targetResult.value : null;
    if (patchResult.status === 'rejected') state.loadWarnings.push(patchResult.reason?.message || String(patchResult.reason));
    if (targetResult.status === 'rejected') state.loadWarnings.push(targetResult.reason?.message || String(targetResult.reason));

    const family = ensureFamilyRecord(state.familyId);
    if (state.patchImage && !Array.isArray(family.sourceBounds)) family.sourceBounds = alphaBoundsFor(state.patchImage);
    const record = ensureVariantRecord(state.familyId, state.variantKey, Number(els.gridSize.value));
    if (!record.points?.length) record.points = buildRegularPoints(record.grid.cols, family.sourceBounds);
    els.gridSize.value = String(record.grid.cols);
    sizeCanvasForTarget();
    render();
  }

  function sizeCanvasForTarget() {
    const img = state.targetImage || state.patchImage;
    if (!img) return;
    els.stage.width = img.naturalWidth || 1440;
    els.stage.height = img.naturalHeight || 1080;
  }

  // Same affine-triangle strategy used by portrait-utils.js: clip to the destination
  // triangle, then transform the complete source image so that its source triangle
  // lands exactly on that destination triangle. targetCtx is explicit so the exact
  // same warp code powers both the live editor and the PNG-baking export.
  function drawTriangleTo(targetCtx, image, s0, s1, s2, d0, d1, d2, alpha = 1) {
    const [sx0, sy0] = s0, [sx1, sy1] = s1, [sx2, sy2] = s2;
    const [dx0, dy0] = d0, [dx1, dy1] = d1, [dx2, dy2] = d2;
    const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(det) < 1e-8) return;
    targetCtx.save();
    targetCtx.globalAlpha = alpha;
    targetCtx.beginPath(); targetCtx.moveTo(dx0, dy0); targetCtx.lineTo(dx1, dy1); targetCtx.lineTo(dx2, dy2); targetCtx.closePath(); targetCtx.clip();
    const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / det;
    const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / det;
    const c = (sx0 * (dx1 - dx2) + sx1 * (dx2 - dx0) + sx2 * (dx0 - dx1)) / det;
    const d = (sx0 * (dy1 - dy2) + sx1 * (dy2 - dy0) + sx2 * (dy0 - dy1)) / det;
    const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / det;
    const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / det;
    targetCtx.setTransform(a, b, c, d, e, f);
    targetCtx.drawImage(image, 0, 0);
    targetCtx.restore();
  }

  function sourceGridPoints(size, bounds, image) {
    const [x, y, w, h] = bounds || [0, 0, 1, 1];
    const out = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const u = col / (size - 1), v = row / (size - 1);
        out.push([(x + w * u) * image.naturalWidth, (y + h * v) * image.naturalHeight]);
      }
    }
    return out;
  }

  function destinationPointsFor(record, width, height) {
    return record.points.map(([x, y]) => [x * width, y * height]);
  }

  function destinationPoints(record) {
    return destinationPointsFor(record, els.stage.width, els.stage.height);
  }

  function drawWarpedPatchTo(targetCtx, patchImage, record, bounds, width, height, alpha = 1) {
    if (!patchImage || !record) return;
    const size = record.grid.cols;
    const src = sourceGridPoints(size, bounds || [0, 0, 1, 1], patchImage);
    const dst = destinationPointsFor(record, width, height);
    for (let row = 0; row < size - 1; row++) {
      for (let col = 0; col < size - 1; col++) {
        const i00 = row * size + col, i10 = i00 + 1, i01 = (row + 1) * size + col, i11 = i01 + 1;
        drawTriangleTo(targetCtx, patchImage, src[i00], src[i10], src[i01], dst[i00], dst[i10], dst[i01], alpha);
        drawTriangleTo(targetCtx, patchImage, src[i10], src[i11], src[i01], dst[i10], dst[i11], dst[i01], alpha);
      }
    }
  }

  function drawWarpedPatch(alpha = 1) {
    if (!state.patchImage) return;
    drawWarpedPatchTo(
      ctx,
      state.patchImage,
      currentRecord(),
      ensureFamilyRecord(state.familyId).sourceBounds || [0, 0, 1, 1],
      els.stage.width,
      els.stage.height,
      alpha,
    );
  }

  function drawMesh() {
    if (!els.showMesh.checked) return;
    const record = currentRecord();
    const size = record.grid.cols;
    const pts = destinationPoints(record);
    ctx.save();
    ctx.lineWidth = Math.max(2, els.stage.width / 700);
    ctx.strokeStyle = 'rgba(106,167,255,.95)';
    for (let row = 0; row < size; row++) {
      ctx.beginPath();
      for (let col = 0; col < size; col++) {
        const [x, y] = pts[row * size + col];
        if (col === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let col = 0; col < size; col++) {
      ctx.beginPath();
      for (let row = 0; row < size; row++) {
        const [x, y] = pts[row * size + col];
        if (row === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const r = Math.max(7, els.stage.width / 130);
    pts.forEach(([x, y], index) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = index === state.selectedPoint ? '#ffd479' : '#edf5ff';
      ctx.fill(); ctx.lineWidth = Math.max(2, els.stage.width / 900); ctx.strokeStyle = '#17334f'; ctx.stroke();
    });
    ctx.restore();
  }

  function drawTransformBox() {
    if (state.mode !== 'transform') return;
    const bounds = meshBounds(currentRecord().points);
    const handles = transformHandlePositions(bounds);
    const x = bounds.minX * els.stage.width, y = bounds.minY * els.stage.height;
    const width = (bounds.maxX - bounds.minX) * els.stage.width;
    const height = (bounds.maxY - bounds.minY) * els.stage.height;
    const rect = els.stage.getBoundingClientRect();
    const cssScale = Math.max(Math.min(rect.width / Math.max(els.stage.width, 1), rect.height / Math.max(els.stage.height, 1)), 0.0001);
    const r = 9 / cssScale;

    ctx.save();
    ctx.lineWidth = Math.max(2, els.stage.width / 700);
    ctx.strokeStyle = 'rgba(255,212,121,.95)';
    ctx.setLineDash([8 / cssScale, 5 / cssScale]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    for (const [name, [hx, hy]] of Object.entries(handles)) {
      const px = hx * els.stage.width, py = hy * els.stage.height;
      ctx.beginPath();
      if (name === 'move') {
        ctx.arc(px, py, r * 1.15, 0, Math.PI * 2);
      } else {
        ctx.rect(px - r, py - r, r * 2, r * 2);
      }
      ctx.fillStyle = name === state.pointer?.transformHandle ? '#ffd479' : '#edf5ff';
      ctx.fill();
      ctx.lineWidth = Math.max(2, els.stage.width / 900);
      ctx.strokeStyle = '#17334f';
      ctx.stroke();
    }
    ctx.restore();
  }

  const REFERENCE_CLOTHING_LAYER_KEYS = new Set([
    'torsoClothing', 'overwear', 'hatUnder', 'hood', 'pauldron', 'hatOver', 'snowgoggles',
  ]);

  function normalizeNpcGender(value) {
    return ['female', 'f'].includes(String(value || '').toLowerCase()) ? 'female' : 'male';
  }

  function normalizeNpcSpecies(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/_/g, '-')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mao-ao';
  }

  function asEquipArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === 'object') return Object.values(value).filter(item => typeof item === 'string' && item);
    return [];
  }

  // Mirrors the repo NPC -> portrait adapter used by world-popup-editor so this
  // reference is the same authored appearance/equipment/dyes used by runtime NPCs.
  function portraitExportForNpc(npc) {
    const raw = npc?.avatarEditor?.rawExport || {};
    const profile = raw.profile || raw.avatarProfile || raw.npcProfile || raw;
    const source = raw.appearance || profile.appearance || profile.visuals?.appearance || npc?.appearance || {};
    const appearance = {
      ...source,
      ...(profile.appearance || {}),
      ...(profile.visuals?.appearance || {}),
      ...(npc.appearance || {}),
    };
    appearance.speciesId = normalizeNpcSpecies(appearance.speciesId || appearance.species || npc?.species);
    appearance.gender = normalizeNpcGender(appearance.gender || npc?.gender);
    appearance.cosmetics = {
      ...(source.cosmetics || {}),
      ...(profile.appearance?.cosmetics || {}),
      ...(profile.visuals?.appearance?.cosmetics || {}),
      ...(npc.appearance?.cosmetics || {}),
    };
    appearance.bodyColors = {
      ...(source.bodyColors || {}),
      ...(profile.appearance?.bodyColors || {}),
      ...(profile.visuals?.appearance?.bodyColors || {}),
      ...(npc.appearance?.bodyColors || {}),
    };
    return {
      name: npc?.name || npc?.id || 'NPC',
      appearance,
      equippedCosmetics: asEquipArray(raw.equippedCosmetics || profile.equippedCosmetics || profile.equipment || npc?.equippedCosmetics),
      appliedDyes: raw.appliedDyes || profile.appliedDyes || npc?.appliedDyes || {},
      portrait: npc?.portrait || {},
      rawExport: raw,
    };
  }

  function targetBehindLayerKey() {
    return state.familyId === 'tunic' ? 'torsoClothing' : 'overwear';
  }

  function runtimeBehindLayerOrder() {
    const exported = window.renderPortraitProfile?.defaultBehindLayerOrder || window.renderProfile?.defaultBehindLayerOrder;
    return Array.isArray(exported) && exported.length
      ? [...exported]
      : ['sideLeft', 'rightSideHair', 'baseLeftArm', 'baseTorso', 'baseRightArm', 'head', 'frontHair', 'torsoClothing', 'overwear', 'hatUnder', 'hood', 'pauldron', 'hatOver', 'snowgoggles', 'hairBack'];
  }

  function referenceLayerSlices() {
    const order = runtimeBehindLayerOrder();
    const target = targetBehindLayerKey();
    const index = order.indexOf(target);
    if (index < 0) return { target, below: order, aboveClothing: [], aboveNonClothing: [] };
    const above = order.slice(index + 1);
    return {
      target,
      below: order.slice(0, index),
      aboveClothing: above.filter(key => REFERENCE_CLOTHING_LAYER_KEYS.has(key)),
      aboveNonClothing: above.filter(key => !REFERENCE_CLOTHING_LAYER_KEYS.has(key)),
    };
  }

  function npcMatchesCurrentVariant(npc) {
    const exported = portraitExportForNpc(npc);
    const { speciesId, gender } = splitVariantKey(state.variantKey);
    return normalizeNpcSpecies(exported.appearance.speciesId) === normalizeNpcSpecies(speciesId)
      && normalizeNpcGender(exported.appearance.gender) === normalizeNpcGender(gender);
  }

  function populateNpcReferenceOptions() {
    const previous = els.npcReferenceSelect.value || state.npcReferenceId;
    const matching = state.repoNpcs.filter(npcMatchesCurrentVariant);
    els.npcReferenceSelect.innerHTML = matching.length
      ? matching.map(npc => `<option value="${String(npc.id || '').replace(/"/g, '&quot;')}">${npc.name || npc.id} · ${normalizeNpcSpecies(npc.appearance?.speciesId || npc.species)} ${normalizeNpcGender(npc.appearance?.gender || npc.gender)}</option>`).join('')
      : '<option value="">No matching repo NPCs</option>';
    const keep = matching.some(npc => String(npc.id || '') === previous);
    els.npcReferenceSelect.value = keep ? previous : String(matching[0]?.id || '');
    els.loadNpcReferenceBtn.disabled = !matching.length;
  }

  async function loadRepoNpcDatabase() {
    if (!window.NpcAvatarPreview) throw new Error('NpcAvatarPreview runtime is unavailable.');
    const response = await fetch(NPC_DB_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`NPC database load failed (HTTP ${response.status})`);
    const raw = await response.json();
    state.repoNpcs = (Array.isArray(raw) ? raw : raw?.npcs || raw?.npcDatabase || []).filter(npc => npc && npc.id);
    await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: '../../assets/', configBase: '../../config/' });
    populateNpcReferenceOptions();
  }

  function clearNpcReference(renderAfter = true) {
    state.npcReferenceGeneration++;
    state.npcReferenceId = '';
    state.npcReferenceBelow = null;
    state.npcReferenceAboveClothing = null;
    state.npcReferenceAboveNonClothing = null;
    state.npcReferenceName = '';
    els.clearNpcReferenceBtn.disabled = true;
    els.npcReferenceNote.textContent = 'No repo NPC rear portrait loaded.';
    if (renderAfter) render();
  }

  function makeRuntimePortraitCanvas() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.canvas || {};
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Number(cfg.width) || 200);
    canvas.height = Math.max(1, Number(cfg.height) || 200);
    return canvas;
  }

  async function renderNpcReferenceSlice(profile, npc, behindLayerOrder) {
    const canvas = makeRuntimePortraitCanvas();
    const ok = await window.NpcAvatarPreview.renderProfileToCanvas(canvas, profile, {
      seatId: npc.id || npc.name || 'neck-patch-reference',
      portraitView: 'behind',
      forceEyesOpen: true,
      behindLayerOrder,
    });
    if (!ok) throw new Error('Runtime NPC behind renderer did not render.');
    return canvas;
  }

  async function loadNpcReference(npcId = els.npcReferenceSelect.value) {
    const npc = state.repoNpcs.find(entry => String(entry.id || '') === String(npcId || ''));
    if (!npc) throw new Error('Choose a matching repo NPC first.');
    if (!npcMatchesCurrentVariant(npc)) throw new Error('That NPC does not match the selected species + gender.');

    const generation = ++state.npcReferenceGeneration;
    const exported = portraitExportForNpc(npc);
    const profile = window.NpcAvatarPreview.buildProfileFromNpcExport(exported);
    if (!profile) throw new Error(`Could not build ${npc.name || npc.id}'s runtime portrait profile.`);
    const slices = referenceLayerSlices();
    const [below, aboveClothing, aboveNonClothing] = await Promise.all([
      renderNpcReferenceSlice(profile, npc, slices.below),
      renderNpcReferenceSlice(profile, npc, slices.aboveClothing),
      renderNpcReferenceSlice(profile, npc, slices.aboveNonClothing),
    ]);
    if (generation !== state.npcReferenceGeneration) return;

    state.npcReferenceId = String(npc.id || '');
    state.npcReferenceBelow = below;
    state.npcReferenceAboveClothing = aboveClothing;
    state.npcReferenceAboveNonClothing = aboveNonClothing;
    state.npcReferenceName = npc.name || npc.id || 'NPC';
    els.clearNpcReferenceBtn.disabled = false;
    els.npcReferenceNote.textContent = `${state.npcReferenceName} · runtime behind portrait · target bucket: ${slices.target}`;
    render();
  }

  // renderProfile('behind') creates the canvas consumed by PNGPlaneAvatar; the
  // runtime then horizontally flips that canvas for the actual back plane.
  // This inverse B-preset transform maps that final runtime view back into the
  // raw garment sprite's source coordinates, which is the coordinate space this
  // deformation editor and its exported PNGs author.
  function drawNpcReferenceCanvas(canvas, alpha = 1) {
    if (!canvas || alpha <= 0 || !els.stage.width || !els.stage.height) return;
    const portrait = window.SCRATCHBONES_CONFIG?.game?.portrait || {};
    const canvasCfg = portrait.canvas || {};
    const preset = portrait.xformPresets?.B || {};
    const cw = Math.max(1, Number(canvasCfg.width) || canvas.width || 200);
    const ch = Math.max(1, Number(canvasCfg.height) || canvas.height || 200);
    const layerSize = Math.max(1, Number(canvasCfg.layerSize) || 80);
    const ax = Number(preset.ax ?? -0.0983);
    const ay = Number(preset.ay ?? -0.0809);
    const sx = Math.abs(Number(preset.scaleX ?? preset.sx ?? 2.49)) || 2.49;
    const sy = Math.abs(Number(preset.scaleY ?? preset.sy ?? 2.49)) || 2.49;
    const rawW = els.stage.width, rawH = els.stage.height;
    const drawnH = layerSize * sy;
    const drawnW = (rawW / rawH) * layerSize * sx;
    const unflippedCx = cw / 2 + ay * layerSize;
    const cy = ch / 2 - ax * layerSize;
    const runtimeCx = cw - unflippedCx;
    const runtimeLeft = runtimeCx - drawnW / 2;
    const top = cy - drawnH / 2;
    const scaleX = rawW / drawnW;
    const scaleY = rawH / drawnH;

    ctx.save();
    ctx.globalAlpha = alpha;
    // Negative X performs PNGPlaneAvatar's runtime flip while the translation
    // and scale invert portrait preset B back into the source sprite frame.
    ctx.setTransform(-scaleX, 0, 0, scaleY, (cw - runtimeLeft) * scaleX, -top * scaleY);
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  }

  function drawTargetGarment(alpha = 1) {
    if (!state.targetImage) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(state.targetImage, 0, 0, els.stage.width, els.stage.height);
    ctx.restore();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, els.stage.width, els.stage.height);
    const npcReferenceAlpha = Number(els.npcReferenceOpacity.value);
    const patchAlpha = Number(els.patchOpacity.value);
    const garmentAlpha = Number(els.garmentOpacity.value);

    // Runtime NPC layers below the garment bucket are the fitting underlay.
    // The selected garment bucket itself is omitted from the NPC render because
    // this tool draws the exact raw target sprite + patch in that position.
    drawNpcReferenceCanvas(state.npcReferenceBelow, npcReferenceAlpha);

    // Authoring view deliberately puts the deformed patch ON TOP of the exact
    // species+gender garment sprite so the neck-hole edge stays visible while
    // a control point is being fitted. Turning it off previews the final baked
    // PNG order: patch first, garment second.
    if (els.xrayPatch.checked) {
      drawTargetGarment(garmentAlpha);
      drawWarpedPatch(patchAlpha);
    } else {
      drawWarpedPatch(patchAlpha);
      drawTargetGarment(garmentAlpha);
    }

    // These canvases are generated from the same runtime behind-layer order.
    // Clothing/accessories above the target can be toggled off for fitting;
    // non-clothing layers such as rear hair remain in their real top position.
    if (els.showAboveTargetClothing.checked) {
      drawNpcReferenceCanvas(state.npcReferenceAboveClothing, npcReferenceAlpha);
    }
    drawNpcReferenceCanvas(state.npcReferenceAboveNonClothing, npcReferenceAlpha);

    drawMesh();
    drawTransformBox();
    updatePointUi();
    updateDebug();
  }

  function signedArea(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  function triangleWarnings() {
    const record = currentRecord();
    const size = record.grid.cols;
    const pts = record.points;
    let inverted = 0, degenerate = 0;
    const tri = (a, b, c) => {
      const area = signedArea(pts[a], pts[b], pts[c]);
      if (Math.abs(area) < 1e-7) degenerate++;
      else if (area < 0) inverted++;
    };
    for (let row = 0; row < size - 1; row++) for (let col = 0; col < size - 1; col++) {
      const i00 = row * size + col, i10 = i00 + 1, i01 = (row + 1) * size + col, i11 = i01 + 1;
      tri(i00, i10, i01); tri(i10, i11, i01);
    }
    return { inverted, degenerate };
  }

  function updateDebug() {
    const def = FAMILY_DEFS[state.familyId];
    const family = ensureFamilyRecord(state.familyId);
    const record = currentRecord();
    const warnings = triangleWarnings();
    const target = def.targets[state.variantKey];
    const patchDims = state.patchImage ? `${state.patchImage.naturalWidth}×${state.patchImage.naturalHeight}` : 'not loaded';
    const targetDims = state.targetImage ? `${state.targetImage.naturalWidth}×${state.targetImage.naturalHeight}` : 'not loaded';
    const slices = referenceLayerSlices();
    els.debug.textContent = [
      `family: ${state.familyId} · variant: ${state.variantKey} · grid: ${record.grid.cols}×${record.grid.rows}`,
      `patch: ${def.source} (${patchDims})`,
      `patch alpha bounds: ${JSON.stringify(family.sourceBounds)}`,
      `target: ${def.targetDir}${target} (${targetDims})`,
      `repo NPC rear reference: ${state.npcReferenceName || 'none'} · target bucket: ${slices.target} · upper clothing: ${els.showAboveTargetClothing.checked ? 'equipped' : 'dequipped'}`,
      `selected point: ${state.selectedPoint == null ? 'none' : `${state.selectedPoint} ${JSON.stringify(record.points[state.selectedPoint])}`}`,
      `authoring mode: ${state.mode}${state.pointer?.transformHandle ? ` · handle: ${state.pointer.transformHandle}` : ''}`,
      `mesh diagnostics: ${warnings.inverted} inverted · ${warnings.degenerate} degenerate triangle(s)`,
      state.loadWarnings.length ? `warnings: ${state.loadWarnings.join(' | ')}` : 'warnings: none',
      `preview order: ${els.xrayPatch.checked ? 'garment under patch (matches final export)' : 'patch behind garment (comparison only)'}`,
      `draft: ${state.dirty ? 'modified + autosaved' : 'clean'}`,
    ].join('\n');
  }

  function updatePointUi() {
    const selected = state.selectedPoint;
    const record = currentRecord();
    const enabled = Number.isInteger(selected) && record.points[selected];
    els.pointX.disabled = !enabled; els.pointY.disabled = !enabled;
    if (!enabled) {
      els.selectedBadge.textContent = 'None'; els.pointX.value = ''; els.pointY.value = ''; return;
    }
    const [x, y] = record.points[selected];
    const row = Math.floor(selected / record.grid.cols), col = selected % record.grid.cols;
    els.selectedBadge.textContent = `Point ${selected} · row ${row + 1}, col ${col + 1}`;
    if (document.activeElement !== els.pointX) els.pointX.value = round6(x);
    if (document.activeElement !== els.pointY) els.pointY.value = round6(y);
  }

  function canvasPoint(event) {
    const rect = els.stage.getBoundingClientRect();
    return {
      px: (event.clientX - rect.left) * els.stage.width / rect.width,
      py: (event.clientY - rect.top) * els.stage.height / rect.height,
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  function nearestPoint(px, py) {
    const pts = destinationPoints(currentRecord());
    const cssScale = els.stage.getBoundingClientRect().width / els.stage.width;
    const hit = 24 / Math.max(cssScale, 0.0001);
    let best = null, bestD = hit * hit;
    pts.forEach(([x, y], index) => {
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d <= bestD) { bestD = d; best = index; }
    });
    return best;
  }

  function meshBounds(points) {
    if (!points?.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1, centerX: 0.5, centerY: 0.5 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  }

  function transformHandlePositions(bounds) {
    const { minX, minY, maxX, maxY, centerX, centerY } = bounds;
    return {
      nw: [minX, minY], n: [centerX, minY], ne: [maxX, minY],
      w: [minX, centerY], move: [centerX, centerY], e: [maxX, centerY],
      sw: [minX, maxY], s: [centerX, maxY], se: [maxX, maxY],
    };
  }

  function transformAnchor(handle, bounds) {
    const { minX, minY, maxX, maxY, centerX, centerY } = bounds;
    const anchors = {
      nw: [maxX, maxY], n: [centerX, maxY], ne: [minX, maxY],
      w: [maxX, centerY], e: [minX, centerY],
      sw: [maxX, minY], s: [centerX, minY], se: [minX, minY],
    };
    return anchors[handle] || [centerX, centerY];
  }

  function maximumAxisScale(points, anchor, axis) {
    const ai = axis === 'x' ? 0 : 1;
    const origin = anchor[ai];
    let maxScale = Infinity;
    for (const point of points) {
      const delta = point[ai] - origin;
      if (delta > 0) maxScale = Math.min(maxScale, (POINT_LIMIT.max - origin) / delta);
      else if (delta < 0) maxScale = Math.min(maxScale, (POINT_LIMIT.min - origin) / delta);
    }
    return Number.isFinite(maxScale) ? Math.max(0.05, maxScale) : 10;
  }

  function scalePointsFromAnchor(points, anchor, factorX, factorY) {
    const safeX = clamp(factorX, 0.05, maximumAxisScale(points, anchor, 'x'));
    const safeY = clamp(factorY, 0.05, maximumAxisScale(points, anchor, 'y'));
    return points.map(([x, y]) => [
      round6(anchor[0] + (x - anchor[0]) * safeX),
      round6(anchor[1] + (y - anchor[1]) * safeY),
    ]);
  }

  function movePointsWithinLimits(points, dx, dy) {
    const bounds = meshBounds(points);
    const safeDx = clamp(dx, POINT_LIMIT.min - bounds.minX, POINT_LIMIT.max - bounds.maxX);
    const safeDy = clamp(dy, POINT_LIMIT.min - bounds.minY, POINT_LIMIT.max - bounds.maxY);
    return points.map(([x, y]) => [round6(x + safeDx), round6(y + safeDy)]);
  }

  function transformHitTest(px, py, points) {
    const bounds = meshBounds(points);
    const handles = transformHandlePositions(bounds);
    const rect = els.stage.getBoundingClientRect();
    const scaleX = rect.width / Math.max(els.stage.width, 1);
    const scaleY = rect.height / Math.max(els.stage.height, 1);
    const hitPx = 22 / Math.max(Math.min(scaleX, scaleY), 0.0001);
    let best = null, bestDistance = Infinity;
    for (const [name, [x, y]] of Object.entries(handles)) {
      if (name === 'move') continue;
      const hx = x * els.stage.width, hy = y * els.stage.height;
      const distance = Math.hypot(px - hx, py - hy);
      if (distance <= hitPx && distance < bestDistance) { best = name; bestDistance = distance; }
    }
    if (best) return best;
    const x = px / els.stage.width, y = py / els.stage.height;
    if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) return 'move';
    const [cx, cy] = handles.move;
    if (Math.hypot(px - cx * els.stage.width, py - cy * els.stage.height) <= hitPx * 1.25) return 'move';
    return null;
  }

  function pushHistory() {
    state.undo.push(clone({ familyId: state.familyId, variantKey: state.variantKey, record: currentRecord() }));
    if (state.undo.length > 80) state.undo.shift();
    state.redo.length = 0;
    updateHistoryButtons();
  }

  function applyHistorySnapshot(snapshot, destinationStack) {
    if (!snapshot) return;
    destinationStack.push(clone({ familyId: state.familyId, variantKey: state.variantKey, record: currentRecord() }));
    state.familyId = snapshot.familyId; state.variantKey = snapshot.variantKey;
    ensureFamilyRecord(snapshot.familyId).variants[snapshot.variantKey] = clone(snapshot.record);
    populateFamilyAndVariants();
    els.family.value = state.familyId; els.variant.value = state.variantKey; els.gridSize.value = String(snapshot.record.grid.cols);
    state.selectedPoint = null; markDirty(); refreshImages(); updateHistoryButtons();
    refreshActiveNpcReferenceForTarget().catch(error => {
      clearNpcReference();
      els.saveStatus.textContent = `NPC rear reference failed: ${error.message}`;
    });
  }

  function updateHistoryButtons() { els.undo.disabled = !state.undo.length; els.redo.disabled = !state.redo.length; }

  function resamplePoints(record, newSize) {
    const oldSize = record.grid.cols;
    if (oldSize === newSize) return clone(record.points);
    const old = record.points;
    const sample = (u, v) => {
      const gx = u * (oldSize - 1), gy = v * (oldSize - 1);
      const x0 = Math.min(oldSize - 2, Math.floor(gx)), y0 = Math.min(oldSize - 2, Math.floor(gy));
      const tx = gx - x0, ty = gy - y0;
      const p00 = old[y0 * oldSize + x0], p10 = old[y0 * oldSize + x0 + 1];
      const p01 = old[(y0 + 1) * oldSize + x0], p11 = old[(y0 + 1) * oldSize + x0 + 1];
      const lerp = (a, b, t) => a + (b - a) * t;
      return [
        lerp(lerp(p00[0], p10[0], tx), lerp(p01[0], p11[0], tx), ty),
        lerp(lerp(p00[1], p10[1], tx), lerp(p01[1], p11[1], tx), ty),
      ].map(round6);
    };
    const out = [];
    for (let row = 0; row < newSize; row++) for (let col = 0; col < newSize; col++) out.push(sample(col / (newSize - 1), row / (newSize - 1)));
    return out;
  }

  function markDirty(message = 'Draft saved') {
    state.dirty = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
    els.saveStatus.textContent = message;
    clearTimeout(markDirty.timer);
    markDirty.timer = setTimeout(() => { els.saveStatus.textContent = ''; }, 1800);
  }

  function populateFamilyAndVariants() {
    const previousFamily = state.familyId;
    els.family.innerHTML = Object.entries(FAMILY_DEFS).map(([id, def]) => `<option value="${id}">${def.label}</option>`).join('');
    if (!FAMILY_DEFS[previousFamily]) state.familyId = Object.keys(FAMILY_DEFS)[0];
    els.family.value = state.familyId;
    const def = FAMILY_DEFS[state.familyId];
    const keys = Object.keys(def.targets);
    if (!keys.includes(state.variantKey)) state.variantKey = keys[0];
    els.variant.innerHTML = keys.map(key => `<option value="${key}">${variantLabel(key)}</option>`).join('');
    els.copyFrom.innerHTML = keys.filter(key => key !== state.variantKey).map(key => `<option value="${key}">${variantLabel(key)}</option>`).join('');
    els.variant.value = state.variantKey;
    const target = def.targets[state.variantKey];
    els.assetNote.textContent = `Patch: ${def.source.split('/').pop()} · Target: ${target}`;
  }

  function setMode(mode) {
    state.mode = mode;
    els.pointMode.classList.toggle('active', mode === 'point');
    els.transformMode.classList.toggle('active', mode === 'transform');
    state.selectedPoint = null;
    render();
  }

  function normalizeImportedConfig(candidate) {
    if (!candidate || candidate.schema !== SCHEMA || typeof candidate.patches !== 'object') throw new Error(`Expected ${SCHEMA}`);
    const out = makeEmptyConfig();
    for (const familyId of Object.keys(FAMILY_DEFS)) {
      const incoming = candidate.patches?.[familyId];
      if (!incoming) continue;
      const family = out.patches[familyId];
      if (Array.isArray(incoming.sourceBounds) && incoming.sourceBounds.length === 4) family.sourceBounds = incoming.sourceBounds.map(Number);
      for (const [variantKey, record] of Object.entries(incoming.variants || {})) {
        if (!FAMILY_DEFS[familyId].targets[variantKey] || !validRecord(record)) continue;
        family.variants[variantKey] = clone(record);
      }
    }
    return out;
  }

  async function completeConfigForExport() {
    for (const familyId of Object.keys(FAMILY_DEFS)) {
      await ensureFamilyBounds(familyId);
      for (const variantKey of Object.keys(FAMILY_DEFS[familyId].targets)) ensureVariantRecord(familyId, variantKey, 3);
    }
    const out = clone(state.config);
    out.schema = SCHEMA;
    out.generatedAt = new Date().toISOString();
    for (const family of Object.values(out.patches)) {
      family.sourceBounds = family.sourceBounds?.map(round6) || null;
      for (const record of Object.values(family.variants || {})) record.points = record.points.map(([x, y]) => [round6(x), round6(y)]);
    }
    return out;
  }

  async function exportJsonText() { return `${JSON.stringify(await completeConfigForExport(), null, 2)}\n`; }

  async function copyJson() {
    try { await navigator.clipboard.writeText(await exportJsonText()); els.saveStatus.textContent = 'JSON copied'; }
    catch { els.saveStatus.textContent = 'Clipboard unavailable'; }
  }

  async function downloadJson() {
    const text = await exportJsonText();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'neck-patch-deformations.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    els.saveStatus.textContent = 'Source JSON downloaded';
  }

  function exportVariantSuffix(variantKey) {
    const { speciesId, gender } = splitVariantKey(variantKey);
    const speciesCode = SPECIES_FILE_CODES[speciesId] || speciesId.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    return `${speciesCode}_${gender === 'female' ? 'f' : 'm'}`;
  }

  function bakedSpriteFilename(familyId, variantKey) {
    const def = FAMILY_DEFS[familyId];
    return `${def.exportStem}_${exportVariantSuffix(variantKey)}.png`;
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode PNG')), 'image/png');
    });
  }

  async function renderCombinedSpriteCanvas(familyId, variantKey, exportedConfig) {
    const def = FAMILY_DEFS[familyId];
    const family = exportedConfig.patches[familyId];
    const record = family?.variants?.[variantKey];
    const targetName = def.targets[variantKey];
    if (!record || !targetName) throw new Error(`Missing export record for ${familyId}/${variantKey}`);

    const [patchImage, targetImage] = await Promise.all([
      loadImage(def.source),
      loadImage(`${def.targetDir}${targetName}`),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = targetImage.naturalWidth || targetImage.width;
    canvas.height = targetImage.naturalHeight || targetImage.height;
    const exportCtx = canvas.getContext('2d');

    // Final baked order: untouched garment first, then the deformed patch on
    // top. The patch is the visible neck-hole cover, while the combined PNG
    // remains raw untinted source art for the existing dye + weaving pipeline.
    exportCtx.setTransform(1, 0, 0, 1, 0, 0);
    exportCtx.globalAlpha = 1;
    exportCtx.drawImage(targetImage, 0, 0, canvas.width, canvas.height);
    drawWarpedPatchTo(
      exportCtx,
      patchImage,
      record,
      family.sourceBounds || [0, 0, 1, 1],
      canvas.width,
      canvas.height,
      1,
    );
    return canvas;
  }

  async function downloadCombinedSpritesZip() {
    if (!window.JSZip) {
      els.saveStatus.textContent = 'ZIP library unavailable';
      return;
    }
    els.downloadSpritesBtn.disabled = true;
    try {
      const exportedConfig = await completeConfigForExport();
      const zip = new window.JSZip();
      const manifest = {
        schema: 'hobunji_neck_patch_baked_sprites.v1',
        generatedAt: new Date().toISOString(),
        note: 'Each PNG is original garment + deformed patch on top, before runtime dye/pattern processing.',
        entries: [],
      };
      const jobs = [];
      for (const [familyId, def] of Object.entries(FAMILY_DEFS)) {
        for (const variantKey of Object.keys(def.targets)) jobs.push({ familyId, variantKey, def });
      }

      for (let index = 0; index < jobs.length; index++) {
        const { familyId, variantKey, def } = jobs[index];
        els.saveStatus.textContent = `Baking sprite ${index + 1}/${jobs.length}…`;
        const canvas = await renderCombinedSpriteCanvas(familyId, variantKey, exportedConfig);
        const blob = await canvasToPngBlob(canvas);
        const filename = bakedSpriteFilename(familyId, variantKey);
        const repoPath = `${def.zipDir}/${filename}`;
        const runtimeUrl = repoPath.replace(/^docs\/assets\//, '');
        const frontRuntimeUrl = `${def.exportTargetDir}${def.targets[variantKey]}`.replace(/^\.\/assets\//, '');
        const { speciesId, gender } = splitVariantKey(variantKey);

        zip.file(repoPath, blob);
        manifest.entries.push({
          familyId,
          cosmeticIds: def.cosmeticIds,
          speciesId,
          gender,
          frontSprite: frontRuntimeUrl,
          behindSprite: runtimeUrl,
          repoPath,
        });
      }

      zip.file('docs/config/cosmetics/neck-patch-deformations.json', `${JSON.stringify(exportedConfig, null, 2)}\n`);
      zip.file('docs/config/cosmetics/neck-patch-behind-sprites.json', `${JSON.stringify(manifest, null, 2)}\n`);

      els.saveStatus.textContent = 'Compressing sprite folder…';
      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        meta => { els.saveStatus.textContent = `Compressing… ${Math.round(meta.percent)}%`; },
      );
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'neck-patch-behind-sprites.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      els.saveStatus.textContent = `Downloaded ${jobs.length} combined sprites`;
    } catch (error) {
      console.error('[neck-patch-deformer] combined sprite export failed', error);
      els.saveStatus.textContent = `Sprite export failed: ${error.message}`;
    } finally {
      els.downloadSpritesBtn.disabled = false;
    }
  }

  async function loadInitialConfig() {
    let repoConfig = makeEmptyConfig();
    try {
      const response = await fetch(CONFIG_URL, { cache: 'no-store' });
      if (response.ok) repoConfig = normalizeImportedConfig(await response.json());
    } catch (error) { state.loadWarnings.push(`Config load: ${error.message}`); }
    state.config = repoConfig;
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) {
      try { state.config = normalizeImportedConfig(JSON.parse(local)); state.dirty = true; els.saveStatus.textContent = 'Local draft restored'; }
      catch { localStorage.removeItem(STORAGE_KEY); }
    }
  }

  async function refreshActiveNpcReferenceForTarget() {
    const hadReference = !!state.npcReferenceId;
    populateNpcReferenceOptions();
    if (!hadReference) return;
    const nextId = els.npcReferenceSelect.value;
    if (!nextId) {
      clearNpcReference();
      return;
    }
    await loadNpcReference(nextId);
  }

  els.family.addEventListener('change', async () => {
    state.familyId = els.family.value;
    state.variantKey = Object.keys(FAMILY_DEFS[state.familyId].targets)[0];
    state.selectedPoint = null; state.undo.length = 0; state.redo.length = 0;
    populateFamilyAndVariants();
    const record = ensureVariantRecord(); els.gridSize.value = String(record.grid.cols);
    updateHistoryButtons();
    await refreshImages();
    await refreshActiveNpcReferenceForTarget().catch(error => {
      clearNpcReference();
      els.saveStatus.textContent = `NPC rear reference failed: ${error.message}`;
    });
  });
  els.variant.addEventListener('change', async () => {
    state.variantKey = els.variant.value; state.selectedPoint = null;
    populateFamilyAndVariants();
    const record = ensureVariantRecord(); els.gridSize.value = String(record.grid.cols);
    await refreshImages();
    await refreshActiveNpcReferenceForTarget().catch(error => {
      clearNpcReference();
      els.saveStatus.textContent = `NPC rear reference failed: ${error.message}`;
    });
  });
  els.gridSize.addEventListener('change', () => {
    const newSize = Number(els.gridSize.value); if (!ALLOWED_GRID_SIZES.includes(newSize)) return;
    const record = currentRecord(); if (record.grid.cols === newSize) return;
    pushHistory(); record.points = resamplePoints(record, newSize); record.grid = { cols: newSize, rows: newSize };
    state.selectedPoint = null; markDirty(); render();
  });
  els.pointMode.addEventListener('click', () => setMode('point'));
  els.transformMode.addEventListener('click', () => setMode('transform'));
  els.undo.addEventListener('click', () => applyHistorySnapshot(state.undo.pop(), state.redo));
  els.redo.addEventListener('click', () => applyHistorySnapshot(state.redo.pop(), state.undo));
  els.reset.addEventListener('click', async () => {
    pushHistory();
    const record = currentRecord();
    const bounds = await ensureFamilyBounds(state.familyId);
    record.points = buildRegularPoints(record.grid.cols, bounds);
    state.selectedPoint = null; markDirty('Variant reset'); render();
  });
  els.copyVariant.addEventListener('click', () => {
    const fromKey = els.copyFrom.value; if (!fromKey) return;
    const source = ensureVariantRecord(state.familyId, fromKey, currentRecord().grid.cols);
    pushHistory();
    const current = currentRecord(); current.grid = clone(source.grid); current.points = clone(source.points);
    els.gridSize.value = String(current.grid.cols); state.selectedPoint = null; markDirty('Deformation copied'); render();
  });

  for (const id of ['npcReferenceOpacity', 'garmentOpacity', 'patchOpacity', 'xrayPatch', 'showMesh', 'showAboveTargetClothing']) {
    els[id].addEventListener('input', render);
  }
  els.copyBtn.addEventListener('click', copyJson);
  els.downloadBtn.addEventListener('click', downloadJson);
  els.downloadSpritesBtn.addEventListener('click', downloadCombinedSpritesZip);
  els.loadNpcReferenceBtn.addEventListener('click', async () => {
    try {
      await loadNpcReference();
      els.saveStatus.textContent = 'Repo NPC rear portrait loaded';
    } catch (error) {
      els.saveStatus.textContent = `NPC rear reference failed: ${error.message}`;
    }
  });
  els.npcReferenceSelect.addEventListener('change', async () => {
    if (!state.npcReferenceId) return;
    try { await loadNpcReference(); }
    catch (error) { els.saveStatus.textContent = `NPC rear reference failed: ${error.message}`; }
  });
  els.clearNpcReferenceBtn.addEventListener('click', () => {
    clearNpcReference();
    els.saveStatus.textContent = 'NPC rear reference cleared';
  });
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files?.[0]; if (!file) return;
    try {
      state.config = normalizeImportedConfig(JSON.parse(await file.text()));
      state.selectedPoint = null; state.undo.length = 0; state.redo.length = 0;
      markDirty('Imported + saved locally'); populateFamilyAndVariants(); refreshImages();
    } catch (error) { els.saveStatus.textContent = `Import failed: ${error.message}`; }
    els.importFile.value = '';
  });
  els.clearDraft.addEventListener('click', async () => {
    localStorage.removeItem(STORAGE_KEY); state.config = makeEmptyConfig(); state.dirty = false; state.selectedPoint = null;
    await loadInitialConfig(); populateFamilyAndVariants(); refreshImages(); els.saveStatus.textContent = 'Local draft cleared';
  });

  function commitPointInputs() {
    if (state.selectedPoint == null) return;
    const record = currentRecord();
    const nextX = clamp(Number(els.pointX.value), POINT_LIMIT.min, POINT_LIMIT.max);
    const nextY = clamp(Number(els.pointY.value), POINT_LIMIT.min, POINT_LIMIT.max);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
    pushHistory(); record.points[state.selectedPoint] = [round6(nextX), round6(nextY)]; markDirty(); render();
  }
  els.pointX.addEventListener('change', commitPointInputs); els.pointY.addEventListener('change', commitPointInputs);
  document.querySelectorAll('[data-nudge]').forEach(button => button.addEventListener('click', () => {
    if (state.selectedPoint == null) return;
    const [dx, dy] = button.dataset.nudge.split(',').map(Number); const record = currentRecord();
    pushHistory();
    const [x, y] = record.points[state.selectedPoint]; const step = 0.005;
    record.points[state.selectedPoint] = [round6(clamp(x + dx * step, POINT_LIMIT.min, POINT_LIMIT.max)), round6(clamp(y + dy * step, POINT_LIMIT.min, POINT_LIMIT.max))];
    markDirty(); render();
  }));

  els.stage.addEventListener('pointerdown', event => {
    if (!state.patchImage) return;
    const pos = canvasPoint(event);
    const startPoints = clone(currentRecord().points);
    let transformHandle = null;

    if (state.mode === 'point') {
      const index = nearestPoint(pos.px, pos.py);
      if (index == null) { state.selectedPoint = null; render(); return; }
      state.selectedPoint = index;
    } else if (state.mode === 'transform') {
      transformHandle = transformHitTest(pos.px, pos.py, startPoints);
      if (!transformHandle) return;
    }

    pushHistory();
    const bounds = meshBounds(startPoints);
    const anchor = transformAnchor(transformHandle, bounds);
    const startHandle = transformHandlePositions(bounds)[transformHandle] || [pos.x, pos.y];
    state.pointer = {
      id: event.pointerId,
      startX: pos.x,
      startY: pos.y,
      startPoints,
      pointIndex: state.selectedPoint,
      transformHandle,
      transformAnchor: anchor,
      transformStartHandle: startHandle,
    };
    els.stage.setPointerCapture(event.pointerId); event.preventDefault(); render();
  });

  els.stage.addEventListener('pointermove', event => {
    if (!state.pointer || event.pointerId !== state.pointer.id) return;
    const pos = canvasPoint(event);
    const dx = pos.x - state.pointer.startX, dy = pos.y - state.pointer.startY;
    const record = currentRecord();

    if (state.mode === 'transform') {
      const handle = state.pointer.transformHandle;
      if (handle === 'move') {
        record.points = movePointsWithinLimits(state.pointer.startPoints, dx, dy);
      } else if (handle) {
        const anchor = state.pointer.transformAnchor;
        const startHandle = state.pointer.transformStartHandle;
        const scalesX = handle.includes('w') || handle.includes('e');
        const scalesY = handle.includes('n') || handle.includes('s');
        const startDx = startHandle[0] - anchor[0];
        const startDy = startHandle[1] - anchor[1];
        const factorX = scalesX && Math.abs(startDx) > 1e-7 ? (pos.x - anchor[0]) / startDx : 1;
        const factorY = scalesY && Math.abs(startDy) > 1e-7 ? (pos.y - anchor[1]) / startDy : 1;
        record.points = scalePointsFromAnchor(state.pointer.startPoints, anchor, factorX, factorY);
      }
    } else if (state.pointer.pointIndex != null) {
      record.points[state.pointer.pointIndex] = [round6(clamp(pos.x, POINT_LIMIT.min, POINT_LIMIT.max)), round6(clamp(pos.y, POINT_LIMIT.min, POINT_LIMIT.max))];
    }
    render(); event.preventDefault();
  });
  function endPointer(event) {
    if (!state.pointer || event.pointerId !== state.pointer.id) return;
    state.pointer = null; markDirty(); render();
  }
  els.stage.addEventListener('pointerup', endPointer); els.stage.addEventListener('pointercancel', endPointer);

  (async function init() {
    populateFamilyAndVariants(); updateHistoryButtons();
    await loadInitialConfig();
    populateFamilyAndVariants();
    const record = ensureVariantRecord(); els.gridSize.value = String(record.grid.cols);
    await refreshImages();
    try {
      await loadRepoNpcDatabase();
    } catch (error) {
      els.npcReferenceSelect.innerHTML = '<option value="">Repo NPC load failed</option>';
      els.loadNpcReferenceBtn.disabled = true;
      els.npcReferenceNote.textContent = error.message;
      state.loadWarnings.push(`NPC reference: ${error.message}`);
      render();
    }
  })();
})();
