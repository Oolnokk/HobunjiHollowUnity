(() => {
  'use strict';

  if (window.InteriorFurnitureGrid) return;

  const DEFAULT_FOOTPRINTS = Object.freeze({
    basicBedFurniture: [1, 2],
    doubleBedFurniture: [2, 2],
    bedrollFurniture: [1, 1],
    benchFurniture: [2, 1],
    bookshelfFurniture: [2, 1],
    bucketFurniture: [1, 1],
    candleTableFurniture: [1, 1],
    chairSimpleFurniture: [1, 1],
    chairCushionFurniture: [1, 1],
    chestFurniture: [1, 1],
    crateStackFurniture: [1, 1],
    copperBarrelFurniture: [1, 1],
    deskFurniture: [2, 1],
    dresserFurniture: [2, 1],
    hearthFurniture: [2, 1],
    loomFurniture: [1, 2],
    nightstandFurniture: [1, 1],
    rugFurniture: [2, 2],
    standingLampFurniture: [1, 1],
    stoolFurniture: [1, 1],
    tableLongFurniture: [4, 1],
    tableRoundFurniture: [2, 2],
    tableSmallFurniture: [1, 1],
    wardrobeFurniture: [2, 1],
    washTubFurniture: [1, 1],
    statueFurniture: [1, 1],
    counterFurniture: [3, 1],
    alchemyTableFurniture: [1, 1],
    bulletinBoardFurniture: [1, 1],
    pestleFurniture: [1, 1],
    squeezerFurniture: [2, 2],
    handMillFurniture: [1, 1],
    dryingRackFurniture: [2, 1],
    smokerFurniture: [2, 2],
    agingBarrelFurniture: [1, 1],
    agingVaseFurniture: [1, 1],
  });

  const state = { // Used by debugSnapshot() so mobile diagnostics can inspect the last runtime adaptation without developer tools.
    installed: false,
    mapsAdapted: 0,
    lastMapId: '',
    lastFurnitureCount: 0,
    lastCollisionTilesAdded: 0,
    lastTransformedCount: 0,
    lastNonCollidingCount: 0,
  };

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positiveTileInt(value, fallback = 1) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number >= 1 ? number : Math.max(1, Math.round(fallback) || 1);
  }

  function normalizeQuarterRotation(value) {
    const turns = Math.round(finiteNumber(value, 0) / 90);
    return ((turns % 4) + 4) % 4 * 90;
  }

  function footprintForItem(itemKey) {
    const footprint = DEFAULT_FOOTPRINTS[String(itemKey || '')] || [1, 1];
    return { w: footprint[0], d: footprint[1] };
  }

  function placement(piece) {
    const base = footprintForItem(piece?.itemKey || piece?.key);
    const gridRot = normalizeQuarterRotation(piece?.gridRot);
    const quarterTurn = gridRot === 90 || gridRot === 270;
    const defaultW = quarterTurn ? base.d : base.w;
    const defaultD = quarterTurn ? base.w : base.d;
    return {
      baseW: base.w,
      baseD: base.d,
      gridRot,
      gridW: positiveTileInt(piece?.gridW, defaultW),
      gridD: positiveTileInt(piece?.gridD, defaultD),
    };
  }

  function gridScale(piece) {
    const info = placement(piece);
    const quarterTurn = info.gridRot === 90 || info.gridRot === 270;
    return {
      x: quarterTurn ? info.gridD / info.baseW : info.gridW / info.baseW,
      z: quarterTurn ? info.gridW / info.baseD : info.gridD / info.baseD,
    };
  }

  function legacyRecordFor(piece) {
    if (!piece || piece._interiorFurnitureGridApplied) return piece;
    const info = placement(piece);
    const scale = gridScale(piece);
    const uniform = piece.postScale != null ? finiteNumber(piece.postScale, 1) : 1;
    const residualSX = piece.postSX != null ? finiteNumber(piece.postSX, 1) : uniform;
    const residualSY = piece.postSY != null ? finiteNumber(piece.postSY, 1) : uniform;
    const residualSZ = piece.postSZ != null ? finiteNumber(piece.postSZ, 1) : uniform;
    return {
      ...piece,
      postX: finiteNumber(piece.postX, 0) + info.gridW / 2 - info.baseW / 2,
      postY: finiteNumber(piece.postY, 0),
      postZ: finiteNumber(piece.postZ, 0) + info.gridD / 2 - info.baseD / 2,
      rotY: info.gridRot + finiteNumber(piece.rotY, 0),
      postSX: residualSX * scale.x,
      postSY: residualSY,
      postSZ: residualSZ * scale.z,
      _interiorFurnitureGridApplied: true,
    };
  }

  function occupiedTiles(piece) {
    if (!piece) return [];
    const info = placement(piece);
    const col = Math.round(finiteNumber(piece.col, 0));
    const row = Math.round(finiteNumber(piece.row, 0));
    const tiles = [];
    for (let dc = 0; dc < info.gridW; dc++) {
      for (let dr = 0; dr < info.gridD; dr++) tiles.push([col + dc, row + dr]);
    }
    return tiles;
  }

  function providesCollision(piece) {
    return !!piece && !piece.nonColliding && !piece.walkableElevation;
  }

  function mergedColliders(mapData, furniture = mapData?.furniture) {
    const out = [];
    const seen = new Set();
    for (const tile of (Array.isArray(mapData?.colliders) ? mapData.colliders : [])) {
      if (!Array.isArray(tile) || tile.length < 2) continue;
      const col = Math.round(finiteNumber(tile[0], NaN));
      const row = Math.round(finiteNumber(tile[1], NaN));
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const key = `${col},${row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([col, row]);
    }
    const manualCount = out.length;
    for (const piece of (Array.isArray(furniture) ? furniture : [])) {
      if (!providesCollision(piece)) continue;
      for (const [col, row] of occupiedTiles(piece)) {
        const key = `${col},${row}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([col, row]);
      }
    }
    return { colliders: out, added: out.length - manualCount };
  }

  function isBuildingInterior(mapData) {
    return mapData?.schema === 'hobunji_building_interior.v1' || mapData?.category === 'building_interior';
  }

  function adaptEffectiveMap(mapData) {
    if (!isBuildingInterior(mapData) || !Array.isArray(mapData.furniture) || !mapData.furniture.length) return mapData;
    const sourceFurniture = mapData.furniture;
    const transformedById = new Map(); // Used to shift sourceFurnitureId-bound NPC stations by the same grid-center delta as their furniture.
    let transformedCount = 0;
    let nonCollidingCount = 0;
    const furniture = sourceFurniture.map(piece => {
      if (!providesCollision(piece)) nonCollidingCount++;
      const transformed = legacyRecordFor(piece);
      if (transformed !== piece) transformedCount++;
      const id = String(piece?.id || '');
      if (id) transformedById.set(id, { source: piece, transformed });
      return transformed;
    });
    const collision = mergedColliders(mapData, sourceFurniture);

    const stations = Array.isArray(mapData.npcStations) ? mapData.npcStations.map(station => {
      const binding = transformedById.get(String(station?.sourceFurnitureId || ''));
      if (!binding) return station;
      const oldPostX = finiteNumber(binding.source.postX, 0);
      const oldPostZ = finiteNumber(binding.source.postZ, 0);
      const newPostX = finiteNumber(binding.transformed.postX, 0);
      const newPostZ = finiteNumber(binding.transformed.postZ, 0);
      return {
        ...station,
        col: finiteNumber(station.col, finiteNumber(binding.source.col, 0)) + (newPostX - oldPostX),
        row: finiteNumber(station.row, finiteNumber(binding.source.row, 0)) + (newPostZ - oldPostZ),
        rotY: finiteNumber(binding.transformed.rotY, finiteNumber(station.rotY, 0)),
      };
    }) : mapData.npcStations;

    state.mapsAdapted++;
    state.lastMapId = String(mapData.id || mapData.mapId || '');
    state.lastFurnitureCount = sourceFurniture.length;
    state.lastCollisionTilesAdded = collision.added;
    state.lastTransformedCount = transformedCount;
    state.lastNonCollidingCount = nonCollidingCount;

    return {
      ...mapData,
      furniture,
      colliders: collision.colliders,
      ...(Array.isArray(stations) ? { npcStations: stations } : {}),
      _interiorFurnitureGridApplied: true,
    };
  }

  function installRuntimeBridge() {
    const layouts = window.MapLayoutSystem;
    const original = layouts?.getEffectiveMapData;
    if (!layouts || typeof original !== 'function' || original.__interiorFurnitureGridWrapped) return false;
    function getEffectiveMapDataWithFurnitureGrid(...args) {
      return adaptEffectiveMap(original.apply(this, args));
    }
    Object.assign(getEffectiveMapDataWithFurnitureGrid, original);
    getEffectiveMapDataWithFurnitureGrid.__interiorFurnitureGridWrapped = true;
    getEffectiveMapDataWithFurnitureGrid.__interiorFurnitureGridOriginal = original;
    layouts.getEffectiveMapData = getEffectiveMapDataWithFurnitureGrid;
    state.installed = true;
    return true;
  }

  function debugSnapshot() {
    return { ...state };
  }

  window.InteriorFurnitureGrid = Object.freeze({
    DEFAULT_FOOTPRINTS,
    footprintForItem,
    placement,
    gridScale,
    legacyRecordFor,
    occupiedTiles,
    providesCollision,
    mergedColliders,
    adaptEffectiveMap,
    installRuntimeBridge,
    debugSnapshot,
  });

  installRuntimeBridge();
})();
