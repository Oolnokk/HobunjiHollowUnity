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
const companionEnd = game.indexOf('\n            }\n          } else if (c.treasureCue)', companionStart);
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
const wild = { ...actor, isCompanion: false, x: 0, _animalAttack: null };
attacks.start(wild, 'testBite', { target });
assert(!wild._animalAttack.approach && started === 4, 'wild creature AI is not changed');
console.log('Shared companion weapon-speed engagement, attack lifecycle, mobile debug and collision passed.');
