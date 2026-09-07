// Gameplay bridge for authored portrait-only X offsets.
//
// PNGPlaneAvatar's constructor does not always receive a usable species/gender
// identity from every game caller. ProceduralHandAttachments.attach does, and
// runs on the same floor-relative character parent that owns the portrait as a
// child. Reapply the authored portrait offset there so live player/NPC rigs use
// the same value as Full Character Scale without moving hands/feet themselves.
(() => {
  'use strict';

  function identityFor(options = {}) {
    const appearance = options.appearance || options.profile?.appearance || options.npcRecord?.appearance || {};
    return {
      species: options.speciesId
        || appearance.speciesId
        || appearance.species
        || options.profile?.speciesId
        || options.profile?.species
        || null,
      gender: options.gender
        || appearance.gender
        || options.profile?.gender
        || 'male',
    };
  }

  function install() {
    const scaleApi = window.HobunjiCharacterRigScale;
    const hands = window.ProceduralHandAttachments;
    if (!scaleApi?.scaleFor || !scaleApi?.applyPortraitXOffset || !hands?.attach) return false;
    if (hands.attach.__hobunjiPortraitXGameplayWrapped) return true;

    const originalAttach = hands.attach.bind(hands);
    const wrapped = function portraitXGameplayHandAttach(THREE, parent, options = {}) {
      const result = originalAttach(THREE, parent, options);
      const identity = identityFor(options);
      if (parent && identity.species) {
        const resolved = scaleApi.scaleFor(identity.species, identity.gender);
        const applied = scaleApi.applyPortraitXOffset(parent, identity.species, identity.gender, resolved);
        parent.userData ||= {};
        parent.userData.hobunjiPortraitXGameplayRuntime = {
          applied: !!applied,
          species: identity.species,
          gender: identity.gender,
          portraitOffsetX: Number(resolved.portraitOffsetX) || 0,
          source: 'ProceduralHandAttachments.attach',
        }; // Mobile-visible proof that gameplay applied the authored portrait-only offset.
      }
      return result;
    };

    Object.assign(wrapped, hands.attach);
    wrapped.__hobunjiPortraitXGameplayWrapped = true;
    hands.attach = wrapped;

    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.fullCharacterPortraitXGameplay = {
      installed: true,
      runtimeHook: 'ProceduralHandAttachments.attach',
      preservesHandParent: true,
    };
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    if (install() || ++attempts >= 600) clearInterval(timer);
  }, 50);
  install();
})();
