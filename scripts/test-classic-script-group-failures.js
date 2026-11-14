#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const loader = fs.readFileSync('docs/js/bootstrap/classic-script-group-loader.js', 'utf8'); // Shipped parser-time loader under test.
new vm.Script(loader, { filename: 'classic-script-group-loader.js' });
const insertedScripts = []; // Captures script tags written during parsing.
const nodes = new Map(); // Mobile-visible error nodes created by the simulated page.
const body = { appendChild(element) { nodes.set(element.id, element); } }; // Minimal DOM append target for failures.
const listeners = []; // Installed event handlers, used to prove one capture listener across groups.
const domReadyCallbacks = []; // Deferred manifest warning callbacks queued before the body is parsed.
const browser = {
  addEventListener(type, callback, capture) { listeners.push({ type, callback, capture }); },
};
const doc = {
  readyState: 'loading',
  addEventListener(type, callback, options) { domReadyCallbacks.push({ type, callback, options }); },
  currentScript: { getAttribute: () => 'qol' },
  write(markup) { insertedScripts.push(markup); },
  body,
  getElementById(id) { return nodes.get(id) || null; },
  createElement(tag) {
    assert.equal(tag, 'div');
    return {
      style: {},
      setAttribute(key, value) { this[key] = value; },
    };
  },
};
const context = { window: browser, document: doc, Date: { now: () => 4321 } }; // Fake browser scope for real loader execution.
vm.runInNewContext(loader, context);
assert.equal(listeners.length, 1, 'the loader registers exactly one error listener');
assert.equal(listeners[0].type, 'error');
assert.equal(listeners[0].capture, true, 'capture is required for script resource load failures');
assert.match(insertedScripts[0], /classic-groups\/qol\.js\?load=4321/);
assert.match(insertedScripts[0], /<\/script>/);
assert.equal(nodes.size, 0, 'success path adds no DOM elements');
const failedGroups = browser.HobunjiClassicScriptGroups.failedGroups; // Readable mobile diagnostic state.
const resourceError = { target: { src: 'https://raw.githack.com/o/r/ref/docs/js/bootstrap/classic-groups/qol.js?load=4321' } }; // Failed manifest URL.
listeners[0].callback({ target: { src: 'https://example.org/docs/js/elsewhere.js' } });
assert.equal(failedGroups.length, 0, 'ordinary script errors do not produce a false manifest report');
listeners[0].callback(resourceError);
assert.equal(failedGroups.join(','), 'qol');
assert.equal(nodes.size, 1, 'one visible failure notice was mounted');
assert.match(nodes.get('classicScriptLoadFailure').textContent, /qol/);
assert.equal(nodes.get('classicScriptLoadFailure').role, 'alert');
listeners[0].callback(resourceError);
assert.equal(failedGroups.length, 1, 'repeated failures are de-duplicated');
listeners[0].callback({ filename: 'https://example.org/docs/js/bootstrap/classic-groups/guild.js?load=4321' });
assert.equal(failedGroups.join(','), 'qol,guild', 'manifest evaluation errors are also reported');
assert.equal(nodes.size, 1, 'subsequent failures reuse the notice');
assert.match(nodes.get('classicScriptLoadFailure').textContent, /qol, guild/);
doc.currentScript.getAttribute = () => 'render';
vm.runInNewContext(loader, context);
assert.equal(listeners.length, 1, 'repeated group loads must not register duplicate event listeners');
assert.equal(insertedScripts.length, 2, 'both groups still write their manifest tags');

// A manifest in <head> may fail before the page has created document.body.
nodes.clear();
doc.body = null;
listeners[0].callback({ target: { src: 'https://example.org/docs/js/bootstrap/classic-groups/combat-main.js?load=4321' } });
listeners[0].callback({ target: { src: 'https://example.org/docs/js/bootstrap/classic-groups/ruin-puzzles.js?load=4321' } });
assert.equal(nodes.size, 0, 'no alert can mount before body exists');
assert.equal(domReadyCallbacks.length, 1, 'multiple early failures queue one DOMContentLoaded handler');
assert.equal(domReadyCallbacks[0].type, 'DOMContentLoaded');
assert.equal(domReadyCallbacks[0].options.once, true);
doc.body = body;
domReadyCallbacks[0].callback();
assert.equal(nodes.size, 1, 'body availability surfaces previously silent head-time errors');
assert.match(nodes.get('classicScriptLoadFailure').textContent, /combat-main, ruin-puzzles/);
assert.equal(browser.HobunjiClassicScriptGroups.failedGroups.length, 4, 'diagnostics retain all early and late failures');

console.log('Manifest load and evaluation errors surface once on mobile without affecting successful startup.');
