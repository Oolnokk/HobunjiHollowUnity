// Node regression for the utility arch spyglass, optical FOV and camera/input cleanup.
'use strict';
const assert = require('node:assert/strict'); // Used to verify live behavior rather than matching source text alone.
const fs = require('node:fs'); // Reads the actual game modules under test.
const vm = require('node:vm'); // Executes browser-owned modules inside isolated window/document stubs.

const spyglassScript = fs.readFileSync('docs/js/utility-spyglass.js', 'utf8'); // The feature and input-claim owner.
const focusScript = fs.readFileSync('docs/js/combat/ranged-camera-focus.js', 'utf8'); // Existing shared camera FOV owner.
const arcScript = fs.readFileSync('docs/js/action-arc-ui.js', 'utf8'); // Utility-wheel integration point.
const indexHtml = fs.readFileSync('docs/index.html', 'utf8'); // Verifies the feature loads before game.js.

function element(tag = 'div') {
  return {
    tag,
    classList: { values: new Set(), toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); } },
    children: [],
    addEventListener(name, handler) { this.listeners[name] = handler; },
    listeners: {},
    appendChild(child) { this.children.push(child); },
    setAttribute() {},
    closest() { return null; },
    style: {},
  };
}

function environment() {
  const browserEvents = {}; // Allows fake window blur and scene transitions to be dispatched.
  const documentEvents = {}; // Allows fake Escape and visibility changes to be dispatched.
  const body = element('body'); // Contains the reusable lens and button HUD.
  const document = {
    readyState: 'complete',
    body,
    createElement: element,
    querySelector: () => null,
    addEventListener(name, fn) { documentEvents[name] = fn; },
  }; // Minimal DOM because the spyglass owns its own isolated UI.
  let mode = 'default'; // Current gameplay camera mode mutated through Fishing dependencies.
  let target = 'animal'; // Camera target captured and restored after the spyglass is put away.
  let characterView = true; // Original Character View state restored on stow.
  let heldMode = 'tool'; // Cleared by stowForCarry and used to detect new equipment.
  let claim = null; // Action 1 claim registered through the shared world input dispatcher.
  let cameraChangeAllowed = true; // Tests failure rollback if the camera refuses shoulder mode.

  const fishing = {
    init() {},
  }; // Initialized by the same dependency injection seam used by game.js.
  const actionArc = {
    init() {},
    stowForCarry() { heldMode = null; },
  }; // Mirrors the utility arch's exposed equipment clearing method.
  const window = {
    Fishing: fishing,
    ActionArcUI: actionArc,
    WorldActionInputClaims: {
      setClaims(ownerId, claims) { claim = { ...claims[0], ownerId }; },
      clearClaims() { claim = null; },
      claimFor() { return claim; },
      snapshot() { return { pressed: [] }; },
    },
    ControllerInput: { subscribe() {} },
    ShoulderCamPointerLock: { request() {} },
    addEventListener(name, fn) { browserEvents[name] = fn; },
    __farmLog() {},
  }; // Supplies the real production namespaces consumed by the feature.
  const cameraDeps = {
    getCameraMode: () => mode,
    setCameraMode(value) { if (cameraChangeAllowed) mode = value; },
    getCameraTarget: () => target,
    setCameraTarget(value) { target = value; },
  }; // Exercises the same camera restoration contract as fishing/minigames.
  const viewDeps = {
    getHeldMode: () => heldMode,
    characterViewMode: { get enabled() { return characterView; } },
    setCharacterViewMode(value) { characterView = !!value; },
  }; // Supplies the existing Character View state and held-equipment adapter.
  vm.runInNewContext(spyglassScript, { window, document });
  fishing.init(cameraDeps);
  actionArc.init(viewDeps);
  return {
    api: window.Spyglass, window, document, body, browserEvents, documentEvents,
    get mode() { return mode; },
    get target() { return target; },
    get characterView() { return characterView; },
    get claim() { return claim; },
    setHeldMode(value) { heldMode = value; },
    setCameraChangeAllowed(value) { cameraChangeAllowed = value; },
  };
}

assert.match(arcScript, /id: 'spyglass'.*icon: '🔭'/, 'utility arch must display a spyglass');
assert.match(indexHtml, /utility-spyglass\.css\?v=/, 'spyglass overlay CSS must load');
assert.match(indexHtml, /js\/utility-spyglass\.js\?v=/, 'spyglass module must load');
assert.ok(indexHtml.indexOf('js/utility-spyglass.js') < indexHtml.indexOf('src="game.js'), 'spyglass captures injected camera dependencies before gameplay initializes');

const game = environment(); // Main equipment, trigger and camera restoration fixture.
assert.equal(game.api.equip(), true, 'utility spyglass equips');
assert.equal(game.mode, 'shoulderSurf', 'spyglass switches to existing free-look camera');
assert.equal(game.characterView, false, 'Character View gives way to shoulder look');
assert.equal(game.target, null, 'previous camera target is cleared while looking');
assert.equal(game.api.getDebug().ownsAction1, true, 'Action 1 belongs exclusively to spyglass');
game.claim.onPress();
assert.equal(game.api.isAiming(), true, 'pressing Action 1 raises lens');
game.claim.onRelease();
assert.equal(game.api.isAiming(), false, 'releasing Action 1 lowers lens');
game.api.stow('test');
assert.equal(game.mode, 'default', 'original camera mode is restored');
assert.equal(game.characterView, true, 'original Character View is restored');
assert.equal(game.target, 'animal', 'original tracked camera target is restored');
assert.equal(game.claim, null, 'Action 1 input claim is released on stow');
assert.equal(game.api.getDebug().equipped, false, 'debug state reflects stow');

game.api.equip();
game.setHeldMode('item');
game.api.update();
assert.equal(game.api.isEquipped(), false, 'selecting an inventory item automatically stows the spyglass');
game.api.equip();
game.browserEvents.blur();
assert.equal(game.api.isEquipped(), false, 'focus loss stows the spyglass safely');

const cameraFailure = environment(); // Verifies an unavailable shoulder mode cannot strand camera settings.
cameraFailure.setCameraChangeAllowed(false);
assert.equal(cameraFailure.api.equip(), false, 'equipment refuses failed camera switch');
assert.equal(cameraFailure.characterView, true, 'failed camera switch restores Character View');
assert.equal(cameraFailure.target, 'animal', 'failed camera switch restores camera target');
assert.equal(cameraFailure.claim, null, 'failed equip never acquires Action 1');

let aiming = true; // Mock spyglass lens state, supplied to existing ranged focus.
const nativeCamera = {
  fov: 55,
  updates: 0,
  updateProjectionMatrix() { this.updates++; },
}; // Actual PerspectiveCamera-facing FOV adapter.
const ranged = {
  update() {},
  init() {},
  equippedRangedKey() { return null; },
  config: {},
}; // Existing RangedWeapons owner wrapped by camera focus module.
const focusWindow = {
  SCRATCHBONES_CONFIG: { game: { camera: { modes: { shoulderSurf: { fovDeg: 55 } } } } },
  RangedWeapons: ranged,
  Spyglass: { isAiming: () => aiming, update() {} },
  addEventListener() {},
  __farmLog() {},
}; // Simulates a camera with no ranged weapon equipped.
vm.runInNewContext(focusScript, { window: focusWindow, document: game.document });
ranged.init({ getActiveCamera: () => nativeCamera });
for (let frame = 0; frame < 35; frame++) ranged.update(.1);
assert.ok(Math.abs(nativeCamera.fov - 14) < 0.05, 'raised spyglass zooms to 14° via the native shared FOV');
aiming = false;
for (let frame = 0; frame < 35; frame++) ranged.update(.1);
assert.ok(Math.abs(nativeCamera.fov - 55) < 0.05, 'lowered spyglass smoothly restores 55° normal FOV');
assert.ok(nativeCamera.updates > 1, 'optical zoom updates native camera projection');
console.log('Utility spyglass: arch wiring, input claims, camera restoration and optical FOV passed.');
