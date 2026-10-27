'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/controller-ui-nav.js', 'utf8'); // Runs the production section-choice presentation without a browser dependency.
const calls = []; // Records pointer navigation requests for comparison with the controller's shared route.
class Choice {
  constructor() {
    this.attrs = new Map(); this.children = []; this.hidden = true; this.handlers = {}; this.rebuilds = 0;
  }
  getAttribute(name) { return this.attrs.get(name) || null; }
  setAttribute(name, value) { this.attrs.set(name, value); }
  replaceChildren() { this.children = []; this.rebuilds++; }
  appendChild(child) { this.children.push(child); }
  addEventListener(name, callback) { this.handlers[name] = callback; }
  scrollIntoView() {}
}
const context = vm.createContext({
  document: { createElement: () => new Choice() },
  selectLocalSection: (...args) => calls.push(args),
}); // DOM semantics are modeled; the actual label and strip functions execute unchanged.
vm.runInContext(source.slice(source.indexOf('  function navigationLabel('), source.indexOf('  function updateHintBar(panel) {')), context);
const section = (id, label) => ({ id, getAttribute: () => label, querySelector: () => null }); // Stable ids and authored headings model real page sections.
const group = {}; // Maintains the controller section owner across DOM rebuilds.
const panel = {}; // Pointer navigation must target the same active panel as bumper navigation.
const host = new Choice(); // Holds the visible alternatives without adding controller focus stops.
const sections = [section('farmSectionLayout', 'Overview'), section('farmSectionStorage', 'Storage')]; // Two distinct destinations exercise direct jumps and active state.
let state = { sections, selected: sections[0] }; // Controller's existing subtab state remains the selection authority.
context.updateSectionChoices(host, { node: group }, state, panel);
assert.equal(host.hidden, false);
assert.deepEqual(host.children.map(child => child.textContent), ['Overview', 'Storage']);
assert.deepEqual(host.children.map(child => child.getAttribute('aria-pressed')), ['true', 'false']);
host.children[1].handlers.click();
assert.deepEqual(calls.pop(), [group, panel, 1], 'Pointer choice uses the same section selection route as LB/RB');
state.selected = sections[1];
context.updateSectionChoices(host, { node: group }, state, panel);
assert.equal(host.rebuilds, 1, 'Moving within a section does not rebuild the choice controls');
assert.deepEqual(host.children.map(child => child.getAttribute('aria-pressed')), ['false', 'true']);
context.updateSectionChoices(host, null, null, panel);
assert.equal(host.hidden, true, 'Leaving the section restores the ordinary hint bar');
state = { sections: [section('farmSectionLayout', 'Overview'), section('farmSectionStorage', 'Supplies')], selected: null };
state.selected = state.sections[0];
context.updateSectionChoices(host, { node: group }, state, panel);
assert.equal(host.rebuilds, 2, 'Changed authored labels update the visible choices');
assert.equal(host.children[1].textContent, 'Supplies');
assert.equal(context.navigationLabel(section('farmSectionStorage', null)), 'Storage', 'Legacy sections get readable fallback names');
console.log('Menu section choices: labels, pointer routing, selection, teardown and event-driven refresh passed.');
