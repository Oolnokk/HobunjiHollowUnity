// Loose ore rocks styled like the farm rocks (window.FacetedRocks).
//
// The farm's loose rocks are TerrainGeometry.buildRockTileGeo's low-poly
// mound; the natural-surface pipeline then unwraps it with
// HobunjiSurfaceStretchUV (the cliff stretch): the mound is split into
// surface islands wherever its facets bend, and each island carries the whole
// rock PNG with its drawn border. That gives the irregular inked panels and
// needs no generated shell outline (faceted-natural-surface-shell-reduction.js
// turns the shell off for natural rocks).
//
// Ore rocks (wilderness, town mine) reuse exactly that: the same mound, sent
// through the same NaturalSurfaceMaterials.naturalizeMesh(..., 'rocks') call
// the farm uses (unlit body-sprite tint + stretch unwrap + no shell), tinted
// with the ore's colour instead of the farm's grey. Where that stack is absent
// the ore's metal recolour (OreRockTextures.facetedMaterialFor) is unwrapped
// directly. Either way the stone is kept out of the wilderness chunk's
// terrain jigsaw UV bake (game.js skips userData.facetedRock), which would
// replace the islands.
//
// FacetedRocks.setEnabled(false) / localStorage hobunjiFacetedRocks=off
// restores the older continuous-UV, shell-outlined ore mounds for newly built
// areas.
(() => {
  'use strict';

  if (window.FacetedRocks) return;

  const STORAGE_KEY = 'hobunjiFacetedRocks';
  const SHELL_LAYER = globalThis.HobunjiRenderLayers?.SHELL_OUTLINE ?? 1;
  const stats = { built: 0, natural: 0, stretched: 0, unstretched: 0, islands: 0 };
  let enabled = (() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) { return true; }
  })();

  // Off the generated shell outline; the PNG's drawn border is the outline.
  // Owner of its own UVs so terrain/natural-surface passes leave them alone.
  function styleMesh(mesh) {
    mesh.layers?.disable?.(SHELL_LAYER);
    Object.assign(mesh.userData, {
      facetedRock: true,
      noOutline: true,
      facetedSurfaceTextureOutline: true,
      shellOutlineDisabledReason: 'faceted-rock-png-outline',
      terrainJigsawIgnore: true,
      oreRockSurfaceMapped: true,
    });
    if (!mesh.userData.naturalSurfaceUvOwner) mesh.userData.naturalSurfaceUvOwner = 'FacetedRocks'; // The natural pipeline's own owner (HobunjiSurfaceStretchUV) stays.
    return mesh;
  }

  // The farm rocks' unwrap: one PNG per surface island, border kept.
  function stretchToSurfaces(mesh, label) {
    const mapper = window.HobunjiSurfaceStretchUV;
    if (typeof mapper?.mapMesh !== 'function') { stats.unstretched++; return null; }
    const report = mapper.mapMesh(mesh, { label });
    if (report) { stats.stretched++; stats.islands += Number(report.patchCount) || 0; }
    return report;
  }

  // The farm rocks' surfacing for any hard-edged stone mesh (visual-authoring
  // contract §2): NaturalSurfaceMaterials 'rocks' (its loaded hook unwraps
  // each detected surface into its own inked PNG), or the stretch unwrap
  // directly where that stack is absent; then off the generated shell.
  // tint: the rock colour (null keeps the farm rocks' own grey). Used by ore
  // rocks and by the statue ruin debris (statue-ruin-debris.js).
  function surfaceStone(mesh, { tint = null, label = '' } = {}) {
    const natural = window.NaturalSurfaceMaterials;
    if (typeof natural?.naturalizeMesh === 'function') {
      natural.naturalizeMesh(mesh, 'rocks', null, tint ? { tint } : null);
      stats.natural++;
    }
    if (!mesh.geometry.userData?.hobunjiSurfaceStretch) stretchToSurfaces(mesh, label || mesh.name); // The naturalize hook already unwrapped it when loaded.
    return styleMesh(mesh);
  }

  // One removable ore rock: a group with the mound's stone (stretched ore PNG)
  // and its grass rim, exactly as the farm rock is built.
  // displace(geometry): the zone's ground displacement (game.js
  // displaceZoneGeometry); stone and grass share one position buffer, so it
  // runs once. markGrassEdge(mesh): terrain edge-ID for the grass rim.
  function buildOreRock({ col, row, material, tint = null, grassMaterial = null, displace = null, markGrassEdge = null, name = '' }) {
    const THREE = window.THREE;
    const { stoneGeo, grassGeo, heightTiles } = window.TerrainGeometry.buildRockTileGeo(col, row);
    if (typeof displace === 'function' && (stoneGeo || grassGeo)) displace(stoneGeo || grassGeo);
    const group = new THREE.Group();
    group.name = 'faceted_ore_rock_group';
    let stone = null;
    if (stoneGeo) {
      stoneGeo.computeVertexNormals();
      stone = new THREE.Mesh(stoneGeo, material);
      stone.name = name || 'faceted_ore_rock';
      if (tint) surfaceStone(stone, { tint, label: stone.name }); // The farm rocks' call, in the ore's colour.
      else { stretchToSurfaces(stone, stone.name); styleMesh(stone); } // No tint: keep the ore's metal recolour material, unwrapped.
      stone.castShadow = stone.receiveShadow = true;
      stone.userData.wildernessChunkOwnsGeometry = true;
      group.add(stone);
    }
    if (grassGeo && grassMaterial) {
      grassGeo.computeVertexNormals();
      const grass = new THREE.Mesh(grassGeo, grassMaterial);
      grass.name = (name || 'faceted_ore_rock') + '_grass';
      grass.castShadow = grass.receiveShadow = true;
      grass.userData.wildernessChunkOwnsGeometry = true;
      markGrassEdge?.(grass);
      group.add(grass);
    }
    stats.built++;
    return { group, mesh: stone, heightTiles };
  }

  window.FacetedRocks = Object.freeze({
    STORAGE_KEY,
    enabled: () => enabled,
    setEnabled(value) {
      enabled = value !== false;
      try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (_) {}
      return enabled;
    },
    styleMesh,
    stretchToSurfaces,
    surfaceStone,
    buildOreRock,
    snapshot: () => ({ enabled, ...stats }),
  });
})();
