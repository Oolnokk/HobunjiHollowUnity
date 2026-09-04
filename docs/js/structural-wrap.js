// Generic procedural path wrapping/deformation shared by foliage authoring and
// future building/furniture integrations. Requires THREE as a global.
//
// This module intentionally knows nothing about plants. It can measure a static
// Object3D assembly as a vertical envelope, create follower paths around that
// measured host, and bend another static Object3D along one of those paths.
// Root-totem trees use it today; authored beams, rails, walls, roots, vines,
// furniture frames, and similar structures can reuse the same operations later.

window.StructuralWrap = (() => {
  'use strict';

  const EPSILON = 1e-8; // Used throughout geometry math to reject degenerate vectors/spans.

  function requireThree() {
    const T = window.THREE;
    if (!T) throw new Error('StructuralWrap requires window.THREE.');
    return T;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep01(t) {
    const x = clamp01(t);
    return x * x * (3 - 2 * x);
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function vector3From(value, fallback) {
    const T = requireThree();
    if (value?.isVector3) return value.clone();
    if (value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) && Number.isFinite(Number(value.z))) {
      return new T.Vector3(Number(value.x), Number(value.y), Number(value.z));
    }
    return fallback?.clone ? fallback.clone() : new T.Vector3(0, 1, 0);
  }

  // Builds stable tangent/normal/binormal frames for any point list using the
  // same parallel-transport idea the foliage generator already uses for vines.
  // Deformation maps source X/Y/Z -> normal/tangent/binormal, so these three
  // destination axes must remain right-handed: normal × tangent = binormal.
  function framesFromPoints(inputPoints) {
    const T = requireThree();
    if (!Array.isArray(inputPoints) || inputPoints.length < 2) {
      throw new Error('StructuralWrap.framesFromPoints needs at least two points.');
    }

    const points = inputPoints.map((point) => point.clone ? point.clone() : new T.Vector3(point.x, point.y, point.z));
    const tangents = []; // Used to orient every transported cross-section frame.

    for (let i = 0; i < points.length; i++) {
      const previous = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const tangent = next.clone().sub(previous);
      tangents.push(tangent.lengthSq() > EPSILON ? tangent.normalize() : new T.Vector3(0, 1, 0));
    }

    const normals = []; // First radial axis around the host path.
    const binormals = []; // Second radial axis around the host path.
    const worldUp = new T.Vector3(0, 1, 0);
    const firstTangent = tangents[0].clone();
    let firstNormal = worldUp.clone().cross(firstTangent);
    if (firstNormal.lengthSq() < EPSILON) firstNormal.set(1, 0, 0).cross(firstTangent);
    if (firstNormal.lengthSq() < EPSILON) firstNormal.set(0, 0, 1);
    firstNormal.normalize();
    normals.push(firstNormal);
    binormals.push(firstNormal.clone().cross(firstTangent).normalize());

    const axis = new T.Vector3(); // Reused while parallel-transporting each frame.
    for (let i = 1; i < points.length; i++) {
      axis.copy(tangents[i - 1]).cross(tangents[i]);
      const normal = normals[i - 1].clone();
      if (axis.lengthSq() > EPSILON) {
        const angle = Math.acos(clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
        normal.applyAxisAngle(axis.normalize(), angle);
      }
      normal.addScaledVector(tangents[i], -normal.dot(tangents[i]));
      if (normal.lengthSq() < EPSILON) normal.copy(normals[i - 1]);
      normal.normalize();
      const binormal = normal.clone().cross(tangents[i]).normalize();
      normal.copy(tangents[i]).cross(binormal).normalize();
      normals.push(normal);
      binormals.push(binormal);
    }

    return { points, pts: points, tangents, normals, binormals };
  }

  function sampleFrame(frames, t01) {
    const T = requireThree();
    const count = frames.points.length;
    const f = clamp01(t01) * (count - 1);
    const i0 = Math.max(0, Math.min(count - 2, Math.floor(f)));
    const i1 = Math.min(count - 1, i0 + 1);
    const alpha = f - i0;

    const point = frames.points[i0].clone().lerp(frames.points[i1], alpha);
    const tangent = frames.tangents[i0].clone().lerp(frames.tangents[i1], alpha).normalize();
    let normal = frames.normals[i0].clone().lerp(frames.normals[i1], alpha);
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < EPSILON) normal = frames.normals[i0].clone();
    normal.normalize();
    const binormal = new T.Vector3().crossVectors(normal, tangent).normalize();
    normal = new T.Vector3().crossVectors(tangent, binormal).normalize();
    return { point, tangent, normal, binormal };
  }

  // Convenience host for standalone authoring. Root totems now measure their
  // real previously-generated trees instead, but other tools can still use a
  // simple procedural centerline when no host geometry exists yet.
  function buildHostSpine(options = {}) {
    const T = requireThree();
    const height = Math.max(0.01, finiteNumber(options.height, 3.5));
    const samples = Math.max(2, Math.floor(finiteNumber(options.samples, 28)));
    const sway = Math.max(0, finiteNumber(options.sway, 0));
    const leanX = finiteNumber(options.leanX, 0);
    const leanZ = finiteNumber(options.leanZ, 0);
    const phase = finiteNumber(options.phase, 0);
    const points = []; // Generic host path returned to follower-path callers.

    for (let i = 0; i < samples; i++) {
      const u = samples <= 1 ? 0 : i / (samples - 1);
      const endpointEase = Math.sin(Math.PI * u);
      const wave = phase + u * Math.PI * 2 * 1.35;
      points.push(new T.Vector3(
        leanX * u + Math.sin(wave) * sway * endpointEase,
        height * u,
        leanZ * u + Math.cos(wave * 0.93) * sway * endpointEase,
      ));
    }
    return points;
  }

  function sampleScalarProfile(profile, t01, fallback = 0) {
    if (!Array.isArray(profile) || !profile.length) return fallback;
    if (profile.length === 1) return finiteNumber(profile[0], fallback);
    const f = clamp01(t01) * (profile.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(profile.length - 1, i0 + 1);
    return lerp(finiteNumber(profile[i0], fallback), finiteNumber(profile[i1], fallback), f - i0);
  }

  // Produces phase-offset helical paths around an arbitrary host. With no
  // radiusProfile this preserves the old absolute-radius behavior. With a
  // radiusProfile, radiusStart/radiusEnd become CLEARANCE outside the measured
  // host envelope, which is what sequential root-totem growth needs.
  function makeWrappedFollowerPaths(hostPoints, options = {}) {
    const frames = framesFromPoints(hostPoints);
    const count = Math.max(1, Math.min(32, Math.floor(finiteNumber(options.count, 1))));
    const turns = finiteNumber(options.turns, 1.5);
    const radiusStart = Math.max(0, finiteNumber(options.radiusStart ?? options.radius, 0.2));
    const radiusEnd = Math.max(0, finiteNumber(options.radiusEnd ?? options.radius, radiusStart));
    const radiusProfile = Array.isArray(options.radiusProfile) ? options.radiusProfile : null;
    const phaseOffset = finiteNumber(options.phaseOffset, 0);
    const wobbleAmplitude = Math.max(0, finiteNumber(options.wobbleAmplitude, 0));
    const wobbleFrequency = Math.max(0, finiteNumber(options.wobbleFrequency, 2.25));
    const paths = []; // One follower path per wrapped object/strand.

    for (let strandIndex = 0; strandIndex < count; strandIndex++) {
      const strandPhase = phaseOffset + (strandIndex / count) * Math.PI * 2;
      const points = [];
      for (let i = 0; i < frames.points.length; i++) {
        const u = frames.points.length <= 1 ? 0 : i / (frames.points.length - 1);
        const angle = strandPhase + turns * Math.PI * 2 * u;
        const radialWobble = Math.sin((u * wobbleFrequency + strandIndex * 0.371) * Math.PI * 2) * wobbleAmplitude;
        const hostRadius = radiusProfile ? Math.max(0, sampleScalarProfile(radiusProfile, u, 0)) : 0;
        const clearance = lerp(radiusStart, radiusEnd, u);
        const radius = Math.max(0, hostRadius + clearance + radialWobble);
        const outward = frames.normals[i].clone().multiplyScalar(Math.cos(angle))
          .addScaledVector(frames.binormals[i], Math.sin(angle));
        points.push(frames.points[i].clone().addScaledVector(outward, radius));
      }
      paths.push(points);
    }
    return paths;
  }

  function axisKeys(axis) {
    if (axis === 'x') return { axial: 'x', crossA: 'y', crossB: 'z' };
    if (axis === 'z') return { axial: 'z', crossA: 'x', crossB: 'y' };
    return { axial: 'y', crossA: 'x', crossB: 'z' };
  }

  function rigidBasis(direction, preferredNormal) {
    const T = requireThree();
    const tangent = direction.clone().normalize();
    let normal = preferredNormal?.clone ? preferredNormal.clone() : new T.Vector3(1, 0, 0);
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < EPSILON) normal.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
    if (normal.lengthSq() < EPSILON) normal.set(1, 0, 0);
    normal.normalize();
    const binormal = new T.Vector3().crossVectors(normal, tangent).normalize();
    normal = new T.Vector3().crossVectors(tangent, binormal).normalize();
    return { tangent, normal, binormal };
  }

  function deformBakedGeometry(geometry, pathFrames, sourceBounds, options = {}) {
    const T = requireThree();
    const axis = options.axis === 'x' || options.axis === 'z' ? options.axis : 'y';
    const keys = axisKeys(axis);
    const axisMin = sourceBounds.min[keys.axial];
    const axisMax = sourceBounds.max[keys.axial];
    const axisSpan = Math.max(EPSILON, axisMax - axisMin);
    const pivotA = Number.isFinite(options.pivotA)
      ? Number(options.pivotA)
      : (sourceBounds.min[keys.crossA] + sourceBounds.max[keys.crossA]) * 0.5;
    const pivotB = Number.isFinite(options.pivotB)
      ? Number(options.pivotB)
      : (sourceBounds.min[keys.crossB] + sourceBounds.max[keys.crossB]) * 0.5;
    const crossSectionScaleStart = Math.max(0, finiteNumber(options.crossSectionScaleStart ?? options.crossSectionScale, 1));
    const crossSectionScaleEnd = Math.max(0, finiteNumber(options.crossSectionScaleEnd ?? options.crossSectionScale, crossSectionScaleStart));
    const rigidStartFraction = clamp(finiteNumber(options.rigidStartFraction, 0), 0, 0.95);
    const rigidStartTransition = clamp(finiteNumber(options.rigidStartTransition, 0.08), 0.001, 0.5);
    const floorY = Number.isFinite(Number(options.floorY)) ? Number(options.floorY) : null;
    const rigidDirection = vector3From(options.rigidStartDirection, pathFrames.tangents[0]);
    if (rigidDirection.lengthSq() < EPSILON) rigidDirection.set(0, 1, 0);
    rigidDirection.normalize();
    const startBasis = rigidBasis(rigidDirection, pathFrames.normals[0]);
    const pathStart = pathFrames.points[0].clone();
    const position = geometry.getAttribute('position');
    const source = new T.Vector3(); // Reused while reading each source vertex.

    for (let i = 0; i < position.count; i++) {
      source.fromBufferAttribute(position, i);
      const u = clamp01((source[keys.axial] - axisMin) / axisSpan);
      const frame = sampleFrame(pathFrames, u);
      let center = frame.point;
      let tangent = frame.tangent;
      let normal = frame.normal;
      let binormal = frame.binormal;

      // Keep the source object's starting/root band in one rigid frame before
      // easing into the curved follower path. For trees, callers pass world-up
      // and floorY=0, so the root system remains planted horizontally instead
      // of being twisted/tilted by the first helix segment.
      if (rigidStartFraction > 0) {
        const alongStart = frame.point.clone().sub(pathStart).dot(rigidDirection);
        const rigidCenter = pathStart.clone().addScaledVector(rigidDirection, alongStart);
        const blend = u <= rigidStartFraction
          ? 0
          : smoothstep01((u - rigidStartFraction) / rigidStartTransition);
        center = rigidCenter.lerp(frame.point, blend);
        tangent = startBasis.tangent.clone().lerp(frame.tangent, blend).normalize();
        normal = startBasis.normal.clone().lerp(frame.normal, blend);
        normal.addScaledVector(tangent, -normal.dot(tangent));
        if (normal.lengthSq() < EPSILON) normal.copy(startBasis.normal);
        normal.normalize();
        binormal = new T.Vector3().crossVectors(normal, tangent).normalize();
        normal = new T.Vector3().crossVectors(tangent, binormal).normalize();
      }

      const crossScale = lerp(crossSectionScaleStart, crossSectionScaleEnd, u);
      const offsetA = (source[keys.crossA] - pivotA) * crossScale;
      const offsetB = (source[keys.crossB] - pivotB) * crossScale;
      const target = center.clone()
        .addScaledVector(normal, offsetA)
        .addScaledVector(binormal, offsetB);
      if (floorY !== null && target.y < floorY) target.y = floorY;
      position.setXYZ(i, target.x, target.y, target.z);
    }

    position.needsUpdate = true;
    if (geometry.getAttribute('normal')) geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  // Bends every static Mesh below sourceObject along pathPoints. Child mesh
  // transforms are baked first, then the hierarchy is intentionally flattened
  // into one output Group. This keeps the operation independent of whatever
  // schema originally authored the object.
  function deformObjectAlongPath(sourceObject, pathPoints, options = {}) {
    const T = requireThree();
    if (!sourceObject?.traverse) throw new Error('StructuralWrap.deformObjectAlongPath requires an Object3D.');
    const pathFrames = framesFromPoints(pathPoints);
    sourceObject.updateMatrixWorld(true);

    const parentInverse = new T.Matrix4(); // Removes only the source parent's world transform when baking children.
    if (sourceObject.parent) parentInverse.copy(sourceObject.parent.matrixWorld).invert();
    else parentInverse.identity();

    const entries = []; // Baked mesh geometries reused by the bounds and deformation passes below.
    const sourceBounds = new T.Box3().makeEmpty();
    const skipMesh = typeof options.skipMesh === 'function' ? options.skipMesh : null;

    sourceObject.traverse((mesh) => {
      if (!mesh?.isMesh || !mesh.geometry?.getAttribute?.('position')) return;
      if (skipMesh?.(mesh)) return;
      const geometry = mesh.geometry.clone();
      const relativeMatrix = new T.Matrix4().multiplyMatrices(parentInverse, mesh.matrixWorld);
      geometry.applyMatrix4(relativeMatrix);
      geometry.computeBoundingBox();
      sourceBounds.union(geometry.boundingBox);
      entries.push({ mesh, geometry });
    });

    const output = new T.Group();
    output.name = options.name || `${sourceObject.name || 'object'}_wrapped`;
    output.userData = { ...(sourceObject.userData || {}) };
    if (!entries.length || sourceBounds.isEmpty()) return output;

    for (const entry of entries) {
      const geometry = deformBakedGeometry(entry.geometry, pathFrames, sourceBounds, options);
      const mesh = new T.Mesh(geometry, entry.mesh.material);
      mesh.name = entry.mesh.name;
      mesh.visible = entry.mesh.visible;
      mesh.castShadow = entry.mesh.castShadow;
      mesh.receiveShadow = entry.mesh.receiveShadow;
      mesh.renderOrder = entry.mesh.renderOrder;
      mesh.frustumCulled = entry.mesh.frustumCulled;
      mesh.layers.mask = entry.mesh.layers.mask;
      mesh.userData = { ...(entry.mesh.userData || {}) };
      output.add(mesh);
    }

    output.userData.structuralWrap = {
      version: 2,
      axis: options.axis || 'y',
      pathSamples: pathFrames.points.length,
      rigidStartFraction: clamp(finiteNumber(options.rigidStartFraction, 0), 0, 0.95),
      sourceBounds: { min: sourceBounds.min.toArray(), max: sourceBounds.max.toArray() },
    };
    return output;
  }

  // Uniformly scales a normal static Object3D to a requested world height,
  // recenters it on X/Z, and plants its lowest point on groundY. Root Totem
  // tree #1 uses this so it stays a genuinely ordinary generated tree rather
  // than being run through the deformation pipeline.
  function fitObjectToHeight(object, targetHeight, options = {}) {
    const T = requireThree();
    if (!object?.updateMatrixWorld) throw new Error('StructuralWrap.fitObjectToHeight requires an Object3D.');
    const height = Math.max(0.001, finiteNumber(targetHeight, 1));
    const groundY = finiteNumber(options.groundY, 0);
    const centerXZ = options.centerXZ !== false;
    object.updateMatrixWorld(true);
    let box = new T.Box3().setFromObject(object);
    const currentHeight = Math.max(EPSILON, box.max.y - box.min.y);
    object.scale.multiplyScalar(height / currentHeight);
    object.updateMatrixWorld(true);
    box = new T.Box3().setFromObject(object);
    const center = box.getCenter(new T.Vector3());
    if (centerXZ) {
      object.position.x -= center.x;
      object.position.z -= center.z;
    }
    object.position.y += groundY - box.min.y;
    object.updateMatrixWorld(true);
    return object;
  }

  function median(sortedValues) {
    if (!sortedValues.length) return 0;
    const middle = Math.floor(sortedValues.length / 2);
    return sortedValues.length % 2
      ? sortedValues[middle]
      : (sortedValues[middle - 1] + sortedValues[middle]) * 0.5;
  }

  // Measures an arbitrary static assembly as one vertical "trunk": each Y
  // slice gets a robust median X/Z center and a radial quantile. Using a
  // quantile instead of max radius prevents a stray long branch from making
  // the next wrapped object orbit meters away. Callers can skip leaf cards or
  // decorative meshes without this utility knowing what those meshes mean.
  function verticalEnvelopeFromObject(object, options = {}) {
    const T = requireThree();
    if (!object?.traverse) throw new Error('StructuralWrap.verticalEnvelopeFromObject requires an Object3D.');
    const samples = clamp(Math.floor(finiteNumber(options.samples, 30)), 4, 128);
    const radialQuantile = clamp(finiteNumber(options.radialQuantile, 0.58), 0.2, 0.98);
    const minimumRadius = Math.max(0, finiteNumber(options.minimumRadius, 0.02));
    const radiusScale = Math.max(0, finiteNumber(options.radiusScale, 1));
    const smoothing = clamp(finiteNumber(options.smoothing, 0.12), 0, 1);
    const skipMesh = typeof options.skipMesh === 'function' ? options.skipMesh : null;
    const meshes = []; // Geometry/matrix pairs sampled twice: bounds first, then slice points.
    const bounds = new T.Box3().makeEmpty();
    object.updateMatrixWorld(true);

    object.traverse((mesh) => {
      if (!mesh?.isMesh || !mesh.visible || !mesh.geometry?.getAttribute?.('position')) return;
      if (skipMesh?.(mesh)) return;
      mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) return;
      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
      meshes.push(mesh);
    });
    if (!meshes.length || bounds.isEmpty()) throw new Error('StructuralWrap.verticalEnvelopeFromObject found no measurable meshes.');

    const minY = Number.isFinite(Number(options.minY)) ? Number(options.minY) : bounds.min.y;
    const maxY = Number.isFinite(Number(options.maxY)) ? Number(options.maxY) : bounds.max.y;
    const spanY = Math.max(EPSILON, maxY - minY);
    const bins = Array.from({ length: samples }, () => []); // Each entry stores [x,z] pairs for that vertical slice.
    const point = new T.Vector3();

    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        if (point.y < minY - EPSILON || point.y > maxY + EPSILON) continue;
        const u = clamp01((point.y - minY) / spanY);
        const binIndex = clamp(Math.round(u * (samples - 1)), 0, samples - 1);
        bins[binIndex].push([point.x, point.z]);
      }
    }

    function nearestNonEmpty(index) {
      if (bins[index].length) return bins[index];
      for (let offset = 1; offset < samples; offset++) {
        const lower = index - offset;
        const upper = index + offset;
        if (lower >= 0 && bins[lower].length) return bins[lower];
        if (upper < samples && bins[upper].length) return bins[upper];
      }
      return [];
    }

    const centers = []; // Raw robust centers before optional neighbor smoothing.
    const radii = []; // Raw radial envelope before optional neighbor smoothing.
    for (let i = 0; i < samples; i++) {
      const entries = nearestNonEmpty(i);
      if (!entries.length) {
        centers.push(new T.Vector3(0, lerp(minY, maxY, i / (samples - 1)), 0));
        radii.push(minimumRadius);
        continue;
      }
      const xs = entries.map((entry) => entry[0]).sort((a, b) => a - b);
      const zs = entries.map((entry) => entry[1]).sort((a, b) => a - b);
      const centerX = median(xs);
      const centerZ = median(zs);
      const distances = entries.map((entry) => Math.hypot(entry[0] - centerX, entry[1] - centerZ)).sort((a, b) => a - b);
      const radiusIndex = clamp(Math.floor((distances.length - 1) * radialQuantile), 0, distances.length - 1);
      centers.push(new T.Vector3(centerX, lerp(minY, maxY, i / (samples - 1)), centerZ));
      radii.push(Math.max(minimumRadius, distances[radiusIndex] * radiusScale));
    }

    if (smoothing > 0 && samples > 2) {
      const originalCenters = centers.map((center) => center.clone());
      const originalRadii = radii.slice();
      for (let i = 1; i < samples - 1; i++) {
        const neighborCenter = originalCenters[i - 1].clone().add(originalCenters[i]).add(originalCenters[i + 1]).multiplyScalar(1 / 3);
        centers[i].lerp(neighborCenter, smoothing);
        centers[i].y = originalCenters[i].y; // This is a vertical envelope; never smooth Y away from its authored slice.
        const neighborRadius = (originalRadii[i - 1] + originalRadii[i] + originalRadii[i + 1]) / 3;
        radii[i] = lerp(originalRadii[i], neighborRadius, smoothing);
      }
    }

    return {
      points: centers,
      radii,
      minY,
      maxY,
      bounds: { min: bounds.min.clone(), max: bounds.max.clone() },
      samples,
      radialQuantile,
    };
  }

  function describeObject(object) {
    const T = requireThree();
    let meshes = 0;
    let vertices = 0;
    let triangles = 0;
    const bounds = new T.Box3().makeEmpty(); // Reported in the in-tool/mobile diagnostics panel.
    object?.updateMatrixWorld?.(true);
    object?.traverse?.((mesh) => {
      if (!mesh?.isMesh || !mesh.geometry?.getAttribute?.('position')) return;
      meshes++;
      const position = mesh.geometry.getAttribute('position');
      vertices += position.count;
      triangles += mesh.geometry.index ? Math.floor(mesh.geometry.index.count / 3) : Math.floor(position.count / 3);
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      bounds.union(box);
    });
    return {
      meshes,
      vertices,
      triangles,
      bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() },
    };
  }

  return {
    version: 2,
    framesFromPoints,
    sampleFrame,
    buildHostSpine,
    makeWrappedFollowerPaths,
    deformObjectAlongPath,
    fitObjectToHeight,
    verticalEnvelopeFromObject,
    describeObject,
  };
})();