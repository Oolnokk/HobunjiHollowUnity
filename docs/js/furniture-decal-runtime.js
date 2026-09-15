// Generic runtime renderer for Furniture + Avatar Author decals stored in authored furniture JSON.
(() => {
  'use strict';

  const THREE = window.THREE; // Used to build the runtime decal plane and its surface-local transform.
  const authored = window.AuthoredFurniture; // Wrapped so every authored furniture build can receive its editable decals.
  if (!THREE || !authored?.buildGroup) {
    window.FurnitureDecalRuntime = { installed: false, reason: 'missing THREE/AuthoredFurniture' };
    return;
  }

  const DEG = Math.PI / 180;
  const TANKAN_SOURCE_TYPE = 'tankanText';
  const TANKAN_SETTINGS_VERSION = 3;
  const TANKAN_NORMALIZED_VERSION = 2;
  const TANKAN_BASELINE_TEXT = 'Hobunji Hollow';
  const TANKAN_PADDING_X_EM = 0.8;
  const TANKAN_PADDING_Y_EM = 0.28;
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
  const SCRIPT_SRC = typeof document !== 'undefined' ? (document.currentScript?.src || '') : ''; // Resolves the shared Tankan helper from nested previews.
  const textureCache = new Map(); // Resolved decal source key -> shared THREE.Texture used by all furniture instances.
  let tankanLayoutPromise = null; // Shared async helper load so text decals can appear when this runtime is loaded directly.
  let cachedTankanBaselineLayout = null; // Anchors runtime container pixel density to the same normalized Hobunji Hollow reference as the editor.

  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function isTankanTextDecal(record) {
    return record?.sourceType === TANKAN_SOURCE_TYPE || (!!record?.tankanText && !record?.imageSource);
  }

  function isNormalizedTankan(record) {
    return isTankanTextDecal(record) && Number(record?.tankanSettingsVersion) >= TANKAN_NORMALIZED_VERSION;
  }

  function normalizedGlyphSize(record, axis) {
    const uniform = Math.max(0.001, finiteOr(record?.tankanGlyphSize, 1)); // Version-2 normalized records used one shared glyph-size value.
    const value = axis === 'x' ? record?.tankanGlyphSizeX : record?.tankanGlyphSizeY;
    return Math.max(0.001, finiteOr(value, uniform));
  }

  function resolvedImageSource(record) {
    const raw = String(record?.runtimeImageSource || record?.imageSource || record?.imageName || '').trim();
    if (!raw || /^(?:data|blob):/i.test(raw)) return raw;
    const docsAsset = raw.lastIndexOf('docs/assets/');
    if (docsAsset >= 0) return raw.slice(docsAsset + 5);
    const cleaned = raw.replace(/^(?:\.\.\/)+/, '').replace(/^docs\//, '');
    if (cleaned.startsWith('textures/')) return `assets/${cleaned}`;
    return cleaned;
  }

  function configureTexture(texture) {
    texture.format = THREE.RGBAFormat;
    texture.premultiplyAlpha = false;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    return texture;
  }

  function ensureTankanLayout() {
    if (window.TankanScriptLayout?.installed) return Promise.resolve(window.TankanScriptLayout);
    if (tankanLayoutPromise) return tankanLayoutPromise;
    if (typeof document === 'undefined') return Promise.resolve(null);
    tankanLayoutPromise = new Promise(resolve => {
      const finish = () => resolve(window.TankanScriptLayout?.installed ? window.TankanScriptLayout : null);
      const existing = document.querySelector?.('script[data-hobunji-tankan-layout]');
      if (existing) {
        existing.addEventListener?.('load', finish, { once: true });
        existing.addEventListener?.('error', () => resolve(null), { once: true });
        if (window.TankanScriptLayout?.installed) finish();
        return;
      }
      const script = document.createElement('script');
      try { script.src = SCRIPT_SRC ? new URL('tankan-script-layout.js', SCRIPT_SRC).href : 'js/tankan-script-layout.js'; }
      catch (_) { script.src = 'js/tankan-script-layout.js'; }
      script.async = false;
      script.dataset.hobunjiTankanLayout = '1';
      script.onload = finish;
      script.onerror = () => resolve(null);
      (document.head || document.documentElement).appendChild(script);
    });
    return tankanLayoutPromise;
  }

  function tankanTextureOptions(record) {
    if (!isNormalizedTankan(record)) {
      return {
        columnSpacingEm: finiteOr(record?.tankanColumnSpacingEm, -0.55),
        glyphAdvanceEm: finiteOr(record?.tankanGlyphAdvanceEm, 0.56),
        glyphScaleX: 1,
        glyphScaleY: 1,
        color: String(record?.tankanColor || TANKAN_BASELINE.color),
      };
    }
    return {
      columnSpacingEm: clamp(TANKAN_BASELINE.columnSpacingEm + finiteOr(record.tankanColumnSpacing, 0), -0.95, 4),
      glyphAdvanceEm: clamp(TANKAN_BASELINE.glyphAdvanceEm * finiteOr(record.tankanGlyphAdvance, 1), 0.1, 4),
      glyphScaleX: clamp(TANKAN_BASELINE.glyphScaleX * normalizedGlyphSize(record, 'x'), 0.25, 2.5),
      glyphScaleY: clamp(TANKAN_BASELINE.glyphScaleY * normalizedGlyphSize(record, 'y'), 0.25, 2.5),
      paddingXEm: TANKAN_PADDING_X_EM,
      paddingYEm: TANKAN_PADDING_Y_EM,
      color: String(record.tankanColor || TANKAN_BASELINE.color),
    };
  }

  function measureTankanLayout(text, options = {}) {
    if (window.TankanScriptLayout?.measure) return window.TankanScriptLayout.measure(text, options);
    const columnSpacingEm = clamp(finiteOr(options.columnSpacingEm, TANKAN_BASELINE.columnSpacingEm), -0.95, 4);
    const glyphAdvanceEm = clamp(finiteOr(options.glyphAdvanceEm, TANKAN_BASELINE.glyphAdvanceEm), 0.1, 4);
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
      columnCount,
      longestWord,
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
    const options = tankanTextureOptions(record);
    if (!isNormalizedTankan(record)) return options;
    const container = tankanContainerPixels(record);
    return {
      ...options,
      containerWidthPx: container.widthPx,
      containerHeightPx: container.heightPx,
    };
  }

  function tankanTextureKey(record) {
    const options = tankanRenderOptions(record);
    return `tankan:${record?.tankanText || ''}\u0000${options.columnSpacingEm}\u0000${options.glyphAdvanceEm}\u0000${options.glyphScaleX}\u0000${options.glyphScaleY}\u0000${options.paddingXEm ?? ''}\u0000${options.paddingYEm ?? ''}\u0000${options.containerWidthPx ?? ''}\u0000${options.containerHeightPx ?? ''}\u0000${options.color}`;
  }

  function tankanTextureFor(record) {
    const key = tankanTextureKey(record);
    if (textureCache.has(key)) return textureCache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const texture = configureTexture(new THREE.CanvasTexture(canvas));
    textureCache.set(key, texture);
    ensureTankanLayout().then(layout => {
      if (!layout?.renderToCanvas) throw new Error('TankanScriptLayout unavailable');
      return Promise.resolve(layout.ensureFontLoaded?.()).then(() => layout);
    }).then(layout => {
      const rendered = layout.renderToCanvas(canvas, record.tankanText, tankanRenderOptions(record));
      texture.userData = { ...(texture.userData || {}), tankanLayout: rendered || null };
      texture.needsUpdate = true;
    }).catch(error => {
      console.warn(`[furniture decal] failed to render Tankan text ${JSON.stringify(record?.tankanText || '')}`, error);
    });
    return texture;
  }

  function imageTextureFor(record) {
    const source = resolvedImageSource(record);
    if (!source) return null;
    const key = `image:${source}`;
    if (textureCache.has(key)) return textureCache.get(key);
    const texture = new THREE.TextureLoader().load(source, loaded => {
      configureTexture(loaded);
    }, undefined, error => {
      console.warn(`[furniture decal] failed to load ${source}`, error);
    });
    configureTexture(texture);
    textureCache.set(key, texture);
    return texture;
  }

  function textureFor(record) {
    return isTankanTextDecal(record) ? tankanTextureFor(record) : imageTextureFor(record);
  }

  function hasVisualSource(record) {
    return isTankanTextDecal(record) ? !!String(record?.tankanText || '').trim() : !!resolvedImageSource(record);
  }

  function vector3(values) {
    return new THREE.Vector3(Number(values?.[0]) || 0, Number(values?.[1]) || 0, Number(values?.[2]) || 0);
  }

  function matchingSurface(data, record) {
    const surfaces = Array.isArray(data?.recognizedSurfaces) ? data.recognizedSurfaces : [];
    const direct = surfaces.find(surface => surface?.id === record?.surfaceId);
    if (direct) return direct;
    const priorFaces = new Set(Array.isArray(record?.surfaceFaces) ? record.surfaceFaces : []);
    let best = null;
    let bestScore = -Infinity;
    for (const surface of surfaces) {
      if (surface?.partId !== record?.surfacePartId) continue;
      let overlap = 0;
      for (const face of surface.faceIndices || []) if (priorFaces.has(face)) overlap++;
      const score = (surface.recognizedType === record?.surfaceType ? 1000 : 0) + overlap * 10;
      if (score > bestScore) { best = surface; bestScore = score; }
    }
    return best;
  }

  function resolvedTransform(record) {
    if (!isNormalizedTankan(record)) {
      return {
        offsetU: finiteOr(record?.offsetU, 0),
        offsetV: finiteOr(record?.offsetV, 0),
        width: Math.max(0.001, finiteOr(record?.width, 0.5)),
        height: Math.max(0.001, finiteOr(record?.height, 0.5)),
        rotationDeg: finiteOr(record?.rotationDeg, 0),
        normalOffset: Math.max(0.0002, finiteOr(record?.normalOffset, 0.003)),
        opacity: clamp(finiteOr(record?.opacity, 1), 0, 1),
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
      opacity: clamp(finiteOr(record.opacity, TANKAN_BASELINE.opacity), 0, 1),
      tankanLayout: container.layout,
      tankanFitScale: container.fitScale,
    };
  }

  function addDecal(group, data, record) {
    if (!record || record.visible === false || !hasVisualSource(record)) return null;
    const surface = matchingSurface(data, record);
    const partMesh = surface ? group?.userData?.meshById?.get?.(surface.partId) : null;
    if (!surface || !partMesh) return null;

    const bounds = surface.bounds || {};
    const spanU = Math.max(0.001, (Number(bounds.maxU) || 0) - (Number(bounds.minU) || 0));
    const spanV = Math.max(0.001, (Number(bounds.maxV) || 0) - (Number(bounds.minV) || 0));
    const basisU = vector3(surface.basisU).normalize();
    const basisV = vector3(surface.basisV).normalize();
    const normal = vector3(surface.localNormal).normalize();
    const centroid = vector3(surface.localCentroid);
    const centerU = ((Number(bounds.minU) || 0) + (Number(bounds.maxU) || 0)) / 2;
    const centerV = ((Number(bounds.minV) || 0) + (Number(bounds.maxV) || 0)) / 2;
    const center = basisU.clone().multiplyScalar(centerU)
      .addScaledVector(basisV, centerV)
      .addScaledVector(normal, centroid.dot(normal));
    const transform = resolvedTransform(record);

    const width = spanU * transform.width;
    const height = spanV * transform.height;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: textureFor(record),
      transparent: true,
      opacity: transform.opacity,
      alphaTest: 0.001,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = record.name || 'Furniture Decal';
    mesh.userData = {
      furnitureDecal: true,
      decalId: record.id || null,
      decalSourceType: isTankanTextDecal(record) ? TANKAN_SOURCE_TYPE : 'image',
      surfaceId: surface.id || null,
      authoredPartId: surface.partId || null,
      tankanLayout: transform.tankanLayout || null,
      tankanFitScale: transform.tankanFitScale ?? null,
    };
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.raycast = () => {};

    const halfU = spanU / 2;
    const halfV = spanV / 2;
    mesh.position.copy(center)
      .addScaledVector(basisU, transform.offsetU * halfU)
      .addScaledVector(basisV, transform.offsetV * halfV)
      .addScaledVector(normal, transform.normalOffset);
    const basis = new THREE.Matrix4().makeBasis(basisU, basisV, normal);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.rotateZ(transform.rotationDeg * DEG);
    partMesh.add(mesh);
    return mesh;
  }

  function addDecals(group, data) {
    const records = Array.isArray(data?.decals) ? data.decals : [];
    if (!records.length || !group?.userData?.meshById) return group;
    const meshes = [];
    for (const record of records) {
      const mesh = addDecal(group, data, record);
      if (mesh) meshes.push(mesh);
    }
    group.userData.authoredDecalMeshes = meshes;
    group.userData.authoredDecalCount = meshes.length;
    group.userData.authoredTankanDecalCount = meshes.filter(mesh => mesh.userData?.decalSourceType === TANKAN_SOURCE_TYPE).length;
    return group;
  }

  const originalBuildGroup = authored.buildGroup.__furnitureDecalRuntimeOriginal || authored.buildGroup.bind(authored);
  function buildGroup(data, baseColor) {
    return addDecals(originalBuildGroup(data, baseColor), data);
  }
  buildGroup.__furnitureDecalRuntimeWrapped = true;
  buildGroup.__furnitureDecalRuntimeOriginal = originalBuildGroup;
  authored.buildGroup = buildGroup;

  window.FurnitureDecalRuntime = {
    installed: true,
    settingsVersion: TANKAN_SETTINGS_VERSION,
    addDecals,
    resolvedImageSource,
    textureCache,
    ensureTankanLayout,
    isTankanTextDecal,
    tankanTextureOptions,
    tankanRenderOptions,
    resolvedTransform,
    tankanNaturalWidthFactor,
    tankanNaturalHeightFactor,
    tankanContainerPixels,
    tankanContainerState,
  };
})();
