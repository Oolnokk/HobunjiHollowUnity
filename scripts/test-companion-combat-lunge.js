#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const TILE = 32; // Fixed world tile for measuring the 2.6-tile opening burst.
const logs = []; // Captures the game's mobile-visible lunge diagnostics.
const damage = []; // Records the one committed signature attack's strike side effects.
const target = { x: TILE * 3, y: 0, health: 50, areaId: 'cliffs' }; // Outside bite reach, inside the extended attack trigger radius.
const actor = {
  id: 'companion-hound', creatureKey: 'dabinggi-hound', isCompanion: true,
  x: 0, y: 0, health: 50, areaId: 'cliffs', facing: 0, stamina: 100,
  attackCooldownT: 0,
  def: { attackRangePx: TILE, attackHalfConeRad: Math.PI / 3, attackCooldownS: 2, attackStaminaCost: 10, attacks: ['testBite'], realAttackEvery: 1, chaseSpeed: 100 },
}; // Generic companion with no special-case Voorg-Ass code.
const sandbox = {
  console, Math, window: {
    Combat: {
      deps: { TILE, player: { x: -100, y: 0 }, canOccupyAt: () => true, requestThreatGrowl() {} },
      meleeHit: () => true,
    },
    ResourceSystem: { spendStamina(c, cost) { c.stamina -= cost; } },
    StableAnimalTrainingRefinements: { chooseAttack: () => ({ id: 'testBite' }) },
    __farmLog: (...args) => logs.push(args),
  },
}; // Only public engine dependencies: runs the real modular lunge implementation without Three.js.
vm.createContext(sandbox);
sandbox.window.window = sandbox.window;
const src = fs.readFileSync('docs/js/combat/combat-animal-attacks.js', 'utf8');
vm.runInContext(src, sandbox, { filename: 'combat-animal-attacks.js' });
const attacks = sandbox.window.Combat.animalAttacks; // Production dispatcher shared by wild and companion attacks.
let started = 0, cancelled = 0; // Counts signature handler lifecycle callbacks to detect duplicate or early attack starts.
attacks.register('testBite', {
  start(c, state) { started++; state.started = true; },
  update(c, state) { assert(state.started); damage.push(c.id); return false; },
  cancel() { cancelled++; },
  isStriking: () => true,
});

assert.equal(attacks.companionLungeTuning.durationS, 0.12);
assert.equal(attacks.companionEngagementRangePx(actor, TILE), TILE * 3.6);

// Execute the *actual* game's companion combat decision, not a duplicated implementation.
const game = fs.readFileSync('docs/game.js', 'utf8');
const companionStart = game.indexOf('              const st = c._stage ||', game.indexOf('function updateCompanions(dt)'));
const companionEnd = game.indexOf('\n            }\n          } else if (rescueActive)', companionStart); // Rescue arbitration is a distinct branch; extract only the actual attack decision for this fixture.
assert(companionStart >= 0 && companionEnd > companionStart, 'find the real active/backing-up companion AI');
let walkCalls = 0; // Counts normal-speed pursuit so the burst cannot be preceded by a slow approach.
Object.assign(sandbox, {
  c: actor, def: actor.def, dt: 1 / 60, dist: Math.hypot(target.x - actor.x, target.y - actor.y),
  target, moving: false, aimAngle: 0, TILE, STAGE_BACKUP_S: 1,
  companionTempo: { stamina: 1, recovery: 1, cooldown: 1 },
  rnd: () => 0, isCreatureSwimming: () => false,
  moveCreatureToward: () => { walkCalls++; return true; },
});
vm.runInContext('{ ' + game.slice(companionStart, companionEnd) + ' }', sandbox);
assert.equal(walkCalls, 0, 'ready companion skips ordinary-speed chase inside burst range');
assert.equal(started, 0, 'special waits until the committed approach finishes');
assert.equal(actor.stamina, 90, 'stamina paid once at commitment');
assert.equal(actor.attackCooldownT, 2, 'cooldown set once at commitment');
assert(attacks.isBusy(actor), 'the charge owns the entity and suppresses normal pursuit');
assert(!attacks.isStriking(actor), 'the opening movement does not count as a weapon strike');

let elapsed = 0; // Sums fixed simulation frames to enforce the near-instant approach budget.
for (let step = 0; step < 15 && started === 0; step++) {
  attacks.update(actor, 1 / 60);
  elapsed += 1 / 60;
}
assert.equal(started, 1, 'signature attack starts exactly once after the burst');
assert(elapsed <= 0.15, 'fast approach completes inside the weapon-lunge timing budget');
assert(actor.x >= target.x - actor.def.attackRangePx - 0.01, 'charge closes into normal bite reach');
assert.equal(attacks.isStriking(actor), true, 'signature strike state becomes available after approach');
attacks.update(actor, 1 / 60);
assert.deepEqual(damage, ['companion-hound']);
assert.equal(actor.stamina, 90, 'no second attack payment after approach');
assert(logs.some(entry => entry[0].includes('companion-lunge') && entry[0].includes('stopped: target')), 'mobile log includes opening-lunge result');

// Cancel before reaching the target: must not call an attack-specific cancel() on uninitialized state.
const interrupted = { ...actor, x: 0, _animalAttack: null };
attacks.start(interrupted, 'testBite', { target });
attacks.cancel(interrupted);
assert.equal(cancelled, 0, 'pre-lunge cancellation never invokes an unstarted signature handler');
assert(!attacks.isBusy(interrupted));

// Terrain still blocks the 0.12-second burst despite the high speed.
sandbox.window.Combat.deps.canOccupyAt = x => x <= TILE * 0.5;
const blocked = { ...actor, x: 0, _animalAttack: null };
attacks.start(blocked, 'testBite', { target });
for (let step = 0; step < 15 && blocked._animalAttack?.approach; step++) attacks.update(blocked, 1 / 60);
assert(blocked.x <= TILE * 0.5, 'movement respects substepped wall collision');
assert(logs.some(entry => entry[0].includes('stopped: blocked')), 'obstruction appears in the in-game log');
assert.equal(started, 2, 'blocked lunge still commits to its selected attack, which may miss');

// Inside normal reach, and for wild creatures, attacks keep their pre-existing startup timeline.
sandbox.window.Combat.deps.canOccupyAt = () => true;
const near = { ...actor, x: target.x - TILE * 0.5, _animalAttack: null };
attacks.start(near, 'testBite', { target });
assert(!near._animalAttack.approach && started === 3, 'no double lunge inside normal attack reach');
assert.equal(attacks.start(near, 'testBite', { target }), false, 'a duplicate request cannot overwrite an active strike');
assert.equal(started, 3, 'duplicate request cannot invoke a second signature startup');

const wild = { ...actor, isCompanion: false, x: 0, _animalAttack: null };
attacks.start(wild, 'testBite', { target });
assert(!wild._animalAttack.approach && started === 4, 'wild creature AI is not changed');
// Pounce and Guard Charge have their OWN movement: selecting either from the outer
// engagement band must not prepend a generic 2.6-tile charge.
const nativeHits = []; // Collects real Guard Charge damage routing while testing its original collision-aware lunge.
Object.assign(sandbox.window.Combat.deps, {
  hostileObjects: [target], companionObjects: [],
  damageCreature(...args) { nativeHits.push(args); },
  playCreatureClawHit() {},
  canOccupyAt: () => true,
});
sandbox.window.ResourceSystem.afflictionBonusesForTag = () => ({});
const charge = { ...actor, x: 0, y: 0, _animalAttack: null }; // Separate character allows inspecting the native Guard Charge state.
attacks.start(charge, 'guardCharge', { target });
assert.equal(charge._animalAttack.approach, null, 'Guard Charge does not get a second, generic burst');
const chargeState = charge._animalAttack.state; // The one native charge should cover the companion engagement distance.
assert(chargeState.lungeMaxDistancePx <= TILE * 2.6 + 0.01, 'Guard Charge retains the common maximum 2.6-tile lunge');
assert(chargeState.lungeMaxDistancePx > TILE * 1.9, 'Guard Charge covers the target gap from the outer engagement band');
for (let step = 0; step < 15 && attacks.isBusy(charge); step++) attacks.update(charge, 1 / 60);
assert(!attacks.isBusy(charge), 'native Guard Charge resolves in one fast charge');
assert(nativeHits.length === 1, 'Guard Charge reaches and connects with its intended target without an extra burst');
const offsetMaster = { x: 0, y: -TILE * 4 }; // Makes the old master-away steering visibly different from direct target bearing.
const aimedCharge = { ...actor, x: 0, y: 0, master: offsetMaster, _animalAttack: null }; // Checks that closing a distant gap heads straight at the chosen opponent.
attacks.start(aimedCharge, 'guardCharge', { target });
assert(Math.abs(aimedCharge._animalAttack.state.lungeAngle) < 0.0001,
  'extended companion Guard Charge targets the enemy, not a blended direction away from the master');
attacks.cancel(aimedCharge);

const pounce = { ...actor, x: 0, y: 0, _animalAttack: null }; // Exercises the production crouch-and-leap startup.
attacks.start(pounce, 'pounce', { target });
assert.equal(pounce._animalAttack.approach, null, 'Pounce starts its own authored windup rather than stacking lunges');
assert.equal(pounce._animalAttack.state.stage, 'windup', 'Pounce retains its existing crouch telegraph');
assert(pounce._animalAttack.state.lungeSpeedPxS >=
  pounce._animalAttack.state.lungeMaxDistancePx / 0.12,
  'companion leap movement completes at weapon-burst speed once the crouch ends');
const companionPounceSpeed = pounce._animalAttack.state.lungeSpeedPxS; // Preserve the observed speed before cancellation clears the active attack object.
attacks.cancel(pounce);
const wildPounce = { ...actor, isCompanion: false, x: 0, y: 0, _animalAttack: null }; // Wild animal pace remains authored.
sandbox.window.Combat.deps.players = [target];
attacks.start(wildPounce, 'pounce', { target });
assert.equal(wildPounce._animalAttack.approach, null, 'wild Pounce never gets a companion-only pre-lunge');
assert(wildPounce._animalAttack.state.lungeSpeedPxS <=
  companionPounceSpeed,
  'wild Pounce does not inherit the companion-specific speed boost');
attacks.cancel(wildPounce);

// Extra-cost specials must fall back cleanly when the base action already used all available Stamina.
let costlyStarts = 0; // Detects accidental special starts despite insufficient remaining resources.
attacks.register('costlySpecial', {
  additionalStaminaCost: () => 12,
  start() { costlyStarts++; },
  update() { return false; },
});
const tired = { ...actor, x: target.x, stamina: 7, _animalAttack: null }; // Ordinary attack payment has already been made by the companion decision.
assert.equal(attacks.start(tired, 'costlySpecial', { target }), false, 'unaﬀordable extra-cost move should be rejected');
assert.equal(tired.stamina, 7, 'failed special must not drain Stamina or trigger Exhausted');
assert.equal(costlyStarts, 0);
const rested = { ...tired, stamina: 18 };
assert.equal(attacks.start(rested, 'costlySpecial', { target }), true, 'affordable named special starts normally');
assert.equal(rested.stamina, 6, 'only the additional special cost is spent here');
attacks.cancel(rested);
assert.equal(attacks.start({ ...tired, health: 0 }, 'costlySpecial', { target }), false, 'dead companion cannot restart an attack');
const wildTired = { ...tired, isCompanion: false, stamina: 7, _animalAttack: null }; // Wild animals keep their legacy Exhaustion/resource transaction rather than a player-pet-only fallback.
assert.equal(attacks.start(wildTired, 'costlySpecial', { target }), true, 'pet Stamina restriction must not disable wild signature attacks');
attacks.cancel(wildTired);

console.log('Shared companion weapon-speed engagement, attack lifecycle, mobile debug and collision passed.');
