(() => {
  'use strict';

  // Render-only broad-phase for scheduled NPC walkers. Unlike individual skinned
  // portrait/hand/foot/pants meshes, a walker has a stable floor-anchored root.
  // Cull the *entire* visual subtree in all world/depth/outline passes at once,
  // then restore its exact visibility before the next gameplay update.
  // NPC simulation, schedule, social interactions and collision never stop.
  let enabled = true; // Settings -> Performance & diagnostics: safe default-on A/B control.
  let diagnosticHideAll = false; // Opt-in visual-only A/B; simulation continues normally.
  const BOUND_RADIUS_TILES = 4.5; // Conservative body, species size, animation and carried-tool extent.
  const EXTRA_NEAR_KEEP_TILES = 3; // Close actors must remain drawable even just outside the view edge.
  let frustum = null, viewProjection = null, bounds = null; // Reused world-view primitives per render call.
  const stats = {
    frames: 0, eligible: 0, hidden: 0, inside: 0, close: 0,
    inactive: 0, diagnostic: false, enabled: true,
  }; // Copied into the mobile Performance Profiler and diagnostic snapshots.

  function ensureThree() {
    if (frustum) return true;
    const THREE = window.THREE;
    if (!THREE?.Frustum || !THREE?.Matrix4 || !THREE?.Sphere || !THREE?.Vector3) return false;
    frustum = new THREE.Frustum();
    viewProjection = new THREE.Matrix4();
    bounds = new THREE.Sphere(new THREE.Vector3(), BOUND_RADIUS_TILES);
    return true;
  }

  function suspendForRender(walkers, activeScene, camera) {
    if ((!enabled && !diagnosticHideAll) || !Array.isArray(walkers)
        || !activeScene?.isScene || !camera?.isCamera || !ensureThree()) return null;
    // Never retain a hidden walker after returning. The caller MUST invoke
    // the returned restore closure in a finally block around all world passes.
    if (!diagnosticHideAll) {
      camera.updateMatrixWorld?.(true); // Resolve the *current* view before Three's ordinary render happens.
      if (!camera.projectionMatrix || !camera.matrixWorldInverse) return null;
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
    }
    const changed = []; // Only roots hidden by this call, not NPCs already hidden by gameplay.
    let eligible = 0, hidden = 0, inside = 0, close = 0, inactive = 0;
    const cameraMatrix = camera.matrixWorld?.elements; // World eye handles parented cutscene cameras.
    const eyeX = cameraMatrix?.[12] ?? camera.position?.x ?? 0;
    const eyeY = cameraMatrix?.[13] ?? camera.position?.y ?? 0;
    const eyeZ = cameraMatrix?.[14] ?? camera.position?.z ?? 0;
    for (const walker of walkers) {
      const root = walker?.root;
      // Restrict to directly scene-owned walkers: nested/externally controlled
      // dance or cutscene actors keep their original visibility policy.
      if (!root || root.parent !== activeScene || root.visible === false
          || walker.combatTutorialSuspended || !root.position) { inactive++; continue; }
      eligible++;
      const visualScale = walker._npcCharacterRigRoot?.scale; // Longoran and other authored rig scales.
      const scale = Math.max(1, Number(visualScale?.x) || 1, Number(visualScale?.y) || 1, Number(visualScale?.z) || 1);
      const radius = Math.max(BOUND_RADIUS_TILES, (2.5 + (Number(walker.avatarHeight) || 1) * 1.5) * scale);
      const x = root.position.x, y = root.position.y + Math.min(1.5, radius * .3), z = root.position.z;
      // Actor bounds include long equipment, lean, jump and all normal rig poses.
      // The whole root is hidden only if the generous sphere is off-camera.
      if (!diagnosticHideAll) {
        const dx = eyeX - x, dy = eyeY - y, dz = eyeZ - z;
        const keepDistance = radius + EXTRA_NEAR_KEEP_TILES;
        if (dx * dx + dy * dy + dz * dz <= keepDistance * keepDistance) { close++; continue; }
        bounds.center.set(x, y, z);
        bounds.radius = radius;
        if (frustum.intersectsSphere(bounds)) { inside++; continue; }
      }
      changed.push(root);
      root.visible = false;
      hidden++;
    }
    Object.assign(stats, { frames: stats.frames + 1, eligible, hidden, inside, close, inactive,
      diagnostic: diagnosticHideAll, enabled }); // Snapshot is the most recent world render, not a stale accumulated total.
    return function restoreNpcVisuals() {
      for (const root of changed) root.visible = true;
      changed.length = 0;
    };
  }

  window.NpcViewFrustumCull = Object.freeze({
    suspendForRender,
    setEnabled(value) { enabled = value !== false; stats.enabled = enabled; return enabled; },
    setDiagnosticHideAll(value) { diagnosticHideAll = value === true; stats.diagnostic = diagnosticHideAll; return diagnosticHideAll; },
    get enabled() { return enabled; },
    get diagnosticHideAll() { return diagnosticHideAll; },
    snapshot() { return { ...stats }; },
    constants: Object.freeze({ BOUND_RADIUS_TILES, EXTRA_NEAR_KEEP_TILES }),
  });
})();