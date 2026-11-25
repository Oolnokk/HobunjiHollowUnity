(() => {
  'use strict';
  // Wilderness cave sites, cliff-mounted puzzle cave entrances and cave traps: classic scripts in their
  // original parser execution order. Add modules and bump their cache tokens here, not in index.html, so
  // unrelated PRs stop colliding on the shared page. Notes carried over from index.html:
  // Promotes wilderness den anchors into generic cave sites; wraps WildlifeSpawn/CavernGenerator/DevSpawner, all loaded above.
  // Mount editor-authored furniture on the resolved procedural wall normal and elevation.
  // Real mini-cliff cliffDoor placement, exterior timed plate, and authoritative gated transition.
  // Wall-spanning hidden-cache strings and suspended Shattercasks; runtime physics bind once HangingRopes loads.
  const scriptUrls = [
    "js/locale-cave-runtime.js?v=20261010h40fea5e",
    "js/locale-cliff-wall-mounts.js?v=20261105cliffPortal1",
    "js/puzzle-cave-entrances.js?v=20261122h943ee34",
    "js/cave-tripwire-traps.js?v=20261110tripwire2",
    "js/cave-site-system.js?v=20261125catacombRise1"
  ]; // Versioned game modules owned by this group.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
