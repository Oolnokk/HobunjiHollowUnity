'use strict';
// Regression: the shaft connector stamps the vestibule corridor walkable in the ordinary interior
// grid and then calls TileOccupancy.create() again, which destroys the previous model. Destroying
// the old model used to revert EVERY tile it had ever seen to its first-seen type, turning the
// corridor back into rock, so the start room had no way out to the shaft.
// Runs the real occupancy module against a small grid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class Box3 { // Only walls are measured here: a stub wall carries its own world box.
  setFromObject(object) { this.min = new V(...object.box.min); this.max = new V(...object.box.max); return this; }
  isEmpty() { return false; }
}
const THREE = { Vector3: V, Box3, Matrix4: class {} };

const registered = [];
const window = {
  THREE,
  DynamicSurfaces: {
    registerBlocker: record => registered.push(record),
    remove: () => {},
    sampleSupport: () => null,
  },
  GridTileAccessors: { getCurrentArea: () => 'map_i_dev_random_ruin' },
  WildernessMap: { renderMapPanel() {} },
  AreaFootprintBlockers: null,
};
window.window = window;
const context = vm.createContext({
  window, THREE, console,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
});
for (const name of ['dev-random-ruin-solid-footprints', 'dev-random-ruin-tile-occupancy']) {
  vm.runInContext(fs.readFileSync(`docs/js/${name}.js`, 'utf8'), context, { filename: `${name}.js` });
}
const Occupancy = window.DevRandomRuinTileOccupancy;
assert.ok(Occupancy?.create, 'occupancy module loads');

// 6x6 grid: room floor in rows 3-5, a void column (rock) above it for the future corridor.
const COLS = 6, ROWS = 6;
const grid = Array.from({ length: ROWS }, (_, row) =>
  Array.from({ length: COLS }, () => ({ type: row >= 3 ? 'grass' : 'rock' })));
const roomFloor = new Set();
for (let row = 3; row < ROWS; row++) for (let col = 0; col < COLS; col++) roomFloor.add(`${col},${row}`);

// A wall along the boundary between rows 1 and 2 (the way V50 walls sit on floor/void boundaries).
// Its sources make the first model run its grid sync, which snapshots every tile's type for destroy().
const wall = { id: 'w1', box: { min: [0, 0, 2], max: [COLS, 3, 2] }, updateWorldMatrix() {}, updateMatrixWorld() {} };

const makeConfig = floorSet => ({
  mapId: 'map_i_dev_random_ruin', scope: 'test', cols: COLS, rows: ROWS,
  floorSet, grid, solidType: 'rock',
  walls: [wall], solidRoots: [], mechanisms: new Map(), transitDoors: [], activators: [], pushBlocks: [],
  getPlayerPosition: () => ({ x: -1, z: -1 }),
});

Occupancy.create(makeConfig(roomFloor));
assert.ok(Occupancy.getSnapshot().sources['2,1'], 'fixture: the wall gives the first model sources, so it snapshots base tile types');

// The connector stamps a corridor (column 2, rows 0-2) walkable and adds it to the floor set...
const floorWithCorridor = new Set(roomFloor);
for (let row = 0; row < 3; row++) {
  grid[row][2] = { type: 'grass' };
  floorWithCorridor.add(`2,${row}`);
}
// ...then rebuilds the occupancy model, which destroys the first one.
Occupancy.create(makeConfig(floorWithCorridor));

for (let row = 0; row < 3; row++)
  assert.equal(grid[row][2].type, 'grass', `corridor tile 2,${row} must stay walkable after the occupancy model is rebuilt`);
assert.equal(grid[0][0].type, 'rock', 'void tiles stay solid');

console.log('dev random ruin occupancy re-stamp regression passed');

// Drive the production push and collision code with a block in the room.
const player = {x:1.84*64, y:4.5*64, inputX:1, inputY:0, inputStrength:1}; // At the west face, with ordinary movement input held.
const block = {
  id:'test-slide', userData:{previewMotion:{type:'pushPuzzleBlock'},pushBlockSize:.49}, position:{x:1.25,y:0,z:2.25},
  get box() {
    const {x,y,z} = this.position;
    return {min:[2*x-.49,y,2*z-.49],max:[2*x+.49,y+1,2*z+.49]};
  },
};
const model = Occupancy.create({...makeConfig(roomFloor),pushBlocks:[block]});
const ruin = {occupancy:model,supportY:0,blockPushers:[{block,localStep:.5}]};
const surfaces = window.DynamicSurfaces;
surfaces.sampleSupport = (x,z) => x>=0 && x<6 && z>=3 && z<6 ? {y:0} : null;
surfaces.blockerAt = (x,z,opts) => model.blocksAt(x,z,opts.radius,opts) || (z>4.8 && z<5.1);
surfaces.addBeforeRenderClient = () => {};
window.DevSpawner = {init() {}};
window.DevRandomRuinSolvability = {};
context.performance = {now:()=>0};
context.testFixture = {ruin,player};
const interiorSource = fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
vm.runInContext(interiorSource.replace(/\}\)\(\);\s*$/, `
  ruin=testFixture.ruin;
  deps={player:testFixture.player,TILE:64};
  testFixture.tick=updateMechanisms;
  testFixture.manualPush=()=>pushBlock(ruin.blockPushers[0],getPushFace(ruin.blockPushers[0],.36),true);
})();`), context);
const {tick,manualPush} = context.testFixture;
const plate = {
  position:{x:2.25,y:0,z:2.25},
  userData:{previewMotion:{type:'pressurePlate'},linkedWeightBlock:block,pressPlate:{position:{y:.105}}},
  traverse(visit) { visit(this); },
}; // The destination uses the actual V50 pressure signal.
const gate = {root:{userData:{linkedPressurePlateRoot:plate}},progress:0,target:0};
const generator = fs.readFileSync('docs/tools/debris-ifier/debrisifier-v50-api.js','utf8');
const syncPlates = generator.slice(generator.indexOf('  function syncPressurePlates('),generator.indexOf('  function rotateLinkedCube('));
ruin.api = {syncPressurePlates:vm.runInContext(`(() => {
  const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
  ${syncPlates}
  return syncPressurePlates;
})()`,context),tickRuntime(){},applyProgress(){}};
ruin.pressurePlateRoots=ruin.mechanismSignalRoots=[plate];
ruin.mechanisms=new Map([['gate',gate]]);
ruin.activators=[];

assert.equal(grid[4][2].type,'grass','walking collision uses the visible block, not a whole rock tile');
assert(model.blocksAt(2.5,4.5),'the block itself is solid');
assert(!model.blocksAt(2.5,4.5,0,{ignoreRuinSource:block.userData.__devRuinOccupancySource}),'the push sweep ignores its own block');
assert(!model.blocksAt(2.5,4.5,0,{worldY:2}),'a projectile can clear the top');
tick(.07);
assert(!ruin.blockSlide,'brief face contact does not move the block');
tick(.07);
assert(ruin.blockSlide,'sustained face contact starts a push');
tick(.12);
assert.equal(block.position.x,1.5,'the stone passes through a real intermediate pose');
assert(model.blocksAt(3.4,4.5),'collision has already moved with the leading edge');
assert(!model.blocksAt(2.4,4.5),'the trailing edge is immediately walkable');
player.inputX=0;
tick(.12);
assert.equal(block.position.x,1.75,'releasing input lets the current push settle exactly one tile away');
assert(!ruin.blockSlide);
tick(.24);
assert.equal(block.position.x,1.75,'released input cannot start a second push');

player.x=3.0*64; player.y=4.0*64; player.inputX=1; player.inputY=1;
tick(.2);
assert(!ruin.blockSlide,'a diagonal bump at the corner does not move the block');
player.x=3.5*64; player.y=3.84*64; player.inputX=0;
assert.equal(manualPush(),false,'a thin blocker partway to the next stop rejects the whole push');
assert.equal(block.position.z,2.25);
player.x=2.84*64; player.y=4.5*64; player.inputY=0;
assert(manualPush(),'Interact works as a one-step alternative');
assert(gate.progress<1,'the block has not yet fully depressed the target plate');
tick(.24);
assert.equal(block.position.x,2.25,'the prompted push uses the same slide and grid distance');
assert.equal(gate.progress,1,'the real pressure-plate overlap fully opens the gate at the final stop');
console.log('stone block contact, smooth motion, exact collision, and swept blockers passed');
