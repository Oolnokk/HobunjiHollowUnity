const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const bridgeSource = fs.readFileSync(path.join(root, 'docs/js/controller-modern-flow-bridge.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'docs/js/combat/combat-config-loader.js'), 'utf8');
assert.doesNotThrow(() => new vm.Script(bridgeSource), 'controller modern flow bridge parses');
assert.match(loaderSource, /controller-modern-flow-bridge\.js\?v=20260915a/, 'runtime bootstrap loads the controller modern-flow bridge');

const FLOW_SELECTOR = '#ob-overlay, #hobunjiDayProgressReview, .time-passage-backdrop';
const BACK_SELECTOR = '#slBackToCharacter, #slBackToSource, #ob-back-btn';
class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.nodeType = 1;
    this.attrs = new Set();
    this.classList = { contains: name => this.kind === 'review' && name === 'open' };
    this.dataset = {};
  }
  matches(selector) {
    if (selector === FLOW_SELECTOR) return ['onboarding', 'review', 'passage'].includes(this.kind);
    if (selector === '#ob-overlay') return this.kind === 'onboarding';
    if (selector === '.time-passage-backdrop') return this.kind === 'passage';
    return false;
  }
  querySelectorAll(selector) {
    if (this.kind === 'document' && selector === FLOW_SELECTOR) return [onboarding, review, passage];
    if (this.kind === 'onboarding' && selector === BACK_SELECTOR) return [backButton];
    return [];
  }
  querySelector(selector) {
    if (this.kind === 'passage' && selector === '#timePassageCancel') return passageCancel;
    if (this.kind === 'passage' && selector === '#timePassageSlider') return passageSlider;
    if (this.kind === 'review' && selector === '#dayReviewContinue') return reviewContinue;
    return null;
  }
  closest() { return null; }
  hasAttribute(name) { return this.attrs.has(name); }
  setAttribute(name) { this.attrs.add(name); }
  dispatchEvent(event) { if (this.kind === 'review' && event.type === 'pointerdown') reviewFastForward += 1; return true; }
}

const documentElement = new FakeNode('document');
const onboarding = new FakeNode('onboarding');
onboarding.id = 'ob-overlay';
const review = new FakeNode('review');
review.id = 'hobunjiDayProgressReview';
const passage = new FakeNode('passage');
const backButton = new FakeNode('button');
const passageCancel = new FakeNode('button');
const passageSlider = new FakeNode('slider');
const reviewContinue = new FakeNode('button');
reviewContinue.classList = { contains: () => false };
const waitButton = new FakeNode('button');
waitButton.dataset.action = 'calendar_wait';
waitButton.classList = { contains: () => false };

let subscriber = null;
let subscriberPriority = null;
let owner = 'gameplay';
let reviewOpen = true;
let reviewFastForward = 0;
let waitOpened = 0;
const document = {
  documentElement,
  getElementById(id) {
    if (id === 'ob-overlay') return onboarding;
    if (id === 'hobunjiDayProgressReview') return reviewOpen ? review : null;
    if (id === 'btnAction2') return waitButton;
    return null;
  },
  querySelector(selector) { return selector === '.time-passage-backdrop' ? passage : null; },
};
class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
const window = {
  InputBindings: {
    getCurrentBindings: () => ({ controller: { uiConfirm: 'Button0', action2: 'LeftTrigger' } }),
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

const context = { window, document, Event, console, Object, Number, Boolean, Math };
vm.createContext(context);
vm.runInContext(bridgeSource, context);
window.ControllerModernFlowBridge.refresh();
assert.equal(onboarding.hasAttribute('data-ctrl-panel'), true, 'onboarding is opted into universal controller navigation');
assert.equal(backButton.hasAttribute('data-ctrl-cancel'), true, 'onboarding Back buttons are mapped to controller cancel');
assert.equal(review.hasAttribute('data-ctrl-panel'), true, 'midnight review is opted into universal controller navigation');
assert.equal(passage.hasAttribute('data-ctrl-panel'), true, 'Wait/Sleep modal is opted into universal controller navigation');
assert.equal(passageCancel.hasAttribute('data-ctrl-cancel'), true, 'B maps to the existing Wait/Sleep Cancel button');
assert.equal(passageSlider.hasAttribute('data-ctrl-default'), true, 'Wait/Sleep duration slider receives initial controller focus');
assert.equal(subscriberPriority, 9, 'context bridge runs immediately before menu navigation');

subscriber({ focused: true, pad: {}, pressed: new Set(['Button0']) });
assert.equal(reviewFastForward, 1, 'uiConfirm fast-forwards a staged midnight review');
assert.equal(waitOpened, 0, 'day review owns its confirm frame');
reviewOpen = false;
subscriber({ focused: true, pad: {}, pressed: new Set(['LeftTrigger']) });
assert.equal(waitOpened, 1, 'remapped Action 2 opens seated Wait');
assert.equal(owner, 'menu', 'Wait claims controller ownership before gameplay can reuse Action 2');

console.log('controller modern flow bridge regression checks passed');
