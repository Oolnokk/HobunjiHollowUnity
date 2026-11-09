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

// CaveSiteSystem temporarily swaps the zone's den list for animal-only
// anchors. Allocation must not jump when the same cave is inspected indoors.
const marked = densFor(8).map((den, index) => ({
  ...den, isAnimalDen: index % 2 === 0,
  caveSite: { inhabitant: index % 2 === 0 ? 'animal_den' : 'none' },
})); // The four non-animal caves still have entrances but no nest.
const filteredLayout = { dens: marked }; // Real CaveSiteSystem assigns this exact metadata to every cave anchor.
zoneLayouts.set('map_northern_cliffs', filteredLayout);
W.forgetZoneDenState('map_northern_cliffs');
const residentIds = marked.filter(den => den.isAnimalDen).map(den => den.id);
const unfilteredKinds = residentIds.map(id => W.denSpeciesFor('map_northern_cliffs', W.denCavernMapId('map_northern_cliffs', id)));
filteredLayout.caveAnchors = filteredLayout.dens;
filteredLayout.dens = filteredLayout.dens.filter(den => den.isAnimalDen);
const filteredKinds = residentIds.map(id => W.denSpeciesFor('map_northern_cliffs', W.denCavernMapId('map_northern_cliffs', id)));
assert.deepEqual(filteredKinds, unfilteredKinds, 'entering the ecology wrapper cannot change an animal den family');
delete filteredLayout.caveAnchors;
filteredLayout.dens = marked;
assert.equal(new Set(unfilteredKinds).size, 2, 'non-animal caves do not consume the den-only family slots');

// Multi-species legacy zones also need one persistent den family, rather than
// rolling the outside pack and the interior Den-Mother independently.
EXTERIOR_ZONES.map_mixed_wilds = {
  packSpecies: ['gar-wolf', 'grehlr'],
  herbivoreSpecies: ['uumkaoii-wild'],
}; // Existing kind names exercise both random pool selection and pack/herd choice.
zoneLayouts.set('map_mixed_wilds', { dens: densFor(10) });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/cavern-generator.js'), 'utf8'), context);
const mothers = {
  'gar-wolf': { creatureKey: 'gar-wolf-den-mother', nestItemKey: 'garWolfBaby' },
  grehlr: { creatureKey: 'grehlr-den-mother', nestItemKey: 'grehlrBaby' },
  'uumkaoii-wild': { creatureKey: 'uumkaoii-wild-den-mother', nestItemKey: 'uumkaoiiEgg' },
  nazgraku: { creatureKey: 'nazgraku', nestItemKey: 'nazgrakuBaby' },
}; // Uses the same real Den-Mother/reward keys as scratchbones-config.
windowStub.CavernGenerator.init({ EXTERIOR_ZONES, DEN_MOTHER_DEFS: mothers });
for (const den of zoneLayouts.get('map_mixed_wilds').dens) {
  const mapId = W.denCavernMapId('map_mixed_wilds', den.id);
  const outside = W.denResidentSpeciesFor('map_mixed_wilds', mapId);
  assert(mothers[outside], `${den.id}: den must choose a registered nesting species`);
  assert.equal(windowStub.CavernGenerator.pickDenMotherKind(mapId), mothers[outside].creatureKey,
    `${den.id}: guardian and entrance family must match`);
  assert.equal(W.denResidentSpeciesFor('map_mixed_wilds', mapId), outside,
    `${den.id}: revisiting may not reroll its species`);
  assert(mothers[outside].nestItemKey, `${den.id}: usable egg or baby item exists`);
}

// Loading a persisted den can precede exterior transition registration on
// startup. The cavern still needs to identify its native guardian and nest.
const restoredMapId = 'map_i_den_map_northern_cliffs_restored_unminted_den';
assert.equal(W.denCavernZoneOf(restoredMapId), undefined, 'fixture must not have minted a runtime cavern lookup');
const restoredSpecies = W.denResidentSpeciesFor('map_northern_cliffs', restoredMapId);
assert(mothers[restoredSpecies], 'a valid native species is available in the restored region');
assert.equal(windowStub.CavernGenerator.pickDenMotherKind(restoredMapId), mothers[restoredSpecies].creatureKey,
  'an interior loaded before exterior registration still finds the correct home-point species');

// Verify the mobile audit against an actual injected inventory registry. Without
// ITEM_DEFS, fertile Honeyfuzzle eggs are incorrectly marked unavailable.
const gameSource = fs.readFileSync(path.join(ROOT, 'docs/game.js'), 'utf8');
const initStart = gameSource.indexOf('window.WildlifeSpawn?.init({'); // Production DI seam that exposes the live item catalog.
const initEnd = gameSource.indexOf('window.CavernGenerator?.init({', initStart);
assert(initStart >= 0 && initEnd > initStart, 'the runtime wildlife dependency bag exists');
assert.match(gameSource.slice(initStart, initEnd), /\bITEM_DEFS\s*,/, 'wildlife receives the real inventory item registry for offspring validation');
const auditItems = { puktukBaby: { cat: 'livestock' }, fertileHoneyfuzzleEgg: { cat: 'livestock' } }; // Real, usable item fixtures used by audit validation.
const auditMothers = { puktuk: { creatureKey: 'puktuk', nestItemKey: 'puktukBaby' } }; // A den's guardian and baby mapping must both exist.
windowStub.SCRATCHBONES_CONFIG = { game: { livestock: { itemKinds: { puktukBaby: 'puktuk' } }, wildlife: { denMothers: auditMothers } } }; // Mirrors the parser-time config read by nestingSpeciesAudit.
windowStub.CreatureGenetics = { SPECIES_ALIAS: {} }; // Explicitly maps Puktuk/Honeyfuzzle to their own genetic families.
windowStub.CreatureGeneticsRender = { SPECIES: { puktuk: {}, honeyfuzzle: {} } }; // A usable offspring family requires the live coat renderer.
const auditCreatures = { puktuk: {}, honeyfuzzle: {}, tzatzul: {}, 'skeeri-small': {} }; // Real registry fixtures, not merely names in a zone string.
W.init({
  EXTERIOR_ZONES, zoneLayouts, hostileObjects,
  CREATURE_DB: auditCreatures, DEN_MOTHER_DEFS: auditMothers, ITEM_DEFS: auditItems,
  getCurrentArea: () => 'map_western_slope', rnd: Math.random, TILE: 32,
  denNests: new Map(), buildingScenes: new Map(), showToast() {},
});
const auditRecords = W.nestingSpeciesAudit(); // The real mobile-facing audit, not a separately implemented validator.
const inspected = kind => auditRecords.find(record => record.kind === kind);
assert.equal(inspected('puktuk')?.ok, true, 'a registered den guardian with a real baby item passes');
assert.equal(inspected('honeyfuzzle')?.ok, true, 'a fertile hive egg is valid without a conventional stable itemKinds mapping');
assert.equal(inspected('tzatzul')?.exempt, true, 'Tzatzuls are not forced to produce hatchable eggs');
assert.equal(inspected('skeeri-small')?.exempt, true, 'Skeeri are not forced to produce hatchable eggs');
delete auditItems.fertileHoneyfuzzleEgg;
assert.equal(W.nestingSpeciesAudit().find(record => record.kind === 'honeyfuzzle')?.ok, false,
  'a truly absent fertile egg item is detected instead of being silently accepted');
auditItems.fertileHoneyfuzzleEgg = { cat: 'livestock' };
delete auditItems.puktukBaby;
assert.equal(W.nestingSpeciesAudit().find(record => record.kind === 'puktuk')?.ok, false,
  'a stale Puktuk itemKinds mapping without an actual baby pickup cannot pass the audit');

console.log('den species balance and real offspring registry audit: ok');
