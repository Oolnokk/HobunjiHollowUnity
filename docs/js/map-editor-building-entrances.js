// Map Editor — complete building-interior destination choices.
//
// The core editor normally hides its destination controls after a building is
// assigned to a map_i_* interior. This controller keeps the map selector live
// and adds a second, stable "Arrive at entrance" selector populated from the
// destination map's authored exits.
(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;

  const MAP_INDEX_URL = '../../config/maps/index.json'; // Used to discover every authored interior and its source file.
  const WORKSPACE_KEY = 'hobunji_map_editor_workspace_v1'; // Used to persist entrance bindings without requiring a console.
  const STYLE_ID = 'mapEditorBuildingEntranceStyles';
  const EXTRA_GROUP_MARKER = 'repo-interior-options';
  const entranceCache = new Map(); // Used to avoid refetching authored entrance lists while editing several buildings.
  let repoInteriors = [];
  let indexState = 'loading';
  let indexError = '';
  let renderTimer = 0;
  let renderGeneration = 0;
  let nativeMapSelect = null;
  let observer = null;

  function isInteriorMap(entry) {
    return entry?.category === 'building_interior' || String(entry?.id || '').startsWith('map_i_');
  }

  function mapFileUrl(file) {
    const normalized = String(file || '').replace(/^\/+/, '').replace(/^docs\//, '');
    return normalized ? `../../${normalized}` : '';
  }

  function bridgeWorkspace() {
    try {
      return window._mapEditorBridge?.getWorkspace?.()
        || window._mapEditorBridge?.workspace?.()
        || null;
    } catch (_) {
      return null;
    }
  }

  function activeMap() {
    const workspace = bridgeWorkspace();
    if (!workspace || !Array.isArray(workspace.maps)) return null;
    return workspace.maps.find(map => String(map?.id || '') === String(workspace.activeId || '')) || null;
  }

  function selectedBuildingId() {
    return document.querySelector('#buildingList [data-bid].sel')?.dataset.bid || '';
  }

  function selectedBuildingTransition() {
    const map = activeMap();
    const buildingId = selectedBuildingId();
    if (!map || !buildingId) return null;
    return (Array.isArray(map.transitions) ? map.transitions : [])
      .find(transition => String(transition?.buildingId || '') === buildingId) || null;
  }

  function interiorWorkspaceMap(mapId) {
    const workspace = bridgeWorkspace();
    return (workspace?.maps || []).find(map => String(map?.id || '') === String(mapId || '')) || null;
  }

  function logicalExitId(transition) {
    const explicit = String(transition?.exitId || transition?.sourceExitId || '').trim();
    if (explicit) return explicit;
    return String(transition?.id || '').replace(/_-?\d+(?:\.\d+)?_-?\d+(?:\.\d+)?$/, '');
  }

  function workspaceEntrances(mapId) {
    const map = interiorWorkspaceMap(mapId);
    const grouped = new Map();
    for (const transition of (Array.isArray(map?.transitions) ? map.transitions : [])) {
      const id = logicalExitId(transition);
      if (!id || grouped.has(id)) continue;
      grouped.set(id, {
        id,
        label: String(transition?.label || id),
        direction: String(transition?.exitDirection || ''),
        targetSpotId: String(transition?.id || ''),
        col: Number(transition?.col),
        row: Number(transition?.row),
      });
    }
    return Array.from(grouped.values());
  }

  async function authoredEntrances(mapId) {
    if (entranceCache.has(mapId)) return entranceCache.get(mapId);
    const entry = repoInteriors.find(candidate => candidate.id === mapId);
    const url = mapFileUrl(entry?.file);
    if (!url) return [];

    const promise = fetch(url, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(mapData => (Array.isArray(mapData?.exits) ? mapData.exits : []).map((exit, index) => {
        const id = String(exit?.id || `${mapId}_entrance_${index + 1}`);
        const firstTile = Array.isArray(exit?.tiles?.[0]) ? exit.tiles[0] : null;
        const col = Number(firstTile?.[0]);
        const row = Number(firstTile?.[1]);
        if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
        return {
          id,
          label: String(exit?.label || id),
          direction: String(exit?.direction || exit?.boundarySide || ''),
          targetSpotId: `${id}_${col}_${row}`,
          col,
          row,
        };
      }).filter(Boolean))
      .catch(error => {
        entranceCache.delete(mapId);
        throw error;
      });

    entranceCache.set(mapId, promise);
    return promise;
  }

  async function entrancesForMap(mapId) {
    const fromWorkspace = workspaceEntrances(mapId);
    if (fromWorkspace.length) return fromWorkspace;
    return authoredEntrances(mapId);
  }

  async function loadIndex() {
    indexState = 'loading';
    indexError = '';
    entranceCache.clear();
    scheduleRender(0);
    try {
      const response = await fetch(MAP_INDEX_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = await response.json();
      repoInteriors = (index.maps || [])
        .filter(entry => entry?.id && isInteriorMap(entry))
        .map(entry => ({
          id: String(entry.id),
          name: String(entry.name || entry.id),
          file: String(entry.file || ''),
        }))
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
#bldgDoorTarget .mebeChangeRow{display:grid;gap:5px;margin-top:6px}
#bldgDoorTarget .mebeChangeRow select{min-height:40px;width:100%}
#bldgDoorTarget .mebeFieldLabel{font-size:11px;color:var(--muted,#9fb4cf)}
#bldgDoorTarget .mebeEntranceDetail{font-size:11px;line-height:1.4;color:var(--muted,#9fb4cf);margin-top:1px}
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
      group.dataset.repoInteriorOptions = '1';
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
    const transitionMapId = String(selectedBuildingTransition()?.targetMapId || '');
    if (transitionMapId) return transitionMapId;

    const editButton = Array.from(box.querySelectorAll('button')).find(button => /Edit Interior/.test(button.textContent));
    const onclick = editButton?.getAttribute('onclick') || '';
    const match = onclick.match(/mapId\s*:\s*'([^']+)'/);
    if (match) return match[1];

    const pill = Array.from(box.querySelectorAll('.pill')).find(element => /map_i_/.test(element.textContent));
    return pill?.textContent.match(/(map_i_[A-Za-z0-9_]+)/)?.[1] || '';
  }

  function selectBuilding(buildingId) {
    const item = Array.from(document.querySelectorAll('#buildingList [data-bid]'))
      .find(candidate => candidate.dataset.bid === buildingId);
    item?.click();
    return !!item;
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
        selectBuilding(originalBuildingId);
        return true;
      }
    }
    selectBuilding(originalBuildingId);
    return false;
  }

  function persistWorkspace() {
    const workspace = bridgeWorkspace();
    if (!workspace) return false;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
      return true;
    } catch (_) {
      return false;
    }
  }

  function applyEntranceBinding(transition, entrance) {
    if (!transition || !entrance) return;
    transition.targetEntranceId = entrance.id;
    transition.targetSpotId = entrance.targetSpotId || '';
    persistWorkspace();
  }

  function inferSelectedEntranceId(transition, entrances) {
    const stable = String(transition?.targetEntranceId || '').trim();
    if (stable && entrances.some(entrance => entrance.id === stable)) return stable;

    const spotId = String(transition?.targetSpotId || '').trim();
    if (!spotId) return '';
    return entrances.find(entrance => entrance.targetSpotId === spotId)?.id
      || entrances.find(entrance => spotId === entrance.id || spotId.startsWith(`${entrance.id}_`))?.id
      || '';
  }

  function entranceDetail(entrance) {
    if (!entrance) return 'Choose which named doorway on the destination map receives the player.';
    const position = Number.isFinite(entrance.col) && Number.isFinite(entrance.row)
      ? ` · door tile ${entrance.col}, ${entrance.row}`
      : '';
    const direction = entrance.direction ? ` · faces ${entrance.direction}` : '';
    return `Bound to ${entrance.id}${position}${direction}. Moving that authored entrance will keep this link intact.`;
  }

  async function renderEntranceSelector(row, mapId, generation) {
    const transition = selectedBuildingTransition();
    if (!transition || transition.targetMapId !== mapId) return;

    const label = document.createElement('label');
    label.className = 'mebeFieldLabel';
    label.textContent = 'Arrive at entrance';

    const select = document.createElement('select');
    select.dataset.repoEntranceTarget = '1';
    select.disabled = true;
    select.innerHTML = '<option value="">Loading entrances…</option>';

    const detail = document.createElement('div');
    detail.className = 'mebeEntranceDetail';
    detail.setAttribute('aria-live', 'polite');
    detail.textContent = 'Reading named exits from the selected interior…';
    row.append(label, select, detail);

    try {
      const entrances = await entrancesForMap(mapId);
      if (generation !== renderGeneration || !row.isConnected) return;

      observer?.disconnect();
      try {
        select.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = entrances.length ? '— choose entrance —' : 'No authored entrances found';
        select.appendChild(placeholder);
        for (const entrance of entrances) {
          const option = document.createElement('option');
          option.value = entrance.id;
          option.textContent = entrance.direction
            ? `${entrance.label} (${entrance.direction})`
            : entrance.label;
          select.appendChild(option);
        }

        let selectedId = inferSelectedEntranceId(transition, entrances);
        if (!selectedId && entrances.length === 1) {
          selectedId = entrances[0].id;
          applyEntranceBinding(transition, entrances[0]);
        } else if (selectedId) {
          const selectedEntrance = entrances.find(entrance => entrance.id === selectedId);
          if (selectedEntrance && transition.targetSpotId !== selectedEntrance.targetSpotId) {
            applyEntranceBinding(transition, selectedEntrance);
          }
        }

        select.value = selectedId;
        select.disabled = entrances.length === 0;
        detail.textContent = entranceDetail(entrances.find(entrance => entrance.id === selectedId));
        select.addEventListener('change', () => {
          observer?.disconnect();
          try {
            const chosen = entrances.find(entrance => entrance.id === select.value);
            if (!chosen) {
              transition.targetEntranceId = '';
              transition.targetSpotId = '';
              persistWorkspace();
              detail.textContent = entranceDetail(null);
              return;
            }
            applyEntranceBinding(transition, chosen);
            detail.textContent = entranceDetail(chosen);
          } finally {
            observe();
          }
        });
      } finally {
        observe();
      }
    } catch (error) {
      if (generation !== renderGeneration || !row.isConnected) return;
      observer?.disconnect();
      try {
        select.innerHTML = '<option value="">Could not load entrances</option>';
        detail.textContent = `Entrance list error: ${error.message}`;
        detail.classList.add('error');
      } finally {
        observe();
      }
    }
  }

  function renderStatus(box) {
    let status = box.querySelector(':scope > .mebeStatus');
    if (!status) {
      status = document.createElement('div');
      status.className = 'mebeStatus';
      box.appendChild(status);
    }
    status.classList.toggle('error', indexState === 'failed');
    const message = indexState === 'loading'
      ? 'Loading the complete interior map list…'
      : indexState === 'failed'
        ? indexError
        : `${repoInteriors.length} repo interiors available. Destination links now use a map plus a named entrance.`;
    status.replaceChildren(document.createTextNode(message));

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'sec mebeRefresh';
    refresh.textContent = 'Reload';
    refresh.addEventListener('click', loadIndex);
    status.appendChild(refresh);
  }

  function observe() {
    observer?.observe(document.body, { childList: true, subtree: true });
  }

  function buildAssignedControls(box, assignedId) {
    augmentSelect(nativeMapSelect, assignedId);
    let row = box.querySelector('.mebeChangeRow');
    if (!row) {
      row = document.createElement('div');
      row.className = 'mebeChangeRow';
      box.prepend(row);
    }
    row.replaceChildren();

    const mapLabel = document.createElement('label');
    mapLabel.className = 'mebeFieldLabel';
    mapLabel.textContent = 'Leads to map';
    row.append(mapLabel, nativeMapSelect);
    nativeMapSelect.value = assignedId;

    const generation = ++renderGeneration;
    renderEntranceSelector(row, assignedId, generation);
  }

  function render() {
    observer?.disconnect();
    try {
      installStyles();
      const box = document.getElementById('bldgDoorTarget');
      if (!box) return;

      const currentNative = box.querySelector('select[data-bldgdoortarget]');
      if (currentNative) {
        nativeMapSelect = currentNative;
        augmentSelect(nativeMapSelect, nativeMapSelect.value);

        const transition = selectedBuildingTransition();
        const selectedMapId = String(transition?.targetMapId || nativeMapSelect.value || '');
        if (selectedMapId.startsWith('map_i_')) {
          buildAssignedControls(box, selectedMapId);
        } else {
          box.querySelector('.mebeChangeRow')?.remove();
          ++renderGeneration;
        }
        renderStatus(box);
        return;
      }

      const assignedId = assignedInteriorId(box);
      if (!assignedId || !assignedId.startsWith('map_i_')) {
        ++renderGeneration;
        renderStatus(box);
        return;
      }

      const buildingId = selectedBuildingId();
      if (!nativeMapSelect && buildingId) primeNativeSelect(buildingId);
      if (!nativeMapSelect) {
        renderStatus(box);
        const status = box.querySelector(':scope > .mebeStatus');
        if (status && indexState === 'ready') {
          status.insertBefore(document.createTextNode(' Select any unassigned building once to enable destination controls for assigned interiors.'), status.querySelector('button'));
        }
        return;
      }

      buildAssignedControls(box, assignedId);
      renderStatus(box);
    } finally {
      observe();
    }
  }

  function scheduleRender(delay = 35) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  function install() {
    observer = new MutationObserver(() => scheduleRender());
    observe();
    document.addEventListener('click', event => {
      if (event.target.closest('#buildingList [data-bid]')) scheduleRender(0);
    }, true);
    window.MapEditorBuildingEntrances = {
      refresh: () => scheduleRender(0),
      reloadIndex: loadIndex,
      debugSnapshot: () => {
        const transition = selectedBuildingTransition();
        return {
          indexedInteriorCount: repoInteriors.length,
          indexState,
          indexError,
          hasBoundNativeSelect: !!nativeMapSelect,
          selectedBuildingId: selectedBuildingId(),
          targetMapId: String(transition?.targetMapId || ''),
          targetEntranceId: String(transition?.targetEntranceId || ''),
          targetSpotId: String(transition?.targetSpotId || ''),
          availableEntrances: workspaceEntrances(transition?.targetMapId || ''),
        };
      },
    };
    loadIndex();
    scheduleRender(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();