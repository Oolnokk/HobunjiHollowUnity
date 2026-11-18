// Reusable, deterministic locale riddle composer. A clue only names verified, post-generation terrain.
// No festival dependency: other quests can provide any stamped locale and a zone workspace.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LocaleRiddleGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RHYMES = Object.freeze({ A: ['light', 'sight', 'night', 'bright', 'right', 'daylight', 'flight'], B: ['glow', 'flow', 'below', 'show', 'go', 'slow', 'blow', 'know', 'grow'] }); // Validation and stanza composition share these two exact rhyme families.
  const WATER = new Set(['river', 'stream', 'water', 'lake', 'pond', 'waterfall']); // Map exports and live zones use different water tile spellings.
  const ZONES = Object.freeze({ map_northern_cliffs: 'Northern Cliffs', map_southern_cloud_forest: 'Southern Cloud Forest', map_western_slope: 'Western Slope', map_eastern_mire: 'Eastern Mire' }); // Used for the broadest first line, never inferred from requested terrain.
  const BANK = Object.freeze({
    zone: {
      A: [f => `In ${f.value}, begin your search by the fading light`, f => `The trails of ${f.value} shall guide your sight`, f => `Seek through ${f.value} before the fall of night`],
      B: [f => `Let ${f.value} be the first place you go`, f => `Within ${f.value}, the hidden petals glow`, f => `The land of ${f.value} has more to show`]
    },
    sector: {
      A: [f => `Keep to ${f.value}, and hold your bearing right`, f => `In ${f.value}, follow the morning light`, f => `Search ${f.value} with the stars in sight`],
      B: [f => `Toward ${f.value}, where secret flowers grow`, f => `At ${f.value}, a patient seeker ought to go`, f => `This secret lies in ${f.value}, where tender petals grow`]
    },
    water: {
      A: [f => `With ${f.value}, you are drawing right`, f => `Look for ${f.value} in the daylight`, f => `When ${f.value} shines, hold your course in sight`],
      B: [f => `By ${f.value}, still waters shine and glow`, f => `Find ${f.value}, then let the search go slow`, f => `Beyond ${f.value}, new secrets show`]
    },
    path: {
      A: [f => `Where ${f.value} bends, keep the path in sight`, f => `Along ${f.value}, the stones catch light`, f => `Find ${f.value} before the night`],
      B: [f => `Follow ${f.value}, where the footsteps go`, f => `Beside ${f.value}, let your pace grow slow`, f => `Past ${f.value}, the wind will blow`]
    },
    landmark: {
      A: [f => `Near ${f.value}, your search comes right`, f => `Keep ${f.value} within your sight`, f => `Beside ${f.value}, watch for colored light`],
      B: [f => `By ${f.value}, a hidden wonder may show`, f => `Where ${f.value}, your path should go`, f => `Beyond ${f.value}, the petals glow`]
    },
    tree: {
      A: [f => `Find the tree of ${f.value}, where petals catch the light`, f => `The ${f.value} tree will end your flight`, f => `Beneath ${f.value} blooms, your answer shines bright`],
      B: [f => `The tree of ${f.value} is what you ought to know`, f => `At the ${f.value} tree, the final colors glow`, f => `Seek ${f.value} petals, not the grass below`]
    },
    distance: {
      A: [f => `Count ${f.value} beneath the light`, f => `Mark ${f.value} by the final light`, f => `Measure ${f.value} to keep your bearing right`],
      B: [f => `Walk ${f.value} before the blossoms show`, f => `Seek ${f.value} and let your footsteps slow`, f => `Go ${f.value}, where hidden petals glow`]
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
        if (WATER.has(type) || (Number(t.water) > 0) || t.path === true || type === 'path')
          samples.push({ col: x, row: y, d, type: WATER.has(type) || Number(t.water) > 0 ? 'water' : 'path', waterType: type });
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
      const kind = ['river', 'stream', 'waterfall'].includes(water.waterType) ? water.waterType : 'open water';
      facts.push({ kind: 'water', value: `the ${kind} ${bearing(water.col - point.col, water.row - point.row)}`, source: 'post-generation-water-tile', coordinate: { col: water.col, row: water.row }, distance: water.d });
    }
    const path = samples.find(s => s.type === 'path');
    if (path && path.d <= 16) facts.push({ kind: 'path', value: `a trail ${bearing(path.col - point.col, path.row - point.row)}`, source: 'post-generation-path-tile', coordinate: { col: path.col, row: path.row }, distance: path.d });
    const others = (layout.localeInstances || []).filter(other => other !== instance && other.localeId !== instance.localeId && !String(other.localeId || '').startsWith('locale_five_blossoms_')); // Never give away a different blossom as a landmark.
    const landmarks = others.map(other => ({ name: other.name, point: positionOf(other), source: 'stamped-neighbor-locale' })); // Already-stamped locale anchors are authoritative.
    for (const site of (layout.rootTotems || [])) landmarks.push({ name: 'the root totem', point: { col: Number(site.x), row: Number(site.y) }, source: 'generated-root-totem' }); // Uses the existing root-totem placement index.
    for (const site of (layout.animalDens || [])) landmarks.push({ name: 'a wild animal den', point: { col: Number(site.mouthAnchor?.x ?? site.x), row: Number(site.mouthAnchor?.y ?? site.y) }, source: 'generated-animal-den' }); // Use the visible den doorway rather than an assumed footprint center.
    const landmark = landmarks.filter(item => item.name && Number.isFinite(item.point.col) && Number.isFinite(item.point.row))
      .map(item => ({ ...item, d: Math.hypot(item.point.col - point.col, item.point.row - point.row) }))
      .filter(item => item.d <= Math.max(18, radius * 2) && item.d >= 5)
      .sort((a, b) => a.d - b.d)[0]; // Missing optional landmarks simply cannot enter a poem.
    if (landmark) facts.push({ kind: 'landmark', value: `${landmark.name} ${bearing(landmark.point.col - point.col, landmark.point.row - point.row)}`, source: landmark.source, distance: landmark.d });
    if (facts.length < 4) {
      const horizontal = point.col < size.cols / 2
        ? { value: `${Math.round(point.col)} map tiles east of the western boundary`, distance: point.col }
        : { value: `${Math.round(size.cols - 1 - point.col)} map tiles west of the eastern boundary`, distance: size.cols - 1 - point.col }; // Exact final-grid offsets replace misleading "near the border" claims for central sites.
      const vertical = point.row < size.rows / 2
        ? { value: `${Math.round(point.row)} map tiles south of the northern boundary`, distance: point.row }
        : { value: `${Math.round(size.rows - 1 - point.row)} map tiles north of the southern boundary`, distance: size.rows - 1 - point.row }; // The second axis allows triangulation even without rivers, trails, or landmarks.
      facts.push({ kind: 'distance', value: horizontal.value, source: 'final-grid-distance', distance: horizontal.distance });
      facts.push({ kind: 'distance', value: vertical.value, source: 'final-grid-distance', distance: vertical.distance });
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
