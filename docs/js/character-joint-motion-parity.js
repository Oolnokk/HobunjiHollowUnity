// Shared species/gender joint-anchor parity for gameplay + Procedural Animation Editor.
//
// Source-of-truth rules:
//   * every movement hip uses the CURRENT species+gender posterior Y;
//   * dance shoulders use the authored left/right hand-shoulder anchors;
//   * shoulder-pet perch is diagnostic/reference only, never substituted for a hand shoulder.
//
// This deliberately reads HOBUNJI_ATTACHMENT_RIG_PROFILES live. The latest authored
// snapshot can land after an avatar/leg handle was constructed, so caching a posterior
// number at attach time is incorrect.
(function (global) {
  'use strict';

  if (global.HobunjiCharacterJointMotionParity?.installed) return;

  const SELF_SRC = document.currentScript?.src || '';
  const DEFAULT_MODEL_SIZE = 0.9;
  const PREVIEW_PATH_RE = /\/tools\/procedural-animation-editor\/(?:index\.html)?$/;
  const PRE_SYNC_ORDER = -99995; // Normal hand driver is -100000; capture the undanced wrist immediately after it.
  const DANCE_SYNC_ORDER = -99985; // Player/NPC dance is -99990; correct its shoulder origin before forearm orientation/visible hands.
  const LEG_EPSILON = 1e-7;
  const registeredHandRigs = new Set();
  const handSentinels = new WeakMap();
  const legHandles = new Set();

  let latestProfileLoadState = 'idle';
  let latestProfileLoadError = null;
  let latestProfileReadyAt = 0;
  let liveHipCorrections = 0;
  let danceShoulderCorrections = 0;
  let previewHipCorrections = 0;
  let lastHipDiagnostic = null;
  let lastShoulderDiagnostic = null;
  let lastPreviewModel = null;
  let lastPreviewShoulderSignature = '';
  let previewScene = null;
  let previewSceneBeforeRender = null;
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
    const adultScale = Number(anatomy.portraitScale) || 1;
    const userData = avatarRoot?.userData || {};
    const width = Number(userData.portraitModelWidth) || DEFAULT_MODEL_SIZE * adultScale;
    const height = Number(userData.portraitModelHeight) || width;
    const currentScale = Number(userData.portraitScaleMultiplier) || adultScale;
    const placementRatio = Number.isFinite(Number(userData.portraitVerticalPlacementRatio))
      ? Number(userData.portraitVerticalPlacementRatio)
      : Number(anatomy.portraitVerticalPlacementRatio) || 0.5;
    return { width, height, currentScale, adultScale, placementRatio };
  }

  function posteriorY(speciesId, gender, modelHeight, handAttachY = null) {
    const profile = profileFor(speciesId, gender);
    const height = Math.max(0.01, Number(modelHeight) || DEFAULT_MODEL_SIZE);
    const live = Number(profile?.resolvedPosteriorPosition?.y);
    if (Number.isFinite(live)) return live;
    const shared = Number(global.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(
      profile?.posteriorRule,
      height,
      Number(handAttachY),
    ));
    if (Number.isFinite(shared)) return shared;
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

    // Prefer the portrait-binding system used by runtime hands, pets, and Animation Author.
    const portraitSpace = global.HobunjiCharacterPortraitAnchorSpace;
    if (portraitSpace?.metricsForAvatarRoot && portraitSpace?.resolveAnchor) {
      const metrics = portraitSpace.metricsForAvatarRoot(avatarRoot, profile);
      const position = portraitSpace.resolveAnchor(profile, anchorName, metrics);
      if (position) return { position, profile, source: 'portrait-anchor-space', metrics };
    }

    // Lightweight fallback for the Procedural Animation Editor, which does not load
    // the full gameplay hand stack. Authored character coordinates use the 0.9-wide
    // adult basis; current preview size is already species/gender/full-scale adjusted.
    const dims = avatarDimensions(avatarRoot, profile);
    const referenceWidth = Number(profile?.handShoulderRule?.runtimeBaseWidth) || DEFAULT_MODEL_SIZE;
    const referenceHeight = Number(profile?.shoulderPerchRule?.portraitModelHeight)
      || DEFAULT_MODEL_SIZE * (Number(profile?.anatomy?.portraitScale) || 1);
    const xScale = referenceWidth > 0 ? dims.width / referenceWidth : 1;
    const yScale = referenceHeight > 0 ? dims.height / referenceHeight : 1;
    return {
      position: {
        x: (Number(raw.x) || 0) * xScale,
        y: (Number(raw.y) || 0) * yScale,
        z: (Number(raw.z) || 0) * xScale,
      },
      profile,
      source: 'authored-profile-size-fallback',
      metrics: dims,
    };
  }

  function resolveShoulderForRig(rig, side) {
    const avatarRoot = rig?.avatarRoot || null;
    const identity = identityForAvatar(avatarRoot, { speciesId: rig?.speciesId, gender: rig?.gender });
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
    return {
      species: 'mao-ao', gender: sex,
      coordinateSpace: avatarRoot ? 'current-portrait-space' : 'authored-character-space',
      shoulderPerchY: Number(perch.y),
      leftHandShoulderY: Number(left.y),
      rightHandShoulderY: Number(right.y),
      leftDeltaFromPerch: Number(left.y) - Number(perch.y),
      rightDeltaFromPerch: Number(right.y) - Number(perch.y),
      likelyAuthoringError: Math.abs(Number(left.y) - Number(perch.y)) > 0.08
        && Math.abs(Number(right.y) - Number(perch.y)) > 0.08,
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
    const modelHeight = Math.max(0.01,
      Number(options.modelHeight)
      || Number(options.avatarRoot?.userData?.portraitModelHeight)
      || DEFAULT_MODEL_SIZE);
    const handAttachY = Number.isFinite(Number(options.handAttachY))
      ? Number(options.handAttachY)
      : Number(options.avatarRoot?.userData?.handAttachY);
    const leftHip = handle.group.getObjectByName?.('left_hip') || null;
    const rightHip = handle.group.getObjectByName?.('right_hip') || null;
    let lastY = null;

    const syncPosterior = () => {
      const nextY = posteriorY(identity.speciesId, identity.gender, modelHeight, handAttachY);
      if (!Number.isFinite(nextY)) return null;
      if (leftHip?.position) leftHip.position.y = nextY;
      if (rightHip?.position) rightHip.position.y = nextY;
      if (lastY == null || Math.abs(nextY - lastY) > LEG_EPSILON) {
        liveHipCorrections += 1;
        lastHipDiagnostic = {
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
        syncPosterior(); // Hip must be correct BEFORE the two-bone solve uses it.
        const result = originalUpdate.apply(this, arguments);
        syncPosterior(); // Keep exposed/debug hip nodes authoritative if an older updater wrote them.
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
        return { ...(originalDebug() || {}), livePosteriorY: syncPosterior(), posteriorSource: 'species+gender-current-profile' };
      };
    }
    try {
      Object.defineProperty(handle, 'standingPosteriorY', {
        configurable: true,
        enumerable: true,
        get: () => syncPosterior(),
      });
    } catch (_) {
      // Older handles expose a writable value instead. The update wrapper still keeps hips live.
    }
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

  function makeInvisibleSentinel(THREE, name, renderOrder, callback) {
    if (!THREE?.Mesh || !THREE?.BufferGeometry || !THREE?.Float32BufferAttribute || !THREE?.MeshBasicMaterial) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0.0001,0,0, 0,0.0001,0], 3));
    const material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    material.colorWrite = false;
    const sentinel = new THREE.Mesh(geometry, material);
    sentinel.name = name;
    sentinel.frustumCulled = false;
    sentinel.renderOrder = renderOrder;
    sentinel.onBeforeRender = callback;
    return sentinel;
  }

  function handSockets(rig) {
    return {
      left: rig?.group?.getObjectByName?.('left_hand_socket') || null,
      right: rig?.group?.getObjectByName?.('right_hand_socket') || null,
    };
  }

  function installDanceShoulderSentinels(rig, THREE = global.THREE) {
    if (!rig?.group?.isObject3D || handSentinels.has(rig) || !THREE) return;
    const sockets = handSockets(rig);
    if (!sockets.left || !sockets.right) return;
    const base = { left: null, right: null };
    const avatarRoot = rig.avatarRoot || null;

    const pre = makeInvisibleSentinel(THREE, `${rig.group.name || 'hands'}_joint_pre`, PRE_SYNC_ORDER, () => {
      base.left = sockets.left.position.clone();
      base.right = sockets.right.position.clone();
    });
    const post = makeInvisibleSentinel(THREE, `${rig.group.name || 'hands'}_joint_post`, DANCE_SYNC_ORDER, () => {
      if (!base.left || !base.right) return;
      const moved = sockets.left.position.distanceToSquared(base.left) > 1e-10
        || sockets.right.position.distanceToSquared(base.right) > 1e-10;
      if (!moved) return; // No dance writer ran between the two sentinels.
      const profile = profileFor(rig.speciesId, rig.gender);
      const dims = avatarDimensions(avatarRoot, profile);
      const corrected = {};
      for (const side of ['left', 'right']) {
        const shoulder = resolveShoulderForRig(rig, side);
        if (!shoulder?.position) continue;
        const rest = base[side];
        // Old dance code implicitly treated a heuristic point above/inboard of the
        // resting wrist as its shoulder. Translate the already-authored dance pose
        // by the delta to the actual shoulder, preserving its beat/style motion.
        const legacyShoulder = {
          x: rest.x * 0.62,
          y: rest.y + dims.height * 0.10,
          z: rest.z,
        };
        const dx = Number(shoulder.position.x) - legacyShoulder.x;
        const dy = Number(shoulder.position.y) - legacyShoulder.y;
        const dz = Number(shoulder.position.z) - legacyShoulder.z;
        sockets[side].position.x += dx;
        sockets[side].position.y += dy;
        sockets[side].position.z += dz;
        sockets[side].updateMatrix?.();
        sockets[side].updateMatrixWorld?.(true);
        corrected[side] = { authoredShoulder: shoulder.position, legacyShoulder, correction: { x: dx, y: dy, z: dz }, source: shoulder.source };
      }
      if (corrected.left || corrected.right) {
        danceShoulderCorrections += 1;
        lastShoulderDiagnostic = {
          target: 'gameplay-dance-hands',
          speciesId: normalizeSpecies(rig.speciesId),
          gender: normalizeGender(rig.gender) || 'male',
          corrected,
          maoAoSanity: normalizeSpecies(rig.speciesId) === 'mao-ao' ? maoAoShoulderSanity(rig.gender, avatarRoot) : null,
        };
      }
    });
    if (!pre || !post) return;
    rig.group.add(pre, post);
    handSentinels.set(rig, { pre, post });
  }

  function registerHandRig(rig, THREE = global.THREE) {
    if (!rig) return rig;
    registeredHandRigs.add(rig);
    installDanceShoulderSentinels(rig, THREE);
    return rig;
  }

  function patchHandApi(api) {
    if (!api?.attach || api.attach.__hobunjiJointDanceWrapped) return;
    const original = api.attach.bind(api);
    api.attach = function jointDanceHandAttach(THREE, parent, options = {}) {
      return registerHandRig(original(THREE, parent, options), THREE);
    };
    api.attach.__hobunjiJointDanceWrapped = true;
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
      requestAnimationFrame(loadLatestProfilesForProceduralEditor);
      return;
    }
    latestProfileLoadState = 'loading';
    appendScript(profileScriptUrl('attachment-rig-latest-authored-snapshot-core.js?v=20260904joint1'), 'proceduralEditorLatestRigSnapshot')
      .then(() => appendScript(profileScriptUrl('character-rig-maoao-authored-20260905.js?v=20260905joint1'), 'proceduralEditorLatestMaoShoulders'))
      .then(() => {
        latestProfileLoadState = 'ready';
        latestProfileReadyAt = performance.now();
        const male = profileFor('mao-ao', 'male');
        const sanity = maoAoShoulderSanity('male');
        log('[Joint anchors] Procedural editor now uses the latest authored rig profile layer.', 'info', {
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
        log('[Joint anchors] Latest authored procedural-editor rig profile failed to load.', 'error', { error: latestProfileLoadError });
      });
  }

  function previewIdentity(model) {
    return identityForAvatar(model)
      || identityFromObject(model?.userData?.experimentalFeet)
      || null;
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
      // The Dance generated-feet bridge exposes proxy hip positions through its shim.
      // Keep those pivots in lock-step if the bridge captured the line before the latest
      // authored profile finished loading.
      const shim = model.getObjectByName?.(`${model.name || 'Avatar'}_procedural_feet`) || null;
      for (const side of ['left', 'right']) {
        const hip = shim?.getObjectByName?.(`${side}_hip`);
        if (hip?.position && Number.isFinite(desired)) hip.position.y = desired;
      }
    }
    requestAnimationFrame(patchPreviewHipLines);
  }

  function previewShoulderModelLocal(model, identity, side) {
    const anchorName = side === 'right' ? 'rightHandShoulder' : 'leftHandShoulder';
    const resolved = resolveAnchorForAvatar(model, identity.speciesId, identity.gender, anchorName);
    if (!resolved?.position) return null;
    const lift = avatarDimensions(model, resolved.profile).height / 2; // Full Character Scale portrait lift; Dance arm root is portrait-local.
    return {
      position: {
        x: Number(resolved.position.x) || 0,
        y: (Number(resolved.position.y) || 0) - lift,
        z: Number(resolved.position.z) || 0,
      },
      floorPosition: resolved.position,
      source: resolved.source,
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
      const desired = previewShoulderModelLocal(model, identity, side);
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
      corrected[side] = { oldShoulderLocal: old, authoredShoulderLocal: desired.position, authoredShoulderFloor: desired.floorPosition, delta, source: desired.source };
    }
    if (corrected.left || corrected.right) {
      danceShoulderCorrections += 1;
      const signature = `${model.name}|${identity.speciesId}|${identity.gender}|${dance.armStyle}`;
      lastShoulderDiagnostic = {
        target: 'procedural-editor-dance-arms', model: model.name, ...identity, armStyle: dance.armStyle,
        corrected, maoAoSanity: identity.speciesId === 'mao-ao' ? maoAoShoulderSanity(identity.gender, model) : null,
      };
      if (signature !== lastPreviewShoulderSignature) {
        lastPreviewShoulderSignature = signature;
        log('[Joint anchors] Dance shoulder pivot now uses authored species+gender hand-shoulder anchors.', 'info', lastShoulderDiagnostic);
      }
    }
  }

  function attachPreviewSceneHook() {
    if (!PREVIEW_PATH_RE.test(location.pathname)) return;
    const scene = global.HobunjiGameplayBackdrop?.getScene?.() || null;
    if (!scene) { requestAnimationFrame(attachPreviewSceneHook); return; }
    if (scene === previewScene && scene.onBeforeRender === previewSceneWrapper) return;
    previewScene = scene;
    previewSceneBeforeRender = scene.onBeforeRender;
    const previous = previewSceneBeforeRender;
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
    requestAnimationFrame(previewHookIntegrityLoop);
  }

  const api = {
    installed: true,
    profileFor,
    posteriorY,
    resolveAnchorForAvatar,
    resolveShoulderForRig,
    maoAoShoulderSanity,
    syncAllLegHips() { for (const handle of legHandles) handle.syncPosteriorHip?.(); },
    getDebug() {
      return {
        installed: true,
        latestProfileLoadState,
        latestProfileLoadError,
        latestProfileReadyAt,
        liveLegHandles: legHandles.size,
        registeredHandRigs: registeredHandRigs.size,
        liveHipCorrections,
        previewHipCorrections,
        danceShoulderCorrections,
        lastHipDiagnostic,
        lastShoulderDiagnostic,
        maoAoMaleShoulderSanity: maoAoShoulderSanity('male'),
        maoAoFemaleShoulderSanity: maoAoShoulderSanity('female'),
      };
    },
    logNow() { log('[Joint anchors] Current joint parity diagnostic.', 'info', api.getDebug()); return api.getDebug(); },
  };
  global.HobunjiCharacterJointMotionParity = api;

  chainGlobal('ProceduralLegAnimation', patchLegApi);
  chainGlobal('ProceduralHandAttachments', patchHandApi);
  loadLatestProfilesForProceduralEditor();
  if (PREVIEW_PATH_RE.test(location.pathname)) {
    requestAnimationFrame(patchPreviewHipLines);
    requestAnimationFrame(previewHookIntegrityLoop);
  }

  // The male Mao-ao values are intentionally logged because the shoulder-pet
  // perch is the requested sanity check for whether the authored hand shoulders
  // themselves are bad. Small deltas mean the bug is interpretation, not authoring.
  requestAnimationFrame(() => {
    const sanity = maoAoShoulderSanity('male');
    if (sanity) log('[Joint anchors] Mao-ao male shoulder/perch authoring sanity.', sanity.likelyAuthoringError ? 'warn' : 'info', sanity);
  });
})(window);
