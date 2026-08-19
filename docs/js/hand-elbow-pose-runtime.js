// Shared pose-driven elbow targets for the experimental bicep/forearm rig.
// Coordinates are avatar-local fractions of portrait height and are interpolated
// with the same Neutral/Windup/Strike timing as held-item poses.
(function (global) {
  'use strict';

  const DEFAULTS = Object.freeze({
    left: Object.freeze({ x: 0.28, y: 0.08, z: 0.08 }),
    right: Object.freeze({ x: -0.28, y: 0.08, z: 0.08 }),
  });
  let capturedMelee = null;

  const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
  function point(raw, side) {
    const fallback = DEFAULTS[side] || DEFAULTS.right;
    return {
      x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : fallback.x,
      y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : fallback.y,
      z: Number.isFinite(Number(raw?.z)) ? Number(raw.z) : fallback.z,
    };
  }
  function posePoint(rawPose, side) {
    return point(rawPose?.elbowTarget?.[side] || rawPose?.elbow?.[side], side);
  }
  function lerpPoint(a, b, t) {
    const k = clamp01(t);
    return {
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      z: a.z + (b.z - a.z) * k,
    };
  }
  function normalizePoseSet(raw = {}) {
    return {
      neutral: { left: posePoint(raw.neutral, 'left'), right: posePoint(raw.neutral, 'right') },
      windup: { left: posePoint(raw.windup, 'left'), right: posePoint(raw.windup, 'right') },
      strike: { left: posePoint(raw.strike, 'left'), right: posePoint(raw.strike, 'right') },
    };
  }
  function hasAuthoredElbow(raw = {}) {
    return ['neutral', 'windup', 'strike'].some(phase => raw?.[phase]?.elbowTarget || raw?.[phase]?.elbow);
  }
  function pointAt(progress, timing = {}, poseSet = {}, sequence = 'attack', side = 'right') {
    const t = clamp01(progress);
    const wf = clamp01(timing.windupFrac ?? timing.wf ?? 0.16);
    const sf = Math.max(wf, clamp01(timing.strikeFrac ?? timing.sf ?? 0.55));
    const hf = Math.max(sf, clamp01(timing.holdFrac ?? timing.hf ?? 0.68));
    const poses = normalizePoseSet(poseSet);
    const n = poses.neutral[side], w = poses.windup[side], s = poses.strike[side];

    if (sequence === 'load') {
      if (t <= wf) return lerpPoint(n, w, t / Math.max(1e-6, wf));
      return lerpPoint(w, n, (t - wf) / Math.max(1e-6, 1 - wf));
    }
    if (sequence === 'fire') {
      if (t <= sf) return lerpPoint(n, s, t / Math.max(1e-6, sf));
      if (t <= hf) return { ...s };
      return lerpPoint(s, n, (t - hf) / Math.max(1e-6, 1 - hf));
    }
    if (t <= wf) return lerpPoint(n, w, t / Math.max(1e-6, wf));
    if (t <= sf) return lerpPoint(w, s, (t - wf) / Math.max(1e-6, sf - wf));
    if (t <= hf) return { ...s };
    return lerpPoint(s, n, (t - hf) / Math.max(1e-6, 1 - hf));
  }

  function installMeleeCapture() {
    const deps = global.Combat?.deps;
    if (!deps?.__weaponToolStanceVisualHooks || deps.__hobunjiElbowPoseCapture) return false;
    const wrapStart = name => {
      const original = deps[name];
      if (typeof original !== 'function') return;
      deps[name] = function elbowPoseAwareCombatStart(durationS, opts = {}) {
        capturedMelee = {
          durationS: Math.max(0.001, Number(durationS) || 0.5),
          opts: opts && typeof opts === 'object' ? opts : {},
          startedAt: performance.now(),
        };
        return original.call(this, durationS, opts);
      };
    };
    wrapStart('triggerWeaponSwingVisual');
    wrapStart('triggerWeaponHoldVisual');
    for (const name of ['releaseWeaponSwingHold', 'cancelWeaponSwingHold']) {
      const original = deps[name];
      if (typeof original !== 'function') continue;
      deps[name] = function elbowPoseAwareCombatEnd(...args) {
        const result = original.apply(this, args);
        if (name === 'cancelWeaponSwingHold') capturedMelee = null;
        return result;
      };
    }
    Object.defineProperty(deps, '__hobunjiElbowPoseCapture', { value: true, configurable: true });
    return true;
  }

  function captureLoop() {
    installMeleeCapture();
    global.requestAnimationFrame?.(captureLoop);
  }
  global.requestAnimationFrame?.(captureLoop);

  function rangedPoint(side) {
    const action = global.__rangedDebug?.playerAction || null;
    if (!action?.itemKey || !action?.kind || !(Number(action.durationS) > 0)) return null;
    const def = global.RangedWeapons?.config?.[action.itemKey] || null;
    if (!def) return null;
    const kind = action.kind === 'load' ? 'load' : 'fire';
    const poseSet = kind === 'load' ? def.loadPose : def.firePose;
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
    return pointAt(progress, timing, poseSet || {}, sequence, side);
  }

  function gamePoint(side) {
    const ranged = rangedPoint(side);
    if (ranged) return ranged;
    const snapshot = global.WeaponToolStances?.debugSnapshot?.() || null;
    if (!(snapshot?.combatNeutralInjected === true) || !Number.isFinite(Number(snapshot?.combatProgress))) {
      capturedMelee = null;
      return { ...(DEFAULTS[side] || DEFAULTS.right) };
    }
    const rawPose = capturedMelee?.opts?.pose || {};
    const timing = {
      windupFrac: capturedMelee?.opts?.windupFrac ?? 0.16,
      strikeFrac: capturedMelee?.opts?.strikeFrac ?? 0.55,
      holdFrac: capturedMelee?.opts?.holdFrac ?? 0.68,
    };
    const sequence = capturedMelee?.opts?.sequence || 'attack';
    return pointAt(snapshot.combatProgress, timing, rawPose, sequence, side);
  }

  function currentNormalized(side = 'right') {
    const editor = global.HobunjiAttackEditorElbowControls;
    if (editor?.currentElbowNormalized) return editor.currentElbowNormalized(side);
    return gamePoint(side);
  }

  global.HobunjiHandElbowPoseRuntime = Object.freeze({
    defaults: DEFAULTS,
    point,
    posePoint,
    lerpPoint,
    normalizePoseSet,
    hasAuthoredElbow,
    pointAt,
    currentNormalized,
    installMeleeCapture,
  });
})(window);
