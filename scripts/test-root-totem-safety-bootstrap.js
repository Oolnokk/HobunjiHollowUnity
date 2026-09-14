'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const safetySource = fs.readFileSync(path.join(repoRoot, 'docs/js/root-totem-safety.js'), 'utf8'); // Actual adapter source exercised against an existing future-global accessor.
let innerGenerator = null; // Simulates the value storage owned by an earlier bootstrap hook.
const window = { HOBUNJI_ROOT_TOTEM_CONFIG: { placement: { combatPoiClearanceTiles: 12 } } };
Object.defineProperty(window, 'WildernessMapGenerator', {
  configurable: true,
  enumerable: true,
  get() { return innerGenerator; },
  set(value) { innerGenerator = value; },
});
window.window = window;
const context = vm.createContext({ window, console, globalThis: window }); // Browser-shaped sandbox where RootTotemSafety installs after the pre-existing accessor.
new vm.Script(safetySource, { filename: 'docs/js/root-totem-safety.js' }).runInContext(context);

const generator = {
  generateWorkspace() { return { maps: [], rootTotems: [], animalDens: [] }; },
  generateZoneWorkspace() { return { maps: [], rootTotems: [], animalDens: [] }; },
  zoneMapIds() { return []; },
}; // Assigned after RootTotemSafety loads, exactly like a parser-loaded future global.
window.WildernessMapGenerator = generator;

assert.strictEqual(innerGenerator, generator, 'RootTotemSafety must pass assignments through the earlier setter.');
assert.strictEqual(window.WildernessMapGenerator, generator, 'RootTotemSafety must preserve the resolved global value.');
assert.strictEqual(generator.__rootTotemSafetyInstalled, true, 'Resolved generator must receive the Root Totem adapter.');
const descriptor = Object.getOwnPropertyDescriptor(window, 'WildernessMapGenerator'); // Confirms the chained bootstrap hook collapses back to a normal value property after assignment.
assert.strictEqual(typeof descriptor.get, 'undefined');
assert.strictEqual(descriptor.value, generator);

console.log('root-totem safety bootstrap hook regression checks: PASS');
