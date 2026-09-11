const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'roof-climb-pixel-probe.js'), 'utf8');
const player = { x: 48, y: -48, climbing: false, prone: false, dodging: false, onBranch: null };
const wall = { id: 'wall', vertices: [
  {x:0,y:0,z:0},{x:0,y:2,z:0},{x:2,y:2,z:0},{x:2,y:0,z:0},
]};
const meta = { walls:[wall], roofs:[{id:'roof'}], entrance:{x:1,z:0.5} };
let group = null;
const context = {
  console,
  window: {},
  THREE: {
    Raycaster: class { setFromCamera() { this.ray = { origin:{x:1,y:1,z:-5}, direction:{x:0,y:0,z:1} }; } },
  },
  MutationObserver: class { observe() {} },
  document: {
    readyState: 'complete',
    getElementById() { return null; },
    addEventListener() {},
  },
};
context.window.window = context.window;
context.window.GridTileAccessors = { getActiveScene: () => ({ traverse(fn) { if (group) fn(group); } }) };
context.window.HobunjiRoofClimb = {
  roofSurfaceYAt(_meta, x, z) { return x >= 0 && x <= 2 && z >= 0 && z <= 2 ? 2 : null; },
};
context.window.HousePieceGen = {
  buildGroupFromPiece() { return { userData: { hobunjiRoofClimbStructure: { ...meta } } }; },
};
context.window.Mounts = { rideState: 'none' };
vm.createContext(context);
vm.runInContext(code, context);

group = context.window.HousePieceGen.buildGroupFromPiece();
assert.strictEqual(group.userData.hobunjiRoofClimbStructure.entrance, null, 'new buildings clear entrance exclusion metadata');
context.window.PixelProbe = { init() {} };
context.window.PixelProbe.init({ player, TILE: 48, renderer: {domElement:{}}, camera:{} });
const api = context.window.HobunjiRoofClimbProbe;
let result = api.evaluateRay({ origin:{x:1,y:1,z:-5}, direction:{x:0,y:0,z:1} });
assert.strictEqual(result.climbable, true, 'near direct structural wall with roof is climbable');
assert.strictEqual(result.wallFaceId, 'wall');

group.userData.hobunjiRoofClimbStructure.entrance = {x:1,z:0.5};
result = api.evaluateRay({ origin:{x:1,y:1,z:-5}, direction:{x:0,y:0,z:1} });
assert.strictEqual(result.climbable, true, 'entrance adjacency remains disabled even on legacy metadata');
assert.strictEqual(group.userData.hobunjiRoofClimbStructure.entrance, null, 'legacy entrance metadata is cleared');

player.y = -240;
result = api.evaluateRay({ origin:{x:1,y:1,z:-5}, direction:{x:0,y:0,z:1} });
assert.strictEqual(result.climbable, false, 'far player cannot climb');
player.y = -48;

result = api.evaluateRay({ origin:{x:1,y:1,z:-5}, direction:{x:0.9,y:0,z:0.1} });
assert.strictEqual(result.climbable, false, 'glancing probe is rejected');

context.window.Mounts.rideState = 'mounted';
result = api.evaluateRay({ origin:{x:1,y:1,z:-5}, direction:{x:0,y:0,z:1} });
assert.strictEqual(result.climbable, false, 'mounted state is reported as not climbable');
assert.strictEqual(result.reason, 'player is mounted');

const report = api.reportLines('Pixel Probe report\nArea: town   CSS(100,100) framebuffer(100,100)');
assert(report.some(line => line.includes('Entrance-adjacent exclusion: DISABLED')));
console.log('roof climb pixel probe tests passed');
