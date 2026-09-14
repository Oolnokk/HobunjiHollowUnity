(() => {
  'use strict';

  const THREE = window.THREE; // Used for the exact Repeat/Clamp texture state that TerrainJigsawUV applies to wall-like islands.
  const mapper = window.HobunjiSurfaceStretchUV; // Natural terrain still enters through this mapper; the later segmented-Jigsaw adapter replaces only its UV solver.
  if (!THREE || !mapper?.installed || mapper.__naturalSurfaceJigsawExclusionInstalled) return;

  const WALL_NORMAL_Y_MAX = 0.55; // Matches terrain-render-chunks.js componentData(): lower area-weighted |normal.y| means a wall-like surface.
  const FINAL_OWNER = 'surface-split-jigsaw-v2'; // Only meshes successfully claimed by the single-pass hybrid receive Jigsaw material wrapping.
  const stats = {
    exclusionTags: 0,
    parityCalls: 0,
    meshesAdjusted: 0,
    repeatSlots: 0,
    alreadyMatched: 0,
    delayedForTexture: 0,
    revertedSlots: 0,
  }; // Exposed to Pixel Probe so valid Jigsaw UVs cannot be mistaken for full visual parity when the texture sampler is still clamped.

  const originalRemap = mapper.remapNaturalTerrainMesh; // Preserves the pre-Jigsaw natural-surface mapper until TerrainJigsawSurfaceSplit installs later in the loader.
  if (typeof originalRemap !== 'function') return;

  mapper.remapNaturalTerrainMesh = function (mesh, label = '') {
    const report = originalRemap.call(this, mesh, label);
    if (report && mesh?.userData) {
      mesh.userData.terrainJigsawIgnore = true; // Ordinary whole-mesh TerrainJigsawUV must not independently rebake natural rocks/cliffs.
      mesh.userData.naturalSurfaceUvOwner = 'HobunjiSurfaceStretchUV'; // The later hybrid overwrites this owner after its segmented bake succeeds.
      stats.exclusionTags++;
    }
    return report;
  };

  function materialArray(mesh) {
    return Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
  }

  function naturalSurfaceFor(mesh, material, materialIndex) {
    const explicit = material?.userData?.naturalSurface || mesh?.userData?.naturalSurface || null;
    if (explicit === 'rocks' || explicit === 'cliffs') return explicit;
    const cliffSlot = mesh?.userData?.naturalSurfaceCliffSlot;
    if (cliffSlot != null && Number(cliffSlot) === Number(materialIndex)) return 'cliffs';
    return null;
  }

  function materialIndexForElement(geometry, element) {
    const groups = geometry?.groups || [];
    if (!groups.length) return 0;
    for (const group of groups) {
      if (element >= group.start && element < group.start + group.count) return Number(group.materialIndex) || 0;
    }
    return 0;
  }

  function wallLikeSlots(mesh) {
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!position) return new Map();
    const index = geometry.index;
    const elementCount = Math.floor((index?.count ?? position.count) / 3) * 3;
    const materials = materialArray(mesh);
    const accum = new Map(); // materialIndex -> { normalAbsY, normalWeight } using the same cross-product weighting as TerrainJigsawUV.
    const sourceIndex = element => index ? index.getX(element) : element;

    for (let element = 0; element < elementCount; element += 3) {
      const materialIndex = materialIndexForElement(geometry, element);
      const material = materials[materialIndex] || materials[0];
      if (!naturalSurfaceFor(mesh, material, materialIndex) || !material?.map) continue;
      const ia = sourceIndex(element), ib = sourceIndex(element + 1), ic = sourceIndex(element + 2);
      const ax = position.getX(ib) - position.getX(ia);
      const ay = position.getY(ib) - position.getY(ia);
      const az = position.getZ(ib) - position.getZ(ia);
      const bx = position.getX(ic) - position.getX(ia);
      const by = position.getY(ic) - position.getY(ia);
      const bz = position.getZ(ic) - position.getZ(ia);
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const weight = Math.hypot(nx, ny, nz);
      if (!(weight > 1e-9)) continue;
      const rec = accum.get(materialIndex) || { normalAbsY: 0, normalWeight: 0 };
      rec.normalAbsY += Math.abs(ny);
      rec.normalWeight += weight;
      accum.set(materialIndex, rec);
    }

    const result = new Map();
    for (const [materialIndex, rec] of accum) {
      const ratio = rec.normalWeight > 0 ? rec.normalAbsY / rec.normalWeight : 1;
      result.set(materialIndex, ratio < WALL_NORMAL_Y_MAX);
    }
    return result;
  }

  function authoredTextureReady(texture) {
    if (!texture) return false;
    const image = texture.image || texture.source?.data;
    const width = Number(image?.naturalWidth || image?.videoWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.videoHeight || image?.height || 0);
    const state = String(texture.userData?.hobunjiAuthoredSurfaceState || '');
    if (state.startsWith('flat-')) return false;
    return width > 4 && height > 4; // NaturalSurfaceMaterials begins body-tinted surfaces on a 4x4 placeholder canvas.
  }

  function disposeParityMaterial(material) {
    if (!material?.userData?.terrainJigsawWallWrapParity) return;
    try { material.map?.dispose?.(); } catch (_) {}
    try { material.dispose?.(); } catch (_) {}
  }

  function makeRepeatMaterial(sourceMaterial) {
    if (!sourceMaterial?.map || !authoredTextureReady(sourceMaterial.map)) return null;
    const material = sourceMaterial.clone();
    const texture = sourceMaterial.map.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    texture.center?.set?.(0, 0);
    texture.rotation = 0;
    texture.matrixAutoUpdate = true;
    texture.name = `${sourceMaterial.map.name || 'natural'}__jigsaw_repeatU`;
    texture.userData = Object.assign({}, sourceMaterial.map.userData || {}, {
      terrainJigsawWallWrapParity: true,
      terrainJigsawWallWrapSourceName: sourceMaterial.map.name || '',
    });
    texture.needsUpdate = true;
    material.map = texture;
    material.name = `${sourceMaterial.name || 'natural'}__jigsaw_repeatU`;
    material.userData = Object.assign({}, sourceMaterial.userData || {}, {
      terrainJigsawMaterial: true,
      terrainJigsawWallWrapParity: true,
      terrainJigsawFinalOwner: FINAL_OWNER,
    });
    material.__hobunjiJigsawWallWrapSourceMaterial = sourceMaterial; // Runtime-only pointer used to revert safely if rebuilt geometry stops being wall-like.
    material.needsUpdate = true;
    return material;
  }

  function applyMaterialParity(mesh) {
    stats.parityCalls++;
    if (!mesh?.isMesh || mesh.userData?.terrainJigsawFinalOwner !== FINAL_OWNER) return false;
    const wallSlots = wallLikeSlots(mesh);
    const sourceMaterials = materialArray(mesh);
    const nextMaterials = sourceMaterials.slice();
    let changed = false;

    for (let materialIndex = 0; materialIndex < sourceMaterials.length; materialIndex++) {
      const current = sourceMaterials[materialIndex];
      const isWallLike = wallSlots.get(materialIndex) === true;
      if (isWallLike) {
        if (current?.userData?.terrainJigsawWallWrapParity && current.map?.wrapS === THREE.RepeatWrapping && current.map?.wrapT === THREE.ClampToEdgeWrapping) {
          stats.alreadyMatched++;
          continue;
        }
        const source = current?.__hobunjiJigsawWallWrapSourceMaterial || current;
        const replacement = makeRepeatMaterial(source);
        if (!replacement) {
          stats.delayedForTexture++;
          continue;
        }
        nextMaterials[materialIndex] = replacement;
        if (current !== source) disposeParityMaterial(current);
        stats.repeatSlots++;
        changed = true;
      } else if (current?.userData?.terrainJigsawWallWrapParity) {
        const source = current.__hobunjiJigsawWallWrapSourceMaterial;
        if (source) {
          nextMaterials[materialIndex] = source;
          disposeParityMaterial(current);
          stats.revertedSlots++;
          changed = true;
        }
      }
    }

    if (changed) {
      mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0];
      stats.meshesAdjusted++;
    }
    return changed;
  }

  function patchMapperAfterSegmentedJigsaw() {
    if (mapper.__hobunjiSegmentedJigsawMaterialParityInstalled) return;
    const previousMapMesh = mapper.mapMesh;
    const previousNaturalRemap = mapper.remapNaturalTerrainMesh;
    if (typeof previousMapMesh !== 'function' || typeof previousNaturalRemap !== 'function') return;

    mapper.mapMesh = function (mesh, options = {}) {
      const report = previousMapMesh.call(this, mesh, options);
      applyMaterialParity(mesh);
      return report;
    };
    mapper.remapNaturalTerrainMesh = function (mesh, label = '') {
      const report = previousNaturalRemap.call(this, mesh, label);
      applyMaterialParity(mesh);
      return report;
    };
    mapper.mapMesh.__hobunjiSegmentedJigsawMaterialParity = true;
    mapper.remapNaturalTerrainMesh.__hobunjiSegmentedJigsawMaterialParity = true;
    mapper.__hobunjiSegmentedJigsawMaterialParityInstalled = true;
  }

  let segmentedApi = window.TerrainJigsawSurfaceSplit || null; // Stored behind an accessor so this early module can patch the mapper the instant the later hybrid finishes installing.
  if (!segmentedApi) {
    const existingDescriptor = Object.getOwnPropertyDescriptor(window, 'TerrainJigsawSurfaceSplit');
    if (!existingDescriptor || existingDescriptor.configurable) {
      Object.defineProperty(window, 'TerrainJigsawSurfaceSplit', {
        configurable: true,
        enumerable: true,
        get() { return segmentedApi; },
        set(value) {
          segmentedApi = value;
          if (value?.installed && value?.owner === FINAL_OWNER) patchMapperAfterSegmentedJigsaw();
        },
      });
    }
  } else if (segmentedApi?.installed && segmentedApi?.owner === FINAL_OWNER) {
    patchMapperAfterSegmentedJigsaw();
  }

  function diagnostics() {
    return [
      '',
      '=== Segmented Jigsaw material parity ===',
      `repeat-wrap adjustedMeshes=${stats.meshesAdjusted} repeatSlots=${stats.repeatSlots} alreadyMatched=${stats.alreadyMatched} delayedForTexture=${stats.delayedForTexture} reverted=${stats.revertedSlots}`,
    ].join('\n');
  }

  function installProbeDiagnostics() {
    const result = document?.getElementById?.('debugProbeResult');
    if (!result || result.__hobunjiJigsawMaterialParityObserver || typeof MutationObserver !== 'function') return false;
    const marker = '=== Segmented Jigsaw material parity ===';
    const append = () => {
      const text = String(result.textContent || '');
      if (!text || text.includes(marker) || !text.startsWith('Pixel Probe report')) return;
      result.textContent = text + diagnostics();
    };
    const observer = new MutationObserver(() => queueMicrotask(append));
    observer.observe(result, { childList: true, subtree: true, characterData: true });
    result.__hobunjiJigsawMaterialParityObserver = observer;
    return true;
  }
  if (!installProbeDiagnostics()) window.addEventListener?.('DOMContentLoaded', installProbeDiagnostics, { once: true });

  mapper.__naturalSurfaceJigsawExclusionInstalled = true;
  window.NaturalSurfaceJigsawExclusion = {
    installed: true,
    applyMaterialParity,
    snapshot: () => Object.assign({}, stats),
  };
})();
