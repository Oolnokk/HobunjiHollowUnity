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
  const canvas = element('canvas'); // Simulates the existing #threeContainer scene mouse-look target.
  canvas.contains = target => target === canvas;
  let menuOpen = false; // Simulates opening the game's normal menu while the lens is raised.
  const bindings = { desktop: { action1: 'Mouse0' }, controller: { action1: 'RightTrigger', uiOpenMenu: 'Button8' } }; // Configurable Action 1 bindings used by fallback listeners.
  let controllerHandler = null; // Captured ControllerInput subscriber for direct trigger tests.
  const document = {
    readyState: 'complete',
    body,
    createElement: element,
    querySelector: () => null,
    getElementById(id) {
      if (id === 'threeContainer') return canvas;
      if (id === 'menuPanel') return { classList: { contains: () => menuOpen } };
      return null;
    },
    addEventListener(name, fn) { (documentEvents[name] || (documentEvents[name] = [])).push(fn); },
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
    ControllerInput: { subscribe(_name, handler) { controllerHandler = handler; } },
    InputBindings: { getCurrentBindings: () => bindings },
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
    api: window.Spyglass, window, document, body, browserEvents, documentEvents, canvas,
    emitDocument(name, event) { for (const fn of documentEvents[name] || []) fn(event); },
    controllerFrame(frame) { controllerHandler?.(frame); },
    setBinding(device, code) { bindings[device].action1 = code; },
    setMenuOpen(value) { menuOpen = value; },
    get mode() { return mode; },
    get target() { return target; },
    get characterView() { return characterView; },
    get claim() { return claim; },
    setHeldMode(value) { heldMode = value; },
    setCameraChangeAllowed(value) { cameraChangeAllowed = value; },
  };
}

assert.match(arcScript, /id: 'spyglass'.*icon: '🔭'/, 'utility arch must display a spyglass');
assert.match(arcScript, /selectedSpyglass && window.Spyglass\?\.isEquipped\?\.\(\)[\s\S]*ShoulderCamPointerLock/, 'mouse-look is requested after utility arch cleanup');
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

// The action-arch buttons can be hidden while the spyglass is carried. Physical Action 1 still has to work.
const mouseGame = environment(); // Uses the real scene element rather than the optional HUD look button.
assert.equal(mouseGame.api.equip(), true);
const mouseEvent = { pointerId: 31, pointerType: 'mouse', button: 0, target: mouseGame.canvas };
mouseGame.emitDocument('pointerdown', mouseEvent);
assert.equal(mouseGame.api.isAiming(), true, 'mouse Action 1 raises lens directly over the scene');
mouseGame.browserEvents.pointerup(mouseEvent);
assert.equal(mouseGame.api.isAiming(), false, 'mouse release lowers lens even when the action arch is hidden');
mouseGame.setBinding('desktop', 'Mouse2');
mouseGame.emitDocument('pointerdown', { ...mouseEvent, pointerId: 32 });
assert.equal(mouseGame.api.isAiming(), false, 'original mouse button is ignored after Action 1 remap');
mouseGame.emitDocument('pointerdown', { ...mouseEvent, pointerId: 33, button: 2 });
assert.equal(mouseGame.api.isAiming(), true, 'remapped mouse Action 1 raises lens');
mouseGame.browserEvents.pointercancel({ pointerId: 33 });
assert.equal(mouseGame.api.isAiming(), false, 'pointer cancellation lowers the lens');
mouseGame.setBinding('desktop', 'KeyF');
mouseGame.emitDocument('keydown', { code: 'KeyF', repeat: false, ctrlKey: false, altKey: false, metaKey: false });
assert.equal(mouseGame.api.isAiming(), true, 'keyboard-remapped Action 1 raises lens');
mouseGame.emitDocument('keyup', { code: 'KeyF' });
assert.equal(mouseGame.api.isAiming(), false, 'keyboard Action 1 release lowers lens');
mouseGame.setMenuOpen(true);
mouseGame.emitDocument('keydown', { code: 'KeyF', repeat: false });
assert.equal(mouseGame.api.isAiming(), false, 'open menus block camera zoom');
mouseGame.api.update();
assert.equal(mouseGame.api.isEquipped(), false, 'opening game menu puts the spyglass away');

const padGame = environment(); // Exercises the shared controller subscriber rather than manually calling onPress.
padGame.api.equip();
padGame.controllerFrame({ focused: true, pad: {}, down: new Set(['RightTrigger']), pressed: new Set(), isDown: name => name === 'RightTrigger' });
assert.equal(padGame.api.isAiming(), true, 'controller trigger raises lens without a visible action button');
padGame.controllerFrame({ focused: true, pad: {}, down: new Set(), pressed: new Set(), isDown: () => false });
assert.equal(padGame.api.isAiming(), false, 'controller trigger release lowers lens');
padGame.setBinding('controller', 'Button2');
padGame.controllerFrame({ focused: true, pad: {}, pressed: new Set(), isDown: name => name === 'Button2' });
assert.equal(padGame.api.isAiming(), true, 'controller Action 1 remap is honored');
padGame.controllerFrame({ focused: true, pad: {}, pressed: new Set(['Button8']), isDown: () => false });
assert.equal(padGame.api.isEquipped(), false, 'controller menu input stows the spyglass');
assert.equal(padGame.claim, null, 'controller menu input releases Action 1 claim');

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
ranged.update(1 / 60);
assert.ok(nativeCamera.fov > 14 && nativeCamera.fov < 23, 'first lowered frame eases from 14° without jumping immediately to 34° ranged focus');
for (let frame = 0; frame < 35; frame++) ranged.update(.1);
assert.ok(Math.abs(nativeCamera.fov - 55) < 0.05, 'lowered spyglass smoothly restores 55° normal FOV');
assert.ok(nativeCamera.updates > 1, 'optical zoom updates native camera projection');
console.log('Utility spyglass: arch wiring, input claims, camera restoration and optical FOV passed.');
