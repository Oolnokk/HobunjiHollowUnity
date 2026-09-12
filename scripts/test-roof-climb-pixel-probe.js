const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'roof-climb-pixel-probe.js'), 'utf8');
const player = { x: 48, y: -0.25 * 48, climbing: false, prone: false, dodging: false, onBranch: null };
const wall = { id: 'wall', vertices: [
  {x:0,y:0,z:0},{x:0,y:2,z:0},{x:2,y:2,z:0},{x:2,y:0,z:0},
]};
const meta = { walls:[wall], roofs:[{id:'roof'}], entrance:{x:1,z:0.5} };
let group = null;
let liveTarget = {
  type: 'roof', wallFaceId: 'wall', playerWallDistance: 0.25,
  wallPoint: { x: 1, y: 1, z: 0 },
  endWorldX: 1, endWorldZ: 0.5, endSurfaceY: 2.08,
};
const context = {
  console,
  window: {},
  THREE: { Raycaster: class {} },
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
  maxWallDistanceTiles: 0.42,
  getRoofClimbTarget() { return liveTarget; },
  getDebug() {
    return {
      lastBlockReason: liveTarget ? null : 'no valid structural roof climb target',
      runtimeDepsSource: 'ClimbSystem.init',
      runtimePlayerReady: true,
      climbDepsCaptured: true,
      climbHooksCurrent: true,
      surfaceRefinementHooksCurrent: true,
      surfaceRefinementDepsCaptured: true,
      surfaceOffsets: { wallTiles: 0.14, roofY: 0.08 },
      lastMovementInput: { x: 1, y: 0, source: 'ClimbSystem.getMovementInput' },
      lastMovementMovedPx: 9,
      liveMethods: {
        getClimbTarget: 'refinedStructureClimbTarget',
        startClimb: 'refinedStructureClimbStart',
        updateClimb: 'refinedStructureClimbUpdate',
      },
    };
  },
};
context.window.HobunjiClimbPrompt = {
  getDebug() {
    return {
      popupPatched: true,
      climbTargetBridgePatched: true,
      climbTargetBridgeCurrent: true,
      visible: true,
      targetType: 'roof',
      actionable: true,
      targetSource: 'ClimbSystem target',
      reason: 'actionable climb target',
    };
  },
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

let result = api.evaluateRay({ origin:{x:100,y:100,z:100}, direction:{x:1,y:0,z:0} });
assert.strictEqual(result.climbable, true, 'camera ray is irrelevant when the live contact resolver has a roof target');
assert.strictEqual(result.wallFaceId, 'wall');
assert.strictEqual(result.selectionModel, 'nearest-player-wall');
assert.strictEqual(result.playerDistance, 0.25);

group.userData.hobunjiRoofClimbStructure.entrance = {x:1,z:0.5};
result = api.evaluateRay(null);
assert.strictEqual(result.climbable, true, 'entrance adjacency remains disabled');
assert.strictEqual(group.userData.hobunjiRoofClimbStructure.entrance, null, 'legacy entrance metadata is cleared');

liveTarget = null;
player.y = -240;
result = api.evaluateRay({ origin:{x:1,y:1,z:-1}, direction:{x:0,y:0,z:1} });
assert.strictEqual(result.climbable, false, 'far player cannot climb');
assert.match(result.reason, /too far from player|no valid structural roof climb target/);
assert.match(result.reason, /0\.42|no valid structural roof climb target/);
player.y = -0.25 * 48;
liveTarget = {
  type: 'roof', wallFaceId: 'wall', playerWallDistance: 0.25,
  wallPoint: { x: 1, y: 1, z: 0 },
  endWorldX: 1, endWorldZ: 0.5, endSurfaceY: 2.08,
};

context.window.Mounts.rideState = 'mounted';
result = api.evaluateRay(null);
assert.strictEqual(result.climbable, false, 'mounted state is reported as not climbable');
assert.strictEqual(result.reason, 'player is mounted');
context.window.Mounts.rideState = 'none';

const report = api.reportLines('Pixel Probe report\nArea: town');
assert(report.some(line => line.includes('Entrance-adjacent exclusion: DISABLED')));
assert(report.some(line => line.includes('structural wall contact <= 0.42 tiles')));
assert(report.some(line => line.includes('camera ray not required')));
assert(report.some(line => line.includes('Surface refinement: hooks=current deps=captured wallOffset=0.14 roofOffsetY=0.08')));
assert(report.some(line => line.includes('Roof runtime: source=ClimbSystem.init')));
assert(report.some(line => line.includes('hooks=current')));
assert(report.some(line => line.includes('Roof live methods: get=refinedStructureClimbTarget start=refinedStructureClimbStart update=refinedStructureClimbUpdate')));
assert(report.some(line => line.includes('Climb popup/action bridge: popupPatched=yes')));
assert(report.some(line => line.includes('targetBridge=yes current=yes visible=yes target=roof actionable=yes')));
assert(report.some(line => line.includes('distance=0.250 / 0.42 tiles')));
assert(report.some(line => line.includes('Roof movement: input=(1.000,0.000) source=ClimbSystem.getMovementInput movedPx=9.00')));
console.log('roof climb pixel probe tests passed');
