// Procedural Animation Editor: connect the reusable Manual IK author to the
// Ground / Rest preset system without replacing either subsystem.
//
// Ground / Rest keeps owning the preset pose first. This bridge runs one layer
// later in the render chain, so draggable hand/elbow/foot/knee targets override
// only the limbs the author is editing while the preset still owns the body.
(function (global) {
  'use strict';

  if (global.ProceduralGroundRestManualBridge?.installed) return;

  const PANEL_ID = 'proceduralGroundRestPanel'; // Ground / Rest panel that receives manual-author controls.
  const STATE_ID = 'groundRestManualState'; // Mobile-visible live-state readout for manual IK diagnostics.
  const START_ID = 'limbManualStart'; // Existing Manual IK history helper keys off this button id.
  const STOP_ID = 'limbManualStop'; // Stops manual ownership and returns the selected preset to full control.
  const COPY_ID = 'limbManualCopy'; // Copies the current manual target payload for authoring/debug use.
  const GUIDE_ROOT_NAME = 'ProceduralGroundRestNativeGuides'; // Preset guide root doubles as the exact seed source.
  const DOWN = Object.freeze({ x: 0, y: -1, z: 0 }); // Hand orientation axis shared with the Ground / Rest solver.

  const state = { // Mutable bridge state shared by the render hook, UI, and Manual IK host callbacks.
    THREE: null,
    manual: null,
    manualModel: null,
    renderer: null,
    priorRender: null,
    renderHookInstalled: false,
    uiObserver: null,
    poseApiWrapped: false,
    activePose: 'normal',
    selectedHandle: null,
    debug: { installed: true, active: false, ownership: 'preset' },
  };

  let resolveReady; // Resolves once the bridge owns a renderer layer ahead of Ground / Rest.
  const readyPromise = new Promise(resolve => { resolveReady = resolve; }); // Loader awaits this to guarantee render-hook ordering.

  function editorLog(message, level = 'info', extra = null) {
    const logger = global.HobunjiGameplayBackdrop?.log; // Canonical editor Diagnostics logger, visible on mobile.
    if (logger) { logger(message, level, extra); return; }
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'; // Console fallback before Diagnostics exists.
    console[method]?.(message, extra ?? '');
  }

  function currentModel() {
    return global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
  }

  function locomotionRootFor(model = currentModel()) {
    return model?.parent?.parent?.parent || null;
  }

  function guideLine(side, limb) {
    const root = locomotionRootFor()?.getObjectByName?.(GUIDE_ROOT_NAME) || null; // Current Ground / Rest guide root in locomotion space.
    return root?.getObjectByName?.(`${side}_${limb}_ground_rest_guide`) || null;
  }

  function guidePoint(side, limb, index) {
    const attr = guideLine(side, limb)?.geometry?.attributes?.position; // Preset-authored three-point chain used to seed exact manual targets.
    if (!attr || attr.count <= index || !state.THREE) return null;
    return new state.THREE.Vector3(attr.getX(index), attr.getY(index), attr.getZ(index));
  }

  function currentAnchors() {
    const leftShoulder = guidePoint('left', 'arm', 0); // Exact live shoulder after the preset body transform.
    const rightShoulder = guidePoint('right', 'arm', 0); // Exact live shoulder after the preset body transform.
    const leftHip = guidePoint('left', 'leg', 0); // Exact live hip after the preset body transform.
    const rightHip = guidePoint('right', 'leg', 0); // Exact live hip after the preset body transform.
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;
    return {
      shoulders: { left: leftShoulder, right: rightShoulder },
      hips: { left: leftHip, right: rightHip },
    };
  }

  function feetRoot(model = currentModel()) {
    const locomotionRoot = locomotionRootFor(model); // Parent that owns the editor's ExperimentalFeet assembly.
    if (!locomotionRoot || !model) return null;
    return locomotionRoot.getObjectByName?.(`${model.name || 'Avatar'}_ExperimentalFeet`)
      || locomotionRoot.children?.find?.(child => /_ExperimentalFeet$/.test(String(child.name || '')))
      || null;
  }

  function nativeFoot(side) {
    const model = currentModel(); // Avatar whose existing ExperimentalFeet node manual IK must move.
    const root = feetRoot(model); // Coordinate parent used to convert manual locomotion targets into native foot-local positions.
    if (!model || !root) return null;
    return root.getObjectByName?.(`${model.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Foot`)
      || root.children?.find?.(child => new RegExp(`${side}Foot$`, 'i').test(String(child.name || '')))
      || null;
  }

  function nativeHand(side) {
    const model = currentModel(); // Avatar whose existing authored hand wrapper manual IK must move.
    if (!model) return null;
    return model.getObjectByName?.(`${model.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Hand`) || null;
  }

  function locomotionToLocal(point, object) {
    const root = locomotionRootFor(); // Source coordinate root for all Manual IK handles and solves.
    if (!root || !object || !point) return null;
    const out = point.clone(); // Converted point returned in the target object's local coordinate system.
    root.updateWorldMatrix?.(true, false);
    root.localToWorld(out);
    object.updateWorldMatrix?.(true, false);
    object.worldToLocal(out);
    return out;
  }

  function localToLocomotion(point, object) {
    const root = locomotionRootFor(); // Destination coordinate root used by Manual IK handles and solves.
    if (!root || !object || !point) return null;
    const out = point.clone(); // Converted point returned in locomotion-root coordinates.
    object.updateWorldMatrix?.(true, false);
    object.localToWorld(out);
    root.updateWorldMatrix?.(true, false);
    root.worldToLocal(out);
    return out;
  }

  function currentFootPoint(side) {
    return guidePoint(side, 'leg', 2) || (() => {
      const foot = nativeFoot(side); // Existing foot node used only when a Ground / Rest guide has not populated yet.
      const root = feetRoot(); // Foot-local parent used for conversion to locomotion space.
      return foot && root ? localToLocomotion(foot.position, root) : null;
    })();
  }

  function solveManualChain(root, target, joint) {
    return global.LegBones?.solveSubdividedChain?.(state.THREE, { root, target, joint }) || null;
  }

  function updateGuide(side, limb, rootPoint, solved) {
    const attr = guideLine(side, limb)?.geometry?.attributes?.position; // Existing Ground / Rest guide geometry updated to follow manual handles.
    if (!attr || !solved) return;
    attr.setXYZ(0, rootPoint.x, rootPoint.y, rootPoint.z);
    attr.setXYZ(1, solved.joint.x, solved.joint.y, solved.joint.z);
    attr.setXYZ(2, solved.solvedTarget.x, solved.solvedTarget.y, solved.solvedTarget.z);
    attr.needsUpdate = true;
  }

  function applyManualArm(side, _shoulder, solved) {
    const model = currentModel(); // Hand wrapper's local coordinate owner.
    const hand = nativeHand(side); // Existing authored hand wrapper to preserve rather than create a duplicate hand.
    if (!model || !hand || !solved || !state.THREE) return;
    const endpoint = locomotionToLocal(solved.solvedTarget, model); // Manual endpoint converted from locomotion space into model-local hand coordinates.
    const joint = locomotionToLocal(solved.joint, model); // Manual elbow converted into model-local coordinates for forearm direction.
    if (!endpoint || !joint) return;
    hand.position.copy(endpoint);
    const forearm = endpoint.clone().sub(joint); // Direction used to orient the existing hand along the authored forearm.
    if (forearm.lengthSq() > 1e-10) {
      hand.quaternion.setFromUnitVectors(new state.THREE.Vector3(DOWN.x, DOWN.y, DOWN.z), forearm.normalize());
    }
  }

  function applyManualLeg(side, _hip, solved) {
    const foot = nativeFoot(side); // Existing ExperimentalFeet child receiving the manual target.
    const root = feetRoot(); // Foot-local coordinate parent used for target conversion.
    if (!foot || !root || !solved) return;
    const endpoint = locomotionToLocal(solved.solvedTarget, root); // Manual locomotion target converted into ExperimentalFeet local coordinates.
    if (endpoint) foot.position.copy(endpoint);
  }

  function seedFromPreset() {
    const sides = {}; // Seed payload passed to Manual IK so activating edit mode does not visibly jump the preset.
    for (const side of ['left', 'right']) {
      const hand = guidePoint(side, 'arm', 2); // Current preset hand target in locomotion space.
      const elbow = guidePoint(side, 'arm', 1); // Current preset virtual elbow in locomotion space.
      const foot = guidePoint(side, 'leg', 2); // Current preset foot target in locomotion space.
      const knee = guidePoint(side, 'leg', 1); // Current preset virtual knee in locomotion space.
      sides[side] = {
        hand: hand ? { x: hand.x, y: hand.y, z: hand.z } : null,
        elbow: elbow ? { x: elbow.x, y: elbow.y, z: elbow.z } : null,
        foot: foot ? { x: foot.x, y: foot.y, z: foot.z } : null,
        knee: knee ? { x: knee.x, y: knee.y, z: knee.z } : null,
      };
    }
    return { schema: 'hobunji-manual-limb-ik.v1', sides };
  }

  function setState(partial) {
    state.debug = { ...state.debug, ...partial }; // Latest bridge state displayed in the Ground / Rest panel.
    const pre = document.getElementById(STATE_ID); // Mobile-visible live-state pane; canonical logs remain in editor Diagnostics.
    if (pre) pre.textContent = JSON.stringify(state.debug, null, 2);
  }

  function disposeManual(reason = 'disposed') {
    const manual = state.manual; // Existing controller must be torn down before another avatar's locomotion root is captured.
    if (manual) {
      try { manual.dispose?.(); }
      catch (error) { editorLog(`[Ground / Rest manual] Dispose failed: ${error?.message || error}`, 'warn'); }
    }
    state.manual = null;
    state.manualModel = null;
    setState({ active: false, ownership: 'preset', stopReason: reason, selectedHandle: null, dragging: false });
    syncUi();
  }

  function copyManualJson() {
    const payload = state.manual?.snapshot?.() || null; // Current authored handle positions copied for debugging/reuse.
    if (!payload) return false;
    const text = JSON.stringify(payload, null, 2); // Human-readable payload sent to clipboard.
    navigator.clipboard?.writeText?.(text).then(
      () => editorLog('[Ground / Rest manual] Copied Manual IK JSON.', 'info'),
      error => editorLog(`[Ground / Rest manual] Clipboard failed: ${error?.message || error}`, 'warn')
    );
    return true;
  }

  async function ensureManual() {
    const model = currentModel(); // Current avatar determines whether the captured Manual IK locomotion root is still valid.
    if (state.manual && state.manualModel === model) return state.manual;
    if (state.manual) disposeManual('avatar-changed');
    const api = global.HobunjiGameplayBackdrop; // Public editor host supplying scene/camera/renderer/model access.
    const locomotionRoot = locomotionRootFor(model); // Parent coordinate space shared by Ground / Rest guides and handles.
    if (!api?.getScene?.() || !api?.getCamera?.() || !api?.getRenderer?.() || !locomotionRoot || !state.THREE) {
      throw new Error('Ground / Rest Manual IK host is not ready.');
    }
    state.manual = await global.ProceduralLimbManualAuthor.create({
      THREE: state.THREE,
      getScene: () => api.getScene?.(),
      getCamera: () => api.getCamera?.(),
      getRenderer: () => api.getRenderer?.(),
      getLocomotionRoot: () => locomotionRootFor(),
      getCurrentAnchors: currentAnchors,
      getLiveFoot: currentFootPoint,
      getModelHeight: () => Number(currentModel()?.userData?.portraitModelHeight) || Number(currentModel()?.userData?.gameModelHeight) || 0.9,
      solveManualArm: (_side, shoulder, hand, elbow) => solveManualChain(shoulder, hand, elbow),
      solveManualLeg: (_side, hip, foot, knee) => solveManualChain(hip, foot, knee),
      applyManualArm,
      applyManualLeg,
      drawManualSide: (side, shoulder, arm, hip, leg) => {
        updateGuide(side, 'arm', shoulder, arm);
        updateGuide(side, 'leg', hip, leg);
      },
      setHandsVisible: visible => {
        for (const side of ['left', 'right']) {
          const hand = nativeHand(side); // Existing hand wrapper toggled only when Manual IK explicitly asks for visibility.
          if (hand) hand.visible = Boolean(visible);
        }
      },
      setGuidesVisible: visible => {
        const root = locomotionRootFor()?.getObjectByName?.(GUIDE_ROOT_NAME); // Ground / Rest guide root visibility follows Manual IK authoring mode.
        if (root) root.visible = Boolean(visible);
      },
      onSelection: key => {
        state.selectedHandle = key; // Selected handle shown in the mobile-visible state pane.
        setState({ selectedHandle: key });
      },
      onDraggingChanged: dragging => setState({ dragging: Boolean(dragging) }),
      onHistoryChanged: history => setState({ history }),
      onDebug: debug => setState({ ...debug, pose: state.activePose }),
    });
    state.manualModel = model;
    return state.manual;
  }

  async function startManual() {
    if (state.activePose === 'normal') {
      editorLog('[Ground / Rest manual] Select a Ground / Rest pose before editing limbs.', 'warn');
      return false;
    }
    const manual = await ensureManual(); // Reusable Manual IK controller bound to the current editor host.
    if (manual.active) manual.stop();
    const anchors = currentAnchors(); // Validates that the selected preset has rendered at least one frame and produced exact guide anchors.
    if (!anchors) throw new Error('Ground / Rest preset anchors are not ready yet.');
    await manual.start(seedFromPreset());
    setState({ active: true, ownership: 'preset body → manual limbs', pose: state.activePose });
    editorLog(`[Ground / Rest manual] Editing ${state.activePose}; preset seeded all eight limb targets.`, 'info');
    syncUi();
    return true;
  }

  function stopManual(reason = 'stopped') {
    if (state.manual?.active) state.manual.stop();
    setState({ active: false, ownership: 'preset', stopReason: reason, selectedHandle: null, dragging: false });
    syncUi();
    return true;
  }

  function syncUi() {
    const start = document.getElementById(START_ID); // Start/reseed button reflects current manual ownership.
    const stop = document.getElementById(STOP_ID); // Stop button is only useful while Manual IK owns limbs.
    if (start) start.textContent = state.manual?.active ? 'Reseed limbs' : 'Edit limbs';
    if (stop) stop.disabled = !state.manual?.active;
  }

  function installPanelControls() {
    const panel = document.getElementById(PANEL_ID); // Existing Ground / Rest panel to augment in place.
    if (!panel || document.getElementById(START_ID)) return Boolean(panel);
    const row = document.createElement('div'); // Manual IK action row reused by the module's automatic Undo/Redo button placement.
    row.className = 'limbPoseActions';
    row.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;margin-top:8px';
    row.innerHTML = `<button id="${START_ID}" type="button" class="secondary">Edit limbs</button><button id="${STOP_ID}" type="button" class="secondary" disabled>Stop edits</button><button id="${COPY_ID}" type="button" class="secondary">Copy IK JSON</button>`;
    const debug = document.createElement('pre'); // Separate live-state pane keeps Manual IK status visible without polluting copyable Diagnostics.
    debug.id = STATE_ID;
    debug.setAttribute('aria-label', 'Ground / Rest Manual IK live state; not a debug log');
    debug.textContent = JSON.stringify(state.debug, null, 2);
    const note = document.createElement('div'); // Clarifies the distinction between live state and canonical Diagnostics for mobile debugging.
    note.className = 'muted small';
    note.textContent = 'Manual IK · live state only, not the copyable Diagnostics log';
    const groundDebug = document.getElementById('groundRestDebug'); // Existing preset-state pane used as the insertion anchor.
    if (groundDebug) {
      panel.insertBefore(row, groundDebug);
      panel.insertBefore(note, groundDebug);
      panel.insertBefore(debug, groundDebug);
    } else {
      panel.append(row, note, debug);
    }
    document.getElementById(START_ID)?.addEventListener('click', () => startManual().catch(error => {
      setState({ error: String(error?.message || error) });
      editorLog(`[Ground / Rest manual] ${error?.stack || error}`, 'error');
    }));
    document.getElementById(STOP_ID)?.addEventListener('click', () => stopManual('user'));
    document.getElementById(COPY_ID)?.addEventListener('click', copyManualJson);
    syncUi();
    return true;
  }

  function wrapPoseApi() {
    const api = global.HobunjiProceduralLimbPoseAuthor; // Public Ground / Rest API wrapped so changing presets safely releases manual ownership.
    if (!api?.setPose || api.__manualBridgeWrapped) return Boolean(api?.setPose);
    const originalSetPose = api.setPose.bind(api); // Original preset selector retained under the bridge wrapper.
    const originalResetPose = typeof api.resetPose === 'function' ? api.resetPose.bind(api) : null; // Carry and other callers use this direct reset path.
    api.setPose = async function manualAwareSetPose(pose, options) {
      if (state.manual?.active) stopManual('pose-changed');
      const result = await originalSetPose(pose, options); // Ground / Rest remains authoritative for body/preset selection.
      state.activePose = result || 'normal';
      setState({ pose: state.activePose, active: false, ownership: 'preset' });
      syncUi();
      return result;
    };
    if (originalResetPose) {
      api.resetPose = async function manualAwareResetPose(options) {
        if (state.manual?.active) stopManual('pose-reset');
        const result = await originalResetPose(options); // Original reset remains authoritative for restoring body/feet/hands.
        state.activePose = 'normal';
        setState({ pose: 'normal', active: false, ownership: 'preset', stopReason: 'pose-reset' });
        syncUi();
        return result;
      };
    }
    api.__manualBridgeWrapped = true;
    state.poseApiWrapped = true;
    return true;
  }

  function installUiObserver() {
    if (state.uiObserver) return;
    state.uiObserver = new MutationObserver(() => {
      installPanelControls();
      wrapPoseApi();
    });
    state.uiObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function installRenderHook() {
    if (state.renderHookInstalled) return true;
    const renderer = global.HobunjiGameplayBackdrop?.getRenderer?.(); // Renderer hook must be installed before Ground / Rest wraps the same method.
    if (!renderer?.render) return false;
    state.renderer = renderer;
    state.priorRender = renderer.render.bind(renderer); // Original renderer called after Manual IK gets its final-frame override.
    renderer.render = function proceduralGroundRestManualRender(scene, camera) {
      if (state.manual?.active && state.manualModel !== currentModel()) {
        disposeManual('avatar-changed');
        editorLog('[Ground / Rest manual] Avatar changed; released stale Manual IK handles before rendering the new avatar.', 'info');
      }
      if (state.manual?.active && !state.manual.released) {
        try { state.manual.update(); }
        catch (error) {
          setState({ error: String(error?.message || error), active: false });
          editorLog(`[Ground / Rest manual] Render update failed: ${error?.stack || error}`, 'error');
          stopManual('render-error');
        }
      }
      return state.priorRender(scene, camera);
    };
    state.renderHookInstalled = true;
    resolveReady?.(true);
    editorLog('[Ground / Rest manual] Final-frame Manual IK layer installed before Ground / Rest preset layer.', 'info');
    return true;
  }

  async function bootstrap() {
    try {
      const modules = await global.PNGPlaneAvatar?.loadThreeModules?.(); // Canonical editor Three.js instance shared with Ground / Rest and handles.
      state.THREE = modules?.THREE || global.THREE || null;
    } catch (error) {
      editorLog(`[Ground / Rest manual] Could not resolve Three.js: ${error?.message || error}`, 'error');
    }
    installUiObserver();
    let attempts = 0; // Limits renderer-host polling if the editor fails to initialize entirely.
    function frame() {
      installPanelControls();
      wrapPoseApi();
      if (installRenderHook()) return;
      if (attempts++ < 2400) requestAnimationFrame(frame);
      else {
        resolveReady?.(false);
        editorLog('[Ground / Rest manual] Timed out waiting for renderer host.', 'error');
      }
    }
    requestAnimationFrame(frame);
  }

  global.ProceduralGroundRestManualBridge = {
    installed: true,
    whenRenderHookReady: () => readyPromise,
    startManual,
    stopManual,
    getDebug: () => ({
      ...state.debug,
      renderHookInstalled: state.renderHookInstalled,
      poseApiWrapped: state.poseApiWrapped,
      manualModelMatchesAvatar: !state.manual || state.manualModel === currentModel(),
    }),
  };

  bootstrap();
})(window);
