(() => {
  'use strict';

  // Hybrid natural-terrain UV owner.
  //
  // Keep HobunjiSurfaceStretchUV's useful behavior — splitting a cliff/rock mesh
  // into separate surfaces by shared-edge normal continuity — but use the actual
  // TerrainJigsawUV baker for the UVs inside each detected surface. This module
  // deliberately does NOT wrap renderer.render(), TerrainJigsawUV.scanScene(), or
  // replace live materials. It only replaces UV geometry when a natural-surface
  // mapper call occurs, so there is one owner instead of two systems fighting on
  // every frame.
  const THREE = window.THREE;
  const jigsaw = window.TerrainJigsawUV;
  const mapper = window.HobunjiSurfaceStretchUV;
  if (!THREE || !jigsaw?.bakeMesh || !mapper?.installed || window.TerrainJigsawSurfaceSplit?.installed) return;

  const OWNER = 'surface-split-jigsaw-v2';
  const DEFAULT_SPLIT_ANGLE_DEG = 24;
  const QUANT_SCALE = 1e6;
  const wrappedBake = jigsaw.bakeMesh;
  const baseBake = wrappedBake.__hobunjiNaturalSurfacePostJigsawOriginal || wrappedBake;
  const originalMapMesh = mapper.mapMesh;
  const originalRemapNatural = mapper.remapNaturalTerrainMesh;
  const stats = {
    bakes: 0,
    surfaces: 0,
    triangles: 0,
    meshes: 0,
    cacheHits: 0,
    failures: 0,
    last: [],
  };

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
    return materialArray(mesh).some((material, index) => !!naturalSurfaceFor(mesh, material, index));
  }

  function eligibleNaturalMaterial(mesh, material, materialIndex) {
    return !!(
      naturalSurfaceFor(mesh, material, materialIndex)
      && material?.map
      && !material.transparent
      && Number(material.opacity ?? 1) >= 0.99
    );
  }

  function splitAngleFor(mesh, options = {}) {
    const explicit = Number(options.surfaceSplitAngleDeg ?? options.angleToleranceDeg);
    if (Number.isFinite(explicit)) return Math.max(1, Math.min(89, explicit));
    const tagged = Number(mesh?.userData?.terrainJigsawSplitAngleDeg);
    if (Number.isFinite(tagged)) return Math.max(1, Math.min(89, tagged));
    return DEFAULT_SPLIT_ANGLE_DEG;
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
    const values = new Float32Array(position.count * 2);
    for (let index = 0; index < position.count; index++) {
      values[index * 2] = position.getX(index);
      values[index * 2 + 1] = position.getZ(index);
    }
    uv = new THREE.BufferAttribute(values, 2);
    geometry.setAttribute('uv', uv);
    return uv;
  }

  function collectSurfaces(geometry, mesh, splitAngleDeg) {
    const position = geometry.getAttribute('position');
    const materials = materialArray(mesh);
    const triangleCount = Math.floor(position.count / 3);
    const triangles = [];
    const edgeOwners = new Map();

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      const base = triangleIndex * 3;
      const materialIndex = materialIndexForElement(geometry, base);
      const material = materials[materialIndex] || materials[0];
      if (!eligibleNaturalMaterial(mesh, material, materialIndex)) continue;

      const keys = [vertexKey(position, base), vertexKey(position, base + 1), vertexKey(position, base + 2)];
      const a = new THREE.Vector3(position.getX(base), position.getY(base), position.getZ(base));
      const b = new THREE.Vector3(position.getX(base + 1), position.getY(base + 1), position.getZ(base + 1));
      const c = new THREE.Vector3(position.getX(base + 2), position.getY(base + 2), position.getZ(base + 2));
      const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const normal = cross.lengthSq() > 1e-16 ? cross.normalize() : new THREE.Vector3(0, 1, 0);
      const localIndex = triangles.length;
      triangles.push({ base, materialIndex, keys, normal, component: -1 });

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
      for (let i = 0; i < owners.length; i++) for (let j = i + 1; j < owners.length; j++) {
        neighbors[owners[i]].push(owners[j]);
        neighbors[owners[j]].push(owners[i]);
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
          if (neighbor.materialIndex !== current.materialIndex) continue;
          if (current.normal.dot(neighbor.normal) + 1e-7 < cosThreshold) continue;
          neighbor.component = id;
          stack.push(neighborIndex);
        }
      }
      surfaces.push({ id, materialIndex: triangles[start].materialIndex, members });
    }
    return { triangles, surfaces };
  }

  function copySurfacePositions(position, surface, topology) {
    const values = new Float32Array(surface.members.length * 9);
    let write = 0;
    for (const localTriangleIndex of surface.members) {
      const triangle = topology.triangles[localTriangleIndex];
      for (let corner = 0; corner < 3; corner++) {
        const sourceIndex = triangle.base + corner;
        values[write++] = position.getX(sourceIndex);
        values[write++] = position.getY(sourceIndex);
        values[write++] = position.getZ(sourceIndex);
      }
    }
    return values;
  }

  function textureState(mesh) {
    return materialArray(mesh).map((material, index) => {
      const image = material?.map?.image || material?.map?.source?.data;
      const width = Number(image?.naturalWidth || image?.width || 0);
      const height = Number(image?.naturalHeight || image?.height || 0);
      const state = String(material?.map?.userData?.hobunjiAuthoredSurfaceState || '');
      return `${index}:${width}x${height}:${state}`;
    }).join('|');
  }

  function signatureFor(mesh, geometry, splitAngleDeg, options) {
    const edgePx = finite(options.edgePx, jigsaw.defaults?.edgePx ?? 16);
    const edgeWorldWidth = finite(options.edgeWorldWidth, jigsaw.defaults?.edgeWorldWidth ?? 0.5);
    return `${OWNER}|angle=${splitAngleDeg}|edgePx=${edgePx}|edgeWorld=${edgeWorldWidth}|positions=${geometry.getAttribute('position')?.count || 0}|textures=${textureState(mesh)}`;
  }

  function disposeTempJigsawMaterial(material, sourceMap) {
    const list = Array.isArray(material) ? material : [material];
    for (const item of list) {
      if (!item) continue;
      try { if (item.map && item.map !== sourceMap) item.map.dispose?.(); } catch (_) {}
      try { item.dispose?.(); } catch (_) {}
    }
  }

  function segmentedBake(mesh, options = {}) {
    if (!isNaturalTerrainMesh(mesh)) return null;
    const sourceGeometry = mesh.geometry;
    const splitAngleDeg = splitAngleFor(mesh, options);
    const expectedSignature = signatureFor(mesh, sourceGeometry, splitAngleDeg, options);
    const sourcePosition = sourceGeometry.getAttribute?.('position');
    const sourceUv = sourceGeometry.getAttribute?.('uv');
    if (!options.force
        && mesh.userData?.terrainJigsawFinalOwner === OWNER
        && sourceGeometry.userData?.terrainJigsawSurfaceSplitSignature === expectedSignature
        && sourcePosition
        && sourceUv?.count === sourcePosition.count
        && Number(sourceUv.itemSize || 0) >= 2) {
      stats.cacheHits++;
      return mesh.userData.terrainJigsawStats || sourceGeometry.userData.terrainJigsawStats || null;
    }

    const working = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
    const uv = seedUv(working);
    const position = working.getAttribute('position');
    if (!position || !uv) {
      working.dispose?.();
      stats.failures++;
      return null;
    }

    const topology = collectSurfaces(working, mesh, splitAngleDeg);
    if (!topology.surfaces.length) {
      working.dispose?.();
      stats.failures++;
      return null;
    }

    const materials = materialArray(mesh);
    let successfulSurfaces = 0;
    let triangles = 0;
    let islands = 0;

    for (const surface of topology.surfaces) {
      const sourceMaterial = materials[surface.materialIndex] || materials[0];
      if (!eligibleNaturalMaterial(mesh, sourceMaterial, surface.materialIndex)) continue;

      const tempGeometry = new THREE.BufferGeometry();
      const tempPositions = copySurfacePositions(position, surface, topology);
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

      if (!result) {
        try { tempMaterial.dispose?.(); } catch (_) {}
        try { tempMesh.geometry?.dispose?.(); } catch (_) {}
        if (tempMesh.geometry !== tempGeometry) try { tempGeometry.dispose?.(); } catch (_) {}
        stats.failures++;
        continue;
      }

      const bakedGeometry = tempMesh.geometry;
      const bakedUv = bakedGeometry.getAttribute('uv');
      const bakedIndex = bakedGeometry.index;
      if (!bakedUv) {
        disposeTempJigsawMaterial(tempMesh.material, sourceMaterial.map);
        try { bakedGeometry.dispose?.(); } catch (_) {}
        if (bakedGeometry !== tempGeometry) try { tempGeometry.dispose?.(); } catch (_) {}
        stats.failures++;
        continue;
      }

      let element = 0;
      for (const localTriangleIndex of surface.members) {
        const triangle = topology.triangles[localTriangleIndex];
        for (let corner = 0; corner < 3; corner++, element++) {
          const bakedVertex = bakedIndex ? bakedIndex.getX(element) : element;
          uv.setXY(triangle.base + corner, bakedUv.getX(bakedVertex), bakedUv.getY(bakedVertex));
        }
      }

      successfulSurfaces++;
      islands += Number(result.islands || 1);
      triangles += Number(result.triangles || surface.members.length);
      disposeTempJigsawMaterial(tempMesh.material, sourceMaterial.map);
      if (tempMaterial !== tempMesh.material) try { tempMaterial.dispose?.(); } catch (_) {}
      try { bakedGeometry.dispose?.(); } catch (_) {}
      if (bakedGeometry !== tempGeometry) try { tempGeometry.dispose?.(); } catch (_) {}
    }

    if (!successfulSurfaces) {
      working.dispose?.();
      stats.failures++;
      return null;
    }

    uv.needsUpdate = true;
    const report = {
      version: 4,
      segmentation: 'furniture-edge-adjacency',
      mapping: 'segmented-jigsaw',
      patchCount: successfulSurfaces,
      surfaces: successfulSurfaces,
      islands,
      triangles,
      splitAngleDeg,
      edgePx: finite(options.edgePx, jigsaw.defaults?.edgePx ?? 16),
      edgeWorldWidth: finite(options.edgeWorldWidth, jigsaw.defaults?.edgeWorldWidth ?? 0.5),
      finalOwner: OWNER,
    };
    const finalSignature = signatureFor(mesh, working, splitAngleDeg, options);
    working.userData = Object.assign({}, working.userData || {}, {
      terrainJigsawBaked: true,
      terrainJigsawFinalOwner: OWNER,
      terrainJigsawSurfaceSplitSignature: finalSignature,
      terrainJigsawStats: report,
      hobunjiSurfaceStretchSignature: finalSignature,
      hobunjiSurfaceStretch: report,
    });

    mesh.geometry = working;
    // IMPORTANT: leave mesh.material exactly as-is. NaturalSurfaceMaterials owns
    // the decoded/tinted PNG and other meshes may share that material/texture.
    mesh.userData = Object.assign({}, mesh.userData || {}, {
      terrainJigsawIgnore: true,
      terrainJigsawBaked: true,
      terrainJigsawFinalOwner: OWNER,
      terrainJigsawSplitAngleDeg: splitAngleDeg,
      terrainJigsawStats: report,
      terrainGeometryRevision: (Number(mesh.userData?.terrainGeometryRevision) || 0) + 1,
    });

    if (options.disposeSource !== false && sourceGeometry !== working) {
      try { sourceGeometry.dispose?.(); } catch (_) {}
    }
    stats.bakes++;
    stats.surfaces += successfulSurfaces;
    stats.triangles += triangles;
    stats.meshes++;
    stats.last.push({ name: mesh.name || '(unnamed)', surfaces: successfulSurfaces, triangles, splitAngleDeg });
    while (stats.last.length > 8) stats.last.shift();
    return report;
  }

  function wrappedMapMesh(mesh, options = {}) {
    if (isNaturalTerrainMesh(mesh)) return segmentedBake(mesh, options);
    return originalMapMesh?.call(this, mesh, options) || null;
  }

  function wrappedRemapNatural(mesh, label = '') {
    if (isNaturalTerrainMesh(mesh)) return segmentedBake(mesh, { label });
    return originalRemapNatural?.call(this, mesh, label) || null;
  }

  mapper.mapMesh = wrappedMapMesh;
  mapper.remapNaturalTerrainMesh = wrappedRemapNatural;
  wrappedMapMesh.__hobunjiSegmentedJigsawOwner = OWNER;
  wrappedRemapNatural.__hobunjiSegmentedJigsawOwner = OWNER;

  // The old cross-mesh plateau adapter deliberately combined touching plateau
  // cliffs into one UV solve. That contradicts the requested per-face reset, so
  // restore the underlying plateau builders if that adapter already wrapped them.
  const plateau = window.ZonePlateauMesa;
  if (plateau?.buildZoneMesaMeshes?.__hobunjiCrossMeshCliffUvOriginal) {
    plateau.buildZoneMesaMeshes = plateau.buildZoneMesaMeshes.__hobunjiCrossMeshCliffUvOriginal;
  }
  if (plateau?.rebuildZoneMesaMeshes?.__hobunjiCrossMeshCliffUvOriginal) {
    plateau.rebuildZoneMesaMeshes = plateau.rebuildZoneMesaMeshes.__hobunjiCrossMeshCliffUvOriginal;
  }

  function diagnostics() {
    const lines = [
      '',
      '=== Segmented Jigsaw final UV diagnostics ===',
      `Installed=true owner=${OWNER} split=${DEFAULT_SPLIT_ANGLE_DEG}deg bakes=${stats.bakes} meshes=${stats.meshes} surfaces=${stats.surfaces} triangles=${stats.triangles} cacheHits=${stats.cacheHits} failures=${stats.failures}`,
    ];
    for (const entry of stats.last.slice(-5)) {
      lines.push(`  ${entry.name} surfaces=${entry.surfaces} triangles=${entry.triangles} split=${entry.splitAngleDeg}deg`);
    }
    return lines.join('\n');
  }

  function installProbeDiagnostics() {
    const result = document?.getElementById?.('debugProbeResult');
    if (!result || result.__hobunjiSegmentedJigsawObserver || typeof MutationObserver !== 'function') return false;
    const marker = '=== Segmented Jigsaw final UV diagnostics ===';
    const append = () => {
      const text = String(result.textContent || '');
      if (!text || text.includes(marker) || !text.startsWith('Pixel Probe report')) return;
      result.textContent = text + diagnostics();
    };
    const observer = new MutationObserver(() => queueMicrotask(append));
    observer.observe(result, { childList: true, subtree: true, characterData: true });
    result.__hobunjiSegmentedJigsawObserver = observer;
    return true;
  }
  if (!installProbeDiagnostics()) window.addEventListener?.('DOMContentLoaded', installProbeDiagnostics, { once: true });

  window.TerrainJigsawSurfaceSplit = {
    installed: true,
    owner: OWNER,
    splitAngleDeg: DEFAULT_SPLIT_ANGLE_DEG,
    bakeMesh: segmentedBake,
    snapshot: () => Object.assign({}, stats, { last: stats.last.slice() }),
  };
})();
