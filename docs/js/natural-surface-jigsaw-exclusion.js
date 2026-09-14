(() => {
  'use strict';

  const mapper = window.HobunjiSurfaceStretchUV; // Used to tag every successfully recognized natural rock/cliff after its final UV mapping.
  if (!mapper?.installed || mapper.__naturalSurfaceJigsawExclusionInstalled) return;

  const originalRemap = mapper.remapNaturalTerrainMesh; // Used to preserve the furniture-style natural-surface mapper before adding ownership metadata.
  if (typeof originalRemap !== 'function') return;

  mapper.remapNaturalTerrainMesh = function (mesh, label = '') {
    const report = originalRemap.call(this, mesh, label); // Used as the authoritative natural-surface mapping result.
    if (report && mesh?.userData) {
      mesh.userData.terrainJigsawIgnore = true; // Used by TerrainRenderChunks/TerrainJigsawUV to leave finished natural rock/cliff UVs untouched.
      mesh.userData.naturalSurfaceUvOwner = 'HobunjiSurfaceStretchUV'; // Used by diagnostics to make final UV ownership explicit.
    }
    return report;
  };

  mapper.__naturalSurfaceJigsawExclusionInstalled = true;
  window.NaturalSurfaceJigsawExclusion = { installed: true }; // Used by the HousePieces loader to avoid requesting this adapter more than once.
})();