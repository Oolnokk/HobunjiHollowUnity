(() => {
  'use strict';
  // Rig inspection utilities followed by mobile-friendly Pixel Probe diagnostics.
  const scriptUrls = [
    "js/transform-dump-utils.js?v=20261017h3ce7f8d",
    "js/rig-transform-dump.js?v=20261029rigdump1",
    "js/scene-load-summary.js?v=20261126sceneLoad2", // On-demand hostile/companion counts for comparable probe reports.
    "js/probe-performance-capture.js?v=20261126sceneLoad2", // Bounded, opt-in timing window, before Pixel Probe.
    "js/pixel-probe.js?v=20261126h22ebba6"
  ]; // Cache versions are owned by this feature area, rather than the shared index page.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
