(() => {
  'use strict';

  const CHANNEL_NAME = 'hobunji-map-live-preview-v1'; // Shared by the running game, standalone editor, and tools-hub iframe.
  const SNAPSHOT_KEY = 'hobunji_map_live_preview_v1'; // Reconnection-only preview envelope; never a canonical map/save source.
  const NAVIGATION_KEY = 'hobunji_map_editor_pending_navigation_v1'; // One-shot cold-start navigation request from the game.
  const SECTION_KEYS = ['metadata', 'terrain', 'elevation', 'navigation', 'transitions', 'stations', 'decor', 'furniture', 'buildings', 'layouts', 'structural'];

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
})();
