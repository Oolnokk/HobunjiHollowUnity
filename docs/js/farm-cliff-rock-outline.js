(() => {
  'use strict';

  const THREE = window.THREE; // Used to capture farm-border scene additions and enable the shell layer.
  if (!THREE || window.FarmCliffRockOutline?.installed) return;

  const SHELL_LAYER = 1; // Used by the existing inverted-shell outline render pass.
  const SOURCE_SURFACE = 'cliffs'; // Used to identify only the stone skins generated for the farm border.
  const TARGET_SURFACE = 'rocks'; // Used to route farm cliffs through the exact rock natural-surface pipeline.
  const POSITION_KEY_SCALE = 100000; // Used to match the base terrain's Float32 triangles to the coplanar cliff-skin triangles robustly.
  const patchedApis = new WeakSet(); // Used to prevent wrapping the same BorderTerrain API more than once.
  const stats = {
    hookInstalls: 0,
    farmBuildsCaptured: 0,
    cliffMeshesRockified: 0,
    shellMeshesEnabled: 0,
    baseMeshesTrimmed: 0,
    coplanarBaseTrianglesRemoved: 0,
  }; // Exposed through snapshot() for mobile-friendly verification.
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

  function collectMeshes(roots) {
    const meshes = new Set(); // Used to flatten captured roots into unique meshes before geometric matching.
    const visit = object => { if (object?.isMesh) meshes.add(object); };
    for (const root of roots) {
      if (!root) continue;
      visit(root);
      root.traverse?.(visit);
    }
    return [...meshes];
  }

  function pointKey(position, index) {
    const quantize = value => Math.round(value * POSITION_KEY_SCALE); // Used only for topology matching; it does not alter rendered positions.
    return `${quantize(position.getX(index))},${quantize(position.getY(index))},${quantize(position.getZ(index))}`;
  }

  function triangleKey(position, a, b, c) {
    const points = [pointKey(position, a), pointKey(position, b), pointKey(position, c)]; // Sorted so winding/order differences still match the same triangle.
    points.sort();
    return points.join('|');
  }

  function addGeometryTriangleKeys(geometry, output) {
    const position = geometry?.getAttribute?.('position'); // Used to derive position-only triangle identity across separate geometries.
    if (!position) return;
    const index = geometry.index?.array || null; // Uses the authored index when present; non-indexed geometry falls back to sequential triples.
    if (index) {
      for (let i = 0; i + 2 < index.length; i += 3) output.add(triangleKey(position, index[i], index[i + 1], index[i + 2]));
      return;
    }
    for (let i = 0; i + 2 < position.count; i += 3) output.add(triangleKey(position, i, i + 1, i + 2));
  }

  function removeCoplanarBaseTriangles(meshes, cliffMeshes) {
    const cliffTriangleKeys = new Set(); // Used to identify only base-terrain triangles exactly duplicated by a generated cliff skin.
    for (const cliffMesh of cliffMeshes) addGeometryTriangleKeys(cliffMesh.geometry, cliffTriangleKeys);
    if (!cliffTriangleKeys.size) return 0;

    const cliffSet = new Set(cliffMeshes); // Used to exclude the cliff skins themselves from the trimming pass.
    let removedTotal = 0; // Returned for the render log and accumulated into mobile diagnostics.

    for (const mesh of meshes) {
      if (!mesh?.isMesh || cliffSet.has(mesh)) continue;
      const geometry = mesh.geometry;
      const position = geometry?.getAttribute?.('position');
      const index = geometry?.index?.array;
      if (!position || !index || index.length < 3) continue;

      const kept = []; // Becomes the replacement index only when this mesh actually contains duplicate cliff triangles.
      let removedHere = 0; // Stored on the mesh for direct Pixel Probe/debug inspection.
      for (let i = 0; i + 2 < index.length; i += 3) {
        const a = index[i], b = index[i + 1], c = index[i + 2];
        if (cliffTriangleKeys.has(triangleKey(position, a, b, c))) {
          removedHere++;
          continue;
        }
        kept.push(a, b, c);
      }
      if (!removedHere) continue;

      const IndexArray = index.constructor; // Preserves Uint16/Uint32 index width used by the original border geometry.
      geometry.setIndex(new THREE.BufferAttribute(new IndexArray(kept), 1));
      geometry.index.needsUpdate = true;
      geometry.computeBoundingBox?.();
      geometry.computeBoundingSphere?.();
      mesh.userData = Object.assign({}, mesh.userData, {
        farmCliffCoplanarTrianglesRemoved: removedHere,
      });
      stats.baseMeshesTrimmed++;
      stats.coplanarBaseTrianglesRemoved += removedHere;
      removedTotal += removedHere;
    }
    return removedTotal;
  }

  function applyRockMaterialAndShell(roots) {
    const naturalSurfaces = window.NaturalSurfaceMaterials; // Used to apply the same material factory/config path as ordinary rocks.
    if (!naturalSurfaces?.naturalizeMesh) return 0;

    const meshes = collectMeshes(roots); // Used both for cliff discovery and for removing the base terrain directly beneath those cliff skins.
    const cliffMeshes = meshes.filter(mesh => surfaceForMesh(mesh) === SOURCE_SURFACE); // Captured before naturalizeMesh changes their surface tag to rocks.
    const removedBaseTriangles = removeCoplanarBaseTriangles(meshes, cliffMeshes); // Prevents the hidden green border mesh from depth-occluding the cliff shell.
    let changed = 0; // Returned for diagnostics and used to decide whether to log the first successful application.

    for (const object of cliffMeshes) {
      naturalSurfaces.naturalizeMesh(object, TARGET_SURFACE);
      object.layers.enable(SHELL_LAYER);
      object.userData = Object.assign({}, object.userData, {
        farmCliffRockMaterial: true,
        farmCliffShellOutline: true,
      });
      stats.cliffMeshesRockified++;
      stats.shellMeshesEnabled++;
      changed++;
    }

    if ((changed || removedBaseTriangles) && !loggedFirstApply) {
      loggedFirstApply = true;
      const message = `[farm-cliff-render] ${changed} farm cliff mesh(es): rock material + shell outline; removed ${removedBaseTriangles} coplanar base triangle(s)`; // Used by the in-game render log when available.
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
