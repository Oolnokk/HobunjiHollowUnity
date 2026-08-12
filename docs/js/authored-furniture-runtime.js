// Loads and renders the rich per-piece furniture data authored by
// docs/tools/furniture-avatar-author/index.html (docs/config/furniture-authored/
// <furnitureKey>.json — schema hobunji_furniture_authored_runtime.v1), as
// opposed to docs/js/procedural-furniture.js's own small hardcoded CATALOG
// recipes. Both share the same part schema (buildPartMesh), so this module
// is a thin loader/cache + group builder on top of that, plus accessors for
// the interaction metadata (seat anchors, particle emitters, processing
// warps/timelines, livestock stomp attach points) the authoring tool now
// exports alongside geometry.
//
// Intentionally data-driven rather than tied to any specific furniture kind
// (chair/station/etc.) — any key with a docs/config/furniture-authored/*.json
// file works the same way, so decorative pieces (tables, beds, ...) can opt
// into real authored geometry and interactables later without a rewrite.
(function () {
  'use strict';

  const CONFIG_BASE = 'config/furniture-authored/';
  const _cache = new Map(); // furnitureKey -> Promise<data|null>, .__value set once resolved

  // Synchronous accessor for already-resolved data — callers that build
  // meshes on demand (placement, respawn-on-load) should `await load(key)`
  // once up front, then use this for the rest of that object's lifetime.
  function peek(furnitureKey) {
    const cached = _cache.get(furnitureKey);
    return cached && cached.__value !== undefined ? cached.__value : null;
  }

  function load(furnitureKey) {
    if (_cache.has(furnitureKey)) return _cache.get(furnitureKey);
    const promise = fetch(CONFIG_BASE + furnitureKey + '.json')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data) => { promise.__value = data; return data; });
    _cache.set(furnitureKey, promise);
    return promise;
  }

  // Builds a full-fidelity THREE.Group from authored `parts`. Each child
  // mesh is tagged with its authored part id in userData so particle/warp/
  // stomp playback (see docs/game.js's processing-station VFX) can find its
  // target part later without re-walking the parts array. Also stashes each
  // mesh's authored (rest-pose) local matrix — applyWarp/resetWarp recompose
  // from this every frame instead of mutating position/rotation/scale in
  // place, so repeated warp playback never drifts from the authored pose.
  function buildGroup(data, baseColor) {
    const group = new THREE.Group();
    if (!data || !Array.isArray(data.parts)) return group;
    group.name = `authored_furniture_${data.key || 'unknown'}`;
    group.userData.authoredFurnitureKey = data.key || null; // Used by Pixel Probe/runtime diagnostics to identify authored furniture instances.
    const meshById = new Map();
    const partById = new Map(); // Used by timeline liquid geometry, linked-container warps, and stomp anchors.
    for (const part of data.parts) partById.set(part.id, part);
    for (const part of data.parts) {
      const mesh = window.ProceduralFurniture.buildPartMesh(part, baseColor);
      if (part.kind === 'cup') {
        const cupGeometry = _cupGeometry(part); // Used to preserve the editor's open vessel cavity instead of the generic capped-cylinder runtime fallback.
        if (cupGeometry) { mesh.geometry?.dispose?.(); mesh.geometry = cupGeometry; }
      }
      if (part.kind === 'liquidSurface') {
        const liquidGeometry = _liquidSurfaceGeometry(part, partById, Number(part.liquidLevel) || 0);
        if (liquidGeometry) { mesh.geometry?.dispose?.(); mesh.geometry = liquidGeometry; }
        _setLiquidMaterial(mesh, part, {
          color: part.color,
          opacity: part.surfaceOpacity,
          substanceColor: part.substanceColor,
          fillOpacity: part.substanceFillOpacity,
        });
      }
      mesh.name = `authored_${data.key || 'furniture'}_${part.name || part.id}`;
      mesh.userData.authoredPartId = part.id;
      mesh.userData.authoredPart = part;
      mesh.userData.authoredMatrix = new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale);
      group.add(mesh);
      meshById.set(part.id, mesh);
    }
    group.userData.meshById = meshById;
    group.userData.partById = partById;
    group.userData.timelineLiquidStates = new Map(); // Used by the live stomp anchor to follow the animated surface level.
    return group;
  }

  const _clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

  function _vesselPointMapper(part) {
    const t = part.transform || {};
    const sx = Math.max(.001, Number(t.sx) || .001), sy = Math.max(.001, Number(t.sy) || .001), sz = Math.max(.001, Number(t.sz) || .001);
    const axis = part.taperAxis || 'y';
    return (x, y, z) => axis === 'x' ? new THREE.Vector3(y * sx, x * sy, z * sz) : axis === 'z' ? new THREE.Vector3(x * sx, z * sy, y * sz) : new THREE.Vector3(x * sx, y * sy, z * sz);
  }

  function _faceNormalOf(a, b, c) {
    const u = new THREE.Vector3().subVectors(b, a), v = new THREE.Vector3().subVectors(c, a); // Used to preserve the editor's outward/inward winding decisions for vessel surfaces.
    return new THREE.Vector3().crossVectors(u, v);
  }

  function _edgeLen(a, b, tileSize) {
    return a.distanceTo(b) / Math.max(.001, tileSize);
  }

  function _pushOutwardQuad(positions, uvs, p0, p1, p2, p3, center, tileSize) {
    const centroid = p0.clone().add(p1).add(p2).add(p3).multiplyScalar(.25);
    const normal = _faceNormalOf(p0, p1, p2);
    const q = normal.dot(centroid.clone().sub(center)) < 0 ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
    const u = _edgeLen(q[0], q[1], tileSize), v = _edgeLen(q[0], q[3], tileSize);
    positions.push(q[0].x, q[0].y, q[0].z, q[1].x, q[1].y, q[1].z, q[2].x, q[2].y, q[2].z,
      q[0].x, q[0].y, q[0].z, q[2].x, q[2].y, q[2].z, q[3].x, q[3].y, q[3].z);
    uvs.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v);
  }

  function _pushOutwardTri(positions, uvs, p0, p1, p2, center, tileSize) {
    const centroid = p0.clone().add(p1).add(p2).multiplyScalar(1 / 3);
    const q = _faceNormalOf(p0, p1, p2).dot(centroid.clone().sub(center)) < 0 ? [p0, p2, p1] : [p0, p1, p2];
    const u = _edgeLen(q[0], q[1], tileSize), v = _edgeLen(q[0], q[2], tileSize);
    positions.push(q[0].x, q[0].y, q[0].z, q[1].x, q[1].y, q[1].z, q[2].x, q[2].y, q[2].z);
    uvs.push(0, 0, u, 0, 0, v);
  }

  // Exact runtime port of furniture-avatar-author's open cup/basin primitive.
  // Unlike the generic tapered-cylinder builder, this has an outer wall,
  // inward-facing inner wall, rim bridge, basin floor, and sealed underside —
  // but intentionally NO top cap, so authored liquid surfaces remain visible.
  function _cupGeometry(part) {
    const segments = Math.max(3, Math.min(64, Math.round(part.segments || 20)));
    const at = _vesselPointMapper(part);
    const inner = Math.max(.05, Math.min(.95, Number(part.innerScale) || .78));
    const basin = Math.max(.03, Math.min(.8, Number(part.basinDepth ?? .18)));
    const topX = Math.max(.01, part.topScaleX ?? 1.08), topZ = Math.max(.01, part.topScaleZ ?? 1.08);
    const botX = Math.max(.01, part.bottomScaleX ?? .78), botZ = Math.max(.01, part.bottomScaleZ ?? .78);
    const skewX = part.topSkewX || 0, skewZ = part.topSkewZ || 0;
    const floorX = THREE.MathUtils.lerp(botX, topX, basin), floorZ = THREE.MathUtils.lerp(botZ, topZ, basin);
    const floorSkewX = skewX * basin, floorSkewZ = skewZ * basin;
    const outerBottom = [], outerTop = [], innerFloor = [], innerTop = [];
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2, c = Math.cos(angle) * .5, s = Math.sin(angle) * .5;
      outerBottom.push(at(c * botX, -.5, s * botZ));
      outerTop.push(at(c * topX + skewX, .5, s * topZ + skewZ));
      innerFloor.push(at(c * floorX * inner + floorSkewX, -.5 + basin, s * floorZ * inner + floorSkewZ));
      innerTop.push(at(c * topX * inner + skewX, .5, s * topZ * inner + skewZ));
    }
    const positions = [], uvs = [], center = new THREE.Vector3(), tile = part.textureTileSize || 1;
    const floorCenter = at(floorSkewX, -.5 + basin, floorSkewZ), bottomCenter = at(0, -.5, 0);
    const referenceBelow = at(0, -2, 0), referenceAbove = at(0, 2, 0);
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      _pushOutwardQuad(positions, uvs, outerBottom[i], outerBottom[next], outerTop[next], outerTop[i], center, tile);
      const innerCentroid = innerFloor[i].clone().add(innerFloor[next]).add(innerTop[next]).add(innerTop[i]).multiplyScalar(.25);
      const innerReference = innerCentroid.clone().multiplyScalar(2);
      _pushOutwardQuad(positions, uvs, innerFloor[next], innerFloor[i], innerTop[i], innerTop[next], innerReference, tile);
      _pushOutwardQuad(positions, uvs, outerTop[i], outerTop[next], innerTop[next], innerTop[i], referenceBelow, tile);
      _pushOutwardTri(positions, uvs, floorCenter, innerFloor[i], innerFloor[next], referenceBelow, tile);
      _pushOutwardTri(positions, uvs, bottomCenter, outerBottom[next], outerBottom[i], referenceAbove, tile);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }

  function _cupProfileAtLevel(cup, level) {
    const basin = Math.max(.03, Math.min(.8, Number(cup?.basinDepth ?? .18)));
    const fill = _clamp01(level), fullT = basin + (1 - basin) * fill;
    const outerX = THREE.MathUtils.lerp(Math.max(.01, cup.bottomScaleX ?? 1), Math.max(.01, cup.topScaleX ?? 1), fullT);
    const outerZ = THREE.MathUtils.lerp(Math.max(.01, cup.bottomScaleZ ?? 1), Math.max(.01, cup.topScaleZ ?? 1), fullT);
    const inner = Math.max(.05, Math.min(.95, Number(cup.innerScale) || .78));
    return { fill, fullT, y: -.5 + fullT, centerX: (cup.topSkewX || 0) * fullT, centerZ: (cup.topSkewZ || 0) * fullT, radiusX: .5 * outerX * inner, radiusZ: .5 * outerZ * inner };
  }

  // Runtime port of the furniture editor's linked liquid disc. Keeping the
  // vertices in the cup's local frame lets the surface inherit the exact same
  // stomp matrix as its container instead of approximating level with Y scale.
  function _liquidSurfaceGeometry(part, partById, level) {
    const cup = partById?.get(part.liquidContainerId);
    if (!cup || cup.kind !== 'cup') return null;
    const segments = Math.max(3, Math.min(64, Math.round(cup.segments || 20)));
    const profile = _cupProfileAtLevel(cup, level), at = _vesselPointMapper(cup);
    const center = at(profile.centerX, profile.y, profile.centerZ), positions = [], uvs = [];
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
      const p1 = at(profile.centerX + Math.cos(a) * profile.radiusX, profile.y, profile.centerZ + Math.sin(a) * profile.radiusZ);
      const p2 = at(profile.centerX + Math.cos(b) * profile.radiusX, profile.y, profile.centerZ + Math.sin(b) * profile.radiusZ);
      positions.push(center.x, center.y, center.z, p2.x, p2.y, p2.z, p1.x, p1.y, p1.z);
      uvs.push(.5, .5, .5 + Math.cos(b) * .5, .5 + Math.sin(b) * .5, .5 + Math.cos(a) * .5, .5 + Math.sin(a) * .5);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }

  function _setLiquidMaterial(mesh, part, state) {
    const opacity = state.opacity == null ? Number(part.surfaceOpacity ?? .78) : _clamp01(state.opacity);
    const substanceColor = state.substanceColor || part.substanceColor || part.color || '#4aa9dd';
    const fillOpacity = state.fillOpacity == null ? Number(part.substanceFillOpacity) || 0 : _clamp01(state.fillOpacity);
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean)) {
      if (material.map) material.color.copy(new THREE.Color('#ffffff').lerp(new THREE.Color(substanceColor), fillOpacity));
      else material.color.set(state.color || part.color || '#4aa9dd');
      material.opacity = opacity;
      material.transparent = opacity < .999 || !!material.map;
      material.depthWrite = opacity >= .999;
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    }
  }

  // ── Processing warp playback (particleEmitters/processingWarps) ────────
  // Faithful port of the authoring tool's own applyProcessingWarps/
  // stompWarpMotion (docs/tools/furniture-avatar-author/index.html), so a
  // station's in-game animation matches what the tool previews. Kept here
  // rather than duplicated per-caller since both the ordinary player-click
  // processing burst and the livestock stomp animation drive the same warp
  // data.
  const _DEG = Math.PI / 180;

  function stompWarpMotion(warp, nowSeconds) {
    if (!warp || warp.enabled === false || warp.style !== 'stomp') return { impact: 0, rock: 0 };
    const downSpeed = Math.max(0.05, Number(warp.downSpeed) || 10);
    const upSpeed = Math.max(0.05, Number(warp.upSpeed) || 2.85);
    const downDuration = 1 / downSpeed, upDuration = 1 / upSpeed, cycleDuration = downDuration + upDuration;
    const phaseSeconds = ((Number(warp.phaseDeg) || 0) / 360) * cycleDuration;
    const absoluteTime = nowSeconds + phaseSeconds;
    const cycleTime = ((absoluteTime % cycleDuration) + cycleDuration) % cycleDuration;
    const stompIndex = Math.floor(absoluteTime / cycleDuration);
    const sharpness = Math.max(0, Math.min(1, Number(warp.impact ?? 0.82)));
    let impact;
    if (cycleTime < downDuration) {
      const p = cycleTime / Math.max(0.0001, downDuration);
      impact = Math.pow(p, 2.2 + sharpness * 5.8);
    } else {
      const p = (cycleTime - downDuration) / Math.max(0.0001, upDuration);
      impact = Math.pow(Math.max(0, 1 - p), 0.85 + sharpness * 0.55);
    }
    const side = stompIndex % 2 === 0 ? 1 : -1;
    const rock = (Number(warp.rockDeg) || 0) * _DEG * side * Math.pow(impact, 0.72);
    return { impact, rock };
  }

  // Volume-weighted centroid of the warped furniture pieces themselves.
  // IMPORTANT: do not use Box3.setFromObject(mesh) here. Runtime emitter
  // Points are parented to furniture meshes so they follow warps, and unused
  // particle vertices are parked at y=-9999. setFromObject recursively
  // includes those descendants, which can push the warp pivot thousands of
  // units away and make the entire vat sweep across the screen. The editor's
  // centroid is based on the authored pieces, so transform each target mesh's
  // own geometry bounding box into world space and deliberately ignore VFX.
  function _warpCentroid(meshes, group) {
    let total = 0;
    const sum = new THREE.Vector3();
    const box = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3();
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      if (!geometry) continue;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox) continue;
      box.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      box.getSize(size);
      box.getCenter(center);
      if (group) group.worldToLocal(center);
      const weight = Math.max(1e-6, size.x * size.y * size.z);
      sum.addScaledVector(center, weight);
      total += weight;
    }
    return total ? sum.multiplyScalar(1 / total) : new THREE.Vector3();
  }

  const _warpMat = new THREE.Matrix4(), _rotMat = new THREE.Matrix4(), _scaleMat = new THREE.Matrix4();
  const _t1 = new THREE.Matrix4(), _t2 = new THREE.Matrix4();
  const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scl = new THREE.Vector3();

  // Applies one processingWarp record to its target parts within `group`
  // (built by buildGroup) at time `nowSeconds`. No-op if the warp is
  // disabled or none of its partIds resolve to meshes in this group.
  function applyWarp(group, warp, nowSeconds) {
    if (!warp || warp.enabled === false || !Array.isArray(warp.partIds) || !warp.partIds.length) return;
    const meshById = group.userData.meshById;
    if (!meshById) return;
    const targetMeshes = warp.partIds.map((id) => meshById.get(id)).filter(Boolean);
    if (!targetMeshes.length) return;
    const linkedLiquids = [];
    for (const [id, part] of group.userData.partById || []) {
      if (part.kind === 'liquidSurface' && warp.partIds.includes(part.liquidContainerId)) {
        const liquidMesh = meshById.get(id);
        if (liquidMesh) linkedLiquids.push(liquidMesh);
      }
    }
    const meshes = [...targetMeshes, ...linkedLiquids];
    // The editor performs this reset for every affected part before deriving
    // the centroid and warp matrix. Do the same here so live playback uses
    // the authored frame as its input instead of feeding the previous warped
    // frame back into the next one.
    resetWarp(group, warp);
    group.updateMatrixWorld(true);
    const center = _warpCentroid(targetMeshes, group);
    const phase = (warp.phaseDeg || 0) * _DEG;
    const t = nowSeconds * (warp.speed || 0) + phase;
    const pulse = Math.sin(t), secondary = Math.sin(t * 1.73 + 0.8);
    const strength = warp.strength || 0;
    const style = warp.style === 'wobble' || warp.style === 'stomp' ? warp.style : 'breathing';
    let scale, rotation, drop = 0;
    if (style === 'stomp') {
      const motion = stompWarpMotion(warp, nowSeconds);
      const impact = motion.impact;
      scale = new THREE.Vector3(1 + strength * 0.34 * impact, 1 - strength * (warp.depth ?? 0.82) * impact, 1 + strength * 0.34 * impact);
      rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, motion.rock, 'XYZ'));
      drop = strength * 0.34 * impact;
    } else if (style === 'breathing') {
      const radial = 1 + strength * pulse, vertical = 1 - strength * (warp.depth ?? 0.7) * 0.38 * pulse;
      const drift = Math.sin(t * 0.5) * ((warp.swayDeg || 0) * _DEG * 0.18), roll = Math.sin(t * 0.4 + 0.7) * ((warp.twistDeg || 0) * _DEG * 0.1);
      scale = new THREE.Vector3(radial, vertical, radial);
      rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(drift * 0.6, roll, drift, 'XYZ'));
    } else {
      scale = new THREE.Vector3(1 - strength * 0.58 * pulse, 1 + strength * pulse, 1 - strength * (warp.depth ?? 0.45) * 0.58 * pulse);
      rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(secondary * (warp.twistDeg || 0) * _DEG, pulse * (warp.twistDeg || 0) * _DEG * 0.35, Math.sin(t * 0.77) * (warp.swayDeg || 0) * _DEG, 'XYZ'));
    }
    _rotMat.makeRotationFromQuaternion(rotation);
    _scaleMat.makeScale(scale.x, scale.y, scale.z);
    _t1.makeTranslation(center.x, center.y - drop, center.z);
    _t2.makeTranslation(-center.x, -center.y, -center.z);
    _warpMat.copy(_t1).multiply(_rotMat).multiply(_scaleMat).multiply(_t2);
    for (const mesh of meshes) {
      const authored = mesh.userData.authoredMatrix;
      if (!authored) continue;
      _warpMat.clone().multiply(authored).decompose(_pos, _quat, _scl);
      mesh.position.copy(_pos);
      mesh.quaternion.copy(_quat);
      mesh.scale.copy(_scl);
    }
  }

  // Restores every mesh a warp targets back to its authored rest pose —
  // call once when a station stops actively processing/aging.
  function resetWarp(group, warp) {
    if (!warp || !Array.isArray(warp.partIds)) return;
    const meshById = group.userData.meshById;
    if (!meshById) return;
    const ids = [...warp.partIds];
    for (const [id, part] of group.userData.partById || []) if (part.kind === 'liquidSurface' && warp.partIds.includes(part.liquidContainerId)) ids.push(id);
    for (const id of ids) {
      const mesh = meshById.get(id);
      if (!mesh || !mesh.userData.authoredMatrix) continue;
      mesh.userData.authoredMatrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    }
  }

  // ── Particle emitter playback ───────────────────────────────────────
  // Lightweight sprite-burst version of the authoring tool's emitter
  // preview — a single THREE.Points draw call per emitter, parented to its
  // attachedPartId mesh so it automatically follows that part's warp
  // animation (e.g. the squeezer nozzle's pour tracks the stomp bounce).
  // Simplified from the tool's own particle system (no per-type shaping
  // beyond a rotated emission cone) — enough for "something is happening
  // here" station feedback, not a full VFX authoring surface.
  function createEmitterVisual(group, emitter, maxParticles) {
    const meshById = group.userData.meshById;
    const parent = (emitter.attachedPartId && meshById && meshById.get(emitter.attachedPartId)) || group;
    const cap = maxParticles || 40;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    const mat = new THREE.PointsMaterial({ size: Math.max(0.01, emitter.size || 0.05), vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true });
    const points = new THREE.Points(geo, mat);
    points.name = `authored_furniture_emitter_${emitter.name || emitter.id || 'unnamed'}`;
    points.userData.authoredEmitterId = emitter.id || null; // Used by Pixel Probe/runtime diagnostics to distinguish VFX from furniture geometry.
    points.position.set((emitter.position && emitter.position.x) || 0, (emitter.position && emitter.position.y) || 0, (emitter.position && emitter.position.z) || 0);
    points.frustumCulled = false;
    points.visible = false;
    parent.add(points);

    const emitQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      ((emitter.rotation && emitter.rotation.x) || 0) * _DEG,
      ((emitter.rotation && emitter.rotation.y) || 0) * _DEG,
      ((emitter.rotation && emitter.rotation.z) || 0) * _DEG, 'XYZ'));
    const baseDir = new THREE.Vector3(0, 1, 0).applyQuaternion(emitQuat);
    const colorA = new THREE.Color(emitter.colorA || '#ffffff');
    const colorB = new THREE.Color(emitter.colorB || '#ffffff');
    const particles = [];
    let spawnAccum = 0;

    function update(dt, active, override) {
      const live = Object.assign({}, emitter, override || {});
      const rate = active && live.enabled !== false ? (live.rate || 0) : 0;
      mat.size = Math.max(.01, live.size || .05);
      colorA.set(live.colorA || '#ffffff'); colorB.set(live.colorB || '#ffffff');
      if (rate > 0 && particles.length < cap) {
        spawnAccum += dt * rate;
        while (spawnAccum >= 1 && particles.length < cap) {
          spawnAccum -= 1;
          const spread = live.spread || 0.05, radius = live.radius || 0, speed = live.speed || 0.5;
          const jr = Math.random() * radius, ja = Math.random() * Math.PI * 2;
          particles.push({
            age: 0, life: Math.max(0.05, live.lifetime || 0.6),
            x: Math.cos(ja) * jr, y: 0, z: Math.sin(ja) * jr,
            vx: baseDir.x * speed + (Math.random() - 0.5) * spread,
            vy: baseDir.y * speed + (Math.random() - 0.5) * spread,
            vz: baseDir.z * speed + (Math.random() - 0.5) * spread,
          });
        }
      } else {
        spawnAccum = 0;
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) { particles.splice(i, 1); continue; }
        p.vy -= (live.gravity || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      const posAttr = geo.attributes.position, colorAttr = geo.attributes.color;
      for (let i = 0; i < cap; i++) {
        if (i < particles.length) {
          const p = particles[i];
          posAttr.setXYZ(i, p.x, p.y, p.z);
          const c = colorA.clone().lerp(colorB, p.age / p.life);
          colorAttr.setXYZ(i, c.r, c.g, c.b);
        } else {
          posAttr.setXYZ(i, 0, -9999, 0);
        }
      }
      posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      points.visible = particles.length > 0;
    }
    function dispose() {
      parent.remove(points);
      geo.dispose();
      mat.dispose();
    }
    return { points, update, dispose };
  }

  function _colorLerp(a, b, t) {
    return '#' + new THREE.Color(a || '#ffffff').lerp(new THREE.Color(b || a || '#ffffff'), _clamp01(t)).getHexString();
  }

  function _interpolateTimelineValue(a, b, t) {
    const out = {};
    for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const av = a?.[key], bv = b?.[key];
      if (typeof av === 'number' && typeof bv === 'number') out[key] = av + (bv - av) * t;
      else if (typeof av === 'string' && typeof bv === 'string' && /^#[0-9a-f]{6}$/i.test(av) && /^#[0-9a-f]{6}$/i.test(bv)) out[key] = _colorLerp(av, bv, t);
      else out[key] = t < .5 ? (av ?? bv) : (bv ?? av);
    }
    return out;
  }

  function sampleTimelineTrack(track, progress) {
    const frames = (track?.keyframes || []).slice().sort((a, b) => a.time - b.time);
    if (!frames.length) return {};
    if (progress <= frames[0].time) return Object.assign({}, frames[0].value);
    if (progress >= frames[frames.length - 1].time) return Object.assign({}, frames[frames.length - 1].value);
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i], b = frames[i + 1];
      if (progress < a.time || progress > b.time) continue;
      return _interpolateTimelineValue(a.value, b.value, (progress - a.time) / Math.max(.000001, b.time - a.time));
    }
    return Object.assign({}, frames[frames.length - 1].value);
  }

  function primaryProcessTimeline(data) {
    return (data?.processTimelines || []).find(timeline => timeline.enabled !== false) || null;
  }

  // Applies the editor-authored emitter/warp/liquid keyframes at one normalized
  // process position. The returned maps feed the existing lightweight runtime
  // emitters and warps without making game.js understand timeline internals.
  function applyProcessTimeline(group, data, timeline, progress) {
    const p = _clamp01(progress), substance = timeline?.substanceColor || '#7b1f3d';
    const emitterOverrides = new Map(), warpOverrides = new Map(), liquidStates = group.userData.timelineLiquidStates || new Map();
    for (const track of timeline?.emitterTracks || []) {
      const value = sampleTimelineTrack(track, p);
      if (track.useSubstanceColor) { value.colorA = substance; value.colorB = _colorLerp('#000000', substance, .62); }
      emitterOverrides.set(track.emitterId, value);
    }
    for (const track of timeline?.warpTracks || []) warpOverrides.set(track.warpId, sampleTimelineTrack(track, p));
    for (const track of timeline?.liquidTracks || []) {
      const part = group.userData.partById?.get(track.partId), mesh = group.userData.meshById?.get(track.partId);
      if (!part || !mesh) continue;
      const value = sampleTimelineTrack(track, p);
      if (track.useSubstanceColor) value.substanceColor = substance;
      if (track.colorFromSubstance) value.color = substance;
      liquidStates.set(track.partId, value);
      const levelSignature = _clamp01(value.level).toFixed(3);
      if (mesh.userData.timelineLiquidLevel !== levelSignature) {
        const geometry = _liquidSurfaceGeometry(part, group.userData.partById, value.level);
        if (geometry) { mesh.geometry?.dispose?.(); mesh.geometry = geometry; }
        mesh.userData.timelineLiquidLevel = levelSignature;
      }
      _setLiquidMaterial(mesh, part, value);
    }
    group.userData.timelineLiquidStates = liquidStates;
    return { emitterOverrides, warpOverrides };
  }

  // Resolves the authored livestock point after liquid-level and stomp-warp
  // changes, in world space, so the assigned animal can align its shoulderGrip
  // exactly as the furniture editor preview does.
  function stompAttachWorldMatrix(group, data, record, nowSeconds) {
    if (!record || record.enabled === false) return null;
    const parent = group.userData.meshById?.get(record.parentPartId), part = group.userData.partById?.get(record.parentPartId);
    if (!parent || !part) return null;
    group.updateMatrixWorld(true);
    const position = new THREE.Vector3(record.position?.x || 0, record.position?.y || 0, record.position?.z || 0);
    if (part.kind === 'liquidSurface') {
      const cup = group.userData.partById?.get(part.liquidContainerId);
      if (cup) {
        const state = group.userData.timelineLiquidStates?.get(part.id) || { level: part.liquidLevel };
        const profile = _cupProfileAtLevel(cup, state.level);
        position.add(_vesselPointMapper(cup)(profile.centerX, profile.y, profile.centerZ));
      }
    }
    const rotation = record.rotation || {};
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler((rotation.x || 0) * _DEG, (rotation.y || 0) * _DEG, (rotation.z || 0) * _DEG, 'XYZ'));
    const local = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
    const world = parent.matrixWorld.clone().multiply(local);
    const warp = (data?.processingWarps || []).find(item => item.id === record.warpId);
    const lift = (record.bounceHeight || 0) * (1 - stompWarpMotion(warp, nowSeconds).impact);
    return world.multiply(new THREE.Matrix4().makeTranslation(0, lift, 0));
  }

  // index defaults to 0 (single-seat pieces like chairs/stools); bench-like
  // pieces carry one anchor per seat column, in authoring order. position/
  // rotationDeg are already resolved to the piece's own local footprint-
  // center-relative space (matching every part's transform convention) —
  // see docs/tools/furniture-avatar-author's seatAnchorWorldTransform,
  // which this data was extracted from at the piece's authoring origin.
  function seatAnchorFor(data, index) {
    const anchor = data && data.seatAnchors && data.seatAnchors[index || 0];
    if (!anchor) return null;
    return { position: Object.assign({}, anchor.position), rotationDeg: Object.assign({}, anchor.rotationDeg) };
  }

  function seatCount(data) {
    return data && Array.isArray(data.seatAnchors) ? data.seatAnchors.length : 0;
  }

  window.AuthoredFurniture = {
    load,
    peek,
    buildGroup,
    seatAnchorFor,
    seatCount,
    applyWarp,
    resetWarp,
    stompWarpMotion,
    createEmitterVisual,
    sampleTimelineTrack,
    primaryProcessTimeline,
    applyProcessTimeline,
    stompAttachWorldMatrix,
  };
})();
