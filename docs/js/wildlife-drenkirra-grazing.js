// Regular-Drenkirra grazing-station correction.
// Wilderness foliage patches are built from the copse/tree footprint itself;
// herbivore station selection historically picked one of those occupied cells.
// This adapter keeps the existing schedule AI intact but moves regular
// Drenkirra grazing targets onto a cached walkable ring beside that patch.
(() => {
  'use strict';

  const api = window.WildlifeSpawn; // Used to intercept the same dependency injection used by the den-pack spawner.
  if (!api?.init || api.__hobunjiDrenkirraGrazingPatched) return;

  const layoutCache = new WeakMap(); // Used to compute foliage occupancy/ring candidates once per generated zone layout, never per frame.
  let repairCount = 0; // Used by the mobile wildlife debug card to confirm regular-Drenkirra station repairs without devtools.
  let lastRepairText = 'no regular Drenkirra spawned yet'; // Used as the latest human-readable station repair diagnostic.

  function tileKey(x, y) {
    return `${x},${y}`;
  }

  function ensureLayoutInfo(zoneData, injectedDeps) {
    let info = layoutCache.get(zoneData); // Used to reuse candidate maps for every member of the same spawned herd.
    if (info) return info;

    const terrainByKey = new Map(); // Used to reject off-map/water ring cells without rescanning the exported tile list per animal.
    for (const tile of zoneData?.tiles || []) terrainByKey.set(tileKey(tile.c, tile.r), tile);

    const foliageTiles = new Set(); // Used to guarantee repaired stations sit beside foliage rather than inside this/another copse footprint.
    for (const patch of zoneData?.foliagePatches || []) {
      for (const tile of patch.tiles || []) foliageTiles.add(tileKey(tile.x, tile.y));
    }

    const forbiddenTerrain = new Set([
      injectedDeps.TileType?.RIVER,
      injectedDeps.TileType?.STREAM,
      injectedDeps.TileType?.TRENCH,
    ].filter(value => value != null)); // Used to keep grazing targets off water/ditch cells while preserving ordinary ground/incline traversal.

    info = { terrainByKey, foliageTiles, forbiddenTerrain, candidatesByPatch: new Map() };
    layoutCache.set(zoneData, info);
    return info;
  }

  function candidatesForPatch(zoneData, patch, injectedDeps) {
    const info = ensureLayoutInfo(zoneData, injectedDeps); // Used as the cached terrain/foliage occupancy data for this generated zone.
    if (info.candidatesByPatch.has(patch.id)) return info.candidatesByPatch.get(patch.id);

    const patchTiles = new Set((patch.tiles || []).map(tile => tileKey(tile.x, tile.y))); // Used to find the outside perimeter of this exact foliage patch.
    const candidateMap = new Map(); // Used to deduplicate ring cells touched by multiple patch-edge tiles.
    const directions = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ]; // Used to prefer the immediate 8-neighbor ring rather than moving grazing behavior away from its assigned patch.

    for (const tile of patch.tiles || []) {
      for (const [dx, dy] of directions) {
        const x = tile.x + dx, y = tile.y + dy;
        const key = tileKey(x, y);
        if (patchTiles.has(key) || info.foliageTiles.has(key) || candidateMap.has(key)) continue;
        const terrain = info.terrainByKey.get(key); // Used to reject coordinates outside the generated zone and obvious water cells.
        if (!terrain || info.forbiddenTerrain.has(terrain.type)) continue;
        candidateMap.set(key, { x, y });
      }
    }

    const candidates = [...candidateMap.values()]; // Used by each herd member to choose the closest safe edge to its originally-authored station.
    info.candidatesByPatch.set(patch.id, candidates);
    return candidates;
  }

  function repairRegularDrenkirraStation(speciesKey, opts, injectedDeps) {
    if (speciesKey !== 'drenkirra' || !opts?.grazingTile || !opts?.grazingPatchId) return;
    const zoneId = injectedDeps.getCurrentArea?.(); // Used because den packs are only spawned for the active wilderness zone.
    const zoneData = injectedDeps.zoneLayouts?.get?.(zoneId); // Used as the same generated workspace WildlifeSpawn used to assign the original foliage station.
    const patch = zoneData?.foliagePatches?.find?.(entry => entry.id === opts.grazingPatchId); // Used to recover the full copse footprint around the originally selected occupied tile.
    if (!patch?.tiles?.length) return;

    const candidates = candidatesForPatch(zoneData, patch, injectedDeps); // Used as cached immediate-ring cells outside all foliage footprints.
    if (!candidates.length) {
      lastRepairText = `${zoneId || '?'} ${opts.grazingPatchId}: no outside-ring fallback`;
      window.__farmLog?.(`[wildlife] Drenkirra grazing patch ${opts.grazingPatchId} had no non-foliage ring tile; kept legacy station ${opts.grazingTile.x},${opts.grazingTile.y}.`, 'wildlife');
      return;
    }

    const original = opts.grazingTile; // Used to preserve each herd member's originally-randomized part of the foliage patch.
    let best = candidates[0]; // Used as the nearest reachable perimeter station to that original target.
    let bestDistanceSq = Infinity; // Used to compare ring candidates without square roots.
    for (const candidate of candidates) {
      const dx = candidate.x - original.x, dy = candidate.y - original.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        best = candidate;
        bestDistanceSq = distanceSq;
      }
    }

    opts.grazingTile = { x: best.x, y: best.y };
    repairCount += 1;
    lastRepairText = `${zoneId || '?'} ${opts.grazingPatchId}: ${original.x},${original.y} → ${best.x},${best.y}`;
    window.__farmLog?.(`[wildlife] regular Drenkirra grazing station moved off copse footprint: ${original.x},${original.y} -> ${best.x},${best.y} (${opts.grazingPatchId}).`, 'wildlife');
  }

  function refreshDebug() {
    const pane = document.getElementById('devWildlifePane'); // Used as the existing mobile-visible wildlife diagnostics host.
    if (!pane) return;
    let element = document.getElementById('drenkirraGrazingDebug'); // Used to reuse one station-repair diagnostic card.
    if (!element) {
      element = document.createElement('div');
      element.id = 'drenkirraGrazingDebug';
      element.className = 'small';
      element.style.cssText = 'margin:6px 0;padding:6px;border:1px solid currentColor;border-radius:6px;white-space:pre-line;';
      pane.prepend(element);
    }
    element.textContent = `Drenkirra Grazing Stations\nrepaired ${repairCount}\n${lastRepairText}`;
  }

  const previousInit = api.init.bind(api); // Used to preserve Territorial's already-installed init wrapper and WildlifeSpawn's original dependency capture.
  api.init = function drenkirraGrazingAwareInit(injectedDeps) {
    const originalMakeCreatureEntity = injectedDeps?.makeCreatureEntity; // Used to intercept only den-pack entity creation without changing game.js's global creature factory.
    if (typeof originalMakeCreatureEntity !== 'function') return previousInit(injectedDeps);

    const patchedDeps = {
      ...injectedDeps,
      makeCreatureEntity(speciesKey, x, y, opts) {
        repairRegularDrenkirraStation(speciesKey, opts, patchedDeps);
        const creature = originalMakeCreatureEntity(speciesKey, x, y, opts);
        if (speciesKey === 'drenkirra' && opts?.grazingPatchId) refreshDebug();
        return creature;
      },
    }; // Used so neither game.js's original dependency object nor unrelated makeCreatureEntity call sites are mutated.

    return previousInit(patchedDeps);
  };

  api.__hobunjiDrenkirraGrazingPatched = true;
  window.HobunjiDrenkirraGrazing = { refreshDebug }; // Used by mobile/manual diagnostics and loader already-loaded checks.
})();
