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
  function init(injectedDeps) {
    deps = injectedDeps;
    // The native (pre-override) tile materials are shared between all maps as
    // well. Preserve them during zone eviction even if the async config has
    // not installed its textured replacement yet.
    for (const material of Object.values(deps?.tileMats || {})) {
      if (material) _cachedTerrainMaterials.add(material);
    }
  }

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
  const _sharedTerrainTextures = new Map(); // One decoded/shade-filled GPU texture per unique source, fill and sampler; shared by different map/material buckets.
  const _cachedTerrainMaterials = new WeakSet(); // Protects persistent map-specific terrain materials from transient zone scene eviction.
  const _pooledTerrainTextures = new WeakSet(); // Protects shared PNG textures from disposal by unrelated temporary material clones.
  let _textureReuseHits = 0; // Reported by debugSnapshot() for mobile texture reuse verification.
  let _textureDecodeStarts = 0; // Counts source PNG loads started, rather than how many per-zone materials request them.

  function sharedTextureKey(path, tileSize, fillColor, stretch) {
    // The repeat transform lives on the Texture, not the Material: unlike
    // colors, different repeat/stretch settings cannot safely share a sampler.
    const span = Array.isArray(stretch) && stretch.length === 2
      ? [Math.max(0.05, Number(stretch[0]) || 0.05), Math.max(0.05, Number(stretch[1]) || 0.05)]
      : null; // Used to separate stretched textures from normal tile-repeat textures.
    const repeat = span || Math.max(0.05, Number(tileSize) || 1); // Used in the key and the real sampler.
    return JSON.stringify([path, String(fillColor || '').toLowerCase(), span ? 'stretch' : 'repeat', repeat]);
  }

  function applyReadyTerrainTexture(material, entry) {
    material.map = entry.texture; // Every consumer reuses one immutable sampler and GPU upload.
    material.color.set(0xffffff);
    material.needsUpdate = true;
    material.userData.hobunjiTerrainTextureStatus = 'ready';
    window.SeasonalVegetationTint?.tintMaterial?.(material); // Shared-cache hits must receive the same immediate seasonal tint as new PNG loads.
  }

  function getSharedTerrainTexture(path, tileSize, fillColor, stretch) {
    const key = sharedTextureKey(path, tileSize, fillColor, stretch); // Distinguishes actual PNG pixels and UV sampling behavior.
    let entry = _sharedTerrainTextures.get(key); // Avoids duplicate loads while a previous request is still pending.
    if (entry) {
      _textureReuseHits++;
      return entry;
    }
    entry = { status: 'loading', texture: null, materials: [] }; // Holds only pending consumers; released immediately when the async load resolves.
    _sharedTerrainTextures.set(key, entry);
    _textureDecodeStarts++;
    const complete = () => { // Applies a single decoded source to all waiting per-map materials.
      const waiting = entry.materials;
      entry.materials = [];
      for (const mat of waiting) {
        if (entry.status === 'ready') applyReadyTerrainTexture(mat, entry);
        else mat.userData.hobunjiTerrainTextureStatus = 'failed';
      }
    };
    try {
      new THREE.TextureLoader().load(path, tex => {
        let finalTex = tex;
        const rgb = fillColor && parseHexColor(fillColor);
        if (rgb) {
          try {
            const canvas = getShadeFillCanvas(tex.image, path + '|' + fillColor, {
              mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: getPortraitTintingConfig(),
            });
            finalTex = new THREE.CanvasTexture(canvas);
            if (finalTex !== tex) tex.dispose?.(); // Once the shade-filled GPU texture is ready, the original upload is unused.
          } catch (error) {
            console.warn('[terrain] PNG shade-fill failed; using original texture:', path, error);
          }
        }
        finalTex.wrapS = finalTex.wrapT = THREE.RepeatWrapping;
        if (Array.isArray(stretch) && stretch.length === 2) {
          finalTex.repeat.set(1 / Math.max(0.05, stretch[0]), 1 / Math.max(0.05, stretch[1]));
        } else {
          finalTex.repeat.set(1 / Math.max(0.05, tileSize || 1), 1 / Math.max(0.05, tileSize || 1));
        }
        entry.texture = finalTex;
        _pooledTerrainTextures.add(finalTex);
        entry.status = 'ready';
        complete();
      }, undefined, error => {
        entry.status = 'failed';
        console.warn('[terrain] failed to load authored ground PNG:', path, error);
        complete();
      });
    } catch (error) {
      entry.status = 'failed';
      console.warn('[terrain] failed to start authored ground PNG:', path, error);
      complete();
    }
    return entry;
  }

  function loadTerrainTileTexture(path, fallbackColor, tileSize, fillColor, stretch, unlit) {
    const col = fallbackColor instanceof THREE.Color ? fallbackColor : new THREE.Color(fallbackColor);
    const mat = unlit
      ? new THREE.MeshBasicMaterial({ color: col })
      : new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(deps.TILE_EMISSIVE_FLOOR) });
    mat.userData = Object.assign({}, mat.userData, {
      hobunjiTerrainTextureStatus: 'loading',
      hobunjiTerrainTextureSource: path,
    }); // Pixel Probe differentiates the async loading state from intentionally flat terrain.
    const entry = getSharedTerrainTexture(path, tileSize, fillColor, stretch); // Reuses pending loads and finished textures across wilderness zones.
    if (entry.status === 'ready') applyReadyTerrainTexture(mat, entry);
    else if (entry.status === 'failed') mat.userData.hobunjiTerrainTextureStatus = 'failed';
    else entry.materials.push(mat);
    return mat;
  }

  const _mapTileMatCache = new Map(); // "mapId,tileMatsKey" -> THREE.Material
  window.HobunjiCacheAudit?.register('game.mapTileMatCache', () => _mapTileMatCache.size);
  function resolveTileMat(mapId, matKey) {
    const tileMats = deps.tileMats;
    const base = tileMats[matKey] || tileMats.grass;
    base.userData = base.userData || {};
    if (!base.userData.terrainKey) base.userData.terrainKey = matKey; // Pixel Probe identifies the floor bucket even while its texture loads.
    if (matKey === deps.TileType.GRASS) {
      base.userData = base.userData || {};
      base.userData.hobunjiBaseGrassTerrainMaterial = true; // Held-object depth replay may ignore this floor, never billboard grass or other surfaces.
    }
    // '*' is a wildcard entry — applies to any map with no entry of its own
    // (every wilderness zone, without having to list each zone's mapId),
    // overridden by a map-specific entry (town/farm) when one exists.
    const config = deps.getTerrainMaterialConfig();
    const override = config.byMap?.[mapId]?.[matKey] || config.byMap?.['*']?.[matKey];
    if (!override?.texture) return base;
    const cacheKey = mapId + ',' + matKey;
    let mat = _mapTileMatCache.get(cacheKey);
    if (!mat) {
      const livingGround = matKey === deps.TileType.GRASS || matKey === deps.TileType.WEEDS || matKey === deps.TileType.SHRUB; // Vegetated ground shares the unlit grass lighting model.
      mat = loadTerrainTileTexture('assets/textures/' + override.texture, base.color.getHex(), override.tileSize, override.fillColor, override.stretch, livingGround);
      mat.userData.terrainKey = matKey; // Pixel Probe reports the actual resolved floor material rather than inferring from tint.
      if (matKey === deps.TileType.GRASS) {
        mat.userData = mat.userData || {};
        mat.userData.hobunjiBaseGrassTerrainMaterial = true; // Preserves the base-grass x-ray policy when map materials are texture-overridden.
      }
      _cachedTerrainMaterials.add(mat); // Held across zone eviction because resolveTileMat caches this exact material.
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
  _cachedTerrainMaterials.add(_defaultCliffMat); // Shared fallback cliff material also outlives individual zones.
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
      _cachedTerrainMaterials.add(mat); // Kept in the persistent map-specific cliff material cache.
      _mapCliffMatCache.set(mapId, mat);
    }
    return mat;
  }

  window.TerrainTileMaterials = {
    init,
    loadTerrainTileTexture,
    resolveTileMat,
    resolveCliffMat,
    isCachedMaterial: material => _cachedTerrainMaterials.has(material), // Used by zone scene eviction to protect persistent material uniforms.
    isSharedTexture: texture => _pooledTerrainTextures.has(texture), // Used by zone scene eviction to protect pooled GPU samplers.
    debugSnapshot: () => ({
      sharedTextures: _sharedTerrainTextures.size,
      savedLoads: _textureReuseHits,
      sourceLoadsStarted: _textureDecodeStarts,
      pending: [..._sharedTerrainTextures.values()].filter(entry => entry.status === 'loading').length,
      failed: [..._sharedTerrainTextures.values()].filter(entry => entry.status === 'failed').length,
      mapMaterials: _mapTileMatCache.size + _mapCliffMatCache.size,
    }), // Read on demand by Pixel Probe rather than performing a per-frame scan.
  };
})();
