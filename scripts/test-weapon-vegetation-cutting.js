#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the shared cone clear and targeted tree removal paths.
assert.match(gameSource, /function clearVegetationInAttackCone\(/, 'game exposes one shared weapon-cone vegetation clear');
assert.match(gameSource, /!tile \|\| tile\.crop \|\| \(tile\.type !== TileType\.WEEDS && tile\.type !== TileType\.SHRUB\)/,
  'weapon cones only consider unplanted weed and shrub tiles');
assert.match(gameSource, /tile\.type === TileType\.SHRUB && isChoppableTreeTile\(col, row\)/,
  'weapon cones protect true wilderness trees');
assert.match(gameSource, /inCone\(fromX, fromY, facingAngle, tileX, tileY, rangePx, halfConeRad\)/,
  'vegetation uses the attack range and angle instead of reticle-adjacent tiles');
assert.match(gameSource, /const zoneVisualsUpdated = removeZoneVegetationVisual\(currentArea, col, row\)/,
  'tree felling removes its indexed visual directly');
assert.match(gameSource, /!result\.zoneVisualsUpdated && \(tool === 'shovel'/,
  'successful targeted removal skips the full-zone ground rebuild');

// path is used to verify every player combat ability calls the shared vegetation clear.
for (const path of [
  'docs/js/combat/combat-combo.js',
  'docs/js/combat/combat-quickattacks.js',
  'docs/js/combat/combat-charged-breaker.js',
  'docs/js/combat/combat-counter-shield.js',
  'docs/js/combat/combat-flurry.js',
]) {
  assert.match(fs.readFileSync(path, 'utf8'), /clearVegetationInAttackCone/,
    `${path} clears vegetation during its real strike callback`);
}

console.log('weapon vegetation cutting tests passed');
