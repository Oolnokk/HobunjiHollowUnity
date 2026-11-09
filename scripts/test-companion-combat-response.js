// Regression tests for live companion threat response and rescue arbitration.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/companion-combat-response.js'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const context = { window: { __farmLog() {} } };
vm.createContext(context);
vm.runInContext(source, context);
const R = context.window.CompanionCombatResponse;
assert(R, 'CompanionCombatResponse is registered');

const pet = { id: 'pet', x: 0, y: 0 }; // Actor whose target lock and diagnostics are exercised.
const master = { id: 'player', x: 0, y: 0 }; // Owner position determines alert radius and defensive priority.
const far = { id: 'far', x: 80, y: 0, health: 20, areaId: 'forest', def: { hostile: true } };
const close = { id: 'close', x: 35, y: 0, health: 20, areaId: 'forest', def: { hostile: true } };
const distant = { id: 'distant', x: 220, y: 0, health: 20, areaId: 'forest', def: { hostile: true } };
const herbivore = { id: 'grazer', x: 1, y: 0, health: 20, areaId: 'forest', def: { hostile: false } };
const unzoned = { id: 'unknown-zone', x: 0.1, y: 0, health: 20 }; // Transient or stale actors with no areaId must not be pursued across map changes.
const enemies = new Set([far, distant, herbivore, unzoned, close]); // Deliberately wrong insertion order must not determine the pet's target.
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), close, 'closest urgent enemy wins even if last in Set');
assert.equal(R.validEnemy(unzoned, 'forest'), false, 'unknown-area actors are excluded just as they were in the original game loop');
assert.equal(R.debugSnapshot(pet).target, 'close');
const idlessPlayer = { x: 0, y: 0, health: 100 }; // Actual player actors do not have creature IDs; rescue status must not appear blank.
context.window.Combat = { deps: { player: idlessPlayer } };
pet._honeyfuzzleRescueTarget = idlessPlayer;
assert.equal(R.debugSnapshot(pet).rescuing, 'player', 'mobile rescue diagnostics identify the player without a creature ID');
pet._honeyfuzzleRescueTarget = null;


pet._stage = { mode: 'backingUp', t: 0.9 }; // A stale retreat from a previous target should not delay response to a new enemy.
const slightlyNearer = { id: 'challenger', x: 32, y: 0, health: 20, areaId: 'forest' };
enemies.add(slightlyNearer);
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), close, 'small distance changes cannot flip-flop targets');
slightlyNearer.x = 9;
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), slightlyNearer, 'a substantially more urgent threat interrupts target commitment');
assert.equal(pet._stage.mode, 'active', 'switching to a much closer threat ends the old backup phase');
assert.equal(pet._stage.t, 0, 'new target begins a fresh response timer without resetting the attack cooldown');
slightlyNearer.health = 0;
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), close, 'dead target is immediately released');

const ownerThreat = { id: 'owner-threat', x: 47, y: 0, health: 20, areaId: 'forest', targetPlayer: master };
enemies.add(ownerThreat);
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), ownerThreat, 'actively attacking the owner raises enemy priority');
ownerThreat.areaId = 'cave';
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), close, 'area transitions immediately clear invalid targets');
close._denHidden = true;
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), far, 'hidden actors are never combat targets');
far._downed = true;
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), null, 'downed, out-of-range and herbivore targets are excluded');
assert.equal(R.debugSnapshot(pet).target, null, 'mobile diagnostics clear after disengaging');
const defender = { id: 'self-threat', x: 245, y: 0, health: 20, areaId: 'forest', targetCreature: pet };
pet.x = 240; // Companion is temporarily far from the master, so only a nearby attack should trigger self-defense.
enemies.add(defender);
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), defender, 'pet responds to an attacker on itself even beyond master alert radius');
defender.targetCreature = null;
assert.equal(R.chooseTarget(pet, master, enemies, 'forest', 150), null, 'pet disengages if the distant enemy stops threatening it');
pet.x = 0;


assert.equal(R.shouldRestartApproach({ mode: 'backingUp' }, 105, 100), false, 'minor range drift keeps a timed retreat');
assert.equal(R.shouldRestartApproach({ mode: 'backingUp' }, 110, 100), true, 'escaped enemy immediately restarts pursuit');
assert.equal(R.shouldRestartApproach({ mode: 'active' }, 150, 100), false, 'only backup-phase movement is interrupted');
assert.equal(R.shouldRestartApproach({ mode: 'backingUp' }, 50, 100, true), true, 'owner attacked during backup causes an immediate response');


assert.match(game, /CompanionCombatResponse\.chooseTarget\(c, master, hostileObjects, currentArea, ALERT_RANGE_PX\)/,
  'live AI uses the shared priority selector');
assert.match(game, /CompanionCombatResponse\?\.shouldRestartApproach\?\.\(st, dist, def\.attackRangePx,/,
  'live AI abandons unproductive backup movement');
assert.match(game, /rescueActive[\s\S]{0,1000}c\._stage = null/,
  'stale rescue targeting does not cause ordinary combat state to be abandoned');
assert.match(game, /else if \(rescueActive\) \{[\s\S]{0,400}rescueHost\.y/,
  'swarm rescue blocks ordinary follow and chase movement');
assert.match(game, /downedFocus\.health > 0 && !downedFocus\._downed/,
  'companion never pursues an invalid owner-downed focus');
assert(index.indexOf('js/companion-combat-response.js') < index.indexOf('game.js?v='),
  'responsive decisions load before the main game loop');
console.log('Companion combat responsiveness tests passed.');
