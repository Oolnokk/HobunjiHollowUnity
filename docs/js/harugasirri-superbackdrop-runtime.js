(() => {
  'use strict';

  const currentScriptUrl = document.currentScript?.src || location.href;
  const scriptBase = new URL('.', currentScriptUrl);
  const docsBase = new URL('../', scriptBase);
  const ASSET_URL = new URL('assets/terrain/harugasirri-superbackdrop.json', docsBase).href;
  const GROUP_NAME = 'HarugasirriSuperBackdrop';
  const IS_MAP_EDITOR = /\/tools\/map-editor(?:\/|\/index\.html)?$/.test(location.pathname);
  const FALLBACK_MATERIALS = Object.freeze({
    cliff: Object.freeze({ texture: 'assets/textures/carved_smooth.png', tileSize: 4, fillColor: '#6a6460' }),
    snow: Object.freeze({ texture: 'assets/textures/canvas.png', tileSize: 6, fillColor: '#ffffff' }),
    plateauGrass: Object.freeze({ texture: 'assets/textures/wavy_surface.png', tileSize: 8, fillColor: '#777052' }),
  });

  let borderDeps = null;
  let assetPromise = null;
  let templatePromise = null;
  let attachedSceneCount = 0;
  const sceneAttachPromises = new WeakMap();
  const patchedApis = new WeakSet();
  const attachedGroups = new Set();
  const stats = { assetStatus: 'idle', buildCount: 0, attachCount: 0, failureCount: 0, lastMapId: null, lastMessage: 'not built yet' };

  function log(message, level = 'info', category = 'world') {
    stats.lastMessage = String(message);
    if (typeof window.__farmLog === 'function') window.__farmLog(`[Harugasirri] ${message}`, level, category);
    else if (level === 'warn' || level === 'error') console.warn(`[Harugasirri] ${message}`);
  }

  function resolveDocsPath(path) {
    if (!path) return '';
    try { return new URL(path, docsBase).href; } catch (_) { return path; }
  }

  function transformApi() { return window.HarugasirriTransform || null; }

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
        if (asset.grid.heights.length !== expected) throw new Error(`height count ${asset.grid.heights.length} does not match ${expected} grid vertices`);
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
    const textureUrl = resolveDocsPath(definition.texture);
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(textureUrl, sourceTexture => {
        let texture = sourceTexture;
        let shadeFilled = false;
        try {
          const rgb = window.parseHexColor?.(definition.fillColor);
          if (rgb && typeof window.getShadeFillCanvas === 'function' && typeof window.getPortraitTintingConfig === 'function') {
            const canvas = window.getShadeFillCanvas(sourceTexture.image, `${textureUrl}|${definition.fillColor}`, {
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
        const material = resolved.clone();
        material.fog = false;
        material.userData = { ...(resolved.userData || {}), ...(material.userData || {}), harugasirriMaterial: true, textureSource: definition.texture, sourceMaterial: 'farm.cliff' };
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

  function buildGeometry(THREE, asset, triangles, uvScale) {
    const positions = [];
    const uvs = [];
    for (const face of triangles || []) {
      for (const index of face) {
        const [x, y, z] = localVertex(asset, index);
        positions.push(x, y, z);
        uvs.push(x * uvScale, z * uvScale);
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

  function effectiveState(asset) {
    const api = transformApi();
    if (api?.load) return api.load(asset);
    const scale = Number(asset.runtime?.worldScale) || 12;
    const min = asset.origin?.bounds?.min || [-11, 0, -11];
    const max = asset.origin?.bounds?.max || [11, 9.921569, 11];
    return {
      width: (max[0] - min[0]) * scale,
      height: (max[1] - min[1]) * scale,
      depth: (max[2] - min[2]) * scale,
      x: 0, y: 0, z: 0, rotationY: 0, visibilityTest: false,
    };
  }

  function applyDebugVisuals(group, enabled) {
    for (const child of group?.children || []) {
      const material = child.material;
      if (!material) continue;
      if (!child.userData.harugasirriNormalMaterial) {
        child.userData.harugasirriNormalMaterial = material;
        child.material = material.clone();
      }
      const mat = child.material;
      if (enabled) {
        mat.map = null;
        mat.color?.setHex?.(0xff00ff);
        mat.emissive?.setHex?.(0x660066);
        mat.wireframe = true;
        mat.depthTest = false;
        mat.transparent = true;
        mat.opacity = 0.95;
        child.frustumCulled = false;
        child.renderOrder = 100000;
      } else {
        const normal = child.userData.harugasirriNormalMaterial;
        mat.map = normal.map || null;
        mat.color?.copy?.(normal.color);
        if (mat.emissive && normal.emissive) mat.emissive.copy(normal.emissive);
        mat.wireframe = !!normal.wireframe;
        mat.depthTest = normal.depthTest !== false;
        mat.transparent = !!normal.transparent;
        mat.opacity = normal.opacity ?? 1;
        child.frustumCulled = true;
        child.renderOrder = -20;
      }
      mat.needsUpdate = true;
    }
  }

  function applyState(group, asset, state) {
    const api = transformApi();
    const next = state || effectiveState(asset);
    if (api?.apply) api.apply(group, asset, next);
    else {
      const min = asset.origin?.bounds?.min || [-11, 0, -11];
      const max = asset.origin?.bounds?.max || [11, 9.921569, 11];
      group.scale.set(next.width / (max[0] - min[0]), next.height / (max[1] - min[1]), next.depth / (max[2] - min[2]));
      group.position.set(next.x, next.y, next.z);
      group.rotation.y = next.rotationY * Math.PI / 180;
    }
    applyDebugVisuals(group, !!next.visibilityTest);
    group.userData.harugasirriTransform = { ...next };
    return next;
  }

  async function buildTemplate() {
    const asset = await loadAsset();
    const THREE = window.THREE;
    if (!THREE) throw new Error('THREE unavailable');
    const uvScale = Number(asset.runtime?.worldScale) || 12;
    const definitions = { ...FALLBACK_MATERIALS, ...(asset.materials || {}) };
    const [cliffMaterial, snowMaterial, plateauMaterial] = await Promise.all([
      exactFarmCliffMaterial(THREE, definitions.cliff),
      makeTintedMaterial(THREE, definitions.snow),
      makeTintedMaterial(THREE, definitions.plateauGrass),
    ]);
    const materials = { cliff: cliffMaterial, snow: snowMaterial, plateauGrass: plateauMaterial };
    const group = new THREE.Group();
    group.name = GROUP_NAME;
    group.renderOrder = -20;
    group.userData = {
      backgroundScenery: true,
      harugasirriSuperBackdrop: true,
      sourceAsset: ASSET_URL,
      centerOrigin: [0, 0, 0],
      north: '-Z',
      west: '-X',
      textureRoles: { cliff: definitions.cliff.texture, snow: definitions.snow.texture, plateauGrass: definitions.plateauGrass.texture },
    };
    for (const role of ['cliff', 'snow', 'plateauGrass']) {
      const triangles = asset.triangles[role] || [];
      if (!triangles.length) continue;
      const mesh = new THREE.Mesh(buildGeometry(THREE, asset, triangles, uvScale), materials[role]);
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
    return scene.getObjectByName?.(GROUP_NAME) || (scene.children || []).find?.(object => object?.name === GROUP_NAME) || null;
  }

  function attach(scene, mapId = 'unknown') {
    if (!scene) return Promise.resolve(null);
    const existing = findExisting(scene);
    if (existing) {
      attachedGroups.add(existing);
      return loadAsset().then(asset => { applyState(existing, asset); return existing; });
    }
    if (sceneAttachPromises.has(scene)) return sceneAttachPromises.get(scene);
    const promise = Promise.all([getTemplate(), loadAsset()]).then(([template, asset]) => {
      const duplicate = findExisting(scene);
      if (duplicate) return duplicate;
      const group = template.clone(true);
      group.userData = { ...(template.userData || {}), mapId };
      applyState(group, asset);
      scene.add?.(group);
      if (Array.isArray(scene.items) && !scene.items.includes(group)) scene.items.push(group);
      attachedGroups.add(group);
      attachedSceneCount++;
      stats.attachCount++;
      stats.lastMapId = mapId;
      const assetCounts = group.children.map(child => `${child.userData.materialRole}:${child.geometry?.getAttribute?.('position')?.count / 3 || 0}`).join(', ');
      const t = group.userData.harugasirriTransform;
      log(`attached ${mapId}; dimensions=${t.width.toFixed(1)}×${t.height.toFixed(1)}×${t.depth.toFixed(1)}; triangles ${assetCounts}`, 'info', 'world');
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
        borderDeps = injectedDeps;
        return originalInit.call(this, injectedDeps, ...rest);
      };
    }
    const farmBuild = api.buildBorderTerrain;
    if (typeof farmBuild === 'function') {
      api.buildBorderTerrain = function (...args) {
        const result = farmBuild.apply(this, args);
        attach(borderDeps?.scene || window.GridTileAccessors?.getActiveScene?.(), 'farm');
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
        attach(borderDeps?.getTownScene?.() || borderDeps?.townScene || window.GridTileAccessors?.getActiveScene?.(), 'map_hobunji_town');
        return result;
      };
    }
    patchedApis.add(api);
    api.__harugasirriSuperBackdropPatch = true;
    log('BorderTerrain integration armed; backdrop builds only when an outdoor scene is created.', 'info', 'world');
    return api;
  }

  function installBorderHook() {
    if (IS_MAP_EDITOR) return false;
    if (window.BorderTerrain) {
      patchBorderTerrain(window.BorderTerrain);
      return true;
    }
    return false;
  }

  async function reapplyAll(state = null) {
    const asset = await loadAsset();
    for (const group of [...attachedGroups]) {
      if (!group?.parent) { attachedGroups.delete(group); continue; }
      applyState(group, asset, state || effectiveState(asset));
    }
  }

  window.addEventListener(transformApi()?.EVENT_NAME || 'harugasirri-transform-changed', event => {
    reapplyAll(event?.detail?.state || null).catch(error => log(`transform refresh failed: ${error?.message || error}`, 'warn'));
  });

  function getDebugState() {
    return {
      assetUrl: ASSET_URL,
      groupName: GROUP_NAME,
      editorMode: IS_MAP_EDITOR,
      attachedSceneCount,
      attachedGroupCount: attachedGroups.size,
      borderDepsCaptured: !!borderDeps,
      borderPatched: !!window.BorderTerrain?.__harugasirriSuperBackdropPatch,
      transform: [...attachedGroups][0]?.userData?.harugasirriTransform || null,
      ...stats,
    };
  }

  window.HarugasirriSuperBackdrop = Object.freeze({ ASSET_URL, GROUP_NAME, attach, getDebugState, installBorderHook, reapplyAll, loadAsset });
  window.HobunjiCacheAudit?.register?.('Harugasirri backdrop scenes', () => attachedSceneCount);
  if (!IS_MAP_EDITOR) installBorderHook();
})();
