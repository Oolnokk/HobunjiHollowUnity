// Latest explicitly authored creature saddle coordinates from the 2026-10-16
// Animation Author rig export. Keep this pass narrow: only saddle positions that
// changed from the canonical attachment-rig master are overridden here.
(() => {
  'use strict';

  const SOURCE = 'animation-author-export-2026-10-16T22:54:56.556Z'; // Written into saddleRule so diagnostics/export provenance identify this authoring pass.
  const SADDLE_POSITIONS = Object.freeze({ // Applied to the mutable runtime rig library before the latest-authored snapshot imports it into Animation Author.
    drenkirra: Object.freeze({ x: 0, y: 0.030605877381859603, z: 0.02 }),
    grehlr: Object.freeze({ x: 0, y: 0.1224031140623686, z: 0 }),
    'gar-wolf': Object.freeze({ x: 0, y: 0.15973815894365057, z: 0.3293044388176616 }),
    'dabinggi-hound': Object.freeze({ x: 0, y: 0.17901245841201874, z: 0.6091387381509006 }),
    uumkaoii: Object.freeze({ x: 0, y: 0.6408071738820479, z: 0.02 }),
  });
  const debugState = { applied: 0, missing: [], source: SOURCE, latestChange: '2026-10-16 saddle coordinates applied before rig snapshot import' }; // Exposed for mobile diagnostics without requiring console access.

  function copyPosition(position) {
    return { x: Number(position.x) || 0, y: Number(position.y) || 0, z: Number(position.z) || 0 };
  }

  function applyToLibrary(library = window.HOBUNJI_ATTACHMENT_RIG_PROFILES) {
    const creatures = library?.creatures; // Mutable creature profiles consumed by mount runtime and copied by Animation Author's snapshot import.
    if (!creatures) {
      debugState.applied = 0;
      debugState.missing = Object.keys(SADDLE_POSITIONS);
      return 0;
    }

    const missing = []; // Reported through debugState when a stripped/older rig library lacks an authored creature.
    let applied = 0; // Counts successfully updated saddle anchors for diagnostics and tests.
    for (const [kind, position] of Object.entries(SADDLE_POSITIONS)) {
      const profile = creatures[kind]; // Existing profile whose other anchors/scales remain untouched by this narrow authoring pass.
      const saddle = profile?.anchors?.saddle; // Existing saddle transform container; only its position is replaced below.
      if (!profile || !saddle) {
        missing.push(kind);
        continue;
      }
      saddle.position = copyPosition(position);
      profile.saddleRule = {
        ...(profile.saddleRule || {}),
        source: SOURCE,
        authoredFixed: true,
        recalculateOnPreview: false,
      };
      applied += 1;
    }

    debugState.applied = applied;
    debugState.missing = missing;
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS ||= {};
    window.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.creatureSaddleAuthoring = debugSnapshot();
    return applied;
  }

  function debugSnapshot() {
    return { ...debugState, missing: [...debugState.missing] };
  }

  window.HobunjiCreatureSaddleAuthoring = Object.freeze({ // Lets the in-file/mobile diagnostics reapply or inspect this authored pass explicitly.
    SOURCE,
    SADDLE_POSITIONS,
    applyToLibrary,
    getDebug: debugSnapshot,
  });

  applyToLibrary();
})();