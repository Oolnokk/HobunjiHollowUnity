'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const nav = read('docs/js/controller-ui-nav.js');
const bridge = read('docs/js/controller-modern-flow-bridge.js');
const shippingPanel = read('docs/js/shipping-panel.js');
const shippingConfigSource = read('docs/js/shipping-box-config.js');
const crates = read('docs/js/farm-crates.js');
const index = read('docs/index.html');

assert.doesNotThrow(() => new vm.Script(nav), 'controller UI navigator parses');
assert.doesNotThrow(() => new vm.Script(shippingPanel), 'Shipping Box panel parses');
assert.doesNotThrow(() => new vm.Script(crates), 'Shipping Box world interaction parses');

const configContext = { window: {} };
vm.runInNewContext(shippingConfigSource, configContext, { filename: 'shipping-box-config.js' });
const config = configContext.window.ShippingBoxConfig;
assert.ok(config, 'ShippingBoxConfig loads');
const { open, deposit } = config.actions;

// World interaction: Shipping Box stays on the ordinary world-object action
// path that controller gameplay already dispatches, rather than relying on a
// mouse/pointer-only feature bridge.
assert.equal(open, 'obj_open_shipping', 'Shipping Box open action has the expected semantic id');
assert.equal(deposit, 'obj_deposit', 'Shipping Box quick-deposit action has the expected semantic id');
assert.match(crates, /getButtons\(\)[\s\S]*action:\s*actions\.deposit[\s\S]*action:\s*actions\.open/, 'Shipping Box exposes quick deposit and open through ordinary world-object buttons');
assert.match(crates, /action === actions\.legacyOpen \|\| action === actions\.open[\s\S]*ShippingPanel\?\.open\?\.\(\)/, 'ordinary Shipping Box open action enters ShippingPanel.open');
assert.match(crates, /if \(action === actions\.deposit\)[\s\S]*bin\[item\.key\]/, 'ordinary Shipping Box deposit action performs the one-item quick deposit');
assert.doesNotMatch(bridge, /obj_open_shipping|obj_deposit/, 'Shipping Box does not need the pointer-only contextual-action exception list');

// Menu discovery: ShippingPanel is a standards-based modal, so the universal
// navigator discovers it without Shipping-Box-specific IDs.
assert.match(shippingPanel, /id="shippingStandaloneWindow" role="dialog" aria-modal="true"/, 'Shipping Box standalone window is a semantic modal dialog');
assert.match(nav, /SEMANTIC_PANEL_SELECTOR\s*=\s*'\[role="dialog"\]\[aria-modal="true"\]'/, 'controller navigator auto-discovers semantic modal dialogs');
assert.match(nav, /NAV_SELECTOR[\s\S]*'button'/, 'ordinary buttons are controller navigation targets');
assert.match(nav, /function activate\(\)[\s\S]*currentTarget\.click\(\)/, 'controller confirm activates the focused Shipping Box control through its normal click path');

// Item selection and transfer controls are native buttons. The dynamic slot
// click selects an item; the authored stepper/transfer buttons are therefore
// reachable by the same vector-cone navigation and A-button activation.
assert.match(shippingPanel, /document\.createElement\('button'\)[\s\S]*slot\.addEventListener\('click', \(\) => selectShippingItem\(side, key\)\)/, 'Shipping Box item slots are native clickable buttons');
for (const id of config.panel.transferControlIds) {
  const buttonPattern = new RegExp(`<button[^>]*id=["']${id}["']`);
  assert.match(index, buttonPattern, `${id} is a native button in the Shipping Box pane`);
}
assert.match(shippingPanel, /transferShippingAmount\(mode\)[\s\S]*depositItem\(key, qty\)[\s\S]*withdrawItem\(key, qty\)/, 'transfer controls retain the shared deposit/withdraw implementation controller clicks invoke');

// B/Cancel: ControllerUI falls back to Escape for semantic dialogs, and the
// Shipping Box dialog already owns Escape by closing itself.
assert.match(nav, /KeyboardEvent\('keydown', \{ key: 'Escape', code: 'Escape'/, 'controller B has the universal Escape fallback');
assert.match(shippingPanel, /dialog\.addEventListener\('keydown'[\s\S]*event\.key === panel\.escapeKey[\s\S]*closeStandalone\(\)/, 'Shipping Box handles Escape by closing the standalone window');

// Focus returns to gameplay-facing UI state after close rather than leaving a
// trapped modal focus owner behind.
assert.match(shippingPanel, /standaloneOpen = false[\s\S]*standalonePreviousFocus = null[\s\S]*restore\.focus/, 'closing Shipping Box restores the pre-modal focus target');

console.log('controller Shipping Box regression checks passed');
