'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {}; // Isolated browser global for the shipped dismissal module.
const events = []; // Records Escape delivery and prevents fake DOM close handlers from being duplicated.
const context = { window, KeyboardEvent: class {
  constructor(type, options) { this.type = type; Object.assign(this, options); }
}};
vm.runInNewContext(fs.readFileSync('docs/js/controller-menu-dismissal.js', 'utf8'), context);
const policy = window.ControllerMenuDismissal; // Every assertion runs the exported production policy rather than duplicated rules.
assert.equal(typeof policy?.dismiss, 'function');

function button(label = '', attrs = {}) {
  const el = { textContent: label, clicks: 0, disabled: false, attributes: { ...attrs } }; // Minimal DOM button with real attribute priority.
  el.hasAttribute = name => Object.hasOwn(el.attributes, name);
  el.getAttribute = name => el.attributes[name] ?? null;
  el.matches = selector => selector === 'button, [role="button"]';
  el.click = () => { el.clicks++; };
  return el;
}

function panel(children) {
  return { querySelectorAll(selector) {
    assert.equal(selector, 'button, [role="button"], [data-ctrl-cancel]');
    return children; // Only valid dismissal candidates are returned by a real DOM selector.
  }};
}

const inferred = button('Close');
const explicitClipped = button('No matching label', { 'data-ctrl-cancel': '' });
const explicitVisible = button('Close', { 'data-ctrl-cancel': '' });
const otherAction = button('Close account permanently');
const wrongOwner = button('Close', { 'data-ctrl-cancel': '' });
const candidates = panel([inferred, explicitClipped, explicitVisible, otherAction, wrongOwner]);
const eligible = el => el !== wrongOwner && !el.disabled; // Simulates ControllerUI ownership and disabled filtering.
const onScreen = el => el !== explicitClipped; // Visible close beats one clipped inside a scrolling panel.

assert.equal(policy.isCloseControl(inferred), true);
assert.equal(policy.isCloseControl(otherAction), false, 'dangerous non-dismissal actions may not be inferred');
assert.equal(policy.findCloseControl(candidates, { isEligible: eligible, onScreen }), explicitVisible,
  'prefer an explicit on-screen cancel over inferred labels and clipped explicit controls');
assert.equal(policy.findCloseControl(candidates, { isEligible: eligible, onScreen: () => false }), explicitClipped,
  'a scroll-clipped explicit Cancel still works through Back');
assert.equal(policy.findCloseControl(panel([wrongOwner, inferred]), { isEligible: eligible, onScreen: () => true }), inferred,
  'a nested panel cannot steal the outer panel Back press');

const document = { dispatchEvent(event) { events.push(event); return true; } }; // Escape reaches listeners on document, not only window.
const opts = { isEligible: eligible, onScreen, targetDocument: document, KeyboardEventType: context.KeyboardEvent }; // Injected navigator rules remain outside the dismissal module.
const clicked = policy.dismiss(candidates, opts);
assert.equal(clicked, 'close-button');
assert.equal(explicitVisible.clicks, 1);
assert.equal(inferred.clicks, 0);
assert.equal(wrongOwner.clicks, 0);
assert.equal(events.length, 0, 'handled Back cannot also fire Escape and close the underlying menu');

const hidden = button('Cancel', { 'data-ctrl-cancel': '' });
assert.equal(policy.dismiss(panel([hidden]), { ...opts, isEligible: () => false }), 'escape-fallback');
assert.equal(hidden.clicks, 0, 'genuinely hidden or disabled controls cannot be activated');
assert.equal(events.length, 1, 'one fallback Escape per Back press');
assert.equal(events[0].type, 'keydown');
assert.equal(events[0].key, 'Escape');
assert.equal(events[0].bubbles, true);

const outside = button('Cancel');
assert.equal(policy.dismiss(panel([outside]), { ...opts, isEligible: () => false, targetDocument: null }), 'no-dismissal',
  'missing document is diagnosable rather than silently activating an unrelated action');
const iconClose = button('×', { 'aria-label': 'Close' }); // Weaving and Color Pools have a symbol-only close button.
assert.equal(policy.isCloseControl(iconClose), true, 'an icon button with an accessible Close label is recognized');
assert.equal(policy.isCloseControl(button('Trade', { 'data-close': '' })), true, 'legacy data-close is accepted without changing shop markup');

// Guard the real legacy menu contracts: these menus no longer need one-off controller attributes.
const legacyContracts = [
  ['docs/js/slagothim-traders.js', /<button data-close type="button"/],
  ['docs/js/town-mine.js', /<button data-close /],
  ['docs/js/clothing-weaving-system.js', /class="loomcraft-close"[^>]*aria-label="Close"/],
  ['docs/js/color-pools-system.js', /class="cp-close"[^>]*aria-label="Close"/],
  ['docs/js/controller-modern-flow-bridge.js', /markCancelButton\(root\.querySelector\('#npcWardrobeClose'\)\)/],
];
for (const [path, contract] of legacyContracts) {
  assert.match(fs.readFileSync(path, 'utf8'), contract, path + ' must provide a recognizable existing dismissal action');
}
// Keep standalone browser harnesses on the same parser-loading contract as docs/index.html.
for (const path of [
  'scripts/test-farmwork-controller-browser.js',
  'scripts/test-controller-mastery-inventory-browser.js',
  'scripts/test-controller-ui-modal-pin.js',
]) {
  const fixture = fs.readFileSync(path, 'utf8'); // Fixture source is checked for the new dependency's ordering.
  const policyOffset = fixture.indexOf('controller-menu-dismissal.js'); // Required before navigator in every real browser harness.
  const navigatorOffset = fixture.indexOf('controller-ui-nav.js'); // Should never be injected before the helper.
  assert.ok(policyOffset >= 0 && navigatorOffset > policyOffset, path + ' must load dismissal before controller navigation');
}
console.log('Shared controller-menu dismissal policy: label safety, clipping, ownership, Escape and action isolation passed');
