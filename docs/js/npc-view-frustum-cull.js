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
  let clipProjection = null; // Crops the existing perspective/orthographic camera to a scissored depth-pass rectangle.
  let renderWalkers = null, renderScene = null; // Active only during renderWorldPasses; NEVER retained into simulation.
  const stats = {
    frames: 0, eligible: 0, hidden: 0, inside: 0, close: 0,
    inactive: 0, replayChecks: 0, replayHidden: 0, diagnostic: false, enabled: true,
  }; // Copied into the mobile Performance Profiler and diagnostic snapshots.

  function ensureThree() {
    if (frustum) return true;
    const THREE = window.THREE;
    if (!THREE?.Frustum || !THREE?.Matrix4 || !THREE?.Sphere || !THREE?.Vector3) return false;
    frustum = new THREE.Frustum();
    viewProjection = new THREE.Matrix4();
    clipProjection = new THREE.Matrix4();
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
      replayChecks: 0, replayHidden: 0, diagnostic: diagnosticHideAll, enabled }); // One world-render snapshot.
    renderWalkers = walkers; // Scoped registration lets the held renderer cull NPC occluders in its local depth rectangles.
    renderScene = activeScene;
    return function restoreNpcVisuals() {
      renderWalkers = null;
      renderScene = null;
      for (const root of changed) root.visible = true;
      changed.length = 0;
    };
  }

  function suspendOutsideReplayRect(scene, camera, rect, width, height, protectedMeshes = []) {
    // Every held/shell x-ray group can redraw the whole world just to repair a
    // small depth patch. Skinned NPC portraits, feet and pants have
    // frustumCulled=false, so Three submits them even outside that patch.
    // Treat each NPC as one conservative sphere and temporarily hide roots
    // wholly outside this replay's already-proven-safe scissor.
    if (!enabled || diagnosticHideAll || !renderWalkers || scene !== renderScene
        || !camera?.projectionMatrix || !camera.matrixWorldInverse || !rect
        || !(width > 0 && height > 0 && rect.z > 0 && rect.w > 0)) return null;
    const margin = 12; // Extra screen pixels for antialiasing, animation and generated shell width.
    const x0 = Math.max(0, rect.x - margin), y0 = Math.max(0, rect.y - margin);
    const x1 = Math.min(width, rect.x + rect.z + margin), y1 = Math.min(height, rect.y + rect.w + margin);
    if (!(x1 > x0 && y1 > y0)) return null;
    const hx = (x1 - x0) / width, hy = (y1 - y0) / height;
    const cx = ((x0 + x1) / width) - 1, cy = ((y0 + y1) / height) - 1;
    clipProjection.set(
      1 / hx, 0, 0, -cx / hx,
      0, 1 / hy, 0, -cy / hy,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ); // Reuses exactly the same conservative sub-frustum math as HeldObjectRenderOrder.
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    clipProjection.multiply(viewProjection);
    frustum.setFromProjectionMatrix(clipProjection);
    const protectedRoots = new Set(); // The x-ray owner must never disappear during its own depth/shell pass.
    for (const mesh of protectedMeshes) {
      for (let node = mesh; node && node !== scene; node = node.parent) {
        if (String(node.name || '').startsWith('npc_walker_')) protectedRoots.add(node);
      }
    }
    const changed = []; // Scoped suppression of unrelated NPC visual subtrees only.
    for (const walker of renderWalkers) {
      const root = walker?.root;
      if (!root || root.parent !== scene || root.visible === false
          || protectedRoots.has(root) || !root.position) continue;
      const visualScale = walker._npcCharacterRigRoot?.scale;
      const scale = Math.max(1, Number(visualScale?.x) || 1, Number(visualScale?.y) || 1, Number(visualScale?.z) || 1);
      const radius = Math.max(BOUND_RADIUS_TILES, (2.5 + (Number(walker.avatarHeight) || 1) * 1.5) * scale);
      bounds.center.set(root.position.x, root.position.y + Math.min(1.5, radius * .3), root.position.z);
      bounds.radius = radius;
      stats.replayChecks++;
      if (frustum.intersectsSphere(bounds)) continue;
      changed.push(root);
      root.visible = false;
      stats.replayHidden++;
    }
    return function restoreReplayNpcVisuals() {
      for (const root of changed) root.visible = true;
      changed.length = 0;
    };
  }

  window.NpcViewFrustumCull = Object.freeze({
    suspendForRender,
    suspendOutsideReplayRect,
    setEnabled(value) { enabled = value !== false; stats.enabled = enabled; return enabled; },
    setDiagnosticHideAll(value) { diagnosticHideAll = value === true; stats.diagnostic = diagnosticHideAll; return diagnosticHideAll; },
    get enabled() { return enabled; },
    get diagnosticHideAll() { return diagnosticHideAll; },
    snapshot() { return { ...stats }; },
    constants: Object.freeze({ BOUND_RADIUS_TILES, EXTRA_NEAR_KEEP_TILES }),
  });
})();