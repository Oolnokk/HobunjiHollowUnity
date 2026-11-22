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
const cancellations = []; // Records interrupted attacks when herd members sight predators.
const W = {
  __farmLog() {},
  HobunjiActivityEvents: { on(fn) { nestListener = fn; } },
  Combat: {
    deps: { player, TILE: 40, hostileObjects: adults },
    animalAttacks: { cancel(c) { cancellations.push(c); } },
    telegraph: { cancel() {} },
  },
  GameRandom: { random: () => 0.33 },
};
const context = vm.createContext({ window: W, performance: { now: () => clock }, Math, console });
vm.runInContext(fs.readFileSync('docs/js/wildlife-threat-response.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('docs/js/wildlife-food-web.js', 'utf8'), context);
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

// Only nearby, living, wild adult members of the stolen offspring species react.
const puktuk = animal('puktuk', 80, 20, { genotype: { sizeClass: 'large' } });
const second = animal('puktuk', 100, 10);
const juvenile = animal('puktuk', 110, 15, { genotype: { sizeClass: 'small' } });
const unrelated = animal('uumkaoii-wild', 70, 15);
const far = animal('puktuk', 900, 20);
const tamed = animal('puktuk', 70, 10, { isCompanion: true });
for (const c of [puktuk, second, juvenile, unrelated, far, tamed]) adults.add(c);
nestListener({ type: 'nest_stolen', speciesKind: 'puktuk', itemKey: 'puktukBaby',
  x: 70, y: 0, areaId: ctx.zoneId, liveBirth: true });
for (const adult of [puktuk, second]) {
  assert.equal(adult.state, 'chase', 'every nearby same-species adult is alert');
  assert.equal(adult.def.hostile, true);
  assert.equal(adult.targetPlayer, player);
  assert(adult.def.attackRangePx > 0, 'passive adults gain a usable defensive combat profile');
}
for (const safe of [juvenile, unrelated, far, tamed]) assert.equal(safe.def.hostile, false, 'other species, babies, distant and owned pets stay peaceful');
clock += 15000;
R.update(puktuk, 0.3, [puktuk], [player], ctx);
assert.equal(puktuk.def.hostile, false, 'maternal defense is temporary');
assert.equal(puktuk.state, 'return', 'nonpermanent defenders return to their previous homes');

const game = fs.readFileSync('docs/game.js', 'utf8');
assert(game.includes("c.herdKey && herdNight && c.state !== 'herd-panic'"), 'nighttime herd sleep cannot overwrite predator flight');
const charged = fs.readFileSync('docs/js/combat/combat-animal-attacks.js', 'utf8');
assert(charged.includes('guardChargeDamage'), 'Moot Guard Charge inflicts blunt Health damage instead of just knockback');
const page = fs.readFileSync('docs/index.html', 'utf8');
assert(page.indexOf('wildlife-threat-response.js') < page.indexOf('wildlife-food-web.js'), 'threat module loads before food-web adapter');
console.log('wildlife threat response: ok');
