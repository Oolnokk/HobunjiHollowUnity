// Runtime graph for furniture-authored activators and mechanisms.
(() => {
  'use strict';
  const burdenKindLabel = kind => (kind === 'soursap' ? 'Soursap Fruit' : kind === 'keyStatue' ? 'Key Statue' : 'Shattercask');
  const maps = new Map(); // mapId -> { nodes, wiring, bulkRegisteredIds, channelSources }
  const api = window.FurniturePuzzleProperties;
  const DEG = Math.PI / 180;
  let emitterLoopStarted = false; // Keeps furniture emitters and burden-payload validity alive between interactions.
  let standingSurfaceSerial = 0; // Gives each animated support surface its own DynamicSurfaces registration, even across rerolls.

  function graphFor(mapId) {
    const key = String(mapId || '');
    let graph = maps.get(key);
    if (!graph) {
      graph = { nodes:new Map(), wiring:[], bulkRegisteredIds:new Set(), channelSources:new Map() };
      maps.set(key, graph);
    }
    graph.bulkRegisteredIds ||= new Set();
    graph.channelSources ||= new Map();
    return graph;
  }

  function releaseStandingSurface(object) {
    const id = object?.userData?.puzzleStandingSurfaceId; // Registered for this specific object's animated part, not the map's other furniture.
    if (!id) return;
    window.DynamicSurfaces?.remove?.(id);
    object.userData.puzzleStandingSurfaceId = null;
  }

  // Standable moving furniture uses its real rendered top. Raycasting from above also handles tilted/fallen parts
  // without pretending that the bounding box's highest corner is a flat platform.
  function registerStandingSurface(mapId, object) {
    const config = object.userData?.furniturePuzzle?.standingSurface; // Authored metadata opts in; all other furniture is unchanged.
    const part = object.userData?.puzzlePartMeshes?.get?.(config?.partId);
    const DS = window.DynamicSurfaces, Three = window.THREE;
    if (!config || !part || !DS?.registerSurface || !Three?.Box3 || !Three?.Raycaster) return false;
    const box = new Three.Box3(), ray = new Three.Raycaster(); // Reused to sample the animated part without allocating on each support query.
    const origin = new Three.Vector3(), down = new Three.Vector3(0, -1, 0); // Raycast straight down from the surface's moving world bounds.
    const id = 'furniture-puzzle-standing-' + (++standingSurfaceSerial); // Unique identity prevents a replacement from accidentally removing its successor.
    let hitY = null; // The supports predicate resolves the exact height read by topY in the same sampleSupport call.
    const bounds = () => {
      part.updateWorldMatrix?.(true, false);
      box.setFromObject(part);
      return { minX:box.min.x, maxX:box.max.x, minZ:box.min.z, maxZ:box.max.z };
    };
    DS.registerSurface({
      id, scope:String(mapId), priority:12,
      enabled:() => object.visible !== false && part.visible !== false && Number(object.userData?.puzzleProgress) >= config.minProgress,
      bounds,
      supports:(x,z) => {
        hitY = null;
        if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
        bounds();
        if (!Number.isFinite(box.max.y) || x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) return false;
        ray.set(origin.set(x,box.max.y + .2,z), down);
        ray.far = Math.max(1,box.max.y-box.min.y+1);
        const hit = ray.intersectObject(part,true).find(entry=>Number.isFinite(entry.point?.y));
        if (!hit) return false;
        hitY = hit.point.y + config.topOffset;
        return true;
      },
      topY:() => hitY,
    });
    object.userData.puzzleStandingSurfaceId = id;
    return true;
  }

  function initializeNode(mapId, record, object, options = {}) {
    const inheritedPuzzle = object?.userData?.furniturePuzzle;
    const instancePuzzle = record?.puzzle;
    const mergedPuzzle = inheritedPuzzle && instancePuzzle
      ? { ...inheritedPuzzle, ...instancePuzzle, motion:Object.prototype.hasOwnProperty.call(instancePuzzle, 'motion') ? instancePuzzle.motion : inheritedPuzzle.motion }
      : (instancePuzzle || inheritedPuzzle);
    const puzzle = api?.normalizePuzzle(mergedPuzzle);
    if (!object || !puzzle) return null;
    api.applyToObject3D(object, puzzle, record.itemKey || record.key || '');
    const id = String(record.id || object.userData.puzzleInstanceId || object.userData.authoredFurnitureKey || '');
    if (!id) return null;
    object.userData.puzzleInstanceId = id;
    object.userData.puzzleMapId = String(mapId);
    object.userData.puzzleActive = ['burdenPlate','keyStatue'].includes(puzzle.behavior) ? false : puzzle.startsActive;
    object.userData.puzzleRestTransform ||= {
      position:object.position.clone(), quaternion:object.quaternion.clone(), scale:object.scale.clone(),
    };
    object.userData.puzzlePartMeshes = object.userData.meshById || new Map();
    object.userData.puzzleCollision = typeof options.setBlocked === 'function' ? blocked => options.setBlocked(record, blocked) : null;
    object.userData.puzzleMaterials = [];
    object.traverse?.(child => {
      for (const material of (Array.isArray(child.material) ? child.material : [child.material]).filter(Boolean)) {
        object.userData.puzzleMaterials.push({
          material, opacity:Number(material.opacity ?? 1), transparent:!!material.transparent,
          emissive:material.emissive?.clone?.() || null, emissiveIntensity:Number(material.emissiveIntensity ?? 1),
        });
      }
    });
    for (const entry of object.userData.puzzleEmitterVisuals || []) entry.visual.dispose?.();
    object.userData.puzzleEmitterVisuals = (object.userData.authoredParticleEmitters || [])
      .map(emitter => ({ record:emitter, visual:window.AuthoredFurniture?.createEmitterVisual?.(object, emitter) }))
      .filter(entry => entry.visual);
    const linkedLight = object.userData.mapEditorAux?.light;
    object.userData.puzzleLight = linkedLight ? { light:linkedLight, intensity:Number(linkedLight.intensity) || 0 } : null;
    const initialProgress = ['burdenPlate','keyStatue'].includes(puzzle.behavior) ? 0 : puzzle.startsActive ? 1 : 0;
    object.userData.puzzleProgress = Number.isFinite(Number(object.userData.puzzleProgress))
      ? Number(object.userData.puzzleProgress) : initialProgress;
    if (puzzle.behavior === 'burdenPlate') {
      object.userData.burdenPlatePayload ||= null;
      object.userData.burdenPlateAnchor ||= null;
      object.userData.burdenPlateComplete = false;
    }
    if (puzzle.behavior === 'keyStatue') {
      object.userData.keyStatuePayload ||= null;
      object.userData.keyStatueTaken = false;
    }
    window.FurnitureDecalRuntime?.setGlowState?.(object, object.userData.puzzleProgress);
    releaseStandingSurface(object);
    applyMechanism(object, object.userData.puzzleProgress);
    registerStandingSurface(mapId, object);
    return id;
  }

  function registerMap(mapId, records, objectById, wiring, options = {}) {
    const key = String(mapId);
    const graph = graphFor(key);
    for (const id of graph.bulkRegisteredIds) {
      const old = graph.nodes.get(id);
      releaseInputs(old);
      releaseStandingSurface(old);
      if (old?.userData) old.userData.puzzleAnimationRevision = (old.userData.puzzleAnimationRevision || 0) + 1;
      for (const entry of old?.userData?.puzzleEmitterVisuals || []) entry.visual.dispose?.();
      graph.nodes.delete(id);
    }
    graph.bulkRegisteredIds.clear();
    for (const record of records || []) {
      const id = String(record.id || '');
      const object = objectById.get(id);
      const previous = graph.nodes.get(id); // Bulk registration can replace a separately registered instance as well.
      if (previous && previous !== object) {
        releaseInputs(previous);
        releaseStandingSurface(previous);
        previous.userData.puzzleAnimationRevision = (previous.userData.puzzleAnimationRevision || 0) + 1;
        for (const entry of previous.userData.puzzleEmitterVisuals || []) entry.visual.dispose?.();
      }
      const initializedId = initializeNode(key, record, object, options);
      if (!initializedId) continue;
      graph.nodes.set(initializedId, object);
      graph.bulkRegisteredIds.add(initializedId);
      bindInputs(key, initializedId, object);
    }
    graph.wiring = api?.normalizeWiring(wiring) || [];
    maps.set(key, graph); // Individually registered furniture nodes survive bulk interior-door registration.
    for (const [channel, sources] of graph.channelSources) syncChannel(key, channel, sources.size > 0);
    startEmitterLoop();
    return graph.nodes.size;
  }

  function registerNode(mapId, record, object, options = {}) {
    const key = String(mapId);
    const graph = graphFor(key);
    const id = initializeNode(key, record, object, options);
    if (!id) return false;
    const previous = graph.nodes.get(id); // A replacement node must not retain the old object's event subscriptions.
    if (previous && previous !== object) {
      releaseInputs(previous);
      releaseStandingSurface(previous);
      previous.userData.puzzleAnimationRevision = (previous.userData.puzzleAnimationRevision || 0) + 1;
      for (const entry of previous.userData?.puzzleEmitterVisuals || []) entry.visual.dispose?.();
      previous.userData.puzzleEmitterVisuals = [];
    }
    graph.nodes.set(id, object);
    bindInputs(key, id, object);
    if (object.userData.furniturePuzzle?.role === 'mechanism') {
      const sources = graph.channelSources.get(String(object.userData.furniturePuzzle.channel || 'A'));
      if (sources?.size) {
        object.userData.puzzleActive = true;
        animate(object, 1);
      }
    }
    startEmitterLoop();
    return true;
  }

  function unregisterNode(mapId, idOrObject) {
    const graph = maps.get(String(mapId));
    if (!graph) return false;
    for (const [id, object] of graph.nodes) {
      if (id !== String(idOrObject) && object !== idOrObject) continue;
      if (object.userData.furniturePuzzle?.behavior === 'burdenPlate') {
        const puzzle = object.userData.furniturePuzzle;
        setChannelSource(mapId, puzzle.channel, 'burden:' + id + ':placement', false);
        setChannelSource(mapId, puzzle.completionChannel, 'burden:' + id + ':completion', false);
      }
      if (object.userData.furniturePuzzle?.behavior === 'keyStatue')
        window.KeyStatues?.unregisterDispenser?.(mapId,id);
      if (object.userData.furniturePuzzle?.behavior === 'witchBombDispenser')
        window.HronalWitchBombs?.unregisterDispenser?.(mapId,id);
      releaseInputs(object);
      releaseStandingSurface(object);
      object.userData.puzzleAnimationRevision = (object.userData.puzzleAnimationRevision || 0) + 1;
      for (const entry of object.userData.puzzleEmitterVisuals || []) entry.visual.dispose?.();
      graph.nodes.delete(id);
      graph.bulkRegisteredIds.delete(id);
      return true;
    }
    return false;
  }

  // A generated ruin's map ID is reused on rerolls. Tear down one complete puzzle graph so its
  // event listeners, delayed animations and animated support surfaces cannot leak into the new map.
  function clearMap(mapId) {
    const key = String(mapId), graph = maps.get(key); // Scope shared by furniture nodes and their event listeners.
    if (!graph) return 0;
    const ids = [...graph.nodes.keys()]; // Snapshot because unregisterNode deletes entries as it cleans them up.
    for (const id of ids) unregisterNode(key, id);
    maps.delete(key);
    return ids.length;
  }

  // ── Event inputs (puzzle.inputs) ─────────────────────────────────────────
  // A node subscribes to WorldEvents (scoped to its map) and acts when an event matches its
  // conditions, with no activator wire needed: a cracked pillar that falls when a blast reaches it,
  // a door that opens when struck. Mechanisms run setMechanism; activators run activate (so their
  // wired mechanisms follow). Subscriptions are released when the node is unregistered or replaced.
  let inputScratch = null;
  function nodePoint(object) {
    inputScratch ||= (window.THREE?.Vector3 ? new window.THREE.Vector3() : { x:0, y:0, z:0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
    object.updateWorldMatrix?.(true, false);
    return object.getWorldPosition ? object.getWorldPosition(inputScratch) : inputScratch.set(object.position.x, object.position.y, object.position.z);
  }
  function releaseInputs(object) {
    const subs = object?.userData?.puzzleInputUnsubs;
    if (subs) for (const off of subs) off();
    if (object?.userData) object.userData.puzzleInputUnsubs = null;
  }
  function inputMatches(input, payload, id, object) {
    if (input.tag && String(payload.tag || '') !== input.tag) return false;
    if (input.targetId && String(payload.targetId || '') !== (input.targetId === 'self' ? id : input.targetId)) return false;
    const limit = input.withinTiles ?? (Number.isFinite(Number(payload.radius)) ? Number(payload.radius) : null);
    if (limit != null) {
      if (!Number.isFinite(Number(payload.x)) || !Number.isFinite(Number(payload.z))) return false; // A distance condition needs a located event.
      const p = nodePoint(object);
      if (Math.hypot(p.x - Number(payload.x), p.z - Number(payload.z)) > limit) return false;
    }
    return true;
  }
  function runInput(mapId, id, object, input) {
    const role = object.userData.furniturePuzzle?.role;
    const apply = () => {
      // Delayed signals can outlive a removed node or a rerolled ruin with the same map/id.
      if (maps.get(String(mapId))?.nodes.get(id) !== object) return false;
      const target = input.action === 'toggle' ? !object.userData.puzzleActive : input.action === 'on';
      return role === 'mechanism' ? setMechanism(mapId, id, target) : activate(mapId, id, target);
    };
    if (input.delaySeconds > 0) setTimeout(apply, input.delaySeconds * 1000); else apply();
  }
  function bindInputs(mapId, id, object) {
    releaseInputs(object); // Re-registering the same node never stacks duplicate listeners.
    const inputs = object?.userData?.furniturePuzzle?.inputs;
    if (!inputs?.length || !window.WorldEvents) return 0;
    const subs = object.userData.puzzleInputUnsubs = [];
    for (const input of inputs) {
      let off = () => {};
      off = window.WorldEvents.on(input.event, payload => {
        if (!inputMatches(input, payload, id, object)) return;
        if (input.once) off();
        runInput(mapId, id, object, input);
      }, { scope: String(mapId) });
      subs.push(() => off());
    }
    return subs.length;
  }

  function applyMechanism(object, progress) {
    const puzzle = object?.userData?.furniturePuzzle;
    const rest = object?.userData?.puzzleRestTransform;
    const animatedActivator = puzzle?.role === 'activator' && ['burdenPlate','keyStatue'].includes(puzzle.behavior);
    if (!object || !puzzle || (puzzle.role !== 'mechanism' && !animatedActivator) || !rest) return;
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    const off = puzzle.motion.off, on = puzzle.motion.on;
    object.position.copy(rest.position).add(new THREE.Vector3(
      THREE.MathUtils.lerp(off.position.x, on.position.x, t),
      THREE.MathUtils.lerp(off.position.y, on.position.y, t),
      THREE.MathUtils.lerp(off.position.z, on.position.z, t)));
    const rotation = new THREE.Euler(
      THREE.MathUtils.lerp(off.rotation.x, on.rotation.x, t) * DEG,
      THREE.MathUtils.lerp(off.rotation.y, on.rotation.y, t) * DEG,
      THREE.MathUtils.lerp(off.rotation.z, on.rotation.z, t) * DEG, 'XYZ');
    object.quaternion.copy(rest.quaternion).multiply(new THREE.Quaternion().setFromEuler(rotation));
    object.scale.copy(rest.scale).multiply(new THREE.Vector3(
      THREE.MathUtils.lerp(off.scale.x, on.scale.x, t),
      THREE.MathUtils.lerp(off.scale.y, on.scale.y, t),
      THREE.MathUtils.lerp(off.scale.z, on.scale.z, t)));
    for (const [partId, states] of Object.entries(puzzle.motion.parts || {})) {
      const mesh = object.userData.puzzlePartMeshes?.get?.(partId);
      const part = object.userData.partById?.get?.(partId), base = part?.transform;
      if (!mesh || !base) continue;
      const a = states.off, b = states.on;
      mesh.position.set(THREE.MathUtils.lerp(a.x,b.x,t), THREE.MathUtils.lerp(a.y,b.y,t), THREE.MathUtils.lerp(a.z,b.z,t));
      mesh.rotation.set(THREE.MathUtils.lerp(a.rx,b.rx,t)*DEG, THREE.MathUtils.lerp(a.ry,b.ry,t)*DEG, THREE.MathUtils.lerp(a.rz,b.rz,t)*DEG, 'XYZ');
      mesh.scale.set(
        THREE.MathUtils.lerp(a.sx,b.sx,t)/Math.max(.001,Number(base.sx)||.001),
        THREE.MathUtils.lerp(a.sy,b.sy,t)/Math.max(.001,Number(base.sy)||.001),
        THREE.MathUtils.lerp(a.sz,b.sz,t)/Math.max(.001,Number(base.sz)||.001));
      for (const anchor of object.userData.payloadAttachmentAnchors?.values?.() || []) {
        if (anchor.parent !== mesh) continue;
        anchor.scale.set(
          1 / Math.max(.001, Math.abs(mesh.scale.x)),
          1 / Math.max(.001, Math.abs(mesh.scale.y)),
          1 / Math.max(.001, Math.abs(mesh.scale.z))); // Keep the payload rigid while the attachment point follows the animated part.
      }
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
    object.userData.puzzleProgress = t;
    if (puzzle.role === 'mechanism' && puzzle.behavior === 'witchBombDispenser') {
      if (t >= .999 && !object.userData.witchBombDispenseRequested) {
        object.userData.witchBombDispenseRequested = true; // One dispense request per OFF→ON activation; the dispenser itself enforces its live-payload lock.
        window.HronalWitchBombs?.dispenseFromMechanism?.(object);
      } else if (t <= .001) object.userData.witchBombDispenseRequested = false;
    }
    window.FurnitureDecalRuntime?.setGlowState?.(object, t);
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
      for (const [mapId, graph] of maps) for (const [id, object] of graph.nodes) {
        if (object.userData.furniturePuzzle?.behavior === 'burdenPlate' && object.userData.burdenPlatePayload) {
          const payload = object.userData.burdenPlatePayload;
          const anchor = object.userData.burdenPlateAnchor;
          if (payload.exploded || !payload.group || payload.group.parent !== anchor) cancelBurdenPlate(mapId, id);
        }
        const rateScale = Number(object.userData.puzzleEmission?.particleRateScale) || 0;
        for (const entry of object.userData.puzzleEmitterVisuals || []) entry.visual.update(dt, rateScale > 0, { rate:(Number(entry.record.rate) || 0) * rateScale });
        window.FurnitureDecalRuntime?.updateGlow?.(object, now);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function animate(object, target, durationSeconds = null, onComplete = null) {
    const puzzle = object?.userData?.furniturePuzzle;
    if (!object || !puzzle) return false;
    const from = Math.max(0, Math.min(1, Number(object.userData.puzzleProgress) || 0));
    const seconds = durationSeconds == null ? puzzle.motion.durationSeconds : Math.max(0, Number(durationSeconds) || 0);
    const duration = seconds * 1000;
    const started = performance.now();
    const revision = (object.userData.puzzleAnimationRevision || 0) + 1;
    object.userData.puzzleAnimationRevision = revision;
    if (duration <= 0 || Math.abs(from - target) < .00001) {
      applyMechanism(object, target);
      onComplete?.();
      return true;
    }
    function frame(now) {
      if (object.userData.puzzleAnimationRevision !== revision) return;
      const t = Math.min(1, Math.max(0, (now - started) / duration));
      applyMechanism(object, from + (target - from) * (t * t * (3 - 2 * t)));
      if (t < 1) requestAnimationFrame(frame);
      else onComplete?.();
    }
    requestAnimationFrame(frame);
    return true;
  }

  function syncChannel(mapId, channel, active) {
    const graph = maps.get(String(mapId));
    if (!graph || !channel) return false;
    for (const mechanism of graph.nodes.values()) {
      const puzzle = mechanism.userData.furniturePuzzle;
      if (puzzle?.role !== 'mechanism' || String(puzzle.channel || 'A') !== String(channel)) continue;
      const target = active ? 1 : 0;
      if (mechanism.userData.puzzleActive === !!active
        && Math.abs((Number(mechanism.userData.puzzleProgress) || 0) - target) < .001) continue;
      mechanism.userData.puzzleActive = !!active;
      animate(mechanism, target);
    }
    return true;
  }

  function setChannelSource(mapId, channel, sourceId, active) {
    const key = String(mapId), name = String(channel || '').trim();
    if (!name) return false;
    const graph = graphFor(key);
    let sources = graph.channelSources.get(name);
    if (!sources) graph.channelSources.set(name, sources = new Set());
    if (active) sources.add(String(sourceId));
    else sources.delete(String(sourceId));
    if (!sources.size) graph.channelSources.delete(name);
    syncChannel(key, name, sources.size > 0);
    return true;
  }

  function activate(mapId, activatorId, active = true) {
    const graph = maps.get(String(mapId));
    const activator = graph?.nodes.get(String(activatorId));
    if (!graph || activator?.userData?.furniturePuzzle?.role !== 'activator') return false;
    activator.userData.puzzleActive = !!active;
    window.FurnitureDecalRuntime?.setGlowState?.(activator, active ? 1 : 0);
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
    mechanism.userData.puzzleActive = !!active;
    animate(mechanism, active ? 1 : 0);
    return true;
  }

  function toggleMechanism(mapId, mechanismId) {
    const mechanism = maps.get(String(mapId))?.nodes.get(String(mechanismId));
    return setMechanism(mapId, mechanismId, !mechanism?.userData?.puzzleActive);
  }

  function burdenPlateButtons(mapId, id) {
    const object = maps.get(String(mapId))?.nodes.get(String(id));
    const puzzle = object?.userData?.furniturePuzzle;
    if (puzzle?.role !== 'activator' || puzzle.behavior !== 'burdenPlate') return [];
    const payload = object.userData.burdenPlatePayload;
    const anchor = object.userData.burdenPlateAnchor;
    const inserted = !!payload && !payload.exploded && !!payload.group && payload.group.parent === anchor;
    const held = window.Shattercasks?.heldBurdenInfo?.() || null;
    const label = inserted ? 'Retrieve Burden'
      : held?.kind === puzzle.requiredBurdenKind ? 'Insert ' + held.displayName
      : 'Requires ' + burdenKindLabel(puzzle.requiredBurdenKind);
    return [{ icon:inserted ? '↗' : '⬇', label, action:'obj_burden_plate_' + id, style:'primary', allowed:true }];
  }

  function setBurdenPlateOutputs(mapId, id, puzzle, placed, complete) {
    setChannelSource(mapId, puzzle.channel, 'burden:' + id + ':placement', placed);
    setChannelSource(mapId, puzzle.completionChannel, 'burden:' + id + ':completion', complete);
  }

  function cancelBurdenPlate(mapId, id) {
    const object = maps.get(String(mapId))?.nodes.get(String(id));
    const puzzle = object?.userData?.furniturePuzzle;
    if (puzzle?.behavior !== 'burdenPlate') return false;
    const progress = Math.max(0, Math.min(1, Number(object.userData.puzzleProgress) || 0));
    setBurdenPlateOutputs(mapId, id, puzzle, false, false);
    object.userData.burdenPlatePayload = null;
    object.userData.burdenPlateComplete = false;
    object.userData.puzzleActive = false;
    const reverseSeconds = Math.max(0, Number(puzzle.motion.reversalSeconds) || 0) * progress;
    animate(object, 0, reverseSeconds);
    return true;
  }

  function interactBurdenPlate(mapId, id, action) {
    const object = maps.get(String(mapId))?.nodes.get(String(id));
    const puzzle = object?.userData?.furniturePuzzle;
    if (puzzle?.role !== 'activator' || puzzle.behavior !== 'burdenPlate')
      return { ok:false, message:'That plinth is not responsive.' };
    if (action && action !== 'obj_burden_plate_' + id)
      return { ok:false, message:'Unknown plinth action.' };
    const existing = object.userData.burdenPlatePayload;
    const anchor = object.userData.burdenPlateAnchor;
    if (existing && !existing.exploded && existing.group?.parent === anchor) {
      if (!window.Shattercasks?.retrievePlacedBurden?.(existing, anchor))
        return { ok:false, message:'Stow the item you are carrying before retrieving this Burden.' };
      cancelBurdenPlate(mapId, id);
      return { ok:true, message:'Retrieved ' + (existing.displayName || 'the Burden') + '.' };
    }
    if (existing) {
      cancelBurdenPlate(mapId, id);
      return { ok:false, message:'The previous payload was removed; the plinth is returning to OFF.' };
    }
    const held = window.Shattercasks?.heldBurdenInfo?.();
    if (!held) return { ok:false, message:'You must be carrying a Burden to operate this plinth.' };
    if (held.kind !== puzzle.requiredBurdenKind) {
      const required = burdenKindLabel(puzzle.requiredBurdenKind);
      return { ok:false, message:'This plinth requires a ' + required + '.' };
    }
    const attachment = window.AuthoredFurniture?.createSurfaceAnchor?.(object, puzzle.payloadSurfaceId, .012);
    if (!attachment) return { ok:false, message:'The plinth has no valid Payload Attachment Surface.' };
    const payload = window.Shattercasks?.placeHeldBurdenOnSurface?.(attachment, puzzle.payloadSurfaceId);
    if (!payload) return { ok:false, message:'The carried Burden could not be attached.' };
    object.userData.burdenPlateAnchor = attachment;
    object.userData.burdenPlatePayload = payload;
    object.userData.burdenPlateComplete = false;
    object.userData.puzzleActive = true;
    setBurdenPlateOutputs(mapId, id, puzzle, true, false);
    animate(object, 1, puzzle.motion.durationSeconds, () => {
      const stillAttached = object.userData.burdenPlatePayload === payload
        && !payload.exploded && payload.group?.parent === attachment;
      if (!stillAttached) { cancelBurdenPlate(mapId, id); return; }
      object.userData.burdenPlateComplete = true;
      setBurdenPlateOutputs(mapId, id, puzzle, true, true);
    });
    return { ok:true, message:(payload.displayName || 'The Burden') + ' is seated on the plinth.' };
  }

  function keyStatueButtons(mapId, id) {
    const object = maps.get(String(mapId))?.nodes.get(String(id));
    if (object?.userData?.furniturePuzzle?.role !== 'activator'
      || object.userData.furniturePuzzle.behavior !== 'keyStatue') return [];
    const payload = object.userData.keyStatuePayload;
    const ready = !!payload && !payload.exploded && !!payload.group?.parent;
    return [{ icon:'🗿', label:ready ? 'Take Key Statue' : 'The Key Statue is returning',
      action:'obj_key_statue_'+id, style:'primary', allowed:ready }];
  }

  function interactKeyStatue(mapId, id, action) {
    const object = maps.get(String(mapId))?.nodes.get(String(id));
    if (object?.userData?.furniturePuzzle?.role !== 'activator'
      || object.userData.furniturePuzzle.behavior !== 'keyStatue')
      return {ok:false,message:'That statue mount is not responsive.'};
    if (action && action !== 'obj_key_statue_'+id) return {ok:false,message:'Unknown Key Statue action.'};
    const payload = object.userData.keyStatuePayload;
    if (!payload || payload.exploded || !payload.group?.parent)
      return {ok:false,message:'The Key Statue is being restored.'};
    if (!window.Shattercasks?.pickUp?.(payload))
      return {ok:false,message:'Stow the item you are carrying before taking the Key Statue.'};
    return {ok:true,message:'You lift the Key Statue from its mount.'};
  }

  function setKeyStatueTaken(mapId, id, taken) {
    const object = maps.get(String(mapId))?.nodes.get(String(id));
    const puzzle = object?.userData?.furniturePuzzle;
    if (puzzle?.role !== 'activator' || puzzle.behavior !== 'keyStatue') return false;
    object.userData.keyStatueTaken = !!taken;
    object.userData.puzzleActive = !!taken;
    activate(mapId, id, !!taken); // Key Statues remain ordinary wired activators as well as their own animated dispenser.
    return animate(object, taken ? 1 : 0, puzzle.motion.durationSeconds);
  }

  function debug() {
    return [...maps].map(([mapId, graph]) => ({
      mapId, wires:graph.wiring.length,
      channels:[...graph.channelSources].map(([channel,sources])=>({channel,sources:sources.size})),
      nodes:[...graph.nodes].map(([id, object]) => ({
        id, role:object.userData.furniturePuzzle?.role, behavior:object.userData.furniturePuzzle?.behavior,
        active:!!object.userData.puzzleActive, progress:Number(object.userData.puzzleProgress) || 0,
        inputs:object.userData.furniturePuzzle?.inputs?.length || 0,
        blocked:!!object.userData.blocksMovement, standingSurface:object.userData.puzzleStandingSurfaceId || null,
        payload:object.userData.burdenPlatePayload?.id || null,
        payloadComplete:!!object.userData.burdenPlateComplete,
        keyStatueTaken:!!object.userData.keyStatueTaken,
      })),
    }));
  }

  const getNode = (mapId, id) => maps.get(String(mapId))?.nodes.get(String(id)) || null;

  window.FurniturePuzzleRuntime = Object.freeze({
    getNode, registerMap, registerNode, unregisterNode, clearMap, activate, toggle, setMechanism, toggleMechanism,
    setChannelSource, burdenPlateButtons, interactBurdenPlate, keyStatueButtons, interactKeyStatue, setKeyStatueTaken, applyMechanism, debug,
  });
})();
