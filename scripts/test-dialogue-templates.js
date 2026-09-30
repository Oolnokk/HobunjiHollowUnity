'use strict';
const assert = require('node:assert/strict'); // Verify generic templates independently of combat lessons.
const fs = require('node:fs'); // Loads the shipped module.
const vm = require('node:vm'); // Isolates the data-only expansion API.
const window = {}; // Runtime namespace used by both dialogue and activity authors.
vm.runInNewContext(fs.readFileSync('docs/js/dialogue-templates.js', 'utf8'), { window });
const templates = window.DialogueTemplates; // Production API under test.
const context = { shop: 'Potter', wares: [{ name: 'Bowl', price: 4 }, { name: 'Cup', price: 2 }] }; // An unrelated merchant example proves no dependency on tutorial data.
const source = [{ id: 'welcome', text: '{{playerName}}, welcome to {{context:shop}}.' }, { $each: 'wares', as: 'ware', template: { id: 'ware_{{context:index}}', text: '{{context:ware.name}} costs {{context:ware.price}}.', price: { $value: 'ware.price' } } }]; // One reusable pattern generates any number of shop lines.
const before = JSON.stringify(source); // Expansion must not write back into authoring data.
const nodes = templates.expand(source, context); // Generated nodes retain typed numeric fields.
assert.equal(nodes.length, 3);
assert.equal(nodes[0].text, '{{playerName}}, welcome to Potter.');
assert.equal(nodes[1].text, 'Bowl costs 4.');
assert.equal(nodes[2].price, 2);
assert.equal(JSON.stringify(source), before);
assert.equal(templates.format('{{context:missing}}', context), '{{context:missing}}');
assert.equal(templates.value(context, '__proto__.toString'), undefined);
assert.equal(templates.value(Object.create({ hidden: 1 }), 'hidden'), undefined);
assert.throws(() => templates.expand({ $each: 'absent', template: {} }, context));
assert.throws(() => templates.expand({ $each: 'wares', as: '__proto__', template: {} }, context));
console.log('Dialogue templates: reusable repeat blocks, typed bindings, unresolved tokens, immutable sources and safe paths passed.');
