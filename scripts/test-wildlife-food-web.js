#!/usr/bin/env node
'use strict';
// Regression for selective predator/prey relationships, defensive food spots,
// reused burrow-dive phases, and independent northern forager population slots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/wildlife-food-web.js', 'utf8');
const wildlife = fs.readFileSync('docs/js/wildlife-spawn.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const loader = fs.readFileSync('docs/index.html', 'utf8');

let clock = 0; // Drives the production engine's performance.now API deterministically.
let berryConsumed = 0; // Counts berry-bush resource consumption after a Nazgraku completes its feeding cycle.
const berry = { col: 10, row: 10, reserved: false }; // Shared wild-berry object tracks cross-animal reservation/release.
const win = {
  GameRandom: { random: () => 0.25 },
  Music: { isNightTime: () => false },
  WildBerries: {
    nearestAvailableBerry: () => berryConsumed || berry.reserved ? null : berry,
    removeBerryBush: () => { berryConsumed++; },
  },
  __farmLog: () => {},
}; // Intentionally no THREE: logical far-wildlife AI must simulate with zero GPU scene.
const context = vm.createContext({ window: win, Math, performance: { now: () => clock }, console });
vm.runInContext(source, context, { filename: 'wildlife-food-web.js' });
const api = win.WildlifeFoodWeb;
const ctx = {
  zoneId: 'map_western_slope', tile: 10,
  canOccupyAt: () => true,
  moveCreatureToward: (c, x, y) => { c.x = x; c.y = y; return true; },
}; // Exercise real idle/chase interfaces while avoiding a WebGL/DOM requirement.
function creature(kind, x, y) {
  return {
    creatureKey: kind, x, y, homeX: x, homeY: y,
    health: 100, maxHealth: 100, areaId: ctx.zoneId, state: 'idle', scaleY: 1,
    def: { label: kind, moveSpeed: 20, chaseSpeed: 30 },
  };
}
const nelk = creature('nelk', 20, 20);
const puktuk = creature('puktuk', 45, 20);
const nazgraku = creature('nazgraku', 180, 150);
assert.equal(api.profile(nelk).hunts.join(','), 'puktuk', 'Nelk has explicit food, not a broad predator role');
assert.equal(api.profile(puktuk).forage, 'burrow');
assert.equal(api.profile(nazgraku).forage, 'berry-tuber');
api.updateThreats(nelk, 1, [nelk, puktuk, nazgraku], [], [], ctx);
assert.equal(nelk.state, 'patrol-chase');
assert.equal(nelk.targetCreature, puktuk);
nelk.state = 'idle'; nelk.targetCreature = null;
const notPrey = creature('nazgraku', 25, 20);
api.updateThreats(nelk, 1, [nelk, notPrey], [], [], ctx);
assert.equal(nelk.state, 'idle', 'Nelk does not blindly chase all neutral grazing animals');

// Being attacked triggers an active defensive counterattack, not hunting
// other species or converting Puktuk into a new "predator" diet class.
api.onSkirmishHit(nelk, puktuk);
assert.equal(puktuk.state, 'patrol-chase');
assert.equal(puktuk.targetCreature, nelk);
assert.equal(api.profile(puktuk).hunts, undefined);
puktuk.state = 'idle'; puktuk.targetCreature = null;
let moved = false, dug = false, chewed = false, completed = false;
for (let n = 0; n < 90; n++) {
  const result = api.tickForage(puktuk, 0.2, ctx);
  moved ||= result?.moving === true;
  dug ||= puktuk.state === 'foraging-dig';
  chewed ||= puktuk.state === 'foraging-chew';
  completed ||= (puktuk._foodWeb?.cycles || 0) > 0;
}
assert(moved && dug && chewed && completed,
  'Puktuk bolts, dives/digs, reverses, and chews before repeating');
assert.equal(puktuk._foodWeb.spot.kind, 'burrow');
api.abandon(puktuk);

// Nazgraku uses a real wild-berry bush when one is available. Its defended
// site's leash is independent from its original herd center.
ctx.zoneId = 'map_northern_cliffs';
const naz = creature('nazgraku', 100, 100);
naz.areaId = ctx.zoneId;
const intruder = { x: 105, y: 105, health: 100 };
api.updateThreats(naz, 0.6, [naz], [intruder], [], ctx);
assert.equal(naz._foodWeb.spot.kind, 'berry');
assert.equal(berry.reserved, true);
assert.equal(naz.state, 'chase');
assert.equal(naz.targetPlayer, intruder);
assert.equal(api.isDefending(naz), true);
intruder.x = 999; intruder.y = 999;
api.updateThreats(naz, 0.5, [naz], [intruder], [], ctx);
assert.equal(naz.state, 'idle', 'Nazgraku stops defending once the intruder leaves the food-site leash');
assert.equal(api.isDefending(naz), false);
naz.x = 105; naz.y = 105;
for (let n = 0; n < 100; n++) api.tickForage(naz, 0.2, ctx);
assert(berryConsumed > 0, 'Nazgraku can consume the selected berry via WildBerries');
assert.equal(berry.reserved, false, 'The bush reservation is released after feeding');
api.abandon(naz);

// Nonlethal ordinary NPCs do not suddenly inherit combat health or die,
// while combat-equipped humanoids use the preexisting faction damage path.
const npc = { area: ctx.zoneId, rec: { id: 'test_npc' }, root: { position: { x: 10.5, z: 10.5 } } };
const naz2 = creature('nazgraku', 100, 100); naz2.areaId = ctx.zoneId;
api.updateThreats(naz2, 0.5, [naz2], [], [npc], ctx);
assert.equal(naz2.targetCreature?.isNpcWalker, true);
assert.equal(api.npcWalkerStrike(naz2, naz2.targetCreature), true);
assert(npc._wildlifeThreatUntil > 0);
api.abandon(naz2);

assert(loader.includes('js/wildlife-food-web.js'), 'Food-web module is parser-loaded ahead of game.js');
assert(game.includes('WildlifeFoodWeb?.updateThreats'), 'Normal hostile AI calls selective food targeting');
assert(game.includes('WildlifeFoodWeb?.tickForage'), 'Normal hostile AI delegates foraging animation and movement');
assert(game.includes("roamingForagerSpecies: ['nazgraku']"), 'Nazgraku occupies an independent Northern Cliffs forager slot');
assert(game.includes("packSpecies: ['nelk']"), 'Western Slope explicitly registers Nelk as a hunter');
assert(wildlife.includes('window.WildlifeFoodWeb?.onSkirmishHit'), 'Animal skirmishes allow defensive retaliation');
assert(wildlife.includes('roamingForagerSpecies'), 'Extra foragers do not replace Voorg-Ass herds');
assert.match(wildlife, /speciesKey === 'nelk' && denGenotype \? \{ \.\.\.denGenotype, sizeClass: 'large' \} : denGenotype/, 'wild Nelk become Large without changing the den bloodline');
assert.match(wildlife, /denKey, genotype: wildPackGenotype, wildlifeRole:/, 'the wild Nelk size is consumed by the creature constructor');
assert.match(wildlife, /if \(herdGenotype\) herdGenotype\.sizeClass = 'large'/, 'wild Nazgraku continue spawning as Large foragers');
console.log('Wildlife food-web relationships and dig/defense regression passed');
