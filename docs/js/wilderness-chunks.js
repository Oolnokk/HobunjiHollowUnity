(() => {
  'use strict';

  // Finite wilderness-zone streaming. The Tothal generator remains the
  // deterministic owner of each complete 200x200 tile blueprint; this module
  // makes 16x16 tile chunks the owner of expensive runtime scene objects.
  // A chunk can therefore be rebuilt from the live grid after a tile edit and
  // discarded when it is outside the player's unload radius without changing
  // maps, landmarks, fog-of-war, routes, or save data.
  const CHUNK_TILES = 16; // Used to convert tile coordinates into stable chunk keys and bounds.
  const IMMEDIATE_RADIUS = 1; // Used to synchronously prime a safe 3x3 arrival neighborhood behind a black transition.
  const LOAD_RADIUS = 2; // Used to stream a 5x5 neighborhood around the player's current chunk.
  const UNLOAD_RADIUS = 3; // Used as hysteresis so crossing a chunk edge does not immediately destroy the previous ring.
  const INACTIVE_UNLOAD_DELAY_S = 4; // Used to free a wilderness scene after the player remains in another area.
  const MAX_STREAM_BUILDS_PER_UPDATE = 1; // Used to spread outer-ring construction across frames.
  const DEBUG_REFRESH_MS = 250; // Used to keep mobile diagnostic text inexpensive.

  let deps = null; // Receives the current-area/player accessors supplied by game.js.
  const zones = new Map(); // Stores one ZoneChunkController per built wilderness map.
  let debugVisible = false; // Controls the optional in-world chunk cages and fixed diagnostic overlay.
  let lastDebugRefreshAt = 0; // Throttles DOM diagnostic updates.

  function init(injectedDeps) {
    deps = injectedDeps;
    wireDebugUi();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function chunkKey(cx, cz) {
    return cx + ',' + cz;
  }

  function tileToChunk(tile) {
    return Math.floor(Number(tile) / CHUNK_TILES);
  }

  function parseChunkKey(key) {
    const pair = String(key).split(',').map(Number);
    return { cx: pair[0], cz: pair[1] };
  }

  function chebyshev(ax, az, bx, bz) {
    return Math.max(Math.abs(ax - bx), Math.abs(az - bz));
  }

  function disposeTaggedChunkObjects(group) {
    group?.traverse?.(object => {
      if (object.userData?.wildernessChunkOwnsGeometry) object.geometry?.dispose?.();
      if (object.userData?.wildernessChunkOwnsMaterial) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          material?.map?.dispose?.();
          for (const uniform of Object.values(material?.uniforms || {})) {
            if (uniform?.value?.isTexture) uniform.value.dispose?.();
          }
          material?.dispose?.();
        }
      }
      if (object.userData?.mergedWaterStatKey) {
        window.MergedWaterRenderer?.clearStats?.(object.userData.mergedWaterStatKey);
      }
    });
  }

  function makeDebugCage(record, isPlayerChunk) {
    if (!debugVisible || !window.THREE || record.debugCage) return;
    const width = record.bounds.colEnd - record.bounds.colStart;
    const depth = record.bounds.rowEnd - record.bounds.rowStart;
    const box = new THREE.BoxGeometry(width, 32, depth);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const material = new THREE.LineBasicMaterial({
      color: isPlayerChunk ? 0xffd54a : 0x46e58b,
      transparent: true,
      opacity: isPlayerChunk ? 0.95 : 0.5,
      depthTest: false,
    });
    const cage = new THREE.LineSegments(edges, material);
    cage.name = 'WildernessChunkDebug_' + record.key;
    cage.position.set(
      (record.bounds.colStart + record.bounds.colEnd) * 0.5,
      15,
      (record.bounds.rowStart + record.bounds.rowEnd) * 0.5
    );
    cage.renderOrder = 10000;
    cage.userData.wildernessChunkDebug = true;
    cage.userData.wildernessChunkOwnsGeometry = true;
    cage.userData.wildernessChunkOwnsMaterial = true;
    record.group.add(cage);
    record.debugCage = cage;
  }

  function removeDebugCage(record) {
    if (!record?.debugCage) return;
    record.group.remove(record.debugCage);
    record.debugCage.geometry?.dispose?.();
    record.debugCage.material?.dispose?.();
    record.debugCage = null;
  }

  function updateDebugCage(record, isPlayerChunk) {
    if (!debugVisible) {
      removeDebugCage(record);
      return;
    }
    makeDebugCage(record, isPlayerChunk);
    const material = record.debugCage?.material;
    if (!material) return;
    material.color.setHex(isPlayerChunk ? 0xffd54a : 0x46e58b);
    material.opacity = isPlayerChunk ? 0.95 : 0.5;
  }

  class ZoneChunkController {
    constructor(config) {
      this.mapId = config.mapId;
      this.scene = config.scene;
      this.cols = config.cols;
      this.rows = config.rows;
      this.buildChunk = config.buildChunk;
      this.disposeChunk = config.disposeChunk || (record => disposeTaggedChunkObjects(record.group));
      this.onChunkLoaded = config.onChunkLoaded || null;
      this.onChunkUnloaded = config.onChunkUnloaded || null;
      this.loaded = new Map(); // Holds only currently resident THREE scene chunks.
      this.queue = new Map(); // Holds requested-but-not-yet-built chunk coordinates.
      this.centerCx = null;
      this.centerCz = null;
      this.inactiveSeconds = 0;
      this.builds = 0;
      this.unloads = 0;
      this.rebuilds = 0;
      this.totalBuildMs = 0;
      this.lastBuildMs = 0;
      this.maxCx = Math.max(0, Math.ceil(this.cols / CHUNK_TILES) - 1);
      this.maxCz = Math.max(0, Math.ceil(this.rows / CHUNK_TILES) - 1);
    }

    validChunk(cx, cz) {
      return cx >= 0 && cz >= 0 && cx <= this.maxCx && cz <= this.maxCz;
    }

    boundsFor(cx, cz) {
      return {
        colStart: cx * CHUNK_TILES,
        rowStart: cz * CHUNK_TILES,
        colEnd: Math.min(this.cols, (cx + 1) * CHUNK_TILES),
        rowEnd: Math.min(this.rows, (cz + 1) * CHUNK_TILES),
      };
    }

    enqueue(cx, cz, distance) {
      if (!this.validChunk(cx, cz)) return;
      const key = chunkKey(cx, cz);
      if (this.loaded.has(key)) return;
      const existing = this.queue.get(key);
      if (!existing || distance < existing.distance) this.queue.set(key, { key, cx, cz, distance });
    }

    enqueueNeighborhood(centerCx, centerCz) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
          const distance = Math.max(Math.abs(dx), Math.abs(dz));
          this.enqueue(centerCx + dx, centerCz + dz, distance);
        }
      }
    }

    load(cx, cz) {
      if (!this.validChunk(cx, cz)) return null;
      const key = chunkKey(cx, cz);
      if (this.loaded.has(key)) return this.loaded.get(key);
      this.queue.delete(key);
      const bounds = this.boundsFor(cx, cz);
      const group = new THREE.Group();
      group.name = 'WildernessChunk_' + this.mapId + '_' + cx + '_' + cz;
      group.userData.wildernessChunk = true;
      group.userData.wildernessChunkMapId = this.mapId;
      group.userData.wildernessChunkX = cx;
      group.userData.wildernessChunkZ = cz;
      group.userData.wildernessChunkBounds = bounds;
      this.scene.add(group);
      const startedAt = performance.now();
      try {
        const payload = this.buildChunk({ mapId: this.mapId, key, cx, cz, bounds, group }) || {};
        const buildMs = performance.now() - startedAt;
        const record = { key, cx, cz, bounds, group, payload, buildMs, loadedAt: performance.now(), debugCage: null };
        this.loaded.set(key, record);
        this.builds++;
        this.lastBuildMs = buildMs;
        this.totalBuildMs += buildMs;
        this.onChunkLoaded?.(record);
        updateDebugCage(record, cx === this.centerCx && cz === this.centerCz);
        return record;
      } catch (error) {
        this.scene.remove(group);
        disposeTaggedChunkObjects(group);
        console.error('[wilderness-chunks] failed ' + this.mapId + ' ' + key, error);
        window.__farmLog?.('[wilderness-chunks] failed ' + this.mapId + ' ' + key + ': ' + error.message, 'warn');
        return null;
      }
    }

    unload(key) {
      const record = this.loaded.get(key);
      if (!record) return false;
      this.onChunkUnloaded?.(record);
      this.disposeChunk(record);
      this.scene.remove(record.group);
      record.group.clear?.();
      this.loaded.delete(key);
      this.unloads++;
      return true;
    }

    unloadOutside(centerCx, centerCz) {
      for (const [key, record] of [...this.loaded]) {
        if (chebyshev(record.cx, record.cz, centerCx, centerCz) > UNLOAD_RADIUS) this.unload(key);
      }
      for (const [key, request] of [...this.queue]) {
        if (chebyshev(request.cx, request.cz, centerCx, centerCz) > LOAD_RADIUS) this.queue.delete(key);
      }
    }

    unloadAll() {
      this.queue.clear();
      for (const key of [...this.loaded.keys()]) this.unload(key);
      this.centerCx = null;
      this.centerCz = null;
    }

    setCenter(col, row) {
      const centerCx = clamp(tileToChunk(col), 0, this.maxCx);
      const centerCz = clamp(tileToChunk(row), 0, this.maxCz);
      const changed = centerCx !== this.centerCx || centerCz !== this.centerCz;
      this.centerCx = centerCx;
      this.centerCz = centerCz;
      this.enqueueNeighborhood(centerCx, centerCz);
      this.unloadOutside(centerCx, centerCz);
      if (changed) {
        for (const record of this.loaded.values()) {
          updateDebugCage(record, record.cx === centerCx && record.cz === centerCz);
        }
      }
    }

    prime(col, row) {
      this.inactiveSeconds = 0;
      this.setCenter(col, row);
      const requests = [];
      for (let dz = -IMMEDIATE_RADIUS; dz <= IMMEDIATE_RADIUS; dz++) {
        for (let dx = -IMMEDIATE_RADIUS; dx <= IMMEDIATE_RADIUS; dx++) {
          const cx = this.centerCx + dx;
          const cz = this.centerCz + dz;
          if (!this.validChunk(cx, cz)) continue;
          requests.push({ cx, cz, distance: Math.max(Math.abs(dx), Math.abs(dz)) });
        }
      }
      requests.sort((a, b) => a.distance - b.distance || a.cz - b.cz || a.cx - b.cx);
      for (const request of requests) this.load(request.cx, request.cz);
      this.enqueueNeighborhood(this.centerCx, this.centerCz);
      refreshDebugText(true);
      return this;
    }

    updateActive(col, row) {
      this.inactiveSeconds = 0;
      this.setCenter(col, row);
      const queue = [...this.queue.values()]
        .sort((a, b) => a.distance - b.distance || a.cz - b.cz || a.cx - b.cx);
      for (let i = 0; i < Math.min(MAX_STREAM_BUILDS_PER_UPDATE, queue.length); i++) {
        this.load(queue[i].cx, queue[i].cz);
      }
    }

    updateInactive(dt) {
      this.inactiveSeconds += Math.max(0, Number(dt) || 0);
      if (this.inactiveSeconds >= INACTIVE_UNLOAD_DELAY_S && this.loaded.size) this.unloadAll();
    }

    rebuild(col = null, row = null) {
      let keys;
      if (Number.isFinite(col) && Number.isFinite(row)) {
        const targetCx = tileToChunk(col);
        const targetCz = tileToChunk(row);
        keys = [...this.loaded.values()]
          .filter(record => chebyshev(record.cx, record.cz, targetCx, targetCz) <= 1)
          .map(record => record.key);
      } else {
        keys = [...this.loaded.keys()];
      }
      const coords = keys.map(parseChunkKey);
      for (const key of keys) this.unload(key);
      coords.sort((a, b) =>
        chebyshev(a.cx, a.cz, this.centerCx, this.centerCz) -
        chebyshev(b.cx, b.cz, this.centerCx, this.centerCz)
      );
      for (const coord of coords) this.load(coord.cx, coord.cz);
      this.rebuilds += coords.length;
      refreshDebugText(true);
      return coords.length;
    }

    attachObject(col, row, object) {
      const record = this.loaded.get(chunkKey(tileToChunk(col), tileToChunk(row)));
      if (!record || !object) return false;
      record.group.add(object);
      return true;
    }

    snapshot() {
      return {
        mapId: this.mapId,
        chunkTiles: CHUNK_TILES,
        center: this.centerCx == null ? null : { x: this.centerCx, z: this.centerCz },
        loaded: this.loaded.size,
        queued: this.queue.size,
        builds: this.builds,
        unloads: this.unloads,
        rebuilds: this.rebuilds,
        lastBuildMs: Number(this.lastBuildMs.toFixed(2)),
        averageBuildMs: this.builds ? Number((this.totalBuildMs / this.builds).toFixed(2)) : 0,
        loadRadius: LOAD_RADIUS,
        unloadRadius: UNLOAD_RADIUS,
        immediateRadius: IMMEDIATE_RADIUS,
      };
    }
  }

  function createZone(config) {
    destroyZone(config.mapId);
    const controller = new ZoneChunkController(config);
    zones.set(config.mapId, controller);
    if (Number.isFinite(config.focusCol) && Number.isFinite(config.focusRow)) {
      controller.prime(config.focusCol, config.focusRow);
    }
    refreshDebugText(true);
    return controller;
  }

  function destroyZone(mapId) {
    const controller = zones.get(mapId);
    if (!controller) return false;
    controller.unloadAll();
    zones.delete(mapId);
    refreshDebugText(true);
    return true;
  }

  function primeZone(mapId, col, row) {
    return zones.get(mapId)?.prime(col, row) || null;
  }

  function rebuildZone(mapId, col = null, row = null) {
    return zones.get(mapId)?.rebuild(col, row) || 0;
  }

  function attachObject(mapId, col, row, object) {
    return zones.get(mapId)?.attachObject(col, row, object) || false;
  }

  function update(dt) {
    if (!deps) return;
    const area = deps.getCurrentArea?.();
    const active = deps.isZoneArea?.(area) ? zones.get(area) : null;
    const player = deps.player;
    for (const controller of zones.values()) {
      if (controller === active && player) {
        controller.updateActive(player.x / deps.TILE, player.y / deps.TILE);
      } else {
        controller.updateInactive(dt);
      }
    }
    refreshDebugText(false);
  }

  function snapshot() {
    return {
      chunkTiles: CHUNK_TILES,
      loadRadius: LOAD_RADIUS,
      unloadRadius: UNLOAD_RADIUS,
      debugVisible,
      activeArea: deps?.getCurrentArea?.() || null,
      zones: [...zones.values()].map(controller => controller.snapshot()),
    };
  }

  function ensureDebugOverlay() {
    let overlay = document.getElementById('wildernessChunkDebugOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('pre');
    overlay.id = 'wildernessChunkDebugOverlay';
    overlay.style.cssText = [
      'position:fixed', 'left:8px', 'top:8px', 'z-index:100000',
      'margin:0', 'padding:7px 9px', 'max-width:min(90vw,420px)',
      'background:rgba(4,10,8,.88)', 'border:1px solid rgba(70,229,139,.7)',
      'border-radius:6px', 'color:#dfffea', 'font:11px/1.35 ui-monospace,monospace',
      'pointer-events:none', 'white-space:pre-wrap',
    ].join(';');
    document.body.appendChild(overlay);
    return overlay;
  }

  function debugLines() {
    const data = snapshot();
    const lines = [
      'Wilderness chunks: ' + CHUNK_TILES + 'x' + CHUNK_TILES + ' tiles',
      'active=' + (data.activeArea || '(none)') + ' load=' + LOAD_RADIUS + ' unload=' + UNLOAD_RADIUS,
    ];
    const persisted = window.__wildernessChunkPersistenceDebug?.(); // Adds save-state coverage to the mobile status panel.
    if (persisted) {
      lines.push('saved year=' + persisted.year + ' chunks=' + persisted.chunks + ' editedTiles=' + persisted.editedTiles);
    }
    for (const zone of data.zones) {
      const center = zone.center ? zone.center.x + ',' + zone.center.z : '-';
      lines.push(
        zone.mapId + ': center=' + center +
        ' loaded=' + zone.loaded + ' queued=' + zone.queued +
        ' last=' + zone.lastBuildMs + 'ms avg=' + zone.averageBuildMs + 'ms'
      );
    }
    return lines.join('\n');
  }

  function refreshDebugText(force) {
    const now = performance.now();
    if (!force && now - lastDebugRefreshAt < DEBUG_REFRESH_MS) return;
    lastDebugRefreshAt = now;
    const text = debugLines();
    const status = document.getElementById('wildernessChunkStatus');
    if (status) status.textContent = text;
    const overlay = document.getElementById('wildernessChunkDebugOverlay');
    if (overlay) {
      overlay.textContent = text;
      overlay.style.display = debugVisible ? 'block' : 'none';
    }
  }

  function toggleDebug(force = !debugVisible) {
    debugVisible = !!force;
    const overlay = ensureDebugOverlay();
    overlay.style.display = debugVisible ? 'block' : 'none';
    for (const controller of zones.values()) {
      for (const record of controller.loaded.values()) {
        updateDebugCage(record, record.cx === controller.centerCx && record.cz === controller.centerCz);
      }
    }
    const button = document.getElementById('wildernessChunkDebugBtn');
    if (button) button.textContent = debugVisible ? 'Hide Chunk Grid' : 'Show Chunk Grid';
    refreshDebugText(true);
    return debugVisible;
  }

  function wireDebugUi() {
    const button = document.getElementById('wildernessChunkDebugBtn');
    if (button && !button.dataset.wildernessChunksBound) {
      button.dataset.wildernessChunksBound = 'true';
      button.addEventListener('click', () => toggleDebug());
    }
    refreshDebugText(true);
  }

  window.WildernessChunks = {
    init,
    createZone,
    destroyZone,
    primeZone,
    rebuildZone,
    attachObject,
    update,
    snapshot,
    toggleDebug,
    constants: Object.freeze({
      CHUNK_TILES,
      IMMEDIATE_RADIUS,
      LOAD_RADIUS,
      UNLOAD_RADIUS,
      INACTIVE_UNLOAD_DELAY_S,
    }),
  };
  window.__wildernessChunksDebug = snapshot;
})();
