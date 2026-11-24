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
const canonical = window.HobunjiCharacterRigScaleDefaults;
const actual = canonical?.values || {}; // All 26 approved scale tuples.
const pinnedMain = canonical?.mainReferenceValues || {}; // Pinned main values for exact same-sex baseline verification.
const maleShift = canonical?.maoaoRelativeShift?.male || {};
const femaleShift = canonical?.maoaoRelativeShift?.female || {};
const near=(a,b,label)=>assert(Math.abs(a-b)<1e-8, label + ': '+a+' != '+b);
assert.equal(Object.keys(expected).length, 18, 'the 18 original main profiles are pinned');
assert.deepEqual(Object.keys(pinnedMain).sort(), Object.keys(expected).sort(), 'all pinned main reference keys remain present');
assert.equal(Object.keys(actual).length,26,'all 26 imported profiles have canonical defaults');
for (const [key, main] of Object.entries(expected)) {
  const original = pinnedMain[key];
  const changed = actual[key];
  for (const axis of ['x','y','head','offsetY'])
    near(original[axis],main[axis],key+' pinned main '+axis);
  near(changed.x, original.x*maleShift.x,key+' same MALE Maoao width adjustment');
  const [species, gender] = key.split('::');
  const targetFeet = canonical.maleHeightFeet?.[species]; // Eight explicitly requested species override old main-derived heights.
  if (Number(targetFeet) > 0) {
    const expectedFeet = targetFeet * (gender === 'female' ? canonical.femaleVisibleHeightRatio : 1);
    near(canonical.nominalHeightFeetFor(species, gender), expectedFeet, key+' physically calibrated stature');
  } else {
    near(changed.y, original.y*maleShift.y,key+' unlisted species retain MALE Maoao relative height adjustment');
  }
  near(changed.legLength, changed.y,key+' procedural legs scale together with portrait, preserving beltline');
  near(changed.offsetY, original.offsetY,key+' head offset unchanged');
  assert(Number.isFinite(changed.head)&&changed.head>0,key+' has a valid raw 65% Head factor');
}
for(const axis of ['x','y','handScale','footScale'])
  near(maleShift[axis],femaleShift[axis],'Maoao male adjustment applied to female '+axis);
near(actual['mao-ao::female'].x,.895*maleShift.x,'female Maoao x derived only from male anchor');
near(canonical.nominalHeightFeetFor('mao-ao','female'),6.25*.93,'female Maoao has a physically humanlike 93% height of the larger male');
near(actual['mao-ao::female'].handScale,maleShift.handScale,'female Maoao hands from main 1.0');
near(actual['mao-ao::female'].footScale,1.28125*maleShift.footScale,'female Maoao feet from main 1.28125');
near(actual['mao-ao::female'].head*.8,.65,'female Maoao raw head 65%');
assert.match(editor, /maaFullScaleMatchMainAdults/, 'adult alignment is available without wiping child defaults');
assert.match(editor, /addEventListener\('click', matchMainAdultScales\)/, 'new button invokes actual baseline reapply');
const start = editor.indexOf('  function matchMainAdultScales()');
const end = editor.indexOf('  // Discards every author override', start);
assert(start > 0 && end > start, 'find actual migration function without copying logic into test');
const changes = []; // In-memory save receiver for all 26 approved scale profiles.
const before = { handScale: 1.37, footScale: 0.83 }; // Explicit apply replaces stale limb author overrides with approved defaults.
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
assert.equal(changes.length,26,'persist every one of the 26 approved species/gender profiles');
assert.equal(refreshes,2,'reapply the newly aligned adult base to both active preview entries');
assert.equal(saved,1,'reuse shared Rig profile persistence once');
const k = changes.find(record => record.species === 'kenkari' && record.gender === 'female');
near(k.scale.handScale,actual['kenkari::female'].handScale,'apply approved hands, including female Maoao shifts');
near(k.scale.footScale,actual['kenkari::female'].footScale,'apply approved feet, including female Maoao shifts');
near(k.scale.legLength,actual['kenkari::female'].legLength,'saved legs use male Maoao relative Height');
assert.equal(childBody,0.36,'baby/toddler/child author modifiers remain untouched');
assert.equal(hunch,0.42,'per NPC hunch tuning remains untouched');
assert.match(message,/Applied 26\/26 Mao/,'mobile confirmation includes all 26 approved profiles');
console.log('PASS pinned main references + eight male targets, female visible-height ratios, 26 Maoao-anchored width/limb scales, 65% Head, explicit editor reset and age preservation');
