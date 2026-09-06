// Shared generated-wilderness entrance corridor repair.
// The generator's source-only borderEntryGate/designRole metadata is not preserved
// by the Map Editor export, so post-export repair must identify the giant entry
// road mouth from geometry that *does* survive: a very wide contiguous path slab
// centered on the generated entry transition. Ordinary narrow generated roads are
// intentionally left alone.
(function (root) {
  'use strict';

  const PATH_HALF_WIDTH = 1;       // 3 final-world road tiles.
  const SHOULDER_HALF_WIDTH = 2;   // +1 ordinary grass tile each side.
  const WIDE_PATH_THRESHOLD = 6;   // Wider than any ordinary exported road trunk.
  const MAX_APRON_DEPTH = 72;      // Final exported tiles; comfortably beyond old gate depth.
  const CENTER_SEARCH_RADIUS = 5;
  const CLOUD_ID = 'map_southern_cloud_forest';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rootMap = workspace => workspace?.maps?.find(m => m && !m.isSubmap) || workspace?.maps?.[0] || null;
  const entryTransition = map => (map?.transitions || []).find(t => t?.id === 'sp_generated_entry')
    || (map?.transitions || []).find(t => /^Entry\s/i.test(String(t?.label || ''))) || null;

  function transitionSide(transition, map) {
    const label = String(transition?.label || '').toLowerCase();
    for (const side of ['north', 'south', 'west', 'east']) if (label.includes(side)) return side;
    const c = Number(transition?.col), r = Number(transition?.row);
    if (!Number.isFinite(c) || !Number.isFinite(r) || !map) return null;
    const choices = [['north', r], ['south', Math.max(0, map.rows - 1 - r)], ['west', c], ['east', Math.max(0, map.cols - 1 - c)]];
    choices.sort((a, b) => a[1] - b[1]);
    return choices[0]?.[0] || null;
  }

  function coordsAt(side, axis, inward, map) {
    if (side === 'north') return [axis, inward];
    if (side === 'south') return [axis, map.rows - 1 - inward];
    if (side === 'west') return [inward, axis];
    return [map.cols - 1 - inward, axis];
  }

  function inferZoneId(workspace, explicitZoneId) {
    if (explicitZoneId) return explicitZoneId;
    if (workspace?.wildernessLabLiveRecipe?.zoneId) return workspace.wildernessLabLiveRecipe.zoneId;
    if (workspace?.zoneId) return workspace.zoneId;
    const map = rootMap(workspace);
    return map?.generatedFrom?.zoneMapId || map?.generatedFrom?.sourceMapId || workspace?.generatorPreset?.zoneMapId || null;
  }

  function tileAtExport(map, c, r) {
    if (!map || c < 0 || r < 0 || c >= map.cols || r >= map.rows) return null;
    return map.tiles?.[`${c},${r}`] || null;
  }

  function isPath(tile) {
    return String(tile?.type || '').toLowerCase() === 'path';
  }

  function clearGeneratedOverlay(tile) {
    delete tile.generatedObjectId;
    delete tile.generatedObjectType;
  }

  // Find the nearest center-axis cell in this slice that is actually path.
  // Transition coordinates can land on one edge of an even-width upscaled road,
  // so a small lateral search avoids missing the slab by one exported tile.
  function pathAxisNearCenter(map, side, centerAxis, inward) {
    for (let delta = 0; delta <= CENTER_SEARCH_RADIUS; delta++) {
      const offsets = delta === 0 ? [0] : [-delta, delta];
      for (const offset of offsets) {
        const axis = centerAxis + offset;
        const [c, r] = coordsAt(side, axis, inward, map);
        if (isPath(tileAtExport(map, c, r))) return axis;
      }
    }
    return null;
  }

  function contiguousPathRun(map, side, centerAxis, inward) {
    const seedAxis = pathAxisNearCenter(map, side, centerAxis, inward);
    if (seedAxis == null) return null;
    const axisLimit = side === 'north' || side === 'south' ? map.cols : map.rows;
    let lo = seedAxis;
    let hi = seedAxis;
    while (lo - 1 >= 0) {
      const [c, r] = coordsAt(side, lo - 1, inward, map);
      if (!isPath(tileAtExport(map, c, r))) break;
      lo--;
    }
    while (hi + 1 < axisLimit) {
      const [c, r] = coordsAt(side, hi + 1, inward, map);
      if (!isPath(tileAtExport(map, c, r))) break;
      hi++;
    }
    return { inward, lo, hi, width: hi - lo + 1, seedAxis };
  }

  // The old road mouth is a stack of very wide path slices. As soon as that
  // collapses to the ordinary road width for two consecutive slices, stop;
  // subsequent A* roads belong to the real path network and must not be altered.
  function detectWidePathSlab(map, side, centerAxis) {
    const slices = [];
    let started = false;
    let narrowMisses = 0;
    for (let inward = 0; inward < Math.min(MAX_APRON_DEPTH, side === 'north' || side === 'south' ? map.rows : map.cols); inward++) {
      const run = contiguousPathRun(map, side, centerAxis, inward);
      const wide = !!run && run.width >= WIDE_PATH_THRESHOLD;
      if (wide) {
        started = true;
        narrowMisses = 0;
        slices.push(run);
        continue;
      }
      if (!started) {
        // A tiny gap right at the map edge is tolerable, but don't search deep
        // into the map for unrelated wide plazas.
        if (inward >= 3) break;
        continue;
      }
      if (++narrowMisses >= 2) break;
    }
    return slices;
  }

  function shouldCloudTree(axis, inward, centerAxis) {
    if (Math.abs(axis - centerAxis) <= SHOULDER_HALF_WIDTH) return false;
    // Dense checkerboard gives immediate forest edge without adjacent trunk cells.
    return ((axis + inward) & 1) === 0;
  }

  function applyWorkspace(workspace, options = {}) {
    const map = rootMap(workspace);
    if (!map?.tiles || !map.cols || !map.rows) return { applied:false, reason:'no-root-map' };
    if (map.generatedFrom?.narrowEntryCorridorV3) return { applied:false, reason:'already-applied', ...map.generatedFrom.narrowEntryCorridorV3 };

    const transition = entryTransition(map);
    const side = transitionSide(transition, map);
    if (!transition || !side) return { applied:false, reason:'no-entry' };
    const centerAxisRaw = side === 'north' || side === 'south' ? Number(transition.col) : Number(transition.row);
    if (!Number.isFinite(centerAxisRaw)) return { applied:false, reason:'no-entry-axis' };
    const axisLimit = side === 'north' || side === 'south' ? map.cols : map.rows;
    const centerAxis = clamp(Math.round(centerAxisRaw), 0, axisLimit - 1);
    const zoneId = inferZoneId(workspace, options.zoneId);
    const slices = detectWidePathSlab(map, side, centerAxis);
    if (!slices.length) return { applied:false, reason:'no-wide-entry-path-slab', side, centerAxis };

    let roadTiles = 0;
    let shoulderTiles = 0;
    let reclaimedTiles = 0;
    let blockersCleared = 0;
    let cloudTrees = 0;
    let widestSlice = 0;

    for (const slice of slices) {
      widestSlice = Math.max(widestSlice, slice.width);
      for (let axis = slice.lo; axis <= slice.hi; axis++) {
        const [c, r] = coordsAt(side, axis, slice.inward, map);
        const tile = tileAtExport(map, c, r);
        if (!tile || !isPath(tile)) continue;
        const lateral = Math.abs(axis - centerAxis);

        if (lateral <= PATH_HALF_WIDTH) {
          if (tile.generatedObjectType || tile.generatedObjectId) blockersCleared++;
          clearGeneratedOverlay(tile);
          tile.type = 'path';
          tile.entryCorridorProtected = true;
          tile.entryCorridorShoulder = false;
          delete tile.entryCorridorReclaimed;
          delete tile.entryCorridorReclaimedForest;
          roadTiles++;
          continue;
        }

        if (lateral <= SHOULDER_HALF_WIDTH) {
          if (tile.generatedObjectType || tile.generatedObjectId) blockersCleared++;
          clearGeneratedOverlay(tile);
          tile.type = 'grass';
          tile.entryCorridorProtected = true;
          tile.entryCorridorShoulder = true;
          delete tile.entryCorridorReclaimed;
          delete tile.entryCorridorReclaimedForest;
          shoulderTiles++;
          continue;
        }

        tile.type = 'grass';
        tile.entryCorridorProtected = false;
        tile.entryCorridorShoulder = false;
        tile.entryCorridorReclaimed = true;
        reclaimedTiles++;

        if (zoneId === CLOUD_ID && !tile.generatedObjectType && shouldCloudTree(axis, slice.inward, centerAxis)) {
          tile.type = 'shrub';
          tile.generatedObjectType = 'copse';
          tile.generatedObjectId = `entry_copse_${c}_${r}`;
          tile.entryCorridorReclaimedForest = true;
          cloudTrees++;
        }
      }
    }

    const marker = (map.routes || []).find(route => route?.id === 'route_map_entry_marker');
    if (marker) {
      const [c, r] = coordsAt(side, centerAxis, 0, map);
      marker.nodes = [[c, r]];
    }

    // Remove stale earlier diagnostics so the pixel probe always reports the
    // geometry-driven pass that actually ran on the exported workspace.
    if (map.generatedFrom?.narrowEntryCorridorV1) delete map.generatedFrom.narrowEntryCorridorV1;
    if (map.generatedFrom?.narrowEntryCorridorV2) delete map.generatedFrom.narrowEntryCorridorV2;
    const report = {
      version: 3,
      detector: 'wide-contiguous-exported-path-slab',
      side,
      centerAxis,
      widePathThresholdTiles: WIDE_PATH_THRESHOLD,
      wideSlices: slices.length,
      apronDepthTiles: slices[slices.length - 1].inward + 1,
      widestDetectedPathTiles: widestSlice,
      roadWidthTiles: 3,
      protectedWidthTiles: 5,
      roadTiles,
      shoulderTiles,
      reclaimedTiles,
      blockersCleared,
      cloudForestBackfillTrees: cloudTrees,
      zoneId: zoneId || null,
    };
    map.generatedFrom = { ...(map.generatedFrom || {}), narrowEntryCorridorV3: report };
    workspace.wildernessEntryCorridor = report;
    try { (root.__farmLog || console.log)(`[wilderness-entry] v3 ${side} wideSlices=${slices.length} widest=${widestSlice} reclaimed=${reclaimedTiles} cloudTrees=${cloudTrees}`); } catch {}
    return { applied:true, ...report };
  }

  function installGeneratorAdapter() {
    const Generator = root.WildernessMapGenerator;
    if (!Generator || Generator.__narrowEntryCorridorV3Installed) return false;
    Generator.__narrowEntryCorridorV3Installed = true;

    if (typeof Generator.generateWorkspace === 'function') {
      const original = Generator.generateWorkspace.bind(Generator);
      Generator.generateWorkspace = (seed, overrides) => {
        const workspace = original(seed, overrides);
        applyWorkspace(workspace, {});
        return workspace;
      };
    }
    if (typeof Generator.generateZoneWorkspace === 'function') {
      const originalZone = Generator.generateZoneWorkspace.bind(Generator);
      Generator.generateZoneWorkspace = (zoneMapId, seed, locales) => {
        const workspace = originalZone(zoneMapId, seed, locales);
        applyWorkspace(workspace, { zoneId: zoneMapId });
        return workspace;
      };
    }
    return true;
  }

  root.WildernessEntryCorridor = {
    PATH_HALF_WIDTH,
    SHOULDER_HALF_WIDTH,
    WIDE_PATH_THRESHOLD,
    CLOUD_ID,
    applyWorkspace,
    installGeneratorAdapter,
    detectWidePathSlab,
  };
  installGeneratorAdapter();
})(typeof window !== 'undefined' ? window : globalThis);
