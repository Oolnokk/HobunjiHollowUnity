(() => {
  'use strict';

  if (window.BuildingInteriorRuntimeFurniture) return;

  const AUTHORED_RUNTIME_URL = '../../js/authored-furniture-runtime.js?v=20260908b'; // Used to load the same authored furniture group builder as gameplay.
  const VESSEL_RUNTIME_URL = '../../js/furniture-vessel-runtime.js?v=20260908b'; // Used to install gameplay's live procedural-to-authored furniture upgrade wrapper.
  const AUTHORED_CONFIG_BASE = '../../config/furniture-authored/'; // Used to resolve authored furniture JSON correctly from this nested editor page.
  const RUNTIME_TEXTURE_PREFIX = 'assets/textures/'; // Used to recognize game-root-relative furniture texture requests emitted by ProceduralFurniture.
  const EDITOR_TEXTURE_PREFIX = '../../assets/textures/'; // Used to redirect those texture requests to docs/assets/textures from the nested editor.
  const authoredCache = new Map(); // Used by the editor-local AuthoredFurniture load/peek methods with the same cache semantics as gameplay.
  const state = { // Used by the on-screen status line and mobile-friendly debug snapshot.
    installed: false,
    textureRemapInstalled: false,
    authoredRuntimeLoaded: false,
    vesselRuntimeLoaded: false,
    liveUpgradeInstalled: false,
    metadataGuardInstalled: false,
    existingPreviewRebuilt: false,
    loadCount: 0,
    authoredHits: 0,
    authoredMisses: 0,
    lastKey: null,
    lastError: null,
  };

  function statusLine(message, tone = 'normal') {
    const debugEl = document.querySelector('.debug'); // Used to surface furniture-runtime state without requiring browser devtools.
    if (!debugEl) return;
    const line = document.createElement('div'); // Used as one non-destructive diagnostic row inside the editor's existing debug area.
    line.textContent = `[Furniture preview] ${message}`;
    line.style.color = tone === 'error' ? '#ff9a9a' : tone === 'ok' ? '#85e09b' : '#c7d8f2';
    debugEl.appendChild(line);
  }

  function waitFor(predicate, label) {
    const startedAt = performance.now(); // Used to stop an accidental infinite poll if a required editor runtime never loads.
    return new Promise((resolve, reject) => {
      function check() {
        if (predicate()) {
          resolve();
          return;
        }
        if (performance.now() - startedAt > 5000) {
          reject(new Error(`Timed out waiting for ${label}.`));
          return;
        }
        setTimeout(check, 25);
      }
      check();
    });
  }

  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    const fileName = src.split('/').pop().split('?')[0]; // Used to identify an earlier request regardless of its normalized absolute URL.
    const existing = [...document.scripts].find(script => script.src && script.src.includes('/' + fileName)); // Used to discard a stale/failed request before retrying the runtime script.
    if (existing) existing.remove();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); // Used to request one runtime dependency in deterministic order.
      script.addEventListener('load', () => {
        if (ready()) resolve();
        else reject(new Error(`${src} loaded without installing its expected runtime.`));
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}.`)), { once: true });
      script.src = src;
      script.async = false;
      script.dataset.biaRuntimeFurniture = '1';
      document.head.appendChild(script);
    });
  }

  function installTexturePathRemap() {
    const THREE = window.THREE; // Used to patch only this editor's Three.js texture loader requests.
    if (!THREE?.TextureLoader?.prototype?.load) throw new Error('THREE.TextureLoader is unavailable.');
    const currentLoad = THREE.TextureLoader.prototype.load; // Used to preserve the original loader behavior for all non-furniture URLs.
    if (currentLoad.__biaRuntimeFurnitureTextureRemap) {
      state.textureRemapInstalled = true;
      return;
    }
    function loadWithEditorFurniturePath(url, onLoad, onProgress, onError) {
      const resolvedUrl = typeof url === 'string' && url.startsWith(RUNTIME_TEXTURE_PREFIX) // Used as the final URL passed into Three.js after editor-only path correction.
        ? EDITOR_TEXTURE_PREFIX + url.slice(RUNTIME_TEXTURE_PREFIX.length)
        : url;
      return currentLoad.call(this, resolvedUrl, onLoad, onProgress, onError);
    }
    loadWithEditorFurniturePath.__biaRuntimeFurnitureTextureRemap = true;
    loadWithEditorFurniturePath.__biaRuntimeFurnitureTextureRemapOriginal = currentLoad;
    THREE.TextureLoader.prototype.load = loadWithEditorFurniturePath;
    state.textureRemapInstalled = true;
  }

  function installEditorAuthoredLoader() {
    const runtime = window.AuthoredFurniture; // Used to replace only load/peek while retaining gameplay's exact authored group/material/timeline builders.
    if (!runtime?.buildGroup) throw new Error('AuthoredFurniture.buildGroup is unavailable.');

    runtime.load = function loadEditorAuthoredFurniture(furnitureKey) {
      const key = String(furnitureKey || '').trim(); // Used as the canonical authored furniture filename/cache key.
      if (!key) return Promise.resolve(null);
      if (authoredCache.has(key)) return authoredCache.get(key);
      state.loadCount += 1;
      state.lastKey = key;
      const promise = fetch(AUTHORED_CONFIG_BASE + encodeURIComponent(key) + '.json') // Used to load the exact authored furniture data file gameplay requests for this furniture key.
        .then(response => (response.ok ? response.json() : null))
        .catch(error => {
          state.lastError = String(error?.message || error || 'authored furniture fetch failed');
          return null;
        })
        .then(data => {
          promise.__value = data;
          if (data) state.authoredHits += 1;
          else state.authoredMisses += 1;
          return data;
        });
      authoredCache.set(key, promise);
      return promise;
    };

    runtime.peek = function peekEditorAuthoredFurniture(furnitureKey) {
      const cached = authoredCache.get(String(furnitureKey || '').trim()); // Used to synchronously reuse authored data once its editor-local request has resolved.
      return cached && cached.__value !== undefined ? cached.__value : null;
    };
  }

  function protectUserData(object) {
    if (!object || object.__biaRuntimeFurnitureUserDataProtected) return object;
    let storedUserData = object.userData && typeof object.userData === 'object' ? object.userData : {}; // Used as the persistent metadata object merged into when the editor assigns its furnId tag.
    Object.defineProperty(object, 'userData', {
      configurable: true,
      enumerable: true,
      get() { return storedUserData; },
      set(next) {
        if (next && typeof next === 'object') Object.assign(storedUserData, next);
      },
    });
    Object.defineProperty(object, '__biaRuntimeFurnitureUserDataProtected', { value: true, configurable: true });
    return object;
  }

  function protectFurnitureTree(root) {
    if (!root) return root;
    root.traverse?.(protectUserData);
    if (!root.__biaRuntimeFurnitureAddProtected && typeof root.add === 'function') {
      const originalAdd = root.add; // Used to preserve authored metadata and the editor furnId on children swapped in asynchronously by FurnitureVesselRuntime.
      root.add = function addProtectedFurnitureChildren(...children) {
        for (const child of children) protectFurnitureTree(child);
        const result = originalAdd.apply(this, children);
        const furnId = this.userData?.furnId; // Used to make late-authored replacement meshes remain clickable/selectable in the Interior Editor.
        if (furnId != null) {
          for (const child of children) child?.traverse?.(object => {
            protectUserData(object);
            object.userData.furnId = furnId;
          });
        }
        return result;
      };
      Object.defineProperty(root, '__biaRuntimeFurnitureAddProtected', { value: true, configurable: true });
    }
    return root;
  }

  function installEditorMetadataGuard() {
    const furniture = window.ProceduralFurniture; // Used to decorate the already-installed gameplay builder only inside this editor.
    const runtimeBuilder = furniture?.buildFurnitureGroup; // Used as the exact gameplay authored/fallback builder the editor should continue calling.
    if (!runtimeBuilder) throw new Error('ProceduralFurniture.buildFurnitureGroup is unavailable.');
    if (runtimeBuilder.__biaRuntimeFurnitureMetadataGuard) {
      state.metadataGuardInstalled = true;
      return;
    }
    function buildEditorFurnitureGroup(key, baseColor) {
      return protectFurnitureTree(runtimeBuilder.call(this, key, baseColor));
    }
    Object.assign(buildEditorFurnitureGroup, runtimeBuilder);
    buildEditorFurnitureGroup.__biaRuntimeFurnitureMetadataGuard = true;
    buildEditorFurnitureGroup.__biaRuntimeFurnitureMetadataGuardOriginal = runtimeBuilder;
    furniture.buildFurnitureGroup = buildEditorFurnitureGroup;
    state.metadataGuardInstalled = true;
  }

  function rebuildExistingPreview() {
    const refreshButton = document.getElementById('refreshExportBtn'); // Used to serialize the editor's current in-memory interior without touching disk.
    const exportText = document.getElementById('exportText'); // Used to read that authoritative serialized interior for a no-data-loss refresh.
    const importInput = document.getElementById('importInput'); // Used to feed the same JSON back through the editor's normal rebuild path after runtime visuals install.
    if (!refreshButton || !exportText || !importInput) return false;
    refreshButton.click();
    let interior = null; // Used to skip the refresh entirely when the current editor has no furniture yet.
    try { interior = JSON.parse(exportText.value || '{}'); }
    catch (_) { return false; }
    if (!Array.isArray(interior?.furniture) || !interior.furniture.length) return false;
    if (typeof DataTransfer !== 'function' || typeof File !== 'function') return false;
    const file = new File([JSON.stringify(interior, null, 2)], 'runtime-furniture-preview-refresh.json', { type: 'application/json' }); // Used as the unchanged interior payload consumed by the editor's existing import handler.
    const transfer = new DataTransfer(); // Used to populate the file input in the same browser-supported way as the editor's furniture instance extension.
    transfer.items.add(file);
    importInput.files = transfer.files;
    importInput.dispatchEvent(new Event('change', { bubbles: true }));
    state.existingPreviewRebuilt = true;
    return true;
  }

  function debugSnapshot() {
    return {
      installed: state.installed,
      textureRemapInstalled: state.textureRemapInstalled,
      authoredRuntimeLoaded: state.authoredRuntimeLoaded,
      vesselRuntimeLoaded: state.vesselRuntimeLoaded,
      liveUpgradeInstalled: state.liveUpgradeInstalled,
      metadataGuardInstalled: state.metadataGuardInstalled,
      existingPreviewRebuilt: state.existingPreviewRebuilt,
      loadCount: state.loadCount,
      authoredHits: state.authoredHits,
      authoredMisses: state.authoredMisses,
      lastKey: state.lastKey,
      lastError: state.lastError,
      cachedKeys: [...authoredCache.keys()],
      configBase: AUTHORED_CONFIG_BASE,
      textureBase: EDITOR_TEXTURE_PREFIX,
      proceduralBuilderWrapped: !!window.ProceduralFurniture?.buildFurnitureGroup?.__hobunjiAuthoredLiveUpgradeWrapped,
      metadataGuardWrapped: !!window.ProceduralFurniture?.buildFurnitureGroup?.__biaRuntimeFurnitureMetadataGuard,
      furnitureVesselRuntime: window.FurnitureVesselRuntime ? { ...window.FurnitureVesselRuntime } : null,
    };
  }

  async function install() {
    try {
      await waitFor(() => !!window.THREE?.TextureLoader && !!window.ProceduralFurniture?.buildFurnitureGroup, 'THREE + ProceduralFurniture');
      installTexturePathRemap();
      await loadScript(AUTHORED_RUNTIME_URL, () => !!window.AuthoredFurniture?.buildGroup);
      state.authoredRuntimeLoaded = true;
      installEditorAuthoredLoader();
      await loadScript(VESSEL_RUNTIME_URL, () => !!window.FurnitureVesselRuntime?.installed && !!window.ProceduralFurniture?.buildFurnitureGroup?.__hobunjiAuthoredLiveUpgradeWrapped);
      state.vesselRuntimeLoaded = !!window.FurnitureVesselRuntime?.installed;
      state.liveUpgradeInstalled = !!window.ProceduralFurniture?.buildFurnitureGroup?.__hobunjiAuthoredLiveUpgradeWrapped;
      if (!state.liveUpgradeInstalled) throw new Error('Gameplay furniture upgrade wrapper did not install.');
      installEditorMetadataGuard();
      state.installed = true;
      const rebuiltExisting = rebuildExistingPreview(); // Used to repair furniture that a parent tool hub may have imported before the async runtime bridge finished loading.
      statusLine(rebuiltExisting
        ? 'Gameplay authored furniture visuals active; existing preview rebuilt on the runtime path.'
        : 'Gameplay authored furniture visuals active; procedural geometry is now fallback-only.', 'ok');
    } catch (error) {
      state.lastError = String(error?.message || error || 'runtime furniture install failed');
      statusLine(`Runtime visual sync failed: ${state.lastError}`, 'error');
    }
  }

  window.BuildingInteriorRuntimeFurniture = Object.freeze({
    install,
    debugSnapshot,
    configBase: AUTHORED_CONFIG_BASE,
  });
  window.__biaRuntimeFurnitureDebug = debugSnapshot;

  install();
})();
