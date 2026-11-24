'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function plainScale(value) {
  return { x: value.x, y: value.y, head: value.head, offsetY: value.offsetY };
}
function plainPosition(value) {
  return { x: value.x, y: value.y, z: value.z };
}

// 1) The new exported Full Character Scale values are anchored to the ONLY changed Mao'ao male profile.
// Original 2026-09-05 attachment-rig authoring tests below must remain isolated from the current proportions.
const defaultsSource = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8');
const defaultsWindow = {};
defaultsWindow.window = defaultsWindow;
vm.runInContext(defaultsSource, vm.createContext(defaultsWindow), {filename:'character-rig-scale-defaults.js'});
const canonical=defaultsWindow.HobunjiCharacterRigScaleDefaults;
const actual=canonical.values;
const male=canonical.maoaoRelativeShift.male;
const female=canonical.maoaoRelativeShift.female;
const close=(a,b,label)=>assert(Math.abs(a-b)<1e-9,label+': '+a+' != '+b);
assert(canonical.version>=31,'defaults must encode the single Maoao MALE 65% head authoring pass');
assert.strictEqual(Object.keys(actual).length,26,'complete 26-profile export is the source of all character defaults');
for(const axis of ['x','y','handScale','footScale'])close(male[axis],female[axis],'no independent female Maoao '+axis);
for(const key of ['tletingan::male','tletingan::female','engh-sho::male','engh-sho::female',
 'mao-ao::male','mao-ao::female','kenkari::male','kenkari::female','mashtzarr::male','mashtzarr::female']){
  const [species,gender]=key.split('::');
  assert.deepStrictEqual(plainScale(canonical.scaleFor(species,gender)),plainScale(actual[key]),key+' exported dimensions');
  const original=canonical.mainReferenceValues[key];
  close(actual[key].x,original.x*male.x,key+' width uses male Maoao shift');
  close(actual[key].y,original.y*male.y,key+' height uses male Maoao shift');
  const portrait=species==='mao-ao'&&gender==='female' ? .8 : ({tletingan:.85,'engh-sho':.95,'mao-ao':1,kenkari:.75,mashtzarr:1.18}[species]||1);
  close(actual[key].head*portrait,.65,key+' raw PNG Head is 65%');
}

// 2) The bulk rig export is intentionally allowlisted: only Mao-ao hand shoulders
// and arm length may mutate. A non-Mao profile and unrelated Mao fields are sentinels.
const maoSource = fs.readFileSync('docs/js/character-rig-maoao-authored-20260905.js', 'utf8');
const baseProfile = (species, gender) => ({
  species, gender,
  posteriorRule: { sentinel: 'posterior' },
  anchors: {
    posterior: { position: { x: 9, y: 8, z: 7 } },
    shoulderPerch: { position: { x: 6, y: 5, z: 4 } },
    leftHandShoulder: { position: { x: 1, y: 2, z: 3 }, rotationDeg: { x: 4, y: 5, z: 6 }, scale: { x: 7, y: 8, z: 9 } },
    rightHandShoulder: { position: { x: -1, y: -2, z: -3 }, rotationDeg: { x: -4, y: -5, z: -6 }, scale: { x: 3, y: 2, z: 1 } },
  },
  anatomy: { portraitScale: 123, handScale: 456, footScale: 789, armLengthHeightPercentOffset: 99, rigScaleX: 1.7, rigScaleY: 1.8, headScale: 1.9, headOffsetY: 0.12 },
});
const library = { characters: {
  'mao-ao::male': baseProfile('mao-ao', 'male'),
  'mao-ao::female': baseProfile('mao-ao', 'female'),
  'tletingan::male': baseProfile('tletingan', 'male'),
}};
const beforeNonMao = JSON.parse(JSON.stringify(library.characters['tletingan::male']));
const beforeMalePerch = JSON.parse(JSON.stringify(library.characters['mao-ao::male'].anchors.shoulderPerch));
const beforeMalePosterior = JSON.parse(JSON.stringify(library.characters['mao-ao::male'].posteriorRule));
const beforeMaleScaleFields = {
  portraitScale: library.characters['mao-ao::male'].anatomy.portraitScale,
  handScale: library.characters['mao-ao::male'].anatomy.handScale,
  footScale: library.characters['mao-ao::male'].anatomy.footScale,
  rigScaleX: library.characters['mao-ao::male'].anatomy.rigScaleX,
  rigScaleY: library.characters['mao-ao::male'].anatomy.rigScaleY,
  headScale: library.characters['mao-ao::male'].anatomy.headScale,
  headOffsetY: library.characters['mao-ao::male'].anatomy.headOffsetY,
};
const maoWindow = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES: library,
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {},
  setInterval() { return 1; },
  clearInterval() {},
};
maoWindow.window = maoWindow;
vm.runInContext(maoSource, vm.createContext(maoWindow), { filename: 'character-rig-maoao-authored-20260905.js' });
assert.deepStrictEqual(library.characters['tletingan::male'], beforeNonMao, 'non-Mao rig data must remain byte-for-byte unchanged');
assert.deepStrictEqual(library.characters['mao-ao::male'].anchors.shoulderPerch, beforeMalePerch, 'Mao-ao shoulder perch is not part of this authoring pass');
assert.deepStrictEqual(library.characters['mao-ao::male'].posteriorRule, beforeMalePosterior, 'Mao-ao posterior data is not part of this authoring pass');
for (const [field, value] of Object.entries(beforeMaleScaleFields)) assert.strictEqual(library.characters['mao-ao::male'].anatomy[field], value, `${field} must not be imported from the bulk rig export`);
assert.deepStrictEqual(plainPosition(library.characters['mao-ao::male'].anchors.leftHandShoulder.position), { x: 0.1525554542608865, y: 0.6292184955362587, z: 0 });
assert.deepStrictEqual(plainPosition(library.characters['mao-ao::male'].anchors.rightHandShoulder.position), { x: -0.22929652083051758, y: 0.6455541403639915, z: 0 });
assert.strictEqual(library.characters['mao-ao::male'].anatomy.armLengthHeightPercentOffset, 0);
assert.deepStrictEqual(plainPosition(library.characters['mao-ao::female'].anchors.leftHandShoulder.position), { x: 0.1771042396564939, y: 0.6511546407522855, z: 0 });
assert.deepStrictEqual(plainPosition(library.characters['mao-ao::female'].anchors.rightHandShoulder.position), { x: -0.23898599170593354, y: 0.646996571654354, z: 0 });
assert.strictEqual(library.characters['mao-ao::female'].anatomy.armLengthHeightPercentOffset, 5);

// 3) Width/height/head-Y edits preserve headScale; raw-PNG Head still converts
// correctly and every guarded field is persisted directly through host.setRigScale.
const guardSource = fs.readFileSync('docs/js/character-scale-comparison-body-input-guard.js', 'utf8');
const guardWindow = { addEventListener() {} };
guardWindow.window = guardWindow;
const guardDocument = { body: { dataset: {} }, getElementById() { return null; } };
const guardContext = vm.createContext({
  window: guardWindow, document: guardDocument,
  location: { pathname: '/tools/animation-author/index.html' },
  setInterval() { return 1; }, clearInterval() {}, clearTimeout() {}, setTimeout() { return 1; },
  localStorage: { setItem() {} }, console, Number, Math, Object, String, JSON,
});
vm.runInContext(guardSource, guardContext, { filename: 'character-scale-comparison-body-input-guard.js' });
const guard = guardWindow.HobunjiFullScaleBodyInputGuard;
assert(guard, 'guarded full-scale input API must install');
const starting = { x: 1.125, y: 1.125, head: 1.0813, offsetY: 0 };
for (const [field, percent, expectedValue] of [['x', 130, 1.3], ['y', 90, 0.9], ['offsetY', -12.5, -0.125]]) {
  const next = guard.nextScalePreservingHead(starting, field, percent);
  assert.strictEqual(next.head, 1.0813, `${field} edit must preserve headScale exactly`);
  assert.strictEqual(next[field], expectedValue, `${field} edit should still apply requested value`);
}
const convertedHead = guard.nextScale(starting, 'head', 80, 0.8);
assert.strictEqual(convertedHead.head, 1, '80% raw-PNG Head with an 80% portrait plane must persist runtime headScale 1.0');
assert.match(guardSource, /maaFullScaleRangeHead/, 'guard must own Head as well as body controls');
assert.match(guardSource, /setRigScale/, 'guard must update the host round-trip override map directly');
assert.match(guardSource, /stopImmediatePropagation\(\)/, 'guard must block the legacy all-fields input handler');

console.log('latest full-character scale + Mao-ao rig allowlist tests passed');
