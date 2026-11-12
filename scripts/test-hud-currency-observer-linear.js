'use strict';

// Verify that the shipped HUD's currency normalizer visits nested DOM trees
// linearly, without changing legacy currency or physical gold wording.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/hud-update.js', 'utf8'); // Loads the actual HUD implementation under test.
let elementReads = 0; // Counts subtree textContent reads; quadratic rescanning makes this grow with tree depth.
const observers = []; // Captures the actual currency observer callback for simulated UI mutations.
function textNode(value) {
  return {
    nodeType: 3,
    nodeValue: value,
    get textContent() { return this.nodeValue; },
  };
}
function element(children = []) {
  return {
    nodeType: 1,
    childNodes: children,
    get textContent() {
      elementReads++;
      return this.childNodes.map(child => child.textContent).join('');
    },
  };
}
class MutationObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe(target, options) { this.target = target; this.options = options; }
  notify(records) { this.callback(records); }
}
const document = { body: element([]) }; // Avoids unrelated browser rendering dependencies while installing the real observer.
const window = {};
const context = { window, document, MutationObserver, console, Date };
vm.runInNewContext(source, context, { filename: 'hud-update.js' });
const noopButton = { addEventListener() {} };
window.HudUpdate.init({ itemPrev: noopButton, itemNext: noopButton, ITEM_DEFS: { mulch: { sellPrice: 1 } } });
assert.equal(observers.length, 1, 'HUD installs exactly one currency-text observer');
assert.equal(observers[0].target, document.body, 'currency-text observer watches the main UI');
const rewrite = window.HobunjiCurrencyLore.rewriteSubtree; // Exercises the public integration entry point, not a copied algorithm.

let nested = element([textNode('Reward: 15 gold'), textNode('2 Gold Bars'), textNode('Not enough gold.')]);
const matchNodes = nested.childNodes; // Retains original leaf references for strict text and idempotence assertions.
const levels = 35; // Represents nested menus, grids and item description wrappers.
const extrasPerLevel = 25; // Stresses irrelevant HUD text alongside deeply nested currency text.
for (let depth = 0; depth < levels; depth++) {
  const extras = Array.from({ length: extrasPerLevel }, (_, index) => textNode('health ' + depth + ':' + index));
  nested = element([nested, ...extras]);
}
elementReads = 0;
assert.equal(rewrite(nested), 2, 'only genuine monetary text changes');
assert.equal(matchNodes[0].nodeValue, 'Reward: 15 ganang');
assert.equal(matchNodes[1].nodeValue, '2 Gold Bars', 'physical metal descriptions remain untouched');
assert.equal(matchNodes[2].nodeValue, 'Not enough ganang.');
assert(elementReads <= levels + 2, 'nested UI textContent must be read once, not again for every descendant');
assert.equal(rewrite(nested), 0, 'a second render pass is idempotent');

const quiet = element([element([textNode('hit'), textNode('target missed')])]);
elementReads = 0;
assert.equal(rewrite(quiet), 0, 'non-currency combat events do not change');
assert.equal(elementReads, 2, 'unrelated subtrees bail out after one top-level native text scan');

const rootText = textNode('Gold reward');
assert.equal(rewrite(rootText), 1, 'standalone text nodes remain supported');
assert.equal(rootText.nodeValue, 'Ganang reward');

const changed = textNode('Fee in gold');
const added = element([element([changed]), textNode('3 gold ingots')]);
observers[0].notify([{ type: 'childList', target: document.body, addedNodes: [added] }]);
assert.equal(changed.nodeValue, 'Fee in ganang', 'newly attached menu content is still normalized');
assert.equal(added.childNodes[1].nodeValue, '3 gold ingots', 'physical gold text survives observer updates');

const updated = textNode('50 gold');
observers[0].notify([{ type: 'characterData', target: updated, addedNodes: [] }]);
assert.equal(updated.nodeValue, '50 ganang', 'characterData mutations remain supported');
assert.equal(observers[0].options.characterData, true);
assert.equal(observers[0].options.childList, true);

console.log('HUD currency observer linear traversal: ok');
