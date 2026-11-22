#!/usr/bin/env node
'use strict';

// Run: node scripts/test-full-character-scale-proportions.js
// Covers the actual editor's guarded input, shared species anatomy, and durable
// Rig export/import dimensions without loading Three.js or browser-only images.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const comparison = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Live Full Character Scale UI and shared preview update path.
const guardSource = fs.readFileSync('docs/js/character-scale-comparison-body-input-guard.js', 'utf8'); // Captures sliders before the old all-fields handler can corrupt the raw Head value.
const hostSource = fs.readFileSync('docs/js/character-scale-comparison-host-bridge.js', 'utf8'); // Owns the persisted rigScale map, import migration and Reset.
const rigSource = fs.readFileSync('docs/js/character-rig-scale.js', 'utf8'); // Runtime legacy-Y and independent-leg handling.
const legSource = fs.readFileSync('docs/js/procedural-leg-animation.js', 'utf8'); // Shared procedural leg-length/foot-size implementation.
const headAdapter = fs.readFileSync('docs/js/character-scale-comparison-presentation.js', 'utf8'); // Raw-PNG Head input must recognize the renamed Portrait height field.

for (const axis of ['X', 'PortraitHeight', 'LegLength', 'Hand', 'Foot', 'Head', 'OffsetY', 'Age']) {
  assert.match(comparison, new RegExp("scaleRow\\('"+axis+"'"), 'editor has the '+axis+' control');
}
assert.doesNotMatch(comparison, /scaleRow\('Y', 'Height'/, 'old combined Height slider is gone');
assert.match(headAdapter, /maaFullScaleRangePortraitHeight/, 'raw-PNG Head adapter observes the new Portrait height slider');
assert.match(guardSource, /maaFullScaleRangeLegLength/, 'mobile input guard owns independent leg scale');
assert.match(guardSource, /maaFullScaleRangeHand/, 'mobile input guard owns hand size');
assert.match(guardSource, /maaFullScaleRangeFoot/, 'mobile input guard owns foot size');
assert.match(comparison, /refreshFromScaleChange,/, 'host input guard has a live preview callback');
assert.match(comparison, /setFootScaleMultiplier/, 'Foot slider changes the actual procedural foot mesh');
assert.match(comparison, /scheduleHandResize/, 'Hand slider debounces expensive GLB rebuilds');
assert.match(legSource, /syncScaleForParent,/, 'shared runtime updates attached legs after portrait height changes');
assert.match(legSource, /alignPortraitWithLegs,/, 'gameplay and author share one hip-to-portrait alignment');
assert.match(rigSource, /legLengthRatioFor:/, 'game spawns use leg length divided by portrait height, never double-scaling the feet');

const guardWindow = {};
const guardContext = vm.createContext({ window: guardWindow, document: {
  body: { dataset: {} }, getElementById() { return null; },
}, location: { pathname: '/tools/animation-author/index.html' },
setInterval: () => 1, clearInterval() {}, clearTimeout() {}, setTimeout: () => 1, localStorage: {}, console });
vm.runInContext(guardSource, guardContext);
const guard = guardWindow.HobunjiFullScaleBodyInputGuard;
assert.ok(guard, 'actual guard module installed in isolation');
const original = { x: 1.2, y: 1.15, legLength: 1.6, handScale: .8, footScale: 1.25, head: .92, offsetY: -.1 };
for (const [field, value] of [['x', 125], ['y', 80], ['legLength', 190], ['handScale', 55], ['footScale', 170], ['offsetY', 13]]) {
  const next = guard.nextScale(original, field, value, .75);
  for (const key of Object.keys(original)) if (key !== field) {
    assert.equal(next[key], original[key], field+' must preserve neighboring '+key+' (especially raw Head)');
  }
  assert.equal(next[field], value / 100, field+' produces exactly the requested scale');
}
const rawHead = guard.nextScale(original, 'head', 75, .75);
assert.equal(rawHead.head, 1, '75% raw head with 75% authored portrait corresponds to unchanged native-size head');
assert.equal(rawHead.legLength, original.legLength, 'raw Head edits cannot reset independently stretched legs');

// The actual anatomy-config writer must decouple inherited hand size before
// changing the foot multiplier. The older hand model inherits Foot scale by
// default; changing Foot must never also silently resize the hands.
function productionFunction(source, name) {
  const start = source.indexOf('function ' + name + '('); // Extracts exactly the production function, preserving its authored math.
  assert.ok(start >= 0, name + ' exists in the current editor');
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, end = open + 1;
  while (depth > 0 && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, 'source function ends cleanly');
  return source.slice(start, end);
}
let handRefreshes = 0; // Verifies the first foot edit freezes prior hand size, but further foot drags do not repeatedly reload GLBs.
const handConfigData = { speciesScaleOverrides: {} };
const authorWindow = {
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { footScale: { default: 1 } } } } } },
  HobunjiHandModelProfiles: {
    data: handConfigData,
    mutate(change) { change(handConfigData); handRefreshes++; },
  },
};
const configureAnatomy = vm.runInNewContext('(' + productionFunction(comparison, 'applyAnatomyConfig') + ')',
  { window: authorWindow, normalizeSpecies: v => v, normalizeGender: v => v });
const independentAnatomy = { species: 'mao-ao', gender: 'male', anatomy: { handScale: 1, footScale: 1.5 } };
configureAnatomy(independentAnatomy);
assert.equal(handConfigData.speciesScaleOverrides['mao-ao'].male, 1,
  'the original 100% hand size becomes an explicit override before changing inherited foot scale');
assert.equal(authorWindow.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale['mao-ao'].male, 1.5);
independentAnatomy.anatomy.footScale = 1.75;
configureAnatomy(independentAnatomy);
assert.equal(handRefreshes, 1, 'the hand GLB is rebuilt only once, not every time the independent Foot slider moves');
assert.equal(handConfigData.speciesScaleOverrides['mao-ao'].male, 1, 'hands stay 100% after repeated 175% foot edits');

const characters = { 'mao-ao::male': { species: 'mao-ao', gender: 'male', anatomy: {
  portraitScale: 1.1, handScale: .9, footScale: 1.05, rigScaleY: 1.12,
} } }; // Canonical authored part sizes must be recoverable after Reset.
const store = new Map();
const webStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key,value) => store.set(key,String(value)),
  removeItem: key => store.delete(key),
};
const hostWindow = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters },
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  HobunjiCharacterRigScale: { installProfileDefaults() {} },
};
const hostDocument = { documentElement: { dataset: {} }, addEventListener() {}, getElementById() { return null; } };
vm.runInNewContext(hostSource, { window: hostWindow, document: hostDocument, location: {
  pathname: '/tools/animation-author/index.html',
}, localStorage: webStorage, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console });
const host = hostWindow.HobunjiAnimationAuthorScaleHost;
assert.ok(host, 'shared Full Character Scale save host loads');
const authored = { x: 1.22, y: .85, legLength: 1.65, head: .88, offsetY: -.08, handScale: 1.2, footScale: .75 };
const saved = host.setRigScale('mao-ao', 'male', authored);
assert.equal(saved.legLength, 1.65, 'new independent leg length survives save normalization');
assert.equal(saved.handScale, 1.2, 'independent hand size survives save normalization');
assert.equal(saved.footScale, .75, 'independent foot size survives save normalization');
assert.equal(characters['mao-ao::male'].anatomy.legLengthScale, 1.65, 'live anatomy stores the actual rigged leg length');
assert.equal(characters['mao-ao::male'].anatomy.rigScaleY, .85, 'portrait height remains independent');
assert.equal(characters['mao-ao::male'].anatomy.handScale, 1.2);
assert.equal(characters['mao-ao::male'].anatomy.footScale, .75);
assert.equal(host.rigScaleFor('mao-ao', 'male').legLength, 1.65, 'round-trip map preserves leg length');
assert.equal(JSON.parse(store.get('hobunjiFullCharacterRigScales.v2'))['mao-ao::male'].footScale, .75,
  'persisted species/gender map serializes separately authored foot sizes');
const legacy = host.setRigScale('mao-ao', 'male', { x: 1.1, y: 1.3, head: .9, offsetY: 0 });
assert.equal(legacy.legLength, undefined, 'old rig tuples do not invent an unwanted leg multiplier');
assert.equal(legacy.handScale, undefined, 'old imports cannot overwrite authored hand scale with a fake 10% default');
host.resetToRepositoryDefaults();
assert.equal(characters['mao-ao::male'].anatomy.legLengthScale, undefined, 'Reset removes separate authored leg reach');
assert.equal(characters['mao-ao::male'].anatomy.handScale, .9, 'Reset restores canonical hand dimensions');
assert.equal(characters['mao-ao::male'].anatomy.footScale, 1.05, 'Reset restores canonical foot dimensions');
assert.equal(store.has('hobunjiFullCharacterRigScales.v2'), false, 'Reset clears the independent dimensions autosave map');
console.log('Full Character Scale dimensions: legacy Height, sliders, guard, export/save/reset, independent hands/feet PASS');
