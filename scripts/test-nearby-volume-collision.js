#!/usr/bin/env node
'use strict';
const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8');
const volume = read('docs/js/nearby-volume-collision.js');
const game = read('docs/game.js');
const ranged = read('docs/js/combat/ranged-weapons.js');
const popup = read('docs/js/world-popup-text.js');
const foliage = read('docs/js/foliage-generator.js');
const index = read('docs/index.html');
const probe = read('docs/js/pixel-probe.js');

assert(volume.includes('const COMBAT_RADIUS_TILES = 12'), 'combat mesh broad phase is bounded');
assert(volume.includes('!options.projectiles'), 'projectile cover has an independent kill switch');
assert(volume.includes('!options.textureAlpha'), 'texture alpha sampling has an independent kill switch');
assert(volume.includes('textureAlphaAt'), 'transparent texture pixels are sampled');
assert(volume.includes('hitCanBlock(hit)'), 'ray hits reject transparent pixels');
assert(volume.includes("if (!combat) return false"), 'rendered cover never scans outside combat');
assert(!volume.includes('canPlayerOccupy'), 'rendered collision exposes no player-movement API');
assert(!game.includes('NearbyVolumeCollision?.canPlayerOccupy'), 'player movement no longer calls rendered collision');
assert(game.includes('tryPlayerTileSidestep'), 'blocked tile movement can sidestep around obstacles');
assert(game.includes('const sideOrder = [_playerTileSidestepSide, -_playerTileSidestepSide]'), 'sidestep direction remains stable across frames');
assert(foliage.includes('amp * originBlend'), 'procedural trunk/spine bases stay centered on their authored tile origin');
assert(!volume.includes('moveCreatureToward'), 'AI movement is not routed through precise mesh collision');
assert(ranged.includes('coverHit.t <= nearest.interval.enter'), 'cover wins only when it is in front of the hostile');
assert(ranged.includes('coverHit.t <= playerHit.enter'), 'cover also protects the player from enemy projectiles');
assert(ranged.includes('updateBanditAimLabel'), 'aiming updates the bandit identity label');
assert(ranged.includes("(bandit.name || 'Bandit') + ' · ' + rank"), 'bandit labels include name and rank');
assert(popup.includes('setAimLabel, clearAimLabel'), 'world popup runtime exposes persistent aimed labels');
assert(index.indexOf('nearby-volume-collision.js') < index.indexOf('ranged-weapons.js'), 'volume runtime loads before ranged weapons');
assert(index.includes('settingVolumeCollisionMaster'), 'settings expose the master volume toggle');
assert(index.includes('settingVolumeCollisionProjectiles'), 'settings expose the projectile cover toggle');
assert(index.includes('settingVolumeCollisionAlpha'), 'settings expose the alpha precision toggle');
assert(!index.includes('settingVolumeCollisionMovement'), 'removed movement collision cannot be re-enabled in settings');
assert(!index.includes('settingVolumeCollisionTrees'), 'removed out-of-combat tree mesh collision cannot be re-enabled');
assert(probe.includes('Nearby cover: enabled='), 'pixel probe reports cover diagnostics');

for (const [name, source] of [['volume', volume], ['game', game], ['ranged', ranged], ['popup', popup], ['foliage', foliage], ['probe', probe]]) {
  assert.doesNotThrow(() => new Function(source), name + ' parses');
}
console.log('nearby projectile cover/tile movement/bandit label contracts passed');
