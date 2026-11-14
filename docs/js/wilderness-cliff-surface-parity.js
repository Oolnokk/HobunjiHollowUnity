(() => {
  'use strict';

  const THREE = window.THREE; // Used to recognize terrain meshes and preserve Three.js geometry/material conventions.
  if (!THREE || window.WildernessCliffSurfaceParity?.installed) return;

  const WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE = 6; // Used to match the farm boundary's bounded full-PNG surface scale on long wilderness cliff walls.
  const PLATEAU_CLIFF_MATERIAL_SLOT = 1; // Used by ZonePlateauMesa: slot 0 is grass, slot 1 is the actual steep cliff-face group.
  const DEBUG_HISTORY_LIMIT = 16; // Used to keep mobile-visible final-pass history bounded.
  const pendingMeshes = new WeakSet(); // Used to avoid duplicate microtask remaps when nested plateau builders are both wrapped in the same call stack.
  const farmMaterialCache = new WeakMap(); // Used to reuse the canonical farm-rock material when multiple cliffs share one unchanged source material.
  const stats = {
    scheduledPasses: 0,
    completedPasses: 0,
    capturedMeshes: 0,
    candidateMeshes: 0,
    remappedMeshes: 0,
    boundaryMeshesRockified: 0,
    plateauSlotsRockified: 0,
    litOrTintedMaterialsRepaired: 0,
    staleMappingsCleared: 0,
    missingUvsBefore: 0,
    missingUvsAfter: 0,
    plateauBuildsCaptured: 0,
    plateauRebuildsCaptured: 0,
    townBorderBuildsCaptured: 0,
    borderMeshesFarmFinished: 0,
    errors: 0,
    crossMeshUvsDeferred: 0,
    farmMaterialCacheHits: 0,
    recent: [],
  }; // Used by snapshot() and the in-game render log to verify wilderness cliff parity without DevTools.

  function debugLog(message, level = 'render') {
    const text = `[wilderness-cliff-surface] ${message}`; // Used as the common in-game/mobile diagnostic prefix.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level);
    else (level === 'warn' ? console.warn : console.debug)(text);
  }

  function materialSurface(material) {
    return material?.userData?.naturalSurface || null; // Used to recognize the canonical natural-surface material tag independently of mesh ownership tags.
  }

  function surfaceForMesh(mesh) {
    const direct = mesh?.userData?.naturalSurface || null; // Used first because the natural-surface pipeline tags single-material rock/cliff meshes directly.
    if (direct) return direct;
    const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]; // Used as a fallback when only the material retained its natural-surface tag.
    for (const material of materials) {
      const surface = materialSurface(material); // Used to recover rock/cliff identity from a material slot.
      if (surface) return surface;
    }
    return null;
  }

  function hasValidUvs(mesh) {
    const position = mesh?.geometry?.getAttribute?.('position'); // Used as the authoritative vertex-count reference for the final UV attribute.
    const uv = mesh?.geometry?.getAttribute?.('uv'); // Used to catch the exact no-UV wilderness cliff state reported by Pixel Probe.
    return !!(position && uv && uv.count === position.count && Number(uv.itemSize || 0) >= 2);
  }

  function isFarmRockMaterial(material) {
    if (!material?.isMeshBasicMaterial || !material.map) return false;
    if (materialSurface(material) !== 'rocks') return false;
    const colorHex = material.color?.isColor ? material.color.getHexString().toLowerCase() : '';
    // Farm boundary rock bakes the configured gray into carved_smooth.png, then
    // renders the tinted PNG on an unlit WHITE MeshBasicMaterial. Requiring
    // white here catches both the old Lambert-lighting path and accidental
    // second tint multiplication when a PNG is present but looks too dark.
    return colorHex === 'ffffff';
  }

  function isNaturalCliffCandidate(mesh, options = {}) {
    if (!mesh?.isMesh || !mesh.geometry) return false;
    if (options.materialSlot != null && Array.isArray(mesh.material) && mesh.material[Number(options.materialSlot)]) return true;
    const surface = surfaceForMesh(mesh); // Used to accept both farm-style rocks and legacy wilderness cliff tags.
    return surface === 'rocks' || surface === 'cliffs' || mesh.userData?.naturalSurfaceCliffSlot != null;
  }

  function captureNewMeshes(scene, beforeCount) {
    const children = scene?.children || []; // Used to capture exact direct meshes before unrelated asynchronous scene additions can occur.
    const meshes = children.slice(Math.max(0, Number(beforeCount) || 0)).filter(child => child?.isMesh); // Used by deferred final passes instead of re-scanning a wider scene later.
    stats.capturedMeshes += meshes.length;
    return meshes;
  }

  function runCapturingSceneAdds(callback) {
    const scenePrototype = THREE.Scene?.prototype; // Used to observe meshes created by rebuildZoneMesaMeshes, whose internal lexical builder does not return them.
    const previousAdd = scenePrototype?.add; // Restored immediately after the synchronous rebuild completes.
    if (!scenePrototype || typeof previousAdd !== 'function') return { result: callback(), meshes: [] };
    const meshes = []; // Used as exact direct mesh additions made during this rebuild call.
    function capturingAdd(...objects) {
      for (const object of objects) if (object?.isMesh) meshes.push(object);
      return previousAdd.apply(this, objects);
    }
    scenePrototype.add = capturingAdd;
    let result;
    try {
      result = callback();
    } finally {
      if (scenePrototype.add === capturingAdd) scenePrototype.add = previousAdd;
    }
    stats.capturedMeshes += meshes.length;
    return { result, meshes };
  }

  function farmRockMaterialFromSource(sourceMaterial) {
    const natural = window.NaturalSurfaceMaterials; // Used to reuse the exact material factory/config/tint path already used by the farm boundary.
    if (typeof natural?.naturalizeMesh !== 'function' || !sourceMaterial) return null;

    // naturalizeMesh is the public canonical material factory but is designed
    // for whole meshes. A tiny throwaway proxy lets a multi-material plateau
    // obtain that exact farm-rock material without ever remapping the plateau's
    // shared grass UV attribute. The proxy never enters a scene and its geometry
    // is disposed immediately; the returned cached material/texture remain shared.
    const signature = [ // Used to invalidate a reused material when a shared source's appearance or render state changes.
      sourceMaterial.color?.getHexString?.() || '', sourceMaterial.map?.uuid || '',
      sourceMaterial.side, sourceMaterial.transparent, sourceMaterial.opacity, sourceMaterial.alphaTest,
      sourceMaterial.depthTest, sourceMaterial.depthWrite, sourceMaterial.polygonOffset,
      sourceMaterial.polygonOffsetFactor, sourceMaterial.polygonOffsetUnits,
    ].join('|');
    const cached = farmMaterialCache.get(sourceMaterial); // Used to avoid creating throwaway proxy geometry for every plateau in the same material family.
    if (cached?.signature === signature) {
      stats.farmMaterialCacheHits++;
      return cached.material;
    }

    const proxyGeometry = new THREE.PlaneGeometry(1, 1); // Used only to satisfy naturalizeMesh's geometry contract while the canonical rock material is created/resolved.
    const proxy = new THREE.Mesh(proxyGeometry, sourceMaterial); // Used only as a material-factory carrier; never rendered or added to a scene.
    let material;
    try {
      natural.naturalizeMesh(proxy, 'rocks', 'planar-stretch');
      material = proxy.material;
    } finally {
      if (proxy.geometry !== proxyGeometry) proxy.geometry?.dispose?.(); // Dispose the non-rendered surface-island clone created by mapper wrappers.
      proxyGeometry.dispose?.();
    }
    if (material) farmMaterialCache.set(sourceMaterial, { signature, material });
    return material || null;
  }

  function makeMaterialMatchFarm(mesh, materialSlot = null) {
    const natural = window.NaturalSurfaceMaterials; // Used for both single-material cliffs and the material-only plateau proxy path.
    if (!mesh?.isMesh || typeof natural?.naturalizeMesh !== 'function') return false;

    if (materialSlot != null) {
      const slot = Number(materialSlot);
      if (!Array.isArray(mesh.material) || !mesh.material[slot]) return false;
      const current = mesh.material[slot];
      mesh.userData = Object.assign({}, mesh.userData, { naturalSurfaceCliffSlot: slot });
      if (isFarmRockMaterial(current)) return false;

      const farmMaterial = farmRockMaterialFromSource(current);
      if (!farmMaterial) return false;
      const materials = mesh.material.slice();
      materials[slot] = farmMaterial;
      mesh.material = materials;
      mesh.userData = Object.assign({}, mesh.userData, {
        naturalSurfaceCliffSlot: slot,
        wildernessCliffMaterialParity: 'farm-boundary-rock-slot',
      });
      stats.plateauSlotsRockified++;
      stats.litOrTintedMaterialsRepaired++;
      return true;
    }

    if (Array.isArray(mesh.material)) return false;
    if (isFarmRockMaterial(mesh.material)) return false;

    // naturalizeMesh intentionally no-ops when a mesh is already tagged with
    // the requested surface. Clear only that ownership tag when the MATERIAL
    // proves the old pass was incomplete (lit, untextured, or double-tinted),
    // then let the canonical farm rock factory rebuild it.
    if (mesh.userData?.naturalSurface === 'rocks') delete mesh.userData.naturalSurface;
    natural.naturalizeMesh(mesh, 'rocks');
    if (!isFarmRockMaterial(mesh.material)) return false;
    window.FacetedNaturalSurfaceShellReduction?.suppressMesh?.(mesh, 'rocks');
    mesh.userData = Object.assign({}, mesh.userData, {
      wildernessCliffMaterialParity: 'farm-boundary-rock',
    });
    stats.boundaryMeshesRockified++;
    stats.litOrTintedMaterialsRepaired++;
    return true;
  }

  function clearCachedSurfaceMapping(mesh) {
    const geometry = mesh?.geometry; // Used to invalidate mapping metadata after later wilderness geometry wrappers have changed positions or stripped UVs.
    if (!geometry) return false;
    geometry.userData = Object.assign({}, geometry.userData || {});
    let cleared = false; // Used to count only meshes that actually carried a prior surface-island cache.
    if (geometry.userData.hobunjiSurfaceStretchSignature) {
      delete geometry.userData.hobunjiSurfaceStretchSignature;
      cleared = true;
    }
    if (geometry.userData.hobunjiSurfaceStretch) {
      delete geometry.userData.hobunjiSurfaceStretch;
      cleared = true;
    }
    // Older whole-mesh world/face mapping cannot remain authoritative once the
    // furniture-style connected-surface detector is about to rebuild the final UVs.
    if (geometry.userData.naturalSurfaceUvMapping) {
      delete geometry.userData.naturalSurfaceUvMapping;
      cleared = true;
    }
    if (cleared) stats.staleMappingsCleared++;
    return cleared;
  }

  function applyFinalSurfacePass(mesh, label, options = {}) {
    if (!isNaturalCliffCandidate(mesh, options)) return false;
    stats.candidateMeshes++;
    const missingBefore = !hasValidUvs(mesh); // Used to prove the final pass repairs Pixel Probe's no-UV cliff-hit failure mode.
    if (missingBefore) stats.missingUvsBefore++;

    const forcedSlot = options.materialSlot == null ? null : Number(options.materialSlot); // Used by plateau meshes whose slot 1 is known even before natural-surface tagging occurs.
    const taggedSlot = mesh.userData?.naturalSurfaceCliffSlot; // Used by already-naturalized plateau meshes.
    const materialSlot = forcedSlot != null ? forcedSlot : (taggedSlot != null ? Number(taggedSlot) : null);
    makeMaterialMatchFarm(mesh, materialSlot);
    clearCachedSurfaceMapping(mesh);
    if (mesh.userData?.naturalSurfaceCrossMeshUvOwner) {
      // A changed or rejected batch cannot keep its former ownership claim:
      // the central mapper would otherwise short-circuit a later repair.
      delete mesh.userData.naturalSurfaceCrossMeshUvOwner;
      delete mesh.userData.naturalSurfaceCrossMeshUvBatch;
    }
    if (options.deferUvToCrossMesh === true && materialSlot === PLATEAU_CLIFF_MATERIAL_SLOT) {
      stats.crossMeshUvsDeferred++;
      return true; // The later touching-mesa solve owns these UVs; a failed solve explicitly falls back to this normal mapper.
    }

    const mapper = window.HobunjiSurfaceStretchUV; // Used as the canonical Furniture + Avatar Author shared-edge surface detector and full-square UV mapper.
    if (typeof mapper?.mapMesh !== 'function') return false;
    const mappingOptions = {
      label,
      maxPatchWorldSize: WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE,
    }; // Used to give every wilderness cliff the same bounded stretch scale as the farm boundary.
    if (materialSlot != null) mappingOptions.materialIndex = materialSlot;

    const report = materialSlot === PLATEAU_CLIFF_MATERIAL_SLOT && typeof mapper.remapNaturalTerrainMesh === 'function'
      ? mapper.remapNaturalTerrainMesh(mesh, label) // Retains the Jigsaw-exclusion and faceted-outline wrappers on a failed batch.
      : mapper.mapMesh(mesh, mappingOptions); // Other cliff/rock paths retain their original 6u mapper options.
    if (!report) return false;
    if (materialSlot === PLATEAU_CLIFF_MATERIAL_SLOT) {
      mesh.userData = Object.assign({}, mesh.userData || {}, {
        terrainJigsawIgnore: true,
        naturalSurfaceUvOwner: 'HobunjiSurfaceStretchUV',
      }); // Explicit ownership is also safe when a test/editor loads the bare mapper without its exclusion adapter.
    }
    const missingAfter = !hasValidUvs(mesh); // Used by snapshot() to expose any final mapper failure on mobile.
    if (missingAfter) stats.missingUvsAfter++;
    stats.remappedMeshes++;
    mesh.userData = Object.assign({}, mesh.userData, {
      wildernessCliffSurfaceParity: true,
      wildernessCliffUvPatchWorldSize: WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE,
    });
    return true;
  }

  function scheduleFinalSurfacePass(meshes, labelPrefix, options = {}) {
    const candidates = (meshes || []).filter(mesh => isNaturalCliffCandidate(mesh, options) && !pendingMeshes.has(mesh)); // Used to avoid scheduling grass/base meshes and duplicate nested-builder passes.
    if (!candidates.length) return;
    for (const mesh of candidates) pendingMeshes.add(mesh);
    stats.scheduledPasses++;
    const scheduledAt = performance.now?.() ?? Date.now(); // Used only by recent diagnostics to distinguish successive zone rebuilds.

    const run = () => {
      let remapped = 0; // Used to summarize the meshes receiving a complete per-mesh UV solve.
      let deferred = 0; // Used to count plateau meshes whose single cross-mesh UV solve will run in the following microtask.
      try {
        const plateauCandidates = options.materialSlot === PLATEAU_CLIFF_MATERIAL_SLOT
          ? candidates.filter(mesh => Array.isArray(mesh.material) && mesh.material[PLATEAU_CLIFF_MATERIAL_SLOT])
          : []; // Used to ensure deferral only occurs when the cross-mesh adapter will actually accept two or more cliffs.
        const batchAvailable = plateauCandidates.length >= 2 && !!window.ZonePlateauMesa?.__hobunjiCrossMeshCliffUvWrapped; // Used to preserve per-mesh mapping when the later adapter is absent.
        for (let i = 0; i < candidates.length; i++) {
          const deferUvToCrossMesh = batchAvailable && plateauCandidates.includes(candidates[i]); // Used only for matching material-slot cliffs in a multi-mesa batch.
          if (applyFinalSurfacePass(candidates[i], labelPrefix + ':' + (candidates[i].name || i), { ...options, deferUvToCrossMesh })) {
            if (deferUvToCrossMesh) deferred++;
            else remapped++;
          }
        }
        stats.completedPasses++;
        const entry = { label: labelPrefix, meshes: candidates.length, remapped, deferred, materialSlot: options.materialSlot ?? null, scheduledAt }; // Used by snapshot() for mobile-visible recent history.
        stats.recent.push(entry);
        while (stats.recent.length > DEBUG_HISTORY_LIMIT) stats.recent.shift();
        debugLog(labelPrefix + ': farm-parity cliff pass mapped ' + remapped + '/' + candidates.length + ' mesh(es), deferred ' + deferred + ' to cross-mesh UV solve.');
      } catch (error) {
        stats.errors++;
        debugLog(`${labelPrefix}: final surface pass failed: ${error?.message || error}`, 'warn');
      } finally {
        for (const mesh of candidates) pendingMeshes.delete(mesh);
      }
    }; // Used after the complete synchronous wrapper stack so cleanup/slope edits cannot invalidate the final UVs.

    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  function patchZoneTerrainFeatures(api) {
    if (!api || api.__wildernessCliffSurfaceParityWrapped) return api;
    const original = api.buildRockFormationMeshes; // Used to keep existing wilderness cliff construction, cleanup, and material generation intact.
    if (typeof original === 'function') {
      api.buildRockFormationMeshes = function (scene, ...args) {
        const before = scene?.children?.length || 0; // Used to isolate rock/cliff meshes emitted by this exact wilderness build call.
        const result = original.call(this, scene, ...args);
        const mapId = String(args[3] || 'wilderness'); // Used only to identify the source zone in mobile diagnostics.
        scheduleFinalSurfacePass(captureNewMeshes(scene, before), `rock-cliff:${mapId}`);
        return result;
      };
    }
    api.__wildernessCliffSurfaceParityWrapped = true;
    return api;
  }

  function patchPlateauMesa(api) {
    if (!api || api.__wildernessCliffSurfaceParityWrapped) return api;

    const originalPlateau = api.buildPlateauMesa; // Used for callers that invoke one mesa directly through the public API.
    if (typeof originalPlateau === 'function') {
      api.buildPlateauMesa = function (...args) {
        const mesh = originalPlateau.apply(this, args); // Used as the finished plateau mesh after all inner geometry/material wrappers return.
        if (mesh?.isMesh) scheduleFinalSurfacePass([mesh], `plateau-cliff:${String(args[1] || 'wilderness')}`, { materialSlot: PLATEAU_CLIFF_MATERIAL_SLOT });
        return mesh;
      };
    }

    // The ordinary zone path calls a file-local buildPlateauMesa from inside
    // buildZoneMesaMeshes, bypassing wrappers on the exported single-mesa method.
    // Process the returned meshes here so slot 1 cannot remain the original
    // resolveTileMat(ROCK) Lambert/no-map material seen by Pixel Probe.
    const originalZoneMesas = api.buildZoneMesaMeshes;
    if (typeof originalZoneMesas === 'function') {
      api.buildZoneMesaMeshes = function (...args) {
        const meshes = originalZoneMesas.apply(this, args) || [];
        stats.plateauBuildsCaptured++;
        scheduleFinalSurfacePass(meshes, `plateau-zone:${String(args[1] || 'wilderness')}`, { materialSlot: PLATEAU_CLIFF_MATERIAL_SLOT });
        return meshes;
      };
    }

    // rebuildZoneMesaMeshes likewise uses its file-local zone builder and
    // returns nothing. Capture its direct Scene.add calls so runtime terrain
    // edits get exactly the same slot-1 material and UV treatment as first load.
    const originalRebuild = api.rebuildZoneMesaMeshes;
    if (typeof originalRebuild === 'function') {
      api.rebuildZoneMesaMeshes = function (...args) {
        const capture = runCapturingSceneAdds(() => originalRebuild.apply(this, args));
        stats.plateauRebuildsCaptured++;
        scheduleFinalSurfacePass(capture.meshes, `plateau-rebuild:${String(args[0] || 'wilderness')}`, { materialSlot: PLATEAU_CLIFF_MATERIAL_SLOT });
        return capture.result;
      };
    }

    api.__wildernessCliffSurfaceParityWrapped = true;
    return api;
  }

  // Border cliff skins are separate meshes laid over a grass base that still
  // covers the same steep cells, exactly like the farm border. Run the farm's
  // own finishing step on them (rock material, shell skipped, coplanar base
  // triangles removed) before the shared 6u final surface pass.
  function finishBorderLikeFarm(meshes) {
    const farmCliff = window.FarmCliffRockOutline; // Same post-create step farm-border-cliff-edge.js runs on the farm's skins.
    if (typeof farmCliff?.applyRockMaterialAndTextureOutline !== 'function') return 0;
    const changed = farmCliff.applyRockMaterialAndTextureOutline(meshes);
    stats.borderMeshesFarmFinished += changed;
    return changed;
  }

  function patchBorderTerrain(api) {
    if (!api || api.__wildernessCliffSurfaceParityWrapped) return api;
    const original = api.buildZoneBorderTerrain; // Wilderness zone boundaries.
    if (typeof original === 'function') {
      api.buildZoneBorderTerrain = function (scene, ...args) {
        const before = scene?.children?.length || 0; // Used to capture the zone border's grass base + cliff skins synchronously.
        const result = original.call(this, scene, ...args);
        const mapId = String(args[2] || 'wilderness'); // Used only to identify the boundary's zone in mobile diagnostics.
        const meshes = captureNewMeshes(scene, before);
        finishBorderLikeFarm(meshes);
        scheduleFinalSurfacePass(meshes, `zone-border:${mapId}`);
        return result;
      };
    }
    const originalTown = api.buildTownBorderTerrain; // Town boundary; its scene comes from BorderTerrain's deps, so capture its Scene.add calls instead.
    if (typeof originalTown === 'function') {
      api.buildTownBorderTerrain = function (...args) {
        const capture = runCapturingSceneAdds(() => originalTown.apply(this, args));
        stats.townBorderBuildsCaptured++;
        finishBorderLikeFarm(capture.meshes);
        scheduleFinalSurfacePass(capture.meshes, 'town-border');
        return capture.result;
      };
    }
    api.__wildernessCliffSurfaceParityWrapped = true;
    return api;
  }

  function chainGlobal(name, wrapper) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Used to compose with NaturalSurfaceMaterials/HobunjiSurfaceStretchUV late-load accessors instead of replacing them.
    if (descriptor?.get && descriptor?.set && descriptor.configurable) {
      const oldGet = descriptor.get; // Used to read the API managed by the previous accessor.
      const oldSet = descriptor.set; // Used to let all earlier wrappers prepare each future API assignment before this final-pass wrapper.
      const current = oldGet.call(window); // Used to patch an API that was already assigned before this adapter loaded.
      if (current) oldSet.call(window, wrapper(current));
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor.enumerable !== false,
        get() { return oldGet.call(window); },
        set(value) {
          oldSet.call(window, value);
          const prepared = oldGet.call(window); // Used as the earlier wrappers' fully prepared API before wilderness final-pass wrapping.
          if (prepared) oldSet.call(window, wrapper(prepared));
        },
      });
      return;
    }

    let current = window[name]; // Used as the backing API value when no earlier accessor exists.
    if (current) current = wrapper(current);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return current; },
        set(value) { current = wrapper(value); },
      });
    } catch (_) {
      if (window[name]) window[name] = wrapper(window[name]);
    }
  }

  window.WildernessCliffSurfaceParity = {
    installed: true,
    uvPatchWorldSize: WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE,
    plateauCliffMaterialSlot: PLATEAU_CLIFF_MATERIAL_SLOT,
    applyFinalSurfacePass,
    snapshot() {
      return {
        uvPatchWorldSize: WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE,
        plateauCliffMaterialSlot: PLATEAU_CLIFF_MATERIAL_SLOT,
        ...stats,
        recent: stats.recent.slice(),
      };
    },
  };

  chainGlobal('ZoneTerrainFeatures', patchZoneTerrainFeatures);
  chainGlobal('ZonePlateauMesa', patchPlateauMesa);
  chainGlobal('BorderTerrain', patchBorderTerrain);

  debugLog(`installed: all wilderness cliff paths finish on the farm's unlit rock material, then furniture-style connected-surface detection + full-PNG stretch at <=${WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE}u islands; plateau slot ${PLATEAU_CLIFF_MATERIAL_SLOT} is handled without touching grass.`);
})();
