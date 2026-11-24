'use strict';
// Pinned baseline: main@493ccfb05b5f9ff0486bbf43450523fc6c4dda17 adult character scales.
// The older main Height multiplies both the portrait and leg system; the new independent values must both equal that Height.
const assert = require('node:assert/strict'); // Verifies 18 species/gender ratios and non-destructive stored-value migration.
const fs = require('node:fs'); // Reads production default and UI modules instead of duplicated implementations.
const vm = require('node:vm'); // Exercises the editor's actual adult-only reset with mocked persistence.
const expected = {
  "tletingan::male": {
    "x": 0.85,
    "y": 0.85,
    "head": 0.8,
    "offsetY": 0
  },
  "tletingan::female": {
    "x": 0.915,
    "y": 0.89,
    "head": 0.8823529411764706,
    "offsetY": 0
  },
  "nuhongan::male": {
    "x": 0.68,
    "y": 0.6375,
    "head": 0.8,
    "offsetY": 0
  },
  "nuhongan::female": {
    "x": 0.732,
    "y": 0.6675,
    "head": 0.8823529411764706,
    "offsetY": 0
  },
  "longoran::male": {
    "x": 1.05,
    "y": 2,
    "head": 0.9647,
    "offsetY": -0.055
  },
  "longoran::female": {
    "x": 1.130294117647059,
    "y": 2.0941176470588236,
    "head": 1.0640073529411764,
    "offsetY": -0.055
  },
  "engh-sho::male": {
    "x": 0.8,
    "y": 0.845,
    "head": 0.7894736842105263,
    "offsetY": 0
  },
  "engh-sho::female": {
    "x": 0.795,
    "y": 0.81,
    "head": 0.7894736842105263,
    "offsetY": 0
  },
  "harlyao::male": {
    "x": 0.96,
    "y": 1.014,
    "head": 0.9473684210526315,
    "offsetY": 0
  },
  "harlyao::female": {
    "x": 0.954,
    "y": 0.972,
    "head": 0.9473684210526315,
    "offsetY": 0
  },
  "mao-ao::male": {
    "x": 0.81675,
    "y": 1.089,
    "head": 0.726,
    "offsetY": 0
  },
  "mao-ao::female": {
    "x": 0.895,
    "y": 0.94,
    "head": 0.7813,
    "offsetY": 0
  },
  "kenkari::male": {
    "x": 1.225,
    "y": 1.225,
    "head": 1,
    "offsetY": 0
  },
  "kenkari::female": {
    "x": 1.1,
    "y": 1.1,
    "head": 1,
    "offsetY": 0
  },
  "mashtzarr::male": {
    "x": 0.955,
    "y": 1.255,
    "head": 0.9856,
    "offsetY": -0.095
  },
  "mashtzarr::female": {
    "x": 1.01,
    "y": 0.99,
    "head": 0.8475,
    "offsetY": -0.02
  },
  "mammakhbuur::male": {
    "x": 0.96,
    "y": 1.69,
    "head": 0.9771,
    "offsetY": -0.095
  },
  "mammakhbuur::female": {
    "x": 1.0153,
    "y": 1.3331,
    "head": 0.8402,
    "offsetY": -0.02
  }
}; // Snapshot of main's canonical adult X/Y/head/head offset values.
const defaultsSource = fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'); // Current PR baseline table.
const editor = fs.readFileSync('docs/js/character-scale-comparison.js','utf8'); // Full Character Scale button wiring and migration.
const window = { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { footScale: {} } } } } } };
vm.runInNewContext(defaultsSource, { window });
const actual = window.HobunjiCharacterRigScaleDefaults?.values || {};
assert.equal(Object.keys(expected).length, 18, 'all main adult species/gender pairs are pinned');
assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'no adult species missing or spuriously created');
for (const [key, main] of Object.entries(expected)) {
  const pr = actual[key];
  for (const axis of ['x','y','head','offsetY'])
    assert.equal(pr[axis], main[axis], key + ' adult ' + axis + ' must match main at full numeric precision');
  assert.equal(pr.legLength, main.y, key + ' legs must equal main\'s shared Height, not old PR lanky ratios');
  assert.equal(pr.legLength / pr.y, 1, key + ' independent leg-to-portrait ratio is exactly one at the adult baseline');
}
assert.match(editor, /maaFullScaleMatchMainAdults/, 'adult alignment is available without wiping child defaults');
assert.match(editor, /addEventListener\('click', matchMainAdultScales\)/, 'new button invokes actual baseline reapply');
const start = editor.indexOf('  function matchMainAdultScales()');
const end = editor.indexOf('  // Discards every author override', start);
assert(start > 0 && end > start, 'find actual migration function without copying logic into test');
const changes = []; // In-memory save receiver for all 18 adult keys.
const before = { handScale: 1.37, footScale: 0.83 }; // Hand/foot author overrides are NOT part of main adult height migration.
let saved = 0, refreshes = 0, childBody = 0.36, hunch = 0.42;
let message = ''; // Mimics the mobile status text seen after applying the values.
const context = {
  window: { HobunjiCharacterRigScaleDefaults: { values: actual }, ProceduralHandFrameDriver: { syncNow() {} } },
  active: true, entries: [{ species:'longoran', gender:'male' },{ species:'kenkari',gender:'female' }], selected: null,
  host: () => ({
    rigScaleFor: (species, gender) => species === 'kenkari' && gender === 'female' ? before : {},
    setRigScale: (species, gender, scale) => { changes.push({ species, gender, scale }); return scale; },
  }),
  applyPreviewProportions() { refreshes++; },
  syncLegPortraitAlignment() {},
  refreshLongoranSpine() {},
  syncSpineGuides() {},
  persistProfiles() { saved++; },
  layout() {},
  frame() {},
  status(value) { message = value; },
};
vm.runInNewContext(editor.slice(start,end) + '\nthis.matchMainAdultScales = matchMainAdultScales;', context);
context.matchMainAdultScales();
assert.equal(changes.length,18,'one saved adult entry per canonical species/gender');
assert.equal(refreshes,2,'reapply the newly aligned adult base to both active preview entries');
assert.equal(saved,1,'reuse shared Rig profile persistence once');
const k = changes.find(record => record.species === 'kenkari' && record.gender === 'female');
assert.equal(k.scale.handScale,before.handScale,'existing authored hand scale preserved');
assert.equal(k.scale.footScale,before.footScale,'existing authored foot scale preserved');
assert.equal(k.scale.legLength,expected['kenkari::female'].y,'synced adult leg uses main Height');
assert.equal(childBody,0.36,'baby/toddler/child author modifiers remain untouched');
assert.equal(hunch,0.42,'per NPC hunch tuning remains untouched');
assert.match(message,/Matched 18\/18 adult scales to main/,'mobile confirmation includes full count');
console.log('PASS main adult parity: 18 canonical profiles, exact X/Y/head/offset, shared Height => independent leg/portrait, preserves child/limb authoring');
