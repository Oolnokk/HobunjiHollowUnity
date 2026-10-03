(() => {
  'use strict';

  const WESTERN_SLOPE_ID = 'map_western_slope'; // Used to keep the mountain stack exclusive to the Western Slope wilderness.
  const GROUP_NAME = 'WesternSlopeMountainBackdrops'; // Used for duplicate detection and mobile/debug inspection in the live scene.
  const ASSET_URLS = Object.freeze([
    'assets/backdrops/bd_mountains_1.png',
    'assets/backdrops/bd_mountains_2.png',
    'assets/backdrops/bd_mountains_3.png',
  ]); // Used in near-to-far order when building the three authored mountain layers.
  const MIN_WIDTH_MULTIPLIER = 2.75; // Used to guarantee every authored layer is substantially wider than the wilderness footprint.
  const MIN_HEIGHT_MULTIPLIER = 1.6; // Used to guarantee every authored layer is substantially taller than the wilderness footprint.
  const WEST_EDGE_OFFSET_MULTIPLIER = 0.12; // Used to place layer 1 just beyond the generated west border instead of inside playable terrain.
  const WEST_LAYER_GAP_MULTIPLIER = 0.85; // Used to put layers 2 and 3 far behind one another while remaining inside normal outdoor camera range.
  const MIN_WEST_EDGE_OFFSET = 24; // Used for small/test zones so layer 1 still clears the ordinary 18-tile border terrain.
  const BASE_Y = 0; // Used as the shared ground baseline; each image plane is raised by half its own scaled height.
  const patchedBorderApis = new WeakSet(); // Used to prevent wrapping one BorderTerrain API more than once.
  const patchedChunkApis = new WeakSet(); // Used to prevent wrapping one WildernessChunks API more than once.
  const activeByMap = new Map(); // Used to dispose/reuse one backdrop stack per wilderness map lifecycle.
  const stats = {
    borderHookInstalls: 0,
    chunkHookInstalls: 0,
    buildRequests: 0,
    completedBuilds: 0,
    disposedBuilds: 0,
    failedTextures: 0,
    failedBuilds: 0,
    lastError: null,
    lastLayout: null,
  }; // Exposed through getDebugState() so the feature can be checked on mobile without DevTools.

  function log(message, level = 'info') {
    const text = `[western-slope-backdrops] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'world');
    else if (level === 'warn' || level === 'error') console.warn(text);
    else console.debug?.(text);
  }

  function imageSize(texture) {
    const image = texture?.image || {};
    const width = Math.max(1, Number(image.naturalWidth || image.videoWidth || image.width) || 1); // Used to preserve each PNG's authored aspect ratio at the shared pixel scale.
    const height = Math.max(1, Number(image.naturalHeight || image.videoHeight || image.height) || 1); // Used with width when sizing every backdrop plane.
    return { width, height };
  }

  function disposeMaterial(material) {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) entry?.dispose?.();
  }

  function disposeRecord(record) {
    if (!record || record.disposed) return false;
    record.disposed = true;
    record.cancelled = true;
    if (record.root?.parent) record.root.parent.remove(record.root);
    if (Array.isArray(record.scene?.items)) {
      const itemIndex = record.scene.items.indexOf(record.root); // Used to keep scene-like fallback registries in sync with the real THREE parent.
      if (itemIndex >= 0) record.scene.items.splice(itemIndex, 1);
    }
    for (const mesh of record.meshes || []) {
      mesh.geometry?.dispose?.();
      disposeMaterial(mesh.material);
    }
    for (const texture of record.textures || []) texture?.dispose?.();
    if (activeByMap.get(record.mapId) === record) activeByMap.delete(record.mapId);
    stats.disposedBuilds++;
    return true;
  }

  function detachMap(mapId = WESTERN_SLOPE_ID) {
    return disposeRecord(activeByMap.get(mapId));
  }

  function loadTexture(url, record) {
    return new Promise((resolve, reject) => {
      const THREE = window.THREE;
      if (!THREE?.TextureLoader) {
        reject(new Error('THREE.TextureLoader unavailable'));
        return;
      }
      new THREE.TextureLoader().load(url, texture => {
        texture.userData = Object.assign({}, texture.userData, { westernSlopeMountainBackdropAsset: url });
        texture.needsUpdate = true;
        if (record?.cancelled) {
          texture.dispose?.();
          resolve(texture);
          return;
        }
        record?.textures?.push(texture);
        resolve(texture);
      }, undefined, error => {
        stats.failedTextures++;
        reject(error || new Error(`failed to load ${url}`));
      });
    });
  }

  function sharedWorldUnitsPerPixel(textures, zoneSpan) {
    const minWorldWidth = zoneSpan * MIN_WIDTH_MULTIPLIER; // Used to make even the narrowest image exceed the wilderness width.
    const minWorldHeight = zoneSpan * MIN_HEIGHT_MULTIPLIER; // Used to make even the shortest image exceed the wilderness height.
    let unitsPerPixel = 0;
    for (const texture of textures) {
      const size = imageSize(texture);
      unitsPerPixel = Math.max(unitsPerPixel, minWorldWidth / size.width, minWorldHeight / size.height);
    }
    return Math.max(unitsPerPixel, 0.001);
  }

  function buildLayout(textures, zcols, zrows) {
    const zoneSpan = Math.max(1, Number(zcols) || 0, Number(zrows) || 0); // Used as the single scale reference so all three layers retain one authored pixel scale.
    const unitsPerPixel = sharedWorldUnitsPerPixel(textures, zoneSpan); // Used by every layer; this is the key same-scale invariant.
    const westEdgeOffset = Math.max(MIN_WEST_EDGE_OFFSET, zoneSpan * WEST_EDGE_OFFSET_MULTIPLIER); // Used for the near mountain layer's world X.
    const layerGap = zoneSpan * WEST_LAYER_GAP_MULTIPLIER; // Used for the equal deep-space separation of layers 2 and 3.
    const zCenter = Math.max(0, Number(zrows) || 0) * 0.5; // Used to center each huge plane along the north/south span of the map.
    return textures.map((texture, index) => {
      const size = imageSize(texture); // Used to preserve each PNG's own aspect ratio at the common source-pixel scale.
      const width = size.width * unitsPerPixel; // Plane local X before its 90-degree yaw, becoming world north/south width.
      const height = size.height * unitsPerPixel; // Plane local Y and final world height.
      return {
        index,
        asset: ASSET_URLS[index],
        sourceWidth: size.width,
        sourceHeight: size.height,
        unitsPerPixel,
        width,
        height,
        x: -westEdgeOffset - layerGap * index,
        y: BASE_Y + height * 0.5,
        z: zCenter,
      };
    });
  }

  function makeMaterial(texture) {
    const THREE = window.THREE;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.01,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
      fog: false,
    });
    if ('toneMapped' in material) material.toneMapped = false;
    material.userData = Object.assign({}, material.userData, { westernSlopeMountainBackdrop: true });
    return material;
  }

  function attach(scene, zcols, zrows, mapId = WESTERN_SLOPE_ID) {
    if (mapId !== WESTERN_SLOPE_ID || !scene) return Promise.resolve(null);
    const existing = scene.getObjectByName?.(GROUP_NAME) || (scene.children || []).find(child => child?.name === GROUP_NAME);
    if (existing) return Promise.resolve(existing);

    const previous = activeByMap.get(mapId);
    if (previous?.scene === scene && !previous.cancelled) return previous.promise || Promise.resolve(previous.root || null);
    if (previous) disposeRecord(previous);

    const record = {
      mapId,
      scene,
      root: null,
      meshes: [],
      textures: [],
      cancelled: false,
      disposed: false,
      promise: null,
    }; // Holds async load state so a destroyed/rebuilt wilderness scene cannot receive a stale backdrop later.
    activeByMap.set(mapId, record);
    stats.buildRequests++;

    record.promise = Promise.all(ASSET_URLS.map(url => loadTexture(url, record))).then(textures => {
      if (record.cancelled || activeByMap.get(mapId) !== record) {
        for (const texture of textures) texture?.dispose?.();
        return null;
      }

      const THREE = window.THREE;
      if (!THREE?.Group || !THREE?.PlaneGeometry || !THREE?.Mesh || !THREE?.MeshBasicMaterial) {
        throw new Error('required THREE backdrop classes unavailable');
      }
      const layout = buildLayout(textures, zcols, zrows);
      const root = new THREE.Group();
      root.name = GROUP_NAME;
      root.userData = Object.assign({}, root.userData, {
        backgroundScenery: true,
        skipOcclusionFade: true,
        westernSlopeMountainBackdrops: true,
        mapId,
        sharedWorldUnitsPerPixel: layout[0]?.unitsPerPixel || 0,
      });

      for (const layer of layout) {
        const geometry = new THREE.PlaneGeometry(layer.width, layer.height);
        const material = makeMaterial(textures[layer.index]);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${GROUP_NAME}_Layer${layer.index + 1}`;
        mesh.position.set(layer.x, layer.y, layer.z);
        mesh.rotation.y = Math.PI * 0.5;
        mesh.renderOrder = -101 - layer.index;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.userData = Object.assign({}, mesh.userData, {
          backgroundScenery: true,
          skipOcclusionFade: true,
          westernSlopeMountainBackdrop: true,
          layer: layer.index + 1,
          sourceAsset: layer.asset,
          sourcePixelScale: layer.unitsPerPixel,
          worldWidth: layer.width,
          worldHeight: layer.height,
        });
        root.add(mesh);
        record.meshes.push(mesh);
      }

      record.root = root;
      scene.add(root);
      if (Array.isArray(scene.items) && !scene.items.includes(root)) scene.items.push(root);
      stats.completedBuilds++;
      stats.lastLayout = layout.map(layer => ({
        layer: layer.index + 1,
        asset: layer.asset,
        x: layer.x,
        y: layer.y,
        z: layer.z,
        width: layer.width,
        height: layer.height,
        unitsPerPixel: layer.unitsPerPixel,
      }));
      log(`attached 3 mountain layers to ${mapId}; west X=${layout.map(layer => layer.x.toFixed(1)).join(', ')}; shared scale=${(layout[0]?.unitsPerPixel || 0).toFixed(4)} world units/pixel`);
      return root;
    }).catch(error => {
      stats.lastError = error?.message || String(error);
      stats.failedBuilds++;
      log(`build failed: ${stats.lastError}`, 'warn');
      disposeRecord(record);
      return null;
    });

    return record.promise;
  }

  function patchBorderTerrain(api) {
    if (!api || patchedBorderApis.has(api) || typeof api.buildZoneBorderTerrain !== 'function') return api;
    const originalBuild = api.buildZoneBorderTerrain; // Called before adding the backdrop so ordinary border terrain remains the near scenery layer.
    api.buildZoneBorderTerrain = function (scene, zcols, zrows, mapId, ...rest) {
      const result = originalBuild.call(this, scene, zcols, zrows, mapId, ...rest);
      if (mapId === WESTERN_SLOPE_ID) attach(scene, zcols, zrows, mapId);
      return result;
    };
    patchedBorderApis.add(api);
    stats.borderHookInstalls++;
    return api;
  }

  function patchWildernessChunks(api) {
    if (!api || patchedChunkApis.has(api) || typeof api.destroyZone !== 'function') return api;
    const originalDestroyZone = api.destroyZone; // Called after disposing backdrop GPU resources for the scene being retired.
    api.destroyZone = function (mapId, ...rest) {
      if (mapId === WESTERN_SLOPE_ID) detachMap(mapId);
      return originalDestroyZone.call(this, mapId, ...rest);
    };
    patchedChunkApis.add(api);
    stats.chunkHookInstalls++;
    return api;
  }

  function installDeferredHook(propertyName, patcher) {
    const descriptor = Object.getOwnPropertyDescriptor(window, propertyName); // Used to safely chain any already-installed deferred world-system hook.
    if (descriptor?.get && descriptor?.set) {
      const previousGet = descriptor.get; // Used to retrieve the API after the prior wrapper processes an assignment.
      const previousSet = descriptor.set; // Used first so existing wrappers stay inside this feature's wrapper.
      Object.defineProperty(window, propertyName, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return previousGet.call(window); },
        set(value) {
          previousSet.call(window, value);
          patcher(previousGet.call(window));
        },
      });
      patcher(previousGet.call(window));
      return;
    }

    const existing = window[propertyName];
    if (existing) {
      patcher(existing);
      return;
    }

    let pending = null; // Stores a future API assignment when the module loads before that world system.
    Object.defineProperty(window, propertyName, {
      configurable: true,
      enumerable: true,
      get() { return pending; },
      set(value) { pending = patcher(value); },
    });
  }

  function getDebugState() {
    const active = activeByMap.get(WESTERN_SLOPE_ID);
    return {
      installed: true,
      mapId: WESTERN_SLOPE_ID,
      groupName: GROUP_NAME,
      assetUrls: [...ASSET_URLS],
      active: !!active && !active.cancelled,
      attached: !!active?.root?.parent,
      loading: !!active && !active.root && !active.cancelled,
      sceneChildren: active?.scene?.children?.length ?? null,
      ...stats,
      lastLayout: stats.lastLayout ? stats.lastLayout.map(layer => ({ ...layer })) : null,
    };
  }

  window.WesternSlopeMountainBackdrops = Object.freeze({
    installed: true,
    attach,
    detach: detachMap,
    getDebugState,
    constants: Object.freeze({
      WESTERN_SLOPE_ID,
      GROUP_NAME,
      MIN_WIDTH_MULTIPLIER,
      MIN_HEIGHT_MULTIPLIER,
      WEST_EDGE_OFFSET_MULTIPLIER,
      WEST_LAYER_GAP_MULTIPLIER,
    }),
  });
  window.__westernSlopeMountainBackdropsDebug = getDebugState;

  installDeferredHook('BorderTerrain', patchBorderTerrain);
  installDeferredHook('WildernessChunks', patchWildernessChunks);
})();
