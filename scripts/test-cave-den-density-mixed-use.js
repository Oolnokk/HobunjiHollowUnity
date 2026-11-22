#!/usr/bin/env node
'use strict';

// Regression: the same ordinary cave anchors support more wildlife dens plus
// a second small activity when a real, unreserved chamber has room for it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.env.HOBUNJI_TEST_ROOT || path.join(__dirname, '..'); // Repository root used to load the production cave module.
const source = fs.readFileSync(path.join(root, 'docs/js/cave-site-system.js'), 'utf8'); // Source under test: no separate cave-generation implementation.
const windowStub = {
  __farmLog() {},
  __hobunjiPlayerProfile: { worldId: 'den-balance-fixture' },
  CalendarSystem: { tothalCycle: () => 1 },
};
const sandbox = { window: windowStub, console, localStorage: { getItem: () => null } }; // Minimal existing browser globals for headless cave-profile tests.
vm.runInNewContext(source, sandbox, { filename: 'cave-site-system.js' });
const Cave = windowStub.CaveSiteSystem; // Production public cave API used throughout the tests.
assert(Cave, 'the real cave site module loads without rendering a scene');

const dens = count => Array.from({ length: count }, (_, i) => ({
  id: `animalDen_${i}`, x: 10 + i * 10, y: 9, w: 3, h: 3,
  mouthAnchor: { x: 11 + i * 10, y: 12 },
})); // Normal compatibility cave anchors; the test must not create more entrances.

const baseDens = dens(8); // A normal wilderness zone presently generates up to eight ordinary cave anchors.
const first = Cave.applyWorkspaceProfiles('map_northern_cliffs', { animalDens: baseDens });
const second = Cave.applyWorkspaceProfiles('map_northern_cliffs', { animalDens: dens(8) });
const summary = sites => JSON.parse(JSON.stringify(sites.map(site => ({
  id: site.denId, contents: site.contents, inhabitant: site.inhabitant, mapId: site.mapId,
})))); // Cross-VM-safe comparison of the deterministic cave allocation.
assert.equal(first.length, 8, 'do not add extra caves or entrances');
assert.equal(first.filter(site => site.inhabitant === Cave.TYPES.ANIMAL_DEN).length >= 6, true,
  'a normal eight-cave zone has at least six wildlife dens');
assert.deepEqual(summary(first), summary(second), 'same seed and cave positions reproduce the same combined sites');
assert(first.every(site => site.contents && site.contents !== Cave.TYPES.PUZZLE_CAVE),
  'den conversion preserves the existing primary cave content layer');
assert.equal(new Set(first.map(site => site.mapId)).size, 8, 'every cave retains a unique original transition target');

// Legacy profiles should keep all their original content, den identity and
// explored bandits; only unused room and undiscovered non-den sites may change.
const old = dens(8).map((den, index) => {
  const profile = Cave.__test.rollProfile('map_legacy_zone', den); // Production legacy identity and seeded contents.
  profile.schema = 3;
  profile.inhabitant = index === 0 ? Cave.TYPES.ANIMAL_DEN
    : index === 1 ? Cave.TYPES.BANDIT_HIDEOUT : Cave.TYPES.NONE;
  profile.layers = [profile.contents, profile.inhabitant].filter(t => t !== Cave.TYPES.NONE);
  return { ...den, caveSite: profile };
}); // Forced old 1-den, 1-hideout, 6-empty distribution exercises the schema-3 upgrade.
const preserved = old.map(den => JSON.parse(JSON.stringify(den.caveSite))); // Original authored/cached labels and content identities.
Cave.__test.runtimeStateBySignature.set(old[1].caveSite.signature, { discovered: true, occupantsCleared: true });
const migrated = Cave.applyWorkspaceProfiles('map_legacy_zone', { animalDens: old });
assert.equal(migrated.filter(site => site.inhabitant === Cave.TYPES.ANIMAL_DEN).length, 6,
  'migration fills spare caves up to the zone den floor');
assert.equal(migrated[0].inhabitant, Cave.TYPES.ANIMAL_DEN, 'existing animal den is never taken away');
assert.equal(migrated[1].inhabitant, Cave.TYPES.BANDIT_HIDEOUT, 'visited bandit hideout stays a hideout');
assert(migrated.every((site, index) => site.mapId === preserved[index].mapId
  && site.contents === preserved[index].contents && site.signature === preserved[index].signature
  && site.schema === 4), 'migration keeps original geometry IDs, contents, signatures and newer schema');
assert.deepEqual(summary(Cave.applyWorkspaceProfiles('map_legacy_zone', { animalDens: old })), summary(migrated),
  'migrated cave allotment is stable across a second pass');

// Independent puzzle caves are not ordinary wildlife homes.
const puzzleDens = [{ ...dens(1)[0], caveSite: {
  ...Cave.__test.rollProfile('map_puzzle_zone', dens(1)[0]),
  schema: 3, contents: Cave.TYPES.PUZZLE_CAVE, inhabitant: Cave.TYPES.NONE,
} }];
assert.equal(Cave.applyWorkspaceProfiles('map_puzzle_zone', { animalDens: puzzleDens })[0].inhabitant,
  Cave.TYPES.NONE, 'a dedicated puzzle cave is never repurposed as an animal den');

// Spare rooms reuse existing ore and mushroom data, rather than spawning new AI.
const spacious = [];
for (let row = 1; row <= 20; row++) for (let col = 1; col <= 24; col++) spacious.push({ col, row });
const checkPocket = (contents, expectedKind) => {
  let found = false;
  for (let index = 0; index < 20; index++) {
    const profile = { contents, signature: `secondary-${contents}-${index}` }; // Separate deterministic trials include rolls without pockets.
    const mapData = { oreRocks: [], caveMushrooms: [] }; // Existing normal resource lists; no new prefab or entity type.
    const plan = { mushrooms: [], mineRocks: [], separator: null }; // Primary content reservations already supplied by the real decorator.
    const blocked = new Set(['10,10', '10,11']); // Simulated primary objective floor that the pocket must never occupy.
    Cave.__test.addSecondaryPocket(mapData, profile, spacious, blocked, plan);
    if (!plan.secondaryPocket) continue;
    found = true;
    assert.equal(plan.secondaryPocket.kind, expectedKind);
    assert(plan.secondaryPocket.count >= 2 && plan.secondaryPocket.count <= 4, 'secondary resource budget is strictly bounded');
    const placed = expectedKind === 'ore' ? mapData.oreRocks : mapData.caveMushrooms;
    assert.equal(placed.length, plan.secondaryPocket.count, 'ordinary resource owner receives the same secondary count');
    for (const tile of placed) {
      assert(!(['10,10', '10,11'].includes(`${tile.col},${tile.row}`)), 'the original objective remains unobstructed');
      assert(blocked.has(`${tile.col},${tile.row}`), 'each added resource reserves its cave floor tile');
    }
  }
  assert(found, `some spacious ${contents} caves contain a real secondary ${expectedKind} pocket`);
};
checkPocket(Cave.TYPES.ORE_MINE, 'mushrooms');
checkPocket(Cave.TYPES.CATACOMB, 'mushrooms');
checkPocket(Cave.TYPES.MUSHROOM_CAVE, 'ore');
const crampedPlan = { mushrooms: [], mineRocks: [], separator: null };
Cave.__test.addSecondaryPocket({ oreRocks: [] }, { contents: Cave.TYPES.CATACOMB, signature: 'cramped' },
  spacious.slice(0, 5), new Set(), crampedPlan);
assert.equal(crampedPlan.secondaryPocket, undefined, 'cramped caves do not receive overlapping filler');
const puzzlePlan = { mushrooms: [], mineRocks: [], separator: null };
Cave.__test.addSecondaryPocket({ oreRocks: [] }, { contents: Cave.TYPES.PUZZLE_CAVE, signature: 'puzzle' },
  spacious, new Set(), puzzlePlan);
assert.equal(puzzlePlan.secondaryPocket, undefined, 'standalone puzzle rooms remain exclusively authored challenges');

console.log('PASS cave-den-density-mixed-use: den share, migration, untouched cave IDs, separate puzzle rooms, and bounded secondary resources');
