#!/usr/bin/env node
'use strict';

// Regression coverage for the trinket renderer and its placement in the compact Gear workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const trinketSource = fs.readFileSync('docs/js/trinket-system.js', 'utf8'); // Evaluates the real trinket renderer against the lightweight DOM below.
const inventoryUiSource = fs.readFileSync('docs/js/inventory-ui.js', 'utf8'); // Checks that Gear decoration adopts the section instead of leaving grid siblings.
const compactSource = fs.readFileSync('docs/js/inventory-gear-compact-effects.js', 'utf8'); // Keeps the two-column, middle-scroller layout contract covered.

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this._innerHTML = '';
  }

  get classList() {
    return { contains: name => this.className.split(/\s+/).includes(name) };
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  querySelector(selector) {
    if (selector.startsWith(':scope > .')) {
      const name = selector.slice(':scope > .'.length);
      return this.children.find(child => child.classList.contains(name)) || null;
    }
    if (selector.startsWith('.')) {
      const name = selector.slice(1);
      for (const child of this.children) {
        if (child.classList.contains(name)) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
    }
    return null;
  }

  addEventListener() {}
}

const documentStub = { createElement: tag => new Element(tag) }; // Supplies only the DOM operations the trinket module uses.
const windowStub = {}; // Isolated game APIs let the renderer exercise its own fallback gear collection.
const context = { window: windowStub, document: documentStub, console };
vm.createContext(context);
vm.runInContext(trinketSource, context, { filename: 'trinket-system.js' });

const trinkets = windowStub.TrinketSystem;
assert(trinkets?.renderEquipmentSection, 'trinket renderer is exported');
trinkets._setFallbackGear({
  trinkets: [
    { uid: 'one', id: 'iconNaoung' },
    { uid: 'two', id: 'harlyaoReachShard' },
  ],
  equippedTrinkets: ['one'],
});

const equipment = new Element('div'); // Simulates the undecorated section created by EquipmentPanel.
trinkets.renderEquipmentSection(equipment);
assert.equal(equipment.children.length, 1, 'undecorated Gear gets exactly one trinket group, not loose grid children');
const originalGroup = equipment.children[0];
assert(originalGroup.classList.contains('gear-owned-group'), 'trinkets share the existing owned-group styling');
assert(originalGroup.classList.contains('gear-owned-trinkets'), 'trinkets expose their own group marker');
assert(originalGroup.querySelector('.trinket-attunement-label'), 'attunement header stays inside its group');
const cards = originalGroup.querySelector('.trinket-inventory-list');
assert(cards, 'trinket card list stays within its group');
assert.equal(cards.children.length, 2, 'both equipped and unequipped items remain visible');
assert(cards.children.every(card => card.classList.contains('trinket-inventory-row')), 'all cards have stable trinket styling hooks');
assert(originalGroup.querySelector('.trinket-debug'), 'trinket diagnostics remain inside the group');

const ownedSection = new Element('div'); // Simulates InventoryUI's completed owned-gear column.
ownedSection.className = 'gear-owned-section';
equipment.appendChild(ownedSection);
trinkets.renderEquipmentSection(equipment);
assert.equal(equipment.children.length, 1, 'direct rerender removes the stale top-level trinket group');
assert.equal(ownedSection.children.length, 1, 'direct rerender targets the existing scrollable owned-gear column');
assert(ownedSection.children[0].classList.contains('gear-owned-trinkets'), 'the new group is correctly nested');
trinkets.renderEquipmentSection(equipment);
assert.equal(ownedSection.children.length, 1, 'repeated refreshes do not duplicate trinket groups');

trinkets._setFallbackGear({ trinkets: [], equippedTrinkets: [] });
trinkets.renderEquipmentSection(equipment);
assert.equal(ownedSection.children.length, 1, 'empty trinket inventory still occupies one well-formed group');
assert(ownedSection.querySelector('.inv-equip-empty'), 'empty-state text stays in the owned-gear scroller');

assert.match(inventoryUiSource, /const trinketGroup = directChild\(section, 'gear-owned-trinkets'\)/, 'decorator recognizes trinket groups');
assert.match(inventoryUiSource, /if \(trinketGroup\) used\.add\(trinketGroup\)/, 'decorator removes the trinket group from orphan leftovers');
assert.match(inventoryUiSource, /if \(trinketGroup\) ownedSection\.appendChild\(trinketGroup\)/, 'decorator moves trinkets into owned gear');
assert.match(inventoryUiSource, /\.gear-owned-trinkets \.trinket-inventory-row \{[^}]*flex:0 0 auto;[^}]*height:auto;/, 'trinket cards cannot shrink over adjacent rows');
assert.match(inventoryUiSource, /orphanTrinketGroups:/, 'mobile diagnostics report misplaced trinket groups');
assert.match(compactSource, /\.gear-owned-section\.gear-middle-inventory \{[\s\S]*?overflow-y:auto !important;/, 'owned gear remains the independent scrolling column');
assert.match(compactSource, /\.inv-equip-section \{[\s\S]*?display:grid !important;/, 'the outer Gear workspace still has two columns');

console.log('Trinket Gear layout regression tests passed');
