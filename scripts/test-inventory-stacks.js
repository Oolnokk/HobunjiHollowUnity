'use strict';

// Executes docs/js/inventory-stacks.js: 999 is a per-box display size, not a
// per-item cap — overflow spills into another box of the same item.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const window = {};
vm.runInNewContext(fs.readFileSync('docs/js/inventory-stacks.js', 'utf8'), { window, Math, Number, Object });
const { STACK_SIZE, MAX_TOTAL, stackCounts, clampTotal } = window.InventoryStacks;

assert.equal(STACK_SIZE, 999);
assert.equal(MAX_TOTAL, 9999, 'the per-item ceiling remains independent of display stack size');
assert.equal(window.InventoryStacks.getDebug().stackSize, STACK_SIZE, 'mobile diagnostics expose the live stack size');
assert.deepEqual(stackCounts(0), []);
assert.deepEqual(stackCounts(5), [5]);
assert.deepEqual(stackCounts(250), [250]);
assert.deepEqual(stackCounts(999), [999]);
assert.deepEqual(stackCounts(1000), [999, 1]);
assert.deepEqual(stackCounts(2500), [999, 999, 502]);
assert.deepEqual(stackCounts(MAX_TOTAL), [...Array(10).fill(999), 9], 'a capped inventory still spills safely into 11 slots');
assert.deepEqual(stackCounts(undefined), []);
assert.equal(clampTotal(MAX_TOTAL + 5), MAX_TOTAL);
assert.equal(clampTotal(NaN), 0);

// No grant site should clamp a bag count to an old 9/99-item cap.
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
