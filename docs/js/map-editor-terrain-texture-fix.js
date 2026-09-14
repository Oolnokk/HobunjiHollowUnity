(() => {
  'use strict';

  if (!/\/tools\/map-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.__hobunjiMapEditorTerrainTextureFix) return;
  window.__hobunjiMapEditorTerrainTextureFix = true;

  const SELF_SRC = document.currentScript?.src || new URL('../js/map-editor-terrain-texture-fix.js', location.href).href; // Used to resolve repo assets from both standalone and Tool Hub iframe URLs.
  const JS_ROOT = new URL('./', SELF_SRC); // Canonical docs/js/ base for config and terrain texture paths.
  const liveRenderers = new Set(); // Renderers that have drawn the Map Editor preview at least once.
  const pendingMaterials = new WeakSet(); // Prevents duplicate async PNG requests for one cached preview material.
  const hydratedMaterials = new WeakSet(); // Tracks materials already repaired by this basic texture path.
  const rawTexturePromises = new Map(); // Shares one network load for each terrain PNG across cached preview materials.
  const COLOR_TO_TERRAIN_KEY = new Map([
    ['2f711e','grass'], ['247c3c','weeds'], ['8a5b34','tilled'], ['3a2510','trench'],
    ['c39a55','raised'], ['6aa263','paddy'], ['79807c','rock'], ['356e36','shrub'],
    ['b8956a','path'], ['3a4a3f','river'], ['6b5a3a','stream'], ['6a6460','cliff'],
  ]); // Matches the Map Editor's own fallback terrain palette before a PNG map is attached.
  let terrainConfig = null; // Same terrain-materials.json object consumed by the editor/game.
  let terrainConfigPromise = null; // Serializes the initial config fetch.
  let redrawFrame = 0; // Coalesces async texture completions into one redraw.
  let matchedMaterials = 0; // Exposed for mobile/manual diagnostics.
  let hydratedCount = 0; // Exposed for mobile/manual diagnostics.
  let failedCount = 0; // Exposed for mobile/manual diagnostics.

  function queueRedraw() {
    if (redrawFrame) return;
    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = 0;
      for (const renderer of Array.from(liveRenderers)) {
        const last = renderer?.__hobunjiMapEditorLastRender; // Last exact scene/camera pair requested by the editor.
        if (!renderer?.domElement?.isConnected || !last?.scene || !last?.camera) {
          liveRenderers.delete(renderer);
          continue;
        }
        try { renderer.render(last.scene, last.camera); } catch (_) {}
      }
    });
  }

  function activeMap() {
    try {
      const ws = window._mapEditorBridge?.getWorkspace?.();
      if (!ws) return null;
      return ws.maps?.find(map => map.id === ws.activeId) || ws.maps?.[0] || null;
    } catch (_) { return null; }
  }

  function terrainConfigUrl() {
    return new URL('../config/maps/terrain-materials.json', JS_ROOT).href;
  }

  function canonicalTerrainTextureUrl(path) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^(?:data:|blob:)/i.test(raw)) return raw;
    if (/^https?:/i.test(raw)) return raw;
    const clean = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^docs\//, '');
    const marker = 'assets/textures/';
    const markerIndex = clean.toLowerCase().indexOf(marker);
    if (markerIndex >= 0) return new URL('../' + clean.slice(markerIndex), JS_ROOT).href;
    const file = clean.split('/').filter(Boolean).pop() || clean;
    return new URL('../assets/textures/' + file, JS_ROOT).href;
  }

  function loadTerrainConfig() {
    if (terrainConfig) return Promise.resolve(terrainConfig);
    if (terrainConfigPromise) return terrainConfigPromise;
    terrainConfigPromise = fetch(terrainConfigUrl(), { cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(config => {
        terrainConfig = config?.byMap ? config : { byMap: {} };
        queueRedraw();
        return terrainConfig;
      })
      .catch(error => {
        console.warn('[map-editor-terrain-texture-fix] terrain-materials.json failed:', error);
        terrainConfig = { byMap: {} };
        return terrainConfig;
      });
    return terrainConfigPromise;
  }

  function mapOverride(mapId, key) {
    const byMap = terrainConfig?.byMap || {};
    return byMap?.[mapId]?.[key] || byMap?.['*']?.[key] || null;
  }

  function inferTerrainKey(material) {
    const explicit = String(material?.userData?.terrainKey || '').toLowerCase();
    if (explicit) return explicit;
    const name = String(material?.name || '').toLowerCase();
    for (const key of ['grass','weeds','tilled','trench','raised','paddy','rock','shrub','path','river','stream','waterfall','cliff']) {
      if (name.includes(key)) return key;
    }
    if (material?.color?.isColor) return COLOR_TO_TERRAIN_KEY.get(material.color.getHexString().toLowerCase()) || '';
    return '';
  }

  function baseTexture(path) {
    const url = canonicalTerrainTextureUrl(path);
    if (!url) return Promise.resolve(null);
    if (rawTexturePromises.has(url)) return rawTexturePromises.get(url);
    const promise = new Promise(resolve => {
      const THREE = window.THREE;
      new THREE.TextureLoader().load(url, texture => resolve(texture), undefined, error => {
        console.warn('[map-editor-terrain-texture-fix] PNG load failed:', url, error || 'unknown error');
        resolve(null);
      });
    });
    rawTexturePromises.set(url, promise);
    return promise;
  }

  function applyTextureTransform(texture, override) {
    const THREE = window.THREE;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.offset?.set?.(0, 0);
    texture.rotation = 0;
    texture.center?.set?.(0, 0);
    if (Array.isArray(override?.stretch) && override.stretch.length === 2) {
      texture.repeat.set(1 / Math.max(0.05, Number(override.stretch[0]) || 1), 1 / Math.max(0.05, Number(override.stretch[1]) || 1));
    } else {
      const tileSize = Math.max(0.05, Number(override?.tileSize) || 1);
      texture.repeat.set(1 / tileSize, 1 / tileSize);
    }
    texture.needsUpdate = true;
  }

  function makePreviewTexture(source, override) {
    const THREE = window.THREE;
    let output = source.clone(); // Each material gets independent repeat/offset state even when it shares the decoded PNG.
    const rgb = override?.fillColor && window.parseHexColor?.(override.fillColor);
    if (rgb && source?.image && typeof window.getShadeFillCanvas === 'function') {
      try {
        const canvas = window.getShadeFillCanvas(source.image, `${source.image?.src || override.texture}|${override.fillColor}`, {
          mode: 'shadeFill',
          rgb: [rgb.r, rgb.g, rgb.b],
          options: window.getPortraitTintingConfig?.(),
        });
        output = new THREE.CanvasTexture(canvas);
      } catch (error) {
        console.warn('[map-editor-terrain-texture-fix] shade-fill failed; using raw PNG:', error);
      }
    }
    if ('encoding' in source) output.encoding = source.encoding;
    applyTextureTransform(output, override);
    return output;
  }

  function hydrateMaterial(material, mapId) {
    if (!material || hydratedMaterials.has(material) || pendingMaterials.has(material)) return;
    if (material.map && !material.map?.userData?.hobunjiTerrainFallbackPlaceholder) {
      hydratedMaterials.add(material);
      return;
    }
    const key = inferTerrainKey(material);
    if (!key) return;
    const override = mapOverride(mapId, key);
    if (!override?.texture) return;

    material.userData = Object.assign({}, material.userData, { terrainKey: key });
    pendingMaterials.add(material);
    matchedMaterials++;
    baseTexture(override.texture).then(source => {
      pendingMaterials.delete(material);
      if (!source) { failedCount++; queueRedraw(); return; }
      try {
        const texture = makePreviewTexture(source, override);
        material.map = texture;
        material.color?.set?.(0xffffff);
        material.needsUpdate = true;
        hydratedMaterials.add(material);
        hydratedCount++;
      } catch (error) {
        failedCount++;
        console.warn(`[map-editor-terrain-texture-fix] failed to hydrate ${key}:`, error);
      }
      queueRedraw();
    });
  }

  function hydrateScene(scene) {
    if (!scene?.traverse) return;
    const map = activeMap();
    if (!map?.id) return;
    if (!terrainConfig) { loadTerrainConfig(); return; }
    scene.traverse(object => {
      if (!object?.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) hydrateMaterial(material, map.id);
    });
  }

  function patchThree() {
    const THREE = window.THREE;
    if (!THREE?.WebGLRenderer?.prototype || !THREE?.TextureLoader?.prototype) return false;

    const rendererProto = THREE.WebGLRenderer.prototype;
    if (!rendererProto.__hobunjiMapEditorTextureRedrawWrapped) {
      const originalRender = rendererProto.render;
      rendererProto.render = function mapEditorTextureAwareRender(scene, camera) {
        this.__hobunjiMapEditorLastRender = { scene, camera };
        liveRenderers.add(this);
        hydrateScene(scene); // Basic guarantee: configured terrain PNGs are attached before the actual draw whenever possible.
        return originalRender.call(this, scene, camera);
      };
      rendererProto.__hobunjiMapEditorTextureRedrawWrapped = true;
    }

    const loaderProto = THREE.TextureLoader.prototype;
    if (!loaderProto.__hobunjiMapEditorTextureLoadWrapped) {
      const originalLoad = loaderProto.load;
      loaderProto.load = function mapEditorTextureAwareLoad(url, onLoad, onProgress, onError) {
        const raw = String(url || '');
        const canonical = /(?:^|\/)assets\/textures\/|^[^/\\]+\.png(?:[?#].*)?$/i.test(raw)
          ? canonicalTerrainTextureUrl(raw)
          : url; // Repairs both bare filenames and incorrectly nested repo-relative terrain texture URLs.
        const wrappedLoad = texture => {
          try { onLoad?.(texture); }
          finally { queueRedraw(); }
        };
        return originalLoad.call(this, canonical, wrappedLoad, onProgress, onError);
      };
      loaderProto.__hobunjiMapEditorTextureLoadWrapped = true;
    }
    return true;
  }

  function patchNaturalSurfaceMaterialReplacement() {
    const api = window.NaturalSurfaceMaterials;
    if (!api?.naturalizeMesh || api.__hobunjiMapEditorPreservePreviewMaterial) return !!api?.naturalizeMesh;
    const originalNaturalize = api.naturalizeMesh;
    api.naturalizeMesh = function mapEditorPreservePreviewMaterial(mesh, surface, mapping, ...rest) {
      if (mesh?.isMesh) {
        mesh.userData = Object.assign({}, mesh.userData, {
          naturalSurface: surface,
          toolTerrainPreviewMaterialPreserved: true,
        }); // The centralized UV mapper may modify geometry, but the Map Editor keeps the same material object its PNG loader populates.
        return mesh;
      }
      return originalNaturalize.call(this, mesh, surface, mapping, ...rest);
    };
    api.__hobunjiMapEditorPreservePreviewMaterial = true;
    return true;
  }

  function install() {
    const threeReady = patchThree();
    const materialReady = patchNaturalSurfaceMaterialReplacement();
    loadTerrainConfig();
    if (threeReady && materialReady) {
      window.HobunjiMapEditorTerrainTextureFix = {
        installed: true,
        queueRedraw,
        hydrateScene,
        canonicalTerrainTextureUrl,
        snapshot: () => ({
          liveRenderers: liveRenderers.size,
          matchedMaterials,
          hydratedMaterials: hydratedCount,
          failedMaterials: failedCount,
          activeMapId: activeMap()?.id || null,
          configLoaded: !!terrainConfig,
        }),
      };
      queueRedraw();
      return;
    }
    setTimeout(install, 40);
  }

  install();
})();
