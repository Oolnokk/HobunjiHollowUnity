const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(root, 'docs/js/controller-modern-flow-bridge.js'), 'utf8');
const navSource = fs.readFileSync(path.join(root, 'docs/js/controller-ui-nav.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'docs/js/combat/combat-config-loader.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(bridgeSource), 'controller modern flow bridge parses');
assert.doesNotThrow(() => new vm.Script(navSource), 'controller UI navigator parses');
assert.match(loaderSource, /controller-modern-flow-bridge\.js\?v=20260915a/, 'runtime bootstrap loads the controller modern-flow bridge');
assert.ok(bridgeSource.includes('!frame.pressed?.size'), 'compatibility bridge does no DOM/binding work on idle controller frames');
assert.match(navSource, /SEMANTIC_PANEL_SELECTOR\s*=\s*'\[role="dialog"\]\[aria-modal="true"\]'/, 'semantic modal dialogs are auto-discovered for controller navigation');
assert.match(navSource, /CONE_HALF_ANGLE/, 'menu navigation defines a narrow intent cone');
assert.match(navSource, /WIDE_CONE_HALF_ANGLE/, 'menu navigation has a forgiving cone fallback before the forward half-plane');
assert.match(navSource, /pollStickVector\(rawAx, rawAy, now\)/, 'analog menu navigation uses the physical stick vector once per gesture');
assert.match(navSource, /navigateVector:\s*\(x, y\)/, 'vector navigation exposes an in-game/headless diagnostic seam');
assert.doesNotMatch(navSource, /pollDirection\('left',\s*rawAx/, 'analog X no longer fires an independent left cardinal navigation pass');
assert.doesNotMatch(navSource, /pollDirection\('up',\s*rawAy/, 'analog Y no longer fires an independent up cardinal navigation pass');

const FLOW_SELECTOR = '#ob-overlay, #hobunjiDayProgressReview, .time-passage-backdrop, #troughPanelOverlay, #npcWardrobeOverlay';
const BACK_SELECTOR = '#slBackToCharacter, #slBackToSource, #ob-back-btn';
class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.nodeType = 1;
    this.attrs = new Map();
    this.dataset = {};
    this.events = [];
    this.classList = { contains: name => this.kind === 'review' && name === 'open' };
  }
  matches(selector) {
    if (selector === FLOW_SELECTOR) return ['onboarding', 'review', 'passage', 'trough', 'wardrobe'].includes(this.kind);
    if (selector === '#ob-overlay') return this.kind === 'onboarding';
    if (selector === '.time-passage-backdrop') return this.kind === 'passage';
    if (selector === '#troughPanelOverlay') return this.kind === 'trough';
    if (selector === '#npcWardrobeOverlay') return this.kind === 'wardrobe';
    return false;
  }
  querySelectorAll(selector) {
    if (this.kind === 'document' && selector === FLOW_SELECTOR) return [onboarding, review, passage, trough, wardrobe];
    if (this.kind === 'onboarding' && selector === BACK_SELECTOR) return [backButton];
    return [];
  }
  querySelector(selector) {
    if (this.kind === 'passage' && selector === '#timePassageCancel') return passageCancel;
    if (this.kind === 'passage' && selector === '#timePassageSlider') return passageSlider;
    if (this.kind === 'review' && selector === '#dayReviewContinue') return reviewContinue;
    if (this.kind === 'trough' && selector === '#troughPanelClose') return troughClose;
    if (this.kind === 'wardrobe' && selector === '#npcWardrobeClose') return wardrobeClose;
    return null;
  }
  closest() { return null; }
  hasAttribute(name) { return this.attrs.has(name); }
  setAttribute(name, value = '') { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 40, height: 30 }; }
  dispatchEvent(event) {
    this.events.push(event);
    if (this.kind === 'review' && event.type === 'pointerdown') reviewFastForward += 1;
    return true;
  }
}

const documentElement = new FakeNode('document');
const onboarding = new FakeNode('onboarding');
onboarding.id = 'ob-overlay';
const review = new FakeNode('review');
review.id = 'hobunjiDayProgressReview';
const passage = new FakeNode('passage');
const trough = new FakeNode('trough');
trough.id = 'troughPanelOverlay';
const wardrobe = new FakeNode('wardrobe');
wardrobe.id = 'npcWardrobeOverlay';
const backButton = new FakeNode('button');
const passageCancel = new FakeNode('button');
const passageSlider = new FakeNode('slider');
const troughClose = new FakeNode('button');
const wardrobeClose = new FakeNode('button');
const reviewContinue = new FakeNode('button');
reviewContinue.classList = { contains: () => false };
const waitButton = new FakeNode('button');
waitButton.dataset.action = 'calendar_wait';
waitButton.classList = { contains: () => false };
const wardrobeActionButton = new FakeNode('button');
wardrobeActionButton.id = 'btnAction3';
wardrobeActionButton.dataset.action = 'npc_open_wardrobe';
wardrobeActionButton.classList = { contains: () => false };

let subscriber = null;
let subscriberPriority = null;
let owner = 'gameplay';
let reviewOpen = true;
let reviewFastForward = 0;
let waitOpened = 0;
let domLookupCount = 0;
let bindingReadCount = 0;
const document = {
  documentElement,
  getElementById(id) {
    domLookupCount += 1;
    if (id === 'ob-overlay') return onboarding;
    if (id === 'hobunjiDayProgressReview') return reviewOpen ? review : null;
    if (id === 'troughPanelOverlay') return trough;
    if (id === 'npcWardrobeOverlay') return wardrobe;
    if (id === 'btnAction2') return waitButton;
    if (id === 'btnAction3') return wardrobeActionButton;
    return null;
  },
  querySelector(selector) {
    domLookupCount += 1;
    return selector === '.time-passage-backdrop' ? passage : null;
  },
};
class Event {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
}
class PointerEvent extends Event {
  constructor(type, init = {}) { super(type, init); }
}
const window = {
  InputBindings: {
    getCurrentBindings: () => {
      bindingReadCount += 1;
      return { controller: { uiConfirm: 'Button0', action2: 'LeftTrigger', action3: 'Button2' } };
    },
    getDefaultBindings: () => ({}),
  },
  ControllerInput: {
    PRIORITY: { menuNav: 10 },
    get owner() { return owner; },
    setOwner(next) { owner = next; },
    subscribe(name, fn, priority) {
      assert.equal(name, 'controller-modern-flow-bridge');
      subscriber = fn;
      subscriberPriority = priority;
      return () => {};
    },
  },
  ControllerUI: { isActive: () => false, activePanel: () => null },
  CalendarSystem: { openTimePassage: kind => { assert.equal(kind, 'wait'); waitOpened += 1; return true; } },
};

const context = { window, document, Event, PointerEvent, console, Object, Number, Boolean, Math };
vm.createContext(context);
vm.runInContext(bridgeSource, context);
window.ControllerModernFlowBridge.refresh();
assert.equal(window.ControllerModernFlowBridge.version, 2, 'expanded compatibility bridge reports version 2');
assert.equal(onboarding.hasAttribute('data-ctrl-panel'), true, 'onboarding is opted into universal controller navigation');
assert.equal(backButton.hasAttribute('data-ctrl-cancel'), true, 'onboarding Back buttons are mapped to controller cancel');
assert.equal(review.hasAttribute('data-ctrl-panel'), true, 'midnight review is opted into universal controller navigation');
assert.equal(passage.hasAttribute('data-ctrl-panel'), true, 'Wait/Sleep modal is opted into universal controller navigation');
assert.equal(passageCancel.hasAttribute('data-ctrl-cancel'), true, 'B maps to the existing Wait/Sleep Cancel button');
assert.equal(passageSlider.hasAttribute('data-ctrl-default'), true, 'Wait/Sleep duration slider receives initial controller focus');
assert.equal(trough.hasAttribute('data-ctrl-panel'), true, 'trough storage overlay is controller navigable');
assert.equal(trough.getAttribute('role'), 'dialog', 'legacy trough overlay receives semantic dialog metadata');
assert.equal(trough.getAttribute('aria-modal'), 'true', 'legacy trough overlay is marked modal');
assert.equal(troughClose.hasAttribute('data-ctrl-cancel'), true, 'B closes the trough overlay');
assert.equal(wardrobe.hasAttribute('data-ctrl-panel'), true, 'NPC wardrobe overlay is controller navigable');
assert.equal(wardrobe.getAttribute('role'), 'dialog', 'legacy wardrobe overlay receives semantic dialog metadata');
assert.equal(wardrobeClose.hasAttribute('data-ctrl-cancel'), true, 'B closes the NPC wardrobe overlay');
assert.equal(subscriberPriority, 9, 'context bridge runs immediately before menu navigation');

const idleDomBefore = domLookupCount;
const idleBindingsBefore = bindingReadCount;
subscriber({ focused: true, pad: {}, pressed: new Set() });
assert.equal(domLookupCount, idleDomBefore, 'idle shared controller frames do not query the DOM through the compatibility bridge');
assert.equal(bindingReadCount, idleBindingsBefore, 'idle shared controller frames do not resolve bindings through the compatibility bridge');

subscriber({ focused: true, pad: {}, pressed: new Set(['Button0']) });
assert.equal(reviewFastForward, 1, 'uiConfirm fast-forwards a staged midnight review');
assert.equal(waitOpened, 0, 'day review owns its confirm frame');
reviewOpen = false;
subscriber({ focused: true, pad: {}, pressed: new Set(['LeftTrigger']) });
assert.equal(waitOpened, 1, 'remapped Action 2 opens seated Wait');
assert.equal(owner, 'menu', 'Wait claims controller ownership before gameplay can reuse Action 2');

owner = 'gameplay';
subscriber({ focused: true, pad: {}, pressed: new Set(['Button2']) });
const routedPointerEvents = wardrobeActionButton.events.filter(event => event.type === 'pointerdown' || event.type === 'pointerup');
assert.deepEqual(routedPointerEvents.map(event => event.type), ['pointerdown', 'pointerup'], 'rendered controller action routes through the wardrobe pointer-owned button path');
assert.equal(routedPointerEvents[0].pointerId, routedPointerEvents[1].pointerId, 'synthetic contextual tap keeps one pointer id across down/up');

wardrobeActionButton.events.length = 0;
wardrobeActionButton.dataset.action = 'future_pointer_action';
window.ControllerModernFlowBridge.registerPointerOnlyAction('future_pointer_action');
subscriber({ focused: true, pad: {}, pressed: new Set(['Button2']) });
assert.deepEqual(wardrobeActionButton.events.map(event => event.type), ['pointerdown', 'pointerup'], 'future pointer-owned contextual actions can register without adding another controller polling loop');

console.log('controller modern flow bridge regression checks passed');