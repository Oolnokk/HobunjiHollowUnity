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

  function zeroPosteriorPlaceholder(position) { return ['x', 'y', 'z'].every(axis => Math.abs(finite(position?.[axis])) < 1e-12); } // Master/export zero anchors mean derive the anatomical hip, not floor-level hands.

  function ensureStoredBinding(profile, anchorName, metrics = null) {
    const anchor = profile?.anchors?.[anchorName];
    if (!anchor) return null;
    const binding = anchor.portraitBinding; // Repair old debug/export-created posterior bindings as well as fresh placeholders.
    if (anchorName === 'posterior' && zeroPosteriorPlaceholder(binding?.referencePosition || anchor.position)) {
      const referenceHeight = positive(binding?.referenceModelHeight, metrics ? adultMetrics(metrics).modelHeight : .9 * profileAnatomy(profile).portraitScale); // Derived posterior stays in the binding's adult reference frame.
      const derivedY = priorRigMath?.characterPosteriorY?.(profile.posteriorRule, referenceHeight, referenceHeight / 2); // Use the original anatomical rule so a poisoned portrait binding cannot feed itself back into the hip.
      // Floor-relative posteriors may legitimately be below zero for short portrait placements. Only an exact derived zero is ambiguous with the legacy placeholder.
      if (Number.isFinite(derivedY) && Math.abs(derivedY) > 1e-12) {
        anchor.portraitBinding = validBinding(binding) ? { ...binding, referencePosition: { x:0, y:derivedY, z:0 } } : makeBinding(profile, { x:0, y:derivedY, z:0 }, metrics);
        return anchor.portraitBinding;
      }
    }
    if (validBinding(binding)) return binding;
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

  // withResolvedCharacterProfile calls this on every hand-rig solve (several
  // times per rig per frame). The mirrored rule binding is only rebuilt when
  // the source binding or placement ratio actually changed, or when something
  // else replaced the rule's binding; otherwise the deep clone was identical.
  const mirroredPosteriorBindings = new WeakMap(); // profile -> { json, ratio, written }
  function mirrorPosteriorBindingToRule(profile) {
    const binding = profile?.anchors?.posterior?.portraitBinding;
    if (!validBinding(binding)) return;
    profile.posteriorRule ||= {};
    const json = JSON.stringify(binding);
    const ratio = profileAnatomy(profile).placementRatio;
    const last = mirroredPosteriorBindings.get(profile);
    if (last && last.json === json && Object.is(last.ratio, ratio) && profile.posteriorRule.portraitBinding === last.written) return;
    const written = {
      ...JSON.parse(json),
      currentPlacementRatio: ratio,
    };
    profile.posteriorRule.portraitBinding = written;
    mirroredPosteriorBindings.set(profile, { json, ratio, written });
  }

  function livePosteriorPosition(profile, metrics) {
    if (!profile) return null;
    const position = resolveAnchor(profile, 'posterior', metrics);
    profile.resolvedPosteriorPosition = position;
    mirrorPosteriorBindingToRule(profile);
    return position;
  }

  const originalResolve = hands.resolveCharacterProfile;
  if (typeof originalResolve === 'function' && !originalResolve.__hobunjiPortraitAnchorWrapped) {
    hands.resolveCharacterProfile = function wrappedResolveCharacterProfile(rig, avatarRoot) {
      const result = originalResolve.call(this, rig, avatarRoot);
      const profile = characterProfileForRig(rig);
      if (!profile) return result;
      const metrics = metricsForAvatarRoot(avatarRoot, profile);
      profile.resolvedPosteriorPosition = livePosteriorPosition(profile, metrics);
      return result;
    };
    hands.resolveCharacterProfile.__hobunjiPortraitAnchorWrapped = true;
  }

  const originalUpdate = hands.update;
  if (typeof originalUpdate === 'function' && !originalUpdate.__hobunjiPortraitAnchorWrapped) {
    hands.update = function wrappedUpdate(...args) {
      const rig = args[0];
      const avatarRoot = args[1];
      const profile = characterProfileForRig(rig);
      if (profile && avatarRoot) profile.resolvedPosteriorPosition = livePosteriorPosition(profile, metricsForAvatarRoot(avatarRoot, profile));
      return originalUpdate.apply(this, args);
    };
    hands.update.__hobunjiPortraitAnchorWrapped = true;
  }

  // Preserve the original attach semantics, but publish the shared coordinate helper
  // first so both runtime and Animation Author can use the same transform math.
  global.HobunjiCharacterPortraitAnchorSpace = Object.freeze({
    coordinateSpace: 'character-portrait-pre-deadzone',
    ensureStoredBinding,
    resolveAnchor,
    captureBindingFromDisplayed,
    bindPosteriorFromDisplayed,
    syncCompatibilityPosition,
    mirrorPosteriorBindingToRule,
    metricsForAvatarRoot,
    adultMetrics,
  });

  function wrappedAttach(...args) {
    return originalAttach(...args);
  }
  wrappedAttach.__hobunjiScaleFreeWorldWrapped = true;
  hands.attach = wrappedAttach;
})(window);
