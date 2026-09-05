const assert = require('node:assert/strict');
const fs = require('node:fs');

const porchMaterialSource = fs.readFileSync('docs/js/porch-surface-material.js', 'utf8'); // Pins the presentation-only porch material wrapper added by this change.
const loaderSource = fs.readFileSync('docs/js/combat/combat-config-loader.js', 'utf8'); // Verifies the wrapper loads after the existing elevation bridge instead of replacing it.
const inn = JSON.parse(fs.readFileSync('docs/config/maps/map_i_inn.json', 'utf8')); // Verifies only Foroji's authored stage table opts into walkable elevation.

new Function(porchMaterialSource);
new Function(loaderSource);

assert.match(porchMaterialSource, /TEXTURE_PATH = 'assets\/textures\/carved_smooth\.png'/, 'porches use carved_smooth.png');
assert.match(porchMaterialSource, /WOOD_TINT = '#8b6540'/, 'porches use the furniture author wood base color');
assert.match(porchMaterialSource, /PORCH_TAGS = new Set\(\['porch', 'porchStair', 'railing'\]\)/, 'replacement is limited to the porch assembly');
assert.match(porchMaterialSource, /FULL_QUAD_UVS = new Float32Array\(\[0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1\]\)/, 'each authored porch surface receives one stretched texture square');
assert.match(porchMaterialSource, /mode: 'shadeFill'/, 'wood tint preserves carved texture shading via the shared shade-fill path');
assert.match(porchMaterialSource, /Object\.assign\(wrappedBuild, originalBuild\)/, 'existing HousePieceGen/elevation wrapper markers are preserved');
assert.match(porchMaterialSource, /porchMatDebug/, 'mobile-friendly porch material diagnostics can be enabled without devtools');

const elevationIndex = loaderSource.indexOf('town-player-body-elevation-bridge.js');
const porchMaterialIndex = loaderSource.indexOf('porch-surface-material.js');
assert.ok(elevationIndex >= 0 && porchMaterialIndex > elevationIndex, 'porch material wrapper loads after the proven elevation bridge');

const stageStation = inn.npcStations.find(station => station.id === 'station_foroji_inn_music');
assert.ok(stageStation, 'Foroji inn music station exists');
const stageTable = inn.furniture.find(piece => piece.id === 'fmss04iltqngq');
assert.ok(stageTable, 'Foroji stage table exists');
assert.equal(stageTable.itemKey, 'tableLongFurniture');
assert.equal(stageTable.col, stageStation.col);
assert.equal(stageTable.row, stageStation.row);
assert.equal(stageTable.walkableElevation, true, 'Foroji stage table opts into geometry-derived elevation');
assert.deepEqual(inn.furniture.filter(piece => piece.walkableElevation).map(piece => piece.id), ['fmss04iltqngq'], 'no other inn furniture is made walkable by this authored change');

console.log('Foroji stage elevation and porch material regression checks passed');
