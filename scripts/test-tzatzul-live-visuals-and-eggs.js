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
assert(loot.pools.puzzleCave.entries.length > 0, 'mixed remains include the merged puzzle-cave reward pool');

const created = []; // Tracks actual per-instance rig allocations and disposal after death.
const painted = []; // Confirms the game-controlled pose reaches the authored wing renderer.
const tintChecks = []; // Confirms hit-flash expiry restores the identity tint instead of leaving a white body.
let createDelay = null; // Deferred rig construction simulates an async image fetch outliving the actor.
const visualWorld = {
  window: {
    TzatzulRegistration: {
      KIND: 'tzatzul',
      HATCHLING_KIND: 'tzatzul-hatchling', // Non-deformed perched artwork during actual hopping.
      HATCHLING_SCALE: { x:3/8, y:5/8 }, // The authored hatchling retains its own width and height.
      identityFor(area, id) { return { mapId: area, id, tintHex: '#a0b0c0' }; },
      createRig(identity, options = {}) {
        const instance = {
          identity, options, disposed: false,
          root: { parent: null, rotation: { y: 0 }, position: { y: 0 }, scale: { x: null, setScalar(x) { this.x = x; } } },
          update(camera, pose, elapsed, carrying, blinkShut) { painted.push({ pose, elapsed, carrying, blinkShut }); },
          restoreTint() { tintChecks.push(identity.tintHex); return false; },
          dispose() { this.disposed = true; this.root.parent?.remove(this.root); }
        };
        created.push(instance);
        return createDelay ? new Promise(resolve => { createDelay(resolve, instance); }) : Promise.resolve(instance);
      }
    },
    Combat: { deps: { getActiveCamera: () => ({ getWorldPosition() {} }) } },
    CreatureBlink: { isShut: () => true },
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
  assert.equal(painted.at(-1).blinkShut, true, 'the custom bird rig gets the native individual blink state');
  const cameraProvider = visualWorld.window.Combat.deps.getActiveCamera; // Reproduce an early area load with no combat camera available yet.
  visualWorld.window.Combat.deps.getActiveCamera = () => null;
  const beforeNoCamera = painted.length; // Counts actual authored pose updates rather than hidden default sprites.
  visuals.tick(0.016, 'map_northern_cliffs');
  assert.equal(painted.length, beforeNoCamera + 1,
    'camera-less area bootstrap still updates the real articulated bird pose');
  visualWorld.window.Combat.deps.getActiveCamera = cameraProvider;
  adult._animalAttack = { id: 'pounce' };
  visuals.tick(0.016, 'map_northern_cliffs');
  assert.equal(painted.at(-1).pose, 'flap', 'pouncing Tzatzul display the articulated wings');
  adult.tzatzulFlightPose = 'glide';
  adult.tzatzulCarrying = true;
  visuals.tick(0.016, 'map_northern_cliffs');
  assert.deepEqual([painted.at(-1).pose, painted.at(-1).carrying], ['glide', true],
    'later flight/prey AI can choose glide and gripping-portrait art directly');
  assert.equal(visuals.snapshot().scans, 1, 'only the initial tick scans the full hostile roster');
  const replacement = { isMesh: true, parent: adult.avatarRef.group, name: 'animal_front_plane', visible: true,
    geometry: { parameters: { height: 2.2 } }, userData: { hobunjiPlaneFace: 'front' } }; // Hit reaction re-builds the original native plane.
  adult.avatarRef.group.children.push(replacement);
  adult.avatarRef.frontPlane = replacement;
  const beforeTint = tintChecks.length;
  adult.hitFlashT = .15;
  visuals.tick(.016, 'map_northern_cliffs');
  assert.equal(replacement.visible, false, 'a regenerated untinted native portrait never covers the colored flying rig');
  assert.equal(tintChecks.length, beforeTint, 'custom bird tint is not forced over a legitimate hit flash');
  adult.hitFlashT = 0;
  visuals.tick(.016, 'map_northern_cliffs');
  assert.equal(tintChecks.length, beforeTint + 1, 'individual color is restored once the damage flash ends');
  assert.equal(visuals.snapshot().refreshedPlanes, 1, 'mobile diagnostics count the native replacement');
  const captive = { health:20, avatarRef: { group: { quaternion: {
    angle: .37, clone() { return { angle: this.angle }; }, copy(pose) { this.angle = pose.angle; }
  }, scale:{ x:1, clone(){ return {x:this.x}; }, copy(value){this.x=value.x;} } } } }; // A real surviving actor must regain rotation and size after the drop.
  assert(visuals.rememberCaptive(captive));
  captive.avatarRef.group.quaternion.angle = -1.23;
  assert(visuals.restoreCaptive(captive), 'a released prey is returned to its own native orientation');
  assert.equal(captive.avatarRef.group.quaternion.angle, .37);
  assert.equal(visuals.restoreCaptive(captive), false, 'repeat releases must never replay stale rotations');
  assert.equal(visuals.snapshot().captiveRestores, 1);
  captive.avatarRef.group.quaternion.angle = -1.23; captive.avatarRef.group.scale.x = 3; // A late renderer reapplies the talon matrix after release.
  visuals.tick(.016, 'map_northern_cliffs');
  assert.equal(captive.avatarRef.group.quaternion.angle,.37,'next-frame cleanup prevents a lingering sideways captive');
  assert.equal(captive.avatarRef.group.scale.x,1,'capture scale is restored too');
  visuals.tick(.016, 'map_northern_cliffs'); // The restoration fence expires after two ticks.
  captive.avatarRef.group.quaternion.angle = .8;
  visuals.tick(.016, 'map_northern_cliffs');
  assert.equal(captive.avatarRef.group.quaternion.angle,.8,'normal character animation takes over after the drop');

  const hatchling = { id:'test-hatchling', creatureKey:'tzatzul-hatchling', health:30,
    x:180, y:220, state:'idle', areaId:'map_northern_cliffs',
    def:{modelWidth:.85}, avatarRef:avatar() }; // A real registered creature, not decorative hatchling artwork.
  hostiles.add(hatchling);
  for(let step=0;step<7;step++)visuals.tick(.25,'map_northern_cliffs'); // Complete one bounded creature-registration scan.
  await flush();
  visuals.tick(.016,'map_northern_cliffs'); // Mount the rig and render its first stationary frame.
  const childRig=created.at(-1);
  assert.equal(childRig.options.undeformedPerch,true,'hatchling opts out of the adult seated spline');
  assert.equal(painted.at(-1).pose,'hatchling','perched pixels use flight-oriented hatchling pose');
  hatchling.x+=6;
  visuals.tick(.05,'map_northern_cliffs');
  assert(childRig.root.position.y>0,'moving hatchling performs a visible upward hop');
  hostiles.delete(hatchling);
  visuals.tick(.016,'map_northern_cliffs');
  assert(childRig.disposed,'the hatchling rig is cleaned up with its owner');

  adult.health = 0;
  visuals.tick(0.016, 'map_northern_cliffs');
  assert.equal(created[0].disposed, true, 'corpse transition disposes bird-specific textures and geometry');
  assert.equal(adult.avatarRef.frontPlane.visible, true, 'death restores the latest canonical lootable corpse portrait');
  assert.equal(visuals.snapshot().tracked, 0);

  // Late-resolving PNG downloads can never insert a detached scene tree.
  const late = { ...adult, id: 'late-bird', health: 40, avatarRef: avatar() };
  hostiles.add(late);
  let resolveLate = null; // Captures the single pending creation for the disappearance test.
  createDelay = (resolve) => { resolveLate = resolve; };
  for (let step = 0; step < 9; step++) visuals.tick(.25, 'map_northern_cliffs'); // Real tick clamps frame delta to 0.25s; emulate successive frames, not a multi-second hitch.
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
