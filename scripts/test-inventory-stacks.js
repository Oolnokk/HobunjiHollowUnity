'use strict';

// Executes docs/js/inventory-stacks.js: 99 is a per-box display size, not a
// per-item cap — overflow spills into another box of the same item.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const window = {};
vm.runInNewContext(fs.readFileSync('docs/js/inventory-stacks.js', 'utf8'), { window, Math, Number, Object });
const { STACK_SIZE, MAX_TOTAL, stackCounts, clampTotal } = window.InventoryStacks;

assert.equal(STACK_SIZE, 99);
assert.ok(MAX_TOTAL > STACK_SIZE * 10, 'the per-item ceiling allows many full stacks');
assert.deepEqual(stackCounts(0), []);
assert.deepEqual(stackCounts(5), [5]);
assert.deepEqual(stackCounts(99), [99]);
assert.deepEqual(stackCounts(100), [99, 1]);
assert.deepEqual(stackCounts(250), [99, 99, 52]);
assert.deepEqual(stackCounts(undefined), []);
assert.equal(clampTotal(MAX_TOTAL + 5), MAX_TOTAL);
assert.equal(clampTotal(NaN), 0);

// No grant site should still clamp a bag count to a single 99 stack.
const files = ['docs/game.js', ...fs.readdirSync('docs/js').filter(f => f.endsWith('.js')).map(f => `docs/js/${f}`),
  ...fs.readdirSync('docs/js/combat').filter(f => f.endsWith('.js')).map(f => `docs/js/combat/${f}`)];
const offenders = [];
for (const file of files) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/nventory/.test(line) && /Math\.min\(9{1,2}\s*,/.test(line)) offenders.push(`${file}:${i + 1}`);
  });
}
assert.deepEqual(offenders, [], 'inventory grants must use InventoryStacks.MAX_TOTAL, not a 99/9 cap');

console.log('inventory-stacks: ok');
