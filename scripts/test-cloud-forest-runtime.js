'use strict';
const assert = require('assert');

require('../docs/js/cloud-forest-runtime.js');
const V2 = globalThis.CloudForestRuntimeV2;
assert(V2, 'CloudForestRuntimeV2 export missing');
assert.equal(V2.TREE_LATTICE_WORLD, 2, 'generated forest spacing should resolve to two final world units');
assert.equal(V2.TREE_KEEP_PROBABILITY, 0.5625, 'Cloud Forest Shadewood keep probability should mirror thinning + variety conversion');

function makeWorkspace() {
  const cols = 20, rows = 18;
  const tiles = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles[`${c},${r}`] = { type: 'grass', crop: '' };
  // Reproduce the old gate bug: six-wide clearance rectangle is all painted path.
  for (let r = 0; r < 10; r++) for (let c = 6; c <= 11; c++) tiles[`${c},${r}`].type = 'path';
  // Ordinary route takes over as a narrow strip farther inland.
  for (let r = 10; r < 16; r++) for (let c = 8; c <= 10; c++) tiles[`${c},${r}`].type = 'path';

  // One north boundary plateau group that should lose cliff semantics but keep
  // its own footprint identity. The two rows immediately inside it model the
  // generated distant-boundary apron; the first real inland group is tier 2.
  for (let c = 0; c < cols; c++) {
    tiles[`${c},0`].plateau = 'north_wall';
    tiles[`${c},0`].borderEscarpment = true;
    tiles[`${c},0`].generatedBorderEscarpment = true;
    tiles[`${c},0`].borderEscarpmentSide = 'north';
    if (tiles[`${c},0`].type !== 'path') tiles[`${c},0`].type = 'rock';
    tiles[`${c},1`].distantBoundaryLandscape = true;
    tiles[`${c},2`].distantBoundaryLandscape = true;
    tiles[`${c},3`].plateau = 'inland_high';
  }

  const root = {
    id: 'map_generated_wilderness_root', cols, rows, tiles,
    transitions: [{ id: 'sp_generated_entry', label: 'Entry north', col: 6, row: 0 }],
    routes: [{ id: 'route_map_entry_marker', label: 'Entry north', nodes: [[6,0]] }],
    generatedFrom: {},
  };
  return {
    maps: [root, { id: 'map_generated_wilderness_north_wall', isSubmap: true, parentMapId: root.id, plateauGroupId: 'north_wall', elevation: 6, tiles: {} }],
    plateauGroups: [
      { id: 'north_wall', elevation: 6 },
      { id: 'inland_high', elevation: 2 },
    ],
    generatorPreset: {},
  };
}

const workspace = makeWorkspace();
const root = workspace.maps[0];
const repair = V2.repairGeneratedEntryWorkspace(workspace);
assert.equal(repair.repaired, true);
assert.equal(repair.originalWidth, 6);
assert(repair.trimmed > 0, 'expected over-wide path cells to be converted back to grass');
assert.equal(root.transitions[0].col, 9, 'transfer must align to final gate center');
assert.equal(root.transitions[0].row, 0);
assert.deepStrictEqual(root.routes[0].nodes, [[9,0]], 'entry route marker must align to transfer');
for (let r = 0; r < 8; r++) {
  const rowPaths = [];
  for (let c = 0; c < root.cols; c++) if (root.tiles[`${c},${r}`].type === 'path') rowPaths.push(c);
  assert.deepStrictEqual(rowPaths, [8,9,10], `gate slice ${r} should retain only the narrow road`);
}
assert.equal(root.tiles['8,12'].type, 'path', 'ordinary interior route must remain untouched');
assert.equal(root.tiles['10,12'].type, 'path', 'ordinary interior route must remain untouched');

const cliffFix = V2.removeCloudForestNorthCliffs(workspace);
assert.equal(cliffFix.removed, root.cols);
assert.equal(root.tiles['0,0'].plateau, 'north_wall', 'north footprint must keep its original group identity');
assert.equal(root.tiles['0,0'].borderEscarpment, undefined);
assert.equal(root.tiles['0,0'].type, 'grass');
assert.equal(root.tiles['0,0'].borderEntryGate, true, 'retained boundary plateau should not be reconstructed as an incline ring');
assert.equal(workspace.plateauGroups.find(g => g.id === 'north_wall').elevation, 2, 'north boundary group should normalize to inland tier');
assert.equal(workspace.maps[1].elevation, 2, 'matching boundary submap should normalize with its plateau group');

// Forest density should be deterministic, full-height only, and leave the road open.
const layoutA = V2.buildForestLayout(40, 18, 20, 3, () => 5);
const layoutB = V2.buildForestLayout(40, 18, 20, 3, () => 5);
assert.deepStrictEqual(layoutA, layoutB, 'background forest scatter should be deterministic');
assert(layoutA.length > 40 && layoutA.length < 125, `expected generated-forest-like density, got ${layoutA.length}`);
assert(layoutA.every(e => e.scale >= 0.92 && e.scale <= 1.08), 'all scenery trees should remain normal full-height variants');
assert(layoutA.every(e => Math.abs(e.x - 20) >= 3 - 0.2), 'tree jitter must not materially invade the road clearance');
assert(layoutA.every(e => Math.abs(e.y - 5.02) < 1e-6), 'tree bases should follow the supplied hillside height');

console.log(`PASS cloud forest runtime: trimmed ${repair.trimmed} path tiles, aligned entry to ${repair.centerAxis}, normalized ${cliffFix.groups} north cliff group, generated ${layoutA.length} scenery Shadewoods.`);
