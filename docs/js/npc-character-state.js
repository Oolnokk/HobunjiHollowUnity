// NPC runtime state adapter for reusable action locks and alcohol impairment.
//
// This module owns the visual blackout pose and the common "hold this NPC in
// place" behavior. game.js supplies scene-specific surface/schedule readers at
// its update choke point and otherwise treats the state as opaque.
(() => {
  'use strict';

  const participantId = npcId => `npc:${npcId || 'unknown'}`;

  function attachAlcoholPose(THREE, root, avatarGroup, npcId) {
    if (!THREE || !root || !avatarGroup) return null;
    const poseGroup = new THREE.Group();
    poseGroup.name = `${npcId || 'npc'}_alcohol_pose`;
    root.add(poseGroup);
    poseGroup.add(avatarGroup);
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

    // Lock handling intentionally precedes blackout presentation. If a drink
    // reaches zero sobriety at its strike frame, the authored drink pose can
    // finish before the NPC falls prone.
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

  const api = Object.freeze({ participantId, attachAlcoholPose, movementSpeedMultiplier, update });
  window.NpcCharacterState = api;
})();
