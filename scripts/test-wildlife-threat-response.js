#!/usr/bin/env node
'use strict';
// Headless wildlife threat regression: no renderer or browser console required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let clock = 1000; // Drives short-lived panic/parental aggression without real timers.
let nestListener = null; // Captures the existing activity-event subscription.
const player = { x: 70, y: 0, health: 100, areaId: 'map_northern_cliffs' }; // Nearby visitor or nest thief.
const adults = new Set(); // The live wild-animal roster shared with Combat.
const companionPredators = new Set(); // The separate tame-animal roster used by live herd threat scans.
const cancellations = []; // Records interrupted attacks when herd members sight predators.
const W = {
  __farmLog() {},
  HobunjiActivityEvents: { on(fn) { nestListener = fn; } },
  Combat: {
    deps: { player, TILE: 40, hostileObjects: adults, companionObjects: companionPredators },
    animalAttacks: { cancel(c) { cancellations.push(c); } },
    telegraph: { cancel() {} },
  },
  GameRandom: { random: () => 0.33 },
};
const context = vm.createContext({ window: W, performance: { now: () => clock }, Math, console });
vm.runInContext(fs.readFileSync('docs/js/wildlife-threat-response.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/wildlife-food-web.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/combat/animal-scent-targeting.js', 'utf8'), context); // Real scent module must not hijack predator flight.
vm.runInContext(fs.readFileSync('docs/js/moot-registration.js', 'utf8'), context); // Test the actual species registrations, not only their runtime reactions.
vm.runInContext(fs.readFileSync('docs/js/voorg-ass-registration.js', 'utf8'), context);
const R = W.WildlifeThreatResponse;
const F = W.WildlifeFoodWeb;
const movement = [];
const ctx = {
  zoneId: 'map_northern_cliffs', tile: 40,
  canOccupyAt: () => true,
  moveCreatureToward(c, x, y, speed) { movement.push({ c, x, y, speed }); c.x = x; c.y = y; return true; },
}; // Uses the production callbacks without touching WebGL.
function animal(kind, x, y, overrides = {}) {
  return {
    creatureKey: kind, areaId: ctx.zoneId, health: 100, maxHealth: 100,
    x, y, homeX: x, homeY: y, scaleY: 1, state: 'idle',
    def: { hostile: false, diet: 'herbivore', moveSpeed: 110, chaseSpeed: 360 }, ...overrides,
  };
}
assert.equal(typeof nestListener, 'function', 'nest theft uses existing activity event, not a separate inventory poll');
const speciesDefs = { 'uumkaoii-wild': { hostile: false, moveSpeed: 110, chaseSpeed: 110 } }; // Minimal live CREATURE_DB baseline used by both original registration adapters.
W.MootRegistration.ensureCreatureDefs(speciesDefs, ctx.tile);
W.VoorgAssRegistration.ensureCreatureDefs(speciesDefs, ctx.tile);
for (const kind of ['moot', 'moot-herd-mother']) {
  assert.equal(speciesDefs[kind].attackTag, 'blunt', 'Moot family inflicts blunt charge damage');
  assert.equal(speciesDefs[kind].guardChargeDamage, 18, 'Moot family explicitly enables damaging guard charges');
  assert(speciesDefs[kind].attacks.includes('guardCharge'), 'Moot family reuses registered frontal cone attack');
}
for (const kind of ['voorg-ass', 'voorg-ass-herd-mother']) {
  assert(speciesDefs[kind].attacks.includes('rearKick'), 'Voorg-Ass family reuses the existing native rear kick');
  assert.equal(speciesDefs[kind].hostile, false, 'Voorg-Asses remain passive until threatened');
}
assert(speciesDefs['voorg-ass'].chaseSpeed >= ctx.tile * 9.2, 'Voorg-Ass authored sprint is fast enough to retreat');


// A Moot responds immediately to a close player; a Voorg-Ass picks the existing rear-kick retaliation path.
const moot = animal('moot', 0, 0);
const voorg = animal('voorg-ass', 0, 0);
R.update(moot, 0.3, [moot, voorg], [player], ctx);
assert.equal(moot.state, 'chase');
assert.equal(moot.targetPlayer, player);
R.update(voorg, 0.3, [moot, voorg], [player], ctx);
assert.equal(voorg.state, 'chase');
assert.equal(voorg._voorgRearKickThreat, player, 'Voorg-Ass must transition through its existing kick-then-flee special');

// Predator threat overrides both charged defense and sleep and uses a fast collision-aware sprint.
const wolf = animal('gar-wolf', 30, 0, { def: { hostile: true, diet: 'carnivore', chaseSpeed: 180 } });
moot._animalSleeping = true;
R.update(moot, 0.3, [moot, voorg, wolf], [player], ctx);
assert.equal(moot.state, 'herd-panic');
assert.equal(moot._animalSleeping, false, 'sleeping herd wakes to flee');
assert(cancellations.includes(moot), 'combat pose is interrupted for predator flight');
const beforeX = moot.x;
const panic = F.tickForage(moot, 0.2, ctx);
assert(panic.handled && panic.moving, 'predator flight reuses the native movement/collision branch');
assert(moot.x < beforeX, 'Moot runs away from the wolf instead of retreating to its sleep position');
assert(movement[0].speed >= 40 * 9.5, 'panicking prey runs at sprint speed');
R.update(voorg, 0.3, [moot, voorg, wolf], [player], ctx);
assert.equal(voorg.state, 'herd-panic', 'Voorg-Ass must ignore close visitors in favor of predator flight');
clock += 2000;
R.update(moot, 0.3, [moot, voorg], [player], ctx);
assert.equal(moot.state, 'return', 'panic ends after predators leave and grace expires');

// Predator chasing prey receives a temporary speed overlay; it is removed outside pursuit.
const nelk = animal('nelk', 100, 0, {
  state: 'patrol-chase', targetCreature: animal('puktuk', 155, 0),
  def: { hostile: true, diet: 'carnivore', chaseSpeed: 160, moveSpeed: 110 },
});
const original = nelk.def;
R.update(nelk, 0.3, [nelk, nelk.targetCreature], [player], ctx);
assert(nelk.def.chaseSpeed >= 40 * 8.5, 'wild predator pursues fast prey rather than trailing at grazing speed');
nelk.state = 'idle';
R.update(nelk, 0.3, [nelk], [player], ctx);
assert.equal(nelk.def, original, 'pursuit overlay does not permanently mutate the species definition');

// Even player-chasing predators accelerate, but only for as long as they are pursuing.
nelk.state = 'chase'; nelk.targetPlayer = player;
R.update(nelk, 0.3, [nelk], [player], ctx);
assert(nelk.def.chaseSpeed >= 40 * 8.5, 'predators also sprint when actively pursuing a player');
nelk.state = 'idle'; nelk.targetPlayer = null;
R.update(nelk, 0.3, [nelk], [player], ctx);
assert.equal(nelk.def, original, 'player-pursuit speed is restored after disengagement');

// Passive species with a nonlethal wildlife wound are fast when they flee, without a permanent stat mutation.
const injuredPuktuk = animal('puktuk', 230, 0, { state: 'fleeing-low-health', def: { hostile: false, diet: 'herbivore', chaseSpeed: 90 } });
const preFlightDef = injuredPuktuk.def;
R.update(injuredPuktuk, 0.3, [injuredPuktuk], [player], ctx);
assert(injuredPuktuk.def.chaseSpeed >= 40 * 8.8, 'injured prey sprints on the existing wildlife retreat path');
injuredPuktuk.state = 'return';
R.update(injuredPuktuk, 0.3, [injuredPuktuk], [player], ctx);
assert.equal(injuredPuktuk.def, preFlightDef, 'injured prey does not keep sprint stats when back at home');

// A Voorg-Ass really runs AWAY from the visitor after its native kick, even if its old herd home is toward that visitor.
const kickingVoorg = animal('voorg-ass', 45, 0, { homeX: 90 });
R.update(kickingVoorg, 0.3, [kickingVoorg], [player], ctx);
R.update(kickingVoorg, 0.3, [kickingVoorg], [player], ctx); // Capture the kick threat before native rearKick.finish clears it.
kickingVoorg._voorgRearKickSpent = true; kickingVoorg._voorgRearKickThreat = null;
kickingVoorg.state = 'fleeing-low-health'; // The native rear-kick completion state.
R.update(kickingVoorg, 0.3, [kickingVoorg], [player], ctx);
assert.equal(kickingVoorg.state, 'herd-panic', 'a finished rear kick switches to away-from-threat escape rather than homeward flee');
const beforeEscape = kickingVoorg.x;
F.tickForage(kickingVoorg, 0.1, ctx);
assert(kickingVoorg.x < beforeEscape, 'Voorg-Ass runs away from the attacker, not toward its original herd home');

// A trained carnivore is still a predator to wild Moots, but it must not receive wild-only chase tuning.
const trainedNelk = animal('nelk', 10, 0, {
  isCompanion: true, def: { hostile: false, diet: 'carnivore', chaseSpeed: 100 },
});
const frightenedMoot = animal('moot', 0, 0);
companionPredators.add(trainedNelk); // In gameplay, a tamed Nelk is NOT in currentHostilesFrame.
R.update(frightenedMoot, 0.3, [frightenedMoot], [player], ctx);
assert.equal(frightenedMoot.state, 'herd-panic', 'prey also flee from trained animal predators in the separate companion roster');
R.update(trainedNelk, 0.3, [trainedNelk], [player], ctx);
assert.equal(trainedNelk.def.chaseSpeed, 100, 'owner companions keep their saved movement profile');
companionPredators.delete(trainedNelk); // Later cases have independent predator rosters.

// A cliff blocked three tiles away must not prevent movement into a safe nearby step.
const cliffMoot = animal('moot', 0, 0, { state: 'herd-panic', _herdThreat: {
  predatorX: 30, predatorY: 0, panicUntilMs: clock + 1000,
  nextScanS: 1, engaged: false, engagedAtMs: 0,
} });
const cliffCtx = { ...ctx, canOccupyAt(x) { return x > -40; } };
const cliffMove = R.tickPanic(cliffMoot, 0.1, cliffCtx);
assert(cliffMove.handled && cliffMove.moving && cliffMoot.x < 0,
  'cliff escape tests a nearby foothold instead of falsely rejecting a blocked distant endpoint');

// Only nearby, living, wild adult members of the stolen offspring species react.
const puktuk = animal('puktuk', 80, 20, { genotype: { sizeClass: 'large' } });
const second = animal('puktuk', 100, 10);
const juvenile = animal('puktuk', 110, 15, { genotype: { sizeClass: 'small' }, isJuvenile: true });
const smallAdult = animal('puktuk', 90, 25, { genotype: { sizeClass: 'small' } }); // Small-body genes are not an age marker.
const releasedBaby = animal('puktuk', 95, 15, { festivalReleased: true, genotype: { sizeClass: 'small' } });
const unrelated = animal('uumkaoii-wild', 70, 15);
const far = animal('puktuk', 900, 20);
const tamed = animal('puktuk', 70, 10, { isCompanion: true });
for (const c of [puktuk, second, juvenile, smallAdult, releasedBaby, unrelated, far, tamed]) adults.add(c);
nestListener({ type: 'nest_stolen', speciesKind: 'puktuk', itemKey: 'puktukBaby',
  x: 70, y: 0, areaId: ctx.zoneId, liveBirth: true });
for (const adult of [puktuk, second, smallAdult]) {
  assert.equal(adult.state, 'chase', 'every nearby same-species adult is alert');
  assert.equal(adult.def.hostile, true);
  assert.equal(adult.targetPlayer, player);
  assert(adult.def.attackRangePx > 0, 'passive adults gain a usable defensive combat profile');
}
for (const safe of [juvenile, releasedBaby, unrelated, far, tamed]) assert.equal(safe.def.hostile, false, 'other species, genuine juveniles, distant and owned pets stay peaceful');
clock += 5000;
nestListener({ type: 'nest_stolen', speciesKind: 'puktuk', itemKey: 'puktukBaby',
  x: 70, y: 0, areaId: ctx.zoneId, liveBirth: true });
clock += 10000;
R.update(puktuk, 0.3, [puktuk], [player], ctx);
assert.equal(puktuk.def.hostile, true, 'stealing a second baby extends the existing temporary defense rather than resetting it');
clock += 5000;
R.update(puktuk, 0.3, [puktuk], [player], ctx);
assert.equal(puktuk.def.hostile, false, 'maternal defense is temporary');
assert.equal(puktuk.state, 'return', 'nonpermanent defenders return to their previous homes');

// A stolen-nest defender also sees predators: neither ordinary player aggro nor scent can cancel its flight.
const nestMoot = animal('moot', 75, 0);
adults.add(nestMoot);
nestListener({ type: 'nest_stolen', speciesKind: 'moot', itemKey: 'mootBaby',
  x: 70, y: 0, areaId: ctx.zoneId, liveBirth: true });
assert.equal(nestMoot.def.hostile, true, 'parental defensive profile is active before the predator arrives');
R.update(nestMoot, 0.3, [nestMoot, wolf], [player], ctx);
assert.equal(nestMoot.state, 'herd-panic', 'a predator outranks maternal player aggro');
const panickingWhenStolen = animal('moot', 80, 0); // Another adult is already running away before the theft completes.
R.update(panickingWhenStolen, 0.3, [panickingWhenStolen, wolf], [player], ctx);
assert.equal(panickingWhenStolen.state, 'herd-panic');
adults.add(panickingWhenStolen);
nestListener({ type: 'nest_stolen', speciesKind: 'moot', itemKey: 'mootBaby',
  x: 70, y: 0, areaId: ctx.zoneId, liveBirth: true });
assert.equal(panickingWhenStolen.state, 'herd-panic', 'new theft never interrupts an existing escape');
assert.equal(panickingWhenStolen.def.hostile, true, 'the adult still remembers to defend its young when the danger ends');
W.ResourceSystem = { getAffliction: entity => entity === player ? 1 : 0 }; // Simulate an attractive scent-marked player near the nest.
W.AnimalScentTargeting.prioritizeWild(nestMoot, [player], [], ctx.zoneId, () => true);
assert.equal(nestMoot.state, 'herd-panic', 'scent cannot hijack predator flight');

const game = fs.readFileSync('docs/game.js', 'utf8');
assert(game.includes("c.herdKey && herdNight && c.state !== 'herd-panic'"), 'nighttime herd sleep cannot overwrite predator flight');
assert(game.includes("c.state !== 'herd-panic' && c.state !== 'chase'"), 'ordinary enemy aggro must exclude prey currently escaping a predator');
const charged = fs.readFileSync('docs/js/combat/combat-animal-attacks.js', 'utf8');
assert(charged.includes('guardChargeDamage'), 'Moot Guard Charge inflicts blunt Health damage instead of just knockback');
const page = fs.readFileSync('docs/index.html', 'utf8');
assert(page.indexOf('wildlife-threat-response.js') < page.indexOf('wildlife-food-web.js'), 'threat module loads before food-web adapter');
console.log('wildlife threat response: ok');
