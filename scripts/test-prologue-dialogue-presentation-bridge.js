'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-dialogue-presentation-bridge.js', 'utf8');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(...items) { items.forEach(item => values.add(item)); },
    remove(...items) { items.forEach(item => values.delete(item)); },
    contains(item) { return values.has(item); },
  };
}

function element(id) {
  return {
    id,
    classList: classList(),
    attrs: {},
    style: {},
    checked: false,
    dispatched: [],
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    contains(target) { return target === this; },
    dispatchEvent(event) { this.dispatched.push(event.type); return true; },
  };
}

const elements = {
  npcDialogue: element('npcDialogue'),
  arcContainer: element('arcContainer'),
  npcDialogueContinue: element('npcDialogueContinue'),
  npcDialogueLeave: element('npcDialogueLeave'),
  settingShoulderSurf: element('settingShoulderSurf'),
  threeContainer: element('threeContainer'),
};
elements.npcDialogueContinue.style.display = 'none';
elements.npcDialogueLeave.style.display = 'none';

const jubmir = {
  userData: { prologueActor: true, prologueNpcId: 'jubmir' },
  position: { x: 9.5, y: 0.5, z: 12.5 },
  children: [],
};
const spearhead = {
  userData: { prologueActor: true, prologueNpcId: 'spearhead_unumanuk' },
  position: { x: 15.5, y: 0.5, z: 12.5 },
  children: [],
};
const scene = { children: [jubmir, spearhead] };

let sessionActive = true;
let speakerNpcId = 'jubmir';
let testFinished = false;
let actualCameraMode = 'npcDialogue';
let actualCameraTarget = { id: 'old-target' };
let receivedFarmDeps = null;
let receivedClimbDeps = null;
let facingYaw = 0.25;
let aimYaw = 0.4;
let rafCallback = null;
let cameraTargetSnaps = 0;
let cameraPositionUpdates = 0;
let pointerLockExits = 0;
const windowListeners = new Map();

const originalShoulderConfig = {
  distanceTiles: 2.6,
  angleFromGroundDeg: 9,
  fovDeg: 55,
  followLerp: 0.16,
  targetYOffsetTiles: 0.62,
  freeRotate: true,
};
const shoulderConfig = { ...originalShoulderConfig };
const cameraConfig = {
  dialogueMode: 'npcDialogue',
  modes: { shoulderSurf: shoulderConfig },
};

const player = { x: 12.5 * 64, y: 12.5 * 64, angle: 0.1 };
const rawCameraDeps = {
  player,
  TILE: 64,
  cameraConfig: () => cameraConfig,
  getFacingAngle: () => facingYaw,
  setFacingAngle(yaw) { facingYaw = yaw; },
  getCameraMode: () => actualCameraMode,
  setCameraMode(mode) { actualCameraMode = mode; return mode; },
  getCameraTarget: () => actualCameraTarget,
  setCameraTarget(target) { actualCameraTarget = target; return target; },
};
const rawAimDeps = {
  player,
  TILE: 64,
  setFacingAngle(yaw) { facingYaw = yaw; },
  setTargetAimAngle(yaw) { aimYaw = yaw; },
};

const windowObject = {
  SCRATCHBONES_CONFIG: { game: { camera: cameraConfig } },
  GridTileAccessors: {
    getCurrentArea: () => 'map_prologue_rescue',
    getActiveScene: () => scene,
  },
  PrologueDialogueRuntime: {
    debugSnapshot: () => ({
      currentArea: 'map_prologue_rescue',
      sessionActive,
      speakerNpcId,
      testFinished,
    }),
  },
  FarmAnimals: {
    init(deps) { receivedFarmDeps = deps; return 'farm-init'; },
  },
  ClimbSystem: {
    init(deps) { receivedClimbDeps = deps; return 'climb-init'; },
  },
  __climbDebug: {
    getPlayer: () => player,
    snapCameraTarget() { cameraTargetSnaps++; },
    updateCameraPosition() { cameraPositionUpdates++; },
    getCameraDebug: () => ({ camTarget: { x: 12.5, y: 0, z: 12.5 } }),
  },
  __hobunjiFurnitureDebug: { activeCameraAzimuthDeg: 90 },
  addEventListener(type, handler) {
    const list = windowListeners.get(type) || [];
    list.push(handler);
    windowListeners.set(type, list);
  },
};

const documentStub = {
  readyState: 'complete',
  pointerLockElement: elements.threeContainer,
  exitPointerLock() { pointerLockExits++; this.pointerLockElement = null; },
  getElementById(id) { return elements[id] || null; },
  addEventListener() {},
};

const context = {
  window: windowObject,
  document: documentStub,
  console,
  Event: class Event { constructor(type, options = {}) { this.type = type; this.bubbles = !!options.bubbles; } },
  MutationObserver: class MutationObserver { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
  setInterval() { return 1; },
  clearInterval() {},
  setTimeout(callback) { callback(); return 1; },
  requestAnimationFrame(callback) { rafCallback = callback; return 1; },
  Math,
};
windowObject.window = windowObject;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'prologue-dialogue-presentation-bridge.js' });

assert.equal(windowObject.FarmAnimals.init(rawCameraDeps), 'farm-init');
assert.equal(windowObject.ClimbSystem.init(rawAimDeps), 'climb-init');
assert.ok(receivedFarmDeps, 'FarmAnimals must receive the bridged camera dependency object');
assert.equal(receivedClimbDeps, rawAimDeps, 'ClimbSystem must retain its ordinary dependency object');

// The prologue's detached npcDialogue request must become real Shoulder Cam.
receivedFarmDeps.setCameraMode('npcDialogue');
assert.equal(actualCameraMode, 'shoulderSurf');

// Targeting Jubmir starts the true rendered-camera takeover. The NPC is only
// a look direction: camera target is cleared, the private follow target is
// snapped to the player, and Shoulder Cam receives an authored push-in.
const originalFacing = facingYaw;
const originalPlayerAngle = player.angle;
receivedFarmDeps.setCameraTarget(jubmir);
assert.equal(actualCameraTarget, null, 'scripted speaker must never become the camera anchor');
assert.equal(actualCameraMode, 'shoulderSurf');
assert.equal(facingYaw, originalFacing, 'speaker focus must restore player facing immediately');
assert.equal(player.angle, originalPlayerAngle, 'speaker focus must not turn the player');
assert.equal(aimYaw, 0.4, 'speaker focus must not rewrite gameplay aim');
assert.equal(elements.settingShoulderSurf.checked, true);
assert.deepEqual(elements.settingShoulderSurf.dispatched, ['change']);
assert.ok(cameraTargetSnaps >= 1, 'real game camera target must snap onto the player');
assert.ok(cameraPositionUpdates >= 1, 'real camera position must update immediately after the snap');
assert.equal(pointerLockExits, 1, 'dialogue must release free-look pointer lock');
assert.equal(shoulderConfig.distanceTiles, 1.8, 'dialogue applies an automatic shoulder-camera zoom');
assert.equal(shoulderConfig.fovDeg, 50);
assert.equal(shoulderConfig.followLerp, 1, 'stale previous-map camera targets must not visibly lerp inward');
assert.equal(shoulderConfig.freeRotate, false);

// Camera input is capture-blocked while the scripted dialogue is active, but
// the actual dialogue GUI remains interactive.
const mouseHandler = windowListeners.get('mousemove')?.[0];
const wheelHandler = windowListeners.get('wheel')?.[0];
assert.ok(mouseHandler && wheelHandler, 'camera input blockers must be registered before gameplay input');
let prevented = 0, stopped = 0;
const cameraEvent = {
  target: elements.threeContainer,
  cancelable: true,
  preventDefault() { prevented++; },
  stopImmediatePropagation() { stopped++; },
  stopPropagation() {},
};
mouseHandler(cameraEvent);
wheelHandler(cameraEvent);
assert.equal(prevented, 2);
assert.equal(stopped, 2);
const dialogueEvent = {
  target: elements.npcDialogue,
  cancelable: true,
  preventDefault() { throw new Error('dialogue UI input must not be blocked'); },
  stopImmediatePropagation() { throw new Error('dialogue UI input must not be blocked'); },
  stopPropagation() {},
};
mouseHandler(dialogueEvent);

// game.js may close its private scheduled-walker panel state; keep the real
// gameplay dialogue shell visible without creating another overlay.
assert.equal(windowObject.PrologueDialoguePresentationBridge.enforceNow(), true);
assert.equal(elements.npcDialogue.classList.contains('open'), true);
assert.equal(elements.npcDialogue.attrs['aria-hidden'], 'false');
assert.equal(elements.arcContainer.classList.contains('arc-hidden'), true);
assert.equal(elements.npcDialogueContinue.style.display, '');
assert.equal(elements.npcDialogueLeave.style.display, '');

// Speaker change reuses the exact same player-anchored shoulder camera.
speakerNpcId = 'spearhead_unumanuk';
receivedFarmDeps.setCameraTarget(spearhead);
assert.equal(actualCameraTarget, null);
assert.equal(actualCameraMode, 'shoulderSurf');
assert.equal(facingYaw, originalFacing);
assert.equal(player.angle, originalPlayerAngle);
assert.deepEqual(elements.settingShoulderSurf.dispatched, ['change', 'change']);
assert.ok(cameraTargetSnaps >= 2);

const activeDebug = windowObject.PrologueDialoguePresentationBridge.debugSnapshot();
assert.equal(activeDebug.version, 2);
assert.equal(activeDebug.sessionActive, true);
assert.equal(activeDebug.takeoverActive, true);
assert.equal(activeDebug.cameraMode, 'shoulderSurf');
assert.equal(activeDebug.dialogueGuiOpen, true);
assert.equal(activeDebug.dialogueDistanceTiles, 1.8);
assert.equal(activeDebug.dialogueFovDeg, 50);
assert.equal(activeDebug.lastSpeakerNpcId, 'spearhead_unumanuk');
assert.ok(activeDebug.renderedTargetSnaps >= 2);
assert.equal(activeDebug.inputBlocks, 2);

// Closing the synthetic session restores the user's ordinary Shoulder Cam
// tuning. Ordinary NPC/livestock dialogue then passes through unchanged.
sessionActive = false;
assert.equal(windowObject.PrologueDialoguePresentationBridge.syncCameraNow(), false);
for (const key of ['distanceTiles', 'angleFromGroundDeg', 'fovDeg', 'followLerp', 'targetYOffsetTiles', 'freeRotate']) {
  assert.equal(shoulderConfig[key], originalShoulderConfig[key], `restore ${key}`);
}
const ordinaryTarget = { id: 'ordinary-npc' };
receivedFarmDeps.setCameraMode('npcDialogue');
receivedFarmDeps.setCameraTarget(ordinaryTarget);
assert.equal(actualCameraMode, 'npcDialogue');
assert.equal(actualCameraTarget, ordinaryTarget);

assert.equal(source.includes('player.x ='), false, 'presentation bridge must never reposition player X');
assert.equal(source.includes('player.y ='), false, 'presentation bridge must never reposition player Y');
assert.equal(source.includes('updateHeadYaw'), false, 'presentation bridge must not force NPC head yaw');
assert.equal(source.includes('updateHeadRotation'), false, 'presentation bridge must not force NPC head pitch');
assert.ok(typeof rafCallback === 'function', 'post-game presentation frame must be registered');

console.log('prologue real Shoulder Cam takeover + zoom + input-lock regression passed');
