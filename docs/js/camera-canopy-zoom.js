// Camera-vs-tree-canopy zoom floor (window.CameraCanopyZoom), extracted from game.js's camera block.
//
// How far under a tree canopy's own recorded influence radius the player has to be before manual zoom-out gets
// hard-limited to its underside height — ports the standalone foliage tool's camera-vs-canopy obstruction
// concept (see game.js buildZoneScene's canopyZones / the vegGroup.userData.canopyClamp tagging in
// _buildZoneFloorMeshes). floor() only ever reports the minimum zoom scale for THIS frame's distance; it never
// touches the player's own wheel/slider zoom, so their setting is restored the instant they leave every canopy.
//
// game.js calls init(deps) once and floor(tx, tz, lookY) from updateCameraPosition().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CameraCanopyZoom = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const CANOPY_CLEARANCE = 0.3;
  const DEFAULT_ANGLE_DEG = 32.73, DEFAULT_DISTANCE_TILES = 14;
  let deps = null;

  // deps: { isZoneArea(area), getCurrentArea(), getZoneInfo(area) -> { canopyZones }, getModeConfig(),
  //         getPitchOffsetDeg(baseAngleDeg) }
  function init(injected) { deps = injected || null; }

  function floor(tx, tz, lookY) {
    if (!deps) return 0;
    const area = deps.getCurrentArea();
    if (!deps.isZoneArea(area)) return 0;
    const zones = deps.getZoneInfo(area)?.canopyZones;
    if (!zones || !zones.length) return 0;
    const modeCfg = deps.getModeConfig() || {};
    const baseAngle = modeCfg.angleFromGroundDeg ?? DEFAULT_ANGLE_DEG;
    const angle = (baseAngle + (Number(deps.getPitchOffsetDeg(baseAngle)) || 0)) * Math.PI / 180;
    const distanceTiles = modeCfg.distanceTiles ?? DEFAULT_DISTANCE_TILES;
    const sinAngle = Math.sin(angle);
    let result = 0;
    for (const z of zones) {
      const dx = tx - z.x, dz = tz - z.z;
      if (dx * dx + dz * dz > z.radius * z.radius) continue;
      const headroom = z.undersideY - CANOPY_CLEARANCE - lookY;
      const required = headroom > 1e-4 ? (sinAngle * distanceTiles) / headroom : Infinity;
      if (required > result) result = required;
    }
    return result;
  }

  return Object.freeze({ init, floor, CANOPY_CLEARANCE });
});
