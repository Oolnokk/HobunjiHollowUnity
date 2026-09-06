// Procedural Animation Editor: authoritative neutral-arm bridge.
//
// The game does not infer shoulders from handAttachX/Y. Free hands are positioned
// from the authored character attachment-rig shoulder + posterior/arm-length rules,
// with portrait-scale/placement correction applied before the hand is aimed back
// toward its shoulder. The procedural editor historically duplicated an older
// approximation (and one duplicate hand builder even forced abs(handAttachX),
// mirroring left/right). This file makes the editor consume the same authored
// neutral frame and then uses that frame as the fixed-length baseline for Dance
// and Carry arm guides.
(function (global) {
  'use strict';

  if (global.HobunjiProceduralNeutralArms?.installed) return;

  const DOWN = Object.freeze({ x: 0, y: -1, z: 0 }); // Authored hand/limb down axis used by the existing hand and LegBones systems.
  const LEFT_IDLE_YAW_DEG = 90; // Actual free-hand socket medial yaw from procedural-hand-attachments.js.
  const RIGHT_VISUAL_TWIST_DEG = 180; // Actual extra right-hand visual twist around the shoulder/wrist axis.
  const DANCE_ROOT_SUFFIX = '_procedural_arms'; // Existing Dance debug-arm root corrected immediately before draw.
  const CARRY_ROOT_SUFFIX = '_carry_arms'; // Existing Carry debug-arm root corrected immediately before draw.

  const state = { // Shared neutral-frame cache and final-render diagnostics.
    THREE: null,
    scene: null,
    model: null,
    frame: null,
    frameSignature: null,
    previousSceneBeforeRender: null,
    hookInstalled: false,
    lastLoggedModel: null,
    debug: { installed: true, mode: 'waiting' },
  };

  function editorLog(message, level = 'info', extra = null) {
    const logger = global.HobunjiGameplayBackdrop?.log; // Existing copyable editor Diagnostics logger; avoids console-only debugging on mobile.
    if (logger) { logger(message, level, extra); return; }
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
    console[method]?.(message, extra ?? '');
  }

  function finite(value, fallback = 0) {
    const number = Number(value); // Sanitized numeric helper used for authored rig/profile inputs.
    return Number.isFinite(number) ? number : fallback;
  }

  function positive(value, fallback = 1) {
    const number = Number(value); // Positive-only numeric helper used for dimensions and scale factors.
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  }

  function selectedIdentity(model) {
    const npc = global.HobunjiGameplayBackdrop?.getSelectedNpc?.() || {}; // Selected preview NPC supplies species/gender when model.userData has not yet been populated.
    const appearance = npc.appearance || npc.profile?.appearance || npc.fighter?.appearance || {};
    const rawSpecies = appearance.speciesId || appearance.species || npc.species || model?.userData?.speciesId || 'mao-ao';
    const canonical = typeof global.hobunjiTransformSpeciesId === 'function'
      ? global.hobunjiTransformSpeciesId(rawSpecies)
      : ({ rakakoan: 'kenkari', ghoul: 'mao-ao' }[normalizeSpecies(rawSpecies)] || rawSpecies);
    return { species: normalizeSpecies(canonical), gender: normalizeGender(appearance.gender || npc.gender || model?.userData?.gender || 'male') };
  }

  function profileFor(model) {
    const identity = selectedIdentity(model); // Canonical identity selects the same attachment-rig profile as runtime hand aiming.
    const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return { identity, profile: characters[`${identity.species}::${identity.gender}`] || null };
  }

  function portraitMetrics(model, profile) {
    const anatomy = profile?.anatomy || {}; // Authored adult portrait values are the reference frame for shoulder coordinates.
    const modelHeight = positive(model?.userData?.portraitModelHeight || model?.userData?.gameModelHeight, .9);
    const modelWidth = positive(model?.userData?.portraitModelWidth, modelHeight);
    const currentScale = positive(model?.userData?.portraitScaleMultiplier, positive(anatomy.portraitScale, 1));
    const adultScale = positive(anatomy.portraitScale, 1);
    const placementRatio = finite(model?.userData?.portraitVerticalPlacementRatio, finite(anatomy.portraitVerticalPlacementRatio, .5));
    const adultPlacementRatio = finite(anatomy.portraitVerticalPlacementRatio, .5);
    return { modelHeight, modelWidth, currentScale, adultScale, placementRatio, adultPlacementRatio, actorScaleFactor: currentScale / adultScale };
  }

  function validPosition(value) {
    return ['x', 'y', 'z'].every(axis => Number.isFinite(Number(value?.[axis])));
  }

  function resolvePortraitBoundAnchor(model, profile, anchorName, metrics) {
    const anchor = profile?.anchors?.[anchorName]; // Authored character anchor used instead of handAttach-derived shoulder guesses.
    const binding = anchor?.portraitBinding;
    if (validPosition(binding?.referencePosition) && positive(binding?.referencePortraitScale, 0) > 0) {
      const factor = metrics.currentScale / positive(binding.referencePortraitScale, metrics.adultScale);
      const referencePlacement = finite(binding.referencePlacementRatio, metrics.adultPlacementRatio);
      return new state.THREE.Vector3(
        finite(binding.referencePosition.x) * factor,
        finite(binding.referencePosition.y) * factor + metrics.modelHeight * (metrics.placementRatio - referencePlacement),
        finite(binding.referencePosition.z) * factor,
      );
    }
    const authored = anchor?.position;
    if (!validPosition(authored)) return null;
    return new state.THREE.Vector3(
      finite(authored.x) * metrics.actorScaleFactor,
      finite(authored.y) * metrics.actorScaleFactor + metrics.modelHeight * (metrics.placementRatio - metrics.adultPlacementRatio),
      finite(authored.z) * metrics.actorScaleFactor,
    );
  }

  function posteriorY(model, profile, metrics) {
    const handAttachY = finite(model?.userData?.handAttachY, metrics.modelHeight / 2); // Legacy input retained only because the canonical posterior API accepts it as fallback.
    const shared = global.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(profile?.posteriorRule, metrics.modelHeight, handAttachY);
    if (Number.isFinite(Number(shared))) return Number(shared);
    const live = Number(profile?.resolvedPosteriorPosition?.y);
    if (Number.isFinite(live)) return live;
    const floorPercent = Number(profile?.posteriorRule?.heightPercentFromFloor);
    if (Number.isFinite(floorPercent)) return metrics.modelHeight * floorPercent / 100;
    return handAttachY + metrics.modelHeight * finite(profile?.posteriorRule?.heightPercentOffset, -18) / 100;
  }

  function floorLiftFor(model, metrics) {
    const authored = Number(model?.userData?.gameGrounding?.avatarHeightHalfLift); // Existing preview grounding value converts floor-relative character anchors into centered model-local points.
    if (Number.isFinite(authored)) return authored;
    const avatarLiftRoot = model?.parent?.parent;
    const live = Number(avatarLiftRoot?.position?.y);
    return Number.isFinite(live) ? live : metrics.modelHeight / 2;
  }

  function floorPointToModelBase(model, point, floorLift) {
    // Attachment anchors are authored in floor-relative pose-root space. The
    // editor's duplicate hand markers are model children, so remove the preview's
    // half-height lift and preserve the same x/z axes. This intentionally avoids
    // worldToLocal here: Dance mutates model transforms each frame and neutral
    // anatomy must move WITH that body rather than remain pinned in world space.
    return new state.THREE.Vector3(point.x, point.y - floorLift, point.z);
  }

  function neutralSide(model, profile, metrics, side, upperArmFraction, floorLift) {
    const anchorName = side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder'; // Side-specific authored shoulder target used by runtime hand aiming.
    const shoulderFloor = resolvePortraitBoundAnchor(model, profile, anchorName, metrics);
    if (!shoulderFloor) return null;
    const armOffset = finite(profile?.anatomy?.armLengthHeightPercentOffset, 0); // Positive authored value lengthens the hanging arm by lowering its wrist.
    const wristFloor = new state.THREE.Vector3(
      shoulderFloor.x,
      posteriorY(model, profile, metrics) - metrics.modelHeight * armOffset / 100,
      0,
    );
    const shoulder = floorPointToModelBase(model, shoulderFloor, floorLift);
    const hand = floorPointToModelBase(model, wristFloor, floorLift);
    const totalLength = Math.max(metrics.modelHeight * .08, shoulder.distanceTo(hand));
    return {
      shoulderFloor,
      handFloor: wristFloor,
      shoulder,
      hand,
      totalLength,
      upperLength: totalLength * upperArmFraction,
      lowerLength: totalLength * (1 - upperArmFraction),
    };
  }

  function frameSignature(model, profile, metrics) {
    const left = profile?.anchors?.leftHandShoulder?.position || {}; // Signature invalidates cached neutral anatomy when authoring/scaling changes live.
    const right = profile?.anchors?.rightHandShoulder?.position || {};
    return [
      selectedIdentity(model).species,
      selectedIdentity(model).gender,
      metrics.modelHeight,
      metrics.currentScale,
      metrics.placementRatio,
      profile?.anatomy?.portraitScale,
      profile?.anatomy?.armLengthHeightPercentOffset,
      left.x, left.y, left.z,
      right.x, right.y, right.z,
      profile?.resolvedPosteriorPosition?.y,
    ].join('|');
  }

  function buildNeutralFrame(model) {
    if (!model || !state.THREE) return null;
    const { identity, profile } = profileFor(model); // Current canonical attachment profile is the only shoulder authority.
    if (!profile) return null;
    const metrics = portraitMetrics(model, profile); // Current actor scale/placement resolves adult-authored shoulder anchors.
    const tuned = global.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve?.(identity.species, identity.gender) || {};
    const upperArmFraction = Math.max(.35, Math.min(.70, finite(tuned.upperArmFraction, .52))); // Existing anatomy profile only chooses where the elbow subdivides the real neutral span.
    const floorLift = floorLiftFor(model, metrics); // Preview half-height lift removed from floor-relative authored coordinates.
    const left = neutralSide(model, profile, metrics, 'left', upperArmFraction, floorLift);
    const right = neutralSide(model, profile, metrics, 'right', upperArmFraction, floorLift);
    if (!left || !right) return null;
    return {
      model,
      identity,
      profile,
      metrics,
      floorLift,
      upperArmFraction,
      left,
      right,
      shoulderSource: 'attachment-rig-profile + portrait-scale/placement binding',
      handSource: 'shoulder.x + canonical posteriorY + armLengthHeightPercentOffset',
    };
  }

  function currentGroundPose() {
    return global.HobunjiProceduralLimbPoseAuthor?.getDebug?.()?.pose || 'normal';
  }

  function manualActive() {
    return Boolean(global.ProceduralGroundRestManualBridge?.getDebug?.()?.active);
  }

  function ownershipMode() {
    if (manualActive()) return 'ground-manual';
    if (currentGroundPose() !== 'normal') return 'ground-preset';
    if (global.ProceduralCarryWalkMode?.getDebug?.()?.enabled) return 'carry';
    const dance = global.ProceduralDanceMode?.getDebug?.() || {};
    if (dance.enabled) return `dance:${dance.armStyle || 'none'}`;
    return 'neutral';
  }

  function markerFor(model, side) {
    return model?.getObjectByName?.(`${model.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Hand`) || null;
  }

  function orientationForForearm(side, forearmDirection) {
    const direction = forearmDirection?.clone?.() || new state.THREE.Vector3(0, -1, 0); // Current lower-arm direction drives the hand's authored down axis.
    if (direction.lengthSq() < 1e-10) direction.set(0, -1, 0);
    direction.normalize();
    const aim = new state.THREE.Quaternion().setFromUnitVectors(new state.THREE.Vector3(DOWN.x, DOWN.y, DOWN.z), direction);
    const localTwistDeg = LEFT_IDLE_YAW_DEG + (side === 'right' ? RIGHT_VISUAL_TWIST_DEG : 0); // Experimental wrapper has no separate socket/visual hierarchy, so compose both runtime Y twists here.
    const twist = new state.THREE.Quaternion().setFromAxisAngle(new state.THREE.Vector3(0, 1, 0), state.THREE.MathUtils.degToRad(localTwistDeg));
    return aim.multiply(twist).normalize();
  }

  function writeLine(line, shoulder, solved) {
    const attr = line?.geometry?.attributes?.position; // Existing editor line remains the visualization; only its invalid coordinates are replaced.
    if (!attr || attr.count < 3 || !solved) return false;
    attr.setXYZ(0, shoulder.x, shoulder.y, shoulder.z);
    attr.setXYZ(1, solved.joint.x, solved.joint.y, solved.joint.z);
    attr.setXYZ(2, solved.solvedTarget.x, solved.solvedTarget.y, solved.solvedTarget.z);
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere?.();
    return true;
  }

  function solveSide(sideFrame, target, pole = null) {
    return global.LegBones?.solveFixedTwoBoneChain?.(state.THREE, {
      root: sideFrame.shoulder,
      target,
      upperLength: sideFrame.upperLength,
      lowerLength: sideFrame.lowerLength,
      pole: pole || sideFrame.hand.clone().add(new state.THREE.Vector3(sideFrame.shoulder.x >= 0 ? .1 : -.1, 0, -.1)),
    }) || null;
  }

  function applyHand(model, side, solved) {
    const marker = markerFor(model, side); // Editor duplicate GLB marker receives the corrected wrist endpoint/orientation.
    if (!marker || !solved) return false;
    marker.position.copy(solved.solvedTarget);
    const forearm = solved.solvedTarget.clone().sub(solved.joint);
    marker.quaternion.copy(orientationForForearm(side, forearm));
    marker.updateMatrix?.();
    marker.updateMatrixWorld?.(true);
    return true;
  }

  function neutralSolve(sideFrame) {
    // At true neutral the authored shoulder->wrist span is the limb length, so a
    // straight subdivided chain is the most literal representation: no invented
    // 14-degree bend and no target-derived/stretchy segment lengths.
    return global.LegBones?.solveSubdividedChain?.(state.THREE, {
      root: sideFrame.shoulder,
      target: sideFrame.hand,
      jointFraction: state.frame.upperArmFraction,
    }) || null;
  }

  function applyNeutral(model) {
    const result = {};
    for (const side of ['left', 'right']) {
      const solved = neutralSolve(state.frame[side]); // Exact authored neutral chain used when no procedural pose owns the arms.
      result[side] = { solved, marker: applyHand(model, side, solved) };
    }
    return result;
  }

  function linePoint(line, index) {
    const attr = line?.geometry?.attributes?.position; // Current generated arm endpoint/pole read before final correction so authored animation deltas can be preserved.
    if (!attr || attr.count <= index) return null;
    return new state.THREE.Vector3(attr.getX(index), attr.getY(index), attr.getZ(index));
  }

  function oldDanceIdle(model, side) {
    const h = state.frame.metrics.modelHeight; // Legacy Dance target baseline reconstructed only to preserve its authored motion delta while replacing the bad neutral origin.
    const rawX = Number(model?.userData?.handAttachX);
    const rawY = Number(model?.userData?.handAttachY);
    const handAttachX = Number.isFinite(rawX) ? rawX : -state.frame.metrics.modelWidth * .28;
    const handAttachY = Number.isFinite(rawY) ? rawY : h * .45;
    return new state.THREE.Vector3(side === 'left' ? -handAttachX : handAttachX, handAttachY, 0);
  }

  function applyDance(model, armStyle) {
    const root = model.getObjectByName?.(`${model.name || 'Avatar'}${DANCE_ROOT_SUFFIX}`); // Existing Dance-generated arm visualization.
    if (!root) return { corrected: false, reason: 'dance-root-missing' };
    const result = {};
    for (const side of ['left', 'right']) {
      const line = root.getObjectByName?.(`${side}ArmDebugLine`); // Existing line's endpoint contains the Dance style's current authored target.
      const currentTarget = linePoint(line, 2);
      const currentJoint = linePoint(line, 1);
      if (!line || !currentTarget) { result[side] = { corrected: false, reason: 'line-missing' }; continue; }
      let target;
      if (armStyle === 'none') {
        target = state.frame[side].hand.clone(); // Relaxed Dance must be identical to authoritative neutral, not the old handAttach approximation.
      } else {
        const motionDelta = currentTarget.clone().sub(oldDanceIdle(model, side)); // Keep existing arm-style animation while transplanting it onto the real neutral wrist.
        target = state.frame[side].hand.clone().add(motionDelta);
      }
      const solved = solveSide(state.frame[side], target, currentJoint);
      const lineUpdated = writeLine(line, state.frame[side].shoulder, solved);
      result[side] = { corrected: lineUpdated, reachable: solved?.reachable ?? null, marker: applyHand(model, side, solved) };
    }
    return result;
  }

  function applyCarry(model) {
    const root = model.getObjectByName?.(`${model.name || 'Avatar'}${CARRY_ROOT_SUFFIX}`); // Existing Carry upper-body guide root.
    if (!root) return { corrected: false, reason: 'carry-root-missing' };
    const result = {};
    for (const side of ['left', 'right']) {
      const line = root.getObjectByName?.(`${side}CarryArmGuide`); // Carry already computes the moving grip target; only its approximate shoulder/length baseline is replaced.
      const target = linePoint(line, 2);
      const pole = linePoint(line, 1);
      if (!line || !target) { result[side] = { corrected: false, reason: 'line-missing' }; continue; }
      const solved = solveSide(state.frame[side], target, pole);
      const lineUpdated = writeLine(line, state.frame[side].shoulder, solved);
      result[side] = { corrected: lineUpdated, reachable: solved?.reachable ?? null, marker: applyHand(model, side, solved) };
    }
    return result;
  }

  function refreshFrameIfNeeded(model, mode) {
    const { profile } = profileFor(model); // Current attachment profile used to detect live authoring/scaling changes.
    if (!profile) return false;
    const metrics = portraitMetrics(model, profile);
    const signature = frameSignature(model, profile, metrics);
    const canRebind = mode === 'neutral' || state.model !== model || !state.frame;
    if (state.model === model && state.frame && state.frameSignature === signature) return true;
    if (!canRebind) return Boolean(state.frame); // Preserve pre-animation model-local neutral frame while Dance/Carry moves the body.
    const frame = buildNeutralFrame(model);
    if (!frame) return false;
    state.model = model;
    state.frame = frame;
    state.frameSignature = signature;
    if (state.lastLoggedModel !== model) {
      state.lastLoggedModel = model;
      editorLog('[Neutral arms] Bound authored shoulder/posterior neutral frame; removed handAttach shoulder approximation.', 'info', {
        identity: frame.identity,
        actorScaleFactor: frame.metrics.actorScaleFactor,
        left: { shoulder: frame.left.shoulderFloor, hand: frame.left.handFloor },
        right: { shoulder: frame.right.shoulderFloor, hand: frame.right.handFloor },
      });
    }
    return true;
  }

  function correctBeforeRender() {
    const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null; // Current editor preview avatar corrected at the actual final scene draw boundary.
    if (!model || !state.THREE) return;
    const mode = ownershipMode();
    if (!refreshFrameIfNeeded(model, mode)) {
      state.debug = { installed: true, mode, error: 'neutral-frame-unavailable' };
      return;
    }

    let result = null;
    if (mode === 'neutral') result = applyNeutral(model);
    else if (mode.startsWith('dance:')) result = applyDance(model, mode.slice('dance:'.length));
    else if (mode === 'carry') result = applyCarry(model);
    // Ground/Rest automatic/manual posing already owns explicit authored targets.
    // Do not fight that ownership here; its next refactor can consume this public
    // neutral-frame API directly for target seeding.

    state.debug = {
      installed: true,
      mode,
      identity: state.frame.identity,
      shoulderSource: state.frame.shoulderSource,
      handSource: state.frame.handSource,
      actorScaleFactor: state.frame.metrics.actorScaleFactor,
      currentPortraitScale: state.frame.metrics.currentScale,
      authoredPortraitScale: state.frame.metrics.adultScale,
      placementRatio: state.frame.metrics.placementRatio,
      left: {
        shoulder: vectorDebug(state.frame.left.shoulder),
        neutralHand: vectorDebug(state.frame.left.hand),
        totalArmLength: Number(state.frame.left.totalLength.toFixed(5)),
      },
      right: {
        shoulder: vectorDebug(state.frame.right.shoulder),
        neutralHand: vectorDebug(state.frame.right.hand),
        totalArmLength: Number(state.frame.right.totalLength.toFixed(5)),
      },
      result,
    };
  }

  function vectorDebug(vector) {
    if (!vector) return null;
    return { x: Number(vector.x.toFixed(5)), y: Number(vector.y.toFixed(5)), z: Number(vector.z.toFixed(5)) };
  }

  function installSceneHook() {
    const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null; // Scene onBeforeRender executes after every renderer wrapper has applied Dance/Ground/Carry transforms.
    if (!scene) return false;
    if (state.scene === scene && state.hookInstalled) return true;
    state.scene = scene;
    state.previousSceneBeforeRender = typeof scene.onBeforeRender === 'function' ? scene.onBeforeRender : null;
    scene.onBeforeRender = function proceduralNeutralArmBeforeRender() {
      state.previousSceneBeforeRender?.apply(this, arguments);
      try { correctBeforeRender(); }
      catch (error) {
        state.debug = { ...state.debug, error: String(error?.message || error) };
        editorLog(`[Neutral arms] Final correction failed: ${error?.stack || error}`, 'error');
      }
    };
    state.hookInstalled = true;
    editorLog('[Neutral arms] Final scene hook installed; authored attachment-rig neutral frame now wins over editor approximations.', 'info');
    return true;
  }

  async function bootstrap() {
    try {
      const modules = await global.PNGPlaneAvatar?.loadThreeModules?.(); // Same Three.js instance as the procedural preview and LegBones solver.
      state.THREE = modules?.THREE || global.THREE || null;
    } catch (error) {
      editorLog(`[Neutral arms] Could not resolve editor Three.js: ${error?.message || error}`, 'error');
    }
    let attempts = 0; // Renderer/scene host arrives asynchronously after the editor finishes loading the selected NPC.
    function frame() {
      if (installSceneHook()) return;
      if (attempts++ < 2400) requestAnimationFrame(frame);
      else editorLog('[Neutral arms] Timed out waiting for editor scene.', 'error');
    }
    requestAnimationFrame(frame);
  }

  global.HobunjiProceduralNeutralArms = Object.freeze({
    installed: true,
    resolveNeutralFrame(model = global.HobunjiGameplayBackdrop?.getAvatarModel?.()) {
      if (!model) return null;
      const frame = buildNeutralFrame(model);
      if (!frame) return null;
      return {
        identity: { ...frame.identity },
        actorScaleFactor: frame.metrics.actorScaleFactor,
        left: { shoulder: vectorDebug(frame.left.shoulder), hand: vectorDebug(frame.left.hand), totalArmLength: frame.left.totalLength },
        right: { shoulder: vectorDebug(frame.right.shoulder), hand: vectorDebug(frame.right.hand), totalArmLength: frame.right.totalLength },
      };
    },
    getDebug: () => JSON.parse(JSON.stringify(state.debug)),
  });

  bootstrap();
})(window);
