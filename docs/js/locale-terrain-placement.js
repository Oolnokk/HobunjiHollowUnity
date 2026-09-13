// Terrain-aware locale placement for generated wilderness workspaces.
//
// Legacy locales remain owned by wilderness-map-generator.js. Only locales
// with `terrainAnchors` and/or `embeddedTiles` are diverted here, after the
// base wilderness has finished generating. That lets authored landmarks
// search for existing terrain (water, plateau faces, height bands, etc.) and
// optionally carve part of themselves into raised plateau geometry without
// changing the generator's long-standing placement behavior for old content.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.LocaleTerrainPlacement = api;
    if (root.WildernessMapGenerator) api.install(root.WildernessMapGenerator);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CARDINAL = Object.freeze([
    { dx: 0, dy: -1, facing: 'north' },
    { dx: 1, dy: 0, facing: 'east' },
    { dx: 0, dy: 1, facing: 'south' },
    { dx: -1, dy: 0, facing: 'west' },
  ]);

  const WATER_TYPES = new Set(['river', 'stream', 'waterfall']);
  const CLEARABLE_GENERATED_TYPES = new Set([
    'copse', 'tree', 'fallenLog', 'stump', 'bush', 'fruitBush', 'mushroomPatch',
    'beehive', 'foragePlant', 'shrub', 'vegetation', 'diggableRockOre',
    'undiggableBoulder', 'rock', 'rockOutcrop', 'resourceNode', 'flora',
  ]);
  const HARD_BLOCKING_TYPES = new Set([
    'structure', 'caveOpening', 'secretCaveOpening', 'animalDen', 'rootTotem',
    'statue', 'treasureDigspot', 'rareHerb', 'submergedPillar',
  ]);

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function hasTerrainRules(locale) {
    return !!locale && (
      Object.keys(locale.terrainAnchors || {}).length > 0 ||
      Object.keys(locale.embeddedTiles || {}).length > 0
    );
  }

  function parseCellKey(key) {
    const parts = String(key).split(',').map(Number); // Parsed local coordinates are reused by every locale compiler pass.
    return Number.isFinite(parts[0]) && Number.isFinite(parts[1]) ? { c: parts[0], r: parts[1] } : null;
  }

  function rootMap(workspace) {
    if (!workspace || !Array.isArray(workspace.maps)) return null;
    return workspace.maps.find(map => map && !map.isSubmap) || workspace.maps[0] || null;
  }

  function plateauMaps(workspace) {
    const maps = new Map(); // Group id -> plateau submap used when an embedded locale carves or fills that mesa mask.
    for (const map of workspace?.maps || []) {
      if (map?.isSubmap && map.plateauGroupId) maps.set(map.plateauGroupId, map);
    }
    return maps;
  }

  function plateauElevations(workspace) {
    const elevations = new Map(); // Group id -> numeric tier used by terrain/height matching.
    for (const group of workspace?.plateauGroups || []) {
      if (group?.id && Number.isFinite(Number(group.elevation))) elevations.set(group.id, Number(group.elevation));
    }
    return elevations;
  }

  function inferGenerationScale(workspace, sourceWidth) {
    const map = rootMap(workspace); // Root dimensions allow direct scale inference in standalone lab generation.
    const width = Number(sourceWidth);
    if (map && Number.isFinite(width) && width > 0) {
      const ratio = map.cols / width; // Existing generator expands each source tile into a square block (normally 2x).
      if (Number.isFinite(ratio) && ratio >= 1 && Math.abs(ratio - Math.round(ratio)) < 0.001) return Math.round(ratio);
    }
    const note = String(map?.generatedFrom?.note || ''); // Zone-generation calls do not expose sourceWidth, so reuse the generator's exported note.
    const match = note.match(/after\s+([0-9]+(?:\.[0-9]+)?)x\s+tile-density/i);
    if (match) return Math.max(1, Math.round(Number(match[1]) || 1));
    return 2;
  }

  function sourceKey(c, r) { return `${c},${r}`; }

  function scaledCellEntries(record, scale, transformValue) {
    const output = new Map(); // Expanded final-grid cells make terrain-aware locales match legacy locale physical scale.
    for (const [key, raw] of Object.entries(record || {})) {
      const parsed = parseCellKey(key);
      if (!parsed) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const c = parsed.c * scale + dx; // Final-grid local column used directly against exported wilderness coordinates.
          const r = parsed.r * scale + dy; // Final-grid local row used directly against exported wilderness coordinates.
          output.set(sourceKey(c, r), { c, r, sourceC: parsed.c, sourceR: parsed.r, value: transformValue ? transformValue(raw) : raw });
        }
      }
    }
    return output;
  }

  function normalizeHeightRule(raw) {
    const mode = ['any', 'range', 'relativeRange'].includes(raw?.mode) ? raw.mode : 'any'; // Editor-compatible height mode used during constraint evaluation.
    const min = raw?.min == null || raw?.min === '' ? null : Number(raw.min); // Optional lower bound used by range/relativeRange.
    const max = raw?.max == null || raw?.max === '' ? null : Number(raw.max); // Optional upper bound used by range/relativeRange.
    return { mode, min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null };
  }

  function normalizeProbe(raw, embedded) {
    const rule = {
      terrain: ['any', 'water', 'river', 'stream', 'plateau', 'plateauCliff', 'boundaryCliff', 'ground', 'free'].includes(raw?.terrain) ? raw.terrain : (embedded ? 'plateau' : 'plateauCliff'),
      facing: ['any', 'north', 'east', 'south', 'west'].includes(raw?.facing) ? raw.facing : 'any',
      height: normalizeHeightRule(raw?.height),
    }; // Shared normalized constraint record used by candidate scoring and diagnostics.
    if (embedded) rule.carveToLocaleFloor = raw?.carveToLocaleFloor !== false;
    else {
      rule.strength = ['required', 'preferred', 'avoid'].includes(raw?.strength) ? raw.strength : 'required';
      rule.weight = Math.max(0.1, Number(raw?.weight) || 1);
    }
    return rule;
  }

  function compileLocale(locale, scale) {
    const tiles = scaledCellEntries(locale.tiles, scale, raw => ({ type: raw?.type || 'grass' })); // Expanded generated footprint tiles painted after a site is selected.
    const probes = scaledCellEntries(locale.terrainAnchors, scale, raw => normalizeProbe(raw, false)); // Expanded non-generating environmental probes.
    const embedded = scaledCellEntries(locale.embeddedTiles, scale, raw => normalizeProbe(raw, true)); // Expanded footprint cells that must overlap host terrain.
    const all = [...tiles.values(), ...probes.values(), ...embedded.values()]; // Every authored point constrains legal anchor bounds.
    if (!all.length || !tiles.size) return null;
    const minC = Math.min(...all.map(cell => cell.c)); // Minimum local C used to derive anchor scan limits.
    const minR = Math.min(...all.map(cell => cell.r)); // Minimum local R used to derive anchor scan limits.
    const maxC = Math.max(...all.map(cell => cell.c)); // Maximum local C used to derive anchor scan limits.
    const maxR = Math.max(...all.map(cell => cell.r)); // Maximum local R used to derive anchor scan limits.
    const footprintValues = [...tiles.values()]; // Generated footprint bounds drive clearance rather than distant probes.
    const footprint = {
      minC: Math.min(...footprintValues.map(cell => cell.c)),
      minR: Math.min(...footprintValues.map(cell => cell.r)),
      maxC: Math.max(...footprintValues.map(cell => cell.c)),
      maxR: Math.max(...footprintValues.map(cell => cell.r)),
    }; // Final-grid local footprint bounds used for clearance checks and diagnostics.
    return { locale, scale, tiles, probes, embedded, bounds: { minC, minR, maxC, maxR }, footprint };
  }

  function tileRecord(map, c, r) {
    if (!map || c < 0 || r < 0 || c >= map.cols || r >= map.rows) return null;
    return map.tiles?.[sourceKey(c, r)] || null;
  }

  function tileTier(context, c, r) {
    const tile = tileRecord(context.root, c, r); // Root tile record provides ramp metadata and plateau-group membership.
    if (!tile) return 0;
    if (Number.isFinite(Number(tile.rampElevation))) return Number(tile.rampElevation);
    const groupTier = context.plateauElev.get(tile.plateau); // Exported plateau id resolves through workspace.plateauGroups.
    if (Number.isFinite(groupTier)) return groupTier;
    return 0;
  }

  function tileGeneratedType(tile) { return tile?.generatedObjectType || null; }

  function tileGeneratedId(tile) { return tile?.generatedObjectId || null; }

  function waterKind(tile) {
    const type = tile?.type;
    return WATER_TYPES.has(type) ? type : null;
  }

  function isBoundaryCliffTile(tile) {
    return !!(tile?.borderEscarpment || tile?.generatedBorderEscarpment || tile?.distantBoundaryLandscape); // Exported generator metadata distinguishes perimeter escarpments from ordinary plateau mass.
  }

  function cliffInfo(context, c, r, requestedKind = 'any', requestedFacing = 'any') {
    const selfTile = tileRecord(context.root, c, r); // Boundary classification must inspect both sides of the height break, not only the sampled cell.
    const selfTier = tileTier(context, c, r); // Candidate cell tier anchors comparisons to its four orthogonal neighbors.
    let best = null; // Largest matching local tier drop identifies the requested face/facing direction.
    for (const direction of CARDINAL) {
      const neighborC = c + direction.dx;
      const neighborR = r + direction.dy;
      const neighborTile = tileRecord(context.root, neighborC, neighborR);
      const neighborTier = tileTier(context, neighborC, neighborR); // Adjacent tier used to detect either side of a cliff.
      const kind = (isBoundaryCliffTile(selfTile) || isBoundaryCliffTile(neighborTile)) ? 'boundary' : 'plateau'; // Any face touching exported boundary-escarpment terrain belongs to the wilderness perimeter, even when sampled from its low side.
      if (requestedKind !== 'any' && kind !== requestedKind) continue;
      const drop = selfTier - neighborTier;
      if (drop > 0.5) {
        const faceFacing = direction.facing;
        if (requestedFacing !== 'any' && faceFacing !== requestedFacing) continue;
        if (!best || drop > best.drop) best = { drop, facing: faceFacing, highTier: selfTier, lowTier: neighborTier, kind };
      }
      if (drop < -0.5) {
        const outwardFacing = CARDINAL.find(item => item.dx === -direction.dx && item.dy === -direction.dy)?.facing || 'any'; // Low-side cell still inherits the face direction pointing away from the higher neighbor.
        if (requestedFacing !== 'any' && outwardFacing !== requestedFacing) continue;
        const inverseDrop = -drop;
        if (!best || inverseDrop > best.drop) best = { drop: inverseDrop, facing: outwardFacing, highTier: neighborTier, lowTier: selfTier, kind };
      }
    }
    return best;
  }

  function terrainMatches(context, c, r, terrain) {
    const tile = tileRecord(context.root, c, r); // Root tile metadata defines generated terrain type and object occupancy.
    if (!tile) return false;
    const tier = tileTier(context, c, r); // Resolved numeric tier handles plateau submaps correctly.
    const water = waterKind(tile); // Water classifier is shared by water/river/stream constraints.
    switch (terrain) {
      case 'any': return true;
      case 'water': return !!water;
      case 'river': return tile.type === 'river';
      case 'stream': return tile.type === 'stream';
      case 'plateau': return tier > 0.05 || !!tile.plateau;
      case 'plateauCliff': return !!cliffInfo(context, c, r, 'plateau');
      case 'boundaryCliff': return !!cliffInfo(context, c, r, 'boundary');
      case 'ground': return tier <= 0.05 && !water;
      case 'free': return !water && tile.type !== 'ramp' && !tileGeneratedId(tile);
      default: return false;
    }
  }

  function facingMatches(context, c, r, facing, terrain = 'any') {
    if (!facing || facing === 'any') return true;
    const requestedKind = terrain === 'plateauCliff' ? 'plateau' : terrain === 'boundaryCliff' ? 'boundary' : 'any'; // Facing must be read from the same cliff class that satisfied the terrain rule.
    return !!cliffInfo(context, c, r, requestedKind, facing); // A corner may expose two equal faces, so ask for the authored direction instead of trusting one arbitrary dominant edge.
  }

  function heightMatches(rule, hostTier, localeFloorTier) {
    const height = rule?.height || { mode: 'any' }; // Normalized rule is compared either absolutely or relative to the selected locale floor.
    if (height.mode === 'any') return true;
    const value = height.mode === 'relativeRange' ? hostTier - localeFloorTier : hostTier; // Relative range lets caves ask for “plateau N tiers above my floor.”
    if (height.min != null && value < height.min - 0.001) return false;
    if (height.max != null && value > height.max + 0.001) return false;
    return true;
  }

  function constraintMatch(context, worldC, worldR, rule, localeFloorTier) {
    const terrain = terrainMatches(context, worldC, worldR, rule.terrain); // Terrain class match is the first/cheapest constraint gate.
    const facing = terrain && facingMatches(context, worldC, worldR, rule.facing, rule.terrain); // Facing is resolved inside the same plateau-vs-boundary cliff class as the terrain match.
    const hostTier = tileTier(context, worldC, worldR); // Resolved host tier is returned for diagnostics and embedded carve tests.
    const height = facing && heightMatches(rule, hostTier, localeFloorTier); // Height range is evaluated only after terrain/facing succeeded.
    return { matched: !!(terrain && facing && height), terrain, facing, height, hostTier };
  }

  function ordinaryFootprintCells(compiled) {
    const output = []; // Footprint cells not marked embedded establish the locale's own walkable floor tier.
    for (const cell of compiled.tiles.values()) if (!compiled.embedded.has(sourceKey(cell.c, cell.r))) output.push(cell);
    return output;
  }

  function chooseLocaleFloor(context, compiled, anchorC, anchorR) {
    const ordinary = ordinaryFootprintCells(compiled); // Non-embedded cells represent the approach/interior floor rather than host mass being carved away.
    const sample = ordinary.length ? ordinary : [...compiled.tiles.values()];
    const tiers = sample.map(cell => tileTier(context, anchorC + cell.c, anchorR + cell.r)); // Host tiers under floor cells determine the stamped locale's floor.
    if (!tiers.length) return { tier: 0, spread: 0, groupId: null };
    const counts = new Map(); // Rounded tier frequency selects a stable floor in mildly noisy/ramp-adjacent terrain.
    for (const tier of tiers) {
      const key = Number(tier.toFixed(2));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let floorTier = tiers[0]; // Most common host tier becomes locale floor; ties keep the earliest encountered tier.
    let floorCount = -1;
    for (const [tier, count] of counts) if (count > floorCount) { floorCount = count; floorTier = Number(tier); }
    const minTier = Math.min(...tiers); // Tier spread enforces legacy-like flatness on the ordinary footprint when requested.
    const maxTier = Math.max(...tiers);
    let groupId = null; // Matching plateau group lets a raised-floor cave carve into a higher mesa while staying on its lower shelf.
    for (const cell of sample) {
      const worldC = anchorC + cell.c;
      const worldR = anchorR + cell.r;
      const tile = tileRecord(context.root, worldC, worldR);
      if (tile?.plateau && Math.abs(tileTier(context, worldC, worldR) - floorTier) <= 0.05) { groupId = tile.plateau; break; }
    }
    return { tier: floorTier, spread: maxTier - minTier, groupId };
  }

  function objectBlockingReason(tile) {
    const type = tileGeneratedType(tile); // Generated object type decides whether terrain-aware placement may clear the occupant.
    if (!type) return null;
    if (CLEARABLE_GENERATED_TYPES.has(type)) return null;
    if (HARD_BLOCKING_TYPES.has(type)) return `occupied by ${type}`;
    return `occupied by generated ${type}`;
  }

  function localTileCanCoverHost(localType, hostTile) {
    if (!hostTile) return false;
    const hostType = hostTile.type || 'grass'; // Existing exported terrain protects routes/water/ramps from accidental grass stamping.
    if (hostType === 'ramp' && localType !== 'ramp') return false;
    if (WATER_TYPES.has(hostType) && !WATER_TYPES.has(localType)) return false;
    if (hostType === 'path' && localType !== 'path') return false;
    return true;
  }

  function inSameEntrySector(context, anchorC, anchorR, compiled) {
    const entry = context.workspace?.entry; // Generated entry defines the 3x3 sector used by sameSectorAsEntry.
    if (!entry) return true;
    const placement = compiled.locale.placement || {};
    if (!placement.sameSectorAsEntry) return true;
    const centerC = anchorC + (compiled.footprint.minC + compiled.footprint.maxC + 1) * 0.5; // Locale footprint center is compared to entry sector, matching old placement intent.
    const centerR = anchorR + (compiled.footprint.minR + compiled.footprint.maxR + 1) * 0.5;
    const sectorW = context.root.cols / 3;
    const sectorH = context.root.rows / 3;
    return Math.floor(centerC / sectorW) === clamp(Math.floor(entry.col / sectorW), 0, 2)
      && Math.floor(centerR / sectorH) === clamp(Math.floor(entry.row / sectorH), 0, 2);
  }

  function evaluateCandidate(context, compiled, anchorC, anchorR) {
    const placement = compiled.locale.placement || {}; // Locale placement settings still apply around new environmental constraints.
    if (!inSameEntrySector(context, anchorC, anchorR, compiled)) return { ok: false, reason: 'outside entry sector' };

    const floor = chooseLocaleFloor(context, compiled, anchorC, anchorR); // Candidate floor tier is needed before relative-height probes can be evaluated.
    if (placement.requiresFlatGround !== false && floor.spread > 0.05) return { ok: false, reason: `ordinary footprint not flat (spread ${floor.spread.toFixed(2)})`, floorTier: floor.tier };

    const entry = context.workspace?.entry; // Entry distance rule is measured in final exported tiles.
    const minDistance = Math.max(0, Number(placement.minDistanceFromEntry) || 0) * compiled.scale;
    if (entry && minDistance > 0) {
      const centerC = anchorC + (compiled.footprint.minC + compiled.footprint.maxC + 1) * 0.5;
      const centerR = anchorR + (compiled.footprint.minR + compiled.footprint.maxR + 1) * 0.5;
      if (Math.hypot(centerC - entry.col, centerR - entry.row) < minDistance) return { ok: false, reason: 'too close to zone entry', floorTier: floor.tier };
    }

    const footprintDiagnostics = []; // Per-cell host details are kept for the wilderness preview overlay/debugger.
    for (const cell of compiled.tiles.values()) {
      const worldC = anchorC + cell.c;
      const worldR = anchorR + cell.r;
      const host = tileRecord(context.root, worldC, worldR);
      if (!host) return { ok: false, reason: 'footprint out of bounds', floorTier: floor.tier };
      const blocking = objectBlockingReason(host);
      if (blocking) return { ok: false, reason: blocking, floorTier: floor.tier, failAt: { c: worldC, r: worldR } };
      if (!localTileCanCoverHost(cell.value.type, host) && !compiled.embedded.has(sourceKey(cell.c, cell.r))) {
        return { ok: false, reason: `footprint would overwrite ${host.type}`, floorTier: floor.tier, failAt: { c: worldC, r: worldR } };
      }
      footprintDiagnostics.push({ c: worldC, r: worldR, hostTier: tileTier(context, worldC, worldR), localType: cell.value.type });
    }

    let score = 0; // Preferred probes accumulate score; required/avoid probes remain hard gates.
    const probeDiagnostics = [];
    for (const cell of compiled.probes.values()) {
      const worldC = anchorC + cell.c;
      const worldR = anchorR + cell.r;
      const match = constraintMatch(context, worldC, worldR, cell.value, floor.tier);
      const diagnostic = { c: worldC, r: worldR, sourceC: cell.sourceC, sourceR: cell.sourceR, rule: cell.value, ...match };
      probeDiagnostics.push(diagnostic);
      if (cell.value.strength === 'required' && !match.matched) return { ok: false, reason: `required ${cell.value.terrain} probe failed`, floorTier: floor.tier, failAt: { c: worldC, r: worldR }, probes: probeDiagnostics };
      if (cell.value.strength === 'avoid' && match.matched) return { ok: false, reason: `avoid ${cell.value.terrain} probe matched`, floorTier: floor.tier, failAt: { c: worldC, r: worldR }, probes: probeDiagnostics };
      if (cell.value.strength === 'preferred') score += match.matched ? cell.value.weight : -cell.value.weight * 0.25;
    }

    const embeddedDiagnostics = [];
    for (const cell of compiled.embedded.values()) {
      const worldC = anchorC + cell.c;
      const worldR = anchorR + cell.r;
      const match = constraintMatch(context, worldC, worldR, cell.value, floor.tier);
      const diagnostic = { c: worldC, r: worldR, sourceC: cell.sourceC, sourceR: cell.sourceR, rule: cell.value, ...match };
      embeddedDiagnostics.push(diagnostic);
      if (!match.matched) return { ok: false, reason: `embedded ${cell.value.terrain} host failed`, floorTier: floor.tier, failAt: { c: worldC, r: worldR }, probes: probeDiagnostics, embedded: embeddedDiagnostics };
      if (cell.value.carveToLocaleFloor && match.hostTier <= floor.tier + 0.05) {
        return { ok: false, reason: 'embedded carve host is not above locale floor', floorTier: floor.tier, failAt: { c: worldC, r: worldR }, probes: probeDiagnostics, embedded: embeddedDiagnostics };
      }
    }

    const clearance = Math.max(0, Math.round(Number(placement.clearanceTiles) || 0)) * compiled.scale; // Final-grid clearance mirrors the generator's density expansion.
    if (clearance > 0) {
      const x0 = anchorC + compiled.footprint.minC - clearance;
      const y0 = anchorR + compiled.footprint.minR - clearance;
      const x1 = anchorC + compiled.footprint.maxC + clearance;
      const y1 = anchorR + compiled.footprint.maxR + clearance;
      for (let r = y0; r <= y1; r++) {
        for (let c = x0; c <= x1; c++) {
          if (c < 0 || r < 0 || c >= context.root.cols || r >= context.root.rows) return { ok: false, reason: 'clearance reaches map edge', floorTier: floor.tier };
          const localC = c - anchorC;
          const localR = r - anchorR;
          if (compiled.tiles.has(sourceKey(localC, localR))) continue;
          const host = tileRecord(context.root, c, r);
          const blocking = objectBlockingReason(host);
          if (blocking) return { ok: false, reason: `clearance ${blocking}`, floorTier: floor.tier, failAt: { c, r } };
        }
      }
    }

    return { ok: true, score, floorTier: floor.tier, floorGroupId: floor.groupId, probes: probeDiagnostics, embedded: embeddedDiagnostics, footprint: footprintDiagnostics };
  }

  function hashText(text) {
    let hash = 2166136261; // FNV-1a hash provides deterministic tie-breaking without reaching into the generator's private RNG.
    for (const char of String(text)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }

  function candidateTie(seed, localeId, c, r) {
    return hashText(`${seed}|${localeId}|${c}|${r}`) / 4294967296; // Stable fractional noise keeps equally valid placements distributed between Tothal Shift seeds.
  }

  function findCandidate(context, compiled, options = {}) {
    const rejected = []; // Small capped sample is exported for preview diagnostics without bloating workspaces.
    const maxRejected = Math.max(0, Number(options.maxRejectedDiagnostics) || 48);
    let best = null; // Highest preferred-probe score wins; deterministic tie noise breaks equal scores.
    let tested = 0;
    let valid = 0;
    const step = Math.max(1, compiled.scale); // Source-tile alignment preserves the same grid phase as legacy pre-density locale stamping.
    const minAnchorC = -compiled.bounds.minC;
    const minAnchorR = -compiled.bounds.minR;
    const maxAnchorC = context.root.cols - 1 - compiled.bounds.maxC;
    const maxAnchorR = context.root.rows - 1 - compiled.bounds.maxR;
    for (let anchorR = minAnchorR; anchorR <= maxAnchorR; anchorR += step) {
      for (let anchorC = minAnchorC; anchorC <= maxAnchorC; anchorC += step) {
        tested++;
        const result = evaluateCandidate(context, compiled, anchorC, anchorR);
        if (!result.ok) {
          if (rejected.length < maxRejected) rejected.push({ anchorC, anchorR, reason: result.reason, floorTier: result.floorTier ?? null, failAt: result.failAt || null, probes: result.probes || [], embedded: result.embedded || [] });
          continue;
        }
        valid++;
        const tie = candidateTie(context.seed, compiled.locale.id, anchorC, anchorR);
        const ranked = { anchorC, anchorR, tie, ...result };
        if (!best || ranked.score > best.score + 1e-9 || (Math.abs(ranked.score - best.score) <= 1e-9 && ranked.tie > best.tie)) best = ranked;
      }
    }
    return { best, rejected, tested, valid };
  }

  function clearGeneratedObject(context, objectId) {
    if (!objectId) return;
    for (const tile of Object.values(context.root.tiles || {})) {
      if (tileGeneratedId(tile) !== objectId) continue;
      delete tile.generatedObjectId;
      delete tile.generatedObjectType;
    }
    if (Array.isArray(context.workspace.objects)) context.workspace.objects = context.workspace.objects.filter(object => object?.id !== objectId);
    if (Array.isArray(context.workspace.furniture)) context.workspace.furniture = context.workspace.furniture.filter(object => object?.generatedObjectId !== objectId && object?.id !== objectId);
  }

  function clearClearableObjectsUnderFootprint(context, compiled, anchorC, anchorR) {
    const ids = new Set(); // Whole generated objects are removed when any of their overlay tiles intersect the locale footprint.
    for (const cell of compiled.tiles.values()) {
      const tile = tileRecord(context.root, anchorC + cell.c, anchorR + cell.r);
      const type = tileGeneratedType(tile);
      if (type && CLEARABLE_GENERATED_TYPES.has(type) && tileGeneratedId(tile)) ids.add(tileGeneratedId(tile));
    }
    for (const id of ids) clearGeneratedObject(context, id);
    return [...ids];
  }

  function removePlateauCell(context, groupId, worldC, worldR) {
    if (!groupId) return;
    const submap = context.plateauMaps.get(groupId); // Plateau submap owns the mesa mask that TerrainPreview converts into visible cliff geometry.
    if (!submap) return;
    const localC = worldC - (Number(submap.anchorC) || 0);
    const localR = worldR - (Number(submap.anchorR) || 0);
    if (localC < 0 || localR < 0 || localC >= submap.cols || localR >= submap.rows) return;
    delete submap.tiles?.[sourceKey(localC, localR)];
  }

  function addPlateauCell(context, groupId, worldC, worldR, type) {
    if (!groupId) return;
    const submap = context.plateauMaps.get(groupId); // Raised locale floors need their carved cell copied into the lower plateau's own mask.
    if (!submap) return;
    const localC = worldC - (Number(submap.anchorC) || 0);
    const localR = worldR - (Number(submap.anchorR) || 0);
    if (localC < 0 || localR < 0 || localC >= submap.cols || localR >= submap.rows) return;
    submap.tiles = submap.tiles || {};
    submap.tiles[sourceKey(localC, localR)] = { type: type || 'grass', crop: '' };
  }

  function paintLocaleTile(context, compiled, selected, cell) {
    const worldC = selected.anchorC + cell.c;
    const worldR = selected.anchorR + cell.r;
    const rootTile = tileRecord(context.root, worldC, worldR);
    if (!rootTile) return;
    const embedded = compiled.embedded.get(sourceKey(cell.c, cell.r)); // Embedded metadata decides whether existing mesa volume is preserved or carved away.
    const oldGroupId = rootTile.plateau || null;
    if (embedded?.value?.carveToLocaleFloor) {
      removePlateauCell(context, oldGroupId, worldC, worldR);
      delete rootTile.plateau;
      delete rootTile.rampElevation;
      delete rootTile.navRamp;
      delete rootTile.navRampId;
      delete rootTile.navRampProgress;
      if (selected.floorGroupId) {
        rootTile.plateau = selected.floorGroupId;
        addPlateauCell(context, selected.floorGroupId, worldC, worldR, cell.value.type);
      }
    } else if (compiled.locale.placement?.groundOnly) {
      removePlateauCell(context, oldGroupId, worldC, worldR);
      delete rootTile.plateau;
      delete rootTile.rampElevation;
    }
    rootTile.type = cell.value.type || 'grass';
    rootTile.crop = rootTile.crop || '';
  }

  function scaledPoint(anchorC, anchorR, scale, point) {
    return {
      ...point,
      x: anchorC + (Number(point?.col) || 0) * scale,
      y: anchorR + (Number(point?.row) || 0) * scale,
    }; // Authored local point converted into final exported wilderness coordinates.
  }

  function localeInstance(compiled, selected) {
    const locale = compiled.locale; // Original locale definition supplies runtime objects/connectors/NPC anchors.
    return {
      localeId: locale.id,
      name: locale.name,
      category: locale.category,
      x: selected.anchorC,
      y: selected.anchorR,
      col: selected.anchorC,
      row: selected.anchorR,
      fixed: false,
      terrainAware: true,
      floorTier: selected.floorTier,
      alwaysVisible: !!locale.placement?.alwaysVisibleOnMap,
      connectors: (locale.connectors || []).map(connector => ({ ...scaledPoint(selected.anchorC, selected.anchorR, compiled.scale, connector), side: connector.side, label: connector.label })),
      npcAnchors: (locale.npcAnchors || []).map(anchor => ({ ...scaledPoint(selected.anchorC, selected.anchorR, compiled.scale, anchor), npcId: anchor.npcId, name: anchor.name, facing: anchor.facing })),
      objects: (locale.objects || []).map(object => ({
        id: object.id, kind: object.kind, key: object.key, label: object.label,
        ...scaledPoint(selected.anchorC, selected.anchorR, compiled.scale, object),
        w: Math.max(1, Number(object.w) || 1) * compiled.scale,
        h: Math.max(1, Number(object.h) || 1) * compiled.scale,
        rot: object.rot || 0,
        interactable: object.interactable ? { ...object.interactable } : undefined,
      })),
    };
  }

  function placeOne(context, locale, options = {}) {
    const scale = Math.max(1, Number(options.scale) || inferGenerationScale(context.workspace, options.sourceWidth)); // Resolved density scale keeps authored dimensions consistent with legacy locale stamping.
    const compiled = compileLocale(locale, scale);
    if (!compiled) return { placed: false, diagnostic: { localeId: locale?.id || 'unknown', status: 'skipped', reason: 'no footprint cells', scale } };
    const search = findCandidate(context, compiled, options);
    if (!search.best) {
      return { placed: false, diagnostic: { localeId: locale.id, name: locale.name, status: 'skipped', reason: 'no terrain-aware placement matched', scale, tested: search.tested, valid: search.valid, rejected: search.rejected } };
    }
    const clearedObjectIds = clearClearableObjectsUnderFootprint(context, compiled, search.best.anchorC, search.best.anchorR); // Clearable clutter is removed before tile metadata is overwritten.
    for (const cell of compiled.tiles.values()) paintLocaleTile(context, compiled, search.best, cell);
    const instance = localeInstance(compiled, search.best); // Runtime consumes the same localeInstances shape used by legacy stamped locales.
    context.workspace.localeInstances = Array.isArray(context.workspace.localeInstances) ? context.workspace.localeInstances : [];
    context.workspace.localeInstances.push(instance);
    return {
      placed: true,
      instance,
      diagnostic: {
        localeId: locale.id,
        name: locale.name,
        status: 'placed',
        scale,
        tested: search.tested,
        valid: search.valid,
        selected: {
          anchorC: search.best.anchorC,
          anchorR: search.best.anchorR,
          floorTier: search.best.floorTier,
          floorGroupId: search.best.floorGroupId || null,
          score: search.best.score,
          probes: search.best.probes || [],
          embedded: search.best.embedded || [],
          footprint: search.best.footprint || [],
        },
        rejected: search.rejected,
        clearedObjectIds,
      },
    };
  }

  function placeTerrainAwareLocales(workspace, locales, options = {}) {
    const root = rootMap(workspace); // Root exported map is the terrain scan/stamp surface.
    if (!root) return workspace;
    const context = {
      workspace,
      root,
      plateauMaps: plateauMaps(workspace),
      plateauElev: plateauElevations(workspace),
      seed: String(options.seed || root.generatedFrom?.seed || workspace.generatedAt || 'terrain-locale'),
    }; // Shared placement context avoids rebuilding plateau lookup maps for every locale.
    const diagnostics = []; // Workspace diagnostics power the Wilderness Lab overlay and mobile-visible debugging.
    for (const locale of locales || []) {
      if (!hasTerrainRules(locale)) continue;
      const result = placeOne(context, locale, options);
      diagnostics.push(result.diagnostic);
    }
    workspace.localeTerrainDiagnostics = diagnostics;
    return workspace;
  }

  function allowedInZone(locale, zoneMapId) {
    const allowed = locale?.placement?.allowedZones; // Empty allowed-zone list preserves the existing “any wilderness zone” convention.
    return !Array.isArray(allowed) || allowed.length === 0 || allowed.includes(zoneMapId);
  }

  function install(generator) {
    if (!generator || generator.__terrainAwareLocalesInstalled) return generator;
    generator.__terrainAwareLocalesInstalled = true;

    const originalGenerateWorkspace = typeof generator.generateWorkspace === 'function' ? generator.generateWorkspace.bind(generator) : null; // Direct lab/custom generation wrapper.
    if (originalGenerateWorkspace) {
      generator.generateWorkspace = function terrainAwareGenerateWorkspace(seedText, overrides = {}) {
        const allLocales = Array.isArray(overrides.locales) ? overrides.locales : []; // Caller-supplied locale list is split so legacy locales still run inside the original generator.
        const terrainLocales = allLocales.filter(hasTerrainRules);
        const legacyLocales = allLocales.filter(locale => !hasTerrainRules(locale));
        const cleanOverrides = terrainLocales.length ? { ...overrides, locales: legacyLocales } : overrides; // Avoids legacy stampLocale seeing a cave that intentionally overlaps terrain.
        const workspace = originalGenerateWorkspace(seedText, cleanOverrides);
        return terrainLocales.length ? placeTerrainAwareLocales(workspace, terrainLocales, { seed: seedText, sourceWidth: cleanOverrides.width }) : workspace;
      };
    }

    const originalGenerateZoneWorkspace = typeof generator.generateZoneWorkspace === 'function' ? generator.generateZoneWorkspace.bind(generator) : null; // Game/Tothal Shift zone wrapper.
    if (originalGenerateZoneWorkspace) {
      generator.generateZoneWorkspace = function terrainAwareGenerateZoneWorkspace(zoneMapId, seedText, locales = []) {
        const eligible = (Array.isArray(locales) ? locales : []).filter(locale => allowedInZone(locale, zoneMapId)); // Match the base generator's allowedZones filtering before splitting modes.
        const terrainLocales = eligible.filter(hasTerrainRules);
        const legacyLocales = eligible.filter(locale => !hasTerrainRules(locale));
        const workspace = originalGenerateZoneWorkspace(zoneMapId, seedText, legacyLocales);
        return terrainLocales.length ? placeTerrainAwareLocales(workspace, terrainLocales, { seed: seedText }) : workspace;
      };
    }
    return generator;
  }

  return {
    install,
    hasTerrainRules,
    compileLocale,
    inferGenerationScale,
    placeTerrainAwareLocales,
    evaluateCandidateForTest(workspace, locale, anchorC, anchorR, options = {}) {
      const scale = Math.max(1, Number(options.scale) || inferGenerationScale(workspace, options.sourceWidth)); // Test hook uses the same compiler/context as production placement.
      const compiled = compileLocale(locale, scale);
      const context = { workspace, root: rootMap(workspace), plateauMaps: plateauMaps(workspace), plateauElev: plateauElevations(workspace), seed: String(options.seed || 'test') };
      return compiled ? evaluateCandidate(context, compiled, anchorC, anchorR) : { ok: false, reason: 'compile failed' };
    },
  };
});
