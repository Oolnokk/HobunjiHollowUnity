(() => {
  'use strict';
  // Mounts, companion movement, sound effects and music (AudioSystem before its consumers).
  const scriptUrls = [
    "js/mount-system.js?v=20261016he27d4d6",
    "js/companion-movement-speed.js?v=20261102ownerpace1",
    "js/audio-system.js?v=20261114melodyTempoPer1",
    "js/honeyfuzzle-audio.js?v=20261026hivebuzz2",
    "js/scratchbones-emoji-reactions.js?v=20261109scaleglow1",
    "js/animal-vocalizations.js?v=20261114naturalBreath1",
    "js/music-system.js?v=20261108shaftfade1",
    "js/audio-track-gain-settings.js?v=20260920trackgain2"
  ]; // Cache versions are owned by this feature area, rather than the shared index page.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
