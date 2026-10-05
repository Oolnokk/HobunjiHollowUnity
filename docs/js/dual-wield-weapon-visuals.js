// Dual-wield presentation shared by gameplay and the Attack Animation Editor.
//
// The authored/original weapon plane remains the transform authority but becomes
// material-hidden while dual wield is active. Two transform-following roots live
// beneath it. Those ROOTS reproduce the source weapon transform (the main root may
// replay it with the authored short lag); only their visible weapon children carry
// the local +/-Z sandwich offsets. Hands resolve sockets from those visible child
// weapon matrices, never from the hidden source or a root-only approximation.
// During idle, the offhand root may additionally take the explicitly authored
// opposite-hand stance while preserving the shared body yaw.
(function (global) {
  'use strict';

  const grips = global.HobunjiHandToolGrips;
  if (!grips || global.HobunjiDualWieldWeaponVisuals) return;

  const DUPLICATE_Z_GAP = 0.30; // Total plane-normal distance between visible copies.
  const HALF_Z_SEPARATION = DUPLICATE_Z_GAP * 0.5; // Each copy sits on one side of the hidden sprite plane.
  const MAIN_HAND_LAG_MS = 45; // Small visual follow lag behind the offhand/original weapon transform.
  const HISTORY_WINDOW_MS = 240; // Keeps enough parent poses to resolve the short lag through low-FPS frames.
  const ACTIVE_EPSILON = 0.0001;
  let state = null;
  let editorIdlePreviewActive = false;

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
      return { visual, plane, holder: context?.toolHolder || null, bodyRoot: context?.bodyRoot || null, source: 'attack-editor' };
    }
    const deps = global.ProceduralHandAttachments?.gameDeps || null;
    const snapshot = global.WeaponToolStances?.getRuntimeState?.() || global.WeaponToolStances?.debugSnapshot?.() || null;
    const activeSlot = snapshot?.activeSlot || deps?.getActiveTool?.() || null;
    const visual = (activeSlot && (deps?.toolMeshMap?.get?.(activeSlot) || deps?.toolMeshMap?.[activeSlot])) || null;
    const plane = visual?.userData?.toolPlane || null;
    return { visual, plane, holder: deps?.toolHolder || null, bodyRoot: global.PlayerBodyTransformComposer?.getPlayerMesh?.() || deps?.playerMesh || null, source: 'runtime' };
  }

  function currentDualState() {
    if (inAttackEditor() && editorIdlePreviewActive) {
      return { influence: 1, idleBlend: 1, source: 'editor-dual-wield-idle' };
    }
    const direct = grips.currentDualWieldAnimationState?.();
    if (direct) {
      return {
        influence: clamp01(direct.influence),
        idleBlend: clamp01(direct.idleBlend ?? direct.dualWieldIdleBlend),
        source: direct.source || 'animation',
      };
    }
    const fallback = grips.currentSecondaryGripAnimationState?.() || null;
    return {
      influence: clamp01(fallback?.dualWieldInfluence),
      idleBlend: clamp01(fallback?.dualWieldIdleBlend),
      source: fallback?.source || 'animation',
    };
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
    duplicate.position.set?.(0, 0, side === 'main' ? -HALF_Z_SEPARATION : HALF_Z_SEPARATION); // Only the child weapon gets the bread-slice separation; roots stay transform followers.
    duplicate.quaternion.identity?.();
    duplicate.scale.set?.(side === 'off' ? -1 : 1, 1, 1); // The offhand is the opposite-hand mirror, matching Mirror Animation's sprite-X flip without touching the root transform.
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

  function currentPlanePose(current) {
    const Vector3 = current.plane.position.constructor;
    const Quaternion = current.plane.quaternion.constructor;
    return {
      position: new Vector3().setFromMatrixPosition(current.plane.matrixWorld),
      quaternion: hierarchyWorldQuaternion(current.plane, new Quaternion()),
    };
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
    const pose = currentPlanePose(current);
    current.history.push({ at: now, position: pose.position, quaternion: pose.quaternion });
    const cutoff = now - HISTORY_WINDOW_MS;
    while (current.history.length > 2 && current.history[0].at < cutoff) current.history.shift();
    while (current.history.length > 20) current.history.shift();
  }

  function delayedParentPose(current, now) {
    const target = now - MAIN_HAND_LAG_MS;
    let sample = current.history[0] || null;
    for (const candidate of current.history) {
      if (candidate.at > target) break;
      sample = candidate;
    }
    return sample || currentPlanePose(current);
  }

  function idleStancePoses() {
    const stances = inAttackEditor()
      ? global.AttackIdleStanceEditor?.getConfig?.()?.stances
      : global.WeaponToolStances?.poses;
    const main = stances?.dualWieldMain || stances?.lightWeapon || null;
    let offhand = stances?.dualWieldOffhand || null;
    if (!offhand && main) {
      offhand = {
        ...main,
        x: -(Number(main.x) || 0),
        yaw: -(Number(main.yaw) || 0),
        roll: -(Number(main.roll) || 0),
      };
    }
    return main && offhand ? { main, offhand } : null;
  }

  function poseQuaternion(Quaternion, Vector3, pose) {
    const qYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (Number(pose?.yaw) || 0) * Math.PI / 180);
    const qPitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (Number(pose?.pitch) || 0) * Math.PI / 180);
    const qRoll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (Number(pose?.roll) || 0) * Math.PI / 180);
    return qYaw.multiply(qPitch).multiply(qRoll).normalize();
  }

  function idleOffhandLocalTransform(current) {
    const poses = idleStancePoses();
    if (!poses || !current.holder?.matrixWorld || !current.plane?.matrixWorld || !current.bodyRoot) return null;
    const Matrix4 = current.plane.matrixWorld.constructor;
    const Vector3 = current.plane.position.constructor;
    const Quaternion = current.plane.quaternion.constructor;
    const unitScale = new Vector3(1, 1, 1);
    const mainQ = poseQuaternion(Quaternion, Vector3, poses.main);
    const offQ = poseQuaternion(Quaternion, Vector3, poses.offhand);

    // Reconstruct the hand-side anchor underneath the authored main pose. This is
    // the part Mirror Animation also mirrors by negating toolBase.x. Runtime's
    // holder is scene-level, so deriving the anchor from the baked holder pose is
    // more reliable than assuming a particular parent hierarchy.
    const bakedHolderWorld = !inAttackEditor() ? global.WeaponToolStances?.lastHolderMatrixWorld?.() : null;
    const holderWorld = bakedHolderWorld || current.holder.matrixWorld.clone();
    const holderPosition = new Vector3();
    const holderQuaternion = new Quaternion();
    const ignoredHolderScale = new Vector3();
    holderWorld.decompose(holderPosition, holderQuaternion, ignoredHolderScale);
    const baseQuaternion = holderQuaternion.clone().multiply(mainQ.clone().invert()).normalize();
    const mainPoseOffset = new Vector3(
      Number(poses.main.x) || 0,
      Number(poses.main.y) || 0,
      Number(poses.main.z) || 0,
    ).applyQuaternion(baseQuaternion);
    const basePosition = holderPosition.clone().sub(mainPoseOffset);

    // Mirror that anchor across the character's left/right midline. Because the
    // body root itself owns the normal body yaw, reflecting in its current local X
    // frame is exactly "Mirror Animation" AFTER body yaw without negating bodyYaw.
    current.bodyRoot.updateWorldMatrix?.(true, false);
    const bodyPosition = current.bodyRoot.getWorldPosition?.(new Vector3()) || new Vector3().setFromMatrixPosition(current.bodyRoot.matrixWorld);
    const bodyQuaternion = hierarchyWorldQuaternion(current.bodyRoot, new Quaternion());
    const bodyRight = new Vector3(1, 0, 0).applyQuaternion(bodyQuaternion).normalize();
    const sideDistance = basePosition.clone().sub(bodyPosition).dot(bodyRight);
    const mirroredBasePosition = basePosition.clone().addScaledVector(bodyRight, -2 * sideDistance);

    // The offhand pose itself is explicitly authored. Its DEFAULT is generated
    // with the same channel mirror as the editor button (X/Yaw/Roll negate;
    // Y/Z/Pitch stay; Body Yaw stays shared), but artists can change it afterward.
    const offPoseOffset = new Vector3(
      Number(poses.offhand.x) || 0,
      Number(poses.offhand.y) || 0,
      Number(poses.offhand.z) || 0,
    ).applyQuaternion(baseQuaternion);
    const targetHolderPosition = mirroredBasePosition.add(offPoseOffset);
    const targetHolderQuaternion = baseQuaternion.clone().multiply(offQ).normalize();
    const targetHolderWorld = new Matrix4().compose(targetHolderPosition, targetHolderQuaternion, unitScale);

    // Move the duplicated offhand ROOT from the hidden source plane to the exact
    // authored opposite-hand holder transform. The +/-Z bread separation is NOT
    // in this matrix; it belongs only to offMesh.position.z.
    const holderDelta = targetHolderWorld.multiply(holderWorld.clone().invert());
    const planeRelative = current.plane.matrixWorld.clone().invert()
      .multiply(holderDelta)
      .multiply(current.plane.matrixWorld.clone());
    const position = new Vector3();
    const quaternion = new Quaternion();
    const ignoredScale = new Vector3();
    planeRelative.decompose(position, quaternion, ignoredScale);
    return { position, quaternion: quaternion.normalize() };
  }

  function setRootToward(root, targetPosition, targetQuaternion, influence) {
    root.position.copy(targetPosition).multiplyScalar(influence);
    root.quaternion.identity().slerp(targetQuaternion, influence);
    root.scale.set(1, 1, 1);
    root.updateMatrix?.();
  }

  function installMainLagHook(current) {
    const root = current.mainRoot;
    const originalUpdate = root?.updateMatrixWorld;
    if (!root || typeof originalUpdate !== 'function') return;
    const Vector3 = current.plane.position.constructor;
    const Quaternion = current.plane.quaternion.constructor;
    const localPosition = new Vector3();
    const desiredWorldPosition = new Vector3();
    const basePosition = new Vector3();
    const baseQuaternion = new Quaternion();
    const localQuaternion = new Quaternion();
    const inverseCurrentQuaternion = new Quaternion();

    root.updateMatrixWorld = function dualWieldLaggedMainUpdate(force) {
      if (state !== current || !current.plane?.parent) return originalUpdate.call(this, force);
      const now = global.performance?.now?.() ?? Date.now();
      recordParentHistory(current, now);
      const currentPose = currentPlanePose(current);
      const delayed = delayedParentPose(current, now);
      const lagAmount = 1 - clamp01(current.idleBlend); // Idle stance is authored directly and should not trail itself.
      basePosition.copy(currentPose.position).lerp(delayed.position, lagAmount);
      baseQuaternion.copy(currentPose.quaternion).slerp(delayed.quaternion, lagAmount).normalize();
      desiredWorldPosition.copy(basePosition); // Root follows only the delayed source transform; the child mesh owns the local -Z sandwich offset.
      localPosition.copy(desiredWorldPosition).applyMatrix4(current.plane.matrixWorld.clone().invert());
      inverseCurrentQuaternion.copy(currentPose.quaternion).invert();
      localQuaternion.copy(inverseCurrentQuaternion).multiply(baseQuaternion).normalize();
      setRootToward(this, localPosition, localQuaternion, current.influence);
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
      idleBlend: 0,
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
    const dual = currentDualState();
    if (!state && dual.influence <= ACTIVE_EPSILON) return null;
    const current = state || buildState(context);
    if (!current) return null;
    current.influence = dual.influence;
    current.idleBlend = dual.idleBlend;
    current.dualSource = dual.source;
    const active = dual.influence > ACTIVE_EPSILON;
    if (active) hideOriginalMaterial(current);
    else restoreOriginalMaterial(current);
    current.mainRoot.visible = active;
    current.offRoot.visible = active;

    const Vector3 = current.plane.position.constructor;
    const Quaternion = current.plane.quaternion.constructor;
    const idleTransform = current.idleBlend > ACTIVE_EPSILON ? idleOffhandLocalTransform(current) : null;
    const idleAmount = clamp01(current.idleBlend);
    const targetPosition = idleTransform ? idleTransform.position.clone().multiplyScalar(idleAmount) : new Vector3();
    const targetQuaternion = idleTransform
      ? new Quaternion().identity().slerp(idleTransform.quaternion, idleAmount)
      : new Quaternion();
    setRootToward(current.offRoot, targetPosition, targetQuaternion, current.influence); // Attack root stays identity; only idle authoring moves it.

    if (!active) {
      current.mainRoot.position.set(0, 0, 0);
      current.mainRoot.quaternion.identity();
      current.mainRoot.scale.set(1, 1, 1);
      current.history.length = 0;
    }
    current.plane.updateWorldMatrix?.(true, false); // Parent must be current before per-hand socket transforms read duplicate matrixWorld values.
    current.offRoot.updateMatrixWorld?.(true);
    current.mainRoot.updateMatrixWorld?.(true);
    return current;
  }

  function transformSocketForHand(record, side, socketFrame) {
    const current = syncNow();
    if (!current || current.influence <= ACTIVE_EPSILON || !socketFrame?.position || !socketFrame?.quaternion) return socketFrame;
    const weapon = side === 'right' ? current.mainMesh : current.offMesh;
    if (!weapon?.matrixWorld || !current.plane?.matrixWorld) return socketFrame;
    weapon.updateMatrixWorld?.(true);
    // Map the hidden original weapon's real grip frame onto the VISIBLE child
    // weapon. This includes the child-local +/-Z offset and offhand sprite mirror;
    // using the root here leaves both hands gripping the hidden parent instead.
    const delta = weapon.matrixWorld.clone().multiply(current.plane.matrixWorld.clone().invert());
    const position = socketFrame.position.clone().applyMatrix4(delta);
    const Quaternion = weapon.quaternion.constructor;
    const planeWorldQ = hierarchyWorldQuaternion(current.plane, new Quaternion());
    const weaponWorldQ = hierarchyWorldQuaternion(weapon, new Quaternion());
    const deltaQ = weaponWorldQ.multiply(planeWorldQ.invert()).normalize();
    const quaternion = deltaQ.multiply(socketFrame.quaternion.clone()).normalize();
    return {
      ...socketFrame,
      position,
      quaternion,
      dualWield: {
        side,
        influence: current.influence,
        idleBlend: current.idleBlend,
        zGap: DUPLICATE_Z_GAP,
        mainLagMs: MAIN_HAND_LAG_MS,
      },
    };
  }

  function setEditorIdlePreview(active) {
    editorIdlePreviewActive = !!active;
    syncNow();
    global.ProceduralHandFrameDriver?.syncNow?.();
    return editorIdlePreviewActive;
  }

  function debugSnapshot() {
    return {
      active: !!state && state.influence > ACTIVE_EPSILON,
      influence: state?.influence || 0,
      idleBlend: state?.idleBlend || 0,
      source: state?.dualSource || state?.source || null,
      duplicateZGap: DUPLICATE_Z_GAP,
      halfZSeparation: HALF_Z_SEPARATION,
      mainHandLagMs: MAIN_HAND_LAG_MS,
      historySamples: state?.history?.length || 0,
      originalPlaneName: state?.plane?.name || null,
      originalMaterialHidden: !!state && state.influence > ACTIVE_EPSILON,
      mainRootScale: state?.mainRoot?.scale?.toArray?.() || null,
      offRootScale: state?.offRoot?.scale?.toArray?.() || null,
      mainChildLocalPosition: state?.mainMesh?.position?.toArray?.() || null,
      offChildLocalPosition: state?.offMesh?.position?.toArray?.() || null,
      offChildMirroredX: Number(state?.offMesh?.scale?.x) < 0,
      mainRootParentIsHiddenOriginalPlane: !!state && state.mainRoot?.parent === state.plane,
      offRootParentIsHiddenOriginalPlane: !!state && state.offRoot?.parent === state.plane,
      editorIdlePreviewActive,
    };
  }

  global.HobunjiDualWieldWeaponVisuals = {
    syncNow,
    transformSocketForHand,
    setEditorIdlePreview,
    debugSnapshot,
    constants: Object.freeze({ DUPLICATE_Z_GAP, HALF_Z_SEPARATION, MAIN_HAND_LAG_MS }),
  };

  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('dual-wield-weapon-visuals', syncNow, {
      phase: 'pre-render',
      owner: 'HobunjiDualWieldWeaponVisuals',
      description: 'Maintains hidden-original dual weapon duplicates, plane-normal separation, authored idle offhand placement, and small main-hand attack lag.',
    });
  }
  // Standalone editor contexts do not need a second RAF loop: the hand frame driver,
  // grip-mode toggles, idle preview controls, and transformSocketForHand() call syncNow().
})(window);
