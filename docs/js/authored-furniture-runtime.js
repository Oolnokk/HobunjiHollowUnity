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
    const meshById = new Map();
    for (const part of data.parts) {
      const mesh = window.ProceduralFurniture.buildPartMesh(part, baseColor);
      mesh.userData.authoredPartId = part.id;
      mesh.userData.authoredMatrix = new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale);
      group.add(mesh);
      meshById.set(part.id, mesh);
    }
    group.userData.meshById = meshById;
    return group;
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

  // Volume-weighted centroid of the warped parts' current (pre-warp) world
  // bounds — matches calculatedPartGroupCentroid so the pivot the scale/
  // rotate happens around lines up with what the tool previews.
  function _warpCentroid(meshes) {
    let total = 0;
    const sum = new THREE.Vector3();
    const box = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3();
    for (const mesh of meshes) {
      box.setFromObject(mesh);
      box.getSize(size);
      box.getCenter(center);
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
    const meshes = warp.partIds.map((id) => meshById.get(id)).filter(Boolean);
    if (!meshes.length) return;
    const center = _warpCentroid(meshes);
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
    for (const id of warp.partIds) {
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

    function update(dt, active) {
      const rate = active && emitter.enabled !== false ? (emitter.rate || 0) : 0;
      if (rate > 0 && particles.length < cap) {
        spawnAccum += dt * rate;
        while (spawnAccum >= 1 && particles.length < cap) {
          spawnAccum -= 1;
          const spread = emitter.spread || 0.05, radius = emitter.radius || 0, speed = emitter.speed || 0.5;
          const jr = Math.random() * radius, ja = Math.random() * Math.PI * 2;
          particles.push({
            age: 0, life: Math.max(0.05, emitter.lifetime || 0.6),
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
        p.vy -= (emitter.gravity || 0) * dt;
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
  };
})();
