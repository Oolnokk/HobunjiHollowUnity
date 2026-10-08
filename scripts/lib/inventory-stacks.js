'use strict';

// Loads the real docs/js/inventory-stacks.js for tests that run a single
// feature module in an isolated sandbox (index.html loads it first in game).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, Math, Number, Object };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../docs/js/inventory-stacks.js'), 'utf8'), sandbox);
module.exports = sandbox.window.InventoryStacks;
