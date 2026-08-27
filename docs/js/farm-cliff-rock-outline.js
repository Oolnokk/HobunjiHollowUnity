(() => {
  'use strict';

  const THREE = window.THREE; // Used to capture farm-border scene additions and enable the shell layer.
  if (!THREE || window.FarmCliffRockOutline?.installed) return;

  const SHELL_LAYER = 1; // Used by the existing inverted-shell outline render pass.
  const SOURCE_SURFACE = 'cliffs'; // Used to identify only the stone skins generated for the farm border.
  const TARGET_SURFACE = 'rocks'; // Used to route farm cliffs through the exact rock natural-surface pipeline.
  const patchedApis = new WeakSet(); // Used to prevent wrapping the same BorderTerrain API more than once.
  const stats = { hookInstalls: 0, farmBuildsCaptured: 0, cliffMeshesRockified: 0, shellMeshesEnabled: 0 }; // Exposed through snapshot() for mobile-friendly verification.
  let loggedFirstApply = false; // Used to avoid repeating the one-time render diagnostic message.

  function surfaceForMesh(mesh) {
    const directSurface = mesh?.userData?.naturalSurface || null; // Used first because NaturalSurfaceMaterials tags the mesh itself.
    if (directSurface) return directSurface;
    const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]; // Used as a fallback for material-level surface tags.
    for (const material of materials) {
      const materialSurface = material?.userData?.naturalSurface || null; // Used to recognize a tagged material when the mesh tag is absent.
      if (materialSurface) return materialSurface;
    }
    return null;
  }

  function applyRockMaterialAndShell(roots) {
    const naturalSurfaces = window.NaturalSurfaceMaterials; // Used to apply the same material factory/config path as ordinary rocks.
    if (!naturalSurfaces?.naturalizeMesh) return 0;

    const seenMeshes = new Set(); // Used to avoid processing a mesh twice when captured roots overlap.
    let changed = 0; // Returned for diagnostics and used to decide whether to log the first successful application.

    const visit = object => {
      if (!object?.isMesh || seenMeshes.has(object)) return;
      seenMeshes.add(object);
      if (surfaceForMesh(object) !== SOURCE_SURFACE) return;

      naturalSurfaces.naturalizeMesh(object, TARGET_SURFACE);
      object.layers.enable(SHELL_LAYER);
      object.userData = Object.assign({}, object.userData, {
        farmCliffRockMaterial: true,
        farmCliffShellOutline: true,
      });
      stats.cliffMeshesRockified++;
      stats.shellMeshesEnabled++;
      changed++;
    };

    for (const root of roots) {
      if (!root) continue;
      if (root.isMesh) visit(root);
      root.traverse?.(visit);
    }

    if (changed && !loggedFirstApply) {
      loggedFirstApply = true;
      const message = `[farm-cliff-render] ${changed} farm cliff mesh(es): rock material + shell outline`; // Used by the in-game render log when available.
      if (typeof window.__farmLog === 'function') window.__farmLog(message, 'render');
      else console.debug(message);
    }
    return changed;
  }

  function runCapturedFarmBuild(originalBuild, context, args) {
    const scenePrototype = THREE.Scene?.prototype; // Used to intercept only objects synchronously added during this farm-border build.
    const previousAdd = scenePrototype?.add; // Restored immediately after buildBorderTerrain returns.
    if (!scenePrototype || typeof previousAdd !== 'function') return originalBuild.apply(context, args);

    const addedRoots = []; // Used after the existing border/natural-surface passes finish to find the farm's cliff meshes.
    function capturingAdd(...objects) {
      for (const object of objects) if (object) addedRoots.push(object);
      return previousAdd.apply(this, objects);
    }

    scenePrototype.add = capturingAdd;
    let result; // Stores the original build result so the wrapper preserves BorderTerrain's API behavior.
    try {
      result = originalBuild.apply(context, args);
    } finally {
      if (scenePrototype.add === capturingAdd) scenePrototype.add = previousAdd;
    }

    stats.farmBuildsCaptured++;
    applyRockMaterialAndShell(addedRoots);
    return result;
  }

  function patchBorderTerrain(api) {
    if (!api || patchedApis.has(api) || typeof api.buildBorderTerrain !== 'function') return api;

    const originalBuild = api.buildBorderTerrain; // Called by the wrapper before farm cliffs are converted from cliff to rock rendering.
    api.buildBorderTerrain = function (...args) {
      return runCapturedFarmBuild(originalBuild, this, args);
    };
    patchedApis.add(api);
    stats.hookInstalls++;
    return api;
  }

  function installBorderTerrainHook() {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'BorderTerrain'); // Used to chain NaturalSurfaceMaterials' existing deferred global hook safely.
    if (descriptor?.get && descriptor?.set) {
      const previousGet = descriptor.get; // Used by the chained getter and to retrieve NaturalSurfaceMaterials' wrapped API after assignment.
      const previousSet = descriptor.set; // Used first on assignment so the existing natural-surface wrapper remains inside this farm-specific wrapper.
      Object.defineProperty(window, 'BorderTerrain', {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return previousGet.call(window); },
        set(value) {
          previousSet.call(window, value);
          patchBorderTerrain(previousGet.call(window));
        },
      });
      patchBorderTerrain(previousGet.call(window));
      return;
    }

    const existing = window.BorderTerrain; // Used when BorderTerrain was already assigned before this module loaded.
    if (existing) {
      patchBorderTerrain(existing);
      return;
    }

    let pending = null; // Stores a future BorderTerrain assignment when no prior deferred hook exists.
    Object.defineProperty(window, 'BorderTerrain', {
      configurable: true,
      enumerable: true,
      get() { return pending; },
      set(value) { pending = patchBorderTerrain(value); },
    });
  }

  window.FarmCliffRockOutline = {
    installed: true,
    applyRockMaterialAndShell,
    snapshot() { return Object.assign({}, stats); },
  };

  installBorderTerrainHook();
})();
