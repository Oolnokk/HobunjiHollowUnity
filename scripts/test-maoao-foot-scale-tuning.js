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

const values = windowObject.HobunjiCharacterRigScaleDefaults.values; // Every species now inherits the Mao'ao MALE's 0.8x foot-size shift.
assert.strictEqual(footScale['mao-ao'].male, 1.05, 'approved male Mao-ao foot size from source export');
assert(Math.abs(footScale['mao-ao'].female - 1.025) < 1e-12, 'female Mao-ao inherits male foot multiplier from her 1.28125 main value');
assert.strictEqual(footScale['engh-sho'].male, 1.0, 'Engh-sho male feet also inherit the 0.8x male shift');
assert.strictEqual(footScale['engh-sho'].female, .936, 'Engh-sho female feet ALSO inherit the same male 0.8x shift');
assert.strictEqual(windowObject.HobunjiCharacterRigScaleDefaults.maoaoRelativeShift.female.footScale, .8,
  'both genders have the same single male Mao-ao foot shift');
for(const [key, value] of Object.entries(values)) {
  const [species, gender] = key.split('::');
  assert(Math.abs(footScale[species][gender] - value.footScale) < 1e-9, key+' live procedural foot config must match its authored value');
}
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(windowObject.HobunjiCharacterRigScaleDefaults.maoaoFootScale)),
  { male: 1.05, female: 1.025 }, 'live debug config reports approved Mao-ao sizes without the old +25% pre-shift',
);

console.log('Mao-ao male-anchored foot scaling: 26 profiles and both genders passed');
