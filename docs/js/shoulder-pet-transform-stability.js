(() => {
  'use strict';

  if (window.HobunjiShoulderPetTransformStability) return;

  const THREE = window.THREE; // Used for exact world-space billboard matrices and grip-pivot preservation.
  const planeState = new WeakMap(); // Stores each shoulder-pet plane's ordinary pre-render orientation between multi-pass draws.
  let scaleCorrections = 0; // Reported through getDebug so mobile probes can confirm breathing no longer changes shoulder-pet size.
  let yawCorrections = 0; // Reported through getDebug so mobile probes can confirm parent yaw is being cancelled.
  let lastScale = null; // Most recent genotype/attack-only shoulder-pet group scale after breathing removal.
  let lastYaw = null; // Most recent requested/actual world-yaw verification for an attached shoulder-pet plane.
  let lastGripPivotError = null; // Most recent world-space shoulderGrip drift after billboard compensation.

  function companions() {
    const values = window.Combat?.deps?.companionObjects;
    return values && typeof values[Symbol.iterator] === 'function' ? values : [];
  }

  function shoulderPetForGroup(group) {
    for (const companion of companions()) {
      if (companion?.avatarRef?.group === group && companion.stableRole === 'shoulderPet' && companion.health > 0) return companion;
    }
    return null;
  }

  function installStableScale() {
    const genetics = window.CreatureGenetics;
    if (!genetics?.applyCreatureBillboardScale || genetics.__hobunjiShoulderPetStableScale) return false;
    const original = genetics.applyCreatureBillboardScale.bind(genetics); // Preserves the existing size-axis mapping for all ordinary animals.
    genetics.applyCreatureBillboardScale = function shoulderPetStableBillboardScale(group, sizeScale, heightMultiplier = 1) {
      const owner = shoulderPetForGroup(group);
      if (!owner) return original(group, sizeScale, heightMultiplier);
      const attackScaleY = Number(owner.scaleY); // Uses the existing attack squash only; idle breathing must not change a perched pet's apparent size.
      const stableHeightMultiplier = Number.isFinite(attackScaleY) ? Math.max(0, attackScaleY) : 1;
      const result = original(group, sizeScale, stableHeightMultiplier);
      scaleCorrections++;
      lastScale = {
        id: owner.id || null,
        requestedHeightMultiplier: Number(heightMultiplier),
        appliedHeightMultiplier: stableHeightMultiplier,
        x: Number(group?.scale?.x) || 0,
        y: Number(group?.scale?.y) || 0,
        z: Number(group?.scale?.z) || 0,
      };
      return result;
    };
    genetics.applyCreatureBillboardScale.__hobunjiShoulderPetStableScaleOriginal = original;
    genetics.__hobunjiShoulderPetStableScale = true;
    return true;
  }

  function scaledGrip(owner) {
    const genetics = window.CreatureGenetics;
    if (!owner || !genetics?.creatureSizeScale) return null;
    const sizeScale = genetics.creatureSizeScale(owner.creatureKey, owner.genotype); // Matches game.js creatureAttachmentAnchor size-class scaling.
    const profileKind = genetics.SPECIES_ALIAS?.[owner.creatureKey] || owner.creatureKey;
    const anchor = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[profileKind]?.anchors?.shoulderGrip;
    if (!Number.isFinite(Number(anchor?.position?.y))) return null;
    return new THREE.Vector3(
      (Number(anchor.position.x) || 0) * (Number(sizeScale?.x) || 1),
      Number(anchor.position.y) * (Number(sizeScale?.y) || 1),
      Number(anchor.position.z) || 0,
    );
  }

  function groupLocalGrip(owner, group) {
    const grip = scaledGrip(owner);
    if (!grip || !group?.scale) return null;
    const sx = Math.abs(Number(group.scale.x)) > 1e-8 ? Number(group.scale.x) : 1;
    const sy = Math.abs(Number(group.scale.y)) > 1e-8 ? Number(group.scale.y) : 1;
    const sz = Math.abs(Number(group.scale.z)) > 1e-8 ? Number(group.scale.z) : 1;
    return new THREE.Vector3(grip.x / sx, grip.y / sy, grip.z / sz); // Converts game.js's already-size-scaled attachment offset back into this live group's local space.
  }

  function restoreOrdinaryPlaneTransform(plane, state) {
    if (!state?.active || plane.matrixAutoUpdate !== false || !state.baseQuaternion) return;
    plane.quaternion.copy(state.baseQuaternion);
    plane.matrixAutoUpdate = true;
    plane.updateMatrix();
    plane.matrixWorldNeedsUpdate = true;
    state.active = false;
  }

  function captureOrdinaryPlaneTransform(plane, state) {
    if (!plane?.matrixAutoUpdate) return;
    if (!state.baseQuaternion) state.baseQuaternion = plane.quaternion.clone();
    else state.baseQuaternion.copy(plane.quaternion);
    state.baseRoll = Number(plane.rotation?.z) || 0;
  }

  function desiredWorldQuaternion(owner, face, roll) {
    const faceYaw = face === 'front' ? Math.PI / 2 : -Math.PI / 2;
    const worldYaw = owner.pngRot + faceYaw;
    const worldX = new THREE.Vector3(Math.cos(worldYaw), 0, -Math.sin(worldYaw));
    const worldY = new THREE.Vector3(0, 1, 0);
    const worldZ = new THREE.Vector3(Math.sin(worldYaw), 0, Math.cos(worldYaw));
    if (Math.abs(roll) > 1e-8) {
      const rollQuaternion = new THREE.Quaternion().setFromAxisAngle(worldZ, roll); // Keeps the existing curiosity lean as an in-plane roll while cancelling inherited body/head yaw.
      worldX.applyQuaternion(rollQuaternion);
      worldY.applyQuaternion(rollQuaternion);
    }
    return {
      quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(worldX, worldY, worldZ)),
      yaw: worldYaw,
    };
  }

  function applyStableWorldBillboard(plane, group, owner, face, state) {
    if (!THREE || !plane?.parent || !Number.isFinite(owner?.pngRot)) return false;
    if (!group.userData?.hobunjiShoulderPetAttachment?.authoritativeRootTransform) return false;

    group.updateWorldMatrix?.(true, false);
    plane.parent.updateWorldMatrix?.(true, false);
    plane.updateMatrixWorld?.(true);

    const localGrip = groupLocalGrip(owner, group);
    if (!localGrip) return false;
    const gripWorld = group.localToWorld(localGrip.clone()); // Pivot that must remain attached to the authored shoulderPerch while the flat card yaws independently.
    const gripInPlane = plane.worldToLocal(gripWorld.clone()); // Exact current visible-plane point corresponding to that authored grip.
    const worldScale = plane.getWorldScale(new THREE.Vector3()); // Preserves genotype width/height even though the parent carries a non-uniform scale.
    if ((Number(plane.scale?.x) || 1) < 0) worldScale.x *= -1; // Keeps observation-time horizontal mirroring when present.

    const desired = desiredWorldQuaternion(owner, face, state.baseRoll || 0);
    const desiredGripOffset = gripInPlane.clone().multiply(worldScale).applyQuaternion(desired.quaternion);
    const desiredWorldPosition = gripWorld.clone().sub(desiredGripOffset);
    const desiredWorldMatrix = new THREE.Matrix4().compose(desiredWorldPosition, desired.quaternion, worldScale);
    const parentInverse = plane.parent.matrixWorld.clone().invert(); // Converts the exact desired world matrix back under the attached player/head hierarchy, including parent non-uniform scale.
    const desiredLocalMatrix = parentInverse.multiply(desiredWorldMatrix);
    const parentWorldQuaternion = plane.parent.getWorldQuaternion(new THREE.Quaternion());
    const desiredLocalQuaternion = parentWorldQuaternion.invert().multiply(desired.quaternion.clone()); // Mirrors the rendered orientation into component state while the exact matrix remains authoritative.

    plane.quaternion.copy(desiredLocalQuaternion);
    plane.matrixAutoUpdate = false;
    plane.matrix.copy(desiredLocalMatrix);
    plane.matrixWorldNeedsUpdate = true;
    plane.updateMatrixWorld(true);
    state.active = true;

    const diagnosticGroupYaw = Number(group.rotation?.y) || 0; // Used only to keep Pixel Probe's older groupYaw+planeYaw summary consistent with the exact matrix below.
    const diagnosticLocalYaw = Math.atan2(Math.sin(desired.yaw - diagnosticGroupYaw), Math.cos(desired.yaw - diagnosticGroupYaw));
    plane.rotation.y = diagnosticLocalYaw; // Component-space mirror only; matrixAutoUpdate=false keeps the exact full-matrix render transform unchanged.

    const elements = plane.matrixWorld.elements;
    const actualYaw = Math.atan2(elements[8], elements[10]);
    const yawError = Math.abs(Math.atan2(Math.sin(actualYaw - desired.yaw), Math.cos(actualYaw - desired.yaw)));
    const renderedGrip = gripInPlane.clone().applyMatrix4(plane.matrixWorld);
    const gripError = renderedGrip.distanceTo(gripWorld);
    yawCorrections++;
    lastYaw = {
      id: owner.id || null,
      face,
      selected: owner.pngRot,
      target: desired.yaw,
      actual: actualYaw,
      error: yawError,
      diagnosticLocalYaw,
    };
    lastGripPivotError = gripError;
    plane.userData.hobunjiShoulderPetStableBillboard = {
      selectedYaw: owner.pngRot,
      targetWorldYaw: desired.yaw,
      actualWorldYaw: actualYaw,
      yawError,
      gripPivotError: gripError,
      diagnosticLocalYaw,
    }; // Surfaces exact post-compensation values to mobile/runtime inspection without console access.
    return true;
  }

  function wrapPlane(plane, group, face) {
    if (!plane || plane.userData?.hobunjiShoulderPetStableBillboardWrapped) return;
    plane.userData = plane.userData || {};
    const previous = plane.onBeforeRender; // Preserves the PNG avatar's ordinary billboard hook for non-shoulder animals and compatibility state restoration.
    const state = {};
    planeState.set(plane, state);
    plane.onBeforeRender = function shoulderPetStableBillboardRender(...args) {
      if (state.active && this.matrixAutoUpdate === false) restoreOrdinaryPlaneTransform(this, state);
      captureOrdinaryPlaneTransform(this, state);
      if (typeof previous === 'function') previous.apply(this, args);
      const owner = shoulderPetForGroup(group);
      if (!owner) {
        state.active = false;
        return;
      }
      applyStableWorldBillboard(this, group, owner, face, state);
    };
    plane.onBeforeRender.__hobunjiShoulderPetStableBillboardOriginal = previous;
    plane.userData.hobunjiShoulderPetStableBillboardWrapped = true;
  }

  function wrapAvatar(avatarRef) {
    const group = avatarRef?.group;
    if (!group) return avatarRef;
    wrapPlane(avatarRef.frontPlane, group, 'front');
    wrapPlane(avatarRef.backPlane, group, 'back');
    return avatarRef;
  }

  function installAvatarWrapper() {
    const api = window.PNGPlaneAvatar;
    if (!api?.buildAnimalPlaneAvatarModel || api.__hobunjiShoulderPetStableBillboardBuild) return false;
    const original = api.buildAnimalPlaneAvatarModel; // Calls the already-installed animal head-rig wrapper first so final SkinnedMesh planes receive this hook.
    api.buildAnimalPlaneAvatarModel = function shoulderPetStableAnimalPlaneBuild(...args) {
      return wrapAvatar(original.apply(this, args));
    };
    api.buildAnimalPlaneAvatarModel.__hobunjiShoulderPetStableBillboardOriginal = original;
    api.__hobunjiShoulderPetStableBillboardBuild = true;
    return true;
  }

  installStableScale();
  installAvatarWrapper();

  window.HobunjiShoulderPetTransformStability = {
    version: 1,
    wrapAvatar,
    getDebug: () => ({
      scaleCorrections,
      yawCorrections,
      lastScale,
      lastYaw,
      lastGripPivotError,
      stableScaleInstalled: !!window.CreatureGenetics?.__hobunjiShoulderPetStableScale,
      stableBillboardInstalled: !!window.PNGPlaneAvatar?.__hobunjiShoulderPetStableBillboardBuild,
      lastChange: 'Shoulder pets keep genotype scale without idle breathing and preserve shoulderGrip while their flat cards hold camera-relative world yaw.',
    }),
  };
})();
