#!/usr/bin/env node
'use strict';
// Executable target-choice and enemy projectile-hitbox regression; run with node scripts/run-tests.js enemy-pet-targeting.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Reads the shipped module and its integration points.

const win = { __farmLog() {} }; // In-game log stub for target acquisition.
let clock = 0; // A deterministic decision clock for the cached live selector.
const context = vm.createContext({ window: win, performance: { now: () => clock } }); // Executes the actual pure targeting owner, not a duplicate of it.
vm.runInContext(read('docs/js/combat/enemy-pet-targeting.js'), context);
const targeting = win.EnemyPetTargeting; // Public owner used by the game loop.
assert(targeting);

const player = { id: 'player', x: 90, y: 0, health: 100, areaId: 'zone' }; // Eligible player opponent.
const pet = { id: 'pet', isCompanion: true, stableRole: 'companion', master: player, x: 25, y: 0, health: 40, areaId: 'zone' }; // Active player-owned ground pet.
const shoulder = { ...pet, id: 'shoulder', stableRole: 'shoulderPet', x: 2 }; // Attached pet is not a second target.
const mount = { ...pet, id: 'mount', stableRole: 'mount', x: 3 }; // Mount is governed by its own system.
const banditPet = { ...pet, id: 'enemy-pet', banditCompanion: true, x: 4 }; // Enemy-owned pet is an ally.
const elsewhere = { ...pet, id: 'elsewhere', areaId: 'other', x: 5 }; // Cached actors outside the current zone cannot be attacked.
const npcHound = { ...pet, id: 'npc-hound', master: { id: 'jubmir' }, x: 1 }; // Jubmir-like NPC-owned companion must not draw the player's enemies.
const enemy = { id: 'bandit', x: 0, y: 0, health: 100, areaId: 'zone', isBandit: true }; // Hostile selector source.
const roster = new Set([shoulder, mount, banditPet, elsewhere, npcHound, pet]); // Mirrors the live companionObjects Set.

assert.equal(targeting.chooseAggroTarget(enemy, [player], roster, 'zone', 100, () => true), pet,
  'the closest independently standing combat companion can draw normal enemy aggro');
assert.equal(targeting.chooseAggroTarget(enemy, [player], roster, 'zone', 100, (observer, actor) => actor !== pet), player,
  'a hidden/blocked pet cannot prevent a visible player being acquired');
assert.equal(targeting.chooseAggroTarget(enemy, [player], roster, 'zone', 20, () => true), null,
  'normal aggro never bypasses its detection range for an off-range pet or player');
pet._downed = true;
assert.equal(targeting.chooseAggroTarget(enemy, [player], roster, 'zone', 100, () => true), player,
  'downed pets are not valid aggro targets');
assert.equal(targeting.viable(pet, 'zone'), false, 'an already downed pet invalidates a committed chase');
pet._downed = false; pet.health = 0;
assert.equal(targeting.chooseAggroTarget(enemy, [player], roster, 'zone', 100, () => true), player,
  'defeated pets are not reacquired');
pet.health = 40;
assert.equal(targeting.groundPet(shoulder, 'zone'), false);
assert.equal(targeting.groundPet(mount, 'zone'), false);
assert.equal(targeting.groundPet(banditPet, 'zone'), false);
assert.equal(targeting.groundPet(elsewhere, 'zone'), false);
assert.equal(targeting.groundPet(npcHound, 'zone', [player]), false,
  'NPC-owned companions cannot be mistaken for a player-owned pet');

const defendingEnemy = { ...enemy, state: 'chase', targetPlayer: player, homeX: 0, homeY: 0,
  def: { hostile: true, aggroRangePx: 100, leashRangePx: 120 } }; // A player-focused enemy hit by the pet.
assert.equal(targeting.shouldRetaliateToPetHit(defendingEnemy, pet, [player], 'zone'), true,
  'an engaged enemy may retaliate against the companion that just hit it');
defendingEnemy._chunkCombatTarget = { id: 'tribe-opponent' };
assert.equal(targeting.shouldRetaliateToPetHit(defendingEnemy, pet, [player], 'zone'), false,
  'pet aggression must not take over an active faction-ecology fight');
defendingEnemy._chunkCombatTarget = null; defendingEnemy.state = 'fleeing-low-health';
assert.equal(targeting.shouldRetaliateToPetHit(defendingEnemy, pet, [player], 'zone'), false,
  'retaliation must not break a deliberate retreat');
defendingEnemy.state = 'chase'; defendingEnemy.def.hostile = false;
assert.equal(targeting.shouldRetaliateToPetHit(defendingEnemy, pet, [player], 'zone'), false,
  'passive wildlife keeps its existing flee/territory behavior');
defendingEnemy.def.hostile = true; pet.x = 200;
assert.equal(targeting.shouldRetaliateToPetHit(defendingEnemy, pet, [player], 'zone'), false,
  'a distant pet cannot summon retaliation from outside ordinary aggro range');
pet.x = 25;

const master = { x: 0, y: 0 }; // Enemy pet's master-centered alert anchor.
banditPet.x = 0;
assert.equal(targeting.chooseBeastmasterTarget(banditPet, master, [player], roster, 'zone', 120), pet,
  'Beastmaster companions also consider the player\'s ground pet by default');
assert.equal(banditPet._beastmasterCombatTarget, pet, 'enemy pet commits to a real creature reference');
pet.x = 119; // Player at 90 is now more than 24% closer after the target-retention margin.
assert.equal(targeting.chooseBeastmasterTarget(banditPet, master, [player], roster, 'zone', 120), player,
  'enemy pet switches when the player becomes appreciably closer');
pet.x = 25;
assert.equal(targeting.chooseBeastmasterTarget(banditPet, master, [player], roster, 'zone', 120), pet);
pet.x = 32;
assert.equal(targeting.chooseBeastmasterTarget(banditPet, master, [player], roster, 'zone', 120), pet,
  'small movements must not cause target oscillation');
pet._downed = true;
assert.equal(targeting.chooseBeastmasterTarget(banditPet, master, [player], roster, 'zone', 120), player,
  'enemy pet drops a downed opponent immediately');
pet._downed = false;
assert.equal(targeting.chooseBeastmasterTarget(banditPet, master, [player], roster, 'zone', 15), null,
  'owner alert radius still constrains both opponents');
pet.x = 25;
assert.equal(targeting.chooseBeastmasterTarget(banditPet, master, [player], roster, 'zone', 120), pet);
roster.delete(pet); // Swapping/stowing a companion leaves the old entity alive but removes it from the combat roster.
assert.equal(targeting.chooseBeastmasterTarget(banditPet, master, [player], roster, 'zone', 120), player,
  'Beastmaster pets release a despawned companion even when its Health is still positive');
roster.add(pet);

// Runtime decision lease: no scan during the 140 ms window, immediate release on removal.
const trackedRoster = new Set([pet]); // Counts live enumeration without relying on real elapsed time.
let iterations = 0;
trackedRoster[Symbol.iterator] = function* () { iterations++; yield* Set.prototype[Symbol.iterator].call(this); };
assert.equal(targeting.chooseBeastmasterTargetCached(banditPet, master, [player], trackedRoster, 'zone', 120), pet);
for (let frame = 1; frame < 8; frame++) { clock = frame * 16; assert.equal(targeting.chooseBeastmasterTargetCached(banditPet, master, [player], trackedRoster, 'zone', 120), pet); }
assert.equal(iterations, 1, 'eight updates require only one full target scan');
trackedRoster.delete(pet);
assert.equal(targeting.chooseBeastmasterTargetCached(banditPet, master, [player], trackedRoster, 'zone', 120), player, 'removed target bypasses the decision lease');
assert.equal(iterations, 2);
clock += 141;
targeting.chooseBeastmasterTargetCached(banditPet, master, [player], trackedRoster, 'zone', 120);
assert.equal(iterations, 3, 'expired lease resumes target scoring');

const ranged = read('docs/js/combat/ranged-weapons.js'); // Canonical projectile sweep, not a second projectile implementation.
const match = ranged.match(/  function nearestPlayerCompanionHit\([\s\S]*?\n  \}/);
assert(match, 'enemy shots must use their own companion-aware hitbox sweep');
const deps = { player, companionObjects: roster }; // Same player identity and live Set used by the real game.
const hitboxContext = vm.createContext({
  deps, window: {}, segmentHitboxInterval(start, end, hitbox) { return hitbox?.interval || null; },
  actorHitbox(actor) { return actor.testBox; },
});
shoulder.testBox = { interval: { enter: 0.1 } };
mount.testBox = { interval: { enter: 0.1 } };
banditPet.testBox = { interval: { enter: 0.1 } };
elsewhere.testBox = { interval: { enter: 0.1 } };
npcHound.testBox = { interval: { enter: 0.05 } }; // A nearer NPC hound must not intercept a hostile shot aimed at the player's pet.
pet.testBox = { interval: { enter: 0.4 } };
vm.runInContext(match[0], hitboxContext);
assert.equal(vm.runInContext('nearestPlayerCompanionHit({}, {}, 0, "zone").creature', hitboxContext), pet,
  'projectiles can hit the ground pet but never shoulder pets, mounts, enemy pets, or other zones');
pet._downed = true;
assert.equal(vm.runInContext('nearestPlayerCompanionHit({}, {}, 0, "zone")', hitboxContext), null,
  'downed ground pets do not stop enemy bullets');
pet._downed = false;
assert.match(ranged, /nearest\.kind === 'hostile' \|\| nearest\.kind === 'companion'/,
  'pet projectile hits must use damageCreature instead of damagePlayer');
assert.match(ranged, /friendlyFire = nearest\.kind === 'hostile'/,
  'damage to a player pet must not be labelled as allied friendly fire');

const game = read('docs/game.js'); // Integration assertion guards the otherwise private runtime AI wiring.
assert.match(game, /EnemyPetTargeting\?\.chooseAggroTarget/);
assert.match(game, /EnemyPetTargeting\?\.chooseBeastmasterTarget/);
assert.match(game, /DamageAuthority\.hit\(targetPlayer, def\.attackDamage, c\.x, c\.y, HOSTILE_BITE_KNOCKBACK_PX_S, biteDamageOptions\)/); // Bite routes by victim: players via damagePlayer, pets via damageCreature.
assert.match(game, /shouldRetaliateToPetHit/, 'enemy damage handling forwards the real pet attacker into retaliation checks');
assert.match(game, /!companionObjects\.has\(c\.targetPlayer\)/,
  'ordinary enemy chases release a removed companion rather than chasing its stale entity');
const expanded = require('./classic-script-group-index.js').expandClassicScriptGroups(); // Loads the actual published bootstrap order.
assert(expanded.indexOf('js/combat/enemy-pet-targeting.js') > -1, 'target owner must load in the published build');
assert(expanded.indexOf('js/combat/enemy-pet-targeting.js') < expanded.indexOf('js/combat/ranged-weapons.js'));
assert(expanded.indexOf('js/combat/enemy-pet-targeting.js') < expanded.indexOf('<script src="game.js?v='),
  'targeting module must be loaded before the actual versioned game entrypoint, not an earlier filename suffix');
console.log('Enemy aggro, Beastmaster targeting and projectile pet collision tests passed.');
