'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs'); // Loads the shipped input owners for executable controller and dungeon-interaction tests.
const vm = require('node:vm'); // Executes the real browser modules with a minimal fake scene instead of asserting source snippets.

const read = path => fs.readFileSync(path, 'utf8'); // Shared source reader for the two browser runtime fixtures.

let area = 'wilderness'; // Mutable area shared by the binding fixture to verify live ruin entry/exit.
const bindings = { // Live user bindings: controller A is dual-purpose unless the player binds Jump separately.
  controller: { interact: 'Button0', jump: null, action1: 'RightTrigger', action2: 'LeftTrigger' },
  desktop: { interact: 'KeyE', jump: 'Space', action1: 'Mouse0' },
};
const bindingWindow = {
  GridTileAccessors: { getCurrentArea: () => area },
};
vm.runInNewContext(read('docs/js/input-bindings.js'), { window: bindingWindow });
bindingWindow.InputBindings.init({
  getInputBindings: () => bindings,
  INPUT_DEFAULTS: { storageKey: 'dungeon-jump-test', actions: [], controller: {}, desktop: {}, modeShifts: [] },
});
const resolve = (device, button, shift) => bindingWindow.InputBindings.resolveActionForButton(device, button, shift);
assert.equal(resolve('controller', 'Button0'), 'interact', 'controller A retains Interact outside dungeons');
area = 'map_i_dev_random_ruin';
assert.equal(resolve('controller', 'Button0'), 'jump', 'controller A jumps inside a dungeon even when Interact would be available');
assert.equal(resolve('controller', 'RightTrigger'), 'action1', 'dungeon object controls retain their separate Action 1 input');
assert.equal(resolve('controller', 'LeftTrigger'), 'action2', 'secondary dungeon object controls remain available');
assert.equal(resolve('desktop', 'Space'), 'jump', 'keyboard Jump continues to function inside dungeons');
assert.equal(resolve('desktop', 'KeyE'), 'interact', 'keyboard Interact remains independent of Jump inside dungeons');
assert.equal(resolve('controller', 'Button0', { bindings: { Button0: 'action3' } }), 'action3',
  'a held custom controller mode shift retains priority over the fallback');
bindings.controller.jump = 'Button3';
assert.equal(resolve('controller', 'Button0'), 'interact', 'a separately bound controller Jump leaves Interact on A');
assert.equal(resolve('controller', 'Button3'), 'jump', 'the separate Jump binding works beside dungeon objects');
bindings.controller.jump = 'Button0';
assert.equal(resolve('controller', 'Button0'), 'jump', 'an imported shared Jump/Interact binding still jumps inside dungeons');
bindings.controller.jump = null;
area = 'wilderness';
assert.equal(resolve('controller', 'Button0'), 'interact', 'leaving a dungeon restores A interaction');

// Build a single elevator-block scene to ensure the old direct controller-button
// polling cannot push it, while the normal dungeon action provider still can.
let frame = null; // Registered before-render callback from the real motion module, invoked by this test.
let motionArea = 'map_i_dev_random_ruin'; // Area shared by the fake dungeon's discovered root and interaction callback.
const block = {
  id: 23,
  name: 'test-elevator-block',
  userData: { previewMotion: { type: 'elevatorPushBlock' } },
  position: { x: .7, y: 0, z: 0 },
  updateMatrixWorld() {},
  updateWorldMatrix() {},
};
const root = {
  name: 'dev_v50_ruin_test',
  scale: { x: 1, y: 1, z: 1 },
  traverse(callback) { callback(this); callback(block); },
};
const scene = { children: [root] };
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Box3 {
  setFromObject(object) {
    const p = object.position;
    this.min = { x: p.x - .15, y: p.y - .15, z: p.z - .15 };
    this.max = { x: p.x + .15, y: p.y + .15, z: p.z + .15 };
    return this;
  }
  isEmpty() { return false; }
  getCenter(vector) {
    return vector.set((this.min.x + this.max.x) / 2,
      (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2);
  }
}
const runtimeWindow = {
  DynamicSurfaces: {
    sampleSupport: () => ({ y: 0 }),
    blockerAt: () => null,
    addBeforeRenderClient(callback) { frame = callback; },
  },
  DevSpawner: { init() {} },
  DevRandomRuin: { setDebugBadgePart() {}, isSlidingPushBlock: () => true },
  ControllerInput: { frame: () => ({ isDown: () => true }) }, // Pressed controller A must never be polled as a push.
};
const motionListeners = {}; // Capture the legacy keyboard path to verify it cannot bypass the shared focus owner.
const runtimeDocument = { addEventListener(type,callback) { motionListeners[type]=callback; }, getElementById: () => null };
runtimeWindow.InputBindings={getCurrentBindings:()=>bindings};
let aimedBlock=null, focusedInvocations=0;
runtimeWindow.DevRandomRuinInteractions={invokeFocusedControl(kind,owner){
  focusedInvocations++;
  if(kind!=='elevatorpushblock'||owner!==aimedBlock)return false;
  const control=runtimeWindow.DevRandomRuinMotionRuntime.getInteractionControls().find(c=>c.object===owner);
  if(!control)return false;
  control.onPress();return true;
}};
vm.runInNewContext(read('docs/js/dev-random-ruin-motion-runtime.js'), {
  window: runtimeWindow,
  document: runtimeDocument,
  THREE: { Box3, Vector3 },
  setTimeout(callback) { callback(); return 1; },
});
runtimeWindow.DevSpawner.init({
  getCurrentArea: () => motionArea,
  getActiveScene: () => scene,
  player: { x: 0, y: 0 },
  TILE: 1,
  playerMesh: { position: { y: 0 } },
});
runtimeWindow.DevRandomRuinMotionRuntime.rebuild();
assert.equal(typeof frame, 'function', 'dungeon motion runtime registers its original before-render callback');
frame();
assert.equal(block.position.x, .7, 'pressing controller A does not directly push the nearby block');
const controls = runtimeWindow.DevRandomRuinMotionRuntime.getInteractionControls();
assert.equal(controls.length, 1, 'the nearby block is published to the normal dungeon interaction provider');
assert.equal(controls[0].claimAction1, true, 'pushing the block uses the separate Action 1 control');
assert.equal(controls[0].kind, 'elevatorPushBlock', 'published action identifies its world-object type');
let keyConsumed=0;
const event={code:'KeyE',preventDefault(){keyConsumed++;},stopImmediatePropagation(){keyConsumed++;}};
motionListeners.keydown(event);
assert.equal(focusedInvocations,1,'legacy keyboard Interact asks the shared live focus resolver');
assert.equal(keyConsumed,0,'off-reticle Interact is not intercepted');
assert.equal(block.position.x,.7,'keyboard Interact must not push an off-reticle block');
aimedBlock=block;motionListeners.keydown(event);
assert.equal(keyConsumed,2,'aimed Interact consumes the key exactly once');
assert.ok(block.position.x > .7, 'the action moved the block');
motionArea = 'wilderness';
assert.equal(controls[0].onPress(), false, 'a stale dungeon action cannot push the block after leaving');
frame();
assert.equal(runtimeWindow.DevRandomRuinMotionRuntime.getInteractionControls().length, 0,
  'exiting the ruin clears its block interaction');

// Exercise the actual ClimbSystem action owner, rather than only the input bindings:
// a nearby authored ledge or climb wall must never replace the dungeon jump.
let climbArea = 'map_i_dev_random_ruin'; // Mutable map for proving physical ruin Jump and legacy non-ruin climbing have separate priorities.
let climbMove = { x: 1, y: 0 }; // Forward intent in the test player's facing direction, used by Dodge-driven authored climbing.
let fighting = false; // Combat state used to keep emergency Dodge available around dungeon walls.
let freeJumps = 0; // Count ordinary physical launches, even when a ruin ledge offers a climb.
let worldClimbs = 0; // Count authored climb callbacks that formerly stole the dungeon Jump.
const climbPlayer = { angle: 0, climbing: false, dodging: false };
const climbWindow = {
  PlayerJump: { init() {}, start() { freeJumps++; return true; } },
  GameplayInputRouter: { isInCombat: () => fighting },
};
vm.runInNewContext(read('docs/js/climb-system.js'), {
  window: climbWindow,
  performance: { now: () => 100 },
});
climbWindow.ClimbSystem.init({
  player: climbPlayer,
  getCurrentArea: () => climbArea,
  _isZoneArea: () => false,
  getMovementInput: () => climbMove,
  getMountRideState: () => 'none',
});
climbWindow.ClimbSystem.registerWorldClimbProvider(() => ({
  kind: 'ruinLedge',
  start() { worldClimbs++; return true; },
}));
assert.equal(climbWindow.ClimbSystem.jumpAction(), true, 'Jump starts successfully beside an offered dungeon climb');
assert.equal(freeJumps, 1, 'physical Jump takes priority over offered dungeon climb targets');
assert.equal(worldClimbs, 0, 'dungeon Jump cannot activate climbable scenery');
assert.equal(climbWindow.ClimbSystem.cliffDodge(), true, 'forward Dodge still climbs authored ruin ledges');
assert.equal(worldClimbs, 1, 'the separate traversal input triggers the authored climb once');
climbMove = { x: -1, y: 0 };
assert.equal(climbWindow.ClimbSystem.cliffDodge(), false, 'backward Dodge does not activate an authored climb');
assert.equal(worldClimbs, 1, 'backward evasive motion leaves the ledge untouched');
climbMove = { x: 1, y: 0 };
fighting = true;
assert.equal(climbWindow.ClimbSystem.cliffDodge(), false, 'combat Dodge is not stolen by an authored climb');
assert.equal(worldClimbs, 1, 'combat does not activate scenery');
fighting = false;
climbArea = 'wilderness';
assert.equal(climbWindow.ClimbSystem.jumpAction(), true, 'outside ruins, existing world-climb targets retain Jump handling');
assert.equal(worldClimbs, 2, 'dungeon-specific jump independence does not rewrite exterior traversal');
assert.equal(freeJumps, 1, 'exterior climb still owns the original world-climb press');

console.log('Dungeon Jump is independent of all dungeon world-object controls, including climb targets.');
