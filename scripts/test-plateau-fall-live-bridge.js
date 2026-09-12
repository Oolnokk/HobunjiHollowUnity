const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'plateau-fall-live-bridge.js'), 'utf8');
let nextFrame = null;
let fallOptions = null;
const player = {
  x: 48, y: 32,
  inputX: 0, inputY: 0, // Deliberately stale: the live bug this bridge fixes.
  vx: 0, vy: 0,
  climbing: false, onBranch: null, prone: false, dodging: false, lunging: false,
};
const grid = [[
  { type: 'grass', elevTier: 2 },
  { type: 'incline', incline: true, elevTier: 2 },
  { type: 'incline', incline: true, elevTier: 1 },
  { type: 'grass', elevTier: 0 },
]];

const context = {
  console,
  Date,
  MutationObserver: class { observe() {} },
  document: {
    readyState: 'complete',
    getElementById() { return null; },
    addEventListener() {},
  },
  window: {
    PlayerChat: { isOpen: false },
    Mounts: { rideState: 'none' },
    requestAnimationFrame(fn) { nextFrame = fn; return 1; },
    GridTileAccessors: { getActiveGrid: () => grid },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(code, context);

// Simulate climb-system.js assigning its API after this parser-time bridge loaded.
context.window.ClimbSystem = {
  init(deps) { this.receivedDeps = deps; },
};
const climbDeps = {
  player,
  TILE: 64,
  getActiveGrid: () => grid,
  getMovementInput: () => ({ x: 1, y: 0 }), // Fresh held input; player.inputX/Y remain zero.
  isSolid: () => false,
  canPlayerOccupy: () => true,
};
context.window.ClimbSystem.init(climbDeps);
assert.strictEqual(context.window.HobunjiPlateauFallLive.getDebug().climbDepsCaptured, true, 'ClimbSystem init dependencies were captured');

context.window.HobunjiPlateauFalls = {
  beginFall(options) { fallOptions = options; player.climbing = true; return true; },
};
assert(nextFrame, 'live watcher was scheduled');
nextFrame();
assert(fallOptions, 'fresh movement input triggers plateau walkoff even when player.inputX/Y are stale');
assert.strictEqual(fallOptions.endX, 224);
assert.strictEqual(fallOptions.endY, 32);
assert.strictEqual(fallOptions.tierDrop, 2);
assert.strictEqual(fallOptions.rolling, true);
assert.strictEqual(fallOptions.source, 'accidental plateau edge (fresh input)');
let debug = context.window.HobunjiPlateauFallLive.getDebug();
assert.strictEqual(debug.inputSource, 'getMovementInput');
assert.strictEqual(debug.started, true);
assert.strictEqual(debug.reason, 'fall started');

// A player not holding toward the cliff should remain put.
player.climbing = false;
fallOptions = null;
climbDeps.getMovementInput = () => ({ x: 0, y: 0 });
player.inputX = player.inputY = player.vx = player.vy = 0;
context.window.HobunjiPlateauFallLive.probe();
assert.strictEqual(fallOptions, null, 'no movement intent does not trigger a fall');
debug = context.window.HobunjiPlateauFallLive.getDebug();
assert.strictEqual(debug.reason, 'no fresh movement intent');

// Equal/higher far-side terrain is not an accidental downhill crossing.
climbDeps.getMovementInput = () => ({ x: 1, y: 0 });
grid[0][3].elevTier = 2;
context.window.HobunjiPlateauFallLive.probe();
assert.strictEqual(fallOptions, null, 'equal-height far side does not trigger a fall');
assert.strictEqual(context.window.HobunjiPlateauFallLive.getDebug().reason, 'far side is not lower');

grid[0][3].elevTier = 0;
console.log('plateau live fall tests passed');