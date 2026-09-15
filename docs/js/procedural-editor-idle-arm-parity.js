// Procedural Animation Editor: gameplay/Attack Editor free-hand idle parity.
//
// This adapter does not create another arm rig. It owns only the default
// position of the editor's already-generated hand wrappers, and yields as soon
// as an explicit authoring writer moves a hand away from a recognized idle
// default. The canonical target is the same one used by gameplay: authored
// shoulder X + floor-relative posterior Y - authored arm length + idle breath.
(function (global) {
  'use strict';

  if (global.HobunjiProceduralEditorIdleArms?.installed) return;

  const OWNERSHIP_EPSILON_FRACTION = 0.012; // Distinguishes our previous write from a later explicit hand writer.
  const DEFAULT_REACQUIRE_FRACTION = 0.04; // Tolerance for recognizing old editor idle/shoulder defaults.
  const FALLBACK_IDLE_PHASE_RATE = 0.0017; // Matches procedural-hand-frame-driver.js.
  const handState = new WeakMap(); // Per-hand ownership and previous write.
  const inferredProfileCache = new WeakMap(); // Keeps a geometry/asset-inferred profile stable after the first correction moves the hands.
  let activeScene = null; // Current preview scene whose final pre-render callback we own.
  let previousSceneBeforeRender = null; // Callback that was present before our current wrapper.
  let sceneBeforeRenderWrapper = null; // Our current scene wrapper identity.
  let hookAttachCount = 0; // Exposed in diagnostics so mobile testing can reveal callback replacement/rebinds.
  let explicitDanceWasActive = false; // Reacquires defaults after an explicit Dance arm style releases them.
  let lastProfileSignature = ''; // Avoids repeating the same profile-resolution entry every frame.
  let lastStatusSignature = ''; // Avoids flooding Diagnostics with identical ownership state.
  let lastUnresolvedSignature = ''; // Avoids flooding unresolved-profile warnings while still logging meaningful changes.
  let lastModel = null; // Lets avatar switches force a fresh diagnostic even when species/gender are unchanged.
  let debugSnapshot = { installed: true, active: false, reason: 'waiting-for-preview' };

  function editorLog(message, level = 'info', extra = null) {
    const backdropLog = global.HobunjiGameplayBackdrop?.log; // Uses the editor's mobile-visible Diagnostics panel.
    if (backdropLog) { backdropLog(message, level, extra); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(message, extra ?? '');
  }

  function normalizeSpecies(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return typeof global.hobunjiTransformSpeciesId === 'function' ? global.hobunjiTransformSpeciesId(raw) : raw;
  }

  function normalizeGender(value, fallback = null) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'female' || raw === 'f') return 'female';
    if (raw === 'male' || raw === 'm') return 'male';
    return fallback;
  }

  function identityFromObject(value, source = 'avatar-metadata') {
    if (!value || typeof value !== 'object') return null;
    const candidates = [
      value,
      value.appearance,
      value.profile,
      value.profile?.appearance,
      value.profile?.fighter,
      value.fighter,
      value.avatar,
      value.npc,
      value.export,
    ].filter(Boolean);
    for (const candidate of candidates) {
      const species = normalizeSpecies(candidate.speciesId || candidate.species || candidate.kind);
      const gender = normalizeGender(candidate.gender || candidate.sex);
      if (species && gender) return { species, gender, source };
    }
    return null;
  }

  function walkModel(model, callback) {
    if (!model) return;
    if (typeof model.traverse === 'function') { model.traverse(callback); return; }
    const visit = node => {
      callback(node);
      for (const child of node?.children || []) visit(child);
    };
    visit(model);
  }

  function identityFromModelMetadata(model) {
    for (let node = model; node; node = node.parent) {
      const scaleState = node.userData?.hobunjiCharacterRigScaleState;
      if (scaleState?.species) {
        const gender = normalizeGender(scaleState.gender);
        if (gender) return { species: normalizeSpecies(scaleState.species), gender, source: 'character-rig-scale' };
      }
      const direct = identityFromObject(node.userData, node === model ? 'avatar-metadata' : 'ancestor-metadata');
      if (direct) return direct;
    }
    let nested = null;
    walkModel(model, node => {
      if (!nested) nested = identityFromObject(node?.userData, 'descendant-metadata');
    });
    return nested;
  }

  function stringSourcesForNode(node) {
    const out = [];
    if (node?.name) out.push(String(node.name));
    const userData = node?.userData || {};
    for (const key of ['url', 'src', 'sourceUrl', 'assetUrl', 'textureUrl', 'portraitUrl', 'spriteUrl']) {
      if (typeof userData[key] === 'string') out.push(userData[key]);
    }
    const materials = Array.isArray(node?.material) ? node.material : node?.material ? [node.material] : [];
    for (const material of materials) {
      for (const map of [material?.map, material?.alphaMap, material?.emissiveMap].filter(Boolean)) {
        const image = map.image || map.source?.data;
        for (const value of [image?.currentSrc, image?.src, map?.userData?.url, map?.name]) {
          if (typeof value === 'string' && value) out.push(value);
        }
      }
    }
    return out;
  }

  function assetSpeciesCandidates() {
    const profiles = uniqueCharacterProfiles();
    const seen = new Set();
    const out = [];
    for (const profile of profiles) {
      const species = normalizeSpecies(profile?.species);
      if (!species || seen.has(species)) continue;
      seen.add(species);
      out.push({ assetSpecies: species, transformSpecies: species });
    }
    const aliases = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characterTransformAliases || global.HOBUNJI_TRANSFORM_SPECIES_ALIASES || {};
    for (const [alias, target] of Object.entries(aliases)) {
      const assetSpecies = String(alias || '').trim().toLowerCase().replace(/[’']/g, '');
      const transformSpecies = normalizeSpecies(target);
      if (assetSpecies && transformSpecies) out.push({ assetSpecies, transformSpecies });
    }
    return out.sort((a, b) => b.assetSpecies.length - a.assetSpecies.length);
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function identityFromAssetString(value) {
    const raw = String(value || '').toLowerCase().replace(/[’']/g, '');
    if (!raw) return null;
    for (const candidate of assetSpeciesCandidates()) {
      const variants = new Set([
        candidate.assetSpecies,
        candidate.assetSpecies.replace(/-/g, '_'),
        candidate.assetSpecies.replace(/_/g, '-'),
      ]);
      for (const variant of variants) {
        const escaped = escapeRegex(variant);
        const after = raw.match(new RegExp(`${escaped}[_-](female|male|f|m)(?=[._/\\-]|$)`, 'i'));
        const before = raw.match(new RegExp(`(?:^|[._/\\-])(female|male|f|m)[_-]${escaped}(?=[._/\\-]|$)`, 'i'));
        const token = after?.[1] || before?.[1] || null;
        const gender = normalizeGender(token);
        if (gender) return { species: candidate.transformSpecies, gender, source: 'avatar-asset-url', evidence: value };
      }
    }
    return null;
  }

  function identityFromModelAssets(model) {
    let found = null;
    walkModel(model, node => {
      if (found) return;
      for (const value of stringSourcesForNode(node)) {
        const identity = identityFromAssetString(value);
        if (identity) { found = identity; break; }
      }
    });
    return found;
  }

  function identityForModel(model) {
    const metadata = identityFromModelMetadata(model);
    if (metadata) return metadata;
    const handRig = model?.userData?.proceduralHandRig;
    if (handRig?.speciesId) {
      const gender = normalizeGender(handRig.gender);
      if (gender) return { species: normalizeSpecies(handRig.speciesId), gender, source: 'procedural-hand-rig' };
    }
    return identityFromModelAssets(model);
  }

  function handFor(model, side) {
    const exactName = `${model?.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Hand`;
    const exact = model?.getObjectByName?.(exactName) || null;
    if (exact) return exact;
    const suffix = side === 'left' ? /_LeftHand$/i : /_RightHand$/i;
    let found = null;
    walkModel(model, node => { if (!found && suffix.test(String(node?.name || ''))) found = node; });
    return found;
  }

  function uniqueCharacterProfiles() {
    const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return [...new Set(Object.values(characters).filter(Boolean))];
  }

  function profileForIdentity(identity) {
    if (!identity?.species || !identity?.gender) return null;
    return global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${identity.species}::${identity.gender}`] || null;
  }

  function modelLocalHandPosition(model, hand) {
    if (!model || !hand) return null;
    if (hand.parent === model) return hand.position?.clone?.() || null;
    const Vector3 = model.position?.constructor;
    if (!Vector3 || !hand.getWorldPosition || !model.worldToLocal) return null;
    model.updateMatrixWorld?.(true);
    hand.updateMatrixWorld?.(true);
    const world = hand.getWorldPosition(new Vector3());
    return model.worldToLocal(world);
  }

  function positionDistanceSquared(a, b) {
    if (!a || !b) return Infinity;
    const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
    const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
    const dz = (Number(a.z) || 0) - (Number(b.z) || 0);
    return dx * dx + dy * dy + dz * dz;
  }

  function profileFromBrokenShoulderDefault(model, modelHeight) {
    const leftHand = handFor(model, 'left');
    const rightHand = handFor(model, 'right');
    const leftPosition = modelLocalHandPosition(model, leftHand);
    const rightPosition = modelLocalHandPosition(model, rightHand);
    if (!leftPosition || !rightPosition) return null;
    let best = null;
    for (const profile of uniqueCharacterProfiles()) {
      const left = profile?.anchors?.leftHandShoulder?.position;
      const right = profile?.anchors?.rightHandShoulder?.position;
      if (!left || !right) continue;
      const score = positionDistanceSquared(leftPosition, left) + positionDistanceSquared(rightPosition, right);
      if (!best || score < best.score) best = { profile, score };
    }
    const tolerance = Math.max(0.0004, modelHeight * DEFAULT_REACQUIRE_FRACTION);
    return best && best.score <= tolerance * tolerance * 2 ? best.profile : null;
  }

  function resolveProfile(model, modelHeight) {
    const identity = identityForModel(model);
    const directProfile = profileForIdentity(identity);
    if (directProfile) {
      inferredProfileCache.set(model, { profile: directProfile, identity });
      return { profile: directProfile, identity };
    }
    const cached = inferredProfileCache.get(model);
    if (cached?.profile) return { profile: cached.profile, identity: { ...cached.identity, source: `${cached.identity?.source || 'inferred'}-cache` } };
    const inferred = profileFromBrokenShoulderDefault(model, modelHeight);
    if (inferred) {
      const inferredIdentity = { species: inferred.species, gender: inferred.gender, source: 'shoulder-position-match' };
      inferredProfileCache.set(model, { profile: inferred, identity: inferredIdentity });
      return { profile: inferred, identity: inferredIdentity };
    }
    return { profile: null, identity };
  }

  function previewModelHeight(model) {
    const direct = Number(model?.userData?.portraitModelHeight) || Number(model?.userData?.portraitModelWidth);
    if (Number.isFinite(direct) && direct > 0) return Math.max(0.05, direct);
    let planeHeight = null;
    walkModel(model, node => {
      if (planeHeight != null || !node?.isMesh) return;
      const h = Number(node.geometry?.parameters?.height);
      if (Number.isFinite(h) && h > 0) planeHeight = h;
    });
    return Math.max(0.05, planeHeight || 0.9);
  }

  function posteriorY(profile, modelHeight, handAttachY) {
    const shared = global.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(profile?.posteriorRule, modelHeight, handAttachY);
    if (Number.isFinite(Number(shared))) return Number(shared);
    const floorPercent = Number(profile?.posteriorRule?.heightPercentFromFloor);
    if (Number.isFinite(floorPercent)) return modelHeight * floorPercent / 100;
    const legacyOffset = Number(profile?.posteriorRule?.heightPercentOffset);
    const legacyBase = Number(handAttachY);
    return (Number.isFinite(legacyBase) ? legacyBase : modelHeight / 2) + modelHeight * (Number.isFinite(legacyOffset) ? legacyOffset : -18) / 100;
  }

  function idleFallbackOffset(side, modelHeight, nowMs) {
    const idlePhase = nowMs * FALLBACK_IDLE_PHASE_RATE + (side === 'right' ? 0.28 : 0);
    return {
      y: modelHeight * 0.0045 * Math.sin(idlePhase),
      z: modelHeight * 0.003 * Math.cos(idlePhase),
    };
  }

  function canonicalIdleTarget(profile, side, modelHeight, handAttachY, nowMs) {
    const shoulder = profile?.anchors?.[side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder']?.position;
    if (!shoulder) return null;
    const armLengthPercent = Number(profile?.anatomy?.armLengthHeightPercentOffset);
    const armLengthY = Number.isFinite(armLengthPercent) ? -modelHeight * armLengthPercent / 100 : 0;
    const fallback = idleFallbackOffset(side, modelHeight, nowMs);
    const posterior = posteriorY(profile, modelHeight, handAttachY);
    return {
      x: Number(shoulder.x) || 0,
      y: posterior + armLengthY + fallback.y,
      z: fallback.z,
      shoulder,
      posteriorY: posterior,
      armLengthPercent: Number.isFinite(armLengthPercent) ? armLengthPercent : 0,
      armLengthY,
      fallback,
    };
  }

  function legacyEditorIdleTarget(model, side) {
    const handAttachX = Number(model?.userData?.handAttachX);
    const handAttachY = Number(model?.userData?.handAttachY);
    if (!Number.isFinite(handAttachX) || !Number.isFinite(handAttachY)) return null;
    return { x: side === 'left' ? -handAttachX : handAttachX, y: handAttachY, z: 0 };
  }

  function toHandParentLocal(model, hand, point) {
    const Vector3 = model?.position?.constructor;
    if (!Vector3 || !hand?.parent) return null;
    const local = new Vector3(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0);
    if (hand.parent === model) return local;
    if (!model.localToWorld || !hand.parent.worldToLocal) return null;
    model.updateMatrixWorld?.(true);
    hand.parent.updateMatrixWorld?.(true);
    const world = model.localToWorld(local);
    return hand.parent.worldToLocal(world);
  }

  function positionNear(position, target, epsilon) {
    if (!position || !target) return false;
    return Math.abs(position.x - target.x) <= epsilon && Math.abs(position.y - target.y) <= epsilon && Math.abs(position.z - target.z) <= epsilon;
  }

  function vectorJson(value) {
    if (!value) return null;
    return { x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 };
  }

  function handSummary(model, side) {
    const hand = handFor(model, side);
    if (!hand) return { side, available: false };
    return {
      side,
      available: true,
      name: hand.name || null,
      parent: hand.parent?.name || hand.parent?.type || null,
      localPosition: vectorJson(hand.position),
      modelLocalPosition: vectorJson(modelLocalHandPosition(model, hand)),
    };
  }

  function ownershipFor(hand) {
    let state = handState.get(hand);
    if (!state) {
      state = { owns: false, lastWritten: null };
      handState.set(hand, state);
    }
    return state;
  }

  function syncSide(model, profile, side, modelHeight, nowMs, forceReacquire) {
    const hand = handFor(model, side);
    if (!hand) return { side, available: false, owns: false, reason: 'hand-not-built-yet' };
    const targetInfo = canonicalIdleTarget(profile, side, modelHeight, model.userData?.handAttachY, nowMs);
    if (!targetInfo) return { side, available: true, owns: false, reason: 'missing-shoulder' };
    const target = toHandParentLocal(model, hand, targetInfo);
    const shoulder = toHandParentLocal(model, hand, targetInfo.shoulder);
    const legacyInfo = legacyEditorIdleTarget(model, side);
    const legacyIdle = legacyInfo ? toHandParentLocal(model, hand, legacyInfo) : null;
    if (!target || !shoulder) return { side, available: true, owns: false, reason: 'missing-three-bridge' };

    const ownership = ownershipFor(hand);
    const epsilon = Math.max(0.00025, modelHeight * OWNERSHIP_EPSILON_FRACTION);
    const defaultEpsilon = Math.max(epsilon, modelHeight * DEFAULT_REACQUIRE_FRACTION);
    const stillOurWrite = !!(ownership.lastWritten && positionNear(hand.position, ownership.lastWritten, epsilon));
    const atShoulderDefault = positionNear(hand.position, shoulder, defaultEpsilon);
    const atLegacyIdleDefault = !!(legacyIdle && positionNear(hand.position, legacyIdle, defaultEpsilon));
    if (forceReacquire || atShoulderDefault || atLegacyIdleDefault) ownership.owns = true;
    else if (ownership.owns && !stillOurWrite) ownership.owns = false;

    const base = {
      side,
      available: true,
      owns: ownership.owns,
      current: vectorJson(hand.position),
      handName: hand.name || null,
      handParent: hand.parent?.name || hand.parent?.type || null,
      shoulder: vectorJson(shoulder),
      legacyIdle: vectorJson(legacyIdle),
      target: vectorJson(target),
      atShoulderDefault,
      atLegacyIdleDefault,
      stillOurWrite,
      posteriorY: targetInfo.posteriorY,
      armLengthPercent: targetInfo.armLengthPercent,
      armLengthY: targetInfo.armLengthY,
      idleOffset: { ...targetInfo.fallback },
    };
    if (!ownership.owns) return { ...base, reason: 'explicit-animation-owner' };

    hand.position.copy(target);
    hand.updateMatrix?.();
    hand.updateMatrixWorld?.(true);
    ownership.lastWritten = target.clone();
    return { ...base, owns: true, reason: atLegacyIdleDefault ? 'claimed-legacy-idle' : atShoulderDefault ? 'claimed-shoulder-default' : forceReacquire ? 'reacquired-after-dance' : 'canonical-idle', position: vectorJson(target) };
  }

  function unresolvedDiagnostic(model, modelHeight, resolved) {
    return {
      model: model?.name || null,
      modelHeight,
      modelScale: vectorJson(model?.scale),
      identity: resolved?.identity || null,
      modelUserDataKeys: Object.keys(model?.userData || {}).sort(),
      handAttachX: Number(model?.userData?.handAttachX),
      handAttachY: Number(model?.userData?.handAttachY),
      left: handSummary(model, 'left'),
      right: handSummary(model, 'right'),
      profileCount: uniqueCharacterProfiles().length,
      hint: 'Expected identity from character-rig-scale/avatar metadata/portrait asset URL, with shoulder-position matching only as a final fallback.',
    };
  }

  function statusDiagnostic(model, profile, resolved, modelHeight, left, right, dance) {
    const posterior = posteriorY(profile, modelHeight, model.userData?.handAttachY);
    const armLengthPercent = Number(profile.anatomy?.armLengthHeightPercentOffset) || 0;
    return {
      model: model.name || null,
      profile: `${profile.species}::${profile.gender}`,
      identitySource: resolved.identity?.source || 'profile',
      identityEvidence: resolved.identity?.evidence || null,
      modelHeight,
      modelScale: vectorJson(model.scale),
      handAttachX: Number(model.userData?.handAttachX),
      handAttachY: Number(model.userData?.handAttachY),
      posteriorY: posterior,
      armLengthHeightPercentOffset: armLengthPercent,
      armLengthWorldY: -modelHeight * armLengthPercent / 100,
      hook: {
        attached: !!(activeScene && activeScene.onBeforeRender === sceneBeforeRenderWrapper),
        attachCount: hookAttachCount,
        scene: activeScene?.name || activeScene?.type || 'scene',
      },
      left,
      right,
      dance: dance ? { enabled: !!dance.enabled, armStyle: dance.armStyle || 'none' } : null,
      rule: 'shoulder-x + posterior-y - arm-length + shared idle fallback',
    };
  }

  function maybeLogStatus(snapshot, force = false) {
    const leftState = `${snapshot.left?.available ? 1 : 0}:${snapshot.left?.owns ? 1 : 0}:${snapshot.left?.reason || ''}`;
    const rightState = `${snapshot.right?.available ? 1 : 0}:${snapshot.right?.owns ? 1 : 0}:${snapshot.right?.reason || ''}`;
    const signature = `${snapshot.model}|${snapshot.profile}|${snapshot.identitySource}|${leftState}|${rightState}|hook:${snapshot.hook?.attachCount || 0}`;
    if (!force && signature === lastStatusSignature) return;
    lastStatusSignature = signature;
    editorLog('[Idle arms] Idle-arm parity diagnostic', snapshot.active ? 'info' : 'warn', snapshot);
  }

  function applyIdleArmParity(nowMs = performance.now(), forceLog = false) {
    const backdrop = global.HobunjiGameplayBackdrop;
    const model = backdrop?.getAvatarModel?.() || null;
    if (!model) {
      debugSnapshot = { ...debugSnapshot, active: false, reason: 'waiting-for-preview', hookAttachCount };
      return false;
    }

    if (model !== lastModel) {
      lastModel = model;
      lastProfileSignature = '';
      lastStatusSignature = '';
      lastUnresolvedSignature = '';
    }

    const dance = global.ProceduralDanceMode?.getDebug?.() || null;
    const explicitDance = !!(dance?.enabled && dance?.armStyle && dance.armStyle !== 'none');
    const forceReacquire = explicitDanceWasActive && !explicitDance;
    explicitDanceWasActive = explicitDance;
    if (explicitDance) {
      debugSnapshot = { installed: true, active: false, reason: `dance:${dance.armStyle}`, model: model.name || null, dance, hookAttachCount };
      if (forceLog) editorLog('[Idle arms] Explicit Dance arm style owns the hands.', 'info', debugSnapshot);
      return false;
    }

    const modelHeight = previewModelHeight(model);
    const resolved = resolveProfile(model, modelHeight);
    const profile = resolved.profile;
    if (!profile) {
      const detail = unresolvedDiagnostic(model, modelHeight, resolved);
      debugSnapshot = { installed: true, active: false, reason: 'attachment-profile-unresolved', hookAttachCount, ...detail };
      const signature = JSON.stringify({ model: detail.model, identity: detail.identity, left: detail.left?.available, right: detail.right?.available, keys: detail.modelUserDataKeys });
      if (forceLog || signature !== lastUnresolvedSignature) {
        lastUnresolvedSignature = signature;
        editorLog('[Idle arms] Could not resolve the current avatar attachment profile.', 'warn', debugSnapshot);
      }
      return false;
    }

    const profileSignature = `${profile.species || resolved.identity?.species || '?'}::${profile.gender || resolved.identity?.gender || '?'}:${resolved.identity?.source || 'profile'}`;
    if (profileSignature !== lastProfileSignature) {
      lastProfileSignature = profileSignature;
      editorLog('[Idle arms] Resolved gameplay/Attack Editor free-hand profile.', 'info', {
        model: model.name || null,
        profile: `${profile.species}::${profile.gender}`,
        identitySource: resolved.identity?.source || 'profile',
        identityEvidence: resolved.identity?.evidence || null,
        modelHeight,
        handAttachX: Number(model.userData?.handAttachX),
        handAttachY: Number(model.userData?.handAttachY),
        posteriorY: posteriorY(profile, modelHeight, model.userData?.handAttachY),
        armLengthHeightPercentOffset: Number(profile.anatomy?.armLengthHeightPercentOffset) || 0,
      });
    }

    const left = syncSide(model, profile, 'left', modelHeight, nowMs, forceReacquire);
    const right = syncSide(model, profile, 'right', modelHeight, nowMs, forceReacquire);
    const active = !!(left.owns || right.owns);
    const diagnostic = statusDiagnostic(model, profile, resolved, modelHeight, left, right, dance);
    debugSnapshot = {
      installed: true,
      active,
      reason: active ? 'canonical-idle' : (left.reason === 'hand-not-built-yet' || right.reason === 'hand-not-built-yet') ? 'waiting-for-hands' : 'explicit-animation-owner',
      ...diagnostic,
      latestChange: 'Default generated hands now recognize the editor legacy handAttach idle as an acquireable default, then move to canonical gameplay shoulder/posterior/arm-length placement.',
    };
    maybeLogStatus(debugSnapshot, forceLog);
    return active;
  }

  function attachToScene(scene, reason = 'scene-ready') {
    if (!scene) return false;
    if (scene === activeScene && scene.onBeforeRender === sceneBeforeRenderWrapper) return true;

    if (activeScene && activeScene !== scene && activeScene.onBeforeRender === sceneBeforeRenderWrapper) {
      activeScene.onBeforeRender = previousSceneBeforeRender;
    }

    const replacingLostHook = scene === activeScene && sceneBeforeRenderWrapper && scene.onBeforeRender !== sceneBeforeRenderWrapper;
    const previous = typeof scene.onBeforeRender === 'function' && !scene.onBeforeRender.__hobunjiProceduralEditorIdleArms ? scene.onBeforeRender : null;
    const wrapper = function proceduralEditorIdleArmBeforeRender() {
      if (previous) previous.apply(this, arguments);
      applyIdleArmParity(performance.now());
    };
    wrapper.__hobunjiProceduralEditorIdleArms = true;

    activeScene = scene;
    previousSceneBeforeRender = previous;
    sceneBeforeRenderWrapper = wrapper;
    scene.onBeforeRender = wrapper;
    hookAttachCount += 1;

    editorLog(replacingLostHook
      ? '[Idle arms] Scene pre-render hook was replaced by another editor writer; idle-arm parity reattached.'
      : '[Idle arms] Final pre-render parity hook attached to procedural editor scene.',
      replacingLostHook ? 'warn' : 'info',
      { reason, hookAttachCount, chainedPreviousCallback: !!previous });
    return true;
  }

  function refreshSceneBinding() {
    const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null;
    if (scene && (scene !== activeScene || scene.onBeforeRender !== sceneBeforeRenderWrapper)) {
      attachToScene(scene, scene === activeScene ? 'hook-replaced' : 'scene-changed');
    }
    requestAnimationFrame(refreshSceneBinding);
  }

  global.HobunjiProceduralEditorIdleArms = {
    installed: true,
    syncNow: () => applyIdleArmParity(performance.now()),
    logNow: () => {
      applyIdleArmParity(performance.now(), true);
      return { ...debugSnapshot };
    },
    getDebug: () => ({ ...debugSnapshot }),
    getCanonicalTarget(side, nowMs = performance.now()) {
      const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
      if (!model) return null;
      const modelHeight = previewModelHeight(model);
      const resolved = resolveProfile(model, modelHeight);
      const target = resolved.profile ? canonicalIdleTarget(resolved.profile, side, modelHeight, model.userData?.handAttachY, nowMs) : null;
      return target ? { ...target, profile: `${resolved.profile.species}::${resolved.profile.gender}`, identitySource: resolved.identity?.source || 'profile' } : null;
    },
  };

  requestAnimationFrame(refreshSceneBinding);
})(window);
