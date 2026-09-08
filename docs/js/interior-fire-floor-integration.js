// Integration layer for InteriorFireFloorRuntime.
// Adds Interior Editor catalog/floor controls while preserving the shared
// runtime's real furniture footprints. Bonfire is intentionally 2x2, so the
// editor/game's normal furniture centering formula places its origin on the
// shared center vertex of the four occupied tiles: (col + 1, row + 1).
(() => {
  'use strict';

  if (window.InteriorFireFloorIntegration?.installed) return;

  const IS_INTERIOR_EDITOR = /\/tools\/building-interior-author\/(?:index\.html)?$/.test(location.pathname || '');
  const EDITOR_SYNC_MS = 500; // Reconciles Server Layout / Library loads that expose no public editor-state event.
  const EDITOR_CATALOG_ENTRIES = Object.freeze({ // Mirrors the shared runtime definitions so the editor's closure-private catOf() gets the correct footprint.
    campfireFurniture: Object.freeze({ key: 'campfireFurniture', label: 'Campfire', fw: 1, fd: 1, col: 0x6d3e20 }),
    bonfireFurniture: Object.freeze({ key: 'bonfireFurniture', label: 'Bonfire', fw: 2, fd: 2, col: 0x6d3e20 }),
  });
  const editorState = { // Used by the visible debug snapshot on mobile.
    installed: false,
    catalogInstalled: false,
    catalogFootprintBridgeInstalled: false,
    floorControlsInstalled: false,
    floorMeshBridgeInstalled: false,
    previewFloorMaterials: 0,
    previewFloorSignature: null,
    lastFloorSignature: null,
    reimports: 0,
    lastError: null,
  };

  function waitForRuntime() {
    const startedAt = performance.now(); // Bounds alternate tool-page load orders instead of polling forever.
    const timer = setInterval(() => {
      if (window.InteriorFireFloorRuntime?.installed) {
        clearInterval(timer);
        install();
      } else if (performance.now() - startedAt > 5000) {
        clearInterval(timer);
        editorState.lastError = 'Timed out waiting for InteriorFireFloorRuntime.';
      }
    }, 25);
  }

  function isInteriorCatalogMap(value) {
    // The Building Interior Editor keeps its CATALOG/CMAP inside an IIFE and
    // exposes no API for extending it. Identify only that exact map shape so
    // the two non-enumerable compatibility getters below do not change normal
    // object-property reads anywhere else on the tool page.
    return !!value && typeof value === 'object'
      && Object.prototype.hasOwnProperty.call(value, 'basicBedFurniture')
      && Object.prototype.hasOwnProperty.call(value, 'rugFurniture')
      && Object.prototype.hasOwnProperty.call(value, 'agingVaseFurniture');
  }

  function installEditorCatalogFootprintBridge() {
    if (!IS_INTERIOR_EDITOR || editorState.catalogFootprintBridgeInstalled) return false;
    for (const [key, entry] of Object.entries(EDITOR_CATALOG_ENTRIES)) {
      if (Object.prototype.hasOwnProperty.call(Object.prototype, key)) continue;
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        enumerable: false,
        get() {
          return isInteriorCatalogMap(this) ? entry : undefined;
        },
        set(value) {
          // Preserve ordinary assignment semantics for every unrelated object
          // that might genuinely use one of these property names.
          Object.defineProperty(this, key, {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
          });
        },
      });
    }
    editorState.catalogFootprintBridgeInstalled = true;
    return true;
  }

  function editorReadInterior() {
    const refresh = document.getElementById('refreshExportBtn'); // Uses the editor's own serializer instead of private state.
    const text = document.getElementById('exportText');
    if (!refresh || !text) return null;
    refresh.click();
    try { return JSON.parse(text.value || '{}'); }
    catch (error) { editorState.lastError = String(error?.message || error); return null; }
  }

  function editorImportInterior(interior, filename) {
    const input = document.getElementById('importInput'); // Reuses the editor's native undo/load/rebuild path.
    if (!input || typeof DataTransfer !== 'function' || typeof File !== 'function') return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(interior, null, 2)], filename || 'interior-fire-floor-edit.json', { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    editorState.reimports += 1;
    return true;
  }

  function ensureEditorCatalog() {
    const select = document.getElementById('catSelect');
    const grid = document.getElementById('catGrid');
    if (!select || !grid) return false;
    const entries = [
      { key: 'campfireFurniture', label: 'Campfire', detail: '1x1' },
      { key: 'bonfireFurniture', label: 'Bonfire', detail: '2x2 · centered on middle vertex' },
    ];
    for (const entry of entries) {
      if (![...select.options].some(option => option.value === entry.key)) {
        const option = document.createElement('option'); // Existing select change handler writes the closure-private activeKey.
        option.value = entry.key;
        option.textContent = `${entry.label} (${entry.detail})`;
        select.appendChild(option);
      }
      if (!grid.querySelector(`.catBtn[data-key="${entry.key}"]`)) {
        const button = document.createElement('button'); // Matches the editor's native catalog button styling.
        button.type = 'button';
        button.className = 'catBtn';
        button.dataset.key = entry.key;
        button.textContent = `${entry.label}\n${entry.detail}`;
        button.addEventListener('click', () => {
          select.value = entry.key;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          grid.querySelectorAll('.catBtn').forEach(item => item.classList.toggle('active', item.dataset.key === entry.key));
        });
        grid.appendChild(button);
      }
    }
    editorState.catalogInstalled = true;
    return true;
  }

  function normalizedStyle(style) {
    return window.InteriorFireFloorRuntime?.normalizeFloorStyle?.(style) || null;
  }

  function editorStyleFromControls() {
    return normalizedStyle({
      texture: document.getElementById('biaFloorTexture')?.value || '',
      tint: document.getElementById('biaFloorTint')?.value || '#ffffff',
      tilesPerTile: document.getElementById('biaFloorRepeat')?.value || 1,
    });
  }

  function setControlValues(style) {
    const normalized = normalizedStyle(style);
    const texture = document.getElementById('biaFloorTexture');
    const tint = document.getElementById('biaFloorTint');
    const repeat = document.getElementById('biaFloorRepeat');
    if (texture) texture.value = normalized?.texture || '';
    if (tint) tint.value = normalized?.tint || '#ffffff';
    if (repeat) repeat.value = normalized?.tilesPerTile ?? 1;
  }

  function editorPreviewFloorStyle() {
    const authored = normalizedStyle(window.__hobunjiInteriorFloorStyleOverride);
    if (authored) return authored;
    const wallStyle = document.getElementById('wallStyle')?.value || '';
    return window.InteriorFireFloorRuntime?.defaultFloorStyleForWallStyle?.(wallStyle) || null;
  }

  function isEditorFloorGeometry(geometry) {
    const p = geometry?.parameters;
    return geometry?.type === 'BoxGeometry'
      && Math.abs((p?.width ?? 0) - 1) < 1e-6
      && Math.abs((p?.height ?? 0) - 0.08) < 1e-6
      && Math.abs((p?.depth ?? 0) - 1) < 1e-6;
  }

  function installEditorFloorMeshBridge() {
    if (!IS_INTERIOR_EDITOR || editorState.floorMeshBridgeInstalled) return false;
    const THREE = window.THREE;
    const OriginalMesh = THREE?.Mesh;
    if (!OriginalMesh || OriginalMesh.__hobunjiInteriorFloorPreviewWrapped) {
      editorState.floorMeshBridgeInstalled = !!OriginalMesh?.__hobunjiInteriorFloorPreviewWrapped;
      return editorState.floorMeshBridgeInstalled;
    }

    function InteriorFloorAwareMesh(geometry, material) {
      const mesh = new OriginalMesh(geometry, material);
      if (isEditorFloorGeometry(geometry)) {
        const style = editorPreviewFloorStyle();
        if (style) {
          const materials = (Array.isArray(material) ? material : [material]).filter(Boolean);
          for (const mat of materials) {
            window.InteriorFireFloorRuntime?.applyFloorStyleToMaterial?.(mat, style, '../../assets/');
          }
          editorState.previewFloorMaterials = materials.length;
          editorState.previewFloorSignature = JSON.stringify(style);
        }
      }
      return mesh;
    }

    Object.setPrototypeOf(InteriorFloorAwareMesh, OriginalMesh);
    InteriorFloorAwareMesh.prototype = OriginalMesh.prototype;
    InteriorFloorAwareMesh.__hobunjiInteriorFloorPreviewWrapped = true;
    InteriorFloorAwareMesh.__hobunjiInteriorFloorPreviewOriginal = OriginalMesh;
    THREE.Mesh = InteriorFloorAwareMesh;
    editorState.floorMeshBridgeInstalled = true;
    return true;
  }

  function ensureFloorControls() {
    if (document.getElementById('biaFloorSurfaceSection')) {
      editorState.floorControlsInstalled = true;
      return true;
    }
    const left = document.getElementById('biaLeftPanel');
    const identity = left?.querySelector('.section');
    if (!left || !identity) return false;
    const section = document.createElement('div'); // Adds authoring UI without modifying the editor's large inline implementation.
    section.className = 'section';
    section.id = 'biaFloorSurfaceSection';
    section.innerHTML = `
      <h2>1b. Floor surface</h2>
      <div class="field"><label>PNG texture (assets/textures)</label><input id="biaFloorTexture" placeholder="boards.png"></div>
      <div class="grid2" style="margin-top:6px">
        <div class="field"><label>Tint</label><input id="biaFloorTint" type="color" value="#ffffff"></div>
        <div class="field"><label>Textures per tile</label><input id="biaFloorRepeat" type="number" min="0.05" max="64" step="0.05" value="1"></div>
      </div>
      <div class="row" style="margin-top:7px">
        <button id="biaFloorApply" type="button">Apply floor</button>
        <button id="biaFloorDefault" type="button">Use wall-style default</button>
      </div>
      <p class="hint" id="biaFloorStatus">Blank texture uses a flat tint. PNG names resolve from docs/assets/textures/.</p>`;
    identity.insertAdjacentElement('afterend', section);

    document.getElementById('biaFloorApply').addEventListener('click', () => {
      const interior = editorReadInterior();
      const style = editorStyleFromControls();
      if (!interior || !style) return;
      interior.floorStyle = style;
      window.__hobunjiInteriorFloorStyleOverride = style; // Must be set before the native import rebuild constructs its cached floor material.
      editorState.lastFloorSignature = JSON.stringify(style);
      editorImportInterior(interior, `${interior.id || 'building_interior'}-floor-style.json`);
      const status = document.getElementById('biaFloorStatus');
      if (status) status.textContent = `${style.texture || 'flat'} · ${style.tint} · ${style.tilesPerTile} texture(s) per tile`;
    });

    document.getElementById('biaFloorDefault').addEventListener('click', () => {
      const interior = editorReadInterior();
      if (!interior) return;
      delete interior.floorStyle;
      window.__hobunjiInteriorFloorStyleOverride = null;
      editorState.lastFloorSignature = 'null';
      editorImportInterior(interior, `${interior.id || 'building_interior'}-default-floor.json`);
      const status = document.getElementById('biaFloorStatus');
      if (status) status.textContent = 'Using the normal floor for the selected wall style.';
    });

    editorState.floorControlsInstalled = true;
    return true;
  }

  function syncEditorFloorFromExport() {
    const interior = editorReadInterior();
    if (!interior) return false;
    const style = normalizedStyle(interior.floorStyle);
    const signature = JSON.stringify(style || null);
    if (signature === editorState.lastFloorSignature) return true;
    editorState.lastFloorSignature = signature;
    setControlValues(style);
    window.__hobunjiInteriorFloorStyleOverride = style;
    if (style) {
      // Server/Library/native file loads rebuild before this external extension can set
      // the override. Re-import once, with the override already present, then the
      // signature guard prevents any loop.
      editorImportInterior(interior, `${interior.id || 'building_interior'}-floor-sync.json`);
    }
    return true;
  }

  function installEditor() {
    if (!IS_INTERIOR_EDITOR || editorState.installed) return false;
    if (!document.getElementById('catSelect') || !document.getElementById('importInput') || !document.getElementById('exportText')) return false;
    installEditorCatalogFootprintBridge();
    installEditorFloorMeshBridge();
    ensureEditorCatalog();
    ensureFloorControls();
    syncEditorFloorFromExport();
    setInterval(() => {
      ensureEditorCatalog();
      syncEditorFloorFromExport();
    }, EDITOR_SYNC_MS);
    editorState.installed = true;
    return true;
  }

  function debugSnapshot() {
    return {
      installed: true,
      bonfireFootprint: { w: 2, d: 2, centerOffset: { x: 1, z: 1 }, anchor: 'center-vertex' },
      editor: { ...editorState },
      core: window.InteriorFireFloorRuntime?.debugSnapshot?.() || null,
    };
  }

  function install() {
    if (IS_INTERIOR_EDITOR) {
      const startedAt = performance.now(); // Bounded because the core runtime can arrive before the editor's inline UI initialization.
      const timer = setInterval(() => {
        if (installEditor() || performance.now() - startedAt > 5000) clearInterval(timer);
      }, 50);
    }
    window.InteriorFireFloorIntegration = Object.freeze({ installed: true, debugSnapshot });
    window.__interiorFireFloorIntegrationDebug = debugSnapshot;
  }

  if (window.InteriorFireFloorRuntime?.installed) install();
  else waitForRuntime();
})();
