// building-door.js — the ONE place that turns a house piece's footprint
// into a single door tile. Loaded by both docs/game.js (the live game,
// town + zone buildings) and docs/tools/map-editor/index.html (the Building
// inspector) so a door can never be computed two different ways again —
// before this file existed each of those had its own hand-written copy of
// this exact geometry, and they could silently drift apart.
//
// A piece normally carries an authored single door point at
// footprint.door = {x, y} (piece-local grid coords, pre-rotation), placed
// once in House Piece Author's "Door" tool. Pieces that predate that tool
// fall back to deriveDoorLocal()'s old porch/south-edge-of-bbox heuristic
// (still needed as a default so an un-migrated or freshly-imported piece
// still gets a sane door instead of none).
//
// Plain script, no THREE.js dependency, no ES modules — same UMD-style
// window-global pattern as HousePieceGen.js, so it works whether the page
// loads three.js as a classic script (the live game) or via an import map
// (the tool suite).
(function (global) {
  'use strict';

  // House Editor's full-project export keeps the placeable document under
  // currentPiece, while older catalog entries are already flat piece JSON.
  // Accept both shapes at every shared building-data boundary.
  function normalizePieceData(pieceData) {
    return pieceData?.currentPiece && typeof pieceData.currentPiece === 'object'
      ? pieceData.currentPiece
      : pieceData;
  }

  function rotateCell(localX, localY, width, depth, rotationDeg) {
    const rot = ((Math.round((rotationDeg || 0) / 90) * 90) % 360 + 360) % 360;
    if (rot === 90)  return { x: localY, y: width - 1 - localX };
    if (rot === 180) return { x: width - 1 - localX, y: depth - 1 - localY };
    if (rot === 270) return { x: depth - 1 - localY, y: localX };
    return { x: localX, y: localY };
  }

  // All footprint-affecting cells (structural + extensions) for a piece.
  function footprintCells(pieceData) {
    pieceData = normalizePieceData(pieceData);
    return []
      .concat(pieceData?.footprint?.cells || [])
      .concat(pieceData?.footprint?.extensions?.entryTunnels || [])
      .concat(pieceData?.footprint?.extensions?.chimneys || [])
      .concat(pieceData?.footprint?.extensions?.porches || [])
      .concat(pieceData?.footprint?.extensions?.porchStairs || [])
      .concat(pieceData?.footprint?.extensions?.railings || []);
  }
  function porchCells(pieceData) {
    pieceData = normalizePieceData(pieceData);
    return []
      .concat(pieceData?.footprint?.extensions?.porches || [])
      .concat(pieceData?.footprint?.extensions?.porchStairs || []);
  }

  // Caches a piece's structural+porch cell geometry, building-local and
  // pre-rotation, normalized to a 0,0-based bbox — this is the shape stored
  // on a placed building instance as `doorEntrance` so the door's world
  // position can be recomputed from gridX/gridZ/rotationDeg alone, without
  // re-fetching the piece file. This is the old (pre-authored-door)
  // porch/south-edge derivation, kept as the fallback for pieces with no
  // footprint.door yet.
  function deriveDoorLocal(pieceData) {
    const allBldgCells = footprintCells(pieceData);
    if (!allBldgCells.length) return null;
    const psCells = porchCells(pieceData);
    const minX = Math.min(...allBldgCells.map(c => c.x));
    const minY = Math.min(...allBldgCells.map(c => c.y));
    const maxX = Math.max(...allBldgCells.map(c => c.x));
    const maxY = Math.max(...allBldgCells.map(c => c.y));
    return {
      bboxW: maxX - minX + 1,
      bboxD: maxY - minY + 1,
      cells: allBldgCells.map(c => ({ x: c.x - minX, y: c.y - minY })),
      psCells: psCells.map(c => ({ x: c.x - minX, y: c.y - minY })),
    };
  }

  // Same cached shape as deriveDoorLocal(), but preferring the piece's
  // single authored footprint.door point when present (re-anchored through
  // the same bbox so it rotates/translates identically to the geometric
  // fallback case). This is what callers should use.
  function resolveDoorEntrance(pieceData) {
    pieceData = normalizePieceData(pieceData);
    const derived = deriveDoorLocal(pieceData);
    const authored = pieceData?.footprint?.door;
    if (derived && authored && Number.isFinite(authored.x) && Number.isFinite(authored.y)) {
      const allBldgCells = footprintCells(pieceData);
      const minX = Math.min(...allBldgCells.map(c => c.x));
      const minY = Math.min(...allBldgCells.map(c => c.y));
      return { bboxW: derived.bboxW, bboxD: derived.bboxD, cells: [{ x: authored.x - minX, y: authored.y - minY }], psCells: [] };
    }
    return derived;
  }

  // Resolves a cached door-entrance shape (from resolveDoorEntrance/
  // deriveDoorLocal) through a building instance's placement
  // (gridX/gridZ/rotationDeg) into a world tile, using the exact
  // porch-first / world-south-fallback rule the game uses when no single
  // point was authored. `maxRow` (if finite) clamps the south-edge fallback
  // to the map's last row, matching the old per-caller row clamps.
  function doorWorldFromBuilding(doorEntrance, gridX, gridZ, rotationDeg, maxRow) {
    if (!doorEntrance || !doorEntrance.cells || !doorEntrance.cells.length) return null;
    const { bboxW, bboxD, cells, psCells } = doorEntrance;
    const rotDeg = rotationDeg || 0;
    const gx = gridX || 0, gz = gridZ || 0;
    const clampRow = Number.isFinite(maxRow) ? maxRow : Infinity;
    let wBMinC = Infinity, wBMaxC = -Infinity, wBMinR = Infinity, wBMaxR = -Infinity;
    for (const c of cells) {
      const r = rotateCell(c.x, c.y, bboxW, bboxD, rotDeg);
      const wc = gx + r.x, wr = gz + r.y;
      if (wc < wBMinC) wBMinC = wc; if (wc > wBMaxC) wBMaxC = wc;
      if (wr < wBMinR) wBMinR = wr; if (wr > wBMaxR) wBMaxR = wr;
    }
    let eCol, eRow;
    if (psCells && psCells.length) {
      let wPMinC = Infinity, wPMaxC = -Infinity, wPMinR = Infinity, wPMaxR = -Infinity;
      for (const c of psCells) {
        const r = rotateCell(c.x, c.y, bboxW, bboxD, rotDeg);
        const wc = gx + r.x, wr = gz + r.y;
        if (wc < wPMinC) wPMinC = wc; if (wc > wPMaxC) wPMaxC = wc;
        if (wr < wPMinR) wPMinR = wr; if (wr > wPMaxR) wPMaxR = wr;
      }
      eCol = Math.floor((wPMinC + wPMaxC + 1) / 2);
      const bldgCentroidR = (wBMinR + wBMaxR) / 2;
      const innerPorchR = Math.abs(wPMinR - bldgCentroidR) <= Math.abs(wPMaxR - bldgCentroidR) ? wPMinR : wPMaxR;
      eRow = Math.min(clampRow, innerPorchR);
    } else {
      eCol = Math.floor((wBMinC + wBMaxC + 1) / 2);
      eRow = Math.min(clampRow, wBMaxR + 1);
    }
    return { col: eCol, row: eRow, bbox: { minC: wBMinC, maxC: wBMaxC, minR: wBMinR, maxR: wBMaxR } };
  }

  // Returns the authored porch + porch-stair footprint as placed world tiles.
  // Uses deriveDoorLocal's normalized bbox so this is guaranteed to rotate and
  // translate the same way the shared door geometry does.
  function porchWorldCells(pieceData, gridX = 0, gridZ = 0, rotationDeg = 0) {
    const derived = deriveDoorLocal(pieceData); // Used as the normalized local porch geometry and rotation bbox.
    if (!derived?.psCells?.length) return [];
    return derived.psCells.map(cell => {
      const rotated = rotateCell(cell.x, cell.y, derived.bboxW, derived.bboxD, rotationDeg); // Used to place this porch cell in the building's rotated footprint.
      return { col: gridX + rotated.x, row: gridZ + rotated.y };
    });
  }

  // Piece-local (unrotated, unplaced) door point — used by House Piece
  // Author to seed/preview the default door position for a piece with no
  // authored door yet, and by the one-time migration script to backfill
  // footprint.door on every existing piece file.
  function computeDefaultDoorLocal(pieceData) {
    const geo = deriveDoorLocal(pieceData);
    if (!geo) return null;
    const world = doorWorldFromBuilding(geo, 0, 0, 0, Infinity);
    return world ? { x: world.col, y: world.row } : null;
  }

  // ── Live-game porch surface integration ──────────────────────────
  // BuildingDoor is loaded before the town-building and audio modules in the
  // live game, so it is the one shared place that can turn the exact authored
  // porch geometry into both rendering suppression (no grass through boards)
  // and footstep surface semantics (porches use the old procedural hard-step).
  // Tool pages do not install these runtime hooks.
  let _runtimeTownBuildingDeps = null; // Used to read the live town scene/building groups and write porch diagnostics after TownZoneBuildings.init().
  let _runtimeAudioDeps = null; // Used to resolve TILE/TileType/building-area semantics after AudioSystem.init().
  let _runtimePorchTileKeys = new Set(); // Used as the authoritative live-town set of "col,row" porch + stair cells.
  let _runtimePorchTileObjects = new WeakSet(); // Used to carry porch classification from footstepTileAt() to playFootstepSfx() without mutating grid data.
  let _runtimeLastPorchSignature = ''; // Used to avoid repeating the same porch/grass summary in the debug log on delayed refreshes.
  let _runtimeHardStepLogged = false; // Used to log the restored procedural hard-surface voice only once per session.

  function _runtimeDebugLog(message, level = 'info') {
    const injectedLog = _runtimeTownBuildingDeps?.debugLog; // Used to feed the existing in-game debug panel when the town module has initialized.
    if (typeof injectedLog === 'function') { injectedLog(message, level); return; }
    if (typeof global.debugLog === 'function') { global.debugLog(message, level); return; }
    if (level === 'warn') console.warn(message); else console.info(message);
  }

  function _suppressRuntimeGrassUnderPorches() {
    const townScene = _runtimeTownBuildingDeps?.getTownScene?.(); // Used as the scene containing the town's grass InstancedMesh billboards.
    if (!townScene || !global.THREE || !_runtimePorchTileKeys.size) return 0;
    const matrix = new global.THREE.Matrix4(); // Used to inspect and zero matching grass instance transforms in place.
    const zeroScale = new global.THREE.Vector3(0, 0, 0); // Used to hide a grass blade without rebuilding or reallocating its InstancedMesh.
    let hiddenInstances = 0; // Used for porch-render diagnostics and to confirm grass was actually suppressed.

    townScene.traverse(obj => {
      if (!obj?.isInstancedMesh || !obj.userData?.isBillboard) return;
      let changed = false; // Used to avoid marking untouched instance buffers dirty.
      for (let i = 0; i < obj.count; i++) {
        obj.getMatrixAt(i, matrix);
        const col = Math.floor(matrix.elements[12]); // Used to map this billboard instance's world X back to its town tile column.
        const row = Math.floor(matrix.elements[14]); // Used to map this billboard instance's world Z back to its town tile row.
        if (!_runtimePorchTileKeys.has(`${col},${row}`)) continue;
        matrix.scale(zeroScale);
        obj.setMatrixAt(i, matrix);
        hiddenInstances++;
        changed = true;
      }
      if (changed) obj.instanceMatrix.needsUpdate = true;
    });
    return hiddenInstances;
  }

  function _refreshRuntimePorchSurfaces() {
    const groups = _runtimeTownBuildingDeps?.getTownBuildingGroups?.() || []; // Used as the loaded piece+placement source for exact porch world cells.
    const nextKeys = new Set(); // Used to replace the porch registry atomically after each async building-load pass.
    for (const entry of groups) {
      if (!entry?.piece || !entry?.bldg) continue;
      const rotationDeg = entry.bldg.rotationDeg || entry.bldg.rotation || 0; // Used to match the rotation passed into HousePieceGen for this building.
      for (const cell of porchWorldCells(entry.piece, entry.bldg.gridX || 0, entry.bldg.gridZ || 0, rotationDeg)) {
        nextKeys.add(`${cell.col},${cell.row}`);
      }
    }
    _runtimePorchTileKeys = nextKeys;
    _runtimePorchTileObjects = new WeakSet();
    const hiddenInstances = _suppressRuntimeGrassUnderPorches(); // Used to hide any grass billboard instances already built beneath the refreshed porch set.
    const signature = [...nextKeys].sort().join('|'); // Used to suppress duplicate debug messages from the delayed async refresh sequence.
    if (signature && signature !== _runtimeLastPorchSignature) {
      _runtimeLastPorchSignature = signature;
      _runtimeDebugLog(`[porch] ${nextKeys.size} porch/stair tile(s) registered; ${hiddenInstances} grass billboard instance(s) hidden.`);
    }
  }

  function _scheduleRuntimePorchRefresh() {
    // Piece JSON and GLB upgrades are asynchronous. Re-running this cheap
    // registry/suppression pass across their normal completion window keeps
    // both first-load and rebuilt town scenes correct without polling forever.
    for (const delayMs of [0, 50, 250, 1000, 2500]) setTimeout(_refreshRuntimePorchSurfaces, delayMs);
  }

  function _wrapTownZoneBuildings(system) {
    if (!system || system.__buildingDoorPorchRuntimeWrapped) return system;
    const originalInit = system.init; // Used to preserve TownZoneBuildings' own dependency initialization while retaining those deps for porch integration.
    if (typeof originalInit === 'function') {
      system.init = function (injectedDeps) {
        _runtimeTownBuildingDeps = injectedDeps;
        const result = originalInit.call(this, injectedDeps); // Used to preserve the module's existing initialization return value/behavior.
        _scheduleRuntimePorchRefresh();
        return result;
      };
    }
    const originalSpawnTownBuildings = system.spawnTownBuildings; // Used to run the existing async building spawn before scheduling porch registration/grass suppression.
    if (typeof originalSpawnTownBuildings === 'function') {
      system.spawnTownBuildings = function (...args) {
        const result = originalSpawnTownBuildings.apply(this, args); // Used to preserve the original building-spawn behavior and return value.
        _scheduleRuntimePorchRefresh();
        return result;
      };
    }
    Object.defineProperty(system, '__buildingDoorPorchRuntimeWrapped', { value: true, configurable: true });
    return system;
  }

  function _withProceduralGravel(audioSystem, callback) {
    const audioCfg = audioSystem.gameAudioConfig?.(); // Used to temporarily mask the configured gravel recordings for exactly one hard-surface footfall.
    const footstepCfg = audioCfg?.footsteps; // Used as the existing footstep configuration object consumed synchronously by playFootstepSfx().
    if (!footstepCfg) return callback();
    const hadSurfaces = Object.prototype.hasOwnProperty.call(footstepCfg, 'surfaces'); // Used to restore the config shape exactly after playback.
    const surfaces = footstepCfg.surfaces || {}; // Used as the temporary surface-map container when a config omitted one.
    const hadGravel = Object.prototype.hasOwnProperty.call(surfaces, 'gravel'); // Used to restore/delete the gravel entry exactly after playback.
    const originalGravel = surfaces.gravel; // Used to restore the configured real gravel recordings after the procedural call returns.
    try {
      if (!hadSurfaces) footstepCfg.surfaces = surfaces;
      surfaces.gravel = { ...(originalGravel || {}), urls: [] };
    } catch (error) {
      _runtimeDebugLog('[footsteps] Could not switch hard-surface step to procedural fallback: ' + error.message, 'warn');
      return callback();
    }
    try {
      return callback();
    } finally {
      try {
        if (hadGravel) surfaces.gravel = originalGravel;
        else delete surfaces.gravel;
        if (!hadSurfaces) delete footstepCfg.surfaces;
      } catch (_) {}
    }
  }

  function _wrapAudioSystem(system) {
    if (!system || system.__buildingDoorHardSurfaceRuntimeWrapped) return system;
    const originalInit = system.init; // Used to preserve AudioSystem initialization while retaining TILE/TileType/building-area deps for surface classification.
    if (typeof originalInit === 'function') {
      system.init = function (injectedDeps) {
        _runtimeAudioDeps = injectedDeps;
        return originalInit.call(this, injectedDeps);
      };
    }

    const originalFootstepTileAt = system.footstepTileAt; // Used to preserve normal tile lookup while tagging exact town porch tiles by object identity.
    if (typeof originalFootstepTileAt === 'function') {
      system.footstepTileAt = function (area, wx, wy, grid) {
        const tile = originalFootstepTileAt.call(this, area, wx, wy, grid); // Used as the unchanged terrain/moisture tile returned to existing callers.
        if (tile && area === 'town' && _runtimeAudioDeps?.TILE > 0) {
          const col = Math.floor(wx / _runtimeAudioDeps.TILE); // Used to compare this footfall's town column against the authored porch registry.
          const row = Math.floor(wy / _runtimeAudioDeps.TILE); // Used to compare this footfall's town row against the authored porch registry.
          if (_runtimePorchTileKeys.has(`${col},${row}`)) _runtimePorchTileObjects.add(tile);
        }
        return tile;
      };
    }

    const originalPlayFootstepSfx = system.playFootstepSfx; // Used as the real footstep engine; wrapper only selects when its existing synth fallback should win.
    if (typeof originalPlayFootstepSfx === 'function') {
      system.playFootstepSfx = function (area, tile, volumeScale = 1, pan = 0, opts = {}) {
        const TileType = _runtimeAudioDeps?.TileType; // Used to identify authored PATH/optional PLAZA tiles without duplicating numeric tile ids.
        const isInteriorFloor = area === 'interior'
          || !!(_runtimeAudioDeps && _runtimeAudioDeps._isBuildingArea?.(area)); // Used to apply the requested procedural hard step to every building/interior floor.
        const isPath = !!TileType && (tile?.type === TileType.PATH || (TileType.PLAZA != null && tile?.type === TileType.PLAZA)); // Used to apply the requested procedural hard step to path/plaza terrain only, leaving other gravel-mapped terrain recordings alone.
        const isPorch = !!tile && _runtimePorchTileObjects.has(tile); // Used to override a porch's underlying grass tile with hard-surface audio semantics.
        if (!isInteriorFloor && !isPath && !isPorch) return originalPlayFootstepSfx.call(this, area, tile, volumeScale, pan, opts);

        const effectiveTile = isPorch && TileType ? { ...tile, type: TileType.PATH } : tile; // Used so porch grass resolves through AudioSystem's existing gravel/hard-surface post-FX while retaining its moisture field.
        if (!_runtimeHardStepLogged) {
          _runtimeHardStepLogged = true;
          _runtimeDebugLog('[footsteps] Restored procedural hard-surface voice for paths, porches, and interior floors.');
        }
        return _withProceduralGravel(system, () => originalPlayFootstepSfx.call(this, area, effectiveTile, volumeScale, pan, opts));
      };
    }

    // The module's internal heavy-landing helper closes over its original
    // playFootstepSfx, so route the public heavy landing through the wrapped
    // public function as well; otherwise a dodge landing on a porch/path would
    // unexpectedly switch back to the recorded gravel clip.
    if (typeof system.playHeavyLandingSfx === 'function') {
      system.playHeavyLandingSfx = function (area, tile) {
        return system.playFootstepSfx(area, tile, 2.0, 0, { heavy: true });
      };
    }

    Object.defineProperty(system, '__buildingDoorHardSurfaceRuntimeWrapped', { value: true, configurable: true });
    return system;
  }

  // BuildingDoor must tolerate either script order: if a live-game system is
  // already present, wrap it now; otherwise intercept its first assignment,
  // wrap synchronously, then restore an ordinary writable global property.
  function _wrapRuntimeGlobalWhenAssigned(name, wrapper) {
    const existing = global[name]; // Used to support pages where the target module loaded before BuildingDoor.
    if (existing) { wrapper(existing); return; }
    let assignedValue; // Used as temporary storage until the target module assigns its window global.
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: true,
        get() { return assignedValue; },
        set(value) {
          assignedValue = wrapper(value) || value;
          Object.defineProperty(global, name, {
            configurable: true, enumerable: true, writable: true, value: assignedValue,
          });
        },
      });
    } catch (_) {}
  }

  // The game loads HousePieceGen before this module, and the Map Editor loads
  // RepoPicker before it. Wrap both existing APIs once so full House Editor
  // project exports behave exactly like flat pieces without changing callers.
  function installProjectExportCompatibility() {
    const housePieceGen = global.HousePieceGen;
    if (housePieceGen?.buildGroupFromPiece && !housePieceGen.buildGroupFromPiece.acceptsHouseEditorProject) {
      const originalBuild = housePieceGen.buildGroupFromPiece;
      const wrappedBuild = function (THREE, pieceData, ...args) {
        return originalBuild.call(this, THREE, normalizePieceData(pieceData), ...args);
      };
      wrappedBuild.acceptsHouseEditorProject = true;
      housePieceGen.buildGroupFromPiece = wrappedBuild;
    }

    const pickerProto = global.RepoPicker?.prototype;
    if (pickerProto?.makePicker && !pickerProto.makePicker.acceptsHouseEditorProject) {
      const originalMakePicker = pickerProto.makePicker;
      const wrappedMakePicker = function (opts) {
        if (opts?.category === 'housePieces' && typeof opts.onLoad === 'function') {
          const originalOnLoad = opts.onLoad;
          opts = {
            ...opts,
            onLoad(entry, pieceData) {
              return originalOnLoad(entry, normalizePieceData(pieceData));
            },
          };
        }
        return originalMakePicker.call(this, opts);
      };
      wrappedMakePicker.acceptsHouseEditorProject = true;
      pickerProto.makePicker = wrappedMakePicker;
    }
  }

  global.BuildingDoor = {
    normalizePieceData, rotateCell, footprintCells, porchCells, porchWorldCells,
    deriveDoorLocal, resolveDoorEntrance, doorWorldFromBuilding, computeDefaultDoorLocal,
  };
  installProjectExportCompatibility();

  const isToolPage = typeof document !== 'undefined' && /\/tools\//.test(location.pathname); // Used to keep live-game surface hooks completely out of the authoring tools.
  if (typeof document !== 'undefined' && !isToolPage) {
    _wrapRuntimeGlobalWhenAssigned('TownZoneBuildings', _wrapTownZoneBuildings);
    _wrapRuntimeGlobalWhenAssigned('AudioSystem', _wrapAudioSystem);
  }
})(typeof window !== 'undefined' ? window : this);

// Editor-only companion controllers. The live game also loads this shared
// geometry module, so gate all tool behavior to the Map Editor URL.
if (typeof document !== 'undefined'
    && /\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) {
  if (!document.querySelector('script[data-map-editor-building-entrances]')) {
    const entrancesScript = document.createElement('script');
    entrancesScript.src = '../../js/map-editor-building-entrances.js';
    entrancesScript.dataset.mapEditorBuildingEntrances = '1';
    document.head.appendChild(entrancesScript);
  }
  if (!document.querySelector('script[data-map-editor-export-fixes]')) {
    const exportScript = document.createElement('script');
    exportScript.src = '../../js/map-editor-export-fixes.js';
    exportScript.dataset.mapEditorExportFixes = '1';
    document.head.appendChild(exportScript);
  }
  if (!document.querySelector('script[data-map-editor-interior-instance-sync]')) {
    const interiorSyncScript = document.createElement('script');
    interiorSyncScript.src = '../../js/map-editor-interior-instance-sync.js';
    interiorSyncScript.dataset.mapEditorInteriorInstanceSync = '1';
    document.head.appendChild(interiorSyncScript);
  }
}
