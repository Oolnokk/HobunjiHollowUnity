#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict'); // Checks the live attack dispatcher and AI callback below.
const fs = require('node:fs'); // Reads the production modules without a browser bundle.
const vm = require('node:vm'); // Runs browser modules with deterministic gameplay randomness.
const tuning = JSON.parse(fs.readFileSync('docs/config/combat/attack-values.json', 'utf8')).creatureAttacks; // Uses shipped timing/range values.
let roll = 0.9; // Selects burrow or spray deterministically.
let hits = 0; // Counts emergence damage through the existing dependency seam.
let winded = 0; // Counts spray affliction through the shared resource API.
const sprayedTargets = []; // Records actual recipients to verify cone filtering and faction ownership.
const player = { x: 150, y: 0, health: 100, stamina: 100 }; // Target followed underground, then locked by the telegraph.
const context = { // Supplies only browser APIs used by the loaded attack modules.
  console, Math, performance, document: { getElementById() { return null; } }, addEventListener() {},
  GameRandom: { random: () => roll },
  ResourceSystem: {
    spendStamina(c, cost) { c.stamina = Math.max(0, c.stamina - cost); },
    AFFLICTIONS: { windedStamina: {} },
    addAffliction(c, id, amount) { assert.equal(id, 'windedStamina'); sprayedTargets.push(c); winded += amount; return amount; },
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

function sprayRecipients(c, target) {
  sprayedTargets.length = 0;
  attacks.start(c, 'grehlrStink', { target });
  attacks.update(c, tuning.grehlrStink.FLIP_S);
  attacks.update(c, 0.016);
  attacks.update(c, 0.016);
  const result = [...sprayedTargets]; // Capture before cancel also verifies the spray cannot apply twice per attack.
  attacks.cancel(c);
  return result;
}
const victim = { x: 200, y: 0, areaId: 'outside', health: 100 }; // Inside both selection and spray ranges.
const passive = { ...victim, def: { hostile: false } }; // Passive wildlife shares hostileObjects without being an opposing enemy.
const shoulder = { ...victim, stableRole: 'shoulderPet' }; // Riding pets are represented by their owner's body.
const banditPet = { ...victim, isCompanion: true, banditCompanion: true }; // Allied to enemy Grehlrs, opposed to player Grehlrs.
const alliedPet = { ...victim, isCompanion: true }; // Ground companion on the player's side.
const rejected = [
  { ...victim, x: 300 }, { ...victim, y: 200 }, { ...victim, x: -100 },
  { ...victim, health: 0 }, { ...victim, areaId: 'elsewhere' },
  { ...victim, _grehlrBurrowProtected: true }, { ...victim, _downed: true },
]; // Range, cone, death, area, underground and downed exclusions.
context.Combat.deps.hostileObjects = [victim, passive, banditPet, ...rejected];
context.Combat.deps.companionObjects = [alliedPet, shoulder, banditPet, ...rejected];
assert.deepEqual(sprayRecipients({ ...creature(), isCompanion: true }, victim), [victim, banditPet], 'player spray hits opposing actors only, once');
assert.deepEqual(sprayRecipients(creature(), player), [player, alliedPet], 'wild spray catches players and ground companions');
assert.deepEqual(sprayRecipients({ ...creature(), isCompanion: true, banditCompanion: true }, player), [player, alliedPet], 'bandit spray attacks the player faction and spares its own faction');

context.CreatureGenetics = { creatureSizeClass: () => 'medium' };
const medium = { ...creature(), isCompanion: true }; // Species attacks keep their medium-companion selection rule.
attacks.start(medium, 'pounce', { target: victim });
assert.equal(medium._animalAttack.id, 'grehlrStink');
attacks.cancel(medium);
context.CreatureGenetics.creatureSizeClass = () => 'large';
const large = { ...creature(), isCompanion: true }; // Large companions must retain burrow rather than selecting medium-only spray.
attacks.start(large, 'grehlrBurrow', { target: victim });
assert.equal(large._animalAttack.id, 'grehlrBurrow');
attacks.cancel(large);

const particleScene = { children: [], add(mesh) { mesh.parent = this; this.children.push(mesh); }, remove(mesh) {
  this.children = this.children.filter(child => child !== mesh); mesh.parent = null;
} }; // Exercises particle ownership and retirement without allocating WebGL resources.
context.THREE = {
  TetrahedronGeometry: class {},
  MeshBasicMaterial: class { constructor(options) { Object.assign(this, options); } },
  Mesh: class {
    constructor(geometry, material) {
      this.material = material; // Inspect the real module's particle tint.
      this.position = { set(x, y, z) { Object.assign(this, { x, y, z }); } }; // Supports spawn and integration coordinates.
      this.rotation = { set(x, y, z) { Object.assign(this, { x, y, z }); } }; // Supports cosmetic rotation integration.
      this.scale = { setScalar() {}, multiplyScalar() {} }; // Scale does not affect emitter direction or lifetime.
    }
  },
};
for (const interrupted of [false, true]) {
  const emitter = creature(); // A real spray state owns every droplet until finish or cancellation.
  emitter.avatarRef.group.parent = particleScene;
  emitter.avatarRef.group.position = { y: 3 };
  attacks.start(emitter, 'grehlrStink', { target: player });
  attacks.update(emitter, tuning.grehlrStink.FLIP_S);
  attacks.update(emitter, 0.08);
  assert.ok(particleScene.children.length > 0, 'spray emits particles');
  assert.ok(particleScene.children.every(mesh => mesh.position.x === tuning.grehlrStink.REAR_OFFSET_TILES), 'particles leave the rear toward the target');
  assert.ok(particleScene.children.every(mesh => mesh.position.y > 3 && mesh.material.color === context.HobunjiGrehlrStink.STINK_OIL_COLOR), 'spray uses the creature height and stink-oil tint');
  if (interrupted) attacks.cancel(emitter);
  else {
    for (let tick = 0; tick < 100 && attacks.isBusy(emitter); tick++) attacks.update(emitter, 0.016);
    assert.equal(attacks.isBusy(emitter), false, 'spray finishes after recovery and last droplet');
  }
  assert.equal(particleScene.children.length, 0, 'no orphan particles after ' + (interrupted ? 'interruption' : 'completion'));
}
console.log('Grehlr dive, hidden travel, emergence, cancellation, spray and live AI selection passed.');
