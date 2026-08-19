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
const closeupSource = read('docs/js/attack-editor-hand-tool-closeup.js');
const handRuntimeSource = read('docs/js/procedural-hand-semantic-basis-runtime.js');
const toolRuntimeSource = read('docs/js/semantic-tool-basis-runtime.js');
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

// The exact author-provided Hatchet + Feline pair is now a committed default,
// not merely local editor state. This is checked before any custom mutations.
const approvedTool = basis.toolBasisFor('hatchet');
assert.strictEqual(approvedTool.source, 'approved-default');
assert.strictEqual(approvedTool.complete, true);
assert.strictEqual(approvedTool.axes.zSign, -1);
assert.strictEqual(approvedTool.markers.butt.u, 0.3612074435865743);
assert.strictEqual(approvedTool.markers.butt.v, 0.31670838948802604);
assert.strictEqual(approvedTool.markers.head.u, 0.4270044884741022);
assert.strictEqual(approvedTool.markers.head.v, 0.8571504134000086);
assert.strictEqual(approvedTool.markers.working.u, 0.7559960381062183);
assert.strictEqual(approvedTool.markers.working.v, 0.8049483838056785);
assert(Math.abs(approvedTool.axes.x.x - 0.992670250536666) < 1e-12);
assert(Math.abs(approvedTool.axes.x.y - 0.1208543491127769) < 1e-12);
assert(Math.abs(approvedTool.axes.y.x - 0.1208543491127771) < 1e-12);
assert(Math.abs(approvedTool.axes.y.y + 0.9926702505366658) < 1e-12);

const approvedHand = basis.handBasisForModel('feline');
assert.strictEqual(approvedHand.source, 'approved-default');
assert.strictEqual(approvedHand.valid, true);
assert.strictEqual(approvedHand.axes.fingers, '-y');
assert.strictEqual(approvedHand.axes.thumb, '+x');
assert.strictEqual(approvedHand.axes.palm, '-z');
assert.strictEqual(approvedHand.handedness, 'right-handed');

// Feline raw→semantic is a 180° X correction: +X stays thumbward while raw
// -Y becomes fingers +Y and raw -Z becomes palm +Z.
const handQ = basis.handRawToCanonicalQuaternionForModel('feline');
assert(handQ, 'approved feline basis must resolve a proper rotation');
assert(Math.abs(Math.abs(handQ.x) - 1) < 1e-9, 'feline correction should be 180° around X');
assert(Math.abs(handQ.y) < 1e-9 && Math.abs(handQ.z) < 1e-9 && Math.abs(handQ.w) < 1e-9);

const toolQ = basis.toolEngineQuaternionFor('hatchet');
assert(toolQ && [toolQ.x, toolQ.y, toolQ.z, toolQ.w].every(Number.isFinite), 'approved hatchet must resolve an engine-space quaternion');

// Explicit editor authoring still overrides the committed fallback.
basis.setToolMarker('hatchet', 'butt', { u: 0.5, v: 0.9 });
basis.setToolMarker('hatchet', 'head', { u: 0.5, v: 0.1 });
basis.setToolMarker('hatchet', 'working', { u: 0.9, v: 0.2 });
const tool = basis.toolBasisFor('hatchet');
assert.strictEqual(tool.source, 'authored');
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
assert.strictEqual(hand.source, 'authored');
assert.strictEqual(window.HobunjiHandModelProfiles.data.models.feline.semanticBasis.axes.palm, '-z');

const invalid = basis.validateHandAxes({ fingers: '+y', thumb: '-y', palm: '+z' });
assert.strictEqual(invalid.valid, false, 'semantic hand directions cannot reuse the same physical local axis');

assert.match(authorSource, /Haft butt \/ axis start/, 'basis UI must expose the haft-axis start marker');
assert.match(authorSource, /Head \/ top/, 'basis UI must expose the weapon head/top marker');
assert.match(authorSource, /Blade \/ working side/, 'basis UI must expose the blade/working-side marker');
assert.match(authorSource, /Fingers \(\+Y semantic\)/, 'basis UI must expose hand finger direction');
assert.match(authorSource, /Thumb \(\+X semantic\)/, 'basis UI must expose hand thumb direction');
assert.match(authorSource, /Palm facing \(\+Z semantic\)/, 'basis UI must expose hand palm direction');
assert.match(authorSource, /overlay\.style\.zIndex = '9'/, 'basis guard keeps Hand + Tool overlay above its enter button');
assert.match(closeupSource, /z-index:9/, 'close-up itself must own the exit-button stacking fix');
assert.match(closeupSource, /toolEngineQuaternionFor/, 'close-up must consume the shared semantic tool orientation');
assert.match(closeupSource, /camera preserved until Refit/, 'semantic basis changes must preserve the close-up camera');
assert.match(handRuntimeSource, /handRawToCanonicalQuaternionForSpecies/, 'game/editor hand visuals must consume the same semantic hand correction');
assert.match(toolRuntimeSource, /toolEngineQuaternionFor/, 'gameplay tool plane must consume the same semantic tool correction');
assert.match(toolRuntimeSource, /legacyBaseZ = anim === 'sweep' \? -Math\.PI \/ 2 : 0/, 'semantic gameplay must remove the old sweep raw-PNG base rotation');
assert.match(heldSource, /hand-tool-semantic-basis\.js\?v=20260819b/, 'updated shared semantic basis must load in game and editor');
assert.match(heldSource, /procedural-hand-semantic-basis-runtime\.js/, 'semantic hand presentation runtime must load in game and editor');
assert.match(heldSource, /semantic-tool-basis-runtime\.js/, 'semantic tool presentation runtime must load in gameplay');
assert.match(heldSource, /attack-editor-hand-tool-basis-author\.js/, 'basis authoring UI must load after the close-up');

console.log('PASS: approved Hatchet/Feline semantic basis drives shared editor/runtime presentation contract');
