// Reusable manual IK handle layer for the Procedural Animation Editor.
// Owns viewport handles, TransformControls, drag history, and release/resume.
// The host remains authoritative for avatar rendering, limb application, and physics.
(function (global) {
  'use strict';

  if (global.ProceduralLimbManualAuthor) return;

  const HISTORY_LIMIT = 100;

  function finitePoint(value) {
    return value && [value.x, value.y, value.z].every(component => Number.isFinite(Number(component)));
  }

  async function loadTransformControls(THREE) {
    if (typeof THREE?.TransformControls === 'function') return THREE.TransformControls;
    const configured = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.threeModuleUrl || 'https://esm.sh/three@0.128.0';
    const version = configured.match(/three@([0-9.]+)/)?.[1] || '0.128.0';
    const module = await import(`https://esm.sh/three@${version}/examples/jsm/controls/TransformControls.js?deps=three@${version}`);
    return module.TransformControls;
  }

  async function create(host = {}) {
    const THREE = host.THREE;
    if (!THREE) throw new Error('ProceduralLimbManualAuthor.create requires host.THREE.');
    const scene = host.getScene?.();
    const camera = host.getCamera?.();
    const renderer = host.getRenderer?.();
    const locomotionRoot = host.getLocomotionRoot?.();
    if (!scene || !camera || !renderer?.domElement || !locomotionRoot) {
      throw new Error('Manual IK requires scene, camera, renderer, and locomotion root.');
    }

    const TransformControls = await loadTransformControls(THREE);
    const state = {
      active: false,
      released: false,
      handlesRoot: null,
      handles: {},
      control: null,
      selectedKey: null,
      pointerHandler: null,
      keyHandler: null,
      seed: null,
      lastSolve: null,
      cameraLock: null,
      cameraLockFrame: 0,
      history: [],
      historyIndex: -1,
      applyingHistory: false,
      undoButton: null,
      redoButton: null,
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function makeMaterial(kind) {
      const colors = { hand: 0xffd166, elbow: 0x6ba9ff, foot: 0x70e1a1, knee: 0xc89bff };
      return new THREE.MeshBasicMaterial({
        color: colors[kind] || 0xffffff,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false,
      });
    }

    function disposeHandleRoot() {
      if (!state.handlesRoot) return;
      state.handlesRoot.traverse?.(child => {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      });
      state.handlesRoot.parent?.remove(state.handlesRoot);
      state.handlesRoot = null;
      state.handles = {};
    }

    function setHandleVisibility(visible) {
      if (state.handlesRoot) state.handlesRoot.visible = Boolean(visible);
      if (!visible) state.control?.detach?.();
    }

    function makeHandle(side, kind, position, radius) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), makeMaterial(kind));
      mesh.name = `manual_ik_${side}_${kind}`;
      mesh.renderOrder = 120;
      mesh.position.copy(position);
      mesh.userData.manualIkHandle = true;
      mesh.userData.manualIkKey = `${side}.${kind}`;
      mesh.userData.manualIkKind = kind;
      state.handlesRoot.add(mesh);
      state.handles[`${side}.${kind}`] = mesh;
      return mesh;
    }

    function currentHandlePoint(side, kind) {
      return state.handles[`${side}.${kind}`]?.position?.clone?.() || null;
    }

    function attachHandle(mesh) {
      if (!mesh || !state.control) return;
      state.selectedKey = mesh.userData.manualIkKey || null;
      state.control.attach(mesh);
      host.onSelection?.(state.selectedKey);
    }

    function installPointerSelection() {
      if (state.pointerHandler) return;
      state.pointerHandler = event => {
        if (!state.active || state.released || !state.handlesRoot?.visible) return;
        const rect = renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(Object.values(state.handles).filter(Boolean), false)[0]?.object || null;
        if (hit) attachHandle(hit);
      };
      renderer.domElement.addEventListener('pointerdown', state.pointerHandler, true);
    }

    function removePointerSelection() {
      if (!state.pointerHandler) return;
      renderer.domElement.removeEventListener('pointerdown', state.pointerHandler, true);
      state.pointerHandler = null;
    }

    function captureCameraLock() {
      if (state.cameraLock) return;
      state.cameraLock = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        scale: camera.scale?.clone?.() || null,
        zoom: Number.isFinite(Number(camera.zoom)) ? Number(camera.zoom) : null,
      };
    }

    function restoreCameraLock() {
      const lock = state.cameraLock;
      if (!lock) return;
      camera.position.copy(lock.position);
      camera.quaternion.copy(lock.quaternion);
      if (lock.scale && camera.scale?.copy) camera.scale.copy(lock.scale);
      if (lock.zoom != null && camera.zoom !== lock.zoom) {
        camera.zoom = lock.zoom;
        camera.updateProjectionMatrix?.();
      }
      camera.updateMatrixWorld?.(true);
    }

    function cameraLockLoop() {
      state.cameraLockFrame = 0;
      if (!state.cameraLock) return;
      restoreCameraLock();
      state.cameraLockFrame = requestAnimationFrame(cameraLockLoop);
    }

    function beginCameraLock() {
      captureCameraLock();
      const orbit = host.getOrbitControls?.();
      if (orbit) orbit.enabled = false;
      if (!state.cameraLockFrame) state.cameraLockFrame = requestAnimationFrame(cameraLockLoop);
    }

    function endCameraLock() {
      restoreCameraLock();
      if (state.cameraLockFrame) cancelAnimationFrame(state.cameraLockFrame);
      state.cameraLockFrame = 0;
      state.cameraLock = null;
      const orbit = host.getOrbitControls?.();
      if (orbit) orbit.enabled = true;
    }

    function snapshot() {
      const sides = {};
      for (const side of ['left', 'right']) {
        sides[side] = {};
        for (const kind of ['hand', 'elbow', 'foot', 'knee']) {
          const point = currentHandlePoint(side, kind);
          sides[side][kind] = point ? { x: point.x, y: point.y, z: point.z } : null;
        }
      }
      return { schema: 'hobunji-manual-limb-ik.v1', releasedToPhysics: state.released, sides };
    }

    function historyPayload(value) {
      return JSON.stringify(value?.sides || {});
    }

    function historyStatus() {
      return {
        index: state.historyIndex,
        length: state.history.length,
        canUndo: state.active && !state.released && state.historyIndex > 0,
        canRedo: state.active && !state.released && state.historyIndex >= 0 && state.historyIndex < state.history.length - 1,
      };
    }

    function ensureHistoryButtons() {
      const row = document.getElementById('limbManualStart')?.closest?.('.limbPoseActions')
        || document.getElementById('limbManualPhysics')?.parentElement
        || null;
      if (!row) return;
      let undoButton = document.getElementById('limbManualUndo');
      let redoButton = document.getElementById('limbManualRedo');
      if (!undoButton) {
        undoButton = document.createElement('button');
        undoButton.id = 'limbManualUndo';
        undoButton.type = 'button';
        undoButton.className = 'secondary';
        undoButton.textContent = 'Undo';
        undoButton.title = 'Undo last Manual IK drag (Ctrl/Cmd+Z)';
        undoButton.addEventListener('click', undo);
        row.appendChild(undoButton);
      }
      if (!redoButton) {
        redoButton = document.createElement('button');
        redoButton.id = 'limbManualRedo';
        redoButton.type = 'button';
        redoButton.className = 'secondary';
        redoButton.textContent = 'Redo';
        redoButton.title = 'Redo Manual IK drag (Ctrl/Cmd+Shift+Z or Ctrl+Y)';
        redoButton.addEventListener('click', redo);
        row.appendChild(redoButton);
      }
      state.undoButton = undoButton;
      state.redoButton = redoButton;
    }

    function notifyHistory() {
      const status = historyStatus();
      ensureHistoryButtons();
      if (state.undoButton) state.undoButton.disabled = !status.canUndo;
      if (state.redoButton) state.redoButton.disabled = !status.canRedo;
      host.onHistoryChanged?.(status);
    }

    function resetHistory() {
      state.history = [snapshot()];
      state.historyIndex = 0;
      notifyHistory();
    }

    function commitHistory() {
      if (!state.active || state.released || state.applyingHistory) return false;
      const next = snapshot();
      const current = state.history[state.historyIndex] || null;
      if (current && historyPayload(current) === historyPayload(next)) return false;
      state.history.splice(state.historyIndex + 1);
      state.history.push(next);
      if (state.history.length > HISTORY_LIMIT) state.history.shift();
      state.historyIndex = state.history.length - 1;
      notifyHistory();
      return true;
    }

    function applyHistorySnapshot(entry) {
      if (!entry?.sides) return false;
      state.applyingHistory = true;
      try {
        for (const side of ['left', 'right']) {
          for (const kind of ['hand', 'elbow', 'foot', 'knee']) {
            const p = entry.sides?.[side]?.[kind];
            const handle = state.handles[`${side}.${kind}`];
            if (handle && finitePoint(p)) handle.position.set(Number(p.x), Number(p.y), Number(p.z));
          }
        }
        update();
      } finally {
        state.applyingHistory = false;
      }
      return true;
    }

    function undo() {
      if (!historyStatus().canUndo) return false;
      state.historyIndex -= 1;
      const applied = applyHistorySnapshot(state.history[state.historyIndex]);
      notifyHistory();
      return applied;
    }

    function redo() {
      if (!historyStatus().canRedo) return false;
      state.historyIndex += 1;
      const applied = applyHistorySnapshot(state.history[state.historyIndex]);
      notifyHistory();
      return applied;
    }

    function isEditableTarget(target) {
      if (!target) return false;
      const tag = String(target.tagName || '').toLowerCase();
      return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
    }

    function installKeyboardHistory() {
      if (state.keyHandler) return;
      state.keyHandler = event => {
        if (!state.active || state.released || isEditableTarget(event.target)) return;
        const mod = event.ctrlKey || event.metaKey;
        if (!mod || event.altKey) return;
        const key = String(event.key || '').toLowerCase();
        let handled = false;
        if (key === 'z' && !event.shiftKey) handled = undo();
        else if ((key === 'z' && event.shiftKey) || key === 'y') handled = redo();
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      document.addEventListener('keydown', state.keyHandler, true);
    }

    function removeKeyboardHistory() {
      if (!state.keyHandler) return;
      document.removeEventListener('keydown', state.keyHandler, true);
      state.keyHandler = null;
    }

    function buildControls() {
      if (state.control) return;
      state.control = new TransformControls(camera, renderer.domElement);
      state.control.name = 'ManualLimbIKTransformControls';
      state.control.setMode?.('translate');
      state.control.setSpace?.('world');
      state.control.setSize?.(0.72);
      state.control.addEventListener?.('dragging-changed', event => {
        if (event.value) beginCameraLock();
        else {
          endCameraLock();
          commitHistory(); // Exactly one history entry per completed gizmo drag.
        }
        host.onDraggingChanged?.(Boolean(event.value));
      });
      state.control.addEventListener?.('change', restoreCameraLock);
      scene.add(state.control);
    }

    function destroyControls() {
      endCameraLock();
      state.control?.detach?.();
      state.control?.parent?.remove?.(state.control);
      state.control?.dispose?.();
      state.control = null;
      state.selectedKey = null;
    }

    function seedSide(side, anchors, source, h) {
      const sign = side === 'left' ? -1 : 1;
      const shoulder = anchors.shoulders[side];
      const hip = anchors.hips[side];
      const hand = finitePoint(source?.hand)
        ? new THREE.Vector3(source.hand.x, source.hand.y, source.hand.z)
        : shoulder.clone().add(new THREE.Vector3(sign * h * 0.035, -h * 0.28, h * 0.025));
      const elbow = finitePoint(source?.elbow)
        ? new THREE.Vector3(source.elbow.x, source.elbow.y, source.elbow.z)
        : shoulder.clone().lerp(hand, 0.52).add(new THREE.Vector3(sign * h * 0.075, 0, -h * 0.03));
      const footFallback = host.getLiveFoot?.(side) || hip.clone().add(new THREE.Vector3(0, -h * 0.35, 0));
      const foot = finitePoint(source?.foot)
        ? new THREE.Vector3(source.foot.x, source.foot.y, source.foot.z)
        : footFallback.clone();
      const knee = finitePoint(source?.knee)
        ? new THREE.Vector3(source.knee.x, source.knee.y, source.knee.z)
        : hip.clone().lerp(foot, 0.5).add(new THREE.Vector3(sign * h * 0.035, 0, h * 0.12));
      return { hand, elbow, foot, knee };
    }

    function update() {
      if (!state.active || state.released) return null;
      restoreCameraLock();
      const anchors = host.getCurrentAnchors?.();
      if (!anchors?.shoulders?.left || !anchors?.shoulders?.right || !anchors?.hips?.left || !anchors?.hips?.right) return null;
      const solves = { arms: {}, legs: {} };
      for (const side of ['left', 'right']) {
        const shoulder = anchors.shoulders[side];
        const hip = anchors.hips[side];
        const hand = currentHandlePoint(side, 'hand');
        const elbow = currentHandlePoint(side, 'elbow');
        const foot = currentHandlePoint(side, 'foot');
        const knee = currentHandlePoint(side, 'knee');
        if (!hand || !elbow || !foot || !knee) continue;
        const arm = host.solveManualArm?.(side, shoulder, hand, elbow);
        const leg = host.solveManualLeg?.(side, hip, foot, knee);
        solves.arms[side] = arm;
        solves.legs[side] = leg;
        host.applyManualArm?.(side, shoulder, arm);
        host.applyManualLeg?.(side, hip, leg);
        host.drawManualSide?.(side, shoulder, arm, hip, leg);
      }
      host.updateTorsoGuide?.();
      host.setHandsVisible?.(true);
      host.setGuidesVisible?.(true);
      state.lastSolve = solves;
      host.onDebug?.({
        mode: 'manual-ik',
        ownership: 'manual handles → IK; physics off',
        selected: state.selectedKey,
        cameraLockedDuringDrag: Boolean(state.cameraLock),
        history: historyStatus(),
        handles: snapshot(),
      });
      return solves;
    }

    async function start(seed = null) {
      state.seed = seed || null;
      state.active = true;
      state.released = false;
      disposeHandleRoot();
      buildControls();
      const anchors = host.getCurrentAnchors?.();
      if (!anchors) throw new Error('Manual IK cannot resolve avatar anchors.');
      const h = Number(host.getModelHeight?.()) || 0.9;
      const radius = Math.max(0.025, h * 0.038);
      state.handlesRoot = new THREE.Group();
      state.handlesRoot.name = 'ManualLimbIKHandles';
      state.handlesRoot.renderOrder = 120;
      locomotionRoot.add(state.handlesRoot);
      for (const side of ['left', 'right']) {
        const seeded = seedSide(side, anchors, seed?.sides?.[side], h);
        makeHandle(side, 'hand', seeded.hand, radius * 1.15);
        makeHandle(side, 'elbow', seeded.elbow, radius);
        makeHandle(side, 'foot', seeded.foot, radius * 1.2);
        makeHandle(side, 'knee', seeded.knee, radius);
      }
      installPointerSelection();
      installKeyboardHistory();
      setHandleVisibility(true);
      update();
      resetHistory();
      return snapshot();
    }

    function releaseToPhysics() {
      if (!state.active) return false;
      endCameraLock();
      state.released = true;
      setHandleVisibility(false);
      notifyHistory();
      host.onReleaseToPhysics?.(snapshot());
      host.onDebug?.({
        mode: 'manual-ik',
        ownership: 'released; existing physics may take over',
        history: historyStatus(),
        handles: snapshot(),
      });
      return true;
    }

    function resume() {
      if (!state.active) return false;
      state.released = false;
      setHandleVisibility(true);
      update();
      notifyHistory();
      return true;
    }

    function stop() {
      state.active = false;
      state.released = false;
      endCameraLock();
      removePointerSelection();
      removeKeyboardHistory();
      destroyControls();
      disposeHandleRoot();
      state.seed = null;
      state.lastSolve = null;
      state.history = [];
      state.historyIndex = -1;
      notifyHistory();
    }

    function dispose() {
      stop();
    }

    return {
      start,
      update,
      snapshot,
      undo,
      redo,
      getHistoryStatus: historyStatus,
      releaseToPhysics,
      resume,
      stop,
      dispose,
      get active() { return state.active; },
      get released() { return state.released; },
      get selectedKey() { return state.selectedKey; },
    };
  }

  global.ProceduralLimbManualAuthor = Object.freeze({ create });
})(window);
