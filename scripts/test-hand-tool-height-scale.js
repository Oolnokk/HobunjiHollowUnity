#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const windowObject = {
  location: { pathname: '/game/' },
  requestAnimationFrame() { return 1; },
  HobunjiCharacterDimensions: {
    dimensionsFor(speciesId, gender) {
      if (speciesId === 'mao-ao' && gender === 'male') return { height: 1 };
      if (speciesId === 'engh-sho' && gender === 'male') return { height: 2 };
      return null;
    },
  },
};
windowObject.window = windowObject;

const context = vm.createContext({
  window: windowObject,
  console,
  Math,
  Number,
  String,
  Object,
  Set,
  WeakMap,
  JSON,
});
vm.runInContext(source, context, { filename: 'hand-tool-grips.js' });

const grips = windowObject.HobunjiHandToolGrips;
assert.ok(grips, 'hand-tool grip API should load');
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-10,m||a+' != '+b);
const tall={speciesId:'engh-sho',gender:'male'};
const mao={speciesId:'mao-ao',gender:'male'};
for(const key of ['hatchet','grappleflail','workhammer']){
  const p=grips.lengthProfileForTool(key);
  assert.ok(p?.segments.length&&p.contactOutline.length>0,'approved geometry: '+key);
  near(grips.maoaoBaseScaleForTool(key),grips.toolScaleForTool(key));
  near(grips.effectiveToolScaleForTool(key,mao.speciesId,mao.gender),grips.maoaoBaseScaleForTool(key));
  near(grips.effectiveToolScaleForTool(key,tall.speciesId,tall.gender),grips.maoaoBaseScaleForTool(key));
  assert.equal(grips.heightMultiplierForTool(key),0);
  const small=grips.heldItemPlacementForTool(key,'melee',mao),big=grips.heldItemPlacementForTool(key,'melee',tall);
  near(big.scale,small.scale,'same authored size before fitting');
  const grip=grips.authoredPrimaryGripForTool(key,'melee').position;
  near(big.offset.z+grip.z*big.scale,small.offset.z+grip.z*small.scale,'grip anchor stays fixed');
}
assert.equal(grips.characterHeightRatio('engh-sho','male'),2);
grips.mutate(data=>{delete data.tools.hatchet.lengthProfile;data.tools.hatchet.toolScale=1.2;data.tools.hatchet.heightMultiplier=0;});
assert.equal(grips.lengthProfileForTool('hatchet'),null,'removing geometry survives migration');
near(grips.effectiveToolScaleForTool('hatchet','engh-sho','male'),1.2);
near(grips.effectiveToolScaleForTool('hatchet','unknown','male'),1.2);
const placement=grips.heldItemPlacementForTool('hatchet','melee',tall);
near(placement.scale,1.2);
const grip=grips.authoredPrimaryGripForTool('hatchet','melee').position;
const tip=grips.itemPointToHolder('hatchet',{x:0,y:0,z:1},'melee',tall);
near(tip.z,1.2);
const back=grips.holderPointToItem('hatchet',tip,'melee',tall);
near(back.z,1);near(back.x,0);
near(grips.primaryGripForTool('hatchet','melee',tall).position.x,-.04*1.2);
near(grips.effectiveToolScaleForTool('flute','engh-sho','male'),.9,'nonweapon retains authored height influence');
const saved=grips.clone();delete saved.groundGeometryPreset;grips.replace(saved);
assert.ok(grips.lengthProfileForTool('hatchet'),'legacy draft gets approved geometry once');
console.log('hand tool calculated-height scaling: ok');

grips.mutate(data=>{data.tools.hatchet.lengthProfile={a:-.5,b:.5,heightFraction:.8,minSegmentScale:.6,segments:[{a:-.4,b:-.2}],contactOutline:[{x:-.1,z:-.5},{x:.2,z:.5},{x:-.1,z:.5}]};});
assert.equal(grips.effectiveToolScaleForTool('hatchet','engh-sho','male'),1.2,'measured ratio is reference only');
assert.equal(grips.lengthProfileForTool('hatchet').contactOutline.length,3);
assert.equal(grips.clone().tools.hatchet.lengthProfile.contactOutline.length,3,'profile survives export');

grips.mutate(data=>{data.tools.hatchet.lengthProfile.segments=[{a:-.4,b:-.2,x0:-.05,x1:.04}];});
assert.equal(grips.lengthProfileForTool('hatchet').segments[0].x0,-.05);
assert.equal(grips.clone().tools.hatchet.lengthProfile.segments[0].x1,.04);
const shaft={shorteningBands:[{x0:180,x1:270,y0:400,y1:500}],minShorteningScale:.5};
windowObject.ModularWeapons={decode:k=>k.startsWith('modular:')?{shaft:'hatchet'}:null,sourceShape:k=>k.startsWith('modular:')?'hatchet':null,getConfig:()=>({shafts:{hatchet:shaft}}),shaftArtTransform:()=>({enabled:true,scaleX:2,scaleY:1,x:10,y:0})};
const gp=grips.groundProfileForTool('modular:hatchet:axe:iron');
assert.equal(gp,grips.groundProfileForTool('modular:hatchet:hammer:steel'));
assert.equal(gp.minSegmentScale,.5);
assert.ok(Math.abs(gp.segments[0].x0-(-80*.5/450))<1e-10);
assert.equal(gp.contactOutline.length,0,'never reuse donor contact for assembled head');

for(const key of ["hatchet","hoe","bshuakauitl","grappleflail","warhammer","pickshovel","daggersword","plainssword","dagger","kylie","warcleaver","fishingspear","fishingmace","harlyaolongsword","harlyaobroadsword"])assert.ok(grips.lengthProfileForTool(key),'latest export: '+key);
assert.equal(grips.lengthProfileForTool('grappleflail').ropeMinScale,.6);
assert.equal(grips.lengthProfileForTool('warhammer').minSegmentScale,.75);
assert.equal(grips.toolScaleForTool('hachututorchstaff'),1);

// The reset migrates old weapon settings but not non-weapon props or later deliberate edits.
const oldDraft=grips.clone();delete oldDraft.weaponHeightPreset;oldDraft.tools.hatchet.heightMultiplier=1;oldDraft.tools.flute.heightMultiplier=.25;grips.replace(oldDraft);
assert.equal(grips.heightMultiplierForTool('hatchet'),0);assert.equal(grips.heightMultiplierForTool('flute'),.25);
assert.equal(grips.heightMultiplierForTool('bgungku'),0);assert.equal(grips.heightMultiplierForTool('modular:hatchet:axe:iron'),0);
grips.mutate(d=>{d.tools.hatchet.heightMultiplier=.5;});near(grips.effectiveToolScaleForTool('hatchet','engh-sho','male'),1.8);
grips.mutate(d=>{d.tools.hatchet.heightMultiplier=0;});
const dimensions=windowObject.HobunjiCharacterDimensions;windowObject.HobunjiCharacterDimensions={dimensionsFor(){throw Error('zero multiplier must skip dimension queries');}};
near(grips.effectiveToolScaleForTool('hatchet','engh-sho','male'),1.2);windowObject.HobunjiCharacterDimensions=dimensions;
// Real shipped donor bands are pre-seeded into the Foundry catalog, not contact outlines.
const foundryWindow={};foundryWindow.window=foundryWindow;
new Function('window',fs.readFileSync('docs/config/modular-weapons.js','utf8'))(foundryWindow);
new Function('window',fs.readFileSync('docs/js/modular-weapons.js','utf8'))(foundryWindow);
const foundry=foundryWindow.ModularWeapons;const initial=foundry.getConfig();
for(const [shaftKey,donorKey] of Object.entries({"bshuakauitl":"bshuakauitl","dagger-sword":"daggersword","dagger":"dagger","fishing-mace":"fishingmace","fishing-spear":"fishingspear","harlyao-broadsword":"harlyaobroadsword","harlyao-longsword":"harlyaolongsword","war-cleaver":"warcleaver","warhammer":"warhammer","hatchet":"hatchet","hoe":"hoe","kylie":"kylie","pick-shovel":"pickshovel","plains-sword":"plainssword","grapple-flail":"grappleflail"})){
  const shaft=initial.shafts[shaftKey],donor=grips.defaultData.tools[donorKey].lengthProfile;
  assert.equal(shaft.shorteningBands.length,donor.segments.length,shaftKey);
  assert.equal(shaft.minShorteningScale,donor.minSegmentScale);
  for(let i=0;i<donor.segments.length;i++){const b=shaft.shorteningBands[i],p=donor.segments[i];near((b.x0-225)/900,p.x0);near((b.x1-225)/900,p.x1);near((b.y0-602)/900,p.a);near((b.y1-602)/900,p.b);}
}
assert.ok(!initial.shafts.bgungku.shorteningBands?.length,'no donor band to copy');
const legacy=JSON.parse(JSON.stringify(initial));delete legacy.donorBandPreset;legacy.shafts.hatchet.shorteningBands=[];foundry.replace(legacy);assert.equal(foundry.getConfig().shafts.hatchet.shorteningBands.length,1);
const cleared=JSON.parse(JSON.stringify(foundry.getConfig()));cleared.shafts.hatchet.shorteningBands=[];foundry.replace(cleared);assert.equal(foundry.getConfig().shafts.hatchet.shorteningBands.length,0);
console.log('fixed weapon sizing and matching donor shaft bands: ok');
