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

  // The uploaded Inn project is a newer authoring export than the flat runtime
  // catalog entry currently at config/pieces/inn.json. Keep the stable catalog
  // path used by the town map, but upgrade that one fetch in memory with the
  // uploaded entry-tunnel/chimney faces and authored door. All other fetches
  // pass through untouched.
  function installInnRuntimeOverride() {
    if (typeof global.fetch !== 'function' || global.fetch.hobunjiInnRuntimeOverride) return;
    const originalFetch = global.fetch.bind(global); // Used for every normal request and as the base Inn response.
    const compressedPatchBase64 = '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'; // Gzip+base64 of the uploaded Inn's runtime-only delta.
    let patchPromise = null; // Lazily decoded once, then shared by every Inn request in the session.

    function isInnPieceRequest(input) {
      const url = typeof input === 'string' ? input : input?.url;
      return /(?:^|\/)config\/pieces\/inn\.json(?:[?#]|$)/i.test(String(url || ''));
    }

    function decodePatch() {
      if (patchPromise) return patchPromise;
      patchPromise = (async () => {
        if (typeof global.DecompressionStream !== 'function') throw new Error('DecompressionStream is unavailable');
        const binary = global.atob(compressedPatchBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const stream = new Blob([bytes]).stream().pipeThrough(new global.DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text());
      })();
      return patchPromise;
    }

    function applyInnPatch(documentData, patch) {
      const piece = normalizePieceData(documentData);
      if (!piece || piece.id !== 'd5c0f6cb-2992-4fdc-acba-90de9eab6159') return documentData;
      piece.footprint = piece.footprint || {};
      piece.footprint.extensions = JSON.parse(JSON.stringify(patch.footprint?.extensions || {}));
      piece.footprint.door = JSON.parse(JSON.stringify(patch.footprint?.door || null));
      piece.base = piece.base || {};
      const faces = Array.isArray(piece.base.faces) ? piece.base.faces : [];
      const faceIds = new Set(faces.map(face => String(face?.id))); // Prevents duplicate generated extension faces if a future flat Inn already includes them.
      for (const face of (patch.appendFaces || [])) {
        if (faceIds.has(String(face?.id))) continue;
        faces.push(JSON.parse(JSON.stringify(face)));
        faceIds.add(String(face?.id));
      }
      piece.base.faces = faces;
      piece.extensionGeneration = JSON.parse(JSON.stringify(patch.extensionGeneration || {}));
      return documentData;
    }

    const wrappedFetch = async function (input, init) {
      const response = await originalFetch(input, init);
      if (!response?.ok || !isInnPieceRequest(input)) return response;
      try {
        const data = await response.clone().json();
        const patch = await decodePatch();
        applyInnPatch(data, patch);
        const headers = new Headers(response.headers);
        headers.set('content-type', 'application/json; charset=utf-8');
        headers.delete('content-length');
        headers.delete('content-encoding');
        return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        console.warn('Inn runtime override failed; using the catalog Inn unchanged.', error);
        return response;
      }
    };
    wrappedFetch.hobunjiInnRuntimeOverride = true;
    wrappedFetch.originalFetch = originalFetch;
    wrappedFetch.debugState = () => ({ installed: true, patchDecoded: !!patchPromise });
    global.fetch = wrappedFetch;
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
    installInnRuntimeOverride,
  };
  installInnRuntimeOverride();
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
  if (!document.querySelector('script[data-map-editor-interior-instance-sync]')) {
    const interiorSyncScript = document.createElement('script');
    interiorSyncScript.src = '../../js/map-editor-interior-instance-sync.js';
    interiorSyncScript.dataset.mapEditorInteriorInstanceSync = '1';
    document.head.appendChild(interiorSyncScript);
  }
  if (!document.querySelector('script[data-map-editor-building-elevation]')) {
    const buildingElevationScript = document.createElement('script'); // Loads the Building inspector's footprint override UI.
    buildingElevationScript.src = '../../js/map-editor-building-elevation.js';
    buildingElevationScript.dataset.mapEditorBuildingElevation = '1';
    document.head.appendChild(buildingElevationScript);
  }
}
