(() => {
  'use strict';

  // Camera-view LOD for procedural rigs and calm hostile simulation.
  //
  // A big fight puts dozens of humanoid rigs around the player, and half of
  // them are usually behind the camera. Their procedural leg solve and hand
  // frame sync are invisible there, so game.js's updateCreatureMesh asks this
  // module "is this actor in view?" and skips that work when it is not.
  // (Distance-based LOD for NPC walkers/bandits lives in entity-distance-lod.js;
  // this is the view-direction counterpart.)
  //
  // Design:
  //  - beginFrame(camera) prepares a shared frustum from the current camera.
  //    A late camera change can refresh it before newly visible actors wake.
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
  const BOUNDING_RADIUS_TILES = 2.5; // Covers the body plus weapon reach near the edge of view.
  const FULL_RATE_AI_TILES = 6; // Keep nearby humanoids responsive even when the camera is facing away.
  const COARSE_AI_INTERVAL_S = 0.2; // Elapsed simulation time required for an off-camera humanoid update.

  let enabled = true;
  let frustum = null;
  let haveFrustum = false;
  let projView = null;
  let coarseAiEnabled = true; // Independent A/B switch for the hostile update cadence.
  const stats = { checked: 0, skipped: 0, lastFrameChecked: 0, lastFrameSkipped: 0 };
  const aiStats = { deferred: 0, coarseTicks: 0, cameraWakes: 0 }; // Cumulative counts for Pixel Probe.
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
    refreshFrustum(camera);
  }

  function refreshFrustum(camera) {
    haveFrustum = false;
    if (!enabled || !camera || !ensureThree()) return;
    camera.updateMatrixWorld(true);
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
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
    sphere.radius = BOUNDING_RADIUS_TILES;
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

  function canDeferAi(actor, distanceTiles, tileSize) {
    if (!coarseAiEnabled || !haveFrustum || !actor.isBandit || !(distanceTiles > FULL_RATE_AI_TILES)) return false;
    if (actor.state !== 'idle' && actor.state !== 'return') return false;
    if (actor.combatTutorialTarget || actor._chunkCombatTarget || actor.telegraphState ||
        actor._enemyDodge || actor._enemyDodgePending || actor._maskboundHeadtakerNeckControlled ||
        (actor.maskboundTroop === 'headtaker' && window.MaskboundHeadtaker?.isActive?.(actor)) ||
        actor.prone || actor.knockbackT > 0 || actor.retreatT > 0 || actor.hitFlashT > 0 ||
        actor._cliffClimb || actor._cliffRouteTravel || actor.onBranch ||
        window.EnemySearchAI?.enemyAttackBusy?.(actor)) return false;
    const rig = actor.avatarRef?.group; // The last presented height bounds the live simulation position.
    if (!rig?.parent?.isScene || !rig.visible || !Number.isFinite(actor.x) || !Number.isFinite(actor.y) ||
        !(tileSize > 0) || !Number.isFinite(rig.position.y)) return false;
    const scale = rig.scale; // Grow the cull volume for enlarged or stretched rigs.
    sphere.radius = BOUNDING_RADIUS_TILES * Math.max(1, Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
    sphere.center.set(actor.x / tileSize, rig.position.y + 0.8, actor.y / tileSize);
    return !frustum.intersectsSphere(sphere);
  }

  // A negative result defers this update. On wake, use just the current frame's
  // delta so an attack or hit reaction never inherits a coarse movement step.
  function hostileAiDt(actor, distanceTiles, tileSize, dt) {
    if (!canDeferAi(actor, distanceTiles, tileSize)) {
      if (actor._offscreenHostileAiS) actor._offscreenHostileAiS = 0;
      return dt;
    }
    const elapsed = (actor._offscreenHostileAiS || 0) + dt; // Carry only omitted simulation time into the next coarse tick.
    if (elapsed + 1e-9 < COARSE_AI_INTERVAL_S) {
      actor._offscreenHostileAiS = elapsed;
      aiStats.deferred++;
      return -1;
    }
    actor._offscreenHostileAiS = 0;
    aiStats.coarseTicks++;
    return elapsed;
  }

  function wakeHostileAi(actor, distanceTiles, tileSize) {
    if (canDeferAi(actor, distanceTiles, tileSize)) return false;
    actor._offscreenHostileAiS = 0;
    aiStats.cameraWakes++;
    return true;
  }

  window.OffscreenRigLod = Object.freeze({
    beginFrame,
    refreshFrustum,
    shouldAnimate,
    hostileAiDt,
    wakeHostileAi,
    setEnabled(value) { enabled = value !== false; if (!enabled) haveFrustum = false; return enabled; },
    setCoarseAiEnabled(value) { coarseAiEnabled = value !== false; return coarseAiEnabled; },
    get enabled() { return enabled; },
    getStats() { return { ...stats, enabled }; },
    aiSnapshot() { return { ...aiStats, enabled: enabled && coarseAiEnabled, fullRateTiles: FULL_RATE_AI_TILES }; },
    constants: Object.freeze({ SLEEP_DELAY_S, ALWAYS_ANIMATE_TILES, BOUNDING_RADIUS_TILES }),
  });
})();
