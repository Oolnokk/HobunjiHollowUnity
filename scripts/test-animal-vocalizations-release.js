#!/usr/bin/env node
'use strict';

// The vocal scheduler keeps a strong Set of every creature it has ticked. A
// creature that is despawned or dies must leave that set, otherwise the whole
// entity and its rig object graph stay reachable forever (~0.4 MB of JS heap
// per wild animal in a long session).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/animal-vocalizations.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, Math, Date }, { filename: 'animal-vocalizations.js' });
const vocal = window.AnimalVocalizations;
vocal.init({ random: () => 0.5, hasVoice: () => true, renderUtterance: () => true });

const creature = id => ({ id, creatureKey: 'gar-wolf', health: 10, state: 'idle', genotype: { sizeClass: 'medium' }, avatarRef: { group: {} } });

assert.equal(vocal.trackedCount(), 0, 'starts empty');

const a = creature('a'), b = creature('b'), c = creature('c');
for (const x of [a, b, c]) vocal.tickCreature(x, 0.1);
assert.equal(vocal.trackedCount(), 3, 'ticked creatures are tracked');

// Despawn path (game.js despawnCreature -> releaseCreature).
assert.equal(vocal.releaseCreature(a), true, 'release reports a tracked creature');
assert.equal(vocal.trackedCount(), 2, 'a released creature is no longer strongly held');
assert.equal(vocal.releaseCreature(a), false, 'releasing twice is harmless');

// Death path: a creature that died through any route drops out on its next tick,
// without needing debugSnapshot (a debug-only function) to prune it.
b.health = 0;
vocal.tickCreature(b, 0.1);
assert.equal(vocal.trackedCount(), 1, 'a dead creature is released by the scheduler itself');
vocal.tickCreature(b, 0.1);
assert.equal(vocal.trackedCount(), 1, 'ticking a dead creature never re-adds it');

// A released but still-living creature (e.g. visuals retired, data kept) simply re-registers.
vocal.tickCreature(a, 0.1);
assert.equal(vocal.trackedCount(), 2, 'a living creature that is ticked again is tracked again');

// Many create/despawn cycles must not accumulate.
for (let i = 0; i < 500; i++) {
  const x = creature('cycle-' + i);
  vocal.tickCreature(x, 0.1);
  vocal.releaseCreature(x);
}
assert.equal(vocal.trackedCount(), 2, 'create/despawn cycles leave nothing behind');

// Wiring: the removal paths actually call the release.
const game = fs.readFileSync(path.join(root, 'docs/game.js'), 'utf8');
const despawn = game.slice(game.indexOf('function despawnCreature(c)'), game.indexOf('function disposeCreaturePresentation(c)'));
assert.match(despawn, /AnimalVocalizations\?\.releaseCreature\?\.\(c\)/, 'despawnCreature releases the vocal scheduler reference');
const death = game.slice(game.indexOf('function transitionCreatureToDeath('), game.indexOf('function damageCreature('));
assert.match(death, /AnimalVocalizations\?\.releaseCreature\?\.\(c\)/, 'death releases the vocal scheduler reference');

console.log('animal vocalization release regression passed');
