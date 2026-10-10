#!/usr/bin/env node
'use strict';

// A resizable <details> drawer must only hold its dragged / saved size while it is OPEN. If a closed drawer keeps an
// inline `height: ... !important` it stays a huge transparent box above whatever it floats over, and every tap in its
// area (other panels' buttons included) goes to the collapsed drawer instead.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/panel-ui-core.js', 'utf8');

function makeStyle() { // Just enough of CSSStyleDeclaration: values and priorities, like the real inline style.
  const map = new Map();
  return {
    setProperty: (prop, value, priority = '') => { map.set(prop, { value: String(value), priority }); },
    getPropertyValue: prop => (map.has(prop) ? map.get(prop).value : ''),
    getPropertyPriority: prop => (map.has(prop) ? map.get(prop).priority : ''),
    removeProperty: prop => { map.delete(prop); },
    has: prop => map.has(prop),
  };
}

function makeEl(tagName) {
  const handlers = {};
  const el = {
    tagName,
    style: makeStyle(),
    dataset: {},
    children: [],
    open: false,
    className: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
    appendChild(child) { el.children.push(child); return child; },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 300, height: 44, left: 0, top: 0, right: 300, bottom: 44 }),
    setPointerCapture() {},
    fire(type) { (handlers[type] || []).forEach(fn => fn({})); },
  };
  return el;
}

function load(savedSize) {
  const store = savedSize ? { drawerSize: JSON.stringify(savedSize) } : {};
  const document = {
    readyState: 'complete', currentScript: null,
    head: makeEl('HEAD'), body: makeEl('BODY'), documentElement: makeEl('HTML'),
    createElement: makeEl,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const window = {
    document, innerWidth: 1000, innerHeight: 800,
    location: { pathname: '/docs/tools/some-tool/index.html', href: 'https://example.test/docs/tools/some-tool/index.html', search: '', origin: 'https://example.test' },
    localStorage: { getItem: key => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = String(value); } },
    getComputedStyle: () => ({ position: 'fixed', minWidth: '0px', minHeight: '0px', display: 'block', overflowY: 'visible' }),
    addEventListener() {},
  };
  window.window = window;
  const context = vm.createContext({ window, document, localStorage: window.localStorage, getComputedStyle: window.getComputedStyle, location: window.location, console, setTimeout, clearTimeout, requestAnimationFrame: fn => fn(), URL, URLSearchParams, navigator: {} });
  vm.runInContext(source, context);
  return { PanelUI: window.PanelUI, document, store };
}

// ---- a drawer with a stale saved size, loaded while closed ---------------
{
  const { PanelUI, store } = load({ w: '640px', h: '1100px' });
  assert(PanelUI && typeof PanelUI.makeResizableBox === 'function', 'PanelUI.makeResizableBox is not published');
  const drawer = makeEl('DETAILS');
  drawer.open = false;
  PanelUI.makeResizableBox(drawer, { corner: 'sw', axis: 'both', minWidth: 180, minHeight: 120, storageKey: 'drawerSize' });

  for (const prop of ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height']) {
    assert(!drawer.style.has(prop), `closed drawer must not keep an inline ${prop}; it would stay a huge invisible box that takes taps`);
  }

  drawer.open = true; drawer.fire('toggle');
  assert.strictEqual(drawer.style.getPropertyValue('height'), '1100px', 'opening restores the saved height');
  assert.strictEqual(drawer.style.getPropertyValue('width'), '640px', 'opening restores the saved width');
  assert.strictEqual(drawer.style.getPropertyPriority('height'), 'important', 'restored sizes keep their !important priority');

  drawer.style.setProperty('height', '700px', 'important'); // The user drags the grip while it is open...
  drawer.open = false; drawer.fire('toggle'); // ...then collapses the drawer.
  assert(!drawer.style.has('height') && !drawer.style.has('width'), 'collapsing must drop the explicit size again');

  drawer.open = true; drawer.fire('toggle');
  assert.strictEqual(drawer.style.getPropertyValue('height'), '700px', 'reopening restores the size the user last dragged to, not the stale saved one');
  assert.strictEqual(store.drawerSize, JSON.stringify({ w: '640px', h: '1100px' }), 'the persisted size is untouched by collapsing');
}

// ---- no stale size: closing and opening must not invent one --------------
{
  const { PanelUI } = load(null);
  const drawer = makeEl('DETAILS');
  PanelUI.makeResizableBox(drawer, { corner: 'sw', axis: 'both', storageKey: 'drawerSize' });
  drawer.open = true; drawer.fire('toggle');
  drawer.open = false; drawer.fire('toggle');
  assert(!drawer.style.has('height') && !drawer.style.has('width'), 'a drawer that was never resized keeps its stylesheet size');
}

// ---- non-<details> boxes keep their size (they are hidden with display:none, not collapsed) ---------------
{
  const { PanelUI } = load({ w: '500px', h: '400px' });
  const card = makeEl('DIV');
  PanelUI.makeResizableBox(card, { corner: 'se', axis: 'both', storageKey: 'drawerSize' });
  assert.strictEqual(card.style.getPropertyValue('height'), '400px', 'ordinary floating cards must still apply their saved size');
}

console.log('Panel UI closed-drawer size: PASS');
