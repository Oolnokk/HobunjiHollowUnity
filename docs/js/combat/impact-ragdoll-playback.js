// Impact/ragdoll clip playback for player and creature avatars. Samples the
// baked 4-directional blend clips from impact-blend-library.js. Player leg
// poses target the procedural rig and body motion goes through
// PlayerBodyTransformComposer; creature planes reuse the body channel through
// an isolated, quarter-turned visual pivot and deliberately ignore humanoid IK.
(() => {
  'use strict';

  const BODY_CHANNEL = 'ragdoll';
  const BODY_PRIORITY = 100;
  const LEGS_LIFT_Y = 0.06; // Recorded foot centres sit ~0.04 above the floor, but the rendered foot mesh extends below its centre; this keeps the soles on the ground.
  const CREATURE_REFERENCE_HEIGHT = 0.9; // Converts player-authored body-height offsets to each animal plane's visible height in applyCreatureFrame.
  const CREATURE_DIRECTION_QUARTER_TURN = Object.freeze({ front: 'left', right: 'front', back: 'right', left: 'back' }); // Rotates the humanoid blend poles +90° for side-on animal planes.
  const CREATURE_BASIS_QUATERNION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2); // Rotates humanoid-authored motion axes into the animal card's local basis.
  const CREATURE_BASIS_INVERSE = CREATURE_BASIS_QUATERNION.clone().invert(); // Reused each frame to avoid allocating basis transforms per active animal.

  let playerLegsRef = null;
  let baseBodyY = 0;
  const creatureStates = new Set(); // Tracks active creature reactions, including a small number of prone actors that need independent presentation updates.
  const pronePoseDiagnostics = { rescuedStalls: 0, fallbackPoses: 0, restoredMissing: 0, reboundVisuals: 0, retiredOrphans: 0, failedRestores: 0, lastRescue: null }; // Read by the existing mobile impact debug view; never allocated on a render tick.
  const PRONE_ANIMATION_STALL_MS = 90; // A skipped hostile simulation update may not strand the portrait part-way through a knockdown.
  const creatureFlatAxis = new THREE.Vector3(0, 0, 1); // Fallback horizontal rotation of the creature's side-facing two-plane portrait.
  const visualNowMs = () => typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now(); // Monotonic animation sampling clock, independent of hostile AI cadence.

  const recoveryAxis = new THREE.Vector3(1, 0, 0); // Used by recovery rolls; dodge direction blends X/Z while prone recovery keeps +X.
  const tumbleAxis = new THREE.Vector3(1, 0, 0); // Reused by player prone-hit flips without per-frame vector allocation.
  const tumbleRotation = new THREE.Quaternion(); // Reused by updateTumble; the recorded prone tail stays the neutral starting/ending pose.
  const tumbleBaseRotation = new THREE.Quaternion(); // Reused by player/creature tumble sampling so this animation allocates no frame-local quaternion.
  const playback = {
    active: false,
    holding: false,
    bank: null,
    direction: null,
    clip: null,
    elapsedS: 0,
    playbackRate: 1,
    suppressLocomotion: false,
    recoveryBlend: null,
  };

  // Keep the historical two-argument signature because game.js already calls
  // attach(playerMesh, playerLegs). The mesh argument is intentionally ignored:
  // visual body ownership now belongs to PlayerBodyTransformComposer.
  function attach(_playerMesh, playerLegs) {
    playerLegsRef = playerLegs;
  }

  function findBracket(frames, t) {
    if (t <= frames[0].t) return [frames[0], frames[0], 0];
    const last = frames[frames.length - 1];
    if (t >= last.t) return [last, last, 0];
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i];
      const b = frames[i + 1];
      if (t >= a.t && t <= b.t) {
        const span = b.t - a.t;
        return [a, b, span > 1e-6 ? (t - a.t) / span : 0];
      }
    }
    return [last, last, 0];
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function slerpQuat(qa, qb, t) {
    const out = new THREE.Quaternion(qa.x, qa.y, qa.z, qa.w);
    if (t <= 0) return out;
    return out.slerp(new THREE.Quaternion(qb.x, qb.y, qb.z, qb.w), t);
  }

  function sampleLeg(a, b, t) {
    return {
      thighQuaternion: slerpQuat(a.thighQuaternion, b.thighQuaternion, t),
      calfLocalQuaternion: slerpQuat(a.calfLocalQuaternion, b.calfLocalQuaternion, t),
      upperLength: lerp(a.upperLength, b.upperLength, t),
      lowerLength: lerp(a.lowerLength, b.lowerLength, t),
    };
  }

  function sampleBody(frameA, frameB, t) {
    return {
      quaternion: slerpQuat(
        frameA.ragdoll.body.localQuaternion,
        frameB.ragdoll.body.localQuaternion,
        t
      ),
      y: lerp(
        frameA.ragdoll.body.localPosition.y,
        frameB.ragdoll.body.localPosition.y,
        t
      ),
    };
  }

  // absoluteLegs: recorded clip frames carry floor-relative leg poses, so the
  // composer must not tilt/lower the leg group along with the body again (that
  // left the feet hanging in the air). Procedural recovery rolls keep the legs
  // attached to the rolling body.
  function publishBodyPose(quaternion, yOffset = 0, absoluteLegs = false) {
    window.PlayerBodyTransformComposer?.setChannel(BODY_CHANNEL, {
      priority: BODY_PRIORITY,
      mode: 'override',
      absoluteLegs,
      absoluteLegsLiftY: absoluteLegs ? LEGS_LIFT_Y : 0,
      quaternion,
      translation: { x: 0, y: Number(yOffset) || 0, z: 0 },
    });
  }

  function applyFrame(frameA, frameB, t) {
    if (!frameA || !frameB) return;

    const body = sampleBody(frameA, frameB, t);
    publishBodyPose(body.quaternion, body.y - baseBodyY, true);

    if (!playerLegsRef) return;
    playerLegsRef.applyRecordedLegPose(
      'left',
      sampleLeg(frameA.ragdoll.ik.left, frameB.ragdoll.ik.left, t)
    );
    playerLegsRef.applyRecordedLegPose(
      'right',
      sampleLeg(frameA.ragdoll.ik.right, frameB.ragdoll.ik.right, t)
    );
    playerLegsRef.pants?.update?.(); // legs.update() normally drives the pants; it is skipped while a recorded pose owns the legs, which left the garment on the old stance.
  }

  function holdHumanoidProne(walker, direction = 'front', blend = 1) {
    blend = Math.max(0, Math.min(1, Number(blend) || 0));
    if (!walker?.avatarGroup || !walker?.root) return;
    if (walker._cinematicPosePivot && (walker._cinematicPosePivot.parent !== walker.root
      || (walker.alcoholPoseGroup || walker.avatarGroup).parent !== walker._cinematicPosePivot
      || (walker.legs?.group && walker.legs.group.parent !== walker._cinematicPosePivot))) {
      walker._cinematicPronePoseSession?.release(); // The old rig generation no longer owns the current actor.
      walker._cinematicPronePoseSession = null;
      walker._cinematicPosePivot = null;
      walker._cinematicProneBlend = undefined;
    }
    if (walker._cinematicProneBlend === blend && walker._cinematicPronePoseSession?.owns?.()) return;
    const clip = window.ImpactBlendLibrary?.getClip('breakThrow', direction); // Combat holds the settled tail of this same knockdown bank while prone.
    const frame = clip?.frames?.[clip.frames.length - 1]; // A held pose uses the authored final frame without replaying the initial throw.
    if (!frame) return;
    let pivot = walker._cinematicPosePivot; // Isolated actor pivot rotates torso, hands and procedural legs around the normal posterior anchor.
    if (!pivot) {
      const posteriorY = Number(walker.legs?.standingPosteriorY) || 0; // Matches the combat body composer's floor-relative pivot.
      pivot = new THREE.Group();
      pivot.position.y = posteriorY;
      walker.root.add(pivot);
      for (const node of [walker.alcoholPoseGroup || walker.avatarGroup, walker.legs?.group]) {
        if (!node) continue;
        pivot.add(node);
        node.position.y -= posteriorY;
      }
      pivot.userData.posteriorY = posteriorY;
      walker._cinematicPosePivot = pivot;
    }
    const compositor = window.ActorRigCompositor; // Authored absolute pivot owner; normal leg IK and torso offsets keep their separate namespaces.
    if (!walker._cinematicPronePoseSession && compositor?.createAbsoluteSession) {
      const session = compositor.createAbsoluteSession('impact-humanoid-prone');
      if (!session?.capture(pivot, ['position', 'quaternion'])) {
        session?.release();
        return; // Never steal a pivot from an active scripted pose.
      }
      walker._cinematicPronePoseSession = session;
    }
    if (walker._cinematicPronePoseSession && !walker._cinematicPronePoseSession.owns()) {
      clearHumanoidProne(walker); // A newer authored pivot pose took over.
      return;
    }
    const body = sampleBody(clip.frames[0], frame, blend); // Same quaternion/height sampling as combat's held player frame.
    pivot.quaternion.copy(body.quaternion);
    pivot.position.y = pivot.userData.posteriorY + body.y - (Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0);
    for (const side of ['left', 'right']) walker.legs?.applyRecordedLegPose(side, sampleLeg(clip.frames[0].ragdoll.ik[side], frame.ragdoll.ik[side], blend));
    walker._cinematicPronePoseSession?.stamp();
    walker._cinematicProneBlend = blend;
    walker._cinematicProneHeld = blend > 0;
  }

  function clearHumanoidProne(walker) {
    if (!walker?._cinematicProneHeld && !walker?._cinematicPronePoseSession) return;
    const owned = walker._cinematicPronePoseSession;
    walker._cinematicPronePoseSession = null;
    if (owned) owned.release(); // Only restore the neutral persistent pivot if the same generation still owns its pose.
    else if (walker._cinematicPosePivot?.parent === walker.root) {
      walker._cinematicPosePivot.quaternion.identity();
      walker._cinematicPosePivot.position.y = walker._cinematicPosePivot.userData.posteriorY;
    }
    walker._cinematicProneHeld = false;
    walker._cinematicProneBlend = undefined;
  }

  function belongsToCreatureAvatar(node, root) {
    if (!root?.isObject3D) return true; // Isolated preview rigs may not expose their outer avatar group.
    for (let cursor = node; cursor; cursor = cursor.parent) if (cursor === root) return true;
    return false;
  }

  function ensureCreatureImpactPivot(entity) {
    const avatarRef = entity?.avatarRef;
    const front = avatarRef?.frontPlane;
    const back = avatarRef?.backPlane;
    if (!front?.isObject3D || !back?.isObject3D) return null;
    const oldPivot = avatarRef.impactPivot; // The previous creature card can still be rendered if a rebuild leaves its pivot attached.
    if (oldPivot?.isObject3D && oldPivot.parent
      && front.parent === oldPivot && back.parent === oldPivot
      && belongsToCreatureAvatar(oldPivot, avatarRef.group)) {
      return oldPivot; // All of the planes, pivot and current avatar root belong to this exact rig generation.
    }
    oldPivot?.parent?.remove?.(oldPivot); // Retire stale rendered cards rather than leaving a duplicate ghost of the old impact pose.
    avatarRef.impactPivot = null;
    if (!front.parent || front.parent !== back.parent
      || !belongsToCreatureAvatar(front, avatarRef.group)) return null;

    const parent = front.parent;
    const pivot = new THREE.Group(); // Isolates impact pitch/roll from the creature group's persistent facing yaw.
    pivot.name = 'creature_impact_visual';
    parent.add(pivot);
    pivot.add(front);
    pivot.add(back);
    avatarRef.impactPivot = pivot;
    return pivot;
  }

  // The same entity can receive a new animal card after wildlife visual LOD,
  // sprite rig replacement or appearance rebuild. An old session may still
  // own its EMPTY pivot while the live front/back cards render upright.
  function isCurrentCreaturePoseRig(entity, state) {
    const avatar = entity?.avatarRef;
    return !!(state?.pivot?.parent && avatar?.group && avatar.impactPivot === state.pivot
      && avatar.frontPlane?.parent === state.pivot && avatar.backPlane?.parent === state.pivot
      && belongsToCreatureAvatar(state.pivot, avatar.group));
  }

  function createCreaturePoseSession(pivot, owner) {
    const session = window.ActorRigCompositor?.createAbsoluteSession?.(owner) || null;
    if (session && !session.capture(pivot, ['position', 'quaternion'])) {
      session.release(); // A new recording cannot seize a pivot from a still-authoritative corpse/impact owner.
      return false;
    }
    return session;
  }

  function releaseCreaturePose(state) {
    if (state?.poseSession) state.poseSession.release();
    else if (state?.pivot && state.pivot.parent) {
      state.pivot.quaternion?.identity?.();
      if (state.pivot.position) state.pivot.position.y = 0;
    } // Standalone animation tools without the shared compositor keep the old reset.
  }

  function applyCreatureFrame(state, frameA, frameB, t) {
    if (!frameA || !frameB || !state?.pivot || !state.pivot.parent) return false;
    if (state.poseSession && !state.poseSession.owns()) return false;
    const body = sampleBody(frameA, frameB, t);
    // Animal cards face along local X rather than the player's local Z.
    // Conjugating by +90° Y rotates the authored pitch/roll axes with the
    // blendspace instead of merely renaming its four directional clips.
    state.pivot.quaternion.copy(CREATURE_BASIS_QUATERNION).multiply(body.quaternion).multiply(CREATURE_BASIS_INVERSE);
    state.pivot.position.y = (body.y - state.baseBodyY) * state.heightScale;
    state.poseSession?.stamp(); // Every sample is an absolute authored result; no frame accumulates a prior tilt.
    return true;
  }

  // Death owns an independent, persistent sample of the same recorded prone
  // throw used by zero-Footing hits. Unlike a living impact it isn't updated by
  // updateCreatureMesh(), and it must never return to the standing pose.
  function startCreatureDeath(entity, direction = 'front') {
    stopCreature(entity);
    const mappedDirection = CREATURE_DIRECTION_QUARTER_TURN[direction] || 'front';
    const clip = window.ImpactBlendLibrary?.getClip('breakThrow', mappedDirection);
    const pivot = ensureCreatureImpactPivot(entity);
    if (!clip?.frames?.length || !pivot) return 0;
    const poseSession = createCreaturePoseSession(pivot, 'impact-creature-death');
    if (poseSession === false) return 0;
    // Bandit hands and legs are siblings of the portrait planes; take them
    // along for a death without changing the normal live knockdown rig.
    for (const limb of [entity.avatarRef?.handsPivot, entity.avatarRef?.legsPivot]) {
      if (limb?.isObject3D && limb.parent === pivot.parent) pivot.add(limb);
    }
    const visibleHeight = Math.max(0.05, Number(entity?.halfHeight) * 2 || CREATURE_REFERENCE_HEIGHT);
    entity._deathRecordedThrow = {
      pivot, clip, poseSession,
      baseBodyY: Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0,
      heightScale: visibleHeight / CREATURE_REFERENCE_HEIGHT,
    }; // Sampled by CreatureDeath while dying and retained as the corpse's pose.
    sampleCreatureDeath(entity, 0);
    return Math.max(0.05, clip.durationSeconds);
  }

  function sampleCreatureDeath(entity, phase) {
    const state = entity?._deathRecordedThrow;
    if (!state?.clip?.frames?.length) return false;
    const time = Math.max(0, Math.min(1, Number(phase) || 0)) * state.clip.durationSeconds;
    const [frameA, frameB, blend] = findBracket(state.clip.frames, time);
    if (!applyCreatureFrame(state, frameA, frameB, blend)) {
      stopCreatureDeath(entity); // A newer creature visual owns this pose: do not keep recording legs over it.
      return false;
    }
    const legs = entity.avatarRef?.legs;
    if (typeof legs?.applyRecordedLegPose === 'function') {
      for (const side of ['left', 'right']) {
        if (frameA?.ragdoll?.ik?.[side] && frameB?.ragdoll?.ik?.[side])
          legs.applyRecordedLegPose(side, sampleLeg(frameA.ragdoll.ik[side], frameB.ragdoll.ik[side], blend));
      }
    }
    legs?.pants?.update?.(); // Recorded deaths bypass legs.update(); refresh the garment after both authored leg poses are applied.
    return true;
  }

  function stopCreatureDeath(entity) {
    const state = entity?._deathRecordedThrow;
    if (!state) return false;
    releaseCreaturePose(state);
    entity._deathRecordedThrow = null;
    return true;
  }

  function stopCreature(entity) {
    const state = entity?._impactRagdollPlayback;
    if (!state) return;
    releaseCreaturePose(state);
    creatureStates.delete(state);
    entity._impactRagdollPlayback = null;
  }

  // A knocked-down actor whose portrait was promoted/rebuilt after the original
  // hit needs the SETTLED recorded pose, not a replayed first-frame throw.
  // This is called by the existing updateCreatureMesh -> updateCreature path,
  // which handles both animals and bandits without creating a new game.js tick.
  function restoreCreaturePronePose(entity) {
    if (!entity?.prone || !(Number(entity.health) > 0) || entity._deathRecordedThrow
      || entity._wildlifeVisualsReleased) return false;
    const direction = entity._pronePortraitDirection || 'front';
    const mappedDirection = CREATURE_DIRECTION_QUARTER_TURN[direction] || 'front';
    const clip = window.ImpactBlendLibrary?.getClip('breakThrow', mappedDirection);
    if (!clip?.frames?.length) return holdUnrecordedCreatureProne(entity);
    stopCreature(entity);
    const pivot = ensureCreatureImpactPivot(entity);
    if (!pivot) { pronePoseDiagnostics.failedRestores++; return false; }
    const poseSession = createCreaturePoseSession(pivot, 'impact-creature-prone-restored');
    if (poseSession === false) { pronePoseDiagnostics.failedRestores++; return false; }
    const visibleHeight = Math.max(0.05, Number(entity.halfHeight) * 2 || CREATURE_REFERENCE_HEIGHT);
    const state = {
      entity, pivot, poseSession, bank: 'breakThrow', direction: mappedDirection,
      clip, elapsedS: clip.durationSeconds, playbackRate: 1, holding: true,
      lastPresentationMs: visualNowMs(),
      baseBodyY: Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0,
      heightScale: visibleHeight / CREATURE_REFERENCE_HEIGHT,
    }; // A single held pose owner for the existing current portrait generation.
    entity._impactRagdollPlayback = state;
    creatureStates.add(state);
    const tail = clip.frames[clip.frames.length - 1];
    if (!applyCreatureFrame(state, tail, tail, 0)) {
      stopCreature(entity);
      pronePoseDiagnostics.failedRestores++;
      return false;
    }
    pronePoseDiagnostics.restoredMissing++;
    return true;
  }

  // The blend bank loads asynchronously. If a creature is knocked down before
  // the recording is available, keep the card flat instead of showing an
  // upright (or low-Footing tilted) portrait for the entire prone duration.
  function holdUnrecordedCreatureProne(entity) {
    stopCreature(entity);
    const pivot = ensureCreatureImpactPivot(entity);
    if (!pivot) { pronePoseDiagnostics.failedRestores++; return false; }
    const poseSession = createCreaturePoseSession(pivot, 'impact-creature-prone-fallback');
    if (poseSession === false) { pronePoseDiagnostics.failedRestores++; return false; }
    const halfHeight = Math.max(0.05, Number(entity.halfHeight) || CREATURE_REFERENCE_HEIGHT / 2);
    const state = {
      entity, pivot, poseSession, bank: 'breakThrow', clip: null,
      holding: true, elapsedS: 0, lastPresentationMs: visualNowMs(),
    }; // Held until Footing recovery (or a real new knockdown) releases this rig.
    entity._impactRagdollPlayback = state;
    creatureStates.add(state);
    pivot.quaternion.setFromAxisAngle(creatureFlatAxis, Math.PI / 2);
    pivot.position.y = -halfHeight * 0.7; // Match the grounded side-on portrait instead of rotating it around a floating centre.
    poseSession?.stamp();
    pronePoseDiagnostics.fallbackPoses++;
    return true;
  }

  function triggerCreature(entity, bank, direction, opts = {}) {
    if (entity?._deathRecordedThrow) return 0;
    if (bank === 'breakThrow' && entity?.prone)
      entity._pronePortraitDirection = direction; // Retained on the entity when its visible animal/NPC rig streams out and back in. // Never change corpse geometry just because a live attack tried to start.
    if (entity?.prone && bank !== 'breakThrow') return 0; // Ordinary staggers must never replace the prone body with an upright impact clip.
    const mappedDirection = CREATURE_DIRECTION_QUARTER_TURN[direction] || 'front';
    const clip = window.ImpactBlendLibrary?.getClip(bank, mappedDirection);
    if (!clip?.frames?.length) {
      if (bank === 'breakThrow' && entity?.prone) holdUnrecordedCreatureProne(entity);
      return 0; // A missing async recording still produces an unmistakably horizontal prone portrait.
    }
    stopCreature(entity); // Release the previous rig claim before deciding whether a replacement pivot is safe.
    const pivot = ensureCreatureImpactPivot(entity);
    if (!pivot) return 0;
    const poseSession = createCreaturePoseSession(pivot, 'impact-creature-reaction');
    if (poseSession === false) return 0;
    const requestedDurationS = Number(opts.durationSeconds);
    const durationMultiplier = requestedDurationS > 0 && clip.durationSeconds > 0
      ? Math.max(0.01, requestedDurationS / clip.durationSeconds)
      : Math.max(0.01, Number(opts.durationMultiplier) || 1);
    const visibleHeight = Math.max(0.05, Number(entity?.halfHeight) * 2 || CREATURE_REFERENCE_HEIGHT);
    const state = {
      entity,
      pivot, poseSession,
      bank,
      direction: mappedDirection,
      clip,
      elapsedS: 0,
      playbackRate: 1 / durationMultiplier,
      holding: false,
      lastPresentationMs: visualNowMs(), // Used by the render-time rescue when regular hostile animation ticks are skipped.
      baseBodyY: Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0,
      heightScale: visibleHeight / CREATURE_REFERENCE_HEIGHT,
    }; // Stored on the entity so updateCreatureMesh can advance only the creature it is already rendering.
    entity._impactRagdollPlayback = state;
    creatureStates.add(state);
    const [frameA, frameB, blend] = findBracket(clip.frames, 0);
    applyCreatureFrame(state, frameA, frameB, blend);
    return clip.durationSeconds * durationMultiplier;
  }

  // Repeated blows can throw an already prone actor without authoring another
  // four-directional blend. Start/end are the existing breakThrow held pose;
  // a full procedural revolution is composed between them. Translation makes
  // a short ground knockback look airborne while actual world height remains
  // owned exclusively by the player jump / creature cliff-fall systems.
  function tumbleDirectionAxis(direction, axis) {
    if (direction === 'right') axis.set(0, 0, 1);
    else if (direction === 'left') axis.set(0, 0, -1);
    else axis.set(direction === 'back' ? -1 : 1, 0, 0);
    return axis;
  }

  function triggerTumble(entity, direction = 'front', durationS = 0.34) {
    if (!entity?.prone || entity.health <= 0) return false;
    const duration = Math.max(0.18, Number(durationS) || 0.34);
    if (entity === window.Combat?.deps?.player) {
      const clip = window.ImpactBlendLibrary?.getClip('breakThrow', direction);
      if (!clip?.frames?.length) return false;
      playback.active = true;
      playback.holding = false;
      playback.bank = 'tumble';
      playback.direction = direction;
      playback.clip = clip;
      playback.elapsedS = 0;
      playback.tumbleDurationS = duration;
      playback.suppressLocomotion = true; // The held ragdoll legs rotate with the body, not a fresh gait solve.
      playback.recoveryBlend = null;
      baseBodyY = Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0;
      tumbleDirectionAxis(direction, tumbleAxis);
      const tail = clip.frames[clip.frames.length - 1];
      applyFrame(tail, tail, 0);
      return true;
    }
    if (entity._deathRecordedThrow) return false;
    const mappedDirection = CREATURE_DIRECTION_QUARTER_TURN[direction] || 'front';
    const clip = window.ImpactBlendLibrary?.getClip('breakThrow', mappedDirection);
    if (!clip?.frames?.length) return false;
    stopCreature(entity);
    const pivot = ensureCreatureImpactPivot(entity);
    if (!pivot) return false;
    const poseSession = createCreaturePoseSession(pivot, 'impact-creature-prone-tumble');
    if (poseSession === false) return false;
    const visibleHeight = Math.max(0.05, Number(entity.halfHeight) * 2 || CREATURE_REFERENCE_HEIGHT);
    const state = {
      entity, pivot, poseSession, bank: 'tumble', direction: mappedDirection,
      clip, elapsedS: 0, tumbleDurationS: duration, holding: false,
      lastPresentationMs: visualNowMs(), // Repeat prone tumbling must also reach the held prone pose if its AI tick stops.
      baseBodyY: Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0,
      heightScale: visibleHeight / CREATURE_REFERENCE_HEIGHT,
      tumbleAxis: tumbleDirectionAxis(direction, new THREE.Vector3()),
    }; // New reaction owns this one creature's existing impact pivot; no extra rig, bone or recorded animation.
    entity._impactRagdollPlayback = state;
    creatureStates.add(state);
    const tail = clip.frames[clip.frames.length - 1];
    applyCreatureFrame(state, tail, tail, 0);
    return true;
  }

  // Live hostile AI is allowed to skip a creature update when prone/offscreen;
  // its portrait must NOT be left at the first few degrees of breakThrow. Run
  // only active prone reactions once at the world-render boundary, and only
  // when the ordinary creature animation has truly missed an update.
  function rescueStalledCreaturePronePoses() {
    if (!creatureStates.size) return;
    const now = visualNowMs();
    for (const state of creatureStates) {
      if (state.entity?._impactRagdollPlayback !== state) {
        releaseCreaturePose(state); // Visual-streaming can clear the entity's pointer without calling stopCreature.
        creatureStates.delete(state);
        pronePoseDiagnostics.retiredOrphans++;
        continue;
      }
      if (state.bank !== 'breakThrow' && state.bank !== 'tumble') continue;
      if (!state.entity.prone) { stopCreature(state.entity); continue; }
      if (!isCurrentCreaturePoseRig(state.entity, state)) {
        updateCreature(state.entity, 0); // A held pose on a discarded sprite is NOT a held pose on the replacement.
        continue;
      }
      if (state.holding) continue;
      const elapsedMs = now - (state.lastPresentationMs ?? now);
      if (!(elapsedMs >= PRONE_ANIMATION_STALL_MS)) continue;
      const before = state.elapsedS;
      updateCreature(state.entity, Math.min(elapsedMs / 1000, 1.25)); // Recover missed animation time, including long throttled frames.
      if (state.entity._impactRagdollPlayback === state) {
        pronePoseDiagnostics.rescuedStalls++;
        pronePoseDiagnostics.lastRescue = {
          bank: state.bank, missedMs: Math.round(elapsedMs), fromSeconds: before,
          toSeconds: state.elapsedS,
        }; // Low-frequency snapshot available without console through ImpactRagdollPlayback.getDebug().
      }
    }
  }

  if (window.RenderHooks?.register) window.RenderHooks.register({
    id: 'creature-prone-pose-rescue',
    owner: 'combat/impact-ragdoll-playback.js',
    order: (window.RenderHooks.ORDER?.ANIMAL_ELEVATION ?? 50) - 1,
    scope: 'frame',
    before: rescueStalledCreaturePronePoses,
  }); // Presentation only: never advances AI, physics, Footing, or a non-prone hit reaction.

  function updateCreature(entity, dt) {
    let state = entity?._impactRagdollPlayback;
    const prone = !!entity?.prone;
    if (state && state.bank !== 'impact' && !prone && !entity?._deathRecordedThrow) {
      stopCreature(entity); // Recover as soon as the gameplay state stands, not after an abandoned throw timer.
      state = null;
    }
    if (state && (!isCurrentCreaturePoseRig(entity, state)
        || (state.poseSession && !state.poseSession.owns()))) {
      stopCreature(entity); // Outdated/overwritten portrait pivot; do not keep a held pose on invisible geometry.
      state = null;
      if (prone) pronePoseDiagnostics.reboundVisuals++;
    }
    if (!state) return prone ? restoreCreaturePronePose(entity) : false;
    if (Number.isFinite(dt) && dt > 0) state.lastPresentationMs = visualNowMs(); // Zero-dt presentation probes must not hide a stalled knockdown from the render rescue.
    if (state.holding) {
      if (!entity.prone) { stopCreature(entity); return true; }
      return true;
    }
    if (state.bank === 'tumble') {
      state.elapsedS += Math.max(0, Number(dt) || 0);
      const t = Math.min(1, state.elapsedS / state.tumbleDurationS);
      const tail = state.clip.frames[state.clip.frames.length - 1];
      const body = tail.ragdoll.body;
      tumbleBaseRotation.set(body.localQuaternion.x, body.localQuaternion.y, body.localQuaternion.z, body.localQuaternion.w);
      tumbleRotation.setFromAxisAngle(state.tumbleAxis, t * Math.PI * 2).multiply(tumbleBaseRotation);
      state.pivot.quaternion.copy(CREATURE_BASIS_QUATERNION).multiply(tumbleRotation).multiply(CREATURE_BASIS_INVERSE);
      state.pivot.position.y = (body.localPosition.y - state.baseBodyY + Math.sin(t * Math.PI) * 0.3) * state.heightScale;
      state.poseSession?.stamp();
      if (t >= 1) {
        if (entity.prone) { state.bank = 'breakThrow'; state.holding = true; applyCreatureFrame(state, tail, tail, 0); }
        else stopCreature(entity);
      }
      return true;
    }

    state.elapsedS += Math.max(0, Number(dt) || 0) * state.playbackRate;
    if (state.elapsedS >= state.clip.durationSeconds) {
      const [lastFrame] = findBracket(state.clip.frames, state.clip.durationSeconds);
      applyCreatureFrame(state, lastFrame, lastFrame, 0);
      if (state.bank === 'breakThrow' && entity.prone) state.holding = true;
      else stopCreature(entity);
      return true;
    }

    const [frameA, frameB, blend] = findBracket(state.clip.frames, state.elapsedS);
    applyCreatureFrame(state, frameA, frameB, blend);
    return true;
  }

  function trigger(bank, direction, opts = {}) {
    const clip = window.ImpactBlendLibrary?.getClip(bank, direction);
    if (!clip || !clip.frames.length) return 0;

    const durationMultiplier = Math.max(0.01, Number(opts.durationMultiplier) || 1);
    playback.active = true;
    playback.holding = false;
    playback.bank = bank;
    playback.direction = direction;
    playback.clip = clip;
    playback.elapsedS = 0;
    playback.playbackRate = 1 / durationMultiplier;
    playback.suppressLocomotion = false;
    playback.recoveryBlend = null;
    recoveryAxis.set(1, 0, 0);
    baseBodyY = Number(clip.frames[0]?.ragdoll?.body?.localPosition?.y) || 0;

    const [frameA, frameB, t] = findBracket(clip.frames, 0);
    applyFrame(frameA, frameB, t);
    return clip.durationSeconds * durationMultiplier;
  }

  // Treat the four cardinal dodge directions as blend poles. Forward/back use
  // opposite X-axis somersaults; right/left use opposite Z-axis side rolls.
  // A diagonal dodge weights its two adjacent poles, producing one normalized
  // intermediate roll axis instead of snapping between four discrete clips.
  function setRecoveryDirectionBlend(player, suppressLocomotion) {
    if (!suppressLocomotion) {
      playback.recoveryBlend = { forward: 1, backward: 0, left: 0, right: 0 };
      recoveryAxis.set(1, 0, 0);
      return;
    }

    let dx = Number(player?.dodgeDirX) || 0;
    let dy = Number(player?.dodgeDirY) || 0;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 1e-6) {
      dx /= magnitude;
      dy /= magnitude;
    } else {
      // performDodge normally supplies a direction even from rest. Preserve the
      // old forward somersault as the safe fallback if a future caller does not.
      dx = 0;
      dy = -1;
    }

    const forward = Math.max(0, -dy); // Negative map-Y is the forward/up dodge pole.
    const backward = Math.max(0, dy); // Positive map-Y is the backward/down dodge pole.
    const left = Math.max(0, -dx); // Negative map-X supplies the left side-roll pole.
    const right = Math.max(0, dx); // Positive map-X supplies the right side-roll pole.
    playback.recoveryBlend = { forward, backward, left, right };

    recoveryAxis.set(
      forward - backward,
      0,
      right - left
    );
    if (recoveryAxis.lengthSq() < 1e-8) recoveryAxis.set(1, 0, 0);
    else recoveryAxis.normalize();
  }

  // Recovery rolls started from ordinary movement suppress the procedural
  // gait; prone recovery keeps its existing held ragdoll leg pose and +X roll.
  function beginRecoveryArc(durationS, onComplete, opts = {}) {
    const player = window.Combat?.deps?.player;
    playback.active = true;
    playback.holding = false;
    playback.bank = 'recovery';
    playback.clip = null;
    playback.elapsedS = 0;
    playback.recoveryDurationS = Math.max(0.05, Number(durationS) || 0.5);
    playback.recoveryOnComplete = typeof onComplete === 'function' ? onComplete : null;
    playback.suppressLocomotion = opts.suppressLocomotion === true || !player?.prone;
    setRecoveryDirectionBlend(player, playback.suppressLocomotion);
  }

  function updateTumble(dt) {
    playback.elapsedS += Math.max(0, Number(dt) || 0);
    const t = Math.min(1, playback.elapsedS / playback.tumbleDurationS);
    const tail = playback.clip.frames[playback.clip.frames.length - 1];
    const body = tail.ragdoll.body;
    tumbleBaseRotation.set(body.localQuaternion.x, body.localQuaternion.y, body.localQuaternion.z, body.localQuaternion.w);
    tumbleRotation.setFromAxisAngle(tumbleAxis, t * Math.PI * 2).multiply(tumbleBaseRotation);
    publishBodyPose(tumbleRotation, body.localPosition.y - baseBodyY + Math.sin(t * Math.PI) * 0.3);
    if (t >= 1) {
      if (window.Combat?.deps?.player?.prone) {
        playback.bank = 'breakThrow'; playback.holding = true;
        applyFrame(tail, tail, 0); // Restore the real held pose and recorded leg bend, not a guessed standing reset.
      } else stop();
    }
  }

  function updateRecoveryArc(dt) {
    if (playback.suppressLocomotion && playerLegsRef?.update) {
      playerLegsRef.update(dt, 0, true, false);
    }

    playback.elapsedS += dt;
    const t = Math.min(1, playback.elapsedS / playback.recoveryDurationS);
    const eased = t * t * (3 - 2 * t);
    const recoveryQuat = new THREE.Quaternion().setFromAxisAngle(
      recoveryAxis,
      Math.PI * 2 * (1 - eased)
    );
    publishBodyPose(recoveryQuat, Math.sin(Math.PI * t) * 0.12);

    if (t >= 1) {
      const callback = playback.recoveryOnComplete;
      stop();
      callback?.();
    }
  }

  function update(dt) {
    if (!playback.active) return;
    if (playback.bank === 'recovery') {
      updateRecoveryArc(dt);
      return;
    }
    if (playback.bank === 'tumble') {
      updateTumble(dt);
      return;
    }
    if (playback.holding) return;

    playback.elapsedS += dt * playback.playbackRate;
    const clip = playback.clip;
    if (!clip) {
      stop();
      return;
    }

    if (playback.elapsedS >= clip.durationSeconds) {
      const [lastFrame] = findBracket(clip.frames, clip.durationSeconds);
      applyFrame(lastFrame, lastFrame, 0);
      if (playback.bank === 'breakThrow') playback.holding = true;
      else stop();
      return;
    }

    const [frameA, frameB, t] = findBracket(clip.frames, playback.elapsedS);
    applyFrame(frameA, frameB, t);
  }

  function stop() {
    playback.active = false;
    playback.holding = false;
    playback.clip = null;
    playback.suppressLocomotion = false;
    playback.recoveryBlend = null;
    recoveryAxis.set(1, 0, 0);
    window.PlayerBodyTransformComposer?.clearChannel(BODY_CHANNEL);
  }

  function isActive() {
    return playback.active;
  }

  function isHolding() {
    return playback.holding;
  }

  function currentDirection() {
    return playback.direction;
  }

  function getDebug() {
    return {
      active: playback.active,
      bank: playback.bank,
      direction: playback.direction,
      suppressLocomotion: playback.suppressLocomotion,
      recoveryBlend: playback.recoveryBlend ? { ...playback.recoveryBlend } : null,
      recoveryAxis: { x: recoveryAxis.x, y: recoveryAxis.y, z: recoveryAxis.z },
      activeCreatureReactions: creatureStates.size,
      activeCreaturePronePoses: [...creatureStates].filter(state => state.entity?.prone).length, // Requested only by the existing on-device debug snapshot.
      pronePoseRescue: { ...pronePoseDiagnostics },
    };
  }

  window.ImpactRagdollPlayback = {
    attach,
    holdHumanoidProne, clearHumanoidProne,
    trigger,
    triggerTumble,
    update,
    beginRecoveryArc,
    stop,
    isActive,
    isHolding,
    currentDirection,
    triggerCreature,
    startCreatureDeath, sampleCreatureDeath, stopCreatureDeath,
    updateCreature,
    stopCreature,
    getDebug,
  };
})();
