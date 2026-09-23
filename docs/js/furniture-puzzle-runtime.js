// Runtime graph for furniture-authored activators and mechanisms.
(() => {
  'use strict';
  const maps = new Map(); // mapId -> { nodes: Map(instance id -> Object3D), wiring }
  const api = window.FurniturePuzzleProperties;
  const DEG = Math.PI / 180;
  let emitterLoopStarted = false; // Used to keep ON-state furniture emitters alive after a transform lerp finishes.

  function registerMap(mapId, records, objectById, wiring, options = {}) {
    const previous = maps.get(String(mapId)); // Live-layout rebuilds replace a cached interior; dispose its particle visuals before rebinding IDs.
    for (const object of previous?.nodes?.values?.() || []) for (const entry of object.userData.puzzleEmitterVisuals || []) entry.visual.dispose?.();
    const nodes = new Map();
    for (const record of records || []) {
      const object = objectById.get(String(record.id || ''));
      const inheritedPuzzle = object?.userData?.furniturePuzzle; // Authored furniture supplies the reusable transition; map records may override only selected instance fields.
      const instancePuzzle = record?.puzzle;
      const mergedPuzzle = inheritedPuzzle && instancePuzzle
        ? { ...inheritedPuzzle, ...instancePuzzle, motion:Object.prototype.hasOwnProperty.call(instancePuzzle, 'motion') ? instancePuzzle.motion : inheritedPuzzle.motion }
        : (instancePuzzle || inheritedPuzzle);
      const puzzle = api?.normalizePuzzle(mergedPuzzle);
      if (!object || !puzzle) continue;
      api.applyToObject3D(object, puzzle, record.itemKey || record.key || '');
      object.userData.puzzleInstanceId = String(record.id);
      object.userData.puzzleActive = puzzle.startsActive;
      object.userData.puzzleRestTransform = { position:object.position.clone(), quaternion:object.quaternion.clone(), scale:object.scale.clone() };
      object.userData.puzzlePartMeshes = object.userData.meshById || new Map(); // Authored part IDs let a single mechanism interpolate several rigid pieces independently.
      object.userData.puzzleCollision = typeof options.setBlocked === 'function' ? blocked => options.setBlocked(record, blocked) : null;
      object.userData.puzzleMaterials = [];
      object.traverse?.(child => {
        for (const material of (Array.isArray(child.material) ? child.material : [child.material]).filter(Boolean)) {
          object.userData.puzzleMaterials.push({ material, opacity:Number(material.opacity ?? 1), transparent:!!material.transparent, emissive:material.emissive?.clone?.() || null, emissiveIntensity:Number(material.emissiveIntensity ?? 1) });
        }
      });
      object.userData.puzzleEmitterVisuals = (object.userData.authoredParticleEmitters || []).map(record => ({ record, visual:window.AuthoredFurniture?.createEmitterVisual?.(object, record) })).filter(entry => entry.visual);
      const linkedLight = object.userData.mapEditorAux?.light; // Interior lamps use the same OFF/ON emission intensity as materials and particle emitters.
      object.userData.puzzleLight = linkedLight ? { light:linkedLight, intensity:Number(linkedLight.intensity) || 0 } : null;
      nodes.set(String(record.id), object);
      applyMechanism(object, puzzle.startsActive ? 1 : 0);
    }
    maps.set(String(mapId), { nodes, wiring:api?.normalizeWiring(wiring) || [] });
    startEmitterLoop();
    return nodes.size;
  }

  function applyMechanism(object, progress) {
    const puzzle = object?.userData?.furniturePuzzle;
    const rest = object?.userData?.puzzleRestTransform;
    if (!object || !puzzle || puzzle.role !== 'mechanism' || !rest) return;
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    const off = puzzle.motion.off, on = puzzle.motion.on;
    object.position.copy(rest.position).add(new THREE.Vector3(
      THREE.MathUtils.lerp(off.position.x, on.position.x, t), THREE.MathUtils.lerp(off.position.y, on.position.y, t), THREE.MathUtils.lerp(off.position.z, on.position.z, t)));
    const rotation = new THREE.Euler(
      THREE.MathUtils.lerp(off.rotation.x, on.rotation.x, t) * DEG,
      THREE.MathUtils.lerp(off.rotation.y, on.rotation.y, t) * DEG,
      THREE.MathUtils.lerp(off.rotation.z, on.rotation.z, t) * DEG, 'XYZ');
    object.quaternion.copy(rest.quaternion).multiply(new THREE.Quaternion().setFromEuler(rotation));
    object.scale.copy(rest.scale).multiply(new THREE.Vector3(
      THREE.MathUtils.lerp(off.scale.x, on.scale.x, t), THREE.MathUtils.lerp(off.scale.y, on.scale.y, t), THREE.MathUtils.lerp(off.scale.z, on.scale.z, t)));
    for (const [partId, states] of Object.entries(puzzle.motion.parts || {})) {
      const mesh = object.userData.puzzlePartMeshes?.get?.(partId), part = object.userData.partById?.get?.(partId), base = part?.transform;
      if (!mesh || !base) continue;
      const a = states.off, b = states.on;
      mesh.position.set(THREE.MathUtils.lerp(a.x,b.x,t), THREE.MathUtils.lerp(a.y,b.y,t), THREE.MathUtils.lerp(a.z,b.z,t));
      mesh.rotation.set(THREE.MathUtils.lerp(a.rx,b.rx,t)*DEG, THREE.MathUtils.lerp(a.ry,b.ry,t)*DEG, THREE.MathUtils.lerp(a.rz,b.rz,t)*DEG, 'XYZ');
      mesh.scale.set(
        THREE.MathUtils.lerp(a.sx,b.sx,t)/Math.max(.001,Number(base.sx)||.001),
        THREE.MathUtils.lerp(a.sy,b.sy,t)/Math.max(.001,Number(base.sy)||.001),
        THREE.MathUtils.lerp(a.sz,b.sz,t)/Math.max(.001,Number(base.sz)||.001));
      mesh.updateMatrixWorld(true);
    }
    const emission = {
      color:new THREE.Color(off.emission.color).lerp(new THREE.Color(on.emission.color), t),
      intensity:THREE.MathUtils.lerp(off.emission.intensity, on.emission.intensity, t),
      particleRateScale:THREE.MathUtils.lerp(off.emission.particleRateScale, on.emission.particleRateScale, t),
      opacity:THREE.MathUtils.lerp(off.emission.opacity, on.emission.opacity, t),
    };
    for (const entry of object.userData.puzzleMaterials || []) {
      if (entry.material.emissive) entry.material.emissive.copy(emission.color);
      if ('emissiveIntensity' in entry.material) entry.material.emissiveIntensity = emission.intensity;
      entry.material.opacity = entry.opacity * emission.opacity;
      entry.material.transparent = entry.transparent || emission.opacity < .999;
      entry.material.needsUpdate = true;
    }
    object.userData.puzzleEmission = emission;
    if (object.userData.puzzleLight) object.userData.puzzleLight.light.intensity = object.userData.puzzleLight.intensity * emission.intensity;
    object.userData.puzzleProgress = progress;
    const blocked = puzzle.blocksMovement && t < puzzle.motion.collisionOpenProgress;
    object.userData.blocksMovement = blocked;
    object.userData.puzzleCollision?.(blocked);
  }

  function startEmitterLoop() {
    if (emitterLoopStarted) return;
    emitterLoopStarted = true;
    let last = performance.now();
    function tick(now) {
      const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
      for (const graph of maps.values()) for (const object of graph.nodes.values()) {
        const rateScale = Number(object.userData.puzzleEmission?.particleRateScale) || 0;
        for (const entry of object.userData.puzzleEmitterVisuals || []) entry.visual.update(dt, rateScale > 0, { rate:(Number(entry.record.rate) || 0) * rateScale });
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function animate(object, target) {
    const puzzle = object.userData.furniturePuzzle;
    const from = Number(object.userData.puzzleProgress) || 0;
    const started = performance.now(), duration = Math.max(50, puzzle.motion.durationSeconds * 1000);
    const revision = (object.userData.puzzleAnimationRevision || 0) + 1; // Rapid re-toggles cancel the older lerp instead of letting two RAF callbacks fight over one transform.
    object.userData.puzzleAnimationRevision = revision;
    function frame(now) {
      if (object.userData.puzzleAnimationRevision !== revision) return;
      const t = Math.min(1, (now - started) / duration);
      applyMechanism(object, from + (target - from) * (t * t * (3 - 2 * t)));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function activate(mapId, activatorId, active = true) {
    const graph = maps.get(String(mapId));
    const activator = graph?.nodes.get(String(activatorId));
    if (!graph || activator?.userData?.furniturePuzzle?.role !== 'activator') return false;
    activator.userData.puzzleActive = !!active;
    for (const wire of graph.wiring.filter(record => record.fromId === String(activatorId))) {
      const mechanism = graph.nodes.get(wire.toId);
      if (!mechanism) continue;
      const target = wire.invert ? !active : !!active;
      const run = () => { mechanism.userData.puzzleActive = target; animate(mechanism, target ? 1 : 0); };
      wire.delaySeconds > 0 ? setTimeout(run, wire.delaySeconds * 1000) : run();
    }
    return true;
  }

  function toggle(mapId, activatorId) {
    const node = maps.get(String(mapId))?.nodes.get(String(activatorId));
    return activate(mapId, activatorId, !node?.userData?.puzzleActive);
  }

  function setMechanism(mapId, mechanismId, active) {
    const mechanism = maps.get(String(mapId))?.nodes.get(String(mechanismId));
    if (mechanism?.userData?.furniturePuzzle?.role !== 'mechanism') return false;
    mechanism.userData.puzzleActive = !!active; animate(mechanism, active ? 1 : 0); return true;
  }

  function toggleMechanism(mapId, mechanismId) {
    const mechanism = maps.get(String(mapId))?.nodes.get(String(mechanismId));
    return setMechanism(mapId, mechanismId, !mechanism?.userData?.puzzleActive);
  }

  function debug() {
    return [...maps].map(([mapId, graph]) => ({
      mapId, wires:graph.wiring.length,
      nodes:[...graph.nodes].map(([id, object]) => ({ id, role:object.userData.furniturePuzzle?.role, behavior:object.userData.furniturePuzzle?.behavior, active:!!object.userData.puzzleActive, progress:Number(object.userData.puzzleProgress) || 0, blocked:!!object.userData.blocksMovement })),
    }));
  }
  window.FurniturePuzzleRuntime = Object.freeze({ registerMap, activate, toggle, setMechanism, toggleMechanism, applyMechanism, debug });
})();
