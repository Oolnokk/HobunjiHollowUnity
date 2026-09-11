// Force every character profile's arm-length offset to the neutral baseline.
// Loaded after the historical authored rig snapshots so stale exported offsets
// cannot reintroduce species-specific hand lengthening during bootstrap.
(() => {
  'use strict';

  const VERSION = 'character-arm-length-zero-2026-09-07-v1'; // Exposed below for mobile/runtime diagnostics.

  function applyToLibrary(library = window.HOBUNJI_ATTACHMENT_RIG_PROFILES) {
    const characters = library?.characters;
    if (!characters) return false;

    let applied = 0; // Reported below so diagnostics can verify every loaded character profile was normalized.
    for (const profile of Object.values(characters)) {
      if (!profile) continue;
      profile.anatomy ||= {};
      profile.anatomy.armLengthHeightPercentOffset = 0;
      applied += 1;
    }

    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.armLengthZero = `${VERSION}:${applied}`;
    return applied > 0;
  }

  window.HobunjiCharacterArmLengthZero = Object.freeze({ version: VERSION, applyToLibrary });

  applyToLibrary();
  let attempts = 0; // Runs longer than the older 600/620-tick snapshot retries so zero is always the final bootstrap value.
  const timer = setInterval(() => {
    applyToLibrary();
    if (++attempts >= 640) clearInterval(timer);
  }, 50);
})();
