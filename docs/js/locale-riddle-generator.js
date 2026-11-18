// Reusable, deterministic locale riddle composer. A clue only names verified, post-generation terrain.
// No festival dependency: other quests can provide any stamped locale and a zone workspace.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LocaleRiddleGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RHYMES = Object.freeze({ A: ['stone', 'known', 'shown', 'alone', 'grown', 'thrown', 'own'], B: ['near', 'clear', 'here', 'appear', 'steer'] }); // Permanent terrain vocabulary: neither rhyme family implies a time of day.
  const WATER = new Set(['river', 'stream', 'water', 'lake', 'pond', 'waterfall']); // Map exports and live zones use different water tile spellings.
  const ZONES = Object.freeze({ map_northern_cliffs: 'Northern Cliffs', map_southern_cloud_forest: 'Southern Cloud Forest', map_western_slope: 'Western Slope', map_eastern_mire: 'Eastern Mire' }); // Used for the broadest first line, never inferred from requested terrain.
  const BANK = Object.freeze({
    zone: {
      A: [f => `Begin in ${f.value}, a country well known`, f => `The map names ${f.value}, marked as its own`, f => `Go into ${f.value}; let that name be known`],
      B: [f => `Make for ${f.value}; your search begins here`, f => `Let ${f.value} make the broad course clear`, f => `Seek ${f.value}, and draw the region near`]
    },
    sector: {
      A: [f => `In ${f.value}, seek a mark of stone`, f => `Turn to ${f.value}, where the ground is known`, f => `Keep ${f.value} as the region shown`],
      B: [f => `Aim for ${f.value}; the bounds grow clear`, f => `Within ${f.value}, the search draws near`, f => `Find ${f.value}; let it guide where you steer`]
    },
    water: {
      A: [f => `Seek ${f.value}, along the bank of stone`, f => `Search ${f.value}; the water's course is known`, f => `Look ${f.value}, where a mark may be shown`],
      B: [f => `Keep ${f.value}, and the place draws near`, f => `Stand ${f.value}; the direction is clear`, f => `Look ${f.value}; your next landmark is near`]
    },
    path: {
      A: [f => `Search ${f.value}, where tracks press into stone`, f => `Look ${f.value}; let the direction be known`, f => `Seek ${f.value}, not the roadway alone`],
      B: [f => `Look ${f.value}; the way becomes clear`, f => `Keep ${f.value}, and your search draws near`, f => `Go ${f.value}; let that guide where you steer`]
    },
    landmark: {
      A: [f => `Look ${f.value}; its place is known`, f => `Seek ${f.value}, beside the older stone`, f => `Search ${f.value}; the mark is shown`],
      B: [f => `Keep ${f.value}; the next sign is near`, f => `Stand ${f.value}, and the way grows clear`, f => `Go ${f.value}; let it guide where you steer`]
    },
    boulder: {
      A: [f => `Beyond ${f.value}, the ground is stone`, f => `Search ${f.value}; the rock can be known`, f => `Look ${f.value}, where rough shapes are shown`],
      B: [f => `Go ${f.value}; the rock stands near`, f => `Seek ${f.value}, and the bounds grow clear`, f => `Keep ${f.value}; that is where to steer`]
    },
    blossom: {
      A: [f => `Find ${f.value}, where bright leaves have grown`, f => `Seek ${f.value}, unlike the other trees known`, f => `At ${f.value}, the promised bloom is shown`],
      B: [f => `Look for ${f.value}; its crown shall appear`, f => `Find ${f.value}, and your answer is here`, f => `Reach ${f.value}; the goal is now clear`]
    },
    target: {
      A: [f => `Find ${f.value}; the mark is shown`, f => `Seek ${f.value}, the destination known`, f => `There waits ${f.value}, and that place alone`],
      B: [f => `Find ${f.value}; your answer is here`, f => `Look for ${f.value}; the goal is clear`, f => `Reach ${f.value}, and the end draws near`]
    }
  }); // Each verified descriptor has several interchangeable A and B lines with matching terminal sounds.

  function hash(value) {
    let n = 2166136261; // Stable choices make a saved riddle reproducible across browsers and devices.
    for (const c of String(value)) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }
  const FLAT_TILE_INDEX = new WeakMap(); // Actual runtime _zoneLayouts sometimes store flat {c,r,...} records, unlike merged Map and editor dictionaries.
  function tileAt(layout, col, row) {
    const map = layout?.maps?.find?.(m => m.id === 'map_generated_wilderness_root') || layout?.maps?.[0] || layout; // Authored generator workspace, or already folded runtime layout.
    if (col < 0 || row < 0) return null;
    const tiles = map?.tiles;
    if (Array.isArray(tiles) && Array.isArray(tiles[0])) return tiles[row]?.[col] || null;
    if (Array.isArray(tiles)) {
      let indexed = FLAT_TILE_INDEX.get(tiles);
      if (!indexed) {
        indexed = new Map(tiles.map(t => [String(t.c ?? t.col) + ',' + String(t.r ?? t.row), t]));
        FLAT_TILE_INDEX.set(tiles, indexed);
      }
      return indexed.get(`${col},${row}`) || null;
    }
    if (tiles instanceof Map || typeof tiles?.get === 'function') return tiles.get(`${col},${row}`) || null; // Tothal's real merged wilderness keeps tiles in a Map, unlike the editor's JSON dictionary.
    return tiles?.[`${col},${row}`] || null;
  }
  function dimensions(layout) {
    const map = layout?.maps?.find?.(m => m.id === 'map_generated_wilderness_root') || layout?.maps?.[0] || layout; // Coordinates in localeInstances refer to the same final-grid workspace.
    return { cols: Number(map?.cols) || 0, rows: Number(map?.rows) || 0 };
  }
  function positionOf(instance, objectKey = null) {
    const objects = instance?.objects || []; // Every quest supplies its target object key instead of teaching this reusable module about blossoms.
    const landmark = (objectKey && objects.find(o => o.key === objectKey || o.id === objectKey))
      || instance?.connectors?.[0] || objects[0] || instance; // Generic fallback favors walkable entrances and then authored objects.
    return { col: Number(landmark?.x ?? landmark?.col), row: Number(landmark?.y ?? landmark?.row) };
  }
  function sectorAt(col, row, cols, rows) {
    const x = col / cols, y = row / rows;
    const horiz = x < 1 / 3 ? 'western' : x >= 2 / 3 ? 'eastern' : '';
    const vert = y < 1 / 3 ? 'northern' : y >= 2 / 3 ? 'southern' : '';
    return vert && horiz ? `the ${vert.slice(0,-3)}${horiz.slice(0,-3)} sector` : vert ? `the ${vert} reaches` : horiz ? `the ${horiz} reaches` : 'the heart of the zone';
  }
  function relationship(point, feature, name) {
    const dx = point.col - feature.col, dy = point.row - feature.row; // Describe where to search FROM a visible feature, never where the feature lies from an unknown tree.
    const x = dx > 2 ? 'east' : dx < -2 ? 'west' : '';
    const y = dy > 2 ? 'south' : dy < -2 ? 'north' : '';
    return y || x ? `${y && x ? y + '-' + x : y || x} of ${name}` : `near ${name}`;
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
        const boulder = type === 'rock' && (t.rockKind === 'undiggableBoulder' || t.generatedObjectType === 'undiggableBoulder' || !!t.boulderId); // Only genuine solid, generated boulder formations supply a stone landmark.
        if (WATER.has(type) || (Number(t.water) > 0) || t.path === true || type === 'path' || boulder)
          samples.push({ col:x, row:y, d, type: boulder ? 'boulder' : WATER.has(type) || Number(t.water) > 0 ? 'water' : 'path', waterType:type });
      }
    samples.sort((a, b) => a.d - b.d || a.row - b.row || a.col - b.col);
    return samples;
  }
  function inspect({ zoneId, zoneName, layout, instance, targetObjectKey = null, targetName = null, targetKind = 'target', blossomName = null, landmarks: suppliedLandmarks = [], radius = 24 } = {}) {
    const point = positionOf(instance, targetObjectKey);
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
      facts.push({ kind: 'water', value: relationship(point, water, 'the ' + kind), source: 'post-generation-water-tile', coordinate: { col: water.col, row: water.row }, distance: water.d });
    }
    const path = samples.find(s => s.type === 'path');
    if (path && path.d <= 16) facts.push({ kind: 'path', value: relationship(point, path, 'the trail'), source: 'post-generation-path-tile', coordinate: { col: path.col, row: path.row }, distance: path.d });
    const boulder = samples.find(s => s.type === 'boulder');
    if (boulder) facts.push({ kind:'boulder', value:relationship(point,boulder,'the undiggable boulder'), source:'post-generation-boulder-tile', coordinate:{col:boulder.col,row:boulder.row}, distance:boulder.d });
    const others = (layout.localeInstances || []).filter(other => other !== instance && other.localeId !== instance.localeId && !String(other.localeId || '').startsWith('locale_five_blossoms_')); // Never give away a different blossom as a landmark.
    const landmarks = others.map(other => ({ name: other.name, point: positionOf(other), source: 'stamped-neighbor-locale' })); // Already-stamped locale anchors are authoritative.
    for (const site of (layout.rootTotems || [])) landmarks.push({ name: 'the root totem', point: { col: Number(site.x), row: Number(site.y) }, source: 'generated-root-totem' }); // Uses the existing root-totem placement index.
    for (const site of (layout.animalDens || [])) landmarks.push({ name: 'a wild animal den', point: { col: Number(site.mouthAnchor?.x ?? site.x), row: Number(site.mouthAnchor?.y ?? site.y) }, source: 'generated-animal-den' });
    for (const site of suppliedLandmarks) if (site?.name && site?.point) landmarks.push({ name: String(site.name), point: site.point, source: site.source || 'generated-scenery' }); // Caller supplies only genuinely generated scenery, ruin entrances and cliff doors. // Use the visible den doorway rather than an assumed footprint center.
    const landmark = landmarks.filter(item => item.name && Number.isFinite(item.point.col) && Number.isFinite(item.point.row))
      .map(item => ({ ...item, d: Math.hypot(item.point.col - point.col, item.point.row - point.row) }))
      .filter(item => item.d <= Math.max(18, radius * 2) && item.d >= 5)
      .sort((a, b) => a.d - b.d)[0]; // Missing optional landmarks simply cannot enter a poem.
    if (landmark) facts.push({ kind: 'landmark', value: relationship(point, landmark.point, landmark.name), source: landmark.source, distance: landmark.d });
    // No made-up landmarks and no literal tile counts. Sparse locations simply get a shorter, broader poem.
    facts.push({ kind: targetKind === 'blossom' || blossomName ? 'blossom' : 'target', value: String(targetName || blossomName || instance.name || 'the destination'), source: 'stamped-target-object' }); // Subject wording belongs to the calling quest, not a hard-coded tree.
    return { ok: true, zoneId, point, facts, evidence: { waterFound: !!water, pathFound: !!path, boulderFound: !!boulder, landmarkFound: !!landmark, optionalTerrainFallback: !water && !path && !boulder && !landmark } };
  }
  function lineFor(fact, rhyme, seed, offset) {
    const choices = BANK[fact.kind]?.[rhyme];
    if (!choices?.length) throw new TypeError('Unknown descriptor: ' + fact.kind);
    return choices[(hash(seed + '|' + fact.kind + '|' + rhyme) + offset) % choices.length](fact);
  }
  function compose({ facts, seed = 'locale-riddle' } = {}) {
    if (!Array.isArray(facts) || facts.length < 2) return null;
    const groups = []; // Four distinct facts per ABAB stanza when available; avoid the old twelve-line repetitive verse.
    for (let index = 0; index < facts.length; index += 4) groups.push(facts.slice(index, index + 4));
    if (groups.length > 1 && groups[groups.length - 1].length === 1) {
      const prior = groups[groups.length - 2]; // Keep the final target in a meaningful closing couplet.
      groups[groups.length - 1].unshift(prior[prior.length - 1]);
    }
    return groups.map((group, stanzaIndex) => {
      const lines = group.length >= 4 ? group
        : group.length === 3 ? [group[0], group[1], group[0], group[2]]
        : [group[0], group[1], group[0], group[1]]; // Small tails may repeat one fact, but normal stanzas do not.
      return lines.map((fact, i) => lineFor(fact, i % 2 ? 'B' : 'A', seed + ':' + stanzaIndex, i >= 2 ? 1 : 0)
        + (i === 3 ? '.' : i === 1 ? ';' : ','));
    });
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
