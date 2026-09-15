// Procedural Animation Editor: gameplay/Attack Editor free-hand idle parity.
//
// The editor's generated hand wrappers used to sit directly on the authored
// shoulder anchors. Gameplay and the Attack Animation Editor do not: an
// unowned hand keeps the shoulder's X, hangs from the character posterior,
// applies the authored species/gender arm-length offset, then receives the
// tiny procedural idle fallback. This adapter applies that same default to the
// editor's already-existing hand wrappers without creating a second hand rig.
(function (global) {
  'use strict';

  if (global.HobunjiProceduralEditorIdleArms?.installed) return;

  const OWNERSHIP_EPSILON_FRACTION = 0.012; // Used to distinguish the editor's untouched shoulder default from an explicitly animated hand.
  const SHOULDER_REACQUIRE_FRACTION = 0.04; // Used to reacquire default ownership when the editor returns a hand to its unanimated shoulder anchor.
  const FALLBACK_IDLE_PHASE_RATE = 0.0017; // Matches procedural-hand-frame-driver.js's free-hand idle breathing phase.
  const handState = new WeakMap(); // Stores the last position this adapter wrote so later animation writers can take ownership cleanly.
  let activeScene = null; // Tracks the preview scene whose onBeforeRender callback currently owns the final idle-parity pass.
  let previousSceneBeforeRender = null; // Preserves any editor callback that existed before this adapter attached.
  let sceneBeforeRenderWrapper = null; // Identifies this adapter's scene callback for safe scene replacement cleanup.
  let lastProfileSignature = ''; // Prevents the same resolved-rig diagnostic from flooding the mobile Diagnostics panel every frame.
  let explicitDanceWasActive = false; // Forces idle ownership to reacquire once an explicit Dance arm pose releases the hands.
  let debugSnapshot = { installed: true, active: false, reason: 'waiting-for-preview' }; // Supplies mobile-visible inspectable state without requiring DevTools.

  function editorLog(message, level = 'info', extra = null) {
    const backdropLog = global.HobunjiGameplayBackdrop?.log; // Reuses the procedural editor's built-in Diagnostics panel on mobile.
    if (backdropLog) { backdropLog(message, level, extra); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info; // Falls back to the browser console outside the editor shell.
    fn(message, extra ?? '');
  }

  function normalizeSpecies(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-'); // Normalizes every known avatar/export species spelling before profile lookup.
    return typeof global.hobunjiTransformSpeciesId === 'function' ? global.hobunjiTransformSpeciesId(raw) : raw;
  }

  function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase(); // Normalizes compact authoring-tool gender values to the profile keys used by attachment-rig-profiles.js.
    return raw === 'female' || raw === 'f' ? 'female' : 'male';
  }

  function identityFromObject(value) {
    if (!value || typeof value !== 'object') return null;
    const appearance = value.appearance || value.profile?.appearance || value.profile?.fighter || value.fighter || {}; // Covers the shared avatar/profile record shapes already used by the direct-hand runtime.
    const species = normalizeSpecies(value.speciesId || value.species || appearance.speciesId || appearance.species); // Supplies the transform species used for the canonical rig-profile key.
    if (!species) return null;
    const gender = normalizeGender(value.gender || appearance.gender); // Supplies the gender half of the canonical rig-profile key.
    return { species, gender, source: 'avatar-metadata' };
  }

  function identityForModel(model) {
    for (let node = model; node; node = node.parent) {
      const scaleState = node.userData?.hobunjiCharacterRigScaleState; // Preferred source because the shared whole-character scale runtime records the exact transform species/gender it applied.
      if (scaleState?.species) return { species: normalizeSpecies(scaleState.species), gender: normalizeGender(scaleState.gender), source: 'character-rig-scale' };
    }
    const direct = identityFromObject(model?.userData); // Falls back to avatar metadata when the scale wrapper has not run in this editor build.
    if (direct) return direct;
    const handRig = model?.userData?.proceduralHandRig; // Reuses direct-hand identity if this preview happens to be using the shared runtime rig rather than editor-generated wrappers.
    if (handRig?.speciesId) return { species: normalizeSpecies(handRig.speciesId), gender: normalizeGender(handRig.gender), source: 'procedural-hand-rig' };
    return null;
  }

  function handFor(model, side) {
    const exactName = `${model?.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Hand`; // Matches buildExperimentalHandsForAvatar() and Dance's existing lazy hand lookup.
    const exact = model?.getObjectByName?.(exactName) || null; // Uses the stable editor-generated wrapper name first.
    if (exact) return exact;
    const suffix = side === 'left' ? /_LeftHand$/i : /_RightHand$/i; // Allows older preview names while still restricting the fallback to generated hand wrappers.
    return (model?.children || []).find(node => suffix.test(String(node?.name || ''))) || null;
  }

  function uniqueCharacterProfiles() {
    const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Reads the exact same canonical character profiles as gameplay shoulder aiming.
    return [...new Set(Object.values(characters).filter(Boolean))];
  }

  function profileForIdentity(identity) {
    if (!identity?.species) return null;
    const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Supplies authored posterior, shoulder, and anatomy values.
    return characters[`${identity.species}::${identity.gender}`] || null;
  }

  function positionDistanceSquared(a, b) {
    const dx = (Number(a?.x) || 0) - (Number(b?.x) || 0); // Used to score a generated hand against an authored shoulder X.
    const dy = (Number(a?.y) || 0) - (Number(b?.y) || 0); // Used to score a generated hand against an authored shoulder Y.
    const dz = (Number(a?.z) || 0) - (Number(b?.z) || 0); // Used to score a generated hand against an authored shoulder Z.
    return dx * dx + dy * dy + dz * dz;
  }

  function profileFromBrokenShoulderDefault(model, modelHeight) {
    const leftHand = handFor(model, 'left'); // Reads the currently broken left default before this adapter moves it away from the shoulder.
    const rightHand = handFor(model, 'right'); // Reads the currently broken right default before this adapter moves it away from the shoulder.
    if (!leftHand || !rightHand || leftHand.parent !== model || rightHand.parent !== model) return null;
    let best = null; // Holds the lowest shoulder-position error among canonical profiles when explicit identity metadata is unavailable.
    for (const profile of uniqueCharacterProfiles()) {
      const left = profile?.anchors?.leftHandShoulder?.position; // Canonical left shoulder in the same character-visual-local space as the generated wrapper.
      const right = profile?.anchors?.rightHandShoulder?.position; // Canonical right shoulder in the same character-visual-local space as the generated wrapper.
      if (!left || !right) continue;
      const score = positionDistanceSquared(leftHand.position, left) + positionDistanceSquared(rightHand.position, right); // Identifies the profile whose two authored shoulders produced the broken default most closely.
      if (!best || score < best.score) best = { profile, score };
    }
    const tolerance = Math.max(0.0004, modelHeight * SHOULDER_REACQUIRE_FRACTION); // Rejects coincidental nearest profiles when hands are already being explicitly animated elsewhere.
    return best && best.score <= tolerance * tolerance * 2 ? best.profile : null;
  }

  function resolveProfile(model, modelHeight) {
    const identity = identityForModel(model); // Prefers an explicit runtime identity over geometric inference.
    const directProfile = profileForIdentity(identity); // Resolves the same `species::gender` profile used by procedural-hand-shoulder-aim.js.
    if (directProfile) return { profile: directProfile, identity };
    const inferred = profileFromBrokenShoulderDefault(model, modelHeight); // Last-resort migration path for old editor previews that never published identity metadata.
    if (inferred) return { profile: inferred, identity: { species: inferred.species, gender: inferred.gender, source: 'shoulder-position-match' } };
    return { profile: null, identity };
  }

  function posteriorY(profile, modelHeight, handAttachY) {
    const shared = global.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(profile?.posteriorRule, modelHeight, handAttachY); // Uses the exact gameplay/Attack Editor posterior formula when the canonical helper is loaded.
    if (Number.isFinite(Number(shared))) return Number(shared);
    const floorPercent = Number(profile?.posteriorRule?.heightPercentFromFloor); // Preserves the canonical floor-relative rule if the helper has not loaded yet.
    if (Number.isFinite(floorPercent)) return modelHeight * floorPercent / 100;
    const legacyOffset = Number(profile?.posteriorRule?.heightPercentOffset); // Keeps legacy previews usable rather than snapping hands to zero.
    const legacyBase = Number(handAttachY); // Mirrors attachment-rig-profiles.js's legacy posterior fallback base.
    return (Number.isFinite(legacyBase) ? legacyBase : modelHeight / 2) + modelHeight * (Number.isFinite(legacyOffset) ? legacyOffset : -18) / 100;
  }

  function idleFallbackOffset(side, modelHeight, nowMs) {
    const idlePhase = nowMs * FALLBACK_IDLE_PHASE_RATE + (side === 'right' ? 0.28 : 0); // Matches procedural-hand-frame-driver.js's phase split for unowned idle hands.
    const idleBreath = Math.sin(idlePhase); // Drives the exact small idle Y breathing amount from the gameplay fallback.
    return {
      y: modelHeight * 0.0045 * idleBreath,
      z: modelHeight * 0.003 * Math.cos(idlePhase),
    };
  }

  function canonicalIdleTarget(profile, side, modelHeight, handAttachY, nowMs) {
    const shoulder = profile?.anchors?.[side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder']?.position; // Supplies the authored X anchor that gameplay preserves for a free hand.
    if (!shoulder) return null;
    const armLengthPercent = Number(profile?.anatomy?.armLengthHeightPercentOffset); // Positive authored values move the fallback hand downward, matching attachment-rig-profiles.js semantics.
    const armLengthY = Number.isFinite(armLengthPercent) ? -modelHeight * armLengthPercent / 100 : 0; // Converts the authored percentage into the same local-space Y offset as procedural-hand-shoulder-aim.js.
    const fallback = idleFallbackOffset(side, modelHeight, nowMs); // Adds the shared unowned-hand idle breathing without inventing editor-only motion.
    return {
      x: Number(shoulder.x) || 0,
      y: posteriorY(profile, modelHeight, handAttachY) + armLengthY + fallback.y,
      z: fallback.z,
      shoulder,
      armLengthPercent: Number.isFinite(armLengthPercent) ? armLengthPercent : 0,
    };
  }

  function toHandParentLocal(model, hand, point) {
    const Vector3 = model?.position?.constructor; // Reuses the editor's own Three.js Vector3 class even though window.THREE is not mirrored there.
    if (!Vector3 || !hand?.parent) return null;
    const local = new Vector3(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0); // Represents a canonical character-visual-local target before any parent conversion.
    if (hand.parent === model) return local;
    model.updateMatrixWorld?.(true);
    hand.parent.updateMatrixWorld?.(true);
    const world = model.localToWorld(local); // Converts canonical model-local coordinates into world space for nested legacy wrappers.
    return hand.parent.worldToLocal(world); // Converts the same point into the generated hand wrapper's actual parent space.
  }

  function positionNear(position, target, epsilon) {
    if (!position || !target) return false;
    return Math.abs(position.x - target.x) <= epsilon && Math.abs(position.y - target.y) <= epsilon && Math.abs(position.z - target.z) <= epsilon;
  }

  function ownershipFor(hand) {
    let state = handState.get(hand); // Reuses ownership across frames so another authoring writer can take over simply by moving the hand away from our last result.
    if (!state) {
      state = { owns: false, lastWritten: null }; // Starts unowned until the hand is proven to still be at the editor's default shoulder placement.
      handState.set(hand, state);
    }
    return state;
  }

  function syncSide(model, profile, side, modelHeight, nowMs, forceReacquire) {
    const hand = handFor(model, side); // Uses the editor's existing GLB wrapper; no duplicate hand model or rig is created.
    if (!hand) return { side, available: false, owns: false };
    const targetInfo = canonicalIdleTarget(profile, side, modelHeight, model.userData?.handAttachY, nowMs); // Resolves the canonical gameplay idle endpoint for this side.
    if (!targetInfo) return { side, available: true, owns: false, reason: 'missing-shoulder' };
    const target = toHandParentLocal(model, hand, targetInfo); // Places the canonical target in the wrapper's actual parent space.
    const shoulder = toHandParentLocal(model, hand, targetInfo.shoulder); // Places the authored shoulder in the same space for default-ownership detection.
    if (!target || !shoulder) return { side, available: true, owns: false, reason: 'missing-three-bridge' };

    const ownership = ownershipFor(hand); // Tracks whether this adapter still owns the default rather than an authored procedural arm animation.
    const epsilon = Math.max(0.00025, modelHeight * OWNERSHIP_EPSILON_FRACTION); // Scales the ownership tolerance with the preview avatar instead of using one species-specific world-unit value.
    const shoulderEpsilon = Math.max(epsilon, modelHeight * SHOULDER_REACQUIRE_FRACTION); // Allows the broken shoulder default to reacquire even if its authored preview scale is slightly different.
    const stillOurWrite = ownership.lastWritten && positionNear(hand.position, ownership.lastWritten, epsilon); // Confirms no later authoring writer moved this hand after our previous frame.
    const atShoulderDefault = positionNear(hand.position, shoulder, shoulderEpsilon); // Detects the exact old behavior this adapter is replacing.
    if (forceReacquire || atShoulderDefault) ownership.owns = true;
    else if (ownership.owns && !stillOurWrite) ownership.owns = false; // Immediately yields when another arm animation writes a different position.

    if (!ownership.owns) return { side, available: true, owns: false, reason: 'explicit-animation-owner' };
    hand.position.copy(target); // Applies only the shared idle position; existing editor hand orientation/material logic remains untouched.
    hand.updateMatrix?.();
    hand.updateMatrixWorld?.(true); // scene.onBeforeRender runs after the normal scene matrix traversal, so update the moved hand immediately for this same rendered frame.
    ownership.lastWritten = target.clone(); // Supplies next frame's ownership check without comparing against a moving breathing target.
    return {
      side,
      available: true,
      owns: true,
      position: { x: target.x, y: target.y, z: target.z },
      shoulder: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
      armLengthPercent: targetInfo.armLengthPercent,
    };
  }

  function applyIdleArmParity(nowMs = performance.now()) {
    const backdrop = global.HobunjiGameplayBackdrop; // Supplies the exact current procedural-editor preview without reaching into giant index.html private variables.
    const model = backdrop?.getAvatarModel?.() || null; // Supplies the humanoid preview root whose generated hand wrappers are being corrected.
    if (!model) {
      debugSnapshot = { ...debugSnapshot, active: false, reason: 'waiting-for-preview' };
      return false;
    }

    const dance = global.ProceduralDanceMode?.getDebug?.() || null; // Lets explicit Dance arm poses remain higher-priority owners than the default idle behavior.
    const explicitDance = !!(dance?.enabled && dance?.armStyle && dance.armStyle !== 'none'); // Only non-relaxed Dance arm styles should suppress the canonical default.
    const forceReacquire = explicitDanceWasActive && !explicitDance; // Restores default ownership immediately when an explicit Dance pose ends.
    explicitDanceWasActive = explicitDance;
    if (explicitDance) {
      debugSnapshot = { ...debugSnapshot, active: false, reason: `dance:${dance.armStyle}`, dance };
      return false;
    }

    const modelHeight = Math.max(0.05, Number(model.userData?.portraitModelHeight) || Number(model.userData?.portraitModelWidth) || 0.9); // Uses the same portrait-model height basis as gameplay arm-length/posterior math.
    const resolved = resolveProfile(model, modelHeight); // Resolves the canonical species/gender attachment profile for this preview.
    const profile = resolved.profile;
    if (!profile) {
      debugSnapshot = { installed: true, active: false, reason: 'attachment-profile-unresolved', identity: resolved.identity || null, model: model.name || null };
      return false;
    }

    const signature = `${profile.species || resolved.identity?.species || '?'}::${profile.gender || resolved.identity?.gender || '?'}:${resolved.identity?.source || 'profile'}`; // Identifies the current resolved profile for one-time mobile diagnostics.
    if (signature !== lastProfileSignature) {
      lastProfileSignature = signature;
      editorLog('[Idle arms] Procedural editor now uses gameplay/Attack Editor free-hand placement.', 'info', {
        profile: `${profile.species}::${profile.gender}`,
        identitySource: resolved.identity?.source || 'profile',
        posteriorY: posteriorY(profile, modelHeight, model.userData?.handAttachY),
        armLengthHeightPercentOffset: Number(profile.anatomy?.armLengthHeightPercentOffset) || 0,
        rule: 'shoulder-x + posterior-y - arm-length + shared idle fallback',
      });
    }

    const left = syncSide(model, profile, 'left', modelHeight, nowMs, forceReacquire); // Applies/yields left-hand default ownership independently.
    const right = syncSide(model, profile, 'right', modelHeight, nowMs, forceReacquire); // Applies/yields right-hand default ownership independently.
    const active = !!(left.owns || right.owns); // Reports whether at least one free/default hand was actually corrected this frame.
    debugSnapshot = {
      installed: true,
      active,
      reason: active ? 'canonical-idle' : 'explicit-animation-owner',
      model: model.name || null,
      profile: `${profile.species}::${profile.gender}`,
      identitySource: resolved.identity?.source || 'profile',
      posteriorY: posteriorY(profile, modelHeight, model.userData?.handAttachY),
      armLengthHeightPercentOffset: Number(profile.anatomy?.armLengthHeightPercentOffset) || 0,
      left,
      right,
      dance,
      latestChange: 'Default generated hands now use gameplay/Attack Editor shoulder X + posterior Y + authored arm length, with the shared idle breathing offset.',
    };
    return active;
  }

  function attachToScene(scene) {
    if (!scene || scene === activeScene) return;
    if (activeScene && activeScene.onBeforeRender === sceneBeforeRenderWrapper) activeScene.onBeforeRender = previousSceneBeforeRender; // Restores the previous preview scene if the editor rebuilds it.
    activeScene = scene;
    previousSceneBeforeRender = typeof scene.onBeforeRender === 'function' ? scene.onBeforeRender : null; // Preserves any earlier editor render-stage hook.
    sceneBeforeRenderWrapper = function proceduralEditorIdleArmBeforeRender() {
      if (previousSceneBeforeRender) previousSceneBeforeRender.apply(this, arguments); // Lets existing scene-level authoring logic write first.
      applyIdleArmParity(performance.now()); // Applies the default at the final scene hook, after Dance/body writers but before WebGL projects child matrices.
    };
    sceneBeforeRenderWrapper.__hobunjiProceduralEditorIdleArms = true;
    scene.onBeforeRender = sceneBeforeRenderWrapper;
    editorLog('[Idle arms] Final pre-render parity hook attached to procedural editor scene.');
  }

  function refreshSceneBinding() {
    const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null; // Detects the live scene once the repository-backed editor preview finishes booting.
    if (scene && scene !== activeScene) attachToScene(scene);
    requestAnimationFrame(refreshSceneBinding);
  }

  global.HobunjiProceduralEditorIdleArms = {
    installed: true,
    syncNow: () => applyIdleArmParity(performance.now()),
    getDebug: () => ({ ...debugSnapshot }),
  };

  requestAnimationFrame(refreshSceneBinding);
})(window);
