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
    return (window.HobunjiDrunkGameplayBridge?.npcSpeedMultiplier?.(npcId) ?? 1)
      * (window.NpcYawnRest?.movementMultiplier?.(npcId) ?? 1); // Combines drunkenness with the 75% five-second yawn slowdown.
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

  function holdAtCurrentSurface(walker, dt, options, poseLocked = false) {
    const root = walker.root;
    walker.legs?.update?.(dt, 0, !window.SpouseKissMotion?.isPartner?.(walker)); // A spouse kiss locks walking, not the knees needed for its visible kneel.
    walker._legsPrevX = root.position.x;
    walker._legsPrevZ = root.position.z;
    walker._moveSpeedTiles = 0;
    if (walker.currentScheduleTarget === undefined) {
      walker.currentScheduleTarget = options.resolveScheduleTarget?.(walker.rec) || null; // Standalone walkers without a game-loop decision keep their schedule fallback.
    } // Live walkers already resolved/normalized their sleep or seat pose before movement locks; do not overwrite it.
    const groundY = options.surfaceY?.(walker.area, Math.floor(root.position.x), Math.floor(root.position.z));
    if (!Number.isFinite(groundY)) return;
    if (!poseLocked) root.position.y += (groundY - root.position.y) * (1 - Math.exp(-13.4 * dt)); // Exclusive paired choreography owns the actual hop/bow elevation, not the ordinary NPC ground follower.
    if (walker.groundShadow) {
      walker.groundShadow.position.y = groundY - root.position.y + (Number(options.shadowSurfaceOffset?.()) || 0);
    }
  }

  function update(walker, dt, options = {}) {
    if (!walker?.root) return false;
    const npcId = walker.rec?.id;
    const locks = window.CharacterActionLocks;
    const movementLocked = locks?.isLocked?.(participantId(npcId), 'movement') || false;
    const poseLocked = locks?.isLocked?.(participantId(npcId), 'pose') || false; // Paired-actor pose owner must keep its root height and run-lean pivot through ordinary NPC hold logic.
    const toolsLocked = locks?.isLocked?.(participantId(npcId), 'tools') || false;
    if (walker.stationToolMesh) walker.stationToolMesh.visible = !toolsLocked;

    // Lock handling intentionally precedes blackout presentation. If a drink
    // reaches zero sobriety at its strike frame, the authored drink pose can
    // finish before the NPC falls prone.
    if (movementLocked) {
      if (!poseLocked && walker._npcRunLeanActive) walker._npcRunLeanPivot?.quaternion?.identity?.(); // A non-pose lock neutralizes sprint lean; a paired pose owns its own tilt pivot.
      walker._npcRunLeanActive = false;
      holdAtCurrentSurface(walker, dt, options, poseLocked);
      return true;
    }

    const blackedOut = window.HobunjiDrunkGameplayBridge?.isNpcBlackedOut?.(npcId) || false;
    setBlackoutPose(walker, blackedOut);
    if (blackedOut) {
      if (walker._npcRunLeanActive) walker._npcRunLeanPivot?.quaternion?.identity?.(); // Blackout rotation owns the whole portrait, never compose a sprint pitch.
      walker._npcRunLeanActive = false;
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
