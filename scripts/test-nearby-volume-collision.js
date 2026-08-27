#!/usr/bin/env node
'use strict';
const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8');
const volume = read('docs/js/nearby-volume-collision.js');
const game = read('docs/game.js');
const ranged = read('docs/js/combat/ranged-weapons.js');
const popup = read('docs/js/world-popup-text.js');
const index = read('docs/index.html');
const probe = read('docs/js/pixel-probe.js');

assert(volume.includes('const COMBAT_RADIUS_TILES = 12'), 'combat mesh broad phase is bounded');
assert(volume.includes('const TREE_RADIUS_TILES = 2.25'), 'outside-combat tree collision uses a tiny radius');
assert(volume.includes('const treeOnly = !combat'), 'outside combat collects trees only');
assert(volume.includes('textureAlphaAt'), 'transparent texture pixels are sampled');
assert(volume.includes('hitCanBlock(hit)'), 'ray hits reject transparent pixels');
assert(game.includes('NearbyVolumeCollision?.canPlayerOccupy?.(wx, wy'), 'player movement uses precise nearby volumes');
assert(!volume.includes('moveCreatureToward'), 'AI movement is not routed through precise mesh collision');
assert(ranged.includes('coverHit.t <= nearest.interval.enter'), 'cover wins only when it is in front of the hostile');
assert(ranged.includes('coverHit.t <= playerHit.enter'), 'cover also protects the player from enemy projectiles');
assert(ranged.includes('updateBanditAimLabel'), 'aiming updates the bandit identity label');
assert(ranged.includes("(bandit.name || 'Bandit') + ' · ' + rank"), 'bandit labels include name and rank');
assert(popup.includes('setAimLabel, clearAimLabel'), 'world popup runtime exposes persistent aimed labels');
assert(index.indexOf('nearby-volume-collision.js') < index.indexOf('ranged-weapons.js'), 'volume runtime loads before ranged weapons');
assert(probe.includes('Nearby volumes: mode='), 'pixel probe reports volume diagnostics');

for (const [name, source] of [['volume', volume], ['game', game], ['ranged', ranged], ['popup', popup], ['probe', probe]]) {
  assert.doesNotThrow(() => new Function(source), name + ' parses');
}
console.log('nearby volume collision/bandit label contracts: 19 checks passed');
