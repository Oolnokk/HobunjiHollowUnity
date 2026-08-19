'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const profileSource = read('docs/config/hand-model-profiles.js');
const gripSource = read('docs/js/hand-tool-grips.js');
const basisSource = read('docs/js/hand-tool-semantic-basis.js');
const authorSource = read('docs/js/attack-editor-hand-tool-basis-author.js');
const heldSource = read('docs/js/held-action-animations.js');

const storage = new Map();
const localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const window = {
  localStorage,
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: { species: {} },
      assets: { pngPlaneAvatar: { proceduralFeet: { footScale: { default: 1 } } } },
    },
  },
};
const sandbox = { window, localStorage };
vm.runInNewContext(profileSource, sandbox, { filename: 'hand-model-profiles.js' });
vm.runInNewContext(gripSource, sandbox, { filename: 'hand-tool-grips.js' });
vm.runInNewContext(basisSource, sandbox, { filename: 'hand-tool-semantic-basis.js' });

const basis = window.HobunjiHandToolSemanticBasis;
assert(basis, 'shared semantic basis API should install');

basis.setToolMarker('hatchet', 'butt', { u: 0.5, v: 0.9 });
basis.setToolMarker('hatchet', 'head', { u: 0.5, v: 0.1 });
basis.setToolMarker('hatchet', 'working', { u: 0.9, v: 0.2 });
const tool = basis.toolBasisFor('hatchet');
assert.strictEqual(tool.complete, true, 'three tool markers should complete the weapon basis');
assert(Math.abs(tool.axes.y.x) < 1e-9 && tool.axes.y.y > 0.999, 'butt→head should resolve semantic +Y');
assert(tool.axes.x.x > 0.999 && Math.abs(tool.axes.x.y) < 1e-9, 'working side should resolve semantic +X');
assert.strictEqual(tool.axes.zSign, 1, 'X×Y should resolve the raw sprite +Z sign');
assert.strictEqual(
  JSON.stringify(window.HobunjiHandToolGrips.data.tools.hatchet.semanticBasis.markers.working),
  JSON.stringify({ u: 0.9, v: 0.2 }),
  'authored working-side marker should persist in the shared tool config',
);

const hand = basis.setHandAxesForModel('feline', { fingers: '-y', thumb: '+x', palm: '-z' });
assert.strictEqual(hand.valid, true, 'three distinct signed hand axes should be accepted');
assert.strictEqual(hand.axes.fingers, '-y');
assert.strictEqual(hand.axes.thumb, '+x');
assert.strictEqual(hand.axes.palm, '-z');
assert.strictEqual(window.HobunjiHandModelProfiles.data.models.feline.semanticBasis.axes.palm, '-z');

const invalid = basis.validateHandAxes({ fingers: '+y', thumb: '-y', palm: '+z' });
assert.strictEqual(invalid.valid, false, 'semantic hand directions cannot reuse the same physical local axis');

assert.match(authorSource, /Haft butt \/ axis start/, 'basis UI must expose the haft-axis start marker');
assert.match(authorSource, /Head \/ top/, 'basis UI must expose the weapon head/top marker');
assert.match(authorSource, /Blade \/ working side/, 'basis UI must expose the blade/working-side marker');
assert.match(authorSource, /Fingers \(\+Y semantic\)/, 'basis UI must expose hand finger direction');
assert.match(authorSource, /Thumb \(\+X semantic\)/, 'basis UI must expose hand thumb direction');
assert.match(authorSource, /Palm facing \(\+Z semantic\)/, 'basis UI must expose hand palm direction');
assert.match(authorSource, /overlay\.style\.zIndex = '9'/, 'Hand + Tool overlay must sit above its enter button');
assert.match(authorSource, /opener\.style\.visibility = active \? 'hidden'/, 'enter button must hide while close-up is active');
assert.match(authorSource, /They do not move the grip or reset this camera/, 'basis authoring must preserve calibrated grip/camera state');
assert.match(heldSource, /hand-tool-semantic-basis\.js/, 'shared semantic basis must load in game and editor');
assert.match(heldSource, /attack-editor-hand-tool-basis-author\.js/, 'basis authoring UI must load after the close-up');

console.log('PASS: semantic weapon/hand basis authoring and close-up exit layering contract');
