#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'); // Checks the actual shared rig sampler, not hand-copied editor formulas.
const fs=require('node:fs'); // Reads canonical rig-profile sources for species/gender comparisons.
const vm=require('node:vm'); // Executes browser modules in an isolated, predictable global scope.
const root='docs/'; // Repository doc root containing the exact modules loaded by Statue Author.
const read=path=>fs.readFileSync(root+path,'utf8'); // Reuses checked-in sources instead of test fixtures.
const global={}; // Stubbed window receives the canonical character profiles and StatueRigSnapshot API.
vm.runInNewContext(read('config/attachment-rig-profiles.js'),{window:global,performance:{now:()=>0}});
const shared=global.HOBUNJI_ATTACHMENT_RIG_PROFILES;
assert.ok(shared?.characters?.['mao-ao::male']&&shared.characters['tletingan::male']);
const legCalls=[]; // Records precise solver invocation/cleanup so no hand-written stance wins.
const fakeThree={Group:class{clear(){}}}; // Only the floor-relative temporary carrier is required by the fake solver.
global.ProceduralLegAnimation={
  attach(three,parent,opts){
    assert.equal(three,fakeThree);
    assert.equal(parent instanceof fakeThree.Group,true);
    legCalls.push({...opts,configuredFootScale:global.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale?.[opts.speciesId]?.[opts.gender]});
    let cleaned=false; // Ensures every disposable solver instance is cleaned after sampling.
    return{
      update(dt,speed,suppressed,seated){assert.equal(dt,0);assert.equal(speed,0);},
      getRestStance(){assert.equal(cleaned,false);return{
        left:{hip:{x:-.04,y:.25,z:0},ankle:{x:-.08,y:.05,z:.02}},
        right:{hip:{x:.04,y:.25,z:0},ankle:{x:.09,y:.06,z:-.01}}
      };},
      getStandingPoseDebug(){return{posteriorY:.25,coordinateSpace:'avatar-floor-relative'};},
      dispose(){cleaned=true;legCalls.at(-1).disposed=true;}
    };
  }
};
global.HobunjiCharacterRigScale={
  scaleFor:(species,gender)=>species==='mao-ao'?{x:1.2,y:.8,head:1.35,offsetY:.07}:{x:.92,y:1.1,head:1.05,offsetY:-.03},
  ageFor:npc=>npc.appearance.aging?.age||0,
  ageHunchFraction:age=>-age/1000
};
global.HobunjiHandModelProfiles={
  modelForSpecies:()=>({glb:'assets/models/hands/hand_feline.glb',mirrorX:true,scale:1.85}),
  effectiveScaleFor:()=>2.035,
  footScaleFor:()=>1.05,
  data:{handHeightFraction:.12}
};
global.SCRATCHBONES_CONFIG={game:{assets:{pngPlaneAvatar:{proceduralFeet:{
  footHeightFraction:.11,sizeBalanceMultiplier:1.01,stanceWidthFraction:.16
}}}}};
vm.runInNewContext(read('js/statue-rig-snapshot.js'),{window:global});
const api=global.HobunjiStatueRigSnapshot;
assert.equal(api?.version,1);
const npc={name:'Rig Test',appearance:{speciesId:'mao-ao',gender:'male',aging:{age:50}}};
const frame={speciesId:'mao-ao',modelWidth:.9,modelHeight:.9,placementRatio:.95,handAttachX:-.22,handAttachY:.37,childHeadFactor:1.1};
const results=api.resolve({THREE:fakeThree,npc,profile:{bodyColors:{}},frame});
assert.equal(results.profileKey,'mao-ao::male');
assert.equal(results.rigProfileFound,true);
assert.ok(results.body.width>results.body.height,'Independent x/y body rig axes must affect output dimensions');
assert.ok(results.head.scale>1.4,'Head scale + child compensation must survive (not inherit body deformation)');
assert.ok(results.head.offsetY>0,'Authoring offset and age hunch must be combined');
assert.equal(results.anatomy.handScale,shared.characters['mao-ao::male'].anatomy.handScale);
assert.equal(results.hands.modelPath,'assets/models/hands/hand_feline.glb');
assert.equal(results.hands.shoulders.left.x>0,true);
assert.equal(results.hands.shoulders.right.x<0,true);
assert.equal(results.hands.mirrorRight,true);
assert.equal(results.feet.restStance.left.ankle.x,-.08);
assert.ok(results.feet.height>.13,'Imported foot auto-fit must include the same gameplay contact diameter multiplier');
assert.equal(results.feet.positions.right.z<0,true,'3D foot z comes from procedural stance, not a fixed 2D translation');
assert.equal(results.feet.positions.left.x<results.feet.positions.right.x,true);
assert.equal(legCalls.length,1);
assert.equal(legCalls[0].disposed,true,'Temporary pose sampler must not leave a live runtime rig');
assert.equal(legCalls[0].handAttachY,frame.handAttachY);
assert.equal(legCalls[0].configuredFootScale,shared.characters['mao-ao::male'].anatomy.footScale,
  'Leg sampler uses authored species/gender foot scale while sampling');
assert.equal(global.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale,undefined,
  'Sampling must restore the global foot scale table after creating a disposable solver');
assert.equal(results.placement.authored,.95);
const shifted=api.resolve({THREE:fakeThree,npc,profile:{bodyColors:{}},
  frame:{...frame,placementRatio:.5}});
assert.ok(Math.abs(shifted.placement.handAttachY-(frame.handAttachY+(.95-.5)*frame.modelHeight))<1e-9,
  'Author portrait-Y offset must shift the measured hand attachment exactly as Multi-Avatar does');

const tla=api.resolve({THREE:fakeThree,npc:{appearance:{speciesId:'tletingan',gender:'male'}},profile:{bodyColors:{}},
  frame:{speciesId:'tletingan',modelWidth:.765,modelHeight:.765,placementRatio:.645,handAttachX:-.2,handAttachY:.25}});
assert.notEqual(tla.body.height,results.body.height,'Species/gender portrait scale must remain independent');
assert.equal(tla.anatomy.armLengthHeightPercentOffset,shared.characters['tletingan::male'].anatomy.armLengthHeightPercentOffset);
assert.equal(tla.profileKey,'tletingan::male');
const unknown=api.resolve({THREE:fakeThree,npc:{appearance:{speciesId:'harlyao-skeleton',gender:'male'}},
  profile:{bodyColors:{}},frame:{speciesId:'harlyao-skeleton',modelWidth:.9,modelHeight:.9,placementRatio:.5,handAttachX:-.2,handAttachY:.3}});
assert.equal(unknown.rigProfileFound,false,'Do not invent a species shoulder profile when no authored one exists');
const page=read('tools/statue-author/index.html');
for(const file of ['attachment-rig-profiles.js','character-rig-scale.js','procedural-leg-animation.js','statue-rig-snapshot.js']){
  assert.ok(page.includes(file),'Statue Author must load real rig dependency '+file);
}
assert.match(page,/HobunjiStatueRigSnapshot\?\.resolve/);
assert.match(page,/snapshot\.feet\.axes/);
assert.match(page,/snapshot\.hands\.axes/);
assert.match(read('js/procedural-furniture.js'),/statuePartScaleAxes/);
assert.match(read('js/procedural-furniture.js'),/statueMirrorX/);
assert.match(page,/statueRigAlignment='hand'/,'Hand GLBs must retain source grip origin in furniture');
assert.match(page,/statueRigAlignment='foot'/,'Foot GLBs must retain bottom contact as floor origin');
assert.match(page,/statueRigBodyScale=\{x:snapshot\.bodyScale\.x,y:snapshot\.bodyScale\.y\}/,
  'Independent body scale must reach every detached static limb GLB');
assert.match(read('js/procedural-furniture.js'),/part\.statueRigBodyScale/,
  'Furniture must restore the live rig floor parent body scale for hands and feet');
assert.match(read('js/procedural-furniture.js'),/part\.statueRigAlignment==='hand'\|\|part\.statueRigAlignment==='foot'/,
  'Static GLB importer needs an anatomy origin-safe branch');
assert.match(read('js/procedural-furniture.js'),/part\.transform\.sy\)\/Math\.max\(\.001,size\.y\)/,
  'Statue GLB normalization must match the real rig Y-height fit, not longest geometry axis');
assert.match(read('js/procedural-furniture.js'),/if\(!part\.statueRigAlignment\)instance\.position\.sub\(center\)/,
  'Do not recenter authored hand grip or foot ground contact');
console.log('PASS Statue rig sampler: canonical species/gender anatomy, age head offset, independent body/head axes, authored shoulders, real leg rest stance, dimensions, mirroring and cleanup.');
