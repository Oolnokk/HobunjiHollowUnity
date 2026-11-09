// Spouse kiss — shared height solver and in-world two-actor motion.
// The Multi-Avatar Animation Author consumes solveHeights/samplePose too, so its
// default kiss timeline has the same timing and body-sink percentages as gameplay.
(() => {
  'use strict';
  if (window.SpouseKissMotion) return;

  const DURATION_S = 2.4; // Used by the editor timeline and the live contact/exit sequence.
  const MOUTH_HEIGHT_FRACTION = .82; // Floor-relative portrait mouth proxy; scaled by actual rig height.
  const MAX_SINK_PCT = 82; // Upper safety cap; the actual knee limit is based on the leg rig, not this percent alone.
  const KNEEL_LEG_FRACTION = .95; // Spouse-only deep-kneel limit; regular stances retain their original 55%.
  const MAX_BOW_DEG = 89.5; // At extreme height ratios the larger spouse must nearly lie forward, without sinking below the floor.
  const MAX_DISTANCE = .95; // A deliberate close-range action; avoids sliding partners through distant obstacles.
  const SOURCE = 'spouse-kiss'; // Composer/input-claim ownership; never replaces other effect owners.
  const COMFORTABLE_BOW_DEG = 35; // Couples prefer a supported, posterior-straddling hop over an extreme neck-to-waist bow.
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const ease = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
  let active = null; // Contains the locked pair until the 2.4-second interaction ends.
  let lastError = null; // Exposed through diagnostics for touch-only debugging.
  let lastResult = null; // Exposed through diagnostics after a completed or interrupted kiss.
  let schedulerInstalled = false; // Avoids duplicate pre-render callbacks on repeated init.

  function solveHeights(firstHeight, secondHeight, options = {}) {
    const first = Math.max(.001, finite(firstHeight, 1)); // Real rendered height of the first character.
    const second = Math.max(.001, finite(secondHeight, 1)); // Real rendered height of the second character.
    const taller = first >= second ? 'first' : 'second'; // Only the physically taller partner kneels and bows.
    const tall = Math.max(first, second);
    const short = Math.min(first, second);
    const tallMouth = tall * MOUTH_HEIGHT_FRACTION;
    const shortMouth = short * MOUTH_HEIGHT_FRACTION;
    const hipHeight = clamp(finite(options.tallerHipHeightWorld, tall * .28), .001, tallMouth); // Ground-to-posterior height from the real leg handle.
    const legLength = Math.max(.001, finite(options.tallerLegLengthWorld, hipHeight)); // Anatomical leg length controls actual stance limits.
    const kneeLimit = Math.min(legLength * KNEEL_LEG_FRACTION, tall * MAX_SINK_PCT / 100);
    const requestedDrop = Math.max(0, tallMouth - shortMouth);
    let kneeDrop = Math.min(requestedDrop, kneeLimit); // Ordinary couples keep the existing grounded kneel.
    const torsoLength = Math.max(.001, tallMouth - hipHeight);
    const maxBow = MAX_BOW_DEG * Math.PI / 180;
    let bowRad = Math.acos(clamp(1 - Math.max(0, requestedDrop - kneeDrop) / torsoLength, Math.cos(maxBow), 1));
    let shorterJumpWorld = 0; // A positive value lifts the shorter pelvis/mouth onto the taller partner's posterior.
    let shorterPosteriorGrip = false; // Used by the author and gameplay to own the same two independent foot targets.
    const shorterHip = clamp(finite(options.shorterHipHeightWorld, short * .28), .001, shortMouth); // Real short-partner pelvis where available.
    const shorterLeg = Math.max(.001, finite(options.shorterLegLengthWorld, shorterHip)); // Bounds physically possible hip-to-foot IK.
    const posteriorDifference = Math.max(0, hipHeight - shorterHip); // Target lift to put both pelvises at the same height.
    const straddleBowDrop = requestedDrop - posteriorDifference; // Bending closes the remaining difference between torso lengths.
    const straddleBow = Math.acos(clamp(1 - Math.max(0, straddleBowDrop) / torsoLength, Math.cos(maxBow), 1));
    const ratio = short / tall; // Avoid impossible giant-to-speck foot contact; the original deep bow remains the fallback.
    if (ratio >= .27 && ratio < .72 && bowRad > COMFORTABLE_BOW_DEG * Math.PI / 180 &&
        posteriorDifference > .02 * tall && straddleBowDrop >= 0 &&
        straddleBowDrop <= torsoLength * (1 - Math.cos(maxBow))) {
      // Raising the smaller character's pelvis to the larger posterior makes
      // both feet capable of straddling that landmark while the tall torso
      // bends down just enough to align the mouths. Kneeling reduces jump height.
      const supportingKnee = Math.min(kneeLimit,
        Math.max(posteriorDifference * .40, posteriorDifference - short * .75)); // Keeps a hop below 75% of the shorter avatar's height.
      const proposedJump = posteriorDifference - supportingKnee;
      if (proposedJump > Math.max(.015, short * .035) &&
          proposedJump <= short * .75 + .00001 && shorterLeg > .03 * tall) {
        kneeDrop = supportingKnee;
        bowRad = straddleBow;
        shorterJumpWorld = proposedJump;
        shorterPosteriorGrip = true;
      }
    }
    const bowDrop = torsoLength * (1 - Math.cos(bowRad));
    const remainingGap = Math.max(0, requestedDrop - kneeDrop - bowDrop - shorterJumpWorld);
    return {
      taller, firstHeight: first, secondHeight: second,
      mouthHeightRatio: MOUTH_HEIGHT_FRACTION,
      tallerSinkWorld: kneeDrop, tallerSinkPct: kneeDrop / tall * 100,
      shorterSinkPct: 0, tallerBowDeg: bowRad * 180 / Math.PI,
      tallerBowForwardWorld: torsoLength * Math.sin(bowRad),
      shorterJumpWorld, shorterPosteriorGrip, shorterLegLengthWorld: shorterLeg,
      shorterHipHeightWorld: shorterHip, tallerHipHeightWorld: hipHeight,
      jumpFootSpreadWorld: Math.min(shorterLeg * .36, short * .10, tall * .075), // Feet bracket the actual tall-posterior X coordinate.
      jumpFootForwardWorld: Math.min(shorterLeg * .15, short * .035), // Surface depth toward the partner's facing side.
      torsoLengthWorld: torsoLength, legLengthWorld: legLength,
      kneeLimitWorld: kneeLimit, remainingGap,
      pose: shorterPosteriorGrip ? 'posterior-hop' :
        bowRad > .72 ? 'deep-bow' : kneeDrop / tall > .18 ? 'deep-kneel' : kneeDrop > .001 ? 'crouch' : 'lean',
      contactPossible: remainingGap < Math.max(.025, short * .01),
    };
  }

  function samplePose(seconds) {
    const time = clamp(finite(seconds), 0, DURATION_S); // Shared editor/runtime timeline position.
    const blend = time <= .82 ? ease(time / .82) : time <= 1.52 ? 1 : ease((DURATION_S - time) / .88);
    return { time, durationS: DURATION_S, blend, touch: time >= 1.02 && time <= 1.52 };
  }

  function sampleJumpBlend(seconds) {
    const time = clamp(finite(seconds), 0, DURATION_S); // Normal-sized partners never use this pose, even though its timeline exists.
    if (time <= .52 || time >= 2.25) return 0;
    if (time < 1.02) return ease((time - .52) / .50); // Take off after the earlier shoulder grip and while the partner kneels.
    if (time <= 1.52) return 1; // Both feet straddle the posterior during mouth contact.
    return ease((2.25 - time) / .73); // Descend and recover the ordinary grounded stance.
  }

  function posteriorStraddleFootTargets(THREE, tallerLegs, shorterLegs, solution, jumpBlend, scratch = null) {
    if (!THREE?.Vector3 || !tallerLegs?.group?.localToWorld || !shorterLegs?.group?.localToWorld ||
        !solution?.shorterPosteriorGrip || jumpBlend <= 0) return null;
    const temp = scratch || {}; // Reusable world-space vectors prevent GC during gameplay's pre-render callback.
    const tallStance = tallerLegs.getRestStance?.();
    const shortStance = shorterLegs.getRestStance?.();
    if (!tallStance?.left?.hip || !tallStance?.right?.hip ||
        !shortStance?.left?.ankle || !shortStance?.right?.ankle) return null;
    const pelvisX = (tallStance.left.hip.x + tallStance.right.hip.x) / 2; // Authored posterior center between the tall rig's hip pivots.
    const posteriorHalfWidth = Math.max(.001, Math.abs(tallStance.left.hip.x - pelvisX),
      Math.abs(tallStance.right.hip.x - pelvisX)); // Bounded lateral placement on the taller character's genuine posterior, not an imaginary infinite platform.
    const kneeDrop = tallerLegs.getStanceDrop?.() || 0;
    const hipY = (Number(tallStance.left.hip.y) + Number(tallStance.right.hip.y)) / 2; // Actual authored posterior bone coordinate in the existing leg group.
    const pelvisLocalY = (Number.isFinite(hipY) ? hipY : tallerLegs.standingPosteriorY - kneeDrop)
      + (Number.isFinite(Number(temp.posteriorLocalOffsetY)) ? Number(temp.posteriorLocalOffsetY) : 0);
    // Gameplay NPCs lower their entire rig root while knees fold, so bone
    // coordinates already track the posterior. The author lowers only its
    // portrait; it supplies an extra -kneeDrop preview offset explicitly.
    tallerLegs.group.updateWorldMatrix?.(true, false);
    shorterLegs.group.updateWorldMatrix?.(true, false);
    const composerLift = !!temp.composerLift; // Gameplay player composer applies the leap only during render; editor/NPC roots move immediately.
    const out = temp.targets || (temp.targets = { left: new THREE.Vector3(), right: new THREE.Vector3() });
    for (const side of ['left', 'right']) {
      const grip = temp[side + 'Grip'] || (temp[side + 'Grip'] = new THREE.Vector3()); // Posterior-straddle target in the larger rig's anatomical frame.
      const ground = temp[side + 'Ground'] || (temp[side + 'Ground'] = new THREE.Vector3()); // Ground foot at this actor's current horizontal approach position.
      const otherSide = side === 'left' ? 1 : -1; // Fallback for minimal legacy or test-only leg handles without world-coordinate support.
      const shortHip = shortStance[side].hip;
      const projectedHip = temp[side + 'HipProjected'] || (temp[side + 'HipProjected'] = new THREE.Vector3()); // Real short-partner hip in the tall posterior's own frame.
      let localFootX = pelvisX + otherSide * solution.jumpFootSpreadWorld;
      if (shortHip && typeof tallerLegs.group.worldToLocal === 'function') {
        projectedHip.set(shortHip.x, shortHip.y, shortHip.z);
        shorterLegs.group.localToWorld(projectedHip);
        tallerLegs.group.worldToLocal(projectedHip);
        const lateral = projectedHip.x - pelvisX; // Same-side contact prevents crossing legs and exceeding the short character's lateral reach.
        const tallScale = tallerLegs.group.getWorldScale?.(temp.tallWorldScale || (temp.tallWorldScale = new THREE.Vector3(1,1,1)));
        const scaleX = Math.max(.001, Math.abs(tallScale?.x || 1));
        const minimumSpread = solution.jumpFootSpreadWorld / scaleX;
        const spread = Math.min(posteriorHalfWidth, Math.max(minimumSpread, Math.abs(lateral)));
        localFootX = pelvisX + Math.sign(lateral || otherSide) * spread; // Feet bracket the posterior, matching short hip sockets whenever feasible.
      }
      grip.set(localFootX, pelvisLocalY, solution.jumpFootForwardWorld);
      tallerLegs.group.localToWorld(grip);
      const ankle = shortStance[side].ankle;
      ground.set(ankle.x, ankle.y, ankle.z);
      shorterLegs.group.localToWorld(ground);
      // NPC/editor roots already follow their jumping pelvis: the idle ankle
      // must start at its CURRENT airborne position, not be pulled down to the
      // old ground. Otherwise both calves overstretch during release.
      out[side].copy(ground).lerp(grip, jumpBlend); // Interpolate from a body-relative dangling foot into genuine posterior contact.
      if (composerLift) out[side].y -= solution.shorterJumpWorld * jumpBlend; // Player composer applies its own lift only inside render; countertranslate the temporary IK target.
      if (jumpBlend < .999 && shortStance[side]?.hip) {
        // During takeoff/landing the ankle is still IN FLIGHT, so it must not
        // be forced to follow a straight line through an unreachable point.
        // Retract that interim target towards the real hip; at complete
        // contact the posterior target is retained exactly (and validated).
        const hip = shortStance[side].hip;
        const hipWorld = temp[side + 'HipWorld'] || (temp[side + 'HipWorld'] = new THREE.Vector3());
        hipWorld.set(hip.x, hip.y, hip.z);
        shorterLegs.group.localToWorld(hipWorld);
        const shortScale = shorterLegs.group.getWorldScale?.(
          temp.shortScale || (temp.shortScale = new THREE.Vector3(1,1,1))
        );
        const span = Math.abs((Number(hip.y) || 0) - (Number(ankle.y) || 0));
        const maxReach = Math.max(.001, span * Math.max(.001, Math.abs(shortScale?.y || 1)) * .995);
        const distance = out[side].distanceTo(hipWorld);
        if (distance > maxReach) out[side].sub(hipWorld).multiplyScalar(maxReach / distance).add(hipWorld); // Actual two-bone knees remain shorter than their authored length.
      }
    }
    return out;
  }

  // Used by both the author and live kiss to separate the early hand gesture
  // from the taller partner's knee bend when the initiator is shorter.
  function sampleKneelBlend(seconds, initiatorShorter = false) {
    const pose = samplePose(seconds); // Same contact and release windows as the existing lip animation.
    if (!initiatorShorter) return pose.blend;
    const lowering = ease((pose.time - .52) / .30); // Hands reach at .14–.36 s; the taller partner begins kneeling only after .52 s.
    return Math.min(lowering, pose.time <= 1.52 ? 1 : pose.blend);
  }

  function sampleInitiatorHandReach(seconds, initiatorShorter, shoulderDistance, armReach) {
    const pose = samplePose(seconds); // Time drives the gesture deterministically while scrubbing either direction.
    const distance = Math.max(0, finite(shoulderDistance, Infinity));
    const reach = Math.max(.001, finite(armReach, .001));
    const released = pose.time > 1.52 ? ease((DURATION_S - pose.time) / .48) : 1;
    const early = ease((pose.time - .13) / .24); // Short initiator extends hands before the taller one bends.
    const reachable = distance <= reach; // Tall initiator waits until torso lowering brings the other shoulders within actual reach.
    const tallBlend = reachable ? ease((reach - distance) / Math.max(.008, reach * .07)) : 0;
    const grip = (initiatorShorter ? early : tallBlend) * released; // Tall initiators move hands on the first reachable frame as their torso lowers.
    return { blend: clamp(grip, 0, 1), reachable, closestDistance: Math.max(0, distance - reach) };
  }

  function resolveShoulderGripWorld(sourceShoulderWorld, targetShoulderWorld, reachWorld, output, torsoVector = null) {
    if (!sourceShoulderWorld?.isVector3 || !targetShoulderWorld?.isVector3 || !output?.isVector3) return false;
    const distance = sourceShoulderWorld.distanceTo(targetShoulderWorld);
    const limit = Math.max(.001, finite(reachWorld, .001)) * .98; // Reserve elbow bend and forbid overextension beyond the species/gender arm length.
    output.copy(targetShoulderWorld);
    if (distance <= limit) return { targetDistance: distance, armReach: limit, exactShoulder: true, onTorso: false };
    if (torsoVector?.isVector3 && torsoVector.lengthSq() > 1e-8) {
      // An initiator too short for the shoulder may rest the hands on the
      // highest reachable point DOWN THE PARTNER'S ACTUAL UPPER TORSO.
      // Intersect the arm-reach sphere with the shoulder-to-chest segment,
      // never float a wrist at the edge of an imaginary spherical guide.
      const dx = targetShoulderWorld.x - sourceShoulderWorld.x;
      const dy = targetShoulderWorld.y - sourceShoulderWorld.y;
      const dz = targetShoulderWorld.z - sourceShoulderWorld.z;
      const a = torsoVector.lengthSq();
      const b = 2 * (dx * torsoVector.x + dy * torsoVector.y + dz * torsoVector.z);
      const c = distance * distance - limit * limit;
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const t = (-b - Math.sqrt(discriminant)) / (2 * a);
        if (t >= 0 && t <= 1) {
          output.addScaledVector(torsoVector, t);
          return { targetDistance: distance, armReach: limit, exactShoulder: false, onTorso: true,
            shoulderOffsetWorld: Math.sqrt(a) * t };
        }
      }
    }
    output.sub(sourceShoulderWorld).multiplyScalar(limit / distance).add(sourceShoulderWorld);
    return { targetDistance: distance, armReach: limit, exactShoulder: false, onTorso: false };
  }

  function shoulderGripWorld(rig, side, output) {
    if (!rig?.shoulderPositionLocal || !rig.parent?.localToWorld || !output) return false;
    rig.parent.updateWorldMatrix?.(true, false);
    const local = rig.shoulderPositionLocal(side, output);
    if (!local) return false;
    rig.parent.localToWorld(output);
    return true;
  }

  function applyInitiatorShoulderHands(initiatorRig, targetRig, time, initiatorShorter, scratch = null) {
    const THREE = scratch?.THREE || window.THREE; // Animation Author loads Three as a module; gameplay exposes window.THREE.
    if (!THREE?.Vector3 || !THREE?.Quaternion || !initiatorRig?.placeHandWorld ||
        !initiatorRig?.armLengthForSide || !targetRig?.shoulderPositionLocal) return { applied: false, reason: 'hand-rigs-not-ready' };
    const geometry = scratch || {}; // Caller can reuse a fixed two-hand scratch structure across render frames.
    const scale = initiatorRig.parent.getWorldScale(geometry.scale || (geometry.scale = new THREE.Vector3()));
    const worldScale = Math.max(.001, Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)));
    let applied = 0; // Number of hands successfully solved this frame; reported by mobile diagnostics.
    let closestGap = 0; // Largest unavailable exact-shoulder distance after anatomical reach clamping.
    let surfaceContacts = 0; // Counts nearest reachable upper-torso surfaces rather than floating arm reach boundaries.
    let minGrip = 1; // Paired hand engagement for the author/readout.
    let exactContacts = 0; // Counts true shoulder coordinates rather than closest reachable upper-torso placements.
    let maxWristReach = 0; // Farthest final wrist distance from its own shoulder, used to detect overextension.
    let unreachableSurfaces = 0; // Counts hand targets that cannot be reached even along the partner's torso.
    initiatorRig.useIdlePose?.(); // Reset both hands ONCE, or the right-hand solve would undo the left-hand shoulder grip.
    const torsoVector = geometry.torsoVector || (geometry.torsoVector = new THREE.Vector3());
    const torsoQuaternion = geometry.torsoQuaternion || (geometry.torsoQuaternion = new THREE.Quaternion());
    const torsoScale = targetRig.parent.getWorldScale(geometry.torsoScale || (geometry.torsoScale = new THREE.Vector3()));
    const torsoLength = Math.max(.01, finite(targetRig.avatarRoot?.userData?.portraitModelHeight, 1) *
      Math.abs(torsoScale.y) * .38); // Upper-shoulder-to-chest fallback, never the pelvis or legs.
    targetRig.parent.getWorldQuaternion(torsoQuaternion);
    torsoVector.set(0, -torsoLength, 0).applyQuaternion(torsoQuaternion); // Down the actual bowed torso, not always down world Y.
    for (const side of ['left', 'right']) {
      const other = side === 'left' ? 'right' : 'left'; // Face-to-face actors put opposite anatomical hands at the visible shoulders.
      const data = geometry[side] || (geometry[side] = {
        source: new THREE.Vector3(), target: new THREE.Vector3(), grip: new THREE.Vector3(),
        idle: new THREE.Vector3(), orientation: new THREE.Quaternion(),
      }); // Reused world-space shoulder and hand vectors for each side.
      if (!shoulderGripWorld(initiatorRig, side, data.source) ||
          !shoulderGripWorld(targetRig, other, data.target)) continue;
      const reach = Math.max(.001, finite(initiatorRig.armLengthForSide(side), .001)) * worldScale;
      const result = resolveShoulderGripWorld(data.source, data.target, reach, data.grip,
        initiatorShorter ? torsoVector : null); // Short initiators reach nearest upper-body surface; tall initiators wait for true shoulders.
      if (!result) continue;
      // A short initiator can touch a reachable chest/upper-torso point before
      // the taller spouse kneels. If no real surface intersects the arm's reach,
      // wait rather than planting a hand in midair at the reach sphere's edge.
      const surfaceReachable = result.exactShoulder || result.onTorso; // Only anatomical contact points count as a planted hand.
      const gesture = sampleInitiatorHandReach(time, initiatorShorter, result.targetDistance, result.armReach);
      if (!surfaceReachable) {
        gesture.blend = 0;
        unreachableSurfaces++;
      }
      const socket = initiatorRig.group?.getObjectByName?.(side + '_hand_socket');
      if (!socket) continue;
      socket.getWorldPosition(data.idle);
      socket.getWorldQuaternion(data.orientation);
      data.grip.lerpVectors(data.idle, data.grip, gesture.blend);
      if (gesture.blend > 0) {
        initiatorRig.placeHandWorld(side, data.grip, data.orientation);
        applied++;
        if (result.exactShoulder) exactContacts++;
        if (result.onTorso) surfaceContacts++;
        maxWristReach = Math.max(maxWristReach, data.source.distanceTo(data.grip));
      }
      closestGap = Math.max(closestGap, result.targetDistance - result.armReach);
      minGrip = Math.min(minGrip, gesture.blend);
    }
    return { applied: applied === 2, hands: applied, blend: applied ? minGrip : 0, closestGap,
      torsoContacts: surfaceContacts, exactShoulderContacts: exactContacts,
      maxWristReach, unreachableSurfaces }; // Mobile diagnostics distinguish genuine shoulder contact from reachable chest contact.
  }

  function actorHeight(model, legs, root) {
    const local = Math.max(.05, finite(model?.userData?.portraitModelHeight, finite(legs?.modelHeight, 1))); // Render metadata includes species and gender proportions.
    const THREE = window.THREE;
    const visualRoot = model?.getWorldScale ? model : legs?.group?.getWorldScale ? legs.group : root; // NPC size scale lives below walker.root.
    const scale = THREE?.Vector3 && visualRoot?.getWorldScale ? visualRoot.getWorldScale(new THREE.Vector3()) : null;
    return local * Math.max(.01, Math.abs(finite(scale?.y, 1)));
  }

  function anatomyWorld(legs, fallbackHeight) {
    const T = window.THREE;
    const scale = T?.Vector3 && legs?.group?.getWorldScale ? legs.group.getWorldScale(new T.Vector3()) : null;
    const worldScale = Math.max(.01, Math.abs(finite(scale?.y, 1))); // Converts local procedural-leg lengths to world units.
    const records = legs?.motionAnatomy?.();
    const localLegLength = Array.isArray(records) && records.length
      ? Math.min(...records.map(record => Math.max(.001, finite(record.length, .001))))
      : Math.max(.001, finite(legs?.standingPosteriorY, fallbackHeight * .28)); // Only used while old rig handles finish attaching.
    const hip = Math.max(.001, finite(legs?.standingPosteriorY, localLegLength));
    return { legLengthWorld: localLegLength * worldScale, hipHeightWorld: hip * worldScale, worldScale };
  }

  function scenePoint(root) {
    const THREE = window.THREE;
    return root.getWorldPosition(new THREE.Vector3());
  }

  function clearMotion(reason) {
    const old = active;
    if (!old) return false;
    active = null;
    try {
      window.PlayerBodyTransformComposer?.clearChannel?.(SOURCE);
      window.PlayerBodyTransformComposer?.clearChannel?.(SOURCE + '-retreat');
      old.playerHands?.setPoseProvider?.(SOURCE, null);
      old.playerHands?.useIdlePose?.(); // Restores held-tool/idle ownership instead of leaving wrists glued to the spouse's shoulders.
      old.playerLegs?.setExternalFootTargets?.(null); // Release externally planted posterior feet on cancel, spouse switch, or completion.
      old.npcLegs?.setExternalFootTargets?.(null);
      old.playerLegs?.setStanceDrop?.(0, true);
      if (old.npcSink && window.ActorBodySink?.apply) window.ActorBodySink.apply(old.npcSink, 0, 0, true);
      old.playerLegs?.setStanceDropLimitFraction?.(old.originalPlayerKneeLimit);
      old.npcLegs?.setStanceDropLimitFraction?.(old.originalNpcKneeLimit);
      if (old.npcTiltPivot?.rotation && Number.isFinite(old.originalNpcTiltX)) old.npcTiltPivot.rotation.x = old.originalNpcTiltX;
      if (old.walker?.root?.parent === old.npcParent) {
        old.walker.root.position.y = old.originalNpcPosition.y; // Restore world-floor elevation after the small partner's hop.
        old.walker.root.rotation.y = old.originalNpcYaw;
        old.walker.root.position.x = old.originalNpcPosition.x; // Restores the approach displacement, including early dodge.
        old.walker.root.position.z = old.originalNpcPosition.z;
      }
      if (old.npcNeck && old.originalNpcNeck) old.npcNeck.quaternion.copy(old.originalNpcNeck);
      if (old.playerNeck && old.originalPlayerNeck) old.playerNeck.quaternion.copy(old.originalPlayerNeck);
    } finally {
      old.lock?.release?.();
      window.WorldActionInputClaims?.clearClaims?.(SOURCE);
    }
    lastResult = { reason, npcId: old.walker?.rec?.id || null, touched: old.touched, height: old.height, elapsedS: old.elapsed };
    return true;
  }

  function start(walker, onContact) {
    if (active) { lastError = 'already-kissing'; return false; }
    if (!walker?.rec?.id || !walker?.root?.parent || walker.root.visible === false) {
      lastError = 'spouse-unavailable'; return false;
    }
    if (window.CinematicCameraRuntime?.isActive?.() || window.FestivalWheelDanceRuntime?.isActive?.()) {
      lastError = 'another-paired-animation-active'; return false;
    }
    if (window.CharacterActionLocks?.isLocked?.('player', 'movement')) {
      lastError = 'player-busy'; return false;
    }
    const composer = window.PlayerBodyTransformComposer;
    const player = composer?.getPlayerMesh?.();
    const playerLegs = composer?.getPlayerLegHandle?.();
    const npcLegs = walker.legs;
    if (!window.THREE?.Vector3 || !window.ActorBodySink?.apply || !player?.parent ||
        !playerLegs?.setStanceDrop || !npcLegs?.setStanceDrop) {
      lastError = 'paired-rigs-not-ready'; return false;
    }
    player.updateWorldMatrix(true, false);
    walker.root.updateWorldMatrix(true, false);
    const playerPoint = scenePoint(player); // Actual player world position, not a tile rounded to the NPC grid.
    const npcPoint = scenePoint(walker.root);
    const dist = Math.hypot(playerPoint.x - npcPoint.x, playerPoint.z - npcPoint.z);
    if (dist > MAX_DISTANCE || Math.abs(playerPoint.y - npcPoint.y) > .5) {
      lastError = 'spouse-too-far-or-on-different-floor'; return false;
    }
    const npcRigRoot = walker.root.getObjectByName?.('npc_character_rig_root');
    if (!npcRigRoot) { lastError = 'spouse-body-rig-not-ready'; return false; }
    const firstHeight = actorHeight(player, playerLegs, player);
    const secondHeight = actorHeight(walker.avatarGroup, npcLegs, walker.root);
    const playerAnatomy = anatomyWorld(playerLegs, firstHeight);
    const npcAnatomy = anatomyWorld(npcLegs, secondHeight);
    const isPlayerTaller = firstHeight >= secondHeight;
    const tallAnatomy = isPlayerTaller ? playerAnatomy : npcAnatomy;
    const shortAnatomy = isPlayerTaller ? npcAnatomy : playerAnatomy; // Small partner's real hip height and leg length decide whether a supported jump is feasible.
    const height = solveHeights(firstHeight, secondHeight, {
      tallerLegLengthWorld: tallAnatomy.legLengthWorld,
      tallerHipHeightWorld: tallAnatomy.hipHeightWorld,
      shorterLegLengthWorld: shortAnatomy.legLengthWorld,
      shorterHipHeightWorld: shortAnatomy.hipHeightWorld,
    });
    if (!height.contactPossible) { lastError = 'mouth-height-not-reachable'; return false; }
    const normalGap = .12 + Math.min(firstHeight, secondHeight) * .10; // Keep the established game spacing for couples standing on their own feet.
    const jumpGap = height.jumpFootForwardWorld + height.shorterLegLengthWorld * .18; // Supported posterior hops need the smaller pelvis close enough to reach both foot targets.
    const contactGap = Math.min(dist, height.shorterPosteriorGrip
      ? Math.min(normalGap, Math.max(.006, jumpGap)) : normalGap); // Only a mounted posterior contact approaches closer than the normal collision-safe kiss.
    const approach = Math.max(0, dist - contactGap); // Move only the spouse, so player collider and camera stay stable.
    const approachX = dist > .0001 ? (playerPoint.x - npcPoint.x) * approach / dist : 0;
    const approachZ = dist > .0001 ? (playerPoint.z - npcPoint.z) * approach / dist : 0;
    // A bow swings the mouth forward. The taller body needs room to retreat
    // instead of sweeping its head through walls or a second character.
    const tallerPoint = isPlayerTaller ? playerPoint : npcPoint;
    const retreatHeading = isPlayerTaller
      ? Math.atan2(npcPoint.x - playerPoint.x, npcPoint.z - playerPoint.z)
      : Math.atan2(playerPoint.x - npcPoint.x, playerPoint.z - npcPoint.z);
    const walkable = window.NpcPathfinding?.isNpcPositionWalkable;
    if (!height.shorterPosteriorGrip && height.tallerBowForwardWorld > .05 && typeof walkable === 'function' && walker.area) {
      const distance = height.tallerBowForwardWorld;
      const steps = Math.max(1, Math.ceil(distance / .3)); // One-time corridor clearance check, not a frame-loop path search.
      for (let i = 1; i <= steps; i++) {
        const length = distance * i / steps;
        if (walkable(walker.area, tallerPoint.x - Math.sin(retreatHeading) * length,
          tallerPoint.z - Math.cos(retreatHeading) * length) === false) {
          lastError = 'not-enough-clear-floor-for-deep-bow';
          return false;
        }
      }
    }

    const npcSink = { legs: npcLegs, lower: [{ obj: npcRigRoot, factor: () => npcRigRoot.scale?.y || 1 }] };
    const npcTiltPivot = walker._npcRunLeanPivot || (walker.avatarGroup?.parent?.name === 'npc_run_lean_visual'
      ? walker.avatarGroup.parent : walker.avatarGroup); // The existing portrait lean pivot keeps the legs out of the torso bow.
    if (height.taller === 'second' && height.tallerBowDeg > 1 && !npcTiltPivot?.rotation) {
      lastError = 'spouse-bow-rig-not-ready'; return false;
    }
    const playerNeck = player.userData?.neckRig?.neckJoint || null;
    const npcNeck = walker.avatarGroup?.userData?.neckRig?.neckJoint || null;
    const lock = window.CharacterActionLocks?.acquire?.({
      owner: SOURCE, reason: 'Kissing spouse', timeoutMs: 20000, // The world lock outlives low-FPS playback; normal cleanup releases it in 2.4 simulation seconds.
      participants: [
        { id: 'player', channels: ['movement', 'tools', 'facing', 'head'] }, // A pose lock bypasses PlayerBodyTransformComposer; keep its kiss channel active.
        { id: window.NpcCharacterState?.participantId?.(walker.rec.id) || 'npc:' + walker.rec.id,
          channels: ['movement', 'tools', 'actions', 'pose', 'facing', 'head'] },
      ],
    });
    const playerHands = player.userData?.proceduralHandRig || null; // The initiator is always the player in this spouse command.
    const npcHands = walker.avatarGroup?.userData?.proceduralHandRig || null; // Real species/gender shoulder anchors on the spouse.
    const originalPlayerKneeLimit = playerLegs.setStanceDropLimitFraction?.(KNEEL_LEG_FRACTION) ?? .55;
    const originalNpcKneeLimit = npcLegs.setStanceDropLimitFraction?.(KNEEL_LEG_FRACTION) ?? .55;
    active = {
      walker, player, playerLegs, npcLegs, npcRigRoot, npcSink, composer,
      npcTiltPivot, originalNpcTiltX: npcTiltPivot?.rotation?.x,
      originalPlayerKneeLimit, originalNpcKneeLimit,
      playerAnatomy, npcAnatomy,
      playerHands, npcHands, shoulderScratch: {}, footScratch: {}, // Cached world targets for posterior-supported foot IK during short-partner jumps.
      lastHandContact: null, // Mobile diagnostics expose reach and timing without requiring DevTools.
      playerNeck, npcNeck,
      originalPlayerNeck: playerNeck?.quaternion?.clone?.() || null,
      originalNpcNeck: npcNeck?.quaternion?.clone?.() || null,
      originalNpcYaw: walker.root.rotation.y,
      npcParent: walker.root.parent, // Prevents scene transfers from restoring an obsolete local world position.
      characterId: window.__hobunjiPlayerProfile?.characterId || null, // Prevents a delayed contact from buffing the next selected character.
      originalNpcPosition: { x: walker.root.position.x, y: walker.root.position.y, z: walker.root.position.z },
      approachX, approachZ, height, lock, onContact, touched: false, elapsed: 0,
      // Tall torso bows forward around the posterior. The partner's feet retreat by
      // the head's horizontal reach so the two mouths remain in the same contact spot.
      bowRetreatWorld: height.tallerBowForwardWorld,
      headingPlayer: Math.atan2(npcPoint.x - playerPoint.x, npcPoint.z - playerPoint.z),
      headingNpc: Math.atan2(playerPoint.x - npcPoint.x, playerPoint.z - npcPoint.z),
    };
    if (playerHands?.setPoseProvider && npcHands?.shoulderPositionLocal) {
      const session = active; // The live pose provider runs after the body compositor has placed the shoulders.
      playerHands.setPoseProvider(SOURCE, () => {
        if (active !== session) return;
        session.lastHandContact = applyInitiatorShoulderHands(
          session.playerHands, session.npcHands, session.elapsed,
          session.height.taller === 'second', session.shoulderScratch,
        );
      }); // Render-time ownership keeps real GLB hand contact attached through final-frame sync.
    }
    lastError = null;
    window.WorldActionInputClaims?.setClaims?.(SOURCE, [
      { actionId: 'dodge', label: 'Stop kissing', priority: 600, onPress: () => clearMotion('canceled') },
    ]);
    return true;
  }

  function update(context = {}) {
    const session = active;
    if (!session) return;
    if (!session.player?.parent || session.walker?.root?.parent !== session.npcParent ||
        session.composer?.getPlayerMesh?.() !== session.player ||
        session.walker.legs !== session.npcLegs ||
        (window.__hobunjiPlayerProfile?.characterId || null) !== session.characterId ||
        (Number.isFinite(Number(window.Combat?.deps?.player?.health)) && Number(window.Combat.deps.player.health) <= 0) ||
        window.RomanceSystem?.getSpouse?.()?.npcId !== session.walker.rec.id) {
      clearMotion('partner-or-rig-changed');
      return;
    }
    session.elapsed += clamp(finite(context.deltaMs) / 1000, 0, .08);
    const pose = samplePose(session.elapsed);
    const playerIsTaller = session.height.taller === 'first';
    const kneeBlend = sampleKneelBlend(session.elapsed, session.height.taller === 'second'); // Shorter initiators reach for shoulders before the taller spouse kneels.
    const kneeWorld = session.height.tallerSinkWorld * kneeBlend; // Single world-space target shared by both possible taller actors.
    const jumpBlend = session.height.shorterPosteriorGrip ? sampleJumpBlend(session.elapsed) : 0; // Non-jumping couples remain exactly on their original ground.
    const shorterJump = session.height.shorterJumpWorld * jumpBlend; // Vertical lift takes the short partner up to the taller posterior.
    const playerLocalKnee = playerIsTaller ? kneeWorld / session.playerAnatomy.worldScale : 0;
    const npcLocalKnee = playerIsTaller ? 0 : kneeWorld / session.npcAnatomy.worldScale;
    const npcPct = npcLocalKnee / Math.max(.001, Number(session.npcLegs.modelHeight) || 0) * 100;

    session.playerLegs.setStanceDrop(playerLocalKnee, true);
    const playerDrop = session.playerLegs.getStanceDrop?.() || 0;
    session.composer.setChannel(SOURCE, {
      priority: 200, absoluteYaw: session.headingPlayer,
      mode: 'override', translationMode: 'override',
      absoluteLegs: true, // The torso bows independently; grounded knees/feet remain in their existing world orientation.
      translation: { x: 0, y: -playerDrop + (playerIsTaller ? 0 : shorterJump), z: 0 }, // Shorter player hops without translating gameplay collision.
      rotation: { pitch: playerIsTaller ? session.height.tallerBowDeg * Math.PI / 180 * kneeBlend : .025 * pose.blend },
    });
    const npcDrop = window.ActorBodySink.apply(session.npcSink, npcPct, 0, true);
    if (session.npcTiltPivot?.rotation && Number.isFinite(session.originalNpcTiltX)) {
      session.npcTiltPivot.rotation.x = session.originalNpcTiltX +
        (playerIsTaller ? .025 * pose.blend : session.height.tallerBowDeg * Math.PI / 180 * kneeBlend);
    }
    const npcForward = playerIsTaller || session.height.shorterPosteriorGrip ? 0 : session.bowRetreatWorld; // Do not move a straddled posterior out from under the shorter spouse's feet.
    session.walker.root.position.y = session.originalNpcPosition.y + (playerIsTaller ? shorterJump : 0); // NPC jumps only if they are the shorter partner.
    session.walker.root.position.x = session.originalNpcPosition.x + session.approachX * pose.blend - Math.sin(session.headingNpc) * npcForward * kneeBlend;
    session.walker.root.position.z = session.originalNpcPosition.z + session.approachZ * pose.blend - Math.cos(session.headingNpc) * npcForward * kneeBlend;
    if (playerIsTaller && !session.height.shorterPosteriorGrip) {
      session.composer.setChannel(SOURCE + '-retreat', {
        space: 'world', priority: 200, translation: {
          x: -Math.sin(session.headingPlayer) * session.bowRetreatWorld * pose.blend,
          y: 0, z: -Math.cos(session.headingPlayer) * session.bowRetreatWorld * pose.blend,
        },
      }); // Player visuals retreat while real movement/collision remain locked.
    }
    const actualKneeWorld = playerIsTaller ? playerDrop * session.playerAnatomy.worldScale
      : npcDrop * session.npcAnatomy.worldScale;
    const expectedKneeWorld = kneeWorld;
    if (pose.blend > .8 && Math.abs(actualKneeWorld - expectedKneeWorld) > Math.max(.03, expectedKneeWorld * .09)) {
      lastError = 'actual-knee-limit-prevents-mouth-contact';
      clearMotion('knee-limit-mismatch');
      return;
    }
    session.walker.root.rotation.y = session.originalNpcYaw + 
      Math.atan2(Math.sin(session.headingNpc - session.originalNpcYaw), Math.cos(session.headingNpc - session.originalNpcYaw)) * pose.blend;
    if (session.playerNeck && session.originalPlayerNeck) {
      session.playerNeck.quaternion.copy(session.originalPlayerNeck);
      session.playerNeck.rotateX((playerIsTaller ? -.14 : .10) * pose.blend);
    }
    if (session.npcNeck && session.originalNpcNeck) {
      session.npcNeck.quaternion.copy(session.originalNpcNeck);
      session.npcNeck.rotateX((playerIsTaller ? .10 : -.14) * pose.blend);
    }
    if (session.height.shorterPosteriorGrip) {
      const shortLegs = playerIsTaller ? session.npcLegs : session.playerLegs; // Feet that must straddle the taller posterior rather than step on the ground.
      const tallLegs = playerIsTaller ? session.playerLegs : session.npcLegs;
      session.footScratch.composerLift = !playerIsTaller; // Player leg transforms move only during the compositor render; NPCs have physically translated roots.
      const footTargets = posteriorStraddleFootTargets(window.THREE, tallLegs, shortLegs, session.height, jumpBlend, session.footScratch);
      shortLegs.setExternalFootTargets?.(footTargets, { allowDeepFold: true }); // Two real legs bend onto the taller partner's individual left/right pelvis landmarks.
      if (footTargets) shortLegs.applyWorldFootTargets?.(footTargets, null, false, true);
    }
    if (!session.touched && pose.touch) {
      session.touched = true;
      try { session.onContact?.(); }
      catch (error) { lastError = 'contact-callback: ' + (error?.message || error); }
    }
    if (session.elapsed >= DURATION_S) clearMotion('completed');
  }

  function init() {
    if (schedulerInstalled || !window.RuntimeFrameScheduler?.register) return false;
    window.RuntimeFrameScheduler.register(SOURCE, update, {
      phase: 'pre-render', owner: 'SpouseKissMotion',
      description: 'Locks a spouse pair, adapts kneeling, and allows shorter partners to hop onto real posterior foot anchors.',
    });
    schedulerInstalled = true;
    return true;
  }

  function diagnostics() {
    return { version: 2, active: !!active, lastError, lastResult,
      session: active ? { npcId: active.walker?.rec?.id, elapsedS: active.elapsed, touched: active.touched,
        height: { ...active.height }, jumpBlend: sampleJumpBlend(active.elapsed),
        feetAnchored: !!(active.playerLegs?.hasExternalFootTargets?.() || active.npcLegs?.hasExternalFootTargets?.()),
        hands: active.lastHandContact || null } : null };
  }

  window.SpouseKissMotion = Object.freeze({
    DURATION_S, MAX_SINK_PCT, MOUTH_HEIGHT_FRACTION, KNEEL_LEG_FRACTION, MAX_BOW_DEG,
    solveHeights, samplePose, sampleJumpBlend, posteriorStraddleFootTargets,
    sampleKneelBlend, sampleInitiatorHandReach,
    resolveShoulderGripWorld, shoulderGripWorld, applyInitiatorShoulderHands,
    actorHeight, anatomyWorld, init, start, stop: clearMotion,
    isPartner: walker => !!active && active.walker === walker,
    diagnostics,
  });
})();
