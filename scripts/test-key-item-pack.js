// Regression: world/character key-item grants and consumption populate the authored Pack key list.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/key-item-system.js', 'utf8'); // Actual runtime, not a copied inventory simulator.
const style = fs.readFileSync('docs/style.css', 'utf8'); // Authored key-chip styling must remain present and visible.
const overrides = JSON.parse(fs.readFileSync('docs/config/ui/ui-element-editor-overrides.json', 'utf8')); // Prevents accidental reintroduction of the zero-height override.
new vm.Script(source, {filename: 'key-item-system.js'});
assert(style.includes('.inv-key-chip[aria-expanded="true"] .inv-key-desc'), 'tapping a key must expose its description');
assert.equal(overrides.elements['#invKeyList'], undefined, 'the UI editor must not collapse the key list');

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.handlers = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) {
    this.children = nodes.flatMap(node => node.tagName === '#fragment' ? node.children : [node]);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { this.handlers[name] = callback; }
  click() { this.handlers.click?.(); }
  querySelectorAll(selector) {
    if (selector !== '.inv-key-chip[aria-expanded="true"]') throw new Error('unexpected selector: ' + selector);
    return this.children.filter(node => node.className === 'inv-key-chip' && node.getAttribute('aria-expanded') === 'true');
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const keyList = new FakeNode('div'); // The real #invKeyList already exists in docs/index.html.
const listeners = new Map(); // Allows simulating player-ready and DOM-content-loaded events.
const document = {
  getElementById: id => id === 'invKeyList' ? keyList : null,
  createDocumentFragment: () => new FakeNode('#fragment'),
  createElement: tagName => new FakeNode(tagName),
  addEventListener: (event, callback) => listeners.set(event, callback),
};
const profile = {worldId:'worldA',characterId:'characterA',gearInventory:{keyItems:[]}}; // Live identity used to test save-scope isolation.
let meta = {
  characters:[{id:'characterA',gearInventory:{keyItems:[]}}],
  worlds:[{id:'worldA',keyItems:[]},{id:'worldB',keyItems:[]}],
}; // In-memory copy of the real hobunjiSaveMeta persistence schema.
const storage = {
  getItem: key => key === 'hobunjiSaveMeta' ? JSON.stringify(meta) : null,
  setItem: (key, value) => { if (key === 'hobunjiSaveMeta') meta = JSON.parse(value); },
};
const window = {document,localStorage:storage,__hobunjiPlayerProfile:profile,__farmLog(){}}; // Same public API surface as the browser.
vm.runInNewContext(source, {window,document,console});
const api = window.KeyItemSystem;
api.defineMany([
  {id:'delversStone',label:"Delver's Stone",scope:'world',icon:'🔴',desc:'Guild license'},
  {id:'azgarlu_key_stone',label:"Azgarlu's Key-Stone",scope:'world',desc:'Lich tomb key'},
  {id:'color_pools_key',label:'Color Pools Key',scope:'world',desc:'Banubu world unlock'},
  {id:'personal_test_key',label:'Personal Key',scope:'character',desc:'Character-bound key'},
]); // Both Guild and Banubu key items feed the same Pack section.
assert.equal(keyList.children.length,1);
assert.equal(keyList.children[0].className,'inv-key-empty');

assert.equal(api.grant('delversStone').granted,true);
assert.equal(api.grant('azgarlu_key_stone').granted,true);
assert.equal(api.grant('color_pools_key').granted,true);
assert.equal(api.grant('personal_test_key').granted,true);
assert.equal(api.grant('delversStone').granted,false,'repeated grants cannot duplicate key chips');
assert.equal(keyList.children.length,4,'all four acquired keys are shown in Key Items');
const delvers = keyList.children.find(node => node.dataset.keyItemId === 'delversStone'); // Targeted mobile interaction check.
assert(delvers.children.some(node => node.textContent === "Delver's Stone"), 'authored key label is visible');
delvers.click();
assert.equal(delvers.getAttribute('aria-expanded'),'true','tap expands an in-game description');
const personal = keyList.children.find(node => node.dataset.keyItemId === 'personal_test_key');
personal.click();
assert.equal(delvers.getAttribute('aria-expanded'),'false','only one description should be expanded');
assert.equal(personal.getAttribute('aria-expanded'),'true');

assert.equal(api.revoke('azgarlu_key_stone').removed,true);
assert(!keyList.children.some(node => node.dataset.keyItemId === 'azgarlu_key_stone'),'used lich keys disappear immediately');
assert.equal(api.revoke('azgarlu_key_stone').removed,false,'repeated consumption is safe');
profile.worldId = 'worldB'; // World-bound keys must disappear when the character moves to another world.
listeners.get('hobunjiPlayerReady')();
assert.deepEqual(keyList.children.map(node => node.dataset.keyItemId), ['personal_test_key']);
profile.worldId = 'worldA';
listeners.get('hobunjiPlayerReady')();
assert.equal(keyList.children.length,3,'world keys reappear when re-entering the same world');
assert.equal(api.has('color_pools_key'),true,'Banubu Color Pools Key remains accessible');
assert.equal(api.has('delversStone'),true);
assert.equal(api.has('azgarlu_key_stone'),false);
assert.equal(meta.worlds[1].keyItems.length,0);

console.log('Key-item Pack display, mobile details, world isolation, and key consumption: passed');
