// Shared species/gender joint-anchor parity for gameplay + Procedural Animation Editor.
//
// Source-of-truth rules:
//   * every movement hip uses the CURRENT species+gender posterior Y;
//   * gameplay dance shoulder orientation is owned by procedural-hand-forearm-alignment-runtime.js;
//   * procedural-editor Dance uses the authored hand-shoulder anchor instead of its legacy heuristic;
//   * shoulder-pet perch is diagnostic/reference only, never substituted for a hand shoulder.
(function (global) {
  'use strict';

  if (global.HobunjiCharacterJointMotionParity?.installed) return;

  const SELF_SRC = document.currentScript?.src || ''; // Keeps the editor's late profile layer on the same commit as this adapter.
  const DEFAULT_MODEL_SIZE = 0.9; // Attachment-rig character coordinates are authored in the 0.9-wide runtime basis.
  const PREVIEW_PATH_RE = /\/tools\/procedural-animation-editor\/(?:index\.html)?$/;
  const LEG_EPSILON = 1e-7;
  const legHandles = new Set();

  let latestProfileLoadState = 'idle';
  let latestProfileLoadError = null;
  let latestProfileReadyAt = 0;
  let liveHipCorrections = 0;
  let previewHipCorrections = 0;
  let previewShoulderCorrections = 0;
  let lastHipDiagnostic = null;
  let lastShoulderDiagnostic = null;
  let lastPreviewShoulderSignature = '';
  let previewScene = null;
  let previewSceneWrapper = null;

  function log(message, level = 'info', extra = null) {
    const editorLog = global.HobunjiGameplayBackdrop?.log;
    if (editorLog) { editorLog(message, level, extra); return; }
    const farmLog = global.__farmLog;
    if (typeof farmLog === 'function') { farmLog(`[Joint anchors] ${message}`, level); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(`[Joint anchors] ${message}`, extra ?? '');
  }

  function normalizeSpecies(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (typeof global.hobunjiTransformSpeciesId === 'function') return global.hobunjiTransformSpeciesId(raw);
    if (raw === 'rakakoan') return 'kenkari';
    if (raw === 'ghoul') return 'mao-ao';
    return raw;
  }

  function normalizeGender(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'female' || raw === 'f') return 'female';
    if (raw === 'male' || raw === 'm') return 'male';
    return null;
  }

  function identityFromObject(value) {
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
      const speciesId = normalizeSpecies(candidate.speciesId || candidate.species || candidate.kind);
      const gender = normalizeGender(candidate.gender || candidate.sex);
      if (speciesId && gender) return { speciesId, gender };
    }
    return null;
  }

  function identityForAvatar(avatarRoot, fallback = {}) {
    const fromFallback = identityFromObject(fallback);
    if (fromFallback) return fromFallback;
    for (let node = avatarRoot; node; node = node.parent) {
      const scaleState = node.userData?.hobunjiCharacterRigScaleState;
      if (scaleState?.species && normalizeGender(scaleState.gender)) {
        return { speciesId: normalizeSpecies(scaleState.species), gender: normalizeGender(scaleState.gender) };
      }
      const direct = identityFromObject(node.userData);
      if (direct) return direct;
    }
    const idleDebug = global.HobunjiProceduralEditorIdleArms?.getDebug?.();
    const profileKey = String(idleDebug?.profile || '');
    const split = profileKey.split('::');
    if (split.length === 2 && normalizeSpecies(split[0]) && normalizeGender(split[1])) {
      return { speciesId: normalizeSpecies(split[0]), gender: normalizeGender(split[1]) };
    }
    return null;
  }

  function profileFor(speciesId, gender) {
    const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const species = normalizeSpecies(speciesId);
    const sex = normalizeGender(gender) || 'male';
    return characters[`${species}::${sex}`] || null;
  }

  function avatarDimensions(avatarRoot, profile = null) {
    const anatomy = profile?.anatomy || {};
    const userData = avatarRoot?.userData || {};
    const width = Number(userData.portraitModelWidth) || DEFAULT_MODEL_SIZE * (Number(anatomy.portraitScale) || 1);
    const height = Number(userData.portraitModelHeight) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function posteriorY(speciesId, gender, modelHeight, handAttachY = null) {
    const profile = profileFor(speciesId, gender);
    const height = Math.max(0.01, Number(modelHeight) || DEFAULT_MODEL_SIZE);

    // The shared resolver is authoritative. It already prefers the floor-percent
    // posterior and becomes portrait-binding-aware when the hand coordinate bridge
    // is installed. A transient resolvedPosteriorPosition is only a fallback.
    const shared = Number(global.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(
      profile?.posteriorRule,
      height,
      Number(handAttachY),
    ));
    if (Number.isFinite(shared)) return shared;

    const live = Number(profile?.resolvedPosteriorPosition?.y);
    if (Number.isFinite(live)) return live;
    const floorPercent = Number(profile?.posteriorRule?.heightPercentFromFloor);
    if (Number.isFinite(floorPercent)) return height * floorPercent / 100;
    const legacyOffset = Number(profile?.posteriorRule?.heightPercentOffset);
    const base = Number.isFinite(Number(handAttachY)) ? Number(handAttachY) : height / 2;
    return base + height * (Number.isFinite(legacyOffset) ? legacyOffset : -18) / 100;
  }

  function resolveAnchorForAvatar(avatarRoot, speciesId, gender, anchorName) {
    const profile = profileFor(speciesId, gender);
    const raw = profile?.anchors?.[anchorName]?.position;
    if (!profile || !raw) return null;

    // Gameplay/Attack Editor: use the same portrait binding that normal hand
    // shoulder aim already consumes. This handles child/full-character scale and
    // portrait vertical placement without inventing a Dance-specific coordinate system.
    const portraitSpace = global.HobunjiCharacterPortraitAnchorSpace;
    if (avatarRoot && portraitSpace?.metricsForAvatarRoot && portraitSpace?.resolveAnchor) {
      const metrics = portraitSpace.metricsForAvatarRoot(avatarRoot, profile);
      const position = portraitSpace.resolveAnchor(profile, anchorName, metrics);
      if (position) return { position, profile, source: 'portrait-anchor-space', metrics };
    }

    // Procedural Animation Editor fallback. Its generated portrait model has the
    // already-sized runtime dimensions but does not load the complete gameplay hand
    // bridge. Character rig coordinates use a fixed 0.9 runtime basis, matching the
    // existing idle-arm parity adapter rather than portraitScale itself.
    const dims = avatarDimensions(avatarRoot, profile);
    const referenceWidth = Number(profile?.handShoulderRule?.runtimeBaseWidth) || DEFAULT_MODEL_SIZE;
    const referenceHeight = Number(profile?.anchors?.[anchorName]?.portraitBinding?.referenceModelHeight) || DEFAULT_MODEL_SIZE;
    const xScale = referenceWidth > 0 ? dims.width / referenceWidth : 1;
    const yScale = referenceHeight > 0 ? dims.height / referenceHeight : 1;
    return {
      position: {
        x: (Number(raw.x) || 0) * xScale,
        y: (Number(raw.y) || 0) * yScale,
        z: (Number(raw.z) || 0) * xScale,
      },
      profile,
      source: 'authored-runtime-basis-fallback',
      metrics: { ...dims, referenceWidth, referenceHeight },
    };
  }

  function resolveShoulderForAvatar(avatarRoot, side, fallback = {}) {
    const identity = identityForAvatar(avatarRoot, fallback);
    if (!identity) return null;
    const anchorName = side === 'right' ? 'rightHandShoulder' : 'leftHandShoulder';
    const resolved = resolveAnchorForAvatar(avatarRoot, identity.speciesId, identity.gender, anchorName);
    return resolved ? { ...resolved, ...identity, side, anchorName } : null;
  }

  function maoAoShoulderSanity(gender = 'male', avatarRoot = null) {
    const sex = normalizeGender(gender) || 'male';
    const profile = profileFor('mao-ao', sex);
    if (!profile) return null;
    const resolve = name => avatarRoot
      ? resolveAnchorForAvatar(avatarRoot, 'mao-ao', sex, name)?.position
      : profile.anchors?.[name]?.position;
    const perch = resolve('shoulderPerch');
    const left = resolve('leftHandShoulder');
    const right = resolve('rightHandShoulder');
    if (!perch || !left || !right) return null;
    const leftDelta = Number(left.y) - Number(perch.y);
    const rightDelta = Number(right.y) - Number(perch.y);
    return {
      species: 'mao-ao', gender: sex,
      coordinateSpace: avatarRoot ? 'current-portrait-space' : 'authored-character-space',
      shoulderPerchY: Number(perch.y),
      leftHandShoulderY: Number(left.y),
      rightHandShoulderY: Number(right.y),
      leftDeltaFromPerch: leftDelta,
      rightDeltaFromPerch: rightDelta,
      likelyAuthoringError: Math.abs(leftDelta) > 0.08 && Math.abs(rightDelta) > 0.08,
    };
  }

  function chainGlobal(name, install) {
    const existing = global[name];
    if (existing) install(existing);
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && !descriptor.configurable) return;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : existing;
    const oldGet = descriptor?.get;
    const oldSet = descriptor?.set;
    Object.defineProperty(global, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return oldGet ? oldGet.call(global) : stored; },
      set(value) {
        if (oldSet) oldSet.call(global, value); else stored = value;
        const resolved = oldGet ? oldGet.call(global) : stored;
        if (resolved) install(resolved);
      },
    });
  }

  function installLivePosteriorOnHandle(handle, options = {}) {
    if (!handle?.group || handle.__hobunjiLivePosteriorHip) return handle;
    const identity = identityForAvatar(options.avatarRoot, options)
      || { speciesId: normalizeSpecies(options.speciesId), gender: normalizeGender(options.gender) || 'male' };
    const leftHip = handle.group.getObjectByName?.('left_hip') || null;
    const rightHip = handle.group.getObjectByName?.('right_hip') || null;
    let lastY = null;

    const currentHeight = () => Math.max(0.01,
      Number(options.avatarRoot?.userData?.portraitModelHeight)
      || Number(options.modelHeight)
      || DEFAULT_MODEL_SIZE);
    const currentHandAttachY = () => Number.isFinite(Number(options.avatarRoot?.userData?.handAttachY))
      ? Number(options.avatarRoot.userData.handAttachY)
      : Number(options.handAttachY);

    const syncPosterior = () => {
      const modelHeight = currentHeight();
      const nextY = posteriorY(identity.speciesId, identity.gender, modelHeight, currentHandAttachY());
      if (!Number.isFinite(nextY)) return null;
      if (leftHip?.position) leftHip.position.y = nextY;
      if (rightHip?.position) rightHip.position.y = nextY;
      if (lastY == null || Math.abs(nextY - lastY) > LEG_EPSILON) {
        liveHipCorrections += 1;
        lastHipDiagnostic = {
          target: 'gameplay-procedural-leg-hips',
          speciesId: identity.speciesId,
          gender: identity.gender,
          posteriorY: nextY,
          previousPosteriorY: lastY,
          modelHeight,
          profilePercentFromFloor: Number(profileFor(identity.speciesId, identity.gender)?.posteriorRule?.heightPercentFromFloor),
          handle: handle.group?.name || null,
        };
        lastY = nextY;
      }
      return nextY;
    };

    const originalUpdate = handle.update?.bind(handle);
    if (originalUpdate) {
      handle.update = function posteriorLiveLegUpdate() {
        syncPosterior(); // The two-bone solver must read the current posterior before every movement solve.
        const result = originalUpdate.apply(this, arguments);
        syncPosterior(); // Keep exposed hip nodes authoritative if an older updater touched them.
        return result;
      };
    }
    const originalDispose = handle.dispose?.bind(handle);
    if (originalDispose) {
      handle.dispose = function posteriorLiveLegDispose() {
        legHandles.delete(handle);
        return originalDispose.apply(this, arguments);
      };
    }
    const originalDebug = handle.getStandingPoseDebug?.bind(handle);
    if (originalDebug) {
      handle.getStandingPoseDebug = function posteriorLiveStandingDebug() {
        const live = syncPosterior();
        return { ...(originalDebug() || {}), posteriorY: live, livePosteriorY: live, posteriorSource: 'species+gender-current-profile' };
      };
    }
    try {
      Object.defineProperty(handle, 'standingPosteriorY', {
        configurable: true,
        enumerable: true,
        get: () => syncPosterior(),
      });
    } catch (_) {}
    Object.defineProperty(handle, '__hobunjiLivePosteriorHip', { value: true, configurable: true });
    handle.syncPosteriorHip = syncPosterior;
    legHandles.add(handle);
    syncPosterior();
    return handle;
  }

  function patchLegApi(api) {
    if (!api?.attach || api.attach.__hobunjiJointPosteriorWrapped) return;
    const original = api.attach.bind(api);
    api.attach = function jointPosteriorAttach(THREE, parent, options = {}) {
      return installLivePosteriorOnHandle(original(THREE, parent, options), options);
    };
    api.attach.__hobunjiJointPosteriorWrapped = true;
  }

  function profileScriptUrl(filename) {
    if (SELF_SRC) return new URL(filename, SELF_SRC).href;
    return new URL(`../../js/${filename}`, location.href).href;
  }

  function appendScript(src, id) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing?.dataset.loaded === 'true') return resolve();
      const script = existing || document.createElement('script');
      script.id = id;
      script.async = false;
      script.src = src;
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      if (!existing) document.head.appendChild(script);
    });
  }

  function loadLatestProfilesForProceduralEditor() {
    if (!PREVIEW_PATH_RE.test(location.pathname) || latestProfileLoadState !== 'idle') return;
    if (!global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters) {
      global.requestAnimationFrame?.(loadLatestProfilesForProceduralEditor);
      return;
    }
    latestProfileLoadState = 'loading';
    appendScript(profileScriptUrl('attachment-rig-latest-authored-snapshot-core.js?v=20260904joint2'), 'proceduralEditorLatestRigSnapshot')
      .then(() => appendScript(profileScriptUrl('character-rig-maoao-authored-20260905.js?v=20260905joint2'), 'proceduralEditorLatestMaoShoulders'))
      .then(() => {
        latestProfileLoadState = 'ready';
        latestProfileReadyAt = performance.now();
        const male = profileFor('mao-ao', 'male');
        const sanity = maoAoShoulderSanity('male');
        log('Procedural editor now uses the latest authored rig profile layer.', 'info', {
          maoAoMalePosteriorPercentFromFloor: Number(male?.posteriorRule?.heightPercentFromFloor),
          maoAoMaleShoulderSanity: sanity,
          profileStatus: global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS || null,
        });
        global.HobunjiProceduralEditorIdleArms?.syncNow?.();
        global.dispatchEvent?.(new CustomEvent('hobunji-character-joint-profile-ready', { detail: { sanity } }));
      })
      .catch(error => {
        latestProfileLoadState = 'error';
        latestProfileLoadError = String(error?.message || error);
        log('Latest authored procedural-editor rig profile failed to load.', 'error', { error: latestProfileLoadError });
      });
  }

  function previewIdentity(model) {
    return identityForAvatar(model) || identityFromObject(model?.userData?.experimentalFeet) || null;
  }

  function patchPreviewHipLines() {
    if (!PREVIEW_PATH_RE.test(location.pathname)) return;
    const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null;
    const identity = previewIdentity(model);
    const root = scene?.getObjectByName?.('LegBonesDebug') || null;
    if (model && root && identity) {
      const height = avatarDimensions(model, profileFor(identity.speciesId, identity.gender)).height;
      const desired = posteriorY(identity.speciesId, identity.gender, height, model.userData?.handAttachY);
      const lines = root.children?.filter?.(node => node?.isLine) || [];
      for (const line of lines.slice(0, 2)) {
        const attr = line.geometry?.attributes?.position;
        if (!attr || attr.count < 3 || !Number.isFinite(desired)) continue;
        const old = attr.getY(0);
        const delta = desired - old;
        if (Math.abs(delta) <= LEG_EPSILON) continue;
        attr.setY(0, desired);
        attr.setY(1, attr.getY(1) + delta * 0.5);
        attr.needsUpdate = true;
        line.geometry.computeBoundingSphere?.();
        previewHipCorrections += 1;
        lastHipDiagnostic = {
          target: 'procedural-editor-LegBonesDebug', speciesId: identity.speciesId, gender: identity.gender,
          oldHipY: old, posteriorY: desired, modelHeight: height,
          profilePercentFromFloor: Number(profileFor(identity.speciesId, identity.gender)?.posteriorRule?.heightPercentFromFloor),
        };
      }
      const shim = model.getObjectByName?.(`${model.name || 'Avatar'}_procedural_feet`) || null;
      for (const side of ['left', 'right']) {
        const hip = shim?.getObjectByName?.(`${side}_hip`);
        if (hip?.position && Number.isFinite(desired)) hip.position.y = desired;
      }
    }
    global.requestAnimationFrame?.(patchPreviewHipLines);
  }

  function previewShoulderModelLocal(model, side) {
    const resolved = resolveShoulderForAvatar(model, side);
    if (!resolved?.position) return null;
    const lift = avatarDimensions(model, resolved.profile).height / 2; // Editor portrait stays centered while the runtime floor parent lifts it by half-height.
    return {
      position: {
        x: Number(resolved.position.x) || 0,
        y: (Number(resolved.position.y) || 0) - lift,
        z: Number(resolved.position.z) || 0,
      },
      floorPosition: resolved.position,
      source: resolved.source,
      identity: { speciesId: resolved.speciesId, gender: resolved.gender },
      lift,
    };
  }

  function correctPreviewDanceShoulders() {
    const model = global.HobunjiGameplayBackdrop?.getAvatarModel?.() || null;
    const identity = previewIdentity(model);
    const dance = global.ProceduralDanceMode?.getDebug?.() || null;
    if (!model || !identity || !dance?.enabled || !dance.armStyle || dance.armStyle === 'none') return;
    const armRoot = model.getObjectByName?.(`${model.name || 'Avatar'}_procedural_arms`) || null;
    if (!armRoot) return;
    const corrected = {};
    for (const side of ['left', 'right']) {
      const line = armRoot.getObjectByName?.(`${side}ArmDebugLine`) || null;
      const attr = line?.geometry?.attributes?.position;
      const desired = previewShoulderModelLocal(model, side);
      if (!attr || attr.count < 3 || !desired?.position) continue;
      const old = { x: attr.getX(0), y: attr.getY(0), z: attr.getZ(0) };
      const delta = {
        x: desired.position.x - old.x,
        y: desired.position.y - old.y,
        z: desired.position.z - old.z,
      };
      if (Math.abs(delta.x) + Math.abs(delta.y) + Math.abs(delta.z) <= LEG_EPSILON) continue;
      for (let i = 0; i < 3; i += 1) {
        attr.setXYZ(i, attr.getX(i) + delta.x, attr.getY(i) + delta.y, attr.getZ(i) + delta.z);
      }
      attr.needsUpdate = true;
      line.geometry.computeBoundingSphere?.();
      const handName = `${model.name || 'Avatar'}_${side === 'left' ? 'Left' : 'Right'}Hand`;
      const hand = model.getObjectByName?.(handName) || null;
      if (hand?.position) {
        hand.position.x += delta.x;
        hand.position.y += delta.y;
        hand.position.z += delta.z;
        hand.updateMatrixWorld?.(true);
      }
      corrected[side] = {
        oldShoulderLocal: old,
        authoredShoulderLocal: desired.position,
        authoredShoulderFloor: desired.floorPosition,
        delta,
        source: desired.source,
      };
    }
    if (corrected.left || corrected.right) {
      previewShoulderCorrections += 1;
      const signature = `${model.name}|${identity.speciesId}|${identity.gender}|${dance.armStyle}`;
      lastShoulderDiagnostic = {
        target: 'procedural-editor-dance-arms', model: model.name, ...identity, armStyle: dance.armStyle,
        corrected, maoAoSanity: identity.speciesId === 'mao-ao' ? maoAoShoulderSanity(identity.gender, model) : null,
      };
      if (signature !== lastPreviewShoulderSignature) {
        lastPreviewShoulderSignature = signature;
        log('Procedural-editor Dance shoulder pivot now uses authored species+gender hand-shoulder anchors.', 'info', lastShoulderDiagnostic);
      }
    }
  }

  function attachPreviewSceneHook() {
    if (!PREVIEW_PATH_RE.test(location.pathname)) return;
    const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null;
    if (!scene) { global.requestAnimationFrame?.(attachPreviewSceneHook); return; }
    if (scene === previewScene && scene.onBeforeRender === previewSceneWrapper) return;
    previewScene = scene;
    const previous = scene.onBeforeRender;
    previewSceneWrapper = function jointAnchorPreviewBeforeRender() {
      if (typeof previous === 'function') previous.apply(this, arguments);
      correctPreviewDanceShoulders();
    };
    previewSceneWrapper.__hobunjiJointAnchorParity = true;
    scene.onBeforeRender = previewSceneWrapper;
  }

  function previewHookIntegrityLoop() {
    if (PREVIEW_PATH_RE.test(location.pathname)) {
      const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null;
      if (scene && scene.onBeforeRender !== previewSceneWrapper) attachPreviewSceneHook();
    }
    global.requestAnimationFrame?.(previewHookIntegrityLoop);
  }

  const api = {
    installed: true,
    profileFor,
    posteriorY,
    resolveAnchorForAvatar,
    resolveShoulderForAvatar,
    maoAoShoulderSanity,
    syncAllLegHips() { for (const handle of legHandles) handle.syncPosteriorHip?.(); },
    getDebug() {
      return {
        installed: true,
        latestProfileLoadState,
        latestProfileLoadError,
        latestProfileReadyAt,
        liveLegHandles: legHandles.size,
        liveHipCorrections,
        previewHipCorrections,
        previewShoulderCorrections,
        lastHipDiagnostic,
        lastShoulderDiagnostic,
        gameplayDanceShoulderOwner: 'ProceduralHandForearmAlignment / HobunjiCharacterPortraitAnchorSpace',
        maoAoMaleShoulderSanity: maoAoShoulderSanity('male'),
        maoAoFemaleShoulderSanity: maoAoShoulderSanity('female'),
      };
    },
    logNow() { log('Current joint parity diagnostic.', 'info', api.getDebug()); return api.getDebug(); },
  };
  global.HobunjiCharacterJointMotionParity = api;

  chainGlobal('ProceduralLegAnimation', patchLegApi);
  loadLatestProfilesForProceduralEditor();
  if (PREVIEW_PATH_RE.test(location.pathname)) {
    global.requestAnimationFrame?.(patchPreviewHipLines);
    global.requestAnimationFrame?.(previewHookIntegrityLoop);
  }

  global.requestAnimationFrame?.(() => {
    const sanity = maoAoShoulderSanity('male');
    if (sanity) log('Mao-ao male shoulder/perch authoring sanity.', sanity.likelyAuthoringError ? 'warn' : 'info', sanity);
  });
})(window);
