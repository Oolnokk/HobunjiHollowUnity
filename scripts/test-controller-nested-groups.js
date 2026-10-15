'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = new Map(); // Native focus/keyboard events exercise the shipped navigator, without a browser dependency.
const observers = []; // Delivers actual subtree-rebuild notifications to the production observer callbacks.
let document; // Assigned after constructing the fake body/panels used by focus().
class Element {
  constructor(tag = 'div', attrs = {}, children = [], x = 0, y = 0) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = { ...attrs };
    this.children = []; this.parentElement = null; this.disabled = false; this.hidden = false;
    this.style = {}; this.tabIndex = tag === 'button' ? 0 : -1; this.clicks = 0;
    this.x = x; this.y = y; this.textContent = attrs.id || tag;
    this.classes = new Set((attrs.class || '').split(' ').filter(Boolean));
    this.classList = { contains: value => this.classes.has(value), add: value => this.classes.add(value), remove: value => this.classes.delete(value) };
    children.forEach(child => this.append(child));
  }
  get id() { return this.attrs.id || ''; }
  get className() { return [...this.classes].join(' '); }
  get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); }
  hasAttribute(name) { return name === 'tabindex' ? this.tabIndex >= 0 || name in this.attrs : name in this.attrs; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  append(child) { child.parentElement = this; this.children.push(child); }
  contains(other) { return other === this || this.children.some(child => child.contains(other)); }
  matches(selector) {
    return selector.split(',').some(raw => {
      const part = raw.trim(); // Only the DOM selector boundary is mocked; all navigation logic is production code.
      if (part.includes(' ')) return false;
      const tag = part.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (part.startsWith('.') && !this.classes.has(part.slice(1))) return false;
      if (part.startsWith('#') && this.id !== part.slice(1)) return false;
      for (const [, name, value] of part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(name) || (value !== undefined && this.getAttribute(name) !== value)) return false;
      }
      return true;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { left: this.x, top: this.y, width: 80, height: 24 }; }
  focus() { document.activeElement = this; for (const callback of listeners.get('focusin') || []) callback({ target: this }); }
  blur() { document.activeElement = body; }
  scrollIntoView() {}
  click() { this.clicks++; this.onclick?.(); }
  addEventListener() {}
}
const button = (id, x, y, attrs = {}) => new Element('button', { id, ...attrs }, [], x, y); // Positions give the real cone scorer meaningful competitors.
const a = button('a', 10, 40); // First control inside the outer group.
const b = button('b', 110, 40); // Sibling selected by Right inside that group.
const innerButton = button('inner-button', 10, 100); // Control that requires entering the second nesting level.
const inner = new Element('div', { id: 'inner', 'data-ctrl-group': '' }, [innerButton], 10, 100); // Explicit nested-menu contract.
const group = new Element('div', { id: 'group', 'data-ctrl-group': '' }, [a, b, inner], 10, 40); // Parent sections are single candidates before Confirm.
const outside = button('outside', 250, 40); // Tempting spatial neighbor that must never steal selection inside a nest.
const tabA = button('tab-a', 250, 100); // A sibling tab group tests bumper confinement.
const tabB = button('tab-b', 350, 100);
const tabs = new Element('div', { 'data-ctrl-tabs': '' }, [tabA, tabB], 250, 100);
const close = button('close', 400, 0, { 'data-ctrl-cancel': '' }); // Only root-level Back should activate the panel close action.
const panel = new Element('div', { id: 'panel', 'data-ctrl-panel': '' }, [group, outside, tabs, close]);
const body = new Element('body', {}, [panel]); // Sole connected document root.
document = { body, activeElement: body, addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); } };
const context = {
  document, console, getComputedStyle: el => ({ display: el.hidden ? 'none' : el.style.display || 'block', visibility: 'visible', opacity: '1' }),
  window: { addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); }, dispatchEvent() {} },
  MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
  queueMicrotask, setTimeout: () => 1, clearTimeout() {}, KeyboardEvent: class {},
}; // No custom navigation helpers: boot, press, focus recovery and cancel execute the entire shipped module.
vm.runInNewContext(fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8'), context);
const ui = context.window.ControllerUI; // Same public diagnostic/press API used in-game.
const press = action => ui.press(action); // Reconciles real panel ownership on every input.
const rebuild = async target => { for (const observer of observers) observer([{ target, addedNodes: [], removedNodes: [] }]); await Promise.resolve(); }; // Flushes production mutation-driven focus recovery.
(async () => {
  assert.equal(ui.focusedElement(), group, 'whole section gets initial focus');
  assert.ok(group.classList.contains('ctrl-nav-focus'));
  press('confirm');
  assert.equal(ui.focusedElement(), a);
  assert.equal(a.clicks, 0, 'entering does not accidentally activate the first item');
  press('right'); assert.equal(ui.focusedElement(), b);
  press('right'); assert.equal(ui.focusedElement(), b, 'Right cannot escape to a nearby outside item');
  press('tabNext'); assert.equal(tabB.clicks, 0, 'bumper cannot switch tabs outside the nest');
  press('cancel'); assert.equal(ui.focusedElement(), group);
  assert.equal(close.clicks, 0);
  press('confirm'); assert.equal(ui.focusedElement(), b, 're-enter remembers selection');
  press('down'); assert.equal(ui.focusedElement(), inner, 'nested section is a single glowing target');
  press('confirm'); assert.equal(ui.focusedElement(), innerButton);
  assert.equal(ui.debugState().groupDepth, 2);
  press('right'); assert.equal(ui.focusedElement(), innerButton);
  press('cancel'); assert.equal(ui.focusedElement(), inner); assert.equal(ui.debugState().groupDepth, 1);
  press('cancel'); assert.equal(ui.focusedElement(), group); assert.equal(ui.debugState().groupDepth, 0);

  innerButton.focus();
  assert.equal(ui.debugState().groupDepth, 2, 'switching to mouse/native focus adopts its containing nests');
  const escape = () => { let prevented = false; for (const listener of listeners.get('keydown')) listener({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} }); return prevented; };
  assert.equal(escape(), false, 'Escape after mouse/native focus reaches the game, which closes the menu');
  assert.equal(ui.debugState().groupDepth, 2, 'focus-adopted scopes are not unwound by keyboard Escape');
  press('cancel'); press('cancel');
  assert.equal(ui.debugState().groupDepth, 0, 'controller Back still unwinds adopted scopes');
  press('confirm'); assert.equal(ui.debugState().groupDepth, 1);
  assert.equal(escape(), true, 'Escape exits a nest entered with Confirm');
  assert.equal(ui.debugState().groupDepth, 0);

  a.focus();
  const replacementA = button('a', 10, 40); // Represents a full menu section rebuild preserving IDs.
  const replacementGroup = new Element('div', { id: 'group', 'data-ctrl-group': '' }, [replacementA], 10, 40);
  panel.children[0] = replacementGroup; replacementGroup.parentElement = panel; group.parentElement = null;
  await rebuild(panel);
  assert.equal(ui.focusedElement(), replacementA, 'rebuild restores the selected control immediately');
  assert.ok(replacementA.classList.contains('ctrl-nav-focus'), 'rebuilt selection retains its glow without another input');
  assert.equal(ui.debugState().groupDepth, 1);
  press('right'); assert.equal(ui.focusedElement(), replacementA, 'rebuild preserves confinement');

  const modalClose = button('modal-close', 0, 0, { 'data-ctrl-cancel': '' }); // A genuine modal temporarily supersedes the entered underlying group.
  const modalAction = button('modal-action', 0, 40);
  const modal = new Element('div', { id: 'modal', 'data-ctrl-panel': '' }, [modalClose, modalAction]);
  body.append(modal); await rebuild(body);
  // Registration normally arrives as an added node in the structural observer.
  for (const observer of observers) observer([{ target: body, addedNodes: [modal], removedNodes: [] }]);
  await Promise.resolve();
  assert.equal(ui.activePanel(), modal);
  assert.equal(ui.focusedElement(), modalAction);
  modal.hidden = true; await rebuild(modal);
  assert.equal(ui.activePanel(), panel);
  assert.equal(ui.focusedElement(), replacementA, 'modal handoff returns to the same nested control');
  press('cancel'); assert.equal(ui.focusedElement(), replacementGroup);
  replacementA.disabled = true; await rebuild(replacementGroup);
  assert.equal(ui.focusedElement(), outside, 'now-empty section is skipped even after it acquired tabindex');
  press('cancel'); assert.equal(close.clicks, 1, 'root Back uses the existing close action');
  assert.equal(panel.querySelectorAll('.ctrl-nav-focus').length, 1, 'exactly one control glows after all handoffs');
  const perk = (tree, x) => new Element('div', { class: 'perk-tree', 'data-tree': tree }, [new Element('div', { 'data-perk': 'health' }, [
    button('', x, 200, { 'data-perk-action': 'dec' }), button('', x + 100, 200, { 'data-perk-action': 'inc' }),
  ])], x, 180); // Mirrors id-less perk markup whose siblings gain enabled minus buttons after spending a point.
  const originalTree = perk('combat', 20); // Selected tree must survive a reorder of all rendered perk trees.
  const originalOther = perk('alchemy', 220);
  panel.append(originalTree); panel.append(originalOther);
  originalTree.children[0].children[1].focus();
  const nextTree = perk('combat', 20);
  const nextOther = perk('alchemy', 220);
  panel.children.splice(-2, 2, nextOther, nextTree);
  nextTree.parentElement = nextOther.parentElement = panel;
  originalTree.parentElement = originalOther.parentElement = null;
  await rebuild(panel);
  assert.equal(ui.focusedElement(), nextTree.children[0].children[1], 'id-less perk controls retain skill, row and plus/minus identity across reorder');
  assert.equal(ui.debugState().groupDepth, 1);
  panel.children.splice(panel.children.indexOf(nextTree), 1); nextTree.parentElement = null;
  await rebuild(panel);
  assert.equal(ui.debugState().groupDepth, 0, 'removing a nest unwinds instead of entering a different sibling section');
  console.log('Controller nested group confinement, Back, rebuild and modal handoffs passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
