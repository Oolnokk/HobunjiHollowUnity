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
  const TANKAN_SETTINGS_VERSION = 2;
  // Matches the normalized furniture-author baseline. Glyph scale 1.2 means a
  // normalized glyph-size value of 1.0 is 20% larger than the old rendering.
  const TANKAN_BASELINE = Object.freeze({
    columnSpacingEm: -0.35,
    glyphAdvanceEm: 0.6,
    glyphScale: 1.2,
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

  const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function isTankanTextDecal(record) {
    return record?.sourceType === TANKAN_SOURCE_TYPE || (!!record?.tankanText && !record?.imageSource);
  }

  function isNormalizedTankan(record) {
    return isTankanTextDecal(record) && Number(record?.tankanSettingsVersion) >= TANKAN_SETTINGS_VERSION;
  }

  function resolvedImageSource(record) {
    const raw = String(record?.runtimeImageSource || record?.imageSource || record?.imageName || '').trim(); // Browser texture URL after author-path normalization.
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
      const script = document.createElement('script'); // Text-decals only; image decals remain independent.
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
        glyphScale: 1,
        color: String(record?.tankanColor || TANKAN_BASELINE.color),
      };
    }
    return {
      columnSpacingEm: clamp(TANKAN_BASELINE.columnSpacingEm + finiteOr(record.tankanColumnSpacing, 0), -0.95, 4),
      glyphAdvanceEm: clamp(TANKAN_BASELINE.glyphAdvanceEm * finiteOr(record.tankanGlyphAdvance, 1), 0.1, 4),
      glyphScale: clamp(TANKAN_BASELINE.glyphScale * finiteOr(record.tankanGlyphSize, 1), 0.25, 2.5),
      color: String(record.tankanColor || TANKAN_BASELINE.color),
    };
  }

  function tankanTextureKey(record) {
    const options = tankanTextureOptions(record);
    return `tankan:${record?.tankanText || ''}\u0000${options.columnSpacingEm}\u0000${options.glyphAdvanceEm}\u0000${options.glyphScale}\u0000${options.color}`;
  }

  function tankanTextureFor(record) {
    const key = tankanTextureKey(record);
    if (textureCache.has(key)) return textureCache.get(key);
    const canvas = document.createElement('canvas'); // One transparent pixel until the exact Tankan face is ready.
    canvas.width = 1;
    canvas.height = 1;
    const texture = configureTexture(new THREE.CanvasTexture(canvas));
    textureCache.set(key, texture);
    ensureTankanLayout().then(layout => {
      if (!layout?.renderToCanvas) throw new Error('TankanScriptLayout unavailable');
      return Promise.resolve(layout.ensureFontLoaded?.()).then(() => layout);
    }).then(layout => {
      const rendered = layout.renderToCanvas(canvas, record.tankanText, tankanTextureOptions(record));
      texture.userData = { ...(texture.userData || {}), tankanLayout: rendered || null };
      texture.needsUpdate = true;
    }).catch(error => {
      console.warn(`[furniture decal] failed to render Tankan text ${JSON.stringify(record?.tankanText || '')}`, error);
    });
    return texture;
  }

  function imageTextureFor(record) {
    const source = resolvedImageSource(record); // Cache key and TextureLoader URL.
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
    const surfaces = Array.isArray(data?.recognizedSurfaces) ? data.recognizedSurfaces : []; // Exact authored face frame for this decal.
    const direct = surfaces.find(surface => surface?.id === record?.surfaceId);
    if (direct) return direct;
    const priorFaces = new Set(Array.isArray(record?.surfaceFaces) ? record.surfaceFaces : []); // Recovers regenerated surface ids by face membership.
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
    return {
      offsetU: TANKAN_BASELINE.offsetU + finiteOr(record.offsetU, 0),
      offsetV: TANKAN_BASELINE.offsetV + finiteOr(record.offsetV, 0),
      width: TANKAN_BASELINE.width * Math.max(0.001, finiteOr(record.width, 1)),
      height: TANKAN_BASELINE.height * Math.max(0.001, finiteOr(record.height, 1)),
      rotationDeg: TANKAN_BASELINE.rotationDeg + finiteOr(record.rotationDeg, 0),
      normalOffset: Math.max(0.0002, TANKAN_BASELINE.normalOffset + finiteOr(record.normalOffset, 0)),
      opacity: clamp(finiteOr(record.opacity, TANKAN_BASELINE.opacity), 0, 1),
    };
  }

  function addDecal(group, data, record) {
    if (!record || record.visible === false || !hasVisualSource(record)) return null;
    const surface = matchingSurface(data, record); // Surface-local size, position, normal, and orientation.
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
    const transform = resolvedTransform(record); // Converts normalized Tankan controls to renderer-space values.

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
    const records = Array.isArray(data?.decals) ? data.decals : []; // Editable decal records exported by Furniture + Avatar Author.
    if (!records.length || !group?.userData?.meshById) return group;
    const meshes = []; // Stored on the group for diagnostics and later runtime extensions.
    for (const record of records) {
      const mesh = addDecal(group, data, record);
      if (mesh) meshes.push(mesh);
    }
    group.userData.authoredDecalMeshes = meshes;
    group.userData.authoredDecalCount = meshes.length;
    group.userData.authoredTankanDecalCount = meshes.filter(mesh => mesh.userData?.decalSourceType === TANKAN_SOURCE_TYPE).length;
    return group;
  }

  const originalBuildGroup = authored.buildGroup.__furnitureDecalRuntimeOriginal || authored.buildGroup.bind(authored); // Preserved so wrapper remains composable.
  function buildGroup(data, baseColor) {
    return addDecals(originalBuildGroup(data, baseColor), data);
  }
  buildGroup.__furnitureDecalRuntimeWrapped = true;
  buildGroup.__furnitureDecalRuntimeOriginal = originalBuildGroup;
  authored.buildGroup = buildGroup;

  window.FurnitureDecalRuntime = {
    installed: true,
    addDecals,
    resolvedImageSource,
    textureCache,
    ensureTankanLayout,
    isTankanTextDecal,
    tankanTextureOptions,
    resolvedTransform,
  };
})();
