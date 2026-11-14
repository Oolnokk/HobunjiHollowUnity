(() => {
  'use strict';
  // ruin-puzzles: feature-owned classic scripts in the original parser execution order.
  const scriptUrls = [
    "js/melody-camera-framing.js?v=20261114musicReticleMerge1",
    "js/puzzle-cave-melody.js?v=20261114melodyTempoPer1",
    "js/puzzle-cave-plate-art.js?v=20261110tankanring1",
    "js/ruin-melody-glyph-decal.js?v=20261108cliffWhiteYellowGlowPick3",
    "js/ruin-layer-challenges.js?v=20261114melodyTempoPer1",
    "js/ruin-layer-playable.js?v=20261110h8b3a4fc",
    "js/ruin-v50-native-mechanisms.js?v=20261107wingDoorSoftlock2",
    "js/ruin-v50-native-floors.js?v=20261110h0efff27",
    "js/ruin-shaft-connector.js?v=20261110hcf0f1b0",
    "js/ruin-v50-vestibule.js?v=20261108h61ad699",
    "js/ruin-wall-coffins.js?v=20261108coffin1",
    "js/ruin-multifloor-v50-style.js?v=20261109ruinTravel1",
    "js/ruin-checkpoint-travel.js?v=20261109ropeCheckpoint1"
]; // Versioned modules evaluated before gameplay boot.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // Parser-time writing preserves blocking evaluation and dependencies of the former inline registrations.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
