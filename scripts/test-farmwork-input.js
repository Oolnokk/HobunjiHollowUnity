#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Execute the actual FarmEditor pointer bridge with native-input handlers after it.
const listeners = new Map();
const container = { addEventListener(type, fn) {
  const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list);
} };
let planning = true, open = true, painting = false, strokes = 0, nativePresses = 0;
const doc = { pointerLockElement: null, getElementById: () => null };
const win = {
  addEventListener() {},
  FarmworkUI: {
    isOpen: () => open, isPanelOpen: () => open && !planning, isPlanning: () => planning,
    startWorldPointer() { strokes++; painting = true; return true; },
    dragTile: () => painting,
    endWorldPointer: () => false,
  },
};
vm.runInNewContext(read('docs/js/farm-editor.js'), { window: win, document: doc, console });
win.FarmEditor.init({
  threeContainer: container,
  getMouseAction: button => button === 0 ? 'action1' : button === 2 ? 'action2' : null,
  getArmedFurniturePlacementKey: () => null, getArmedFurnitureMoveId: () => null,
  getFarmEditMode: () => false,
});
container.addEventListener('pointerdown', () => { nativePresses++; });
function pointer(pointerType, button = 0) {
  painting = false;
  const e = { pointerType, button, pointerId: 1, clientX: 40, clientY: 50, stopped: false,
    preventDefault() {}, stopImmediatePropagation() { this.stopped = true; } };
  for (const fn of listeners.get('pointerdown')) { fn(e); if (e.stopped) break; }
  return e;
}
assert.equal(pointer('touch').stopped, false, 'equipped tool leaves touch look/movement gestures with their native owners');
assert.equal(strokes, 0);
doc.pointerLockElement = container;
assert.equal(pointer('mouse').stopped, false, 'locked mouse goes through native action claims and reticle');
assert.equal(strokes, 0, 'screen coordinates are never mistaken for the gameplay reticle under pointer lock');
doc.pointerLockElement = null;
assert.equal(pointer('mouse').stopped, true, 'free mouse retains world painting');
assert.equal(strokes, 1);
planning = false;
assert.equal(pointer('touch').stopped, true, 'settings panel blocks viewport touch fallthrough');
assert.equal(nativePresses, 2);

// Evaluate the actual game-owned camera/pointer-lock policies, rather than reproducing them in the test.
const game = read('docs/game.js');
const cameraBody = game.match(/function cameraDragAllowed\(\) \{([\s\S]*?)\n      \}/)[1];
const pointerPolicy = game.match(/isUiBlockingPointerLock: (\(\) => [^\n]+),\n/)[1];
const cameraEnv = {
  window: win, menuOpen: false, farmEditMode: false,
  furniturePlacementArmedKey: null, furnitureMoveArmedId: null,
  dialogueZoomActive: () => false, cutscenePreviewActive: false,
};
cameraEnv.furniturePlacementModeArmed = () => !!(cameraEnv.furniturePlacementArmedKey || cameraEnv.furnitureMoveArmedId); // Evaluates the same armed states as gameplay for the isolated camera function.
const canDrag = vm.runInNewContext(`(function(){${cameraBody}})`, cameraEnv);
const blocksLock = vm.runInNewContext(`(${pointerPolicy})`, cameraEnv);
assert.equal(canDrag(), false, 'settings panel prevents camera rotation');
assert.equal(blocksLock(), true, 'settings panel prevents pointer-lock reacquisition');
planning = true;
assert.equal(canDrag(), true, 'equipped tool permits camera aiming');
assert.equal(blocksLock(), false, 'equipped tool permits cursorless aiming');
// Reticle placement consumes action buttons, never the look stick or Shift+mouse movement.
cameraEnv.furniturePlacementArmedKey = 'wovenRugFurniture';
assert.equal(canDrag(), true, 'placing furniture must still allow camera rotation');
cameraEnv.furniturePlacementArmedKey = null;
cameraEnv.furnitureMoveArmedId = 'existing-chair';
assert.equal(canDrag(), true, 'moving furniture must still allow camera rotation');
cameraEnv.furnitureMoveArmedId = null;
cameraEnv.farmEditMode = true;
assert.equal(canDrag(), false, 'Farm Editor alone still reserves the camera for painting');
cameraEnv.furniturePlacementArmedKey = 'wovenRugFurniture';
assert.equal(canDrag(), true, 'an armed furniture placement takes precedence over Farm Editor camera suppression');
cameraEnv.furniturePlacementArmedKey = null;
cameraEnv.furnitureMoveArmedId = 'existing-chair';
assert.equal(canDrag(), true, 'an armed furniture move takes precedence over Farm Editor camera suppression');
cameraEnv.furnitureMoveArmedId = null;
cameraEnv.farmEditMode = false;
win.FurniturePlacer = { isOpen: () => true };
assert.equal(canDrag(), false, 'furniture picker overlay still blocks background camera look');
win.FurniturePlacer.isOpen = () => false;
win.__furniturePlacerPanelOpen = true;
assert.equal(canDrag(), false, 'picker panel flag independently prevents touch look while visible');
win.__furniturePlacerPanelOpen = false;
win.__mapEditorPanelOpen = true;
assert.equal(canDrag(), false, 'visible map editor panel still blocks camera input');
win.__mapEditorPanelOpen = false;
assert.match(game, /\(farmEditMode && !furniturePlacementModeArmed\(\)\)/,
  'desktop clicks must reach reticle furniture placement even when Farm Editor was active');
open = false;
assert.equal(canDrag(), true);
assert.equal(blocksLock(), false);
console.log('Farmwork native input and camera ownership checks passed');
