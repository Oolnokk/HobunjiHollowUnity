'use strict';
// Exact pre-calibration Mao'ao foot size parity; do NOT propagate the later Mao'ao male 0.8x foot shift to every species.
const fs=require('fs'); // Reads the current shipped legacy main-silhouette configuration.
const vm=require('vm'); // Loads the real startup module without WebGL.
const assert=require('assert'); // Rejects reintroduced scaling edits.

const source=fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'); // Snapshot pinned to main-silhouette commit 4cfb39c.
const footScale={default:1,'engh-sho':{male:1.275,female:1.325},'mao-ao':{male:1.05,female:1.025}};
const windowObject={SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{proceduralFeet:{footScale}}}}}};
windowObject.window=windowObject;
vm.runInContext(source,vm.createContext(windowObject),{filename:'character-rig-scale-defaults.js'});
const defaults=windowObject.HobunjiCharacterRigScaleDefaults;
assert.strictEqual(footScale['mao-ao'].male,1.3125,'restore main Mao-ao male 25%-larger original foot default');
assert.strictEqual(footScale['mao-ao'].female,1.28125,'restore main Mao-ao female original foot default');
assert.strictEqual(footScale['engh-sho'].male,1.275,'unrelated male feet cannot inherit later Mao-ao changes');
assert.strictEqual(footScale['engh-sho'].female,1.325,'unrelated female feet cannot inherit later Mao-ao changes');
assert.deepStrictEqual(JSON.parse(JSON.stringify(defaults.maoaoFootScale)),{male:1.3125,female:1.28125});
assert.strictEqual(defaults.maoaoRelativeShift,undefined,'gender-wide Mao-ao adjustment has been removed');
assert.strictEqual(defaults.mainSilhouetteRestoreValues['mao-ao::male'].footScale,1.3125,
  'explicit saved-rig restoration uses exactly the same original foot value');
console.log('PASS restored original Mao-ao feet; no inherited male/female foot shift');
