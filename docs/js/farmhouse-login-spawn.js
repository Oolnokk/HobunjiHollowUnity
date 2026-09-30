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

  global.FarmhouseLoginSpawn = Object.freeze({ placeInFarmhouse, frontDoor });
})(window);
