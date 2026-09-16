(() => {
  'use strict';

  const CHANNEL_NAME = 'hobunji-map-live-preview-v1'; // Shared by the running game, standalone editor, and tools-hub iframe.
  const SNAPSHOT_KEY = 'hobunji_map_live_preview_v1'; // Reconnection-only preview envelope; never a canonical map/save source.
  const NAVIGATION_KEY = 'hobunji_map_editor_pending_navigation_v1'; // One-shot cold-start navigation request from the game.
  const SECTION_KEYS = ['metadata', 'terrain', 'elevation', 'navigation', 'transitions', 'stations', 'decor', 'furniture', 'buildings', 'layouts', 'structural'];
  const THIS_SCRIPT_URL = typeof document !== 'undefined' ? (document.currentScript?.src || '') : ''; // Used after protocol setup to load shared placement/lighting companions from the same /docs/js/ directory.

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function same(a, b) {
    return stable(a) === stable(b);
  }

  function classifyMapChanges(previous, next) {
    if (!previous) return SECTION_KEYS.slice();
    const changed = [];
    if (!same([previous.name, previous.audioIndex, previous.mapAudio], [next.name, next.audioIndex, next.mapAudio])) changed.push('metadata');
    if (!same(previous.tiles, next.tiles)) changed.push('terrain');
    if (!same(previous.visualHeights, next.visualHeights)) changed.push('elevation');
    if (!same(previous.routes || previous.npcPaths, next.routes || next.npcPaths)) changed.push('navigation');
    if (!same(previous.transitions, next.transitions)) changed.push('transitions');
    if (!same(previous.npcStations, next.npcStations)) changed.push('stations');
    if (!same(previous.decor, next.decor)) changed.push('decor');
    if (!same(previous.furniture, next.furniture)) changed.push('furniture');
    if (!same(previous.buildings, next.buildings)) changed.push('buildings');
    if (!same(previous.layouts, next.layouts)) changed.push('layouts');
    if (!same([previous.cols, previous.rows, previous.category, previous.parentMapId, previous.plateauGroupId], [next.cols, next.rows, next.category, next.parentMapId, next.plateauGroupId])) changed.push('structural');
    return changed;
  }

  function rootMapId(workspace, mapId) {
    const byId = new Map((workspace?.maps || []).map(map => [map.id, map]));
    let current = byId.get(mapId);
    const visited = new Set();
    while (current?.parentMapId && !visited.has(current.id)) {
      visited.add(current.id);
      current = byId.get(current.parentMapId) || current;
      if (!current.parentMapId) break;
    }
    return current?.id || mapId;
  }

  function requestId(prefix = 'map') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function createEndpoint(role, onMessage) {
    const sourceId = requestId(role); // Prevents an endpoint from processing its own mirrored storage/channel messages.
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
    const receive = message => {
      if (!message || message.protocol !== 1 || message.sourceId === sourceId) return;
      onMessage?.(clone(message));
    };
    if (channel) channel.onmessage = event => receive(event.data);
    const storageListener = event => {
      if (event.key !== SNAPSHOT_KEY || !event.newValue) return;
      try { receive(JSON.parse(event.newValue)); } catch (_) {}
    };
    window.addEventListener('storage', storageListener);
    return {
      sourceId,
      send(message, { mirror = false } = {}) {
        const envelope = { protocol: 1, sourceId, role, sentAt: Date.now(), ...clone(message) };
        channel?.postMessage(envelope);
        if (mirror) {
          try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(envelope)); } catch (_) {}
        }
        return envelope;
      },
      readLatest() {
        try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null'); } catch (_) { return null; }
      },
      close() {
        channel?.close();
        window.removeEventListener('storage', storageListener);
      },
    };
  }

  function savePendingNavigation(request) {
    try { localStorage.setItem(NAVIGATION_KEY, JSON.stringify({ ...clone(request), savedAt: Date.now() })); } catch (_) {}
  }

  function consumePendingNavigation(maxAgeMs = 120000) {
    try {
      const value = JSON.parse(localStorage.getItem(NAVIGATION_KEY) || 'null');
      localStorage.removeItem(NAVIGATION_KEY);
      if (!value || Date.now() - value.savedAt > maxAgeMs) return null;
      delete value.savedAt;
      return value;
    } catch (_) { return null; }
  }

  function loadCompanion(globalName, fileName, datasetKey) {
    if (!THIS_SCRIPT_URL || typeof document === 'undefined' || window[globalName]) return; // Node/VM protocol tests have no document and intentionally skip runtime UI/lighting integration.
    if (document.querySelector?.(`script[data-${datasetKey}]`)) return; // Game and Map Editor both host this transport; never inject the same companion twice.
    const script = document.createElement('script'); // Shared classic scripts can patch globals regardless whether they are assigned before or after they load.
    script.src = new URL(fileName, THIS_SCRIPT_URL).href;
    script.async = false;
    script.setAttribute(`data-${datasetKey}`, '1');
    script.onerror = () => console.error(`[MapLivePreview] Could not load ${fileName}.`);
    (document.head || document.documentElement)?.appendChild(script);
  }

  function loadPlacementCompanions() {
    loadCompanion('WallOrnamentPlacement', 'wall-ornament-placement.js?v=20260916wall1', 'wall-ornament-placement');
    loadCompanion('DaylightWindowRuntime', 'daylight-window-runtime.js?v=20260916window1', 'daylight-window-runtime');
    loadCompanion('__daylightWindowOverlaySchedulerLoaded', 'daylight-window-overlay-scheduler.js?v=20260916window1', 'daylight-window-overlay-scheduler');
  }

  function isMapEditorPage() {
    return typeof location !== 'undefined' && /\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname); // The editor creates its Three renderer lazily only after the user opens 3D mode.
  }

  function dockWallOrnamentPanel() {
    if (typeof document === 'undefined') return false;
    const bar = document.getElementById('gizmo3dBar'); // The bar is already hidden automatically whenever the editor leaves 3D mode.
    const panel = document.getElementById('wallOrnamentMapControls');
    if (!bar || !panel) return false;
    if (panel.parentElement !== bar) bar.appendChild(panel); // Keeps the panel inside the 3D-only gizmo host instead of after the full-height canvas where it was offscreen.
    panel.style.position = 'absolute';
    panel.style.right = '0';
    panel.style.top = 'calc(100% + 6px)';
    panel.style.width = 'min(430px, calc(100vw - 20px))';
    panel.style.maxWidth = '430px';
    panel.style.zIndex = '21';
    panel.style.margin = '0';
    panel.style.pointerEvents = 'auto';
    return true;
  }

  function scheduleWallPanelDock() {
    if (typeof window === 'undefined') return;
    let attempts = 0; // Finite retry spans async companion loading plus the wall module's own lazy Map Editor installer.
    const timer = window.setInterval(() => {
      attempts += 1;
      if (dockWallOrnamentPanel() || attempts >= 150) window.clearInterval(timer);
    }, 100);
  }

  function installMapEditorCompanionTrigger() {
    const button = document.getElementById('toggle3dBtn');
    const canvas3d = document.getElementById('canvas3d');
    if (!button) return;
    const ensureFor3d = () => {
      loadPlacementCompanions(); // Start the wall/daylight modules only after 3D exists, so their finite lazy-install windows cannot expire while the user is still editing in 2D.
      scheduleWallPanelDock();
    };
    button.addEventListener('click', () => window.setTimeout(ensureFor3d, 0)); // Base editor's click handler runs first and creates three3d.renderer synchronously.
    if (canvas3d?.classList.contains('active')) ensureFor3d(); // Supports editor restores or programmatic 3D activation before DOMContentLoaded.
  }

  window.MapLivePreview = {
    CHANNEL_NAME,
    SNAPSHOT_KEY,
    NAVIGATION_KEY,
    clone,
    classifyMapChanges,
    rootMapId,
    requestId,
    createEndpoint,
    savePendingNavigation,
    consumePendingNavigation,
  };

  if (isMapEditorPage() && typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMapEditorCompanionTrigger, { once: true });
    else installMapEditorCompanionTrigger();
  } else {
    loadPlacementCompanions(); // The running game needs placement + daylight integration during normal boot, not lazily behind a Map Editor control.
  }
})();
