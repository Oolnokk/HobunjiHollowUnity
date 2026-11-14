(() => {
  'use strict';
  // dialogue: feature-owned classic scripts in the original parser execution order.
  const scriptUrls = [
    "js/cinematic-camera-runtime.js?v=20261026hmaskalpha11",
    "js/camera-tile-collision.js?v=20261023camtile1",
    "js/camera-occlusion-chunks.js?v=20261101h7a6e930",
    "js/dialogue-camera-framing.js?v=20261002hba1474a",
    "js/dialogue-templates.js?v=20260929mastery1",
    "js/dialogue-rich-text.js?v=20260929colors1",
    "js/character-voice-owner.js?v=20261027releaseOverlap1",
    "js/dialogue-content.js?v=20261109nicknameAudit1"
]; // Versioned modules evaluated before gameplay boot.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // Parser-time writing preserves blocking evaluation and dependencies of the former inline registrations.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
