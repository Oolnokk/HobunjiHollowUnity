// NPC runtime state adapter for reusable action locks, alcohol impairment, and static body composition.
//
// Static body channels are recomputed only when a channel is added/changed/removed.
// They do not add a requestAnimationFrame loop, timer, or per-frame update wrapper.
(() => {
  'use strict';

  const participantId = npcId => `npc:${npcId || 'unknown'}`;
  const BODY_COMPOSER_STATE = '__hobunjiNpcBodyTransformComposer';

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function ensureBodyComposer(THREE, bodyRoot) {
    if (!THREE || !bodyRoot?.isObject3D) return null;
    if (bodyRoot.userData?.[BODY_COMPOSER_STATE]) return bodyRoot.userData[BODY_COMPOSER_STATE];
    bodyRoot.userData = bodyRoot.userData || {};
    const state = {
      THREE,
      basePosition: bodyRoot.position.clone(),
      baseQuaternion: bodyRoot.quaternion.clone(),
      channels: new Map(),
      revision: 0,
    };
    bodyRoot.userData[BODY_COMPOSER_STATE] = state;
    return state;
  }

  function channelQuaternion(THREE, contribution = {}) {
    if (contribution.quaternion?.isQuaternion) return contribution.quaternion.clone();
    const rotation = contribution.rotation || {};
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(
      finite(rotation.pitch ?? rotation.x),
      finite(rotation.yaw ?? rotation.y),
      finite(rotation.roll ?? rotation.z),
      contribution.order || 'YXZ',
    ));
  }

  function composeBodyChannels(bodyRoot) {
    const state = bodyRoot?.userData?.[BODY_COMPOSER_STATE];
    if (!state) return false;
    const THREE = state.THREE;
    const ordered = Array.from(state.channels.entries())
      .filter(([, contribution]) => contribution && contribution.enabled !== false)
      .sort((a, b) => finite(a[1].priority) - finite(b[1].priority) || a[0].localeCompare(b[0]));

    const position = state.basePosition.clone();
    const quaternion = state.baseQuaternion.clone();
    for (const [, contribution] of ordered) {
      const q = channelQuaternion(THREE, contribution);
      const pivotSource = contribution.pivot || {};
      const pivot = new THREE.Vector3(finite(pivotSource.x), finite(pivotSource.y), finite(pivotSource.z));
      const translationSource = contribution.translation || contribution.position || {};
      const translation = new THREE.Vector3(
        finite(translationSource.x),
        finite(translationSource.y),
        finite(translationSource.z),
      );
      position.sub(pivot).applyQuaternion(q).add(pivot).add(translation);
      quaternion.premultiply(q);
    }

    bodyRoot.position.copy(position);
    bodyRoot.quaternion.copy(quaternion).normalize();
    state.revision++;
    bodyRoot.updateMatrix?.();
    bodyRoot.updateMatrixWorld?.(true);
    return true;
  }

  function setBodyTransformChannel(bodyRoot, name, contribution = {}) {
    if (!bodyRoot?.isObject3D || !name) return false;
    const state = ensureBodyComposer(window.THREE, bodyRoot);
    if (!state) return false;
    state.channels.set(String(name), {
      priority: finite(contribution.priority),
      enabled: contribution.enabled !== false,
      order: contribution.order || 'YXZ',
      rotation: contribution.rotation ? { ...contribution.rotation } : undefined,
      quaternion: contribution.quaternion?.isQuaternion ? contribution.quaternion.clone() : undefined,
      pivot: contribution.pivot ? { ...contribution.pivot } : undefined,
      translation: contribution.translation ? { ...contribution.translation } : contribution.position ? { ...contribution.position } : undefined,
    });
    return composeBodyChannels(bodyRoot);
  }

  function clearBodyTransformChannel(bodyRoot, name) {
    const state = bodyRoot?.userData?.[BODY_COMPOSER_STATE];
    if (!state || !name) return false;
    const removed = state.channels.delete(String(name));
    if (removed) composeBodyChannels(bodyRoot);
    return removed;
  }

  function bodyTransformRootFor(subject) {
    if (!subject?.isObject3D) return null;
    if (subject.userData?.hobunjiNpcBodyTransformRoot === subject) return subject;
    return subject.userData?.hobunjiNpcBodyTransformRoot
      || subject.userData?.bodyTransformRoot
      || null;
  }

  function attachAlcoholPose(THREE, root, avatarGroup, npcId) {
    if (!THREE || !root || !avatarGroup) return null;
    const poseGroup = new THREE.Group();
    poseGroup.name = `${npcId || 'npc'}_alcohol_pose`;
    root.add(poseGroup);

    // Body-only transforms live here. Procedural feet remain under `root`, while
    // the portrait and auto-attached hands share this child as their parent.
    const bodyRoot = new THREE.Group();
    bodyRoot.name = `${npcId || 'npc'}_body_transform`;
    bodyRoot.userData.hobunjiNpcBodyTransformRoot = bodyRoot;
    poseGroup.userData.bodyTransformRoot = bodyRoot;
    avatarGroup.userData = avatarGroup.userData || {};
    avatarGroup.userData.bodyTransformRoot = bodyRoot;
    poseGroup.add(bodyRoot);
    bodyRoot.add(avatarGroup);
    ensureBodyComposer(THREE, bodyRoot);
    return poseGroup;
  }

  function movementSpeedMultiplier(npcId) {
    return window.HobunjiDrunkGameplayBridge?.npcSpeedMultiplier?.(npcId) ?? 1;
  }

  function setBlackoutPose(walker, active) {
    const poseGroup = walker?.alcoholPoseGroup;
    if (!poseGroup) return;
    const avatarHeight = Number(walker.avatarHeight) || 1;
    poseGroup.rotation.z = active ? -Math.PI / 2 : 0;
    poseGroup.position.x = active ? -avatarHeight * 0.5 : 0;
    poseGroup.position.y = active ? Math.max(0.035, avatarHeight * 0.06) : 0;
    if (walker.legs?.group) walker.legs.group.visible = !active;
  }

  function holdAtCurrentSurface(walker, dt, options) {
    const root = walker.root;
    walker.legs?.update?.(dt, 0, true);
    walker._legsPrevX = root.position.x;
    walker._legsPrevZ = root.position.z;
    walker._moveSpeedTiles = 0;
    walker.currentScheduleTarget = options.resolveScheduleTarget?.(walker.rec) || null;
    const groundY = options.surfaceY?.(walker.area, Math.floor(root.position.x), Math.floor(root.position.z));
    if (!Number.isFinite(groundY)) return;
    root.position.y += (groundY - root.position.y) * 0.2;
    if (walker.groundShadow) {
      walker.groundShadow.position.y = groundY - root.position.y + (Number(options.shadowSurfaceOffset?.()) || 0);
    }
  }

  function update(walker, dt, options = {}) {
    if (!walker?.root) return false;
    const npcId = walker.rec?.id;
    const locks = window.CharacterActionLocks;
    const movementLocked = locks?.isLocked?.(participantId(npcId), 'movement') || false;
    const toolsLocked = locks?.isLocked?.(participantId(npcId), 'tools') || false;
    if (walker.stationToolMesh) walker.stationToolMesh.visible = !toolsLocked;

    if (movementLocked) {
      holdAtCurrentSurface(walker, dt, options);
      return true;
    }

    const blackedOut = window.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(npcId) || false;
    setBlackoutPose(walker, blackedOut);
    if (blackedOut) {
      holdAtCurrentSurface(walker, dt, options);
      walker.state = 'alcohol-blackout';
      return true;
    }
    if (walker.state === 'alcohol-blackout') walker.resetRouteState?.();
    return false;
  }

  const api = Object.freeze({
    participantId,
    attachAlcoholPose,
    bodyTransformRootFor,
    setBodyTransformChannel,
    clearBodyTransformChannel,
    composeBodyChannels,
    movementSpeedMultiplier,
    update,
  });
  window.NpcCharacterState = api;
})();
