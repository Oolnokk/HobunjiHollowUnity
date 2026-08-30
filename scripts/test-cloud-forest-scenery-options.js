'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/cloud-forest-scenery-options.js'), 'utf8');
let stored = new Map();
const root = {
  localStorage: { getItem: k => stored.has(k) ? stored.get(k) : null, setItem: (k,v) => stored.set(k,String(v)) },
  setInterval: () => 1,
  clearInterval: () => {},
  document: { getElementById: () => null },
};
root.window = root;
const context = vm.createContext({ window: root, document: root.document, setInterval: root.setInterval, clearInterval: root.clearInterval, console });
vm.runInContext(source, context, { filename: 'cloud-forest-scenery-options.js' });
const api = root.CloudForestSceneryOptions;
if (!api) throw new Error('CloudForestSceneryOptions API missing');
if (api.DENSITY_KEEP !== 0.25) throw new Error('Cloud Forest north tree wall must retain exactly 25% density');
if (!api.treeWallEnabled()) throw new Error('tree wall should default on');
api.setTreeWallEnabled(false);
if (api.treeWallEnabled()) throw new Error('tree wall setting did not switch to cliffs');
api.setTreeWallEnabled(true);
if (!api.treeWallEnabled()) throw new Error('tree wall setting did not switch back on');
console.log('PASS Cloud Forest scenery options: 25% density + persistent tree/cliff boundary toggle.');
