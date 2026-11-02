'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/companion-movement-speed.js', 'utf8'); // Executes the production module in a deterministic fake game runtime.
const index = fs.readFileSync('docs/index.html', 'utf8'); // Verifies the runtime is loaded by the playable game.
assert.match(index, /companion-movement-speed\.js\?v=20261102ownerpace1/, 'game index loads the owner-relative companion speed module');

let now = 1000; // Advances the deterministic clock used for position-only NPC owner sampling.
let terrainType = 'grass'; // Changes the active player tile between grass and river for movement-speed parity.
let combatMul = 0.9; // Represents the live Combat movement modifier.
let alchemyMul = 1.2; // Represents the live Alchemy movement modifier.
let cookingMul = 1.1; // Represents the live food movement modifier.
let devMul = 1; // Represents the mutable global speed setting.
let perceptionMul = 0.5; // Represents the mounted Perception Mode movement modifier.
const callbacks = []; // Captures scheduled animation callbacks without running an endless browser frame loop.
const player = { x: 64, y: 64, footing: 100, maxFooting: 100 }; // Uses the same pixel-space player position and footing values as the runtime.
const companionObjects = new Set(); // Mirrors Combat.deps.companionObjects.
const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'grass' }))); // Minimal active terrain for the player's tile lookup.
const windowStub = {
  requestAnimationFrame(callback) { callbacks.push(callback); return callbacks.length; },
  Combat: {
    init(deps) { this.deps = deps; },
    getMovementSpeedMul() { return combatMul; },
  },
  CookingSystem: { getSpeedMultiplier() { return cookingMul; } },
  AlchemySystem: { getMovementSpeedMultiplier() { return alchemyMul; } },
  ResourceSystem: { getEffectiveMax() { return 100; } },
  PerceptionMode: { speedMultiplier() { return perceptionMul; } },
  Mounts: { rideState: 'none', rideEntity: null },
  NpcCharacterState: { movementSpeedMultiplier() { return 0.75; } },
  _npcWalkers: new Map(),
};
const deps = {
  player,
  companionObjects,
  MOVE_SPEED: 238,
  TILE: 32,
  getActiveGrid: () => grid,
  getDevGlobalSpeedMul: () => devMul,
  getAlchemySpeedMul: () => alchemyMul,
};
const context = {
  window: windowStub,
  performance: { now: () => now },
  Date,
  Math,
  Number,
  Object,
  Array,
  Map,
  Set,
  WeakMap,
  Proxy,
  Reflect,
};
vm.runInNewContext(source, context, { filename: 'companion-movement-speed.js' });

windowStub.Combat.init(deps);
const api = windowStub.CompanionMovementSpeed; // The same public diagnostic/test surface used by the live game.
assert(api, 'companion movement speed API is installed');
assert.equal(api.debugSnapshot().initialized, true, 'Combat.init supplies the live runtime dependencies');

const sourceDef = { moveSpeed: 100, chaseSpeed: 160 }; // Represents shared species data that must not be mutated.
const playerPet = { id: 'player-pet', isCompanion: true, master: player, def: sourceDef };
companionObjects.add(playerPet);
api.update();
const defaultPlayerSpeed = 238 * cookingMul * combatMul * alchemyMul;
assert.ok(Math.abs(playerPet.def.moveSpeed - defaultPlayerSpeed) < 1e-9, 'ordinary follow speed equals 100% of the player’s current effective speed');
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed) < 1e-9, 'chase speed also follows the player’s current effective pace');
assert.equal(sourceDef.moveSpeed, 100, 'shared species moveSpeed remains unchanged');
assert.equal(sourceDef.chaseSpeed, 160, 'shared species chaseSpeed remains unchanged');

combatMul = 0.8;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * cookingMul * combatMul * alchemyMul)) < 1e-9,
  'an active Combat speed change is reflected on the next speed read without rewrapping the companion');

terrainType = 'river';
grid[2][2].type = terrainType;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * 0.5 * cookingMul * combatMul * alchemyMul)) < 1e-9,
  'terrain slowdowns on the player are reflected by the companion');
grid[2][2].type = 'grass';

devMul = 1.1;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * cookingMul * combatMul * alchemyMul * devMul)) < 1e-9,
  'the live global movement-speed setting is included');

windowStub.Mounts.rideState = 'mounted';
windowStub.Mounts.rideEntity = { def: { mountSpeed: 340 } };
perceptionMul = 0.5;
const mountedSpeed = 340 * alchemyMul * devMul * perceptionMul * cookingMul * combatMul;
assert.ok(Math.abs(playerPet.def.moveSpeed - mountedSpeed) < 1e-9,
  'a mounted owner transfers the mount’s live top speed and applicable movement modifiers');
windowStub.Mounts.rideState = 'none';
windowStub.Mounts.rideEntity = null;
devMul = 1;
perceptionMul = 1;

const npcOwner = { npcId: 'npc-owner', state: 'idle', def: { moveSpeed: 120, chaseSpeed: 170 } }; // NPC-style owner exposes its own live authored movement values.
const npcPet = { id: 'npc-pet', isCompanion: true, master: npcOwner, def: { moveSpeed: 70, chaseSpeed: 90 } };
companionObjects.add(npcPet);
api.update();
assert.equal(npcPet.def.moveSpeed, 90, 'NPC-owned companion uses the owner’s move speed and current NPC movement modifier');
assert.equal(npcPet.def.chaseSpeed, 127.5, 'NPC-owned companion uses the owner’s chase speed and current NPC movement modifier');

npcPet.ownerMovementSpeedPercent = 50;
assert.equal(npcPet.def.moveSpeed, 45, 'an explicit owner-speed percentage scales the live owner speed');

const jubmirMaster = { npcId: 'jubmir', x: 0, y: 0, areaId: 'town' }; // Mirrors JubmirDabinggiHounds' position-only master adapter.
windowStub._npcWalkers.set('jubmir', { rec: { id: 'jubmir' }, root: { position: { x: 0, z: 0 } } });
const jubmirPet = { id: 'jubmir-pet', isCompanion: true, master: jubmirMaster, def: { moveSpeed: 80, chaseSpeed: 100 } };
companionObjects.add(jubmirPet);
api.update();
assert.equal(jubmirPet.def.moveSpeed, 80, 'a position-only NPC owner keeps the authored companion fallback until its pace is observed');
now += 1000;
jubmirMaster.x = 32;
assert.equal(jubmirPet.def.moveSpeed, 32, 'position-only NPC owner movement is measured in the same pixel-per-second units as creature movement');
now += 1000;
assert.equal(jubmirPet.def.moveSpeed, 32, 'the last observed NPC pace remains available while the owner pauses so a trailing companion can catch up');

const mount = { id: 'mount', isCompanion: true, stableRole: 'mount', master: player, def: { moveSpeed: 200, chaseSpeed: 280, mountSpeed: 340 } };
companionObjects.add(mount);
api.update();
assert.equal(mount.def.moveSpeed, 200, 'the mounted animal itself is excluded from owner-relative pet scaling');
assert.equal(mount.def.mountSpeed, 340, 'mount top speed remains authored and cannot feed back into its own rider speed');

assert.equal(api.debugSnapshot().companionCount, 3, 'diagnostics report player, NPC, and position-only NPC companions but not the mount');
assert.equal(api.debugSnapshot().lastError, null, 'normal update paths do not record an error');

console.log('companion movement speed regressions passed');
