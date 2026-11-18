// Reusable, deterministic locale riddle composer. A clue only names verified, post-generation terrain.
// No festival dependency: other quests can provide any stamped locale and a zone workspace.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LocaleRiddleGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RHYMES = Object.freeze({ A: ['light', 'sight', 'night', 'bright'], B: ['glow', 'flow', 'below', 'show'] }); // Validation and stanza composition share these two exact rhyme families.
  const WATER = new Set(['river', 'stream', 'water', 'lake', 'pond', 'waterfall']); // Map exports and live zones use different water tile spellings.
  const LARGE_FEATURES = new Set(['structure', 'statue', 'rootTotem', 'caveOpening', 'secretCaveOpening']); // Only named, actually exported landmarks can become clues.
  const ZONES = Object.freeze({ map_northern_cliffs: 'Northern Cliffs', map_southern_cloud_forest: 'Southern Cloud Forest', map_western_slope: 'Western Slope', map_eastern_mire: 'Eastern Mire' }); // Used for the broadest first line, never inferred from requested terrain.
  const BANK = Object.freeze({
    zone: {
      A: [f => `In ${f.value}, begin your search by the fading light`, f => `The trails of ${f.value} shall guide your sight`, f => `Seek through ${f.value} before the fall of night`],
      B: [f => `Let ${f.value} be the first place you go`, f => `Within ${f.value}, the hidden petals glow`, f => `The land of ${f.value} has more to show`]
    },
    sector: {
      A: [f => `Keep to ${f.value}, and hold your bearing right`, f => `In ${f.value}, follow the morning light`, f => `Search ${f.value} with the stars in sight`],
      B: [f => `Toward ${f.value}, where secret flowers grow`, f => `At ${f.value}, a patient seeker ought to go`, f => `The ${f.value} is the place to know`]
    },
    water: {
      A: [f => `With ${f.value}, you are drawing right`, f => `Look for ${f.value} in the daylight`, f => `Where ${f.value}, hold your course in sight`],
      B: [f => `By ${f.value}, still waters shine and glow`, f => `Find ${f.value}, then let the search go slow`, f => `Beyond ${f.value}, new secrets show`]
    },
    path: {
      A: [f => `Where ${f.value}, keep the path in sight`, f => `Along ${f.value}, the stones catch light`, f => `Find ${f.value} before the night`],
      B: [f => `Where ${f.value}, the wandering footsteps go`, f => `At ${f.value}, let your pace grow slow`, f => `Past ${f.value}, the wind will blow`]
    },
    landmark: {
      A: [f => `Near ${f.value}, your search comes right`, f => `Keep ${f.value} within your sight`, f => `Beside ${f.value}, watch for colored light`],
      B: [f => `By ${f.value}, a hidden wonder may show`, f => `Where ${f.value}, your path should go`, f => `Beyond ${f.value}, the petals glow`]
    },
    tree: {
      A: [f => `Find the tree of ${f.value}, where petals catch the light`, f => `The ${f.value} blossom tree will end your flight`, f => `Beneath ${f.value} blooms, your answer shines bright`],
      B: [f => `The tree of ${f.value} is what you ought to know`, f => `At ${f.value} boughs, the final colors glow`, f => `Seek ${f.value} blossoms, not the grass below`]
    },
    edge: {
      A: [f => `Not far from ${f.value}, seek the light`, f => `Keep ${f.value} within your sight`, f => `Toward ${f.value}, go before the night`],
      B: [f => `Remain by ${f.value}, and onward go`, f => `Near ${f.value}, the quiet breezes blow`, f => `Past ${f.value}, the blossoms show`]
    }
  }); // Each verified descriptor has several interchangeable A and B lines with matching terminal sounds.

  function hash(value) {
    let n = 2166136261; // Stable choices make a saved riddle reproducible across browsers and devices.
    for (const c of String(value)) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }
  function tileAt(layout, col, row) {
    const map = layout?.maps?.find?.(m => m.id === 'map_generated_wilderness_root') || layout?.maps?.[0] || layout; // Authored generator workspace, or already folded runtime layout.
    if (col < 0 || row < 0) return null;
    const tiles = map?.tiles;
    if (Array.isArray(tiles)) return tiles[row]?.[col] || null;
    return tiles?.[`${col},${row}`] || null;
  }
  function dimensions(layout) {
    const map = layout?.maps?.find?.(m => m.id === 'map_generated_wilderness_root') || layout?.maps?.[0] || layout; // Coordinates in localeInstances refer to the same final-grid workspace.
    return { cols: Number(map?.cols) || 0, rows: Number(map?.rows) || 0 };
  }
  function positionOf(instance) {
    const tree = (instance?.objects || []).find(o => o.key === 'blossom-tree') || instance?.objects?.[0]; // Use the actual stamped tree position, never only the locale's top-left anchor.
    return { col: Number(tree?.x ?? tree?.col ?? instance?.x ?? instance?.col), row: Number(tree?.y ?? tree?.row ?? instance?.y ?? instance?.row) };
  }
  function sectorAt(col, row, cols, rows) {
    const x = col / cols, y = row / rows;
    const horiz = x < 1 / 3 ? 'western' : x >= 2 / 3 ? 'eastern' : '';
    const vert = y < 1 / 3 ? 'northern' : y >= 2 / 3 ? 'southern' : '';
    return vert && horiz ? `the ${vert}-${horiz} quarter` : vert ? `the ${vert} reaches` : horiz ? `the ${horiz} reaches` : 'the heart of the zone';
  }
  function bearing(dx, dy) {
    const x = dx > 2 ? 'east' : dx < -2 ? 'west' : '';
    const y = dy > 2 ? 'south' : dy < -2 ? 'north' : '';
    return y && x ? `to the ${y}-${x}` : `to the ${y || x || 'nearby'}`;
  }
  function nearbyEvidence(layout, point, radius = 24) {
    const size = dimensions(layout); // Limits actual map reads to the neighborhood, never an expensive full-map scan.
    const samples = []; // Candidate evidence includes only final, existing tiles and their measured distance from the tree.
    const r = Math.max(2, Math.min(48, Math.round(radius)));
    for (let y = Math.max(0, Math.floor(point.row - r)); y <= Math.min(size.rows - 1, Math.ceil(point.row + r)); y++)
      for (let x = Math.max(0, Math.floor(point.col - r)); x <= Math.min(size.cols - 1, Math.ceil(point.col + r)); x++) {
        const d = Math.hypot(x - point.col, y - point.row);
        if (d > r || d < 2) continue;
        const t = tileAt(layout, x, y);
        if (!t) continue;
        const type = String(t.type || '').toLowerCase();
        if (WATER.has(type) || t.water === true || t.path === true || type === 'path')
          samples.push({ col: x, row: y, d, type: WATER.has(type) || t.water === true ? 'water' : 'path', waterType: type });
      }
    samples.sort((a, b) => a.d - b.d || a.row - b.row || a.col - b.col);
    return samples;
  }
  function inspect({ zoneId, zoneName, layout, instance, blossomName = 'unknown', radius = 24 } = {}) {
    const point = positionOf(instance);
    const size = dimensions(layout);
    if (!layout || !instance || !Number.isFinite(point.col) || !Number.isFinite(point.row) ||
      size.cols <= 0 || size.rows <= 0 || point.col < 0 || point.row < 0 || point.col >= size.cols || point.row >= size.rows) return { ok: false, reason: 'missing stamped locale or its final-grid map' };
    const facts = [
      { kind: 'zone', value: zoneName || ZONES[zoneId] || zoneId || 'the wilderness', source: 'zone-id' },
      { kind: 'sector', value: sectorAt(point.col, point.row, size.cols, size.rows), source: 'final-grid-coordinate' }
    ]; // Broad location is always included, even if optional terrain probes found nothing.
    const samples = nearbyEvidence(layout, point, radius);
    const water = samples.find(s => s.type === 'water');
    if (water) {
      const kind = ['river', 'stream', 'waterfall'].includes(water.waterType) ? 'running water' : 'open water';
      facts.push({ kind: 'water', value: `${kind} ${bearing(water.col - point.col, water.row - point.row)}`, source: 'post-generation-water-tile', coordinate: { col: water.col, row: water.row }, distance: water.d });
    }
    const path = samples.find(s => s.type === 'path');
    if (path && path.d <= 16) facts.push({ kind: 'path', value: `a trail ${bearing(path.col - point.col, path.row - point.row)}`, source: 'post-generation-path-tile', coordinate: { col: path.col, row: path.row }, distance: path.d });
    const others = (layout.localeInstances || []).filter(other => other !== instance && other.localeId !== instance.localeId);
    const landmark = others.map(other => ({ name: other.name, point: positionOf(other) }))
      .filter(item => item.name && Number.isFinite(item.point.col) && Number.isFinite(item.point.row))
      .map(item => ({ ...item, d: Math.hypot(item.point.col - point.col, item.point.row - point.row) }))
      .filter(item => item.d <= Math.max(18, radius * 2) && item.d >= 5)
      .sort((a, b) => a.d - b.d)[0]; // No synthetic landmarks: only another real, already-placed locale.
    if (landmark) facts.push({ kind: 'landmark', value: landmark.name, source: 'stamped-neighbor-locale', distance: landmark.d });
    if (facts.length < 4) {
      const edge = [
        { value: 'the northern boundary', distance: point.row },
        { value: 'the southern boundary', distance: size.rows - point.row },
        { value: 'the western boundary', distance: point.col },
        { value: 'the eastern boundary', distance: size.cols - point.col }
      ].sort((a, b) => a.distance - b.distance)[0]; // A real, always-available second-stage bearing when optional terrain features did not spawn.
      facts.push({ kind: 'edge', value: edge.value, source: 'final-grid-distance', distance: edge.distance });
    }
    facts.push({ kind: 'tree', value: blossomName, source: 'stamped-target-tree' });
    return { ok: true, zoneId, point, facts, evidence: { waterFound: !!water, pathFound: !!path, landmarkFound: !!landmark, optionalTerrainFallback: !water && !path && !landmark } };
  }
  function lineFor(fact, rhyme, seed, offset) {
    const choices = BANK[fact.kind]?.[rhyme];
    if (!choices?.length) throw new TypeError('Unknown descriptor: ' + fact.kind);
    return choices[(hash(seed + '|' + fact.kind + '|' + rhyme) + offset) % choices.length](fact);
  }
  function compose({ facts, seed = 'locale-riddle' } = {}) {
    if (!Array.isArray(facts) || facts.length < 2) return null;
    const stanzas = []; // Every stanza is ABAB; the last stanza always specifies the actual target tree.
    for (let i = 0; i < facts.length; i += 2) {
      const first = facts[i], second = facts[i + 1] || facts[facts.length - 1];
      if (first === second) break;
      stanzas.push([
        lineFor(first, 'A', seed + ':' + i, 0) + ',',
        lineFor(second, 'B', seed + ':' + i, 0) + ';',
        lineFor(first, 'A', seed + ':' + i, 1) + ',',
        lineFor(second, 'B', seed + ':' + i, 1) + '.'
      ]); // Paired descriptors describe the same verified surroundings twice, with fresh rhyming phrasing.
    }
    const last = facts[facts.length - 1];
    if (facts.length % 2) {
      const partner = facts[facts.length - 2];
      stanzas.push([lineFor(partner,'A',seed+':end',0)+',',lineFor(last,'B',seed+':end',0)+';',lineFor(partner,'A',seed+':end',1)+',',lineFor(last,'B',seed+':end',1)+'.']);
    }
    return stanzas;
  }
  function validate(result) {
    if (!result?.stanzas?.length) return false;
    return result.stanzas.every(stanza => stanza.length === 4 && stanza.every((line, i) =>
      RHYMES[i % 2 ? 'B' : 'A'].some(word => new RegExp('\\b' + word + '[,;.!?]*$', 'i').test(line))));
  }
  function generate(options = {}) {
    const found = inspect(options);
    if (!found.ok) return found;
    const stanzas = compose({ facts: found.facts, seed: options.seed || `${options.zoneId}:${found.point.col}:${found.point.row}` });
    const result = { ...found, stanzas, text: stanzas.map(lines => lines.join('\n')).join('\n\n') };
    return validate(result) ? result : { ok: false, reason: 'rhyme validation failed', facts: found.facts };
  }
  return Object.freeze({ inspect, compose, generate, validate, positionOf, nearbyEvidence, RHYMES, ZONES });
});
