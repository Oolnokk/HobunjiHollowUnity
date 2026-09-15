// Procedural Animation Editor: gameplay/Attack Editor free-hand idle parity.
//
// IMPORTANT COORDINATE CONTRACT
// -----------------------------
// Attachment-rig shoulder/posterior coordinates live in the character's
// floor-relative visual parent, exactly like Animation Author's Full Character
// Scale workspace. The procedural editor's generated hand wrappers, however,
// are descendants of the lifted portrait model. Canonical targets therefore
// MUST be transformed from character-floor-parent space into the hand wrapper's
// actual parent space. Treating floor coordinates as portrait-local adds the
// portrait's +height/2 lift a second time and visually pins hands to shoulders.
(function (global) {
  'use strict';

  if (global.HobunjiProceduralEditorIdleArms?.installed) return;

  const OWNERSHIP_EPSILON_FRACTION = 0.012;
  const DEFAULT_REACQUIRE_FRACTION = 0.04;
  const FALLBACK_IDLE_PHASE_RATE = 0.0017;
  const DEFAULT_RUNTIME_WIDTH = 0.9;
  const NPC_DATABASE_PATH = 'docs/config/npcs/hobunji-starter-npc-database.json';
  const REPOSITORY = 'Oolnokk/HobunjiHollowUnity';

  const handState = new WeakMap();
  const inferredProfileCache = new WeakMap();
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
  let explicitDanceWasActive = false;
  let lastProfileSignature = '';
  let lastStatusSignature = '';
  let lastUnresolvedSignature = '';
  let lastModel = null;
  let debugSnapshot = { installed: true, active: false, reason: 'waiting-for-preview' };

  function editorLog(message, level = 'info', extra = null) {
    const backdropLog = global.HobunjiGameplayBackdrop?.log;
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
      value.source,
      value.source?.appearance,
      value.experimentalFeet,
      value.editorGeneratedFeetDanceBridge,
      value.avatarEditor?.rawExport,
      value.avatarEditor?.rawExport?.appearance,
    ].filter(candidate => candidate && typeof candidate === 'object');
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

  function uniqueCharacterProfiles() {
    return [...new Set(Object.values(global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}).filter(Boolean))];
  }

  function profileForIdentity(identity) {
    if (!identity?.species || !identity?.gender) return null;
    return global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${identity.species}::${identity.gender}`] || null;
  }

  function assetSpeciesCandidates() {
    const out = [];
    const seen = new Set();
    for (const profile of uniqueCharacterProfiles()) {
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
      for (const variant of new Set([candidate.assetSpecies, candidate.assetSpecies.replace(/-/g, '_'), candidate.assetSpecies.replace(/_/g, '-')])) {
        const escaped = escapeRegex(variant);
        const after = raw.match(new RegExp(`${escaped}[_-](female|male|f|m)(?=[._/\\-]|$)`, 'i'));
        const before = raw.match(new RegExp(`(?:^|[._/\\-])(female|male|f|m)[_-]${escaped}(?=[._/\\-]|$)`, 'i'));
        const gender = normalizeGender(after?.[1] || before?.[1]);
        if (gender) return { species: candidate.transformSpecies, gender, source: 'avatar-asset-url', evidence: value };
      }
    }
    return null;
  }

  function stringSourcesForNode(node) {
    const out = [];
    if (node?.name) out.push(String(node.name));
    const data = node?.userData || {};
    for (const key of ['url', 'src', 'sourceUrl', 'assetUrl', 'textureUrl', 'portraitUrl', 'spriteUrl']) {
      if (typeof data[key] === 'string') out.push(data[key]);
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

  function identityFromModelAssets(model) {
    let found = null;
    walkModel(model, node => {
      if (found) return;
      for (const value of stringSourcesForNode(node)) {
        found = identityFromAssetString(value);
        if (found) break;
      }
    });
    return found;
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
    return state ? { revision, state: state.state, url: state.url, count: state.count || 0, error: state.error || null }
      : { revision, state: 'idle', url: npcDatabaseUrl(model), count: 0, error: null };
  }

  function ensureNpcIdentityLookup(model) {
    const npcId = String(model?.userData?.npcId || '').trim();
    if (!npcId || npcIdentityById.has(npcId) || typeof global.fetch !== 'function') return;
    const revision = npcRevision(model);
    const existing = npcLookupByRevision.get(revision);
    if (existing?.state === 'loading' || existing?.state === 'ready') return;
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
        const base = identityFromObject(record, 'npc-database') || identityFromObject(record?.avatarEditor?.rawExport, 'npc-database');
        if (!base) continue;
        npcIdentityById.set(id, { ...base, source: 'npc-database', evidence: `${id}@${revision}` });
        count += 1;
      }
      npcLookupByRevision.set(revision, { state: 'ready', url, count, error: null });
      lastUnresolvedSignature = '';
      const resolved = npcIdentityById.get(npcId) || null;
      editorLog(resolved ? '[Idle arms] NPC database identity resolved.' : '[Idle arms] NPC database loaded, but the current NPC had no usable species/gender.', resolved ? 'info' : 'warn', { npcId, revision, resolved, indexedIdentities: count });
      applyIdleArmParity(performance.now(), true);
    }).catch(error => {
      npcLookupByRevision.set(revision, { state: 'error', url, count: 0, error: String(error?.message || error) });
      lastUnresolvedSignature = '';
      editorLog('[Idle arms] NPC database identity lookup failed.', 'warn', { npcId, revision, url, error: String(error?.message || error) });
    });
  }

  function identityForModel(model) {
    const metadata = identityFromModelMetadata(model);
    if (metadata) return metadata;
    const handRig = model?.userData?.proceduralHandRig;
    if (handRig?.speciesId) {
      const gender = normalizeGender(handRig.gender);
      if (gender) return { species: normalizeSpecies(handRig.speciesId), gender, source: 'procedural-hand-rig' };
    }
    const npcId = String(model?.userData?.npcId || '').trim();
    if (npcId && npcIdentityById.has(npcId)) return npcIdentityById.get(npcId);
    const asset = identityFromModelAssets(model);
    if (asset) return asset;
    ensureNpcIdentityLookup(model);
    return null;
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

  function vectorJson(value) {
    return value ? { x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 } : null;
  }

  function pointCtor(model) {
    return model?.position?.constructor || null;
  }

  // Same parent contract used by Full Character Scale: hands/feet/portrait are
  // interpreted around a floor-relative visual root, then that root may itself
  // receive whole-character X/Y scale. Never rewrite local rig coordinates for
  // the full-character scale; let parent transforms carry them together.
  function floorParentFor(model) {
    const explicit = model?.userData?.proceduralHandParent;
    if (explicit?.isObject3D) return explicit;
    for (let node = model?.parent; node; node = node.parent) {
      const state = node.userData?.hobunjiCharacterRigScaleState;
      if (state?.groundRelative && state?.coordinateSpace === 'character-floor-parent') return node;
      // The procedural editor's portrait is normally a direct child of its
      // locomotion/floor root. Stop there rather than climbing into Scene.
      if (node === model.parent) return node;
    }
    return model?.parent || model || null;
  }

  function transformPoint(source, target, point, model) {
    const Vector3 = pointCtor(model);
    if (!Vector3 || !source || !target) return null;
    const value = new Vector3(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0);
    if (source === target) return value;
    if (!source.localToWorld || !target.worldToLocal) return null;
    source.updateWorldMatrix?.(true, false);
    source.updateMatrixWorld?.(true);
    target.updateWorldMatrix?.(true, false);
    target.updateMatrixWorld?.(true);
    source.localToWorld(value);
    target.worldToLocal(value);
    return value;
  }

  function pointWorld(source, point, model) {
    const Vector3 = pointCtor(model);
    if (!Vector3 || !source?.localToWorld) return null;
    const value = new Vector3(Number(point?.x) || 0, Number(point?.y) || 0, Number(point?.z) || 0);
    source.updateWorldMatrix?.(true, false);
    source.updateMatrixWorld?.(true);
    return source.localToWorld(value);
  }

  function worldPointTo(source, worldPoint, model) {
    const Vector3 = pointCtor(model);
    if (!Vector3 || !source?.worldToLocal || !worldPoint) return null;
    const value = new Vector3(Number(worldPoint.x) || 0, Number(worldPoint.y) || 0, Number(worldPoint.z) || 0);
    source.updateWorldMatrix?.(true, false);
    source.updateMatrixWorld?.(true);
    return source.worldToLocal(value);
  }

  function handPositionInSpace(hand, space, model) {
    const Vector3 = pointCtor(model);
    if (!Vector3 || !hand || !space || !hand.getWorldPosition) return null;
    hand.updateWorldMatrix?.(true, false);
    hand.updateMatrixWorld?.(true);
    const world = hand.getWorldPosition(new Vector3());
    return worldPointTo(space, world, model);
  }

  function positionDistanceSquared(a, b) {
    if (!a || !b) return Infinity;
    const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
    const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
    const dz = (Number(a.z) || 0) - (Number(b.z) || 0);
    return dx * dx + dy * dy + dz * dz;
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
    return Math.max(0.05, planeHeight || DEFAULT_RUNTIME_WIDTH);
  }

  // This is only the baked avatar-size ratio (e.g. a half-sized child portrait),
  // not Full Character Scale. CharacterRigScale lives on the floor parent and is
  // intentionally left to the transform hierarchy, matching that tool's contract.
  function bakedAvatarCoordinateScale(model, profile) {
    const currentWidth = Number(model?.userData?.portraitModelWidth) || Number(model?.userData?.gameWorldModelBaseWidth) || DEFAULT_RUNTIME_WIDTH;
    const authoredWidth = Number(profile?.handShoulderRule?.runtimeBaseWidth) || DEFAULT_RUNTIME_WIDTH;
    return authoredWidth > 0 ? currentWidth / authoredWidth : 1;
  }

  function scaledShoulderFloor(profile, side, bakedScale) {
    const raw = profile?.anchors?.[side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder']?.position;
    if (!raw) return null;
    return {
      x: (Number(raw.x) || 0) * bakedScale,
      y: (Number(raw.y) || 0) * bakedScale,
      z: (Number(raw.z) || 0) * bakedScale,
    };
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
    const phase = nowMs * FALLBACK_IDLE_PHASE_RATE + (side === 'right' ? 0.28 : 0);
    return {
      y: modelHeight * 0.0045 * Math.sin(phase),
      z: modelHeight * 0.003 * Math.cos(phase),
    };
  }

  function canonicalFloorTarget(model, profile, side, modelHeight, nowMs) {
    const bakedScale = bakedAvatarCoordinateScale(model, profile);
    const shoulder = scaledShoulderFloor(profile, side, bakedScale);
    if (!shoulder) return null;
    const armLengthPercent = Number(profile?.anatomy?.armLengthHeightPercentOffset);
    const armLengthY = Number.isFinite(armLengthPercent) ? -modelHeight * armLengthPercent / 100 : 0;
    const fallback = idleFallbackOffset(side, modelHeight, nowMs);
    const posterior = posteriorY(profile, modelHeight, model?.userData?.handAttachY);
    return {
      x: shoulder.x,
      y: posterior + armLengthY + fallback.y,
      z: fallback.z,
      coordinateSpace: 'character-floor-parent',
      shoulder,
      rawShoulder: profile?.anchors?.[side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder']?.position || null,
      bakedAvatarCoordinateScale: bakedScale,
      posteriorY: posterior,
      armLengthPercent: Number.isFinite(armLengthPercent) ? armLengthPercent : 0,
      armLengthY,
      fallback,
    };
  }

  // Generated wrappers are initially authored in PORTRAIT-MODEL local space.
  // This is only an acquisition/default test and must not be mixed with the
  // canonical floor-relative attachment-rig target above.
  function gameplayModelIdleTarget(model, side) {
    const x = Number(model?.userData?.handAttachX);
    const y = Number(model?.userData?.handAttachY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: side === 'left' ? -x : x, y, z: 0 };
  }

  function legacyReversedModelIdleTarget(model, side) {
    const x = Number(model?.userData?.handAttachX);
    const y = Number(model?.userData?.handAttachY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: side === 'left' ? x : -x, y, z: 0 };
  }

  function positionNear(position, target, epsilon) {
    return !!(position && target
      && Math.abs(position.x - target.x) <= epsilon
      && Math.abs(position.y - target.y) <= epsilon
      && Math.abs(position.z - target.z) <= epsilon);
  }

  function normalizeGeneratedHandWrapper(model, hand, side) {
    const gameplayIdle = gameplayModelIdleTarget(model, side);
    const legacyIdle = legacyReversedModelIdleTarget(model, side);
    if (!gameplayIdle || !legacyIdle || !hand?.position) return false;
    const modelHeight = previewModelHeight(model);
    const epsilon = Math.max(0.00025, modelHeight * DEFAULT_REACQUIRE_FRACTION);
    if (!positionNear(hand.position, legacyIdle, epsilon) || positionNear(hand.position, gameplayIdle, epsilon)) return false;
    const before = vectorJson(hand.position);
    hand.position.set?.(gameplayIdle.x, gameplayIdle.y, gameplayIdle.z);
    if (!hand.position.set) {
      hand.position.x = gameplayIdle.x;
      hand.position.y = gameplayIdle.y;
      hand.position.z = gameplayIdle.z;
    }
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

  function patchGeneratedHandsRoot(model, root) {
    if (!root || patchedHandRoots.has(root)) return;
    patchedHandRoots.add(root);
    const originalAdd = typeof root.add === 'function' ? root.add : null;
    if (originalAdd) {
      root.add = function hobunjiGameplaySideHandRootAdd() {
        const objects = Array.from(arguments);
        const result = originalAdd.apply(this, objects);
        for (const object of objects) {
          const name = String(object?.name || '');
          if (/_LeftHand$/i.test(name)) normalizeGeneratedHandWrapper(model, object, 'left');
          else if (/_RightHand$/i.test(name)) normalizeGeneratedHandWrapper(model, object, 'right');
        }
        return result;
      };
      root.add.__hobunjiGameplayHandSideBridge = true;
    }
    for (const child of root.children || []) {
      const name = String(child?.name || '');
      if (/_LeftHand$/i.test(name)) normalizeGeneratedHandWrapper(model, child, 'left');
      else if (/_RightHand$/i.test(name)) normalizeGeneratedHandWrapper(model, child, 'right');
    }
  }

  function installGenerationSideBridge(model) {
    if (!model || generationBridgeByModel.has(model)) return generationBridgeByModel.get(model) || null;
    const originalAdd = typeof model.add === 'function' ? model.add : null;
    const state = { installed: !!originalAdd, model: model.name || null, correctedCountAtInstall: generationCorrectionCount };
    generationBridgeByModel.set(model, state);
    if (!originalAdd) return state;
    model.add = function hobunjiGameplaySideModelAdd() {
      const objects = Array.from(arguments);
      const result = originalAdd.apply(this, objects);
      for (const object of objects) {
        if (/_procedural_hands$/i.test(String(object?.name || ''))) patchGeneratedHandsRoot(model, object);
      }
      return result;
    };
    model.add.__hobunjiGameplayHandSideBridge = true;
    for (const child of model.children || []) {
      if (/_procedural_hands$/i.test(String(child?.name || ''))) patchGeneratedHandsRoot(model, child);
    }
    editorLog('[Idle arms] Generated-hand construction bridge installed; new Left/Right wrappers now use gameplay handAttachX sides.', 'info', {
      model: model.name || null,
      convention: 'left=-handAttachX, right=+handAttachX',
    });
    return state;
  }

  function generationBridgeStatus(model) {
    const state = generationBridgeByModel.get(model) || null;
    return {
      installed: !!state?.installed,
      correctedCount: generationCorrectionCount,
      lastCorrection: lastGenerationCorrection,
      gameplayConvention: 'left=-handAttachX,right=+handAttachX',
      legacyCompatibility: 'left=+handAttachX,right=-handAttachX',
    };
  }

  function modelIdleInHandParent(model, hand, side, legacy = false) {
    const source = legacy ? legacyReversedModelIdleTarget(model, side) : gameplayModelIdleTarget(model, side);
    return source ? transformPoint(model, hand?.parent, source, model) : null;
  }

  function floorTargetInHandParent(model, hand, floorPoint) {
    const floorParent = floorParentFor(model);
    return floorParent ? transformPoint(floorParent, hand?.parent, floorPoint, model) : null;
  }

  function floorSpaceSummary(model) {
    const floorParent = floorParentFor(model);
    const origin = floorParent ? transformPoint(model, floorParent, { x: 0, y: 0, z: 0 }, model) : null;
    const scaleState = floorParent?.userData?.hobunjiCharacterRigScaleState || null;
    return {
      coordinateSpace: 'character-floor-parent',
      floorParent: floorParent?.name || floorParent?.type || null,
      portraitOriginInFloor: vectorJson(origin),
      portraitLiftY: origin ? Number(origin.y) || 0 : Number(model?.position?.y) || 0,
      fullCharacterScaleState: scaleState ? {
        factor: scaleState.factor || null,
        groundRelative: !!scaleState.groundRelative,
        coordinateSpace: scaleState.coordinateSpace || null,
      } : null,
      contract: 'Full Character Scale: local hand/shoulder/posterior coordinates remain floor-relative; parent transform owns whole-character scale.',
    };
  }

  function profileFromBrokenShoulderDefault(model, modelHeight) {
    const floorParent = floorParentFor(model);
    const left = handFor(model, 'left');
    const right = handFor(model, 'right');
    const leftPosition = floorParent ? handPositionInSpace(left, floorParent, model) : null;
    const rightPosition = floorParent ? handPositionInSpace(right, floorParent, model) : null;
    if (!leftPosition || !rightPosition) return null;
    let best = null;
    for (const profile of uniqueCharacterProfiles()) {
      const scale = bakedAvatarCoordinateScale(model, profile);
      const leftShoulder = scaledShoulderFloor(profile, 'left', scale);
      const rightShoulder = scaledShoulderFloor(profile, 'right', scale);
      if (!leftShoulder || !rightShoulder) continue;
      const score = positionDistanceSquared(leftPosition, leftShoulder) + positionDistanceSquared(rightPosition, rightShoulder);
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

  function metadataSummary(value) {
    if (value == null) return null;
    if (typeof value !== 'object') return { type: typeof value, value: String(value).slice(0, 160) };
    const identity = identityFromObject(value, 'diagnostic');
    return { type: Array.isArray(value) ? 'array' : 'object', keys: Object.keys(value).slice(0, 24), identity: identity ? { species: identity.species, gender: identity.gender } : null };
  }

  function handSummary(model, side) {
    const hand = handFor(model, side);
    if (!hand) return { side, available: false };
    const floorParent = floorParentFor(model);
    const Vector3 = pointCtor(model);
    const world = Vector3 && hand.getWorldPosition ? hand.getWorldPosition(new Vector3()) : null;
    return {
      side,
      available: true,
      name: hand.name || null,
      parent: hand.parent?.name || hand.parent?.type || null,
      handParentLocal: vectorJson(hand.position),
      floorLocal: floorParent ? vectorJson(handPositionInSpace(hand, floorParent, model)) : null,
      world: vectorJson(world),
    };
  }

  function ownershipFor(hand) {
    let state = handState.get(hand);
    if (!state) { state = { owns: false, lastWritten: null }; handState.set(hand, state); }
    return state;
  }

  function syncSide(model, profile, side, modelHeight, nowMs, forceReacquire) {
    const hand = handFor(model, side);
    if (!hand) return { side, available: false, owns: false, reason: 'hand-not-built-yet' };
    const floorParent = floorParentFor(model);
    if (!floorParent) return { side, available: true, owns: false, reason: 'floor-parent-missing' };

    const targetFloor = canonicalFloorTarget(model, profile, side, modelHeight, nowMs);
    if (!targetFloor) return { side, available: true, owns: false, reason: 'missing-shoulder' };
    const target = floorTargetInHandParent(model, hand, targetFloor);
    const shoulder = floorTargetInHandParent(model, hand, targetFloor.shoulder);
    const gameplayIdle = modelIdleInHandParent(model, hand, side, false);
    const legacyIdle = modelIdleInHandParent(model, hand, side, true);
    if (!target || !shoulder) return { side, available: true, owns: false, reason: 'missing-three-bridge' };

    const ownership = ownershipFor(hand);
    const epsilon = Math.max(0.00025, modelHeight * OWNERSHIP_EPSILON_FRACTION);
    const defaultEpsilon = Math.max(epsilon, modelHeight * DEFAULT_REACQUIRE_FRACTION);
    const stillOurWrite = !!(ownership.lastWritten && positionNear(hand.position, ownership.lastWritten, epsilon));
    const atShoulderDefault = positionNear(hand.position, shoulder, defaultEpsilon);
    const atGameplayIdleDefault = !!(gameplayIdle && positionNear(hand.position, gameplayIdle, defaultEpsilon));
    const atLegacyIdleDefault = !!(legacyIdle && positionNear(hand.position, legacyIdle, defaultEpsilon));
    if (forceReacquire || atShoulderDefault || atGameplayIdleDefault || atLegacyIdleDefault) ownership.owns = true;
    else if (ownership.owns && !stillOurWrite) ownership.owns = false;

    const Vector3 = pointCtor(model);
    const currentWorld = Vector3 && hand.getWorldPosition ? hand.getWorldPosition(new Vector3()) : null;
    const currentFloor = currentWorld ? worldPointTo(floorParent, currentWorld, model) : null;
    const targetWorld = pointWorld(floorParent, targetFloor, model);
    const shoulderWorld = pointWorld(floorParent, targetFloor.shoulder, model);
    const base = {
      side,
      available: true,
      owns: ownership.owns,
      handName: hand.name || null,
      handParent: hand.parent?.name || hand.parent?.type || null,
      currentHandParentLocal: vectorJson(hand.position),
      currentFloorLocal: vectorJson(currentFloor),
      currentWorld: vectorJson(currentWorld),
      shoulderFloorLocal: vectorJson(targetFloor.shoulder),
      shoulderHandParentLocal: vectorJson(shoulder),
      shoulderWorld: vectorJson(shoulderWorld),
      rawShoulder: vectorJson(targetFloor.rawShoulder),
      targetFloorLocal: vectorJson(targetFloor),
      targetHandParentLocal: vectorJson(target),
      targetWorld: vectorJson(targetWorld),
      verticalArmDropFloor: Number(targetFloor.shoulder.y) - Number(targetFloor.y),
      bakedAvatarCoordinateScale: targetFloor.bakedAvatarCoordinateScale,
      gameplayIdleHandParentLocal: vectorJson(gameplayIdle),
      legacyReversedIdleHandParentLocal: vectorJson(legacyIdle),
      atShoulderDefault,
      atGameplayIdleDefault,
      atLegacyIdleDefault,
      stillOurWrite,
      posteriorY: targetFloor.posteriorY,
      armLengthPercent: targetFloor.armLengthPercent,
      armLengthY: targetFloor.armLengthY,
      idleOffset: { ...targetFloor.fallback },
      coordinateSpace: 'character-floor-parent -> actual-hand-parent',
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
    return { ...base, owns: true, reason, position: vectorJson(target) };
  }

  function unresolvedDiagnostic(model, modelHeight, resolved) {
    return {
      model: model?.name || null,
      npcId: model?.userData?.npcId || null,
      repositoryCommit: model?.userData?.repositoryCommit || null,
      npcIdentityLookup: npcLookupStatus(model),
      generationBridge: generationBridgeStatus(model),
      floorSpace: floorSpaceSummary(model),
      modelHeight,
      modelWidth: Number(model?.userData?.portraitModelWidth) || null,
      modelScale: vectorJson(model?.scale),
      identity: resolved?.identity || null,
      modelUserDataKeys: Object.keys(model?.userData || {}).sort(),
      sourceMetadata: metadataSummary(model?.userData?.source),
      experimentalFeetMetadata: metadataSummary(model?.userData?.experimentalFeet),
      handAttachX: Number(model?.userData?.handAttachX),
      handAttachY: Number(model?.userData?.handAttachY),
      left: handSummary(model, 'left'),
      right: handSummary(model, 'right'),
      profileCount: uniqueCharacterProfiles().length,
      hint: 'Canonical shoulder/posterior coordinates are character-floor-parent local, matching Full Character Scale; generated wrappers are portrait descendants and require an explicit space conversion.',
    };
  }

  function statusDiagnostic(model, profile, resolved, modelHeight, left, right, dance) {
    const armLengthPercent = Number(profile.anatomy?.armLengthHeightPercentOffset) || 0;
    return {
      model: model.name || null,
      npcId: model?.userData?.npcId || null,
      profile: `${profile.species}::${profile.gender}`,
      identitySource: resolved.identity?.source || 'profile',
      identityEvidence: resolved.identity?.evidence || null,
      floorSpace: floorSpaceSummary(model),
      modelHeight,
      modelWidth: Number(model?.userData?.portraitModelWidth) || null,
      modelScale: vectorJson(model.scale),
      handAttachX: Number(model.userData?.handAttachX),
      handAttachY: Number(model.userData?.handAttachY),
      posteriorY: posteriorY(profile, modelHeight, model.userData?.handAttachY),
      bakedAvatarCoordinateScale: bakedAvatarCoordinateScale(model, profile),
      fullCharacterScaleAppliedByParent: !!floorParentFor(model)?.userData?.hobunjiCharacterRigScaleState,
      armLengthHeightPercentOffset: armLengthPercent,
      armLengthWorldY: -modelHeight * armLengthPercent / 100,
      npcIdentityLookup: npcLookupStatus(model),
      generationBridge: generationBridgeStatus(model),
      hook: { attached: !!(activeScene && activeScene.onBeforeRender === sceneBeforeRenderWrapper), attachCount: hookAttachCount, scene: activeScene?.name || activeScene?.type || 'scene' },
      left,
      right,
      dance: dance ? { enabled: !!dance.enabled, armStyle: dance.armStyle || 'none' } : null,
      rule: 'Full Character Scale floor-parent contract -> baked avatar-size coordinates -> posterior/arm idle target -> convert into generated hand parent',
    };
  }

  function maybeLogStatus(snapshot, force = false) {
    const l = `${snapshot.left?.available ? 1 : 0}:${snapshot.left?.owns ? 1 : 0}:${snapshot.left?.reason || ''}`;
    const r = `${snapshot.right?.available ? 1 : 0}:${snapshot.right?.owns ? 1 : 0}:${snapshot.right?.reason || ''}`;
    const signature = `${snapshot.model}|${snapshot.profile}|${snapshot.identitySource}|${l}|${r}|generation:${snapshot.generationBridge?.correctedCount || 0}|hook:${snapshot.hook?.attachCount || 0}`;
    if (!force && signature === lastStatusSignature) return;
    lastStatusSignature = signature;
    editorLog('[Idle arms] Idle-arm parity diagnostic', snapshot.active ? 'info' : 'warn', snapshot);
  }

  function applyIdleArmParity(nowMs = performance.now(), forceLog = false) {
    const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    if (!model) {
      debugSnapshot = { ...debugSnapshot, active: false, reason: 'waiting-for-preview', hookAttachCount };
      return false;
    }

    installGenerationSideBridge(model);
    if (model !== lastModel) {
      lastModel = model;
      lastProfileSignature = '';
      lastStatusSignature = '';
      lastUnresolvedSignature = '';
      editorLog('[Idle arms] Avatar changed; using Full Character Scale floor-parent coordinate contract.', 'info', floorSpaceSummary(model));
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
        floorSpace: floorSpaceSummary(model),
        generationBridge: generationBridgeStatus(model),
        hookAttachCount,
      };
      if (forceLog) editorLog('[Idle arms] Explicit Dance arm style owns the hands.', 'info', debugSnapshot);
      return false;
    }

    const modelHeight = previewModelHeight(model);
    const resolved = resolveProfile(model, modelHeight);
    const profile = resolved.profile;
    if (!profile) {
      const detail = unresolvedDiagnostic(model, modelHeight, resolved);
      debugSnapshot = { installed: true, active: false, reason: 'attachment-profile-unresolved', hookAttachCount, ...detail };
      const signature = JSON.stringify({ model: detail.model, npcId: detail.npcId, lookup: detail.npcIdentityLookup?.state, identity: detail.identity, left: detail.left?.available, right: detail.right?.available, corrected: detail.generationBridge?.correctedCount });
      if (forceLog || signature !== lastUnresolvedSignature) {
        lastUnresolvedSignature = signature;
        editorLog('[Idle arms] Could not resolve the current avatar attachment profile.', 'warn', debugSnapshot);
      }
      return false;
    }

    const profileSignature = `${profile.species || resolved.identity?.species || '?'}::${profile.gender || resolved.identity?.gender || '?'}:${resolved.identity?.source || 'profile'}`;
    if (profileSignature !== lastProfileSignature) {
      lastProfileSignature = profileSignature;
      editorLog('[Idle arms] Resolved gameplay/Attack Editor free-hand profile in Full Character Scale coordinate space.', 'info', {
        model: model.name || null,
        npcId: model?.userData?.npcId || null,
        profile: `${profile.species}::${profile.gender}`,
        identitySource: resolved.identity?.source || 'profile',
        identityEvidence: resolved.identity?.evidence || null,
        modelHeight,
        modelWidth: Number(model?.userData?.portraitModelWidth) || null,
        floorSpace: floorSpaceSummary(model),
        bakedAvatarCoordinateScale: bakedAvatarCoordinateScale(model, profile),
        handAttachX: Number(model.userData?.handAttachX),
        handAttachY: Number(model.userData?.handAttachY),
        posteriorY: posteriorY(profile, modelHeight, model.userData?.handAttachY),
        armLengthHeightPercentOffset: Number(profile.anatomy?.armLengthHeightPercentOffset) || 0,
        generationBridge: generationBridgeStatus(model),
      });
    }

    const left = syncSide(model, profile, 'left', modelHeight, nowMs, forceReacquire);
    const right = syncSide(model, profile, 'right', modelHeight, nowMs, forceReacquire);
    const active = !!(left.owns || right.owns);
    const diagnostic = statusDiagnostic(model, profile, resolved, modelHeight, left, right, dance);
    debugSnapshot = {
      installed: true,
      active,
      reason: active ? 'canonical-idle'
        : (left.reason === 'hand-not-built-yet' || right.reason === 'hand-not-built-yet') ? 'waiting-for-hands'
        : 'explicit-animation-owner',
      ...diagnostic,
      latestChange: 'Idle targets now use the same floor-relative parent contract as Animation Author Full Character Scale. The portrait +height/2 lift is removed during floor->hand-parent conversion instead of being added onto the hand a second time.',
    };
    maybeLogStatus(debugSnapshot, forceLog);
    return active;
  }

  function attachToScene(scene, reason = 'scene-ready') {
    if (!scene) return false;
    if (scene === activeScene && scene.onBeforeRender === sceneBeforeRenderWrapper) return true;
    if (activeScene && activeScene !== scene && activeScene.onBeforeRender === sceneBeforeRenderWrapper) activeScene.onBeforeRender = previousSceneBeforeRender;

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
    editorLog(
      replacingLostHook ? '[Idle arms] Scene pre-render hook was replaced; idle-arm parity reattached.' : '[Idle arms] Final pre-render parity hook attached to procedural editor scene.',
      replacingLostHook ? 'warn' : 'info',
      { reason, hookAttachCount, chainedPreviousCallback: !!previous },
    );
    return true;
  }

  function refreshSceneBinding() {
    const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    if (model) installGenerationSideBridge(model);
    const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null;
    if (scene && (scene !== activeScene || scene.onBeforeRender !== sceneBeforeRenderWrapper)) {
      attachToScene(scene, scene === activeScene ? 'hook-replaced' : 'scene-changed');
    }
    requestAnimationFrame(refreshSceneBinding);
  }

  global.HobunjiProceduralEditorIdleArms = {
    installed: true,
    syncNow: () => applyIdleArmParity(performance.now()),
    logNow: () => { applyIdleArmParity(performance.now(), true); return { ...debugSnapshot }; },
    getDebug: () => ({ ...debugSnapshot }),
    getCanonicalTarget(side, nowMs = performance.now()) {
      const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
      if (!model) return null;
      const modelHeight = previewModelHeight(model);
      const resolved = resolveProfile(model, modelHeight);
      const floorTarget = resolved.profile ? canonicalFloorTarget(model, resolved.profile, side, modelHeight, nowMs) : null;
      const hand = handFor(model, side);
      return floorTarget ? {
        ...floorTarget,
        floorTarget: vectorJson(floorTarget),
        handParentTarget: hand ? vectorJson(floorTargetInHandParent(model, hand, floorTarget)) : null,
        floorSpace: floorSpaceSummary(model),
        profile: `${resolved.profile.species}::${resolved.profile.gender}`,
        identitySource: resolved.identity?.source || 'profile',
      } : null;
    },
  };

  requestAnimationFrame(refreshSceneBinding);
})(window);
