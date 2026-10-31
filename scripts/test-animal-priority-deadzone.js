'use strict';

const assert = require('node:assert/strict'); // Behavior assertions for the shared live facing paths.
const fs = require('node:fs'); // Loads actual runtime code rather than mirroring the implementation.
const vm = require('node:vm'); // Runs browser modules with deterministic time and camera bearings.
let clockMs = 0; // Advances across many legacy flip periods and expires gaze hints.
const context = { Math, performance: { now: () => clockMs }, THREE: { MathUtils: { degToRad: d => d * Math.PI / 180 } } }; // Browser stand-in used by all facing tests.
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('docs/js/perp-rotation.js', 'utf8'), context);
const api = context.PerpRotation; // Real shared NPC/animal priority owner.
function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
api.init({ angleDiff });
assert.equal(api.CREATURE_PLANE_ROT_MODE, 'halt', 'animals default to priority selection rather than rhythmic alternation');
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Extracts only the rendering step to avoid unrelated world startup.
const renderStart = gameSource.indexOf('        c.pngRot ??= c.groupRot;'); // Start of the live creature plane-facing block.
const renderEnd = gameSource.indexOf('        const planeDelta =', renderStart); // End before material/rig rendering dependencies.
assert.ok(renderStart >= 0 && renderEnd > renderStart);
const render = new Function('window', 'c', 'grp', 'rawTargetRotY', 'cameraRelativeCreaturePerps', 'dt', 'angleDiff', 'kickPoseHeld', 'const headtakerOwnsFacing = false;\n' + gameSource.slice(renderStart, renderEnd)); // This fixture tests animals outside the scoped Headtaker grapple.
function step(c, raw = 0, travel = true) {
  if (travel && Number.isFinite(c.x) && Number.isFinite(c.y)) { c.x += (c.vx || 0) / 60; c.y += (c.vy || 0) / 60; }
  clockMs += 1000 / 60;
  render(context, c, { userData: {} }, raw, () => [0, Math.PI], 1 / 60, angleDiff, false); // This fixture tests ordinary animals; a kicking animal opts into the separate frozen-pose renderer test.
}
for (const role of ['wild', 'mount', 'companion']) {
  const c = { x: 0, y: 0, stableRole: role, def: {}, perpState: {}, groupRot: 0, vx: 80, vy: 100 }; // Fresh state follows the runtime creature constructor contract.
  step(c); // Establish the first actual-position sample.
  for (let frame = 0; frame < 600; frame++) {
    step(c);
    assert.equal(c.perpState.pixelProbeDebug.selectedSide, 1, `${role}: ten seconds of travel never alternates sides`);
    assert.equal(c.perpState.pixelProbeDebug.correctiveSource, 'movement');
  }
  api.setHeadtrackHint(c.perpState, -0.4);
  step(c);
  assert.equal(c.perpState.pixelProbeDebug.selectedSide, 1, 'movement outranks active gaze');
  step(c, 0, false); // Requested velocity stays nonzero, as it can when wildlife stops or hits a wall.
  assert.equal(c.perpState.movementYaw, null, 'stale requested velocity cannot override active gaze');
  c.vx = c.vy = 0;
  step(c);
  assert.equal(c.perpState.pixelProbeDebug.correctiveSource, 'headtrack');
  assert.equal(c.pngRot, -api.CREATURE_PERP_DEAD_RAD, 'a priority side change hard-snaps without interpolating through edge-on');
  clockMs += 300;
  step(c);
  assert.equal(c.perpState.pixelProbeDebug.correctiveSource, 'lastMovement', 'expired gaze yields to remembered travel');
  assert.equal(c.pngRot, api.CREATURE_PERP_DEAD_RAD);
  c.vx = -80; c.vy = 100;
  step(c);
  assert.equal(c.pngRot, -api.CREATURE_PERP_DEAD_RAD, 'reversed travel immediately chooses the opposite edge');
  step(c, Math.PI / 2);
  assert.equal(c.perpState.pixelProbeDebug.effectiveTargetRotY, Math.PI / 2, 'outside the deadzone the logical facing is unchanged');
}
const sliding = { x: 0, y: 0, def: {}, perpState: {}, groupRot: 0, vx: 80, vy: 100 }; // Intended travel differs from actual motion along a blocking wall.
step(sliding, 0, false);
sliding.x = -1;
step(sliding, 0, false);
assert.equal(sliding.perpState.pixelProbeDebug.correctiveSource, 'movement');
assert.equal(sliding.perpState.pixelProbeDebug.selectedSide, -1, 'collision slides use the achieved direction rather than requested velocity');
for (let frame = 0; frame < 180; frame++) step(sliding, 0, false);
assert.equal(sliding.perpState.pixelProbeDebug.correctiveSource, 'lastMovement', 'blocked animals retain their last achieved travel as a lower priority');
assert.equal(sliding.perpState.pixelProbeDebug.selectedSide, -1);

const animal = { x: 0, y: 0, perpState: {}, avatarRef: { group: { position: { x: 0, z: 0 } } }, vx: 0, vy: 0, def: {}, groupRot: 0 }; // Idle wildlife with no movement history tests player fallback.
context.Combat = { deps: { hostileObjects: [animal] } };
api.init({ playerWorldPosition: () => ({ x: -2, z: 3 }) });
step(animal);
assert.equal(animal.perpState.pixelProbeDebug.correctiveSource, 'player');
assert.equal(animal.perpState.pixelProbeDebug.selectedSide, -1);
context.Combat.deps.hostileObjects = [];

// Execute the named animal NPC method, which uses a separate rendering path.
const walkerStart = gameSource.indexOf('          applyFacingDeadzone(rawRot ='); // Method boundary in the real schedule walker object.
const walkerEnd = gameSource.indexOf('          resetRouteState()', walkerStart); // Following method boundary avoids recreating unrelated NPC routing.
const makeWalker = new Function('window', 'root', 'angleDiff', 'cameraRelativeCreaturePerps', `return ({${gameSource.slice(walkerStart, walkerEnd)}});`); // Compiles the actual method as an object member.
const walker = makeWalker(context, { rotation: { y: 0 } }, angleDiff, () => [0, Math.PI]); // Minimal named-animal rig used below.
Object.assign(walker, { animalDef: {}, animalAvatarRef: { frontPlane: { rotation: {} }, backPlane: { rotation: {} } }, perpState: {}, rot: 0, _lastUpdateDt: 1 / 60, _reportDeadzoneMovementHint() { api.setMovementHint(this.perpState, -0.4); } });
for (let frame = 0; frame < 300; frame++) {
  walker.applyFacingDeadzone(0);
  assert.equal(walker.perpState.pixelProbeDebug.selectedSide, -1, 'named animal NPCs use the same priority mode');
}

const gazeStart = gameSource.indexOf('      function _setLookAtDebug('); // Head-look entry shared by combat targets, idle scans and player-facing companions.
const gazeEnd = gameSource.indexOf('      function _updateCreatureLookAtFace(', gazeStart); // Following function bounds the actual gaze reporter.
const reportGaze = new Function('window', 'TILE', '_creatureHeadWorldY', `${gameSource.slice(gazeStart, gazeEnd)}; return _setLookAtDebug;`)(context, 32, () => 1); // Executes the live hint wiring along with its debug-ray report.
const gazer = { x: 0, y: 0, perpState: {} }; // Head-look subject with no travel history.
reportGaze(gazer, -10, 20, 1.5);
assert.equal(api.resolveCorrectiveDirection(gazer.perpState).source, 'headtrack');
assert.equal(gazer.perpState.headtrackYaw, Math.atan2(-10, 20), 'head targets use world-bearing rather than ordinary XY aim angles');

const farmSource = fs.readFileSync('docs/js/farm-animals.js', 'utf8'); // Farm livestock owns a separate tile-space loop.
const farmStart = farmSource.indexOf('  function _reportFarmAnimalMovementHint('); // Extracts the live farm facing function.
const farmEnd = farmSource.indexOf('  function _farmAnimalPickWanderTarget', farmStart); // Next function marks its boundary.
const farmFacing = new Function('window', 'deps', '_farmAnimalLookTarget', `${farmSource.slice(farmStart, farmEnd)}; return _updateFarmAnimalFacing;`)(context, { perpClamp: api.perpClamp, cameraRelativeCreaturePerps: () => [0, Math.PI], CREATURE_PERP_DEAD_RAD: api.CREATURE_PERP_DEAD_RAD, angleDiff }, () => 0); // Tests travel sampling and remembered movement against the real clamp.
const farm = { wx: 0, wz: 0, perpState: {}, groupRot: 0, avatarRef: { group: { rotation: {} } } }; // Farm animal before its first update.
farmFacing(farm, 1 / 60, true);
farm.wx = -0.1; farm.wz = 0.1;
farmFacing(farm, 1 / 60, false);
assert.equal(farm.perpState.pixelProbeDebug.correctiveSource, 'movement');
assert.equal(farm.perpState.pixelProbeDebug.selectedSide, -1);
farmFacing(farm, 1 / 60, true);
assert.equal(farm.perpState.pixelProbeDebug.correctiveSource, 'lastMovement', 'stationary livestock retains travel history');
api.setHeadtrackHint(farm.perpState, 0.4);
farmFacing(farm, 1 / 60, true);
assert.equal(farm.perpState.pixelProbeDebug.correctiveSource, 'headtrack');
assert.equal(farm.groupRot, api.CREATURE_PERP_DEAD_RAD);
console.log('Animal priority deadzone: wild, mounts, companions, named NPCs and farm livestock passed.');
