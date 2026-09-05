// Map Editor — building elevation entry point plus per-instance walkable furniture authoring.
//
// The mature per-building subtle-elevation controller is preserved byte-for-byte
// in map-editor-building-elevation-core.js. This small entry point loads it first,
// then adds the related furniture support-height authoring UI without coupling that
// UI to standalone-interior synchronization.
(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;

  const BASE_CONTROLLER_URL = '../../js/map-editor-building-elevation-core.js?v=20260905walk1'; // Loaded before the walkable-furniture UI so existing building elevation behavior remains authoritative.
  const WORKSPACE_KEY = 'hobunji_map_editor_workspace_v1'; // Used to persist per-instance walkableElevation metadata in the editor's existing workspace.
  const WALKABLE_ELEVATION_KEY = 'walkableElevation'; // Read by HobunjiWalkableElevation at runtime to opt one placed furniture instance into geometry-derived support.
  const BUTTON_ID = 'walkableFurnitureElevationBtn'; // Used to keep one exterior-editor entry button across map/list rerenders.
  const DIALOG_ID = 'walkableFurnitureElevationDialog'; // Used to replace stale dialogs after map changes or repeated opens.
  let installed = false; // Used to prevent duplicate event listeners after the base controller's delayed startup.
  let mapListObserver = null; // Used to refresh the enabled-count badge when the active map changes.

  function workspace() {
    try { return window._mapEditorBridge?.getWorkspace?.() || null; }
    catch (_) { return null; }
  }

  function activeMap() {
    const ws = workspace();
    if (!ws || !Array.isArray(ws.maps) || !ws.maps.length) return null;
    return ws.maps.find(map => String(map?.id || '') === String(ws.activeId || '')) || ws.maps[0] || null;
  }

  function setStatus(message) {
    const pill = document.getElementById('statusPill'); // Existing Map Editor status surface used so mobile testing never depends on the console.
    if (pill) pill.textContent = message;
  }

  function persistWorkspace() {
    const ws = workspace();
    if (!ws) return false;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
      return true;
    } catch (error) {
      console.warn('Walkable furniture elevation: workspace save failed', error);
      setStatus(`Walkable furniture save failed: ${error?.message || error}`);
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function finiteNumber(value, fallback = NaN) {
    const number = Number(value); // Used by furnitureDisplayLabel so authored zero coordinates remain valid.
    return Number.isFinite(number) ? number : fallback;
  }

  function furnitureCollections(map) {
    const collections = []; // Used by the dialog and debug snapshot as the single list of instance-bearing map fields.
    if (Array.isArray(map?.decor)) collections.push({ key: 'decor', label: 'Exterior decor / furniture', list: map.decor });
    if (Array.isArray(map?.furniture)) collections.push({ key: 'furniture', label: 'Exterior processing furniture', list: map.furniture });
    if (map?.category === 'building_interior' && Array.isArray(map?.buildingInteriorBase?.furniture)) {
      collections.push({ key: 'buildingInteriorBase.furniture', label: 'Interior furniture', list: map.buildingInteriorBase.furniture });
    }
    return collections;
  }

  function furnitureDisplayLabel(record, index) {
    const key = record?.itemKey || record?.key || record?.kind || record?.type || `piece ${index + 1}`; // Used as the readable instance name in the mobile-friendly checkbox list.
    const col = finiteNumber(record?.col ?? record?.c ?? record?.x);
    const row = finiteNumber(record?.row ?? record?.r ?? record?.y);
    const id = String(record?.id || '').trim();
    const position = Number.isFinite(col) && Number.isFinite(row) ? ` · ${col},${row}` : '';
    return `${key}${position}${id ? ` · ${id}` : ''}`;
  }

  function walkableFurnitureSnapshot(map = activeMap()) {
    if (!map) return { mapId: null, enabled: 0, total: 0, instances: [] };
    const instances = []; // Used by copied diagnostics and the toolbar count.
    for (const collection of furnitureCollections(map)) {
      collection.list.forEach((record, index) => {
        instances.push({
          collection: collection.key,
          index,
          id: record?.id || null,
          key: record?.itemKey || record?.key || record?.kind || record?.type || null,
          col: finiteNumber(record?.col ?? record?.c ?? record?.x, null),
          row: finiteNumber(record?.row ?? record?.r ?? record?.y, null),
          walkableElevation: !!record?.[WALKABLE_ELEVATION_KEY],
        });
      });
    }
    return {
      mapId: map.id || null,
      mapName: map.name || null,
      enabled: instances.filter(instance => instance.walkableElevation).length,
      total: instances.length,
      instances,
    };
  }

  function updateButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    const snapshot = walkableFurnitureSnapshot();
    button.textContent = snapshot.enabled
      ? `Walkable Furniture · ${snapshot.enabled}`
      : 'Walkable Furniture';
    button.title = snapshot.total
      ? `${snapshot.enabled} of ${snapshot.total} furniture/decor instances use geometry-derived vertical support.`
      : 'This map has no furniture/decor instances to configure.';
  }

  function refreshJsonPreview() {
    const preview = document.getElementById('jsonPreview'); // Existing full-map JSON preview updated immediately after a walkability edit.
    const map = activeMap();
    if (!preview || !map) return;
    try {
      const runtimeMap = window.MapEditorBuildingElevation?.materializeActiveMap?.() || map;
      const output = {
        ...runtimeMap,
        tiles: Object.keys(runtimeMap.tiles || {}).map(key => {
          const [c, r] = key.split(',').map(Number);
          return { c, r, ...runtimeMap.tiles[key] };
        }),
      };
      preview.value = JSON.stringify(output, null, 2);
    } catch (_) {}
  }

  function copyWalkableDebug() {
    const snapshot = walkableFurnitureSnapshot(); // Copied whole because mobile users cannot rely on devtools.
    const text = JSON.stringify(snapshot, null, 2);
    navigator.clipboard?.writeText(text)
      .then(() => setStatus(`Copied walkable furniture debug: ${snapshot.enabled}/${snapshot.total} enabled.`))
      .catch(() => console.log(text));
    return snapshot;
  }

  function showWalkableFurnitureEditor() {
    const map = activeMap();
    if (!map) {
      setStatus('No active map is available for walkable furniture elevation.');
      return false;
    }

    document.getElementById(DIALOG_ID)?.remove();
    const dialog = document.createElement('dialog'); // Used as the per-instance editor on desktop and touch devices.
    dialog.id = DIALOG_ID;
    dialog.style.cssText = 'max-width:min(94vw,760px);width:760px;max-height:84vh;background:#111827;color:#e5e7eb;border:1px solid #4b5563;border-radius:10px;padding:14px;overflow:auto';

    const collections = furnitureCollections(map); // Captured for checkbox collection/index lookup until this modal is saved or closed.
    const rows = [];
    collections.forEach((collection, collectionIndex) => {
      if (!collection.list.length) return;
      rows.push(`<h4 style="margin:12px 0 6px">${escapeHtml(collection.label)}</h4>`);
      collection.list.forEach((record, recordIndex) => {
        rows.push(`<label style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.07)"><input type="checkbox" data-walk-collection="${collectionIndex}" data-walk-index="${recordIndex}"${record?.[WALKABLE_ELEVATION_KEY] ? ' checked' : ''}><span>${escapeHtml(furnitureDisplayLabel(record, recordIndex))}</span></label>`);
      });
    });

    dialog.innerHTML = `
      <h3 style="margin:0 0 4px">Walkable Furniture Elevation</h3>
      <div style="font-size:12px;color:#9ca3af;margin-bottom:8px">
        Map: ${escapeHtml(map.name || map.id || 'Untitled')}. Enabled instances use a runtime box calculated from their complete rendered geometry. The top is walkable; box sides remain non-blocking.
      </div>
      <div data-walk-list>${rows.join('') || '<div style="color:#9ca3af">This map has no furniture/decor instances to toggle.</div>'}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
        <button type="button" data-walk-debug>Copy debug</button>
        <button type="button" data-walk-save>Save</button>
        <button type="button" data-walk-close>Close</button>
      </div>`;

    dialog.querySelector('[data-walk-debug]')?.addEventListener('click', copyWalkableDebug);
    dialog.querySelector('[data-walk-close]')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-walk-save]')?.addEventListener('click', () => {
      const liveMap = activeMap();
      if (!liveMap || liveMap !== map) {
        setStatus('Active map changed; reopen Walkable Furniture before saving.');
        return;
      }

      let changed = 0; // Used to report the number of records whose authored walkability actually changed.
      dialog.querySelectorAll('input[data-walk-collection][data-walk-index]').forEach(input => {
        const collectionIndex = Number(input.dataset.walkCollection);
        const recordIndex = Number(input.dataset.walkIndex);
        const record = collections[collectionIndex]?.list?.[recordIndex]; // Exact placed instance edited by this checkbox.
        if (!record) return;
        const before = !!record[WALKABLE_ELEVATION_KEY];
        const after = !!input.checked;
        if (after) record[WALKABLE_ELEVATION_KEY] = true;
        else delete record[WALKABLE_ELEVATION_KEY];
        if (before !== after) changed += 1;
      });

      persistWorkspace();
      refreshJsonPreview();
      updateButton();
      setStatus(`Walkable furniture elevation saved · ${changed} change${changed === 1 ? '' : 's'}.`);
      dialog.close();
    });

    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
    return true;
  }

  function installButton() {
    if (document.getElementById(BUTTON_ID)) {
      updateButton();
      return true;
    }
    const section = document.getElementById('buildingsSection');
    const heading = section?.querySelector('.sect-head');
    if (!section || !heading) return false;

    const row = document.createElement('div'); // Used to keep this related elevation control near the existing building-elevation inspector.
    row.style.cssText = 'display:flex;gap:6px;margin:6px 0 2px;flex-wrap:wrap';
    const button = document.createElement('button'); // Opens the per-instance walkable furniture dialog.
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'sec';
    button.textContent = 'Walkable Furniture';
    button.addEventListener('click', showWalkableFurnitureEditor);
    row.appendChild(button);
    heading.insertAdjacentElement('afterend', row);
    updateButton();
    return true;
  }

  function installMapObserver() {
    if (mapListObserver) return;
    const mapList = document.getElementById('mapList'); // Existing active-map list observed so the button badge follows map switches.
    if (!mapList) return;
    mapListObserver = new MutationObserver(() => queueMicrotask(updateButton));
    mapListObserver.observe(mapList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
    mapList.addEventListener('click', () => setTimeout(updateButton, 0));
  }

  function augmentBaseApi() {
    const api = window.MapEditorBuildingElevation;
    if (!api || api.__walkableFurnitureElevation) return false;
    api.walkableFurnitureSnapshot = walkableFurnitureSnapshot;
    api.showWalkableFurnitureEditor = showWalkableFurnitureEditor;
    api.copyWalkableFurnitureDebug = copyWalkableDebug;
    api.__walkableFurnitureElevation = true;
    return true;
  }

  function installWalkableUi() {
    if (installed) return;
    if (!window.MapEditorBuildingElevation || !document.getElementById('buildingsSection')) {
      setTimeout(installWalkableUi, 30);
      return;
    }
    installed = true;
    installButton();
    installMapObserver();
    augmentBaseApi();
    updateButton();
  }

  function loadBaseController() {
    if (window.MapEditorBuildingElevation) {
      installWalkableUi();
      return;
    }
    const existing = document.querySelector('script[data-map-editor-building-elevation-core]'); // Prevents duplicate base-controller loads if another initializer races this entry point.
    if (existing) {
      existing.addEventListener('load', installWalkableUi, { once: true });
      setTimeout(installWalkableUi, 0);
      return;
    }
    const script = document.createElement('script'); // Loads the preserved original building-elevation implementation.
    script.src = BASE_CONTROLLER_URL;
    script.dataset.mapEditorBuildingElevationCore = '1';
    script.addEventListener('load', installWalkableUi, { once: true });
    document.head.appendChild(script);
  }

  loadBaseController();
})();
