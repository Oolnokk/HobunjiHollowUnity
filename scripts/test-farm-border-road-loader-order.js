'use strict';

const fs = require('fs'); // Used to inspect the parser-time gameplay entrypoint and house module loader.
const path = require('path'); // Used to resolve repository-relative source files consistently.

const indexSource = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8'); // Gameplay parser order under test.
const houseLoaderSource = fs.readFileSync(path.join(__dirname, '../docs/js/house-pieces.js'), 'utf8'); // Must no longer own farm-only runtime adapters.
const borderIndex = indexSource.indexOf('src="js/border-terrain.js'); // The dependency that must exist before the farm border adapter executes.
const pathIndex = indexSource.indexOf('src="js/farm-path-bricks.js'); // Farm road adapter's parser position.
const edgeIndex = indexSource.indexOf('src="js/farm-border-cliff-edge.js'); // Farm border adapter's parser position.
const gameIndex = indexSource.indexOf('src="game.js'); // Both adapters must install before game boot invokes their wrapped APIs.
const roadSource = fs.readFileSync(path.join(__dirname, '../docs/js/farm-path-bricks.js'), 'utf8'); // Road extension and grass-mask contract under test.
const cliffSource = fs.readFileSync(path.join(__dirname, '../docs/js/farm-border-cliff-edge.js'), 'utf8'); // Post-construction surface-mapping contract under test.
const vegetationSource = fs.readFileSync(path.join(__dirname, '../docs/js/vegetation-crop-rendering.js'), 'utf8'); // Billboard suppression consumer under test.

if (!(borderIndex >= 0 && borderIndex < pathIndex && pathIndex < edgeIndex && edgeIndex < gameIndex)) {
  throw new Error('farm border/road adapters are not loaded directly after BorderTerrain and before game.js');
}
if (houseLoaderSource.includes("'farm-path-bricks.js") || houseLoaderSource.includes("'farm-border-cliff-edge.js")) {
  throw new Error('farm border/road adapters still depend on the unrelated HousePieces loader');
}
for (const expected of ['ENTRANCE_BORDER_DEPTH = 18', 'extendThroughNorthGap(splineData)', 'suppressesGrassAt:']) {
  if (!roadSource.includes(expected)) throw new Error(`missing farm road continuation contract: ${expected}`);
}
if (!vegetationSource.includes('!pavedRoad') || !vegetationSource.includes('rebuildFarmBillboards: _rebuildFarmBillboards')) {
  throw new Error('farm grass billboards are not connected to the paved-road suppression mask');
}
if (!cliffSource.includes('queueMicrotask(applyFinishedCliffSurfaces)') || !cliffSource.includes("farm-border-immediate-edge:post-create")) {
  throw new Error('replacement cliffs are not surface-mapped after construction');
}

console.log('PASS farm cliffs map after construction; road crosses the border gap and suppresses underlying grass.');
