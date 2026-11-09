#!/usr/bin/env node
'use strict';

// Den species are split across a zone's dens by weight (Nazgraku slightly
// rarer), every denSpecies entry gets at least one den when there are enough
// dens, and the exterior/cavern lookups agree. Also covers denCensus.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd();
const source = fs.readFileSync(path.join(ROOT, 'docs/js/wildlife-spawn.js'), 'utf8');
const Generator = require(path.join(ROOT, 'docs/js/wilderness-map-generator.js'));

const zoneLayouts = new Map();
const hostileObjects = new Set();
const EXTERIOR_ZONES = {
  map_northern_cliffs: { denSpecies: ['grehlr', 'nazgraku'] },
  map_western_slope: { denSpecies: ['puktuk', 'nelk'] },
  map_three: { denSpecies: ['a', 'b', 'c'] },
};
const windowStub = { WildernessMapGenerator: Generator, __farmLog() {} };
const context = vm.createContext({ window: windowStub, console, Math, Map, Set, Object, Array, String, Number, JSON, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
vm.runInContext(source, context, { filename: 'wildlife-spawn.js' });
const W = windowStub.WildlifeSpawn;
W.init({
  EXTERIOR_ZONES, zoneLayouts, hostileObjects, CREATURE_DB: {}, denNests: new Map(), buildingScenes: new Map(),
  getCurrentArea: () => 'map_northern_cliffs', rnd: Math.random, TILE: 32, showToast() {},
});

const densFor = n => Array.from({ length: n }, (_, i) => ({ id: `animalDen_${i + 1}`, x: i * 10, y: 5, w: 3, h: 3 }));
const speciesCounts = (zoneId, n) => {
  zoneLayouts.set(zoneId, { dens: densFor(n) });
  W.forgetZoneDenState(zoneId);
  const counts = {};
  for (const den of zoneLayouts.get(zoneId).dens) {
    const kind = W.denSpeciesFor(zoneId, W.denCavernMapId(zoneId, den.id));
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
};

for (let n = 2; n <= 12; n++) {
  const counts = speciesCounts('map_northern_cliffs', n);
  assert.ok(counts.grehlr >= 1 && counts.nazgraku >= 1, `${n} dens: both species present (${JSON.stringify(counts)})`);
  assert.ok(counts.grehlr - counts.nazgraku >= 0 && counts.grehlr - counts.nazgraku <= 1, `${n} dens: near-even split, Nazgraku never more common (${JSON.stringify(counts)})`);
  const western = speciesCounts('map_western_slope', n);
  assert.ok(Math.abs(western.puktuk - western.nelk) <= 1, `${n} dens: equal-weight species split evenly (${JSON.stringify(western)})`);
}
assert.deepEqual({ ...speciesCounts('map_northern_cliffs', 5) }, { grehlr: 3, nazgraku: 2 }, '5 dens -> 3 Grehlr / 2 Nazgraku');
assert.equal(Object.keys(speciesCounts('map_three', 3)).length, 3, 'three species over three dens: one each');
assert.equal(Object.values(speciesCounts('map_three', 2)).reduce((a, b) => a + b, 0), 2, 'fewer dens than species still assigns every den');

// Cavern-side lookup (id not yet registered via denCavernMapId) parses the
// same den id and gets the same species as the exterior.
zoneLayouts.set('map_northern_cliffs', { dens: densFor(8) });
W.forgetZoneDenState('map_northern_cliffs');
const exterior = W.denSpeciesFor('map_northern_cliffs', W.denCavernMapId('map_northern_cliffs', 'animalDen_4'));
assert.equal(W.denSpeciesFor('map_northern_cliffs', 'map_i_den_map_northern_cliffs_animalDen_4'), exterior);

// Stable across repeated lookups and a cache reset.
const before = zoneLayouts.get('map_northern_cliffs').dens.map(d => W.denSpeciesFor('map_northern_cliffs', W.denCavernMapId('map_northern_cliffs', d.id)));
W.forgetZoneDenState('map_northern_cliffs');
const after = zoneLayouts.get('map_northern_cliffs').dens.map(d => W.denSpeciesFor('map_northern_cliffs', W.denCavernMapId('map_northern_cliffs', d.id)));
assert.deepEqual(after, before, 'allocation is deterministic');

// denCensus lists every den, occupied or not.
hostileObjects.add({ denKey: 'map_northern_cliffs:animalDen_2', health: 10 });
hostileObjects.add({ denKey: 'map_northern_cliffs:animalDen_2', health: 0 });
const census = W.denCensus('map_northern_cliffs');
assert.equal(census.length, 8);
assert.equal(census.find(d => d.denId === 'animalDen_2').alive, 1);
assert.equal(census.filter(d => d.alive > 0).length, 1);
assert.ok(census.every(d => d.species === 'grehlr' || d.species === 'nazgraku'));

console.log('den species balance: ok');
