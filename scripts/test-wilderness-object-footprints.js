const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const policy = require('../docs/js/wilderness-object-footprints.js');

const grass = () => ({ terrain: 'grass', type: 'grass' }); // Unoccupied tile factory for footprint and site-selection fixtures.
const zone = { cols: 4, rows: 3, tiles: Array.from({ length: 3 }, () => Array.from({ length: 4 }, grass)) }; // Touching yet independently identified formations.
for (const [col, row, id] of [[0,0,'A'],[1,0,'A'],[1,1,'A'],[2,0,'B']]) {
  Object.assign(zone.tiles[row][col], { type: 'rock', rockKind: 'undiggableBoulder', boulderId: id });
}
assert.equal(policy.isBoulder(zone.tiles[0][0]), true);
assert.equal(policy.isBoulder(grass()), false);
assert.deepEqual(policy.boulderCells(zone, 0, 0).sort((a,b) => a[1]-b[1] || a[0]-b[0]),
  [[0,0],[1,0],[1,1]], 'a whole connected boulder belongs to one identity, even beside another boulder');
assert.deepEqual(policy.boulderCells(zone, 2, 0), [[2,0]], 'neighboring object IDs remain separate');
assert.deepEqual(policy.boulderCells(zone, 3, 2), [], 'ordinary ground has no boulder footprint');

const maps = [
  { tiles: { '0,0': { type:'rock', generatedObjectId:'A', generatedObjectType:'undiggableBoulder' },
    '1,0': { type:'rock', generatedObjectId:'A', generatedObjectType:'undiggableBoulder' },
    '2,0': { type:'rock', generatedObjectId:'B', generatedObjectType:'undiggableBoulder' } } },
  { tiles: { '1,0': { type:'rock', generatedObjectId:'A', generatedObjectType:'undiggableBoulder', plateau:'p1' } } }
]; // Root plus a plateau submap which overlays the same generated rock.
const workspace = { maps, objects:[{id:'A'},{id:'B'}], furniture:[{generatedObjectId:'A'},{generatedObjectId:'B'}] };
const cleared = policy.clearExportedObjects(workspace, new Set(['A']));
assert.deepEqual(cleared, {objects:1, tiles:3}, 'all copies of the targeted boulder are cleared in one pass');
assert.equal(maps[0].tiles['1,0'].type, 'grass');
assert.equal(maps[0].tiles['1,0'].generatedObjectId, undefined);
assert.equal(maps[1].tiles['1,0'].type, 'grass');
assert.equal(maps[1].tiles['1,0'].plateau, 'p1', 'the underlying terrain ownership must survive');
assert.equal(maps[0].tiles['2,0'].generatedObjectId, 'B', 'unrelated rocks must remain intact');
assert.deepEqual(workspace.objects, [{id:'B'}]);
assert.deepEqual(workspace.furniture, [{generatedObjectId:'B'}]);

// Execute the actual browser temporary-locale module against a source grid
// whose visual boulder was exported without an occupiedBy object proxy.
const browser = { WildernessObjectFootprints: policy }; // Injected window namespace matches the production loader.
browser.window = browser;
vm.runInNewContext(fs.readFileSync('docs/js/temporary-locales.js', 'utf8'), browser, { filename:'temporary-locales.js' });
const ghostZone = { cols:4, rows:4, tiles: Array.from({length:4}, () => Array.from({length:4}, () => ({
  terrain:'rock', rockKind:'undiggableBoulder', boulderId:'ghost', height:0
}))), objects:[] }; // A wholly unregistered formation cannot be snapshotted and therefore must block stamping.
const locale = { id:'one-cell-camp', tiles:{'0,0':{type:'grass'}}, placement:{clearanceTiles:0,requiresFlatGround:false} };
assert.equal(browser.TemporaryLocales.findSite(ghostZone, locale, {rng:()=>0}), null,
  'an unregistered solid formation must not allow a locale to occupy it');
ghostZone.tiles[3][3] = grass();
const recovered = browser.TemporaryLocales.findSite(ghostZone, locale, {rng:()=>0});
assert.equal(recovered?.x, 3);
assert.equal(recovered?.y, 3);
assert.equal(policy.reserveScenery(ghostZone,[{point:{col:3,row:3}}]),4,
  'a corner landmark reserves every in-bounds tile of its local overhang without scanning the map');
assert.equal(policy.isSceneryReserved(ghostZone,3,3),true);
assert.equal(browser.TemporaryLocales.findSite(ghostZone, locale, {rng:()=>0}),null,
  'a camp generated after a stone cannot stamp over its reserved physical footprint');
policy.reserveScenery(ghostZone,[]);
assert.equal(policy.isSceneryReserved(ghostZone,3,3),false,
  'a regenerated zone may update its previous scenery reservations in place');
assert.equal(browser.TemporaryLocales.findSite(ghostZone, locale, {rng:()=>0})?.x,3);


const bigLocale = {
  x: 18, y: 17,
  footprint: { x: 7, y: 8, w: 35, h: 24 }, // Irregular locale anchor is nowhere near the edge of its painted footprint.
  objects: [{x:45,y:11,w:4,h:3}]
}; // Authored floor and protruding furniture are both protected from unrelated stone generation.
assert.equal(policy.localeBlocksSite(bigLocale, 9, 29), true, 'large locale floors cannot receive boulders even far from their anchor');
assert.equal(policy.localeBlocksSite(bigLocale, 46, 12), true, 'outlying locale furniture remains free of unmineable stones');
assert.equal(policy.localeBlocksSite(bigLocale, 1, 1), false, 'distant wilderness remains available for scenery');
assert.equal(policy.localeBlocksSite({x:12,y:13}, 12, 13), true, 'pre-metadata locales keep a safe anchor radius');

const sceneryBrowser = {}; // VM browser isolates the renderer's globals from other headless test files.
const rendererProps = new Map(); // Captures registered stone colliders through the real AreaFootprintBlockers-compatible API.
class TestGroup {
  constructor(){this.children=[];this.userData={};this.parent=null;}
  add(child){this.children.push(child);child.parent=this;}
  remove(child){this.children=this.children.filter(entry=>entry!==child);child.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)fn(child);}
}
class TestMesh {
  constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={};
    this.children=[];this.position={set(){}};this.rotation={y:0};}
}
sceneryBrowser.WildernessObjectFootprints = policy;
sceneryBrowser.THREE = { Group:TestGroup, Mesh:TestMesh, InstancedMesh:class {} };
sceneryBrowser.OreRockTextures = {smallStoneArt:()=>({geometry:{},material:{}})};
sceneryBrowser.AreaFootprintBlockers = {register(id,provider){rendererProps.set(id,provider);return()=>rendererProps.delete(id);}};
const activeScene = new TestGroup(); // Fake scene only needs the real module's add/remove and parent semantics.
sceneryBrowser.GridTileAccessors = {getActiveScene:()=>activeScene};
vm.runInNewContext(fs.readFileSync('docs/js/wilderness-landmark-scenery.js','utf8'),
  {window:sceneryBrowser,globalThis:sceneryBrowser},{filename:'wilderness-landmark-scenery.js'});
const tinyTiles = Array.from({length:7},()=>Array.from({length:7},()=>({type:'grass',elevTier:0}))); // Four-square buffer excludes additional random cairns.
const tinyLayout = {cols:7,rows:7,tiles:tinyTiles,localeInstances:[{
  localeId:'locale_five_blossoms_test',x:2,y:2,
  footprint:{x:1,y:1,w:5,h:5},
  blossomStartLandmark:{col:3,row:3,replacedTree:true}
}]}; // A planted story boulder provides deterministic rendered-stone collision without needing WebGL.
const temporaryOccupiedTiles = Array.from({length:32},()=>Array.from({length:32},()=>({type:'grass',elevTier:0}))); // A bandit camp already stamped before scenery plans its stone sites.
for(let row=12;row<=16;row++) for(let col=12;col<=16;col++) temporaryOccupiedTiles[row][col].occupiedBy='bandit_tent';
const occupiedLayout = {cols:32,rows:32,tiles:temporaryOccupiedTiles,localeInstances:[]};
const independentSites = sceneryBrowser.WildernessLandmarkScenery.planForLayout('map_western_slope',occupiedLayout,'temporary-first');
assert(independentSites.length>0,'the wilderness retains ordinary scenery outside stamped temporary locales');
assert(independentSites.every(site=>Math.abs(site.point.col-14)>3 || Math.abs(site.point.row-14)>3),
  'new permanent scenery must stay away from an existing temporary locale footprint');
assert(independentSites.every(site=>policy.isSceneryReserved(occupiedLayout,site.point.col,site.point.row)),
  'the exact planned sites are shared with any temporary locales that arrive later');

const deps = {_zoneLayouts:new Map([['map_northern_cliffs',tinyLayout]]),getCurrentArea:()=> 'map_northern_cliffs',
  tothalWorldId:()=> 'world', currentTothalYear:()=> 12,TILE:64};
const scenery=sceneryBrowser.WildernessLandmarkScenery;
scenery.init(deps);
scenery.update();
const collider=rendererProps.get('wilderness-landmark-stones'); // The real scene update must register its site's physical obstacle.
assert(collider,'visible landmark stones must be registered with the common collision service');
assert.equal(collider.area,'map_northern_cliffs');
assert.equal(collider.blocksBox(3.5,3.5,.1,null),true,'the previously non-colliding boulder must block the player');
assert.equal(collider.blocksBox(3.5,3.5,.1,10),false,'a projectile passing above the boulder remains clear');
assert.equal(collider.blocksBox(6.5,6.5,.1,null),false,'unrelated floor remains walkable');
assert.equal(scenery.debugSnapshot().stoneCollision.siteCount,1,'mobile diagnostics expose the physical stone count');
scenery.clear();
assert.equal(rendererProps.size,0,'changing zone or shift unregisters stale physical stones');

console.log('wilderness generated-object footprint and collision-preservation tests passed');
