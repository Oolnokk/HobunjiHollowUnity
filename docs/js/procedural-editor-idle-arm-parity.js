// Procedural Animation Editor: gameplay/Attack Editor free-hand idle parity.
//
// Full Character Scale is the source of truth for coordinate layout:
//   floor parent -> portrait model lifted by modelHeight / 2
//   hands live in the floor parent, not in the lifted portrait model.
//
// The procedural animation editor is different: its portrait model stays at its
// own pose-root origin and its generated hand wrappers are descendants of that
// portrait. To reproduce Full Character Scale visually, canonical floor-space
// hand/shoulder points are first converted to "virtual portrait local" by
// subtracting modelHeight / 2, then transformed into the wrapper's real parent.
(function (global) {
  'use strict';

  if (global.HobunjiProceduralEditorIdleArms?.installed) return;

  const DEFAULT_RUNTIME_SIZE = 0.9;
  const FALLBACK_IDLE_PHASE_RATE = 0.0017;
  const OWNERSHIP_EPSILON_FRACTION = 0.012;
  const DEFAULT_REACQUIRE_FRACTION = 0.04;
  const REPOSITORY = 'Oolnokk/HobunjiHollowUnity';
  const NPC_DATABASE_PATH = 'docs/config/npcs/hobunji-starter-npc-database.json';

  const handState = new WeakMap();
  const npcIdentityById = new Map();
  const npcLookupByRevision = new Map();
  const generationBridgeByModel = new WeakMap();
  const patchedHandRoots = new WeakSet();

  let generationCorrectionCount = 0;
  let lastGenerationCorrection = null;
  let activeScene = null;
  let previousSceneBeforeRender = null;
  let sceneBeforeRenderWrapper = null;
  let hookAttachCount = 0;
  let lastModel = null;
  let lastProfileSignature = '';
  let lastStatusSignature = '';
  let lastUnresolvedSignature = '';
  let explicitDanceWasActive = false;
  let debugSnapshot = { installed: true, active: false, reason: 'waiting-for-preview' };

  function editorLog(message, level = 'info', extra = null) {
    const log = global.HobunjiGameplayBackdrop?.log;
    if (log) { log(message, level, extra); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(message, extra ?? '');
  }

  function normalizeSpecies(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-');
    return typeof global.hobunjiTransformSpeciesId === 'function' ? global.hobunjiTransformSpeciesId(raw) : raw;
  }

  function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'female' || raw === 'f') return 'female';
    if (raw === 'male' || raw === 'm') return 'male';
    return null;
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
      value.experimentalFeet,
      value.editorGeneratedFeetDanceBridge,
      value.avatarEditor?.rawExport,
      value.avatarEditor?.rawExport?.appearance,
    ].filter(Boolean);
    for (const candidate of candidates) {
      const species = normalizeSpecies(candidate.speciesId || candidate.species || candidate.kind);
      const gender = normalizeGender(candidate.gender || candidate.sex);
      if (species && gender) return { species, gender, source };
    }
    return null;
  }

  function walk(root, callback) {
    if (!root) return;
    if (typeof root.traverse === 'function') { root.traverse(callback); return; }
    const visit = node => {
      callback(node);
      for (const child of node?.children || []) visit(child);
    };
    visit(root);
  }

  function npcRevision(model) {
    return String(model?.userData?.repositoryCommit || 'main').trim() || 'main';
  }

  function npcDatabaseUrl(model) {
    return `https://raw.githubusercontent.com/${REPOSITORY}/${encodeURIComponent(npcRevision(model))}/${NPC_DATABASE_PATH}`;
  }

  function npcLookupStatus(model) {
    const revision = npcRevision(model);
    const state = npcLookupByRevision.get(revision);
    return state
      ? { revision, state: state.state, url: state.url, count: state.count || 0, error: state.error || null }
      : { revision, state: 'idle', url: npcDatabaseUrl(model), count: 0, error: null };
  }

  function ensureNpcIdentityLookup(model) {
    const npcId = String(model?.userData?.npcId || '').trim();
    if (!npcId || npcIdentityById.has(npcId) || typeof global.fetch !== 'function') return;
    const revision = npcRevision(model);
    const prior = npcLookupByRevision.get(revision);
    if (prior?.state === 'loading' || prior?.state === 'ready') return;
    const url = npcDatabaseUrl(model);
    npcLookupByRevision.set(revision, { state: 'loading', url, count: 0, error: null });
    editorLog('[Idle arms] Resolving avatar identity from the same NPC database revision used by the preview.', 'info', { npcId, revision, url });
    global.fetch(url).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).then(data => {
      const records = Array.isArray(data) ? data : Array.isArray(data?.npcs) ? data.npcs : [];
      let count = 0;
      for (const record of records) {
        const id = String(record?.id || '').trim();
        if (!id) continue;
        const identity = identityFromObject(record, 'npc-database') || identityFromObject(record?.avatarEditor?.rawExport, 'npc-database');
        if (!identity) continue;
        npcIdentityById.set(id, { ...identity, source: 'npc-database', evidence: `${id}@${revision}` });
        count += 1;
      }
      npcLookupByRevision.set(revision, { state: 'ready', url, count, error: null });
      lastUnresolvedSignature = '';
      const resolved = npcIdentityById.get(npcId) || null;
      editorLog(resolved ? '[Idle arms] NPC database identity resolved.' : '[Idle arms] NPC database loaded, but current NPC identity is still unresolved.', resolved ? 'info' : 'warn', {
        npcId, revision, resolved, indexedIdentities: count,
      });
      applyIdleArmParity(performance.now(), true);
    }).catch(error => {
      npcLookupByRevision.set(revision, { state: 'error', url, count: 0, error: String(error?.message || error) });
      lastUnresolvedSignature = '';
      editorLog('[Idle arms] NPC database identity lookup failed.', 'warn', { npcId, revision, url, error: String(error?.message || error) });
    });
  }

  function identityForModel(model) {
    for (let node = model; node; node = node.parent) {
      const scaleState = node.userData?.hobunjiCharacterRigScaleState;
      if (scaleState?.species && normalizeGender(scaleState.gender)) {
        return { species: normalizeSpecies(scaleState.species), gender: normalizeGender(scaleState.gender), source: 'character-rig-scale' };
      }
      const direct = identityFromObject(node.userData, node === model ? 'avatar-metadata' : 'ancestor-metadata');
      if (direct) return direct;
    }
    const handRig = model?.userData?.proceduralHandRig;
    if (handRig?.speciesId && normalizeGender(handRig.gender)) {
      return { species: normalizeSpecies(handRig.speciesId), gender: normalizeGender(handRig.gender), source: 'procedural-hand-rig' };
    }
    const npcId = String(model?.userData?.npcId || '').trim();
    if (npcId && npcIdentityById.has(npcId)) return npcIdentityById.get(npcId);
    ensureNpcIdentityLookup(model);
    return null;
  }

  function profileFor(identity) {
    if (!identity?.species || !identity?.gender) return null;
    return global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${identity.species}::${identity.gender}`] || null;
  }

  function handFor(model, side) {
    const exactName = `${model?.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Hand`;
    const exact = model?.getObjectByName?.(exactName) || null;
    if (exact) return exact;
    const suffix = side === 'left' ? /_LeftHand$/i : /_RightHand$/i;
    let found = null;
    walk(model, node => { if (!found && suffix.test(String(node?.name || ''))) found = node; });
    return found;
  }

  function vectorJson(value) {
    return value ? { x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 } : null;
  }

  function dimsFor(model) {
    const width = Number(model?.userData?.portraitModelWidth) || Number(model?.userData?.gameWorldModelBaseWidth) || DEFAULT_RUNTIME_SIZE;
    const height = Number(model?.userData?.portraitModelHeight) || Number(model?.userData?.gameWorldModelBaseHeight) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function virtualPortraitLiftY(model) {
    return dimsFor(model).height / 2; // Exact Full Character Scale buildPreviewEntry contract: model.position.y = modelHeight / 2.
  }

  function fullScaleSpaceDiagnostic(model) {
    const Vector3 = model?.position?.constructor;
    const dims = dimsFor(model);
    const lift = dims.height / 2;
    let modelWorld = null;
    let virtualFloorWorld = null;
    if (Vector3 && model?.localToWorld) {
      model.updateMatrixWorld?.(true);
      modelWorld = model.localToWorld(new Vector3(0, 0, 0));
      virtualFloorWorld = model.localToWorld(new Vector3(0, -lift, 0));
    }
    return {
      coordinateSpace: 'virtual-full-character-scale-floor-parent',
      modelHeight: dims.height,
      actualEditorPortraitLocalY: Number(model?.position?.y) || 0,
      actualEditorPortraitWorldOrigin: vectorJson(modelWorld),
      fullCharacterScalePortraitLiftY: lift,
      synthesizedFloorWorldOrigin: vectorJson(virtualFloorWorld),
      contract: 'Full Character Scale sets portrait model.position.y=modelHeight/2; procedural editor keeps its portrait at its own pose-root origin, so floor-space points subtract modelHeight/2 before entering portrait-local space.',
    };
  }

  function bakedScaleFor(model, profile) {
    const dims = dimsFor(model);
    const authored = Number(profile?.handShoulderRule?.runtimeBaseWidth) || DEFAULT_RUNTIME_SIZE;
    return {
      x: authored > 0 ? dims.width / authored : 1,
      y: DEFAULT_RUNTIME_SIZE > 0 ? dims.height / DEFAULT_RUNTIME_SIZE : 1,
    };
  }

  function shoulderFloor(profile, side, scale) {
    const raw = profile?.anchors?.[side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder']?.position;
    if (!raw) return null;
    return {
      x: (Number(raw.x) || 0) * scale.x,
      y: (Number(raw.y) || 0) * scale.y,
      z: (Number(raw.z) || 0) * scale.x,
      raw,
    };
  }

  function posteriorY(profile, modelHeight, handAttachY) {
    const shared = global.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(profile?.posteriorRule, modelHeight, handAttachY);
    if (Number.isFinite(Number(shared))) return Number(shared);
    const floorPercent = Number(profile?.posteriorRule?.heightPercentFromFloor);
    if (Number.isFinite(floorPercent)) return modelHeight * floorPercent / 100;
    const offset = Number(profile?.posteriorRule?.heightPercentOffset);
    const base = Number(handAttachY);
    return (Number.isFinite(base) ? base : modelHeight / 2) + modelHeight * (Number.isFinite(offset) ? offset : -18) / 100;
  }

  function idleOffset(side, modelHeight, nowMs) {
    const phase = nowMs * FALLBACK_IDLE_PHASE_RATE + (side === 'right' ? 0.28 : 0);
    return {
      y: modelHeight * 0.0045 * Math.sin(phase),
      z: modelHeight * 0.003 * Math.cos(phase),
    };
  }

  function canonicalFloorTarget(model, profile, side, nowMs) {
    const dims = dimsFor(model);
    const scale = bakedScaleFor(model, profile);
    const shoulder = shoulderFloor(profile, side, scale);
    if (!shoulder) return null;
    const armLengthPercent = Number(profile?.anatomy?.armLengthHeightPercentOffset);
    const armLengthY = Number.isFinite(armLengthPercent) ? -dims.height * armLengthPercent / 100 : 0;
    const idle = idleOffset(side, dims.height, nowMs);
    const posterior = posteriorY(profile, dims.height, model?.userData?.handAttachY);
    return {
      floorTarget: { x: shoulder.x, y: posterior + armLengthY + idle.y, z: idle.z },
      shoulderFloor: { x: shoulder.x, y: shoulder.y, z: shoulder.z },
      rawShoulder: shoulder.raw,
      bakedScale: scale,
      posteriorY: posterior,
      armLengthPercent: Number.isFinite(armLengthPercent) ? armLengthPercent : 0,
      armLengthY,
      idleOffset: idle,
    };
  }

  function modelLocalToHandParent(model, hand, point) {
    const Vector3 = model?.position?.constructor;
    if (!Vector3 || !hand?.parent) return null;
    const value = new Vector3(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0);
    if (hand.parent === model) return value;
    if (!model.localToWorld || !hand.parent.worldToLocal) return null;
    model.updateMatrixWorld?.(true);
    hand.parent.updateMatrixWorld?.(true);
    model.localToWorld(value);
    hand.parent.worldToLocal(value);
    return value;
  }

  function fullScaleFloorToHandParent(model, hand, floorPoint) {
    const lift = virtualPortraitLiftY(model);
    // This is the crucial parity bridge. Full Character Scale would lift the portrait
    // +height/2 while leaving the hand in floor-parent coordinates. Since this editor
    // keeps the hand under the portrait, express that same point relative to the
    // virtual lifted portrait first, then map through the editor's actual hierarchy.
    return modelLocalToHandParent(model, hand, {
      x: Number(floorPoint?.x) || 0,
      y: (Number(floorPoint?.y) || 0) - lift,
      z: Number(floorPoint?.z) || 0,
    });
  }

  function handWorldPosition(hand, model) {
    const Vector3 = model?.position?.constructor;
    if (!Vector3 || !hand?.getWorldPosition) return null;
    hand.updateMatrixWorld?.(true);
    return hand.getWorldPosition(new Vector3());
  }

  function handFullScaleFloorPosition(hand, model) {
    const Vector3 = model?.position?.constructor;
    if (!Vector3 || !hand?.getWorldPosition || !model?.worldToLocal) return null;
    model.updateMatrixWorld?.(true);
    hand.updateMatrixWorld?.(true);
    const local = model.worldToLocal(hand.getWorldPosition(new Vector3()));
    local.y += virtualPortraitLiftY(model);
    return local;
  }

  function generatedIdleModelLocal(model, side, reversed = false) {
    const x = Number(model?.userData?.handAttachX);
    const y = Number(model?.userData?.handAttachY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const gameplayX = side === 'left' ? -x : x;
    return { x: reversed ? -gameplayX : gameplayX, y, z: 0 };
  }

  function positionNear(position, target, epsilon) {
    return !!position && !!target
      && Math.abs((Number(position.x) || 0) - (Number(target.x) || 0)) <= epsilon
      && Math.abs((Number(position.y) || 0) - (Number(target.y) || 0)) <= epsilon
      && Math.abs((Number(position.z) || 0) - (Number(target.z) || 0)) <= epsilon;
  }

  function normalizeGeneratedHandWrapper(model, hand, side) {
    if (!hand?.position) return false;
    const gameplay = generatedIdleModelLocal(model, side, false);
    const reversed = generatedIdleModelLocal(model, side, true);
    if (!gameplay || !reversed) return false;
    const dims = dimsFor(model);
    const epsilon = Math.max(0.00025, dims.height * DEFAULT_REACQUIRE_FRACTION);
    if (!positionNear(hand.position, reversed, epsilon) || positionNear(hand.position, gameplay, epsilon)) return false;
    const before = vectorJson(hand.position);
    hand.position.set?.(gameplay.x, gameplay.y, gameplay.z);
    if (!hand.position.set) Object.assign(hand.position, gameplay);
    hand.updateMatrix?.();
    hand.updateMatrixWorld?.(true);
    generationCorrectionCount += 1;
    lastGenerationCorrection = {
      model: model?.name || null,
      hand: hand?.name || null,
      side,
      before,
      after: vectorJson(hand.position),
      convention: 'gameplay:left=-handAttachX,right=+handAttachX',
    };
    editorLog('[Idle arms] Corrected newly generated editor hand to gameplay side convention.', 'info', lastGenerationCorrection);
    return true;
  }

  function patchHandsRoot(model, root) {
    if (!root || patchedHandRoots.has(root)) return;
    patchedHandRoots.add(root);
    const originalAdd = typeof root.add === 'function' ? root.add : null;
    if (originalAdd) {
      root.add = function hobunjiIdleArmHandRootAdd() {
        const objects = Array.from(arguments);
        const result = originalAdd.apply(this, objects);
        for (const object of objects) {
          if (/_LeftHand$/i.test(String(object?.name || ''))) normalizeGeneratedHandWrapper(model, object, 'left');
          else if (/_RightHand$/i.test(String(object?.name || ''))) normalizeGeneratedHandWrapper(model, object, 'right');
        }
        return result;
      };
      root.add.__hobunjiIdleArmGenerationBridge = true;
    }
    for (const child of root.children || []) {
      if (/_LeftHand$/i.test(String(child?.name || ''))) normalizeGeneratedHandWrapper(model, child, 'left');
      else if (/_RightHand$/i.test(String(child?.name || ''))) normalizeGeneratedHandWrapper(model, child, 'right');
    }
  }

  function installGenerationBridge(model) {
    if (!model || generationBridgeByModel.has(model)) return generationBridgeByModel.get(model) || null;
    const originalAdd = typeof model.add === 'function' ? model.add : null;
    const state = { installed: !!originalAdd, model: model.name || null };
    generationBridgeByModel.set(model, state);
    if (!originalAdd) return state;
    model.add = function hobunjiIdleArmModelAdd() {
      const objects = Array.from(arguments);
      const result = originalAdd.apply(this, objects);
      for (const object of objects) {
        if (/_procedural_hands$/i.test(String(object?.name || ''))) patchHandsRoot(model, object);
      }
      return result;
    };
    model.add.__hobunjiIdleArmGenerationBridge = true;
    for (const child of model.children || []) {
      if (/_procedural_hands$/i.test(String(child?.name || ''))) patchHandsRoot(model, child);
    }
    editorLog('[Idle arms] Generated-hand construction bridge installed; new Left/Right wrappers use gameplay handAttachX sides.', 'info', {
      model: model.name || null,
      convention: 'left=-handAttachX, right=+handAttachX',
    });
    return state;
  }

  function generationBridgeStatus(model) {
    return {
      installed: !!generationBridgeByModel.get(model)?.installed,
      correctedCount: generationCorrectionCount,
      lastCorrection: lastGenerationCorrection,
      gameplayConvention: 'left=-handAttachX,right=+handAttachX',
      legacyCompatibility: 'left=+handAttachX,right=-handAttachX',
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

  function syncSide(model, profile, side, nowMs, forceReacquire) {
    const hand = handFor(model, side);
    if (!hand) return { side, available: false, owns: false, reason: 'hand-not-built-yet' };
    const canonical = canonicalFloorTarget(model, profile, side, nowMs);
    if (!canonical) return { side, available: true, owns: false, reason: 'missing-shoulder' };

    const target = fullScaleFloorToHandParent(model, hand, canonical.floorTarget);
    const shoulder = fullScaleFloorToHandParent(model, hand, canonical.shoulderFloor);
    const gameplayIdleModel = generatedIdleModelLocal(model, side, false);
    const legacyIdleModel = generatedIdleModelLocal(model, side, true);
    const gameplayIdle = gameplayIdleModel ? modelLocalToHandParent(model, hand, gameplayIdleModel) : null;
    const legacyIdle = legacyIdleModel ? modelLocalToHandParent(model, hand, legacyIdleModel) : null;
    if (!target || !shoulder) return { side, available: true, owns: false, reason: 'missing-space-bridge' };

    const dims = dimsFor(model);
    const ownership = ownershipFor(hand);
    const epsilon = Math.max(0.00025, dims.height * OWNERSHIP_EPSILON_FRACTION);
    const defaultEpsilon = Math.max(epsilon, dims.height * DEFAULT_REACQUIRE_FRACTION);
    const stillOurWrite = !!(ownership.lastWritten && positionNear(hand.position, ownership.lastWritten, epsilon));
    const atShoulderDefault = positionNear(hand.position, shoulder, defaultEpsilon);
    const atGameplayIdleDefault = !!(gameplayIdle && positionNear(hand.position, gameplayIdle, defaultEpsilon));
    const atLegacyIdleDefault = !!(legacyIdle && positionNear(hand.position, legacyIdle, defaultEpsilon));

    if (forceReacquire || atShoulderDefault || atGameplayIdleDefault || atLegacyIdleDefault) ownership.owns = true;
    else if (ownership.owns && !stillOurWrite) ownership.owns = false;

    const base = {
      side,
      available: true,
      owns: ownership.owns,
      handName: hand.name || null,
      handParent: hand.parent?.name || hand.parent?.type || null,
      currentHandParentLocal: vectorJson(hand.position),
      currentFullScaleFloorLocal: vectorJson(handFullScaleFloorPosition(hand, model)),
      currentWorld: vectorJson(handWorldPosition(hand, model)),
      shoulderFloorLocal: vectorJson(canonical.shoulderFloor),
      shoulderHandParentLocal: vectorJson(shoulder),
      targetFloorLocal: vectorJson(canonical.floorTarget),
      targetHandParentLocal: vectorJson(target),
      virtualPortraitLiftY: virtualPortraitLiftY(model),
      verticalArmDropFloor: canonical.shoulderFloor.y - canonical.floorTarget.y,
      rawShoulder: vectorJson(canonical.rawShoulder),
      bakedAvatarCoordinateScale: canonical.bakedScale,
      gameplayIdleHandParentLocal: vectorJson(gameplayIdle),
      legacyReversedIdleHandParentLocal: vectorJson(legacyIdle),
      atShoulderDefault,
      atGameplayIdleDefault,
      atLegacyIdleDefault,
      stillOurWrite,
      posteriorY: canonical.posteriorY,
      armLengthPercent: canonical.armLengthPercent,
      armLengthY: canonical.armLengthY,
      idleOffset: { ...canonical.idleOffset },
      coordinateSpace: 'Full Character Scale floor -> virtual lifted portrait -> actual generated-hand parent',
    };

    if (!ownership.owns) return { ...base, reason: 'explicit-animation-owner' };

    hand.position.copy(target);
    hand.updateMatrix?.();
    hand.updateMatrixWorld?.(true);
    ownership.lastWritten = target.clone();
    const reason = atGameplayIdleDefault ? 'claimed-gameplay-idle'
      : atLegacyIdleDefault ? 'claimed-legacy-reversed-idle'
        : atShoulderDefault ? 'claimed-shoulder-default'
          : forceReacquire ? 'reacquired-after-dance'
            : 'canonical-idle';
    return {
      ...base,
      owns: true,
      reason,
      position: vectorJson(target),
      positionWorld: vectorJson(handWorldPosition(hand, model)),
      positionFullScaleFloorLocal: vectorJson(handFullScaleFloorPosition(hand, model)),
    };
  }

  function statusDiagnostic(model, profile, identity, left, right, dance) {
    const dims = dimsFor(model);
    const armLengthPercent = Number(profile?.anatomy?.armLengthHeightPercentOffset) || 0;
    return {
      model: model?.name || null,
      npcId: model?.userData?.npcId || null,
      profile: `${profile.species}::${profile.gender}`,
      identitySource: identity?.source || 'profile',
      identityEvidence: identity?.evidence || null,
      modelHeight: dims.height,
      modelWidth: dims.width,
      modelScale: vectorJson(model?.scale),
      handAttachX: Number(model?.userData?.handAttachX),
      handAttachY: Number(model?.userData?.handAttachY),
      fullScaleSpace: fullScaleSpaceDiagnostic(model),
      posteriorY: posteriorY(profile, dims.height, model?.userData?.handAttachY),
      armLengthHeightPercentOffset: armLengthPercent,
      armLengthWorldY: -dims.height * armLengthPercent / 100,
      npcIdentityLookup: npcLookupStatus(model),
      generationBridge: generationBridgeStatus(model),
      hook: {
        attached: !!(activeScene && activeScene.onBeforeRender === sceneBeforeRenderWrapper),
        attachCount: hookAttachCount,
        scene: activeScene?.name || activeScene?.type || 'scene',
      },
      left,
      right,
      dance: dance ? { enabled: !!dance.enabled, armStyle: dance.armStyle || 'none' } : null,
      rule: 'Full Character Scale portrait lift (modelHeight/2) -> canonical posterior/arm idle target -> convert into procedural editor generated-hand parent',
    };
  }

  function maybeLogStatus(snapshot, force = false) {
    const signature = `${snapshot.model}|${snapshot.profile}|${snapshot.left?.reason}|${snapshot.right?.reason}|${snapshot.generationBridge?.correctedCount}|${snapshot.hook?.attachCount}`;
    if (!force && signature === lastStatusSignature) return;
    lastStatusSignature = signature;
    editorLog('[Idle arms] Idle-arm parity diagnostic', snapshot.active ? 'info' : 'warn', snapshot);
  }

  function applyIdleArmParity(nowMs = performance.now(), forceLog = false) {
    const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    if (!model) {
      debugSnapshot = { installed: true, active: false, reason: 'waiting-for-preview', hookAttachCount };
      return false;
    }

    installGenerationBridge(model);
    if (model !== lastModel) {
      lastModel = model;
      lastProfileSignature = '';
      lastStatusSignature = '';
      lastUnresolvedSignature = '';
      editorLog('[Idle arms] Avatar changed; reproducing Full Character Scale portrait-lift contract inside procedural editor hierarchy.', 'info', fullScaleSpaceDiagnostic(model));
    }

    const dance = global.ProceduralDanceMode?.getDebug?.() || null;
    const explicitDance = !!(dance?.enabled && dance?.armStyle && dance.armStyle !== 'none');
    const forceReacquire = explicitDanceWasActive && !explicitDance;
    explicitDanceWasActive = explicitDance;
    if (explicitDance) {
      debugSnapshot = {
        installed: true,
        active: false,
        reason: `dance:${dance.armStyle}`,
        model: model.name || null,
        dance,
        fullScaleSpace: fullScaleSpaceDiagnostic(model),
        generationBridge: generationBridgeStatus(model),
        hookAttachCount,
      };
      if (forceLog) editorLog('[Idle arms] Explicit Dance arm style owns generated hands.', 'info', debugSnapshot);
      return false;
    }

    const identity = identityForModel(model);
    const profile = profileFor(identity);
    if (!profile) {
      debugSnapshot = {
        installed: true,
        active: false,
        reason: 'attachment-profile-unresolved',
        model: model.name || null,
        npcId: model?.userData?.npcId || null,
        identity,
        modelUserDataKeys: Object.keys(model?.userData || {}).sort(),
        fullScaleSpace: fullScaleSpaceDiagnostic(model),
        npcIdentityLookup: npcLookupStatus(model),
        generationBridge: generationBridgeStatus(model),
        left: { side: 'left', available: !!handFor(model, 'left') },
        right: { side: 'right', available: !!handFor(model, 'right') },
        hint: 'Need species+gender to choose the same attachment profile used by Full Character Scale/gameplay.',
      };
      const signature = `${debugSnapshot.model}|${debugSnapshot.npcIdentityLookup?.state}|${debugSnapshot.left.available}|${debugSnapshot.right.available}`;
      if (forceLog || signature !== lastUnresolvedSignature) {
        lastUnresolvedSignature = signature;
        editorLog('[Idle arms] Could not resolve current avatar attachment profile.', 'warn', debugSnapshot);
      }
      return false;
    }

    const profileSignature = `${profile.species}::${profile.gender}:${identity?.source || 'profile'}`;
    if (profileSignature !== lastProfileSignature) {
      lastProfileSignature = profileSignature;
      editorLog('[Idle arms] Resolved gameplay/Attack Editor profile with Full Character Scale portrait lift.', 'info', {
        model: model.name || null,
        npcId: model?.userData?.npcId || null,
        profile: `${profile.species}::${profile.gender}`,
        identitySource: identity?.source || 'profile',
        identityEvidence: identity?.evidence || null,
        fullScaleSpace: fullScaleSpaceDiagnostic(model),
        armLengthHeightPercentOffset: Number(profile?.anatomy?.armLengthHeightPercentOffset) || 0,
      });
    }

    const left = syncSide(model, profile, 'left', nowMs, forceReacquire);
    const right = syncSide(model, profile, 'right', nowMs, forceReacquire);
    const active = !!(left.owns || right.owns);
    debugSnapshot = {
      installed: true,
      active,
      reason: active ? 'canonical-idle'
        : (left.reason === 'hand-not-built-yet' || right.reason === 'hand-not-built-yet') ? 'waiting-for-hands'
          : 'explicit-animation-owner',
      ...statusDiagnostic(model, profile, identity, left, right, dance),
      latestChange: 'Procedural editor now reproduces Full Character Scale model.position.y=modelHeight/2 virtually. Canonical floor-space hands subtract that lift before entering the editor portrait hierarchy, instead of trusting the editor portrait current Y (usually zero).',
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
    const previous = typeof scene.onBeforeRender === 'function' && !scene.onBeforeRender.__hobunjiProceduralEditorIdleArms
      ? scene.onBeforeRender
      : null;
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
    editorLog(replacingLostHook ? '[Idle arms] Scene pre-render hook was replaced; idle-arm parity reattached.' : '[Idle arms] Final pre-render parity hook attached to procedural editor scene.', replacingLostHook ? 'warn' : 'info', {
      reason,
      hookAttachCount,
      chainedPreviousCallback: !!previous,
    });
    return true;
  }

  function refreshSceneBinding() {
    const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    if (model) installGenerationBridge(model);
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
      const identity = identityForModel(model);
      const profile = profileFor(identity);
      const floor = profile ? canonicalFloorTarget(model, profile, side, nowMs) : null;
      const hand = handFor(model, side);
      if (!floor || !hand) return null;
      return {
        profile: `${profile.species}::${profile.gender}`,
        identitySource: identity?.source || 'profile',
        floorTarget: { ...floor.floorTarget },
        shoulderFloor: { ...floor.shoulderFloor },
        virtualPortraitLiftY: virtualPortraitLiftY(model),
        handParentTarget: vectorJson(fullScaleFloorToHandParent(model, hand, floor.floorTarget)),
      };
    },
  };

  requestAnimationFrame(refreshSceneBinding);
})(window);
