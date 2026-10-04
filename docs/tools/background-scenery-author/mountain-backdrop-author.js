(() => {
  'use strict';

  const THREE = window.THREE;
  const Core = window.BackgroundScenery;
  const Backdrops = window.WesternSlopeMountainBackdrops;
  const BorderTerrain = window.BorderTerrain;
  if (!THREE || !Core || !Backdrops || !BorderTerrain || window.BackgroundSceneryMountainAuthor?.installed) return;

  const $ = id => document.getElementById(id);
  const WESTERN_ID = Backdrops.constants.WESTERN_SLOPE_ID;
  const GROUP_NAME = Backdrops.constants.GROUP_NAME;
  let activeMap = null; // Map currently resolved by the Background Scenery Author; used by controls and preview injection.
  let activeConfig = null; // Same resolved config object held by author.js, so edits flow into normal map/scenery export.
  let previewDeps = null; // Captured from scenery-3d-preview's BorderTerrain.init call so its private THREE scene can receive the mountain stack.
  let selectedLayer = 0; // Zero-based authored mountain layer selected by the sidebar transform controls.
  let resolvedLayout = null; // Latest fully resolved transform/size layout returned by the runtime module.
  let lastAutoFramedScene = null; // Prevents rebuilds from constantly stealing the user's preview camera.

  function mapId(map = activeMap) {
    return String(map?.id || map?.mapId || '');
  }

  function isWestern(map = activeMap) {
    return mapId(map) === WESTERN_ID;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ensureConfig() {
    if (!isWestern()) return null;
    const raw = activeConfig?.mountainBackdrops
      || activeMap?.backgroundScenery?.mountainBackdrops
      || Backdrops.readAuthorConfig();
    const normalized = Backdrops.normalizeAuthorConfig(raw);
    activeConfig.mountainBackdrops = normalized;
    activeMap.backgroundScenery = activeMap.backgroundScenery || {};
    activeMap.backgroundScenery.mountainBackdrops = normalized;
    return normalized;
  }

  const originalResolveConfig = Core.resolveConfig.bind(Core);
  Core.resolveConfig = function mountainBackdropResolveConfig(map) {
    const cfg = originalResolveConfig(map);
    activeMap = map;
    activeConfig = cfg;
    if (isWestern(map)) {
      cfg.mountainBackdrops = Backdrops.normalizeAuthorConfig(
        map?.backgroundScenery?.mountainBackdrops || Backdrops.readAuthorConfig()
      );
      map.backgroundScenery = map.backgroundScenery || {};
      map.backgroundScenery.mountainBackdrops = cfg.mountainBackdrops;
    }
    queueMicrotask(syncUi);
    return cfg;
  };

  const originalInit = BorderTerrain.init;
  if (typeof originalInit === 'function') {
    BorderTerrain.init = function mountainBackdropPreviewInit(deps, ...rest) {
      previewDeps = deps; // The preview's injected getTownScene/getTownZone accessors expose its otherwise private scene.
      return originalInit.call(this, deps, ...rest);
    };
  }

  const originalBuildTown = BorderTerrain.buildTownBorderTerrain;
  if (typeof originalBuildTown === 'function') {
    BorderTerrain.buildTownBorderTerrain = function mountainBackdropPreviewBuild(...args) {
      const result = originalBuildTown.apply(this, args);
      const map = previewDeps?.getTownZone?.();
      const scene = previewDeps?.getTownScene?.();
      if (mapId(map) !== WESTERN_ID || !scene) return result;
      const config = Backdrops.normalizeAuthorConfig(
        activeConfig?.mountainBackdrops
        || map?.backgroundScenery?.mountainBackdrops
        || Backdrops.readAuthorConfig()
      );
      Backdrops.attach(scene, map.cols, map.rows, WESTERN_ID, {
        config,
        assetBase: '../../',
      }).then(root => {
        if (!root || scene !== previewDeps?.getTownScene?.() || map !== activeMap) return;
        resolvedLayout = Backdrops.applyAuthorConfigToGroup(root, map.cols, map.rows, config);
        syncUi();
        if (lastAutoFramedScene !== scene) {
          const tryFrame = (remaining = 4) => {
            if (frameMountains()) { lastAutoFramedScene = scene; return; }
            if (remaining > 0) setTimeout(() => tryFrame(remaining - 1), 60);
          }; // The preview starts in 2D, so wait briefly for its render loop to expose the private camera after switching to 3D.
          tryFrame();
        }
      });
      return result;
    };
  }

  function activeRoot() {
    return previewDeps?.getTownScene?.()?.getObjectByName?.(GROUP_NAME) || null;
  }

  function currentResolvedLayer() {
    return resolvedLayout?.[selectedLayer] || null;
  }

  function displayVector(inputIds, rawVector, resolvedVector, fallbackVector) {
    inputIds.forEach((id, axis) => {
      const input = $(id);
      if (!input) return;
      const raw = rawVector?.[axis];
      const resolved = Number(resolvedVector?.[axis]);
      const fallback = Number(fallbackVector?.[axis]);
      const value = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw)
        : Number.isFinite(resolved) ? resolved
        : Number.isFinite(fallback) ? fallback : 0;
      input.value = Number(value.toFixed(3));
      input.dataset.autoValue = Number.isFinite(resolved) ? String(resolved) : '';
      input.title = raw == null && Number.isFinite(resolved) ? `Auto default: ${resolved.toFixed(3)}` : '';
    });
  }

  function syncUi() {
    const section = $('mountainBackdropSection');
    if (!section) return;
    const western = isWestern();
    section.style.display = western ? '' : 'none';
    const button = $('loadWesternSlope');
    if (button) button.classList.toggle('act', western);
    if (!western) return;

    const config = ensureConfig();
    const layer = config.layers[selectedLayer];
    const resolved = currentResolvedLayer();
    if ($('mountainEnabled')) $('mountainEnabled').checked = config.enabled !== false;
    if ($('mountainLayerSelect')) $('mountainLayerSelect').value = String(selectedLayer);
    if ($('mountainVisible')) $('mountainVisible').checked = layer.visible !== false;
    if ($('mountainAsset')) $('mountainAsset').value = layer.asset;
    if ($('mountainAssetThumb')) $('mountainAssetThumb').src = '../../' + layer.asset;

    displayVector(
      ['mountainPosX','mountainPosY','mountainPosZ'],
      layer.transform.position,
      resolved?.position,
      [-(Math.max(activeMap.cols, activeMap.rows) * 0.12), resolved?.height ? resolved.height * 0.5 : 0, activeMap.rows * 0.5]
    );
    displayVector(
      ['mountainRotX','mountainRotY','mountainRotZ'],
      layer.transform.rotationDeg,
      resolved?.rotationDeg,
      [0,90,0]
    );
    displayVector(
      ['mountainScaleX','mountainScaleY','mountainScaleZ'],
      layer.transform.scale,
      resolved?.scale,
      [1,1,1]
    );

    const size = $('mountainResolvedSize');
    if (size) {
      size.textContent = resolved
        ? `Base ${resolved.width.toFixed(1)} × ${resolved.height.toFixed(1)} world · final ${(resolved.width * resolved.scale[0]).toFixed(1)} × ${(resolved.height * resolved.scale[1]).toFixed(1)} · source ${resolved.sourceWidth}×${resolved.sourceHeight}px`
        : '3D preview will report the exact scaled image dimensions after the PNG loads.';
    }
  }

  function readVector(ids) {
    return ids.map(id => {
      const value = Number($(id)?.value);
      return Number.isFinite(value) ? value : 0;
    });
  }

  function commitControls() {
    if (!isWestern()) return;
    const config = ensureConfig();
    const layer = config.layers[selectedLayer];
    config.enabled = $('mountainEnabled')?.checked !== false;
    layer.visible = $('mountainVisible')?.checked !== false;
    layer.transform.position = readVector(['mountainPosX','mountainPosY','mountainPosZ']);
    layer.transform.rotationDeg = readVector(['mountainRotX','mountainRotY','mountainRotZ']);
    layer.transform.scale = readVector(['mountainScaleX','mountainScaleY','mountainScaleZ']).map(value => Math.max(0.001, value));
    activeConfig.mountainBackdrops = config;
    activeMap.backgroundScenery = activeMap.backgroundScenery || {};
    activeMap.backgroundScenery.mountainBackdrops = config;
    Backdrops.saveAuthorConfig(config);

    const root = activeRoot();
    if (root) {
      resolvedLayout = Backdrops.applyAuthorConfigToGroup(root, activeMap.cols, activeMap.rows, config);
      syncUi();
    }
    window.dispatchEvent(new CustomEvent('hobunji-western-slope-backdrop-author-change', {
      detail: { config: clone(config), layer: selectedLayer + 1 },
    }));
  }

  function resetSelectedLayer() {
    if (!isWestern()) return;
    const config = ensureConfig();
    const defaults = Backdrops.defaultAuthorConfig();
    config.layers[selectedLayer] = defaults.layers[selectedLayer];
    Backdrops.saveAuthorConfig(config);
    const root = activeRoot();
    if (root) resolvedLayout = Backdrops.applyAuthorConfigToGroup(root, activeMap.cols, activeMap.rows, config);
    syncUi();
  }

  function resetAllLayers() {
    if (!isWestern()) return;
    const config = Backdrops.clearAuthorConfig();
    activeConfig.mountainBackdrops = config;
    activeMap.backgroundScenery = activeMap.backgroundScenery || {};
    activeMap.backgroundScenery.mountainBackdrops = config;
    const root = activeRoot();
    if (root) resolvedLayout = Backdrops.applyAuthorConfigToGroup(root, activeMap.cols, activeMap.rows, config);
    syncUi();
  }

  function frameMountains() {
    const root = activeRoot();
    const camera = window.BackgroundSceneryPreview?.getCamera();
    const previewControls = window.BackgroundSceneryPreview?.getControls(); // Used to update the orbit target and zoom limits after fitting.
    if (!root || !camera || !activeMap) return false;
    root.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(root); // Used to include the gargantuan authored planes in the camera fit.
    box.expandByPoint(new THREE.Vector3(0, 0, 0));
    box.expandByPoint(new THREE.Vector3(activeMap.cols, 0, activeMap.rows));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);
    const halfFov = THREE.MathUtils.degToRad(camera.fov || 46) * 0.5;
    const distance = (radius * 0.5) / Math.max(0.1, Math.tan(halfFov)) * 1.32;
    const direction = new THREE.Vector3(1, 0.55, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(0.05, distance / 4000);
    camera.far = Math.max(1200, distance * 8);
    camera.updateProjectionMatrix();
    if (previewControls) {
      previewControls.target.copy(center);
      previewControls.minDistance = Math.min(previewControls.minDistance || 2, 2);
      previewControls.maxDistance = Math.max(previewControls.maxDistance || 320, distance * 3);
      previewControls.update();
    }
    return true;
  }

  function loadWesternSlopeAuthorMap() {
    const input = $('importFile'); // Reuses author.js's normal import path so its private state, fit logic, exports, and live-map bookkeeping stay authoritative.
    if (typeof input?.onchange !== 'function') return;
    const config = Backdrops.readAuthorConfig();
    const authoredMap = {
      id: WESTERN_ID,
      name: 'Western Slope',
      cols: 200,
      rows: 200,
      routes: [],
      rivers: [],
      tiles: {},
      backgroundScenery: {
        mountainBackdrops: config,
      },
    };
    const syntheticFile = {
      name: 'western-slope-backdrop-authoring.map.json',
      text: async () => JSON.stringify(authoredMap),
    }; // Matches the only File fields author.js's import handler reads, without creating a download/upload round trip.
    input.onchange({ target: { files: [syntheticFile], value: '' } });
    setTimeout(() => $('view3DBtn')?.click(), 30);
  }

  function installUi() {
    if (!$('loadWesternSlope')) {
      const loadTown = $('loadTown');
      const button = document.createElement('button');
      button.className = 'sec';
      button.id = 'loadWesternSlope';
      button.textContent = '🏔 Western Slope';
      loadTown?.after(button);
    }
    if ($('mountainBackdropSection')) return;
    const sideScroll = $('sideScroll');
    if (!sideScroll) return;
    const section = document.createElement('div');
    section.className = 'section';
    section.id = 'mountainBackdropSection';
    section.style.display = 'none';
    section.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center">
        <h2 style="margin:0">Mountain backdrop layers</h2>
        <label class="pill" style="display:flex;gap:5px;align-items:center"><input id="mountainEnabled" type="checkbox" checked> enabled</label>
      </div>
      <p class="muted" style="margin:6px 0">The real Western Slope PNG planes. Transforms here are the same transforms consumed by the runtime and are saved as a browser-local author override plus normal scenery export data.</p>
      <div class="g2">
        <div class="field"><label>Layer</label><select id="mountainLayerSelect"><option value="0">Layer 1 · near</option><option value="1">Layer 2 · middle</option><option value="2">Layer 3 · far</option></select></div>
        <div class="field"><label><input id="mountainVisible" type="checkbox" checked> Layer visible</label><input id="mountainAsset" type="text" readonly></div>
      </div>
      <img id="mountainAssetThumb" alt="Selected mountain backdrop" style="display:block;width:100%;max-height:150px;object-fit:contain;background:#07101a;border:1px solid rgba(255,255,255,.11);border-radius:7px;margin:5px 0 8px">
      <div class="field"><label>Position X / Y / Z</label><div class="g2" style="grid-template-columns:repeat(3,minmax(0,1fr))"><input id="mountainPosX" type="number" step="0.25"><input id="mountainPosY" type="number" step="0.25"><input id="mountainPosZ" type="number" step="0.25"></div></div>
      <div class="field"><label>Rotation X / Y / Z (degrees)</label><div class="g2" style="grid-template-columns:repeat(3,minmax(0,1fr))"><input id="mountainRotX" type="number" step="1"><input id="mountainRotY" type="number" step="1"><input id="mountainRotZ" type="number" step="1"></div></div>
      <div class="field"><label>Scale X / Y / Z</label><div class="g2" style="grid-template-columns:repeat(3,minmax(0,1fr))"><input id="mountainScaleX" type="number" min="0.001" step="0.05"><input id="mountainScaleY" type="number" min="0.001" step="0.05"><input id="mountainScaleZ" type="number" min="0.001" step="0.05"></div></div>
      <div id="mountainResolvedSize" class="muted" style="line-height:1.35;margin:5px 0">Load Western Slope to resolve PNG dimensions.</div>
      <div class="row"><button class="sec" id="mountainFrameAll">Frame mountains</button><button class="sec" id="mountainResetLayer">Reset layer</button><button class="bad" id="mountainResetAll">Reset all</button></div>
    `;
    const firstSection = sideScroll.querySelector('.section');
    firstSection?.after(section);
  }

  function bindUi() {
    $('loadWesternSlope')?.addEventListener('click', loadWesternSlopeAuthorMap);
    $('mountainLayerSelect')?.addEventListener('change', event => {
      selectedLayer = Math.max(0, Math.min(2, Number(event.target.value) || 0));
      syncUi();
    });
    $('mountainEnabled')?.addEventListener('change', commitControls);
    $('mountainVisible')?.addEventListener('change', commitControls);
    for (const id of [
      'mountainPosX','mountainPosY','mountainPosZ',
      'mountainRotX','mountainRotY','mountainRotZ',
      'mountainScaleX','mountainScaleY','mountainScaleZ',
    ]) {
      $(id)?.addEventListener('input', commitControls);
      $(id)?.addEventListener('change', commitControls);
    }
    $('mountainResetLayer')?.addEventListener('click', resetSelectedLayer);
    $('mountainResetAll')?.addEventListener('click', resetAllLayers);
    $('mountainFrameAll')?.addEventListener('click', frameMountains);
    syncUi();
  }

  installUi();
  bindUi();

  window.BackgroundSceneryMountainAuthor = Object.freeze({
    installed: true,
    syncUi,
    frameMountains,
    loadWesternSlopeAuthorMap,
    getState: () => ({
      mapId: mapId(),
      selectedLayer: selectedLayer + 1,
      resolvedLayout: resolvedLayout ? clone(resolvedLayout) : null,
      config: isWestern() ? clone(ensureConfig()) : null,
    }),
  });
})();
