#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Validates actual companion runtime behavior.
const fs = require('node:fs'); // Loads shipped source instead of copying its implementation.

const game = fs.readFileSync('docs/game.js', 'utf8'); // Canonical character restore and companion-sync owner.
const farmAnimals = fs.readFileSync('docs/js/farm-animals.js', 'utf8'); // Item-to-Stable acquisition path.
const farmPanel = fs.readFileSync('docs/js/farm-panel-core.js', 'utf8'); // Farm-to-Stable adult transfer path.

function section(source, start, end) {
  const begin = source.indexOf(start); // A missing production seam should fail this test, not silently skip it.
  const finish = source.indexOf(end, begin + start.length); // End of the exact function under test.
  assert(begin >= 0 && finish > begin, 'Expected runtime seam: ' + start);
  return source.slice(begin, finish);
}

const restoreStable = section(game, '        stable = Array.isArray(playerData.stable)', '        // Backfill genotype-less');
function loadStable(playerData) {
  const load = new Function('playerData', 'window', 'companionAiTypeForKind',
    'let stable = [], activeCompanionId = null, activeMountId = null, activeShoulderPetId = null;\n' +
    restoreStable + '\nreturn { stable, activeCompanionId, activeMountId, activeShoulderPetId };');
  return load(playerData, {
    CreatureGenetics: { makeDefaultGenotype: () => ({ sizeClass: 'medium' }) },
  }, () => 'vigilantProtector');
}
const fresh = loadStable({ stable: [], activeCompanionId: null }); // Newly created player profile.
assert.equal(fresh.stable.length, 1, 'Bingo stays owned as the default Stable animal');
assert.equal(fresh.stable[0].name, 'Bingo');
assert.equal(fresh.activeCompanionId, null, 'Owning Bingo must not equip him');
const owned = loadStable({ stable: [{ id: 'real', kind: 'gar-wolf', name: 'Moss' }], activeCompanionId: null });
assert.equal(owned.activeCompanionId, null, 'An intentionally empty slot stays empty across reloads');
assert.equal(owned.stable[0].name, 'Moss');
const chosen = loadStable({ stable: [{ id: 'real', kind: 'gar-wolf' }], activeCompanionId: 'real' });
assert.equal(chosen.activeCompanionId, 'real', 'Explicitly selected animals remain equipped on reload');
assert.match(game, /whistles:\s*\[\s*\{ id: 'whistle_bingo'/,
  'The starter whistle remains an owned item');
assert.match(game, /gearInventory\.whistles = \[\{ id: 'whistle_bingo'/,
  'Legacy characters still receive their owned starter whistle');
assert.doesNotMatch(game, /_autoAssignStableRole/,
  'Stable role assignment must only happen through the manual Stable UI');

const restoreGear = section(game,
  '        equipmentSlots.whistle = null; // A saved explicit selection',
  '        rebuildToolMeshes();');
function loadGear(savedSlots) {
  const equipmentSlots = { whistle: 'previous-profile', adventuring: null, hoe: null, shovel: null, weapon: null, ranged: null };
  const gearInventory = { tools: {}, whistles: [{ id: 'whistle_bingo', creatureKey: 'dabinggi-hound', name: 'Bingo' }] };
  new Function('playerData', 'gearInventory', 'equipmentSlots', 'window', restoreGear)(
    { equipmentSlots: savedSlots }, gearInventory, equipmentSlots, { __hobunjiCutscenePreview: false });
  return equipmentSlots;
}
assert.equal(loadGear({ whistle: null }).whistle, null, 'Saving an empty whistle slot keeps it empty');
assert.equal(loadGear(undefined).whistle, null, 'A missing equipment record does not auto-select a whistle');
assert.equal(loadGear({ whistle: 'whistle_bingo' }).whistle, 'whistle_bingo',
  'An explicitly saved whistle remains equipped');
assert.doesNotMatch(section(game, '        // Reset equipment to defaults', '        rebuildToolMeshes();'),
  /equipmentSlots\.whistle\s*=\s*gearInventory\.whistles/,
  'Farm reset cannot auto-equip the first whistle');

const spawnSource = section(game,
  'function syncCompanionFromWhistle(master = player) {',
  '      // Mount ride logic');
const companionObjects = new Set(); // Models the exact Set consulted by the real spawn loop.
const player = { x: 100, y: 100, angle: 0 }; // Both source and summoned creatures share this owner.
const stable = [{ id: 'stable_bingo', kind: 'dabinggi-hound', name: 'Bingo' }]; // Starter stays owned.
const equipped = { companion: null, shoulderPet: null }; // Default creature slots intentionally empty.
const gearInventory = { whistles: [{ id: 'whistle_bingo', creatureKey: 'dabinggi-hound', name: 'Bingo' }] };
const equipmentSlots = { whistle: null };
const window = {
  FarmPanel: { activeStableIdForRole: role => equipped[role] },
  CombatTutorial: { originalEquipment: () => null },
  CompanionDowned: { onCompanionSpawned() {} },
  __farmLog() {},
};
let created = 0; // Counts actual actor factory calls to catch hidden fallback summons.
const spawn = new Function('window', 'player', 'stable', 'companionObjects', 'cutscenePreviewActive',
  'gearInventory', 'equipmentSlots', 'CREATURE_DB', 'TILE', 'currentArea', 'makeCreatureEntity',
  'despawnCompanions', spawnSource + '\nreturn syncCompanionFromWhistle;')(
  window, player, stable, companionObjects, false, gearInventory, equipmentSlots,
  { 'dabinggi-hound': {} }, 64, 'farm',
  (creatureKey, x, y, other) => { created++; return { creatureKey, x, y, areaId: 'farm', ...other }; },
  (master, role) => {
    for (const actor of companionObjects) {
      if (actor.master === master && actor.stableRole === role) companionObjects.delete(actor);
    }
  });
spawn();
assert.equal(created, 0, 'Owning a starter animal and whistle never summons one with empty slots');
equipped.companion = 'stable_bingo';
spawn();
assert.equal(companionObjects.size, 1, 'Explicit Stable selection summons the owned animal');
equipped.companion = null;
spawn();
assert.equal(companionObjects.size, 0, 'Deselecting the Stable animal despawns it');
equipmentSlots.whistle = 'whistle_bingo';
spawn();
assert.equal(companionObjects.size, 1, 'Explicitly equipped whistles still summon companions');
equipmentSlots.whistle = null;
spawn();
assert.equal(companionObjects.size, 0, 'Unequipping the whistle despawns its companion');

assert.doesNotMatch(section(farmAnimals, '  function addToStable(', '  // Recreates every animal'),
  /_autoAssignStableRole/, 'Obtaining an animal must not auto-fill the empty role slot');
assert.doesNotMatch(section(farmPanel, '  function _addToOwnStable(', '  function moveLivestockToStable('),
  /_autoAssignStableRole/, 'Moving an adult animal into the Stable must not auto-equip it');
console.log('Manual animal slot behavior, save restoration, and starter ownership tests passed.');
