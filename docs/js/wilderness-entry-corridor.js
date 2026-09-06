// Shared generated-wilderness entrance/causeway repair.
//
// The literal border entry and the Great Basin high-entry causeway are two
// different things. In particular, Cloud Forest has a deliberately narrow
// border gate, then several tiles farther inward the Great Basin preset paints
// a much wider radius-brushed path toward its high plateau. The Map Editor
// export keeps those cells as ordinary `type: path` tiles, but does not retain
// the Great Basin designRole that created them. Detect the surviving geometry
// instead: an abnormally wide path run near the entry axis, even when it begins
// well after a narrow entrance. Trim only that thick run; ordinary roads stay
// untouched.
(function (root) {
  'use strict';

  const PATH_HALF_WIDTH = 1;          // 3 final-world road tiles.
  const SHOULDER_HALF_WIDTH = 2;      // +1 ordinary grass tile each side.
  const WIDE_PATH_THRESHOLD = 6;      // Ordinary road trunks are narrower.
  const MAX_SCAN_DEPTH = 96;          // Final exported tiles from the entry edge.
  const PRESTART_CENTER_RADIUS = 14;  // Causeway may begin after a short bend.
  const FOLLOW_CENTER_RADIUS = 9;     // Maximum lateral step while following it.
  const END_MISS_LIMIT = 3;
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
    const choices = [
      ['north', r],
      ['south', Math.max(0, map.rows - 1 - r)],
      ['west', c],
      ['east', Math.max(0, map.cols - 1 - c)],
    ];
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

  // Return every contiguous path run across one row/column slice. Doing this
  // instead of seeding from the transition axis matters because the high-entry
  // causeway is allowed to bend toward its chosen plateau.
  function pathRunsAtSlice(map, side, inward) {
    const axisLimit = side === 'north' || side === 'south' ? map.cols : map.rows;
    const runs = [];
    let start = null;
    for (let axis = 0; axis <= axisLimit; axis++) {
      let path = false;
      if (axis < axisLimit) {
        const [c, r] = coordsAt(side, axis, inward, map);
        path = isPath(tileAtExport(map, c, r));
      }
      if (path && start == null) start = axis;
      if (!path && start != null) {
        const lo = start;
        const hi = axis - 1;
        runs.push({ inward, lo, hi, width: hi - lo + 1, center: (lo + hi) / 2 });
        start = null;
      }
    }
    return runs;
  }

  function nearestWideRun(map, side, inward, expectedAxis, radius) {
    const candidates = pathRunsAtSlice(map, side, inward)
      .filter(run => run.width >= WIDE_PATH_THRESHOLD)
      .map(run => ({ ...run, centerDistance: Math.abs(run.center - expectedAxis) }))
      .filter(run => run.centerDistance <= radius)
      .sort((a, b) => a.centerDistance - b.centerDistance || b.width - a.width);
    return candidates[0] || null;
  }

  // Important: do NOT stop while the literal entrance is narrow. Cloud Forest
  // intentionally starts with a narrow border gate and only later enters the
  // Great Basin radius-brushed high-entry road. Search the whole bounded entry
  // region until the first thick slice appears. Once found, follow its moving
  // center and stop only after several consecutive misses.
  function detectWidePathSlab(map, side, entryAxis) {
    const slices = [];
    const depthLimit = Math.min(
      MAX_SCAN_DEPTH,
      side === 'north' || side === 'south' ? map.rows : map.cols
    );
    let started = false;
    let expectedAxis = entryAxis;
    let misses = 0;

    for (let inward = 0; inward < depthLimit; inward++) {
      const radius = started ? FOLLOW_CENTER_RADIUS : PRESTART_CENTER_RADIUS;
      const run = nearestWideRun(map, side, inward, expectedAxis, radius);
      if (run) {
        started = true;
        misses = 0;
        expectedAxis = Math.round(run.center);
        slices.push({ ...run, centerAxis: expectedAxis });
        continue;
      }
      if (!started) continue;
      if (++misses >= END_MISS_LIMIT) break;
    }
    return slices;
  }

  function shouldCloudTree(axis, inward, centerAxis) {
    if (Math.abs(axis - centerAxis) <= SHOULDER_HALF_WIDTH) return false;
    // Dense checkerboard starts the forest immediately outside the shoulder
    // without planting trunks in adjacent cardinal cells.
    return ((axis + inward) & 1) === 0;
  }

  function applyWorkspace(workspace, options = {}) {
    const map = rootMap(workspace);
    if (!map?.tiles || !map.cols || !map.rows) return { applied:false, reason:'no-root-map' };
    if (!options.force && map.generatedFrom?.narrowEntryCorridorV4) {
      return { applied:false, reason:'already-applied', ...map.generatedFrom.narrowEntryCorridorV4 };
    }

    const transition = entryTransition(map);
    const side = transitionSide(transition, map);
    if (!transition || !side) return { applied:false, reason:'no-entry' };
    const entryAxisRaw = side === 'north' || side === 'south' ? Number(transition.col) : Number(transition.row);
    if (!Number.isFinite(entryAxisRaw)) return { applied:false, reason:'no-entry-axis' };
    const axisLimit = side === 'north' || side === 'south' ? map.cols : map.rows;
    const entryAxis = clamp(Math.round(entryAxisRaw), 0, axisLimit - 1);
    const zoneId = inferZoneId(workspace, options.zoneId);
    const slices = detectWidePathSlab(map, side, entryAxis);
    if (!slices.length) return { applied:false, reason:'no-wide-entry-causeway', side, entryAxis };

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
        const lateral = Math.abs(axis - slice.centerAxis);

        if (lateral <= PATH_HALF_WIDTH) {
          if (tile.generatedObjectType || tile.generatedObjectId) blockersCleared++;
          clearGeneratedOverlay(tile);
          tile.type = 'path';
          tile.entryCorridorProtected = true;
          tile.entryCorridorShoulder = false;
          tile.entryCausewayCenterline = true;
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
          delete tile.entryCausewayCenterline;
          delete tile.entryCorridorReclaimed;
          delete tile.entryCorridorReclaimedForest;
          shoulderTiles++;
          continue;
        }

        tile.type = 'grass';
        tile.entryCorridorProtected = false;
        tile.entryCorridorShoulder = false;
        tile.entryCorridorReclaimed = true;
        delete tile.entryCausewayCenterline;
        reclaimedTiles++;

        if (zoneId === CLOUD_ID && !tile.generatedObjectType && shouldCloudTree(axis, slice.inward, slice.centerAxis)) {
          tile.type = 'shrub';
          tile.generatedObjectType = 'copse';
          tile.generatedObjectId = `entry_copse_${c}_${r}`;
          tile.entryCorridorReclaimedForest = true;
          cloudTrees++;
        }
      }
    }

    // Remove stale diagnostics from older attempts so the probe reports which
    // geometry-driven pass actually ran on this workspace.
    map.generatedFrom = { ...(map.generatedFrom || {}) };
    delete map.generatedFrom.narrowEntryCorridorV1;
    delete map.generatedFrom.narrowEntryCorridorV2;
    delete map.generatedFrom.narrowEntryCorridorV3;

    const report = {
      version: 4,
      detector: 'delayed-following-wide-path-causeway',
      side,
      entryAxis,
      firstWideSlice: slices[0].inward,
      lastWideSlice: slices[slices.length - 1].inward,
      widePathThresholdTiles: WIDE_PATH_THRESHOLD,
      wideSlices: slices.length,
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
    map.generatedFrom.narrowEntryCorridorV4 = report;
    workspace.wildernessEntryCorridor = report;
    try {
      (root.__farmLog || console.log)(
        `[wilderness-entry] v4 ${side} firstWide=${report.firstWideSlice} ` +
        `lastWide=${report.lastWideSlice} widest=${widestSlice} ` +
        `reclaimed=${reclaimedTiles} cloudTrees=${cloudTrees}`
      );
    } catch {}
    return { applied:true, ...report };
  }

  function installGeneratorAdapter() {
    const Generator = root.WildernessMapGenerator;
    if (!Generator || Generator.__narrowEntryCorridorV4Installed) return false;
    Generator.__narrowEntryCorridorV4Installed = true;

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
