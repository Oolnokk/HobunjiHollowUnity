'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8'); // Executes the production recovery helpers with a minimal DOM tree.
const helpers = source.slice(source.indexOf('  function rememberFocusPath'), source.indexOf('  // ── focus application')); // Keeps the test independent of browser input plumbing.
function node(attrs = {}, children = []) {
  const result = { children, parentElement: null, getAttribute: name => attrs[name] || null,
    contains(other) { return this === other || this.children.some(child => child.contains(other)); } }; // Models element identity, ancestry and children used by recovery.
  children.forEach(child => { child.parentElement = result; });
  return result;
}
const panel = node(); // Owns both inventory and storage lists to catch cross-list jumps.
const context = { panel, activePanel: () => panel, belongsToNavigation: (el, owner) => owner.contains(el) }; // Supplies only menu ownership dependencies.
vm.createContext(context);
vm.runInContext(`let focusPath = null; ${helpers}; this.remember = rememberFocusPath; this.recover = recoverFocusTarget;`, context);
const item = key => node({ 'data-stack-id': key }); // Represents a quality/genotype-specific stack button.
let bag = node({}, [item('a'), item('b'), item('c')]); // Replaced during each simulated inventory render.
const storage = node({}, [item('b')]); // Same stack ID in another list must never steal selection.
panel.children = [bag, storage]; bag.parentElement = storage.parentElement = panel;
context.remember(bag.children[1]);
bag.children = [item('b'), item('a'), item('c')]; bag.children.forEach(child => { child.parentElement = bag; });
assert.equal(context.recover(panel, [...bag.children, ...storage.children]), bag.children[0], 'same stack survives reordered rebuild');
context.remember(bag.children[2]);
bag.children = [item('b'), item('a'), node()]; bag.children.forEach(child => { child.parentElement = bag; });
assert.equal(context.recover(panel, [...bag.children.slice(0, 2), ...storage.children]), bag.children[1], 'consumed last stack skips disabled empty slot and stays in bag');
context.remember(bag.children[0]);
bag = node({}, [item('b'), item('a')]); bag.parentElement = panel; panel.children[0] = bag;
assert.equal(context.recover(panel, [...bag.children, ...storage.children]), bag.children[0], 'whole list replacement retains selection');
assert.equal(context.recover(node(), bag.children), null, 'another panel cannot inherit stale selection');
console.log('Controller focus rebuild recovery passed');
