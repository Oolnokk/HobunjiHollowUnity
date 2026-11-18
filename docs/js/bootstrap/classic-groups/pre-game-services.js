(() => {
  'use strict';
  // Mounts, companion movement, sound effects and music (AudioSystem before its consumers).
  const scriptUrls = [
    "js/mount-system.js?v=20261118playerRunBase1",
    "js/companion-movement-speed.js?v=20261118liveAlchemy1",
    "js/audio-system.js?v=20261115exertionVoiceGateReview3",
    "js/honeyfuzzle-audio.js?v=20261114queenPerf1",
    "js/scratchbones-emoji-reactions.js?v=20261117emojiHeadSide1",
    "js/animal-vocalizations.js?v=20261117emojiHeadSide1",
    "js/music-system.js?v=20261108shaftfade1",
    "js/audio-track-gain-settings.js?v=20260920trackgain2"
  ]; // Cache versions are owned by this feature area, rather than the shared index page.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
