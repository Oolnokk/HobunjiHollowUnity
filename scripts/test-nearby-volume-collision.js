#!/usr/bin/env node
'use strict';
const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8');
const volume = read('docs/js/nearby-volume-collision.js');
const game = read('docs/game.js');
const ranged = read('docs/js/combat/ranged-weapons.js');
const bandits = read('docs/js/bandit-camps.js');
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
assert(volume.includes('textureAlpha: false'), 'legacy transparent-pixel precision is forcibly disabled');
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

assert(ranged.includes('nearestHostileHit(start, end, projectileRadius, p.areaId, p.owner)'), 'enemy projectiles test allied hostile bodies before reaching the player');
assert(ranged.includes('friendlyFireHits++'), 'allied enemy impacts are counted as friendly fire');
assert(ranged.includes('friendlyFire: true'), 'friendly-fire creature damage is explicitly tagged');
assert(ranged.includes("lastEvent = `friendly-fire:"), 'mobile ranged diagnostics identify friendly-fire impacts');
assert(ranged.includes('banditLosStatus(c, targetPlayer, def)'), 'loaded ranged AI checks LOS before firing');
assert(ranged.includes('repositionBanditForLos(c, targetPlayer, def, dt, los)'), 'blocked loaded ranged AI strafes for LOS');
assert(ranged.indexOf('if (!isLoaded(itemKey, c))') < ranged.indexOf('const los = banditLosStatus(c, targetPlayer, def)'), 'LOS seeking only occurs after the weapon is loaded');
assert(ranged.includes('BANDIT_LOS_CACHE_MS = 80'), 'bandit LOS work is throttled per actor');
assert(ranged.includes('ACTOR_HITBOX_CACHE_MS = 16'), 'actor hitbox work is shared within a rendered frame');
assert(ranged.includes('const sharedPerps = projectiles.some'), 'camera-relative projectile perps are computed once per projectile update');
assert(ranged.includes('WOULD_HIT_CACHE_MS = 50'), 'HUD hit prediction is throttled to 20 Hz');
assert(ranged.includes('coverHit.t <= nearest.interval.enter'), 'semantic cover wins only when it is in front of the nearest actor');
assert(ranged.includes('updateBanditAimLabel'), 'aiming updates the bandit identity label');
assert(ranged.includes("(bandit.name || 'Bandit') + ' · ' + rank"), 'bandit labels include name and rank');

assert(bandits.includes('_applyBanditTentGridCollision'), 'standing tents stamp a cheap runtime collision footprint');
assert(bandits.includes('tile.type = deps.TileType.ROCK'), 'tent collision reuses the normal solid-tile path');
assert(bandits.includes('_restoreBanditTentGridCollision'), 'burned/re-rolled tents restore their original grid tiles');
assert(bandits.includes('projectileCoverHeightTiles = 1.45'), 'tent supplies semantic height metadata for projectile cover');
assert(bandits.includes('projectileCoverRadiusTiles = 0.9'), 'tent supplies semantic footprint metadata for projectile cover');
assert(bandits.includes('window.NearbyVolumeCollision?.invalidate?.()'), 'tent add/remove invalidates the semantic cover index');

assert(popup.includes('setAimLabel, clearAimLabel'), 'world popup runtime exposes persistent aimed labels');
assert(index.indexOf('nearby-volume-collision.js') < index.indexOf('ranged-weapons.js'), 'cover runtime loads before ranged weapons');
assert(index.includes('settingVolumeCollisionMaster'), 'settings retain the master cover toggle');
assert(index.includes('settingVolumeCollisionProjectiles'), 'settings retain the projectile cover toggle');
assert(!index.includes('settingVolumeCollisionMovement'), 'removed movement collision cannot be re-enabled in settings');
assert(!index.includes('settingVolumeCollisionTrees'), 'removed out-of-combat tree mesh collision cannot be re-enabled');
assert(probe.includes('Nearby cover: enabled='), 'pixel probe reports cover diagnostics');

for (const [name, source] of [
  ['volume', volume], ['game', game], ['ranged', ranged], ['bandits', bandits],
  ['popup', popup], ['foliage', foliage], ['probe', probe],
]) {
  assert.doesNotThrow(() => new Function(source), name + ' parses');
}
console.log('height-only cover/tent collision/friendly-fire/LOS/performance contracts passed');
