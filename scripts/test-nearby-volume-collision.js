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

assert(volume.includes("algorithm: 'semantic-height'"), 'cover reports the semantic-height algorithm');
assert(volume.includes('boundsFromParts'), 'furniture height comes from authored part metadata');
assert(volume.includes('window.ProceduralFurniture?.CATALOG'), 'procedural furniture uses its authored recipe dimensions');
assert(volume.includes('node.userData?.partById'), 'authored furniture uses its runtime part metadata');
assert(volume.includes('semantic.heightTiles * Math.abs(transform.sy)'), 'post-placement world Y scale affects furniture cover height');
assert(volume.includes('window.RangedWeapons?.actorHitbox?.(deps.player)'), 'player head height uses the shared portrait hitbox');
assert(volume.includes('headY - ground'), 'cover threshold is the player head-to-ground distance');
assert(volume.includes('SPATIAL_CELL_TILES'), 'semantic cover is spatially bucketed');
assert(volume.includes('projectileCoverUsesTile'), 'native trees use their centered solid tile as cheap cover');
assert(volume.includes("if (!combat)"), 'cover stays disabled outside combat');
assert(volume.includes('!options.projectiles'), 'projectile cover retains its kill switch');
assert(!volume.includes('new deps.THREE.Raycaster'), 'cover creates no raycaster');
assert(!volume.includes('intersectObjects'), 'cover performs no mesh ray intersection');
assert(!volume.includes('textureAlphaAt'), 'cover performs no texture alpha sampling');
assert(!volume.includes('.geometry'), 'cover never inspects render geometry');
assert(!volume.includes('boundingSphere'), 'cover never calculates mesh bounds');
assert(!volume.includes('boundingBox'), 'cover never calculates mesh bounds');
assert(!volume.includes('canPlayerOccupy'), 'rendered cover exposes no player-movement API');
assert(!game.includes('NearbyVolumeCollision?.canPlayerOccupy'), 'player movement no longer calls rendered collision');
assert(game.includes('tryPlayerTileSidestep'), 'blocked tile movement can sidestep around obstacles');
assert(game.includes('vegGroup.userData.projectileCoverUsesTile = true'), 'native tree trunks use their centered solid tile for projectile cover');
assert(game.includes('const sideOrder = [_playerTileSidestepSide, -_playerTileSidestepSide]'), 'sidestep direction remains stable across frames');
assert(foliage.includes('amp * originBlend'), 'procedural trunk/spine bases stay centered on their authored tile origin');
assert(!volume.includes('moveCreatureToward'), 'AI movement is not routed through cover collision');
assert(ranged.includes('coverHit.t <= nearest.interval.enter'), 'cover wins only when it is in front of the hostile');
assert(ranged.includes('coverHit.t <= playerHit.enter'), 'cover also protects the player from enemy projectiles');
assert(ranged.includes('updateBanditAimLabel'), 'aiming updates the bandit identity label');
assert(ranged.includes("(bandit.name || 'Bandit') + ' · ' + rank"), 'bandit labels include name and rank');
assert(popup.includes('setAimLabel, clearAimLabel'), 'world popup runtime exposes persistent aimed labels');
assert(index.indexOf('nearby-volume-collision.js') < index.indexOf('ranged-weapons.js'), 'cover runtime loads before ranged weapons');
assert(index.includes('settingVolumeCollisionMaster'), 'settings retain the master cover toggle');
assert(index.includes('settingVolumeCollisionProjectiles'), 'settings retain the projectile cover toggle');
assert(!index.includes('settingVolumeCollisionMovement'), 'removed movement collision cannot be re-enabled in settings');
assert(!index.includes('settingVolumeCollisionTrees'), 'removed out-of-combat tree mesh collision cannot be re-enabled');
assert(probe.includes('Nearby cover: enabled='), 'pixel probe reports cover diagnostics');

for (const [name, source] of [['volume', volume], ['game', game], ['ranged', ranged], ['popup', popup], ['foliage', foliage], ['probe', probe]]) {
  assert.doesNotThrow(() => new Function(source), name + ' parses');
}
console.log('height-only projectile cover/tile movement/bandit label contracts passed');
