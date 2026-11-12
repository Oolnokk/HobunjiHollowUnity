(() => {
  'use strict';

  // Render-only camera cull for WallBuilder's instanced brick meshes (building
  // walls, farm/zone path bricks, town scenery paths). Three r128 cannot
  // frustum-cull an InstancedMesh, so every brick was submitted in every world
  // pass whatever the camera saw. WallBuilder owns a sphere around all of a
  // mesh's instances; meshes whose sphere is outside the view are hidden for
  // the synchronous world render only and restored before anything else runs
  // (same contract as NpcViewFrustumCull). Raycasts, collision and the path
  // corridor culling never see the temporary state.
  let enabled = true; // Debug A/B switch: InstancedWallViewCull.setEnabled(false).
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

  function rootOf(object) {
    let node = object;
    while (node.parent) node = node.parent;
    return node;
  }

  function restore() {
    for (let i = 0; i < hiddenScratch.length; i++) hiddenScratch[i].visible = true;
    hiddenScratch.length = 0;
  }

  // Returns a restore closure (or null when nothing was hidden). The caller
  // MUST invoke it in a finally block around all world passes.
  function suspendForRender(activeScene, camera) {
    const builder = window.WallBuilder;
    if (!enabled || !activeScene?.isScene || !camera?.isCamera
        || !builder?.forEachInstanceMesh || !builder.instanceWorldSphere || !ensureThree()) return null;
    if (hiddenScratch.length) restore(); // A previous call that was never restored must not leave walls hidden.
    camera.updateMatrixWorld?.(true); // Resolve the current view before Three's own render does.
    if (!camera.projectionMatrix || !camera.matrixWorldInverse) return null;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    let tracked = 0, inScene = 0, hiddenInstances = 0;
    builder.forEachInstanceMesh((mesh) => {
      tracked++;
      if (!mesh.visible || !mesh.parent || rootOf(mesh) !== activeScene) return;
      inScene++;
      const bounds = builder.instanceWorldSphere(mesh, sphere);
      if (!bounds || frustum.intersectsSphere(bounds)) return;
      mesh.visible = false;
      hiddenScratch.push(mesh);
      hiddenInstances += mesh.count;
    });
    stats.frames++; stats.tracked = tracked; stats.inScene = inScene;
    stats.hidden = hiddenScratch.length; stats.hiddenInstances = hiddenInstances;
    return hiddenScratch.length ? restore : null;
  }

  window.InstancedWallViewCull = Object.freeze({
    suspendForRender,
    setEnabled(value) { enabled = value !== false; stats.enabled = enabled; if (!enabled) restore(); return enabled; },
    get enabled() { return enabled; },
    snapshot: () => ({ ...stats }),
  });
})();
