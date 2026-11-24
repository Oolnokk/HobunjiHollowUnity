'use strict';
// Eight requested adult heights and 93%-of-male female stature, against the game's existing 6ft chair ruler.
const assert = require('node:assert/strict'); // Ensures numerical size goals survive future sprite-scale adjustments.
const fs = require('node:fs'); // Reads actual canonical character defaults and authored chair geometry.
const vm = require('node:vm'); // Runs the production default installer without WebGL.

const source = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'); // Shared gameplay/Animation Author scales.
const chair = JSON.parse(fs.readFileSync('docs/config/furniture-authored/chairSimple.json','utf8')); // Same chair as the six-foot overlay.
const w = { SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{proceduralFeet:{footScale:{}}}}}} }; // No persisted overrides: test checked-in defaults only.
vm.runInNewContext(source,{window:w});
const rig=w.HobunjiCharacterRigScaleDefaults;
const goals={kenkari:4,tletingan:4+5/12,nuhongan:3,longoran:8,
  'mao-ao':6.25,'engh-sho':5+5/12,mammakhbuur:8,mashtzarr:7.25}; // Exact user-approved male targets in feet.
const portrait={'kenkari':.75,tletingan:.85,nuhongan:.85,longoran:.85,
  'mao-ao':1,'engh-sho':.95,mammakhbuur:1.18,mashtzarr:1.18}; // Existing adult PNGPlaneAvatar portrait-plane multipliers.
const close=(a,b,label)=>assert(Math.abs(a-b)<1e-9,label+': '+a+' != '+b); // Subpixel numerical parity, rather than integer-rounded display.
assert.deepEqual(Object.keys(rig.maleHeightFeet).sort(),Object.keys(goals).sort(),'all eight and only eight named species calibrated');
assert.equal(rig.version,32,'old cached default bundles cannot silently pass the new target test');
assert.equal(Object.keys(rig.values).length,26,'all 26 approved canonical and special profiles retained');
assert.equal(rig.rawHeadScale,.65,'65 percent raw source-PNG head size remains canonical');
assert.equal(rig.femaleVisibleHeightRatio,.93,'female physical stature is humanlike relative to the larger male');
const top=Math.max(...chair.parts.map(part=>Number(part.transform.y)+Number(part.transform.sy)/2));
close(top,.66,'chair size is unchanged');
close(rig.worldHeightCalibration.uniformScale*.9*rig.values['mao-ao::male'].y, top*(6.25/3),
  'Mao-ao male equals 6ft3 by the existing chair-to-world reference exactly once');
close(rig.values['mao-ao::male'].y,1.29,'approved Mao-ao male body-height anchor stays 1.29');
close(rig.values['mao-ao::male'].x,.85,'approved Mao-ao male width anchor stays .85');
for (const [species,feet] of Object.entries(goals)) {
  const male=rig.values[species+'::male'];
  const female=rig.values[species+'::female'];
  assert(male&&female,'both gender profiles exist for '+species);
  close(rig.nominalHeightFeetFor(species,'male'),feet,species+' male exact feet');
  close(rig.nominalHeightFeetFor(species,'female'),feet*.93,species+' female exact visible feet');
  close(male.y*portrait[species]*.9*rig.worldHeightCalibration.uniformScale,feet*top/3,
    species+' actual male nominal world units');
  close(male.legLength,male.y,species+' male leg and portrait share scale');
  close(female.legLength,female.y,species+' female leg and portrait share scale');
  assert(female.y>0&&female.y<=4,'female still within the existing 10–400% rig range');
  assert(male.y>0&&male.y<=4,'male still within the existing 10–400% rig range');
}
const base=rig.mainReferenceValues;
const delta=rig.maoaoRelativeShift.male;
for(const [key,profile] of Object.entries(rig.values)) {
  const [species,gender]=key.split('::');
  const original=base[key];
  if(original) {
    close(profile.x, original.x*delta.x,key+' width retains approved Mao-ao relative change');
    close(profile.offsetY,original.offsetY,key+' authored head offset is unchanged');
  }
  assert(Number.isFinite(profile.head)&&profile.head>0,key+' Head factor remains finite');
}
for(const species of ['tletingan','nuhongan','longoran']) {
  assert(rig.nominalHeightFeetFor(species,'female')<rig.nominalHeightFeetFor(species,'male'),
    species+' previously taller female default is corrected');
}
close(rig.nominalHeightFeetFor('harlyao','male'),rig.values['harlyao::male'].y*
  .95/1.29*6.25,'unlisted Harlyao keeps Maoao-relative size');
assert.match(source,/const FEMALE_VISIBLE_HEIGHT_RATIO = 0\.93/,'humanlike female/male ratio is centralized');
assert.match(source,/const targetHeight = calibratedHeightFor\(species, gender\)/,
  'target heights are applied by one shared resolution path, not rewritten save snapshots');
console.log('PASS all eight adult male heights, female stature, world/chair calibration, 65% heads and 26-profile identity preservation');
