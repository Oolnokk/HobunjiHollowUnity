// Per-map terrain tile texture overrides (docs/config/maps/terrain-materials.json,
// the Map Editor's Materials tab) — resolveTileMat/resolveCliffMat, extracted
// out of game.js. Everything here is a thin, cached layer on top of the
// shared tileMats/TILE_EMISSIVE_FLOOR/terrain-materials-config state that
// still lives in game.js (genuinely shared with unrelated code there), fed
// in once via init(deps). THREE is used as the ambient global every other
// docs/js/*.js module already relies on, same as border-terrain.js (this
// module's main consumer via deps.resolveTileMat/deps.resolveCliffMat).
(() => {
  'use strict';

  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // Loads a docs/assets/textures/*.png as a tiling MeshLambertMaterial for
  // ground/cliff meshes — same emissive-floor treatment as game.js's floorMat
  // (TILE_EMISSIVE_FLOOR) so a textured tile doesn't read as a solid black
  // blob at night/in storms the way an untreated MeshLambertMaterial would.
  // Unlike loadHousePieceFaceTexture (which bakes its tile size into each
  // face's own UV, since a furniture part's geometry is built once for one
  // fixed material), ground meshes get their UV for free from
  // _mergeTileGeos/the world-space UV added to each standalone heightfield
  // builder — plain world-unit (X,Z) coordinates — so tileSize here just
  // scales texture.repeat instead; that also means the exact same merged
  // geometry keeps working if the override's tileSize is ever changed, no
  // geometry rebuild required.
  // fillColor, when given, recolors the PNG's visible pixels to that target
  // hex using the same adaptive luminance-preserving shade fill as
  // portrait/creature tinting (getShadeFillCanvas in portrait-utils.js,
  // loaded before this file) — keeps the texture's own shading/grain instead
  // of showing the raw PNG albedo untouched.
  // stretch, when given as [worldWidth, worldHeight], fits the whole PNG once
  // across that world-unit span instead of tiling it (the preview tool's
  // "stretch to bounds" mode) — since this ground UV is already raw world
  // (X,Z) in 1-unit-per-tile units, that span is simply the map's own tile
  // footprint, so this is just a texture.repeat change, no geometry/UV
  // rebuild needed. Overrides tileSize when present.
  // unlit, when true, builds a MeshBasicMaterial instead of the usual lit
  // MeshLambertMaterial — used for grass so its textured ground override
  // reads at one consistent brightness like the base tileMats.grass does,
  // instead of dimming at night/in storms.
  function loadTerrainTileTexture(path, fallbackColor, tileSize, fillColor, stretch, unlit) {
    const col = fallbackColor instanceof THREE.Color ? fallbackColor : new THREE.Color(fallbackColor);
    const mat = unlit
      ? new THREE.MeshBasicMaterial({ color: col })
      : new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(deps.TILE_EMISSIVE_FLOOR) });
    new THREE.TextureLoader().load(path, (tex) => {
      let finalTex = tex;
      const rgb = fillColor && parseHexColor(fillColor);
      if (rgb) {
        const canvas = getShadeFillCanvas(tex.image, path + '|' + fillColor, {
          mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: getPortraitTintingConfig(),
        });
        finalTex = new THREE.CanvasTexture(canvas);
      }
      finalTex.wrapS = finalTex.wrapT = THREE.RepeatWrapping;
      if (Array.isArray(stretch) && stretch.length === 2) {
        finalTex.repeat.set(1 / Math.max(0.05, stretch[0]), 1 / Math.max(0.05, stretch[1]));
      } else {
        const ts = Math.max(0.05, tileSize || 1);
        finalTex.repeat.set(1 / ts, 1 / ts);
      }
      mat.map = finalTex; mat.color.set(0xffffff); mat.needsUpdate = true;
    }, undefined, () => {});
    return mat;
  }

  const _mapTileMatCache = new Map(); // "mapId,tileMatsKey" -> THREE.Material
  window.HobunjiCacheAudit?.register('game.mapTileMatCache', () => _mapTileMatCache.size);
  function resolveTileMat(mapId, matKey) {
    const tileMats = deps.tileMats;
    const base = tileMats[matKey] || tileMats.grass;
    // '*' is a wildcard entry — applies to any map with no entry of its own
    // (every wilderness zone, without having to list each zone's mapId),
    // overridden by a map-specific entry (town/farm) when one exists.
    const config = deps.getTerrainMaterialConfig();
    const override = config.byMap?.[mapId]?.[matKey] || config.byMap?.['*']?.[matKey];
    if (!override?.texture) return base;
    const cacheKey = mapId + ',' + matKey;
    let mat = _mapTileMatCache.get(cacheKey);
    if (!mat) {
      mat = loadTerrainTileTexture('assets/textures/' + override.texture, base.color.getHex(), override.tileSize, override.fillColor, override.stretch, matKey === deps.TileType.GRASS);
      _mapTileMatCache.set(cacheKey, mat);
    }
    return mat;
  }

  // Steep-cliff "stone skin" overlay material — same role as tileMats.rock
  // but for the standalone heightfield cliff-face meshes (plateau mesas,
  // farm/town border terrain — see buildZoneBorderTerrain/buildBorderTerrain/
  // buildTownBorderTerrain), which never went through tileMats at all
  // before this. Overridden via the 'cliff' key in terrain-materials.json,
  // independent of 'rock' so a map can texture ore-bearing rock tiles
  // differently from its distant cliff faces.
  const _defaultCliffMat = new THREE.MeshLambertMaterial({
    color: 0x6a6460, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const _mapCliffMatCache = new Map(); // mapId -> THREE.Material
  window.HobunjiCacheAudit?.register('game.mapCliffMatCache', () => _mapCliffMatCache.size);
  function resolveCliffMat(mapId) {
    const config = deps.getTerrainMaterialConfig();
    const override = config.byMap?.[mapId]?.cliff || config.byMap?.['*']?.cliff;
    if (!override?.texture) return _defaultCliffMat;
    let mat = _mapCliffMatCache.get(mapId);
    if (!mat) {
      mat = loadTerrainTileTexture('assets/textures/' + override.texture, _defaultCliffMat.color.getHex(), override.tileSize, override.fillColor, override.stretch);
      mat.side = THREE.DoubleSide;
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      _mapCliffMatCache.set(mapId, mat);
    }
    return mat;
  }

  window.TerrainTileMaterials = {
    init,
    loadTerrainTileTexture,
    resolveTileMat,
    resolveCliffMat,
  };
})();
