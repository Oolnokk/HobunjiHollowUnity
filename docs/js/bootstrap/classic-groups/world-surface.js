(() => {
  'use strict';
  // Terrain geometry, grass/crop rendering and active-area accessors extracted from game.js: classic
  // scripts in their original parser execution order. Add modules and bump their cache tokens here, not
  // in index.html, so unrelated PRs stop colliding on the shared page. Notes carried over from
  // index.html:
  // Terrain/path tile geometry builders, extracted out of game.js. Must
  // load before game.js, which calls window.TerrainGeometry.init(...)
  // partway through its own setup (after camTargetX/pathWallBuilder/
  // VEG_CULL_* are declared, well before the first real terrain mesh
  // build).
  // Farm/town grass & weed billboards, crop growth meshes, and per-tile
  // ground+vegetation mesh building, extracted out of game.js. Must load
  // before game.js, which calls window.VegetationCropRendering.init(...)
  // immediately before the farm's very first buildTileMeshes() call (same
  // forward-reference-safe ordering as WaterSystem/FarmEditor above) —
  // several other already-extracted modules (BorderTerrain,
  // ZoneGrassBillboards, ReagentPlants, WildBerries, WildTreasure) also
  // read its exported mbRng/grassBladeGeo/getGrassBillboardMat helpers
  // from their own init() calls further down game.js.
  // Active-area grid/scene/dimension accessors and building/den footprint
  // collision checks, extracted out of game.js. Must load before game.js,
  // which calls window.GridTileAccessors.init(...) alongside the other
  // window.*.init(...) calls — dozens of already-extracted modules also
  // read getActiveGrid/getActiveScene/etc. from their own init() calls
  // throughout game.js.
  const scriptUrls = [
    "js/terrain-geometry.js?v=20261114waterBrick1",
    "js/vegetation-crop-rendering.js?v=20261124traceHotpaths2",
    "js/grid-tile-accessors.js?v=20261121h742daef"
  ]; // Versioned game modules owned by this group.
  if (document.readyState !== 'loading') throw new Error('Classic script group must run during parsing');
  // A single write guarantees blocking, ordered execution before the next source index.html tag.
  document.write(scriptUrls.map(src => '<script src="' + src.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"><\/script>').join('\n'));
})();
