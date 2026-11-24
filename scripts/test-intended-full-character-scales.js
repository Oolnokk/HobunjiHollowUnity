'use strict';
// Both uploaded Mao'ao genders are independent transform anchors, while the eight later height targets supersede baseline Y.
// All 26 character identities keep 65%-of-source-PNG heads.
const assert = require('node:assert/strict'); // Guards the user's approved scale intent against accidental per-gender authoring.
const fs = require('node:fs'); // Runs actual game defaults rather than a duplicated scale table.
const vm = require('node:vm'); // No browser or 3D renderer required.
const source = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'); // Shipped 26-profile scale definitions.
const window = { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { footScale: {} } } } } } };
vm.runInNewContext(source, {window});
const defaults=window.HobunjiCharacterRigScaleDefaults;
const actual=defaults.values; // The 26 user-exported species/gender keys.
const base=defaults.mainReferenceValues; // All 18 pinned main baseline ratios remain available.
const male=defaults.maoaoRelativeShift.male; // Male Mao'ao source, independent from the uploaded female source.
const femaleDelta=defaults.maoaoRelativeShift.female; // Female Mao'ao source; must not inherit the male's hand/width changes.
const near=(a,b,reason)=>assert(Math.abs(a-b)<1e-9, reason+': '+a+' != '+b);
assert.equal(defaults.version,33,'independently uploaded gender anchors and nominal target documentation');
assert.equal(Object.keys(actual).length,26,'all 26 identities from uploaded scale export');
assert.equal(Object.keys(base).length,18,'18 main baselines retained independently of approved edits');
assert.notEqual(defaults.maoaoRelativeShift.male,defaults.maoaoRelativeShift.female,'the separately uploaded female anchor is preserved');
for(const [axis,current,prior] of [
  ['x',.85,.81675], ['y',1.29,1.089],
  ['handScale',1.2,1.1], ['footScale',1.05,1.3125],
]) {
  near(male[axis],current/prior, 'Maoao male relative '+axis);
}
for(const [key,baseline] of Object.entries(base)){
  const value=actual[key];
  const [species,gender]=key.split('::');
  const shift=gender==='female'?femaleDelta:male;
  near(value.x,baseline.x*shift.x,key+' width uses its gender\'s own uploaded Mao\'ao shift');
  if(!(species in defaults.maleHeightFeet)) near(value.y,baseline.y*shift.y,key+' unspecified height preserves main-relative shift');
  near(value.legLength,value.y,key+' legacy leg/portrait balance maintained');
  near(value.offsetY,baseline.offsetY,key+' authored head Y unchanged');
}
const portrait={kenkari:.75,tletingan:.85,nuhongan:.85,longoran:.85,
  'engh-sho':.95,harlyao:.95,'harlyao-skeleton':.95,
  'mao-ao':1,'mao-ao-skeleton':1,mashtzarr:1.18,mammakhbuur:1.18,
  omgurku:.95,porakaneki:.75}; // Inherited model plane scales for the character line-up.
for(const [key,value] of Object.entries(actual)){
  const [species,gender]=key.split('::');
  const art=species==='mao-ao' && gender==='female' ? .8 : portrait[species]||1;
  near(value.head*art,.65,key+' preserves 65% original head PNG size');
}
const female=actual['mao-ao::female'];
near(female.x,.895,'Maoao female width equals her uploaded source value');
near(female.handScale,1.15,'Maoao female hand size equals her uploaded source value');
near(female.footScale,1.025,'Maoao female foot size equals her uploaded source value');
near(femaleDelta.x,1,'female width did not change from main');
near(femaleDelta.y,1,'female source height did not change from main; later female height is an explicit separate rule');
near(femaleDelta.handScale,1.15,'female hand shift is +15%');
near(femaleDelta.footScale,.8,'female foot shift is -20%');
near(female.head*.8,.65,'Maoao female raw-PNG head equals 65%');
const kenkariFemale=actual['kenkari::female'];
near(kenkariFemale.x,1.1,'Kenkari female width stays at main because female Maoao width did not change');
near(kenkariFemale.handScale,.93*1.15,'Kenkari female hands inherit the female +15% source shift');
near(kenkariFemale.footScale,1*.8,'Kenkari female feet inherit the female -20% source shift');
assert(actual['longoran::male'].y>actual['nuhongan::male'].y,'species retain original relative height differences');
assert(actual['longoran::female'].y>actual['nuhongan::female'].y,'female species retain original relative height differences');
console.log('PASS intended scales: both exact uploaded Maoao gender anchors, nominal height overrides for eight species, all 26 heads raw 65%');
