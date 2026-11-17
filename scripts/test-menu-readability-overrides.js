#!/usr/bin/env node
'use strict';

// Regression: readability overrides must not mask ancestor CSS changes or
// permanently destroy authored inline declarations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/inventory-ui.js', 'utf8');

class TestStyle {
  constructor() { this.properties = new Map(); } // Stores authored and temporarily overridden declarations.
  getPropertyValue(name) { return this.properties.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.properties.get(name)?.priority || ''; }
  setProperty(name, value, priority = '') { this.properties.set(name, { value: String(value), priority }); }
  removeProperty(name) { this.properties.delete(name); }
}

let root = null; // The containing menu for all fixture nodes.
class TestElement {
  constructor(name, parent = null) {
    this.name = name;
    this.parentElement = parent;
    this.childNodes = [];
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.style = new TestStyle();
    this.offsetParent = parent || null;
    this.tagName = name.toUpperCase();
    this.attrs = new Map();
    this.classList = { contains: cls => cls === 'open' && this === root };
    if (parent) parent.children.push(this);
  }
  closest(selector) {
    return selector === '#menuPanel, #houseLayoutModal' ? root : null;
  }
  querySelector(selector) { return null; }
  querySelectorAll(selector) {
    assert.equal(selector, '*');
    return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
  }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
}

root = new TestElement('div');
const wrapper = new TestElement('div', root); // A non-interactive CSS ancestor that the old state cache ignored.
const label = new TestElement('span', wrapper); // The corrected text node.
label.childNodes.push({ nodeType: 3, textContent: 'Inventory' });

function computedCss(element) {
  if (element !== label) return { fontSize: '14px', color: 'rgb(40,120,70)' };
  const expanded = wrapper.className === 'expanded';
  const font = label.style.getPropertyValue('font-size');
  const color = label.style.getPropertyValue('color');
  const rawSize = font && font !== 'var(--text-size)' ? font : (expanded ? '16px' : '8px');
  const rawColor = color && color !== 'var(--text-color)' ? color : (expanded ? 'rgb(80,140,100)' : 'rgb(120,120,120)');
  return { fontSize: rawSize, color: rawColor };
}

const window = {};
vm.runInNewContext(source, {
  window,
  document: { querySelectorAll: () => [root] },
  HTMLElement: TestElement,
  Node: { TEXT_NODE: 3 },
  performance: { now: () => 0 },
  getComputedStyle: computedCss,
}, { filename: 'inventory-ui.js' });

label.style.setProperty('font-size', 'var(--text-size)', 'important');
label.style.setProperty('color', 'var(--text-color)', 'important');
window.InventoryUI.enforceMenuReadability([wrapper]);
assert.equal(label.style.getPropertyValue('font-size'), '11px', 'compact font must receive a floor');
assert.equal(label.style.getPropertyValue('color'), 'rgb(138,173,143)', 'neutral gray receives a readable tint');
assert.equal(label.dataset.menuFontFloor, '1');

wrapper.className = 'expanded';
window.InventoryUI.enforceMenuReadability([wrapper]);
assert.equal(computedCss(label).fontSize, '16px', 'ancestor-only class change reveals the true larger size');
assert.equal(computedCss(label).color, 'rgb(80,140,100)', 'ancestor-only color change removes obsolete tint');
assert.equal(label.style.getPropertyValue('font-size'), 'var(--text-size)', 'original authored font declaration is restored exactly');
assert.equal(label.style.getPropertyPriority('font-size'), 'important', 'original authored font priority is restored');
assert.equal(label.style.getPropertyValue('color'), 'var(--text-color)', 'original authored color declaration is restored exactly');
assert.equal(label.style.getPropertyPriority('color'), 'important', 'original authored color priority is restored');
assert.equal(label.dataset.menuFontFloor, undefined);
assert.equal(label.dataset.menuGrayText, undefined);

wrapper.className = 'compact';
window.InventoryUI.enforceMenuReadability([wrapper]);
assert.equal(label.style.getPropertyValue('font-size'), '11px', 're-entering compact mode restores the floor');
label.style.setProperty('font-size', '20px', 'important');
window.InventoryUI.enforceMenuReadability([wrapper]);
assert.equal(label.style.getPropertyValue('font-size'), '20px', 'external inline changes win over a stale readability snapshot');
assert.equal(label.dataset.menuFontFloor, undefined);
assert.equal(label.style.getPropertyValue('color'), 'rgb(138,173,143)', 'unrelated color floor can remain active');
console.log('menu readability ancestor invalidation and inline restoration passed');
