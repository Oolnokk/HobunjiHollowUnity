const assert = require('assert');
const fs = require('fs');

const piece = JSON.parse(fs.readFileSync('docs/config/pieces/barn-nursery.json', 'utf8'));
const nurserySource = fs.readFileSync('docs/js/livestock-nursery.js', 'utf8');
const troughSource = fs.readFileSync('docs/js/farm-troughs.js', 'utf8');
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8');

const cells = piece.footprint?.cells || [];
assert.equal(cells.length, 6, 'Nursery authored footprint has exactly six cells');
const xs = [...new Set(cells.map(cell => cell.x))].sort((a, b) => a - b);
const ys = [...new Set(cells.map(cell => cell.y))].sort((a, b) => a - b);
assert.equal(xs.length, 3, 'Nursery authored footprint spans exactly three columns');
assert.equal(ys.length, 2, 'Nursery authored footprint spans exactly two rows');
assert.deepEqual(xs, [8, 9, 10], 'Nursery footprint columns remain contiguous');
assert.deepEqual(ys, [8, 9], 'Nursery footprint rows remain contiguous');

const entries = piece.footprint?.extensions?.entryTunnels || [];
assert.equal(entries.length, 1, 'Nursery has one authored exterior entrance');
assert.equal(entries[0].x, 9, 'Nursery entrance stays centered on the three-tile front');
assert.equal(entries[0].y, 9, 'Nursery entrance stays on the front/south row');
assert.equal(piece.base?.height, 1.2, 'Nursery keeps its compact 1.2-unit wall height');
const roofSection = piece.roof?.crossGableSections?.[0];
assert(roofSection, 'Nursery has an authored Highland gable section');
assert.equal(roofSection.roofHeight, 0.85, 'Nursery keeps its lower 0.85-unit roof');

assert(nurserySource.includes("const NURSERY_PIECE_DEF = { file: 'config/pieces/barn-nursery.json', w: 3, h: 2 };"), 'runtime registers the dedicated 3x2 authored piece');
assert(nurserySource.includes('buildings.BARN_PIECES[NURSERY_TIER] = { ...NURSERY_PIECE_DEF };'), 'runtime extends the existing exported barn-piece registry instead of forking FarmBuildings');
assert(nurserySource.includes('NURSERY_PIECE_DEF.w') && nurserySource.includes('NURSERY_PIECE_DEF.h'), 'initial placement searches the true 3x2 footprint');
assert(nurserySource.includes("slots: 0"), 'Nursery tier cannot silently add adult livestock capacity');
assert(!troughSource.includes('lifeStage'), 'FarmTroughs does not contain Nursery lifecycle behavior');
assert(!troughSource.includes('growBaby'), 'FarmTroughs does not contain Grow Up behavior');
assert(troughSource.includes('livestock-nursery.js'), 'FarmTroughs only bootstraps the standalone Nursery module');
assert(bridgeSource.includes("Object.defineProperty(window, 'FarmPanel'"), 'load-order bridge is limited to the FarmPanel publication handoff');
assert(bridgeSource.includes('installNursery'), 'load-order bridge only installs the standalone Nursery hooks');

console.log('Nursery building-piece regression tests passed');
