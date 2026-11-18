// Reusable, deterministic locale riddle composer. A clue only names verified, post-generation terrain.
// No festival dependency: other quests can provide any stamped locale and a zone workspace.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LocaleRiddleGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RHYMES = Object.freeze({ A:['stone','known','shown','alone','grown','thrown','own'], B:['near','clear','here','appear','steer'], way:['way','stray','stay','say','away'], ground:['ground','found','bound','around'], side:['guide','side','aside','abide'], place:['place','trace','grace','space','chase'], eyes:['eyes','lies','skies','prize','rise'], door:['door','more','explore','before','lore','store'], tree:['tree','see','key','free'], flow:['flow','show','know','go','grow','slow'] }); // Permanent terrain vocabulary: neither rhyme family implies a time of day.
  const WATER = new Set(['river', 'stream', 'water', 'lake', 'pond', 'waterfall']); // Map exports and live zones use different water tile spellings.
  const ZONES = Object.freeze({ map_northern_cliffs: 'Northern Cliffs', map_southern_cloud_forest: 'Southern Cloud Forest', map_western_slope: 'Western Slope', map_eastern_mire: 'Eastern Mire' }); // Used for the broadest first line, never inferred from requested terrain.
  const BANK = Object.freeze({
    zone: {
      A: [f => `Begin in ${f.value}, a country well known`, f => `The map names ${f.value}, marked as its own`, f => `Go into ${f.value}; let that name be known`],
      B: [f => `Make for ${f.value}; your search begins here`, f => `Let ${f.value} make the broad course clear`, f => `Seek ${f.value}, and draw the region near`]
    },
    sector: {
      A: [f => `In ${f.value}, let this bearing be known`, f => `Turn to ${f.value}, where the ground is known`, f => `Keep ${f.value} as the region shown`],
      B: [f => `Aim for ${f.value}; the bounds grow clear`, f => `Within ${f.value}, the search draws near`, f => `Find ${f.value}; let it guide where you steer`]
    },
    water: {
      A: [f => `Search ${f.value}; let the clue be known`, f => `Search ${f.value}; the water's course is known`, f => `Look ${f.value}, where a mark may be shown`],
      B: [f => `Keep ${f.value}, and the place draws near`, f => `Stand ${f.value}; the direction is clear`, f => `Look ${f.value}; your next landmark is near`]
    },
    path: {
      A: [f => `Seek ${f.value}; let that bearing be known`, f => `Look ${f.value}; let the direction be known`, f => `Seek ${f.value}, not the roadway alone`],
      B: [f => `Look ${f.value}; the way becomes clear`, f => `Keep ${f.value}, and your search draws near`, f => `Go ${f.value}; let that guide where you steer`]
    },
    landmark: {
      A: [f => `Look ${f.value}; the landmark's place is known`, f => `Seek ${f.value}; let the bearing be known`, f => `Search ${f.value}; the mark is shown`],
      B: [f => `Keep ${f.value}; the next sign is near`, f => `Stand ${f.value}, and the way grows clear`, f => `Look ${f.value}; let it guide where you steer`]
    },
    boulder: {
      A: [f => `Search ${f.value}; the boulder's shape is stone`, f => `Search ${f.value}; the rock can be known`, f => `Look ${f.value}, where rough shapes are shown`],
      B: [f => `Look ${f.value}; the rock may be near`, f => `Seek ${f.value}, and the bounds grow clear`, f => `Keep ${f.value}; that is where to steer`]
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


  const FAMILIES = Object.freeze(['A','B','way','ground','side','place','eyes','door','tree','flow']); // Ten deterministic phonetic families.
  const VERSE_BANK = Object.freeze({
    zone:{
      way:['Let {value} be the start of your way','Begin in {value}; do not stray'],
      ground:['Within {value}, the search is bound','Seek {value}; begin on this ground'],
      side:['In {value}, let the land be your guide','Seek {value}; set other lands aside'],
      place:['Within {value} lies the sought-after place','Search {value}, the first of clues to trace'],
      eyes:['In {value}, look with searching eyes','Within {value}, the hidden answer lies'],
      door:['In {value}, begin to explore','Seek {value}; the land holds something more'],
      tree:['Search {value}; the country holds the key',"In {value}, the goal you seek you'll see"],
      flow:['To {value}, let the search now go','Begin in {value}; let your knowledge grow']
    },
    bearing:{
      way:['Look {value}; let the landmark point the way','Seek {value}; do not let your steps stray','Search {value}; let that clue have its say'],
      ground:['Search {value}; a clue waits to be found','Look {value}; the bearing marks this ground','Go {value}; let that hint define your bound'],
      side:['Look {value}; let the clue be your guide','Seek {value}; set other hints aside','Search {value}; let this bearing abide'],
      place:['Search {value}; it helps to fix the place',"Look {value}; pursue the riddle's trace",'Seek {value}; explore the nearby space'],
      eyes:['Look {value}; let the clue direct your eyes','Search {value}; the hidden answer lies','Seek {value}; there waits the sought-for prize'],
      door:['Look {value}; then search a little more',"Seek {value}; there's ground left to explore",'Go {value}; find what the land holds in store'],
      tree:['Look {value}; this hint becomes your key',"Search {value}; there's more for you to see",'Seek {value}; let the clue set you free'],
      flow:['Search {value}; let what follows show','Look {value}; follow what you know','Go {value}; let the searching onward flow']
    },
    blossom:{
      way:['Find {value}; its blossoms end your way','Seek {value}; where colored petals stay'],
      ground:['Find {value}; where colored blooms are found','Seek {value}; its roots hold to the ground'],
      side:['Find {value}; let its branches be your guide','Seek {value}; where colored blooms abide'],
      place:['Find {value}; the blossom marks the place','Seek {value}; where petals lend their grace'],
      eyes:['Find {value}; bright petals meet your eyes','At {value}, the hidden answer lies'],
      door:['Find {value}; the riddle asks no more','Seek {value}; here ends what you explore'],
      tree:['Find {value}, the long-sought tree','At {value}, the petals hold the key'],
      flow:['Find {value}, and let the searching go','At {value}, its blossoms tell you so']
    },
    target:{
      way:["Find {value}; you've reached the end of the way",'Seek {value}; here your footsteps may stay'],
      ground:['Find {value}; the answer has been found','Seek {value}; its place is on this ground'],
      side:['Find {value}; set other hints aside','Seek {value}; the last clue is your guide'],
      place:["Find {value}; you've reached the sought-for place",'Seek {value}; it ends your wandering chase'],
      eyes:['Find {value}; the final answer lies','At {value}, the search has earned its prize'],
      door:['Seek {value}; no need to search for more','Find {value}; here ends what you explore'],
      tree:['Find {value}; let that be your key','Seek {value}; the answer you will see'],
      flow:['Find {value}; let the wandering slow','Seek {value}; the answer you will know']
    }
  }); // Universal stanza endings use facts, not fabricated structures.
  const LANDMARK_BANK = Object.freeze({
    water:{flow:['Search {value}; follow where the waters flow','Look {value}; follow what the waters show'],side:['Look {value}; let the water be your guide']},
    path:{way:['Search {value}; the trodden track defines the way','Look {value}; let the trail have its say'],side:['Seek {value}; let the footpath be your guide']},
    boulder:{A:['Search {value}; the earth holds fast to stone','Look {value}; the unyielding rock is shown'],ground:['Seek {value}; the stubborn stone marks the ground']},
    stoneCairn:{A:['Look {value}; a cairn has gathered stone','Search {value}; the piled stones make their mark known'],ground:['Seek {value}; stacked stones rise from the ground']},
    brokenPillar:{A:['Look {value}; a fractured pillar speaks in stone','Seek {value}; the broken masonry is shown'],ground:['Search {value}; scarred masonry marks the ground']},
    deadTree:{tree:['Look {value}; bare branches hold the key','Seek {value}; the leafless tree is yours to see'],eyes:['Search {value}; bare branches sketch the skies']},
    cliffDoor:{door:['Look {value}; the cliffside keeps a door','Seek {value}; stone guards a way to explore'],place:['Search {value}; the cliff door marks the place']},
    rootTotem:{ground:['Look {value}; the carved sign marks the ground'],side:['Seek {value}; let the root totem be your guide']},
    animalDen:{B:["Look {value}; the creature's lair is near"],place:['Search {value}; the animal den marks the place']}
  }); // Witness-specific language only appears for measured and typed structures.
  const SIGNATURE = Object.freeze({
    water:['flow','side'],path:['way','side'],boulder:['A','ground'],
    stoneCairn:['A','ground'],brokenPillar:['A','ground'],deadTree:['tree','eyes'],
    cliffDoor:['door','place'],rootTotem:['ground','side'],animalDen:['B','place']
  }); // Favor signature rhymes but leave variety available.

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
      facts.push({ kind: 'water', waterType:kind, value: relationship(point, water, 'the ' + kind), source: 'post-generation-water-tile', coordinate: { col: water.col, row: water.row }, distance: water.d });
    }
    const path = samples.find(s => s.type === 'path');
    if (path && path.d <= 16) facts.push({ kind: 'path', value: relationship(point, path, 'the trail'), source: 'post-generation-path-tile', coordinate: { col: path.col, row: path.row }, distance: path.d });
    const boulder = samples.find(s => s.type === 'boulder');
    if (boulder) facts.push({ kind:'boulder', value:relationship(point,boulder,'the undiggable boulder'), source:'post-generation-boulder-tile', coordinate:{col:boulder.col,row:boulder.row}, distance:boulder.d });
    const others = (layout.localeInstances || []).filter(other => other !== instance && other.localeId !== instance.localeId && !String(other.localeId || '').startsWith('locale_five_blossoms_')); // Never give away a different blossom as a landmark.
    const landmarks = others.map(other => ({ name: other.name, point: positionOf(other), source: 'stamped-neighbor-locale', kind:'authoredLocale' })); // Already-stamped locale anchors are authoritative.
    for (const site of (layout.rootTotems || [])) landmarks.push({ name: 'the root totem', point: { col: Number(site.x), row: Number(site.y) }, source: 'generated-root-totem', kind:'rootTotem' }); // Uses the existing root-totem placement index.
    for (const site of (layout.animalDens || [])) landmarks.push({ name: 'a wild animal den', point: { col: Number(site.mouthAnchor?.x ?? site.x), row: Number(site.mouthAnchor?.y ?? site.y) }, source: 'generated-animal-den', kind:'animalDen' });
    for (const site of suppliedLandmarks) if (site?.name && site?.point) landmarks.push({ name: String(site.name), point: site.point, source: site.source || 'generated-scenery', kind: site.kind || (site.source === 'registered-cliff-door' ? 'cliffDoor' : 'authoredLocale') }); // Caller supplies only genuinely generated scenery, ruin entrances and cliff doors. // Use the visible den doorway rather than an assumed footprint center.
    const nearbyLandmarks = landmarks.filter(item => item.name && Number.isFinite(item.point.col) && Number.isFinite(item.point.row))
      .map(item => ({ ...item, d: Math.hypot(item.point.col - point.col, item.point.row - point.row) }))
      .filter(item => item.d <= Math.max(18, radius * 2) && item.d >= 5)
      .sort((a,b) => a.d - b.d || a.point.row - b.point.row || a.point.col - b.point.col);
    const chosen = []; // Two different nearby feature types can triangulate the target in two stanzas.
    for (const item of nearbyLandmarks) {
      if (chosen.some(prev => prev.kind === item.kind || (prev.point.col === item.point.col && prev.point.row === item.point.row))) continue;
      chosen.push(item);
      if (chosen.length === 2) break;
    }
    for (const item of chosen) facts.push({
      kind:'landmark', flavor:item.kind, value:relationship(point,item.point,item.name),
      source:item.source, coordinate:{col:item.point.col,row:item.point.row}, distance:item.d
    });
    // No made-up landmarks and no literal tile counts. Sparse locations simply get a shorter, broader poem.
    facts.push({ kind: targetKind === 'blossom' || blossomName ? 'blossom' : 'target', value: String(targetName || blossomName || instance.name || 'the destination'), source: 'stamped-target-object' }); // Subject wording belongs to the calling quest, not a hard-coded tree.
    return { ok: true, zoneId, point, facts, evidence: { waterFound: !!water, pathFound: !!path, boulderFound: !!boulder, landmarkFound: chosen.length > 0, landmarkCount: chosen.length, optionalTerrainFallback: !water && !path && !boulder && !chosen.length } };
  }
  function rhymeOf(line) {
    const terminal = String(line).trim().replace(/[.,;!?]+$/, '').split(/\s+/).pop().toLowerCase();
    return FAMILIES.find(family => RHYMES[family].includes(terminal)) || null;
  }
  function descriptorKey(fact) { return fact.kind === 'landmark' ? fact.flavor || 'authoredLocale' : fact.kind; }
  function linesFor(fact, family) {
    const old = BANK[fact.kind]?.[family] || []; // Preserve legacy A/B descriptor choices.
    const basic = old.length ? old : VERSE_BANK[fact.kind === 'zone' || fact.kind === 'blossom' || fact.kind === 'target' ? fact.kind : 'bearing']?.[family] || [];
    const extra = LANDMARK_BANK[descriptorKey(fact)]?.[family] || [];
    if (fact.kind === 'water' && fact.waterType === 'open water' && family === 'flow') return basic; // Ponds and lakes need not flow.
    return extra.length ? [...extra,...extra,...basic] : basic;
  }
  function lineFor(fact, family, seed, offset, previousEnding = '') {
    const lines = linesFor(fact, family);
    if (!lines.length) throw new TypeError('Unknown descriptor or rhyme: ' + fact.kind + '/' + family);
    const index = hash(seed + '|' + fact.kind + '|' + (fact.flavor || '') + '|' + fact.value + '|' + family) % lines.length;
    let fallback = '';
    for (let i = 0; i < lines.length; i++) {
      const phrase = lines[(index + offset + i) % lines.length];
      const line = typeof phrase === 'function' ? phrase(fact) : phrase.replaceAll('{value}', fact.value);
      const word = line.trim().split(/\s+/).pop().toLowerCase();
      if (!fallback) fallback = line;
      if (word !== previousEnding) return line;
    }
    return fallback;
  }
  function chooseFamily(lines, parity, exclude, seed) {
    const hinted = lines.filter((_, index) => index % 2 === parity)
      .flatMap(fact => descriptorKey(fact) === 'water' && fact.waterType === 'open water'
        ? ['side','B'] : SIGNATURE[descriptorKey(fact)] || [])
      .filter(family => family !== exclude);
    const allowed = FAMILIES.filter(family => family !== exclude);
    if (hinted.length && hash(seed + '|signature') % 4 !== 0)
      return hinted[hash(seed + '|landmark') % hinted.length];
    return allowed[hash(seed + '|all') % allowed.length];
  }
  function compose({ facts, seed = 'locale-riddle' } = {}) {
    if (!Array.isArray(facts) || facts.length < 2) return null;
    const groups = []; // Retain two-stanza ABAB structure with the target in the final line.
    for (let index = 0; index < facts.length; index += 4) groups.push(facts.slice(index, index + 4));
    if (groups.length > 1 && groups[groups.length - 1].length === 1) {
      const prior = groups[groups.length - 2];
      groups[groups.length - 1].unshift(prior[prior.length - 1]);
    }
    return groups.map((group, stanzaIndex) => {
      const lines = group.length >= 4 ? group
        : group.length === 3 ? [group[0], group[1], group[0], group[2]]
        : [group[0], group[1], group[0], group[1]];
      const stanzaSeed = seed + ':' + stanzaIndex;
      const a = chooseFamily(lines, 0, null, stanzaSeed + '|A');
      const b = chooseFamily(lines, 1, a, stanzaSeed + '|B');
      const endings = ['', ''];
      return lines.map((fact, i) => {
        const family = i % 2 ? b : a, parity = i % 2;
        const line = lineFor(fact, family, stanzaSeed, i >= 2 ? 1 : 0, endings[parity]);
        endings[parity] = line.trim().split(/\s+/).pop().toLowerCase();
        return line + (i === 3 ? '.' : i === 1 ? ';' : i === 0 || i === 2 ? ',':',');
      });
    });
  }
  function validate(result) {
    if (!result?.stanzas?.length) return false;
    return result.stanzas.every(stanza => {
      if (stanza.length !== 4) return false;
      const families = stanza.map(rhymeOf);
      const endings = stanza.map(line => line.trim().replace(/[.,;!?]+$/, '').split(/\s+/).pop().toLowerCase());
      return families.every(Boolean) && families[0] === families[2] && families[1] === families[3] &&
        families[0] !== families[1] && endings[0] !== endings[2] && endings[1] !== endings[3];
    });
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
