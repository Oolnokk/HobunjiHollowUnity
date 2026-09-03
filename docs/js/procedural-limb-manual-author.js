// Reusable manual IK handle layer for the Procedural Animation Editor.
//
// The host supplies the actual avatar/leg/hand application callbacks. This file
// owns only author handles, selection, TransformControls, and the transition
// from "IK is driving" to "pose is frozen so physics may take over".
(function (global) {
  'use strict';

  if (global.ProceduralLimbManualAuthor) return;

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
    if (!scene || !camera || !renderer?.domElement || !locomotionRoot) throw new Error('Manual IK requires scene, camera, renderer, and locomotion root.');

    const TransformControls = await loadTransformControls(THREE);
    const state = {
      active: false,
      released: false,
      handlesRoot: null,
      handles: {},
      control: null,
      selectedKey: null,
      pointerHandler: null,
      seed: null,
      lastSolve: null,
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
        const candidates = Object.values(state.handles).filter(Boolean);
        const hit = raycaster.intersectObjects(candidates, false)[0]?.object || null;
        if (hit) attachHandle(hit);
      };
      renderer.domElement.addEventListener('pointerdown', state.pointerHandler, true);
    }

    function removePointerSelection() {
      if (!state.pointerHandler) return;
      renderer.domElement.removeEventListener('pointerdown', state.pointerHandler, true);
      state.pointerHandler = null;
    }

    function buildControls() {
      if (state.control) return;
      state.control = new TransformControls(camera, renderer.domElement);
      state.control.name = 'ManualLimbIKTransformControls';
      state.control.setMode?.('translate');
      state.control.setSpace?.('world');
      state.control.setSize?.(0.72);
      state.control.addEventListener?.('dragging-changed', event => {
        const orbit = host.getOrbitControls?.();
        if (orbit) orbit.enabled = !event.value;
        host.onDraggingChanged?.(Boolean(event.value));
      });
      scene.add(state.control);
    }

    function destroyControls() {
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

    function update() {
      if (!state.active || state.released) return null;
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
      setHandleVisibility(true);
      update();
      return snapshot();
    }

    function releaseToPhysics() {
      if (!state.active) return false;
      state.released = true;
      setHandleVisibility(false);
      host.onReleaseToPhysics?.(snapshot());
      host.onDebug?.({ mode: 'manual-ik', ownership: 'released; existing physics may take over', handles: snapshot() });
      return true;
    }

    function resume() {
      if (!state.active) return false;
      state.released = false;
      setHandleVisibility(true);
      update();
      return true;
    }

    function stop() {
      state.active = false;
      state.released = false;
      removePointerSelection();
      destroyControls();
      disposeHandleRoot();
      state.seed = null;
      state.lastSolve = null;
    }

    function dispose() {
      stop();
    }

    return {
      start,
      update,
      snapshot,
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
