// Scale-aware world/local quaternion bridge for procedural hands plus the shared
// character portrait-anchor coordinate space.
//
// Character attachment points are authored against the UNROTATED portrait, not
// against the outer character/world rig. A point therefore follows the same
// portrait-scale and portrait-Y changes as the pixel it was placed over, before
// camera/deadzone facing rotation is applied. Hand/foot size multipliers remain
// independent; only body-location anchors use this coordinate space.
(function (global) {
  'use strict';

  const hands = global.ProceduralHandAttachments;
  if (!hands?.attach || hands.attach.__hobunjiScaleFreeWorldWrapped) return;

  const originalAttach = hands.attach.bind(hands);
  const PORTRAIT_BINDING_VERSION = 1;
  const CHARACTER_ANCHORS = Object.freeze(['posterior', 'shoulderPerch', 'leftHandShoulder', 'rightHandShoulder']);
  const HAND_SHOULDERS = Object.freeze(['leftHandShoulder', 'rightHandShoulder']);

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positive(value, fallback = 1) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function positionOf(value) {
    const source = value?.position || value || {};
    return { x: finite(source.x), y: finite(source.y), z: finite(source.z) };
  }

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'female' || gender === 'f' ? 'female' : 'male';
  }

  function transformSpeciesId(value) {
    if (typeof global.hobunjiTransformSpeciesId === 'function') return global.hobunjiTransformSpeciesId(value);
    const species = normalizeKey(value);
    if (species === 'rakakoan') return 'kenkari';
    if (species === 'ghoul') return 'mao-ao';
    return species;
  }

  function characterProfileForRig(rig) {
    const speciesId = transformSpeciesId(rig?.speciesId);
    const gender = normalizeGender(rig?.gender);
    const characters = global.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    return characters[`${speciesId}::${gender}`] || characters[`${normalizeKey(rig?.speciesId)}::${gender}`] || null;
  }

  function profileAnatomy(profile) {
    const anatomy = profile?.anatomy || {};
    return {
      portraitScale: positive(anatomy.portraitScale, 1),
      placementRatio: finite(anatomy.portraitVerticalPlacementRatio, .5),
    };
  }

  function metricsForAvatarRoot(avatarRoot, profile) {
    const anatomy = profileAnatomy(profile);
    const userData = avatarRoot?.userData || {};
    const modelWidth = positive(userData.portraitModelWidth, .9 * anatomy.portraitScale);
    const modelHeight = positive(userData.portraitModelHeight, modelWidth);
    const currentScale = positive(userData.portraitScaleMultiplier, anatomy.portraitScale);
    const placementRatio = finite(userData.portraitVerticalPlacementRatio, anatomy.placementRatio);
    return { modelWidth, modelHeight, currentScale, adultScale: anatomy.portraitScale, placementRatio };
  }

  function actorScaleFactor(metrics) {
    return positive(metrics?.currentScale, 1) / positive(metrics?.adultScale, 1);
  }

  function adultMetrics(metrics) {
    const factor = actorScaleFactor(metrics);
    return {
      modelWidth: positive(metrics?.modelWidth, .9) / factor,
      modelHeight: positive(metrics?.modelHeight, .9) / factor,
      currentScale: positive(metrics?.adultScale, 1),
      adultScale: positive(metrics?.adultScale, 1),
      placementRatio: finite(metrics?.placementRatio, .5),
    };
  }

  function makeBinding(profile, referencePosition, metrics = null) {
    const anatomy = profileAnatomy(profile);
    const referenceAdultMetrics = metrics ? adultMetrics(metrics) : null;
    return {
      version: PORTRAIT_BINDING_VERSION,
      coordinateSpace: 'character-portrait-pre-deadzone',
      referencePortraitScale: anatomy.portraitScale,
      referencePlacementRatio: anatomy.placementRatio,
      referenceModelHeight: positive(referenceAdultMetrics?.modelHeight, .9 * anatomy.portraitScale),
      referencePosition: positionOf(referencePosition),
    };
  }

  function validBinding(binding) {
    return !!binding
      && positive(binding.referencePortraitScale, 0) > 0
      && positive(binding.referenceModelHeight, 0) > 0
      && ['x', 'y', 'z'].every(axis => Number.isFinite(Number(binding.referencePosition?.[axis])));
  }

  function ensureStoredBinding(profile, anchorName, metrics = null) {
    const anchor = profile?.anchors?.[anchorName];
    if (!anchor) return null;
    if (validBinding(anchor.portraitBinding)) return anchor.portraitBinding;
    anchor.portraitBinding = makeBinding(profile, anchor.position, metrics);
    return anchor.portraitBinding;
  }

  function resolveBinding(binding, metrics) {
    if (!validBinding(binding) || !metrics) return null;
    const factor = positive(metrics.currentScale, 1) / positive(binding.referencePortraitScale, 1);
    const placementDelta = finite(metrics.placementRatio, .5) - finite(binding.referencePlacementRatio, .5);
    const reference = positionOf(binding.referencePosition);
    return {
      x: reference.x * factor,
      y: reference.y * factor + positive(metrics.modelHeight, .9) * placementDelta,
      z: reference.z * factor,
    };
  }

  function resolveAnchor(profile, anchorName, metrics) {
    const binding = ensureStoredBinding(profile, anchorName, metrics);
    return resolveBinding(binding, metrics) || positionOf(profile?.anchors?.[anchorName]?.position);
  }

  function captureBindingFromDisplayed(profile, anchorName, displayedPosition, metrics) {
    const anchor = profile?.anchors?.[anchorName];
    if (!anchor || !metrics) return null;
    const existing = validBinding(anchor.portraitBinding)
      ? anchor.portraitBinding
      : makeBinding(profile, anchor.position, metrics);
    const factor = positive(metrics.currentScale, 1) / positive(existing.referencePortraitScale, 1);
    const placementDelta = finite(metrics.placementRatio, .5) - finite(existing.referencePlacementRatio, .5);
    const displayed = positionOf(displayedPosition);
    existing.referencePosition = {
      x: displayed.x / factor,
      y: (displayed.y - positive(metrics.modelHeight, .9) * placementDelta) / factor,
      z: displayed.z / factor,
    };
    existing.version = PORTRAIT_BINDING_VERSION;
    existing.coordinateSpace = 'character-portrait-pre-deadzone';
    anchor.portraitBinding = existing;
    return existing;
  }

  function bindPosteriorFromDisplayed(profile, displayedPosition, metrics) {
    const anchor = profile?.anchors?.posterior;
    if (!anchor) return null;
    if (!validBinding(anchor.portraitBinding)) {
      const anatomy = profileAnatomy(profile);
      const factor = actorScaleFactor(metrics);
      const displayed = positionOf(displayedPosition);
      anchor.portraitBinding = {
        version: PORTRAIT_BINDING_VERSION,
        coordinateSpace: 'character-portrait-pre-deadzone',
        referencePortraitScale: anatomy.portraitScale,
        referencePlacementRatio: anatomy.placementRatio,
        referenceModelHeight: positive(metrics?.modelHeight, .9) / factor,
        referencePosition: {
          x: displayed.x / factor,
          y: displayed.y / factor,
          z: displayed.z / factor,
        },
      };
    }
    return anchor.portraitBinding;
  }

  function syncCompatibilityPosition(profile, anchorName, metrics) {
    if (!profile?.anchors?.[anchorName] || anchorName === 'posterior') return null;
    const position = resolveAnchor(profile, anchorName, adultMetrics(metrics));
    Object.assign(profile.anchors[anchorName].position, position);
    return position;
  }

  function mirrorPosteriorBindingToRule(profile) {
    const binding = profile?.anchors?.posterior?.portraitBinding;
    if (!validBinding(binding)) return;
    profile.posteriorRule ||= {};
    profile.posteriorRule.portraitBinding = {
      ...clone(binding),
      currentPlacementRatio: profileAnatomy(profile).placementRatio,
    };
  }

  const portraitAnchorSpace = {
    version: PORTRAIT_BINDING_VERSION,
    coordinateSpace: 'character-portrait-pre-deadzone',
    characterAnchors: CHARACTER_ANCHORS,
    metricsForAvatarRoot,
    actorScaleFactor,
    adultMetrics,
    ensureStoredBinding,
    bindPosteriorFromDisplayed,
    captureBindingFromDisplayed,
    resolveAnchor,
    resolveBinding,
    syncCompatibilityPosition,
    mirrorPosteriorBindingToRule,
  };
  global.HobunjiCharacterPortraitAnchorSpace = portraitAnchorSpace;

  // Preserve the old characterPosteriorY API for mount consumers, but let new
  // exported posterior bindings win when present.
  const priorRigMath = global.HOBUNJI_ATTACHMENT_RIG_MATH;
  if (priorRigMath?.characterPosteriorY && !priorRigMath.characterPosteriorY.__hobunjiPortraitBound) {
    const priorPosteriorY = priorRigMath.characterPosteriorY.bind(priorRigMath);
    const portraitBoundPosteriorY = function portraitBoundPosteriorY(rule, modelHeight, legacyHandAttachY) {
      const binding = rule?.portraitBinding;
      if (validBinding(binding)) {
        const currentHeight = positive(modelHeight, binding.referenceModelHeight);
        const factor = currentHeight / positive(binding.referenceModelHeight, currentHeight);
        const currentPlacement = finite(binding.currentPlacementRatio, binding.referencePlacementRatio);
        return finite(binding.referencePosition?.y) * factor
          + currentHeight * (currentPlacement - finite(binding.referencePlacementRatio, currentPlacement));
      }
      return priorPosteriorY(rule, modelHeight, legacyHandAttachY);
    };
    portraitBoundPosteriorY.__hobunjiPortraitBound = true;
    global.HOBUNJI_ATTACHMENT_RIG_MATH = Object.freeze({ ...priorRigMath, characterPosteriorY: portraitBoundPosteriorY });
  }

  function hierarchyWorldQuaternion(THREE, node, target = new THREE.Quaternion()) {
    const chain = [];
    for (let cursor = node; cursor?.isObject3D; cursor = cursor.parent) chain.push(cursor);
    target.identity();
    for (let i = chain.length - 1; i >= 0; i -= 1) target.multiply(chain[i].quaternion);
    return target.normalize();
  }

  function installScaleFreePlacement(THREE, rig) {
    const parent = rig?.parent;
    if (!parent?.isObject3D || rig.__hobunjiScaleFreeWorldPlacement) return rig;
    const parentWorldQuaternion = new THREE.Quaternion();
    const localQuaternion = new THREE.Quaternion();

    rig.placeHandWorld = function scaleFreePlaceHandWorld(side, worldPosition, worldQuaternion) {
      const socket = rig.group?.getObjectByName?.(`${side}_hand_socket`);
      if (!socket || !worldPosition || !worldQuaternion) return false;
      parent.updateWorldMatrix?.(true, false);
      const localPosition = worldPosition.clone();
      parent.worldToLocal(localPosition);
      hierarchyWorldQuaternion(THREE, parent, parentWorldQuaternion);
      localQuaternion.copy(parentWorldQuaternion).invert().multiply(worldQuaternion).normalize();
      socket.position.copy(localPosition);
      socket.quaternion.copy(localQuaternion);
      socket.visible = true;
      socket.updateMatrix?.();
      socket.updateMatrixWorld?.(true);
      return true;
    };

    const originalDebug = rig.getDebug?.bind(rig);
    rig.getDebug = function scaleFreeHandDebug() {
      return { ...(originalDebug?.() || {}), worldQuaternionBasis: 'scale-free-hierarchy' };
    };
    Object.defineProperty(rig, '__hobunjiScaleFreeWorldPlacement', { value: true, configurable: true });
    return rig;
  }

  const scaleFreeAttach = function scaleFreeHandAttach(THREE, parent, options = {}) {
    return installScaleFreePlacement(THREE, originalAttach(THREE, parent, options));
  };
  scaleFreeAttach.__hobunjiScaleFreeWorldWrapped = true;

  // Shoulder aim loads immediately after this file. Catch that assignment and
  // wrap the finished solver so it sees portrait-transformed actor positions.
  let activeAttach = scaleFreeAttach;

  function withResolvedCharacterProfile(rig, callback) {
    const profile = characterProfileForRig(rig);
    const metrics = metricsForAvatarRoot(rig?.avatarRoot, profile);
    if (!profile || !metrics) return callback();
    const originals = [];
    const originalResolvedPosterior = profile.resolvedPosteriorPosition;
    const hadResolvedPosterior = Object.prototype.hasOwnProperty.call(profile, 'resolvedPosteriorPosition');
    try {
      for (const name of HAND_SHOULDERS) {
        const anchor = profile?.anchors?.[name];
        if (!anchor?.position) continue;
        const original = positionOf(anchor.position);
        originals.push([anchor.position, original]);
        Object.assign(anchor.position, resolveAnchor(profile, name, metrics));
      }

      const posteriorAnchor = profile?.anchors?.posterior;
      if (posteriorAnchor) {
        const liveResolvedPosterior = profile.resolvedPosteriorPosition;
        const hasLiveResolvedPosterior = Number.isFinite(Number(liveResolvedPosterior?.y));
        // Animation Author already publishes the displayed posterior gizmo position.
        // That live value must win during the hand solve; replacing it with an older
        // persisted portraitBinding is what made posterior edits stop moving hands
        // and allowed stale zero-valued bindings to pin a hand to the floor.
        if (!hasLiveResolvedPosterior) {
          if (!validBinding(posteriorAnchor.portraitBinding)) {
            const oldY = priorRigMath?.characterPosteriorY?.(
              profile.posteriorRule,
              metrics.modelHeight,
              rig?.avatarRoot?.userData?.handAttachY,
            );
            const displayed = {
              x: finite(posteriorAnchor.position?.x),
              y: finite(oldY),
              z: finite(posteriorAnchor.position?.z),
            };
            bindPosteriorFromDisplayed(profile, displayed, metrics);
          }
          profile.resolvedPosteriorPosition = resolveAnchor(profile, 'posterior', metrics);
          mirrorPosteriorBindingToRule(profile);
        }
      }
      return callback();
    } finally {
      for (const [position, original] of originals) Object.assign(position, original);
      if (hadResolvedPosterior) profile.resolvedPosteriorPosition = originalResolvedPosterior;
      else delete profile.resolvedPosteriorPosition;
    }
  }

  function effectiveAnchorDebug(rig) {
    const profile = characterProfileForRig(rig);
    const metrics = metricsForAvatarRoot(rig?.avatarRoot, profile);
    if (!profile || !metrics) return null;
    const liveResolvedPosterior = profile?.resolvedPosteriorPosition;
    return {
      coordinateSpace: 'character-portrait-pre-deadzone -> actor visual-local',
      actorScaleFactor: actorScaleFactor(metrics),
      currentPortraitScale: metrics.currentScale,
      authoredAdultScale: metrics.adultScale,
      placementRatio: metrics.placementRatio,
      leftHandShoulder: resolveAnchor(profile, 'leftHandShoulder', metrics),
      rightHandShoulder: resolveAnchor(profile, 'rightHandShoulder', metrics),
      posterior: Number.isFinite(Number(liveResolvedPosterior?.y))
        ? positionOf(liveResolvedPosterior)
        : profile?.anchors?.posterior ? resolveAnchor(profile, 'posterior', metrics) : null,
    };
  }

  function installPortraitBoundHandSolver(nextAttach) {
    if (typeof nextAttach !== 'function' || nextAttach.__hobunjiPortraitAnchorSpaceWrapped) return nextAttach;
    if (!nextAttach.__hobunjiShoulderAimWrapped) return nextAttach;
    const adapted = function portraitBoundShoulderAttach(THREE, parent, options = {}) {
      const rig = nextAttach.call(this, THREE, parent, options);
      if (!rig || rig.__hobunjiPortraitAnchorSpaceRigWrapped) return rig;
      for (const name of ['setSideIdle', 'useIdlePose', 'placeHandWorld']) {
        const original = rig[name]?.bind(rig);
        if (!original) continue;
        rig[name] = function portraitBoundShoulderSolve() {
          const args = arguments;
          return withResolvedCharacterProfile(rig, () => original(...args));
        };
      }
      const originalDebug = rig.getDebug?.bind(rig);
      rig.getDebug = function portraitBoundShoulderDebug() {
        return { ...(originalDebug?.() || {}), characterPortraitAnchorSpace: effectiveAnchorDebug(rig) };
      };
      Object.defineProperty(rig, '__hobunjiPortraitAnchorSpaceRigWrapped', { value: true, configurable: true });
      return rig;
    };
    adapted.__hobunjiShoulderAimWrapped = true;
    adapted.__hobunjiScaleFreeWorldWrapped = true;
    adapted.__hobunjiPortraitAnchorSpaceWrapped = true;
    return adapted;
  }

  try {
    Object.defineProperty(hands, 'attach', {
      configurable: true,
      enumerable: true,
      get() { return activeAttach; },
      set(nextAttach) { activeAttach = installPortraitBoundHandSolver(nextAttach); },
    });
  } catch (_) {
    hands.attach = scaleFreeAttach;
  }

  // Animation Author integration. Its stored profile remains adult species/gender
  // data while each preview actor can additionally be a child.
  function installAnimationAuthorPortraitAnchorBridge() {
    if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(global.location?.pathname || '')) return true;
    const PATCH_ID = 'animation-author-character-portrait-anchor-space-v1';
    if (global.__HobunjiAnimationAuthorPortraitAnchorBridge === PATCH_ID) return true;
    const required = [
      'applyAttachmentRigProfileToActor', 'handleAnimationTransformChanged', 'attachmentRigProfileForActor',
      'selectedAnimationActor', 'selectedRigAnchorName', 'portraitModelMetrics', 'normalizedRigProfileLibrary',
    ];
    if (!required.every(name => typeof global[name] === 'function')) return false;

    function metricsForActor(actor, profile) {
      const modelMetrics = global.portraitModelMetrics(actor) || {};
      const anatomy = profileAnatomy(profile);
      const currentScale = positive(
        actor?.model?.userData?.portraitScaleMultiplier,
        positive(actor?.rigBuiltAvatarScaleV1533, anatomy.portraitScale),
      );
      return {
        modelWidth: positive(modelMetrics.modelWidth, actor?.model?.userData?.portraitModelWidth || .9),
        modelHeight: positive(modelMetrics.modelHeight, actor?.model?.userData?.portraitModelHeight || .9),
        currentScale,
        adultScale: anatomy.portraitScale,
        placementRatio: finite(actor?.model?.userData?.portraitVerticalPlacementRatio, anatomy.placementRatio),
      };
    }

    function publishActorProfile(actor, profile) {
      try { global.publishCharacterHandShouldersV1525?.(actor, profile); } catch (_) {}
      try { global.updateActorAttachmentAlignment?.(actor); } catch (_) {}
    }

    function applyBindingsToActor(actor, profile = global.attachmentRigProfileForActor(actor)) {
      if (actor?.source?.type !== 'npc' || !profile || !actor.rigAnchors) return;
      const metrics = metricsForActor(actor, profile);
      for (const name of CHARACTER_ANCHORS) {
        const group = actor.rigAnchors[name];
        const anchor = profile.anchors?.[name];
        if (!group || !anchor) continue;
        if (name === 'posterior' && !validBinding(anchor.portraitBinding)) {
          // Preserve the already-fixed displayed posterior as the migration point.
          bindPosteriorFromDisplayed(profile, group.position, metrics);
        } else {
          ensureStoredBinding(profile, name, metrics);
        }
        const effective = resolveAnchor(profile, name, metrics);
        group.position.set(effective.x, effective.y, effective.z);
        if (name !== 'posterior') syncCompatibilityPosition(profile, name, metrics);
      }
      mirrorPosteriorBindingToRule(profile);
      publishActorProfile(actor, profile);
      global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
      global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.characterPortraitAnchorSpace = {
        mode: 'portrait-bound-pre-deadzone',
        actor: actor.label || actor.id || null,
        actorScaleFactor: actorScaleFactor(metrics),
        placementRatio: metrics.placementRatio,
      };
    }

    const baseNormalize = global.normalizedRigProfileLibrary;
    global.normalizedRigProfileLibrary = function portraitBindingPreservingNormalizer(value = {}) {
      const output = baseNormalize.apply(this, arguments);
      for (const [key, targetProfile] of Object.entries(output.characters || {})) {
        const sourceProfile = value?.characters?.[key] || {};
        for (const name of CHARACTER_ANCHORS) {
          const binding = sourceProfile?.anchors?.[name]?.portraitBinding;
          if (binding && targetProfile?.anchors?.[name]) targetProfile.anchors[name].portraitBinding = clone(binding);
        }
        if (sourceProfile?.posteriorRule?.portraitBinding) {
          targetProfile.posteriorRule ||= {};
          targetProfile.posteriorRule.portraitBinding = clone(sourceProfile.posteriorRule.portraitBinding);
        }
      }
      return output;
    };

    const baseApplyProfile = global.applyAttachmentRigProfileToActor;
    global.applyAttachmentRigProfileToActor = function portraitBoundApplyAttachmentRigProfile(actor) {
      const result = baseApplyProfile.apply(this, arguments);
      if (actor?.source?.type === 'npc') applyBindingsToActor(actor);
      return result;
    };

    const baseHandleTransform = global.handleAnimationTransformChanged;
    global.handleAnimationTransformChanged = function portraitBoundHandleAnimationTransformChanged(source, changedTarget) {
      const actor = global.selectedAnimationActor?.();
      const rigMode = global.document?.body?.dataset?.animationAuthorMode === 'rig';
      const isRigEdit = actor?.source?.type === 'npc' && rigMode && (changedTarget === 'rigAnchor' || changedTarget == null);
      const name = isRigEdit ? global.selectedRigAnchorName?.(actor) : null;
      const group = name ? actor?.rigAnchors?.[name] : null;
      const profile = isRigEdit ? global.attachmentRigProfileForActor?.(actor) : null;
      if (!profile || !group || !CHARACTER_ANCHORS.includes(name)) return baseHandleTransform.apply(this, arguments);

      const metrics = metricsForActor(actor, profile);
      if (name === 'posterior') {
        captureBindingFromDisplayed(profile, name, group.position, metrics);
        mirrorPosteriorBindingToRule(profile);
        const result = baseHandleTransform.apply(this, arguments);
        mirrorPosteriorBindingToRule(profile);
        applyBindingsToActor(actor, profile);
        return result;
      }

      const binding = captureBindingFromDisplayed(profile, name, group.position, metrics);
      const displayed = { x: group.position.x, y: group.position.y, z: group.position.z };
      const compatibilityPosition = resolveAnchor(profile, name, adultMetrics(metrics));
      group.position.set(compatibilityPosition.x, compatibilityPosition.y, compatibilityPosition.z);
      const result = baseHandleTransform.apply(this, arguments);
      if (profile.anchors?.[name]) profile.anchors[name].portraitBinding = clone(binding);
      group.position.set(displayed.x, displayed.y, displayed.z);
      applyBindingsToActor(actor, profile);
      return result;
    };

    if (typeof global.applyCharacterPortraitPlacementV1530 === 'function') {
      const basePortraitPlacement = global.applyCharacterPortraitPlacementV1530;
      global.applyCharacterPortraitPlacementV1530 = function portraitBoundCharacterPlacement(actor, ratio) {
        const result = basePortraitPlacement.apply(this, arguments);
        if (actor?.source?.type === 'npc') applyBindingsToActor(actor);
        return result;
      };
    }

    if (typeof global.serializeAttachmentRigLibrary === 'function') {
      const baseSerialize = global.serializeAttachmentRigLibrary;
      global.serializeAttachmentRigLibrary = function portraitBoundRigExport() {
        const data = baseSerialize.apply(this, arguments);
        data.coordinateSpace = 'Character posterior, shoulder perch, and hand-shoulder anchors are bound to the unrotated portrait before deadzone/facing rotation. portraitBinding stores the portrait scale/Y state used when each point was authored; effective positions follow later body-scale, child-scale, and portrait-Y changes.';
        data.portraitBindingSemantics = {
          profileField: 'characters.<species>::<gender>.anchors.<anchor>.portraitBinding',
          anchors: [...CHARACTER_ANCHORS],
          transformOrder: 'portrait binding -> body/child scale + portrait Y -> deadzone/facing rotation -> world',
          independentSizeControls: ['handScale', 'footScale'],
        };
        return data;
      };
    }

    global.__HobunjiAnimationAuthorPortraitAnchorBridge = PATCH_ID;
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    global.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.characterPortraitAnchorBridge = 'installed after final Animation Author wrappers';
    const selected = global.selectedAnimationActor?.();
    if (selected?.source?.type === 'npc') applyBindingsToActor(selected);
    return true;
  }

  if (!installAnimationAuthorPortraitAnchorBridge()) {
    let attempts = 0;
    const timer = global.setInterval(() => {
      if (installAnimationAuthorPortraitAnchorBridge() || ++attempts >= 600) global.clearInterval(timer);
    }, 50);
  }

  global.ProceduralHandScaleFreeWorld = Object.freeze({
    mode: 'scale-free-quaternion-hierarchy + portrait-bound-character-anchors',
  });
})(window);
