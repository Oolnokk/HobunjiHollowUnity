#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks the live attack dispatcher and AI callback below.
const fs = require('node:fs'); // Reads the production modules without a browser bundle.
const vm = require('node:vm'); // Runs browser modules with deterministic gameplay randomness.
const tuning = JSON.parse(fs.readFileSync('docs/config/combat/attack-values.json', 'utf8')).creatureAttacks; // Uses shipped timing/range values.
let roll = 0.9; // Selects burrow or spray deterministically.
let hits = 0; // Counts emergence damage through the existing dependency seam.
let winded = 0; // Counts spray affliction through the shared resource API.
const player = { x: 150, y: 0, health: 100, stamina: 100 }; // Target followed underground, then locked by the telegraph.
const context = { // Supplies only browser APIs used by the loaded attack modules.
  console, Math, performance, document: { getElementById() { return null; } }, addEventListener() {},
  GameRandom: { random: () => roll },
  ResourceSystem: {
    spendStamina(c, cost) { c.stamina = Math.max(0, c.stamina - cost); },
    AFFLICTIONS: { windedStamina: {} },
    addAffliction(c, id, amount) { assert.equal(id, 'windedStamina'); winded += amount; return amount; },
  },
  Combat: { init() {}, deps: {
    TILE: 100, player, players: [player], hostileObjects: [], companionObjects: [],
    canOccupyAt: () => true, damagePlayer() { hits++; },
    inCone(x, y, angle, tx, ty, range, halfCone) {
      return Math.hypot(tx - x, ty - y) <= range
        && Math.abs(Math.atan2(ty - y, tx - x) - angle) <= halfCone;
    },
  } },
};
context.window = context;
vm.createContext(context);
for (const file of ['combat-animal-attacks', 'combat-grehlr-burrow', 'combat-grehlr-stink', 'combat-grehlr-drenkirra-followup']) {
  vm.runInContext(fs.readFileSync(`docs/js/combat/${file}.js`, 'utf8'), context);
}
context.HobunjiGrehlrBurrow.applyConfig(tuning.grehlrBurrow);
context.HobunjiGrehlrStink.applyConfig(tuning.grehlrStink);
const attacks = context.Combat.animalAttacks; // Public dispatcher including all production selection/protection wrappers.
function creature(key = 'grehlr') {
  return {
    creatureKey: key, x: 0, y: 0, areaId: 'outside', facing: 0, health: 100,
    maxStamina: 100, stamina: 100, maxFooting: 100, footing: 100,
    avatarRef: { group: { visible: true }, frontPlane: { rotation: { x: 0 } }, backPlane: { rotation: { x: 0 } } },
    groundShadow: { visible: true }, _ringHud: { visible: true },
    def: { chaseSpeed: 205, modelWidth: 2.2, attackDamage: 14, maxStamina: 100 },
  };
}

for (const key of ['grehlr', 'grehlr-den-mother']) {
  const c = creature(key); // Exercises both species through the stale-pounce compatibility route.
  player.x = 150;
  assert(attacks.start(c, 'pounce', { target: player }));
  assert.equal(c._animalAttack.id, 'grehlrBurrow');
  attacks.update(c, tuning.grehlrBurrow.DIVE_S / 2);
  for (const [plane, yaw, noseX] of [[c.avatarRef.frontPlane, Math.PI / 2, -1], [c.avatarRef.backPlane, -Math.PI / 2, 1]]) {
    // Three.js XYZ Euler: mirrored source noses must both move below the tail.
    const noseY = noseX * Math.sin(plane.rotation.x) * Math.sin(yaw); // Transformed height of a nose at local sprite X.
    assert(noseY < 0, 'both mirrored faces dive nose-first');
  }
  assert.equal(c.avatarRef.group.visible, true, 'body remains visible while diving');
  attacks.update(c, tuning.grehlrBurrow.DIVE_S / 2);
  assert.equal(c._animalAttack.state.stage, 'burrow');
  assert.equal(c.avatarRef.group.visible, false);
  assert.equal(c.groundShadow.visible, false);
  assert.equal(c._ringHud.visible, false);
  assert.equal(context.HobunjiGrehlrStink.isBurrowProtected(c), true);
  player.x = 200;
  attacks.update(c, tuning.grehlrBurrow.BURROW_MAX_S);
  assert.equal(c._animalAttack.state.stage, 'telegraph');
  assert.equal(c.x, 200);
  assert.equal(c.avatarRef.group.visible, false, 'warning ring does not reveal the body');
  attacks.update(c, tuning.grehlrBurrow.TELEGRAPH_S);
  assert.equal(c._animalAttack.state.stage, 'emerge');
  assert.equal(c.avatarRef.group.visible, true);
  assert.equal(c.groundShadow.visible, true);
  assert.equal(c._wildlifeVisualLodJustWoke, true, 'renderer snaps to emergence point rather than sliding in');
  assert.equal(context.HobunjiGrehlrStink.isBurrowProtected(c), false);
  assert.equal(attacks.update(c, tuning.grehlrBurrow.EMERGE_S), false);
  assert.equal(c.scaleY, 1);
  assert.equal(c.avatarRef.frontPlane.rotation.x, 0);
}
assert.equal(hits, 2);

for (const phase of ['dive', 'burrow', 'telegraph']) {
  const c = creature(); // Interruptions must never strand the avatar invisible or invulnerable.
  c._ringHud.visible = false;
  attacks.start(c, 'grehlrBurrow', { target: player });
  if (phase !== 'dive') attacks.update(c, tuning.grehlrBurrow.DIVE_S);
  if (phase === 'telegraph') attacks.update(c, tuning.grehlrBurrow.BURROW_MAX_S);
  attacks.cancel(c);
  assert.equal(c.avatarRef.group.visible, true);
  assert.equal(c.groundShadow.visible, true);
  assert.equal(c._ringHud.visible, false, 'preserves presentation hidden before the attack');
  assert.equal(c.scaleY, 1);
  assert.equal(c._grehlrBurrowProtected, false);
}

roll = 0;
player.x = 200;
for (const key of ['grehlr', 'grehlr-den-mother']) {
  const c = creature(key); // Checks actual spray selection, stage progression, and status application.
  attacks.start(c, 'grehlrBurrow', { target: player });
  assert.equal(c._animalAttack.id, 'grehlrStink');
  attacks.update(c, tuning.grehlrStink.FLIP_S);
  attacks.update(c, tuning.grehlrStink.SPRAY_S);
  assert.equal(c._animalAttack.state.hitCount, 1);
  assert.equal(c._animalAttack.state.windedApplied, tuning.grehlrStink.CHOKED_STAMINA_AMOUNT);
  assert.equal(attacks.update(c, tuning.grehlrStink.RECOVER_S), false);
}

const range = context.HobunjiGrehlrStink.attackTriggerRangePx; // Verifies species-specific eligibility and unchanged shorter/other-species ranges.
assert.equal(range(creature(), 440, 100), 225);
assert.equal(range(creature('grehlr-den-mother'), 620, 100), 225);
assert.equal(range(creature(), 90, 100), 90);
assert.equal(range(creature('gar-wolf'), 440, 100), 440);
assert.equal(range({ ...creature(), isCompanion: true }, 90, 100), 90);

// Execute the game's actual behavior-stage call, including its range gate,
// alignment, stamina payment, random attack choice, and wrapped dispatcher.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Extracts one existing integration seam without booting the entire world.
const start = game.indexOf('const result = updateCreatureBehaviorStage(c, entityDt, targetPlayer, def, (dist) => {'); // Start of the production hostile attack decision.
const end = game.indexOf('\n              });', start) + '\n              });'.length; // End of that callback invocation.
assert(start >= 0 && end > start);
Object.assign(context, {
  c: creature(), def: { attacks: ['grehlrBurrow'], attackStaminaCost: 13, attackCooldownS: 1 },
  entityDt: 0.016, targetPlayer: player, TILE: 100, rnd: () => 0,
  creatureAimColliderReachPx: () => 440, isCreatureSwimming: () => false,
  enemyAttackAlignment: () => ({ eligible: true, aligned: true, desiredFacing: 0 }),
});
context.c.attackCooldownT = 0;
context.updateCreatureBehaviorStage = (c, dt, target, def, attempt) => {
  assert.equal(attempt(440), false, 'AI approaches instead of always burrowing from beyond spray selection range');
  return attempt(200);
};
vm.runInContext(`{ ${game.slice(start, end)} }`, context);
assert.equal(context.c._animalAttack.id, 'grehlrStink', 'live hostile AI can choose spray');
assert.equal(context.c.stamina, 87);
console.log('Grehlr dive, hidden travel, emergence, cancellation, spray and live AI selection passed.');
