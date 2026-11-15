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
    "js/shadow-map-refresh-throttle.js?v=20261114shadowThrottle1",
    "js/farm-tile-render-batches.js?v=20261114farmBatch1"
]; // Versioned game modules owned by this group.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
