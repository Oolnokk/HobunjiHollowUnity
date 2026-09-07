(() => {
  'use strict';

  const THREE = window.THREE;
  const GROUP_NAME = 'HarugasirriSuperBackdrop';
  const BACKDROP_GROUP_RENDER_ORDER = 1;
  const MIN_BACKDROP_FAR = 512;
  const rendererPrototype = THREE?.WebGLRenderer?.prototype;
  if (!THREE?.Box3 || !THREE?.Sphere || !rendererPrototype || window.HarugasirriCullRange) return;

  const trackedGroups = new Set();
  const cameraStates = new WeakMap();
  const hookedRendererInstances = new WeakSet();
  let renderHook = null;
  let rangeRevision = 0;
  const stats = {
    cameraAdjustments: 0,
    renderHookArms: 0,
    renderHookHits: 0,
    directRegistrations: 0,
    discoveredRegistrations: 0,
    lastRequiredFar: 0,
    lastAppliedFar: 0,
    lastBaselineFar: 0,
  };

  function isBackdropGroup(object) {
    // Only the named parent is a backdrop registration target. Child meshes
    // deliberately carry the same userData tag for material/debug traversal,
    // so using that tag here would double-register all three children whenever
    // Object3D.add() is used to assemble the template.
    return object?.name === GROUP_NAME;
  }

  function visitBackdropMeshes(group, callback) {
    const visit = object => {
      if (!object?.isMesh || object?.userData?.harugasirriSuperBackdrop !== true) return;
      callback(object);
    };
    if (typeof group?.traverse === 'function') group.traverse(visit);
    else for (const child of group?.children || []) visit(child);
  }

  function normalizeBackdropRendering(group) {
    if (!group) return 0;
    // Opaque render items are sorted by parent Group renderOrder before the
    // child mesh's own order. Keep the Harugasirri group after the sky group
    // (0) so the sky's depth-disabled opaque shell cannot paint over it.
    group.renderOrder = BACKDROP_GROUP_RENDER_ORDER;
    let count = 0;
    visitBackdropMeshes(group, mesh => {
      mesh.frustumCulled = false;
      count++;
    });
    group.userData = {
      ...(group.userData || {}),
      harugasirriCullBypass: true,
      harugasirriOpaqueGroupOrder: BACKDROP_GROUP_RENDER_ORDER,
    };
    return count;
  }

  function renderSceneFor(group) {
    let node = group;
    let guard = 0;
    while (node && guard++ < 128) {
      if (node.isScene) return node;
      node = node.parent || null;
    }
    return null;
  }

  function belongsToRenderScene(group, scene) {
    if (!group || !scene) return false;
    let node = group;
    let guard = 0;
    while (node && guard++ < 128) {
      if (node === scene) return true;
      node = node.parent || null;
    }
    return false;
  }

  function requiredFarFor(group, camera) {
    if (!group || !camera?.position) return 0;
    try {
      group.updateMatrixWorld?.(true);
      const box = new THREE.Box3().setFromObject(group);
      if (box.isEmpty?.()) return 0;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const distance = camera.position.distanceTo(sphere.center);
      if (!Number.isFinite(distance) || !Number.isFinite(sphere.radius)) return 0;
      return Math.ceil(distance + sphere.radius + 96);
    } catch (_) {
      return 0;
    }
  }

  function discoverBackdrop(scene) {
    if (!scene) return null;
    let found = null;
    try { found = scene.getObjectByName?.(GROUP_NAME) || null; } catch (_) {}
    if (!found && typeof scene.traverse === 'function') {
      try {
        scene.traverse(object => {
          if (!found && isBackdropGroup(object)) found = object;
        });
      } catch (_) {}
    }
    if (!found) return null;
    if (!trackedGroups.has(found)) {
      stats.discoveredRegistrations++;
      rangeRevision++;
    }
    trackedGroups.add(found);
    normalizeBackdropRendering(found);
    return found;
  }

  function sceneHasTrackedBackdrop(scene) {
    if (!scene) return false;
    for (const group of [...trackedGroups]) {
      if (!group?.parent) {
        trackedGroups.delete(group);
        continue;
      }
      if (belongsToRenderScene(group, scene)) return true;
    }
    return !!discoverBackdrop(scene);
  }

  function ensureCameraRange(scene, camera) {
    if (!scene || !camera?.isPerspectiveCamera) return false;
    let required = 0;
    for (const group of [...trackedGroups]) {
      if (!group?.parent) {
        trackedGroups.delete(group);
        continue;
      }
      if (!belongsToRenderScene(group, scene)) continue;
      normalizeBackdropRendering(group);
      required = Math.max(required, requiredFarFor(group, camera));
    }
    if (!(required > 0)) return false;

    let cameraState = cameraStates.get(camera);
    if (!cameraState) {
      cameraState = { baselineFar: Math.max(1, Number(camera.far) || 200), lastAppliedFar: null, revision: -1 };
      cameraStates.set(camera, cameraState);
    }
    const targetFar = Math.max(cameraState.baselineFar, MIN_BACKDROP_FAR, required);
    stats.lastRequiredFar = required;
    stats.lastBaselineFar = cameraState.baselineFar;
    stats.lastAppliedFar = targetFar;
    cameraState.revision = rangeRevision;

    if (Math.abs((Number(camera.far) || 0) - targetFar) > 0.5) {
      camera.far = targetFar;
      camera.updateProjectionMatrix?.();
      cameraState.lastAppliedFar = targetFar;
      stats.cameraAdjustments++;
      return true;
    }
    cameraState.lastAppliedFar = targetFar;
    return false;
  }

  function cameraRangeNeedsCheck(camera) {
    const state = cameraStates.get(camera);
    if (!state || state.revision !== rangeRevision) return true;
    return (Number(camera?.far) || 0) + 0.5 < (Number(state.lastAppliedFar) || 0);
  }

  function guardRender(scene, camera) {
    if (!sceneHasTrackedBackdrop(scene) || !camera?.isPerspectiveCamera) return;
    stats.renderHookHits++;
    // The permanent guard itself is intentionally tiny. World-bounds work
    // only repeats after a transform/attachment revision or if another
    // system actually lowers the camera range again.
    if (cameraRangeNeedsCheck(camera)) ensureCameraRange(scene, camera);
  }

  function hookRendererInstance(renderer) {
    if (!renderer || hookedRendererInstances.has(renderer) || typeof renderer.render !== 'function') return false;
    const previous = renderer.render;
    renderer.render = function harugasirriRangeRender(scene, camera, ...rest) {
      guardRender(scene, camera);
      return previous.call(this, scene, camera, ...rest);
    };
    hookedRendererInstances.add(renderer);
    return true;
  }

  function armRenderHook() {
    if (renderHook || typeof rendererPrototype.render !== 'function') return false;
    let instanceCount = 0;
    for (const renderer of window.__hobunjiRendererInstances || []) {
      if (hookRendererInstance(renderer)) instanceCount++;
    }
    if (instanceCount > 0) {
      // Three r128 and several gameplay bridges can leave an own render()
      // method on the live instance. Hook that authoritative boundary when
      // available instead of assuming the prototype remains observable.
      renderHook = { instances: instanceCount };
      stats.renderHookArms++;
      return true;
    }
    const previous = rendererPrototype.render;
    const hook = { previous, wrapped: null };
    hook.wrapped = function (scene, camera, ...rest) {
      guardRender(scene, camera);
      return previous.call(this, scene, camera, ...rest);
    };
    renderHook = hook;
    rendererPrototype.render = hook.wrapped;
    stats.renderHookArms++;
    return true;
  }

  function armScene(group) {
    if (!group) return false;
    if (!trackedGroups.has(group)) {
      stats.directRegistrations++;
      rangeRevision++;
    }
    trackedGroups.add(group);
    normalizeBackdropRendering(group);
    armRenderHook();
    return !!renderSceneFor(group);
  }

  // Fallback interception for ordinary Three.js add() calls. Runtime attach
  // also hands the finished group directly to armScene(), so this is no longer
  // relied upon for correctness when a map uses an intermediate root Group.
  const object3DPrototype = THREE?.Object3D?.prototype;
  if (object3DPrototype?.add && !object3DPrototype.__harugasirriCullAddWrapped) {
    const originalAdd = object3DPrototype.add;
    object3DPrototype.add = function (...objects) {
      const result = originalAdd.apply(this, objects);
      for (const object of objects) {
        if (isBackdropGroup(object)) armScene(object);
      }
      return result;
    };
    Object.defineProperty(object3DPrototype, '__harugasirriCullAddWrapped', { value: true, configurable: true });
  }

  window.addEventListener?.('harugasirri-transform-changed', () => {
    rangeRevision++;
    for (const group of [...trackedGroups]) {
      if (!group?.parent) {
        trackedGroups.delete(group);
        continue;
      }
      normalizeBackdropRendering(group);
    }
    armRenderHook();
  });

  function trackedMeshCount() {
    let count = 0;
    for (const group of trackedGroups) {
      if (!group?.parent) continue;
      visitBackdropMeshes(group, () => { count++; });
    }
    return count;
  }

  function getDebugState() {
    return {
      trackedGroups: [...trackedGroups].filter(group => !!group?.parent).length,
      opaqueGroupRenderOrder: BACKDROP_GROUP_RENDER_ORDER,
      frustumBypassMeshes: trackedMeshCount(),
      cameraAdjustments: stats.cameraAdjustments,
      renderHookArms: stats.renderHookArms,
      renderHookHits: stats.renderHookHits,
      renderHookArmed: !!renderHook,
      directRegistrations: stats.directRegistrations,
      discoveredRegistrations: stats.discoveredRegistrations,
      lastRequiredFar: stats.lastRequiredFar,
      lastAppliedFar: stats.lastAppliedFar,
      lastBaselineFar: stats.lastBaselineFar,
    };
  }

  window.HarugasirriCullRange = Object.freeze({
    GROUP_NAME,
    BACKDROP_GROUP_RENDER_ORDER,
    MIN_BACKDROP_FAR,
    armScene,
    armRenderHook,
    ensureCameraRange,
    normalizeBackdropRendering,
    getDebugState,
  });
  window.HobunjiCacheAudit?.register?.('Harugasirri frustum bypass meshes', trackedMeshCount);
  window.HobunjiCacheAudit?.register?.('Harugasirri camera far', () => Math.round(stats.lastAppliedFar || 0));
  window.HobunjiCacheAudit?.register?.('Harugasirri required camera far', () => Math.round(stats.lastRequiredFar || 0));
  window.HobunjiCacheAudit?.register?.('Harugasirri camera range hook hits', () => stats.renderHookHits);
  window.HobunjiCacheAudit?.register?.('Harugasirri range direct registrations', () => stats.directRegistrations);
  window.HobunjiCacheAudit?.register?.('Harugasirri range discovered registrations', () => stats.discoveredRegistrations);
  window.HobunjiCacheAudit?.register?.('Harugasirri opaque group order', () => BACKDROP_GROUP_RENDER_ORDER);
})();
