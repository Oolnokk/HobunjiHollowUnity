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
  const SCRIPT_SRC = typeof document !== 'undefined' ? (document.currentScript?.src || '') : ''; // Used to resolve the shared Tankan layout helper when this runtime is loaded from a nested preview.
  const textureCache = new Map(); // Resolved decal source key -> shared THREE.Texture used by all furniture instances.
  let tankanLayoutPromise = null; // Shared async helper load so text decals can appear even when this runtime was loaded directly instead of by the furniture editor.

  function isTankanTextDecal(record) {
    return record?.sourceType === TANKAN_SOURCE_TYPE || (!!record?.tankanText && !record?.imageSource);
  }

  function resolvedImageSource(record) {
    const raw = String(record?.runtimeImageSource || record?.imageSource || record?.imageName || '').trim(); // Used as the browser texture URL after author-path normalization.
    if (!raw || /^(?:data|blob):/i.test(raw)) return raw;
    const docsAsset = raw.lastIndexOf('docs/assets/'); // Used to turn author-relative ../../../docs/assets/... paths into game-relative assets/....
    if (docsAsset >= 0) return raw.slice(docsAsset + 5);
    const cleaned = raw.replace(/^(?:\.\.\/)+/, '').replace(/^docs\//, ''); // Used for repository paths already near the docs root.
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
      const script = document.createElement('script'); // Used by text decals only; image decals remain completely independent of the Tankan helper.
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

  function tankanTextureKey(record) {
    return `tankan:${record?.tankanText || ''}\u0000${record?.tankanColumnSpacingEm ?? ''}\u0000${record?.tankanGlyphAdvanceEm ?? ''}\u0000${record?.tankanColor || ''}`;
  }

  function tankanTextureFor(record) {
    const key = tankanTextureKey(record);
    if (textureCache.has(key)) return textureCache.get(key);
    const canvas = document.createElement('canvas'); // Starts as one transparent pixel until the Tankan font/layout helper is ready.
    canvas.width = 1;
    canvas.height = 1;
    const texture = configureTexture(new THREE.CanvasTexture(canvas));
    textureCache.set(key, texture);
    ensureTankanLayout().then(layout => {
      if (!layout?.renderToCanvas) throw new Error('TankanScriptLayout unavailable');
      return Promise.resolve(layout.ensureFontLoaded?.()).then(() => layout);
    }).then(layout => {
      const rendered = layout.renderToCanvas(canvas, record.tankanText, {
        columnSpacingEm: record.tankanColumnSpacingEm,
        glyphAdvanceEm: record.tankanGlyphAdvanceEm,
        color: record.tankanColor || layout.defaults?.color || '#ffffff',
      });
      texture.userData = { ...(texture.userData || {}), tankanLayout: rendered || null };
      texture.needsUpdate = true;
    }).catch(error => {
      console.warn(`[furniture decal] failed to render Tankān text ${JSON.stringify(record?.tankanText || '')}`, error);
    });
    return texture;
  }

  function imageTextureFor(record) {
    const source = resolvedImageSource(record); // Used as the cache key and TextureLoader URL.
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
    const surfaces = Array.isArray(data?.recognizedSurfaces) ? data.recognizedSurfaces : []; // Used to recover the exact authored face frame for this decal.
    const direct = surfaces.find(surface => surface?.id === record?.surfaceId);
    if (direct) return direct;
    const priorFaces = new Set(Array.isArray(record?.surfaceFaces) ? record.surfaceFaces : []); // Used when surface ids were regenerated but face membership stayed stable.
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

  function addDecal(group, data, record) {
    if (!record || record.visible === false || !hasVisualSource(record)) return null;
    const surface = matchingSurface(data, record); // Used for surface-local size, position, normal, and orientation.
    const partMesh = surface ? group?.userData?.meshById?.get?.(surface.partId) : null; // Decal child follows this authored part's transforms and animations.
    if (!surface || !partMesh) return null;

    const bounds = surface.bounds || {}; // Used to convert author fractional decal dimensions into local world units.
    const spanU = Math.max(0.001, (Number(bounds.maxU) || 0) - (Number(bounds.minU) || 0));
    const spanV = Math.max(0.001, (Number(bounds.maxV) || 0) - (Number(bounds.minV) || 0));
    const basisU = vector3(surface.basisU).normalize(); // Used as the decal plane's horizontal axis.
    const basisV = vector3(surface.basisV).normalize(); // Used as the decal plane's vertical axis.
    const normal = vector3(surface.localNormal).normalize(); // Used to lift the decal just off the furniture face.
    const centroid = vector3(surface.localCentroid); // Used to recover the face plane offset from the part origin.
    const centerU = ((Number(bounds.minU) || 0) + (Number(bounds.maxU) || 0)) / 2;
    const centerV = ((Number(bounds.minV) || 0) + (Number(bounds.maxV) || 0)) / 2;
    const center = basisU.clone().multiplyScalar(centerU)
      .addScaledVector(basisV, centerV)
      .addScaledVector(normal, centroid.dot(normal)); // Same recognized-surface frame used by the authoring tool.

    const width = spanU * Math.max(0.001, Number(record.width) || 0.5); // Author width is a fraction of recognized face width.
    const height = spanV * Math.max(0.001, Number(record.height) || 0.5); // Author height is a fraction of recognized face height.
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: textureFor(record),
      transparent: true,
      opacity: Math.max(0, Math.min(1, Number(record.opacity ?? 1))),
      alphaTest: 0.001,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material); // Runtime decal visual attached directly to its authored part.
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

    const halfU = spanU / 2; // Used to interpret author offsetU in half-surface-span units.
    const halfV = spanV / 2; // Used to interpret author offsetV in half-surface-span units.
    mesh.position.copy(center)
      .addScaledVector(basisU, (Number(record.offsetU) || 0) * halfU)
      .addScaledVector(basisV, (Number(record.offsetV) || 0) * halfV)
      .addScaledVector(normal, Math.max(0.0002, Number(record.normalOffset) || 0.003));
    const basis = new THREE.Matrix4().makeBasis(basisU, basisV, normal); // Used to align the plane exactly to the recognized furniture surface.
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.rotateZ((Number(record.rotationDeg) || 0) * DEG);
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

  const originalBuildGroup = authored.buildGroup.__furnitureDecalRuntimeOriginal || authored.buildGroup.bind(authored); // Preserved so the wrapper remains composable with other authored-furniture runtimes.
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
  };
})();
