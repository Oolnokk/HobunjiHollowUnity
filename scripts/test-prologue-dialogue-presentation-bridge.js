'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/prologue-dialogue-presentation-bridge.js', 'utf8'); // Presentation adapter under test.

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
    dispatchEvent(event) { this.dispatched.push(event.type); return true; },
  };
}

const elements = {
  npcDialogue: element('npcDialogue'),
  arcContainer: element('arcContainer'),
  npcDialogueContinue: element('npcDialogueContinue'),
  npcDialogueLeave: element('npcDialogueLeave'),
  settingShoulderSurf: element('settingShoulderSurf'),
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
let facingYaw = null;
let aimYaw = null;
let rafCallback = null;

const player = { x: 12.5 * 64, y: 12.5 * 64, angle: 0 };
const rawCameraDeps = {
  player,
  TILE: 64,
  cameraConfig: () => ({ dialogueMode: 'npcDialogue' }),
  getCameraMode: () => actualCameraMode,
  setCameraMode(mode) { actualCameraMode = mode; return mode; },
  getCameraTarget: () => actualCameraTarget,
  setCameraTarget(target) { actualCameraTarget = target; return target; },
  setFacingAngle(yaw) { facingYaw = yaw; },
};
const rawAimDeps = {
  player,
  TILE: 64,
  setFacingAngle(yaw) { facingYaw = yaw; },
  setTargetAimAngle(yaw) { aimYaw = yaw; },
};

const windowObject = {
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
};

const context = {
  window: windowObject,
  document: {
    readyState: 'complete',
    getElementById(id) { return elements[id] || null; },
    addEventListener() {},
  },
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

// The prologue's old request for npcDialogue must be rewritten synchronously,
// so no detached dialogue-camera frame can render before the bridge corrects it.
receivedFarmDeps.setCameraMode('npcDialogue');
assert.equal(actualCameraMode, 'shoulderSurf', 'rescue dialogue must remain in Shoulder Cam');

// A scripted actor is a look direction, never the camera anchor. The bridge
// clears the target, turns ordinary facing/aim toward Jubmir, and dispatches
// the existing Shoulder Cam recenter listener.
receivedFarmDeps.setCameraTarget(jubmir);
assert.equal(actualCameraTarget, null, 'scripted speaker must not become the camera orbit anchor');
assert.equal(actualCameraMode, 'shoulderSurf');
const expectedJubmirYaw = Math.atan2(0, -3);
assert(Math.abs(facingYaw - expectedJubmirYaw) < 1e-12, 'ordinary facing yaw must point at Jubmir');
assert(Math.abs(aimYaw - expectedJubmirYaw) < 1e-12, 'ordinary target aim yaw must point at Jubmir');
assert.equal(player.angle, expectedJubmirYaw, 'player logical angle stays synchronized with ordinary aim state');
assert.equal(elements.settingShoulderSurf.checked, true);
assert.deepEqual(elements.settingShoulderSurf.dispatched, ['change'], 'existing Shoulder Cam recenter path must be invoked exactly once for Jubmir');

// game.js may close the panel because its private scheduled-walker flag is
// false. The bridge must restore the real gameplay shell without inventing a
// second overlay.
assert.equal(windowObject.PrologueDialoguePresentationBridge.enforceNow(), true);
assert.equal(elements.npcDialogue.classList.contains('open'), true);
assert.equal(elements.npcDialogue.attrs['aria-hidden'], 'false');
assert.equal(elements.arcContainer.classList.contains('arc-hidden'), true);
assert.equal(elements.npcDialogueContinue.style.display, '');
assert.equal(elements.npcDialogueLeave.style.display, '');

// Speaker change reuses the exact same shoulder camera and only changes yaw.
speakerNpcId = 'spearhead_unumanuk';
receivedFarmDeps.setCameraTarget(spearhead);
const expectedSpearheadYaw = Math.atan2(0, 3);
assert(Math.abs(aimYaw - expectedSpearheadYaw) < 1e-12, 'second line must turn aim toward Spearhead');
assert.equal(actualCameraTarget, null);
assert.equal(actualCameraMode, 'shoulderSurf');
assert.deepEqual(elements.settingShoulderSurf.dispatched, ['change', 'change']);

const debug = windowObject.PrologueDialoguePresentationBridge.debugSnapshot();
assert.equal(debug.sessionActive, true);
assert.equal(debug.cameraMode, 'shoulderSurf');
assert.equal(debug.dialogueGuiOpen, true);
assert.equal(debug.recenterCount, 2);
assert.equal(debug.lastSpeakerNpcId, 'spearhead_unumanuk');

// Outside the synthetic prologue session, ordinary dialogue camera behavior
// passes through untouched for NPCs/livestock elsewhere in the game.
sessionActive = false;
const ordinaryTarget = { id: 'ordinary-npc' };
receivedFarmDeps.setCameraMode('npcDialogue');
receivedFarmDeps.setCameraTarget(ordinaryTarget);
assert.equal(actualCameraMode, 'npcDialogue');
assert.equal(actualCameraTarget, ordinaryTarget);

assert.equal(source.includes('player.x ='), false, 'presentation bridge must never reposition the player X');
assert.equal(source.includes('player.y ='), false, 'presentation bridge must never reposition the player Y');
assert.equal(source.includes('updateHeadYaw'), false, 'presentation bridge must not force NPC head yaw');
assert.equal(source.includes('updateHeadRotation'), false, 'presentation bridge must not force NPC head pitch');
assert.ok(typeof rafCallback === 'function', 'post-game presentation frame must be registered');

console.log('prologue Shoulder Cam + persistent gameplay dialogue GUI regression passed');
