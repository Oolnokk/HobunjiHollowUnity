'use strict';
// Playable-content checks for Tzatzul's live authored rig and non-incubatable high-value eggs.
// Run: node scripts/test-tzatzul-live-visuals-and-eggs.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(file, 'utf8'); // Loads production modules verbatim.
const dataWorld = { window: {
  Combat: { animalAttacks: { register() {} } },
  EffectBuffBar: { registerProvider() {} },
}, document: { getElementById: () => ({}) }, console, Math, Date, Promise };
vm.runInNewContext(read('docs/js/cooking-data.js'), dataWorld);
vm.runInNewContext(read('docs/js/cooking-system.js'), dataWorld);
vm.runInNewContext(read('docs/js/tzatzul-registration.js'), dataWorld);
const cooking = dataWorld.window.HobunjiCookingData;
const egg = cooking.items.tzatzulEgg; // One canonical egg ingredient must not create an incubatable livestock species.
assert.equal(egg.infertile, true);
assert.equal(egg.incubatable, false);
assert(egg.categories.includes('egg'), 'Tzatzul Egg participates in normal egg recipes');
const itemDefs = {}; // Authoritative gameplay pack/shipping defs, not a preview-only item list.
const inventoryItems = []; // Gameplay pack catalog passed to CookingSystem.init.
dataWorld.window.CookingSystem.init({ ITEM_DEFS: itemDefs, inventoryItems });
assert.equal(itemDefs.tzatzulEgg.sellPrice, 240, 'rare infertile egg keeps its authored resale value');
assert.equal(itemDefs.tzatzulEgg.cat, 'food');
assert.deepEqual(Array.from(itemDefs.tzatzulEgg.cookingCategories), ['egg']);
assert.equal(itemDefs.tzatzulEgg.cookingPrimaryEffect, 'perception');
assert(inventoryItems.some(item => item.key === 'tzatzulEgg'), 'egg is available in the actual item catalog');
assert(!dataWorld.window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.tzatzulEgg,
  'egg is never entered in the hatchable-livestock lookup');
const db = { grehlr: { maxHealth: 60 } };
assert(dataWorld.window.TzatzulRegistration.register({ CREATURE_DB: db, TILE: 64 }));
assert.equal(db.tzatzul.lootPool, 'mixedCrateTreasurePuzzle', 'adult remains get the full mixed loot source');
assert.equal(db['tzatzul-hatchling'].lootPool, 'creature_tzatzul_hatchling', 'hatchlings do not replicate adult hoards');
const loot = JSON.parse(read('docs/config/loot/loot-pools.json'));
assert.equal(loot.pools.creature_tzatzul_hatchling.entries.length, 0);
assert.deepEqual(Array.from(loot.pools.mixedCrateTreasurePuzzle.sourcePools, s => s.poolId),
  ['crateJunk', 'treasureChest', 'puzzleCave']);
assert.equal(loot.pools.puzzleCave.entries.length, 0, 'future puzzle loot remains deliberately unpopulated');

const created = []; // Tracks actual per-instance rig allocations and disposal after death.
const painted = []; // Confirms the game-controlled pose reaches the authored wing renderer.
let createDelay = null; // Deferred rig construction simulates an async image fetch outliving the actor.
const visualWorld = {
  window: {
    TzatzulRegistration: {
      KIND: 'tzatzul',
      identityFor(area, id) { return { mapId: area, id, tintHex: '#a0b0c0' }; },
      createRig(identity) {
        const instance = {
          identity, disposed: false,
          root: { parent: null, rotation: { y: 0 }, scale: { x: null, setScalar(x) { this.x = x; } } },
          update(camera, pose, elapsed, carrying) { painted.push({ pose, elapsed, carrying }); },
          dispose() { this.disposed = true; this.root.parent?.remove(this.root); }
        };
        created.push(instance);
        return createDelay ? new Promise(resolve => { createDelay(resolve, instance); }) : Promise.resolve(instance);
      }
    },
    Combat: { deps: { getActiveCamera: () => ({ getWorldPosition() {} }) } },
    __farmLog() {}
  },
  console, Math, Date, Promise, Map, Set, performance: { now: () => 1000 },
};
vm.runInNewContext(read('docs/js/tzatzul-live-visuals.js'), visualWorld);
const visuals = visualWorld.window.TzatzulLiveVisuals;
function avatar() {
  const group = { children: [], parent: {}, userData: {},
    add(node) { this.children.push(node); node.parent = this; },
    remove(node) { this.children = this.children.filter(other => other !== node); node.parent = null; } };
  const front = { isMesh: true, parent: group, name: 'animal_front_plane', visible: true,
    geometry: { parameters: { height: 2.2 } }, userData: { hobunjiPlaneFace: 'front' } };
  const back = { isMesh: true, parent: group, name: 'animal_back_plane', visible: true,
    geometry: { parameters: { height: 2.2 } }, userData: { hobunjiPlaneFace: 'back' } };
  group.children.push(front, back);
  return { group, frontPlane: front, backPlane: back };
}
const hostiles = new Set(); // The authoritative combat hostile roster; never a new parallel enemy list.
const adult = { id: 'visible-bird', creatureKey: 'tzatzul', health: 40, areaId: 'map_northern_cliffs',
  avatarRef: avatar(), def: { modelWidth: 2.2 }, x: 64, y: 128, state: 'idle' };
hostiles.add(adult);
visuals.init({ hostileObjects: hostiles, getCurrentArea: () => 'map_northern_cliffs' });
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
(async () => {
  assert.equal(visuals.tick(0.016, 'map_northern_cliffs'), 1);
  await flush();
  assert.equal(created.length, 1, 'only one bird rig is allocated');
  assert.equal(visuals.snapshot().liveRigs, 1);
  assert.equal(created[0].root.scale.x, 2.2, 'flying rig inherits native creature portrait height');
  assert.equal(adult.avatarRef.frontPlane.visible, false);
  assert.equal(adult.avatarRef.backPlane.visible, false);
  visuals.tick(0.016, 'map_northern_cliffs');
  assert.equal(painted.at(-1).pose, 'perched');
  adult._animalAttack = { id: 'pounce' };
  visuals.tick(0.016, 'map_northern_cliffs');
  assert.equal(painted.at(-1).pose, 'flap', 'pouncing Tzatzul display the articulated wings');
  adult.tzatzulFlightPose = 'glide';
  adult.tzatzulCarrying = true;
  visuals.tick(0.016, 'map_northern_cliffs');
  assert.deepEqual([painted.at(-1).pose, painted.at(-1).carrying], ['glide', true],
    'later flight/prey AI can choose glide and gripping-portrait art directly');
  assert.equal(visuals.snapshot().scans, 1, 'only the initial tick scans the full hostile roster');
  adult.health = 0;
  visuals.tick(0.016, 'map_northern_cliffs');
  assert.equal(created[0].disposed, true, 'corpse transition disposes bird-specific textures and geometry');
  assert.equal(adult.avatarRef.frontPlane.visible, true, 'death restores the canonical lootable corpse portrait');
  assert.equal(visuals.snapshot().tracked, 0);

  // Late-resolving PNG downloads can never insert a detached scene tree.
  const late = { ...adult, id: 'late-bird', health: 40, avatarRef: avatar() };
  hostiles.add(late);
  let resolveLate = null; // Captures the single pending creation for the disappearance test.
  createDelay = (resolve) => { resolveLate = resolve; };
  visuals.tick(2, 'map_northern_cliffs');
  await flush();
  assert(resolveLate, 'new flying rig began asynchronous creation');
  hostiles.delete(late);
  visuals.tick(.016, 'map_northern_cliffs');
  resolveLate(created.at(-1));
  await flush();
  assert.equal(created.at(-1).disposed, true, 'late loader disposes its own rig after the animal vanished');
  assert.equal(late.avatarRef.group.children.length, 2, 'no detached bird meshes were attached after cleanup');
  assert.equal(visuals.snapshot().tracked, 0);
  console.log('Tzatzul rare infertile eggs, canonical mixed adult loot, authored live flying rig, camera animation, death and late-load cleanup PASS.');
})().catch(error => { console.error(error); process.exitCode = 1; });
