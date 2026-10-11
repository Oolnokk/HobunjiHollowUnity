'use strict';
const fs = require('node:fs'); // Loads the runtime implementations under test.
const assert = require('node:assert/strict'); // Checks shared physical/virtual right-stick behavior.
const vm = require('node:vm'); // Executes the production camera input without WebGL boot.
const source = fs.readFileSync('docs/game.js', 'utf8'); // Current arch and camera owner.
const controllerSource = fs.readFileSync('docs/js/controller-input.js', 'utf8'); // Canonical radial normalization.
const normalizeSource = controllerSource.slice(controllerSource.indexOf('  function normalizeStick('), controllerSource.indexOf('  // Indexed loops')); // Real stick response helper.
const archResponseSource = source.split('\n').find(line => line.includes('const MOBILE_ARCH_LOOK_RESPONSE =')); // Read the authored curve from the runtime.
const setterSource = source.slice(source.indexOf('      function setMobileArchCombatAim('), source.indexOf('      function clearMobileArchCombatAim(')); // Real touch-to-stick adapter.
const cameraSource = source.slice(source.indexOf('      function applyControllerCameraLook('), source.indexOf('      function pollControllerInput(')); // Single yaw/pitch consumer shared by both devices.
function cameraContext(invert = false, free = true) {
  const ctx = { // Supplies camera settings and lifecycle dependencies of production code.
    mobileArchCombatAim: null, controllerCameraX: 0, controllerCameraY: 0,
    cameraAzimuthOffsetDeg: 0, cameraAngleOffsetDeg: 0, controllerLookAngle: 0,
    targetAimAngle: 0, controllerLookActive: false, activeTool: 'ranged', player: {},
    INPUT_DEFAULTS: { deadzone: 0.24 }, CONTROLLER_LOOK_RESPONSE: 1.45,
    CONTROLLER_LOOK_DEG_PER_SEC: 140, CONTROLLER_LOOK_VERTICAL_SCALE: 0.7,
    s_controllerLookSensitivity: 1.3, s_controllerInvertY: invert,
    lastMobileArchCombatAimEvent: null, invalidateMobileArchAimPerspectiveCache() {},
    cameraDragAllowed: () => true, desktopControlsConfig: () => ({ cameraRotateClampDeg: 45 }),
    freeRotateCameraActive: () => free, wrapAzimuthDeg: v => ((v + 180) % 360 + 360) % 360 - 180,
    clampCameraPitchOffsetDeg: v => Math.max(-85, Math.min(45, v)),
    window: { FormatUtils: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) }, Combat: { postAttackTurnMultiplier: () => 0.6 } },
  };
  ctx.cameraFacingAngleRad = () => -ctx.cameraAzimuthOffsetDeg * Math.PI / 180;
  vm.createContext(ctx);
  vm.runInContext(normalizeSource, ctx);
  ctx.window.ControllerInput = { normalizeStick: ctx.normalizeStick };
  vm.runInContext(archResponseSource + '\n' + setterSource + cameraSource, ctx);
  return ctx;
}
for (const invert of [false, true]) for (const free of [false, true]) for (const [x, y] of [[1, 0], [0, -1], [0.65, 0.75], [0.12, 0.12], [-0.5, 0.4]]) {
  const physical = cameraContext(invert, free), touch = cameraContext(invert, free); // Same settings and normalized camera axes exercise the shared consumer.
  touch.setMobileArchCombatAim(7, x * 42, y * 42, 42, 'shoot');
  const look = { x: touch.mobileArchCombatAim.lookX, y: touch.mobileArchCombatAim.lookY }; // The arch intentionally softens its throw before the shared controller camera path.
  physical.controllerCameraX = look.x;
  physical.controllerCameraY = look.y;
  assert.equal(touch.cameraAzimuthOffsetDeg, 0, 'touch sample does not snap to a world heading');
  assert.equal(touch.mobileArchCombatAim.lookX, look.x);
  assert.equal(touch.mobileArchCombatAim.lookY, look.y);
  for (const dt of [1 / 60, 1 / 30, 0.08, 1]) {
    physical.applyControllerCameraLook(dt);
    touch.applyControllerCameraLook(dt);
    assert.equal(touch.cameraAzimuthOffsetDeg, physical.cameraAzimuthOffsetDeg, 'same continuous horizontal turn');
    assert.equal(touch.cameraAngleOffsetDeg, physical.cameraAngleOffsetDeg, 'same pitch and inversion');
    assert.equal(touch.targetAimAngle, physical.targetAimAngle, 'same target bearing');
  }
  const azimuth = touch.cameraAzimuthOffsetDeg, pitch = touch.cameraAngleOffsetDeg; // Centering stops look immediately without clearing the held attack.
  touch.setMobileArchCombatAim(7, 0, 0, 42, 'shoot');
  touch.applyControllerCameraLook(0.5);
  assert.equal(touch.cameraAzimuthOffsetDeg, azimuth);
  assert.equal(touch.cameraAngleOffsetDeg, pitch);
  touch.mobileArchCombatAim.released = true;
  touch.applyControllerCameraLook(0.5);
  assert.equal(touch.cameraAzimuthOffsetDeg, azimuth, 'released arch no longer turns camera');
}
const curve = cameraContext(); // Mid-throw remains precise while the outer rim still permits fast turning.
const turnAt = throwFraction => {
  curve.setMobileArchCombatAim(7, throwFraction * 42, 0, 42, 'shoot');
  return curve.mobileArchCombatAim.lookX;
}; // Samples the production radial response without duplicating its formula.
assert.equal(turnAt(0.2), 0, 'center remains inside the controller deadzone');
assert(turnAt(0.5) < 0.01, 'half throw stays below one percent speed');
assert(turnAt(0.75) < 0.1, 'three-quarter throw stays below ten percent speed');
assert(turnAt(0.9) > 0.4, 'turn speed ramps up near the outer edge');
assert.equal(turnAt(1), 1, 'maximum turn speed is unchanged');
assert.equal(turnAt(1.5), 1, 'dragging beyond the socket clamps to full speed');
const rayContext = { // Camera pitch and yaw must reach attacks without a separate arch heading override.
  mobileArchCombatAim: { angle: 0 }, mobileAutoCameraActive: false,
  currentCombatReticleNDC: () => ({ x: 0, y: 0 }), activeCameraMode: 'orbit', SHOULDER_SURF_MODE: 'shoulder',
  heldMode: 'tool', activeTool: 'weapon', equipmentSlots: {}, camera: { updateMatrixWorld() {} },
  _shoulderSurfReticleRaycaster: { setFromCamera() {}, ray: { origin: { x: 1, y: 2, z: 3 }, direction: { x: 0.3, y: 0.4, z: -0.8 } } },
};
vm.createContext(rayContext);
vm.runInContext(source.slice(source.indexOf('      function currentPlayerAimRay()'), source.indexOf('      function currentPlayerInteractionRay()')), rayContext);
assert.deepEqual(JSON.parse(JSON.stringify(rayContext.currentPlayerAimRay().direction)), { x: 0.3, y: 0.4, z: -0.8 }, 'virtual right stick uses the actual camera ray including elevation');
console.log('Physical and arch right-stick yaw/pitch, deadzone, rate, settings and camera-ray parity passed.');

const inputSource = fs.readFileSync('docs/js/combat/combat-input.js', 'utf8'); // Real hold termination state machine under test.
let releases = 0, cancellations = 0, alignmentCancels = 0; // Counters distinguish a normal release from a canceled input.
const makeHeldSlot = () => ({down:true,holding:true,holdStarted:true,holdAbility:{onHoldEnd(){releases++;},onHoldCancel(){cancellations++;}}}); // Started charge-like ability with separate cancellation cleanup.
const holdContext = {slots:{1:makeHeldSlot()},emitState(){}}; // Minimal shared-input slot state.
vm.createContext(holdContext);
vm.runInContext(inputSource.slice(inputSource.indexOf('  function endHold('), inputSource.indexOf('  // Call on pointerdown')), holdContext);
vm.runInContext(inputSource.slice(inputSource.indexOf('  function abortPress('), inputSource.indexOf('  function abortAllPresses(')), holdContext);
holdContext.abortPress(1);
assert.equal(cancellations, 1, 'canceled started hold calls cancellation cleanup');
assert.equal(releases, 0, 'canceled started hold never calls the release attack');
assert.equal(holdContext.slots[1].down, false, 'cancellation releases input ownership');
holdContext.slots[1] = makeHeldSlot();
holdContext.endHold(1);
assert.equal(releases, 1, 'ordinary finger-up keeps normal release behavior');
holdContext.slots[1] = {down:true,holding:true,holdStarted:false,alignmentRequest:{cancel(){alignmentCancels++;}}};
holdContext.abortPress(1);
assert.equal(alignmentCancels, 1, 'pending alignment is canceled without starting an attack');
assert.equal(holdContext.slots[1].releaseQueued, false, 'canceled pending alignment cannot release later');

const breakerSource = fs.readFileSync('docs/js/combat/combat-charged-breaker.js', 'utf8'); // Real charge cleanup function under test.
let visualCancels = 0, glowClears = 0; // Counts cleanup paths that must run instead of strike resolution.
const breakerContext = {startedAt:1,debugState:{active:true},FURIOUS_PROGRESS_OWNER:'charge',clearGlow(){glowClears++;},window:{Combat:{setWindupProgressTransform(owner,value){assert.equal(value,null);},deps:{cancelWeaponSwingHold(){visualCancels++;}}}}}; // Minimal Charged Breaker ownership dependencies.
vm.createContext(breakerContext);
vm.runInContext(breakerSource.slice(breakerSource.indexOf('    function onHoldCancel('), breakerSource.indexOf('    function onHoldEnd(')), breakerContext);
breakerContext.onHoldCancel();
breakerContext.onHoldCancel();
assert.equal(visualCancels, 1, 'charge cancellation cleans up exactly once');
assert.equal(glowClears, 1, 'charge cancellation clears its glow');
assert.equal(breakerContext.startedAt, -1, 'charge cancellation stops the hold clock');
assert.equal(breakerContext.debugState.active, false, 'mobile diagnostics stop reporting an active charge');
console.log('Executed mobile aim and held-attack cancellation checks passed.');
