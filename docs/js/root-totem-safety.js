// Root Totem safety placement.
//
// Root Totems are wilderness respawn checkpoints, so the generator keeps them
// away from static combat landmarks (animal dens and combat-oriented locales),
// while temporary combat locales are given the inverse keep-away rule when
// they stamp into an already-generated zone.
(function (root) {
  'use strict';

  const FALLBACK_CLEARANCE_TILES = 12; // Used when root-totem-config.js does not provide authored placement tuning.
  const COMBAT_LOCALE_CATEGORIES = new Set(['bandit_camp', 'porakaneki_camp', 'combat_poi', 'hostile_poi']); // Used by fixed + temporary locale classification.
  const NON_WALKABLE_TILE_TYPES = new Set(['river', 'stream', 'waterfall', 'water', 'deep_water', 'deepwater', 'ramp', 'rock']); // Used while relocating a checkpoint on exported terrain.
  const registryRecords = new Set(); // Used to match later TemporaryLocales zone views back to generated Root Totem coordinates.
  const recordByWorkspace = new WeakMap(); // Used to avoid duplicate registry entries when generateZoneWorkspace internally calls generateWorkspace.
  const state = {
    workspacesChecked: 0,
    totemsMoved: 0,
    temporaryCombatSitesProtected: 0,
    lastWorkspaceReport: null,
    lastTemporaryLocaleReport: null,
  }; // Exposed through debugSnapshot so placement can be inspected without a browser console.

  function configuredClearanceTiles() {
    const configured = Number(root.HOBUNJI_ROOT_TOTEM_CONFIG?.placement?.combatPoiClearanceTiles); // Read by both static relocation and temporary-locale separation.
    return Number.isFinite(configured) && configured > 0 ? configured : FALLBACK_CLEARANCE_TILES;
  }

  function rootMap(workspace) {
    return workspace?.maps?.find(map => map && !map.isSubmap) || workspace?.maps?.[0] || null;
  }

  function tileAt(map, col, row) {
    if (!map || col < 0 || row < 0 || col >= map.cols || row >= map.rows) return null;
    return map.tiles?.[`${col},${row}`] || null;
  }

  function rectContains(rect, col, row) {
    if (!rect) return false;
    const width = Math.max(1, Number(rect.w) || 1); // Used to normalize authored/generated blocker footprints.
    const height = Math.max(1, Number(rect.h) || 1); // Used to normalize authored/generated blocker footprints.
    return col >= rect.x && row >= rect.y && col < rect.x + width && row < rect.y + height;
  }

  function distanceToRect(col, row, rect) {
    const width = Math.max(1, Number(rect.w) || 1); // Used to measure safety from the whole combat POI footprint, not just its center.
    const height = Math.max(1, Number(rect.h) || 1); // Used with width by the point-to-rectangle distance check.
    const nearestX = Math.max(rect.x, Math.min(col, rect.x + width - 1)); // Used as the nearest POI tile to this checkpoint candidate.
    const nearestY = Math.max(rect.y, Math.min(row, rect.y + height - 1)); // Used as the nearest POI tile to this checkpoint candidate.
    return Math.hypot(col - nearestX, row - nearestY);
  }

  function localeLooksCombatOriented(locale) {
    const category = String(locale?.category || '').trim().toLowerCase(); // Used for authored locale classification when no hostile tag survives export.
    if (COMBAT_LOCALE_CATEGORIES.has(category)) return true;
    if (/(^|[_-])(bandit|combat|hostile|battle|arena|den)([_-]|$)/.test(category)) return true;
    const tags = Array.isArray(locale?.tags) ? locale.tags.map(tag => String(tag).toLowerCase()) : []; // Used by temporary locale definitions, which retain authored tags.
    return tags.some(tag => tag === 'hostile' || tag === 'combat' || tag === 'bandit');
  }

  function staticCombatThreats(workspace) {
    const threats = []; // Consumed by checkpoint candidate filtering below.
    for (const den of (workspace?.animalDens || [])) {
      threats.push({
        kind: 'animalDen',
        x: Number(den.x) || 0,
        y: Number(den.y) || 0,
        w: Math.max(1, Number(den.w) || 1),
        h: Math.max(1, Number(den.h) || 1),
      });
    }
    for (const locale of (workspace?.localeInstances || [])) {
      if (!localeLooksCombatOriented(locale)) continue;
      const x = Number(locale.x ?? locale.anchorX); // Used as the fixed combat locale footprint origin.
      const y = Number(locale.y ?? locale.anchorY); // Used with x to build a keep-away rectangle.
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      threats.push({
        kind: String(locale.category || 'combatLocale'),
        x,
        y,
        w: Math.max(1, Number(locale.w) || 1),
        h: Math.max(1, Number(locale.h) || 1),
      });
    }
    return threats;
  }

  function genericHardBlockers(workspace, map) {
    const blockers = []; // Used to keep relocated Root Totems out of structures and authored object footprints.
    const addRect = (x, y, w = 1, h = 1) => {
      const col = Number(x), row = Number(y); // Converted once here for every blocker source.
      if (!Number.isFinite(col) || !Number.isFinite(row)) return;
      blockers.push({ x: col, y: row, w: Math.max(1, Number(w) || 1), h: Math.max(1, Number(h) || 1) });
    };
    for (const den of (workspace?.animalDens || [])) addRect(den.x, den.y, den.w, den.h);
    for (const building of (map?.buildings || [])) addRect(building.gridX ?? building.col ?? building.x, building.gridZ ?? building.row ?? building.y, building.footprintW ?? building.w, building.footprintD ?? building.h);
    for (const transition of (map?.transitions || [])) addRect(transition.col ?? transition.x, transition.row ?? transition.y, transition.w, transition.h);
    for (const locale of (workspace?.localeInstances || [])) {
      for (const object of (locale.objects || [])) addRect(object.x ?? object.col, object.y ?? object.row, object.w, object.h);
    }
    return blockers;
  }

  function tileIsWalkable(map, col, row, blockers) {
    const tile = tileAt(map, col, row); // Candidate terrain record used for collision/terrain rejection.
    if (!tile) return false;
    const type = String(tile.type || '').toLowerCase(); // Compared against obviously impassable exported terrain kinds.
    if (NON_WALKABLE_TILE_TYPES.has(type) || tile.water || tile.waterfall || tile.incline) return false;
    if (tile.generatedObjectId || tile.generatedObjectType) return false;
    return !(blockers || []).some(rect => rectContains(rect, col, row));
  }

  function farEnoughFromThreats(col, row, threats, clearance) {
    return !(threats || []).some(threat => distanceToRect(col, row, threat) < clearance);
  }

  function quadrantBounds(map, totem) {
    const midX = Math.floor(map.cols / 2); // Used to preserve the generator's one-checkpoint-per-quadrant distribution.
    const midY = Math.floor(map.rows / 2); // Used with midX when limiting relocation candidates.
    const left = Number(totem.x) < midX;
    const top = Number(totem.y) < midY;
    return {
      minX: Math.max(1, left ? 1 : midX),
      maxX: Math.min(map.cols - 2, left ? midX - 1 : map.cols - 2),
      minY: Math.max(1, top ? 1 : midY),
      maxY: Math.min(map.rows - 2, top ? midY - 1 : map.rows - 2),
    };
  }

  function candidateScore(col, row, original, originalTile, map) {
    const relocationDistance = Math.hypot(col - original.x, row - original.y); // Primary score keeps a moved checkpoint near its original sector landmark.
    const candidateTile = tileAt(map, col, row); // Used for a small same-elevation preference when exported height data is available.
    const originalHeight = Number(originalTile?.elevTier ?? originalTile?.height ?? originalTile?.elevation); // Baseline elevation for the checkpoint before relocation.
    const candidateHeight = Number(candidateTile?.elevTier ?? candidateTile?.height ?? candidateTile?.elevation); // Compared with originalHeight to avoid unnecessary plateau changes.
    const elevationPenalty = Number.isFinite(originalHeight) && Number.isFinite(candidateHeight) ? Math.abs(candidateHeight - originalHeight) * 3 : 0; // Secondary score used after safety rules pass.
    return relocationDistance + elevationPenalty;
  }

  function findSpawnAnchor(map, col, row, blockers, threats, clearance, occupiedTotems) {
    for (let radius = 1; radius <= 4; radius++) {
      const candidates = []; // Sorted to prefer cardinal/nearby spawn tiles around the Root Totem.
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = col + dx, y = row + dy; // Candidate spawn tile used by respawnPlayer via pathAnchor.
          if (!tileIsWalkable(map, x, y, blockers)) continue;
          if (!farEnoughFromThreats(x, y, threats, clearance)) continue;
          if (occupiedTotems.has(`${x},${y}`)) continue;
          candidates.push({ x, y, score: Math.hypot(dx, dy) + (dx !== 0 && dy !== 0 ? 0.2 : 0) });
        }
      }
      candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
      if (candidates.length) return { x: candidates[0].x, y: candidates[0].y };
    }
    return null;
  }

  function relocateRootTotems(workspace, options = {}) {
    const map = rootMap(workspace); // Root exported map supplies the final post-density tile grid.
    const totems = Array.isArray(workspace?.rootTotems) ? workspace.rootTotems : []; // Mutated in place so all downstream layout/render/respawn users see the safer coordinates.
    const clearance = Math.max(1, Number(options.clearanceTiles) || configuredClearanceTiles()); // Shared minimum spacing for static combat POIs.
    const threats = staticCombatThreats(workspace); // Static combat footprints generated before Root Totem post-processing.
    if (!map || !totems.length || !threats.length) {
      return { applied: false, reason: !map ? 'no-root-map' : (!totems.length ? 'no-root-totems' : 'no-static-combat-pois'), clearanceTiles: clearance, moved: 0, total: totems.length };
    }

    const blockers = genericHardBlockers(workspace, map); // Prevents relocation into structures/dens/transitions.
    const occupiedTotems = new Set(totems.map(totem => `${Math.round(Number(totem.x) || 0)},${Math.round(Number(totem.y) || 0)}`)); // Updated after every move so checkpoints never stack.
    let moved = 0; // Reported to the in-game/mobile-visible diagnostics snapshot.

    for (const totem of totems) {
      const original = { x: Math.round(Number(totem.x) || 0), y: Math.round(Number(totem.y) || 0) }; // Preserved for same-quadrant bounds and movement diagnostics.
      const originalTile = tileAt(map, original.x, original.y); // Used only for the candidate elevation preference.
      const originalAnchor = totem.pathAnchor && Number.isFinite(Number(totem.pathAnchor.x)) && Number.isFinite(Number(totem.pathAnchor.y))
        ? { x: Math.round(Number(totem.pathAnchor.x)), y: Math.round(Number(totem.pathAnchor.y)) }
        : null; // Existing spawn tile is checked independently because it can be one tile closer to danger than the Totem itself.
      const originalIsSafe = tileIsWalkable(map, original.x, original.y, blockers)
        && farEnoughFromThreats(original.x, original.y, threats, clearance)
        && (!originalAnchor || (tileIsWalkable(map, originalAnchor.x, originalAnchor.y, blockers) && farEnoughFromThreats(originalAnchor.x, originalAnchor.y, threats, clearance)));
      if (originalIsSafe) continue;

      occupiedTotems.delete(`${original.x},${original.y}`);
      const bounds = quadrantBounds(map, original); // Limits candidate search to the checkpoint's original quadrant.
      const candidates = []; // Safe walkable Root Totem tiles ranked by minimum disruption to the original generated placement.
      for (let row = bounds.minY; row <= bounds.maxY; row++) {
        for (let col = bounds.minX; col <= bounds.maxX; col++) {
          if (!tileIsWalkable(map, col, row, blockers)) continue;
          if (!farEnoughFromThreats(col, row, threats, clearance)) continue;
          if (occupiedTotems.has(`${col},${row}`)) continue;
          const anchor = findSpawnAnchor(map, col, row, blockers, threats, clearance, occupiedTotems); // Ensures the actual revive position is safe too.
          if (!anchor) continue;
          candidates.push({ col, row, anchor, score: candidateScore(col, row, original, originalTile, map) });
        }
      }
      candidates.sort((a, b) => a.score - b.score || a.row - b.row || a.col - b.col);
      const best = candidates[0] || null; // Applied below; null deliberately leaves the original rather than moving to invalid terrain.
      if (!best) {
        occupiedTotems.add(`${original.x},${original.y}`);
        continue;
      }
      totem.x = best.col;
      totem.y = best.row;
      totem.pathAnchor = { x: best.anchor.x, y: best.anchor.y };
      occupiedTotems.add(`${best.col},${best.row}`);
      moved++;
    }

    return { applied: true, clearanceTiles: clearance, moved, total: totems.length, threatCount: threats.length };
  }

  function rememberWorkspace(workspace, zoneId = null) {
    if (!workspace || typeof workspace !== 'object') return null;
    let record = recordByWorkspace.get(workspace); // Reused when the zone-specific wrapper sees the same workspace a second time.
    if (!record) {
      record = { workspace, zoneId: null, rootTotems: workspace.rootTotems || [] };
      recordByWorkspace.set(workspace, record);
      registryRecords.add(record);
    }
    if (zoneId) record.zoneId = zoneId;
    record.rootTotems = workspace.rootTotems || [];
    return record;
  }

  function applyWorkspace(workspace, options = {}) {
    if (!workspace || typeof workspace !== 'object') return { applied: false, reason: 'no-workspace' };
    let report = workspace.rootTotemSafety; // Reused on nested generator wrappers to keep relocation idempotent.
    if (!report || report.version !== 1) {
      const relocation = relocateRootTotems(workspace, options); // The only step that changes generated Root Totem coordinates.
      report = { version: 1, ...relocation };
      workspace.rootTotemSafety = report;
      state.workspacesChecked++;
      state.totemsMoved += Number(report.moved) || 0;
      state.lastWorkspaceReport = report;
      if (report.moved > 0) {
        const logger = root.__farmLog || console.log; // Uses the existing in-game debug log when available so mobile testing does not require devtools.
        try { logger(`[root-totem-safety] moved ${report.moved}/${report.total} checkpoint(s); combat clearance ${report.clearanceTiles} tiles.`, 'info'); } catch {}
      }
    }
    rememberWorkspace(workspace, options.zoneId || null);
    return report;
  }

  function installGeneratorAdapter(generator = root.WildernessMapGenerator) {
    if (!generator || generator.__rootTotemSafetyInstalled) return false;
    generator.__rootTotemSafetyInstalled = true;
    if (typeof generator.generateWorkspace === 'function') {
      const originalGenerateWorkspace = generator.generateWorkspace.bind(generator); // Called by the wrapper before static combat clearance is applied.
      generator.generateWorkspace = (seed, overrides) => {
        const workspace = originalGenerateWorkspace(seed, overrides); // Base generator output kept intact except for Root Totem coordinates/pathAnchor.
        applyWorkspace(workspace, {});
        return workspace;
      };
    }
    if (typeof generator.generateZoneWorkspace === 'function') {
      const originalGenerateZoneWorkspace = generator.generateZoneWorkspace.bind(generator); // Preserves zone id so temporary-locale matching can use a stable registry record.
      generator.generateZoneWorkspace = (zoneMapId, seed, locales) => {
        const workspace = originalGenerateZoneWorkspace(zoneMapId, seed, locales); // May already have been normalized by generateWorkspace; applyWorkspace is idempotent.
        applyWorkspace(workspace, { zoneId: zoneMapId });
        return workspace;
      };
    }
    return true;
  }

  function scoreTotemSetAgainstZone(zone, totems) {
    let score = 0; // Used to identify which generated layout a TemporaryLocales view was copied from.
    for (const totem of (totems || [])) {
      const col = Math.round(Number(totem.x));
      const row = Math.round(Number(totem.y));
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      if (zone?.tiles?.[row]?.[col]?.occupiedBy) score++;
    }
    return score;
  }

  function debugLayoutTotemSets() {
    const candidates = []; // Fallback for cached workspaces that were loaded without running the generator adapter this session.
    const debug = root.__wildlifeDebug;
    const zoneIds = root.WildernessMapGenerator?.zoneMapIds?.() || [];
    if (!debug?.dumpZone) return candidates;
    for (const zoneId of zoneIds) {
      const snapshot = debug.dumpZone(zoneId); // dumpZone returns the live layout arrays, including cached Root Totems.
      if (snapshot?.rootTotems?.length) candidates.push({ zoneId, rootTotems: snapshot.rootTotems });
    }
    return candidates;
  }

  function rootTotemsForTemporaryZone(zone) {
    const candidates = []; // Combined fresh-generation registry + live cached layout snapshots, scored against the copied zone view.
    for (const record of registryRecords) if (record.rootTotems?.length) candidates.push({ zoneId: record.zoneId, rootTotems: record.rootTotems });
    candidates.push(...debugLayoutTotemSets());
    let best = null, bestScore = 0; // Only a positive occupancy match is accepted; otherwise no potentially-wrong zone is injected.
    for (const candidate of candidates) {
      const score = scoreTotemSetAgainstZone(zone, candidate.rootTotems);
      if (score > bestScore) { best = candidate; bestScore = score; }
    }
    return bestScore > 0 ? { ...best, matchScore: bestScore } : null;
  }

  function mergedAvoidPoints(existing, rootTotems, minDistance) {
    const points = Array.isArray(existing) ? existing.slice() : []; // Keeps caller-specific Porakaneki/Bandit separation rules intact.
    for (const totem of (rootTotems || [])) {
      const col = Number(totem.x), row = Number(totem.y); // Root Totem tile becomes a generic TemporaryLocales keep-away point.
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const duplicate = points.some(point => Number(point?.col) === col && Number(point?.row) === row && Number(point?.minDistance) >= minDistance); // Prevents duplicate points when a caller already supplied an equal/stronger Root Totem rule.
      if (!duplicate) points.push({ col, row, minDistance });
    }
    return points;
  }

  function installTemporaryLocaleAdapter(temporaryLocales = root.TemporaryLocales) {
    if (!temporaryLocales || temporaryLocales.__rootTotemSafetyInstalled || typeof temporaryLocales.stamp !== 'function') return false;
    temporaryLocales.__rootTotemSafetyInstalled = true;
    const originalStamp = temporaryLocales.stamp.bind(temporaryLocales); // Called after combat-oriented locales receive Root Totem avoid points.
    temporaryLocales.stamp = (zone, locale, opts = {}) => {
      if (!localeLooksCombatOriented(locale)) return originalStamp(zone, locale, opts);
      const match = rootTotemsForTemporaryZone(zone); // Resolves the copied zone view back to its live/generated Root Totem set.
      if (!match?.rootTotems?.length) return originalStamp(zone, locale, opts);
      const authoredDistance = Number(locale?.placement?.minDistanceFromRootTotem); // Allows a future combat locale to override the global Root Totem buffer deliberately.
      const minDistance = Number.isFinite(authoredDistance) && authoredDistance > 0 ? authoredDistance : configuredClearanceTiles(); // Shared fallback keeps camps and static threats consistent.
      const nextOpts = { ...opts, avoidPoints: mergedAvoidPoints(opts.avoidPoints, match.rootTotems, minDistance) }; // Passed to TemporaryLocales.findSite through the original stamp implementation.
      state.temporaryCombatSitesProtected++;
      state.lastTemporaryLocaleReport = { localeId: locale?.id || null, category: locale?.category || null, zoneId: match.zoneId || null, rootTotemCount: match.rootTotems.length, minDistance, matchScore: match.matchScore };
      return originalStamp(zone, locale, nextOpts);
    };
    return true;
  }

  function watchGlobal(globalName, installer) {
    if (root[globalName]) { installer(root[globalName]); return; }
    const descriptor = Object.getOwnPropertyDescriptor(root, globalName); // Existing descriptor is respected when another bootstrap shim owns the property.
    if (descriptor && descriptor.configurable === false) return;
    let value = descriptor?.value; // Backing value used until the real global is assigned by its parser-loaded module.
    Object.defineProperty(root, globalName, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return value; },
      set(next) { value = next; installer(next); },
    });
    if (value) installer(value);
  }

  function debugSnapshot() {
    return {
      ...state,
      configuredClearanceTiles: configuredClearanceTiles(),
      registeredWorkspaces: registryRecords.size,
    };
  }

  root.RootTotemSafety = {
    configuredClearanceTiles,
    localeLooksCombatOriented,
    relocateRootTotems,
    applyWorkspace,
    installGeneratorAdapter,
    installTemporaryLocaleAdapter,
    rootTotemsForTemporaryZone,
    debugSnapshot,
  };

  watchGlobal('WildernessMapGenerator', installGeneratorAdapter);
  watchGlobal('TemporaryLocales', installTemporaryLocaleAdapter);
})(typeof window !== 'undefined' ? window : globalThis);
