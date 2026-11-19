(() => {
  'use strict';
  // render: classic scripts in their original parser execution order. Add modules here, not in index.html.
  const scriptUrls = [
    "js/npc-view-frustum-cull.js?v=20261110frustumWire1",
    "js/instanced-mesh-view-cull.js?v=20261114farCullReview2",
    "js/grass-billboard-render-chunks.js?v=20261112grasschunk1",
    "js/scissor-depth-snapshot.js?v=20261112depthsnap1",
    "js/actor-render-occlusion.js?v=20261114farCull1",
    "js/outline-composite-material.js?v=20261114composite1",
    "js/world-render-pipeline.js?v=20261119visualCore1", // Pass order, outline materials/targets and render scopes; game.js calls init() after its camera exists.
    "js/shadow-map-refresh-throttle.js?v=20261114shadowThrottle1",
    "js/farm-tile-render-batches.js?v=20261119h71de730",
    "js/zone-prop-render-batches.js?v=20261119hsettledEligibility2",
    "js/wilderness-distance-cull.js?v=20261119h89ca824", // Loaded before game.js; scope begins after static prop batching.
    "js/zone-tree-fade.js?v=20261118h9d25902",
    "js/zone-vegetation-cull.js?v=20261119visualCore1", // Wilderness vegetation corridor cull; game.js calls init() and tick(dt).
    "js/shoulder-pet-attachment-runtime.js?v=20261119h14f115f", // Shared pin solver, before game.js starts.
    "js/adventuring-torch-belt.js?v=20261118beltTrueSize4" // Stowed belt sprite and 30-second live torch timeout before game.js starts.
]; // Versioned game modules owned by this group.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
