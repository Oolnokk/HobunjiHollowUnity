(() => {
  'use strict';

  // Far scenery lives beyond the gameplay camera's far plane, so ordinary
  // Three.js frustumCulled=true would erase it. Test the four screen-side
  // planes and the near plane instead; only the far plane is exempted.
  // Render-only hide/restore scopes are shared with InstancedMeshViewCull.
  if (window.DistantSceneryViewCull?.installed) return;
  const SCREEN_PLANES = Object.freeze([0, 1, 2, 3, 5]); // Three r128 Frustum: plane 4 is far, plane 5 is near.
  const FRUSTUM_MARGIN = 1.0; // Conservative pixel-edge allowance in world units to avoid popping during camera motion.
  const CAMERA_MOVE_RESET = 0.25; // Wake hidden scenery when the camera changes position appreciably.
  const CAMERA_TURN_DOT = 0.9997; // Wake after about 2.8 degrees of accumulated rotation.
  const PROBES_PER_FRAME = 3; // Small bounded GPU proxy budget across both Western Slope and Northern Cliffs.
  const PROBE_INTERVAL = 8; // Hidden objects are re-probed frequently enough to reappear.
  const CONSECUTIVE_MISSES = 2; // A single delayed negative query never hides distant geometry.
  const BOX_EXPANSION = 0.5; // Conservative occlusion proxy expansion; over-inclusion is safe, over-culling is not.
  const NEVER_RAYCAST = () => {}; // Depth-only GPU proxies never handle gameplay raycasts.

  const states = new Map(); // One cached world AABB, visibility history, and GPU query per static rock/plateau.
  const hidden = []; // Temporarily hidden scenery objects; restored after the synchronous world render.
  const probeSlots = []; // Bounded reusable query meshes; pending query results stay on scenery state.
  const eligible = []; // Reused per-submission candidate list.
  const candidates = []; // Visible-in-frustum rocks and plateau eligible for the async depth probe.
  const stats = {
    frames:0, candidates:0, submitted:0, frustumHidden:0, occludedHidden:0,
    probes:0, results:0, negatives:0, resets:0, pending:0,
    gpuAvailable:false, gpuFailure:null, activeScene:null,
  }; // In-game mobile diagnostics, including the actual number of skipped draw groups.

  let enabled = true; // Controls distant-scenery culling without disabling gameplay or other performance systems.
  let gpuEnabled = true; // Can fall back to frustum-only on WebGL1 or failed WebGL2 queries.
  let frustum = null, matrix = null, cameraEye = null, cameraRotation = null; // Cached camera matrices/vectors; allocated lazily.
  let lastEye = null, lastRotation = null, lastProjection = null; // Stable camera pose used to invalidate stale GPU answers.
  let lastCamera = null, lastScene = null, currentScene = null, currentCamera = null; // Current render scope and context identity.
  let lastGeneration = 0, frame = 0, cursor = 0; // GPU query epochs and rotating candidate scheduling.
  let gl = null, queryTarget = null, queryScene = null, queryGeometry = null, queryMaterial = null; // Shared WebGL2 depth-only proxy resources.

  function setupCamera(camera) {
    const T = window.THREE;
    if (!camera?.projectionMatrix || !camera?.matrixWorldInverse || !T?.Frustum || !T?.Matrix4 || !T?.Box3) return false;
    if (!frustum) {
      frustum = new T.Frustum();
      matrix = new T.Matrix4();
      cameraEye = new T.Vector3();
      cameraRotation = new T.Quaternion();
    }
    camera.updateMatrixWorld?.(true);
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    return true;
  }

  function sceneryRoots(scene) {
    const west = window.WesternSlopeMountainBackdrops?.getActiveRoot?.(); // Existing mountain owner supplies its exact live root.
    const north = window.NorthernCliffsPlateauBackdrop?.getActiveRoot?.(); // Existing Northern Cliffs owner supplies its exact live root.
    const result = []; // At most sixteen mountain rocks or one plateau.
    if (west?.parent === scene && west.visible !== false) for (const layer of west.children || []) {
      if (layer.visible === false) continue;
      for (const rock of layer.children || []) if (rock.visible !== false) {
        result.push({object:rock,revision:west.userData?.cullBoundsRevision||0});
      }
    }
    if (north?.parent === scene && north.visible !== false) for (const mesh of north.children || []) {
      if (mesh.visible !== false) result.push({object:mesh,revision:0});
    }
    return result;
  }

  function stateFor(object, revision) {
    let state = states.get(object);
    if (!state) {
      state = {object,revision:null,bounds:null,seen:0,occluded:false,misses:0,
        pending:null,nextProbe:0}; // World bounds are immutable until the scenery author increments its layout revision.
      states.set(object,state);
    }
    if (!state.bounds || state.revision !== revision) {
      object.updateWorldMatrix?.(true,true);
      state.bounds ||= new window.THREE.Box3(); // The actual snow/stone/outline hierarchy, including authored world transforms.
      state.bounds.setFromObject(object);
      state.revision=revision;
      state.occluded=false; state.misses=0;
      state.nextProbe=0;
      if (state.pending) retirePending(state);
    }
    return state;
  }

  function onScreenWithoutFar(box) {
    if (!box || box.isEmpty?.()) return true; // Missing or invalid bounds must always fail open.
    for (const i of SCREEN_PLANES) {
      const plane = frustum.planes[i], n = plane?.normal;
      if (!n) return true;
      const x = n.x >= 0 ? box.max.x : box.min.x;
      const y = n.y >= 0 ? box.max.y : box.min.y;
      const z = n.z >= 0 ? box.max.z : box.min.z;
      if (n.x*x+n.y*y+n.z*z+plane.constant < -FRUSTUM_MARGIN) return false;
    }
    return true;
  }

  function retirePending(state) {
    if (!state.pending) return;
    try { state.pending.gl?.deleteQuery?.(state.pending.query); } catch (_) {}
    state.pending = null;
  }

  function wakeAll() {
    lastGeneration++;
    stats.resets++;
    for (const state of states.values()) {
      state.occluded=false; state.misses=0;
      // Keep outstanding queries until they resolve or the object unloads;
      // their generation numbers reject stale answers without a GPU stall.
    }
  }

  function poll() {
    if (!gl) return;
    for (const state of states.values()) {
      const p=state.pending;
      if (!p) continue;
      let ready=false;
      try { ready=!!gl.getQueryParameter(p.query,gl.QUERY_RESULT_AVAILABLE); }
      catch (_) { disableGpu('query-poll-failed'); return; }
      if (!ready) continue; // Never block the GPU with an unavailable result.
      let passed=true;
      try { passed=!!gl.getQueryParameter(p.query,gl.QUERY_RESULT); }
      catch (_) { disableGpu('query-result-failed'); return; }
      retirePending(state);
      stats.results++;
      if (p.generation!==lastGeneration || p.revision!==state.revision || p.scene!==currentScene) continue;
      if (passed) {state.misses=0;state.occluded=false;}
      else {
        stats.negatives++;
        if (++state.misses>=CONSECUTIVE_MISSES) state.occluded=true;
      }
    }
  }

  function disableGpu(message) {
    stats.gpuFailure=message;
    stats.gpuAvailable=false;
    gpuEnabled=false;
    wakeAll();
    for (const state of states.values()) retirePending(state);
  }

  function checkCameraPose(scene,camera) {
    const pos=camera.getWorldPosition?.(cameraEye) || camera.position;
    const quat=camera.getWorldQuaternion?.(cameraRotation) || camera.quaternion;
    if (!pos || !quat) { wakeAll(); return; }
    const projection=camera.projectionMatrix?.elements;
    let lensChanged=!lastProjection && !!projection;
    if (lastProjection && projection) for(let i=0;i<16;i++) {
      if (Math.abs(lastProjection[i]-projection[i]) > 1e-5) {lensChanged=true;break;}
    }
    const cameraChanged=lastCamera!==camera||lastScene!==scene||!lastEye||!lastRotation||lensChanged
      ||lastEye.distanceToSquared(pos)>CAMERA_MOVE_RESET*CAMERA_MOVE_RESET
      ||Math.abs(lastRotation.dot(quat))<CAMERA_TURN_DOT;
    if (cameraChanged) {
      wakeAll();
      if (!lastEye) {lastEye=pos.clone();lastRotation=quat.clone();}
      else {lastEye.copy(pos);lastRotation.copy(quat);}
      lastProjection=projection?.slice()||null;
      lastCamera=camera;lastScene=scene;
    }
  }

  function restore() {
    for (const object of hidden) object.visible=true;
    hidden.length=0;
    candidates.length=0;
    currentScene=null;currentCamera=null;
  }

  function suspendForRender(scene,camera) {
    // Restore first even when a previous interrupted render did not reach its finally.
    restore(); // Also clears a previous candidate list after an interrupted render with no hidden meshes.
    if (!enabled || !scene || !camera || !setupCamera(camera)) return null;
    frame++;stats.frames++;stats.candidates=0;stats.submitted=0;
    stats.frustumHidden=0;stats.occludedHidden=0;stats.probes=0;
    currentScene=scene;currentCamera=camera;stats.activeScene=scene.name||'(unnamed)';
    checkCameraPose(scene,camera);
    if (stats.gpuAvailable) poll();
    const chosen=sceneryRoots(scene);
    for (const {object,revision} of chosen) {
      const state=stateFor(object,revision);
      state.seen=frame;
      stats.candidates++;
      if (!onScreenWithoutFar(state.bounds)) {
        object.visible=false;hidden.push(object);
        stats.frustumHidden++;
        continue;
      }
      candidates.push(state);
      if (gpuEnabled&&stats.gpuAvailable&&state.occluded) {
        object.visible=false;hidden.push(object);stats.occludedHidden++;
      } else stats.submitted++;
    }
    // Retire cached objects from unloaded zones without retaining removed meshes/materials.
    for (const [object,state] of states) if (state.seen!==frame) {
      retirePending(state);
      states.delete(object);
    }
    stats.pending=countPending();
    return hidden.length ? restore : (candidates.length ? restore : null);
  }

  function prepareGpu(renderer) {
    if (!gpuEnabled || !renderer?.capabilities?.isWebGL2 || typeof renderer.getContext!=='function') {
      stats.gpuAvailable=false;
      return false;
    }
    const context=renderer.getContext();
    if (!context?.createQuery || !context.beginQuery || !context.endQuery || !context.getQueryParameter) {
      stats.gpuAvailable=false;
      return false;
    }
    if (gl && gl!==context) {
      for (const state of states.values()) retirePending(state);
      wakeAll();
    }
    gl=context;
    queryTarget=gl.ANY_SAMPLES_PASSED_CONSERVATIVE||gl.ANY_SAMPLES_PASSED;
    if (!queryTarget) {stats.gpuAvailable=false;return false;}
    stats.gpuAvailable=true;
    return true;
  }

  function ensureQueryResources() {
    if (queryScene) return true;
    const T=window.THREE;
    if (!T?.Scene || !T?.BoxGeometry || !T?.MeshBasicMaterial || !T?.Mesh) return false;
    if (typeof window.WesternSlopeMountainBackdrops?.keepInFrontOfSky!=='function') return false;
    queryScene=new T.Scene();
    (queryScene.userData||={}).hobunjiOutlineSequenceNeutral=true; // Depth-query proxies never touch world matrices; do not end the outline matrix-reuse sequence.
    queryGeometry=new T.BoxGeometry(1,1,1); // All queries reuse twelve triangles; no additional world geometry is baked.
    queryMaterial=new T.MeshBasicMaterial({
      colorWrite:false,depthWrite:false,depthTest:true,transparent:false,
      side:T.DoubleSide,fog:false,toneMapped:false,
    }); // GPU query only, never draws a pixel or alters the main depth buffer.
    window.WesternSlopeMountainBackdrops.keepInFrontOfSky(queryMaterial);
    return true;
  }

  function proxySlot(index) {
    if (probeSlots[index]) return probeSlots[index];
    const slot={state:null,proxy:new window.THREE.Mesh(queryGeometry,queryMaterial)}; // Slot is bound only during synchronous query rendering.
    const mesh=slot.proxy;
    mesh.name='distant_scenery_occlusion_proxy';
    mesh.frustumCulled=false; // The usual far clip does not apply to backdrop depth shaders.
    mesh.visible=false;
    mesh.castShadow=false;mesh.receiveShadow=false;
    mesh.raycast=NEVER_RAYCAST;
    mesh.onBeforeRender=() => {
      const pending=slot.state?.pending;
      if (!pending || pending.started) return;
      gl.beginQuery(queryTarget,pending.query);
      pending.started=true;
    };
    mesh.onAfterRender=() => {
      const pending=slot.state?.pending;
      if (!pending?.started) return;
      gl.endQuery(queryTarget);
      pending.started=false;
    };
    queryScene.add(mesh);
    probeSlots[index]=slot;
    return slot;
  }

  function probeAfterBase(renderer,camera,scene) {
    camera ||= currentCamera; // The GPU depth slot remains available if actor-only culling was disabled in diagnostics.
    scene ||= currentScene;
    // Called after the normal world base pass (its populated depth is still bound)
    // and before the held/outline replays. Never run a GPU query from the game update.
    if (!enabled || !candidates.length || scene!==currentScene || camera!==currentCamera) return;
    if (!prepareGpu(renderer) || !ensureQueryResources()) return;
    eligible.length=0;
    for(const state of candidates) if(!state.pending && frame>=state.nextProbe) eligible.push(state);
    if (!eligible.length) return;
    const count=Math.min(PROBES_PER_FRAME,eligible.length);
    const previousAutoClear=renderer.autoClear;
    const previousShadows=renderer.shadowMap?.autoUpdate;
    const previousMask=camera.layers?.mask;
    const chosen=[];
    try {
      const start=cursor%eligible.length;cursor+=count;
      const position=camera.getWorldPosition?.(cameraEye)||camera.position; // One live viewpoint for all probes in this synchronous submission.
      for(let i=0;i<count;i++) {
        const state=eligible[(start+i)%eligible.length];
        // A camera inside a gigantic proxy cannot be safely tested by its back-facing faces.
        if (position && state.bounds?.distanceToPoint?.(position)<=BOX_EXPANSION+0.5) {
          state.occluded=false;state.misses=0;state.nextProbe=frame+PROBE_INTERVAL;continue;
        }
        const slot=proxySlot(chosen.length), proxy=slot.proxy, box=state.bounds;
        box.getCenter(proxy.position); // The proxy's existing vectors hold the computed box center and size.
        box.getSize(proxy.scale);
        proxy.scale.set(proxy.scale.x+BOX_EXPANSION*2,proxy.scale.y+BOX_EXPANSION*2,proxy.scale.z+BOX_EXPANSION*2);
        const query=gl.createQuery();
        if (!query) throw Error('create-query-failed');
        state.pending={query,gl,started:false,generation:lastGeneration,revision:state.revision,scene};
        state.nextProbe=frame+PROBE_INTERVAL;
        slot.state=state; proxy.visible=true;
        chosen.push(slot);
      }
      if (!chosen.length) return;
      renderer.autoClear=false;
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate=false;
      camera.layers?.enable?.(0);
      renderer.render(queryScene,camera);
      stats.probes=chosen.length;
      stats.pending=countPending();
    } catch(error) {
      for(const {state} of chosen) if (state.pending?.started) {
        try {gl.endQuery(queryTarget);} catch(_) {}
        state.pending.started=false;
      }
      disableGpu('proxy-render-failed:'+String(error?.message||error));
    } finally {
      for(const slot of chosen) {slot.proxy.visible=false;slot.state=null;}
      eligible.length=0;
      renderer.autoClear=previousAutoClear;
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate=previousShadows;
      if (camera.layers && previousMask!=null) camera.layers.mask=previousMask;
    }
  }

  function reset() {
    restore();wakeAll();
    for(const state of states.values()) {
      retirePending(state);
    }
    states.clear();lastCamera=null;lastScene=null;lastEye=null;lastRotation=null;lastProjection=null;
    stats.pending=0;
  }

  function countPending() { let count=0;for(const state of states.values())if(state.pending)count++;return count; }

  function snapshot() {
    return {...stats,enabled,gpuEnabled,tracked:states.size,
      renderOnly:true,farPlaneExempt:true,consecutiveMisses:CONSECUTIVE_MISSES,
      probeBudget:PROBES_PER_FRAME};
  }

  window.DistantSceneryViewCull=Object.freeze({
    installed:true,suspendForRender,probeAfterBase,reset,snapshot,
    setEnabled(value){enabled=value!==false;reset();return enabled;},
    setGpuEnabled(value){gpuEnabled=value!==false;stats.gpuFailure=null;stats.gpuAvailable=false;reset();return gpuEnabled;},
  });
  window.__distantSceneryCullingDebug=snapshot; // Mobile-safe scene counters without opening DevTools.
})();
