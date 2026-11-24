(() => {
  'use strict';
  // ruin-puzzles: feature-owned classic scripts in the original parser execution order.
  const scriptUrls = [
    "js/melody-camera-framing.js?v=20261114musicReticleMerge1",
    "js/puzzle-cave-melody.js?v=20261115tierMelody1",
    "js/puzzle-cave-plate-art.js?v=20261110tankanring1",
    "js/ruin-melody-glyph-decal.js?v=20261114ruinCaveParity1",
    "js/ruin-layer-challenges.js?v=20261123h5c3f01e",
    "js/ruin-hidden-secrets.js?v=20261122h5fef1bb",
    "js/ruin-room-system.js?v=20261124kanthicAudit4",
    "js/ruin-layer-playable.js?v=20261124kanthicAudit3",
    "js/ruin-v50-native-mechanisms.js?v=20261122hbc5c6e2",
    "js/ruin-v50-native-floors.js?v=20261116ruinFloorXray2",
    "js/ruin-shaft-connector.js?v=20261122hdc72cb7",
    "js/ruin-v50-vestibule.js?v=20261122hbaa8809",
    "js/ruin-wall-coffins.js?v=20261122h1d3c3ab",
    "js/ruin-multifloor-v50-style.js?v=20261123kanthicTinyTorch1",
    "js/ruin-checkpoint-travel.js?v=20261122hbbb0141"
]; // Versioned modules evaluated before gameplay boot.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // Parser-time writing preserves blocking evaluation and dependencies of the former inline registrations.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
