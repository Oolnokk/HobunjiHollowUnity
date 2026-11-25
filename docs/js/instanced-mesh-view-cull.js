(() => {
  'use strict';

  // Render-only camera cull for InstancedMeshes tagged by InstancedMeshBounds
  // (WallBuilder brick walls and path bricks, GrassBillboardRenderChunks'
  // farm/town grass chunks). Three r128 cannot frustum-cull an InstancedMesh,
  // so each one was submitted in every world pass whatever the camera saw.
  // Meshes whose instance sphere is outside the view are hidden for the
  // synchronous world render only and restored before anything else runs
  // (same contract as NpcViewFrustumCull). Raycasts, collision and the path
  // corridor culling never see the temporary state.
  let enabled = true; // Debug A/B switch: InstancedMeshViewCull.setEnabled(false).
  let frustum = null, viewProjection = null, sphere = null; // Reused per render call.
  const hiddenScratch = []; // Meshes hidden by the current call; emptied on restore.
  const stats = { frames: 0, tracked: 0, inScene: 0, hidden: 0, hiddenInstances: 0, enabled: true };

  function ensureThree() {
    if (frustum) return true;
    const THREE = window.THREE;
    if (!THREE?.Frustum || !THREE?.Matrix4 || !THREE?.Sphere) return false;
    frustum = new THREE.Frustum();
    viewProjection = new THREE.Matrix4();
    sphere = new THREE.Sphere();
    return true;
  }

  // The scene the mesh would draw in, or null when it or an ancestor is hidden.
  function drawnRoot(object) {
    let node = object;
    for (;;) {
      if (node.visible === false) return null;
      if (!node.parent) return node;
      node = node.parent;
    }
  }

  function restore() {
    for (let i = 0; i < hiddenScratch.length; i++) hiddenScratch[i].visible = true;
    hiddenScratch.length = 0;
  }

  // Returns a restore closure (or null when nothing was hidden). The caller
  // MUST invoke it in a finally block around all world passes.
  function suspendForRender(activeScene, camera) {
    if (hiddenScratch.length) restore(); // Interrupted prior passes must never leave instanced meshes hidden.
    let sceneryRestore = null; // Scenery and instancing have independent visibility histories.
    try {
      sceneryRestore = window.DistantSceneryViewCull?.suspendForRender?.(activeScene, camera) || null;
    } catch (_) {
      window.DistantSceneryViewCull?.reset?.(); // A failed optional culler restores its own hidden scenery.
    }
    const restoreBoth = () => {
      try { restore(); } finally { sceneryRestore?.(); }
    }; // Shared finally callback, including all early returns and exceptions below.
    const bounds = window.InstancedMeshBounds;
    if (!enabled || !activeScene?.isScene || !camera?.isCamera || !bounds || !ensureThree()) return sceneryRestore;

    try {
      camera.updateMatrixWorld?.(true);
      if (!camera.projectionMatrix || !camera.matrixWorldInverse) return sceneryRestore; // Previously discarded the scenery restore callback.
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      let tracked = 0, inScene = 0, hiddenInstances = 0;
      const visitInstances = callback => bounds.forEachTrackedInScene ? bounds.forEachTrackedInScene(activeScene, callback) : bounds.forEachTracked(callback); // Legacy tool pages may omit the scene notification owner.
      visitInstances((mesh) => {
        tracked++;
        if (drawnRoot(mesh) !== activeScene) return;
        inScene++;
        const world = bounds.worldSphere(mesh, sphere);
        if (!world || frustum.intersectsSphere(world)) return;
        mesh.visible = false;
        hiddenScratch.push(mesh);
        hiddenInstances += mesh.count;
      });
      stats.frames++; stats.tracked = tracked; stats.inScene = inScene;
      stats.hidden = hiddenScratch.length; stats.hiddenInstances = hiddenInstances;
      return sceneryRestore ? restoreBoth : (hiddenScratch.length ? restore : null);
    } catch (_) {
      restoreBoth(); // Fail open even if instanced bounds computation throws mid-iteration.
      return null;
    }
  }

  window.InstancedMeshViewCull = Object.freeze({
    suspendForRender,
    setEnabled(value) { enabled = value !== false; stats.enabled = enabled; if (!enabled) restore(); return enabled; },
    get enabled() { return enabled; },
    snapshot: () => ({ ...stats }),
  });
})();
