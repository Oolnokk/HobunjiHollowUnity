// Every login starts inside the farmhouse.
//
// game.js's spawnPlayerAvatar calls placeInFarmhouse() once the world is
// hydrated (except for the wilderness-campfire resume and cutscene previews).
// The player is first stood on the exterior approach tile of the farmhouse
// front door, facing it, and then enterInterior(pieceId) runs, so
// the interior's saved "return" position is that doorstep: walking out lands
// the player just outside the door they logged in behind — which is also
// where DoorstepVisits (js/doorstep-visits.js) puts any waiting visitor.
(function (global) {
  'use strict';

  let runtimeDeps = null; // Captured from the normal login placement call; reused by Tiredness pass-out recovery so it enters the farmhouse through the same private game transition.

  function parseTileKey(key) {
    const parts = String(key || '').split(',').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? { c: parts[0], r: parts[1] } : null;
  }

  // The starter piece's first valid entrance with a registered farm-side door.
  function frontDoor() {
    for (const piece of (global.HousePieces?.debugPieceFeatures?.() || [])) {
      if (piece.stage && piece.stage !== 'built') continue;
      for (const feature of (piece.features || [])) {
        if (feature.type !== 'entrance' || feature.invalid || !feature.hasDoorObj) continue;
        const door = parseTileKey(feature.doorTile);
        const approach = parseTileKey(feature.approachTile);
        if (door && approach) return { pieceId: piece.id, featureId: feature.id, door, approach };
      }
    }
    return null;
  }

  // deps: { player, TILE, enterInterior(pieceId), setFacingAngle(angle) }
  function placeInFarmhouse(deps) {
    const { player, TILE } = deps || {};
    if (deps?.player && typeof deps.enterInterior === 'function') runtimeDeps = deps; // Retains the already-authorized game.js interior handoff for later pass-out recovery.
    if (!player || typeof deps.enterInterior !== 'function') return false;
    const front = frontDoor();
    if (front) {
      const tile = Number(TILE) || 1;
      player.x = (front.approach.c + 0.5) * tile;
      player.y = (front.approach.r + 0.5) * tile;
      // Face the door, exactly as if the player had walked in last session:
      // the chase camera then sits out in the yard on the way back out
      // instead of inside the house wall.
      const angle = Math.atan2(front.door.r - front.approach.r, front.door.c - front.approach.c);
      player.angle = angle;
      deps.setFacingAngle?.(angle);
    }
    if (front) global.HousePieces?.recordEnteredEntrance?.(front.pieceId, front.featureId);
    deps.enterInterior(front?.pieceId);
    return true;
  }

  function findHomeBed() {
    const furniture = global.FarmEditor?.getInteriorFurnitureObjects?.() || []; // Live player-placed interior registry; this follows moved/replaced beds instead of assuming starter coordinates.
    return furniture.find(object => object?.area === 'interior' && ['basicBedFurniture', 'doubleBedFurniture', 'bedrollFurniture'].includes(String(object?.key || ''))) || null;
  }

  function bedFootprint(key, rotationDeg = 0) {
    const base = key === 'doubleBedFurniture' ? { fw: 2, fd: 2 } : key === 'bedrollFurniture' ? { fw: 1, fd: 2 } : { fw: 1, fd: 2 }; // Used only to center the recovered player over the actual placed bed.
    const quarterTurn = Math.abs(Math.round((Number(rotationDeg) || 0) / 90)) % 2 === 1;
    return quarterTurn ? { fw: base.fd, fd: base.fw } : base;
  }

  function movePlayerOntoBed(deps = runtimeDeps) {
    const player = deps?.player; // Existing player reference captured from game.js; moved only after the farmhouse interior has been entered.
    const bed = findHomeBed();
    if (!player || !bed) return false;
    const tile = Number(deps?.TILE) || 1; // Same world-space tile scale used by placeInFarmhouse above.
    const footprint = bedFootprint(bed.key, bed.rotYDeg);
    player.x = (Number(bed.col) + footprint.fw / 2) * tile;
    player.y = (Number(bed.row) + footprint.fd / 2) * tile;
    player.vx = 0;
    player.vy = 0;
    deps?._snapCameraTarget?.();
    return true;
  }

  function returnToFarmhouse(options = {}) {
    if (!runtimeDeps) return false;
    const entered = placeInFarmhouse(runtimeDeps);
    if (!entered) return false;
    if (options.atBed !== false) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => movePlayerOntoBed(runtimeDeps)); // Interior furniture is already restored in normal play; two frames also covers a just-built scene before placing the player.
      });
    }
    return true;
  }

  function debugSnapshot() {
    const bed = findHomeBed();
    return {
      runtimeReady: !!runtimeDeps,
      homeBed: bed ? { id: bed.id || null, key: bed.key || null, col: bed.col, row: bed.row, rotYDeg: bed.rotYDeg || 0 } : null,
    };
  }

  global.FarmhouseLoginSpawn = Object.freeze({ placeInFarmhouse, frontDoor, returnToFarmhouse, movePlayerOntoBed, debugSnapshot });
})(window);
