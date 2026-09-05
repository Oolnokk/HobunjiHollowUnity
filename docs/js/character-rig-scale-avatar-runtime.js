// Runtime bridge for authored character head scale / head Y offset.
//
// Whole-character body X/Y scaling is applied later on the floor-relative
// character parent by character-rig-scale.js's ProceduralHandAttachments hook.
// Head compensation cannot safely depend on that later attachment chain: the
// avatar's neck/head-scale bones already exist as soon as
// PNGPlaneAvatar.buildSinglePlaneAvatarModel() returns, so apply the canonical
// species/gender head transform there immediately. Reapplying later is safe;
// character-rig-scale.js keeps the head offset relative to its authored base.
(() => {
  'use strict';

  function identityFor(options = {}) {
    const appearance = options.appearance
      || options.profile?.appearance
      || options.profile?.fighter
      || options.npcRecord?.appearance
      || {}; // Used below to resolve the runtime character's species/gender without coupling to one caller's profile shape.
    return {
      speciesId: options.speciesId
        || appearance.speciesId
        || appearance.species
        || options.profile?.speciesId
        || options.profile?.species
        || null,
      gender: options.gender
        || appearance.gender
        || options.profile?.gender
        || 'male',
      age: options.age
        ?? options.profile?.age
        ?? options.npcRecord?.age
        ?? 0,
    };
  }

  function installAvatarHeadRuntime() {
    const scaleApi = window.HobunjiCharacterRigScale; // Shared scale API used to resolve canonical x/y/head/offset values and drive the neck rig.
    const avatarApi = window.PNGPlaneAvatar; // Shared PNG-plane constructor used by the player and ordinary humanoid NPC walkers.
    if (!scaleApi?.applyHeadCompensation || !scaleApi?.scaleFor || !avatarApi?.buildSinglePlaneAvatarModel) return false;

    const currentBuild = avatarApi.buildSinglePlaneAvatarModel; // Preserves whichever wrappers were installed before this bridge.
    if (currentBuild.__hobunjiCharacterRigScaleAvatarHeadWrapped) return true;

    const wrappedBuild = function characterRigScaleAvatarHeadBuild(THREE, sourceCanvas, options = {}) {
      const root = currentBuild.apply(this, arguments);
      if (!root) return root;

      const identity = identityFor(options); // Resolved once per avatar so diagnostics and application use the same identity.
      if (!identity.speciesId) return root;

      const resolved = scaleApi.scaleFor(identity.speciesId, identity.gender); // Canonical authored tuple; body x/y are used to counter-compensate the head before the parent scale lands later.
      const applied = scaleApi.applyHeadCompensation(
        root,
        identity.speciesId,
        identity.gender,
        resolved,
        identity.age,
      );

      root.userData ||= {};
      root.userData.hobunjiCharacterRigHeadRuntime = {
        applied: !!applied,
        species: identity.speciesId,
        gender: identity.gender,
        headScale: resolved.head,
        headOffsetY: resolved.offsetY,
        bodyScaleX: resolved.x,
        bodyScaleY: resolved.y,
        source: 'PNGPlaneAvatar.buildSinglePlaneAvatarModel',
      }; // Mobile-friendly in-object diagnostic proving whether this avatar received the runtime head transform.
      return root;
    };

    Object.assign(wrappedBuild, currentBuild);
    wrappedBuild.__hobunjiCharacterRigScaleAvatarHeadWrapped = true;
    avatarApi.buildSinglePlaneAvatarModel = wrappedBuild;

    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.characterRigHeadRuntimeHook = 'PNGPlaneAvatar.buildSinglePlaneAvatarModel';
    return true;
  }

  let attempts = 0; // Bounds the late-load retry loop so a genuinely missing dependency cannot poll forever.
  let timer = null; // Holds the retry interval so it can be cleared as soon as the shared avatar/scale APIs exist.
  timer = setInterval(() => {
    if (installAvatarHeadRuntime() || ++attempts >= 600) clearInterval(timer);
  }, 50);
  installAvatarHeadRuntime();
})();
