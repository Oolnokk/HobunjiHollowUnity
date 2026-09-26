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
    doorFurniture: [1, 1],
    woodenDoorFurniture: [1, 1],
  });

  const state = { // Used by debugSnapshot() so mobile diagnostics can inspect the last runtime adaptation without developer tools.
    installed: false,
    mapsAdapted: 0,
    lastMapId: '',
    lastFurnitureCount: 0,
    lastCollisionTilesAdded: 0,
    lastCollisionBounds: 0,
    lastCollisionBoundsOutsideGrid: 0,
    lastCollisionBoundsSample: [],
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

  function isDynamicMechanism(piece) {
    const puzzle = window.FurniturePuzzleProperties?.normalizePuzzle?.(piece?.puzzle);
    return puzzle?.role === 'mechanism' && puzzle.blocksMovement;
  }

  function collisionBounds(piece) {
    if (!piece || !providesCollision(piece)) return null;
    const info = placement(piece); // Used to recover the unscaled local rectangle that the final furniture transform is applied to.
    const visual = legacyRecordFor(piece); // Used to match the exact compatibility transform consumed by the editor/game renderer.
    const uniform = visual?.postScale != null ? finiteNumber(visual.postScale, 1) : 1; // Used only as a legacy fallback when per-axis scale is absent.
    const scaleX = visual?.postSX != null ? finiteNumber(visual.postSX, 1) : uniform; // Used to transform the collision rectangle along furniture-local X.
    const scaleZ = visual?.postSZ != null ? finiteNumber(visual.postSZ, 1) : uniform; // Used to transform the collision rectangle along furniture-local Z.
    const width = Math.max(0.001, info.baseW * Math.abs(scaleX)); // Used by point/AABB collision and the editor's red footprint preview.
    const depth = Math.max(0.001, info.baseD * Math.abs(scaleZ)); // Used by point/AABB collision and the editor's red footprint preview.
    const itemKey = String(piece.itemKey || piece.key || ''); // Used by collision diagnostics and impact material lookup without consulting rendered meshes.
    return {
      id: String(piece.id || ''),
      itemKey,
      furnitureKey: itemKey.replace(/Furniture$/, ''),
      centerX: finiteNumber(piece.col, 0) + info.baseW * 0.5 + finiteNumber(visual?.postX, 0),
      centerZ: finiteNumber(piece.row, 0) + info.baseD * 0.5 + finiteNumber(visual?.postZ, 0),
      width,
      depth,
      halfWidth: width * 0.5,
      halfDepth: depth * 0.5,
      rotationDeg: finiteNumber(visual?.rotY, 0),
    };
  }

  function boundsCorners(bounds) {
    if (!bounds) return [];
    const angle = finiteNumber(bounds.rotationDeg, 0) * Math.PI / 180; // Used to rotate local rectangle corners into the same X/Z orientation as Three.js rotation.y.
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const halfWidth = Math.max(0, finiteNumber(bounds.halfWidth, finiteNumber(bounds.width, 0) * 0.5)); // Used to enumerate the four local X extents.
    const halfDepth = Math.max(0, finiteNumber(bounds.halfDepth, finiteNumber(bounds.depth, 0) * 0.5)); // Used to enumerate the four local Z extents.
    const corners = []; // Used by the 2D editor overlay and snapped-grid overflow diagnostics.
    for (const localX of [-halfWidth, halfWidth]) {
      for (const localZ of [-halfDepth, halfDepth]) {
        corners.push({
          x: finiteNumber(bounds.centerX, 0) + localX * cos + localZ * sin,
          z: finiteNumber(bounds.centerZ, 0) - localX * sin + localZ * cos,
        });
      }
    }
    return corners;
  }

  function boundsContainsPoint(bounds, x, z, padding = 0) {
    if (!bounds) return false;
    const angle = finiteNumber(bounds.rotationDeg, 0) * Math.PI / 180; // Used to inverse-rotate a world point into furniture-local X/Z.
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = finiteNumber(x, 0) - finiteNumber(bounds.centerX, 0), dz = finiteNumber(z, 0) - finiteNumber(bounds.centerZ, 0);
    const localX = dx * cos - dz * sin; // Used to compare against the transformed rectangle's local width.
    const localZ = dx * sin + dz * cos; // Used to compare against the transformed rectangle's local depth.
    const extra = Math.max(0, finiteNumber(padding, 0)); // Used by callers that want a conservative point-radius expansion.
    return Math.abs(localX) <= finiteNumber(bounds.halfWidth, 0) + extra
      && Math.abs(localZ) <= finiteNumber(bounds.halfDepth, 0) + extra;
  }

  function boundsOverlapAabb(bounds, centerX, centerZ, halfX = 0, halfZ = halfX) {
    if (!bounds) return false;
    const angle = finiteNumber(bounds.rotationDeg, 0) * Math.PI / 180; // Used by the four separating-axis tests between the OBB and actor AABB.
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const absCos = Math.abs(cos), absSin = Math.abs(sin);
    const boxHalfX = Math.max(0, finiteNumber(halfX, 0)); // Used for the actor/world-aligned collision half-width.
    const boxHalfZ = Math.max(0, finiteNumber(halfZ, boxHalfX)); // Used for the actor/world-aligned collision half-depth.
    const obbHalfX = Math.max(0, finiteNumber(bounds.halfWidth, 0)); // Used for furniture-local X projections.
    const obbHalfZ = Math.max(0, finiteNumber(bounds.halfDepth, 0)); // Used for furniture-local Z projections.
    const dx = finiteNumber(centerX, 0) - finiteNumber(bounds.centerX, 0), dz = finiteNumber(centerZ, 0) - finiteNumber(bounds.centerZ, 0);

    if (Math.abs(dx) > boxHalfX + obbHalfX * absCos + obbHalfZ * absSin) return false;
    if (Math.abs(dz) > boxHalfZ + obbHalfX * absSin + obbHalfZ * absCos) return false;

    const localCenterX = Math.abs(dx * cos - dz * sin); // Used by the furniture-local X separating axis.
    const localCenterZ = Math.abs(dx * sin + dz * cos); // Used by the furniture-local Z separating axis.
    if (localCenterX > obbHalfX + boxHalfX * absCos + boxHalfZ * absSin) return false;
    if (localCenterZ > obbHalfZ + boxHalfX * absSin + boxHalfZ * absCos) return false;
    return true;
  }

  function boundsOutsideSnappedGrid(piece, bounds = collisionBounds(piece)) {
    if (!piece || !bounds) return false;
    const info = placement(piece); // Used to compare the freeform transformed rectangle against the placement-only snapped footprint.
    const col = finiteNumber(piece.col, 0), row = finiteNumber(piece.row, 0);
    const epsilon = 1e-6; // Used to avoid flagging exact edge contact as an off-grid transformed collision.
    return boundsCorners(bounds).some(corner =>
      corner.x < col - epsilon || corner.x > col + info.gridW + epsilon
      || corner.z < row - epsilon || corner.z > row + info.gridD + epsilon);
  }

  function collisionBoundsForFurniture(furniture) {
    const out = []; // Used as the cheap scene-local list queried by player/NPC movement instead of baking furniture back into tile collision.
    for (const piece of (Array.isArray(furniture) ? furniture : [])) {
      if (!providesCollision(piece) || isDynamicMechanism(piece)) continue; // Dynamic mechanisms retain their own runtime collision ownership.
      const bounds = collisionBounds(piece); // Used to preserve post translation/rotation/scale outside the snapped placement grid.
      if (bounds) out.push(bounds);
    }
    return out;
  }

  function mergedColliders(mapData, furniture = mapData?.furniture) {
    const out = []; // Used only for explicitly-authored/manual tile colliders; furniture now stays continuous in 2D tile-space.
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
    const bounds = collisionBoundsForFurniture(furniture); // Used by gameplay as simple transformed 2D rectangles rather than snapped ROCK tiles.
    return { colliders: out, added: 0, bounds };
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
    const outsideGridBounds = sourceFurniture.reduce((count, piece) => { // Used by mobile diagnostics to prove post transforms can carry collision beyond the snapped footprint.
      if (!providesCollision(piece) || isDynamicMechanism(piece)) return count;
      const bounds = collisionBounds(piece); // Used only for the snapped-vs-freeform overflow check; runtime reuses collision.bounds below.
      return count + (boundsOutsideSnappedGrid(piece, bounds) ? 1 : 0);
    }, 0);
    const manualColliderKeys = (mapData.colliders || []).map(tile => `${Math.round(finiteNumber(tile?.[0], NaN))},${Math.round(finiteNumber(tile?.[1], NaN))}`); // Gameplay uses this to avoid reopening a manually-solid tile under a moving door.

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
    state.lastCollisionBounds = collision.bounds.length;
    state.lastCollisionBoundsOutsideGrid = outsideGridBounds;
    state.lastCollisionBoundsSample = collision.bounds.slice(0, 4).map(bounds => ({ // Used by Pixel Probe to expose a compact mobile-readable transformed-collision sample.
      id: bounds.id,
      centerX: Number(bounds.centerX.toFixed(3)),
      centerZ: Number(bounds.centerZ.toFixed(3)),
      width: Number(bounds.width.toFixed(3)),
      depth: Number(bounds.depth.toFixed(3)),
      rotationDeg: Number(bounds.rotationDeg.toFixed(2)),
    }));
    state.lastTransformedCount = transformedCount;
    state.lastNonCollidingCount = nonCollidingCount;

    return {
      ...mapData,
      furniture,
      colliders: collision.colliders,
      _interiorFurnitureCollisionBounds: collision.bounds,
      _interiorManualColliderKeys: manualColliderKeys,
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
    return { ...state, lastCollisionBoundsSample: state.lastCollisionBoundsSample.map(entry => ({ ...entry })) };
  }

  window.InteriorFurnitureGrid = Object.freeze({
    DEFAULT_FOOTPRINTS,
    footprintForItem,
    placement,
    gridScale,
    legacyRecordFor,
    occupiedTiles,
    providesCollision,
    isDynamicMechanism,
    collisionBounds,
    boundsCorners,
    boundsContainsPoint,
    boundsOverlapAabb,
    boundsOutsideSnappedGrid,
    collisionBoundsForFurniture,
    mergedColliders,
    adaptEffectiveMap,
    installRuntimeBridge,
    debugSnapshot,
  });

  installRuntimeBridge();
})();
