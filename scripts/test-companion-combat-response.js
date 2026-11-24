// Regression tests for live companion threat response and rescue arbitration.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/companion-combat-response.js'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '../docs/game.js'), 'utf8');
const navigationSource = fs.readFileSync(path.join(__dirname, '../docs/js/companion-follow-navigation.js'), 'utf8'); // Shared terrain authority for retreat.
const index = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const context = { window: { __farmLog() {} } };
vm.createContext(context);
vm.runInContext(source, context);
vm.runInContext(navigationSource, context);
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
// The player jumped or was knocked below a cliff while the pet was still fighting above.
const cliffGrid = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => ({ elevTier: 0, incline: false }))); // Small genuine tile-elevation fixture.
cliffGrid[0][0].elevTier = 2;
context.window.GridTileAccessors = { getActiveGrid: () => cliffGrid }; // Supplies production tile access without a game runtime.
context.window.Combat.deps.TILE = 64;
context.window.Combat.deps.getCurrentArea = () => 'forest'; // Only the active exterior map may influence companion combat.
context.window.Combat.deps._isZoneArea = area => area === 'forest';
context.window.Combat.deps.getActiveGrid = () => cliffGrid;
context.window.CompanionFollowNavigation.init({
  TILE: 64, getCurrentArea: () => 'forest', isZoneArea: area => area === 'forest', getActiveGrid: () => cliffGrid,
}); // The production combat decision now consumes the same follow navigation used by game.js.
let retreatClock = 10000; // Deterministic monotonic clock for the post-landing escape grace.
context.performance = { now: () => retreatClock };
let cancelledCliffAttack = 0; // Verifies that a started named attack does not retain movement authority during the drop.
context.window.Combat.animalAttacks = { cancel: actor => { cancelledCliffAttack++; actor._animalAttack = null; } };
const cliffPet = { id: 'cliff-pet', x: 32, y: 32, areaId: 'forest', isCompanion: true,
  stableRole: 'companion', _stage: { mode: 'active', t: 0.3 }, _animalAttack: { stage: 'windup' },
  _travelPath: [{ col: 0, row: 0 }], _travelPathTarget: { x: 34, y: 32 } }; // Follower still has old attack waypoints on upper ground.
const escapedOwner = { x: 160, y: 32, health: 100 }; // Owner landed on a lower safe shelf.
const pursuer = { id: 'cliff-foe', x: 34, y: 32, health: 20, areaId: 'forest', def: { hostile: true },
  targetCreature: cliffPet }; // Would otherwise pin the pet in a defensive fight.
cliffPet._companionCombatTarget = pursuer;
cliffPet._companionDecisionNextAt = 1e15; // A long cached decision must be invalidated the moment the owner drops.
assert.equal(R.shouldReevaluate(cliffPet, escapedOwner, 'forest', 150), true,
  'a newly lower owner overrides cached combat target reevaluation');
assert.equal(R.chooseTarget(cliffPet, escapedOwner, [pursuer], 'forest', 150), null,
  'the cliff-top pet leaves a fight to follow an owner who fell or jumped below');
assert.equal(cancelledCliffAttack, 1, 'committed named attack is cancelled via its existing lifecycle');
assert.equal(cliffPet._stage, null, 'old attack phase cannot reclaim movement during the drop');
assert.equal(cliffPet._travelPath, null, 'an old attack navigation path cannot steer back up the cliff');
cliffPet._travelPath = [{ col: 2, row: 1 }]; // A new safe detour may be computed while the owner is still below.
assert.equal(R.shouldReevaluate(cliffPet, escapedOwner, 'forest', 150), false,
  'an unchanged retreat should keep its cached target decision');
assert.equal(R.chooseTarget(cliffPet, escapedOwner, [pursuer], 'forest', 150), null);
assert.equal(cliffPet._travelPath.length, 1, 'repeated combat checks must not erase the new safe detour');
assert.equal(R.debugSnapshot(cliffPet).followingDownCliff, true, 'mobile diagnostics report descent priority');
let clearedTreasure = 0, clearedWatch = 0; // Confirms the response module owns secondary-behavior arbitration.
cliffPet.treasureCue = { x: 1 };
cliffPet.watchPlayerIdle = { timer: 1 };
const retained = R.prioritizeOwnerRetreat(cliffPet, pursuer, .05,
  () => { clearedTreasure++; }, () => { clearedWatch++; });
assert.equal(retained, null, 'owner retreat wins over reintroduced Sicced and committed targets');
assert.equal(clearedTreasure, 1);
assert.equal(clearedWatch, 1);
assert.equal(R.isRescuing(cliffPet, escapedOwner), false, 'rescue never overrides cliff escape');
cliffPet.treasureCue = null; cliffPet.watchPlayerIdle = null;
cliffGrid[0][0].incline = true; // A descending creature can briefly cross a cliff-face tile.
cliffPet._cliffClimb = { phase: 'climb', descending: true };
assert.equal(R.shouldFollowOwnerDownCliff(cliffPet, escapedOwner, 'forest'), true,
  'entering an incline during the drop does not resume combat in midair');
cliffPet._cliffClimb = null;
cliffGrid[0][0].incline = false;
cliffPet.x = 160; // Reunion begins the short escape grace, avoiding an immediate uphill charge back into combat.
assert.equal(R.shouldReevaluate(cliffPet, escapedOwner, 'forest', 150), false,
  'after landing, follow retreat stays active briefly instead of immediately reacquiring a cliff-top enemy');
assert.equal(R.chooseTarget(cliffPet, escapedOwner, [pursuer], 'forest', 150), null,
  'even an explicit combat scan cannot override post-landing escape grace');
assert.equal(R.debugSnapshot(cliffPet).followingDownCliff, true);
assert(R.debugSnapshot(cliffPet).escapeGraceRemainingMs > 0, 'escape countdown is visible in mobile diagnostics');
retreatClock += 2300; // The owner had time to run out of hostile alert range.
assert.equal(R.shouldReevaluate(cliffPet, escapedOwner, 'forest', 150), true,
  'normal targeting resumes when the short retreat grace expires');
assert.equal(R.chooseTarget(cliffPet, escapedOwner, [pursuer], 'forest', 150), pursuer,
  'combat can resume once the retreat has finished');
assert.equal(R.debugSnapshot(cliffPet).followingDownCliff, false);
cliffPet.x = 32;
assert.equal(R.shouldFollowOwnerDownCliff(cliffPet, escapedOwner, 'town'), false,
  'non-wilderness areas cannot trigger exterior cliff retreat behavior');
assert.equal(R.shouldFollowOwnerDownCliff({ ...cliffPet, areaId: 'cave' }, escapedOwner, 'forest'), false,
  'an animal in another area does not react to the player height');
cliffPet.isCompanion = false; cliffPet.x = 32; // Enemies are not ordered to abandon combat.
assert.equal(R.shouldFollowOwnerDownCliff(cliffPet, escapedOwner, 'forest'), false,
  'ordinary enemies and non-companions preserve their targeting');

assert.match(game, /CompanionCombatResponse\.isRescuing\(c, rescueHost\)/,
  'rescue versus retreat is arbitrated by the extracted combat response');
assert.match(game, /CompanionCombatResponse\.prioritizeOwnerRetreat\(/,
  'Sicced, downed-focus and committed target overrides pass through the final response arbiter');
assert.match(source, /if \(companion\.treasureCue\) clearTreasureCue\?\.\(companion, dt, 'following owner below cliff'\)/,
  'the response module clears a stale treasure detour before escape');
assert.match(game, /!target && !c\._followOwnerDownCliff && !c\.treasureCue/,
  'watch-player idle cannot start during the follow descent');
// Exercise the actual final target seam used by Sicced and downed-focus overrides.
const orderedPet = { id: 'ordered-pet', x: 0, y: 0, attackCooldownT: 1.25 };
const ordinaryEnemy = { id: 'ordinary', x: 30, y: 0, health: 20, areaId: 'forest' };
const markedEnemy = { id: 'marked', x: 50, y: 0, health: 20, areaId: 'forest' };
context.window.ResourceSystem = { getAffliction: (entity, id) => entity === markedEnemy && id === 'scentMarkedHealth' ? 5 : 0 };
assert.equal(R.chooseTarget(orderedPet, master, [ordinaryEnemy, markedEnemy], 'forest', 150), markedEnemy, 'friendly companion prioritizes scent within normal leash');
R.syncEffectiveTarget(orderedPet, ordinaryEnemy);
orderedPet._stage = { mode: 'backingUp', t: 1 };
orderedPet._travelPath = [{ col: 1, row: 1 }];
R.syncEffectiveTarget(orderedPet, markedEnemy);
assert.equal(orderedPet._stage, null, 'new explicit target abandons old backup');
assert.equal(orderedPet._travelPath, null, 'new explicit target abandons old route');
assert.equal(orderedPet.attackCooldownT, 1.25, 'retargeting never grants a free attack');
assert.equal(R.debugSnapshot(orderedPet).effectiveTarget, 'marked');
assert.equal(R.debugSnapshot(orderedPet).scentMarked, true);
assert.equal(R.validFocus({ ...markedEnemy, _denHidden: true }, 'forest'), false);
assert.equal(R.validFocus({ ...markedEnemy, x: NaN }, 'forest'), false);
assert.equal(R.validFocus({ ...markedEnemy, areaId: 'mine' }, 'forest'), false);
assert.match(game, /CompanionCombatResponse\.syncEffectiveTarget\(c, target\)/);
assert.match(game, /const biteTarget = biteBusy \? c\._companionBiteTarget : null/);
// LOS is checked only on readiness and reused for the same target in the short decision lease.
let geometryChecks = 0;
context.window.RangedWeapons = { hasLineOfSight() { geometryChecks++; return false; } };
assert.equal(R.canAttackThroughTerrain(orderedPet, markedEnemy), false);
assert.equal(R.canAttackThroughTerrain(orderedPet, markedEnemy), false);
assert.equal(geometryChecks, 1, 'repeated readiness probes reuse terrain geometry');
R.syncEffectiveTarget(orderedPet, ordinaryEnemy);
assert.equal(R.canAttackThroughTerrain(orderedPet, ordinaryEnemy), false);
assert.equal(geometryChecks, 2, 'new effective target receives a fresh terrain check');
console.log('Companion combat responsiveness tests passed.');
