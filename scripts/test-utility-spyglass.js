// Node regression for Action 2 spyglass toggle, Action 1 held zoom, interruption and optical focus.
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
    closest(selector) { return selector === '#' + this.id ? this : null; },
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

function environment({ deferredArch = false } = {}) {
  let domReady = !deferredArch; // Reproduces the head-loaded spyglass script before action-arch markup exists.
  let actionObserver = null; // Captures the MutationObserver callback for action-bar rebuild regressions.
  const browserEvents = {}; // Captures window blur/scene transitions.
  const documentEvents = {}; // Captures keyboard, pointer and visibility listeners.
  const body = element('body');
  const stack = element('div'); stack.id = 'actionStack';
  const actionButton = element('button'); actionButton.id = 'btnAction1';
  actionButton.dataset.action = 'attack'; actionButton.dataset.combatSlot = 'action1';
  actionButton.classList.add('combat-dual-input');
  actionButton.setAttribute('aria-label', 'Primary action');
  stack.appendChild(actionButton);
  const action2Button = element('button'); action2Button.id = 'btnAction2'; // Normal second item/action arch slot.
  action2Button.dataset.action = 'alternate'; action2Button.dataset.combatSlot = 'action2';
  action2Button.setAttribute('aria-label', 'Secondary action');
  stack.appendChild(action2Button);
  const canvas = element('canvas'); canvas.id = 'threeContainer';
  canvas.contains = target => target === canvas;
  let menuOpen = false;
  const bindings = { desktop: { action1: 'Mouse0', action2: 'Mouse2' }, controller: { action1: 'RightTrigger', action2: 'LeftTrigger', uiOpenMenu: 'Button8' } };
  let controllerHandler = null;
  const document = {
    readyState: deferredArch ? 'loading' : 'complete', body, activeElement: null, hidden: false, createElement: element,
    getElementById(id) {
      if (id === 'threeContainer') return canvas;
      if (id === 'actionStack') return domReady ? stack : null;
      if (id === 'btnAction1') return domReady ? actionButton : null;
      if (id === 'btnAction2') return domReady ? action2Button : null;
      if (id === 'menuPanel') return { classList: { contains: () => menuOpen } };
      return null;
    },
    addEventListener(name, fn) { (documentEvents[name] || (documentEvents[name] = [])).push(fn); },
  };
  let mode = 'default';
  let target = 'animal';
  let characterView = true;
  let heldMode = 'tool';
  const claims = new Map(); // Tracks the two active claims per semantic action.
  const pressedClaims = new Set(); // Pairs each owned press with its own release.
  let cameraChangeAllowed = true;
  let perceptionActive = false;
  let clock = 0;
  const fishing = { init() {} };
  const actionArc = { init() {}, stowForCarry() { heldMode = null; } };
  const window = {
    Fishing: fishing,
    ActionArcUI: actionArc,
    WorldActionInputClaims: {
      setClaims(ownerId, newClaims) {
        for (const entry of newClaims) claims.set(entry.actionId, { ...entry, ownerId });
      },
      clearClaims(ownerId) {
        for (const [id, entry] of claims) if (entry.ownerId === ownerId) claims.delete(id);
      },
      claimFor(actionId) { return claims.get(actionId) || null; },
      snapshot() {
        return { pressed: [...pressedClaims].map(actionId => ({
          actionId, ownerId: claims.get(actionId)?.ownerId,
        })) };
      },
      dispatch(actionId, phase = 'press', detail = null) {
        const claim = claims.get(actionId);
        if (!claim) return false;
        if (phase === 'release' || phase === 'cancel') {
          if (!pressedClaims.delete(actionId)) return false;
          claim.onRelease?.(detail);
          return true;
        }
        if (pressedClaims.has(actionId)) return true;
        pressedClaims.add(actionId);
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
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target) { if (target === stack) actionObserver = this; }
  }
  vm.runInNewContext(spyglassScript, { window, document, MutationObserver: FakeMutationObserver, performance: { now: () => clock } });
  fishing.init(cameraDeps);
  actionArc.init(viewDeps);
  return {
    api: window.Spyglass, window, document, body, stack, actionButton, action2Button, canvas, browserEvents, documentEvents,
    emitDocument(name, event) {
      if (name === 'DOMContentLoaded') domReady = true;
      for (const fn of documentEvents[name] || []) fn(event);
    },
    fireActionMutation() { actionObserver?.callback(); },
    get observedArch() { return !!actionObserver; },
    controllerFrame(frame) { controllerHandler?.(frame); },
    setBinding(device, code, actionId = 'action1') { bindings[device][actionId] = code; },
    setMenuOpen(value) { menuOpen = value; },
    advance(ms = 100) { clock += ms; },
    get mode() { return mode; },
    get target() { return target; },
    get characterView() { return characterView; },
    get claim() { return claims.get('action1') || null; },
    get claim2() { return claims.get('action2') || null; },
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
assert.match(css, /#btnAction1\.spyglass-action-visible/, 'Action 1 uses the standard action arch');
assert.match(css, /#btnAction2\.spyglass-action-visible/, 'Action 2 uses the standard action arch');
assert.match(css, /spyglass-action-inactive/, 'Action 1 stays hidden until the lens is raised');
assert.doesNotMatch(css, /#spyglassHud|Hold to Look|Put Away Spyglass/, 'the standalone footer and hold controls remain removed');
assert.match(perceptionScript, /spyglass-enemy:/, 'close perception adds named hostile info lists');
assert.match(perceptionScript, /creature\.name \|\| creature\.def\?\.label/, 'enemy labels prefer their individual name');

const deferred = environment({ deferredArch: true }); // Regression: spyglass loads in <head>, before the action arch is parsed.
assert.equal(deferred.observedArch, false, 'observer cannot attach to a not-yet-created action arch');
deferred.emitDocument('DOMContentLoaded');
assert.equal(deferred.observedArch, true, 'observer attaches after DOMContentLoaded');
assert.equal(deferred.api.getDebug().actionObserverActive, true, 'mobile diagnostics report observer state');
deferred.api.equip();
deferred.actionButton.dataset.action = 'attack'; // Simulate a normal refreshActionBar overwriting spyglass presentation.
deferred.action2Button.dataset.action = 'alternate';
deferred.fireActionMutation();
assert.equal(deferred.actionButton.dataset.action, 'spyglass', 'Action 1 prompt is restored after ordinary action-bar refresh');
assert.equal(deferred.action2Button.dataset.action, 'spyglass', 'Action 2 prompt is restored after ordinary action-bar refresh');
deferred.api.stow();
assert.equal(deferred.actionButton.dataset.action, 'attack', 'newly assigned Action 1 context survives stow');
assert.equal(deferred.action2Button.dataset.action, 'alternate', 'newly assigned Action 2 context survives stow');

const game = environment(); // Action 2 toggles lens; Action 1 is held only for the closer view.
assert.equal(game.api.equip(), true, 'utility spyglass equips');
assert.equal(game.mode, 'shoulderSurf', 'spyglass switches to existing free-look camera');
assert.equal(game.characterView, false, 'Character View gives way to shoulder look');
assert.equal(game.target, null, 'previous camera target clears while equipped');
assert.equal(game.api.getDebug().ownsAction1, true, 'Action 1 is claimed');
assert.equal(game.api.getDebug().ownsAction2, true, 'Action 2 is claimed');
assert.equal(game.action2Button.dataset.action, 'spyglass', 'Action 2 replaces normal secondary combat presentation');
assert.equal(game.actionButton.dataset.action, 'spyglass', 'Action 1 replaces primary attack presentation');
assert.equal(game.actionButton.dataset.combatSlot, undefined, 'Action 1 temporarily clears combat slot');
assert.equal(game.actionButton.classList.contains('combat-dual-input'), false, 'attack coin is hidden');
assert.equal(game.actionButton.classList.contains('spyglass-action-inactive'), true, 'Look Closer unavailable while lowered');
assert.equal(game.action2Button.querySelector('.spyglass-action-label').textContent, 'Raise Spyglass', 'Action 2 initially raises');
game.window.WorldActionInputClaims.dispatch('action1', 'press');
assert.equal(game.api.isAiming(), false, 'Action 1 cannot raise the spyglass');
game.window.WorldActionInputClaims.dispatch('action1', 'release');

game.window.WorldActionInputClaims.dispatch('action2', 'press');
assert.equal(game.api.isAiming(), true, 'first Action 2 press raises the lens');
assert.equal(game.actionButton.classList.contains('spyglass-action-visible'), true, 'Action 1 appears when the lens is raised');
assert.equal(game.action2Button.querySelector('.spyglass-action-label').textContent, 'Lower Spyglass', 'Action 2 changes to Lower Spyglass');
game.api.action2Press('duplicate observer');
assert.equal(game.api.isAiming(), true, 'two observers of same Action 2 press cannot double-toggle');
game.window.WorldActionInputClaims.dispatch('action2', 'release');
assert.equal(game.api.isAiming(), true, 'Action 2 release leaves the lens raised');

game.window.WorldActionInputClaims.dispatch('action1', 'press');
assert.equal(game.api.isLookingCloser(), true, 'holding Action 1 enters Look Closer');
assert.equal(game.perceptionActive, true, 'close-look activates shared perception');
assert.equal(game.actionButton.getAttribute('aria-pressed'), 'true', 'Action 1 reports its held state');
game.window.WorldActionInputClaims.dispatch('action1', 'release');
assert.equal(game.api.isAiming(), true, 'Action 1 release does not lower the lens');
assert.equal(game.api.isLookingCloser(), false, 'Action 1 release exits Look Closer');
assert.equal(game.perceptionActive, false, 'Action 1 release restores perception');
game.advance();
game.window.WorldActionInputClaims.dispatch('action2', 'press');
assert.equal(game.api.isAiming(), false, 'second Action 2 press lowers the lens');
assert.equal(game.actionButton.classList.contains('spyglass-action-inactive'), true, 'Action 1 is hidden again');
assert.equal(game.action2Button.querySelector('.spyglass-action-label').textContent, 'Raise Spyglass', 'Action 2 prompt resets');
game.window.WorldActionInputClaims.dispatch('action2', 'release');
// Holding Action 1 is a physical state, not merely a press event; raising while held must enable zoom immediately.
game.window.WorldActionInputClaims.dispatch('action1', 'press');
assert.equal(game.api.getDebug().action1Held, true, 'Action 1 hold is tracked even while the lens is lowered');
assert.equal(game.api.isLookingCloser(), false, 'lowered lens never enters close-look');
game.advance();
game.window.WorldActionInputClaims.dispatch('action2', 'press');
assert.equal(game.api.isAiming(), true, 'Action 2 re-raises with Action 1 already held');
assert.equal(game.api.isLookingCloser(), true, 'already-held Action 1 immediately engages extra zoom');
assert.equal(game.perceptionActive, true, 'already-held Action 1 immediately activates perception');
game.window.WorldActionInputClaims.dispatch('action2', 'release');
game.advance();
game.window.WorldActionInputClaims.dispatch('action2', 'press');
assert.equal(game.api.isAiming(), false, 'Action 2 lowers while Action 1 remains physically held');
assert.equal(game.api.getDebug().action1Held, true, 'lowering lens does not erase the still-held Action 1');
assert.equal(game.api.isLookingCloser(), false, 'lowering ends close-look');
assert.equal(game.perceptionActive, false, 'lowering restores perception despite continuing Action 1 hold');
game.window.WorldActionInputClaims.dispatch('action2', 'release');
game.advance();
game.window.WorldActionInputClaims.dispatch('action2', 'press');
assert.equal(game.api.isLookingCloser(), true, 're-raising during the same Action 1 hold restores extra zoom');
game.window.WorldActionInputClaims.dispatch('action1', 'release');
assert.equal(game.api.getDebug().action1Held, false, 'Action 1 release clears held state');
assert.equal(game.api.isLookingCloser(), false, 'release restores base zoom after multiple lens toggles');
game.window.WorldActionInputClaims.dispatch('action2', 'release');
game.api.stow('test');
assert.equal(game.mode, 'default', 'camera mode restored');
assert.equal(game.characterView, true, 'Character View restored');
assert.equal(game.target, 'animal', 'tracked camera target restored');
assert.equal(game.claim, null, 'Action 1 claim released');
assert.equal(game.claim2, null, 'Action 2 claim released');
assert.equal(game.actionButton.classList.contains('spyglass-action-visible'), false, 'Action 1 visibility restored');
assert.equal(game.action2Button.classList.contains('spyglass-action-visible'), false, 'Action 2 visibility restored');
assert.equal(game.actionButton.getAttribute('aria-label'), 'Primary action', 'Action 1 label restored');
assert.equal(game.action2Button.getAttribute('aria-label'), 'Secondary action', 'Action 2 label restored');
assert.equal(game.actionButton.getAttribute('aria-pressed'), null, 'held-state aria restored');
assert.equal(game.actionButton.dataset.action, 'attack', 'primary action restored');
assert.equal(game.action2Button.dataset.action, 'alternate', 'secondary action restored');
assert.equal(game.actionButton.dataset.combatSlot, 'action1', 'primary combat slot restored');
assert.equal(game.action2Button.dataset.combatSlot, 'action2', 'secondary combat slot restored');
assert.equal(game.actionButton.classList.contains('combat-dual-input'), true, 'attack coin restored');

const preservePerception = environment(); // Close-look must not disable pre-existing perception.
preservePerception.setPerception(true);
preservePerception.api.equip();
preservePerception.api.action2Press();
preservePerception.api.action1Press();
preservePerception.api.action1Release();
assert.equal(preservePerception.perceptionActive, true, 'pre-existing perception remains active after hold ends');
preservePerception.advance();
preservePerception.api.action2Press();
assert.equal(preservePerception.perceptionActive, true, 'lowering lens preserves pre-existing perception');

const cameraFailure = environment(); // Failed camera ownership must never acquire controls.
cameraFailure.setCameraChangeAllowed(false);
assert.equal(cameraFailure.api.equip(), false, 'equipment refuses failed camera switch');
assert.equal(cameraFailure.characterView, true, 'failed camera switch restores Character View');
assert.equal(cameraFailure.target, 'animal', 'failed camera switch restores camera target');
assert.equal(cameraFailure.claim, null, 'failed equip never acquires Action 1');
assert.equal(cameraFailure.claim2, null, 'failed equip never acquires Action 2');

const mouseGame = environment(); // World mouse input obeys both default bindings and physical release.
mouseGame.api.equip();
const ptr = (pointerId, button, target = mouseGame.canvas) =>
  ({ pointerId, pointerType: 'mouse', button, target, preventDefault() {}, stopImmediatePropagation() {} });
mouseGame.emitDocument('pointerdown', ptr(31, 2));
assert.equal(mouseGame.api.isAiming(), true, 'right mouse Action 2 raises');
mouseGame.emitDocument('pointerdown', ptr(32, 0));
assert.equal(mouseGame.api.isLookingCloser(), true, 'left mouse Action 1 zooms closer');
mouseGame.emitDocument('pointerup', ptr(32, 0));
assert.equal(mouseGame.api.isAiming(), true, 'releasing left mouse retains lens');
assert.equal(mouseGame.api.isLookingCloser(), false, 'releasing left mouse restores normal spyglass zoom');
mouseGame.advance();
mouseGame.emitDocument('pointerdown', ptr(33, 2));
assert.equal(mouseGame.api.isAiming(), false, 'right mouse Action 2 lowers');

const keyboardGame = environment(); // Both independently remappable inputs must work on desktop.
keyboardGame.api.equip();
keyboardGame.setBinding('desktop', 'KeyQ', 'action2');
keyboardGame.setBinding('desktop', 'KeyF', 'action1');
const keyEvent = code => ({ code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopImmediatePropagation() {} });
keyboardGame.emitDocument('keydown', keyEvent('KeyQ'));
assert.equal(keyboardGame.api.isAiming(), true, 'remapped keyboard Action 2 raises');
keyboardGame.emitDocument('keyup', keyEvent('KeyQ'));
assert.equal(keyboardGame.api.isAiming(), true, 'remapped Action 2 keyup does not lower');
keyboardGame.emitDocument('keydown', keyEvent('KeyF'));
assert.equal(keyboardGame.api.isLookingCloser(), true, 'remapped Action 1 keydown zooms closer');
keyboardGame.emitDocument('keyup', keyEvent('KeyF'));
assert.equal(keyboardGame.api.isLookingCloser(), false, 'remapped Action 1 keyup ends zoom');
keyboardGame.emitDocument('keydown', keyEvent('KeyW'));
assert.equal(keyboardGame.api.isEquipped(), false, 'other keyboard input stows');

const touchGame = environment(); // Touch uses standard action-arch slots, no extra HUD.
touchGame.api.equip();
const touch = (pointerId, target) => ({ pointerId, pointerType: 'touch', target, preventDefault() {}, stopImmediatePropagation() {} });
touchGame.emitDocument('pointerdown', touch(71, touchGame.action2Button));
assert.equal(touchGame.api.isAiming(), true, 'touching Action 2 raises');
touchGame.emitDocument('pointerup', touch(71, touchGame.action2Button));
assert.equal(touchGame.api.isAiming(), true, 'touching Action 2 is a persistent toggle');
touchGame.emitDocument('pointerdown', touch(72, touchGame.actionButton));
assert.equal(touchGame.api.isLookingCloser(), true, 'touching Action 1 zooms closer');
touchGame.emitDocument('pointercancel', touch(72, touchGame.actionButton));
assert.equal(touchGame.api.isLookingCloser(), false, 'canceling Action 1 touch restores base zoom');
touchGame.emitDocument('pointerdown', touch(73, touchGame.canvas));
assert.equal(touchGame.api.isEquipped(), false, 'other touch input stows');

const padGame = environment(); // Controller triggers handle two actions independently.
padGame.api.equip();
const padFrame = (down, pressed = down, move = 0) => ({
  focused: true, pad: {}, down: new Set(down), pressed: new Set(pressed),
  move: { magnitude: move }, isDown: code => down.includes(code),
});
padGame.controllerFrame(padFrame(['LeftTrigger']));
assert.equal(padGame.api.isAiming(), true, 'left trigger Action 2 raises lens');
padGame.window.WorldActionInputClaims.dispatch('action2', 'press');
assert.equal(padGame.api.isAiming(), true, 'shared claim and controller frame cannot double-toggle');
padGame.window.WorldActionInputClaims.dispatch('action2', 'release');
padGame.controllerFrame(padFrame(['LeftTrigger', 'RightTrigger'], ['RightTrigger']));
assert.equal(padGame.api.isLookingCloser(), true, 'right trigger Action 1 zooms closer');
padGame.controllerFrame(padFrame(['LeftTrigger'], []));
assert.equal(padGame.api.isLookingCloser(), false, 'releasing right trigger restores base zoom');
padGame.controllerFrame(padFrame([], []));
assert.equal(padGame.api.isAiming(), true, 'releasing Action 2 does not lower');
padGame.controllerFrame(padFrame([], ['Button1']));
assert.equal(padGame.api.isEquipped(), false, 'controller dodge/other button stows');

const movingPadGame = environment();
movingPadGame.api.equip();
movingPadGame.controllerFrame(padFrame([], ['RightStickRight']));
assert.equal(movingPadGame.api.isEquipped(), true, 'right-stick look remains available');
movingPadGame.controllerFrame(padFrame([], [], 0.4));
assert.equal(movingPadGame.api.isEquipped(), false, 'left-stick movement stows');
const heldItemGame = environment();
heldItemGame.api.equip();
heldItemGame.setHeldMode('item');
heldItemGame.api.update();
assert.equal(heldItemGame.api.isEquipped(), false, 'selecting held item stows');

const menuGame = environment();
menuGame.api.equip();
menuGame.setMenuOpen(true);
menuGame.api.update();
assert.equal(menuGame.api.isEquipped(), false, 'game menu stows');
const blurGame = environment();
blurGame.api.equip();
blurGame.api.action2Press();
blurGame.api.action1Press();
for (const fn of blurGame.browserEvents.blur || []) fn();
assert.equal(blurGame.api.isEquipped(), false, 'focus loss stows');
assert.equal(blurGame.perceptionActive, false, 'focus loss restores perception');

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
console.log('Utility spyglass: Action 2 toggle, held Action 1, interruption, perception and optical zoom passed.');
