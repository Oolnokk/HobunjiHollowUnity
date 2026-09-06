(() => {
  'use strict';

  // Harugasirri is a static, world-scale landmark behind the ordinary per-map
  // border terrain. The source is centered on X/Z origin and intentionally uses
  // the same origin on every outdoor map.
  const ASSET_URL = 'assets/terrain/harugasirri-superbackdrop.json';
  const GROUP_NAME = 'HarugasirriSuperBackdrop';
  const DEFAULT_WORLD_SCALE = 12;
  const FALLBACK_MATERIALS = Object.freeze({
    cliff: Object.freeze({ texture: 'assets/textures/carved_smooth.png', tileSize: 4, fillColor: '#6a6460' }),
    snow: Object.freeze({ texture: 'assets/textures/canvas.png', tileSize: 6, fillColor: '#ffffff' }),
    plateauGrass: Object.freeze({ texture: 'assets/textures/wavy_surface.png', tileSize: 8, fillColor: '#777052' }),
  });

  let borderDeps = null; // Captured from BorderTerrain.init(); used for the exact farm cliff resolver and outdoor scenes.
  let assetPromise = null; // Shared immutable asset load used by every map scene.
  let templatePromise = null; // Shared three-mesh template cloned into each outdoor scene.
  let attachedSceneCount = 0; // Used by the mobile-visible debug snapshot and cache audit.
  const sceneAttachPromises = new WeakMap(); // Prevents duplicate async backdrop builds for the same scene.
  const patchedApis = new WeakSet(); // Prevents wrapping one BorderTerrain API more than once.
  const stats = { assetStatus: 'idle', buildCount: 0, attachCount: 0, failureCount: 0, lastMapId: null, lastMessage: 'not built yet' }; // Used by getDebugState() and Debug-panel logs.

  function log(message, level = 'info', category = 'world') {
    stats.lastMessage = String(message);
    if (typeof window.__farmLog === 'function') window.__farmLog(`[Harugasirri] ${message}`, level, category);
    else if (level === 'warn' || level === 'error') console.warn(`[Harugasirri] ${message}`);
  }

  function loadAsset() {
    if (assetPromise) return assetPromise;
    stats.assetStatus = 'loading';
    assetPromise = fetch(ASSET_URL, { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status} loading ${ASSET_URL}`);
        return response.json();
      })
      .then(asset => {
        if (!asset?.grid?.x?.length || !asset?.grid?.z?.length || !asset?.grid?.heights?.length || !asset?.triangles) {
          throw new Error('terrain asset is missing grid or triangle data');
        }
        const expected = asset.grid.x.length * asset.grid.z.length;
        if (asset.grid.heights.length !== expected) {
          throw new Error(`height count ${asset.grid.heights.length} does not match ${expected} grid vertices`);
        }
        stats.assetStatus = 'ready';
        return asset;
      })
      .catch(error => {
        stats.assetStatus = 'failed';
        stats.failureCount++;
        log(`asset load failed: ${error?.message || error}`, 'error', 'assets');
        throw error;
      });
    return assetPromise;
  }

  function parseHexFallback(value, fallback = 0xffffff) {
    if (typeof value !== 'string') return fallback;
    const n = Number.parseInt(value.replace(/^#/, ''), 16);
    return Number.isFinite(n) ? n : fallback;
  }

  function shadeFilledTexture(THREE, definition) {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(definition.texture, sourceTexture => {
        let texture = sourceTexture;
        let shadeFilled = false;
        try {
          const rgb = window.parseHexColor?.(definition.fillColor);
          if (rgb && typeof window.getShadeFillCanvas === 'function' && typeof window.getPortraitTintingConfig === 'function') {
            const canvas = window.getShadeFillCanvas(sourceTexture.image, `${definition.texture}|${definition.fillColor}`, {
              mode: 'shadeFill',
              rgb: [rgb.r, rgb.g, rgb.b],
              options: window.getPortraitTintingConfig(),
            });
            texture = new THREE.CanvasTexture(canvas);
            shadeFilled = true;
          }
        } catch (error) {
          log(`shade-fill fallback for ${definition.texture}: ${error?.message || error}`, 'warn', 'assets');
        }
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1 / Math.max(0.001, Number(definition.tileSize) || 1), 1 / Math.max(0.001, Number(definition.tileSize) || 1));
        if ('encoding' in texture && THREE.sRGBEncoding != null) texture.encoding = THREE.sRGBEncoding;
        texture.needsUpdate = true;
        resolve({ texture, shadeFilled });
      }, undefined, reject);
    });
  }

  async function makeTintedMaterial(THREE, definition) {
    const loaded = await shadeFilledTexture(THREE, definition);
    const material = new THREE.MeshLambertMaterial({
      map: loaded.texture,
      color: loaded.shadeFilled ? 0xffffff : parseHexFallback(definition.fillColor),
      side: THREE.FrontSide,
      fog: false,
    });
    material.userData = {
      ...(material.userData || {}),
      harugasirriMaterial: true,
      textureSource: definition.texture,
      fillColor: definition.fillColor,
      uvTileSize: definition.tileSize,
    };
    return material;
  }

  function exactFarmCliffMaterial(THREE, definition) {
    try {
      const resolved = borderDeps?.resolveCliffMat?.('farm');
      if (resolved) {
        const material = resolved.clone(); // Keeps the farm cliff texture/tint while allowing this horizon layer to ignore near-ground fog.
        material.fog = false;
        material.userData = {
          ...(resolved.userData || {}),
          ...(material.userData || {}),
          harugasirriMaterial: true,
          textureSource: definition.texture,
          sourceMaterial: 'farm.cliff',
        };
        material.needsUpdate = true;
        return Promise.resolve(material);
      }
    } catch (error) {
      log(`farm cliff resolver fallback: ${error?.message || error}`, 'warn', 'assets');
    }
    return makeTintedMaterial(THREE, definition);
  }

  function localVertex(asset, index) {
    const width = asset.grid.x.length;
    const row = Math.floor(index / width);
    const col = index - row * width;
    return [Number(asset.grid.x[col]) || 0, Number(asset.grid.heights[index]) || 0, Number(asset.grid.z[row]) || 0];
  }

  function buildGeometry(THREE, asset, triangles, worldScale) {
    const positions = [];
    const uvs = [];
    for (const face of triangles || []) {
      for (const index of face) {
        const [x, y, z] = localVertex(asset, index);
        positions.push(x, y, z);
        // BorderTerrain materials already interpret UVs as world-space tiling.
        // Bake the final scale into UVs while leaving geometry compact for one
        // uniform Object3D scale.
        uvs.push(x * worldScale, z * worldScale);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  async function buildTemplate() {
    const asset = await loadAsset();
    const THREE = window.THREE;
    if (!THREE) throw new Error('THREE unavailable');
    const worldScale = Number(asset.runtime?.worldScale) || DEFAULT_WORLD_SCALE;
    const definitions = { ...FALLBACK_MATERIALS, ...(asset.materials || {}) };
    const [cliffMaterial, snowMaterial, plateauMaterial] = await Promise.all([
      exactFarmCliffMaterial(THREE, definitions.cliff),
      makeTintedMaterial(THREE, definitions.snow),
      makeTintedMaterial(THREE, definitions.plateauGrass),
    ]);
    const materials = { cliff: cliffMaterial, snow: snowMaterial, plateauGrass: plateauMaterial };
    const group = new THREE.Group();
    group.name = GROUP_NAME;
    group.scale.setScalar(worldScale);
    group.renderOrder = -20;
    group.userData = {
      backgroundScenery: true,
      harugasirriSuperBackdrop: true,
      sourceAsset: ASSET_URL,
      centerOrigin: [0, 0, 0],
      north: '-Z',
      west: '-X',
      worldScale,
      textureRoles: {
        cliff: definitions.cliff.texture,
        snow: definitions.snow.texture,
        plateauGrass: definitions.plateauGrass.texture,
      },
    };

    for (const role of ['cliff', 'snow', 'plateauGrass']) {
      const triangles = asset.triangles[role] || [];
      if (!triangles.length) continue;
      const mesh = new THREE.Mesh(buildGeometry(THREE, asset, triangles, worldScale), materials[role]);
      mesh.name = `${GROUP_NAME}_${role}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = -20;
      mesh.frustumCulled = true;
      mesh.userData = { backgroundScenery: true, harugasirriSuperBackdrop: true, materialRole: role };
      group.add(mesh);
    }
    stats.buildCount++;
    return group;
  }

  function getTemplate() {
    if (!templatePromise) {
      templatePromise = buildTemplate().catch(error => {
        templatePromise = null;
        stats.failureCount++;
        log(`template build failed: ${error?.message || error}`, 'error', 'assets');
        throw error;
      });
    }
    return templatePromise;
  }

  function findExisting(scene) {
    if (!scene) return null;
    if (typeof scene.getObjectByName === 'function') return scene.getObjectByName(GROUP_NAME);
    const collection = scene.children || scene.items || [];
    return collection.find?.(object => object?.name === GROUP_NAME) || null;
  }

  function attach(scene, mapId = 'unknown') {
    if (!scene) return Promise.resolve(null);
    const existing = findExisting(scene);
    if (existing) return Promise.resolve(existing);
    if (sceneAttachPromises.has(scene)) return sceneAttachPromises.get(scene);

    const promise = getTemplate().then(template => {
      const duplicate = findExisting(scene);
      if (duplicate) return duplicate;
      const group = template.clone(true);
      group.userData = { ...(template.userData || {}), mapId };
      scene.add?.(group);
      if (Array.isArray(scene.items) && !scene.items.includes(group)) scene.items.push(group);
      attachedSceneCount++;
      stats.attachCount++;
      stats.lastMapId = mapId;
      const assetCounts = group.children.map(child => `${child.userData.materialRole}:${child.geometry?.getAttribute?.('position')?.count / 3 || 0}`).join(', ');
      log(`attached ${mapId}; scale=${group.userData.worldScale}x; triangles ${assetCounts}`, 'info', 'world');
      return group;
    }).catch(error => {
      sceneAttachPromises.delete(scene);
      stats.failureCount++;
      log(`attach failed for ${mapId}: ${error?.message || error}`, 'error', 'assets');
      return null;
    });
    sceneAttachPromises.set(scene, promise);
    return promise;
  }

  function patchBorderTerrain(api) {
    if (!api || patchedApis.has(api) || api.__harugasirriSuperBackdropPatch) return api;

    const originalInit = api.init;
    if (typeof originalInit === 'function') {
      api.init = function (injectedDeps, ...rest) {
        borderDeps = injectedDeps; // Used by attach wrappers and the exact farm cliff material resolver.
        const result = originalInit.call(this, injectedDeps, ...rest);
        return result;
      };
    }

    const farmBuild = api.buildBorderTerrain;
    if (typeof farmBuild === 'function') {
      api.buildBorderTerrain = function (...args) {
        const result = farmBuild.apply(this, args);
        attach(borderDeps?.scene, 'farm');
        return result;
      };
    }

    const zoneBuild = api.buildZoneBorderTerrain;
    if (typeof zoneBuild === 'function') {
      api.buildZoneBorderTerrain = function (scene, zcols, zrows, mapId, ...rest) {
        const result = zoneBuild.call(this, scene, zcols, zrows, mapId, ...rest);
        attach(scene, mapId || 'wilderness');
        return result;
      };
    }

    const townBuild = api.buildTownBorderTerrain;
    if (typeof townBuild === 'function') {
      api.buildTownBorderTerrain = function (...args) {
        const result = townBuild.apply(this, args);
        attach(borderDeps?.getTownScene?.() || borderDeps?.townScene, 'map_hobunji_town');
        return result;
      };
    }

    patchedApis.add(api);
    api.__harugasirriSuperBackdropPatch = true;
    log('BorderTerrain integration armed; backdrop builds only when an outdoor scene is created.', 'info', 'world');
    return api;
  }

  function installBorderHook() {
    if (window.BorderTerrain) {
      patchBorderTerrain(window.BorderTerrain);
      return true;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'BorderTerrain');
    if (descriptor && !descriptor.configurable) return false;
    const previousGet = descriptor?.get; // Preserves a pending wrapper installed earlier by Cloud Forest runtime.
    const previousSet = descriptor?.set; // Called before our own patch so existing BorderTerrain adapters win first.
    let pending = descriptor && 'value' in descriptor ? descriptor.value : undefined; // Fallback storage when no earlier accessor exists.
    try {
      Object.defineProperty(window, 'BorderTerrain', {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          if (previousGet) {
            try {
              const priorValue = previousGet.call(window);
              if (priorValue !== undefined) return priorValue;
            } catch (_) {}
          }
          return pending;
        },
        set(value) {
          if (previousSet) {
            // Existing wrappers such as cloud-forest-runtime.js may replace
            // this accessor with a normal value property inside their setter.
            // Let them do that first, then wrap the final API object.
            previousSet.call(window, value);
            patchBorderTerrain(window.BorderTerrain || value);
            return;
          }
          pending = value;
          patchBorderTerrain(value);
          Object.defineProperty(window, 'BorderTerrain', {
            value,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        },
      });
      return true;
    } catch (error) {
      log(`could not install BorderTerrain hook: ${error?.message || error}`, 'warn', 'world');
      return false;
    }
  }

  function getDebugState() {
    return {
      assetUrl: ASSET_URL,
      groupName: GROUP_NAME,
      worldScale: DEFAULT_WORLD_SCALE,
      attachedSceneCount,
      borderDepsCaptured: !!borderDeps,
      borderPatched: !!window.BorderTerrain?.__harugasirriSuperBackdropPatch,
      ...stats,
    };
  }

  window.HarugasirriSuperBackdrop = Object.freeze({
    ASSET_URL,
    GROUP_NAME,
    attach,
    getDebugState,
    installBorderHook,
  });

  window.HobunjiCacheAudit?.register?.('Harugasirri backdrop scenes', () => attachedSceneCount);
  installBorderHook();
})();
