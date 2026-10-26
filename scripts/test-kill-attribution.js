// Kill attribution: only deaths the player (or their companion) caused award
// Motes of Prowess, combat XP and the creature_killed activity event; NPC-vs-NPC
// battles nearby award nothing. Executes game.js's real transitionCreatureToDeath
// with the real js/player-downed.js and js/activity-events.js.
// Run with: node scripts/test-kill-attribution.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const game = fs.readFileSync('docs/game.js', 'utf8');
const deathFn = game.slice(game.indexOf('function transitionCreatureToDeath('), game.indexOf('function damageCreature('));
assert(deathFn.startsWith('function transitionCreatureToDeath('), 'death transition source located');

let nowMs = 100000;
const motes = [], xp = [], events = [], corpses = [];
const context = {
  performance: { now: () => nowMs }, console, Date,
  hostileObjects: new Set(), companionObjects: new Set(),
  MOTES_PER_KILL: 1, TILE: 60,
  awardMotesOfProwess: amount => motes.push(amount),
  createCreatureVisuals() {}, tryRevealMineDescent: () => false, showToast() {},
};
context.window = context;
context.SkillSystem = { award: (skill, amount, reason) => xp.push(reason) };
context.CreatureDeath = { begin: c => corpses.push(c.id) };
context.dispatchEvent = () => {};
context.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/player-downed.js', 'utf8'), context, { filename: 'player-downed.js' });
vm.runInContext(fs.readFileSync('docs/js/activity-events.js', 'utf8'), context, { filename: 'activity-events.js' });
vm.runInContext(`${deathFn}; this.transitionCreatureToDeath = transitionCreatureToDeath;`, context);
const player = { id: 'player', x: 0, y: 0 };
context.PlayerDowned.init({ player });
context.HobunjiActivityEvents.on(event => { if (event.type === 'creature_killed') events.push(event); });
const PD = context.PlayerDowned;
const kill = c => { c.health = 0; return context.transitionCreatureToDeath(c, c.x, c.y); };
const actor = (id, extra = {}) => ({ id, x: 0, y: 0, health: 10, def: { hostile: true }, ...extra });

// The player's own kill rewards everything.
const mine = actor('mine');
PD.noteTeamHit(mine, {});
assert.equal(kill(mine), true);
assert.deepEqual([motes.length, xp.length, events.length], [1, 1, 1], 'player kill: Motes, XP and the activity event');

// An Omgurku killing a Porakaneki next to the player rewards nothing, but still leaves a corpse.
const victim = actor('pora', { isTribeHunter: true, tribeId: 'porakaneki', isBandit: true });
PD.noteTeamHit(victim, { friendlyFire: true, factionCombat: true, attacker: { id: 'omgurku' } });
assert.equal(kill(victim), true);
assert.deepEqual([motes.length, xp.length, events.length], [1, 1, 1], 'NPC-vs-NPC death: no Motes, XP or kill event');
assert(corpses.includes('pora'), 'the NPC-killed hunter still becomes a corpse');

// Player softened it up, an NPC finished it: the NPC owns the kill.
const stolen = actor('stolen');
PD.noteTeamHit(stolen, {});
PD.noteTeamHit(stolen, { friendlyFire: true, attacker: { id: 'bandit' } });
kill(stolen);
assert.deepEqual([motes.length, xp.length], [1, 1], 'a kill stolen by an NPC rewards nothing');

// Untouched by anyone on the player's side (e.g. a predator's prey).
kill(actor('prey'));
assert.equal(motes.length, 1, 'a death nobody on the player\'s side touched rewards nothing');

// A burn the player started that kills 30s later (resource-tick death) still counts.
const burned = actor('burned');
PD.noteTeamHit(burned, {});
nowMs += 30000;
burned._deathByAffliction = true; // What game.js's tickCreatureResources marks before the transition.
kill(burned);
assert.deepEqual([motes.length, xp.length, events.length], [2, 2, 2], 'a lingering burn kill is the player\'s');
assert.match(game, /c\._deathByAffliction = true;[^\n]*\n\s*transitionCreatureToDeath\(c, c\.x, c\.y\);/, 'resource-tick deaths are marked as damage-over-time deaths');

// Companions never award kill progression.
const pet = actor('pet', { isCompanion: true });
kill(pet);
assert.equal(motes.length, 2);

console.log('Kill attribution checks passed.');
