#!/usr/bin/env node
'use strict';
// Runs the shipped panel renderer against a small DOM model to verify dropdown
// commands and preserve focus while unrelated companion panels update.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; // Used to find dropdowns in the rendered tree.
    this.attrs = attrs; // Captures the actual event callbacks produced by renderPanels.
    this.children = children.flat().filter(child => child instanceof Element); // The fixture needs element structure only.
    this.parent = null; // Maintains insert/remove semantics for focus-preservation tests.
    for (const child of this.children) child.parent = this;
    this.value = this.children.find(child => child.attrs.selected)?.attrs.value || ''; // Models a select's selected option.
  }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  matches(selector) { return selector.split(',').map(part => part.trim()).includes(this.tag); }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceWith(node) {
    if (!this.parent) return;
    const parent = this.parent; // Preserves the parent through the node replacement.
    parent.children[parent.children.indexOf(this)] = node;
    node.parent = parent;
    this.parent = null;
  }
  insertBefore(node, before) {
    node.remove();
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
    node.parent = this;
  }
  find(tag) { return this.tag === tag ? this : this.children.map(child => child.find(tag)).find(Boolean); }
}
(async () => {
  const host = new Element('host'); // Represents the existing companion panel container.
  const sent = []; // Captures commands sent to the game using the normal panel-action transport.
  const context = vm.createContext({
    panelCards: new Map(), document: { activeElement: null },
    state: { connected: true, game: { panels: [] } },
    $: () => host,
    el: (tag, attrs, ...children) => new Element(tag, attrs, children),
    button: label => new Element('button', { label }),
    run: async (name, args) => { sent.push({ name, args }); return { ok: true }; },
  }); // Supplies only the renderer's DOM/transport dependencies.
  const source = fs.readFileSync('docs/tools/dev-companion/dev-companion.js', 'utf8'); // The real renderer being shipped.
  vm.runInContext(source.slice(source.indexOf('  function renderPanels()'), source.indexOf('  function renderHistory()')), context);
  const clock = { id: 'clock', title: 'Clock', summary: '12:00' }; // Changes independently of the grant controls.
  const grants = { id: 'grants', title: 'Grants', actions: [{ id: 'grant', label: 'Trinket', args: { source: 'dev' }, reset: true, options: [{ value: '', label: 'Choose…' }, { value: 'icon', label: 'Icon' }] }] }; // Models the actual grant schema.
  context.state.game.panels = [clock, grants];
  context.renderPanels();
  const firstCard = host.children[0]; // Used to verify changed panels replace their old nodes.
  const grantCard = host.children[1]; // Must remain mounted when the clock changes.
  const select = grantCard.find('select'); // Its callback comes from the shipped renderer.
  context.document.activeElement = select;
  clock.summary = '12:01';
  context.renderPanels();
  assert.equal(host.children.length, 2, 'updated cards replace their old nodes without accumulating copies');
  assert.notEqual(host.children[0], firstCard);
  assert.equal(host.children[1], grantCard, 'clock refresh preserves the grant card and focus');
  grants.note = 'Updated while picker open';
  context.renderPanels();
  assert.equal(host.children[1], grantCard, 'focused dropdown survives changes in its own panel');
  select.value = 'icon';
  await select.attrs.onchange({ target: select });
  assert.equal(sent[0].name, 'panel-action');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].args)), { panel: 'grants', action: 'grant', args: { source: 'dev', value: 'icon' } });
  assert.equal(select.value, '', 'grant picker resets so the same trinket can be granted again');
  context.document.activeElement = null;
  context.renderPanels();
  assert.notEqual(host.children[1], grantCard, 'deferred panel changes render after focus leaves');
  assert.equal(host.children.length, 2);
  const toggleCard = host.children[1]; // A clicked toggle button keeps browser focus but must still pick up the new state.
  context.document.activeElement = new Element('button', { label: 'Show Hitboxes' });
  toggleCard.children.push(context.document.activeElement);
  grants.note = 'Toggled';
  context.renderPanels();
  assert.notEqual(host.children[1], toggleCard, 'a focused button does not freeze its card on stale state');
  context.document.activeElement = null;
  context.state.game.panels = [clock];
  context.renderPanels();
  assert.equal(host.children.length, 1, 'unavailable cheat panels disappear');
  const tuning = { id: 'tuning', actions: [{ id: 'value', label: 'Fog radius', args: { controlId: 'radius' }, value: '30', input: { min: '5', max: '40', step: '1' } }] }; // Uses the schema emitted by the Settings owner.
  context.state.game.panels = [clock, tuning];
  context.renderPanels();
  const field = host.children[1].find('input'); // Exercises the shipped numeric editor and its command payload.
  assert.equal(field.attrs.min, '5');
  assert.equal(field.attrs.max, '40');
  field.value = '25';
  await field.attrs.onchange({ target: field });
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1].args)), { panel: 'tuning', action: 'value', args: { controlId: 'radius', value: '25' } });
  context.run = async () => null;
  field.value = 'invalid';
  await field.attrs.onchange({ target: field });
  assert.equal(field.value, '30', 'failed numeric edits restore the last authoritative value');

  console.log('test-dev-companion-panel-controls: ok');
})().catch(error => { console.error(error); process.exit(1); });
