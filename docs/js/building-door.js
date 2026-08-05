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
    normalizePieceData, rotateCell, footprintCells, porchCells,
    deriveDoorLocal, resolveDoorEntrance, doorWorldFromBuilding, computeDefaultDoorLocal,
  };
  installProjectExportCompatibility();
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
}
