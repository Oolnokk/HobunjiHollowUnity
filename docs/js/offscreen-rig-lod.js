(() => {
  'use strict';

  // Camera-view LOD for per-frame procedural rig animation.
  //
  // A big fight puts dozens of humanoid rigs around the player, and half of
  // them are usually behind the camera. Their procedural leg solve and hand
  // frame sync are invisible there, so game.js's updateCreatureMesh asks this
  // module "is this actor in view?" and skips that work when it is not.
  // (Distance-based LOD for NPC walkers/bandits lives in entity-distance-lod.js;
  // this is the view-direction counterpart.)
  //
  // Design:
  //  - beginFrame(camera) rebuilds one frustum per frame from the camera's
  //    cached matrices (no per-actor matrix work, no allocation).
  //  - shouldAnimate(actor, x, y, z, dt) is true when the actor's bounding
  //    sphere (deliberately generous) intersects the frustum. Waking is
  //    immediate; going to sleep needs SLEEP_DELAY_S of continuous
  //    off-screen time so a quick camera swing never freezes a rig the
  //    player is about to see.
  //  - Anyone within ALWAYS_ANIMATE_TILES stays animated regardless: a melee
  //    attacker behind the camera is still close enough to cast shadows,
  //    appear in reflections, or pop into view on the next camera turn.
  //  - The per-actor state is two plain fields on the actor, so there is no
  //    side table to leak when an actor is removed.

  const SLEEP_DELAY_S = 0.25;
  const ALWAYS_ANIMATE_TILES = 3;
  const BOUNDING_RADIUS_TILES = 2.5; // Covers the body plus weapon reach and the camera matrices being one frame old.

  let enabled = true;
  let frustum = null;
  let haveFrustum = false;
  let projView = null;
  let camX = 0, camY = 0, camZ = 0;
  const stats = { checked: 0, skipped: 0, lastFrameChecked: 0, lastFrameSkipped: 0 };
  const sphere = { center: null, radius: BOUNDING_RADIUS_TILES };

  function ensureThree() {
    const THREE = window.THREE;
    if (!THREE || frustum) return !!frustum;
    frustum = new THREE.Frustum();
    projView = new THREE.Matrix4();
    sphere.center = new THREE.Vector3();
    return true;
  }

  function beginFrame(camera) {
    stats.lastFrameChecked = stats.checked;
    stats.lastFrameSkipped = stats.skipped;
    stats.checked = 0;
    stats.skipped = 0;
    haveFrustum = false;
    if (!enabled || !camera || !ensureThree()) return;
    // matrixWorldInverse/projectionMatrix are refreshed by the render pass, so
    // this reads last frame's camera; BOUNDING_RADIUS_TILES absorbs that lag.
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    camX = camera.position.x; camY = camera.position.y; camZ = camera.position.z;
    haveFrustum = true;
  }

  // x/y/z are world-space (tile) coordinates of the actor's centre.
  function shouldAnimate(actor, x, y, z, dt, playerDistanceTiles) {
    if (!haveFrustum || !actor) return true;
    stats.checked++;
    if (Number.isFinite(playerDistanceTiles) && playerDistanceTiles <= ALWAYS_ANIMATE_TILES) {
      actor._rigOffscreenS = 0;
      return true;
    }
    sphere.center.set(x, y, z);
    if (frustum.intersectsSphere(sphere)) {
      actor._rigOffscreenS = 0;
      actor._rigOffscreenAsleep = false;
      return true;
    }
    const offscreenS = (actor._rigOffscreenS || 0) + Math.max(0, Number(dt) || 0);
    actor._rigOffscreenS = offscreenS;
    if (offscreenS < SLEEP_DELAY_S) return true;
    actor._rigOffscreenAsleep = true;
    stats.skipped++;
    return false;
  }

  window.OffscreenRigLod = Object.freeze({
    beginFrame,
    shouldAnimate,
    setEnabled(value) { enabled = value !== false; if (!enabled) haveFrustum = false; return enabled; },
    get enabled() { return enabled; },
    getStats() { return { ...stats, enabled }; },
    constants: Object.freeze({ SLEEP_DELAY_S, ALWAYS_ANIMATE_TILES, BOUNDING_RADIUS_TILES }),
  });
})();
