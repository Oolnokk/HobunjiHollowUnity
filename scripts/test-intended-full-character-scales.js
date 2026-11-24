'use strict';
// The intended Full Character Scale edit is now a SINGLE edited male Mao'ao profile.
// All 26 character identities inherit his proportional body and extremity changes; all raw heads are 65%.
const assert = require('node:assert/strict'); // Guards the user's approved scale intent against accidental per-gender authoring.
const fs = require('node:fs'); // Runs actual game defaults rather than a duplicated scale table.
const vm = require('node:vm'); // No browser or 3D renderer required.
const source = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'); // Shipped 26-profile scale definitions.
const window = { SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { proceduralFeet: { footScale: {} } } } } } };
vm.runInNewContext(source, {window});
const defaults=window.HobunjiCharacterRigScaleDefaults;
const actual=defaults.values; // The 26 user-exported species/gender keys.
const base=defaults.mainReferenceValues; // All 18 pinned main baseline ratios remain available.
const male=defaults.maoaoRelativeShift.male; // Every gender uses this ONE anchor.
const near=(a,b,reason)=>assert(Math.abs(a-b)<1e-9, reason+': '+a+' != '+b);
assert.equal(defaults.version,31,'new canonical authored revision');
assert.equal(Object.keys(actual).length,26,'all 26 identities from uploaded scale export');
assert.equal(Object.keys(base).length,18,'18 main baselines retained independently of approved edits');
assert.equal(defaults.maoaoRelativeShift.male,defaults.maoaoRelativeShift.female,'no separate female anchor');
for(const [axis,current,prior] of [
  ['x',.85,.81675], ['y',1.29,1.089],
  ['handScale',1.2,1.1], ['footScale',1.05,1.3125],
]) {
  near(male[axis],current/prior, 'Maoao male relative '+axis);
}
for(const [key,baseline] of Object.entries(base)){
  const value=actual[key];
  near(value.x,baseline.x*male.x,key+' width inherits male shift');
  near(value.y,baseline.y*male.y,key+' height inherits male shift');
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
const female=actual['mao-ao::female']; // Her uploaded x/y/hands were not intentional new anchors.
near(female.x,.895*male.x,'Maoao female width from main female × male edit');
near(female.y,.94*male.y,'Maoao female height from main female × male edit');
near(female.handScale,1*male.handScale,'Maoao female hands do not use accidental 1.15 anchor');
near(female.footScale,1.28125*male.footScale,'Maoao female feet from main and male foot shift');
near(female.head*.8,.65,'Maoao female raw-PNG head equals 65%');
const kenkariFemale=actual['kenkari::female'];
near(kenkariFemale.x,1.1*male.x,'Kenkari female width changed by the SAME male shift');
near(kenkariFemale.y,1.1*male.y,'Kenkari female height changed by the SAME male shift');
near(kenkariFemale.handScale,.93*male.handScale,'Kenkari female authored hands inherit male shift');
near(kenkariFemale.footScale,1*male.footScale,'Kenkari female feet inherit male shift');
assert(actual['longoran::male'].y>actual['nuhongan::male'].y,'species retain original relative height differences');
assert(actual['longoran::female'].y>actual['nuhongan::female'].y,'female species retain original relative height differences');
console.log('PASS intended scales: only Maoao MALE authored anchor, his shifts on both genders, all 26 heads raw 65%, original species ratios preserved');
