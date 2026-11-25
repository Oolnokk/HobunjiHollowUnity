(() => {
  'use strict';
  // render: classic scripts in their original parser execution order. Add modules here, not in index.html.
  const scriptUrls = [
    "js/npc-view-frustum-cull.js?v=20261110frustumWire1",
    "js/instanced-mesh-view-cull.js?v=20261125sceneRegistry1",
    "js/instanced-brick-lod.js?v=20261125sceneRegistry1", // Render scope: far default-brick meshes draw an octant-hull brick (world-render-pipeline.js).
    "js/grass-billboard-render-chunks.js?v=20261112grasschunk1",
    "js/scissor-depth-snapshot.js?v=20261121hc90e239",
    "js/actor-render-occlusion.js?v=20261114farCull1",
    "js/outline-composite-material.js?v=20261125deepHotpaths1",
    "js/character-visuals.js?v=20261124h21ad2df", // Character enumeration + visual capability table; game.js registers the provider.
    "js/character-held-tools.js?v=20261119charVisuals1", // Held tool/weapon planes for any character; game.js calls init() in its tool section.
    "js/world-render-pipeline.js?v=20261125hierarchyCapture1", // Pass order, outline materials/targets and render scopes; game.js calls init() after its camera exists.
    "js/render-ab-benchmark.js?v=20261125treeMatrix1", // On-device A/B: frame-scoped render hooks on vs off (Settings → Dev Tools).
    "js/shadow-map-refresh-throttle.js?v=20261124localReplay3",
    "js/farm-tile-render-batches.js?v=20261123pr2110rebase1",
    "js/zone-prop-render-batches.js?v=20261125propScope1",
    "js/wilderness-distance-cull.js?v=20261119h89ca824", // Loaded before game.js; scope begins after static prop batching.
    "js/zone-tree-fade.js?v=20261120h87c4a16",
    "js/zone-vegetation-cull.js?v=20261120he8225fb", // Wilderness vegetation corridor cull; game.js calls init() and tick(dt).
    "js/wilderness-tree-instancer.js?v=20261124spatialTrees2", // Render scope: drawn, non-fading procedural trees as InstancedMeshes (world-render-pipeline.js).
    "js/dense-forest-wall-batches.js?v=20261124h78afa15", // Render scope: Cloud Forest dense wall chunk parts merged across chunks (world-render-pipeline.js).
    "js/shoulder-pet-attachment-runtime.js?v=20261122shoulderHeadOnly1", // Shared pin solver, before game.js starts.
    "js/stowed-torch-fire.js?v=20261122stowSplit1", // Shared layer-effects adapter owns stowed PNG, tint, wick and particles.
    "js/adventuring-torch-belt.js?v=20261122stowSplit1", // Stowed belt sprite and 30-second live torch timeout before game.js starts.
    "js/render-optimization-settings.js?v=20261125treeMatrix1" // Settings → Render optimizations: a persisted toggle per render switch; last, after every owner.
]; // Versioned game modules owned by this group.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
