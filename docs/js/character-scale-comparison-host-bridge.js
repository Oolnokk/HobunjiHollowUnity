// Bridge Animation Author internals to the separately loaded Full Character Scale
// workspace. Missing optional internals must never disable the mode: the author has
// a stable public MultiAvatarAnimationAuthor API that is used as the fallback.
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

  // Capture the lexical helpers before assigning any compatibility properties on
  // window. Some author revisions expose these as window properties already and
  // some only as classic-script global lexical bindings.
  const lexical = {
    setMode: typeof setAnimationAuthorMode === 'function' ? setAnimationAuthorMode : null,
    addNpc: typeof addNpcAnimationActor === 'function' ? addNpcAnimationActor : null,
    selectedActor: typeof selectedAnimationActor === 'function' ? selectedAnimationActor : null,
    profileForActor: typeof attachmentRigProfileForActor === 'function' ? attachmentRigProfileForActor : null,
    clearActors: typeof clearAnimationActors === 'function' ? clearAnimationActors : null,
    selectActor: typeof selectAnimationActor === 'function' ? selectAnimationActor : null,
    serializeRig: typeof serializeAttachmentRigLibrary === 'function' ? serializeAttachmentRigLibrary : null,
    frameAll: typeof frameAllAnimationActors === 'function' ? frameAllAnimationActors : null,
    strictAppearance: typeof strictNpcAppearanceV1514 === 'function' ? strictNpcAppearanceV1514 : null,
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

  async function addNpc(id, options) {
    const fn = lexical.addNpc || publicApi().addNpc;
    if (typeof fn !== 'function') throw new Error('Animation Author NPC preview API is unavailable.');
    const actor = await fn(id, options);
    if (actor) lastActor = actor;
    else lastActor = actorFromAuthorState();
    return actor || lastActor;
  }

  function selectedActor() {
    return lexical.selectedActor?.() || actorFromAuthorState();
  }

  function selectActor(id) {
    const fn = lexical.selectActor || publicApi().selectActor;
    if (typeof fn !== 'function') throw new Error('Animation Author selection API is unavailable.');
    const result = fn(id);
    lastActor = actorFromAuthorState() || lastActor;
    return result;
  }

  function profileForActor(actor) {
    return lexical.profileForActor?.(actor) || profileForActorFallback(actor);
  }

  function clearActors() {
    if (lexical.clearActors) return lexical.clearActors();
    // The New button is wired to the author's own cleanup path. Using it as the
    // fallback is safer than duplicating disposal of skinned portraits, feet,
    // hands, selection helpers and relationship lines here.
    const button = document.getElementById('maaNewBtn');
    if (!button) throw new Error('Animation Author clear-scene API is unavailable.');
    button.click();
    lastActor = null;
  }

  async function setMode(mode) {
    if (lexical.setMode) return lexical.setMode(mode);
    // Usually unreachable on current builds, but keep a public-DOM fallback for
    // revisions where the lexical mode helper is not exported. The comparison
    // workspace has not entered its synthetic mode yet when this is used.
    const id = { multi: 'maaMultiTab', single: 'maaSingleTab', rig: 'maaRigTab' }[mode];
    const tab = id ? document.getElementById(id) : null;
    if (!tab) throw new Error(`Animation Author mode “${mode}” is unavailable.`);
    tab.click();
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  function serializeRig() {
    if (lexical.serializeRig) return lexical.serializeRig();
    return {
      schema: 'hobunji.attachment-rig-profiles.v10',
      exportedAt: new Date().toISOString(),
      profiles: JSON.parse(JSON.stringify(window.HOBUNJI_ATTACHMENT_RIG_PROFILES || {})),
      exportFallback: 'full-character-scale-public-profile-library',
    };
  }

  function frameAll(view) {
    return lexical.frameAll?.(view);
  }

  function strictAppearance(npc) {
    if (lexical.strictAppearance) return lexical.strictAppearance(npc);
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
    lexicalAvailability: Object.freeze(Object.fromEntries(Object.entries(lexical).map(([name, fn]) => [name, typeof fn === 'function']))),
  });
  window.HobunjiAnimationAuthorHost = host;

  // Backward-compatible names consumed by the first version of the comparison
  // workspace. They now always have a usable implementation instead of gating the
  // tab on every internal function being reflected on window.
  window.setAnimationAuthorMode = setMode;
  window.addNpcAnimationActor = addNpc;
  window.selectedAnimationActor = selectedActor;
  window.attachmentRigProfileForActor = profileForActor;
  window.clearAnimationActors = clearActors;
  window.selectAnimationActor = selectActor;
  window.serializeAttachmentRigLibrary = serializeRig;
  if (lexical.frameAll) window.frameAllAnimationActors = frameAll;
  if (lexical.strictAppearance) window.strictNpcAppearanceV1514 = strictAppearance;

  const missingLexical = Object.entries(lexical).filter(([, fn]) => typeof fn !== 'function').map(([name]) => name);
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
  window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterScaleHostBridge = {
    installed: true,
    publicFallbacksEnabled: true,
    missingLexical,
  };

  // Never gray out the comparison mode because an optional internal helper is not
  // reflected globally. Entry itself reports a useful error if a genuinely required
  // public capability is absent.
  const tab = document.getElementById('maaFullScaleTab');
  if (tab) {
    tab.disabled = false;
    tab.removeAttribute('disabled');
    tab.title = missingLexical.length
      ? `Full character scale · public fallbacks active (${missingLexical.join(', ')})`
      : 'Compare and author full species/gender character scale';
  }
})();