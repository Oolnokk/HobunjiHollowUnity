// Node regression for spyglass action-arch toggles, input interruption, perception and optical focus.
'use strict';
const assert = require('node:assert/strict'); // Verifies the production modules' state transitions and camera effects.
const fs = require('node:fs'); // Reads the actual game modules under test.
const vm = require('node:vm'); // Executes browser-owned modules inside isolated window/document stubs.

const spyglassScript = fs.readFileSync('docs/js/utility-spyglass.js', 'utf8'); // The feature and input-claim owner.
const focusScript = fs.readFileSync('docs/js/combat/ranged-camera-focus.js', 'utf8'); // Existing shared camera FOV owner.
const arcScript = fs.readFileSync('docs/js/action-arc-ui.js', 'utf8'); // Utility-wheel integration point.
const perceptionScript = fs.readFileSync('docs/js/perception-mode.js', 'utf8'); // Shared perception and enemy-name list owner.
const css = fs.readFileSync('docs/utility-spyglass.css', 'utf8'); // Ensures the old standalone footer is gone.
const indexHtml = fs.readFileSync('docs/index.html', 'utf8'); // Verifies load order and cache-busted assets.

function element(tag = 'div') {
  const attrs = {}; // Small attribute store used by the action-arch and lens DOM fixtures.
  const node = {
    tag, id: '', className: '', textContent: '', innerHTML: '', parentNode: null, children: [], listeners: {}, dataset: {}, style: {},
    classList: {
      values: new Set(),
      toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); return !!enabled; },
      add(name) { this.values.add(name); },
      remove(name) { this.values.delete(name); },
      contains(name) { return this.values.has(name); },
    },
    addEventListener(name, handler) { (this.listeners[name] || (this.listeners[name] = [])).push(handler); },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    insertBefore(child, before) {
      child.parentNode = this;
      const index = before ? this.children.indexOf(before) : -1;
      if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
      return child;
    },
    get firstChild() { return this.children[0] || null; },
    get nextSibling() {
      if (!this.parentNode) return null;
      const index = this.parentNode.children.indexOf(this);
      return this.parentNode.children[index + 1] || null;
    },
    querySelector(selector) {
      const className = selector.startsWith('.') ? selector.slice(1) : null;
      return className ? this.children.find(child => child.className.split(/\s+/).includes(className)) || null : null;
    },
    closest(selector) { return selector === '#btnAction1' && this.id === 'btnAction1' ? this : null; },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; },
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    },
  };
  return node;
}

function environment() {
  const browserEvents = {}; // Captures window blur/scene transitions.
  const documentEvents = {}; // Captures keyboard, pointer and visibility listeners.
  const body = element('body');
  const stack = element('div'); stack.id = 'actionStack';
  const actionButton = element('button'); actionButton.id = 'btnAction1';
  actionButton.dataset.action = 'attack'; actionButton.dataset.combatSlot = 'action1';
  actionButton.classList.add('combat-dual-input');
  actionButton.setAttribute('aria-label', 'Primary action');
  stack.appendChild(actionButton);
  const canvas = element('canvas'); canvas.id = 'threeContainer';
  canvas.contains = target => target === canvas;
  let menuOpen = false;
  const bindings = { desktop: { action1: 'Mouse0' }, controller: { action1: 'RightTrigger', uiOpenMenu: 'Button8' } };
  let controllerHandler = null;
  const document = {
    readyState: 'complete', body, activeElement: null, hidden: false, createElement: element,
    getElementById(id) {
      if (id === 'threeContainer') return canvas;
      if (id === 'actionStack') return stack;
      if (id === 'btnAction1') return actionButton;
      if (id === 'menuPanel') return { classList: { contains: () => menuOpen } };
      return null;
    },
    addEventListener(name, fn) { (documentEvents[name] || (documentEvents[name] = [])).push(fn); },
  };
  let mode = 'default';
  let target = 'animal';
  let characterView = true;
  let heldMode = 'tool';
  let claim = null;
  let pressedClaim = false;
  let cameraChangeAllowed = true;
  let perceptionActive = false;
  let clock = 0;
  const fishing = { init() {} };
  const actionArc = { init() {}, stowForCarry() { heldMode = null; } };
  const window = {
    Fishing: fishing,
    ActionArcUI: actionArc,
    WorldActionInputClaims: {
      setClaims(ownerId, claims) { claim = { ...claims[0], ownerId }; },
      clearClaims(ownerId) { if (claim?.ownerId === ownerId) claim = null; },
      claimFor() { return claim; },
      snapshot() { return { pressed: pressedClaim && claim ? [{ ownerId: claim.ownerId, actionId: 'action1' }] : [] }; },
      dispatch(actionId, phase = 'press', detail = null) {
        if (actionId !== 'action1' || !claim) return false;
        if (phase === 'release' || phase === 'cancel') {
          pressedClaim = false;
          claim.onRelease?.(detail);
          return true;
        }
        if (pressedClaim) return true;
        pressedClaim = true;
        claim.onPress?.(detail);
        return true;
      },
    },
    ControllerInput: { subscribe(_name, handler) { controllerHandler = handler; } },
    InputBindings: { getCurrentBindings: () => bindings },
    PerceptionMode: {
      isActive: () => perceptionActive,
      setActive(value) { perceptionActive = !!value; return perceptionActive; },
    },
    ShoulderCamPointerLock: { request() {} },
    addEventListener(name, fn) { (browserEvents[name] || (browserEvents[name] = [])).push(fn); },
    __farmLog() {},
  };
  const cameraDeps = {
    getCameraMode: () => mode,
    setCameraMode(value) { if (cameraChangeAllowed) mode = value; },
    getCameraTarget: () => target,
    setCameraTarget(value) { target = value; },
  };
  const viewDeps = {
    getHeldMode: () => heldMode,
    characterViewMode: { get enabled() { return characterView; } },
    setCharacterViewMode(value) { characterView = !!value; },
  };
  vm.runInNewContext(spyglassScript, { window, document, performance: { now: () => clock } });
  fishing.init(cameraDeps);
  actionArc.init(viewDeps);
  return {
    api: window.Spyglass, window, document, body, stack, actionButton, canvas, browserEvents, documentEvents,
    emitDocument(name, event) { for (const fn of documentEvents[name] || []) fn(event); },
    controllerFrame(frame) { controllerHandler?.(frame); },
    setBinding(device, code) { bindings[device].action1 = code; },
    setMenuOpen(value) { menuOpen = value; },
    advance(ms = 100) { clock += ms; },
    get mode() { return mode; },
    get target() { return target; },
    get characterView() { return characterView; },
    get claim() { return claim; },
    get perceptionActive() { return perceptionActive; },
    setPerception(value) { perceptionActive = !!value; },
    setHeldMode(value) { heldMode = value; },
    setCameraChangeAllowed(value) { cameraChangeAllowed = value; },
  };
}

assert.match(arcScript, /id: 'spyglass'.*icon: '🔭'/, 'utility arch must display the spyglass');
assert.match(arcScript, /selectedSpyglass && window\.Spyglass\?\.isEquipped\?\.\(\)[\s\S]*ShoulderCamPointerLock/, 'mouse-look is requested after utility arch cleanup');
assert.match(indexHtml, /utility-spyglass\.css\?v=/, 'spyglass styling must load');
assert.match(indexHtml, /js\/utility-spyglass\.js\?v=/, 'spyglass module must load');
assert.ok(indexHtml.indexOf('js/utility-spyglass.js') < indexHtml.indexOf('src="game.js'), 'spyglass captures camera dependencies before gameplay initializes');
assert.match(css, /#btnAction1\.spyglass-action-visible/, 'spyglass prompt uses the standard Action 1 arch button');
assert.doesNotMatch(css, /#spyglassHud|Hold to Look|Put Away Spyglass/, 'the standalone how-to/footer and hold controls are removed');
assert.match(perceptionScript, /spyglass-enemy:/, 'close perception adds named hostile info lists');
assert.match(perceptionScript, /creature\.name \|\| creature\.def\?\.label/, 'enemy labels prefer their individual name and fall back to species label');

const game = environment(); // Main equipment and three-stage Action 1 cycle fixture.
assert.equal(game.api.equip(), true, 'utility spyglass equips');
assert.equal(game.mode, 'shoulderSurf', 'spyglass switches to existing free-look camera');
assert.equal(game.characterView, false, 'Character View gives way to shoulder look');
assert.equal(game.target, null, 'previous camera target is cleared while the spyglass is selected');
assert.equal(game.api.getDebug().ownsAction1, true, 'Action 1 belongs exclusively to spyglass');
assert.equal(game.actionButton.classList.contains('spyglass-action-visible'), true, 'normal Action 1 arch button is exposed');
assert.equal(game.actionButton.dataset.action, 'spyglass', 'Action 1 leaves combat-attack presentation while the spyglass owns it');
assert.equal(game.actionButton.dataset.combatSlot, undefined, 'the temporary spyglass action is not decorated as a combat slot');
assert.equal(game.actionButton.classList.contains('combat-dual-input'), false, 'the attack coin presentation is removed while the spyglass owns Action 1');
assert.equal(game.actionButton.querySelector('.spyglass-action-label').textContent, 'Raise Spyglass', 'initial arch prompt says Raise Spyglass');

game.window.WorldActionInputClaims.dispatch('action1', 'press');
assert.equal(game.api.isAiming(), true, 'first Action 1 press raises the lens');
assert.equal(game.actionButton.querySelector('.spyglass-action-label').textContent, 'Look Closer', 'raised spyglass changes Action 1 to Look Closer');
game.window.WorldActionInputClaims.dispatch('action1', 'release');
assert.equal(game.api.isAiming(), true, 'releasing Action 1 does not lower the toggle');
game.advance();
game.window.WorldActionInputClaims.dispatch('action1', 'press');
assert.equal(game.api.isLookingCloser(), true, 'second Action 1 press enters Look Closer');
assert.equal(game.perceptionActive, true, 'Look Closer activates the shared perception effect');
assert.equal(game.actionButton.querySelector('.spyglass-action-label').textContent, 'Lower Spyglass', 'close-look state exposes a clear lower action');
game.window.WorldActionInputClaims.dispatch('action1', 'release');
game.advance();
game.window.WorldActionInputClaims.dispatch('action1', 'press');
assert.equal(game.api.isAiming(), false, 'third Action 1 press lowers the spyglass');
assert.equal(game.perceptionActive, false, 'lowering restores the prior perception state');
assert.equal(game.actionButton.querySelector('.spyglass-action-label').textContent, 'Raise Spyglass', 'lowered spyglass returns to the Raise prompt');
game.api.stow('test');
assert.equal(game.mode, 'default', 'original camera mode is restored');
assert.equal(game.characterView, true, 'original Character View is restored');
assert.equal(game.target, 'animal', 'original tracked camera target is restored');
assert.equal(game.claim, null, 'Action 1 input claim is released on stow');
assert.equal(game.actionButton.classList.contains('spyglass-action-visible'), false, 'normal Action 1 visibility is restored');
assert.equal(game.actionButton.getAttribute('aria-label'), 'Primary action', 'normal Action 1 accessibility label is restored');
assert.equal(game.actionButton.getAttribute('aria-pressed'), null, 'temporary pressed-state accessibility metadata is removed');
assert.equal(game.actionButton.dataset.action, 'attack', 'the prior contextual Action 1 action is restored');
assert.equal(game.actionButton.dataset.combatSlot, 'action1', 'the prior combat-slot marker is restored');
assert.equal(game.actionButton.classList.contains('combat-dual-input'), true, 'the prior attack coin styling is restored after stowing');

const preservePerception = environment(); // Existing perception should not be disabled when spyglass look mode ends.
preservePerception.setPerception(true);
preservePerception.api.equip();
preservePerception.api.action1Press();
preservePerception.advance();
preservePerception.api.action1Press();
assert.equal(preservePerception.perceptionActive, true);
preservePerception.api.endAim('lower');
assert.equal(preservePerception.perceptionActive, true, 'pre-existing perception remains enabled after lowering');

const cameraFailure = environment(); // Failed camera ownership must roll back without acquiring controls.
cameraFailure.setCameraChangeAllowed(false);
assert.equal(cameraFailure.api.equip(), false, 'equipment refuses failed camera switch');
assert.equal(cameraFailure.characterView, true, 'failed camera switch restores Character View');
assert.equal(cameraFailure.target, 'animal', 'failed camera switch restores camera target');
assert.equal(cameraFailure.claim, null, 'failed equip never acquires Action 1');

const mouseGame = environment(); // Action 1 mouse input works over the world even with no visible action button.
mouseGame.api.equip();
mouseGame.emitDocument('pointerdown', { pointerId: 31, pointerType: 'mouse', button: 0, target: mouseGame.canvas, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(mouseGame.api.isAiming(), true, 'scene mouse Action 1 raises the lens');
mouseGame.emitDocument('pointerdown', { pointerId: 32, pointerType: 'mouse', button: 2, target: mouseGame.canvas, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(mouseGame.api.isEquipped(), false, 'any non-Action-1 mouse input automatically stows the spyglass');

const keyboardGame = environment(); // Remapped Action 1 toggles; other keyboard input interrupts.
keyboardGame.api.equip();
keyboardGame.setBinding('desktop', 'KeyF');
keyboardGame.emitDocument('keydown', { code: 'KeyF', repeat: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(keyboardGame.api.isAiming(), true, 'remapped keyboard Action 1 raises the lens');
keyboardGame.emitDocument('keydown', { code: 'KeyW', repeat: false, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(keyboardGame.api.isEquipped(), false, 'movement/other keyboard input stows the spyglass');

const touchGame = environment(); // Touch uses the normal action-arch button, not a separate bottom HUD.
touchGame.api.equip();
const touchEvent = { pointerType: 'touch', target: touchGame.actionButton, preventDefault() {}, stopImmediatePropagation() {} };
touchGame.emitDocument('pointerdown', touchEvent);
assert.equal(touchGame.api.isAiming(), true, 'touching Action 1 raises the spyglass');
assert.equal(touchGame.api.isEquipped(), true, 'Action 1 touch does not stow the spyglass');
touchGame.emitDocument('pointerdown', { pointerType: 'touch', target: touchGame.canvas, preventDefault() {}, stopImmediatePropagation() {} });
assert.equal(touchGame.api.isEquipped(), false, 'other touch input stows the spyglass');

const padGame = environment(); // Controller Action 1 toggles and any other controller button interrupts.
padGame.api.equip();
padGame.controllerFrame({ focused: true, pad: {}, down: new Set(['RightTrigger']), pressed: new Set(['RightTrigger']), isDown: name => name === 'RightTrigger' });
assert.equal(padGame.api.isAiming(), true, 'controller Action 1 raises the lens');
padGame.window.WorldActionInputClaims.dispatch('action1', 'press');
assert.equal(padGame.api.isAiming(), true, 'shared controller claim and direct frame observer cannot double-toggle Action 1');
padGame.window.WorldActionInputClaims.dispatch('action1', 'release');
padGame.controllerFrame({ focused: true, pad: {}, down: new Set(), pressed: new Set(['Button1']), isDown: () => false });
assert.equal(padGame.api.isEquipped(), false, 'controller dodge/other button stows the spyglass');
assert.equal(padGame.claim, null, 'controller interruption releases the Action 1 claim');
const movingPadGame = environment();
movingPadGame.api.equip();
movingPadGame.controllerFrame({ focused: true, pad: {}, down: new Set(), pressed: new Set(['RightStickRight']), move: { magnitude: 0 }, look: { magnitude: 0.4 }, isDown: () => false });
assert.equal(movingPadGame.api.isEquipped(), true, 'right-stick camera look remains available while the spyglass is raised');
movingPadGame.controllerFrame({ focused: true, pad: {}, down: new Set(), pressed: new Set(), move: { magnitude: 0.4 }, look: { magnitude: 0 }, isDown: () => false });
assert.equal(movingPadGame.api.isEquipped(), false, 'left-stick movement stows the spyglass');
const heldItemGame = environment();
heldItemGame.api.equip();
heldItemGame.setHeldMode('item');
heldItemGame.api.update();
assert.equal(heldItemGame.api.isEquipped(), false, 'taking an item out stows the spyglass');

const menuGame = environment();
menuGame.api.equip();
menuGame.setMenuOpen(true);
menuGame.api.update();
assert.equal(menuGame.api.isEquipped(), false, 'opening the game menu puts the spyglass away');
const blurGame = environment();
blurGame.api.equip();
for (const fn of blurGame.browserEvents.blur || []) fn();
assert.equal(blurGame.api.isEquipped(), false, 'focus loss stows the spyglass safely');

let aiming = false; // Mock raised-lens state supplied to the existing ranged focus authority.
let lookingCloser = false; // Mock the second spyglass state independently of ordinary ranged focus.
const nativeCamera = { fov: 55, updates: 0, updateProjectionMatrix() { this.updates++; } };
const ranged = { update() {}, init() {}, equippedRangedKey() { return null; }, config: {} };
const focusWindow = {
  SCRATCHBONES_CONFIG: { game: { camera: { modes: { shoulderSurf: { fovDeg: 55 } } } } },
  RangedWeapons: ranged,
  Spyglass: { isAiming: () => aiming, isLookingCloser: () => lookingCloser, update() {} },
  addEventListener() {},
  __farmLog() {},
};
vm.runInNewContext(focusScript, { window: focusWindow, document: game.document });
ranged.init({ getActiveCamera: () => nativeCamera });
for (let frame = 0; frame < 35; frame++) ranged.update(.1);
assert.ok(Math.abs(nativeCamera.fov - 55) < 0.05, 'normal camera FOV remains unchanged before the spyglass is raised');
aiming = true;
for (let frame = 0; frame < 35; frame++) ranged.update(.1);
assert.ok(Math.abs(nativeCamera.fov - 14) < 0.05, 'raised spyglass eases to its 14° optical zoom');
lookingCloser = true;
for (let frame = 0; frame < 35; frame++) ranged.update(.1);
assert.ok(Math.abs(nativeCamera.fov - 12.5) < 0.05, 'Look Closer eases to the small additional 12.5° zoom');
lookingCloser = false;
aiming = false;
ranged.update(1 / 60);
assert.ok(nativeCamera.fov > 12.5 && nativeCamera.fov < 23, 'lowering starts a smooth FOV restoration');
for (let frame = 0; frame < 35; frame++) ranged.update(.1);
assert.ok(Math.abs(nativeCamera.fov - 55) < 0.05, 'lowered spyglass smoothly restores the authored camera FOV');
assert.ok(nativeCamera.updates > 1, 'optical zoom updates the native camera projection');
console.log('Utility spyglass: action-arch toggle cycle, input interruption, perception and optical zoom passed.');
