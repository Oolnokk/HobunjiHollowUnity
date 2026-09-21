// Shared per-pose hand/elbow data.
//
// The hand's proximal local +Y axis targets the pose-authored elbow. Poses still
// choose how much of that correction may come from the hand's two meaningful local
// hinges: grip axis (local +X) and directed palm-normal axis (local -Z). Legacy pitch/roll
// hinge fields remain import-compatible.
(function (global) {
  'use strict';

  const IDLE = Object.freeze({ grip: 1, palmNormal: 1 });
  const ACTIVE = Object.freeze({ grip: 0, palmNormal: 1 });
  let capturedMelee = null;

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  const axisWeight = (raw, key, legacyKey, fallback) => {
    const value = raw?.[key] ?? raw?.[legacyKey]; // Migrates old Pitch→grip and Roll→palm-normal without keeping a third hinge.
    return value === true ? 1 : value === false ? 0 : clamp01(value ?? fallback);
  };
  const normalize = (raw, fallback = ACTIVE) => ({
    grip: axisWeight(raw, 'grip', 'pitch', fallback.grip),
    palmNormal: axisWeight(raw, 'palmNormal', 'roll', fallback.palmNormal),
  });
  const lerp = (a, b, t) => {
    const k = clamp01(t);
    return {
      grip: a.grip + (b.grip - a.grip) * k,
      palmNormal: a.palmNormal + (b.palmNormal - a.palmNormal) * k,
    };
  };
  const normalizeElbowPoint = raw => {
    if (!raw || typeof raw !== 'object') return null;
    const x = Number(raw.x), y = Number(raw.y), z = Number(raw.z);
    return [x,y,z].every(Number.isFinite) ? { x, y, z } : null;
  };
  const elbowPointFromPose = (pose, side) =>
    normalizeElbowPoint(pose?.elbows?.[side] || pose?.elbow?.[side] || pose?.shoulderAim?.elbows?.[side]);
  const mirrorSign = value => Number(value) === -1 ? -1 : 1;
  const mirrorElbowPoint = (point, sign = 1) => {
    const normalized = normalizeElbowPoint(point);
    if (!normalized) return null;
    return { x: normalized.x * mirrorSign(sign), y: normalized.y, z: normalized.z };
  };
  const lerpElbowPoint = (a, b, t) => {
    if (!a && !b) return null;
    // A missing elbow keyframe means the legacy shoulder target for that phase,
    // which is exactly a zero shoulder-relative elbow offset. Interpolate through
    // that zero point so adding an elbow to only one phase never snaps on at t=0.
    const from = a || { x: 0, y: 0, z: 0 };
    const to = b || { x: 0, y: 0, z: 0 };
    const k = clamp01(t);
    return {
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k,
      z: from.z + (to.z - from.z) * k,
    };
  };

  function normalizePoseSet(raw = {}) {
    return {
      neutral: normalize(raw.neutral?.shoulderAim || raw.neutral, IDLE),
      windup: normalize(raw.windup?.shoulderAim || raw.windup, ACTIVE),
      strike: normalize(raw.strike?.shoulderAim || raw.strike, ACTIVE),
    };
  }
  function normalizeElbowPoseSet(raw = {}, side = 'right') {
    return {
      neutral: elbowPointFromPose(raw.neutral, side),
      windup: elbowPointFromPose(raw.windup, side),
      strike: elbowPointFromPose(raw.strike, side),
    };
  }

  function hasAuthoredPoseAim(raw = {}) {
    return ['neutral','windup','strike'].some(phase => {
      const pose = raw?.[phase];
      return (pose?.shoulderAim && typeof pose.shoulderAim === 'object')
        || (pose?.elbows && typeof pose.elbows === 'object')
        || (pose?.elbow && typeof pose.elbow === 'object');
    });
  }

  function weightsAt(progress, timing = {}, poseSet = {}, sequence = 'attack') {
    const t = clamp01(progress);
    const wf = clamp01(timing.windupFrac ?? timing.wf ?? 0.16);
    const sf = Math.max(wf, clamp01(timing.strikeFrac ?? timing.sf ?? 0.55));
    const hf = Math.max(sf, clamp01(timing.holdFrac ?? timing.hf ?? 0.68));
    const poses = normalizePoseSet(poseSet);
    const poseScale = clamp01(timing.poseScale ?? 1); // Used after a partial held release to scale authored shoulder endpoints from Neutral by the same fraction as the weapon.
    const scaledWindup = lerp(poses.neutral, poses.windup, poseScale); // Used as the effective Windup shoulder state for the current release amplitude.
    const scaledStrike = lerp(poses.neutral, poses.strike, poseScale); // Used as the effective Strike shoulder state for the current release amplitude.

    if (sequence === 'load') {
      if (t <= wf) return lerp(poses.neutral, scaledWindup, t / Math.max(1e-6, wf));
      return lerp(scaledWindup, poses.neutral, (t - wf) / Math.max(1e-6, 1 - wf));
    }
    if (sequence === 'fire') {
      if (t <= sf) return lerp(poses.neutral, scaledStrike, t / Math.max(1e-6, sf));
      if (t <= hf) return { ...scaledStrike };
      return lerp(scaledStrike, poses.neutral, (t - hf) / Math.max(1e-6, 1 - hf));
    }
    if (t <= wf) {
      const rawWindupT = t / Math.max(1e-6, wf);
      const poseT = global.Combat?.windupPoseProgress?.(rawWindupT, timing.windupSlowdown) ?? rawWindupT;
      return lerp(poses.neutral, scaledWindup, poseT);
    }
    if (t <= sf) return lerp(scaledWindup, scaledStrike, (t - wf) / Math.max(1e-6, sf - wf));
    if (t <= hf) return { ...scaledStrike };
    return lerp(scaledStrike, poses.neutral, (t - hf) / Math.max(1e-6, 1 - hf));
  }

  function elbowAt(progress, timing = {}, poseSet = {}, sequence = 'attack', side = 'right') {
    const t = clamp01(progress);
    const wf = clamp01(timing.windupFrac ?? timing.wf ?? 0.16);
    const sf = Math.max(wf, clamp01(timing.strikeFrac ?? timing.sf ?? 0.55));
    const hf = Math.max(sf, clamp01(timing.holdFrac ?? timing.hf ?? 0.68));
    const poses = normalizeElbowPoseSet(poseSet, side);
    const poseScale = clamp01(timing.poseScale ?? 1);
    const activeSign = mirrorSign(timing.activeMirrorSign ?? timing.dirSign ?? 1);
    const neutralSign = mirrorSign(timing.neutralMirrorSign ?? 1);
    const returnNeutralSign = mirrorSign(timing.returnNeutralMirrorSign ?? neutralSign);
    // Mirroring never swaps anatomical hands. Backhand/alternating-heavy pose
    // mirroring changes the shoulder-relative X coordinate for this same side.
    const neutral = mirrorElbowPoint(poses.neutral, neutralSign);
    const returnNeutral = mirrorElbowPoint(poses.neutral, returnNeutralSign);
    const windup = mirrorElbowPoint(poses.windup, activeSign);
    const strike = mirrorElbowPoint(poses.strike, activeSign);
    const scaledWindup = lerpElbowPoint(neutral, windup, poseScale);
    const scaledStrike = lerpElbowPoint(neutral, strike, poseScale);
    if (sequence === 'load') {
      if (t <= wf) return lerpElbowPoint(neutral, scaledWindup, t / Math.max(1e-6, wf));
      return lerpElbowPoint(scaledWindup, returnNeutral, (t - wf) / Math.max(1e-6, 1 - wf));
    }
    if (sequence === 'fire') {
      if (t <= sf) return lerpElbowPoint(neutral, scaledStrike, t / Math.max(1e-6, sf));
      if (t <= hf) return scaledStrike ? { ...scaledStrike } : null;
      return lerpElbowPoint(scaledStrike, returnNeutral, (t - hf) / Math.max(1e-6, 1 - hf));
    }
    if (t <= wf) {
      const rawWindupT = t / Math.max(1e-6, wf);
      const poseT = global.Combat?.windupPoseProgress?.(rawWindupT, timing.windupSlowdown) ?? rawWindupT;
      return lerpElbowPoint(neutral, scaledWindup, poseT);
    }
    if (t <= sf) return lerpElbowPoint(scaledWindup, scaledStrike, (t - wf) / Math.max(1e-6, sf - wf));
    if (t <= hf) return scaledStrike ? { ...scaledStrike } : null;
    return lerpElbowPoint(scaledStrike, returnNeutral, (t - hf) / Math.max(1e-6, 1 - hf));
  }

  function secondaryGripActive(toolKey) {
    return !!global.HobunjiHandToolGrips?.secondaryGripForTool?.(toolKey || '');
  }

  function applyLeftIdleRule(side, toolKey, weights) {
    return side === 'left' && !secondaryGripActive(toolKey) ? { ...IDLE } : weights;
  }

  // WeaponToolStances has to remain authoritative for transforming actual tool
  // poses. Once it has installed its wrapper, place this capture OUTSIDE it so we
  // see editor-authored shoulderAim metadata before its numeric pose normalizer
  // intentionally strips unknown fields.
  function installMeleeCapture() {
    const deps = global.Combat?.deps;
    if (!deps?.__weaponToolStanceVisualHooks || deps.__hobunjiShoulderPoseCapture) return false;

    const wrapStart = name => {
      const original = deps[name];
      if (typeof original !== 'function') return;
      deps[name] = function shoulderPoseAwareCombatStart(durationS, opts = {}) {
        capturedMelee = {
          durationS: Math.max(0.001, Number(durationS) || 0.5),
          opts: opts && typeof opts === 'object' ? opts : {},
          startedAt: performance.now(),
          kind: name === 'triggerWeaponHoldVisual' ? 'hold' : 'swing',
        };
        return original.call(this, durationS, opts);
      };
    };
    wrapStart('triggerWeaponSwingVisual');
    wrapStart('triggerWeaponHoldVisual');

    for (const name of ['releaseWeaponSwingHold','cancelWeaponSwingHold']) {
      const original = deps[name];
      if (typeof original !== 'function') continue;
      deps[name] = function shoulderPoseAwareCombatEnd(...args) {
        const result = original.apply(this, args);
        if (name === 'cancelWeaponSwingHold') capturedMelee = null;
        return result;
      };
    }
    Object.defineProperty(deps, '__hobunjiShoulderPoseCapture', { value: true, configurable: true });
    return true;
  }

  function captureLoop() {
    installMeleeCapture();
  }
  global.setInterval?.(captureLoop, 250); // Polls only for global.Combat.deps to become available; the post-install check is a cheap no-op, so no per-frame cadence is needed.

  function rangedWeights(side) {
    const action = global.__rangedDebug?.playerAction || null;
    if (!action?.itemKey || !action?.kind || !(Number(action.durationS) > 0)) return null;
    const def = global.RangedWeapons?.config?.[action.itemKey] || null;
    if (!def) return null;
    const kind = action.kind === 'load' ? 'load' : 'fire';
    const progress = clamp01(Number(action.t) / Number(action.durationS));
    const timing = kind === 'load' ? {
      windupFrac: def.reloadWindupFrac ?? 0.55,
      strikeFrac: def.reloadStrikeFrac ?? 0.56,
      holdFrac: def.reloadHoldFrac ?? 0.57,
    } : {
      windupFrac: def.fireWindupFrac ?? 0.02,
      strikeFrac: def.fireAtFrac ?? 0.18,
      holdFrac: def.fireHoldFrac ?? (def.fireAtFrac ?? 0.18),
    };
    const sequence = kind === 'load' ? (def.reloadSequence || 'attack') : (def.fireSequence || 'fire');
    const key = `ranged:${action.itemKey}:${kind}`;
    const configuredPose = kind === 'load' ? def.loadPose : def.firePose;
    const authored = hasAuthoredPoseAim(configuredPose)
      ? configuredPose
      : (global.HobunjiHandShoulderPoseProfiles?.forKey?.(key) || {});
    return applyLeftIdleRule(side, action.itemKey, weightsAt(progress, timing, authored, sequence));
  }

  function gameWeights(side) {
    const ranged = rangedWeights(side);
    if (ranged) return ranged;

    const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
    const active = snapshot?.combatNeutralInjected === true && Number.isFinite(Number(snapshot?.combatProgress));
    if (!active) {
      capturedMelee = null;
      return { ...IDLE };
    }

    const toolKey = snapshot?.itemKey || snapshot?.shape || '';
    const rawPose = capturedMelee?.opts?.pose;
    if (hasAuthoredPoseAim(rawPose)) {
      const timing = {
        windupFrac: snapshot.combatWindupFrac ?? capturedMelee.opts.windupFrac ?? 0.16,
        strikeFrac: snapshot.combatStrikeFrac ?? capturedMelee.opts.strikeFrac ?? 0.55,
        holdFrac: snapshot.combatHoldFrac ?? capturedMelee.opts.holdFrac ?? 0.68,
        windupSlowdown: capturedMelee.opts.windupSlowdown ?? 0,
        poseScale: snapshot.combatPoseScale ?? 1,
      };
      const sequence = capturedMelee.opts.sequence || 'attack';
      return applyLeftIdleRule(side, toolKey, weightsAt(snapshot.combatProgress, timing, rawPose, sequence));
    }

    // Current committed melee profiles use both local hinges at Neutral and the
    // palm-normal hinge during active Windup/Strike. WeaponToolStances exposes its
    // exact Neutral blend weight, including hold/release timing.
    const profileKey = `melee:${snapshot?.combatAnim || 'thrust'}`;
    const authored = global.HobunjiHandShoulderPoseProfiles?.forKey?.(profileKey);
    const profile = normalizePoseSet(authored || {});
    const neutralWeight = clamp01(snapshot.combatNeutralWeight);
    const weights = {
      grip: profile.strike.grip + (profile.neutral.grip - profile.strike.grip) * neutralWeight,
      palmNormal: profile.strike.palmNormal + (profile.neutral.palmNormal - profile.strike.palmNormal) * neutralWeight,
    };
    return applyLeftIdleRule(side, toolKey, weights);
  }

  function rangedWindupStrikeActive() {
    // The authoring editor should always display exactly what its checkboxes/pose data request.
    if (global.HobunjiAttackEditorHandShoulderControls) return false;

    // Hold-release thrown weapons spend their visible charge in authored Windup
    // before RangedWeapons creates the release playerAction.
    if (global.HobunjiRangedWeaponArchetypes?.activeThrownChargeItemKey?.()) return true;

    const action = global.__rangedDebug?.playerAction || null;
    if (action?.kind !== 'fire' || !action?.itemKey || !(Number(action.durationS) > 0)) return false;
    const def = global.RangedWeapons?.config?.[action.itemKey] || null;
    if (!def) return false;
    const progress = clamp01(Number(action.t) / Number(action.durationS));
    const strikeBoundary = clamp01(def.fireAtFrac ?? def.fireStrikeFrac ?? 0.18); // Windup+Strike are authored; Hold/Return resume ordinary proximal targeting.
    return progress <= strikeBoundary;
  }

  function currentWeights(side) {
    const editor = global.HobunjiAttackEditorHandShoulderControls;
    if (editor?.currentWeights) {
      const weights = editor.currentWeights();
      const toolKey = document.getElementById('toolSpriteSelect')?.value || '';
      return applyLeftIdleRule(side, toolKey, normalize(weights, IDLE));
    }
    const weights = gameWeights(side);
    if (!rangedWindupStrikeActive()) return weights;
    return { ...weights, grip: 0 }; // Ranged Windup/Strike disables the grip-axis correction only; palm-normal targeting still follows the authored elbow/shoulder target.
  }

  function currentElbow(side) {
    const editor = global.HobunjiAttackEditorHandShoulderControls;
    if (editor?.currentElbow) return normalizeElbowPoint(editor.currentElbow(side));

    const action = global.__rangedDebug?.playerAction || null;
    if (action?.itemKey && action?.kind && Number(action.durationS) > 0) {
      const def = global.RangedWeapons?.config?.[action.itemKey] || null;
      if (def) {
        const kind = action.kind === 'load' ? 'load' : 'fire';
        const progress = clamp01(Number(action.t) / Number(action.durationS));
        const timing = kind === 'load'
          ? { windupFrac: def.reloadWindupFrac ?? 0.55, strikeFrac: def.reloadStrikeFrac ?? 0.56, holdFrac: def.reloadHoldFrac ?? 0.57 }
          : { windupFrac: def.fireWindupFrac ?? 0.02, strikeFrac: def.fireAtFrac ?? 0.18, holdFrac: def.fireHoldFrac ?? (def.fireAtFrac ?? 0.18) };
        const sequence = kind === 'load' ? (def.reloadSequence || 'attack') : (def.fireSequence || 'fire');
        const configuredPose = kind === 'load' ? def.loadPose : def.firePose;
        const key = `ranged:${action.itemKey}:${kind}`;
        const authored = hasAuthoredPoseAim(configuredPose)
          ? configuredPose
          : (global.HobunjiHandShoulderPoseProfiles?.forKey?.(key) || {});
        return elbowAt(progress, timing, authored, sequence, side);
      }
    }

    const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
    const active = snapshot?.combatNeutralInjected === true && Number.isFinite(Number(snapshot?.combatProgress));
    if (!active) return null;
    const rawPose = capturedMelee?.opts?.pose;
    if (hasAuthoredPoseAim(rawPose)) {
      const timing = {
        windupFrac: snapshot.combatWindupFrac ?? capturedMelee.opts.windupFrac ?? 0.16,
        strikeFrac: snapshot.combatStrikeFrac ?? capturedMelee.opts.strikeFrac ?? 0.55,
        holdFrac: snapshot.combatHoldFrac ?? capturedMelee.opts.holdFrac ?? 0.68,
        windupSlowdown: capturedMelee.opts.windupSlowdown ?? 0,
        poseScale: snapshot.combatPoseScale ?? 1,
      };
      timing.activeMirrorSign = snapshot.combatDirSign ?? capturedMelee.opts.dirSign ?? 1;
      timing.neutralMirrorSign = snapshot.combatNeutralMirrorSign ?? 1;
      timing.returnNeutralMirrorSign = snapshot.combatReturnNeutralMirrorSign ?? timing.neutralMirrorSign;
      return elbowAt(snapshot.combatProgress, timing, rawPose, capturedMelee.opts.sequence || 'attack', side);
    }
    const profileKey = `melee:${snapshot?.combatAnim || 'thrust'}`;
    return elbowAt(snapshot.combatProgress, {
      windupFrac: snapshot.combatWindupFrac ?? 0.16,
      strikeFrac: snapshot.combatStrikeFrac ?? 0.55,
      holdFrac: snapshot.combatHoldFrac ?? 0.68,
      poseScale: snapshot.combatPoseScale ?? 1,
      activeMirrorSign: snapshot.combatDirSign ?? capturedMelee?.opts?.dirSign ?? 1,
      neutralMirrorSign: snapshot.combatNeutralMirrorSign ?? 1,
      returnNeutralMirrorSign: snapshot.combatReturnNeutralMirrorSign ?? snapshot.combatNeutralMirrorSign ?? 1,
    }, global.HobunjiHandShoulderPoseProfiles?.forKey?.(profileKey) || {}, 'attack', side);
  }

  global.HobunjiHandShoulderPoseRuntime = Object.freeze({
    idle: IDLE,
    active: ACTIVE,
    normalize,
    normalizePoseSet,
    normalizeElbowPoint,
    normalizeElbowPoseSet,
    mirrorElbowPoint,
    hasAuthoredPoseAim,
    lerp,
    lerpElbowPoint,
    weightsAt,
    elbowAt,
    currentWeights,
    currentElbow,
    rangedWindupStrikeActive,
    installMeleeCapture,
  });
})(window);