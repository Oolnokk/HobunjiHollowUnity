(() => {
  'use strict';

  const THREE = window.THREE; // Used to reconstruct the same shared-edge surface segmentation as HobunjiSurfaceStretchUV before delegating each surface to TerrainJigsawUV.
  const jigsaw = window.TerrainJigsawUV; // Used as the authoritative UV baker whose visual result is preserved on each detected terrain face.
  if (!THREE || !jigsaw?.bakeMesh || jigsaw.__hobunjiSurfaceSplitFinalInstalled) return;

  const OWNER = 'surface-split-jigsaw-v1'; // Used to make final UV ownership explicit to later natural-surface/runtime repair passes.
  const DEFAULT_SPLIT_ANGLE_DEG = 24; // Matches HobunjiSurfaceStretchUV's furniture-style adjacent-face split threshold.
  const SCAN_INTERVAL_MS = 250; // Bounds the final-owner scene traversal while still picking up newly generated/rebuilt terrain promptly.
  const QUANT_SCALE = 1e6; // Used to weld non-indexed corners back into logical shared-edge topology for segmentation only.
  const stats = {
    segmentedBakes: 0,
    surfacesBaked: 0,
    trianglesBaked: 0,
    meshesClaimed: 0,
    scanPasses: 0,
    skippedCurrentSignature: 0,
    failures: 0,
  }; // Used by Pixel Probe/debug callers to verify that jigsaw, not the old surface mapper, owns the final UVs.
  const lastScanAt = new WeakMap(); // Throttles the extra natural-terrain pass independently of TerrainJigsawUV's general scan.

  const wrappedBakeBeforeInstall = jigsaw.bakeMesh; // Public bake function as installed by the post-jigsaw guard, if present.
  const baseBake = wrappedBakeBeforeInstall.__hobunjiNaturalSurfacePostJigsawOriginal || wrappedBakeBeforeInstall; // Bypasses the old "jigsaw then reassert current mapper" manual wrapper on temporary per-surface meshes.
  const previousScan = typeof jigsaw.scanScene === 'function' ? jigsaw.scanScene.bind(jigsaw) : null; // Preserves ordinary terrain jigsaw processing before the natural-surface final pass.

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

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

  function isNaturalTerrainMesh(mesh) {
    if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !mesh.geometry) return false;
    const materials = materialArray(mesh);
    return materials.some((material, index) => naturalSurfaceFor(mesh, material, index));
  }

  function shouldSurfaceSplit(mesh, options = {}) {
    if (Number.isFinite(Number(options.surfaceSplitAngleDeg))) return true;
    if (/\/tools\/background-scenery-author\//.test(location.pathname)) return true; // The comparison tool should show the same split-jigsaw result that gameplay uses on cliffs.
    return isNaturalTerrainMesh(mesh);
  }

  function splitAngleFor(mesh, options = {}) {
    const explicit = Number(options.surfaceSplitAngleDeg);
    if (Number.isFinite(explicit)) return Math.max(1, Math.min(89, explicit));
    const tagged = Number(mesh?.userData?.terrainJigsawSplitAngleDeg);
    if (Number.isFinite(tagged)) return Math.max(1, Math.min(89, tagged));
    return DEFAULT_SPLIT_ANGLE_DEG;
  }

  function eligibleMaterial(material) {
    return !!(material?.map && !material.transparent && Number(material.opacity ?? 1) >= 0.99);
  }

  function materialIndexForElement(geometry, element) {
    const groups = geometry?.groups || [];
    if (!groups.length) return 0;
    for (const group of groups) {
      if (element >= group.start && element < group.start + group.count) return Number(group.materialIndex) || 0;
    }
    return 0;
  }

  function vertexKey(position, index) {
    return `${Math.round(position.getX(index) * QUANT_SCALE)},${Math.round(position.getY(index) * QUANT_SCALE)},${Math.round(position.getZ(index) * QUANT_SCALE)}`;
  }

  function edgeKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function seedUv(geometry) {
    const position = geometry?.getAttribute?.('position');
    if (!position) return null;
    let uv = geometry.getAttribute('uv');
    if (uv?.count === position.count && Number(uv.itemSize || 0) >= 2) return uv;
    const values = new Float32Array(position.count * 2); // TerrainJigsawUV requires a writable UV attribute even though it replaces its values.
    for (let index = 0; index < position.count; index++) {
      values[index * 2] = position.getX(index);
      values[index * 2 + 1] = position.getZ(index);
    }
    uv = new THREE.BufferAttribute(values, 2);
    geometry.setAttribute('uv', uv);
    return uv;
  }

  function collectSurfaceTriangles(geometry, mesh, splitAngleDeg) {
    const position = geometry.getAttribute('position');
    const materials = materialArray(mesh);
    const triangleCount = Math.floor(position.count / 3);
    const triangles = [];
    const edgeOwners = new Map();

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      const base = triangleIndex * 3;
      const materialIndex = materialIndexForElement(geometry, base);
      const material = materials[materialIndex] || materials[0];
      if (!eligibleMaterial(material)) continue;

      const keys = [vertexKey(position, base), vertexKey(position, base + 1), vertexKey(position, base + 2)];
      const a = new THREE.Vector3(position.getX(base), position.getY(base), position.getZ(base));
      const b = new THREE.Vector3(position.getX(base + 1), position.getY(base + 1), position.getZ(base + 1));
      const c = new THREE.Vector3(position.getX(base + 2), position.getY(base + 2), position.getZ(base + 2));
      const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const normal = cross.lengthSq() > 1e-16 ? cross.normalize() : new THREE.Vector3(0, 1, 0);
      const localIndex = triangles.length;
      triangles.push({ triangleIndex, base, materialIndex, keys, normal, component: -1 });

      for (let edge = 0; edge < 3; edge++) {
        const key = `${materialIndex}:${edgeKey(keys[edge], keys[(edge + 1) % 3])}`;
        const owners = edgeOwners.get(key) || [];
        owners.push(localIndex);
        edgeOwners.set(key, owners);
      }
    }

    const neighbors = Array.from({ length: triangles.length }, () => []);
    for (const owners of edgeOwners.values()) {
      if (owners.length < 2) continue;
      for (let i = 0; i < owners.length; i++) {
        for (let j = i + 1; j < owners.length; j++) {
          neighbors[owners[i]].push(owners[j]);
          neighbors[owners[j]].push(owners[i]);
        }
      }
    }

    const cosThreshold = Math.cos(THREE.MathUtils.degToRad(splitAngleDeg));
    const surfaces = [];
    for (let start = 0; start < triangles.length; start++) {
      if (triangles[start].component >= 0) continue;
      const id = surfaces.length;
      const stack = [start];
      const members = [];
      triangles[start].component = id;
      while (stack.length) {
        const currentIndex = stack.pop();
        const current = triangles[currentIndex];
        members.push(currentIndex);
        for (const neighborIndex of neighbors[currentIndex]) {
          const neighbor = triangles[neighborIndex];
          if (neighbor.component >= 0) continue;
          if (current.materialIndex !== neighbor.materialIndex) continue;
          if (current.normal.dot(neighbor.normal) + 1e-7 < cosThreshold) continue;
          neighbor.component = id;
          stack.push(neighborIndex);
        }
      }
      surfaces.push({ id, materialIndex: triangles[start].materialIndex, members });
    }

    return { triangles, surfaces };
  }

  function copyTrianglePositions(sourcePosition, surface, topology) {
    const values = new Float32Array(surface.members.length * 9);
    let write = 0;
    for (const localTriangleIndex of surface.members) {
      const triangle = topology.triangles[localTriangleIndex];
      for (let corner = 0; corner < 3; corner++) {
        const sourceIndex = triangle.base + corner;
        values[write++] = sourcePosition.getX(sourceIndex);
        values[write++] = sourcePosition.getY(sourceIndex);
        values[write++] = sourcePosition.getZ(sourceIndex);
      }
    }
    return values;
  }

  function textureDimensions(material) {
    const image = material?.map?.image || material?.map?.source?.data;
    return `${Number(image?.naturalWidth || image?.width || 0)}x${Number(image?.naturalHeight || image?.height || 0)}`;
  }

  function finalSignature(mesh, geometry, splitAngleDeg, options) {
    const materials = materialArray(mesh);
    const textureState = materials.map((material, index) => `${index}:${textureDimensions(material)}:${String(material?.map?.userData?.hobunjiAuthoredSurfaceState || '')}`).join('|');
    return `${OWNER}|angle=${splitAngleDeg}|edgePx=${finite(options.edgePx, jigsaw.defaults?.edgePx ?? 16)}|edgeWorld=${finite(options.edgeWorldWidth, jigsaw.defaults?.edgeWorldWidth ?? 0.5)}|positions=${geometry.getAttribute('position')?.count || 0}|textures=${textureState}`;
  }

  function cloneJigsawMaterial(material, repeatU) {
    if (!material) return material;
    const clone = material.clone();
    clone.userData = Object.assign({}, material.userData || {}, { terrainJigsawMaterial: true, terrainJigsawFinalOwner: OWNER });
    if (material.map) {
      const texture = material.map.clone();
      texture.wrapS = repeatU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(1, 1);
      texture.offset.set(0, 0);
      texture.center?.set?.(0, 0);
      texture.rotation = 0;
      texture.matrixAutoUpdate = true;
      texture.needsUpdate = true;
      clone.map = texture;
    }
    clone.needsUpdate = true;
    return clone;
  }

  function disposeOwnedMaterial(material) {
    if (material?.userData?.terrainJigsawFinalOwner !== OWNER) return;
    try { material.map?.dispose?.(); } catch (_) {}
    try { material.dispose?.(); } catch (_) {}
  }

  function segmentedBake(mesh, options = {}) {
    if (!mesh?.isMesh || !mesh.geometry) return null;
    const splitAngleDeg = splitAngleFor(mesh, options);
    const sourceGeometry = mesh.geometry;
    const working = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone(); // Independent corners are required because detected faces intentionally become UV seams.
    const uv = seedUv(working);
    const position = working.getAttribute('position');
    if (!position || !uv) { working.dispose?.(); stats.failures++; return null; }

    const signature = finalSignature(mesh, working, splitAngleDeg, options);
    if (!options.force && sourceGeometry.userData?.terrainJigsawSurfaceSplitSignature === signature && mesh.userData?.terrainJigsawFinalOwner === OWNER) {
      working.dispose?.();
      stats.skippedCurrentSignature++;
      return mesh.userData?.terrainJigsawStats || sourceGeometry.userData?.terrainJigsawStats || null;
    }

    const topology = collectSurfaceTriangles(working, mesh, splitAngleDeg);
    if (!topology.surfaces.length) { working.dispose?.(); stats.failures++; return null; }

    const materials = materialArray(mesh);
    const repeatByMaterial = new Map();
    let islands = 0;
    let triangles = 0;
    let successfulSurfaces = 0;

    for (const surface of topology.surfaces) {
      const sourceMaterial = materials[surface.materialIndex] || materials[0];
      if (!eligibleMaterial(sourceMaterial)) continue;
      const tempGeometry = new THREE.BufferGeometry();
      const tempPositions = copyTrianglePositions(position, surface, topology);
      tempGeometry.setAttribute('position', new THREE.BufferAttribute(tempPositions, 3));
      tempGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((tempPositions.length / 3) * 2), 2));
      const tempMaterial = sourceMaterial.clone();
      tempMaterial.map = sourceMaterial.map;
      tempMaterial.transparent = false;
      tempMaterial.opacity = 1;
      tempMaterial.depthWrite = true;
      const tempMesh = new THREE.Mesh(tempGeometry, tempMaterial);
      const result = baseBake.call(jigsaw, tempMesh, {
        edgePx: finite(options.edgePx, jigsaw.defaults?.edgePx ?? 16),
        edgeWorldWidth: finite(options.edgeWorldWidth, jigsaw.defaults?.edgeWorldWidth ?? 0.5),
        force: true,
        disposeSource: false,
      });
      tempMaterial.dispose?.();
      if (!result) {
        tempMesh.geometry?.dispose?.();
        if (tempMesh.geometry !== tempGeometry) tempGeometry.dispose?.();
        stats.failures++;
        continue;
      }

      const bakedGeometry = tempMesh.geometry;
      const bakedUv = bakedGeometry.getAttribute('uv');
      const bakedIndex = bakedGeometry.index;
      let element = 0;
      for (const localTriangleIndex of surface.members) {
        const triangle = topology.triangles[localTriangleIndex];
        for (let corner = 0; corner < 3; corner++, element++) {
          const bakedVertex = bakedIndex ? bakedIndex.getX(element) : element;
          uv.setXY(triangle.base + corner, bakedUv.getX(bakedVertex), bakedUv.getY(bakedVertex));
        }
      }
      const bakedMaterial = Array.isArray(tempMesh.material) ? tempMesh.material[0] : tempMesh.material;
      if (bakedMaterial?.map?.wrapS === THREE.RepeatWrapping) repeatByMaterial.set(surface.materialIndex, true);
      islands += Number(result.islands || 1);
      triangles += Number(result.triangles || surface.members.length);
      successfulSurfaces++;
      if (bakedMaterial && bakedMaterial !== sourceMaterial) {
        try { if (bakedMaterial.map && bakedMaterial.map !== sourceMaterial.map) bakedMaterial.map.dispose?.(); } catch (_) {}
        try { bakedMaterial.dispose?.(); } catch (_) {}
      }
      bakedGeometry.dispose?.();
      if (bakedGeometry !== tempGeometry) tempGeometry.dispose?.();
    }

    if (!successfulSurfaces) {
      working.dispose?.();
      stats.failures++;
      return null;
    }

    uv.needsUpdate = true;
    working.userData = Object.assign({}, working.userData || {}, {
      terrainJigsawBaked: true,
      terrainJigsawFinalOwner: OWNER,
      terrainJigsawSurfaceSplitSignature: signature,
      hobunjiSurfaceStretchSignature: null,
      hobunjiSurfaceStretch: null,
    });
    const nextMaterials = materials.map((material, index) => eligibleMaterial(material) ? cloneJigsawMaterial(material, !!repeatByMaterial.get(index)) : material);
    const oldMaterials = materials.slice();
    mesh.geometry = working;
    mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0];
    mesh.userData = Object.assign({}, mesh.userData || {}, {
      terrainJigsawIgnore: false,
      terrainJigsawBaked: true,
      terrainJigsawFinalOwner: OWNER,
      terrainJigsawSplitAngleDeg: splitAngleDeg,
      terrainGeometryRevision: (Number(mesh.userData?.terrainGeometryRevision) || 0) + 1,
      terrainJigsawStats: {
        islands,
        surfaces: successfulSurfaces,
        triangles,
        verticesBefore: sourceGeometry.getAttribute('position')?.count || 0,
        verticesAfter: working.getAttribute('position')?.count || 0,
        edgePx: finite(options.edgePx, jigsaw.defaults?.edgePx ?? 16),
        edgeWorldWidth: finite(options.edgeWorldWidth, jigsaw.defaults?.edgeWorldWidth ?? 0.5),
        splitAngleDeg,
        finalOwner: OWNER,
      },
    });
    for (let index = 0; index < oldMaterials.length; index++) if (oldMaterials[index] !== nextMaterials[index]) disposeOwnedMaterial(oldMaterials[index]);
    if (options.disposeSource !== false && sourceGeometry !== working) {
      try { sourceGeometry.dispose?.(); } catch (_) {}
    }
    stats.segmentedBakes++;
    stats.surfacesBaked += successfulSurfaces;
    stats.trianglesBaked += triangles;
    stats.meshesClaimed++;
    return mesh.userData.terrainJigsawStats;
  }

  function publicBake(mesh, options = {}) {
    if (shouldSurfaceSplit(mesh, options)) {
      if (mesh?.userData) delete mesh.userData.terrainJigsawIgnore;
      return segmentedBake(mesh, options);
    }
    return wrappedBakeBeforeInstall.call(jigsaw, mesh, options);
  }

  function scanFinalNaturalSurfaces(scene, now = performance.now()) {
    if (!scene?.isScene || scene.userData?.terrainJigsawDisableAuto) return 0;
    const previous = lastScanAt.get(scene) ?? -Infinity;
    if (now - previous < SCAN_INTERVAL_MS) return 0;
    lastScanAt.set(scene, now);
    stats.scanPasses++;
    let made = 0;
    scene.traverse(object => {
      if (!isNaturalTerrainMesh(object)) return;
      const angle = splitAngleFor(object, {});
      const geometry = object.geometry;
      if (object.userData?.terrainJigsawFinalOwner === OWNER && geometry?.userData?.terrainJigsawSurfaceSplitSignature) {
        const signature = finalSignature(object, geometry, angle, {});
        if (geometry.userData.terrainJigsawSurfaceSplitSignature === signature) return;
      }
      if (object.userData) delete object.userData.terrainJigsawIgnore;
      const result = segmentedBake(object, { force: true, disposeSource: true, surfaceSplitAngleDeg: angle });
      if (result) made++;
    });
    return made;
  }

  function scanScene(scene, now = performance.now()) {
    let ordinary = 0;
    if (previousScan) {
      const natural = [];
      scene?.traverse?.(object => {
        if (!isNaturalTerrainMesh(object)) return;
        natural.push([object, object.userData?.terrainJigsawIgnore]);
        object.userData = Object.assign({}, object.userData || {}, { terrainJigsawIgnore: true }); // Prevents the old unsplit auto scan from doing throwaway work on natural cliffs before the final segmented pass.
      });
      ordinary = Number(previousScan(scene, now)) || 0;
      for (const [object, previousIgnore] of natural) {
        if (!object?.userData) continue;
        if (previousIgnore) object.userData.terrainJigsawIgnore = previousIgnore;
        else delete object.userData.terrainJigsawIgnore;
      }
    }
    return ordinary + scanFinalNaturalSurfaces(scene, now);
  }

  function protectFinalOwnership() {
    const mapper = window.HobunjiSurfaceStretchUV;
    if (mapper?.remapNaturalTerrainMesh && !mapper.remapNaturalTerrainMesh.__hobunjiJigsawFinalProtected) {
      const previousRemap = mapper.remapNaturalTerrainMesh;
      function protectedRemap(mesh, label = '') {
        const position = mesh?.geometry?.getAttribute?.('position');
        const uv = mesh?.geometry?.getAttribute?.('uv');
        if (mesh?.userData?.terrainJigsawFinalOwner === OWNER && position && uv?.count === position.count && Number(uv.itemSize || 0) >= 2) {
          if (mesh.userData) delete mesh.userData.terrainJigsawIgnore;
          return mesh.userData.terrainJigsawStats || mesh.geometry?.userData?.terrainJigsawStats || { mapping: OWNER, label };
        }
        return previousRemap.call(this, mesh, label);
      }
      protectedRemap.__hobunjiJigsawFinalProtected = true;
      protectedRemap.__hobunjiJigsawFinalOriginal = previousRemap;
      mapper.remapNaturalTerrainMesh = protectedRemap;
    }

    const plateau = window.ZonePlateauMesa;
    if (plateau?.buildZoneMesaMeshes?.__hobunjiCrossMeshCliffUvOriginal) plateau.buildZoneMesaMeshes = plateau.buildZoneMesaMeshes.__hobunjiCrossMeshCliffUvOriginal;
    if (plateau?.rebuildZoneMesaMeshes?.__hobunjiCrossMeshCliffUvOriginal) plateau.rebuildZoneMesaMeshes = plateau.rebuildZoneMesaMeshes.__hobunjiCrossMeshCliffUvOriginal;
  }

  jigsaw.bakeMesh = publicBake;
  jigsaw.scanScene = scanScene;
  jigsaw.__hobunjiSurfaceSplitFinalInstalled = true;
  jigsaw.__hobunjiSurfaceSplitFinalOwner = OWNER;
  protectFinalOwnership();
  if (typeof queueMicrotask === 'function') queueMicrotask(protectFinalOwnership);
  window.addEventListener?.('DOMContentLoaded', protectFinalOwnership, { once: true });

  window.TerrainJigsawSurfaceSplit = {
    installed: true,
    owner: OWNER,
    splitAngleDeg: DEFAULT_SPLIT_ANGLE_DEG,
    bakeMesh: segmentedBake,
    scanScene: scanFinalNaturalSurfaces,
    snapshot() { return Object.assign({}, stats); },
  };
})();
