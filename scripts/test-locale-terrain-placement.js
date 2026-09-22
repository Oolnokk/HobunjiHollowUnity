const assert = require('assert');
const Placement = require('../docs/js/locale-terrain-placement.js');

function makeWorkspace() {
  const root = {
    schema: 'hobunji_map.v1', id: 'root', cols: 12, rows: 8, tiles: {}, generatedFrom: { seed: 'unit', note: 'Flattened after 1x tile-density expansion.' }
  };
  for (let r = 0; r < root.rows; r++) for (let c = 0; c < root.cols; c++) root.tiles[`${c},${r}`] = { type: 'grass', crop: '' };
  const sub = { schema: 'hobunji_map.v1', id: 'p2map', isSubmap: true, plateauGroupId: 'p2', elevation: 2, anchorC: 6, anchorR: 2, cols: 5, rows: 4, tiles: {} };
  for (let r = 2; r <= 5; r++) for (let c = 6; c <= 10; c++) {
    root.tiles[`${c},${r}`].plateau = 'p2';
    sub.tiles[`${c - 6},${r - 2}`] = { type: 'grass', crop: '' };
  }
  return { schema: 'hobunji_map_editor_workspace.v1', maps: [root, sub], plateauGroups: [{ id: 'p2', elevation: 2 }], localeInstances: [], entry: { col: 0, row: 4, side: 'west' } };
}

const cave = {
  schema: 'hobunji_locale.v1', id: 'locale_test_cave', name: 'Test Cave', category: 'cave', cols: 4, rows: 2,
  tiles: {
    '0,0': { type: 'grass' }, '1,0': { type: 'grass' }, '2,0': { type: 'grass' }, '3,0': { type: 'grass' },
    '0,1': { type: 'grass' }, '1,1': { type: 'grass' }, '2,1': { type: 'grass' }, '3,1': { type: 'grass' },
  },
  terrainAnchors: {
    '2,0': { terrain: 'plateauCliff', strength: 'required', facing: 'west', height: { mode: 'relativeRange', min: 2, max: 2 } },
  },
  embeddedTiles: {
    '2,0': { terrain: 'plateau', facing: 'any', height: { mode: 'relativeRange', min: 2, max: 2 }, carveToLocaleFloor: true },
    '3,0': { terrain: 'plateau', facing: 'any', height: { mode: 'relativeRange', min: 2, max: 2 }, carveToLocaleFloor: true },
    '2,1': { terrain: 'plateau', facing: 'any', height: { mode: 'relativeRange', min: 2, max: 2 }, carveToLocaleFloor: true },
    '3,1': { terrain: 'plateau', facing: 'any', height: { mode: 'relativeRange', min: 2, max: 2 }, carveToLocaleFloor: true },
  },
  objects: [], npcAnchors: [], connectors: [{ id: 'mouth', col: 0, row: 0, side: 'west', label: 'Cave mouth' }],
  placement: { mode: 'fixed', clearanceTiles: 0, requiresFlatGround: true, minDistanceFromEntry: 0, allowedZones: [] },
};

const workspace = makeWorkspace();
Placement.placeTerrainAwareLocales(workspace, [cave], { seed: 'unit', scale: 1 });
assert.strictEqual(workspace.localeInstances.length, 1, 'cave should place');
const diagnostic = workspace.localeTerrainDiagnostics[0];
assert.strictEqual(diagnostic.status, 'placed');
assert.strictEqual(diagnostic.selected.floorTier, 0);
const { anchorC, anchorR } = diagnostic.selected;
assert.strictEqual(anchorC + 2, 6, 'required west-facing cliff probe should sit on west plateau edge');
for (const [dc, dr] of [[2,0],[3,0],[2,1],[3,1]]) {
  const wc = anchorC + dc, wr = anchorR + dr;
  assert.ok(!workspace.maps[0].tiles[`${wc},${wr}`].plateau, `embedded cell ${wc},${wr} should be carved out of plateau root mask`);
  const subKey = `${wc - 6},${wr - 2}`;
  assert.ok(!workspace.maps[1].tiles[subKey], `embedded cell ${subKey} should be removed from plateau submap mask`);
}
assert.strictEqual(workspace.localeInstances[0].terrainAware, true);
assert.strictEqual(workspace.localeInstances[0].connectors[0].x, anchorC);

// Boundary escarpments and internal plateau cliffs are distinct terrain classes.
const boundaryClassWorkspace = makeWorkspace();
for (let r = 2; r <= 5; r++) {
  const tile = boundaryClassWorkspace.maps[0].tiles[`6,${r}`];
  tile.borderEscarpment = true;
  tile.generatedBorderEscarpment = true;
  tile.borderEscarpmentSide = 'west';
}
const plateauRuleOnBoundary = Placement.evaluateCandidateForTest(boundaryClassWorkspace, cave, 4, 2, { scale: 1, seed: 'boundary-class-test' });
assert.strictEqual(plateauRuleOnBoundary.ok, false, 'plateauCliff must reject a wilderness boundary escarpment');
const boundaryCave = JSON.parse(JSON.stringify(cave));
boundaryCave.id = 'locale_test_boundary_cave';
boundaryCave.terrainAnchors['2,0'].terrain = 'boundaryCliff';
const boundaryRuleOnBoundary = Placement.evaluateCandidateForTest(boundaryClassWorkspace, boundaryCave, 4, 2, { scale: 1, seed: 'boundary-class-test' });
assert.strictEqual(boundaryRuleOnBoundary.ok, true, `boundaryCliff must match the exported boundary escarpment: ${boundaryRuleOnBoundary.reason || 'unknown rejection'}`);

// A cave whose embedded host is not above its floor must be rejected.
const flatWorkspace = makeWorkspace();
for (const tile of Object.values(flatWorkspace.maps[0].tiles)) delete tile.plateau;
flatWorkspace.maps = [flatWorkspace.maps[0]];
flatWorkspace.plateauGroups = [];
Placement.placeTerrainAwareLocales(flatWorkspace, [cave], { seed: 'unit', scale: 1 });
assert.strictEqual(flatWorkspace.localeInstances.length, 0);
assert.strictEqual(flatWorkspace.localeTerrainDiagnostics[0].status, 'skipped');

// Cardinal rotation must rotate the entire locale, not just the cave mesh.
function makeRotationWorkspace() {
  const root = { schema: 'hobunji_map.v1', id: 'rotation-root', cols: 8, rows: 8, tiles: {}, generatedFrom: { seed: 'rotation-unit', note: 'Flattened after 1x tile-density expansion.' } };
  for (let r = 0; r < root.rows; r++) for (let c = 0; c < root.cols; c++) root.tiles[`${c},${r}`] = { type: 'grass', crop: '' };
  const sub = { schema: 'hobunji_map.v1', id: 'rotation-p2-map', isSubmap: true, plateauGroupId: 'rotation-p2', elevation: 2, anchorC: 4, anchorR: 0, cols: 4, rows: 8, tiles: {} };
  for (let r = 0; r < 8; r++) for (let c = 4; c < 8; c++) {
    root.tiles[`${c},${r}`].plateau = 'rotation-p2';
    sub.tiles[`${c - 4},${r}`] = { type: 'grass', crop: '' };
  }
  for (let c = 4; c < 8; c++) {
    root.tiles[`${c},0`].borderEscarpment = true;
    root.tiles[`${c},7`].borderEscarpment = true;
  }
  for (let r = 0; r < 8; r++) root.tiles[`7,${r}`].borderEscarpment = true;
  return { schema: 'hobunji_map_editor_workspace.v1', maps: [root, sub], plateauGroups: [{ id: 'rotation-p2', elevation: 2 }], localeInstances: [], entry: { col: 0, row: 4, side: 'west' } };
}

const rotatingCave = {
  schema: 'hobunji_locale.v1', id: 'locale_rotating_cave', name: 'Rotating Cave', category: 'cave', cols: 2, rows: 1,
  tiles: { '0,0': { type: 'grass' } },
  terrainAnchors: { '0,0': { terrain: 'plateauCliff', strength: 'required', facing: 'north', height: { mode: 'any', min: null, max: null } } },
  embeddedTiles: {},
  objects: [{ id: 'cave', kind: 'structure', key: 'cave_small', col: 0, row: 0, w: 1, h: 1, rot: 180 }],
  npcAnchors: [],
  connectors: [{ id: 'mouth', col: 0, row: 0, side: 'north', label: 'Cave mouth' }],
  placement: { mode: 'fixed', rotationMode: 'cardinal', clearanceTiles: 0, requiresFlatGround: false, minDistanceFromEntry: 0, allowedZones: [] },
};
const rotationWorkspace = makeRotationWorkspace();
Placement.placeTerrainAwareLocales(rotationWorkspace, [rotatingCave], { seed: 'rotation-unit', scale: 1 });
assert.strictEqual(rotationWorkspace.localeInstances.length, 1, 'cardinal cave locale should rotate to the only non-boundary cliff face');
const rotationInstance = rotationWorkspace.localeInstances[0];
const rotationDiagnostic = rotationWorkspace.localeTerrainDiagnostics[0];
assert.strictEqual(rotationDiagnostic.selected.rotationDeg, 270, 'authored north-facing cave should rotate 270° to the only west-facing internal cliff');
assert.strictEqual(rotationInstance.rotationDeg, 270, 'runtime locale instance must preserve the selected terrain-placement rotation');
assert.strictEqual(rotationInstance.connectors[0].side, 'west', 'entrance connector must rotate with the locale rather than remaining north-facing');
assert.strictEqual(rotationInstance.objects[0].rot, 90, 'cave object yaw must rotate with the locale footprint');

// Installing the adapter must keep a legacy locale on the old generator path.
const legacy = { id: 'legacy', tiles: { '0,0': { type: 'grass' } }, placement: {} };
let receivedLocales = null;
const fakeGenerator = {
  generateWorkspace(seed, overrides) { receivedLocales = overrides.locales; return makeWorkspace(); },
  generateZoneWorkspace(zone, seed, locales) { receivedLocales = locales; return makeWorkspace(); },
};
Placement.install(fakeGenerator);
fakeGenerator.generateWorkspace('unit', { width: 12, locales: [legacy, cave] });
assert.deepStrictEqual(receivedLocales.map(item => item.id), ['legacy']);
console.log('locale-terrain-placement tests passed');
