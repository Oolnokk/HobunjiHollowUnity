// TileSpanFurniture — one furniture recipe across variable-length tile footprints.
// End sections translate rigidly; center geometry extends between authored attachment surfaces.
(function (global) {
  'use strict';
  if (global.FurnitureTileSpan) return;
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const tiles = (value, fallback) => Math.max(1, Math.min(256, Math.floor(finite(value, fallback))));
  const roleOf = part => ['start', 'stretch', 'end', 'follow'].includes(part?.tileSpanRole) ? part.tileSpanRole : 'none';
  const sourcePoses = new WeakMap(); // Mesh-local rest shapes for reversible resizing, kept out of serialized Three.js userData.

  function normalize(value) {
    const s = value && typeof value === 'object' ? value : {};
    const startTiles = tiles(s.startTiles, 2); // Fixed tile count at the beginning.
    const endTiles = Math.min(tiles(s.endTiles, 2), 511 - startTiles); // Reserve at least one middle tile.
    const middleTiles = Math.min(tiles(s.middleTiles, 1), 512 - startTiles - endTiles); // Keep the complete footprint within the supported limit.
    const baseTiles = startTiles + endTiles + middleTiles; // Minimum overall footprint.
    return {
      version: 1, enabled: s.enabled === true,
      axis: ['x','y','z'].includes(s.axis) ? s.axis : 'x',
      baseHeight: Math.max(.1, Math.min(128, finite(s.baseHeight, 1.4))), // Rest-height between a floor end and a ceiling end.
      targetHeight: Math.max(.1, Math.min(128, finite(s.targetHeight, finite(s.baseHeight, 1.4)))), // Requested ceiling height in local Y.
      verticalTarget: s.verticalTarget === 'ceiling' ? 'ceiling' : null, // Runtime may supply the owning room's actual ceiling height.
      startTiles, endTiles, middleTiles, baseTiles,
      totalTiles: Math.max(baseTiles, Math.min(512, Math.floor(finite(s.totalTiles, baseTiles)))),
      tileSize: Math.max(.001, Math.min(100, finite(s.tileSize, 1))),
    };
  }

  function transformFor(role, start, end, delta, axis = 'x') {
    const vertical = axis === 'y'; // Unlike a centered bridge, the ladder's bottom never moves.
    if (role === 'start') return { scale: 1, offset: vertical ? 0 : -delta / 2 };
    if (role === 'end') return { scale: 1, offset: vertical ? delta : delta / 2 };
    if (role !== 'stretch') return { scale: 1, offset: 0 };
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < .0001) return null;
    const scale = 1 + delta / (end - start); // Stretch only along the chosen horizontal axis.
    const offset = (vertical ? 0 : -delta / 2) + start * (1 - scale); // Preserve the floor anchor for Y; horizontal spans remain centered.
    return { scale, offset };
  }

  function sourcePose(mesh) {
    let pose = sourcePoses.get(mesh);
    if (!pose || (mesh.geometry !== pose.geometry && mesh.geometry !== pose.stretchedGeometry)) {
      mesh.updateMatrix();
      pose = {
        geometry: mesh.geometry, position: mesh.position.clone(),
        quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone(),
        matrix: mesh.matrix.clone(), stretchedGeometry: null, deformation: null,
      }; // Original mesh shape and rest pose for repeated preview/runtime resizing.
      sourcePoses.set(mesh, pose);
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
    pose.deformation = null;
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
    if (root?.surfaceId) {
      // Explicitly named attachments must never quietly fall back to another face after import or editing.
      if (!surface || !Array.isArray(surface.localCentroid) || surface.localCentroid.length !== 3
        || !surface.localCentroid.every(Number.isFinite)) return NaN;
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
      for (const mesh of group?.userData?.meshById?.values?.() || []) if (sourcePoses.has(mesh)) resetMesh(mesh);
      if (group?.userData) { delete group.userData.activeTileSpanTiles; delete group.userData.activeHeightSpan; delete group.userData.tileSpanDiagnostics; }
      return { enabled: false };
    }
    const meshes = group?.userData?.meshById || new Map();
    const vertical = spec.axis === 'y'; // Ceiling-anchored furniture uses world-unit height, not horizontal footprint tiles.
    const totalTiles = Math.max(spec.baseTiles, Math.min(512, Math.floor(finite(vertical ? null : requestedTiles, spec.totalTiles))));
    const targetHeight = vertical ? Math.max(.1,Math.min(128,finite(requestedTiles,spec.targetHeight))) : null; // Used by dynamic room-height callers.
    const delta = vertical ? targetHeight - spec.baseHeight : (totalTiles - spec.baseTiles) * spec.tileSize; // Vertical span leaves the bottom on the floor.
    const errors = [];
    const partById = new Map(data.parts.map(part => [part.id, part])); // Validate each root against the correct rigid end section.
    for (const part of data.parts) {
      const mesh = meshes.get(part.id);
      if (mesh) resetMesh(mesh);
    }
    for (const part of data.parts) {
      const role = roleOf(part), mesh = meshes.get(part.id);
      if (!mesh || role === 'none') continue;
      const pose = sourcePose(mesh);
      let mapping;
      if (role === 'stretch' || role === 'follow') {
        const roots = part.tileSpanRoots || {};
        if (roleOf(partById.get(roots.start?.partId)) !== 'start'
          || roleOf(partById.get(roots.end?.partId)) !== 'end') {
          errors.push(part.id + ': roots must reference rigid beginning and ending pieces');
          continue;
        }
        const start = anchorPosition(data, roots.start, meshes, spec.axis, roots.start?.face === 'min' ? 'min' : 'max');
        const end = anchorPosition(data, roots.end, meshes, spec.axis, roots.end?.face === 'max' ? 'max' : 'min');
        mapping = transformFor('stretch', start, end, delta, spec.axis);
        if (!mapping || mapping.scale <= 0) { errors.push(part.id + ': missing, reversed or collapsed attachment surfaces'); continue; }
        if (role === 'follow') {
          const fraction = Math.max(0, Math.min(1, (pose.position[spec.axis] - start) / (end-start))); // A rung/decorative part moves without stretching its thickness.
          mesh.position[spec.axis] = pose.position[spec.axis] + (vertical ? delta * fraction : delta * (fraction - .5));
          mesh.updateMatrix();
          if (mesh.userData.authoredMatrix) mesh.userData.authoredMatrix.compose(mesh.position,mesh.quaternion,mesh.scale);
          continue;
        }
        if (part.kind === 'glb') { errors.push(part.id + ': GLB pieces cannot stretch their vertices (use Follow)'); continue; }
        if (delta !== 0 && !mesh.geometry?.clone) { errors.push(part.id + ': stretch geometry unavailable'); continue; }
        if (delta !== 0) {
          const three = global.THREE;
          const stretch = new three.Matrix4().makeScale(spec.axis === 'x' ? mapping.scale : 1, vertical ? mapping.scale : 1, spec.axis === 'z' ? mapping.scale : 1);
          stretch.setPosition(spec.axis === 'x' ? mapping.offset : 0, vertical ? mapping.offset : 0, spec.axis === 'z' ? mapping.offset : 0);
          const local = pose.matrix.clone().invert().multiply(stretch).multiply(pose.matrix);
          const geometry = pose.geometry.clone();
          geometry.applyMatrix4(local);
          mesh.geometry = geometry;
          pose.stretchedGeometry = geometry; // Dispose only per-instance deformation; never the shared authored source.
          pose.deformation = local; // Shared local-coordinate mapping for children rooted to a stretched surface.
        }
      } else {
        mapping = transformFor(role, 0, 0, delta, spec.axis);
        mesh.position[spec.axis] = pose.position[spec.axis] + mapping.offset; // Stairs/caps retain original shape and UVs.
        mesh.updateMatrix();
        if (mesh.userData.authoredMatrix) mesh.userData.authoredMatrix.compose(mesh.position, mesh.quaternion, mesh.scale);
      }
    }
    group.userData.activeTileSpanTiles = totalTiles;
    group.userData.activeHeightSpan = vertical ? targetHeight : null; // Tracks the exact ceiling target so repeat application is cheap.
    group.userData.tileSpanDiagnostics = { axis: spec.axis, startTiles: spec.startTiles, middleTiles: totalTiles - spec.startTiles - spec.endTiles, endTiles: spec.endTiles, targetHeight, errors };
    return { enabled: true, totalTiles, targetHeight, delta, errors };
  }

  function mapLocalPoint(mesh, point) {
    const deformation = sourcePoses.get(mesh)?.deformation;
    return deformation ? point.applyMatrix4(deformation) : point; // Maps a recognized surface point onto the actual stretched mesh.
  }

  function mapLocalDirection(mesh, direction, isNormal = false) {
    const deformation = sourcePoses.get(mesh)?.deformation;
    if (!deformation) return direction;
    if (isNormal && global.THREE.Matrix3) {
      return direction.applyMatrix3(new global.THREE.Matrix3().getNormalMatrix(deformation)).normalize();
    }
    return direction.transformDirection(deformation);
  }

  function release(mesh) {
    const pose = sourcePoses.get(mesh);
    if (!pose) return;
    if (pose.stretchedGeometry && pose.stretchedGeometry !== mesh.geometry) pose.stretchedGeometry.dispose?.();
    if (pose.geometry && pose.geometry !== mesh.geometry) pose.geometry.dispose?.();
    sourcePoses.delete(mesh); // Clean up the original GPU geometry after a stretched mesh is permanently removed.
  }

  global.FurnitureTileSpan = { normalize, roleOf, transformFor, mapLocalPoint, mapLocalDirection, apply, release };
})(typeof window !== 'undefined' ? window : globalThis);
