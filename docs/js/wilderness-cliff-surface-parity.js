(() => {
  'use strict';

  const THREE = window.THREE; // Used to recognize terrain meshes and preserve Three.js geometry/material conventions.
  if (!THREE || window.WildernessCliffSurfaceParity?.installed) return;

  const WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE = 6; // Used to match the farm boundary's bounded full-PNG surface scale on long wilderness cliff walls.
  const DEBUG_HISTORY_LIMIT = 16; // Used to keep mobile-visible final-pass history bounded.
  const stats = {
    scheduledPasses: 0,
    completedPasses: 0,
    capturedMeshes: 0,
    candidateMeshes: 0,
    remappedMeshes: 0,
    boundaryMeshesRockified: 0,
    staleMappingsCleared: 0,
    missingUvsBefore: 0,
    missingUvsAfter: 0,
    errors: 0,
    recent: [],
  }; // Used by snapshot() and the in-game render log to verify wilderness cliff parity without DevTools.

  function debugLog(message, level = 'render') {
    const text = `[wilderness-cliff-surface] ${message}`; // Used as the common in-game/mobile diagnostic prefix.
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level);
    else (level === 'warn' ? console.warn : console.debug)(text);
  }

  function surfaceForMesh(mesh) {
    const direct = mesh?.userData?.naturalSurface || null; // Used first because the natural-surface pipeline tags single-material rock/cliff meshes directly.
    if (direct) return direct;
    const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]; // Used as a fallback when only the material retained its natural-surface tag.
    for (const material of materials) {
      const materialSurface = material?.userData?.naturalSurface || null; // Used to recover rock/cliff identity from a material slot.
      if (materialSurface) return materialSurface;
    }
    return null;
  }

  function hasValidUvs(mesh) {
    const position = mesh?.geometry?.getAttribute?.('position'); // Used as the authoritative vertex-count reference for the final UV attribute.
    const uv = mesh?.geometry?.getAttribute?.('uv'); // Used to catch the exact no-UV wilderness cliff state reported by Pixel Probe.
    return !!(position && uv && uv.count === position.count && Number(uv.itemSize || 0) >= 2);
  }

  function isNaturalCliffCandidate(mesh) {
    if (!mesh?.isMesh || !mesh.geometry) return false;
    const surface = surfaceForMesh(mesh); // Used to accept both farm-style rocks and legacy wilderness cliff tags.
    return surface === 'rocks' || surface === 'cliffs' || mesh.userData?.naturalSurfaceCliffSlot != null;
  }

  function captureNewMeshes(scene, beforeCount) {
    const children = scene?.children || []; // Used to capture exact direct meshes before unrelated asynchronous scene additions can occur.
    const meshes = children.slice(Math.max(0, Number(beforeCount) || 0)).filter(child => child?.isMesh); // Used by deferred final passes instead of re-scanning a wider scene later.
    stats.capturedMeshes += meshes.length;
    return meshes;
  }

  function makeBoundaryMaterialMatchFarm(mesh) {
    if (!mesh?.isMesh || mesh.userData?.naturalSurfaceCliffSlot != null) return false;
    if (surfaceForMesh(mesh) !== 'cliffs') return false;
    const natural = window.NaturalSurfaceMaterials; // Used to reuse the exact farm rock material + carved_smooth body-tint factory.
    if (typeof natural?.naturalizeMesh !== 'function') return false;

    natural.naturalizeMesh(mesh, 'rocks');
    window.FacetedNaturalSurfaceShellReduction?.suppressMesh?.(mesh, 'rocks');
    mesh.userData = Object.assign({}, mesh.userData, {
      wildernessCliffMaterialParity: 'farm-boundary-rock',
    });
    stats.boundaryMeshesRockified++;
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
    if (cleared) stats.staleMappingsCleared++;
    return cleared;
  }

  function applyFinalSurfacePass(mesh, label, options = {}) {
    if (!isNaturalCliffCandidate(mesh)) return false;
    stats.candidateMeshes++;
    const missingBefore = !hasValidUvs(mesh); // Used to prove the final pass repairs Pixel Probe's no-UV cliff-hit failure mode.
    if (missingBefore) stats.missingUvsBefore++;

    if (options.matchFarmBoundaryMaterial) makeBoundaryMaterialMatchFarm(mesh);
    clearCachedSurfaceMapping(mesh);

    const mapper = window.HobunjiSurfaceStretchUV; // Used as the canonical Furniture + Avatar Author shared-edge surface detector and full-square UV mapper.
    if (typeof mapper?.mapMesh !== 'function') return false;
    const cliffSlot = mesh.userData?.naturalSurfaceCliffSlot; // Used to preserve grass/top UVs on shared plateau meshes while remapping only the cliff material slot.
    const mappingOptions = {
      label,
      maxPatchWorldSize: WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE,
    }; // Used to give every wilderness cliff the same bounded stretch scale as the farm boundary.
    if (cliffSlot != null) mappingOptions.materialIndex = Number(cliffSlot);

    const report = mapper.mapMesh(mesh, mappingOptions); // Runs after every synchronous wilderness geometry modifier so this result is authoritative.
    if (!report) return false;
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
    const candidates = (meshes || []).filter(isNaturalCliffCandidate); // Used to avoid scheduling work for the grass/base mesh emitted by the same terrain builders.
    if (!candidates.length) return;
    stats.scheduledPasses++;
    const scheduledAt = performance.now?.() ?? Date.now(); // Used only by recent diagnostics to distinguish successive zone rebuilds.

    const run = () => {
      let remapped = 0; // Used to summarize one completed builder-level final pass.
      try {
        for (let i = 0; i < candidates.length; i++) {
          if (applyFinalSurfacePass(candidates[i], `${labelPrefix}:${candidates[i].name || i}`, options)) remapped++;
        }
        stats.completedPasses++;
        const entry = { label: labelPrefix, meshes: candidates.length, remapped, scheduledAt }; // Used by snapshot() for mobile-visible recent history.
        stats.recent.push(entry);
        while (stats.recent.length > DEBUG_HISTORY_LIMIT) stats.recent.shift();
        debugLog(`${labelPrefix}: final farm-parity surface pass remapped ${remapped}/${candidates.length} cliff mesh(es) at ${WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE}u max UV islands.`);
      } catch (error) {
        stats.errors++;
        debugLog(`${labelPrefix}: final surface pass failed: ${error?.message || error}`, 'warn');
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
    const original = api.buildPlateauMesa; // Used to preserve plateau top/cliff material-group classification before the final cliff-slot UV pass.
    if (typeof original === 'function') {
      api.buildPlateauMesa = function (...args) {
        const mesh = original.apply(this, args); // Used as the finished plateau mesh after all inner geometry/material wrappers return.
        if (mesh?.isMesh) scheduleFinalSurfacePass([mesh], `plateau-cliff:${mesh.name || 'mesa'}`);
        return mesh;
      };
    }
    api.__wildernessCliffSurfaceParityWrapped = true;
    return api;
  }

  function patchBorderTerrain(api) {
    if (!api || api.__wildernessCliffSurfaceParityWrapped) return api;
    const original = api.buildZoneBorderTerrain; // Used to target shared wilderness boundaries without changing farm/town builders.
    if (typeof original === 'function') {
      api.buildZoneBorderTerrain = function (scene, ...args) {
        const before = scene?.children?.length || 0; // Used to capture the zone border's grass base + cliff skins synchronously.
        const result = original.call(this, scene, ...args);
        const mapId = String(args[2] || 'wilderness'); // Used only to identify the boundary's zone in mobile diagnostics.
        scheduleFinalSurfacePass(captureNewMeshes(scene, before), `zone-border:${mapId}`, { matchFarmBoundaryMaterial: true });
        return result;
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

    let current = window[name]; // Used as the backing API value when no earlier accessor is installed.
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
    applyFinalSurfacePass,
    snapshot() {
      return {
        uvPatchWorldSize: WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE,
        ...stats,
        recent: stats.recent.slice(),
      };
    },
  };

  chainGlobal('ZoneTerrainFeatures', patchZoneTerrainFeatures);
  chainGlobal('ZonePlateauMesa', patchPlateauMesa);
  chainGlobal('BorderTerrain', patchBorderTerrain);

  debugLog(`installed: wilderness cliffs use farm rock material parity where applicable, then furniture-style surface detection + full-PNG stretch at <=${WILDERNESS_CLIFF_UV_PATCH_WORLD_SIZE}u islands after final geometry edits.`);
})();
