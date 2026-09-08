// Integration layer for InteriorFireFloorRuntime.
// Keeps the doubled bonfire centered on one authored map tile and adds
// Interior Editor controls without reaching into the editor's closure-private state.
(() => {
  'use strict';

  if (window.InteriorFireFloorIntegration?.installed) return;

  const IS_INTERIOR_EDITOR = /\/tools\/building-interior-author\/(?:index\.html)?$/.test(location.pathname || '');
  const EDITOR_SYNC_MS = 500; // Reconciles Server Layout / Library loads that expose no public editor-state event.
  const BONFIRE_ITEM_KEY = 'bonfireFurniture'; // Used to keep the doubled visual on the same single target tile as the original campfire.
  const editorState = { // Used by the visible debug snapshot on mobile.
    installed: false,
    catalogInstalled: false,
    floorControlsInstalled: false,
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

  function forceBonfireOneTile(data) {
    if (data?.key === 'bonfire') data.footprint = { w: 1, d: 1 }; // The visual itself is already doubled by InteriorFireFloorRuntime.
    return data;
  }

  function installBonfireDataGuard() {
    const authored = window.AuthoredFurniture;
    if (!authored?.load || authored.load.__hobunjiBonfireOneTile) return;
    const originalLoad = authored.load; // Used beneath the footprint-only correction.
    const originalPeek = authored.peek; // Used beneath the synchronous footprint-only correction.
    function loadOneTileBonfire(key) {
      return Promise.resolve(originalLoad.call(this, key)).then(data => forceBonfireOneTile(data));
    }
    loadOneTileBonfire.__hobunjiBonfireOneTile = true;
    loadOneTileBonfire.__hobunjiBonfireOneTileOriginal = originalLoad;
    authored.load = loadOneTileBonfire;
    authored.peek = function peekOneTileBonfire(key) {
      return forceBonfireOneTile(originalPeek?.call(this, key) || null);
    };
  }

  function patchDefinitionDeps(injectedDeps) {
    const defs = injectedDeps?.DECORATIVE_FURNITURE_DEFS; // The game's placement/scene loader reads footprint from this table.
    if (defs?.[BONFIRE_ITEM_KEY]) {
      defs[BONFIRE_ITEM_KEY].fw = 1;
      defs[BONFIRE_ITEM_KEY].fd = 1;
      defs[BONFIRE_ITEM_KEY].procKey = 'bonfire';
    }
  }

  function wrapInit(namespaceName) {
    const namespace = window[namespaceName];
    if (!namespace?.init || namespace.init.__hobunjiBonfireOneTile) return false;
    const originalInit = namespace.init; // Wraps the core runtime's existing definition-registration init hook.
    function initWithOneTileBonfire(injectedDeps) {
      const result = originalInit.call(this, injectedDeps);
      patchDefinitionDeps(injectedDeps);
      return result;
    }
    initWithOneTileBonfire.__hobunjiBonfireOneTile = true;
    initWithOneTileBonfire.__hobunjiBonfireOneTileOriginal = originalInit;
    namespace.init = initWithOneTileBonfire;
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
      { key: 'bonfireFurniture', label: 'Bonfire', detail: '1x1 · 2× visual' },
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
      oneTileBonfire: true,
      editor: { ...editorState },
      core: window.InteriorFireFloorRuntime?.debugSnapshot?.() || null,
    };
  }

  function install() {
    installBonfireDataGuard();
    wrapInit('FarmEditor');
    wrapInit('FarmPanel');
    setTimeout(() => {
      wrapInit('FarmEditor');
      wrapInit('FarmPanel');
    }, 0);
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
