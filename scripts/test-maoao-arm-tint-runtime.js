const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('docs/js/maoao-arm-tint-runtime.js', 'utf8'); // Loads the runtime bridge under the same classic-script conditions used by the game.
const windowObject = {
  normalizedFighterPortrait(fighter) {
    return {
      ...fighter,
      bodyLayers: Array.isArray(fighter?.bodyLayers) ? fighter.bodyLayers.map(layer => ({ ...layer })) : fighter?.bodyLayers,
    };
  },
}; // Supplies the shared portrait normalizer that the bridge decorates in production.
windowObject.window = windowObject;
const context = vm.createContext({
  window: windowObject,
  setInterval(fn) { fn(); return 1; },
  clearInterval() {},
}); // Executes retry setup synchronously so the test has no timers left running.
vm.runInContext(source, context, { filename: 'maoao-arm-tint-runtime.js' });

const male = windowObject.normalizedFighterPortrait({
  id: 'M',
  speciesId: 'mao-ao',
  gender: 'male',
  bodyLayers: [
    { id: 'armL', url: 'portraitsprites/arm-L_mao-ao_m.png', tintSlot: 'A', pos: 'back' },
    { id: 'armR', url: 'portraitsprites/arm-R_mao-ao_m.png', tintSlot: 'C', pos: 'front' },
  ],
}); // Reproduces the live male species JSON mismatch.
assert.strictEqual(male.bodyLayers[1].tintSlot, 'A', 'Mao-ao male right arm must use the same body tint slot as the torso/left arm');
assert.strictEqual(male.bodyLayers[1].pos, 'front', 'tint correction must not alter the authored front-layer placement');

const female = windowObject.normalizedFighterPortrait({
  id: 'F',
  speciesId: 'mao_ao',
  gender: 'female',
  bodyLayers: [
    { id: 'armR', url: 'portraitsprites/arm-R_mao-ao_f.png', tintSlot: 'C', pos: 'front' },
  ],
}); // Verifies the underscore legacy species key resolves through the same correction.
assert.strictEqual(female.bodyLayers[0].tintSlot, 'A', 'Mao-ao female right arm must be corrected too');

const other = windowObject.normalizedFighterPortrait({
  id: 'other',
  speciesId: 'mashtzarr',
  bodyLayers: [{ id: 'armR', url: 'portraitsprites/arm-R_mashtzarr_m.png', tintSlot: 'C', pos: 'front' }],
}); // Guards against accidentally flattening legitimate C-slot anatomy on other species.
assert.strictEqual(other.bodyLayers[0].tintSlot, 'C', 'non-Mao-ao C-slot layers must remain untouched');

const snapshot = windowObject.HobunjiMaoAoArmTintFix.snapshot(); // Confirms the mobile diagnostic reports the correction without requiring devtools.
assert.strictEqual(snapshot.installed, true);
assert.strictEqual(snapshot.correctionCount, 2);
assert.strictEqual(snapshot.lastCorrection.toTintSlot, 'A');

console.log('Mao-ao arm tint runtime tests passed.');
