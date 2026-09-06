// Shared generated-wilderness entrance corridor repair.
// Replaces the old giant empty road apron with a narrow guaranteed route while
// preserving the broad terrain cut only as invisible anti-cliff surgery.
(function (root) {
  'use strict';

  const PATH_HALF_WIDTH = 1;      // 3 visible road tiles.
  const SHOULDER_HALF_WIDTH = 2;  // +1 blocker-free grass tile per side.
  const CLOUD_ID = 'map_southern_cloud_forest';

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function rootMap(workspace) {
    return workspace?.maps?.find(m => m && !m.isSubmap)
      || workspace?.maps?.[0]
      || null;
  }

  function entryTransition(map) {
    return (map?.transitions || []).find(t => t?.id === 'sp_generated_entry')
      || (map?.transitions || []).find(t => /^Entry\s/i.test(String(t?.label || '')))
      || null;
  }

  function transitionSide(transition, map) {
    const label = String(transition?.label || '').toLowerCase();
    for (const side of ['north', 'south', 'west', 'east']) {
      if (label.includes(side)) return side;
    }
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

  function axisFor(side, c, r) {
    return side === 'north' || side === 'south' ? c : r;
  }

  function inwardFor(side, c, r, map) {
    if (side === 'north') return r;
    if (side === 'south') return map.rows - 1 - r;
    if (side === 'west') return c;
    return map.cols - 1 - c;
  }

  function tileCoords(key) {
    const [c, r] = String(key).split(',').map(Number);
    return Number.isFinite(c) && Number.isFinite(r) ? { c, r } : null;
  }

  function hash01(c, r, salt = 0) {
    let h = (2166136261 ^ Math.imul((c | 0) + 0x9e37, 374761393)
      ^ Math.imul((r | 0) + 0x85eb, 668265263)
      ^ Math.imul(salt | 0, 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return h / 4294967296;
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

  function inferZoneId(workspace, explicitZoneId) {
    if (explicitZoneId) return explicitZoneId;
    if (workspace?.wildernessLabLiveRecipe?.zoneId) return workspace.wildernessLabLiveRecipe.zoneId;
    if (workspace?.zoneId) return workspace.zoneId;
    const map = rootMap(workspace);
    return map?.generatedFrom?.zoneMapId
      || map?.generatedFrom?.sourceMapId
      || workspace?.generatorPreset?.zoneMapId
      || null;
  }

  function cloudCopseCandidate(c, r, side, centerAxis, inward) {
    const axis = axisFor(side, c, r);
    if (Math.abs(axis - centerAxis) <= SHOULDER_HALF_WIDTH) return false;
    // Keep a readable but dense 2-world-ish lattice, offset per inward row.
    // The first eligible row can contain trees, so the forest starts at the gate.
    const lattice = ((axis + (inward & 1)) & 1) === 0;
    if (!lattice) return false;
    return hash01(c, r, 91031) < 0.68;
  }

  function applyWorkspace(workspace, options = {}) {
    const map = rootMap(workspace);
    if (!map?.tiles || !map.cols || !map.rows) return { applied: false, reason: 'no-root-map' };
    if (map.generatedFrom?.narrowEntryCorridorV1) {
      return { applied: false, reason: 'already-applied', ...(map.generatedFrom.narrowEntryCorridorV1 || {}) };
    }

    const transition = entryTransition(map);
    const side = transitionSide(transition, map);
    if (!transition || !side) return { applied: false, reason: 'no-entry' };

    const centerAxisRaw = side === 'north' || side === 'south' ? Number(transition.col) : Number(transition.row);
    if (!Number.isFinite(centerAxisRaw)) return { applied: false, reason: 'no-entry-axis' };
    const axisLimit = side === 'north' || side === 'south' ? map.cols : map.rows;
    const centerAxis = clamp(Math.round(centerAxisRaw), 0, axisLimit - 1);
    const zoneId = inferZoneId(workspace, options.zoneId);

    const gate = [];
    for (const [key, tile] of Object.entries(map.tiles)) {
      if (!tile?.borderEntryGate) continue;
      const p = tileCoords(key);
      if (!p) continue;
      gate.push({ key, tile, c: p.c, r: p.r, axis: axisFor(side, p.c, p.r), inward: inwardFor(side, p.c, p.r, map) });
    }
    if (!gate.length) return { applied: false, reason: 'no-gate-tiles', side, centerAxis };

    // Keep the transition and route marker centered on the actual narrow road.
    if (side === 'north' || side === 'south') transition.col = centerAxis;
    else transition.row = centerAxis;
    const marker = (map.routes || []).find(route => route?.id === 'route_map_entry_marker');
    if (marker) {
      const c = side === 'west' ? 0 : side === 'east' ? map.cols - 1 : centerAxis;
      const r = side === 'north' ? 0 : side === 'south' ? map.rows - 1 : centerAxis;
      marker.nodes = [[c, r]];
    }

    let roadTiles = 0, shoulderTiles = 0, reclaimed = 0, blockersCleared = 0, cloudTrees = 0;
    const newTreeKeys = new Set();

    // First pass: guarantee the protected 3+1+1 corridor and reclaim all other
    // old gate-apron tiles as natural grass.
    for (const item of gate) {
      const { tile, axis } = item;
      const lateral = Math.abs(axis - centerAxis);
      if (lateral <= PATH_HALF_WIDTH) {
        if (tile.generatedObjectId || tile.generatedObjectType || tile.type !== 'path') blockersCleared++;
        clearGeneratedOverlay(tile);
        clearSlopeAndCliffFlags(tile);
        tile.type = 'path';
        tile.borderEntryGate = true;
        tile.entryCorridorProtected = true;
        tile.entryCorridorShoulder = false;
        roadTiles++;
      } else if (lateral <= SHOULDER_HALF_WIDTH) {
        if (tile.generatedObjectId || tile.generatedObjectType || (tile.type !== 'grass' && tile.type !== 'path')) blockersCleared++;
        clearGeneratedOverlay(tile);
        clearSlopeAndCliffFlags(tile);
        tile.type = 'grass';
        tile.borderEntryGate = true;
        tile.entryCorridorProtected = true;
        tile.entryCorridorShoulder = true;
        shoulderTiles++;
      } else {
        if (tile.type === 'path') reclaimed++;
        tile.type = 'grass';
        tile.entryCorridorProtected = false;
        tile.entryCorridorShoulder = false;
        // Keep borderEntryGate as an invisible terrain-clearance tag: the broad
        // anti-cliff flattening still exists, but it no longer reserves or paints
        // this tile as road. Leaving the tag also lets a later zone-aware pass
        // (notably Cloud Forest) repopulate a generically-trimmed apron safely.
        tile.entryCorridorReclaimed = true;
      }
    }

    // Cloud Forest-specific backfill: the old giant path rectangle prevented
    // placeCopses() from ever considering these tiles. Repopulate the reclaimed
    // apron with normal copse metadata, beginning immediately outside the
    // one-tile safety shoulder.
    if (zoneId === CLOUD_ID) {
      const candidates = gate
        .filter(item => Math.abs(item.axis - centerAxis) > SHOULDER_HALF_WIDTH)
        .sort((a, b) => a.inward - b.inward || a.axis - b.axis);

      for (const item of candidates) {
        const { tile, c, r, inward } = item;
        if (tile.type !== 'grass' || tile.generatedObjectType) continue;
        if (!cloudCopseCandidate(c, r, side, centerAxis, inward)) continue;

        // Avoid placing newly backfilled trees directly adjacent to each other.
        let nearNew = false;
        for (let dr = -1; dr <= 1 && !nearNew; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dc === 0 && dr === 0) continue;
            if (newTreeKeys.has(`${c + dc},${r + dr}`)) { nearNew = true; break; }
          }
        }
        if (nearNew) continue;

        tile.type = 'shrub';
        tile.generatedObjectType = 'copse';
        tile.generatedObjectId = `entry_copse_${c}_${r}`;
        tile.entryCorridorReclaimedForest = true;
        newTreeKeys.add(`${c},${r}`);
        cloudTrees++;
      }
    }

    map.generatedFrom = {
      ...(map.generatedFrom || {}),
      narrowEntryCorridorV1: {
        side,
        centerAxis,
        roadWidthTiles: PATH_HALF_WIDTH * 2 + 1,
        protectedWidthTiles: SHOULDER_HALF_WIDTH * 2 + 1,
        gateTiles: gate.length,
        roadTiles,
        shoulderTiles,
        reclaimedTiles: reclaimed,
        blockersCleared,
        cloudForestBackfillTrees: cloudTrees,
      },
    };
    workspace.wildernessEntryCorridor = { ...map.generatedFrom.narrowEntryCorridorV1, zoneId: zoneId || null };
    return { applied: true, ...workspace.wildernessEntryCorridor };
  }

  function installGeneratorAdapter() {
    const Generator = root.WildernessMapGenerator;
    if (!Generator || Generator.__narrowEntryCorridorInstalled) return false;
    Generator.__narrowEntryCorridorInstalled = true;

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
        // generateWorkspace may already have applied; explicit zone id still
        // lets an unmarked Cloud Forest receive the forest backfill correctly.
        if (!rootMap(workspace)?.generatedFrom?.narrowEntryCorridorV1) {
          applyWorkspace(workspace, { zoneId: zoneMapId });
        } else if (zoneMapId === CLOUD_ID && !(rootMap(workspace)?.generatedFrom?.narrowEntryCorridorV1?.cloudForestBackfillTrees > 0)) {
          // If a generic wrapper ran first without knowing the zone, allow one
          // corrective pass by clearing only the idempotence marker.
          const map = rootMap(workspace);
          delete map.generatedFrom.narrowEntryCorridorV1;
          applyWorkspace(workspace, { zoneId: zoneMapId });
        }
        return workspace;
      };
    }
    return true;
  }

  const API = {
    PATH_HALF_WIDTH,
    SHOULDER_HALF_WIDTH,
    CLOUD_ID,
    applyWorkspace,
    installGeneratorAdapter,
  };
  root.WildernessEntryCorridor = API;
  installGeneratorAdapter();
})(typeof window !== 'undefined' ? window : globalThis);
