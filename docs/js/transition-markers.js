(() => {
  'use strict';

  // Gold floor rings marking farm/interior travel-transition spots, built
  // from the map editor layout by game.js's initWorldTravel(). Extracted
  // from game.js's buildTransitionMarkers(); wired back via init(deps).
  let deps = null;

  function init(injectedDeps) {
    deps = injectedDeps;
  }

  function buildTransitionMarkers() {
    if (!deps) return;
    const THREE = window.THREE;
    const _ringGeo = new THREE.RingGeometry(0.22, 0.36, 24);
    const _ringMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    for (const t of deps.getWorldTransitions()) {
      const interior = t.area === 'interior';
      const g = interior ? deps.interiorGrid : deps.getGrid();
      const tile = g[t.row]?.[t.col];
      if (!tile) continue;
      const ring = new THREE.Mesh(_ringGeo, _ringMat);
      window.EnvironmentSurfaceMicroPlateau?.bindGroundProjection(ring);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(t.col + 0.5, deps.tileSurfaceY(tile.type) + 0.02, t.row + 0.5);
      (interior ? deps.interiorScene : deps.scene).add(ring);
    }
  }

  window.TransitionMarkers = { init, buildTransitionMarkers };
})();
