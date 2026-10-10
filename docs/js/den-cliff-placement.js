// Den cliff placement — fits procedural animal-den entrances into existing
// plateau cliffs the way Banubu's Cave sits in one, using the den-entrance
// locale templates (category `den_entrance`, edited in the Locale Editor) as
// the rule source: their `terrainAnchors` / `embeddedTiles` say which cells
// must be cliff face, which must sit inside the higher plateau, and which
// must stay free in front of the mouth.
//
// js/locale-terrain-placement.js evaluates the same probe vocabulary for
// stamped locales, but against the exported (density-scaled) workspace after
// generation. Dens are placed by wilderness-map-generator.js on its source
// grid *before* paths/reachability run, so this evaluates the den-relevant
// subset of that vocabulary directly on the generator's live tiles:
//
//   terrain: any | free | ground | plateau | plateauCliff | water
//   facing:  any | north | east | south | west   (plateauCliff only)
//   height:  any | range | relativeRange          (relative to the mouth tier)
//   strength: required | preferred | avoid        (terrainAnchors)
//
// Pure functions only; the generator passes a `tileAt(x, y)` accessor.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DenCliffPlacement = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TEMPLATE_CATEGORY = 'den_entrance';
  const CARDINAL = Object.freeze([
    { dx: 0, dy: -1, facing: 'north' },
    { dx: 1, dy: 0, facing: 'east' },
    { dx: 0, dy: 1, facing: 'south' },
    { dx: -1, dy: 0, facing: 'west' },
  ]);

  function parseKey(key) {
    const [c, r] = String(key).split(',').map(Number);
    return Number.isFinite(c) && Number.isFinite(r) ? { c, r } : null;
  }

  function heightRule(raw) {
    const mode = ['any', 'range', 'relativeRange'].includes(raw?.mode) ? raw.mode : 'any';
    const num = value => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
    return { mode, min: num(raw?.min), max: num(raw?.max) };
  }

  function caveObject(locale) {
    return (locale?.objects || []).find(object => object?.key === 'cave_small' || object?.visual?.renderer === 'cave_small') || null;
  }

  function isTemplate(locale) {
    return locale?.category === TEMPLATE_CATEGORY;
  }

  // Compiles one den-entrance template into den-local offsets (relative to the
  // cave object's top-left, i.e. the den footprint origin). Returns null for a
  // template without cliff rules — those keep the legacy flat placement.
  function compileTemplate(locale) {
    const cave = caveObject(locale);
    if (!cave) return null;
    const originC = Number(cave.col) || 0;
    const originR = Number(cave.row) || 0;
    const w = Math.max(1, Math.round(Number(cave.w) || 1));
    const h = Math.max(1, Math.round(Number(cave.h) || 1));
    const probes = [];
    for (const [key, raw] of Object.entries(locale.terrainAnchors || {})) {
      const cell = parseKey(key);
      if (!cell) continue;
      probes.push({
        dx: cell.c - originC, dy: cell.r - originR,
        terrain: String(raw?.terrain || 'any'),
        facing: String(raw?.facing || 'any'),
        height: heightRule(raw?.height),
        strength: ['required', 'preferred', 'avoid'].includes(raw?.strength) ? raw.strength : 'required',
        weight: Math.max(0.1, Number(raw?.weight) || 1),
      });
    }
    const embedded = [];
    for (const [key, raw] of Object.entries(locale.embeddedTiles || {})) {
      const cell = parseKey(key);
      if (!cell) continue;
      embedded.push({ dx: cell.c - originC, dy: cell.r - originR, terrain: String(raw?.terrain || 'plateau'), facing: 'any', height: heightRule(raw?.height) });
    }
    if (!probes.length && !embedded.length) return null;
    // The first connector is the den's entry tile. It may sit inside the cave
    // footprint (in the arch opening); the column from it to the footprint's
    // front edge then becomes walkable ground (see entryPath).
    const connector = (locale.connectors || [])[0];
    const mouth = connector
      ? { dx: (Number(connector.col) || 0) - originC, dy: (Number(connector.row) || 0) - originR }
      : { dx: Math.floor(w / 2), dy: h };
    return {
      id: String(locale.id || ''),
      w, h, mouth, probes, embedded,
      embeddedKeys: new Set(embedded.map(cell => `${cell.dx},${cell.dy}`)),
      size: w * h,
    };
  }

  function tier(tile) {
    return Number(tile?.elevation) || 0;
  }

  function isBoundary(tile) {
    return !!(tile?.borderEscarpment || tile?.distantBoundaryLandscape);
  }

  // Cliff face at (x, y): the low-side cell of a tier drop facing away from
  // the higher neighbour, or the high-side cell facing toward the lower one —
  // the same reading as locale-terrain-placement's cliffInfo.
  function cliffFacing(tileAt, x, y, facing) {
    const self = tileAt(x, y);
    if (!self) return false;
    for (const dir of CARDINAL) {
      const other = tileAt(x + dir.dx, y + dir.dy);
      if (!other || isBoundary(self) || isBoundary(other)) continue;
      const drop = tier(self) - tier(other);
      if (drop > 0.5 && (facing === 'any' || facing === dir.facing)) return true;
      if (drop < -0.5) {
        const outward = CARDINAL.find(item => item.dx === -dir.dx && item.dy === -dir.dy).facing;
        if (facing === 'any' || facing === outward) return true;
      }
    }
    return false;
  }

  function terrainMatches(tileAt, x, y, rule, floorTier) {
    const tile = tileAt(x, y);
    if (!tile) return false;
    switch (rule.terrain) {
      case 'any': return true;
      case 'water': return !!tile.water;
      case 'ground': return tier(tile) <= 0.05 && !tile.water;
      case 'plateau': return tier(tile) > floorTier + 0.05;
      case 'plateauCliff': return cliffFacing(tileAt, x, y, rule.facing || 'any');
      // Walkable open ground the den never covers: the approach in front of
      // the mouth must stay usable, so cliff skirts, ramps and objects fail.
      case 'free': return !tile.water && !tile.ramp && !tile.occupiedBy && !(tile.cliffSkirt && !tile.waterfall) && !isBoundary(tile) && !tile.plateauRing;
      default: return false;
    }
  }

  function heightMatches(rule, tileTier, floorTier) {
    const height = rule.height;
    if (!height || height.mode === 'any') return true;
    const value = height.mode === 'relativeRange' ? tileTier - floorTier : tileTier;
    if (height.min != null && value < height.min - 0.001) return false;
    if (height.max != null && value > height.max + 0.001) return false;
    return true;
  }

  function probeMatches(tileAt, x, y, rule, floorTier) {
    return terrainMatches(tileAt, x, y, rule, floorTier) && heightMatches(rule, tier(tileAt(x, y)), floorTier);
  }

  // Evaluates a den footprint at (x, y). Returns null when any hard rule
  // fails, else { score, floorTier, mouth }.
  function evaluate(compiled, tileAt, x, y) {
    const mouthTile = tileAt(x + compiled.mouth.dx, y + compiled.mouth.dy);
    if (!mouthTile) return null;
    const floorTier = tier(mouthTile);
    // Footprint: never water/ramp/boundary/occupied; ordinary (non-embedded)
    // cells stand on the mouth's tier, embedded cells are judged below.
    for (let dy = 0; dy < compiled.h; dy++) {
      for (let dx = 0; dx < compiled.w; dx++) {
        const tile = tileAt(x + dx, y + dy);
        if (!tile || tile.water || tile.ramp || tile.occupiedBy || tile.designReserve || isBoundary(tile)) return null;
        if (!compiled.embeddedKeys.has(`${dx},${dy}`) && Math.abs(tier(tile) - floorTier) > 0.05) return null;
      }
    }
    // Walkable entry column from the entry tile out through the footprint's
    // front row: plain floor only (cliff skirts and ramps export as rock/slope).
    for (const step of entryPath(compiled)) {
      const tile = tileAt(x + step.dx, y + step.dy);
      if (!tile || (tile.cliffSkirt && !tile.waterfall) || tile.plateauRing || compiled.embeddedKeys.has(`${step.dx},${step.dy}`)) return null;
    }
    for (const cell of compiled.embedded) {
      if (!probeMatches(tileAt, x + cell.dx, y + cell.dy, cell, floorTier)) return null;
    }
    let score = 0;
    for (const probe of compiled.probes) {
      const matched = probeMatches(tileAt, x + probe.dx, y + probe.dy, probe, floorTier);
      if (probe.strength === 'required' && !matched) return null;
      if (probe.strength === 'avoid' && matched) return null;
      if (probe.strength === 'preferred') score += matched ? probe.weight : -probe.weight * 0.25;
    }
    return { score, floorTier, mouth: { x: x + compiled.mouth.dx, y: y + compiled.mouth.dy } };
  }

  // Footprint cells between an inside entry tile and the front edge, entry included.
  function entryPath(compiled) {
    const { dx, dy } = compiled.mouth;
    if (dx < 0 || dx >= compiled.w || dy < 0 || dy >= compiled.h) return [];
    const cells = [];
    for (let row = dy; row < compiled.h; row++) cells.push({ dx, dy: row });
    return cells;
  }

  // Every valid site for every template over a width×height grid. When two
  // templates fit the same spot the larger one wins, so small caves only
  // appear where the cliff is too short or too thin for the full-size one.
  function findSites(compiledTemplates, tileAt, width, height) {
    const ordered = [...compiledTemplates].filter(Boolean).sort((a, b) => b.size - a.size);
    const sites = [];
    const claimed = new Set();
    for (const compiled of ordered) {
      for (let y = 0; y + compiled.h <= height; y++) {
        for (let x = 0; x + compiled.w <= width; x++) {
          const result = evaluate(compiled, tileAt, x, y);
          if (!result) continue;
          const mouthKey = `${result.mouth.x},${result.mouth.y}`;
          if (claimed.has(mouthKey)) continue;
          claimed.add(mouthKey);
          sites.push({ templateId: compiled.id, x, y, w: compiled.w, h: compiled.h, ...result });
        }
      }
    }
    return sites;
  }

  return { TEMPLATE_CATEGORY, isTemplate, caveObject, compileTemplate, evaluate, findSites, entryPath };
});
