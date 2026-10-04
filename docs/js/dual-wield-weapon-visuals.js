// Dual-wield presentation shared by gameplay and the Attack Animation Editor.
//
// The authored/original weapon plane remains the transform authority but becomes
// material-hidden while dual wield is active. Two visible duplicate meshes live
// beneath that hidden plane, so Tool End Flip, sweep-plane correction, mirroring,
// scale, and every authored attack transform remain inherited automatically.
// The offhand duplicate follows the hidden plane directly. The main-hand root
// replays the hidden plane a few milliseconds late, producing the requested small
// trailing motion without maintaining a second authored animation.
(function (global) {
  'use strict';

  const grips = global.HobunjiHandToolGrips;
  if (!grips || global.HobunjiDualWieldWeaponVisuals) return;

  const DUPLICATE_SEPARATION = 0.09; // Plane-local Y; after the weapon plane's -90deg X basis this is the parent weapon's local Z axis.
  const MAIN_HAND_LAG_MS = 45; // Small visual follow lag behind the offhand/original weapon transform.
  const HISTORY_WINDOW_MS = 240; // Keeps enough parent transforms to resolve the short lag through low-FPS frames.
  const ACTIVE_EPSILON = 0.0001;
  let state = null;

  function clamp01(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }

  function inAttackEditor() {
    return /\/tools\/attack-animation-editor\//.test(global.location?.pathname || '');
  }

  function currentContext() {
    if (inAttackEditor()) {
      const context = global.HobunjiAttackEditorToolContext;
      const visual = context?.toolPlaneMesh || null;
      const plane = visual?.userData?.toolPlane || null;
      return { visual, plane, holder: context?.toolHolder || null, source: 'attack-editor' };
    }
    const deps = global.ProceduralHandAttachments?.gameDeps || null;
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    const activeSlot = snapshot?.activeSlot || deps?.getActiveTool?.() || null;
    const visual = (activeSlot && (deps?.toolMeshMap?.get?.(activeSlot) || deps?.toolMeshMap?.[activeSlot])) || null;
    const plane = visual?.userData?.toolPlane || null;
    return { visual, plane, holder: deps?.toolHolder || null, source: 'runtime' };
  }

  function currentInfluence() {
    const direct = grips.currentDualWieldAnimationState?.();
    if (direct) return clamp01(direct.influence);
    return clamp01(grips.currentSecondaryGripAnimationState?.()?.dualWieldInfluence);
  }

  function materialList(material) {
    return Array.isArray(material) ? material : (material ? [material] : []);
  }

  function cloneOwnedMaterial(material) {
    const clone = material?.clone?.() || material;
    if (clone && material?.map?.clone) {
      clone.map = material.map.clone(); // Editor tool disposal recursively disposes child maps, so each duplicate owns its texture wrapper.
      clone.map.needsUpdate = true;
    }
    if (clone) clone.visible = true;
    return clone;
  }

  function disposeOwnedMaterial(material) {
    for (const entry of materialList(material)) {
      try { entry?.map?.dispose?.(); } catch (_) {}
      try { entry?.dispose?.(); } catch (_) {}
    }
  }

  function makeDuplicateMesh(plane, side) {
    let duplicate = null;
    try {
      const material = Array.isArray(plane.material)
        ? plane.material.map(cloneOwnedMaterial)
        : cloneOwnedMaterial(plane.material);
      duplicate = new plane.constructor(plane.geometry, material);
    } catch (_) {
      duplicate = plane.clone?.(false) || null;
      if (duplicate) {
        duplicate.material = Array.isArray(plane.material)
          ? plane.material.map(cloneOwnedMaterial)
          : cloneOwnedMaterial(plane.material);
      }
    }
    if (!duplicate) return null;
    duplicate.name = `dual_wield_${side}_weapon`;
    duplicate.position.set?.(0, 0, 0);
    duplicate.quaternion.identity?.();
    duplicate.scale.set?.(1, 1, 1);
    duplicate.renderOrder = plane.renderOrder;
    duplicate.frustumCulled = plane.frustumCulled;
    duplicate.castShadow = plane.castShadow;
    duplicate.receiveShadow = plane.receiveShadow;
    if (duplicate.layers && plane.layers) duplicate.layers.mask = plane.layers.mask;
    duplicate.userData = { hobunjiDualWieldDuplicate: true, side };
    return duplicate;
  }

  function makeRoot(plane, side) {
    const RootCtor = plane.parent?.constructor || plane.constructor;
    const root = new RootCtor();
    root.name = `dual_wield_${side}_root`;
    root.userData = { hobunjiDualWieldRoot: true, side };
    root.position.set?.(0, 0, 0);
    root.quaternion.identity?.();
    root.scale.set?.(1, 1, 1);
    return root;
  }

  function restoreOriginalMaterial(current) {
    if (!current?.plane) return;
    for (const record of current.originalMaterials || []) {
      if (record.material) record.material.visible = record.visible;
    }
  }

  function hideOriginalMaterial(current) {
    for (const record of current?.originalMaterials || []) if (record.material) record.material.visible = false;
  }

  function teardown() {
    const old = state;
    if (!old) return;
    restoreOriginalMaterial(old);
    old.mainRoot?.parent?.remove?.(old.mainRoot);
    old.offRoot?.parent?.remove?.(old.offRoot);
    disposeOwnedMaterial(old.mainMesh?.material);
    disposeOwnedMaterial(old.offMesh?.material);
    state = null;
  }

  function hierarchyWorldQuaternion(node, target) {
    const chain = [];
    for (let cursor = node; cursor?.isObject3D; cursor = cursor.parent) chain.push(cursor);
    target.identity();
    for (let index = chain.length - 1; index >= 0; index -= 1) target.multiply(chain[index].quaternion);
    return target.normalize();
  }

  function recordParentHistory(current, now) {
    const frameId = global.RuntimeFrameScheduler?.frameId?.();
    if (frameId != null) {
      if (current.lastHistoryFrame === frameId) return;
      current.lastHistoryFrame = frameId;
    } else if (now - current.lastHistoryAt < 3) {
      return;
    }
    current.lastHistoryAt = now;
    current.history.push({ at: now, matrix: current.plane.matrixWorld.clone() });
    const cutoff = now - HISTORY_WINDOW_MS;
    while (current.history.length > 2 && current.history[0].at < cutoff) current.history.shift();
    while (current.history.length > 20) current.history.shift();
  }

  function delayedParentMatrix(current, now) {
    const target = now - MAIN_HAND_LAG_MS;
    let sample = current.history[0] || null;
    for (const candidate of current.history) {
      if (candidate.at > target) break;
      sample = candidate;
    }
    return sample?.matrix || current.plane.matrixWorld;
  }

  function installMainLagHook(current) {
    const root = current.mainRoot;
    const originalUpdate = root?.updateMatrixWorld;
    if (!root || typeof originalUpdate !== 'function') return;
    const Matrix4 = current.plane.matrixWorld.constructor;
    const Vector3 = root.position.constructor;
    const Quaternion = root.quaternion.constructor;
    const translation = new Matrix4();
    const desiredWorld = new Matrix4();
    const localDesired = new Matrix4();
    const fullPosition = new Vector3();
    const fullQuaternion = new Quaternion();
    const fullScale = new Vector3(1, 1, 1);
    const identityQuaternion = new Quaternion();
    const unitScale = new Vector3(1, 1, 1);

    root.updateMatrixWorld = function dualWieldLaggedMainUpdate(force) {
      if (state !== current || !current.plane?.parent) return originalUpdate.call(this, force);
      const now = global.performance?.now?.() ?? Date.now();
      recordParentHistory(current, now);
      const influence = current.influence;
      const delayed = delayedParentMatrix(current, now);
      translation.makeTranslation(0, -DUPLICATE_SEPARATION, 0); // Plane-local -Y maps to the hidden weapon parent's +Z side.
      desiredWorld.copy(delayed).multiply(translation);
      localDesired.copy(current.plane.matrixWorld).invert().multiply(desiredWorld);
      localDesired.decompose(fullPosition, fullQuaternion, fullScale);
      this.position.copy(fullPosition).multiplyScalar(influence);
      this.quaternion.copy(identityQuaternion).slerp(fullQuaternion, influence);
      this.scale.copy(unitScale).lerp(fullScale, influence);
      this.updateMatrix?.();
      return originalUpdate.call(this, force);
    };
  }

  function buildState(context) {
    const plane = context.plane;
    if (!plane?.parent) return null;
    const mainRoot = makeRoot(plane, 'main');
    const offRoot = makeRoot(plane, 'off');
    const mainMesh = makeDuplicateMesh(plane, 'main');
    const offMesh = makeDuplicateMesh(plane, 'off');
    if (!mainMesh || !offMesh) {
      disposeOwnedMaterial(mainMesh?.material);
      disposeOwnedMaterial(offMesh?.material);
      return null;
    }
    mainRoot.add(mainMesh);
    offRoot.add(offMesh);
    plane.add(offRoot);
    plane.add(mainRoot);
    const next = {
      ...context,
      mainRoot,
      offRoot,
      mainMesh,
      offMesh,
      influence: 0,
      history: [],
      lastHistoryAt: -Infinity,
      lastHistoryFrame: null,
      originalMaterials: materialList(plane.material).map(material => ({ material, visible: material.visible !== false })),
    };
    state = next;
    installMainLagHook(next);
    return next;
  }

  function syncNow() {
    const context = currentContext();
    if (!context.visual || !context.plane) {
      teardown();
      return null;
    }
    if (state && (state.visual !== context.visual || state.plane !== context.plane)) teardown();
    const influence = currentInfluence();
    if (!state && influence <= ACTIVE_EPSILON) return null;
    const current = state || buildState(context);
    if (!current) return null;
    current.influence = influence;
    const active = influence > ACTIVE_EPSILON;
    if (active) hideOriginalMaterial(current);
    else restoreOriginalMaterial(current);
    current.mainRoot.visible = active;
    current.offRoot.visible = active;
    current.offRoot.position.set(0, DUPLICATE_SEPARATION * influence, 0); // Opposite/equal plane-local Y offset -> opposite parent-local Z side.
    current.offRoot.quaternion.identity();
    current.offRoot.scale.set(1, 1, 1);
    if (!active) {
      current.mainRoot.position.set(0, 0, 0);
      current.mainRoot.quaternion.identity();
      current.mainRoot.scale.set(1, 1, 1);
      current.history.length = 0;
    }
    current.offRoot.updateMatrix?.();
    current.mainRoot.updateMatrix?.();
    current.plane.updateWorldMatrix?.(true, false); // Parent must be current before per-hand socket transforms read duplicate matrixWorld values.
    current.offRoot.updateMatrixWorld?.(true);
    current.mainRoot.updateMatrixWorld?.(true);
    return current;
  }

  function transformSocketForHand(record, side, socketFrame) {
    const current = syncNow();
    if (!current || current.influence <= ACTIVE_EPSILON || !socketFrame?.position || !socketFrame?.quaternion) return socketFrame;
    const root = side === 'right' ? current.mainRoot : current.offRoot;
    if (!root?.matrixWorld || !current.plane?.matrixWorld) return socketFrame;
    const delta = root.matrixWorld.clone().multiply(current.plane.matrixWorld.clone().invert());
    const position = socketFrame.position.clone().applyMatrix4(delta);
    const Quaternion = root.quaternion.constructor;
    const planeWorldQ = hierarchyWorldQuaternion(current.plane, new Quaternion());
    const rootWorldQ = hierarchyWorldQuaternion(root, new Quaternion());
    const deltaQ = rootWorldQ.multiply(planeWorldQ.invert()).normalize();
    const quaternion = deltaQ.multiply(socketFrame.quaternion.clone()).normalize();
    return {
      ...socketFrame,
      position,
      quaternion,
      dualWield: { side, influence: current.influence, separation: DUPLICATE_SEPARATION, mainLagMs: MAIN_HAND_LAG_MS },
    };
  }

  function debugSnapshot() {
    return {
      active: !!state && state.influence > ACTIVE_EPSILON,
      influence: state?.influence || 0,
      source: state?.source || null,
      separationPlaneY: DUPLICATE_SEPARATION,
      equivalentWeaponParentLocalZ: DUPLICATE_SEPARATION,
      mainHandLagMs: MAIN_HAND_LAG_MS,
      historySamples: state?.history?.length || 0,
      originalPlaneName: state?.plane?.name || null,
      originalMaterialHidden: !!state && state.influence > ACTIVE_EPSILON,
      mainRootParentIsHiddenOriginalPlane: !!state && state.mainRoot?.parent === state.plane,
      offRootParentIsHiddenOriginalPlane: !!state && state.offRoot?.parent === state.plane,
    };
  }

  global.HobunjiDualWieldWeaponVisuals = {
    syncNow,
    transformSocketForHand,
    debugSnapshot,
    constants: Object.freeze({ DUPLICATE_SEPARATION, MAIN_HAND_LAG_MS }),
  };

  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('dual-wield-weapon-visuals', syncNow, {
      phase: 'pre-render',
      owner: 'HobunjiDualWieldWeaponVisuals',
      description: 'Maintains hidden-original dual weapon duplicates and their small main-hand transform lag before hand/socket render sync.',
    });
  } else {
    const frame = () => { syncNow(); global.requestAnimationFrame?.(frame); };
    global.requestAnimationFrame?.(frame);
  }
})(window);
