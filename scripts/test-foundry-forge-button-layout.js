#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'); // Shipped Foundry builder's visible action, order and transaction checks.
const fs = require('node:fs'); // Loads real browser module, layout styles and game entrypoint.
const vm = require('node:vm'); // Runs the real Foundry DOM builder without WebGL or a browser.

function element(tag) {
  return {
    tagName: tag.toUpperCase(), className: '', textContent: '', style: {}, attributes: {}, children: [], value: '', disabled: false, isConnected: true,
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    setAttribute(key, value) { this.attributes[key] = value; },
  };
}
function childrenOf(parent) { // Flatten only this fixture's DOM, to verify the actual produced button and explanatory text.
  return [parent, ...parent.children.flatMap(childrenOf)];
}
const document = { createElement: element }; // The shipped Foundry code only needs these ordinary DOM interfaces.
const window = {}; // Browser-module globals; no fake copy of the render() implementation.
const context = vm.createContext({ window, document, console }); // Browser module is evaluated unchanged in this VM.
vm.runInContext(fs.readFileSync('docs/js/foundry-shop.js', 'utf8'), context, { filename: 'docs/js/foundry-shop.js' });
const key = 'modular:shaft:head:copper'; // Registered in the same form as the production item key.
const definition = { label: 'Copper Custom Weapon', dmgType: 'blunt', animStyle: 'sweep', slots: ['weapon'], weaponAssembly: { flail: true } }; // Forces both verbose optional paragraphs.
const cost = { gold: 40, bars: 5, wood: 5 }; // Matches the production module's resource authority without duplicating its crafting algorithm.
const config = { shafts: { shaft: { label: 'Wood Haft', sourceShape: 'sourceShaft' } },
  heads: { head: { label: 'Mace Head' } }, craftCost: cost };
window.ModularWeapons = {
  unlockedParts: () => ({ shafts: ['shaft'], heads: ['head'] }),
  getConfig: () => config,
  isDisallowed: () => false,
  itemKey: () => key,
  weaponDamageType: () => 'blunt',
  diagnostics: () => ({ longData: 'diagnostic-example'.repeat(180) }),
  settings: () => ({ x: 0 }),
};
window.TownMine = { improvementStatus: () => ({ built: true }), hasImprovement: () => true }; // Builder is in its post-upgrade state.
window.ToolMetalRecolor = { getRecoloredCanvas: () => Promise.resolve({ toDataURL: () => 'data:image/png;base64,ok' }) }; // Preview is asynchronous, as in game.
window.HobunjiHandToolGrips = { weaponHandModeForTool: () => 'two-hand' }; // Uses the actual UI's handedness label.

function setup(inventory, gear = { tools: {} }) {
  let rerenders = 0; // Purchase event refreshes the page exactly once.
  const toasts = []; // Gives a console-free assertion that crafting succeeded.
  window.FoundryShop.init({
    inventory, getGearInventory: () => gear, TOOL_ITEM_DEFS: { [key]: definition }, UNLOCKED_TOOL_SHAPES: ['shaft', 'head'],
    VERDIGRIS_METAL_KEYS: ['copper'], METAL_DEFS: { copper: { label: 'Copper', hex: '#b87333' } },
    metalBarItemKey: metal => 'bar_' + metal, clampInventoryStack() {}, saveGearInventory() {},
    buildInventoryGrid() {}, buildEquipmentSlots() {}, saveMemberWorldData() {}, showToast: (...parts) => toasts.push(parts),
    rerender: () => { rerenders++; },
  });
  return { gear, toasts, get rerenders() { return rerenders; } };
}
function render() {
  const list = element('div'); // Real shop list is `#metalCraftShopList`.
  window.FoundryShop.render(list);
  const section = list.children.find(child => child.className === 'foundry-section');
  assert(section, 'Foundry section renders in the smithing menu');
  const button = childrenOf(section).find(child => child.tagName === 'BUTTON' && child.className.includes('foundry-forge-button'));
  assert(button, 'Forge button is present for an unlocked valid custom weapon');
  assert.equal(button.textContent.includes('Forge') || button.textContent.includes('Already'), true);
  const name = section.children.find(child => child.className === 'foundry-weapon-name');
  const price = section.children.find(child => child.className === 'foundry-craft-cost');
  assert.equal(name.textContent, definition.label);
  assert.match(price.textContent, /40 bronze/);
  assert(section.children.indexOf(name) < section.children.indexOf(button), 'generated weapon name is above the button');
  assert(section.children.indexOf(button) < section.children.findIndex(child => child.tagName === 'IMG'), 'Forge action precedes the tall preview');
  assert(section.children.indexOf(button) < section.children.findIndex(child => child.className === 'foundry-weapon-details'), 'optional long details cannot push Forge below the fold');
  assert(section.style.cssText.includes('grid-template-columns:minmax(0,1fr)'), 'Foundry grid can shrink even with long diagnostics');
  assert(childrenOf(section).some(child => child.tagName === 'PRE'), 'mobile diagnostics stay available');
  return { section, button };
}
const ready = setup({ gold: 100, bar_copper: 10, pineLog: 10 });
let rendered = render();
assert.equal(rendered.button.disabled, false, 'affordable valid recipe can be forged');
rendered.button.onclick();
assert.equal(ready.gear.tools[key], true, 'Forge action grants the registered modular weapon');
assert.equal(ready.rerenders, 1, 'a successful forge refreshes the smithing menu');
assert.deepEqual([ready.gear.tools[key], ready.toasts.at(-1)?.[1]], [true, true]);
rendered = render();
assert.equal(rendered.button.disabled, true, 'previously forged combination cannot be purchased twice');
assert.match(rendered.button.textContent, /Already forged/);
assert(childrenOf(rendered.section).some(child => /already in your equipment/i.test(child.textContent)), 'already-owned reason stays visible');

setup({ gold: 0, bar_copper: 0, pineLog: 0 });
rendered = render();
assert(rendered.button.disabled, 'missing resources disable purchase, not the button itself');
const status = rendered.section.children.find(child => child.className === 'foundry-craft-status');
assert.match(status.textContent, /bronze/);
assert.match(status.textContent, /bars/);
assert.match(status.textContent, /wood/);

const css = fs.readFileSync('docs/style.css', 'utf8'); // Real responsive layout contract, not test-only styles.
assert.match(css, /#mpMetalCraftShop \.foundry-forge-button \{[^}]*min-height:\s*44px/s, 'Forge action meets touch size');
assert.match(css, /#mpMetalCraftShop \.foundry-section pre \{[^}]*overflow-wrap:\s*anywhere/s, 'long diagnostics do not force hidden horizontal overflow');
assert.match(css, /#mpMetalCraftShop #metalCraftShopList \{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s, 'smithing list accepts narrow viewport');
const html = fs.readFileSync('docs/index.html', 'utf8'); // Confirm mobile browsers request the changed module and styles.
assert.match(html, /js\/foundry-shop\.js\?v=[A-Za-z0-9_-]+/);
assert.match(html, /style\.css\?v=[A-Za-z0-9_-]+/);
console.log('Foundry Forge action: visible order, responsive grid, insufficient and owned states, and real craft event passed.');
