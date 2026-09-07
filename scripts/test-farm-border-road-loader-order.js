'use strict';

const fs = require('fs'); // Used to inspect the parser-time gameplay entrypoint and house module loader.
const path = require('path'); // Used to resolve repository-relative source files consistently.

const indexSource = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8'); // Gameplay parser order under test.
const houseLoaderSource = fs.readFileSync(path.join(__dirname, '../docs/js/house-pieces.js'), 'utf8'); // Must no longer own farm-only runtime adapters.
const borderIndex = indexSource.indexOf('src="js/border-terrain.js'); // The dependency that must exist before the farm border adapter executes.
const pathIndex = indexSource.indexOf('src="js/farm-path-bricks.js'); // Farm road adapter's parser position.
const edgeIndex = indexSource.indexOf('src="js/farm-border-cliff-edge.js'); // Farm border adapter's parser position.
const gameIndex = indexSource.indexOf('src="game.js'); // Both adapters must install before game boot invokes their wrapped APIs.

if (!(borderIndex >= 0 && borderIndex < pathIndex && pathIndex < edgeIndex && edgeIndex < gameIndex)) {
  throw new Error('farm border/road adapters are not loaded directly after BorderTerrain and before game.js');
}
if (houseLoaderSource.includes("'farm-path-bricks.js") || houseLoaderSource.includes("'farm-border-cliff-edge.js")) {
  throw new Error('farm border/road adapters still depend on the unrelated HousePieces loader');
}

console.log('PASS farm border/road adapters load after BorderTerrain and before game boot.');
