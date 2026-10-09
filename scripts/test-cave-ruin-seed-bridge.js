const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/js/cave-ruin-seed-bridge.js'), 'utf8');
const localeSource = fs.readFileSync(path.join(root, 'docs/js/locale-cave-runtime.js'), 'utf8');

const context = { console, Math, Object, String }; // VM global used to exercise the same assignment-time DevRandomRuin hook as browser parser order.
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'cave-ruin-seed-bridge.js' });

const Bridge = context.CaveRuinSeedBridge;
assert(Bridge, 'CaveRuinSeedBridge exports');
const firstText = 'map_western_slope:animalDen_2:52,18:ruin'; // Representative CaveSiteSystem descriptive ruin seed.
const secondText = 'map_northern_cliffs:animalDen_1:30,12:ruin'; // Distinct cave identity used to verify cave-linked ruins do not collapse onto one seed.
const first = Bridge.normalizeSeed(firstText);
const second = Bridge.normalizeSeed(secondText);
assert(Number.isInteger(first) && first > 0, 'cave seed becomes a positive uint32-compatible number');
assert.equal(first, Bridge.normalizeSeed(firstText), 'same cave seed is deterministic');
assert.notEqual(first, second, 'different caves produce different ruin seeds');
assert.equal(Bridge.normalizeSeed(123456), 123456, 'existing numeric ruin seeds pass through unchanged');
assert.equal(Bridge.normalizeSeed('not-a-cave-seed'), 'not-a-cave-seed', 'unrelated string callers retain existing DevRandomRuin behavior');

let capturedSeed = null; // Records the seed actually received by DevRandomRuin after the future-global wrapper installs.
context.DevRandomRuin = {
  async generate(seed) { capturedSeed = seed; return true; },
};
context.DevRandomRuin.generate(firstText);
assert.equal(capturedSeed, first, 'assignment-time hook normalizes cave seed before DevRandomRuin receives it');

assert(localeSource.includes('cave-ruin-seed-bridge.js?v=20261009caveruinseed1'), 'LocaleCaveRuntime parser-loads the seed bridge beside CaveSiteSystem');
console.log(`PASS cave-ruin-seed-bridge: ${firstText} -> ${first}; second cave -> ${second}`);
