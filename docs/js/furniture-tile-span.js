// TileSpanFurniture — one furniture recipe across variable-length tile footprints.
// End sections translate rigidly; center geometry extends between authored attachment surfaces.
(function (global) {
  'use strict';
  if (global.FurnitureTileSpan) return;
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const tiles = (value, fallback) => Math.max(1, Math.min(256, Math.floor(finite(value, fallback))));
  const roleOf = part => ['start', 'stretch', 'end'].includes(part?.tileSpanRole) ? part.tileSpanRole : 'none';

  function normalize(value) {
    const s = value && typeof value === 'object' ? value : {};
    const startTiles = tiles(s.startTiles, 2); // Fixed tile count at the beginning.
    const endTiles = tiles(s.endTiles, 2); // Fixed tile count at the far end.
    const middleTiles = tiles(s.middleTiles, 1); // Original number of tiles occupied by the flexible middle.
    const baseTiles = startTiles + endTiles + middleTiles; // Minimum overall footprint.
    return {
      version: 1, enabled: s.enabled === true,
      axis: s.axis === 'z' ? 'z' : 'x',
      startTiles, endTiles, middleTiles, baseTiles,
      totalTiles: Math.max(baseTiles, Math.min(512, Math.floor(finite(s.totalTiles, baseTiles)))),
      tileSize: Math.max(.001, Math.min(100, finite(s.tileSize, 1))),
    };
  }

  function transformFor(role, start, end, delta) {
    if (role === 'start') return { scale: 1, offset: -delta / 2 };
    if (role === 'end') return { scale: 1, offset: delta / 2 };
    if (role !== 'stretch') return { scale: 1, offset: 0 };
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < .0001) return null;
    const scale = 1 + delta / (end - start); // Stretch only along the chosen horizontal axis.
    const offset = -delta / 2 + start * (1 - scale); // The start attachment stays on its rigid partner.
    return { scale, offset };
  }

  function sourcePose(mesh) {
    let pose = mesh.userData.tileSpanSource;
    if (!pose || pose.geometry !== mesh.geometry && !pose.stretchedGeometry) {
      mesh.updateMatrix();
      pose = {
        geometry: mesh.geometry, position: mesh.position.clone(),
        quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone(),
        matrix: mesh.matrix.clone(), stretchedGeometry: null,
      }; // Original mesh shape and rest pose for repeated preview/runtime resizing.
      mesh.userData.tileSpanSource = pose;
    }
    return pose;
  }

  function resetMesh(mesh) {
    const pose = sourcePose(mesh);
    if (pose.stretchedGeometry) {
      mesh.geometry = pose.geometry;
      pose.stretchedGeometry.dispose?.();
      pose.stretchedGeometry = null;
    }
    mesh.position.copy(pose.position);
    mesh.quaternion.copy(pose.quaternion);
    mesh.scale.copy(pose.scale);
    mesh.updateMatrix();
    if (mesh.userData.authoredMatrix?.compose) mesh.userData.authoredMatrix.compose(mesh.position, mesh.quaternion, mesh.scale);
    return pose;
  }

  function anchorPosition(data, root, meshes, axis, face) {
    const mesh = meshes.get(root?.partId);
    if (!mesh) return NaN;
    const pose = sourcePose(mesh);
    const surface = (data.recognizedSurfaces || []).find(s => s.id === root?.surfaceId && s.partId === root?.partId);
    if (surface && Array.isArray(surface.localCentroid) && surface.localCentroid.length === 3) {
      return new global.THREE.Vector3(...surface.localCentroid).applyMatrix4(pose.matrix)[axis];
    }
    const geometry = pose.geometry;
    if (!geometry) return NaN;
    if (!geometry.boundingBox) geometry.computeBoundingBox?.();
    const box = geometry.boundingBox;
    if (!box) return NaN;
    let extreme = face === 'max' ? -Infinity : Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const coordinate = new global.THREE.Vector3(x, y, z).applyMatrix4(pose.matrix)[axis];
      extreme = face === 'max' ? Math.max(extreme, coordinate) : Math.min(extreme, coordinate);
    }
    return extreme;
  }

  function apply(group, data, requestedTiles) {
    const spec = normalize(data?.tileSpan);
    if (!spec.enabled || !Array.isArray(data?.parts)) {
      for (const mesh of group?.userData?.meshById?.values?.() || []) if (mesh.userData.tileSpanSource) resetMesh(mesh);
      if (group?.userData) { delete group.userData.activeTileSpanTiles; delete group.userData.tileSpanDiagnostics; }
      return { enabled: false };
    }
    const meshes = group?.userData?.meshById || new Map();
    const totalTiles = Math.max(spec.baseTiles, Math.min(512, Math.floor(finite(requestedTiles, spec.totalTiles))));
    const delta = (totalTiles - spec.baseTiles) * spec.tileSize; // Only extra middle tiles add length.
    const errors = [];
    for (const part of data.parts) {
      const mesh = meshes.get(part.id);
      if (mesh) resetMesh(mesh);
    }
    for (const part of data.parts) {
      const role = roleOf(part), mesh = meshes.get(part.id);
      if (!mesh || role === 'none') continue;
      const pose = sourcePose(mesh);
      let mapping;
      if (role === 'stretch') {
        const roots = part.tileSpanRoots || {};
        const start = anchorPosition(data, roots.start, meshes, spec.axis, roots.start?.face === 'min' ? 'min' : 'max');
        const end = anchorPosition(data, roots.end, meshes, spec.axis, roots.end?.face === 'max' ? 'max' : 'min');
        mapping = transformFor(role, start, end, delta);
        if (part.kind === 'glb') { errors.push(part.id + ': GLB pieces must be rigid ends'); continue; }
        if (!mapping) { errors.push(part.id + ': missing or reversed attachment surfaces'); continue; }
        if (delta !== 0 && mesh.geometry?.clone) {
          const three = global.THREE;
          const stretch = new three.Matrix4().makeScale(spec.axis === 'x' ? mapping.scale : 1, 1, spec.axis === 'z' ? mapping.scale : 1);
          stretch.setPosition(spec.axis === 'x' ? mapping.offset : 0, 0, spec.axis === 'z' ? mapping.offset : 0);
          const local = pose.matrix.clone().invert().multiply(stretch).multiply(pose.matrix);
          const geometry = pose.geometry.clone();
          geometry.applyMatrix4(local);
          mesh.geometry = geometry;
          pose.stretchedGeometry = geometry; // Dispose only per-instance deformation; never the shared authored source.
        }
      } else {
        mapping = transformFor(role, 0, 0, delta);
        mesh.position[spec.axis] = pose.position[spec.axis] + mapping.offset; // Stairs/caps retain original shape and UVs.
        mesh.updateMatrix();
        if (mesh.userData.authoredMatrix) mesh.userData.authoredMatrix.compose(mesh.position, mesh.quaternion, mesh.scale);
      }
    }
    group.userData.activeTileSpanTiles = totalTiles;
    group.userData.tileSpanDiagnostics = { axis: spec.axis, startTiles: spec.startTiles, middleTiles: totalTiles - spec.startTiles - spec.endTiles, endTiles: spec.endTiles, errors };
    return { enabled: true, totalTiles, delta, errors };
  }

  global.FurnitureTileSpan = { normalize, roleOf, transformFor, apply };
})(typeof window !== 'undefined' ? window : globalThis);
