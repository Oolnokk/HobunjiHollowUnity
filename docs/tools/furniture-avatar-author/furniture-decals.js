// Furniture + Avatar Author decal extension.
// Decals are authored in recognized-surface-local coordinates so they follow
// furniture part translation, rotation, and scale without a per-frame sync.
(() => {
'use strict';

const DEG = Math.PI / 180;
const dq = id => document.getElementById(id);
const dclone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const dclamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const decalMeshes = new Map();
const decalTextureCache = new Map();
const TANKAN_SOURCE_TYPE = 'tankanText';
const IMAGE_SOURCE_TYPE = 'image';
const TANKAN_SETTINGS_VERSION = 3;
const TANKAN_BASELINE_TEXT = 'Hobunji Hollow';
const TANKAN_PADDING_X_EM = 0.8;
const TANKAN_PADDING_Y_EM = 0.28;
// Visual reference taken from the supplied authored Hobunji Hollow text decal.
const TANKAN_BASELINE = Object.freeze({
  columnSpacingEm: -0.35,
  glyphAdvanceEm: 0.6,
  glyphScaleX: 1.2,
  glyphScaleY: 1.2,
  color: '#000000',
  offsetU: 0,
  offsetV: -0.055,
  width: 0.96,
  height: 0.96,
  rotationDeg: 0,
  normalOffset: 0.003,
  opacity: 0.5,
});
let selectedDecalId = null;
let decalFileTargetSurfaceId = null;
let tankanInputTimer = null; // Keeps mobile text entry responsive without rebuilding a texture on every keystroke synchronously.
let cachedTankanBaselineLayout = null; // Anchors the pixel density of the UI-like text container to the normalized Hobunji Hollow reference.

function ensureDecalState() {
  if (!Array.isArray(state.decals)) state.decals = [];
  return state.decals;
}

function isTankanTextDecal(record) {
  return record?.sourceType === TANKAN_SOURCE_TYPE || (!!record?.tankanText && !record?.imageSource);
}

function normalizedTankanRecord(record) {
  const settingsVersion = Number(record?.tankanSettingsVersion) || 0;
  if (settingsVersion >= 2) {
    const priorUniformSize = Math.max(0.001, finiteOr(record.tankanGlyphSize, 1)); // Version 2 stored one glyph-size value; migrate it to both axes.
    return {
      tankanSettingsVersion: TANKAN_SETTINGS_VERSION,
      tankanColumnSpacing: finiteOr(record.tankanColumnSpacing, 0),
      tankanGlyphAdvance: Math.max(0.001, finiteOr(record.tankanGlyphAdvance, 1)),
      tankanGlyphSizeX: Math.max(0.001, finiteOr(record.tankanGlyphSizeX, priorUniformSize)),
      tankanGlyphSizeY: Math.max(0.001, finiteOr(record.tankanGlyphSizeY, priorUniformSize)),
      tankanColor: String(record.tankanColor || TANKAN_BASELINE.color),
      offsetU: finiteOr(record.offsetU, 0),
      offsetV: finiteOr(record.offsetV, 0),
      width: Math.max(0.001, finiteOr(record.width, 1)),
      height: Math.max(0.001, finiteOr(record.height, 1)),
      rotationDeg: finiteOr(record.rotationDeg, 0),
      normalOffset: finiteOr(record.normalOffset, 0),
      opacity: dclamp(record.opacity ?? TANKAN_BASELINE.opacity, 0, 1),
    };
  }

  const legacyColumnSpacing = finiteOr(record?.tankanColumnSpacingEm, TANKAN_BASELINE.columnSpacingEm);
  const legacyGlyphAdvance = finiteOr(record?.tankanGlyphAdvanceEm, TANKAN_BASELINE.glyphAdvanceEm);
  const legacyOffsetU = finiteOr(record?.offsetU, TANKAN_BASELINE.offsetU);
  const legacyOffsetV = finiteOr(record?.offsetV, TANKAN_BASELINE.offsetV);
  const legacyWidth = Math.max(0.001, finiteOr(record?.width, TANKAN_BASELINE.width));
  const legacyHeight = Math.max(0.001, finiteOr(record?.height, TANKAN_BASELINE.height));
  const legacyLift = finiteOr(record?.normalOffset, TANKAN_BASELINE.normalOffset);
  return {
    tankanSettingsVersion: TANKAN_SETTINGS_VERSION,
    tankanColumnSpacing: legacyColumnSpacing - TANKAN_BASELINE.columnSpacingEm,
    tankanGlyphAdvance: legacyGlyphAdvance / TANKAN_BASELINE.glyphAdvanceEm,
    tankanGlyphSizeX: 1,
    tankanGlyphSizeY: 1,
    tankanColor: String(record?.tankanColor || TANKAN_BASELINE.color),
    offsetU: legacyOffsetU - TANKAN_BASELINE.offsetU,
    offsetV: legacyOffsetV - TANKAN_BASELINE.offsetV,
    width: legacyWidth / TANKAN_BASELINE.width,
    height: legacyHeight / TANKAN_BASELINE.height,
    rotationDeg: finiteOr(record?.rotationDeg, 0) - TANKAN_BASELINE.rotationDeg,
    normalOffset: legacyLift - TANKAN_BASELINE.normalOffset,
    opacity: dclamp(record?.opacity ?? TANKAN_BASELINE.opacity, 0, 1),
  };
}

function normalizeDecal(record = {}) {
  const sourceType = record.sourceType === TANKAN_SOURCE_TYPE || record.tankanText ? TANKAN_SOURCE_TYPE : IMAGE_SOURCE_TYPE;
  const common = {
    id: record.id || uid('decal'),
    name: record.name || (sourceType === TANKAN_SOURCE_TYPE ? 'Tankan Text' : 'Furniture Decal'),
    sourceType,
    surfaceId: record.surfaceId || null,
    surfacePartId: record.surfacePartId || null,
    surfaceType: record.surfaceType || '',
    surfaceFaces: Array.isArray(record.surfaceFaces) ? [...record.surfaceFaces] : [],
    imageSource: record.imageSource || null,
    imageName: record.imageName || '',
    tankanText: String(record.tankanText || ''),
    visible: record.visible !== false,
  };
  if (sourceType === TANKAN_SOURCE_TYPE) return { ...common, ...normalizedTankanRecord(record) };
  return {
    ...common,
    offsetU: finiteOr(record.offsetU, 0),
    offsetV: finiteOr(record.offsetV, 0),
    width: Math.max(0.001, finiteOr(record.width, 0.5)),
    height: Math.max(0.001, finiteOr(record.height, 0.5)),
    rotationDeg: finiteOr(record.rotationDeg, 0),
    normalOffset: Math.max(0.0002, finiteOr(record.normalOffset, 0.003)),
    opacity: dclamp(record.opacity ?? 1, 0, 1),
  };
}

function selectedDecal() {
  return ensureDecalState().find(record => record.id === selectedDecalId) || null;
}

function decalSurface(record) {
  if (!record) return null;
  if (record.surfaceId && surfaceGroups.has(record.surfaceId)) return surfaceGroups.get(record.surfaceId);
  const partId = record.surfacePartId;
  if (!partId) return null;
  let best = null;
  let bestScore = -Infinity;
  const priorFaces = new Set(record.surfaceFaces || []);
  for (const group of surfaceGroups.values()) {
    if (group.partId !== partId) continue;
    let overlap = 0;
    for (const face of group.faceIndices || []) if (priorFaces.has(face)) overlap++;
    const typeScore = record.surfaceType && group.recognizedType === record.surfaceType ? 1000 : 0;
    const score = typeScore + overlap * 10 - Math.abs((group.faceIndices?.length || 0) - priorFaces.size);
    if (score > bestScore) { best = group; bestScore = score; }
  }
  if (best) {
    record.surfaceId = best.id;
    record.surfacePartId = best.partId;
    record.surfaceType = best.recognizedType || '';
    record.surfaceFaces = [...(best.faceIndices || [])];
  }
  return best;
}

function surfaceDimensions(group) {
  const b = group?.bounds || {};
  return {
    width: Math.max(0.001, Number(b.maxU) - Number(b.minU) || 0.001),
    height: Math.max(0.001, Number(b.maxV) - Number(b.minV) || 0.001),
  };
}

function tankanTextureOptions(record) {
  return {
    columnSpacingEm: dclamp(TANKAN_BASELINE.columnSpacingEm + finiteOr(record.tankanColumnSpacing, 0), -0.95, 4),
    glyphAdvanceEm: dclamp(TANKAN_BASELINE.glyphAdvanceEm * finiteOr(record.tankanGlyphAdvance, 1), 0.1, 4),
    glyphScaleX: dclamp(TANKAN_BASELINE.glyphScaleX * finiteOr(record.tankanGlyphSizeX, 1), 0.25, 2.5),
    glyphScaleY: dclamp(TANKAN_BASELINE.glyphScaleY * finiteOr(record.tankanGlyphSizeY, 1), 0.25, 2.5),
    paddingXEm: TANKAN_PADDING_X_EM,
    paddingYEm: TANKAN_PADDING_Y_EM,
    color: record.tankanColor || TANKAN_BASELINE.color,
  };
}

function measureTankanLayout(text, options = {}) {
  if (window.TankanScriptLayout?.measure) return window.TankanScriptLayout.measure(text, options);
  const columnSpacingEm = dclamp(finiteOr(options.columnSpacingEm, TANKAN_BASELINE.columnSpacingEm), -0.95, 4);
  const glyphAdvanceEm = dclamp(finiteOr(options.glyphAdvanceEm, TANKAN_BASELINE.glyphAdvanceEm), 0.1, 4);
  const fontSizePx = Math.max(16, finiteOr(options.fontSizePx, 128));
  const paddingEm = Math.max(0, finiteOr(options.paddingEm, 0.28));
  const paddingXEm = Math.max(0, finiteOr(options.paddingXEm, paddingEm));
  const paddingYEm = Math.max(0, finiteOr(options.paddingYEm, paddingEm));
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const columnCount = Math.max(1, words.length);
  const longestWord = Math.max(1, ...words.map(word => Array.from(word).length));
  const glyphAdvancePx = fontSizePx * glyphAdvanceEm;
  const columnAdvancePx = fontSizePx * Math.max(0.05, 1 + columnSpacingEm);
  const paddingXPx = fontSizePx * paddingXEm;
  const paddingYPx = fontSizePx * paddingYEm;
  const contentWidth = fontSizePx + (columnCount - 1) * columnAdvancePx;
  const contentHeight = longestWord * glyphAdvancePx;
  return {
    words,
    columnCount,
    longestWord,
    glyphAdvanceEm,
    glyphAdvancePx,
    columnSpacingEm,
    columnAdvancePx,
    paddingXPx,
    paddingYPx,
    widthPx: Math.max(1, Math.ceil(contentWidth + paddingXPx * 2 - 1e-9)),
    heightPx: Math.max(1, Math.ceil(contentHeight + paddingYPx * 2 - 1e-9)),
  };
}

function baselineTankanLayout() {
  if (cachedTankanBaselineLayout) return cachedTankanBaselineLayout;
  cachedTankanBaselineLayout = measureTankanLayout(TANKAN_BASELINE_TEXT, {
    columnSpacingEm: TANKAN_BASELINE.columnSpacingEm,
    glyphAdvanceEm: TANKAN_BASELINE.glyphAdvanceEm,
    glyphScaleX: TANKAN_BASELINE.glyphScaleX,
    glyphScaleY: TANKAN_BASELINE.glyphScaleY,
    paddingXEm: TANKAN_PADDING_X_EM,
    paddingYEm: TANKAN_PADDING_Y_EM,
    color: TANKAN_BASELINE.color,
  });
  return cachedTankanBaselineLayout;
}

function tankanNaturalWidthFactor(record, layout) {
  const baseLayout = baselineTankanLayout();
  const liveLayout = layout || measureTankanLayout(record?.tankanText, tankanTextureOptions(record));
  return Math.max(0.001, liveLayout.widthPx / baseLayout.widthPx);
}

function tankanNaturalHeightFactor(record, layout) {
  const baseLayout = baselineTankanLayout();
  const liveLayout = layout || measureTankanLayout(record?.tankanText, tankanTextureOptions(record));
  return Math.max(0.001, liveLayout.heightPx / baseLayout.heightPx);
}

function tankanContainerPixels(record) {
  const baseLayout = baselineTankanLayout();
  return {
    widthPx: Math.max(1, Math.round(baseLayout.widthPx * Math.max(0.001, finiteOr(record?.width, 1)))),
    heightPx: Math.max(1, Math.round(baseLayout.heightPx * Math.max(0.001, finiteOr(record?.height, 1)))),
  };
}

function tankanContainerState(record) {
  const options = tankanTextureOptions(record);
  const layout = measureTankanLayout(record?.tankanText, options);
  const container = tankanContainerPixels(record);
  const fitScale = Math.min(1, container.widthPx / layout.widthPx, container.heightPx / layout.heightPx);
  return {
    layout,
    containerWidthPx: container.widthPx,
    containerHeightPx: container.heightPx,
    fitScale,
    renderedWidthPx: layout.widthPx * fitScale,
    renderedHeightPx: layout.heightPx * fitScale,
  };
}

function tankanRenderOptions(record) {
  const container = tankanContainerPixels(record);
  return {
    ...tankanTextureOptions(record),
    containerWidthPx: container.widthPx,
    containerHeightPx: container.heightPx,
  };
}

function resolvedDecalTransform(record) {
  if (!isTankanTextDecal(record)) {
    return {
      offsetU: record.offsetU,
      offsetV: record.offsetV,
      width: record.width,
      height: record.height,
      rotationDeg: record.rotationDeg,
      normalOffset: record.normalOffset,
      opacity: record.opacity,
      tankanLayout: null,
    };
  }
  const container = tankanContainerState(record);
  return {
    offsetU: TANKAN_BASELINE.offsetU + finiteOr(record.offsetU, 0),
    offsetV: TANKAN_BASELINE.offsetV + finiteOr(record.offsetV, 0),
    width: TANKAN_BASELINE.width * Math.max(0.001, finiteOr(record.width, 1)),
    height: TANKAN_BASELINE.height * Math.max(0.001, finiteOr(record.height, 1)),
    rotationDeg: TANKAN_BASELINE.rotationDeg + finiteOr(record.rotationDeg, 0),
    normalOffset: Math.max(0.0002, TANKAN_BASELINE.normalOffset + finiteOr(record.normalOffset, 0)),
    opacity: dclamp(record.opacity ?? TANKAN_BASELINE.opacity, 0, 1),
    tankanLayout: container.layout,
    tankanFitScale: container.fitScale,
  };
}

function configureDecalTexture(texture) {
  texture.format = THREE.RGBAFormat;
  texture.premultiplyAlpha = false;
  if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  else texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  return texture;
}

function buildDecalTexturePair(image) {
  return { map: configureDecalTexture(new THREE.Texture(image)), alphaMap: null };
}

function decalTextureKey(record) {
  if (isTankanTextDecal(record)) {
    const options = tankanRenderOptions(record);
    return `tankan:${record.tankanText}\u0000${options.columnSpacingEm}\u0000${options.glyphAdvanceEm}\u0000${options.glyphScaleX}\u0000${options.glyphScaleY}\u0000${options.paddingXEm}\u0000${options.paddingYEm}\u0000${options.containerWidthPx}\u0000${options.containerHeightPx}\u0000${options.color}`;
  }
  return `image:${record.imageSource || ''}`;
}

function decalHasVisualSource(record) {
  return isTankanTextDecal(record) ? !!String(record.tankanText || '').trim() : !!record.imageSource;
}

function buildTankanDecalTexture(record) {
  const layout = window.TankanScriptLayout;
  if (!layout?.createCanvas) return Promise.reject(new Error('TankanScriptLayout is unavailable. Reload the editor so the shared script renderer can load.'));
  return Promise.resolve(layout.ensureFontLoaded?.()).then(() => {
    const result = layout.createCanvas(record.tankanText, tankanRenderOptions(record));
    if (!result?.canvas) throw new Error('Could not create Tankan-script canvas.');
    const texture = configureDecalTexture(new THREE.CanvasTexture(result.canvas));
    texture.userData = { ...(texture.userData || {}), tankanLayout: result.layout || null };
    return { map: texture, alphaMap: null, layout: result.layout || null };
  });
}

function loadImageDecalTexture(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!/^(?:data|blob):/i.test(source)) image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      try { resolve(buildDecalTexturePair(image)); }
      catch (error) { reject(new Error(`Could not preserve decal transparency: ${error.message}`)); }
    };
    image.onerror = () => reject(new Error('Could not load decal image (network/CORS).'));
    image.src = source;
  });
}

function loadDecalTexture(record) {
  if (!decalHasVisualSource(record)) return Promise.resolve(null);
  const key = decalTextureKey(record);
  if (decalTextureCache.has(key)) return decalTextureCache.get(key);
  const promise = (isTankanTextDecal(record) ? buildTankanDecalTexture(record) : loadImageDecalTexture(record.imageSource))
    .catch(error => { decalTextureCache.delete(key); throw error; });
  decalTextureCache.set(key, promise);
  return promise;
}

function disposeDecalMesh(id) {
  const mesh = decalMeshes.get(id);
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry?.dispose?.();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials.filter(Boolean)) material.dispose?.();
  const outline = mesh.userData?.outline;
  if (outline) {
    outline.geometry?.dispose?.();
    outline.material?.dispose?.();
  }
  decalMeshes.delete(id);
}

function clearDecalMeshes() {
  for (const id of [...decalMeshes.keys()]) disposeDecalMesh(id);
}

function localSurfaceFrame(group) {
  if (!group) return null;
  const dimensions = surfaceDimensions(group);
  const centerU = (Number(group.bounds?.minU) + Number(group.bounds?.maxU)) / 2;
  const centerV = (Number(group.bounds?.minV) + Number(group.bounds?.maxV)) / 2;
  const projectedCenter = group.basisU.clone().multiplyScalar(centerU)
    .addScaledVector(group.basisV, centerV)
    .addScaledVector(group.localNormal, group.localCentroid.dot(group.localNormal));
  return { dimensions, center: projectedCenter, u: group.basisU, v: group.basisV, normal: group.localNormal };
}

function buildDecalMesh(record) {
  disposeDecalMesh(record.id);
  if (!record.visible || !decalHasVisualSource(record)) return null;
  const group = decalSurface(record);
  const partMesh = group ? meshes.get(group.partId) : null;
  const frame = group ? localSurfaceFrame(group) : null;
  if (!group || !partMesh || !frame) return null;

  const transform = resolvedDecalTransform(record);
  const width = Math.max(0.001, frame.dimensions.width * transform.width);
  const height = Math.max(0.001, frame.dimensions.height * transform.height);
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: transform.opacity,
    alphaTest: 0.001,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const textureKey = decalTextureKey(record);
  mesh.name = record.name || 'Furniture Decal';
  mesh.userData = { type: 'furnitureDecal', id: record.id, surfaceId: group.id, decalTextureKey: textureKey, tankanFitScale: transform.tankanFitScale ?? null };
  mesh.raycast = () => {};

  const halfU = frame.dimensions.width / 2;
  const halfV = frame.dimensions.height / 2;
  mesh.position.copy(frame.center)
    .addScaledVector(frame.u, transform.offsetU * halfU)
    .addScaledVector(frame.v, transform.offsetV * halfV)
    .addScaledVector(frame.normal, transform.normalOffset);
  const basis = new THREE.Matrix4().makeBasis(frame.u, frame.v, frame.normal);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.rotateZ(transform.rotationDeg * DEG);
  partMesh.add(mesh);
  decalMeshes.set(record.id, mesh);

  if (selectedDecalId === record.id) {
    const points = [
      new THREE.Vector3(-width / 2, -height / 2, 0.0005),
      new THREE.Vector3(width / 2, -height / 2, 0.0005),
      new THREE.Vector3(width / 2, height / 2, 0.0005),
      new THREE.Vector3(-width / 2, height / 2, 0.0005),
    ];
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x65b8ff, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    outline.renderOrder = 999;
    outline.raycast = () => {};
    mesh.add(outline);
    mesh.userData.outline = outline;
  }

  loadDecalTexture(record).then(textures => {
    const live = decalMeshes.get(record.id);
    if (live?.material && live.userData?.decalTextureKey === textureKey && textures?.map) {
      live.material.map = textures.map;
      live.material.alphaMap = textures.alphaMap || null;
      live.material.needsUpdate = true;
      if (isTankanTextDecal(record) && textures.layout) {
        live.userData.tankanLayout = textures.layout;
        live.userData.tankanFitScale = textures.layout.fitScale ?? live.userData.tankanFitScale;
      }
      renderTankanDebug(record);
    }
  }).catch(error => log?.(`Decal source failed (${record.imageName || record.name || record.id}): ${error.message}`, 'warn'));
  return mesh;
}

function rebuildDecals({ prune = true } = {}) {
  clearDecalMeshes();
  const decals = ensureDecalState();
  for (let i = decals.length - 1; i >= 0; i--) {
    decals[i] = normalizeDecal(decals[i]);
    const group = decalSurface(decals[i]);
    if (!group && prune) decals.splice(i, 1);
  }
  for (const record of decals) buildDecalMesh(record);
  if (selectedDecalId && !decals.some(record => record.id === selectedDecalId)) selectedDecalId = null;
  renderDecalUi();
}

function selectedSurfaceForDecal() {
  const surface = selectedSurface?.();
  if (surface) return surface;
  const ids = activeSurfaceIds?.() || [];
  return ids.length ? surfaceGroups.get(ids[ids.length - 1]) : null;
}

function baseRecordForSurface(surface) {
  return {
    id: uid('decal'),
    surfaceId: surface.id,
    surfacePartId: surface.partId,
    surfaceType: surface.recognizedType,
    surfaceFaces: [...(surface.faceIndices || [])],
    normalOffset: 0.003,
  };
}

function addDecalFromFile(file, surfaceId) {
  const surface = surfaceGroups.get(surfaceId);
  if (!surface) { log?.('Select a recognized furniture surface before adding a decal.', 'warn'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const record = normalizeDecal({
      ...baseRecordForSurface(surface),
      name: file.name.replace(/\.[^.]+$/, '') || 'Furniture Decal',
      sourceType: IMAGE_SOURCE_TYPE,
      imageSource: String(reader.result || ''),
      imageName: file.name,
      width: 0.5,
      height: 0.5,
    });
    ensureDecalState().push(record);
    selectedDecalId = record.id;
    buildDecalMesh(record);
    renderDecalUi();
    updateStats?.();
    queueUndoHistory?.('add furniture decal');
    log?.(`Added decal ${record.name} to ${surface.recognizedType || 'surface'}.`);
  };
  reader.readAsDataURL(file);
}

function addTankanTextDecal() {
  const surface = selectedSurfaceForDecal();
  if (!surface) { log?.('Select a recognized furniture surface first.', 'warn'); return; }
  const record = normalizeDecal({
    ...baseRecordForSurface(surface),
    name: 'Tankan Text',
    sourceType: TANKAN_SOURCE_TYPE,
    tankanText: TANKAN_BASELINE_TEXT,
    tankanSettingsVersion: TANKAN_SETTINGS_VERSION,
    tankanColumnSpacing: 0,
    tankanGlyphAdvance: 1,
    tankanGlyphSizeX: 1,
    tankanGlyphSizeY: 1,
    tankanColor: TANKAN_BASELINE.color,
    offsetU: 0,
    offsetV: 0,
    width: 1,
    height: 1,
    rotationDeg: 0,
    normalOffset: 0,
    opacity: TANKAN_BASELINE.opacity,
  });
  ensureDecalState().push(record);
  selectedDecalId = record.id;
  buildDecalMesh(record);
  renderDecalUi();
  updateStats?.();
  queueUndoHistory?.('add Tankan text decal');
  log?.(`Added normalized Tankan-script text to ${surface.recognizedType || 'surface'} in a UI-like fit container.`);
}

function requestDecalImage() {
  const surface = selectedSurfaceForDecal();
  if (!surface) { log?.('Select a recognized furniture surface first.', 'warn'); return; }
  decalFileTargetSurfaceId = surface.id;
  const input = dq('furnitureDecalFile');
  if (input) { input.value = ''; input.click(); }
}

function retargetSelectedDecal() {
  const record = selectedDecal();
  const surface = selectedSurfaceForDecal();
  if (!record || !surface) { log?.('Select both a decal and a target furniture surface.', 'warn'); return; }
  record.surfaceId = surface.id;
  record.surfacePartId = surface.partId;
  record.surfaceType = surface.recognizedType;
  record.surfaceFaces = [...(surface.faceIndices || [])];
  record.offsetU = 0;
  record.offsetV = 0;
  buildDecalMesh(record);
  renderDecalUi();
  queueUndoHistory?.('retarget furniture decal');
}

function deleteSelectedDecal() {
  const record = selectedDecal();
  if (!record) return;
  state.decals = ensureDecalState().filter(candidate => candidate.id !== record.id);
  disposeDecalMesh(record.id);
  selectedDecalId = null;
  renderDecalUi();
  updateStats?.();
  queueUndoHistory?.('delete furniture decal');
}

function duplicateSelectedDecal() {
  const record = selectedDecal();
  if (!record) return;
  const copy = normalizeDecal({ ...dclone(record), id: uid('decal'), name: `${record.name} Copy`, offsetU: record.offsetU + 0.08, offsetV: record.offsetV + 0.08 });
  ensureDecalState().push(copy);
  selectedDecalId = copy.id;
  buildDecalMesh(copy);
  renderDecalUi();
  updateStats?.();
  queueUndoHistory?.('duplicate furniture decal');
}

function fitSelectedDecal() {
  const record = selectedDecal();
  if (!record) return;
  record.offsetU = 0;
  record.offsetV = 0;
  record.width = isTankanTextDecal(record) ? 1 : 0.96;
  record.height = isTankanTextDecal(record) ? 1 : 0.96;
  buildDecalMesh(record);
  renderDecalUi();
  queueUndoHistory?.('fit furniture decal');
}

function centerSelectedDecal() {
  const record = selectedDecal();
  if (!record) return;
  record.offsetU = 0;
  record.offsetV = 0;
  buildDecalMesh(record);
  renderDecalUi();
  queueUndoHistory?.('center furniture decal');
}

function updateSelectedDecalFromUi({ recordHistory = true } = {}) {
  const record = selectedDecal();
  if (!record) return;
  const tankan = isTankanTextDecal(record);
  record.name = dq('decalName')?.value.trim() || record.name;
  record.offsetU = finiteOr(dq('decalOffsetU')?.value, 0);
  record.offsetV = finiteOr(dq('decalOffsetV')?.value, 0);
  record.width = Math.max(0.001, finiteOr(dq('decalWidth')?.value, record.width));
  record.height = Math.max(0.001, finiteOr(dq('decalHeight')?.value, record.height));
  record.rotationDeg = finiteOr(dq('decalRotation')?.value, 0);
  record.normalOffset = tankan ? finiteOr(dq('decalLift')?.value, 0) : Math.max(0.0002, finiteOr(dq('decalLift')?.value, 0.003));
  record.opacity = dclamp(dq('decalOpacity')?.value ?? (tankan ? TANKAN_BASELINE.opacity : 1), 0, 1);
  record.visible = dq('decalVisible')?.checked !== false;
  if (tankan) {
    record.tankanSettingsVersion = TANKAN_SETTINGS_VERSION;
    record.tankanText = dq('decalTankanText')?.value || '';
    record.tankanColumnSpacing = dclamp(dq('decalTankanColumnSpacing')?.value ?? 0, -0.6, 4.35);
    record.tankanGlyphAdvance = dclamp(dq('decalTankanGlyphAdvance')?.value ?? 1, 1 / 6, 20 / 3);
    record.tankanGlyphSizeX = dclamp(dq('decalTankanGlyphSizeX')?.value ?? 1, 0.25, 2);
    record.tankanGlyphSizeY = dclamp(dq('decalTankanGlyphSizeY')?.value ?? 1, 0.25, 2);
    record.tankanColor = dq('decalTankanColor')?.value || TANKAN_BASELINE.color;
  }
  buildDecalMesh(record);
  renderDecalList();
  renderTankanDebug(record);
  if (recordHistory) queueUndoHistory?.('edit furniture decal');
}

function decalSurfaceLabel(record) {
  const group = decalSurface(record);
  return group ? `${group.recognizedType || 'surface'} · ${group.partId}` : 'missing surface';
}

function decalSourceLabel(record) {
  if (isTankanTextDecal(record)) {
    const text = String(record.tankanText || '').trim();
    return `Tankan text · ${text ? `“${text.slice(0, 36)}${text.length > 36 ? '…' : ''}”` : 'empty'}`;
  }
  return record.imageName || 'image decal';
}

function renderDecalList() {
  const list = dq('furnitureDecalList');
  if (!list) return;
  list.innerHTML = ensureDecalState().map(record => `<div class="item ${record.id === selectedDecalId ? 'sel' : ''}" data-furniture-decal="${escapeHtml?.(record.id) || record.id}"><div class="item-title">${escapeHtml?.(record.name) || record.name}</div><div class="item-meta">${escapeHtml?.(decalSurfaceLabel(record)) || decalSurfaceLabel(record)} · ${escapeHtml?.(decalSourceLabel(record)) || decalSourceLabel(record)}</div></div>`).join('') || '<div class="muted">No decals authored yet.</div>';
  list.querySelectorAll('[data-furniture-decal]').forEach(element => {
    element.onclick = () => {
      selectedDecalId = element.dataset.furnitureDecal;
      rebuildDecals({ prune: false });
    };
  });
}

function renderTankanDebug(record = selectedDecal()) {
  const readout = dq('decalTankanReadout');
  if (!readout || (record?.id && record.id !== selectedDecalId)) return;
  if (!record || !isTankanTextDecal(record)) { readout.textContent = ''; return; }
  const container = tankanContainerState(record);
  const layout = container.layout;
  const fitLabel = container.fitScale < 0.9995 ? `fit-down ${container.fitScale.toFixed(2)}×` : 'natural size';
  readout.textContent = `${layout.columnCount} word column${layout.columnCount === 1 ? '' : 's'} · longest ${layout.longestWord} glyph${layout.longestWord === 1 ? '' : 's'} · normalized spacing ${finiteOr(record.tankanColumnSpacing, 0).toFixed(2)} · advance ${finiteOr(record.tankanGlyphAdvance, 1).toFixed(2)}× · glyph X ${finiteOr(record.tankanGlyphSizeX, 1).toFixed(2)}× · glyph Y ${finiteOr(record.tankanGlyphSizeY, 1).toFixed(2)}× · container ${finiteOr(record.width, 1).toFixed(2)}×${finiteOr(record.height, 1).toFixed(2)} · ${fitLabel} · natural ${layout.widthPx}×${layout.heightPx}px in ${container.containerWidthPx}×${container.containerHeightPx}px`;
}

function renderDecalEditor() {
  const editor = dq('furnitureDecalEditor');
  if (!editor) return;
  const record = selectedDecal();
  editor.classList.toggle('hidden', !record);
  if (!record) return;
  const tankan = isTankanTextDecal(record);
  dq('decalName').value = record.name;
  dq('decalOffsetU').value = record.offsetU;
  dq('decalOffsetV').value = record.offsetV;
  dq('decalWidth').value = record.width;
  dq('decalHeight').value = record.height;
  dq('decalRotation').value = record.rotationDeg;
  dq('decalLift').value = record.normalOffset;
  dq('decalOpacity').value = record.opacity;
  dq('decalVisible').checked = record.visible !== false;
  dq('decalTankanFields')?.classList.toggle('hidden', !tankan);
  if (dq('decalWidthLabel')) dq('decalWidthLabel').textContent = tankan ? 'Container width' : 'Width scale';
  if (dq('decalHeightLabel')) dq('decalHeightLabel').textContent = tankan ? 'Container height' : 'Height scale';
  if (tankan) {
    dq('decalTankanText').value = record.tankanText;
    dq('decalTankanColumnSpacing').value = record.tankanColumnSpacing;
    dq('decalTankanGlyphAdvance').value = record.tankanGlyphAdvance;
    dq('decalTankanGlyphSizeX').value = record.tankanGlyphSizeX;
    dq('decalTankanGlyphSizeY').value = record.tankanGlyphSizeY;
    dq('decalTankanColor').value = record.tankanColor;
  }
  const label = dq('decalSurfaceReadout');
  if (label) label.textContent = `${decalSurfaceLabel(record)} · ${decalSourceLabel(record)}`;
  renderTankanDebug(record);
}

function renderDecalUi() {
  renderDecalList();
  renderDecalEditor();
}

function installDecalUi() {
  if (dq('furnitureDecalPanel')) return;
  const host = dq('tab-surfaces');
  if (!host) return;
  const panel = document.createElement('div');
  panel.id = 'furnitureDecalPanel';
  panel.className = 'section';
  panel.innerHTML = `<h2>Surface Decals</h2>
    <div class="muted">Place image artwork or editable Tankan-script text over a recognized furniture surface. For Tankan text, Width/Height define a 2D container: text stays at its authored glyph size and spacing while there is room, and only uniformly scales down when it would overflow the box.</div>
    <div class="g2"><button id="addFurnitureDecal" class="ok">＋ Add Image to Selected Surface</button><button id="addFurnitureTankanText" class="ok">＋ Add Tankan Text</button></div>
    <button id="retargetFurnitureDecal" style="width:100%;margin-top:6px">Retarget Selected Decal</button>
    <input id="furnitureDecalFile" type="file" accept="image/png,image/webp,image/jpeg" hidden>
    <div id="furnitureDecalList" class="list" style="margin-top:7px"></div>
    <div id="furnitureDecalEditor" class="hidden">
      <hr><div id="decalSurfaceReadout" class="readout muted"></div>
      <label>Name</label><input id="decalName" type="text">
      <div id="decalTankanFields" class="hidden">
        <label>Tankan-script text</label><textarea id="decalTankanText" rows="3" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
        <div class="g2"><div><label>Word-column spacing</label><input id="decalTankanColumnSpacing" type="number" min="-0.6" max="4.35" step="0.05"></div><div><label>Glyph advance</label><input id="decalTankanGlyphAdvance" type="number" min="0.1667" max="6.6667" step="0.05"></div></div>
        <div class="g3"><div><label>Glyph size X</label><input id="decalTankanGlyphSizeX" type="number" min="0.25" max="2" step="0.05"></div><div><label>Glyph size Y</label><input id="decalTankanGlyphSizeY" type="number" min="0.25" max="2" step="0.05"></div><div><label>Text color</label><input id="decalTankanColor" type="color" value="#000000"></div></div>
        <div id="decalTankanReadout" class="readout muted" style="margin-top:6px"></div>
      </div>
      <div class="g2"><div><label>U offset</label><input id="decalOffsetU" type="number" step="0.02"></div><div><label>V offset</label><input id="decalOffsetV" type="number" step="0.02"></div></div>
      <div class="g2"><div><label id="decalWidthLabel">Width scale</label><input id="decalWidth" type="number" min="0.001" step="0.02"></div><div><label id="decalHeightLabel">Height scale</label><input id="decalHeight" type="number" min="0.001" step="0.02"></div></div>
      <div class="g3"><div><label>Rotation°</label><input id="decalRotation" type="number" step="1"></div><div><label>Surface-lift offset</label><input id="decalLift" type="number" step="0.001"></div><div><label>Opacity</label><input id="decalOpacity" type="number" min="0" max="1" step="0.05"></div></div>
      <label class="row"><input id="decalVisible" type="checkbox"> Visible</label>
      <div class="g2"><button id="centerFurnitureDecal">Center</button><button id="fitFurnitureDecal">Fit Surface</button></div>
      <div class="g2"><button id="duplicateFurnitureDecal">Duplicate</button><button id="deleteFurnitureDecal" class="bad">Delete</button></div>
    </div>`;
  host.prepend(panel);
  dq('addFurnitureDecal').onclick = requestDecalImage;
  dq('addFurnitureTankanText').onclick = addTankanTextDecal;
  dq('retargetFurnitureDecal').onclick = retargetSelectedDecal;
  dq('furnitureDecalFile').addEventListener('change', event => {
    const file = event.target?.files?.[0];
    if (file && decalFileTargetSurfaceId) addDecalFromFile(file, decalFileTargetSurfaceId);
  });
  for (const id of ['decalName','decalOffsetU','decalOffsetV','decalWidth','decalHeight','decalRotation','decalLift','decalOpacity','decalVisible','decalTankanColumnSpacing','decalTankanGlyphAdvance','decalTankanGlyphSizeX','decalTankanGlyphSizeY','decalTankanColor']) {
    dq(id)?.addEventListener('change', () => updateSelectedDecalFromUi({ recordHistory: true }));
  }
  dq('decalTankanText')?.addEventListener('input', () => {
    clearTimeout(tankanInputTimer);
    tankanInputTimer = setTimeout(() => updateSelectedDecalFromUi({ recordHistory: false }), 90);
  });
  dq('decalTankanText')?.addEventListener('change', () => updateSelectedDecalFromUi({ recordHistory: true }));
  dq('centerFurnitureDecal').onclick = centerSelectedDecal;
  dq('fitFurnitureDecal').onclick = fitSelectedDecal;
  dq('duplicateFurnitureDecal').onclick = duplicateSelectedDecal;
  dq('deleteFurnitureDecal').onclick = deleteSelectedDecal;
}

const originalDecalRepoImport = importRepoFurniture;
importRepoFurniture = async function importRepoFurnitureWithMaterialDefaults(...args) {
  const beforeIds = new Set((state.parts || []).map(part => part.id));
  const result = await originalDecalRepoImport(...args);
  const importedParts = (state.parts || []).filter(part => !beforeIds.has(part.id));
  const texturedParts = importedParts.filter(part => part.materialTexture || part.materialCapTexture);
  if (texturedParts.length) {
    applyEntrySurfaceDefaults({ materialRules: { mapping: 'stretch' } }, texturedParts);
    rebuildFurnitureMeshes();
    log?.(`Applied authored material textures to ${texturedParts.length} repository-imported piece${texturedParts.length === 1 ? '' : 's'}.`);
  }
  return result;
};

const originalDecalBuildPartMesh = buildPartMesh;
buildPartMesh = function buildPartMeshWithDecals(part) {
  const mesh = originalDecalBuildPartMesh(part);
  for (const record of ensureDecalState().filter(item => item.surfacePartId === part.id)) buildDecalMesh(record);
  return mesh;
};

const originalDecalRebuildFurnitureMeshes = rebuildFurnitureMeshes;
rebuildFurnitureMeshes = function rebuildFurnitureMeshesWithDecals(...args) {
  const result = originalDecalRebuildFurnitureMeshes(...args);
  rebuildDecals({ prune: false });
  return result;
};

const originalDecalExport = exportData;
exportData = function exportFurnitureWithDecals(...args) {
  const data = originalDecalExport(...args);
  data.decals = dclone(ensureDecalState());
  data.decalAuthoring = {
    version: 4,
    coordinateSpace: 'recognized-surface-local',
    sizeUnits: 'surface-fraction',
    offsetUnits: 'half-surface-span',
    sourceTypes: [IMAGE_SOURCE_TYPE, TANKAN_SOURCE_TYPE],
    tankanLayout: 'vertical-word-columns',
    tankanSizing: 'container-fit-down-v1',
  };
  return data;
};

const originalDecalLoad = loadData;
loadData = function loadFurnitureWithDecals(data, ...args) {
  state.decals = Array.isArray(data?.decals) ? data.decals.map(normalizeDecal) : [];
  selectedDecalId = null;
  const result = originalDecalLoad(data, ...args);
  rebuildDecals({ prune: false });
  renderDecalUi();
  return result;
};

const originalDecalClearFurniture = clearFurniture;
clearFurniture = function clearFurnitureWithDecals(...args) {
  const result = originalDecalClearFurniture(...args);
  state.decals = [];
  selectedDecalId = null;
  clearDecalMeshes();
  renderDecalUi();
  return result;
};

const originalDecalUpdateStats = updateStats;
updateStats = function updateStatsWithDecals(...args) {
  const result = originalDecalUpdateStats(...args);
  const pill = dq('statsPill');
  if (pill) {
    const count = ensureDecalState().length;
    if (/ · \d+ decals?\b/.test(pill.textContent)) pill.textContent = pill.textContent.replace(/ · \d+ decals?\b/, ` · ${count} decals`);
    else pill.textContent += ` · ${count} decals`;
  }
  return result;
};

installDecalUi();
rebuildDecals({ prune: false });
log?.('Furniture decal authoring ready. Latest change: Tankan Width/Height are now UI-like container dimensions; text stays at natural glyph size and only uniformly fits down on overflow.');
})();
