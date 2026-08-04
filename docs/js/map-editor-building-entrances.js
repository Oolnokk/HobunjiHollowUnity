// Map Editor — complete building-interior destination choices.
//
// This controller deliberately reuses the map editor's own destination select
// element instead of writing workspace data itself. The editor's existing
// change listener therefore remains the single save path; this file only:
//   1. adds every map_i_* entry from config/maps/index.json to that select;
//   2. keeps the same live select available after an assigned interior would
//      normally replace it with a read-only "Edit Interior" row.
(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;

  const MAP_INDEX_URL = '../../config/maps/index.json';
  const STYLE_ID = 'mapEditorBuildingEntranceStyles';
  const EXTRA_GROUP_MARKER = 'repo-interior-options';
  let repoInteriors = [];
  let indexState = 'loading';
  let indexError = '';
  let renderTimer = 0;
  let nativeMapSelect = null;

  function isInteriorMap(entry) {
    return entry?.category === 'building_interior' || String(entry?.id || '').startsWith('map_i_');
  }

  async function loadIndex() {
    indexState = 'loading';
    indexError = '';
    scheduleRender(0);
    try {
      const response = await fetch(MAP_INDEX_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = await response.json();
      repoInteriors = (index.maps || [])
        .filter(entry => entry?.id && isInteriorMap(entry))
        .map(entry => ({ id: entry.id, name: entry.name || entry.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
      indexState = 'ready';
    } catch (error) {
      indexState = 'failed';
      indexError = `Could not load all interior maps: ${error.message}`;
    }
    scheduleRender(0);
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#bldgDoorTarget .mebeChangeRow{display:grid;gap:4px;margin-top:6px}
#bldgDoorTarget .mebeChangeRow select{min-height:40px}
#bldgDoorTarget .mebeStatus{font-size:11px;line-height:1.4;color:var(--muted,#9fb4cf);margin-top:5px}
#bldgDoorTarget .mebeStatus.error{color:var(--bad,#fb7185)}
#bldgDoorTarget .mebeRefresh{padding:3px 8px;margin-left:5px}
`;
    document.head.appendChild(style);
  }

  function augmentSelect(select, selectedMapId = '') {
    if (!select) return;

    select.querySelector(`optgroup[data-${EXTRA_GROUP_MARKER}]`)?.remove();
    const existing = new Set(Array.from(select.options).map(option => option.value));
    const missing = repoInteriors.filter(entry => !existing.has(entry.id));

    if (missing.length) {
      const group = document.createElement('optgroup');
      group.label = `All repo interiors (${repoInteriors.length})`;
      group.dataset[EXTRA_GROUP_MARKER.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = '1';
      for (const entry of missing) {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name;
        group.appendChild(option);
      }
      select.appendChild(group);
    }

    if (selectedMapId && Array.from(select.options).some(option => option.value === selectedMapId)) {
      select.value = selectedMapId;
    }
  }

  function assignedInteriorId(box) {
    const editButton = Array.from(box.querySelectorAll('button')).find(button => /Edit Interior/.test(button.textContent));
    const onclick = editButton?.getAttribute('onclick') || '';
    const match = onclick.match(/mapId\s*:\s*'([^']+)'/);
    if (match) return match[1];

    const pill = Array.from(box.querySelectorAll('.pill')).find(element => /map_i_/.test(element.textContent));
    return pill?.textContent.match(/(map_i_[A-Za-z0-9_]+)/)?.[1] || '';
  }

  function primeNativeSelect(originalBuildingId) {
    if (nativeMapSelect) return true;
    const items = Array.from(document.querySelectorAll('#buildingList [data-bid]'));
    for (const item of items) {
      if (item.dataset.bid === originalBuildingId) continue;
      item.click();
      const candidate = document.querySelector('#bldgDoorTarget select[data-bldgdoortarget]');
      if (candidate) {
        nativeMapSelect = candidate;
        document.querySelector(`#buildingList [data-bid="${CSS.escape(originalBuildingId)}"]`)?.click();
        return true;
      }
    }
    document.querySelector(`#buildingList [data-bid="${CSS.escape(originalBuildingId)}"]`)?.click();
    return false;
  }

  function selectedBuildingId() {
    return document.querySelector('#buildingList [data-bid].sel')?.dataset.bid || '';
  }

  function renderStatus(box) {
    let status = box.querySelector(':scope > .mebeStatus');
    if (!status) {
      status = document.createElement('div');
      status.className = 'mebeStatus';
      box.appendChild(status);
    }
    status.classList.toggle('error', indexState === 'failed');
    if (indexState === 'loading') status.textContent = 'Loading the complete interior map list…';
    else if (indexState === 'failed') status.textContent = indexError;
    else status.textContent = `${repoInteriors.length} repo interiors available, including upper floors, bedrooms, and basements.`;

    if (!status.querySelector('.mebeRefresh')) {
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'sec mebeRefresh';
      refresh.textContent = 'Reload';
      refresh.addEventListener('click', loadIndex);
      status.appendChild(refresh);
    }
  }

  function render() {
    installStyles();
    const box = document.getElementById('bldgDoorTarget');
    if (!box) return;

    const currentNative = box.querySelector('select[data-bldgdoortarget]');
    if (currentNative) {
      // MutationObserver runs after renderBuildingPanel wires this exact node,
      // so retaining it also retains the editor's own change listener.
      nativeMapSelect = currentNative;
      augmentSelect(nativeMapSelect, nativeMapSelect.value);
      box.querySelector('.mebeChangeRow')?.remove();
      renderStatus(box);
      return;
    }

    const assignedId = assignedInteriorId(box);
    if (!assignedId) {
      renderStatus(box);
      return;
    }

    const buildingId = selectedBuildingId();
    if (!nativeMapSelect && buildingId) primeNativeSelect(buildingId);
    if (!nativeMapSelect) {
      renderStatus(box);
      const status = box.querySelector(':scope > .mebeStatus');
      if (status && indexState === 'ready') {
        status.firstChild.textContent += ' Select any unassigned building once to enable reassignment controls for already-assigned interiors.';
      }
      return;
    }

    augmentSelect(nativeMapSelect, assignedId);
    let row = box.querySelector('.mebeChangeRow');
    if (!row) {
      row = document.createElement('div');
      row.className = 'mebeChangeRow';
      const label = document.createElement('label');
      label.textContent = 'Change destination';
      row.append(label, nativeMapSelect);
      box.prepend(row);
    } else if (!row.contains(nativeMapSelect)) {
      row.appendChild(nativeMapSelect);
    }
    nativeMapSelect.value = assignedId;
    renderStatus(box);
  }

  function scheduleRender(delay = 35) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  function install() {
    new MutationObserver(() => scheduleRender()).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', event => {
      if (event.target.closest('#buildingList [data-bid]')) scheduleRender(0);
    }, true);
    window.MapEditorBuildingEntrances = {
      refresh: () => scheduleRender(0),
      reloadIndex: loadIndex,
      debugSnapshot: () => ({
        indexedInteriorCount: repoInteriors.length,
        indexState,
        indexError,
        hasBoundNativeSelect: !!nativeMapSelect,
        selectedBuildingId: selectedBuildingId(),
      }),
    };
    loadIndex();
    scheduleRender(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
