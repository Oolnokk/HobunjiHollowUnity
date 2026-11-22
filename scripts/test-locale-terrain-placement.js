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

// Two copies of the same locale (e.g. same-facing ruin-entrance copies) must
// not stack on one spot: the first copy's painted tiles look like plain ground.
const pairWorkspace = makeWorkspace();
const copyA = { ...JSON.parse(JSON.stringify(cave)), id: 'locale_test_cave_a' };
const copyB = { ...JSON.parse(JSON.stringify(cave)), id: 'locale_test_cave_b' };
Placement.placeTerrainAwareLocales(pairWorkspace, [copyA, copyB], { seed: 'unit', scale: 1 });
assert.strictEqual(pairWorkspace.localeInstances.length, 2, 'the west cliff has room for both copies');
const [rowA, rowB] = pairWorkspace.localeTerrainDiagnostics.map(entry => entry.selected.anchorR);
assert.ok(Math.abs(rowA - rowB) >= 2, `copies must not overlap (rows ${rowA} and ${rowB})`);

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

// Blossom locales must reserve the full native crown, not only their trunk's authored footprint.
function blossomWorkspace() {
  const root={id:'root',cols:36,rows:36,tiles:{},generatedFrom:{seed:'blossom',note:'Flattened after 1x tile-density expansion.'}};
  for(let r=0;r<36;r++)for(let c=0;c<36;c++)root.tiles[`${c},${r}`]={type:'grass'};
  return {maps:[root],localeInstances:[],objects:[],entry:{col:1,row:1,side:'west'}};
}
const blossomTemplate={
  id:'locale_five_blossoms_cyan',name:'Cyan Blossom Tree',category:'story_poi',
  cols:3,rows:3,festivalBlossom:{id:'cyan'},
  tiles:Object.fromEntries(Array.from({length:9},(_,i)=>[`${i%3},${Math.floor(i/3)}`,{type:'grass'}])),
  objects:[{id:'blossom',key:'blossom-tree',col:1,row:1,w:1,h:1}],
  terrainAnchors:{'7,1':{terrain:'water',strength:'preferred',weight:1}},
  placement:{allowedZones:[],requiresFlatGround:true,minDistanceFromEntry:0,clearanceTiles:0,preferSeclusion:false}
}; // Uses the real festivalBlossom marker rather than a test-only site name.
const cleanBlossom=blossomWorkspace();
Placement.placeTerrainAwareLocales(cleanBlossom,[blossomTemplate],{seed:'blossom-fixed',scale:1});
assert.equal(cleanBlossom.localeInstances.length,1,'flat test zone can stamp a blossom');
const originalBlossom=cleanBlossom.localeInstances[0].objects[0];
const clearGroundLandmark=cleanBlossom.localeInstances[0].blossomStartLandmark; // The real terrain pass reserves a short, dry-land starting point.
assert.ok(clearGroundLandmark && Number.isInteger(clearGroundLandmark.col) && Number.isInteger(clearGroundLandmark.row),
  'every generated blossom receives a nearby riddle start landmark');
assert.ok(Math.hypot(clearGroundLandmark.col-originalBlossom.x, clearGroundLandmark.row-originalBlossom.y)<=18,
  'riddle starting debris stays within eighteen tiles of the actual blossom, regardless of entry sector');
assert.equal(clearGroundLandmark.replacedTree,false,'an ordinary clear-ground location can host authored patterned pillar debris');
const treeCol=Math.min(34,Math.max(1,originalBlossom.x+(originalBlossom.x<24?4:-4)));
const treeRow=originalBlossom.y;
const farCol=originalBlossom.x<18?35:0;
const farRow=originalBlossom.y<18?35:0;
const crowdedBlossom=blossomWorkspace();
const nearTile=crowdedBlossom.maps[0].tiles[`${treeCol},${treeRow}`];
nearTile.type='shrub';nearTile.floraKind='copse';
nearTile.generatedObjectId='neighbor-tree';nearTile.generatedObjectType='copse';
const distantTile=crowdedBlossom.maps[0].tiles[`${farCol},${farRow}`];
distantTile.type='shrub';distantTile.floraKind='copse';
distantTile.generatedObjectId='distant-tree';distantTile.generatedObjectType='copse';
const landmarkTreeTile=crowdedBlossom.maps[0].tiles[`${clearGroundLandmark.col},${clearGroundLandmark.row}`]; // Promote the previously valid fallback to a replaceable ordinary tree.
landmarkTreeTile.type='shrub';landmarkTreeTile.floraKind='copse';
landmarkTreeTile.generatedObjectId='landmark-tree';landmarkTreeTile.generatedObjectType='copse';
crowdedBlossom.objects=[{id:'neighbor-tree'},{id:'distant-tree'},{id:'landmark-tree'}];
Placement.placeTerrainAwareLocales(crowdedBlossom,[blossomTemplate],{seed:'blossom-fixed',scale:1});
assert.equal(crowdedBlossom.localeInstances.length,1,'an ordinary nearby tree must not block a quest locale');
assert.equal(crowdedBlossom.localeInstances[0].objects[0].x,originalBlossom.x,'nearby clearable flora must not move the quest tree');
assert.equal(nearTile.type,'grass','nearby native canopy is removed before it can render inside the blossom');
assert.equal(nearTile.floraKind,undefined,'cleared canopy cannot respawn from a stray copse flora tag');
assert.equal(crowdedBlossom.objects.some(o=>o.id==='neighbor-tree'),false,'removed tree object metadata must not resurrect its mesh');
const nearLandmark=crowdedBlossom.localeInstances[0].blossomStartLandmark; // The tree-replacement site must survive export as locale instance metadata.
assert.equal(nearLandmark.replacedTree,true,'choose a real nearby copse to replace with patterned debris when one is available');
assert.equal(nearLandmark.col,clearGroundLandmark.col);
assert.equal(nearLandmark.row,clearGroundLandmark.row);
assert.equal(landmarkTreeTile.type,'grass','replaced tree has no residual rendered shrub below the patterned boulder');
assert.equal(crowdedBlossom.objects.some(o=>o.id==='landmark-tree'),false,'replaced copse is removed from generated object records');
assert.equal(distantTile.floraKind,'copse','ordinary trees outside the clearance radius are preserved');
assert.equal(crowdedBlossom.objects.some(o=>o.id==='distant-tree'),true,'distant native trees are not disturbed');

const sharedBlossomZone=blossomWorkspace(); // Two blossoms sharing one real zone must not reserve the same future debris tile.
const secondBlossom={...blossomTemplate,id:'locale_five_blossoms_gold',festivalBlossom:{id:'gold'}};
Placement.placeTerrainAwareLocales(sharedBlossomZone,[blossomTemplate,secondBlossom],{seed:'blossom-paired',scale:1});
const pairedStartSites=sharedBlossomZone.localeInstances.map(instance=>instance.blossomStartLandmark); // Both markers must survive sequential placement.
assert.equal(pairedStartSites.length,2,'both same-zone blossom locales can be stamped on one generated map');
assert.ok(pairedStartSites.every(Boolean),'each blossom has a nearby start despite previously claimed marker tiles');
assert.notDeepEqual(
  {col:pairedStartSites[0].col,row:pairedStartSites[0].row},
  {col:pairedStartSites[1].col,row:pairedStartSites[1].row},
  'a later blossom may never overwrite or reuse the earlier uniquely painted start');
assert.ok(pairedStartSites.every((site,i)=>{
  const tree=sharedBlossomZone.localeInstances[i].objects[0];
  return Math.hypot(site.col-tree.x,site.row-tree.y)<=18;
}),'both blossom clues are independently anchored near their actual tree');
assert.ok(Math.hypot(pairedStartSites[0].col-pairedStartSites[1].col,
  pairedStartSites[0].row-pairedStartSites[1].row)>=5,
  'same-zone patterned debris has enough separation to avoid physically overlapping inscriptions');
for(const [i,site] of pairedStartSites.entries()) {
  for(const [j,instance] of sharedBlossomZone.localeInstances.entries()) {
    if(i===j)continue;
    assert.ok(instance.objects.every(object=>Math.abs(object.x-site.col)>1||Math.abs(object.y-site.row)>1),
      'a subsequently stamped story locale cannot cover another blossom starting marker');
  }
}


// A terrain-aware locale can intersect just one part of a multi-tile boulder.
// Its ENTIRE generated object must disappear, on both the root and plateau
// submap, or the surviving tiles render a ghost rock with inconsistent collision.
const boulderWorkspace = makeWorkspace(); // Uses a real cliff-backed two-map footprint.
const boulderRoot = boulderWorkspace.maps[0]; // Source root overlay used by terrain placement.
const boulderSub = boulderWorkspace.maps[1]; // Plateau's separate render/collision source.
const boulderId = 'edge-crossing-boulder'; // Exact generated object identity shared by all overlay copies.
for (const c of [7, 8]) {
  Object.assign(boulderRoot.tiles[`${c},2`], {
    type: 'rock', generatedObjectId: boulderId, generatedObjectType: 'undiggableBoulder'
  });
  Object.assign(boulderSub.tiles[`${c - 6},0`], {
    type: 'rock', generatedObjectId: boulderId, generatedObjectType: 'undiggableBoulder'
  });
}
boulderRoot.tiles['4,4'].generatedObjectType = 'structure'; // Forces the same cliff-facing locale onto row 2 instead of shifting rows.
boulderRoot.tiles['4,4'].generatedObjectId = 'reserved-other-site';
boulderWorkspace.objects = [{ id: boulderId, type: 'undiggableBoulder' }];
boulderWorkspace.furniture = [{ id: 'boulder-decoration', generatedObjectId: boulderId }];
assert.equal(Placement.evaluateCandidateForTest(boulderWorkspace, cave, 4, 2, {scale:1}).ok, true,
  'an identified generated boulder may be completely cleared by a terrain-aware locale');
Placement.placeTerrainAwareLocales(boulderWorkspace, [cave], { seed: 'unit', scale: 1 });
assert.equal(boulderWorkspace.localeTerrainDiagnostics[0].status, 'placed');
assert.equal(boulderWorkspace.localeTerrainDiagnostics[0].selected.anchorR, 2);
assert.deepEqual(boulderWorkspace.localeTerrainDiagnostics[0].clearedObjectIds, [boulderId]);
for (const c of [7, 8]) {
  assert.equal(boulderRoot.tiles[`${c},2`].generatedObjectId, undefined,
    'even boulder tiles outside the locale footprint must lose their identity');
  assert.equal(boulderSub.tiles[`${c-6},0`]?.generatedObjectId, undefined,
    'the plateau copy must not reintroduce a removed boulder');
}
assert.equal(boulderRoot.tiles['8,2'].type, 'grass', 'unpainted exterior portion must become actual ground');
assert.equal(boulderSub.tiles['2,0'].type, 'grass', 'the unpainted plateau portion must become actual ground');
assert.equal(boulderWorkspace.objects.length, 0, 'boulder object metadata must be removed');
assert.equal(boulderWorkspace.furniture.length, 0, 'boulder-attached decoration must not survive the object');

const anonymousBoulder = makeWorkspace(); // Malformed older data without a generated ID cannot be cleared atomically.
anonymousBoulder.maps[0].tiles['7,2'].generatedObjectType = 'undiggableBoulder';
const rejectedBoulder = Placement.evaluateCandidateForTest(anonymousBoulder, cave, 4, 2, {scale:1});
assert.equal(rejectedBoulder.ok, false, 'unidentified boulders must never be partially overwritten by a locale');
assert.match(rejectedBoulder.reason, /unidentified generated undiggableBoulder/);

console.log('locale-terrain-placement tests passed');
