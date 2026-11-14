(() => {
  'use strict';
  // Pre-game rendering, item presentation, audio and developer services.
  // Keep these classic scripts in their original synchronous parser order; every entry executes before dialogue and game.js.
  // Surface occlusion now owns weapon x-ray startup directly: the HUD/tool icon adapter no longer loads rendering modules.
  const scriptUrls = [
    "js/surface-occlusion-composer.js?v=20261102composer2",
    "js/held-object-render-order.js?v=20261114groundclone3",
    "js/tool-icon-render.js?v=20261114pregameservices1",
    "js/sprite-recolor.js?v=20261114inventoryPerf2",
    "js/object-sprite-catalog.js?v=20261114potionAudit2",
    "js/mount-system.js?v=20261016he27d4d6",
    "js/companion-movement-speed.js?v=20261102ownerpace1",
    "js/audio-system.js?v=20261114melodyTempoPer1",
    "js/honeyfuzzle-audio.js?v=20261026hivebuzz2",
    "js/scratchbones-emoji-reactions.js?v=20261109scaleglow1",
    "js/animal-vocalizations.js?v=20261114naturalBreath1",
    "js/music-system.js?v=20261108shaftfade1",
    "js/audio-track-gain-settings.js?v=20260920trackgain2",
    "js/transform-dump-utils.js?v=20261017h3ce7f8d",
    "js/rig-transform-dump.js?v=20261029rigdump1",
    "js/pixel-probe.js?v=20261114h3619c93"
  ]; // Independent cache versions live here, not in index.html.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
