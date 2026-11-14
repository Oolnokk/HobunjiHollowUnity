'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { expandClassicScriptGroups } = require('./classic-script-group-index.js'); // Resolves versioned parser-time service registrations.

const source = fs.readFileSync('docs/js/companion-movement-speed.js', 'utf8'); // Executes the production module in a deterministic fake game runtime.
const index = expandClassicScriptGroups(fs.readFileSync('docs/index.html', 'utf8')); // Verifies the effective game loader, including the pre-game services manifest.
const moduleScriptPattern = new RegExp('companion-movement-speed\\.js\\?v' + '=[A-Za-z0-9_-]+'); // Split the cache-token delimiter so the no-pin audit does not mistake this generic pattern for an exact version.
assert.match(index, moduleScriptPattern, 'game index loads the owner-relative companion speed module with any valid cache token');

let now = 1000; // Advances the deterministic clock used for position-only NPC owner sampling.
let terrainType = 'grass'; // Changes the active player tile between grass, raised terrain and river.
let bridgeDeck = false; // Simulates the bridge-aware player movement predicate above a river tile.
let combatMul = 0.9; // Represents the live Combat movement modifier.
let alchemyMul = 1.2; // Represents the live Alchemy movement modifier.
let cookingMul = 1.1; // Represents the live food movement modifier.
let devMul = 1; // Represents the mutable global speed setting.
let perceptionMul = 1; // Represents Perception Mode movement, both mounted and on foot.
let stickyMul = 1; // Represents a live player Soursap Sticky movement effect.
let festivalMul = 1; // Represents a live Festival movement blessing.
let npcOwnerMul = 0.75; // Lets the position-only NPC fixture change buffs while paused.
let siccedTarget = null; // Exercises target selection that bypasses the normal companion combat commitment.
let downedTarget = null; // Exercises downed-owner focus without a normal committed combat target.
const schedulerRegistrations = new Map(); // Captures the production pre-game subscription for ordering assertions.
const player = { x: 64, y: 64, footing: 100, maxFooting: 100 }; // Uses the same pixel-space player position and footing values as the runtime.
const companionObjects = new Set(); // Mirrors Combat.deps.companionObjects.
const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'grass' }))); // Minimal active terrain for the player's tile lookup.
const windowStub = {
  RuntimeFrameScheduler: {
    register(id, callback, options) {
      schedulerRegistrations.set(id, { callback, options });
      return () => schedulerRegistrations.delete(id);
    },
  },
  Combat: {
    init(deps) { this.deps = deps; },
    getMovementSpeedMul() { return combatMul; },
  },
  CookingSystem: { getSpeedMultiplier() { return cookingMul; } },
  AlchemySystem: { getMovementSpeedMultiplier() { return alchemyMul; } },
  ResourceSystem: { getEffectiveMax() { return 100; } },
  PerceptionMode: { speedMultiplier() { return perceptionMul; } },
  RangedWeapons: { movementSpeedMultiplier() { return stickyMul; } },
  FestivalSystem: { blessingMultiplier() { return festivalMul; } },
  EnchantmentSystem: { getCurrentSiccedTarget() { return siccedTarget; } },
  PlayerDowned: { getFocusTarget() { return downedTarget; } },
  Mounts: {
    init(deps) { this.deps = deps; },
    rideState: 'none',
    rideEntity: null,
  },
  NpcCharacterState: { movementSpeedMultiplier() { return npcOwnerMul; } },
  _npcWalkers: new Map(),
};
const deps = {
  player,
  companionObjects,
  MOVE_SPEED: 238,
  TILE: 32,
  getActiveGrid: () => grid,
  getCurrentArea: () => 'town',
  getPlayerTerrainSpeedMul: () => bridgeDeck ? 1 : ({ river: 0.5, raised: 0.9 })[terrainType] ?? 1, // Mirrors game.js's actual bridge-aware tileSpeedAt result.
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

windowStub.Mounts.init({
  MOVE_SPEED: 238,
  getDevGlobalSpeedMul: () => devMul,
  getAlchemySpeedMul: () => alchemyMul,
});
windowStub.Combat.init(deps);
const api = windowStub.CompanionMovementSpeed; // The same public diagnostic/test surface used by the live game.
assert(api, 'companion movement speed API is installed');
assert.equal(api.debugSnapshot().initialized, true, 'Combat.init supplies the live runtime dependencies');
assert.equal(windowStub.Mounts.deps.MOVE_SPEED, 238, 'Mounts retains the authoritative movement dependency supplied to its init');
assert.equal(schedulerRegistrations.get('companion-movement-speed')?.options.phase, 'pre-game',
  'owner-relative speeds update before gameplay simulation consumes companion movement definitions');

const sourceDef = { moveSpeed: 100, chaseSpeed: 160 }; // Represents shared species data that must not be mutated.
const playerPet = { id: 'player-pet', isCompanion: true, master: player, def: sourceDef };
companionObjects.add(playerPet);
api.update();
const defaultPlayerSpeed = 238 * cookingMul * combatMul * alchemyMul;
assert.ok(Math.abs(playerPet.def.moveSpeed - defaultPlayerSpeed) < 1e-9, 'ordinary follow speed equals 100% of the player’s current effective speed');
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed) < 1e-9, 'chase speed also follows the player’s current effective pace');
assert.equal(sourceDef.moveSpeed, 100, 'shared species moveSpeed remains unchanged');
assert.equal(sourceDef.chaseSpeed, 160, 'shared species chaseSpeed remains unchanged');
playerPet.stableRole = 'companion';
playerPet._companionGroundFollow = { distancePx: 32 * 6 }; // Simulates a ground pet far behind its owner's path.
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed * 1.65) < 1e-9,
  'a distant follower gets a bounded catch-up advantage without changing the owner baseline');
playerPet._companionGroundFollow.distancePx = 32 * 2.2;
assert.ok(playerPet.def.chaseSpeed > defaultPlayerSpeed,
  'catch-up begins with an advantage at the real follow threshold, instead of asymptotically stalling there');
playerPet._companionGroundFollow.distancePx = 32 * 1.1;
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed) < 1e-9,
  'catch-up acceleration drops back to normal inside the near-follow distance');
playerPet._companionGroundFollow.distancePx = 32 * 6;
siccedTarget = { areaId: 'town', health: 100 };
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed) < 1e-9,
  'Sicced focus suppresses follow acceleration even without a scored _companionCombatTarget');
siccedTarget = null;
downedTarget = { areaId: 'town', health: 100 };
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed) < 1e-9,
  'downed-owner ranged focus suppresses catch-up without a scored _companionCombatTarget');
downedTarget = null;
assert.ok(Math.abs(playerPet.def.moveSpeed - defaultPlayerSpeed) < 1e-9,
  'idle wandering and non-pursuit movement do not gain catch-up speed');
playerPet._companionCombatTarget = { id: 'hostile', health: 100 };
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed) < 1e-9,
  'combat pursuit does not inherit the owner catch-up acceleration');
playerPet._companionCombatTarget = null;
playerPet.banditCompanion = true;
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed) < 1e-9,
  'enemy Beastmaster pets are never accelerated by player follow distance');
playerPet.banditCompanion = false;
playerPet.ownerMovementSpeedPercent = 50;
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed * 0.5) < 1e-9,
  'a deliberately reduced owner-speed percentage is respected instead of overridden by catch-up');
playerPet.ownerMovementSpeedPercent = null;
assert.ok(Math.abs(playerPet.def.chaseSpeed - defaultPlayerSpeed * 1.65) < 1e-9,
  'a null owner-speed percentage is treated as absent rather than as zero');
playerPet._companionGroundFollow = { distancePx: 0 };
const playerPetDefinitionProxy = playerPet.def; // Retained to prove the per-frame discovery pass is idempotent.
api.update();
assert.strictEqual(playerPet.def, playerPetDefinitionProxy, 'repeated companion scans do not wrap an entity definition more than once');

combatMul = 0.8;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * cookingMul * combatMul * alchemyMul)) < 1e-9,
  'an active Combat speed change is reflected on the next speed read without rewrapping the companion');

terrainType = 'river';
grid[2][2].type = terrainType;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * 0.5 * cookingMul * combatMul * alchemyMul)) < 1e-9,
  'terrain slowdowns on the player are reflected by the companion');
bridgeDeck = true;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * cookingMul * combatMul * alchemyMul)) < 1e-9,
  'a bridge deck above river water has normal player and companion pace');
bridgeDeck = false;
terrainType = 'raised';
grid[2][2].type = terrainType;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * 0.9 * cookingMul * combatMul * alchemyMul)) < 1e-9,
  'raised terrain shares the authoritative 0.9 player movement modifier');
delete deps.getPlayerTerrainSpeedMul;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * 0.9 * cookingMul * combatMul * alchemyMul)) < 1e-9,
  'isolated callers retain a terrain lookup when game.js is unavailable');
deps.getPlayerTerrainSpeedMul = () => bridgeDeck ? 1 : ({ river: 0.5, raised: 0.9 })[terrainType] ?? 1;
terrainType = 'grass';
grid[2][2].type = 'grass';

player.footing = 50;
player.afflictions = { drunkenFooting: 50 };
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * cookingMul * combatMul * alchemyMul * 0.775)) < 1e-9,
  'active drunken Footing applies the same current movement penalty as the player');
player.afflictions = {};
player.footing = 20;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * cookingMul * combatMul * alchemyMul * 0.64)) < 1e-9,
  'ordinary low Footing still slows the player and companion, even without drunkenness');
player.footing = 100;

stickyMul = 0.8;
festivalMul = 1.25;
perceptionMul = 0.6;
assert.ok(Math.abs(playerPet.def.moveSpeed - (238 * cookingMul * combatMul * alchemyMul * stickyMul * festivalMul * perceptionMul)) < 1e-9,
  'the stationary player pace includes Soursap Sticky, Festival blessings and Perception Mode');
stickyMul = 1;
festivalMul = 1;
perceptionMul = 1;

devMul = 1.1;
assert.ok(Math.abs(playerPet.def.moveSpeed * devMul - (238 * cookingMul * combatMul * alchemyMul * devMul)) < 1e-9,
  'the creature mover applies the global setting once, rather than squaring it');
player.vx = 90;
player.vy = 120;
assert.ok(Math.abs(playerPet.def.moveSpeed * devMul - 150) < 1e-9,
  'on-foot companion pace follows owner velocity without doubling the global modifier');
player.vx = 0;
player.vy = 0;

windowStub.Mounts.rideState = 'mounted';
windowStub.Mounts.rideEntity = { def: { mountSpeed: 340 } };
perceptionMul = 0.5;
const mountedSpeed = 340 * alchemyMul * devMul * perceptionMul;
assert.ok(Math.abs(playerPet.def.moveSpeed * devMul - mountedSpeed) < 1e-9,
  'a stationary mounted owner transfers the mount’s live top speed without duplicating the global modifier');
windowStub.Mounts.rideEntity.vx = 90;
windowStub.Mounts.rideEntity.vy = 120;
assert.ok(Math.abs(playerPet.def.moveSpeed * devMul - 150) < 1e-9,
  'a moving mount transfers its live velocity without duplicating the global modifier');
windowStub.Mounts.rideEntity.vx = 0;
windowStub.Mounts.rideEntity.vy = 0;
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
windowStub._npcWalkers.set('npc-owner', {
  rec: { id: 'npc-owner' },
  _moveSpeedTiles: 4,
  root: { position: { x: 2, z: 2 } },
});
assert.equal(npcPet.def.moveSpeed, 128, 'a live NPC walker’s current catch-up pace takes precedence over its static authored species speed');
devMul = 1.5;
assert.ok(Math.abs(npcPet.def.moveSpeed * devMul - 128) < 1e-9,
  'an NPC walker world pace is not multiplied by the global movement setting a second time');
windowStub._npcWalkers.delete('npc-owner');
assert.equal(npcPet.def.moveSpeed, 90,
  'a creature owner with authored movement retains the shared creature-global movement modifier');
npcOwner.currentMovementSpeedPxS = 240;
assert.ok(Math.abs(npcPet.def.moveSpeed * devMul - 240) < 1e-9,
  'a creature owner with explicit live world velocity is not multiplied by the global setting again');
delete npcOwner.currentMovementSpeedPxS;
windowStub._npcWalkers.set('npc-owner', {
  rec: { id: 'npc-owner' }, _moveSpeedTiles: 4, root: { position: { x: 2, z: 2 } },
});
devMul = 1;

npcPet.ownerMovementSpeedPercent = 50;
assert.equal(npcPet.def.moveSpeed, 64, 'an explicit owner-speed percentage scales the owner’s current catch-up speed');

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
npcOwnerMul = 0.5;
assert.ok(Math.abs(jubmirPet.def.moveSpeed - (32 / 0.75 * 0.5)) < 1e-9,
  'position-sampled NPC pace re-applies live owner buffs/debuffs even while the owner pauses');

const mount = { id: 'mount', isCompanion: true, stableRole: 'mount', master: player, def: { moveSpeed: 200, chaseSpeed: 280, mountSpeed: 340 } };
companionObjects.add(mount);
api.update();
assert.equal(mount.def.moveSpeed, 200, 'the mounted animal itself is excluded from owner-relative pet scaling');
assert.equal(mount.def.mountSpeed, 340, 'mount top speed remains authored and cannot feed back into its own rider speed');

assert.equal(api.debugSnapshot().companionCount, 3, 'diagnostics report player, NPC, and position-only NPC companions but not the mount');
assert.equal(api.debugSnapshot().lastError, null, 'normal update paths do not record an error');

// Exercise game.js's actual movement choke point, not a second copy of its speed formula.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Shares the production movement authority used by regular animal and cliff-route travel.
const moveStart = gameSource.indexOf('function moveCreatureToward(c, tx, ty, speed, dt)');
const moveEnd = gameSource.indexOf('\n      // Grid-walkability predicate', moveStart);
assert(moveStart >= 0 && moveEnd > moveStart, 'the game still exposes one creature movement function for the integration fixture');
let routeApproach = true; // Switches the real moveCreatureToward between cliff entry and ordinary ground motion.
let cliffReceivedSpeed = null; // Captures the world speed passed to the cliff-route navigator.
let creatureHeavyMul = 1; // Applies a creature-specific Heavy slowdown to both paths.
let creatureStickyMul = 1; // Applies a creature-specific Sticky slowdown to both paths.
const moveContext = {
  window: {
    CreatureCliffClimb: { navigate: (_actor, _x, _y, speed) => {
      cliffReceivedSpeed = speed;
      return routeApproach;
    } },
    RangedWeapons: { movementDirectionMultiplier: () => 1, movementSpeedMultiplier: () => creatureStickyMul },
    ResourceSystem: { timedDebuffModifier: () => creatureHeavyMul },
    DevRandomRuin: { syncShaftCreatureFloor() {} },
    EnemyCollisionReposition: { MIN_MOVE_FRAC: 0.25, tryReposition: () => null },
  },
  devGlobalSpeedMul: 1.6,
  isCreatureSwimming: () => false,
  isCreatureClimbing: () => false,
  creatureCanEnterTile: () => true,
  tickCreatureFootsteps: () => {},
  TILE: 32,
  Math,
  Number,
};
const moveCreature = vm.runInNewContext('(' + gameSource.slice(moveStart, moveEnd).trim() + ')', moveContext);
player.vx = 90;
player.vy = 120;
devMul = 1.6;
playerPet._companionGroundFollow = { distancePx: 32 * 6 }; // Both paths must use the 1.65x bounded follow recovery pace.
const expectedCatchupWorldSpeed = 150 * 1.65;
const routeActor = { ...playerPet, x: 0, y: 0, def: playerPet.def };
assert.equal(moveCreature(routeActor, 1000, 0, routeActor.def.chaseSpeed, 1 / 60), true);
assert.ok(Math.abs(cliffReceivedSpeed - expectedCatchupWorldSpeed) < 1e-9,
  'a cliff entry receives the same world follow speed as ordinary movement after one global multiplier');
routeApproach = false;
assert.equal(moveCreature(routeActor, 1000, 0, routeActor.def.chaseSpeed, 1 / 60), true);
assert.ok(Math.abs(routeActor.x - expectedCatchupWorldSpeed / 60) < 1e-9,
  'ordinary ground movement achieves the same catch-up speed without double global application');
creatureHeavyMul = 0.75;
creatureStickyMul = 0.8;
routeApproach = true;
assert.equal(moveCreature(routeActor, 1000, 0, routeActor.def.chaseSpeed, 1 / 60), true);
assert.ok(Math.abs(cliffReceivedSpeed - expectedCatchupWorldSpeed * creatureHeavyMul * creatureStickyMul) < 1e-9,
  'cliff approach respects per-creature Heavy and Sticky penalties like the normal mover');
routeApproach = false;
const earlierX = routeActor.x; // Used to compare only this slowed ground-movement frame.
assert.equal(moveCreature(routeActor, 1000, 0, routeActor.def.chaseSpeed, 1 / 60), true);
assert.ok(Math.abs(routeActor.x - earlierX - expectedCatchupWorldSpeed * creatureHeavyMul * creatureStickyMul / 60) < 1e-9,
  'ground movement remains numerically identical to the slowed cliff approach');
player.vx = 0;
player.vy = 0;
devMul = 1;
playerPet._companionGroundFollow = { distancePx: 0 };

console.log('companion movement speed regressions passed');
