// Shared generated-wilderness entrance corridor repair.
// Guarantees a narrow traversable entry without leaving a giant sterile apron.
(function (root) {
  'use strict';

  const PATH_HALF_WIDTH = 1;      // 3 visible road tiles.
  const SHOULDER_HALF_WIDTH = 2;  // +1 blocker-free grass tile each side.
  const APRON_HALF_WIDTH = 12;    // Bound all post-export surgery near the actual entry.
  const MAX_APRON_DEPTH = 48;
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

  const axisFor = (side, c, r) => side === 'north' || side === 'south' ? c : r;
  function inwardFor(side, c, r, map) {
    if (side === 'north') return r;
    if (side === 'south') return map.rows - 1 - r;
    if (side === 'west') return c;
    return map.cols - 1 - c;
  }
  function coordsAt(side, axis, inward, map) {
    if (side === 'north') return [axis, inward];
    if (side === 'south') return [axis, map.rows - 1 - inward];
    if (side === 'west') return [inward, axis];
    return [map.cols - 1 - inward, axis];
  }
  function tileCoords(key) {
    const [c, r] = String(key).split(',').map(Number);
    return Number.isFinite(c) && Number.isFinite(r) ? { c, r } : null;
  }
  function inferZoneId(workspace, explicitZoneId) {
    if (explicitZoneId) return explicitZoneId;
    if (workspace?.wildernessLabLiveRecipe?.zoneId) return workspace.wildernessLabLiveRecipe.zoneId;
    if (workspace?.zoneId) return workspace.zoneId;
    const map = rootMap(workspace);
    return map?.generatedFrom?.zoneMapId || map?.generatedFrom?.sourceMapId || workspace?.generatorPreset?.zoneMapId || null;
  }
  function clearGeneratedOverlay(tile) {
    delete tile.generatedObjectId;
    delete tile.generatedObjectType;
  }
  function clearSlopeAndCliffFlags(tile) {
    delete tile.plateau;
    delete tile.rampElevation;
    delete tile.borderEscarpment;
    delete tile.generatedBorderEscarpment;
    delete tile.borderEscarpmentDepth;
    delete tile.borderEscarpmentSide;
    delete tile.borderEscarpmentHeightBonus;
  }

  // Prefer the exact number of broad road slices the older runtime repair saw.
  // If that wasn't recorded, follow the entry's centerline only while it still
  // carries gate semantics. This avoids treating Cloud Forest's whole north
  // boundary as an entrance just because that cleanup also uses borderEntryGate.
  function detectApronDepth(map, side, centerAxis) {
    const recorded = Math.round(Number(map?.generatedFrom?.entryPathRepairSlices) || 0);
    if (recorded > 0) return clamp(recorded, 1, MAX_APRON_DEPTH);
    let lastHit = -1;
    let misses = 0;
    for (let inward = 0; inward < MAX_APRON_DEPTH; inward++) {
      const [c, r] = coordsAt(side, centerAxis, inward, map);
      const tile = map.tiles?.[`${c},${r}`];
      const hit = !!tile && (tile.borderEntryGate || tile.entryCorridorReclaimed || String(tile.type || '').toLowerCase() === 'path');
      if (hit) { lastHit = inward; misses = 0; }
      else if (++misses >= 2) break;
    }
    return clamp(lastHit + 1, 1, MAX_APRON_DEPTH);
  }

  function buildApron(map, side, centerAxis, depth) {
    const out = [];
    for (const [key, tile] of Object.entries(map.tiles || {})) {
      if (!tile) continue;
      const p = tileCoords(key);
      if (!p) continue;
      const inward = inwardFor(side, p.c, p.r, map);
      if (inward < 0 || inward >= depth) continue;
      const axis = axisFor(side, p.c, p.r);
      const lateral = Math.abs(axis - centerAxis);
      if (lateral > APRON_HALF_WIDTH) continue;
      // Only rewrite tiles that belong to the old gate/apron. Ordinary nearby
      // terrain and authored objects are left alone.
      if (!tile.borderEntryGate && !tile.entryCorridorReclaimed && !tile.entryCorridorProtected) continue;
      out.push({ tile, c: p.c, r: p.r, inward, axis, lateral });
    }
    return out;
  }

  function shouldCloudTree(item) {
    if (item.lateral <= SHOULDER_HALF_WIDTH) return false;
    // Dense two-tile checkerboard: forest begins immediately outside the one-
    // tile safety shoulder without stacking trunks on adjacent cardinal tiles.
    return ((item.axis + item.inward) & 1) === 0;
  }

  function applyWorkspace(workspace, options = {}) {
    const map = rootMap(workspace);
    if (!map?.tiles || !map.cols || !map.rows) return { applied:false, reason:'no-root-map' };
    if (map.generatedFrom?.narrowEntryCorridorV2) return { applied:false, reason:'already-applied', ...map.generatedFrom.narrowEntryCorridorV2 };

    const transition = entryTransition(map);
    const side = transitionSide(transition, map);
    if (!transition || !side) return { applied:false, reason:'no-entry' };
    const centerAxisRaw = side === 'north' || side === 'south' ? Number(transition.col) : Number(transition.row);
    if (!Number.isFinite(centerAxisRaw)) return { applied:false, reason:'no-entry-axis' };
    const axisLimit = side === 'north' || side === 'south' ? map.cols : map.rows;
    const centerAxis = clamp(Math.round(centerAxisRaw), 0, axisLimit - 1);
    const zoneId = inferZoneId(workspace, options.zoneId);
    const depth = detectApronDepth(map, side, centerAxis);
    const apron = buildApron(map, side, centerAxis, depth);
    if (!apron.length) return { applied:false, reason:'no-apron-tiles', side, centerAxis, depth };

    if (side === 'north' || side === 'south') transition.col = centerAxis;
    else transition.row = centerAxis;
    const marker = (map.routes || []).find(route => route?.id === 'route_map_entry_marker');
    if (marker) {
      const [c, r] = coordsAt(side, centerAxis, 0, map);
      marker.nodes = [[c, r]];
    }

    let roadTiles = 0, shoulderTiles = 0, reclaimedTiles = 0, blockersCleared = 0, cloudTrees = 0;
    for (const item of apron) {
      const tile = item.tile;
      if (item.lateral <= PATH_HALF_WIDTH) {
        if (tile.generatedObjectId || tile.generatedObjectType || tile.type !== 'path') blockersCleared++;
        clearGeneratedOverlay(tile);
        clearSlopeAndCliffFlags(tile);
        tile.type = 'path';
        tile.borderEntryGate = true;
        tile.entryCorridorProtected = true;
        tile.entryCorridorShoulder = false;
        delete tile.entryCorridorReclaimed;
        delete tile.entryCorridorReclaimedForest;
        roadTiles++;
        continue;
      }
      if (item.lateral <= SHOULDER_HALF_WIDTH) {
        if (tile.generatedObjectId || tile.generatedObjectType || (tile.type !== 'grass' && tile.type !== 'path')) blockersCleared++;
        clearGeneratedOverlay(tile);
        clearSlopeAndCliffFlags(tile);
        tile.type = 'grass';
        // This is ordinary grass, not a fake cliff-gate tile. The road itself
        // alone keeps borderEntryGate so runtime incline handling stays safe.
        delete tile.borderEntryGate;
        tile.entryCorridorProtected = true;
        tile.entryCorridorShoulder = true;
        delete tile.entryCorridorReclaimed;
        delete tile.entryCorridorReclaimedForest;
        shoulderTiles++;
        continue;
      }

      if (tile.type === 'path') reclaimedTiles++;
      clearSlopeAndCliffFlags(tile);
      tile.type = 'grass';
      delete tile.borderEntryGate;
      tile.entryCorridorProtected = false;
      tile.entryCorridorShoulder = false;
      tile.entryCorridorReclaimed = true;

      if (zoneId === CLOUD_ID && !tile.generatedObjectType && shouldCloudTree(item)) {
        tile.type = 'shrub';
        tile.generatedObjectType = 'copse';
        tile.generatedObjectId = `entry_copse_${item.c}_${item.r}`;
        tile.entryCorridorReclaimedForest = true;
        cloudTrees++;
      }
    }

    // Replace the V1 diagnostic rather than allowing stale "success" metadata
    // to mask a V2 pass in the Lab.
    if (map.generatedFrom?.narrowEntryCorridorV1) delete map.generatedFrom.narrowEntryCorridorV1;
    const report = {
      version: 2,
      side,
      centerAxis,
      apronDepthTiles: depth,
      apronHalfWidthTiles: APRON_HALF_WIDTH,
      roadWidthTiles: 3,
      protectedWidthTiles: 5,
      apronTiles: apron.length,
      roadTiles,
      shoulderTiles,
      reclaimedTiles,
      blockersCleared,
      cloudForestBackfillTrees: cloudTrees,
      zoneId: zoneId || null,
    };
    map.generatedFrom = { ...(map.generatedFrom || {}), narrowEntryCorridorV2: report };
    workspace.wildernessEntryCorridor = report;
    try { (root.__farmLog || console.log)(`[wilderness-entry] v2 ${side} depth=${depth} road=${roadTiles} shoulder=${shoulderTiles} reclaimed=${reclaimedTiles} cloudTrees=${cloudTrees}`); } catch {}
    return { applied:true, ...report };
  }

  function installGeneratorAdapter() {
    const Generator = root.WildernessMapGenerator;
    if (!Generator || Generator.__narrowEntryCorridorV2Installed) return false;
    Generator.__narrowEntryCorridorV2Installed = true;

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
        const map = rootMap(workspace);
        // A nested generateWorkspace wrapper may already have run without an
        // explicit zone id; redo only when Cloud Forest identity was missing.
        if (zoneMapId === CLOUD_ID && map?.generatedFrom?.narrowEntryCorridorV2?.zoneId !== CLOUD_ID) {
          delete map.generatedFrom.narrowEntryCorridorV2;
          applyWorkspace(workspace, { zoneId: zoneMapId });
        } else if (!map?.generatedFrom?.narrowEntryCorridorV2) {
          applyWorkspace(workspace, { zoneId: zoneMapId });
        }
        return workspace;
      };
    }
    return true;
  }

  root.WildernessEntryCorridor = {
    PATH_HALF_WIDTH,
    SHOULDER_HALF_WIDTH,
    APRON_HALF_WIDTH,
    CLOUD_ID,
    applyWorkspace,
    installGeneratorAdapter,
  };
  installGeneratorAdapter();
})(typeof window !== 'undefined' ? window : globalThis);
