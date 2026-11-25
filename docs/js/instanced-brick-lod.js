// Render-only distance LOD for WallBuilder's default brick (Roughbrick1.glb):
// house walls, gables and path bricks. Town draws ~8,000 of these 70-triangle
// faceted rocks (~570k triangles, performance-investigation-log.md, 24 Nov).
//
// Far brick: the "octant hull" of the same geometry, i.e. for each of the 8
// box-corner directions the source corner that reaches furthest that way,
// joined as a 12-triangle irregular block with the source's flat shading and
// stretched to the brick's exact bounding box. It keeps the brick's extents,
// volume (Roughbrick1: within a few %) and lopsidedness; only small facets go.
// Normals are per face; uv (when a later tint added one) is copied from the
// source vertex at that corner whose normal best matches the face, so a
// projected PNG maps the same way.
//
// Selection is per InstancedMesh, not per brick: WallBuilder groups bricks per
// wall/path chunk, so a whole mesh is usually either near or far. A mesh whose
// nearest instance (its InstancedMeshBounds sphere edge) is at least
// lodDistance from the camera draws with the far geometry for this world
// render only; its instance matrices, count, material, layers and raycast are
// untouched and the source geometry is restored afterwards. No extra draws,
// no buffer copies. Straddling meshes keep full detail.
// InstancedBrickLod.setEnabled(false) / setDistance(n) are the A/B switches.
(() => {
  'use strict';
  if (window.InstancedBrickLod) return;

  let enabled = true;
  let lodDistance = 14; // World units (≈ tiles) from the camera to the mesh's nearest brick.
  const liteCache = new WeakMap(); // source geometry -> { key, geometry }
  const swapped = []; // [mesh, source geometry, ...] for the current render
  const stats = { frames: 0, candidates: 0, meshes: 0, farMeshes: 0, farInstances: 0, trianglesAvoided: 0, builds: 0, enabled: true, distance: lodDistance };
  let sphere = null;

  function sourceKey(geometry) {
    const position = geometry.attributes.position, uv = geometry.attributes.uv;
    return position.version + '|' + position.count + '|' + (uv ? 'uv' + uv.version : '-') + '|' + (geometry.index ? geometry.index.count : 0);
  }

  // Builds the 12-triangle octant hull of a (flat-shaded) source geometry.
  function buildLite(THREE, source) {
    const position = source.attributes.position, normal = source.attributes.normal, uv = source.attributes.uv;
    if (!position || position.count < 8) return null;
    source.computeBoundingBox?.();
    const box = source.boundingBox;
    const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2, cz = (box.min.z + box.max.z) / 2;
    const hx = Math.max(1e-6, (box.max.x - box.min.x) / 2), hy = Math.max(1e-6, (box.max.y - box.min.y) / 2), hz = Math.max(1e-6, (box.max.z - box.min.z) / 2);
    // Corner c = bit0 x, bit1 y, bit2 z (1 = positive side).
    const corner = new Int32Array(8).fill(-1), best = new Float64Array(8).fill(-Infinity);
    for (let i = 0; i < position.count; i++) {
      const x = (position.getX(i) - cx) / hx, y = (position.getY(i) - cy) / hy, z = (position.getZ(i) - cz) / hz;
      for (let c = 0; c < 8; c++) {
        const d = (c & 1 ? x : -x) + (c & 2 ? y : -y) + (c & 4 ? z : -z);
        if (d > best[c]) { best[c] = d; corner[c] = i; }
      }
    }
    if (corner.some(i => i < 0)) return null;
    // The six quads of a box (corner indices), two triangles each, wound outward below.
    const quads = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
    const out = [], outUv = uv ? [] : null;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const at = (index, target) => target.set(position.getX(index), position.getY(index), position.getZ(index));
    // uv of the source vertex sharing this corner's position whose normal best matches the face.
    const uvFor = (index, faceNormal) => {
      const px = position.getX(index), py = position.getY(index), pz = position.getZ(index);
      let pick = index, score = -Infinity;
      for (let i = 0; i < position.count; i++) {
        if (Math.abs(position.getX(i) - px) + Math.abs(position.getY(i) - py) + Math.abs(position.getZ(i) - pz) > 1e-6) continue;
        const s = normal ? normal.getX(i) * faceNormal.x + normal.getY(i) * faceNormal.y + normal.getZ(i) * faceNormal.z : 0;
        if (s > score) { score = s; pick = i; }
      }
      return [uv.getX(pick), uv.getY(pick)];
    };
    const hullCenter = new THREE.Vector3(), mid = new THREE.Vector3();
    for (let k = 0; k < 8; k++) hullCenter.add(at(corner[k], mid));
    hullCenter.multiplyScalar(1 / 8);
    for (const [q0, q1, q2, q3] of quads) {
      for (let tri of [[q0, q1, q2], [q0, q2, q3]]) {
        at(corner[tri[0]], a); at(corner[tri[1]], b); at(corner[tri[2]], c);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        if (n.lengthSq() < 1e-14) continue; // Two octants picked the same corner.
        n.normalize();
        mid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(hullCenter);
        if (n.dot(mid) < 0) { tri = [tri[0], tri[2], tri[1]]; at(corner[tri[1]], b); at(corner[tri[2]], c); n.negate(); } // Wind outward.
        for (const p of [a, b, c]) out.push(p.x, p.y, p.z);
        if (outUv) for (const k of tri) outUv.push(...uvFor(corner[k], n));
      }
    }
    if (out.length < 9 * 4) return null;
    // Stretch the hull per axis to the brick's exact bounding box: corner picks
    // sit slightly inside it (Roughbrick1: 90-93% of the x/y span), and a
    // far brick must not read as a smaller one or open gaps in the course.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < out.length; i++) { const k = i % 3; if (out[i] < lo[k]) lo[k] = out[i]; if (out[i] > hi[k]) hi[k] = out[i]; }
    const srcLo = [box.min.x, box.min.y, box.min.z], srcHi = [box.max.x, box.max.y, box.max.z];
    for (let i = 0; i < out.length; i++) {
      const k = i % 3, span = hi[k] - lo[k];
      if (span > 1e-9) out[i] = srcLo[k] + (out[i] - lo[k]) * (srcHi[k] - srcLo[k]) / span;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    if (outUv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
    geometry.computeVertexNormals(); // Non-indexed: one flat normal per face, like the source.
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.instancedBrickLod = true;
    return geometry;
  }

  // Far geometry for this source, rebuilt when the source's attributes change
  // (e.g. a later tint adds projected uvs). Null when the source cannot be hulled.
  function liteFor(source) {
    const THREE = window.THREE;
    if (!THREE || !source?.attributes?.position) return null;
    const key = sourceKey(source);
    let entry = liteCache.get(source);
    if (!entry || entry.key !== key) {
      entry?.geometry?.dispose?.();
      entry = { key, geometry: buildLite(THREE, source) };
      liteCache.set(source, entry);
      stats.builds++;
    }
    return entry.geometry;
  }

  function triangles(geometry) {
    return Math.round((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3);
  }

  function drawnIn(object, scene) {
    for (let node = object; node; node = node.parent) {
      if (node.visible === false) return false;
      if (node === scene) return true;
    }
    return false;
  }

  function restore() {
    for (let i = 0; i < swapped.length; i += 2) swapped[i].geometry = swapped[i + 1];
    swapped.length = 0;
  }

  // Returns a restore closure, or null when nothing was swapped.
  function suspendForRender(scene, camera) {
    if (swapped.length) restore(); // Never leave a previous render's swap behind.
    const bounds = window.InstancedMeshBounds;
    if (!enabled || !scene?.isScene || !camera?.matrixWorld || !bounds?.forEachTracked || !window.THREE) return null;
    if (!sphere) sphere = new window.THREE.Sphere();
    const e = camera.matrixWorld.elements, camX = e[12], camY = e[13], camZ = e[14];
    let candidates = 0, meshes = 0, farMeshes = 0, farInstances = 0, avoided = 0;
    try {
      const visitBricks = callback => bounds.forEachTrackedBrickInScene
        ? bounds.forEachTrackedBrickInScene(scene, callback)
        : (bounds.forEachTrackedBrick || bounds.forEachTracked)(callback); // Older preview pages retain the generic fallback.
      visitBricks(mesh => {
        candidates++;
        if (mesh.userData?.hobunjiBrickLod !== true || !(mesh.count > 0) || !drawnIn(mesh, scene)) return;
        meshes++;
        const world = bounds.worldSphere(mesh, sphere);
        if (!world) return;
        const gap = Math.hypot(world.center.x - camX, world.center.y - camY, world.center.z - camZ) - world.radius;
        if (gap < lodDistance) return;
        const lite = liteFor(mesh.geometry);
        if (!lite) return;
        swapped.push(mesh, mesh.geometry);
        avoided += (triangles(mesh.geometry) - triangles(lite)) * mesh.count;
        mesh.geometry = lite;
        farMeshes++;
        farInstances += mesh.count;
      });
    } catch (error) {
      restore(); // Fail open: full-detail bricks.
      throw error;
    }
    stats.frames++; stats.candidates = candidates; stats.meshes = meshes; stats.farMeshes = farMeshes; stats.farInstances = farInstances; stats.trianglesAvoided = avoided;
    return swapped.length ? restore : null;
  }

  function setEnabled(value) { enabled = value !== false; stats.enabled = enabled; if (!enabled) restore(); return enabled; }
  function setDistance(value) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) lodDistance = n;
    stats.distance = lodDistance;
    return lodDistance;
  }

  window.InstancedBrickLod = Object.freeze({
    suspendForRender, liteFor, setEnabled, setDistance,
    enabled: () => enabled,
    snapshot: () => ({ ...stats }),
  });
})();
