// Invisible movement-only head target for humanoid NPCs and enemy actors.
// Camera/weapon targets still win during dialogue, authored poses and combat.
(() => {
  'use strict';

  const LOOK_AHEAD_TILES = 3; // Keeps the default eye line almost level even during a full running lean.
  const MOVE_EPSILON_TILES = 0.0005; // Rejects idle positional jitter without delaying real movement.
  const MAX_YAW_DEG = 70; // Used only by the NPC-walker gaze solver; authored dialogue/stations retain their own limits.
  const MAX_PITCH_DEG = 55; // Gives the running neck enough travel to counter the body's full forward lean.

  function targetAhead(root, dx, dz, eyeHeight) {
    const travel = Math.hypot(dx, dz); // Movement heading, not camera-relative billboard facing, points the invisible target forward.
    if (!root || !(travel > MOVE_EPSILON_TILES) || !Number.isFinite(eyeHeight)) return null;
    return {
      x: root.x + LOOK_AHEAD_TILES * dx / travel,
      y: root.y + eyeHeight,
      z: root.z + LOOK_AHEAD_TILES * dz / travel,
    };
  }

  function updateWalker(walker, oldX, oldZ, options = {}) {
    if (!walker?.neckJoint || walker.animalDef || !walker.root?.position) return false;
    // Higher-priority actors own neck pose completely; never reset their transforms.
    if (options.hasScriptedGaze) { walker._npcMotionLookActive = false; return false; }
    if (walker.area !== options.currentArea || walker._npcLodFar) {
      // LOD/area changes must not strand the last movement gaze on a now-idle NPC.
      if (walker._npcMotionLookActive) {
        walker.neckJoint.rotation.set(0, 0, 0);
        walker._lookAtDebug = null;
        window.PerpRotation?.clearHeadtrackHint?.(walker.perpState);
      }
      walker._npcMotionLookActive = false;
      return false;
    }
    const position = walker.root.position;
    const dx = position.x - oldX, dz = position.z - oldZ;
    const moving = Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > MOVE_EPSILON_TILES;
    if (moving && typeof options.aimAtWorldPoint === 'function' && typeof options.makeWorldPoint === 'function') {
      const target = targetAhead(position, dx, dz, walker.avatarHeight * options.eyeHeightRatio);
      if (target) {
        const eye = options.getFaceWorld?.(walker); // Samples the already-leaning skinned head, not the upright root estimate.
        const succeeded = options.aimAtWorldPoint(walker, options.makeWorldPoint(target), eye);
        if (succeeded) {
          walker._ambientLookActive = false; // A station's old lookAt must stop owning the head as soon as travel resumes.
          walker._npcMotionLookActive = true;
          return true;
        }
      }
    }
    if (walker._npcMotionLookActive) {
      walker._npcMotionLookActive = false;
      if (!walker._ambientLookActive) { // An authored idle/station gaze applied this same tick takes precedence.
        walker.neckJoint.rotation.set(0, 0, 0);
        walker._lookAtDebug = null;
        window.PerpRotation?.clearHeadtrackHint?.(walker.perpState);
      }
    }
    return false;
  }

  function applyHostileRunPitch(avatar, lean, localHeading, undo) {
    // Bandit/ghoul portraits have TWO camera-facing cards, each with its own neck bone.
    // Project the body lean onto each card's forward axis; their rear card needs
    // the opposite sign. Leave the existing combat yaw untouched.
    const front = avatar?.neckJoint?.front;
    const back = avatar?.neckJoint?.back;
    if (!front?.rotation || !back?.rotation || !Array.isArray(undo)) return false;
    const pitch = Number(lean);
    if (!Number.isFinite(pitch) || Math.abs(pitch) < 0.0001 || !Number.isFinite(localHeading)) return false;
    const frontOld = front.rotation.x, backOld = back.rotation.x; // Restored immediately after the actual 3D render, never carried into AI calculations.
    const frontYaw = Number(avatar.frontPlane?.rotation?.y) || 0;
    const backYaw = Number(avatar.backPlane?.rotation?.y) || 0;
    front.rotation.x = frontOld - pitch * Math.cos(localHeading - frontYaw);
    back.rotation.x = backOld - pitch * Math.cos(localHeading - backYaw);
    undo.push(() => { front.rotation.x = frontOld; back.rotation.x = backOld; });
    return true;
  }

  window.NpcMovementHeadTarget = Object.freeze({
    targetAhead,
    updateWalker,
    applyHostileRunPitch,
    getDebug: () => ({ lookAheadTiles: LOOK_AHEAD_TILES, movementThresholdTiles: MOVE_EPSILON_TILES, maxYawDeg: MAX_YAW_DEG, maxPitchDeg: MAX_PITCH_DEG }),
    MAX_YAW_DEG,
    MAX_PITCH_DEG,
  });
})();
