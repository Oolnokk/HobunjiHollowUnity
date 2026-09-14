'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8');
const footScale = {
  default: 1,
  'engh-sho': { male: 1.275, female: 1.325 },
  'mao-ao': { male: 1.05, female: 1.025 },
};
const windowObject = {
  SCRATCHBONES_CONFIG: {
    game: {
      assets: {
        pngPlaneAvatar: {
          proceduralFeet: { footScale },
        },
      },
    },
  },
};
windowObject.window = windowObject;
vm.runInContext(source, vm.createContext(windowObject), { filename: 'character-rig-scale-defaults.js' });

assert.strictEqual(footScale['mao-ao'].male, 1.3125, 'Mao-ao male feet must be 25% larger than the canonical 1.05 scale');
assert.strictEqual(footScale['mao-ao'].female, 1.28125, 'Mao-ao female feet must be 25% larger than the canonical 1.025 scale');
assert.strictEqual(footScale['engh-sho'].male, 1.275, 'Mao-ao tuning must not alter Engh-sho male feet');
assert.strictEqual(footScale['engh-sho'].female, 1.325, 'Mao-ao tuning must not alter Engh-sho female feet');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(windowObject.HobunjiCharacterRigScaleDefaults.maoaoFootScale)),
  { male: 1.3125, female: 1.28125 },
  'debug/default API must expose the exact repository Mao-ao foot scales',
);

console.log('Mao-ao foot scale tuning: all checks passed');
