(() => {
  'use strict';

  // Renderer-only culling: gameplay ownership of NPC and hostile rigs never changes.
  // A generously sized whole-actor frustum keeps behind-camera character rigs out
  // of every world/outline/x-ray pass. WebGL2 async occlusion queries additionally
  // reject fully covered character rigs. No synchronous readPixels/GPU wait.
  const THREE = window.THREE; // Shared Three.js version used by game.js.
  const ALWAYS_DRAW_TILES = 5; // Nearby actors, interaction partners and their shadows stay visible.
  const FRUSTUM_RADIUS_TILES = 4.25; // Covers oversized humanoid rigs, raised arms and held weapons.
  const CAMERA_RESET_DISTANCE = 0.6; // Camera changes invalidate old occlusion, never hide a newly revealed actor.
  const CAMERA_RESET_DOT = 0.997; // About nine degrees: a significant view rotation wakes all actors.
  const ACTOR_RESET_DISTANCE = 0.4; // Moving NPCs immediately invalidate stale hidden results.
  const MAX_QUERY_PER_FRAME = 8; // Bound added GPU draws even during a large Tzizkhanash crowd.
  const MIN_HIDDEN_RESULTS = 2; // Two separate missing-sample results are required to hide an actor.
  const PROBE_INTERVAL_FRAMES = 3; // Spread expensive probes across render frames, including hidden actors.
  const PROBE_WIDTH_TILES = 4.5; // Conservative tile-space bound includes hands, feet and held tool arcs.
  const PROBE_HEIGHT_TILES = 7; // Includes tall Longoran rig poses while standing or sitting.
  const PROBE_DEPTH_TILES = 4.5; // Deliberately oversized: false visibility is safe; false occlusion is not.

  const states = new Map(); // Actor root -> short-lived occlusion history and its own GPU query lifecycle.
  const active = []; // Scratch list of roots belonging to the current rendered area.
  const hidden = []; // Roots temporarily hidden from rendering, restored before gameplay resumes.
  const stats = { frames:0, candidates:0, frustumHidden:0, occludedHidden:0,
    visible:0, probes:0, results:0, discarded:0, pending:0, gpuAvailable:false, disabledReason:'' };
  const sphere = THREE ? new THREE.Sphere(new THREE.Vector3(), FRUSTUM_RADIUS_TILES) : null; // Reused camera-volume test.
  const frustum = THREE ? new THREE.Frustum() : null; // Shared frustum for all actors in a frame.
  const viewMatrix = THREE ? new THREE.Matrix4() : null; // Camera projection * inverse-world matrix.
  const scene = THREE ? new THREE.Scene() : null; // Tiny isolated proxy scene, never added to gameplay world.
  const geometry = THREE ? new THREE.BoxGeometry(1, 1, 1) : null; // A single shared conservative query cuboid.
  const material = THREE ? new THREE.MeshBasicMaterial({
    colorWrite:false, depthWrite:false, depthTest:true, transparent:false,
    side:THREE.DoubleSide, fog:false, toneMapped:false
  }) : null; // Depth-tested only: no pixels, stencil writes or z-buffer modifications.

  let enabled = true; // Dev/mobile override without requiring browser console.
  let gpuEnabled = true; // GPU occlusion can be disabled while retaining cheap frustum culling.
  let gl = null; // WebGL2 context for non-blocking occlusion queries.
  let target = null; // WebGL2 ANY_SAMPLES_PASSED_CONSERVATIVE token.
  let currentScene = null; // Active scene supplied by game.js before main render.
  let currentCamera = null; // Camera for the current render, never saved across area changes.
  let currentRenderer = null; // Current renderer used for the actual _mainRT depth buffer.
  let currentArea = ''; // Area boundary invalidates all prior visibility decisions.
  let currentViewValid = false; // True only after the shared camera frustum has been rebuilt.
  let lastCamPos = null; // Stored previous viewpoint for conservative query-history invalidation.
  let lastCamQuat = null; // Stored previous orientation for immediate turn-around wakeup.
  let lastArea = ''; // Cached area identity, used to drop results from other maps.
  let queryDisabled = false; // Fail-open if context/query calls do not work.
  let generation = 0; // Increments after any significant camera/area change.
  let cursor = 0; // Fair round-robin offset so distant NPCs never starve.

  function inScene(root, expected) {
    for (let node = root; node; node = node.parent) if (node === expected) return true;
    return false;
  } // Skip detached NPCs and residents attached to an inactive interior scene.

  function release(state) {
    if (state.pending && gl) {
      try { gl.deleteQuery(state.pending.query); } catch (_) { /* Context may already be gone. */ }
    }
    state.pending = null;
    if (state.proxy) {
      scene?.remove(state.proxy); // Disposal only retires this actor; shared geometry/material stay alive.
      state.proxy.onBeforeRender = null;
      state.proxy.onAfterRender = null;
      state.proxy = null;
    }
  }

  function clearHistory() {
    generation++;
    for (const state of states.values()) { state.occluded = false; state.misses = 0; }
  } // Camera changes wake all entities before the next frame can use stale hidden results.

  function getState(root) {
    let state = states.get(root);
    if (!state) {
      state = { root, pending:null, proxy:null, occluded:false, misses:0,
        x:root.position.x, y:root.position.y, z:root.position.z, nextProbeFrame:0, seen:stats.frames };
      states.set(root, state);
    }
    return state;
  }

  function supportsQueries(renderer) {
    if (!gpuEnabled || queryDisabled || !renderer?.capabilities?.isWebGL2) return false;
    const context = renderer.getContext?.();
    if (!context || typeof context.createQuery !== 'function'
        || typeof context.beginQuery !== 'function'
        || typeof context.getQueryParameter !== 'function'
        || typeof context.endQuery !== 'function') return false;
    if (gl && gl !== context) {
      for (const state of states.values()) release(state); // Previous context cannot own this renderer's queries.
      clearHistory();
    }
    gl = context;
    target = gl.ANY_SAMPLES_PASSED_CONSERVATIVE || gl.ANY_SAMPLES_PASSED;
    return !!target;
  }

  function pollQueries() {
    if (!gl || queryDisabled) return;
    for (const state of states.values()) {
      const pending = state.pending;
      if (!pending) continue;
      let ready = false;
      try { ready = !!gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE); }
      catch (_) { disableGpu('query-result-error'); return; }
      if (!ready) continue;
      let passed = true;
      try { passed = !!gl.getQueryParameter(pending.query, gl.QUERY_RESULT); }
      catch (_) { disableGpu('query-result-error'); return; }
      try { gl.deleteQuery(pending.query); } catch (_) { /* Harmless after context loss. */ }
      state.pending = null;
      stats.results++;
      // Query results are only authoritative for the view, area and actor
      // position at submission; stale negatives must never make actors vanish.
      if (pending.generation !== generation
          || Math.hypot(state.root.position.x-pending.x, state.root.position.y-pending.y,
            state.root.position.z-pending.z) > ACTOR_RESET_DISTANCE) {
        stats.discarded++;
        continue;
      }
      if (passed) { state.misses = 0; state.occluded = false; }
      else if (++state.misses >= MIN_HIDDEN_RESULTS) state.occluded = true;
    }
  }

  function disableGpu(reason) {
    queryDisabled = true;
    stats.disabledReason = reason;
    for (const state of states.values()) { release(state); state.occluded = false; state.misses = 0; }
  } // Any WebGL failure restores full rendering automatically, never a blank town.

  function makeProxy(state) {
    const proxy = new THREE.Mesh(geometry, material); // Created at most once per actor, not per frame.
    proxy.name = 'actor_occlusion_query_proxy';
    proxy.frustumCulled = false; // Our conservative character frustum has already chosen candidates.
    proxy.visible = false;
    proxy.onBeforeRender = function () {
      const pending = state.pending;
      if (!pending || !gl || queryDisabled) return;
      gl.beginQuery(target, pending.query);
      pending.started = true;
    };
    proxy.onAfterRender = function () {
      const pending = state.pending;
      if (!pending?.started || !gl) return;
      gl.endQuery(target);
      pending.started = false;
    };
    scene.add(proxy);
    state.proxy = proxy;
    return proxy;
  }

  function addActor(root, area, activeScene, playerPosition, canOcclude) {
    if (!root?.isObject3D || root.visible !== true || !inScene(root, activeScene)) return;
    const state = getState(root);
    state.seen = stats.frames;
    const p = root.position; // Top-level NPC/hostile roots use world tile coordinates.
    if (Math.hypot(p.x-state.x, p.y-state.y, p.z-state.z) > ACTOR_RESET_DISTANCE) {
      state.occluded = false; state.misses = 0;
    }
    state.x = p.x; state.y = p.y; state.z = p.z;
    const dx = p.x-playerPosition.x, dz = p.z-playerPosition.z;
    const nearby = dx*dx + dz*dz <= ALWAYS_DRAW_TILES*ALWAYS_DRAW_TILES;
    let outside = false;
    if (!nearby && currentViewValid) {
      sphere.center.set(p.x, p.y+1, p.z);
      outside = !frustum.intersectsSphere(sphere);
    }
    stats.candidates++;
    if (outside) {
      hidden.push(root);
      root.visible = false; // Rendering only: restored in endFrame before any gameplay update.
      stats.frustumHidden++;
      return;
    }
    active.push({state, queryAllowed:canOcclude && !nearby});
    if (canOcclude && !nearby && state.occluded && stats.gpuAvailable) {
      hidden.push(root);
      root.visible = false;
      stats.occludedHidden++;
    } else stats.visible++;
  }

  function beginFrame(args) {
    endFrame(); // Unwind any interrupted previous render before touching roots again.
    stats.frames++; stats.candidates=0; stats.frustumHidden=0; stats.occludedHidden=0;
    stats.visible=0; stats.probes=0; stats.pending=0;
    if (!enabled || !THREE || !args?.camera || !args.scene) return;
    const {renderer,camera,scene:activeScene,walkers,hostiles,playerPosition,area} = args;
    currentRenderer=renderer; currentCamera=camera; currentScene=activeScene; currentArea=area||'';
    stats.gpuAvailable = supportsQueries(renderer);
    camera.updateMatrixWorld?.(true);
    viewMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewMatrix);
    currentViewValid=true;
    const pos=camera.position,quat=camera.quaternion;
    const changed = lastArea!==currentArea || !lastCamPos
      || lastCamPos.distanceToSquared(pos) > CAMERA_RESET_DISTANCE*CAMERA_RESET_DISTANCE
      || Math.abs(lastCamQuat.dot(quat)) < CAMERA_RESET_DOT;
    if (changed) clearHistory();
    if (!lastCamPos) {lastCamPos=pos.clone();lastCamQuat=quat.clone();}
    else {lastCamPos.copy(pos);lastCamQuat.copy(quat);}
    lastArea=currentArea;
    pollQueries();
    const player = playerPosition || {x:pos.x,z:pos.z};
    for (const w of walkers||[]) {
      if (w.area===currentArea && !w.combatTutorialSuspended)
        addActor(w.root,w.area,activeScene,player,true);
    }
    for (const c of hostiles||[]) {
      if (c.areaId!==currentArea || !(c.health>0) || c._denHidden || c.tzatzulCapturedBy) continue;
      // Humanoid combatants have a bounded character-scale rig. Huge wild
      // monsters/flying creatures retain the old renderer to avoid bad bounds.
      if (!c.isBandit && !c.isTribeHunter) continue;
      const combat = c.state==='chase' || c.state==='attacking' || c.state==='attack'
        || c.state==='searching' || c.combatTutorialTarget || c.maskboundTroop;
      addActor(c.avatarRef?.group,c.areaId,activeScene,player,!combat);
    }
    for (const [root,state] of states) if (state.seen!==stats.frames) {
      release(state);
      states.delete(root); // No retained references to transferred/despawned actors.
    }
    for (const state of states.values()) if (state.pending) stats.pending++;
  }

  function probeAfterBase() {
    if (!enabled || !stats.gpuAvailable || !currentRenderer || !currentCamera || !currentScene || !active.length) return;
    const candidates=active.filter(x=>x.queryAllowed && !x.state.pending && stats.frames >= x.state.nextProbeFrame);
    if (!candidates.length) return;
    const count=Math.min(MAX_QUERY_PER_FRAME,candidates.length);
    const previousAutoClear=currentRenderer.autoClear;
    const previousShadows=currentRenderer.shadowMap?.autoUpdate;
    const previousMask=currentCamera.layers.mask;
    const chosen=[]; // Only selected probes are visible during this single scene submission.
    let started = false;
    try {
      // Fairly rotate which NPCs are tested first across low-FPS frames.
      const start=cursor%candidates.length;cursor+=count;
      for(let i=0;i<count;i++) {
        const state=candidates[(start+i)%candidates.length].state;
        const q=gl.createQuery();
        if (!q) throw Error('create-query-failed');
        const proxy=state.proxy || makeProxy(state);
        const p=state.root.position;
        proxy.position.set(p.x,p.y+1,p.z);
        proxy.scale.set(PROBE_WIDTH_TILES,PROBE_HEIGHT_TILES,PROBE_DEPTH_TILES);
        proxy.visible=true; chosen.push(state);
        state.pending={query:q,started:false,generation,x:p.x,y:p.y,z:p.z};
        state.nextProbeFrame=stats.frames+PROBE_INTERVAL_FRAMES;
      }
      currentRenderer.autoClear=false; // Preserve the main scene's opaque depth and color.
      if (currentRenderer.shadowMap) currentRenderer.shadowMap.autoUpdate=false;
      currentCamera.layers.enable(0);
      started=true;
      currentRenderer.render(scene,currentCamera); // One lightweight proxy render, not one render per NPC.
      stats.probes=chosen.length;
    } catch (_) {
      disableGpu('query-pass-failed'); // Fail open and keep the scene fully visible.
    } finally {
      for(const state of chosen) if (state.proxy) state.proxy.visible=false;
      currentCamera.layers.mask=previousMask;
      currentRenderer.autoClear=previousAutoClear;
      if (currentRenderer.shadowMap) currentRenderer.shadowMap.autoUpdate=previousShadows;
      if (!started) stats.probes=0;
    }
  }

  function endFrame() {
    for (const root of hidden) root.visible=true; // Restore logical visibility after ALL world render passes.
    hidden.length=0;
    active.length=0;
    currentScene=null;currentCamera=null;currentRenderer=null;currentViewValid=false;
  }

  function reset() {
    endFrame();
    for(const state of states.values()) release(state);
    states.clear(); lastCamPos=null; lastCamQuat=null; lastArea=''; clearHistory();
  }

  function snapshot() {
    return { ...stats, tracked:states.size, enabled, gpuEnabled, gpuError:queryDisabled,
      queriesPending:[...states.values()].filter(s=>s.pending).length };
  }

  window.ActorRenderOcclusion=Object.freeze({
    beginFrame,probeAfterBase,endFrame,snapshot,
    reset,
    setEnabled(value){enabled=value!==false;if(!enabled)reset();return enabled;},
    setGpuEnabled(value){gpuEnabled=value!==false;reset();return gpuEnabled;},
  });
})();