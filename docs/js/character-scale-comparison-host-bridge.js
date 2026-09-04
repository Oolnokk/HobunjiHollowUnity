// Dedicated host API for the Animation Author's Full Character Scale workspace.
//
// This script deliberately does NOT replace Animation Author globals. Earlier
// revisions did that for compatibility, which made the comparison workspace's
// wrappers become the editor functions they were trying to call and created a
// load-order/recursion trap. The comparison now talks through this one host only.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;

  const publicApi = () => window.MultiAvatarAnimationAuthor || {}; // Used for the editor's intentionally public mode/add/select operations.
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

  let lastActor = null; // Used only as a selection fallback when an editor operation does not return its actor.

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

  async function setMode(mode) {
    const api = publicApi(); // Used here so the host always calls the editor's original public function reference.
    if (typeof api.setMode === 'function') return api.setMode(mode);
    try {
      if (typeof setAnimationAuthorMode === 'function') return setAnimationAuthorMode(mode);
    } catch (_) {}
    throw new Error(`Animation Author mode “${mode}” is unavailable.`);
  }

  async function addNpc(id, options) {
    const api = publicApi(); // Used here so no feature bridge can accidentally become the NPC-creation implementation.
    let result = null;
    if (typeof api.addNpc === 'function') result = await api.addNpc(id, options);
    else {
      try {
        if (typeof addNpcAnimationActor === 'function') result = await addNpcAnimationActor(id, options);
        else throw new Error('Animation Author NPC preview API is unavailable.');
      } catch (error) {
        throw error;
      }
    }
    lastActor = result || actorFromAuthorState();
    return lastActor;
  }

  function selectedActor() {
    try {
      if (typeof selectedAnimationActor === 'function') return selectedAnimationActor() || actorFromAuthorState();
    } catch (_) {}
    return actorFromAuthorState();
  }

  function selectActor(id) {
    const api = publicApi(); // Used to keep selection on the editor's supported public route when available.
    let result;
    if (typeof api.selectActor === 'function') result = api.selectActor(id);
    else {
      try {
        if (typeof selectAnimationActor === 'function') result = selectAnimationActor(id);
        else throw new Error('Animation Author selection API is unavailable.');
      } catch (error) {
        throw error;
      }
    }
    lastActor = actorFromAuthorState() || lastActor;
    return result;
  }

  function profileForActor(actor) {
    try {
      if (typeof attachmentRigProfileForActor === 'function') return attachmentRigProfileForActor(actor) || profileForActorFallback(actor);
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

    try { if (typeof updateAnimationSelectionBox === 'function') updateAnimationSelectionBox(); } catch (_) {}
    try { if (typeof attachAnimationGizmo === 'function') attachAnimationGizmo(); } catch (_) {}
  }

  function clearActors() {
    try {
      if (typeof clearAnimationActors === 'function') {
        const result = clearAnimationActors();
        lastActor = null;
        return result;
      }
    } catch (_) {}
    // Never synthesize a click on maaNewBtn: in Rig Coordinates that command is a
    // destructive attachment-library reset, not a harmless scene clear.
    return clearActorsDirectly();
  }

  function serializeRig() {
    try {
      if (typeof serializeAttachmentRigLibrary === 'function') return serializeAttachmentRigLibrary();
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
      if (typeof frameAllAnimationActors === 'function') return frameAllAnimationActors(view);
    } catch (_) {}
    return undefined;
  }

  function strictAppearance(npc) {
    try {
      if (typeof strictNpcAppearanceV1514 === 'function') return strictNpcAppearanceV1514(npc);
    } catch (_) {}
    return null;
  }

  function diagnostics() {
    const api = publicApi(); // Used to surface mobile-visible readiness information in the comparison workspace.
    return {
      publicApi: !!window.MultiAvatarAnimationAuthor,
      setMode: typeof api.setMode === 'function' || typeof window.setAnimationAuthorMode === 'function',
      addNpc: typeof api.addNpc === 'function' || typeof window.addNpcAnimationActor === 'function',
      selectActor: typeof api.selectActor === 'function' || typeof window.selectAnimationActor === 'function',
      selectedActor: typeof window.selectedAnimationActor === 'function' || typeof animationAuthor !== 'undefined',
      profileForActor: typeof window.attachmentRigProfileForActor === 'function' || !!window.HOBUNJI_ATTACHMENT_RIG_PROFILES,
      clearActors: typeof window.clearAnimationActors === 'function' || typeof animationAuthor !== 'undefined',
      frameAll: typeof window.frameAllAnimationActors === 'function',
    };
  }

  const host = Object.freeze({ // Used exclusively by Full Character Scale and its camera helper.
    setMode,
    addNpc,
    selectedActor,
    profileForActor,
    clearActors,
    selectActor,
    serializeRig,
    frameAll,
    strictAppearance,
    diagnostics,
  });
  window.HobunjiAnimationAuthorScaleHost = host;
  window.HobunjiAnimationAuthorHost = host; // Compatibility alias for any already-cached comparison script; core editor globals remain untouched.

  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterScaleHostBridge = {
    installed: true,
    dedicatedHostApi: true,
    editorGlobalsOverridden: false,
    destructiveDomFallbacks: false,
  };
})();
