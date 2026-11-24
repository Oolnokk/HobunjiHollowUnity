'use strict';

// Behavioral regression for optional character-owned tool/clothing storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.children = []; // Used to inspect the actual buttons emitted by EquipmentPanel.
    this.style = { setProperty(name, value) { this[name] = value; } }; // Used by the existing gear thumbnail renderer.
    this.dataset = {}; // Retains per-tool and per-garment selectors.
    this.attributes = {}; // Retains accessible drawer expanded state.
    this.listeners = {}; // Calls real click listeners without a browser.
    this.className = '';
    this.classList = { toggle: (name, enabled) => { const classes = this.className.split(/\s+/).filter(c => c && c !== name); if (enabled) classes.push(name); this.className = classes.join(' '); }, contains: name => this.className.split(/\s+/).includes(name) };
    this.textContent = '';
    this.parentNode = null;
  }

  set innerHTML(_) { this.children = []; } // Reproduces the Gear pane replacing its previous visible rows.
  get innerHTML() { return ''; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) {
      const property = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); // Mirror browser dataset behavior for gear item lookup.
      this.dataset[property] = String(value);
    }
  }
  getAttribute(name) { return this.attributes[name]; }
  replaceWith(replacement) {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this); // Replaces a sprite fallback inside its existing cell.
    if (index >= 0) { replacement.parentNode = this.parentNode; this.parentNode.children[index] = replacement; }
  }
}

function descendants(root) {
  const out = []; // Captures dynamically rendered buttons after every UI rerender.
  const queue = [...root.children];
  while (queue.length) {
    const current = queue.shift();
    out.push(current);
    queue.push(...current.children);
  }
  return out;
}
function findAction(root, key, text) {
  return descendants(root).find(node => node.tagName === 'BUTTON'
    && node.textContent === text && (node.parentNode?.dataset?.itemKey === key || node.parentNode?.dataset?.key === key));
}

const hat = { uid: 'hat1', cosmeticId: 'hat_basic', slot: 'hat', label: 'Blue Hat',
  baseLabel: 'Hat', colorA: { h: 1, s: 0.5, v: 0.5 } }; // Physical test garment retains its dye after stowage.
let gear = {
  tools: { axe1: true, pick1: true }, toolMastery: { axe1: { xp: 17 } },
  clothingItems: [hat], clothing: { hat }, starterPantsGranted: true,
}; // Character-owned gear replaces itself when the active character changes.
const equipmentSlots = { axe: 'axe1', weapon: 'axe1', pick: 'pick1' }; // An axe used in two slots must be fully unassigned on stow.
const root = new FakeElement(); // The real Gear pane is rendered into this root.
const itemDetail = new FakeElement(); // Canonical selection identity is recorded here for mastery rendering.
const itemName = new FakeElement('span'); // The ordinary visible name is intentionally ambiguous for same-named crafted tools.
const itemActions = new FakeElement(); // Receives real gear action buttons from selectGearTool.
const events = { gearSave: 0, slotSave: 0, mesh: 0, avatar: 0 }; // Counts exactly which live systems need updates.
const document = {
  addEventListener() {},
  getElementById: id => id === 'invEquipSection' ? root
    : id === 'iiDetail' ? itemDetail : id === 'iiName' ? itemName : id === 'iiActions' ? itemActions : null,
  querySelectorAll: selector => selector === '.clothing-nest' ? descendants(root).filter(node => node.classList.contains('clothing-nest')) : [], // Empty unrelated selections in the inventory mastery resolver.
  createElement: tag => new FakeElement(tag),
  createTextNode: text => Object.assign(new FakeElement('#text'), { textContent: text }),
};
const window = {
  InventoryUI: { init() {} }, Combat: { deps: {} },
  WhistleEquip: { build() {} },
}; // Stops unrelated module-loading and lets the actual Gear UI finish.
const dependencies = {
  getGearInventory: () => gear, equipmentSlots,
  TOOL_ITEM_DEFS: { axe1: { label: 'Axe', icon: '🪓', slots: ['axe', 'weapon'] },
    pick1: { label: 'Pick', icon: '⛏️', slots: ['pick'] } },
  saveGearInventory: () => events.gearSave++,
  saveEquipmentSlots: () => events.slotSave++,
  rebuildToolMeshes: () => events.mesh++,
  refreshPlayerAvatar: () => events.avatar++,
  buildInventoryGrid() {}, clearInventoryDetail() {}, clearInvSelection() {}, refreshActionBar() {},
  getActiveTool: () => 'axe', toolMasteryLevel: key => key === 'axe1' ? 2 : 0,
  toolMeshMap: {}, toolHolder: { add() {}, remove() {} },
  showToast() {},
};
vm.runInNewContext(fs.readFileSync('docs/js/equipment-panel.js', 'utf8'), { window, document });
const panel = window.EquipmentPanel;
panel.init(dependencies);
panel.buildEquipmentSlots();
assert(findAction(root, 'axe1', 'Stow'), 'available owned tools have a direct Stow button');
function openHatNest() {
  const hatNest = descendants(root).find(node => node.classList.contains('clothing-nest') && node.children[0]?.title === 'Hat');
  assert(hatNest, 'Hat name stack exists');
  if (hatNest.children[1].hidden) hatNest.children[0].listeners.click();
  const plain = hatNest.children[1].children.find(node => node.classList.contains('clothing-nest'));
  assert(plain, 'plain clothing is nested under its name');
  if (plain.children[1].hidden) plain.children[0].listeners.click();
}
openHatNest();
assert(findAction(root, 'hat1', 'Stow'), 'individual owned clothing retains its Stow button');

findAction(root, 'axe1', 'Stow').listeners.click({ stopPropagation() {} });
assert.equal(equipmentSlots.axe, null);
assert.equal(equipmentSlots.weapon, null, 'every assignment of the stored tool is cleared');
assert.equal(events.slotSave, 1, 'all tool assignments are saved in one batch');
assert.equal(equipmentSlots.pick, 'pick1', 'other equipped tools remain untouched');
assert.equal(gear.tools.axe1, true, 'stowing must not dispose of owned tools');
assert.equal(gear.toolMastery.axe1.xp, 17, 'stored tool mastery survives');
assert.equal(panel.getArchiveDebug().stowedTools, 1);
assert(descendants(root).some(node => node.textContent === '▾ Stowed Tools · 1'), 'tool archive is discoverable and expanded after stow');
let toolsToggle = descendants(root).find(node => node.textContent === '▾ Stowed Tools · 1'); // Exercises the archive drawer instead of only checking its label.
toolsToggle.listeners.click();
assert.equal(findAction(root, 'axe1', 'Take Out'), undefined, 'collapsed tool storage hides its item controls');
toolsToggle = descendants(root).find(node => node.textContent === '▸ Stowed Tools · 1');
toolsToggle.listeners.click();
assert(findAction(root, 'axe1', 'Take Out'), 'reopening tool storage restores its item controls');
panel.equipItem('axe1', 'axe');
assert.equal(equipmentSlots.axe, null, 'a stowed tool cannot be equipped');
findAction(root, 'axe1', 'Take Out').listeners.click({ stopPropagation() {} });
assert.equal(panel.isToolArchived('axe1'), false);
panel.equipItem('axe1', 'axe');
assert.equal(equipmentSlots.axe, 'axe1', 'withdrawn tool can be equipped again');

openHatNest();
findAction(root, 'hat1', 'Stow').listeners.click({ stopPropagation() {} });
assert.equal(gear.clothing.hat, null, 'worn clothing is removed before archiving');
assert.equal(events.avatar, 1, 'stowing worn clothing updates its avatar once');
assert.equal(hat.archived, true);
assert.equal(hat.colorA.h, 1, 'stowing does not strip dye state');
assert(descendants(root).some(node => node.textContent === '▾ Stowed Clothing · 1'), 'clothing archive exposes its drawer');
const inventoryLayout = fs.readFileSync('docs/js/inventory-ui.js', 'utf8'); // Verifies the live Inventory layout keeps each archive in the correct owned-gear group.
assert.match(inventoryLayout, /if \(toolsArchive\) ownedToolsGroup\.appendChild\(toolsArchive\)/);
assert.match(inventoryLayout, /if \(clothingArchive\) ownedClothingGroup\.appendChild\(clothingArchive\)/);
assert.match(inventoryLayout, /matchedCell\?\.dataset\?\.itemKey/, 'mastery view reads the canonical item key after archive reordering');
openHatNest();
findAction(root, 'hat1', 'Take Out').listeners.click({ stopPropagation() {} });
assert.equal(hat.archived, undefined, 'withdrawing restores the original physical article');
assert.equal(panel.getArchiveDebug().stowedClothing, 0);

gear.archivedTools = { pick1: true };
equipmentSlots.pick = 'pick1';
hat.archived = true;
gear.clothing.hat = hat;
assert(panel.reconcileArchivedGear(), 'old-save conflicts are repaired once');
assert.equal(equipmentSlots.pick, null);
assert.equal(gear.clothing.hat, null);
const saved = JSON.parse(JSON.stringify(gear));
assert.equal(saved.archivedTools.pick1, true, 'tool archive persists within character gear');
assert.equal(saved.clothingItems[0].archived, true, 'clothing archive persists on its saved record');

gear = { tools: { axe1: true }, clothing: { hat: null }, clothingItems: [], starterPantsGranted: true };
assert.equal(panel.isToolArchived('axe1'), false, 'other characters do not inherit storage state');
assert.equal(panel.getArchiveDebug().stowedClothing, 0);

// Two materially different owned axes share the same visible name. Their
// distinct mastery values must follow the selected key, including storage.
gear.tools.axe2 = true;
gear.toolMastery = { axe2: { xp: 210 } }; // The second character's new mastery record is independent from the first.
dependencies.TOOL_ITEM_DEFS.axe2 = { label: 'Axe', icon: '🪓', slots: ['axe'] };
assert(panel.setToolArchived('axe2', true), 'the second same-named tool can be stored individually');
const secondAxe = descendants(root).find(node => node.dataset?.itemKey === 'axe2');
assert(secondAxe, 'archived second axe has its own tile');
secondAxe.listeners.click();
assert.equal(itemDetail.dataset.gearToolKey, 'axe2', 'Gear detail publishes the selected canonical tool key');
assert.match(itemName.textContent, /\(Gear Storage\)$/, 'stored tool detail identifies its archived status');
vm.runInNewContext(fs.readFileSync('docs/js/inventory-ui.js', 'utf8'), { window, document });
const combatDeps = {
  TOOL_ITEM_DEFS: dependencies.TOOL_ITEM_DEFS, equipmentSlots,
  gearInventory: () => gear,
};
assert.equal(window.InventoryUI.__test.selectedDetailToolKey(combatDeps), 'axe2',
  'mastery resolves second archived Axe, not the first same-named Axe');
itemName.textContent = 'Blue Hat';
assert.equal(window.InventoryUI.__test.selectedDetailToolKey(combatDeps), null,
  'stale Gear selection metadata must not reappear on unrelated item details');

console.log('Optional tool/clothing Gear archive UI, equipment guards, save fields, and character scope passed');
