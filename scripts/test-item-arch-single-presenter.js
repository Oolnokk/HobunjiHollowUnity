'use strict';
// Executable item-wheel regression: one owner, fixed heading, sentinel continuity,
// Potion Select radius parity, sprite framing and idempotent frame updates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Uses the actual shipping source.
const source = read('docs/js/item-arch-category-colors.js');
const bootstrap = read('docs/js/tool-icon-render.js');
const legacy = [
  read('docs/js/item-arch-sticky-category-heading.js'),
  read('docs/js/item-arch-original-presentation.js'),
];
assert.match(bootstrap, /js\/item-arch-category-colors\.js\?v=/);
assert.doesNotMatch(bootstrap, /js\/item-arch-(?:sticky-category-heading|original-presentation)\.js/);
assert.equal((source.match(/new MutationObserver/g) || []).length, 1);
assert.equal((source.match(/function queueRefresh\(/g) || []).length, 1);
assert.equal((source.match(/createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/g) || []).length, 1);
for (const shim of legacy) {
  assert.doesNotMatch(shim, /MutationObserver|requestAnimationFrame|addEventListener/);
}

let geometryReads = 0; // Counts synchronous DOM layout measurements under valid Potion Select diagnostics.
class Style {
  constructor() {
    this.values = new Map(); // Records style changes so idle RAF frames can be checked for no redundant writes.
    this.writes = 0; // Number of actual set/remove operations by the game.
    this.visibility = 'visible';
  }
  getPropertyValue(key) { return this.values.get(key) || ''; }
  setProperty(key, value) { this.values.set(key, String(value)); this.writes++; }
  removeProperty(key) { this.values.delete(key); this.writes++; }
}
class ClassList extends Set {
  add(...names) { for (const name of names) super.add(name); return this; }
  contains(name) { return this.has(name); }
  remove(...names) { for (const name of names) super.delete(name); }
}
class Element {
  constructor(tag = 'div') {
    this.nodeType = 1;
    this.tagName = tag;
    this.id = '';
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = new Style();
    this.classList = new ClassList();
    this.attributes = new Map();
    this.textContent = '';
    this.writes = 0; // Number of SVG attribute writes, used for repeated-render idempotence.
    this.namespaceURI = 'http://www.w3.org/2000/svg';
  }
  append(...children) {
    for (const child of children) { child.parentElement = this; this.children.push(child); }
  }
  appendChild(child) { this.append(child); return child; }
  remove() {
    if (!this.parentElement) return;
    const children = this.parentElement.children;
    const index = children.indexOf(this);
    if (index >= 0) children.splice(index, 1);
    this.parentElement = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); this.writes++; }
  getAttribute(key) { return this.attributes.get(key) || null; }
  addEventListener() {} // Supports the item selector's native pointerdown regroup hook.
  querySelector(tag) {
    const matches = node => tag === '.arc-label' ? node.classList.has('arc-label')
      : tag === '.arc-icon' ? node.classList.has('arc-icon')
      : tag === 'path' ? node.tagName === 'path'
      : tag === 'textPath' ? node.tagName === 'textPath' : false;
    const walk = node => {
      for (const child of node.children) {
        if (matches(child)) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
  matches(selector) { return selector === '.arc-slot' && this.classList.has('arc-slot'); }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  getBoundingClientRect() { geometryReads++; return {left:190, top:190, width:20, height:20}; }
}

const root = new Element('html'); // In-game document root, including external SVG overlays.
const head = new Element('head'), body = new Element('body');
root.append(head, body);
const toolBtn = new Element('button'), itemBtn = new Element('button'), toolSelect = new Element('div');
toolBtn.id = 'toolBtn'; itemBtn.id = 'itemBtn'; toolSelect.id = 'toolSelect';
body.append(toolBtn, itemBtn, toolSelect);
const makeSlot = (name, angle, active = false) => {
  const slot = new Element('button');
  slot.classList.add('arc-slot', 'shared-selection-slot');
  if (active) slot.classList.add('arc-active');
  slot.dataset.sharedSelectionAngle = String(angle);
  slot.dataset.sharedSelectionRadius = '120';
  slot.dataset.sharedSelectionTargetX = '115';
  slot.dataset.sharedSelectionTargetY = '115';
  const icon = new Element('span'), label = new Element('span');
  icon.classList.add('arc-icon', 'sprited-icon');
  label.classList.add('arc-label');
  label.textContent = name;
  slot.append(icon, label);
  body.append(slot);
  return slot;
};
const seed = makeSlot('BLUE SEED', 135, true);
const berry = makeSlot('RED BERRY', 110);
const edge = new Element('button');
edge.classList.add('arc-slot','arc-arrow');
body.append(edge);
const slots = [seed, berry, edge];
const byId = id => {
  const walk = node => {
    if (node.id === id) return node;
    for (const child of node.children) { const found = walk(child); if (found) return found; }
    return null;
  };
  return walk(root);
};
const has = (s, className) => s.classList.has(className);
const real = () => slots.filter(s => has(s,'arc-slot') && !has(s,'arc-arrow') && !has(s,'shared-selection-exit-ghost'));
const queryAll = selector => {
  if (selector === '.arc-slot:not(.arc-arrow):not(.shared-selection-exit-ghost)') return real();
  if (selector === '.arc-slot[data-item-category]:not(.arc-arrow):not(.shared-selection-exit-ghost)')
    return real().filter(s => s.dataset.itemCategory !== undefined);
  if (selector === '.arc-slot[data-item-category]')
    return slots.filter(s => s.dataset.itemCategory !== undefined);
  if (selector === '.arc-slot.item-select-radius-inset')
    return slots.filter(s => has(s,'item-select-radius-inset'));
  return [];
};
const queryOne = selector => {
  if (selector === '.arc-slot.arc-arrow') return edge;
  if (selector === '.arc-slot.arc-arrow.arc-active') return has(edge,'arc-active') ? edge : null;
  if (selector.startsWith('#')) {
    const [id, tag] = selector.slice(1).split(/\s+/);
    const found = byId(id);
    return tag ? found?.querySelector(tag) || null : found;
  }
  if (selector.endsWith(' .arc-icon')) {
    const match = selector.includes('.arc-active')
      ? real().find(s => s.dataset.itemCategory && has(s,'arc-active'))
      : real().find(s => s.dataset.itemCategory);
    return match?.querySelector('.arc-icon') || null;
  }
  return null;
};
const document = {
  readyState: 'complete', head, body, documentElement: root,
  getElementById: byId,
  querySelector: queryOne,
  querySelectorAll: queryAll,
  createElement: tag => new Element(tag),
  createElementNS: (namespace, tag) => new Element(tag),
  addEventListener() {},
};
const listeners = new Map(); // One event subscription per event after consolidation.
const frames = []; // Mock RAF queue advanced deterministically by the test.
const observers = []; // Counts and delivers just the actual production observer.
class MutationObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
}
let cheapGeometryCalls = 0; // Verifies hot-path geometry reads never poll the expensive all-DOM diagnostic snapshot.
let fullDiagnosticsCalls = 0; // Must remain zero across the item-wheel's repeated UI-open frames.
const window = {
  CookingSystem: { init() {} },
  FarmCrates: { init() {} },
  AlchemySystem: { init() {} },
  QuickPotionArcUI: {
    readGeometry: () => { cheapGeometryCalls++; return { outerRingGeometry: { center: {x:200,y:200}, radius:120 }, labelOutsetPx:17 }; },
    diagnostics: () => { fullDiagnosticsCalls++; return { outerRingGeometry: { center: {x:200,y:200}, radius:120 }, labelOutsetPx:17 }; },
    refresh() { this.calls = (this.calls || 0) + 1; },
  },
};
const sandbox = {
  window, document, MutationObserver, innerWidth:1000, innerHeight:800,
  getComputedStyle: () => ({ display:'block', visibility:'visible', opacity:'1', fontSize:'15px' }),
  addEventListener: (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  },
  queueMicrotask: fn => fn(),
  requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
  console,
};
vm.runInNewContext(source, sandbox);
assert.equal(observers.length, 1, 'one mutation observer owns the item arch');
assert.equal(listeners.get('pointermove').length, 1);
assert.equal(listeners.get('wheel').length, 1);
assert.equal(listeners.get('keydown').length, 1);
assert.ok(byId('itemArchCategoryColorStyles'), 'one consolidated stylesheet is installed');
assert.ok(!byId('itemArchCategoryHeading') && !byId('itemArchStickyCategoryHeading'));

const defs = {
  seed: { label:'BLUE SEED', itemArchCategory:'seed' },
  berry: { label:'RED BERRY', tags:['berry'] },
};
const inventory = { seed:2, berry:3 };
const inventoryItems = [
  {key:'seed',label:'BLUE SEED'},
  {key:'berry',label:'RED BERRY'},
];
window.CookingSystem.init({ITEM_DEFS:defs,inventory,inventoryItems});
const step = () => {
  const callbacks = frames.splice(0, frames.length);
  for (const fn of callbacks) fn();
};
const send = name => { for (const cb of listeners.get(name) || []) cb({key:''}); };
toolBtn.style.visibility = 'hidden';
itemBtn.style.visibility = 'visible';
send('pointermove'); step(); step();
const api = window.ItemArchCategoryColors;
assert.equal(seed.dataset.itemCategory,'seed');
assert.equal(berry.dataset.itemCategory,'berry');
assert.equal(byId('itemArchFixedCategoryHeading').querySelector('textPath').textContent,'Seeds');
assert.equal(seed.style.getPropertyValue('--item-cat-rgb'),'124,255,79', 'slot pseudo-element inherits the category palette');
assert.equal(seed.style.getPropertyValue('--item-select-inset-x'), '4.243px', '135-degree item icon moves six pixels inward');
assert.ok(has(seed,'item-select-radius-inset'));
assert.equal(root.children.filter(el => el.id === 'itemArchFixedCategoryHeading').length,1);
const heading = byId('itemArchFixedCategoryHeading');
const beforeWrites = seed.style.writes + berry.style.writes + heading.writes;
const beforeGeometryReads = geometryReads;
for (let i=0;i<5;i++) step();
assert.equal(seed.style.writes + berry.style.writes + heading.writes,beforeWrites, 'steady open frames do not rewrite unchanged styles/SVG attributes');
assert.equal(geometryReads,beforeGeometryReads,'valid Potion Select geometry avoids per-frame synchronous layout reads');
assert(cheapGeometryCalls > 5, 'item arch consumes the cheap live selector geometry during the open-frame loop');
assert.equal(fullDiagnosticsCalls, 0, 'UI-open item updates never request the full Potion Select DOM diagnostic snapshot');

seed.classList.delete('arc-active'); edge.classList.add('arc-active');
send('pointermove'); step(); step();
assert.equal(heading.querySelector('textPath').textContent, 'Seeds', 'edge sentinel retains last real category');
assert.equal(window.ItemArchStickyCategoryHeading.debugSnapshot().stickyVisible,true,'compatibility diagnostic identifies sentinel-held heading');
berry.classList.add('arc-active'); edge.classList.delete('arc-active');
assert.equal(window.ItemArchStickyCategoryHeading.debugSnapshot().stickyVisible,false,'normal item selection is no longer sticky');
send('pointermove'); step(); step();
assert.equal(heading.querySelector('textPath').textContent, 'Berries');
assert.equal(api.debugSnapshot().presentation.fixedHeadingText, 'Berries');

seed.dataset.sharedSelectionRadius = '100'; berry.dataset.sharedSelectionRadius = '100';
step(); step(); step();
assert.equal(window.QuickPotionArcUI.calls, 1, 'mismatched wheel geometry requests one canonical selector refresh');
seed.dataset.sharedSelectionRadius = '120'; berry.dataset.sharedSelectionRadius = '120';
step();
assert.equal(api.debugSnapshot().presentation.selectionRadiusMatchesPotion, true);

const legacyStickyDebug = window.ItemArchStickyCategoryHeading.debugSnapshot(); // Cached mobile diagnostics should keep their old property shape.
assert.equal(legacyStickyDebug.potionGeometry.radius,120);
assert.equal(legacyStickyDebug.itemSelectionRadii.length,2);
assert.equal(legacyStickyDebug.itemCategoryLabelRadius,137);
assert.equal(legacyStickyDebug.potionCategoryLabelRadius,137);
assert.equal(legacyStickyDebug.potionIconCss.fontSize,'.78em');
assert.equal(legacyStickyDebug.parityStyleInstalled,true);

const headingBefore = heading.getAttribute('viewBox');
assert.equal(headingBefore, '0 0 1000 800');
toolBtn.style.visibility='visible'; itemBtn.style.visibility='hidden';
send('pointerup'); step(); step();
assert.equal(byId('itemArchFixedCategoryHeading'),null,'closing removes fixed heading');
assert.ok(!has(seed,'item-select-radius-inset'), 'close restores original item slot geometry');
assert.equal(api.debugSnapshot().presentation.frameRunning,false,'bounded loop stops on close');
assert.equal(window.ItemArchOriginalPresentation.debugSnapshot().singlePresenter,true);
assert.equal(window.ItemArchStickyCategoryHeading.debugSnapshot().singlePresenter,true);
console.log('Item arch: single owner, category colors, sprite styling, sentinel, fixed heading, inset, idle writes and cleanup passed.');
