// Runtime furniture geometry/loading corrections shared by authored vessels.
// Loaded by zone-den-totem-features during normal game boot, after
// ProceduralFurniture + AuthoredFurniture are available and before game.js
// starts building world furniture.
//
// Two narrow corrections live here:
// - `cup` must be a genuinely hollow vessel rather than a capped cylinder,
//   and a linked `liquidSurface` must not fall back to an opaque solid puck.
// - the game's authored-furniture preload is asynchronous. If a scene builds
//   before a JSON finishes loading, buildFurnitureVisual intentionally uses
//   ProceduralFurniture as a temporary fallback. Historically that temporary
//   model stayed forever. We now upgrade only those fallback children in place
//   as soon as the existing AuthoredFurniture.load(key) promise resolves.
(() => {
  'use strict';

  const THREE = window.THREE;
  const furniture = window.ProceduralFurniture;
  if (!THREE || !furniture?.buildPartMesh) {
    window.FurnitureVesselRuntime = { installed: false, reason: 'missing ProceduralFurniture/THREE' };
    return;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const existingPartBuilder = furniture.buildPartMesh;
  const originalBuildPartMesh = existingPartBuilder.__hobunjiVesselRuntimeOriginal || existingPartBuilder.bind(furniture);

  function mapper(part) {
    const t = part?.transform || {};
    const sx = Math.max(0.001, Number(t.sx) || 0.001);
    const sy = Math.max(0.001, Number(t.sy) || 0.001);
    const sz = Math.max(0.001, Number(t.sz) || 0.001);
    const axis = part?.taperAxis || 'y';
    return (x, y, z) => {
      if (axis === 'x') return [y * sx, x * sy, z * sz];
      if (axis === 'z') return [x * sx, z * sy, y * sz];
      return [x * sx, y * sy, z * sz];
    };
  }

  function cupProfile(part, t01, inner = false) {
    const t = clamp(t01, 0, 1);
    const outerX = THREE.MathUtils.lerp(Math.max(0.01, Number(part.bottomScaleX ?? 1)), Math.max(0.01, Number(part.topScaleX ?? 1)), t);
    const outerZ = THREE.MathUtils.lerp(Math.max(0.01, Number(part.bottomScaleZ ?? 1)), Math.max(0.01, Number(part.topScaleZ ?? 1)), t);
    const innerScale = inner ? clamp(part.innerScale ?? 0.78, 0.05, 0.95) : 1;
    return {
      y: -0.5 + t,
      cx: (Number(part.topSkewX) || 0) * t,
      cz: (Number(part.topSkewZ) || 0) * t,
      rx: 0.5 * outerX * innerScale,
      rz: 0.5 * outerZ * innerScale,
    };
  }

  // Keep authored boards/stone textures working on the replacement geometry.
  // This mirrors ProceduralFurniture's dominant-axis UV projection, but stays
  // local so the runtime correction does not need private module helpers.
  function ensureUvs(geometry) {
    if (geometry.getAttribute('uv')) return geometry;
    const projected = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = projected.getAttribute('position');
    if (!pos?.count) return projected;
    projected.computeBoundingBox();
    const box = projected.boundingBox;
    const sizeX = Math.max(1e-6, box.max.x - box.min.x);
    const sizeY = Math.max(1e-6, box.max.y - box.min.y);
    const sizeZ = Math.max(1e-6, box.max.z - box.min.z);
    const uv = new Float32Array(pos.count * 2);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (let first = 0; first + 2 < pos.count; first += 3) {
      a.fromBufferAttribute(pos, first);
      b.fromBufferAttribute(pos, first + 1);
      c.fromBufferAttribute(pos, first + 2);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      n.crossVectors(e1, e2).normalize();
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const dominant = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
      for (let corner = 0; corner < 3; corner++) {
        const v = corner === 0 ? a : corner === 1 ? b : c;
        let u, vv;
        if (dominant === 'x') {
          u = (v.z - box.min.z) / sizeZ;
          vv = (v.y - box.min.y) / sizeY;
          if (n.x < 0) u = 1 - u;
        } else if (dominant === 'y') {
          u = (v.x - box.min.x) / sizeX;
          vv = (v.z - box.min.z) / sizeZ;
          if (n.y > 0) vv = 1 - vv;
        } else {
          u = (v.x - box.min.x) / sizeX;
          vv = (v.y - box.min.y) / sizeY;
          if (n.z > 0) u = 1 - u;
        }
        const offset = (first + corner) * 2;
        uv[offset] = u;
        uv[offset + 1] = vv;
      }
    }
    projected.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return projected;
  }

  function createCupGeometry(part) {
    const segments = Math.max(3, Math.min(64, Math.round(Number(part?.segments) || 16)));
    const basinT = clamp(part?.basinDepth ?? 0.18, 0.03, 0.8);
    const at = mapper(part);
    const positions = [];
    const indices = [];
    const add = (x, y, z) => {
      const p = at(x, y, z);
      positions.push(p[0], p[1], p[2]);
      return positions.length / 3 - 1;
    };
    const ring = (profile) => {
      const ids = [];
      for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2;
        ids.push(add(profile.cx + Math.cos(a) * profile.rx, profile.y, profile.cz + Math.sin(a) * profile.rz));
      }
      return ids;
    };

    const outerBottom = ring(cupProfile(part, 0, false));
    const outerTop = ring(cupProfile(part, 1, false));
    const innerTop = ring(cupProfile(part, 1, true));
    const innerFloor = ring(cupProfile(part, basinT, true));
    const bottomCenter = add(0, -0.5, 0);
    const floorProfile = cupProfile(part, basinT, true);
    const floorCenter = add(floorProfile.cx, floorProfile.y, floorProfile.cz);

    for (let i = 0; i < segments; i++) {
      const n = (i + 1) % segments;

      // Outer wall: same outward winding as ProceduralFurniture's cylinder.
      indices.push(outerBottom[i], outerTop[n], outerBottom[n]);
      indices.push(outerBottom[i], outerTop[i], outerTop[n]);

      // Top rim annulus, facing upward. Crucially: no center/top cap exists.
      indices.push(outerTop[i], innerTop[n], outerTop[n]);
      indices.push(outerTop[i], innerTop[i], innerTop[n]);

      // Inner wall, reversed so FrontSide faces into the vessel cavity.
      indices.push(innerFloor[i], innerTop[n], innerTop[i]);
      indices.push(innerFloor[i], innerFloor[n], innerTop[n]);

      // Solid basin floor at authored basinDepth, facing upward.
      indices.push(floorCenter, innerFloor[n], innerFloor[i]);

      // Closed underside, facing downward.
      indices.push(bottomCenter, outerBottom[i], outerBottom[n]);
    }

    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry = ensureUvs(geometry);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.userData.hobunjiHollowCup = true;
    geometry.userData.basinDepth = basinT;
    geometry.userData.innerScale = clamp(part?.innerScale ?? 0.78, 0.05, 0.95);
    return geometry;
  }

  function createEmptyLiquidGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geometry.userData.hobunjiLinkedLiquidPlaceholder = true;
    return geometry;
  }

  function buildPartMesh(part, baseColor) {
    const mesh = originalBuildPartMesh(part, baseColor);
    if (!part || !mesh) return mesh;

    if (part.kind === 'cup') {
      const replacement = createCupGeometry(part);
      mesh.geometry?.dispose?.();
      mesh.geometry = replacement;
      for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean)) {
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      }
      mesh.userData.hobunjiHollowCup = true;
      mesh.userData.hobunjiOpenVessel = true;
    } else if (part.kind === 'liquidSurface') {
      // AuthoredFurniture replaces this with a disc derived from the linked cup.
      // Leaving the old cylinder here is dangerous: if the relationship is broken,
      // the fallback becomes an opaque/full-looking puck using normal furniture material.
      mesh.geometry?.dispose?.();
      mesh.geometry = createEmptyLiquidGeometry();
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.hobunjiLinkedLiquidPlaceholder = true;
      mesh.userData.liquidContainerId = part.liquidContainerId || null;
    }
    return mesh;
  }

  if (!existingPartBuilder.__hobunjiVesselRuntimeWrapped) {
    buildPartMesh.__hobunjiVesselRuntimeWrapped = true;
    buildPartMesh.__hobunjiVesselRuntimeOriginal = originalBuildPartMesh;
    furniture.buildPartMesh = buildPartMesh;
  }

  // ── Async authored-furniture fallback upgrade ───────────────────────
  // game.js deliberately does not block scene construction on 36 JSON fetches.
  // Preserve that responsiveness, but make the crude procedural visual genuinely
  // temporary instead of permanently snapshotting whichever side won the race.
  const existingGroupBuilder = furniture.buildFurnitureGroup;
  const originalBuildFurnitureGroup = existingGroupBuilder?.__hobunjiAuthoredLiveUpgradeOriginal || existingGroupBuilder?.bind(furniture);

  function disposeFallbackVisual(root) {
    root?.traverse?.((object) => {
      object.geometry?.dispose?.();
      for (const material of (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean)) {
        // Textures in ProceduralFurniture are cached/shared; disposing a material
        // is safe, disposing material.map here would invalidate other furniture.
        material.dispose?.();
      }
    });
  }

  function adoptAuthoredVisual(target, fallbackChildren, data, baseColor) {
    const authoredRuntime = window.AuthoredFurniture;
    if (!target || !data || !authoredRuntime?.buildGroup || target.userData?.authoredFurnitureUpgraded) return false;
    const replacement = authoredRuntime.buildGroup(data, baseColor);
    if (!replacement) return false;

    // Remove ONLY children that belonged to the original procedural fallback.
    // Callers are free to have attached lights, particle helpers, interaction
    // markers, etc. after buildFurnitureGroup returned; those must survive.
    for (const child of fallbackChildren) {
      if (child?.parent !== target) continue;
      target.remove(child);
      disposeFallbackVisual(child);
    }
    for (const child of [...replacement.children]) target.add(child);

    target.name = replacement.name || target.name;
    Object.assign(target.userData, replacement.userData || {}, {
      authoredFurnitureKey: data.key || target.userData?.pendingAuthoredFurnitureKey || null,
      authoredFurnitureUpgraded: true,
      authoredFurnitureUpgradeSource: 'async-fallback-upgrade',
      pendingAuthoredFurnitureKey: null,
    });
    target.updateMatrixWorld?.(true);
    return true;
  }

  function buildFurnitureGroup(key, baseColor) {
    const authoredRuntime = window.AuthoredFurniture;
    const cached = authoredRuntime?.peek?.(key);
    if (cached && authoredRuntime?.buildGroup) {
      const ready = authoredRuntime.buildGroup(cached, baseColor);
      if (ready?.userData) {
        ready.userData.authoredFurnitureUpgraded = true;
        ready.userData.authoredFurnitureUpgradeSource = 'ready-at-build';
      }
      return ready;
    }

    const group = originalBuildFurnitureGroup ? originalBuildFurnitureGroup(key, baseColor) : new THREE.Group();
    if (!group || !key || !authoredRuntime?.load || !authoredRuntime?.buildGroup) return group;

    const fallbackChildren = [...group.children];
    group.userData = group.userData || {};
    group.userData.pendingAuthoredFurnitureKey = key;
    group.userData.authoredFurnitureFallback = true;

    Promise.resolve(authoredRuntime.load(key))
      .then((data) => {
        if (!data) {
          group.userData.pendingAuthoredFurnitureKey = null;
          group.userData.authoredFurnitureFallbackMissing = true;
          return;
        }
        if (adoptAuthoredVisual(group, fallbackChildren, data, baseColor)) {
          group.userData.authoredFurnitureFallback = false;
        }
      })
      .catch((error) => {
        group.userData.pendingAuthoredFurnitureKey = null;
        group.userData.authoredFurnitureFallbackError = String(error?.message || error || 'load failed');
      });

    return group;
  }

  if (existingGroupBuilder && !existingGroupBuilder.__hobunjiAuthoredLiveUpgradeWrapped) {
    buildFurnitureGroup.__hobunjiAuthoredLiveUpgradeWrapped = true;
    buildFurnitureGroup.__hobunjiAuthoredLiveUpgradeOriginal = originalBuildFurnitureGroup;
    furniture.buildFurnitureGroup = buildFurnitureGroup;
  }

  window.FurnitureVesselRuntime = {
    installed: true,
    createCupGeometry,
    createEmptyLiquidGeometry,
    adoptAuthoredVisual,
    liveAuthoredUpgrade: !!furniture.buildFurnitureGroup?.__hobunjiAuthoredLiveUpgradeWrapped,
  };
})();