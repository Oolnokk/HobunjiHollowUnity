// Bridge Animation Author internals to the separately loaded Full Character Scale
// workspace. This bridge must never impersonate editor UI buttons: in Rig mode the
// ordinary New button is a destructive attachment-library reset, not a scene clear.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const publicApi = () => window.MultiAvatarAnimationAuthor || {};
  const normalizeSpecies = value => String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const normalizeGender = value => {
    const gender = String(value || '').trim().toLowerCase();
    return gender === 'f' ? 'female' : gender === 'm' ? 'male' : gender;
  };
  const canonicalSpecies = value => {
    const species = normalizeSpecies(value);
    if (typeof window.hobunjiTransformSpeciesId === 'function') return normalizeSpecies(window.hobunjiTransformSpeciesId(species));
    return species === 'rakakoan' ? 'kenkari' : species === 'ghoul' ? 'mao-ao' : species;
  };

  let lastActor = null;

  function actorFromAuthorState() {
    try {
      if (typeof animationAuthor !== 'undefined') {
        const id = animationAuthor.selectedActorId;
        return animationAuthor.actors?.find?.(actor => actor.id === id) || lastActor || null;
      }
    } catch (_) {}
    return lastActor;
  }

  function profileForActorFallback(actor) {
    if (!actor) return null;
    const source = actor.source || {};
    const species = canonicalSpecies(source.species || source.appearance?.speciesId || source.appearance?.species);
    const gender = normalizeGender(source.gender || source.appearance?.gender);
    return window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${species}::${gender}`] || null;
  }

  function nativeSetMode() {
    try {
      if (typeof setAnimationAuthorMode === 'function' && setAnimationAuthorMode !== setMode) return setAnimationAuthorMode;
    } catch (_) {}
    const fn = publicApi().setMode;
    return typeof fn === 'function' && fn !== setMode ? fn : null;
  }

  function nativeAddNpc() {
    try {
      if (typeof addNpcAnimationActor === 'function' && addNpcAnimationActor !== addNpc) return addNpcAnimationActor;
    } catch (_) {}
    const fn = publicApi().addNpc;
    return typeof fn === 'function' && fn !== addNpc ? fn : null;
  }

  function nativeSelectActor() {
    try {
      if (typeof selectAnimationActor === 'function' && selectAnimationActor !== selectActor) return selectAnimationActor;
    } catch (_) {}
    const fn = publicApi().selectActor;
    return typeof fn === 'function' && fn !== selectActor ? fn : null;
  }

  async function addNpc(id, options) {
    const fn = nativeAddNpc();
    if (!fn) throw new Error('Animation Author NPC preview API is unavailable.');
    const actor = await fn.call(publicApi(), id, options);
    lastActor = actor || actorFromAuthorState();
    return actor || lastActor;
  }

  function selectedActor() {
    try {
      if (typeof selectedAnimationActor === 'function' && selectedAnimationActor !== selectedActor) {
        return selectedAnimationActor() || actorFromAuthorState();
      }
    } catch (_) {}
    return actorFromAuthorState();
  }

  function selectActor(id) {
    const fn = nativeSelectActor();
    if (!fn) throw new Error('Animation Author selection API is unavailable.');
    const result = fn.call(publicApi(), id);
    lastActor = actorFromAuthorState() || lastActor;
    return result;
  }

  function profileForActor(actor) {
    try {
      if (typeof attachmentRigProfileForActor === 'function' && attachmentRigProfileForActor !== profileForActor) {
        return attachmentRigProfileForActor(actor) || profileForActorFallback(actor);
      }
    } catch (_) {}
    return profileForActorFallback(actor);
  }

  function disposeRelationLine(line) {
    try { line?.parent?.remove?.(line); } catch (_) {}
    try { line?.geometry?.dispose?.(); } catch (_) {}
    try {
      if (Array.isArray(line?.material)) line.material.forEach(material => material?.dispose?.());
      else line?.material?.dispose?.();
    } catch (_) {}
  }

  function clearActorsDirectly() {
    if (typeof animationAuthor === 'undefined') throw new Error('Animation Author scene state is unavailable.');
    try { animationAuthor.transformControls?.detach?.(); } catch (_) {}
    try {
      if (typeof disposeBatchOffsetProxy === 'function') disposeBatchOffsetProxy();
    } catch (_) {}

    for (const actor of [...(animationAuthor.actors || [])]) {
      try {
        if (typeof actor?.root?.removeFromParent === 'function') actor.root.removeFromParent();
        else actor?.root?.parent?.remove?.(actor.root);
      } catch (_) {}
      try { actor?.neckRig?.skeleton?.dispose?.(); } catch (_) {}
    }
    for (const line of animationAuthor.relationLines?.values?.() || []) disposeRelationLine(line);
    animationAuthor.relationLines?.clear?.();
    animationAuthor.actors = [];
    animationAuthor.selectedActorId = null;
    lastActor = null;

    try {
      if (typeof updateAnimationSelectionBox === 'function') updateAnimationSelectionBox();
    } catch (_) {}
    try {
      if (typeof attachAnimationGizmo === 'function') attachAnimationGizmo();
    } catch (_) {}
  }

  function clearActors() {
    // Resolve the real helper at call time. The comparison bridge can load before
    // later V15.x author patches finish defining/reassigning this lexical function.
    try {
      if (typeof clearAnimationActors === 'function' && clearAnimationActors !== clearActors) {
        const result = clearAnimationActors();
        lastActor = null;
        return result;
      }
    } catch (_) {}
    // There is deliberately no button.click() fallback here. In Rig Coordinates
    // maaNewBtn means "reset every saved attachment coordinate" and must only run
    // from an explicit user press on that editor command.
    return clearActorsDirectly();
  }

  async function setMode(mode) {
    const fn = nativeSetMode();
    if (!fn) throw new Error(`Animation Author mode “${mode}” is unavailable.`);
    return fn.call(publicApi(), mode);
  }

  function serializeRig() {
    try {
      if (typeof serializeAttachmentRigLibrary === 'function' && serializeAttachmentRigLibrary !== serializeRig) {
        return serializeAttachmentRigLibrary();
      }
    } catch (_) {}
    const profiles = publicApi().getAttachmentRigProfiles?.() || window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {};
    return {
      schema: 'hobunji.attachment-rig-profiles.v10',
      exportedAt: new Date().toISOString(),
      profiles: JSON.parse(JSON.stringify(profiles)),
      exportFallback: 'full-character-scale-public-profile-library',
    };
  }

  function frameAll(view) {
    try {
      if (typeof frameAllAnimationActors === 'function' && frameAllAnimationActors !== frameAll) return frameAllAnimationActors(view);
    } catch (_) {}
  }

  function strictAppearance(npc) {
    try {
      if (typeof strictNpcAppearanceV1514 === 'function' && strictNpcAppearanceV1514 !== strictAppearance) return strictNpcAppearanceV1514(npc);
    } catch (_) {}
    return null;
  }

  const host = Object.freeze({
    setMode,
    addNpc,
    selectedActor,
    profileForActor,
    clearActors,
    selectActor,
    serializeRig,
    frameAll,
    strictAppearance,
  });
  window.HobunjiAnimationAuthorHost = host;

  // Backward-compatible names consumed by the existing comparison workspace. All
  // fallbacks are now data/API based; none dispatch synthetic editor-button clicks.
  window.setAnimationAuthorMode = setMode;
  window.addNpcAnimationActor = addNpc;
  window.selectedAnimationActor = selectedActor;
  window.attachmentRigProfileForActor = profileForActor;
  window.clearAnimationActors = clearActors;
  window.selectAnimationActor = selectActor;
  window.serializeAttachmentRigLibrary = serializeRig;
  window.frameAllAnimationActors = frameAll;
  window.strictNpcAppearanceV1514 = strictAppearance;

  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterScaleHostBridge = {
    installed: true,
    publicFallbacksEnabled: true,
    destructiveDomFallbacks: false,
  };

  const tab = document.getElementById('maaFullScaleTab');
  if (tab) {
    tab.disabled = false;
    tab.removeAttribute('disabled');
    tab.title = 'Compare and author full species/gender character scale';
  }
})();
