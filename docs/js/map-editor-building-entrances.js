// Map Editor — reliable per-building entrance destinations.
// Loaded only by docs/tools/map-editor through building-door.js.
(() => {
  'use strict';

  if (!/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return;

  const WS_KEY = 'hobunji_map_editor_workspace_v1';
  const FOCUS_KEY = 'hobunji_map_editor_building_entrance_focus_v1';
  const STYLE_ID = 'mapEditorBuildingEntranceStyles';
  const PANEL_CLASS = 'mapEditorBuildingEntranceEditor';
  const MAP_INDEX_URL = '../../config/maps/index.json';
  let renderTimer = 0;
  let lastError = '';
  let repoInteriorMaps = [];
  let repoIndexState = 'loading';

  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function isInterior(mapId) {
    return String(mapId || '').startsWith('map_i_');
  }

  async function loadRepoInteriorIndex() {
    repoIndexState = 'loading';
    try {
      const response = await fetch(MAP_INDEX_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = await response.json();
      repoInteriorMaps = (index.maps || [])
        .filter(map => map && map.id && (map.category === 'building_interior' || isInterior(map.id)))
        .map(map => ({ id: map.id, name: map.name || map.id, category: map.category || 'building_interior', file: map.file || '' }));
      repoIndexState = 'ready';
      lastError = '';
    } catch (error) {
      repoIndexState = 'failed';
      lastError = `Interior map index failed to load: ${error.message}`;
    }
    scheduleRender(0);
  }

  function readWorkspace() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WS_KEY) || 'null');
      return parsed && Array.isArray(parsed.maps) ? parsed : null;
    } catch (error) {
      lastError = `Workspace read failed: ${error.message}`;
      return null;
    }
  }

  function activeMap(workspace) {
    return workspace?.maps.find(map => map.id === workspace.activeId) || workspace?.maps[0] || null;
  }

  function selectedBuildingId() {
    return document.querySelector('#buildingList [data-bid].sel')?.dataset.bid || '';
  }

  function linkedTransition(map, buildingId) {
    return (map?.transitions || []).find(transition => transition.buildingId === buildingId) || null;
  }

  function isAssigned(transition) {
    return !!transition?.targetMapId && (isInterior(transition.targetMapId) || !!transition.targetSpotId);
  }

  function writeWorkspace(workspace) {
    const serialized = JSON.stringify(workspace);
    try {
      localStorage.setItem(WS_KEY, serialized);
      // The editor may still have a delayed save queued. Re-write the patched
      // workspace during pagehide so its stale in-memory copy cannot win.
      window.addEventListener('pagehide', () => {
        try { localStorage.setItem(WS_KEY, serialized); } catch (_) {}
      }, { once: true });
      return true;
    } catch (error) {
      lastError = `Workspace save failed: ${error.message}`;
      return false;
    }
  }

  function saveDestination(mapId, buildingId, targetMapId, targetSpotId, status) {
    const workspace = readWorkspace();
    const map = workspace?.maps.find(candidate => candidate.id === mapId);
    const transition = linkedTransition(map, buildingId);
    if (!transition) {
      lastError = 'The linked door has not reached the saved workspace yet. Tap Refresh destinations.';
      if (status) status.textContent = lastError;
      return;
    }

    transition.targetMapId = targetMapId || '';
    transition.targetSpotId = targetSpotId || '';
    sessionStorage.setItem(FOCUS_KEY, buildingId);
    if (!writeWorkspace(workspace)) {
      if (status) status.textContent = lastError;
      return;
    }
    if (status) status.textContent = 'Saved. Reloading the editor…';
    location.reload();
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.${PANEL_CLASS}{display:grid;gap:7px;margin-top:4px}
.${PANEL_CLASS} select,.${PANEL_CLASS} button{min-height:40px}
.${PANEL_CLASS} .mebeRow,.${PANEL_CLASS} .mebeSummary{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.${PANEL_CLASS} .mebeRow>*{flex:1 1 130px}
.${PANEL_CLASS} .mebeSummary{justify-content:space-between}
.${PANEL_CLASS} .mebeStatus{font-size:11px;line-height:1.4;color:var(--muted,#9fb4cf)}
.${PANEL_CLASS} .mebeError{color:var(--bad,#fb7185)}
.${PANEL_CLASS} .mebeAuto{padding:7px 9px;border:1px solid rgba(52,211,153,.28);border-radius:8px;background:rgba(52,211,153,.08);font-size:11px;line-height:1.4;color:var(--muted,#9fb4cf)}
.${PANEL_CLASS} details{font-size:10px;color:var(--muted,#9fb4cf)}
.${PANEL_CLASS} code{display:block;white-space:normal;overflow-wrap:anywhere;margin-top:4px}
`;
    document.head.appendChild(style);
  }

  function allDestinationMaps(workspace, currentMap) {
    const byId = new Map();
    // Workspace entries retain their full transitions[] for non-interior targets.
    for (const map of workspace.maps || []) {
      if (map?.id && map.id !== currentMap.id) byId.set(map.id, map);
    }
    // Repo index entries guarantee every authored map_i_* interior is offered,
    // even after Load Town replaces the editor workspace or before those maps
    // finish loading into it.
    for (const map of repoInteriorMaps) {
      if (map.id !== currentMap.id && !byId.has(map.id)) byId.set(map.id, map);
    }
    return Array.from(byId.values());
  }

  function destinationOptions(workspace, currentMap, selectedId) {
    const candidates = allDestinationMaps(workspace, currentMap);
    const interiors = candidates
      .filter(map => isInterior(map.id) || map.category === 'building_interior')
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const others = candidates
      .filter(map => !interiors.includes(map))
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const options = maps => maps.map(map =>
      `<option value="${esc(map.id)}" ${map.id === selectedId ? 'selected' : ''}>${esc(map.name || map.id)}</option>`
    ).join('');
    let html = '<option value="">— No destination —</option>';
    if (interiors.length) html += `<optgroup label="All repo interiors (${interiors.length})">${options(interiors)}</optgroup>`;
    if (others.length) html += `<optgroup label="Other loaded maps">${options(others)}</optgroup>`;
    if (selectedId && !candidates.some(map => map.id === selectedId)) {
      html += `<option value="${esc(selectedId)}" selected>[Missing] ${esc(selectedId)}</option>`;
    }
    return html;
  }

  function destinationMapById(workspace, mapId) {
    return workspace.maps.find(map => map.id === mapId)
      || repoInteriorMaps.find(map => map.id === mapId)
      || null;
  }

  function focusBuilding(buildingId) {
    const item = Array.from(document.querySelectorAll('#buildingList [data-bid]'))
      .find(candidate => candidate.dataset.bid === buildingId);
    if (!item) return false;
    item.click();
    item.scrollIntoView({ block: 'nearest' });
    return true;
  }

  function restoreFocus(attempt = 0) {
    const buildingId = sessionStorage.getItem(FOCUS_KEY);
    if (!buildingId) return;
    if (focusBuilding(buildingId)) {
      sessionStorage.removeItem(FOCUS_KEY);
      return;
    }
    if (attempt < 30) setTimeout(() => restoreFocus(attempt + 1), 100);
    else sessionStorage.removeItem(FOCUS_KEY);
  }

  function nextUnassigned(map, currentId) {
    const buildings = map?.buildings || [];
    const start = Math.max(0, buildings.findIndex(building => building.id === currentId));
    for (let offset = 1; offset <= buildings.length; offset++) {
      const candidate = buildings[(start + offset) % buildings.length];
      if (candidate && !isAssigned(linkedTransition(map, candidate.id))) return candidate;
    }
    return null;
  }

  function render() {
    installStyles();
    restoreFocus();
    const box = document.getElementById('bldgDoorTarget');
    const workspace = readWorkspace();
    const map = activeMap(workspace);
    const buildingId = selectedBuildingId();
    if (!box || !workspace || !map || !buildingId) return;

    const building = (map.buildings || []).find(candidate => candidate.id === buildingId);
    const transition = linkedTransition(map, buildingId);
    const signature = [map.id, buildingId, transition?.targetMapId || '', transition?.targetSpotId || '',
      workspace.maps.map(candidate => `${candidate.id}:${(candidate.transitions || []).length}`).join('|'),
      repoIndexState, repoInteriorMaps.length, lastError].join('::');
    if (box.querySelector(`.${PANEL_CLASS}`) && box.dataset.mebeSignature === signature) return;
    box.dataset.mebeSignature = signature;

    if (!building || !transition) {
      box.innerHTML = `<div class="${PANEL_CLASS}"><div class="mebeStatus">Waiting for the selected building's linked door to save…</div><button class="sec" data-mebe-refresh>Refresh destinations</button></div>`;
      box.querySelector('[data-mebe-refresh]')?.addEventListener('click', () => scheduleRender(0));
      scheduleRender(450);
      return;
    }

    const targetMap = destinationMapById(workspace, transition.targetMapId);
    const automaticArrival = isInterior(transition.targetMapId);
    const assigned = (map.buildings || []).filter(candidate => isAssigned(linkedTransition(map, candidate.id))).length;
    const next = nextUnassigned(map, buildingId);
    const arrival = !transition.targetMapId
      ? '<div class="mebeStatus">Choose the map this doorway enters.</div>'
      : automaticArrival
        ? `<div class="mebeAuto">Arrival is automatic at <b>${esc(targetMap?.name || transition.targetMapId)}</b>'s Front Door exit zone.</div>`
        : `<div><label>Arrive at</label><select data-mebe-spot><option value="">— Choose an arrival spot —</option>${(targetMap?.transitions || []).map(spot => `<option value="${esc(spot.id)}" ${spot.id === transition.targetSpotId ? 'selected' : ''}>${esc(spot.label || spot.id)}</option>`).join('')}</select></div>`;

    const indexMessage = repoIndexState === 'loading'
      ? 'Loading the repo interior index…'
      : repoIndexState === 'failed'
        ? lastError
        : `${repoInteriorMaps.length} repo interiors available, including floors and private rooms.`;

    box.innerHTML = `<div class="${PANEL_CLASS}">
      <div class="mebeSummary"><span class="pill">${assigned}/${(map.buildings || []).length} entrances assigned</span><button class="sec" data-mebe-next ${next ? '' : 'disabled'}>${next ? 'Next unassigned' : 'All assigned'}</button></div>
      <div><label>Destination map</label><select data-mebe-map ${repoIndexState === 'loading' ? 'disabled' : ''}>${destinationOptions(workspace, map, transition.targetMapId || '')}</select></div>
      ${arrival}
      <div class="mebeRow">${transition.targetMapId ? '<button class="bad" data-mebe-clear>Clear destination</button>' : ''}<button class="sec" data-mebe-refresh>Reload interior index</button></div>
      <div class="mebeStatus ${repoIndexState === 'failed' || lastError ? 'mebeError' : ''}" data-mebe-status>${esc(indexMessage)}</div>
      <details><summary>Entrance debug</summary><code>map=${esc(map.id)} · building=${esc(buildingId)} · transition=${esc(transition.id || 'missing')} · target=${esc(transition.targetMapId || 'none')} · workspaceMaps=${workspace.maps.length} · indexedInteriors=${repoInteriorMaps.length}</code></details>
    </div>`;

    const status = box.querySelector('[data-mebe-status]');
    box.querySelector('[data-mebe-map]')?.addEventListener('change', event => {
      lastError = '';
      saveDestination(map.id, buildingId, event.target.value, '', status);
    });
    box.querySelector('[data-mebe-spot]')?.addEventListener('change', event => {
      lastError = '';
      saveDestination(map.id, buildingId, transition.targetMapId, event.target.value, status);
    });
    box.querySelector('[data-mebe-clear]')?.addEventListener('click', () => saveDestination(map.id, buildingId, '', '', status));
    box.querySelector('[data-mebe-next]')?.addEventListener('click', () => { if (next) focusBuilding(next.id); });
    box.querySelector('[data-mebe-refresh]')?.addEventListener('click', () => loadRepoInteriorIndex());
  }

  function scheduleRender(delay = 40) {
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
      reloadIndex: () => loadRepoInteriorIndex(),
      debugSnapshot: () => {
        const workspace = readWorkspace();
        const map = activeMap(workspace);
        const buildingId = selectedBuildingId();
        return { mapId: map?.id || null, buildingId, transition: linkedTransition(map, buildingId), workspaceMapCount: workspace?.maps?.length || 0, indexedInteriorCount: repoInteriorMaps.length, repoIndexState, lastError };
      },
    };
    loadRepoInteriorIndex();
    scheduleRender(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
